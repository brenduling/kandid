begin;

-- This RPC is the trusted Super Admin companion to manual Student enrollment.
-- It uses the same transaction-local markers and guarded system provenance as
-- the term activation and Masterlist reconciliation workflows.
do $preflight$
begin
  if pg_catalog.to_regclass('public.admin_users') is null
     or pg_catalog.to_regclass('public.academic_terms') is null
     or pg_catalog.to_regclass('public.student_term_enrollments') is null
     or pg_catalog.to_regclass('public.student_organization_terms') is null
     or pg_catalog.to_regclass('public.student_organizations') is null
     or pg_catalog.to_regclass('public.organizations') is null
     or pg_catalog.to_regclass('public.organization_programs') is null
     or pg_catalog.to_regclass('public.programs') is null then
    raise exception 'Membership synchronization preflight failed: required KANDID tables are missing.';
  end if;

  if pg_catalog.to_regprocedure('public.kandid_ensure_program_catalog_entry_for_server_actor(text,bigint)') is null
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.kandid_ensure_program_catalog_entry_for_server_actor(text,bigint)',
       'EXECUTE'
     ) then
    raise exception 'Membership synchronization preflight failed: trusted program catalog contract is unavailable.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.student_organization_terms'::pg_catalog.regclass
      and t.tgname = 'student_organization_terms_admission_guard'
      and not t.tgisinternal
  ) then
    raise exception 'Membership synchronization preflight failed: membership admission guard is unavailable.';
  end if;
end;
$preflight$;

