begin;

-- Browser clients may read the program catalog and organization coverage.
-- Mutations use trusted, role-checked RPCs; coverage replacement is Super Admin-only.
alter table public.programs enable row level security;
alter table public.organization_programs enable row level security;

do $policy_cleanup$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('programs', 'organization_programs')
  loop
    execute pg_catalog.format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$policy_cleanup$;

create policy "Program catalog is readable by app clients"
  on public.programs
  for select
  to anon, authenticated
  using (true);

create policy "Organization program coverage is readable by app clients"
  on public.organization_programs
  for select
  to anon, authenticated
  using (true);

revoke all on table public.programs from public, anon, authenticated;
revoke all on table public.organization_programs from public, anon, authenticated;
grant select on table public.programs to anon, authenticated;
grant select on table public.organization_programs to anon, authenticated;

revoke all on sequence public.programs_id_seq from public, anon, authenticated, service_role;

-- Temporary expand-phase compatibility: already-deployed enrollment/import
-- Edge Functions still use direct program upserts until all three updated
-- functions call the audited server operation below. The contract migration
-- removes these table/sequence privileges after that deployment.
revoke all on table public.programs from service_role;
grant select, insert, update on table public.programs to service_role;
grant usage, select on sequence public.programs_id_seq to service_role;
grant select on table public.organization_programs to service_role;

create or replace function public.kandid_ensure_program_catalog_entry_for_server_actor(
  p_code text,
  p_actor_admin_id bigint
)
returns table (
  id bigint,
  code text,
  name text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor_name text;
  actor_role text;
  normalized_code text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_code, '')));
  program_row public.programs%rowtype;
  inserted_rows integer;
begin
  select a.full_name, a.role
  into actor_name, actor_role
  from public.admin_users a
  where a.id = p_actor_admin_id
    and a.status = 'active'
    and a.role in ('electoral_board', 'super_admin');

  if not found then
    raise exception using errcode = '42501', message = 'Active administrator authorization required.';
  end if;

  if normalized_code = '' then
    raise exception using errcode = '22023', message = 'Program code is required.';
  end if;

  select p.*
  into program_row
  from public.programs p
  where pg_catalog.upper(pg_catalog.btrim(p.code)) = normalized_code
  order by p.id
  limit 1;

  if not found then
    insert into public.programs (code, name)
    values (normalized_code, normalized_code)
    on conflict (code) do nothing
    returning * into program_row;

    get diagnostics inserted_rows = row_count;

    if inserted_rows = 0 then
      select p.*
      into program_row
      from public.programs p
      where p.code = normalized_code
      limit 1;
    else
      insert into public.audit_logs (
        user_id,
        actor_name,
        actor_role,
        action,
        entity_type,
        entity_id,
        entity_label,
        status,
        metadata
      ) values (
        p_actor_admin_id,
        actor_name,
        actor_role,
        'program_catalog_entry_created',
        'program',
        program_row.id::text,
        program_row.code,
        'completed',
        pg_catalog.jsonb_build_object(
          'program_id', program_row.id,
          'code', program_row.code,
          'name', program_row.name
        )
      );
    end if;
  end if;

  if program_row.id is null then
    raise exception using errcode = '23503', message = 'Program catalog entry could not be resolved.';
  end if;

  return query select program_row.id, program_row.code, program_row.name;
end;
$function$;

create or replace function public.kandid_ensure_program_catalog_entry(
  p_code text
)
returns table (
  id bigint,
  code text,
  name text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  admin_id bigint;
  actor_role text;
begin
  if caller_uid is null then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization required.';
  end if;

  select a.id, a.role
  into admin_id, actor_role
  from public.admin_users a
  where a.auth_user_id = caller_uid
    and a.role = 'super_admin'
    and a.status = 'active';

  if not found then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization required.';
  end if;

  return query
    select resolved.id, resolved.code, resolved.name
    from public.kandid_ensure_program_catalog_entry_for_server_actor(
      p_code,
      admin_id
    ) as resolved;
end;
$function$;

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
  synced_count integer := 0;
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

  -- Preserve the existing additive structural-membership sync. Coverage
  -- removal does not delete or deactivate existing membership/term records.
  if organization_row.organization_type = 'departmental' then
    insert into public.student_organizations (student_id, organization_id, role)
    select distinct s.id, organization_row.id, 'member'
    from public.students s
    join public.programs p
      on pg_catalog.upper(pg_catalog.btrim(coalesce(s.program, ''))) = pg_catalog.upper(pg_catalog.btrim(coalesce(p.code, '')))
      or pg_catalog.upper(pg_catalog.btrim(coalesce(s.program, ''))) = pg_catalog.upper(pg_catalog.btrim(coalesce(p.name, '')))
    join public.organization_programs op
      on op.program_id = p.id
     and op.organization_id = organization_row.id
    where nullif(pg_catalog.btrim(coalesce(s.program, '')), '') is not null
    on conflict (student_id, organization_id) do nothing;

    get diagnostics synced_count = row_count;
  end if;

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
      'synchronized_membership_insert_count', synced_count
    )
  );

  return pg_catalog.jsonb_build_object(
    'organization_id', organization_row.id,
    'programs', after_programs,
    'synchronized_membership_insert_count', synced_count
  );
end;
$function$;

revoke all on function public.kandid_ensure_program_catalog_entry(text)
  from public, anon, authenticated;
grant execute on function public.kandid_ensure_program_catalog_entry(text)
  to authenticated;

revoke all on function public.kandid_ensure_program_catalog_entry_for_server_actor(text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_ensure_program_catalog_entry_for_server_actor(text, bigint)
  to service_role;

revoke all on function public.kandid_replace_organization_program_coverage(bigint, bigint[])
  from public, anon, authenticated;
grant execute on function public.kandid_replace_organization_program_coverage(bigint, bigint[])
  to authenticated;

comment on function public.kandid_ensure_program_catalog_entry(text) is
  'Creates or resolves a program catalog entry for an active Super Admin; identity is derived from auth.uid() and creation is audited transactionally.';
comment on function public.kandid_ensure_program_catalog_entry_for_server_actor(text, bigint) is
  'Server-only program catalog create-or-resolve operation for an authenticated active admin actor; creates and audits atomically.';
comment on function public.kandid_replace_organization_program_coverage(bigint, bigint[]) is
  'Atomically replaces organization program coverage for an active Super Admin, performs additive structural membership sync, and records exact before/after coverage in audit_logs.';

commit;
