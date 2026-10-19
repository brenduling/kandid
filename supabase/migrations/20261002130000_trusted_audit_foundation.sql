begin;

-- Expand the production four-column audit table before any indexes, functions,
-- triggers, or RPCs reference the trusted audit fields. All additions remain
-- nullable so historical sparse rows retain only the facts they originally had.
-- In particular, created_at remains NULL on old rows; read RPCs use the existing
-- timestamp as their display/cursor fallback instead of rewriting history.
alter table public.audit_logs
  add column if not exists actor_name text,
  add column if not exists actor_role text,
  add column if not exists created_at timestamptz,
  add column if not exists entity_id text,
  add column if not exists entity_label text,
  add column if not exists entity_type text,
  add column if not exists metadata jsonb,
  add column if not exists organization_id bigint,
  add column if not exists organization_name text,
  add column if not exists status text;

-- New events receive a stable machine identity and authoritative linkage/time
-- as they are written by trusted boundaries. Legacy rows are not backfilled.
alter table public.audit_logs
  add column if not exists event_type text,
  add column if not exists event_category text,
  add column if not exists event_origin text,
  add column if not exists election_id bigint;

create index if not exists audit_logs_org_created_cursor_idx
  on public.audit_logs (organization_id, created_at desc, id desc);
create index if not exists audit_logs_global_created_cursor_idx
  on public.audit_logs (created_at desc, id desc);
create index if not exists audit_logs_election_cursor_idx
  on public.audit_logs (organization_id, election_id, created_at desc, id desc);
create index if not exists audit_logs_category_cursor_idx
  on public.audit_logs (organization_id, event_category, created_at desc, id desc);

create or replace function public.kandid_audit_category_for_event(p_event_type text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when event_name like 'election_%' or event_name = 'results_published' then 'elections'
    when event_name like 'position_%' then 'positions'
    when event_name like 'candidate_%' then 'candidates'
    when event_name like 'partylist_%' then 'partylists'
    when event_name like 'eligibility_%' then 'eligibility'
    when event_name like 'officer_%' then 'officers'
    when event_name like 'student_%' or event_name like 'membership_%' then 'students'
    when event_name like 'organization_%' or event_name like 'program_%' then 'organization'
    when event_name like 'security_%' or event_name in ('login', 'logout') then 'security'
    else 'system'
  end
  from (
    select pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_event_type, ''))),
      '[^a-z0-9]+', '_', 'g'
    ) as event_name
  ) normalized_event;
$function$;

create or replace function public.kandid_prepare_audit_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  normalized text;
begin
  -- The legacy membership RPC emitted only these sparse rows. Its validated
  -- Edge Function now writes the same operation with full trusted context.
  if auth.uid() is null and new.action in (
    'Student Removed from Organization',
    'Student Restored to Organization'
  ) then
    return null;
  end if;

  -- Existing writers that still use their historical action string are mapped
  -- only for new inserts; historical records are deliberately not rewritten.
  if new.event_type is null then
    normalized := pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.btrim(coalesce(new.action, 'legacy_event'))),
      '[^a-z0-9]+', '_', 'g'
    );
    new.event_type := case normalized
      when 'student_organization_registered' then 'student_enrolled'
      when 'student_removed_from_organization' then 'membership_removed'
      when 'student_restored_to_organization' then 'membership_restored'
      when 'student_updated' then 'student_updated'
      when 'organization_program_coverage_replaced' then 'organization_program_coverage_changed'
      else pg_catalog.btrim(normalized, '_')
    end;
  end if;

  new.event_category := coalesce(
    new.event_category,
    public.kandid_audit_category_for_event(new.event_type)
  );
  -- Never accept browser or Edge-supplied time as the audit timestamp.
  new.timestamp := pg_catalog.clock_timestamp();
  new.created_at := new.timestamp;
  if new.event_origin is null and new.actor_name is not null and new.actor_role is not null then
    new.event_origin := 'trusted_server';
  end if;
  return new;
