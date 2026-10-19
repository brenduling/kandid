begin;

-- Existing elections remain on the explicitly marked compatibility path.
-- New elections default to frozen-policy v1 and cannot accept ballots until
-- their Board locks a term-specific electorate.
alter table public.elections
  add column if not exists electorate_policy_version smallint;
update public.elections
set electorate_policy_version = 0
where electorate_policy_version is null;
alter table public.elections
  alter column electorate_policy_version set default 1,
  alter column electorate_policy_version set not null,
  add column if not exists electorate_frozen_at timestamptz,
  add column if not exists electorate_frozen_by bigint references public.admin_users(id) on delete restrict;

do $constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.elections'::regclass
      and conname = 'elections_electorate_policy_version_check'
  ) then
    alter table public.elections
      add constraint elections_electorate_policy_version_check
      check (electorate_policy_version in (0, 1));
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.elections'::regclass
      and conname = 'elections_electorate_lock_pair_check'
  ) then
    alter table public.elections
      add constraint elections_electorate_lock_pair_check
      check ((electorate_frozen_at is null) = (electorate_frozen_by is null));
  end if;
end;
$constraint$;

create table if not exists private.election_eligible_voters (
  election_id integer not null references public.elections(id) on delete restrict,
  student_id integer not null references public.students(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (election_id, student_id)
);
alter table private.election_eligible_voters enable row level security;
revoke all on table private.election_eligible_voters from public, anon, authenticated, service_role;

create or replace function private.kandid_guard_frozen_electorate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'INSERT' then
    if new.electorate_policy_version <> 1
       or new.electorate_frozen_at is not null
       or new.electorate_frozen_by is not null then
      raise exception using errcode = '42501', message = 'New elections must use the frozen-electorate policy and cannot be pre-locked.';
    end if;
    return new;
  end if;

  if old.electorate_frozen_at is not null and (
    new.electorate_frozen_at is distinct from old.electorate_frozen_at
    or new.electorate_frozen_by is distinct from old.electorate_frozen_by
    or new.electorate_policy_version is distinct from old.electorate_policy_version
    or new.organization_id is distinct from old.organization_id
    or new.academic_term_id is distinct from old.academic_term_id
    or new.start_date is distinct from old.start_date
    or new.end_date is distinct from old.end_date
  ) then
    raise exception using errcode = '42501', message = 'The locked election electorate, term, organization, and voting schedule are immutable.';
  end if;

  if new.electorate_policy_version is distinct from old.electorate_policy_version then
    raise exception using errcode = '42501', message = 'Election electorate policy cannot be changed.';
  end if;

  if old.electorate_frozen_at is null and new.electorate_frozen_at is not null then
    if pg_catalog.current_setting('kandid.lock_electorate', true) is distinct from 'on'
       or auth.uid() is null
       or not exists (
         select 1 from public.admin_users a
         where a.id = new.electorate_frozen_by
           and a.auth_user_id = auth.uid()
           and a.role = 'electoral_board'
           and a.status = 'active'
           and a.organization_id = new.organization_id
       ) then
      raise exception using errcode = '42501', message = 'Electorate lock must use the trusted Board operation.';
    end if;
  end if;

  if old.electorate_frozen_at is not null
     and lower(coalesce(old.status, '')) in ('closed', 'archived', 'done')
     and lower(coalesce(new.status, '')) = 'active' then
    raise exception using errcode = '42501', message = 'A closed election cannot be reopened.';
  end if;
  return new;
end;
$function$;
revoke all on function private.kandid_guard_frozen_electorate() from public, anon, authenticated, service_role;
drop trigger if exists elections_guard_frozen_electorate on public.elections;
create trigger elections_guard_frozen_electorate
before insert or update on public.elections
for each row execute function private.kandid_guard_frozen_electorate();

create or replace function private.kandid_guard_frozen_electorate_member()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_election_id integer;
begin
  if tg_op = 'DELETE' then
    target_election_id := old.election_id;
  else
    target_election_id := new.election_id;
  end if;
  if tg_op = 'UPDATE' and (
    new.election_id is distinct from old.election_id
    or new.student_id is distinct from old.student_id
  ) then
    raise exception using errcode = '42501', message = 'Electorate membership cannot be moved.';
  end if;

  if exists (
    select 1 from public.elections e
    where e.id = target_election_id and e.electorate_frozen_at is not null
  ) then
    raise exception using errcode = '42501', message = 'A locked electorate cannot be changed.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function private.kandid_guard_frozen_electorate_member() from public, anon, authenticated, service_role;
drop trigger if exists election_eligible_voters_immutable on private.election_eligible_voters;
create trigger election_eligible_voters_immutable
before insert or update or delete on private.election_eligible_voters
for each row execute function private.kandid_guard_frozen_electorate_member();

-- Defense in depth for the trusted ballot RPC and older submit-vote versions:
-- new-policy ballots are rejected at the database write boundary unless the
-- already-authenticated student is in the locked snapshot.
create or replace function private.kandid_require_locked_electorate_for_ballot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  election_row public.elections%rowtype;
begin
  select e.* into election_row from public.elections e where e.id = new.election_id;
  if not found then
    raise exception using errcode = '42501', message = 'Election is unavailable.';
  end if;
  if election_row.electorate_policy_version = 0 then
    return new;
  end if;
  if election_row.electorate_policy_version <> 1
     or election_row.electorate_frozen_at is null then
    raise exception using errcode = '42501', message = 'Voting is unavailable because the election electorate is not locked.';
  end if;
  if not exists (
    select 1 from private.election_eligible_voters v
    where v.election_id = new.election_id and v.student_id = new.student_id
  ) then
    raise exception using errcode = '42501', message = 'Student is not a member of the locked election electorate.';
  end if;
  return new;
end;
$function$;
revoke all on function private.kandid_require_locked_electorate_for_ballot() from public, anon, authenticated, service_role;
drop trigger if exists vote_ballots_require_locked_electorate on public.vote_ballots;
create trigger vote_ballots_require_locked_electorate
before insert on public.vote_ballots
for each row execute function private.kandid_require_locked_electorate_for_ballot();

create or replace function public.kandid_get_board_electorate_preview(p_election_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  board_admin public.admin_users%rowtype;
  assignment_admin_id bigint;
  assignment_count integer;
  election_row public.elections%rowtype;
  term_row public.academic_terms%rowtype;
  eligible_count bigint;
  now_manila timestamp without time zone;
  block_reason text;
begin
  if caller_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  select count(*)::integer, min(a.id)
    into assignment_count, assignment_admin_id
  from public.admin_users a
  where a.auth_user_id = caller_uid and a.role = 'electoral_board' and a.status = 'active';
  if assignment_count <> 1 then
    raise exception using errcode = '42501', message = 'One active Electoral Board assignment is required.';
  end if;
  select a.* into board_admin from public.admin_users a where a.id = assignment_admin_id;
  select e.* into election_row from public.elections e
  where e.id = p_election_id and e.organization_id = board_admin.organization_id;
  if not found then
    raise exception using errcode = '42501', message = 'Election is unavailable.';
  end if;

  if election_row.academic_term_id is not null then
    select t.* into term_row from public.academic_terms t where t.id = election_row.academic_term_id;
  end if;
  now_manila := pg_catalog.timezone('Asia/Manila', pg_catalog.clock_timestamp());

  if election_row.electorate_policy_version = 0 then
    block_reason := 'This election uses the legacy compatibility policy.';
  elsif election_row.electorate_frozen_at is not null then
    select count(*) into eligible_count from private.election_eligible_voters v where v.election_id = election_row.id;
  elsif election_row.academic_term_id is null or term_row.id is null then
    block_reason := 'Choose an academic term before locking the electorate.';
  elsif election_row.start_date is null or election_row.end_date is null or election_row.start_date >= election_row.end_date then
    block_reason := 'Set a valid voting start and end before locking the electorate.';
  elsif lower(coalesce(election_row.status, '')) <> 'active' then
    block_reason := 'Set the election to Active before locking its electorate.';
  elsif now_manila >= election_row.start_date then
    block_reason := 'Voting start has passed. Move the schedule into the future before locking.';
  else
    select count(*) into eligible_count
    from public.students s
    cross join lateral public.resolve_student_organization_participation(
      s.id, election_row.organization_id, election_row.academic_term_id
    ) participation
    where s.status = 'active'
      and s.auth_user_id is not null
      and participation.allowed is true;
  end if;

  return pg_catalog.jsonb_build_object(
    'election_id', election_row.id,
    'election_title', election_row.title,
    'academic_term_id', election_row.academic_term_id,
    'semester', term_row.semester,
    'academic_year', term_row.academic_year,
    'scheduled_voting_start', election_row.start_date,
    'scheduled_voting_end', election_row.end_date,
    'eligible_voters', eligible_count,
    'is_locked', election_row.electorate_frozen_at is not null,
    'locked_at', election_row.electorate_frozen_at,
    'policy_version', election_row.electorate_policy_version,
    'locking_allowed', block_reason is null and election_row.electorate_frozen_at is null,
    'blocking_reason', block_reason
  );
end;
$function$;

create or replace function public.kandid_lock_board_electorate(p_election_id integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  board_admin public.admin_users%rowtype;
  assignment_admin_id bigint;
  assignment_count integer;
  election_row public.elections%rowtype;
  term_row public.academic_terms%rowtype;
  eligible_count bigint;
  locked_at_value timestamptz;
  now_manila timestamp without time zone;
begin
  if caller_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  select count(*)::integer, min(a.id)
    into assignment_count, assignment_admin_id
  from public.admin_users a
  where a.auth_user_id = caller_uid and a.role = 'electoral_board' and a.status = 'active';
  if assignment_count <> 1 then
    raise exception using errcode = '42501', message = 'One active Electoral Board assignment is required.';
  end if;
  select a.* into board_admin from public.admin_users a where a.id = assignment_admin_id;

  select e.* into election_row from public.elections e
  where e.id = p_election_id and e.organization_id = board_admin.organization_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Election is unavailable.';
  end if;

  if election_row.electorate_frozen_at is not null then
    select count(*) into eligible_count from private.election_eligible_voters v where v.election_id = election_row.id;
    return pg_catalog.jsonb_build_object(
      'election_id', election_row.id, 'eligible_voters', eligible_count,
      'locked_at', election_row.electorate_frozen_at, 'is_locked', true,
      'policy_version', election_row.electorate_policy_version
    );
  end if;
  if exists (select 1 from private.election_eligible_voters v where v.election_id = election_row.id) then
    raise exception using errcode = '55000', message = 'An incomplete electorate snapshot requires administrator review.';
  end if;
  if election_row.electorate_policy_version <> 1 then
    raise exception using errcode = '42501', message = 'Legacy elections cannot be newly locked as historical electorates.';
  end if;
  if election_row.academic_term_id is null then
    raise exception using errcode = '22023', message = 'Choose an academic term before locking the electorate.';
  end if;
  select t.* into term_row from public.academic_terms t where t.id = election_row.academic_term_id;
  if not found then
    raise exception using errcode = '22023', message = 'The election academic term is unavailable.';
  end if;
  if election_row.start_date is null or election_row.end_date is null or election_row.start_date >= election_row.end_date then
    raise exception using errcode = '22023', message = 'Set a valid voting start and end before locking the electorate.';
  end if;
  if lower(coalesce(election_row.status, '')) <> 'active' then
    raise exception using errcode = '22023', message = 'Set the election to Active before locking its electorate.';
  end if;
  now_manila := pg_catalog.timezone('Asia/Manila', pg_catalog.clock_timestamp());
  if now_manila >= election_row.start_date then
    raise exception using errcode = '22023', message = 'Voting start has passed. Move the schedule into the future before locking.';
  end if;

  insert into private.election_eligible_voters (election_id, student_id)
  select election_row.id, s.id
  from public.students s
  cross join lateral public.resolve_student_organization_participation(
    s.id, election_row.organization_id, election_row.academic_term_id
  ) participation
  where s.status = 'active'
    and s.auth_user_id is not null
    and participation.allowed is true
  on conflict (election_id, student_id) do nothing;

  select count(*) into eligible_count from private.election_eligible_voters v where v.election_id = election_row.id;
  perform pg_catalog.set_config('kandid.lock_electorate', 'on', true);
  update public.elections
  set electorate_frozen_at = pg_catalog.clock_timestamp(),
      electorate_frozen_by = board_admin.id
  where id = election_row.id
  returning electorate_frozen_at into locked_at_value;

  insert into public.audit_logs (
    user_id, actor_name, actor_role, action, event_type, event_category,
    entity_type, entity_id, entity_label, organization_id, organization_name,
    election_id, status, event_origin, metadata
  ) values (
    board_admin.id, board_admin.full_name, 'electoral_board',
    'election_electorate_locked', 'election_electorate_locked', 'elections',
    'election', election_row.id::text, election_row.title,
    election_row.organization_id,
    (select o.name from public.organizations o where o.id = election_row.organization_id),
    election_row.id, 'completed', 'trusted_database',
    pg_catalog.jsonb_build_object(
      'eligible_count', eligible_count,
      'academic_term_id', election_row.academic_term_id,
      'policy_version', election_row.electorate_policy_version
    )
  );

  return pg_catalog.jsonb_build_object(
    'election_id', election_row.id,
    'election_title', election_row.title,
    'academic_term_id', election_row.academic_term_id,
    'semester', term_row.semester,
    'academic_year', term_row.academic_year,
    'scheduled_voting_start', election_row.start_date,
    'eligible_voters', eligible_count,
    'is_locked', true,
    'locked_at', locked_at_value,
    'policy_version', election_row.electorate_policy_version
  );
end;
$function$;

-- Service-role-only yes/no membership check for the already-authenticated
-- submit-vote Edge Function. No student IDs or electorate lists are returned.
create or replace function public.kandid_is_locked_electorate_member(p_election_id integer, p_student_id integer)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted server access required.';
  end if;
  return exists (
    select 1
    from public.elections e
    join private.election_eligible_voters v on v.election_id = e.id
    where e.id = p_election_id
      and e.electorate_policy_version = 1
      and e.electorate_frozen_at is not null
      and v.student_id = p_student_id
  );
end;
$function$;

create or replace function private.kandid_election_turnout_summary(p_election_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  election_row public.elections%rowtype;
  electorate_count bigint;
  ballot_count bigint;
  participant_count bigint;
  legacy_vote_count bigint;
  electorate_state text;
  participation_state text;
  percentage numeric;
begin
  select e.* into election_row from public.elections e where e.id = p_election_id;
  if not found then raise exception using errcode = '22023', message = 'Election is unavailable.'; end if;

  select count(*) into ballot_count from public.vote_ballots b where b.election_id = election_row.id;
  select count(distinct b.student_id) into participant_count from public.vote_ballots b where b.election_id = election_row.id;
  select count(*) into legacy_vote_count
  from public.votes v
  where v.election_id = election_row.id
    and not exists (select 1 from public.vote_ballots b where b.id = v.ballot_id);

  if election_row.electorate_policy_version = 1 and election_row.electorate_frozen_at is not null then
    select count(*) into electorate_count from private.election_eligible_voters v where v.election_id = election_row.id;
    electorate_state := case when electorate_count = 0 then 'frozen_zero_member' else 'frozen_authoritative' end;
  elsif election_row.electorate_policy_version = 0 then
    electorate_count := null;
    electorate_state := 'legacy_unavailable';
  else
    electorate_count := null;
    electorate_state := 'unlocked_unavailable';
  end if;

  if legacy_vote_count > 0 and ballot_count > 0 then
    participation_state := 'mixed_ballot_and_legacy';
  elsif legacy_vote_count > 0 then
    participation_state := 'legacy_unavailable';
    participant_count := null;
  else
    participation_state := 'authoritative';
  end if;

  if electorate_state = 'frozen_authoritative'
     and participation_state = 'authoritative'
     and electorate_count > 0 then
    percentage := round((participant_count::numeric / electorate_count::numeric) * 100, 1);
  else
    percentage := null;
  end if;

  return pg_catalog.jsonb_build_object(
    'election_id', election_row.id,
    'electorate_policy_version', election_row.electorate_policy_version,
    'electorate_availability', electorate_state,
    'eligible_voters', electorate_count,
    'participation_availability', participation_state,
    'participated_voters', participant_count,
    'authoritative_ballot_count', case when participation_state = 'legacy_unavailable' then null else ballot_count end,
    'legacy_vote_rows_without_ballot', legacy_vote_count,
    'turnout_percentage', percentage,
    'turnout_availability', case
      when electorate_state = 'legacy_unavailable' then 'legacy_unavailable'
      when electorate_state = 'unlocked_unavailable' then 'electorate_unlocked'
      when electorate_state = 'frozen_zero_member' then 'zero_member_electorate'
      when participation_state <> 'authoritative' then participation_state
      else 'authoritative'
    end
  );
end;
$function$;
revoke all on function private.kandid_election_turnout_summary(integer) from public, anon, authenticated, service_role;

create or replace function public.kandid_get_election_turnout(p_election_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  election_row public.elections%rowtype;
  admin_count integer;
  admin_row public.admin_users%rowtype;
  student_id_value integer;
  eligibility_term_id integer;
  student_participation_allowed boolean := false;
  now_manila timestamp without time zone;
  visible_to_student boolean := false;
begin
  if caller_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  select e.* into election_row from public.elections e where e.id = p_election_id;
  if not found then raise exception using errcode = '42501', message = 'Election is unavailable.'; end if;

  select count(*)::integer into admin_count
  from public.admin_users a where a.auth_user_id = caller_uid and a.status = 'active';
  if admin_count = 1 then
    select a.* into admin_row from public.admin_users a where a.auth_user_id = caller_uid and a.status = 'active';
    if admin_row.role = 'electoral_board' and admin_row.organization_id = election_row.organization_id then
      return private.kandid_election_turnout_summary(election_row.id);
    elsif admin_row.role = 'super_admin' then
      return private.kandid_election_turnout_summary(election_row.id);
    end if;
    raise exception using errcode = '42501', message = 'Election is unavailable.';
  elsif admin_count > 1 then
    raise exception using errcode = '42501', message = 'One active administrator identity is required.';
  end if;

  select s.id into student_id_value from public.students s
  where s.auth_user_id = caller_uid and s.status = 'active';
  if student_id_value is null then
    raise exception using errcode = '42501', message = 'Election is unavailable.';
  end if;

  now_manila := pg_catalog.timezone('Asia/Manila', pg_catalog.clock_timestamp());
  visible_to_student := election_row.results_released_at is not null
    or (
      election_row.student_result_visibility = 'realtime'
      and lower(coalesce(election_row.status, '')) not in ('draft', 'archived')
      and (
        (election_row.start_date is not null and election_row.end_date is not null
          and now_manila >= election_row.start_date and now_manila < election_row.end_date)
        or public.kandid_election_is_closed(election_row.id)
      )
    )
    or (
      election_row.student_result_visibility in ('hidden', 'after_close')
      and public.kandid_election_is_closed(election_row.id)
    );

  if election_row.academic_term_id is not null then
    eligibility_term_id := election_row.academic_term_id;
  else
    -- Legacy termless elections keep the existing current-term authorization
    -- solely for result visibility; this value is never used as an electorate
    -- snapshot or turnout denominator.
    select t.id into eligibility_term_id
    from public.academic_terms t
    where t.status = 'active'
    order by t.created_at desc, t.id desc
    limit 1;
  end if;
  if visible_to_student and eligibility_term_id is not null then
    select coalesce(participation.allowed, false) into student_participation_allowed
    from public.resolve_student_organization_participation(
      student_id_value,
      election_row.organization_id,
      eligibility_term_id
    ) participation;
  end if;

  if not visible_to_student or not student_participation_allowed then
    raise exception using errcode = '42501', message = 'Election is unavailable.';
  end if;
  return private.kandid_election_turnout_summary(election_row.id);
end;
$function$;

-- Preserve the existing secure report implementation and extend its one
-- Voting Summary dataset with the canonical turnout contract.
alter function public.kandid_get_board_election_report_package(integer)
  set schema private;
alter function private.kandid_get_board_election_report_package(integer)
  rename to kandid_get_board_election_report_package_base;
revoke all on function private.kandid_get_board_election_report_package_base(integer)
  from public, anon, authenticated, service_role;

create function public.kandid_get_board_election_report_package(p_election_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  report_result jsonb;
  voting_summary jsonb;
  turnout_summary jsonb;
begin
  report_result := private.kandid_get_board_election_report_package_base(p_election_id);
  turnout_summary := private.kandid_election_turnout_summary(p_election_id);
  voting_summary := coalesce(report_result -> 'voting_summary', '{}'::jsonb) || pg_catalog.jsonb_build_object(
    'electorate_policy_version', turnout_summary -> 'electorate_policy_version',
    'electorate_availability', turnout_summary -> 'electorate_availability',
    'eligible_voters', turnout_summary -> 'eligible_voters',
    'participation_availability', turnout_summary -> 'participation_availability',
    'participated_voters', turnout_summary -> 'participated_voters',
    'turnout_availability', turnout_summary -> 'turnout_availability',
    'turnout_percentage', turnout_summary -> 'turnout_percentage'
  );
  return pg_catalog.jsonb_set(report_result, '{voting_summary}', voting_summary, true);
end;
$function$;

-- Preserve generic election auditing while treating the dedicated electorate
-- lock as one meaningful action. The lock RPC updates only the two internal
-- lock columns above; ordinary election changes (including a change combined
-- with lock metadata) still pass through the existing trusted audit writer.
drop trigger if exists audit_elections_mutations on public.elections;
drop trigger if exists audit_elections_mutations_update on public.elections;
create trigger audit_elections_mutations after insert or delete on public.elections
for each row execute function public.kandid_audit_admin_row_change();
create trigger audit_elections_mutations_update after update on public.elections
for each row
when (
  (pg_catalog.to_jsonb(old) - 'electorate_frozen_at' - 'electorate_frozen_by')
  is distinct from
  (pg_catalog.to_jsonb(new) - 'electorate_frozen_at' - 'electorate_frozen_by')
)
execute function public.kandid_audit_admin_row_change();

revoke all on function public.kandid_get_board_electorate_preview(integer) from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_board_electorate_preview(integer) to authenticated;
revoke all on function public.kandid_lock_board_electorate(integer) from public, anon, authenticated, service_role;
grant execute on function public.kandid_lock_board_electorate(integer) to authenticated;
revoke all on function public.kandid_is_locked_electorate_member(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.kandid_is_locked_electorate_member(integer, integer) to service_role;
revoke all on function public.kandid_get_election_turnout(integer) from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_election_turnout(integer) to authenticated;
revoke all on function public.kandid_get_board_election_report_package(integer) from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_board_election_report_package(integer) to authenticated;

comment on function public.kandid_get_board_electorate_preview(integer) is
  'Returns only live aggregate electorate preview and configuration for the caller’s assigned Board election.';
comment on function public.kandid_lock_board_electorate(integer) is
  'Atomically recomputes and locks a term-specific election electorate before scheduled voting begins; records a trusted Board audit event.';
comment on function public.kandid_is_locked_electorate_member(integer, integer) is
  'Service-role-only yes/no check for submit-vote; exposes no electorate identities.';
comment on function public.kandid_get_election_turnout(integer) is
  'Returns privacy-safe canonical election-level eligibility and participation counts to an authorized administrator or student results reader.';
comment on function public.kandid_get_board_election_report_package(integer) is
  'Returns election-scoped report datasets and canonical privacy-safe turnout counts after trusted Board authorization.';

notify pgrst, 'reload schema';
commit;
