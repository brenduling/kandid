-- LOCAL PROPOSAL ONLY. Not in migration discovery; requires separate production approval.
-- Installs contracts only: no rule, schedule, snapshot, vote or election record writes.
-- Independently reviewed against the installed baseline; do not stack with the Election 3 proposal.
-- Election 4 opt-in only: all other elections retain their installed contracts.
-- Rule and schedule changes remain separate authenticated Board operations.
begin;

do $preflight$
declare item record;
begin
  perform 1 from public.elections where id=4 for update;
  for item in select * from (values
    ('private.kandid_guard_frozen_electorate()','737cb159ce7efc5a0898a95df31554b3'),
    ('private.kandid_guard_frozen_electorate_member()','548db2d4b40f35f4b9c1720addcab469'),
    ('private.kandid_guard_removed_election_child_mutation()','2bc030d422ea1f8dec3bcba29d90a9e3'),
    ('private.kandid_require_locked_electorate_for_ballot()','471f6b34836dd2d6fb4bb10bc5e99868'),
    ('public.kandid_get_board_electorate_preview(integer)','c551f3def42e6326d291a48c42854a1d'),
    ('public.kandid_get_student_ballot_candidates(integer)','f61151200968d5c3601eebb29d61b18b'),
    ('public.kandid_is_locked_electorate_member(integer,integer)','e6b562bea2a164222713d94c838ad5e0'),
    ('public.kandid_lock_board_electorate(integer)','0fe4a3556ac668b31b25f86af1a04cbf'),
    ('public.resolve_student_organization_participation(integer,integer,integer)','9fa37fb5446954fa855bce11a63f2aa7')
  ) expected(signature, digest) loop
    if to_regprocedure(item.signature) is null or
       (select pg_get_userbyid(proowner) from pg_proc where oid=to_regprocedure(item.signature)) is distinct from 'postgres' or
       md5(pg_get_functiondef(to_regprocedure(item.signature))) is distinct from item.digest then
      raise exception 'Reviewed function has drifted: %. No changes applied.', item.signature;
    end if;
  end loop;
  if not exists (select 1 from public.elections e where e.id=4
    and e.organization_id=2 and e.status='active'
    and e.electorate_policy_version=1 and e.electorate_frozen_at is null
    and e.electorate_frozen_by is null and e.removed_at is null
    and e.results_released_at is null)
    or exists (select 1 from private.election_eligible_voters where election_id=4)
    or exists (select 1 from public.vote_ballots where election_id=4)
    or exists (select 1 from public.votes where election_id=4) then
    raise exception 'Election 4 recovery baseline differs; inspect before applying.';
  end if;
  if to_regprocedure('private.kandid_election_uses_declared_ballot_rules(integer)') is not null
     or to_regprocedure('private.kandid_student_matches_ballot_rules(integer,integer)') is not null
     or to_regprocedure('private.kandid_guard_frozen_ballot_rules()') is not null then
    raise exception 'Rule enforcement already exists; inspect before applying.';
  end if;
end;
$preflight$;

-- Explicit rollout scope. This is an Election 4 repair, not an automatic
-- authorization change for other existing or future elections.
create function private.kandid_election_uses_declared_ballot_rules(p_election_id integer)
returns boolean language sql immutable set search_path=pg_catalog
as $function$ select coalesce(p_election_id=4,false) $function$;
alter function private.kandid_election_uses_declared_ballot_rules(integer) owner to postgres;
revoke all on function private.kandid_election_uses_declared_ballot_rules(integer) from public,anon,authenticated,service_role;