end;
$function$;

drop trigger if exists audit_logs_prepare_insert on public.audit_logs;
create trigger audit_logs_prepare_insert
before insert on public.audit_logs
for each row execute function public.kandid_prepare_audit_event();

create or replace function public.kandid_audit_admin_row_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  active_admin_count integer;
  admin_row record;
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
  target_id text;
  target_label text;
  target_type text;
  event_type_value text;
  event_status text := 'completed';
  target_org_id bigint;
  target_org_name text;
  target_election_id bigint;
  changed_fields text[] := array[]::text[];
  field_name text;
begin
  if tg_op = 'INSERT' then old_row := '{}'::jsonb;
  else old_row := pg_catalog.to_jsonb(old); end if;
  if tg_op = 'DELETE' then new_row := '{}'::jsonb;
  else new_row := pg_catalog.to_jsonb(new); end if;

  -- Edge Functions using service_role record their own verified admin actor.
  -- Their JWT has no authenticated user identity to derive here.
  if caller_uid is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select count(*)::integer into active_admin_count
  from public.admin_users a
  where a.auth_user_id = caller_uid and a.status = 'active';
  if active_admin_count <> 1 then
    raise exception using errcode = '42501', message = 'One active administrator identity is required for audited changes.';
  end if;

  select a.id, a.full_name, a.role, a.status, a.organization_id
    into admin_row
  from public.admin_users a
  where a.auth_user_id = caller_uid
    and a.status = 'active';

  if not found or admin_row.id is null then
    raise exception using errcode = '42501', message = 'Active administrator context required for audited changes.';
  end if;

  row_data := case when tg_op = 'DELETE' then old_row else new_row end;
  target_id := coalesce(row_data ->> 'id', row_data ->> 'student_id');
  target_election_id := nullif(row_data ->> 'election_id', '')::bigint;
  target_org_id := nullif(row_data ->> 'organization_id', '')::bigint;

  if tg_table_name = 'elections' then
    target_type := 'election';
    target_org_id := nullif(row_data ->> 'organization_id', '')::bigint;
    target_election_id := nullif(row_data ->> 'id', '')::bigint;
    target_label := coalesce(row_data ->> 'title', 'Election');
    if tg_op = 'INSERT' then
      event_type_value := 'election_created';
    elsif tg_op = 'DELETE' then
      event_type_value := 'election_deleted';
    elsif old_row ->> 'results_released_at' is null and new_row ->> 'results_released_at' is not null then
      event_type_value := 'results_published';
    elsif old_row ->> 'status' is distinct from new_row ->> 'status' then
      event_type_value := 'election_status_changed';
    else
      event_type_value := 'election_updated';
    end if;
  elsif tg_table_name = 'positions' then
    target_type := 'position';
    target_election_id := nullif(row_data ->> 'election_id', '')::bigint;
    select e.organization_id into target_org_id from public.elections e where e.id = target_election_id;
    target_label := coalesce(row_data ->> 'name', 'Position');
    if tg_op = 'INSERT' then event_type_value := 'position_created';
    elsif tg_op = 'DELETE' then event_type_value := 'position_deleted';
    elsif old_row ->> 'status' is distinct from new_row ->> 'status' and new_row ->> 'status' = 'retired' then
      event_type_value := 'position_retired';
    else event_type_value := 'position_updated'; end if;
  elsif tg_table_name = 'candidates' then
    target_type := 'candidate';
    select p.election_id, e.organization_id
      into target_election_id, target_org_id
    from public.positions p
    join public.elections e on e.id = p.election_id
    where p.id = nullif(row_data ->> 'position_id', '')::bigint;
    target_label := 'Candidate #' || coalesce(target_id, 'unknown');
    if tg_op = 'INSERT' then event_type_value := 'candidate_created';
    elsif tg_op = 'DELETE' then event_type_value := 'candidate_removed';
    elsif old_row ->> 'campaign_status' is distinct from new_row ->> 'campaign_status' then
      event_type_value := 'candidate_status_changed';
    else event_type_value := 'candidate_updated'; end if;
  elsif tg_table_name = 'partylists' then
    target_type := 'partylist';
    target_org_id := nullif(row_data ->> 'organization_id', '')::bigint;
    target_label := coalesce(row_data ->> 'name', 'Partylist');
    if tg_op = 'INSERT' then event_type_value := 'partylist_created';
    elsif tg_op = 'DELETE' then event_type_value := 'partylist_removed';
    else event_type_value := 'partylist_updated'; end if;
  elsif tg_table_name = 'eligibility_rules' then
    target_type := 'eligibility_rule';
    target_election_id := nullif(row_data ->> 'election_id', '')::bigint;
    select e.organization_id into target_org_id from public.elections e where e.id = target_election_id;
    target_label := 'Eligibility rule';
    if tg_op = 'INSERT' then event_type_value := 'eligibility_rule_created';
    elsif tg_op = 'DELETE' then event_type_value := 'eligibility_rule_removed';
    else event_type_value := 'eligibility_rule_updated'; end if;
  elsif tg_table_name = 'officer_new_roster' then
    target_type := 'officer_new_roster';
    target_org_id := nullif(row_data ->> 'organization_id', '')::bigint;
    target_election_id := nullif(row_data ->> 'election_id', '')::bigint;
    target_label := coalesce(row_data ->> 'position_title', 'Officer');
    if tg_op = 'INSERT' and row_data ->> 'selection_type' = 'elected' then
      event_type_value := 'officer_elected_staged';
    elsif tg_op = 'INSERT' then event_type_value := 'officer_appointed_staged';
    elsif tg_op = 'DELETE' then event_type_value := 'officer_staged_removed';
    else event_type_value := 'officer_staged_updated'; end if;
  elsif tg_table_name = 'officers' then
    target_type := 'officer';
    target_org_id := nullif(row_data ->> 'organization_id', '')::bigint;
    target_election_id := nullif(row_data ->> 'election_id', '')::bigint;
    target_label := coalesce(row_data ->> 'position_title', 'Officer');
    if tg_op = 'INSERT' then event_type_value := 'officer_current_added';
    elsif tg_op = 'DELETE' then event_type_value := 'officer_removed';
    else event_type_value := 'officer_updated'; end if;
  elsif tg_table_name = 'officer_leadership_releases' then
    target_type := 'officer_leadership_release';
    target_org_id := nullif(row_data ->> 'organization_id', '')::bigint;
    target_election_id := nullif(row_data ->> 'election_id', '')::bigint;
    target_label := 'Leadership roster';
    event_type_value := case when tg_op = 'DELETE' then 'officer_release_removed' else 'officer_roster_released' end;
  elsif tg_table_name = 'student_organizations' then
    target_type := 'student_organization';
    target_org_id := nullif(row_data ->> 'organization_id', '')::bigint;
    target_label := 'Organization membership';
    if tg_op = 'INSERT' then event_type_value := 'membership_added';
    elsif tg_op = 'DELETE' then event_type_value := 'membership_removed';
    else event_type_value := 'membership_updated'; end if;
  elsif tg_table_name = 'organizations' then
    target_type := 'organization';
    target_org_id := nullif(row_data ->> 'id', '')::bigint;
    target_label := coalesce(row_data ->> 'name', 'Organization');
    target_org_name := target_label;
    if tg_op = 'INSERT' then event_type_value := 'organization_created';
    elsif tg_op = 'DELETE' then event_type_value := 'organization_deleted';
    else event_type_value := 'organization_updated'; end if;
  elsif tg_table_name = 'students' then
    target_type := 'student';
    if admin_row.role = 'electoral_board' then
      select so.organization_id into target_org_id
      from public.student_organizations so
      where so.student_id = nullif(target_id, '')::bigint
        and so.organization_id = admin_row.organization_id
      limit 1;
    end if;
    target_label := 'Student #' || coalesce(target_id, 'unknown');
    if tg_op = 'INSERT' then event_type_value := 'student_created';
    elsif tg_op = 'DELETE' then event_type_value := 'student_deleted';
    else event_type_value := 'student_updated'; end if;
  else
    raise exception using errcode = '0A000', message = 'Unsupported audited table.';
  end if;

  if target_org_id is not null then
    target_org_name := coalesce(
      (select o.name from public.organizations o where o.id = target_org_id),
      target_org_name
    );
  end if;

  -- Cascaded child deletes may run after their election/organization parent has
  -- already disappeared. The Board's authenticated RLS check authorized the
  -- parent operation; preserve the trusted assignment as the audit scope.
  if target_org_id is null and admin_row.role = 'electoral_board' and tg_table_name <> 'students' then
    target_org_id := admin_row.organization_id;
  end if;

  if admin_row.role = 'electoral_board'
     and (target_org_id is null or target_org_id is distinct from admin_row.organization_id) then
    raise exception using errcode = '42501', message = 'Board audit target is outside the assigned organization.';
  elsif admin_row.role <> 'electoral_board' and admin_row.role <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Unsupported administrator role for audit.';
  end if;

  foreach field_name in array array[
    'title', 'status', 'start_date', 'end_date', 'campaign_start', 'campaign_end',
    'voting_start', 'voting_end', 'location', 'name', 'organization_type', 'max_votes', 'display_order',
    'campaign_status', 'min_year_level', 'max_year_level', 'allow_shs', 'position_title', 'position_id',
    'partylist_id', 'student_id', 'description', 'photo', 'bio', 'platform',
    'selection_type', 'is_current', 'term_label', 'leadership_academic_year', 'role',
    'first_name', 'last_name', 'program', 'year_level'
  ] loop
    if tg_op = 'INSERT' and new_row ? field_name then
      changed_fields := array_append(changed_fields, field_name);
    elsif tg_op = 'UPDATE' and old_row -> field_name is distinct from new_row -> field_name then
      changed_fields := array_append(changed_fields, field_name);
    elsif tg_op = 'DELETE' and old_row ? field_name then
      changed_fields := array_append(changed_fields, field_name);
    end if;
  end loop;

  insert into public.audit_logs (
    user_id, actor_name, actor_role, action, event_type, event_category,
    entity_type, entity_id, entity_label, organization_id, organization_name,
    election_id, status, event_origin, metadata
  ) values (
    admin_row.id,
    admin_row.full_name,
    admin_row.role,
    event_type_value,
    event_type_value,
    public.kandid_audit_category_for_event(event_type_value),
    target_type,
    target_id,
    target_label,
    target_org_id,
    target_org_name,
    target_election_id,
    event_status,
    'trusted_database',
    pg_catalog.jsonb_build_object('changed_fields', to_jsonb(changed_fields))
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists audit_elections_mutations on public.elections;
create trigger audit_elections_mutations after insert or update or delete on public.elections
for each row execute function public.kandid_audit_admin_row_change();
drop trigger if exists audit_positions_mutations on public.positions;
create trigger audit_positions_mutations after insert or update or delete on public.positions
for each row execute function public.kandid_audit_admin_row_change();
drop trigger if exists audit_candidates_mutations on public.candidates;
create trigger audit_candidates_mutations after insert or update or delete on public.candidates
for each row execute function public.kandid_audit_admin_row_change();
drop trigger if exists audit_partylists_mutations on public.partylists;
create trigger audit_partylists_mutations after insert or update or delete on public.partylists
for each row execute function public.kandid_audit_admin_row_change();
drop trigger if exists audit_eligibility_rules_mutations on public.eligibility_rules;
create trigger audit_eligibility_rules_mutations after insert or update or delete on public.eligibility_rules
for each row execute function public.kandid_audit_admin_row_change();
drop trigger if exists audit_officers_mutations on public.officers;
create trigger audit_officers_mutations after insert or update or delete on public.officers
for each row execute function public.kandid_audit_admin_row_change();
drop trigger if exists audit_officer_new_roster_mutations on public.officer_new_roster;
create trigger audit_officer_new_roster_mutations after insert or update or delete on public.officer_new_roster
for each row execute function public.kandid_audit_admin_row_change();
drop trigger if exists audit_officer_release_mutations on public.officer_leadership_releases;
create trigger audit_officer_release_mutations after insert or update or delete on public.officer_leadership_releases
for each row execute function public.kandid_audit_admin_row_change();
drop trigger if exists audit_organization_mutations on public.organizations;
create trigger audit_organization_mutations after insert or update or delete on public.organizations
for each row execute function public.kandid_audit_admin_row_change();
drop trigger if exists audit_student_organization_memberships on public.student_organizations;
create trigger audit_student_organization_memberships after insert or update or delete on public.student_organizations
for each row execute function public.kandid_audit_admin_row_change();
drop trigger if exists audit_students_mutations on public.students;
create trigger audit_students_mutations after insert or update or delete on public.students
for each row execute function public.kandid_audit_admin_row_change();
-- Return a deliberately narrow event projection. Raw metadata is never returned;
-- only trigger-generated changed_fields and selected program coverage details
-- are exposed for the trusted organization audit view.
create or replace function public.kandid_list_board_audit_events(
  p_before_created_at timestamptz default null,
  p_before_id bigint default null,
  p_page_size integer default 50,
  p_category text default null,
  p_event_type text default null,
  p_election_id bigint default null,
  p_search text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  assignment_count integer;
  board_org_id bigint;
  board_org_name text;
  page_limit integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  result_json jsonb;
begin
  if caller_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  select count(*)::integer, min(a.organization_id)
    into assignment_count, board_org_id
  from public.admin_users a
  where a.auth_user_id = caller_uid and a.role = 'electoral_board' and a.status = 'active';
  if assignment_count <> 1 or board_org_id is null then
    raise exception using errcode = '42501', message = 'One active Electoral Board assignment is required.';
  end if;
  select o.name into board_org_name from public.organizations o where o.id = board_org_id;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception using errcode = '22023', message = 'A complete pagination cursor is required.';
  end if;

  with filtered as (
    select l.id, coalesce(l.event_type, l.action) as event_type,
      coalesce(l.event_category, public.kandid_audit_category_for_event(coalesce(l.event_type, l.action))) as event_category,
      coalesce(l.actor_name, 'Legacy administrator') as actor_name,
      coalesce(l.actor_role, 'unknown') as actor_role,
      coalesce(l.entity_type, '') as entity_type, coalesce(l.entity_id, '') as entity_id,
      coalesce(l.entity_label, '') as entity_label,
      coalesce(l.organization_name, board_org_name, 'Organization') as organization_name,
      coalesce(l.organization_id, board_org_id) as organization_id,
      coalesce(l.status, 'completed') as status, l.election_id,
      l.event_origin,
      coalesce(l.created_at, l.timestamp) as created_at,
      case when pg_catalog.jsonb_typeof(l.metadata -> 'changed_fields') = 'array'
        then l.metadata -> 'changed_fields' else '[]'::jsonb end as changed_fields,
      case when coalesce(l.event_type, l.action) in ('organization_program_coverage_replaced','organization_program_coverage_changed')
        then pg_catalog.jsonb_build_object(
          'before_programs', l.metadata -> 'before_programs',
          'after_programs', l.metadata -> 'after_programs'
        ) else '{}'::jsonb end as safe_details
    from public.audit_logs l
    where l.organization_id = board_org_id
      and (p_before_created_at is null or (coalesce(l.created_at, l.timestamp), l.id) < (p_before_created_at, p_before_id))
      and (p_category is null or coalesce(l.event_category, public.kandid_audit_category_for_event(coalesce(l.event_type, l.action))) = p_category)
      and (p_event_type is null or coalesce(l.event_type, l.action) = p_event_type)
      and (p_election_id is null or l.election_id = p_election_id)
      and (nullif(pg_catalog.btrim(p_search), '') is null or
        pg_catalog.concat_ws(' ', l.actor_name, l.event_type, l.action, l.entity_type, l.entity_label)
          ilike '%' || pg_catalog.btrim(p_search) || '%')
    order by coalesce(l.created_at, l.timestamp) desc, l.id desc
    limit page_limit + 1
  ), page_rows as (
    select * from filtered order by created_at desc, id desc limit page_limit
  )
  select pg_catalog.jsonb_build_object(
    'events', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', p.id, 'event_type', p.event_type, 'category', p.event_category,
      'actor_name', p.actor_name, 'actor_role', p.actor_role,
      'entity_type', p.entity_type, 'entity_id', p.entity_id, 'entity_label', p.entity_label,
      'organization_id', p.organization_id, 'organization_name', p.organization_name,
      'status', p.status, 'election_id', p.election_id, 'created_at', p.created_at,
      'changed_fields', p.changed_fields, 'safe_details', p.safe_details,
      'is_legacy', p.event_origin is null
    ) order by p.created_at desc, p.id desc) from page_rows p), '[]'::jsonb),
    'has_more', (select count(*) > page_limit from filtered),
    'next_cursor', (select pg_catalog.jsonb_build_object('created_at', p.created_at, 'id', p.id)
      from page_rows p order by p.created_at asc, p.id asc limit 1)
  ) into result_json;
  return result_json;
