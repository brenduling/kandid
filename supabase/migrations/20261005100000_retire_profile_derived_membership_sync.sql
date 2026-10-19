begin;

-- Current membership is term-scoped. Student profile changes and organization
-- coverage edits must not manufacture structural compatibility links from the
-- mutable students.program profile field.
--
-- Retire only the legacy profile-triggered writer. Keep its trigger function
-- and all existing student_organizations rows, foreign keys, and audit triggers.
drop trigger if exists trg_sync_student_organization_memberships on public.students;

-- Coverage is configuration only. Keep the trusted Super Admin authorization,
-- validation, atomic replacement, return shape, and configuration audit, while
-- removing the former profile-derived student_organizations projection.
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

  select o.*
  into organization_row
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
    select 1
    from pg_catalog.unnest(normalized_program_ids) as requested(program_id)
    where requested.program_id is null or requested.program_id <= 0
  ) then
    raise exception using errcode = '22023', message = 'Program IDs must be positive values.';
  end if;

  if requested_count <> distinct_count then
    raise exception using errcode = '22023', message = 'Duplicate programs are not allowed.';
  end if;

  select pg_catalog.count(*)::integer
  into matched_count
  from public.programs p
  where p.id = any(normalized_program_ids);

  if matched_count <> distinct_count then
    raise exception using errcode = '23503', message = 'One or more programs were not found.';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name)
      order by p.code, p.id
    ),
    '[]'::jsonb
  )
  into before_programs
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
    ),
    '[]'::jsonb
  )
  into after_programs
  from public.organization_programs op
  join public.programs p on p.id = op.program_id
  where op.organization_id = organization_row.id;

  insert into public.audit_logs (
    user_id,
    actor_name,
    actor_role,
    action,
    entity_type,
    entity_id,
    entity_label,
    organization_id,
    organization_name,
    status,
    metadata
  ) values (
    admin_id,
    admin_name,
    'super_admin',
    'organization_program_coverage_replaced',
    'organization',
    organization_row.id::text,
    organization_row.name,
    organization_row.id,
    organization_row.name,
    'completed',
    pg_catalog.jsonb_build_object(
      'before_programs', before_programs,
      'after_programs', after_programs,
      'synchronized_membership_insert_count', 0
    )
  );

  return pg_catalog.jsonb_build_object(
    'organization_id', organization_row.id,
    'programs', after_programs,
    'synchronized_membership_insert_count', 0
  );
end;
$function$;

alter function public.kandid_replace_organization_program_coverage(bigint, bigint[]) owner to postgres;
revoke all on function public.kandid_replace_organization_program_coverage(bigint, bigint[])
  from public, anon, authenticated;
grant execute on function public.kandid_replace_organization_program_coverage(bigint, bigint[])
  to authenticated;
comment on function public.kandid_replace_organization_program_coverage(bigint, bigint[]) is
  'Atomically replaces program coverage for an active Super Admin and audits before/after configuration; does not project profile-derived student memberships.';

commit;