create or replace function public.kandid_super_admin_sync_current_term_memberships(
  p_actor_admin_id bigint,
  p_student_id integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  active_term_count integer;
  active_term_id integer;
  enrollment_program text;
  resolved_program_id bigint;
  organization_row record;
  membership_row public.student_organization_terms%rowtype;
  previous_activation_marker text;
  previous_reconcile_actor text;
  previous_reconcile_student text;
  previous_reconcile_term text;
  created_ids integer[] := array[]::integer[];
  restored_ids integer[] := array[]::integer[];
  removed_ids integer[] := array[]::integer[];
  active_ids integer[] := array[]::integer[];
begin
  if p_actor_admin_id is null or p_actor_admin_id <= 0
     or not exists (
       select 1 from public.admin_users a
       where a.id = p_actor_admin_id
         and a.role = 'super_admin'
         and a.status = 'active'
     ) then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization required.';
  end if;
  if p_student_id is null or p_student_id <= 0 then
    raise exception using errcode = '22023', message = 'A valid Student is required.';
  end if;

  -- Hold the active term row stable so term activation cannot change while
  -- this synchronization chooses its scope.
  perform 1
  from public.academic_terms t
  where t.status = 'active'
  for share;

  select pg_catalog.count(*)::integer, pg_catalog.min(t.id)
    into active_term_count, active_term_id
  from public.academic_terms t
  where t.status = 'active';
  if active_term_count <> 1 then
    raise exception using errcode = '55000', message = 'Exactly one active academic term is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(p_student_id, active_term_id);

  select ste.program into enrollment_program
  from public.student_term_enrollments ste
  where ste.student_id = p_student_id
    and ste.academic_term_id = active_term_id
    and ste.enrollment_status = 'enrolled'
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'Student must be enrolled in the active academic term.';
  end if;

  select program_entry.id into resolved_program_id
  from public.kandid_ensure_program_catalog_entry_for_server_actor(
    enrollment_program,
    p_actor_admin_id
  ) as program_entry;
  if resolved_program_id is null then
    raise exception using errcode = '23503', message = 'Current enrollment program could not be resolved.';
  end if;

  previous_activation_marker := pg_catalog.current_setting('kandid.membership_activation_term_id', true);
  previous_reconcile_actor := pg_catalog.current_setting('kandid.program_reconcile_actor_id', true);
  previous_reconcile_student := pg_catalog.current_setting('kandid.program_reconcile_student_id', true);
  previous_reconcile_term := pg_catalog.current_setting('kandid.program_reconcile_term_id', true);

  perform pg_catalog.set_config('kandid.membership_activation_term_id', active_term_id::text, true);
  perform pg_catalog.set_config('kandid.program_reconcile_actor_id', p_actor_admin_id::text, true);
  perform pg_catalog.set_config('kandid.program_reconcile_student_id', p_student_id::text, true);
  perform pg_catalog.set_config('kandid.program_reconcile_term_id', active_term_id::text, true);

  -- A prior program's automatic membership is ended using the existing guarded
  -- reconciliation reason. Manual-scope memberships are never touched here.
  with removed as (
    update public.student_organization_terms sot
    set status = 'removed',
        removed_by = p_actor_admin_id,
        removed_at = pg_catalog.clock_timestamp(),
        removal_reason = 'program_change_reconciliation',
        updated_at = pg_catalog.clock_timestamp()
    from public.organizations o
    where sot.student_id = p_student_id
      and sot.academic_term_id = active_term_id
      and sot.status = 'active'
      and sot.source = 'system'
      and o.id = sot.organization_id
      and o.membership_scope = 'program'
      and not exists (
        select 1 from public.organization_programs op
        where op.organization_id = o.id
          and op.program_id = resolved_program_id
      )
    returning sot.organization_id
  )
  select coalesce(pg_catalog.array_agg(removed.organization_id order by removed.organization_id), array[]::integer[])
    into removed_ids
  from removed;

  for organization_row in
    select o.id, o.membership_scope
    from public.organizations o
    where o.membership_scope = 'institution'
       or (
         o.membership_scope = 'program'
         and exists (
           select 1 from public.organization_programs op
           where op.organization_id = o.id
             and op.program_id = resolved_program_id
         )
       )
    order by o.id
  loop
    select sot.* into membership_row
    from public.student_organization_terms sot
    where sot.student_id = p_student_id
      and sot.organization_id = organization_row.id
      and sot.academic_term_id = active_term_id
    for update;

    if not found then
      insert into public.student_organization_terms (
        student_id, organization_id, academic_term_id, status, source
      ) values (
        p_student_id, organization_row.id, active_term_id, 'active', 'system'
      );
      created_ids := pg_catalog.array_append(created_ids, organization_row.id);
    elsif membership_row.status = 'active' then
      null;
    elsif membership_row.status = 'removed'
      and organization_row.membership_scope = 'program'
      and membership_row.source = 'system'
      and membership_row.removal_reason = 'program_change_reconciliation' then
      update public.student_organization_terms sot
      set status = 'active',
          source = 'system',
          removed_by = null,
          removed_at = null,
          removal_reason = null,
          updated_at = pg_catalog.clock_timestamp()
      where sot.id = membership_row.id;
      restored_ids := pg_catalog.array_append(restored_ids, organization_row.id);
    elsif membership_row.status = 'removed' then
      -- Preserve explicit or otherwise unrecognized removals; they require
      -- their established trusted restoration workflow.
      continue;
    else
      raise exception using errcode = '23514', message = 'Unsupported current-term membership status.';
    end if;

    select sot.* into membership_row
    from public.student_organization_terms sot
    where sot.student_id = p_student_id
      and sot.organization_id = organization_row.id
      and sot.academic_term_id = active_term_id;
    if membership_row.status = 'active' then
      active_ids := pg_catalog.array_append(active_ids, organization_row.id);
      insert into public.student_organizations (student_id, organization_id, role)
      values (p_student_id, organization_row.id, 'member')
      on conflict (student_id, organization_id) do nothing;
    end if;
  end loop;

  perform pg_catalog.set_config('kandid.membership_activation_term_id', coalesce(previous_activation_marker, ''), true);
  perform pg_catalog.set_config('kandid.program_reconcile_actor_id', coalesce(previous_reconcile_actor, ''), true);
  perform pg_catalog.set_config('kandid.program_reconcile_student_id', coalesce(previous_reconcile_student, ''), true);
  perform pg_catalog.set_config('kandid.program_reconcile_term_id', coalesce(previous_reconcile_term, ''), true);

  return pg_catalog.jsonb_build_object(
    'academic_term_id', active_term_id,
    'active_organization_ids', active_ids,
    'created_organization_ids', created_ids,
    'restored_organization_ids', restored_ids,
    'removed_organization_ids', removed_ids
  );
end;
$function$;

alter function public.kandid_super_admin_sync_current_term_memberships(bigint, integer) owner to postgres;
revoke all on function public.kandid_super_admin_sync_current_term_memberships(bigint, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_super_admin_sync_current_term_memberships(bigint, integer)
  to service_role;

do $postflight$
declare
  target_oid oid := pg_catalog.to_regprocedure('public.kandid_super_admin_sync_current_term_memberships(bigint,integer)');
  owner_name text;
  is_security_definer boolean;
  configured_search_path text[];
begin
  if target_oid is null then
    raise exception 'Membership synchronization postflight failed: RPC is missing.';
  end if;
  select r.rolname, p.prosecdef, p.proconfig
    into owner_name, is_security_definer, configured_search_path
  from pg_catalog.pg_proc p
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where p.oid = target_oid;

  if owner_name <> 'postgres' or is_security_definer is distinct from true
     or configured_search_path is distinct from array['search_path=pg_catalog']::text[] then
    raise exception 'Membership synchronization postflight failed: owner or SECURITY DEFINER search path is incorrect.';
  end if;
  if not pg_catalog.has_function_privilege('service_role', target_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', target_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', target_oid, 'EXECUTE')
     or exists (
       select 1 from pg_catalog.aclexplode(
         coalesce((select p.proacl from pg_catalog.pg_proc p where p.oid = target_oid), pg_catalog.acldefault('f', (select p.proowner from pg_catalog.pg_proc p where p.oid = target_oid)))
       ) acl
       where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'Membership synchronization postflight failed: effective EXECUTE grants are incorrect.';
  end if;
end;
$postflight$;

commit;