end;
$function$;

create or replace function public.kandid_list_super_admin_audit_events(
  p_before_created_at timestamptz default null,
  p_before_id bigint default null,
  p_page_size integer default 50,
  p_category text default null,
  p_event_type text default null,
  p_organization_id bigint default null,
  p_election_id bigint default null,
  p_search text default null,
  p_entity_type text default null,
  p_status text default null,
  p_created_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  assignment_count integer;
  page_limit integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  result_json jsonb;
begin
  if caller_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  select count(*)::integer into assignment_count
  from public.admin_users a
  where a.auth_user_id = caller_uid and a.role = 'super_admin' and a.status = 'active';
  if assignment_count <> 1 then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization required.';
  end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception using errcode = '22023', message = 'A complete pagination cursor is required.';
  end if;

  with filtered as (
    select l.id, coalesce(l.event_type, l.action) as event_type,
      coalesce(l.event_category, public.kandid_audit_category_for_event(coalesce(l.event_type, l.action))) as event_category,
      coalesce(l.actor_name, 'Legacy administrator') as actor_name,
      coalesce(l.actor_role, 'unknown') as actor_role,
      coalesce(l.entity_type, '') as entity_type, coalesce(l.entity_id, '') as entity_id,
      coalesce(l.entity_label, '') as entity_label, l.organization_id,
      coalesce(l.organization_name, 'Organization') as organization_name,
      coalesce(l.status, 'completed') as status, l.election_id,
      l.event_origin,
      coalesce(l.created_at, l.timestamp) as created_at,
      case when pg_catalog.jsonb_typeof(l.metadata -> 'changed_fields') = 'array'
        then l.metadata -> 'changed_fields' else '[]'::jsonb end as changed_fields,
      case when coalesce(l.event_type, l.action) in ('organization_program_coverage_replaced','organization_program_coverage_changed')
        then pg_catalog.jsonb_build_object(
          'before_programs', l.metadata -> 'before_programs',
          'after_programs', l.metadata -> 'after_programs'
        )
        when coalesce(l.event_type, l.action) = 'program_catalog_entry_created'
        then pg_catalog.jsonb_build_object('code', l.metadata -> 'code', 'name', l.metadata -> 'name')
        else '{}'::jsonb end as safe_details
    from public.audit_logs l
    where (p_organization_id is null or l.organization_id = p_organization_id)
      and (p_before_created_at is null or (coalesce(l.created_at, l.timestamp), l.id) < (p_before_created_at, p_before_id))
      and (p_category is null or coalesce(l.event_category, public.kandid_audit_category_for_event(coalesce(l.event_type, l.action))) = p_category)
      and (p_event_type is null or coalesce(l.event_type, l.action) = p_event_type)
      and (p_entity_type is null or l.entity_type = p_entity_type)
      and (p_status is null or pg_catalog.lower(coalesce(l.status, 'completed')) = pg_catalog.lower(p_status))
      and (p_election_id is null or l.election_id = p_election_id)
      and (p_created_on is null or (coalesce(l.created_at, l.timestamp) at time zone 'UTC')::date = p_created_on)
      and (nullif(pg_catalog.btrim(p_search), '') is null or
        pg_catalog.concat_ws(' ', l.actor_name, l.event_type, l.action, l.entity_type, l.entity_label, l.organization_name)
          ilike '%' || pg_catalog.btrim(p_search) || '%')
    order by coalesce(l.created_at, l.timestamp) desc, l.id desc
    limit page_limit + 1
  ), page_rows as (
    select * from filtered order by created_at desc, id desc limit page_limit
  )
  select pg_catalog.jsonb_build_object(
    'events', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', p.id, 'event_type', p.event_type, 'category', p.event_category,
      'actor_name', p.actor_name, 'actor_role', p.actor_role,
      'entity_type', p.entity_type, 'entity_id', p.entity_id, 'entity_label', p.entity_label,
      'organization_id', p.organization_id, 'organization_name', p.organization_name,
      'status', p.status, 'election_id', p.election_id, 'created_at', p.created_at,
      'changed_fields', p.changed_fields, 'safe_details', p.safe_details,
      'is_legacy', p.event_origin is null
    ) order by p.created_at desc, p.id desc) from page_rows p), '[]'::jsonb),
    'has_more', (select count(*) > page_limit from filtered),
    'next_cursor', (select pg_catalog.jsonb_build_object('created_at', p.created_at, 'id', p.id)
      from page_rows p order by p.created_at asc, p.id asc limit 1)
  ) into result_json;
  return result_json;
