begin;

-- Reversible election removal. Election rows and every related record remain
-- in place; no DELETE/CASCADE path is introduced.
do $preflight$
declare
  required_relation text;
  required_relations text[] := array[
    'public.organizations',
    'public.positions',
    'public.candidates',
    'public.candidate_media',
    'public.partylists',
    'public.eligibility_rules',
    'public.election_access_tokens',
    'public.election_campaign_snapshots',
    'public.votes',
    'public.vote_ballots',
    'public.officers',
    'public.officer_new_roster',
    'public.officer_leadership_releases',
    'public.election_officer_publications',
    'public.election_officer_publication_entries',
    'public.archived_elections'
  ];
begin
  if to_regclass('public.elections') is null
     or to_regclass('public.admin_users') is null
     or to_regclass('public.audit_logs') is null
     or to_regclass('private.election_eligible_voters') is null
     or exists (
       select 1 from unnest(array['id','organization_id','title','status','campaign_start','campaign_end','start_date','end_date','results_released_at','created_at']) required(column_name)
       where not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = to_regclass('public.elections') and a.attname = required.column_name and a.attnum > 0 and not a.attisdropped)
     )
     or exists (
       select 1 from unnest(array['id','auth_user_id','full_name','role','status','organization_id']) required(column_name)
       where not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = to_regclass('public.admin_users') and a.attname = required.column_name and a.attnum > 0 and not a.attisdropped)
     )
     or exists (
       select 1 from unnest(array['election_id','student_id']) required(column_name)
       where not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = to_regclass('private.election_eligible_voters') and a.attname = required.column_name and a.attnum > 0 and not a.attisdropped)
     )
     or exists (
       select 1 from unnest(array['user_id','actor_name','actor_role','action','timestamp','created_at','event_type','event_category','entity_type','entity_id','entity_label','organization_id','organization_name','election_id','status','event_origin','metadata']) required(column_name)
       where not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = to_regclass('public.audit_logs') and a.attname = required.column_name and a.attnum > 0 and not a.attisdropped)
     ) then
    raise exception 'Election soft-removal prerequisites are missing; no changes applied.';
  end if;

  foreach required_relation in array required_relations loop
    if to_regclass(required_relation) is null then
      raise exception 'Required election dependency relation % is missing; no changes applied.', required_relation;
    end if;
  end loop;

  if to_regprocedure('private.kandid_guard_election_removal_state()') is not null
     or to_regprocedure('private.kandid_guard_removed_election_child_mutation()') is not null
     or to_regprocedure('private.kandid_election_removal_phase_is_safe(text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)') is not null
     or to_regprocedure('public.kandid_get_election_removal_electorate_count(integer,uuid)') is not null
     or to_regprocedure('public.kandid_soft_remove_election(integer,uuid)') is not null
     or to_regprocedure('public.kandid_restore_removed_election(integer,uuid)') is not null then
    raise exception 'Election soft-removal function names already exist; review for partial installation before proceeding.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and ((n.nspname = 'public' and c.relname = 'elections' and t.tgname = 'elections_guard_soft_removal')
        or t.tgname = 'guard_removed_election_mutation')
  ) then
    raise exception 'Election soft-removal trigger names already exist; review for partial installation before proceeding.';
  end if;

  if exists (
    select 1 from (values
      ('public.positions','election_id'),
      ('public.candidates','position_id'),
      ('public.candidate_media','candidate_id'),
      ('public.election_officer_publication_entries','publication_id'),
      ('public.partylists','election_id'),
      ('public.eligibility_rules','election_id'),
      ('public.election_access_tokens','election_id'),
      ('public.election_campaign_snapshots','election_id'),
      ('public.votes','election_id'),
      ('public.vote_ballots','election_id'),
      ('public.officers','election_id'),
      ('public.officer_new_roster','election_id'),
      ('public.officer_leadership_releases','election_id'),
      ('public.election_officer_publications','election_id'),
      ('public.archived_elections','election_id')
    ) required(relation_name, column_name)
    where not exists (
      select 1
      from pg_catalog.pg_attribute a
      where a.attrelid = to_regclass(required.relation_name)
        and a.attname = required.column_name
        and a.attnum > 0
        and not a.attisdropped
    )
  ) then
    raise exception 'Election dependency columns do not match the reviewed trigger contract; no changes applied.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = to_regclass('public.elections')
      and a.attname = 'removed_at'
      and a.attnum > 0
      and not a.attisdropped
  ) or to_regclass('public.elections_removed_org_created_idx') is not null then
    raise exception 'Election removal marker or index already exists; inspect for partial installation before proceeding.';
  end if;
  -- Reviewed identifier types: UUID publications must never enter numeric casts.
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.elections','id','integer'),
      ('public.elections','organization_id','integer'),
      ('public.positions','id','integer'),
      ('public.positions','election_id','integer'),
      ('public.candidates','id','integer'),
      ('public.candidates','position_id','integer'),
      ('public.candidate_media','candidate_id','integer'),
      ('public.admin_users','id','integer'),
      ('public.admin_users','auth_user_id','uuid'),
      ('public.admin_users','organization_id','integer'),
      ('public.election_officer_publications','id','uuid'),
      ('public.election_officer_publications','election_id','integer'),
      ('public.election_officer_publication_entries','id','uuid'),
      ('public.election_officer_publication_entries','publication_id','uuid'),
      ('public.election_officer_publication_entries','source_officer_id','integer'),
      ('public.officer_leadership_releases','id','bigint')
    ) expected(relation_name,column_name,type_name)
    LEFT JOIN pg_catalog.pg_attribute a
      ON a.attrelid=pg_catalog.to_regclass(expected.relation_name)
      AND a.attname=expected.column_name AND a.attnum>0 AND NOT a.attisdropped
    WHERE a.atttypid IS DISTINCT FROM pg_catalog.to_regtype(expected.type_name)
  ) THEN
    RAISE EXCEPTION 'Election removal identifier types do not match the reviewed UUID/integer contract; stop.';
  END IF;
