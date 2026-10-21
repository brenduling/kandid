-- LOCAL REVIEW PROPOSAL ONLY. Installing this RPC requires production approval.
-- Installation creates no electorate, ballot, vote, or election record changes.
-- Invoke separately with a real organization-2 Board session after approval.
-- No changes to the normal lock RPC, RLS, schedule, or ballot/receipt contracts.
begin;

do $preflight$
declare item record;
begin
  for item in select * from (values
    ('public.kandid_lock_board_electorate(integer)','0fe4a3556ac668b31b25f86af1a04cbf'),
    ('public.resolve_student_organization_participation(integer,integer,integer)','9fa37fb5446954fa855bce11a63f2aa7'),
    ('public.kandid_get_student_ballot_candidates(integer)','f61151200968d5c3601eebb29d61b18b'),
    ('public.kandid_is_locked_electorate_member(integer,integer)','e6b562bea2a164222713d94c838ad5e0'),
    ('public.insert_v2_vote_rows(integer,integer,jsonb)','6b99f18237fbe72cc96cf63c9f1cc8af'),
    ('private.kandid_require_locked_electorate_for_ballot()','471f6b34836dd2d6fb4bb10bc5e99868'),
    ('private.kandid_guard_frozen_electorate()','737cb159ce7efc5a0898a95df31554b3'),
    ('private.kandid_guard_frozen_electorate_member()','548db2d4b40f35f4b9c1720addcab469')
  ) expected(signature,digest) loop
    if to_regprocedure(item.signature) is null
      or md5(pg_get_functiondef(to_regprocedure(item.signature))) is distinct from item.digest
      or (select pg_get_userbyid(proowner) from pg_proc where oid=to_regprocedure(item.signature)) is distinct from 'postgres' then
      raise exception 'Recovery contract has drifted: %. No changes applied.',item.signature;
    end if;
  end loop;
  if to_regprocedure('public.kandid_recover_election4_electorate()') is not null then
    raise exception 'Election 4 recovery RPC already exists; inspect before continuing.';
  end if;
end;
$preflight$;

create function public.kandid_recover_election4_electorate()
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog
as $function$
declare
  board_admin public.admin_users%rowtype;
  election_row public.elections%rowtype;
  assignment_count integer;
  board_id bigint;
  eligible_ids integer[];
  inserted_count integer;
  locked_at_value timestamptz;