-- Internal predicate only: no new student-data endpoint or browser grants.
-- Term enrollment is authoritative. OR between rules; NULL program/bounds are
-- wildcards. SHS inclusion is explicit and independent of college year bounds.
-- Missing rules/enrollment/identity/term fail closed for the opted-in election.
create function private.kandid_student_matches_ballot_rules(
  p_election_id integer, p_student_id integer
)
returns boolean language plpgsql stable set search_path=pg_catalog
as $function$
begin
  if not private.kandid_election_uses_declared_ballot_rules(p_election_id) then
    return true;
  end if;
  return exists (
    select 1 from public.elections e
    join public.academic_terms t on t.id=e.academic_term_id and t.status='active'
    join public.students s on s.id=p_student_id and s.status='active' and s.auth_user_id is not null
    join public.student_term_enrollments ste on ste.student_id=s.id
      and ste.academic_term_id=e.academic_term_id and ste.enrollment_status='enrolled'
    cross join lateral public.resolve_student_organization_participation(
      s.id,e.organization_id,e.academic_term_id
    ) participation
    where e.id=p_election_id and e.status='active' and e.removed_at is null
      and (select count(*) from public.academic_terms where status='active')=1
      and participation.allowed is true
      and exists (
        select 1 from public.eligibility_rules r where r.election_id=e.id
          and (r.program is null or upper(btrim(ste.program))=upper(btrim(r.program)))
          and (
            (ste.is_shs is true and r.allow_shs is true)
            or (ste.is_shs is false and ste.year_level between 1 and 6
              and (r.min_year_level is null or ste.year_level>=r.min_year_level)
              and (r.max_year_level is null or ste.year_level<=r.max_year_level))
          )
      )
  );
end;
$function$;
alter function private.kandid_student_matches_ballot_rules(integer,integer) owner to postgres;
revoke all on function private.kandid_student_matches_ballot_rules(integer,integer) from public,anon,authenticated,service_role;

-- Serialize a rule edit with the same election row locked by the freeze RPC.
-- Preserve historical rules and snapshot integrity once locking or voting exists.
create function private.kandid_guard_frozen_ballot_rules()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $function$
declare target_id integer; election_row record;
begin
  if tg_op='DELETE' then target_id:=old.election_id;
  else target_id:=new.election_id; end if;
  if tg_op='UPDATE' and new.election_id is distinct from old.election_id
    and (private.kandid_election_uses_declared_ballot_rules(old.election_id)
      or private.kandid_election_uses_declared_ballot_rules(new.election_id)) then
    raise exception using errcode='42501',message='An enforced eligibility rule cannot be moved to another election.';
  end if;
  if private.kandid_election_uses_declared_ballot_rules(target_id) then
    select e.electorate_frozen_at,e.removed_at into election_row
    from public.elections e where e.id=target_id for update;
    if not found or election_row.removed_at is not null then
      raise exception using errcode='42501',message='Election is unavailable.';
    end if;
    if election_row.electorate_frozen_at is not null
      or exists(select 1 from private.election_eligible_voters where election_id=target_id)
      or exists(select 1 from public.vote_ballots where election_id=target_id)
      or exists(select 1 from public.votes where election_id=target_id) then
      raise exception using errcode='42501',message='Eligibility rules are locked for this election.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
alter function private.kandid_guard_frozen_ballot_rules() owner to postgres;
revoke all on function private.kandid_guard_frozen_ballot_rules() from public,anon,authenticated,service_role;
create trigger eligibility_rules_guard_declared_ballot_rules
before insert or update or delete on public.eligibility_rules
for each row execute function private.kandid_guard_frozen_ballot_rules();