end;
$preflight$;

alter table public.elections
  add column if not exists removed_at timestamptz;

create index if not exists elections_removed_org_created_idx
  on public.elections (organization_id, removed_at desc, created_at desc, id desc)
  where removed_at is not null;

create or replace function private.kandid_guard_election_removal_state()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  -- Invoker context is required so direct callers cannot impersonate postgres.
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Elections cannot be physically deleted; use authorized soft removal.';
  end if;

  if tg_op = 'INSERT' then
    if new.removed_at is not null then
      raise exception using errcode = '42501', message = 'New elections cannot be created in a removed state.';
    end if;
    return new;
  end if;

  if old.removed_at is not null then
    if new.removed_at is null
       and current_user = 'postgres'
       and (to_jsonb(new) - 'removed_at') = (to_jsonb(old) - 'removed_at') then
      return new;
    end if;
    raise exception using errcode = '42501', message = 'Removed elections are immutable except through authorized restoration.';
  end if;

  if new.removed_at is distinct from old.removed_at then
    if current_user <> 'postgres'
       or new.removed_at is null then
      raise exception using errcode = '42501', message = 'Removal state can only be changed by the trusted removal operation.';
    end if;
  end if;
  return new;
end;
$function$;

alter function private.kandid_guard_election_removal_state() owner to postgres;
revoke all on function private.kandid_guard_election_removal_state() from public, anon, authenticated, service_role;
create trigger elections_guard_soft_removal
before insert or update or delete on public.elections
for each row execute function private.kandid_guard_election_removal_state();

-- Serialize child-row changes against removal's FOR UPDATE lock. This makes a
-- concurrent insert wait, then observe the committed removed marker and fail.
create or replace function private.kandid_guard_removed_election_child_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  row_data jsonb;
  previous_data jsonb;
  target_election_id bigint;
  target_position_id bigint;
  target_candidate_id bigint;
  target_publication_id uuid;
  removed timestamptz;
  rows_to_check jsonb[];
  item jsonb;