end;
$function$;

-- Replace all client policies and direct grants. Trusted SQL owners and the
-- authenticated Edge Functions may append; clients can only use read RPCs.
alter table public.audit_logs enable row level security;
do $policies$
declare p record;
begin
  for p in select policyname from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'audit_logs'
  loop
    execute pg_catalog.format('drop policy if exists %I on public.audit_logs', p.policyname);
  end loop;
end
$policies$;
revoke all on table public.audit_logs from public, anon, authenticated, service_role;
grant insert on table public.audit_logs to service_role;
revoke all on sequence public.audit_logs_id_seq from public, anon, authenticated, service_role;
grant usage on sequence public.audit_logs_id_seq to service_role;
revoke all on function public.kandid_list_board_audit_events(timestamptz, bigint, integer, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.kandid_list_board_audit_events(timestamptz, bigint, integer, text, text, bigint, text)
  to authenticated;
revoke all on function public.kandid_list_super_admin_audit_events(timestamptz, bigint, integer, text, text, bigint, bigint, text, text, text, date)
  from public, anon, authenticated;
grant execute on function public.kandid_list_super_admin_audit_events(timestamptz, bigint, integer, text, text, bigint, bigint, text, text, text, date)
  to authenticated;
revoke all on function public.kandid_audit_category_for_event(text) from public, anon, authenticated;
revoke all on function public.kandid_prepare_audit_event() from public, anon, authenticated;
revoke all on function public.kandid_audit_admin_row_change() from public, anon, authenticated;

comment on function public.kandid_list_board_audit_events(timestamptz, bigint, integer, text, text, bigint, text) is
  'Returns an allow-listed, newest-first Board audit page for the one active organization derived from auth.uid().';
comment on function public.kandid_list_super_admin_audit_events(timestamptz, bigint, integer, text, text, bigint, bigint, text, text, text, date) is
  'Returns an allow-listed global audit page for an active Super Admin derived from auth.uid().';

commit;
