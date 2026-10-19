begin;

-- Membership scope is trusted organization configuration. Organization type
-- remains the visible classification; the scope expresses how membership is
-- established for future term-aware resolution.
alter table public.organizations
  add column if not exists membership_scope text;

do $migration$
declare
  witsg_row public.organizations%rowtype;
  witsg_candidate_count integer;
  witsg_coverage_count integer;
  witsg_deleted_count integer;
  witsg_before_coverage jsonb;
begin
  select count(*)::integer
  into witsg_candidate_count
  from public.organizations o
  where pg_catalog.upper(pg_catalog.btrim(coalesce(o.name, ''))) in (
      'WITSG', 'WIT-SG', 'WIT SG'
    )
     or pg_catalog.upper(pg_catalog.btrim(coalesce(o.description, ''))) =
        'WESTERN INSTITUTE OF TECHNOLOGY STUDENT GOVERNMENT';

  select o.* into witsg_row
  from public.organizations o
  where o.id = 2;

  if not found
     or witsg_row.name is distinct from 'WITSG'
     or witsg_row.description is distinct from 'Western Institute of Technology Student Government'
     or witsg_row.organization_type is distinct from 'departmental'
     or witsg_candidate_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'Verified institution-wide organization identity no longer matches organization ID 2; review the organization scope migration.';
  end if;

  select pg_catalog.count(*)::integer
  into witsg_coverage_count
  from public.organization_programs op
  where op.organization_id = 2;

  if witsg_coverage_count <> 8 then
    raise exception using
      errcode = '23514',
      message = 'Verified WITSG coverage does not match the approved eight-program pre-state; review it before assigning institution scope.';
  end if;

  if exists (
    select 1
    from (values
      (1::bigint, 'BSHM'::text, 'BSHM'::text),
      (2::bigint, 'BSIT'::text, 'BSIT'::text),
      (3::bigint, 'BSCE'::text, 'BSCE'::text),
      (4::bigint, 'BSEE'::text, 'BSEE'::text),
      (5::bigint, 'BSME'::text, 'BSME'::text),
      (6::bigint, 'BSCOMPE'::text, 'BSCOMPE'::text),
      (12::bigint, 'BSMARE'::text, 'BSMARE'::text),
      (16::bigint, 'BSBA'::text, 'BSBA'::text)
    ) expected(program_id, program_code, program_name)
    left join public.organization_programs op
      on op.organization_id = 2
     and op.program_id = expected.program_id
    left join public.programs p
      on p.id = expected.program_id
    where op.program_id is null
       or p.id is null
       or p.code is distinct from expected.program_code
       or p.name is distinct from expected.program_name
  ) or exists (
    select 1
    from public.organization_programs op
    where op.organization_id = 2
      and op.program_id not in (1, 2, 3, 4, 5, 6, 12, 16)
  ) then
    raise exception using
      errcode = '23514',
      message = 'Verified WITSG coverage differs from the approved program IDs and catalog identities; review it before assigning institution scope.';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'program_id', p.id,
        'program_code', p.code,
        'program_name', p.name
      ) order by p.id
    ),
    '[]'::jsonb
  )
  into witsg_before_coverage
  from public.organization_programs op
  join public.programs p on p.id = op.program_id
  where op.organization_id = 2;

  -- This migration actor is intentionally not represented as a human admin.
  -- The audit row and coverage retirement share this migration transaction.
  insert into public.audit_logs (
    user_id, actor_name, actor_role, action, event_type, event_category,
    entity_type, entity_id, entity_label, organization_id, organization_name,
    status, event_origin, metadata
  ) values (
    null,
    '20261003110000_organization_membership_scope.sql',
    'system_migration',
    'WITSG legacy program coverage retired for institution-scope migration',
    'organization_program_coverage_retired',
    'organization',
    'organization',
    '2',
    'WITSG',
    2,
    'WITSG',
    'completed',
    'trusted_database',
    pg_catalog.jsonb_build_object(
      'migration', '20261003110000_organization_membership_scope.sql',
      'reason', 'Retire verified WITSG legacy program coverage before assigning institution membership scope.',
      'organization_id', 2,
      'before_programs', witsg_before_coverage,
      'after_programs', '[]'::jsonb
    )
  );

  delete from public.organization_programs op
  where op.organization_id = 2
    and op.program_id in (1, 2, 3, 4, 5, 6, 12, 16);
  get diagnostics witsg_deleted_count = row_count;

  if witsg_deleted_count <> 8 then
    raise exception using
      errcode = '23514',
      message = 'WITSG coverage retirement did not remove exactly the eight approved rows.';
  end if;

  if exists (
    select 1 from public.organization_programs op
    where op.organization_id = 2
  ) then
    raise exception using
      errcode = '23514',
      message = 'WITSG program coverage remains after the approved retirement.';
  end if;

  if exists (
    select 1 from public.organization_programs op
    where op.organization_id = 2
  ) then
    raise exception using
      errcode = '23514',
      message = 'Verified institution-wide organization has program coverage; review it before assigning institution scope.';
  end if;

  if exists (
    select 1
    from public.organizations o
    where o.id <> 2
      and (
        o.organization_type is null
        or o.organization_type not in ('departmental', 'non_departmental')
        or (
          o.organization_type = 'departmental'
          and not exists (
            select 1 from public.organization_programs op
            where op.organization_id = o.id
          )
        )
        or (
          o.organization_type = 'non_departmental'
          and exists (
            select 1 from public.organization_programs op
            where op.organization_id = o.id
          )
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Existing organization type and program coverage do not support deterministic membership scope classification.';
  end if;

  update public.organizations o
  set membership_scope = case
    when o.id = 2 then 'institution'
    when o.organization_type = 'departmental' then 'program'
    when o.organization_type = 'non_departmental' then 'manual'
  end;
end;
$migration$;

alter table public.organizations
  alter column membership_scope set not null;

alter table public.organizations
  add constraint organizations_membership_scope_check
  check (membership_scope in ('program', 'manual', 'institution'));

alter table public.organizations
  add constraint organizations_membership_scope_type_check
  check (
    organization_type is not null
    and organization_type in ('departmental', 'non_departmental')
    and (
      (membership_scope = 'program' and organization_type = 'departmental')
      or (membership_scope = 'manual' and organization_type = 'non_departmental')
      or membership_scope = 'institution'
    )
  );

-- Configuration changes must pass through the trusted Super Admin RPCs.
-- Keep existing read access, but remove any direct DML grants that may have
-- been inherited from the earlier schema setup, including service_role DML.
revoke insert, update, delete, truncate, references, trigger
  on table public.organizations
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger
  on table public.organization_programs
  from public, anon, authenticated, service_role;

create unique index organizations_one_institution_scope_idx
  on public.organizations (membership_scope)
  where membership_scope = 'institution';

create or replace function public.kandid_set_organization_membership_scope()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if new.organization_type is null
     or new.organization_type not in ('departmental', 'non_departmental') then
    raise exception using errcode = '23514', message = 'Organization type is invalid.';
  end if;

  if tg_op = 'INSERT' then
    if new.membership_scope is null then
      new.membership_scope := case new.organization_type
        when 'departmental' then 'program'
        when 'non_departmental' then 'manual'
        else null
      end;
    end if;
  elsif new.organization_type is distinct from old.organization_type
     and old.membership_scope <> 'institution'
     and new.membership_scope is not distinct from old.membership_scope then
    new.membership_scope := case new.organization_type
      when 'departmental' then 'program'
      when 'non_departmental' then 'manual'
      else null
    end;
  end if;

  if new.membership_scope not in ('program', 'manual', 'institution') then
    raise exception using errcode = '23514', message = 'Organization membership scope is invalid.';
  end if;

  if (new.membership_scope = 'program' and new.organization_type <> 'departmental')
     or (new.membership_scope = 'manual' and new.organization_type <> 'non_departmental') then
    raise exception using errcode = '23514', message = 'Organization type and membership scope are incompatible.';
  end if;

  return new;
end;
$function$;

revoke all on function public.kandid_set_organization_membership_scope()
  from public, anon, authenticated, service_role;

drop trigger if exists organizations_set_membership_scope on public.organizations;
create trigger organizations_set_membership_scope
before insert or update of organization_type, membership_scope
on public.organizations
for each row execute function public.kandid_set_organization_membership_scope();

create or replace function public.kandid_validate_organization_membership_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_organization_id bigint;
  organization_type_value text;
  membership_scope_value text;
  coverage_count bigint;
begin
  if tg_table_name = 'organizations' then
    target_organization_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    target_organization_id := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  end if;

  select o.organization_type, o.membership_scope
  into organization_type_value, membership_scope_value
  from public.organizations o
  where o.id = target_organization_id;

  -- Organization deletion may cascade to coverage rows. There is no surviving
  -- configuration to validate in that case.
  if not found then
    return null;
  end if;

  select pg_catalog.count(*)
  into coverage_count
  from public.organization_programs op
  where op.organization_id = target_organization_id;

  if membership_scope_value = 'program'
     and (organization_type_value <> 'departmental' or coverage_count = 0) then
    raise exception using errcode = '23514', message = 'Program-scoped organizations must be Departmental and cover at least one program.';
  elsif membership_scope_value = 'manual'
     and (organization_type_value <> 'non_departmental' or coverage_count <> 0) then
    raise exception using errcode = '23514', message = 'Manual-scoped organizations must be Non-departmental and have no program coverage.';
  elsif membership_scope_value = 'institution'
     and coverage_count <> 0 then
    raise exception using errcode = '23514', message = 'Institution-scoped organizations cannot have program coverage.';
  elsif membership_scope_value not in ('program', 'manual', 'institution') then
    raise exception using errcode = '23514', message = 'Organization membership scope is invalid.';
  end if;

  return null;
end;
$function$;

revoke all on function public.kandid_validate_organization_membership_scope()
  from public, anon, authenticated, service_role;

drop trigger if exists organizations_validate_membership_scope on public.organizations;
create constraint trigger organizations_validate_membership_scope
after insert or update or delete on public.organizations
deferrable initially deferred
for each row execute function public.kandid_validate_organization_membership_scope();

drop trigger if exists organization_programs_validate_membership_scope on public.organization_programs;
create constraint trigger organization_programs_validate_membership_scope
after insert or update or delete on public.organization_programs
deferrable initially deferred
for each row execute function public.kandid_validate_organization_membership_scope();

-- Organization creation/type changes and their complete coverage replacement
-- happen in one trusted transaction, so deferred cross-table invariants are
-- checked only against the final configuration.
create or replace function public.kandid_save_organization_configuration(
  p_organization_id bigint,
  p_name text,
  p_description text,
  p_logo_url text,
  p_organization_type text,
  p_program_ids bigint[]
)
returns table (id bigint)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  organization_row public.organizations%rowtype;
  admin_found boolean;
  requested_scope text;
  normalized_program_ids bigint[] := coalesce(p_program_ids, array[]::bigint[]);
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

  if nullif(pg_catalog.btrim(coalesce(p_name, '')), '') is null
     or p_organization_type is null
     or p_organization_type not in ('departmental', 'non_departmental') then
    raise exception using errcode = '22023', message = 'A valid organization name and type are required.';
  end if;

  if p_organization_id is null then
    requested_scope := case p_organization_type
      when 'departmental' then 'program'
      else 'manual'
    end;

    insert into public.organizations (
      name, description, logo_url, organization_type, membership_scope
    ) values (
      pg_catalog.btrim(p_name),
      pg_catalog.btrim(coalesce(p_description, '')),
      nullif(pg_catalog.btrim(coalesce(p_logo_url, '')), ''),
      p_organization_type,
      requested_scope
    )
    returning * into organization_row;
  else
    select o.* into organization_row
    from public.organizations o
    where o.id = p_organization_id
    for update;

    if not found then
      raise exception using errcode = '23503', message = 'Organization was not found.';
    end if;

    if organization_row.membership_scope not in ('program', 'manual', 'institution') then
      raise exception using errcode = '23514', message = 'Organization membership scope is not configured.';
    end if;

    requested_scope := case
      when organization_row.membership_scope = 'institution' then 'institution'
      when p_organization_type = 'departmental' then 'program'
      else 'manual'
    end;

    update public.organizations o
    set name = pg_catalog.btrim(p_name),
        description = pg_catalog.btrim(coalesce(p_description, '')),
        logo_url = nullif(pg_catalog.btrim(coalesce(p_logo_url, '')), ''),
        organization_type = p_organization_type,
        membership_scope = requested_scope
    where o.id = p_organization_id
    returning * into organization_row;
  end if;

  if requested_scope = 'program'
     and coalesce(pg_catalog.cardinality(normalized_program_ids), 0) = 0 then
    raise exception using errcode = '22023', message = 'Program-scoped organizations require at least one covered program.';
  end if;

  if requested_scope in ('manual', 'institution')
     and coalesce(pg_catalog.cardinality(normalized_program_ids), 0) <> 0 then
    raise exception using errcode = '22023', message = 'Manual and institution-scoped organizations cannot have program coverage.';
  end if;

  perform public.kandid_replace_organization_program_coverage(
    organization_row.id,
    normalized_program_ids
  );

  return query select organization_row.id::bigint;
end;
$function$;

revoke all on function public.kandid_save_organization_configuration(bigint, text, text, text, text, bigint[])
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_save_organization_configuration(bigint, text, text, text, text, bigint[])
  to authenticated;

comment on column public.organizations.membership_scope is
  'Trusted membership derivation scope: program, manual, or institution. This does not replace organization_type.';
comment on function public.kandid_save_organization_configuration(bigint, text, text, text, text, bigint[]) is
  'Atomically saves an organization and its program coverage for an active Super Admin, enforcing trusted membership-scope invariants.';

commit;