begin
  if tg_op = 'INSERT' then
    rows_to_check := array[to_jsonb(new)];
  elsif tg_op = 'DELETE' then
    rows_to_check := array[to_jsonb(old)];
  else
    rows_to_check := array[to_jsonb(old), to_jsonb(new)];
  end if;

  foreach row_data in array rows_to_check loop
    target_election_id := nullif(row_data ->> 'election_id', '')::bigint;
    if tg_table_name = 'candidates' then
      target_position_id := nullif(row_data ->> 'position_id', '')::bigint;
      select p.election_id into target_election_id
      from public.positions p where p.id = target_position_id;
    elsif tg_table_name = 'candidate_media' then
      target_candidate_id := nullif(row_data ->> 'candidate_id', '')::bigint;
      select p.election_id into target_election_id
      from public.candidates c join public.positions p on p.id = c.position_id
      where c.id = target_candidate_id;
    elsif tg_table_name = 'election_officer_publication_entries' then
      target_publication_id := nullif(row_data ->> 'publication_id', '')::uuid;
      select p.election_id into target_election_id
      from public.election_officer_publications p where p.id = target_publication_id;
    end if;

    if target_election_id is not null then
      removed := null;
      select e.removed_at into removed
      from public.elections e where e.id = target_election_id
      for key share;
      if removed is not null then
        raise exception using errcode = '42501', message = 'This election has been removed; related records are read-only.';
      end if;
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

alter function private.kandid_guard_removed_election_child_mutation() owner to postgres;
revoke all on function private.kandid_guard_removed_election_child_mutation() from public, anon, authenticated, service_role;

do $install_child_guards$
declare
  relation_entry text;
  relation_name text;
  relation_schema text;
  relations text[] := array[
    'public.positions',
    'public.candidates',
    'public.candidate_media',
    'public.partylists',
    'public.eligibility_rules',
    'public.election_access_tokens',
    'public.election_campaign_snapshots',
    'public.votes',
    'public.vote_ballots',
    'public.officers',
    'public.officer_new_roster',
    'public.officer_leadership_releases',
    'public.election_officer_publications',
    'public.election_officer_publication_entries',
    'public.archived_elections',
    'private.election_eligible_voters'
  ];
begin
  foreach relation_entry in array relations loop
    relation_schema := split_part(relation_entry, '.', 1);
    relation_name := split_part(relation_entry, '.', 2);
    if to_regclass(format('%I.%I', relation_schema, relation_name)) is not null then
      execute format(
        'create trigger guard_removed_election_mutation before insert or update or delete on %I.%I for each row execute function private.kandid_guard_removed_election_child_mutation()',
        relation_schema, relation_name
      );
    end if;
  end loop;
end;
$install_child_guards$;