begin
  if auth.uid() is null then
    raise exception using errcode='28000',message='Authentication required.';
  end if;
  select count(*)::integer,min(id) into assignment_count,board_id
  from public.admin_users
  where auth_user_id=auth.uid() and role='electoral_board' and status='active';
  if assignment_count<>1 then
    raise exception using errcode='42501',message='One active Electoral Board assignment is required.';
  end if;
  select * into board_admin from public.admin_users where id=board_id;
  if board_admin.organization_id is distinct from 2 then
    raise exception using errcode='42501',message='Election is unavailable.';
  end if;

  -- Same election row serialization as the normal lock operation. A second
  -- recovery/lock waits, then fails or returns the committed immutable state.
  select * into election_row from public.elections
  where id=4 and organization_id=board_admin.organization_id for update;
  if not found or election_row.status is distinct from 'active'
    or election_row.academic_term_id is distinct from 1
    or election_row.electorate_policy_version is distinct from 1
    or election_row.electorate_frozen_at is not null
    or election_row.electorate_frozen_by is not null
    or election_row.removed_at is not null or election_row.results_released_at is not null
    or election_row.start_date is distinct from timestamp '2026-10-21 01:00:00'
    or election_row.end_date is distinct from timestamp '2026-10-21 22:00:00' then
    raise exception using errcode='55000',message='Election 4 recovery baseline differs or is already finalized.';
  end if;
  if timezone('Asia/Manila',clock_timestamp())<election_row.start_date
    or timezone('Asia/Manila',clock_timestamp())>=election_row.end_date then
    raise exception using errcode='55000',message='Election 4 recovery is restricted to its existing voting window.';
  end if;
  if not exists(select 1 from public.academic_terms where id=1 and status='active')
    or (select count(*) from public.academic_terms where status='active')<>1
    or exists(select 1 from public.eligibility_rules where election_id=4) then
    raise exception using errcode='55000',message='Election 4 term or optional eligibility configuration changed; review required.';
  end if;
  if exists(select 1 from private.election_eligible_voters where election_id=4)
    or exists(select 1 from public.vote_ballots where election_id=4)
    or exists(select 1 from public.votes where election_id=4) then
    raise exception using errcode='55000',message='Recovery requires zero snapshot, ballot and vote rows.';
  end if;
  -- Check the installed database write boundary at invocation, not just install.
  if not exists(select 1 from pg_trigger where tgrelid='public.vote_ballots'::regclass
    and tgname='vote_ballots_require_locked_electorate' and tgenabled in ('O','A')
    and tgfoid='private.kandid_require_locked_electorate_for_ballot()'::regprocedure) then
    raise exception using errcode='55000',message='Frozen-electorate ballot safeguard is unavailable.';
  end if;

  -- Server-derived IDs only; one query establishes the admission snapshot.
  -- This is the installed membership definition plus explicit current-term
  -- enrollment. No rules currently exist; stop above if that baseline changes.
  select array_agg(s.id order by s.id) into eligible_ids
  from public.students s
  join public.student_term_enrollments ste on ste.student_id=s.id
    and ste.academic_term_id=1 and ste.enrollment_status='enrolled'
  cross join lateral public.resolve_student_organization_participation(s.id,2,1) participation
  where s.status='active' and s.auth_user_id is not null
    and participation.allowed is true and participation.status='active';
  if coalesce(cardinality(eligible_ids),0)<>2 then
    raise exception using errcode='55000',message='Recovery requires exactly two eligible active authenticated enrolled members.';
  end if;
  insert into private.election_eligible_voters(election_id,student_id)
  select 4,member_id from unnest(eligible_ids) member_id;
  get diagnostics inserted_count=row_count;
  if inserted_count<>2 then raise exception 'Electorate snapshot count could not be verified.'; end if;

  perform set_config('kandid.lock_electorate','on',true);
  update public.elections set electorate_frozen_at=clock_timestamp(),electorate_frozen_by=board_admin.id
  where id=4 returning electorate_frozen_at into locked_at_value;
  insert into public.audit_logs(
    user_id,actor_name,actor_role,action,event_type,event_category,entity_type,entity_id,entity_label,
    organization_id,organization_name,election_id,status,event_origin,metadata
  ) values(
    board_admin.id,board_admin.full_name,'electoral_board','election_electorate_locked',
    'election_electorate_locked','elections','election','4',election_row.title,2,
    (select name from public.organizations where id=2),4,'completed','trusted_database',
    jsonb_build_object('recovery','election4_current_window_once','eligible_count',inserted_count,
      'academic_term_id',1,'policy_version',1,'ballots_before',0,'votes_before',0,
      'snapshot_before',0,'start_date',election_row.start_date,'end_date',election_row.end_date,
      'reason','One-time recovery of an active unfrozen election with no voting history')
  );
  -- Crossing the existing cutoff or an audit error rolls everything back.
  if timezone('Asia/Manila',clock_timestamp())>=election_row.end_date then
    raise exception using errcode='55000',message='Election 4 voting window ended during recovery.';
  end if;
  return jsonb_build_object('election_id',4,'is_locked',true,'eligible_voters',inserted_count,
    'locked_at',locked_at_value,'schedule_unchanged',true);
end;
$function$;
alter function public.kandid_recover_election4_electorate() owner to postgres;
revoke all on function public.kandid_recover_election4_electorate() from public,anon,authenticated,service_role;
grant execute on function public.kandid_recover_election4_electorate() to authenticated;
notify pgrst,'reload schema';
commit;
