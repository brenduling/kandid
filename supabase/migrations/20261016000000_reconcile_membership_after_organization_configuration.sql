begin;

-- When organization coverage changes during an already active semester,
-- reconcile only that organization's newly eligible current-term memberships.
-- New-term activation remains the full-semester synchronization boundary.
create or replace function public.kandid_sync_organization_memberships_for_current_term(
  p_organization_id bigint
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  admin_found boolean;
  active_term_count integer;
  active_term_id integer;
  organization_scope text;
  previous_sync_setting text;
  inserted_membership_count integer := 0;
begin
  if caller_uid is null then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization required.';
  end if;

  select exists (
    select 1 from public.admin_users a
    where a.auth_user_id = caller_uid
      and a.role = 'super_admin'
      and a.status = 'active'
  ) into admin_found;
  if not admin_found then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization required.';
  end if;

  select o.membership_scope into organization_scope
  from public.organizations o
  where o.id = p_organization_id;
  if not found then
    raise exception using errcode = '23503', message = 'Organization was not found.';
  end if;
  if organization_scope = 'manual' then
    return 0;
  end if;
  if organization_scope is null or organization_scope not in ('program', 'institution') then
    raise exception using errcode = '23514', message = 'Organization membership scope is not configured.';
  end if;

  select pg_catalog.count(*)::integer, pg_catalog.min(t.id)
    into active_term_count, active_term_id
  from public.academic_terms t
  where t.status = 'active';
  if active_term_count > 1 then
    raise exception using errcode = '55000', message = 'Multiple active academic terms require administrator review.';
  end if;
  if active_term_count = 0 then
    return 0;
  end if;

  previous_sync_setting := pg_catalog.current_setting('kandid.membership_activation_term_id', true);
  perform pg_catalog.set_config('kandid.membership_activation_term_id', active_term_id::text, true);

  with enrolled as materialized (
    select ste.student_id, ste.program
    from public.student_term_enrollments ste
    where ste.academic_term_id = active_term_id
      and ste.enrollment_status = 'enrolled'
  ), resolved as materialized (
    select e.student_id, public.kandid_resolve_program_catalog_id(e.program) as program_id
    from enrolled e
  ), eligible as materialized (
    select distinct r.student_id
    from resolved r
    where organization_scope = 'institution'
       or (
         organization_scope = 'program'
         and r.program_id is not null
         and exists (
           select 1 from public.organization_programs op
           where op.organization_id = p_organization_id
             and op.program_id = r.program_id
         )
       )
  )
  insert into public.student_organization_terms (
    student_id, organization_id, academic_term_id, status, source
  )
  select e.student_id, p_organization_id::integer, active_term_id, 'active', 'system'
  from eligible e
  on conflict (student_id, organization_id, academic_term_id) do nothing;

  get diagnostics inserted_membership_count = row_count;

  -- Keep the legacy structural projection additive and scoped to this
  -- organization. Current membership remains authoritative in the term table.
  with enrolled as materialized (
    select ste.student_id, ste.program
    from public.student_term_enrollments ste
    where ste.academic_term_id = active_term_id
      and ste.enrollment_status = 'enrolled'
  ), resolved as materialized (
    select e.student_id, public.kandid_resolve_program_catalog_id(e.program) as program_id
    from enrolled e
  ), eligible as materialized (
    select distinct r.student_id
    from resolved r
    where organization_scope = 'institution'
       or (
         organization_scope = 'program'
         and r.program_id is not null
         and exists (
           select 1 from public.organization_programs op
           where op.organization_id = p_organization_id
             and op.program_id = r.program_id
         )
       )
  )
  insert into public.student_organizations (student_id, organization_id, role)
  select e.student_id, p_organization_id::integer, 'member'
  from eligible e
  join public.student_organization_terms sot
    on sot.student_id = e.student_id
   and sot.organization_id = p_organization_id::integer
   and sot.academic_term_id = active_term_id
   and sot.status = 'active'
  on conflict (student_id, organization_id) do nothing;

  perform pg_catalog.set_config(
    'kandid.membership_activation_term_id', coalesce(previous_sync_setting, ''), true
  );

  return inserted_membership_count;
end;
$function$;

alter function public.kandid_sync_organization_memberships_for_current_term(bigint) owner to postgres;
revoke all on function public.kandid_sync_organization_memberships_for_current_term(bigint)
  from public, anon, authenticated, service_role;

-- Preserve the existing active-Super-Admin checks, atomic coverage replacement,
-- audit details, and return contract while invoking the term-scoped helper.
create or replace function public.kandid_replace_organization_program_coverage(
  p_organization_id bigint,
  p_program_ids bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  admin_id bigint;
  admin_name text;
  organization_row public.organizations%rowtype;
  normalized_program_ids bigint[] := coalesce(p_program_ids, array[]::bigint[]);
  requested_count integer;
  distinct_count integer;
  matched_count integer;
  before_programs jsonb;
  after_programs jsonb;
  synchronized_membership_insert_count integer := 0;
begin
  if caller_uid is null then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization required.';
  end if;

  select a.id, a.full_name
  into admin_id, admin_name
  from public.admin_users a
  where a.auth_user_id = caller_uid
    and a.role = 'super_admin'
    and a.status = 'active';

  if not found then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization required.';
  end if;

  if p_organization_id is null or p_organization_id <= 0 then
    raise exception using errcode = '22023', message = 'A valid organization is required.';
  end if;

  select o.* into organization_row
  from public.organizations o
  where o.id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'Organization was not found.';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.count(distinct requested.program_id)::integer
  into requested_count, distinct_count
  from pg_catalog.unnest(normalized_program_ids) as requested(program_id);

  if exists (
    select 1 from pg_catalog.unnest(normalized_program_ids) as requested(program_id)
    where requested.program_id is null or requested.program_id <= 0
  ) then
    raise exception using errcode = '22023', message = 'Program IDs must be positive values.';
  end if;
  if requested_count <> distinct_count then
    raise exception using errcode = '22023', message = 'Duplicate programs are not allowed.';
  end if;

  select pg_catalog.count(*)::integer into matched_count
  from public.programs p where p.id = any(normalized_program_ids);
  if matched_count <> distinct_count then
    raise exception using errcode = '23503', message = 'One or more programs were not found.';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name)
      order by p.code, p.id
    ), '[]'::jsonb
  ) into before_programs
  from public.organization_programs op
  join public.programs p on p.id = op.program_id
  where op.organization_id = organization_row.id;

  delete from public.organization_programs op
  where op.organization_id = organization_row.id;
  insert into public.organization_programs (organization_id, program_id)
  select organization_row.id, requested.program_id
  from pg_catalog.unnest(normalized_program_ids) as requested(program_id)
  order by requested.program_id;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name)
      order by p.code, p.id
    ), '[]'::jsonb
  ) into after_programs
  from public.organization_programs op
  join public.programs p on p.id = op.program_id
  where op.organization_id = organization_row.id;

  synchronized_membership_insert_count :=
    public.kandid_sync_organization_memberships_for_current_term(organization_row.id);

  insert into public.audit_logs (
    user_id, actor_name, actor_role, action, entity_type, entity_id, entity_label,
    organization_id, organization_name, status, metadata
  ) values (
    admin_id, admin_name, 'super_admin', 'organization_program_coverage_replaced',
    'organization', organization_row.id::text, organization_row.name,
    organization_row.id, organization_row.name, 'completed',
    pg_catalog.jsonb_build_object(
      'before_programs', before_programs,
      'after_programs', after_programs,
      'synchronized_membership_insert_count', synchronized_membership_insert_count
    )
  );

  return pg_catalog.jsonb_build_object(
    'organization_id', organization_row.id,
    'programs', after_programs,
    'synchronized_membership_insert_count', synchronized_membership_insert_count
  );
end;
$function$;

alter function public.kandid_replace_organization_program_coverage(bigint, bigint[]) owner to postgres;
revoke all on function public.kandid_replace_organization_program_coverage(bigint, bigint[])
  from public, anon, authenticated;
grant execute on function public.kandid_replace_organization_program_coverage(bigint, bigint[])
  to authenticated;
comment on function public.kandid_replace_organization_program_coverage(bigint, bigint[]) is
  'Atomically replaces program coverage for an active Super Admin, reconciles additive current-term memberships only for that organization, and audits before/after configuration.';

commit;