CREATE OR REPLACE FUNCTION public.kandid_get_board_electorate_preview(p_election_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
      and participation.allowed is true
      and private.kandid_student_matches_ballot_rules(election_row.id,s.id);
  end if;

  if private.kandid_election_uses_declared_ballot_rules(election_row.id)
     and election_row.electorate_frozen_at is null then
    if exists(select 1 from private.election_eligible_voters where election_id=election_row.id) then
      block_reason := 'An incomplete electorate snapshot requires administrator review.';
    elsif exists(select 1 from public.vote_ballots where election_id=election_row.id)
       or exists(select 1 from public.votes where election_id=election_row.id) then
      block_reason := 'Existing voting history requires administrator review.';
    elsif not exists(select 1 from public.eligibility_rules where election_id=election_row.id) then
      block_reason := 'Save the election eligibility rules before locking the electorate.';
    elsif term_row.status is distinct from 'active'
       or (select count(*) from public.academic_terms where status='active')<>1 then
      block_reason := 'The election must use the single active academic term.';
    end if;
  end if;
  if private.kandid_election_uses_declared_ballot_rules(election_row.id)
     and election_row.electorate_frozen_at is null and block_reason is null
     and coalesce(eligible_count,0)=0 then
    block_reason := 'No eligible voters match the saved election rules.';
  end if;

  return pg_catalog.jsonb_build_object(
    'election_id', election_row.id,
    'election_title', election_row.title,
    'eligibility_contract', case when private.kandid_election_uses_declared_ballot_rules(election_row.id) then 'declared-rules-v1' else null end,
    'rule_count', (select count(*) from public.eligibility_rules where election_id=election_row.id),
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

CREATE OR REPLACE FUNCTION public.kandid_lock_board_electorate(p_election_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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

  if private.kandid_election_uses_declared_ballot_rules(election_row.id) then
    if exists(select 1 from public.vote_ballots where election_id=election_row.id)
       or exists(select 1 from public.votes where election_id=election_row.id) then
      raise exception using errcode='55000',message='Existing voting history requires administrator review.';
    end if;
    if not exists(select 1 from public.eligibility_rules where election_id=election_row.id) then
      raise exception using errcode='22023',message='Save the election eligibility rules before locking the electorate.';
    end if;
    if term_row.status is distinct from 'active'
       or (select count(*) from public.academic_terms where status='active')<>1 then
      raise exception using errcode='22023',message='The election must use the single active academic term.';
    end if;
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
    and private.kandid_student_matches_ballot_rules(election_row.id,s.id)
  on conflict (election_id, student_id) do nothing;

  select count(*) into eligible_count from private.election_eligible_voters v where v.election_id = election_row.id;
  if private.kandid_election_uses_declared_ballot_rules(election_row.id) and eligible_count=0 then
    raise exception using errcode='22023',message='No eligible voters match the saved election rules.';
  end if;
  if private.kandid_election_uses_declared_ballot_rules(election_row.id)
     and timezone('Asia/Manila',clock_timestamp())>=election_row.start_date then
    raise exception using errcode='22023',message='Voting start has passed. Move the schedule into the future before locking.';
  end if;
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

CREATE OR REPLACE FUNCTION public.kandid_get_student_ballot_candidates(p_election_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  caller_uid uuid := auth.uid();
  student_count integer;
  student_id_value integer;
  active_term_count integer;
  term_id_value integer;
  election_row record;
  participation_allowed boolean := false;
  manila_now timestamp without time zone;
  candidate_data jsonb;
begin
  if caller_uid is null or p_election_id is null or p_election_id <= 0 then
    raise exception using errcode='28000', message='Eligible Student authentication is required.';
  end if;
  select pg_catalog.count(*)::integer,pg_catalog.min(s.id)
    into student_count,student_id_value
    from public.students s where s.auth_user_id=caller_uid;
  if student_count<>1 or not exists (
    select 1 from public.students s where s.id=student_id_value
      and s.auth_user_id=caller_uid and s.status='active'
  ) then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;

  select e.id,e.organization_id,e.academic_term_id,e.electorate_policy_version,
         e.electorate_frozen_at,e.start_date,e.end_date,e.status::text as election_status
    into election_row
  from public.elections e
  where e.id=p_election_id and e.status='active' and e.removed_at is null;
  if not found then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;

  if election_row.start_date is null or election_row.end_date is null then
    return '[]'::jsonb;
  end if;
  manila_now := pg_catalog.timezone('Asia/Manila',pg_catalog.statement_timestamp());
  if manila_now < election_row.start_date or manila_now >= election_row.end_date then
    return '[]'::jsonb;
  end if;

  select pg_catalog.count(*)::integer,pg_catalog.min(t.id)
    into active_term_count,term_id_value
  from public.academic_terms t where t.status='active';
  if active_term_count<>1 then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;
  if election_row.academic_term_id is not null
     and election_row.academic_term_id is distinct from term_id_value then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;

  if election_row.electorate_policy_version=1 then
    if election_row.electorate_frozen_at is null
       or election_row.academic_term_id is null
       or term_id_value is distinct from election_row.academic_term_id
       or not exists (
         select 1 from public.student_term_enrollments ste
         where ste.student_id=student_id_value
           and ste.academic_term_id=term_id_value
           and ste.enrollment_status='enrolled'
       )
       or not exists (
         select 1 from private.election_eligible_voters ev
         where ev.election_id=p_election_id and ev.student_id=student_id_value
       ) then
      raise exception using errcode='42501', message='Ballot choices are unavailable.';
    end if;
  elsif election_row.electorate_policy_version<>0 then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;

  select coalesce(participation.allowed,false) into participation_allowed
  from public.resolve_student_organization_participation(
    student_id_value,election_row.organization_id,term_id_value
  ) participation;
  if not coalesce(participation_allowed,false)
     or not private.kandid_student_matches_ballot_rules(p_election_id,student_id_value) then
    raise exception using errcode='42501', message='Ballot choices are unavailable.';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',c.id,
    'position_id',c.position_id,
    'photo',c.photo,
    'students',pg_catalog.jsonb_build_object('first_name',s.first_name,'last_name',s.last_name,'photo_url',s.photo_url),
    'partylists',case when pl.id is null then null
      else pg_catalog.jsonb_build_object('name',pl.name,'logo_url',pl.logo_url) end
  ) order by p.display_order,p.id,c.id),'[]'::jsonb)
  into candidate_data
  from public.positions p
  join public.candidates c on c.position_id=p.id
  join public.students s on s.id=c.student_id
  left join public.partylists pl on pl.id=c.partylist_id
    and pl.organization_id=election_row.organization_id
    and (pl.election_id is null or pl.election_id=p_election_id)
  where p.election_id=p_election_id and p.status='active';
  return candidate_data;
end;
$function$;

CREATE OR REPLACE FUNCTION public.kandid_is_locked_electorate_member(p_election_id integer, p_student_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
      and (not private.kandid_election_uses_declared_ballot_rules(p_election_id) or (
        private.kandid_student_matches_ballot_rules(p_election_id,p_student_id)
        and timezone('Asia/Manila',statement_timestamp())>=e.start_date
        and timezone('Asia/Manila',statement_timestamp())<e.end_date
      ))
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.kandid_require_locked_electorate_for_ballot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  if private.kandid_election_uses_declared_ballot_rules(new.election_id) and (
    not private.kandid_student_matches_ballot_rules(new.election_id,new.student_id)
    or election_row.start_date is null or election_row.end_date is null
    or timezone('Asia/Manila',statement_timestamp())<election_row.start_date
    or timezone('Asia/Manila',statement_timestamp())>=election_row.end_date
  ) then
    raise exception using errcode='42501',message='Student is not eligible for this election.';
  end if;
  return new;
end;
$function$;

create function private.kandid_guard_unfinalized_ballot_start()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $function$
begin
  if not private.kandid_election_uses_declared_ballot_rules(new.id) then return new; end if;
  if tg_op='UPDATE' then
    if lower(coalesce(old.status,'')) in ('closed','done','archived') and new.status='active' then
      raise exception using errcode='42501',message='A closed election cannot be reopened.';
    end if;
    if new.status is not distinct from old.status
      and new.start_date is not distinct from old.start_date
      and new.end_date is not distinct from old.end_date then return new; end if;
  end if;
  if new.status='active' and new.electorate_frozen_at is null
    and (new.start_date is null or new.end_date is null or new.start_date>=new.end_date
      or timezone('Asia/Manila',clock_timestamp())>=new.start_date) then
    raise exception using errcode='22023',message='Save a future voting window, then lock the electorate before voting starts.';
  end if;
  return new;
end;
$function$;
alter function private.kandid_guard_unfinalized_ballot_start() owner to postgres;
revoke all on function private.kandid_guard_unfinalized_ballot_start() from public,anon,authenticated,service_role;
create trigger elections_guard_unfinalized_ballot_start
before insert or update on public.elections
for each row execute function private.kandid_guard_unfinalized_ballot_start();

-- CREATE OR REPLACE preserves existing owners and ACLs. Verify no grant drift.
do $postflight$
declare signature text;
begin
  foreach signature in array array[
    'public.kandid_get_board_electorate_preview(integer)',
    'public.kandid_lock_board_electorate(integer)',
    'public.kandid_get_student_ballot_candidates(integer)'
  ] loop
    if not has_function_privilege('authenticated',signature,'EXECUTE')
      or has_function_privilege('anon',signature,'EXECUTE')
      or has_function_privilege('service_role',signature,'EXECUTE') then
      raise exception 'Authenticated RPC grant contract changed: %',signature;
    end if;
  end loop;
  if not has_function_privilege('service_role','public.kandid_is_locked_electorate_member(integer,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.kandid_is_locked_electorate_member(integer,integer)','EXECUTE')
    or has_function_privilege('anon','public.kandid_is_locked_electorate_member(integer,integer)','EXECUTE') then
    raise exception 'Server-only electorate membership contract changed.';
  end if;
end;
$postflight$;
notify pgrst, 'reload schema';
commit;