create or replace function private.kandid_election_removal_phase_is_safe(
  p_status text,
  p_campaign_start timestamptz,
  p_campaign_end timestamptz,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_now timestamptz default pg_catalog.clock_timestamp()
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog
as $function$
declare
  phase_time timestamptz := p_now;
  normalized_status text := lower(pg_catalog.btrim(coalesce(p_status, '')));
begin
  if normalized_status in ('draft', 'archived', 'closed', 'done') then return true; end if;
  if normalized_status <> 'active' then return false; end if;
  if p_campaign_start is not null and p_campaign_end is not null and phase_time < p_campaign_end then return false; end if;
  if p_campaign_end is not null and p_start_date is not null
     and phase_time >= p_campaign_end and phase_time < p_start_date then return false; end if;
  if p_start_date is not null and p_end_date is not null
     and phase_time >= p_start_date and phase_time < p_end_date then return false; end if;
  if normalized_status = 'active' and p_start_date is not null and phase_time < p_start_date then return false; end if;
  return p_end_date is not null and phase_time >= p_end_date;
end;
$function$;

alter function private.kandid_election_removal_phase_is_safe(text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) owner to postgres;

create or replace function public.kandid_get_election_removal_electorate_count(
  p_election_id integer,
  p_actor_auth_uid uuid
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor_count integer;
  actor record;
  election_organization_id bigint;
  electorate_count bigint;
begin
  select count(*)::integer into actor_count from public.admin_users a
  where a.auth_user_id = p_actor_auth_uid and a.status = 'active';
  if actor_count <> 1 then
    raise exception using errcode = '42501', message = 'A unique active administrator identity is required.';
  end if;
  select a.id, a.auth_user_id, a.role, a.status, a.organization_id into actor
  from public.admin_users a
  where a.auth_user_id = p_actor_auth_uid and a.status = 'active'
  for share;
  if actor.role not in ('electoral_board', 'super_admin') then
    raise exception using errcode = '42501', message = 'Active Electoral Board or Super Admin access is required.';
  end if;
  select e.organization_id into election_organization_id
  from public.elections e where e.id = p_election_id;
  if not found then raise exception using errcode = 'P0002', message = 'Election is unavailable.'; end if;
  if actor.role = 'electoral_board'
     and (actor.organization_id is null or actor.organization_id is distinct from election_organization_id) then
    raise exception using errcode = '42501', message = 'Election is outside the assigned organization.';
  end if;
  select count(*) into electorate_count from private.election_eligible_voters v
  where v.election_id = p_election_id;
  return electorate_count;
end;
$function$;

alter function public.kandid_get_election_removal_electorate_count(integer, uuid) owner to postgres;
revoke all on function public.kandid_get_election_removal_electorate_count(integer, uuid) from public, anon, authenticated;
grant execute on function public.kandid_get_election_removal_electorate_count(integer, uuid) to service_role;

create or replace function public.kandid_soft_remove_election(p_election_id integer, p_actor_auth_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor record;
  actor_count integer;
  election_row public.elections%rowtype;
  organization_name text;
begin
  if p_actor_auth_uid is null then
    raise exception using errcode = '42501', message = 'An authenticated administrator is required.';
  end if;

  select count(*)::integer into actor_count from public.admin_users a
  where a.auth_user_id = p_actor_auth_uid and a.status = 'active';
  if actor_count <> 1 then
    raise exception using errcode = '42501', message = 'A unique active administrator identity is required.';
  end if;
  select a.id, a.auth_user_id, a.full_name, a.role, a.status, a.organization_id
  into actor
  from public.admin_users a
  where a.auth_user_id = p_actor_auth_uid and a.status = 'active'
  for share;
  if not found or actor.id is null or actor.auth_user_id is distinct from p_actor_auth_uid
     or actor.role not in ('electoral_board', 'super_admin') then
    raise exception using errcode = '42501', message = 'Active Electoral Board or Super Admin access is required.';
  end if;

  select e.* into election_row
  from public.elections e
  where e.id = p_election_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Election is unavailable.'; end if;
  if actor.role = 'electoral_board' and actor.organization_id is distinct from election_row.organization_id then
    raise exception using errcode = '42501', message = 'Election is outside the assigned organization.';
  end if;
  if election_row.removed_at is not null then
    raise exception using errcode = '23505', message = 'Election is already removed.';
  end if;
  if not private.kandid_election_removal_phase_is_safe(
    election_row.status, election_row.campaign_start, election_row.campaign_end,
    election_row.start_date, election_row.end_date, pg_catalog.clock_timestamp()
  ) then
    raise exception using errcode = '55000', message = 'Only draft or concluded elections can be removed. Active, scheduled, campaigning, waiting, or voting elections are protected.';
  end if;

  select o.name into organization_name from public.organizations o where o.id = election_row.organization_id;
  update public.elections
  set removed_at = pg_catalog.clock_timestamp()
  where id = p_election_id and removed_at is null;
  if not found then raise exception using errcode = '40001', message = 'Election state changed. Refresh and review it again.'; end if;

  insert into public.audit_logs (
    user_id, actor_name, actor_role, action, event_type, event_category,
    entity_type, entity_id, entity_label, organization_id, organization_name,
    election_id, status, event_origin, metadata
  ) values (
    actor.id, actor.full_name, actor.role, 'election_soft_removed', 'election_soft_removed', 'elections',
    'election', p_election_id::text, election_row.title, election_row.organization_id, organization_name,
    p_election_id, 'completed', 'trusted_edge',
    pg_catalog.jsonb_build_object('preserved_related_records', true, 'previous_status', election_row.status)
  );

  return pg_catalog.jsonb_build_object('removed', true, 'election_id', p_election_id);
end;
$function$;

create or replace function public.kandid_restore_removed_election(p_election_id integer, p_actor_auth_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor record;
  actor_count integer;
  election_row public.elections%rowtype;
  organization_name text;
begin
  if p_actor_auth_uid is null then
    raise exception using errcode = '42501', message = 'An authenticated administrator is required.';
  end if;
  select count(*)::integer into actor_count from public.admin_users a
  where a.auth_user_id = p_actor_auth_uid and a.status = 'active';
  if actor_count <> 1 then
    raise exception using errcode = '42501', message = 'A unique active administrator identity is required.';
  end if;
  select a.id, a.auth_user_id, a.full_name, a.role, a.status, a.organization_id
  into actor
  from public.admin_users a
  where a.auth_user_id = p_actor_auth_uid and a.status = 'active'
  for share;
  if not found or actor.id is null or actor.auth_user_id is distinct from p_actor_auth_uid
     or actor.role not in ('electoral_board', 'super_admin') then
    raise exception using errcode = '42501', message = 'Active Electoral Board or Super Admin access is required.';
  end if;
  select e.* into election_row from public.elections e where e.id = p_election_id for update;
  if not found or election_row.removed_at is null then
    raise exception using errcode = 'P0002', message = 'Removed election is unavailable.';
  end if;
  if actor.role = 'electoral_board' and actor.organization_id is distinct from election_row.organization_id then
    raise exception using errcode = '42501', message = 'Election is outside the assigned organization.';
  end if;
  if not private.kandid_election_removal_phase_is_safe(
    election_row.status, election_row.campaign_start, election_row.campaign_end,
    election_row.start_date, election_row.end_date, pg_catalog.clock_timestamp()
  ) then
    raise exception using errcode = '55000', message = 'An election can only be restored while it remains draft or concluded.';
  end if;

  select o.name into organization_name from public.organizations o where o.id = election_row.organization_id;
  update public.elections set removed_at = null
  where id = p_election_id and removed_at is not null;
  if not found then raise exception using errcode = '40001', message = 'Election state changed. Refresh and review it again.'; end if;
  insert into public.audit_logs (
    user_id, actor_name, actor_role, action, event_type, event_category,
    entity_type, entity_id, entity_label, organization_id, organization_name,
    election_id, status, event_origin, metadata
  ) values (
    actor.id, actor.full_name, actor.role, 'election_restored', 'election_restored', 'elections',
    'election', p_election_id::text, election_row.title, election_row.organization_id, organization_name,
    p_election_id, 'completed', 'trusted_edge',
    pg_catalog.jsonb_build_object('related_records_preserved', true, 'restored_status', election_row.status)
  );
  return pg_catalog.jsonb_build_object('restored', true, 'election_id', p_election_id);
end;
$function$;

alter function public.kandid_soft_remove_election(integer, uuid) owner to postgres;
alter function public.kandid_restore_removed_election(integer, uuid) owner to postgres;
revoke all on function public.kandid_soft_remove_election(integer, uuid) from public, anon, authenticated;
revoke all on function public.kandid_restore_removed_election(integer, uuid) from public, anon, authenticated;
grant execute on function public.kandid_soft_remove_election(integer, uuid) to service_role;
grant execute on function public.kandid_restore_removed_election(integer, uuid) to service_role;

revoke all on function private.kandid_election_removal_phase_is_safe(text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated, service_role;

commit;
