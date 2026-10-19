begin;

create or replace function public.kandid_finalize_masterlist_import_with_membership_sync(
  p_import_id integer,
  p_actor_admin_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor_ok boolean;
  import_term_id integer;
  import_status text;
  active_term_count integer;
  active_term_id integer;
  r record;
  v_resolved_program_id bigint;
  org record;
  membership public.student_organization_terms%rowtype;
  previous_activation_marker text;
  previous_reconcile_actor text;
  previous_reconcile_student text;
  previous_reconcile_term text;
  synced_membership_count integer := 0;
  synced_term_count integer := 0;
  removed_term_count integer := 0;
  removed_rows integer := 0;
  processed_student_count integer := 0;
begin
  select exists (
    select 1 from public.admin_users a
    where a.id = p_actor_admin_id and a.role = 'super_admin' and a.status = 'active'
  ) into actor_ok;
  if not actor_ok then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization required.';
  end if;
  if p_import_id is null or p_import_id <= 0 then
    raise exception using errcode = '22023', message = 'A valid masterlist import is required.';
  end if;

  select mi.academic_term_id, mi.import_status into import_term_id, import_status
  from public.masterlist_imports mi where mi.id = p_import_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Masterlist import was not found.';
  end if;
  if import_status <> 'review' then
    raise exception using errcode = '55000', message = 'Masterlist import must be in review before finalization.';
  end if;

  perform public.finalize_masterlist_import(p_import_id);

  select pg_catalog.count(*)::integer, pg_catalog.min(t.id)
    into active_term_count, active_term_id
  from public.academic_terms t where t.status = 'active';
  if active_term_count <> 1 then
    raise exception using errcode = '55000', message = 'Exactly one active academic term is required for membership reconciliation.';
  end if;
  if import_term_id <> active_term_id then
    return pg_catalog.jsonb_build_object(
      'processed_student_count', 0, 'membership_synced_count', 0,
      'term_participation_synced_count', 0, 'removed_term_participation_count', 0,
      'admission_skipped_count', 0
    );
  end if;

  previous_activation_marker := pg_catalog.current_setting('kandid.membership_activation_term_id', true);
  previous_reconcile_actor := pg_catalog.current_setting('kandid.program_reconcile_actor_id', true);
  previous_reconcile_student := pg_catalog.current_setting('kandid.program_reconcile_student_id', true);
  previous_reconcile_term := pg_catalog.current_setting('kandid.program_reconcile_term_id', true);

  for r in
    select distinct ste.student_id, ste.program
    from public.masterlist_import_rows mir
    join public.student_term_enrollments ste
      on ste.student_id = mir.matched_student_id and ste.academic_term_id = import_term_id
    where mir.import_id = p_import_id
      and mir.reconciliation_status in ('new', 'continuing', 'shifted_program', 'returnee')
      and mir.matched_student_id is not null
      and ste.enrollment_status = 'enrolled'
    order by ste.student_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(r.student_id, import_term_id);
    select program_entry.id into v_resolved_program_id
    from public.kandid_ensure_program_catalog_entry_for_server_actor(r.program, p_actor_admin_id) program_entry;
    if v_resolved_program_id is null then
      raise exception using errcode = '23503', message = 'Current enrollment program could not be resolved.';
    end if;

    perform pg_catalog.set_config('kandid.membership_activation_term_id', import_term_id::text, true);
    perform pg_catalog.set_config('kandid.program_reconcile_actor_id', p_actor_admin_id::text, true);
    perform pg_catalog.set_config('kandid.program_reconcile_student_id', r.student_id::text, true);
    perform pg_catalog.set_config('kandid.program_reconcile_term_id', import_term_id::text, true);

    update public.student_organization_terms sot
    set status = 'removed', removed_by = p_actor_admin_id,
        removed_at = pg_catalog.clock_timestamp(),
        removal_reason = 'program_change_reconciliation', updated_at = pg_catalog.clock_timestamp()
    from public.organizations o
    where sot.student_id = r.student_id and sot.academic_term_id = import_term_id
      and sot.status = 'active' and o.id = sot.organization_id
      and o.membership_scope = 'program'
      and not exists (
        select 1 from public.organization_programs op
        where op.organization_id = o.id and op.program_id = v_resolved_program_id
      );
    get diagnostics removed_rows = row_count;
    removed_term_count := removed_term_count + removed_rows;

    for org in
      select o.id from public.organizations o
      where o.membership_scope = 'institution'
         or (o.membership_scope = 'program' and exists (
           select 1 from public.organization_programs op
           where op.organization_id = o.id and op.program_id = v_resolved_program_id
         ))
      order by o.id
    loop
      select sot.* into membership from public.student_organization_terms sot
      where sot.student_id = r.student_id and sot.organization_id = org.id
        and sot.academic_term_id = import_term_id for update;
      if found then
        if membership.status = 'removed' then
          update public.student_organization_terms sot
          set status = 'active', source = 'system', removed_by = null,
              removed_at = null, removal_reason = null, updated_at = pg_catalog.clock_timestamp()
          where sot.id = membership.id;
          synced_term_count := synced_term_count + 1;
        elsif membership.status <> 'active' then
          raise exception using errcode = '23514', message = 'Unsupported current-term membership status.';
        end if;
      else
        insert into public.student_organization_terms (
          student_id, organization_id, academic_term_id, status, source
        ) values (r.student_id, org.id, import_term_id, 'active', 'system');
        synced_term_count := synced_term_count + 1;
      end if;

      insert into public.student_organizations (student_id, organization_id, role)
      values (r.student_id, org.id, 'member')
      on conflict (student_id, organization_id) do nothing;
      synced_membership_count := synced_membership_count + 1;
    end loop;
    processed_student_count := processed_student_count + 1;
  end loop;

  perform pg_catalog.set_config('kandid.membership_activation_term_id', coalesce(previous_activation_marker, ''), true);
  perform pg_catalog.set_config('kandid.program_reconcile_actor_id', coalesce(previous_reconcile_actor, ''), true);
  perform pg_catalog.set_config('kandid.program_reconcile_student_id', coalesce(previous_reconcile_student, ''), true);
  perform pg_catalog.set_config('kandid.program_reconcile_term_id', coalesce(previous_reconcile_term, ''), true);

  return pg_catalog.jsonb_build_object(
    'processed_student_count', processed_student_count,
    'membership_synced_count', synced_membership_count,
    'term_participation_synced_count', synced_term_count,
    'removed_term_participation_count', removed_term_count,
    'admission_skipped_count', 0
  );
end;
$function$;

alter function public.kandid_finalize_masterlist_import_with_membership_sync(integer, bigint) owner to postgres;
revoke all on function public.kandid_finalize_masterlist_import_with_membership_sync(integer, bigint) from public, anon, authenticated, service_role;
grant execute on function public.kandid_finalize_masterlist_import_with_membership_sync(integer, bigint) to service_role;

do $postflight$
declare
  function_owner text;
  function_is_security_definer boolean;
  function_search_path text;
  public_execute_grant boolean;
begin
  select r.rolname, p.prosecdef, p.proconfig::text,
         exists (
           select 1
           from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
           where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
         )
    into function_owner, function_is_security_definer, function_search_path, public_execute_grant
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where n.nspname = 'public'
    and p.oid = pg_catalog.to_regprocedure('public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)');

  if not found then
    raise exception 'Corrected Masterlist membership finalizer is missing.';
  end if;
  if function_owner <> 'postgres' or function_is_security_definer is distinct from true
     or function_search_path not like '%search_path=pg_catalog%' then
    raise exception 'Masterlist membership finalizer security contract differs.';
  end if;
  if not has_function_privilege('service_role', 'public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)', 'EXECUTE')
     or public_execute_grant then
    raise exception 'Masterlist membership finalizer execution grants differ.';
  end if;
end;
$postflight$;

commit;
