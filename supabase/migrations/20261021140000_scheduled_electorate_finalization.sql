-- REVIEWED LOCAL IMPLEMENTATION. Do not db push/include-all. Installs no Cron
-- extension/job, backfills no requests, and changes no existing election row.
begin;
do $preflight$
declare item record;
begin
 if current_user<>'postgres' then raise exception 'The reviewed migration must run as postgres.';end if;
 for item in select * from (values
  ('private.kandid_guard_frozen_electorate()','737cb159ce7efc5a0898a95df31554b3'),
  ('private.kandid_guard_frozen_electorate_member()','548db2d4b40f35f4b9c1720addcab469'),
  ('private.kandid_require_locked_electorate_for_ballot()','471f6b34836dd2d6fb4bb10bc5e99868'),
  ('public.kandid_get_board_electorate_preview(integer)','c551f3def42e6326d291a48c42854a1d'),
  ('public.kandid_get_student_ballot_candidates(integer)','f61151200968d5c3601eebb29d61b18b'),
  ('public.kandid_is_locked_electorate_member(integer,integer)','e6b562bea2a164222713d94c838ad5e0'),
  ('public.kandid_lock_board_electorate(integer)','0fe4a3556ac668b31b25f86af1a04cbf'),
  ('public.resolve_student_organization_participation(integer,integer,integer)','9fa37fb5446954fa855bce11a63f2aa7')
 ) expected(signature,digest) loop
  if to_regprocedure(item.signature) is null
   or (select pg_get_userbyid(proowner) from pg_proc where oid=to_regprocedure(item.signature))<>'postgres'
   or md5(pg_get_functiondef(to_regprocedure(item.signature)))<>item.digest then
   raise exception 'Reviewed electorate contract drift: %; no changes applied.',item.signature;
  end if;
 end loop;
 if to_regclass('private.election_electorate_finalizations') is not null
  or to_regprocedure('private.kandid_student_matches_optional_eligibility(integer,integer)') is not null then
  raise exception 'Scheduled eligibility installation already exists; inspect before proceeding.';
 end if;
 -- Existing histories with declared rules need their own review. Do not change
 -- historical eligibility interpretation as a side effect of installation.
 if exists(select 1 from public.elections e join public.eligibility_rules r on r.election_id=e.id
  where e.electorate_policy_version=1 and e.electorate_frozen_at is not null) then
  raise exception 'Frozen elections with existing rules require a historical-compatibility review.';
 end if;
end;
$preflight$;

create table private.election_electorate_finalizations (
 election_id integer primary key references public.elections(id) on delete restrict,
 requested_by bigint not null references public.admin_users(id) on delete restrict,
 requested_uid uuid not null,requested_at timestamptz not null default clock_timestamp(),
 revision text not null,generation bigint not null default 1,
 organization_id integer not null,academic_term_id integer not null,
 voting_start timestamp not null,voting_end timestamp not null,due_at timestamptz not null,
 next_attempt_at timestamptz not null,
 state text not null check(state in('scheduled','retrying','processing','finalized','missed','blocked','cancelled')),
 attempts integer not null default 0 check(attempts>=0),last_attempt_at timestamptz,
 reason_code text,completed_at timestamptz,processing_xid xid8,
 check((state='processing')=(processing_xid is not null))
);
create index election_electorate_due on private.election_electorate_finalizations(next_attempt_at,election_id)
 where state in('scheduled','retrying');
alter table private.election_electorate_finalizations enable row level security;
revoke all on private.election_electorate_finalizations from public,anon,authenticated,service_role;
create table private.electorate_scheduler_health (
 id smallint primary key check(id=1),last_success_at timestamptz not null
);
alter table private.electorate_scheduler_health enable row level security;
revoke all on private.electorate_scheduler_health from public,anon,authenticated,service_role;

create function private.kandid_electorate_revision(p_id integer)
returns text language sql stable set search_path=pg_catalog as $function$
 select md5(jsonb_build_object('organization',e.organization_id,'term',e.academic_term_id,
  'start',e.start_date,'end',e.end_date,'rules',coalesce((select jsonb_agg(
   jsonb_build_array(r.id,r.program,r.min_year_level,r.max_year_level,r.allow_shs) order by r.id)
   from public.eligibility_rules r where r.election_id=e.id),'[]'::jsonb))::text)
 from public.elections e where e.id=p_id
$function$;
revoke all on function private.kandid_electorate_revision(integer) from public,anon,authenticated,service_role;

create function private.kandid_electorate_job_enabled()
returns boolean language plpgsql stable set search_path=pg_catalog as $function$
declare enabled boolean;
begin
 if to_regclass('cron.job') is null then return false; end if;
 execute $query$select exists(select 1 from cron.job where jobname='kandid-electorate-finalization-v1'
  and active and username='postgres' and database=current_database() and schedule='* * * * *'
  and command='select private.kandid_process_due_electorates();')$query$ into enabled;
 return coalesce(enabled,false);
end;
$function$;
revoke all on function private.kandid_electorate_job_enabled() from public,anon,authenticated,service_role;
create function private.kandid_electorate_scheduler_ready()
returns boolean language sql stable set search_path=pg_catalog as $function$
 select private.kandid_electorate_job_enabled() and exists(
  select 1 from private.electorate_scheduler_health where id=1
   and last_success_at>clock_timestamp()-interval '2 minutes'
   and last_success_at<=clock_timestamp())
$function$;
revoke all on function private.kandid_electorate_scheduler_ready() from public,anon,authenticated,service_role;

-- Called only by the restricted dispatcher or the authenticated Board retry.
-- INVOKER: the dispatcher is postgres and the Board wrapper is the existing
-- tightly scoped definer RPC. No API role can invoke this core itself.
create function private.kandid_attempt_electorate(p_id integer)
returns jsonb language plpgsql set search_path=pg_catalog as $function$
declare e public.elections%rowtype;q private.election_electorate_finalizations%rowtype;
 eligible bigint;reason text;frozen timestamptz;board_name text;
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='Trusted database execution required.';end if;
 select * into e from public.elections where id=p_id for update;
 if not found then raise exception using errcode='42501',message='Election is unavailable.';end if;
 select * into q from private.election_electorate_finalizations where election_id=p_id for update;
 if not found then raise exception using errcode='55000',message='Save an active future election to schedule electorate finalization.';end if;
 if e.electorate_frozen_at is not null then
  return jsonb_build_object('election_id',p_id,'is_locked',true,'locked_at',e.electorate_frozen_at,
   'eligible_voters',(select count(*) from private.election_eligible_voters where election_id=p_id));
 end if;
 if q.state not in('scheduled','retrying') then
  return jsonb_build_object('election_id',p_id,'is_locked',false,'finalization_state',q.state,'reason_code',q.reason_code);
 end if;
 if clock_timestamp()<q.due_at or clock_timestamp()<q.next_attempt_at then
  return jsonb_build_object('election_id',p_id,'is_locked',false,'finalization_state',q.state,'reason_code','NOT_DUE');
 end if;
 if e.status<>'active' or e.removed_at is not null or e.electorate_policy_version<>1 then reason:='ELECTION_UNAVAILABLE';
 elsif clock_timestamp()>=(e.start_date at time zone 'Asia/Manila') then reason:='MISSED_START';
 elsif q.revision is distinct from private.kandid_electorate_revision(p_id)
  or (q.organization_id,q.academic_term_id,q.voting_start,q.voting_end)
   is distinct from (e.organization_id,e.academic_term_id,e.start_date,e.end_date) then reason:='STALE_REQUEST';
 elsif not exists(select 1 from public.admin_users a where a.id=q.requested_by
  and a.auth_user_id=q.requested_uid and a.role='electoral_board' and a.status='active'
  and a.organization_id=e.organization_id) then reason:='AUTHORIZATION_REVOKED';
 elsif exists(select 1 from private.election_eligible_voters where election_id=p_id)
  or exists(select 1 from public.vote_ballots where election_id=p_id)
  or exists(select 1 from public.votes where election_id=p_id) then reason:='HISTORY_REVIEW_REQUIRED';
 end if;
 if reason is not null then
  update private.election_electorate_finalizations set state=case when reason='MISSED_START' then 'missed' else 'blocked' end,
   reason_code=reason,last_attempt_at=clock_timestamp(),attempts=attempts+1,processing_xid=null where election_id=p_id;
  return jsonb_build_object('election_id',p_id,'is_locked',false,'reason_code',reason);
 end if;
 -- This subtransaction is the atomic boundary. The exception handler persists
 -- only safe retry metadata after all snapshot/freeze/audit writes roll back.
 begin
  update private.election_electorate_finalizations set state='processing',processing_xid=pg_current_xact_id()
   where election_id=p_id;
  if not exists(select 1 from public.academic_terms where id=e.academic_term_id and status='active')
   or (select count(*) from public.academic_terms where status='active')<>1 then
   raise exception using errcode='P1002',message='TERM_UNAVAILABLE';
  end if;
  insert into private.election_eligible_voters(election_id,student_id)
   select e.id,s.id from public.students s where private.kandid_student_matches_optional_eligibility(e.id,s.id);
  get diagnostics eligible=row_count;
  if eligible=0 then raise exception using errcode='P1001',message='NO_ELIGIBLE_MEMBERS';end if;
  if clock_timestamp()>=(e.start_date at time zone 'Asia/Manila') then
   raise exception using errcode='P1003',message='MISSED_START';end if;
  update public.elections set electorate_frozen_at=clock_timestamp(),electorate_frozen_by=q.requested_by
   where id=p_id returning electorate_frozen_at into frozen;
  select full_name into board_name from public.admin_users where id=q.requested_by;
  insert into public.audit_logs(user_id,actor_name,actor_role,action,event_type,event_category,
   entity_type,entity_id,entity_label,organization_id,organization_name,election_id,status,event_origin,metadata)
  values(q.requested_by,board_name,'electoral_board','election_electorate_locked','election_electorate_locked','elections',
   'election',e.id::text,e.title,e.organization_id,(select name from public.organizations where id=e.organization_id),
   e.id,'completed','trusted_database',jsonb_build_object('eligible_count',eligible,'academic_term_id',e.academic_term_id,
   'policy_version',1,'execution','scheduled_database','request_generation',q.generation,'scheduled_at',q.due_at,
   'eligibility_mode',case when exists(select 1 from public.eligibility_rules where election_id=e.id)
     then 'membership_plus_rules' else 'membership_only' end));
  update private.election_electorate_finalizations set state='finalized',processing_xid=null,completed_at=frozen,
   last_attempt_at=clock_timestamp(),attempts=attempts+1,reason_code=null where election_id=p_id;
  return jsonb_build_object('election_id',p_id,'is_locked',true,'locked_at',frozen,'eligible_voters',eligible);
 exception when others then
  reason:=case sqlstate when 'P1001' then 'NO_ELIGIBLE_MEMBERS' when 'P1002' then 'TERM_UNAVAILABLE'
   when 'P1003' then 'MISSED_START' else 'FINALIZATION_FAILED' end;
  update private.election_electorate_finalizations set state=case when reason='MISSED_START' then 'missed' else 'retrying' end,
   processing_xid=null,reason_code=reason,attempts=attempts+1,last_attempt_at=clock_timestamp(),
   next_attempt_at=date_trunc('minute',clock_timestamp())+interval '1 minute' where election_id=p_id;
  return jsonb_build_object('election_id',p_id,'is_locked',false,'reason_code',reason);
 end;
end;
$function$;
revoke all on function private.kandid_attempt_electorate(integer) from public,anon,authenticated,service_role;

create function private.kandid_process_due_electorates()
returns jsonb language plpgsql set search_path=pg_catalog as $function$
declare item record;n integer:=0;
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='Trusted database execution required.';end if;
 if not private.kandid_electorate_job_enabled() then
  raise exception using errcode='55000',message='The reviewed electorate dispatcher job is not enabled.';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('kandid-electorate-dispatch-v1',0)) then
  return jsonb_build_object('processed',0,'busy',true);end if;
 for item in select e.id from public.elections e join private.election_electorate_finalizations q on q.election_id=e.id
  where q.state in('scheduled','retrying') and q.next_attempt_at<=clock_timestamp()
  order by e.id limit 50 for update of e skip locked loop
  perform private.kandid_attempt_electorate(item.id);n:=n+1;
 end loop;
 insert into private.electorate_scheduler_health values(1,clock_timestamp())
  on conflict(id) do update set last_success_at=excluded.last_success_at;
 return jsonb_build_object('processed',n,'busy',false);
end;
$function$;
revoke all on function private.kandid_process_due_electorates() from public,anon,authenticated,service_role;

create function private.kandid_queue_electorate_after_save()
returns trigger language plpgsql security definer set search_path=pg_catalog as $function$
declare board_id bigint;board_uid uuid:=auth.uid();assignment_count integer;
 q private.election_electorate_finalizations%rowtype;due timestamptz;
begin
 if new.electorate_policy_version<>1 or new.electorate_frozen_at is not null then return new;end if;
 select * into q from private.election_electorate_finalizations where election_id=new.id;
 if new.status<>'active' or new.removed_at is not null then
  update private.election_electorate_finalizations set state='cancelled',processing_xid=null,reason_code='ELECTION_UNAVAILABLE'
   where election_id=new.id and state<>'finalized';return new;
 end if;
 if tg_op='UPDATE' and q.election_id is not null then
  if (new.status,new.organization_id,new.academic_term_id,new.start_date,new.end_date,new.removed_at)
   is not distinct from (old.status,old.organization_id,old.academic_term_id,old.start_date,old.end_date,old.removed_at)
   then return new;end if;
 end if;
 if not private.kandid_electorate_scheduler_ready() then
  raise exception using errcode='55000',message='Automatic electorate finalization is unavailable. Activation or schedule changes were not saved.';end if;
 select count(*)::integer,min(id) into assignment_count,board_id from public.admin_users
  where auth_user_id=board_uid and role='electoral_board' and status='active' and organization_id=new.organization_id;
 if board_uid is null or assignment_count<>1 then
  raise exception using errcode='42501',message='An active organization Electoral Board must authorize scheduled finalization.';end if;
 if new.academic_term_id is null or not exists(select 1 from public.academic_terms where id=new.academic_term_id and status='active')
  or (select count(*) from public.academic_terms where status='active')<>1 then
  raise exception using errcode='22023',message='The election must use the single active academic term.';end if;
 if new.start_date is null or new.end_date is null or new.start_date>=new.end_date
  or (new.start_date at time zone 'Asia/Manila')<clock_timestamp()+interval '2 minutes' then
  raise exception using errcode='22023',message='Choose a valid voting window starting at least two minutes in the future.';end if;
 if exists(select 1 from private.election_eligible_voters where election_id=new.id)
  or exists(select 1 from public.vote_ballots where election_id=new.id)
  or exists(select 1 from public.votes where election_id=new.id) then
  raise exception using errcode='55000',message='Existing electorate or voting history requires administrator review.';end if;
 due:=(new.start_date at time zone 'Asia/Manila')-interval '10 minutes';
 insert into private.election_electorate_finalizations(election_id,requested_by,requested_uid,revision,
  organization_id,academic_term_id,voting_start,voting_end,due_at,next_attempt_at,state)
 values(new.id,board_id,board_uid,private.kandid_electorate_revision(new.id),new.organization_id,new.academic_term_id,
  new.start_date,new.end_date,due,greatest(due,clock_timestamp()),'scheduled')
 on conflict(election_id) do update set requested_by=excluded.requested_by,requested_uid=excluded.requested_uid,
  requested_at=clock_timestamp(),revision=excluded.revision,generation=private.election_electorate_finalizations.generation+1,
  organization_id=excluded.organization_id,academic_term_id=excluded.academic_term_id,
  voting_start=excluded.voting_start,voting_end=excluded.voting_end,due_at=excluded.due_at,next_attempt_at=excluded.next_attempt_at,
  state='scheduled',attempts=0,last_attempt_at=null,reason_code=null,completed_at=null,processing_xid=null;
 return new;
end;
$function$;
revoke all on function private.kandid_queue_electorate_after_save() from public,anon,authenticated,service_role;
create trigger elections_schedule_electorate after insert or update on public.elections
 for each row execute function private.kandid_queue_electorate_after_save();

create function private.kandid_guard_optional_election_rules()
returns trigger language plpgsql security definer set search_path=pg_catalog as $function$
declare target_id integer;e public.elections%rowtype;
begin
 if tg_op='DELETE' then target_id:=old.election_id;else target_id:=new.election_id;end if;
 if tg_op='UPDATE' and new.election_id is distinct from old.election_id then
  raise exception using errcode='42501',message='Eligibility rules cannot be moved to another election.';end if;
 select * into e from public.elections where id=target_id for update;
 if not found or e.removed_at is not null then raise exception using errcode='42501',message='Election is unavailable.';end if;
 if e.electorate_policy_version=1 and (e.electorate_frozen_at is not null
  or exists(select 1 from private.election_eligible_voters where election_id=target_id)
  or exists(select 1 from public.vote_ballots where election_id=target_id)
  or exists(select 1 from public.votes where election_id=target_id)) then
  raise exception using errcode='42501',message='Eligibility rules are locked for this election.';end if;
 if tg_op='DELETE' then return old;end if;return new;
end;
$function$;
revoke all on function private.kandid_guard_optional_election_rules() from public,anon,authenticated,service_role;
create trigger eligibility_rules_guard_optional_electorate before insert or update or delete on public.eligibility_rules
 for each row execute function private.kandid_guard_optional_election_rules();
create function private.kandid_refresh_electorate_request_rules()
returns trigger language plpgsql security definer set search_path=pg_catalog as $function$
declare target_id integer;board_id bigint;assignment_count integer;
begin
 if tg_op='DELETE' then target_id:=old.election_id;else target_id:=new.election_id;end if;
 if exists(select 1 from private.election_electorate_finalizations q join public.elections e on e.id=q.election_id
  where q.election_id=target_id and e.electorate_frozen_at is null and e.status='active' and e.removed_at is null) then
  select count(*)::integer,min(a.id) into assignment_count,board_id from public.admin_users a
   join public.elections e on e.organization_id=a.organization_id where e.id=target_id
    and a.auth_user_id=auth.uid() and a.role='electoral_board' and a.status='active';
  if assignment_count<>1 then raise exception using errcode='42501',message='An active Electoral Board must authorize these pending election restrictions.';end if;
  update private.election_electorate_finalizations set requested_by=board_id,requested_uid=auth.uid(),requested_at=clock_timestamp(),
   revision=private.kandid_electorate_revision(target_id),generation=generation+1,state='scheduled',processing_xid=null,
   reason_code=null,attempts=0,next_attempt_at=greatest(due_at,clock_timestamp()) where election_id=target_id;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end;
$function$;
revoke all on function private.kandid_refresh_electorate_request_rules() from public,anon,authenticated,service_role;
create trigger eligibility_rules_refresh_electorate_request after insert or update or delete on public.eligibility_rules
 for each row execute function private.kandid_refresh_electorate_request_rules();

create function private.kandid_student_matches_optional_eligibility(
  p_election_id integer,p_student_id integer
)
returns boolean language sql stable set search_path=pg_catalog
as $function$
 select exists (
  select 1
  from public.elections e
  join public.academic_terms t on t.id=e.academic_term_id and t.status='active'
  join public.students s on s.id=p_student_id and s.status='active'
    and s.auth_user_id is not null
  join public.student_term_enrollments ste on ste.student_id=s.id
    and ste.academic_term_id=e.academic_term_id and ste.enrollment_status='enrolled'
  cross join lateral public.resolve_student_organization_participation(
    s.id,e.organization_id,e.academic_term_id
  ) participation
  where e.id=p_election_id and e.removed_at is null
    and (select count(*) from public.academic_terms where status='active')=1
    and participation.allowed is true
    and (
      not exists (select 1 from public.eligibility_rules r where r.election_id=e.id)
      or exists (
        select 1 from public.eligibility_rules r where r.election_id=e.id
          and (r.program is null or upper(btrim(ste.program))=upper(btrim(r.program)))
          and (
            (ste.is_shs is true and r.allow_shs is true)
            or (ste.is_shs is false and ste.year_level between 1 and 6
              and (r.min_year_level is null or ste.year_level>=r.min_year_level)
              and (r.max_year_level is null or ste.year_level<=r.max_year_level))
          )
      )
    )
 );
$function$;
alter function private.kandid_student_matches_optional_eligibility(integer,integer) owner to postgres;
revoke all on function private.kandid_student_matches_optional_eligibility(integer,integer)
 from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.kandid_guard_frozen_electorate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
    if not exists (
      select 1 from private.election_electorate_finalizations q
      join public.admin_users a on a.id=q.requested_by
      where q.election_id=new.id and q.state='processing'
       and q.processing_xid=pg_current_xact_id() and q.requested_by=new.electorate_frozen_by
       and q.revision=private.kandid_electorate_revision(new.id)
       and (q.organization_id,q.academic_term_id,q.voting_start,q.voting_end)
        is not distinct from (new.organization_id,new.academic_term_id,new.start_date,new.end_date)
       and a.auth_user_id=q.requested_uid and a.role='electoral_board' and a.status='active'
       and a.organization_id=new.organization_id
    ) then
      raise exception using errcode = '42501', message = 'Electorate lock must use the trusted scheduled finalization operation.';
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
  if not coalesce(participation_allowed,false) or (election_row.electorate_policy_version=1 and not private.kandid_student_matches_optional_eligibility(p_election_id,student_id_value)) then
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
      and e.status='active' and e.removed_at is null
      and timezone('Asia/Manila',clock_timestamp())>=e.start_date
      and timezone('Asia/Manila',clock_timestamp())<e.end_date
      and private.kandid_student_matches_optional_eligibility(p_election_id,p_student_id)
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
  select e.* into election_row from public.elections e where e.id = new.election_id for share;
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
  if election_row.status<>'active' or election_row.removed_at is not null
    or not private.kandid_student_matches_optional_eligibility(new.election_id,new.student_id)
    or timezone('Asia/Manila',clock_timestamp())<election_row.start_date
    or timezone('Asia/Manila',clock_timestamp())>=election_row.end_date then
    raise exception using errcode='42501',message='Student is not eligible for this election.';
  end if;
  return new;
end;
$function$;

create or replace function public.kandid_get_board_electorate_preview(p_election_id integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $function$
declare e public.elections%rowtype;t public.academic_terms%rowtype;
 q private.election_electorate_finalizations%rowtype;board_id bigint;assignments integer;
 eligible bigint:=0;rules bigint;ready boolean;reason text;state_value text;retry_allowed boolean:=false;editable boolean;
begin
 if auth.uid() is null then raise exception using errcode='28000',message='Authentication required.';end if;
 select count(*)::integer,min(id) into assignments,board_id from public.admin_users
  where auth_user_id=auth.uid() and role='electoral_board' and status='active';
 if assignments<>1 then raise exception using errcode='42501',message='One active Electoral Board assignment is required.';end if;
 select x.* into e from public.elections x join public.admin_users a on a.organization_id=x.organization_id
  where x.id=p_election_id and a.id=board_id;
 if not found then raise exception using errcode='42501',message='Election is unavailable.';end if;
 select * into t from public.academic_terms where id=e.academic_term_id;
 select * into q from private.election_electorate_finalizations where election_id=e.id;
 select count(*) into rules from public.eligibility_rules where election_id=e.id;
 ready:=private.kandid_electorate_scheduler_ready();
 if e.electorate_frozen_at is not null then
  select count(*) into eligible from private.election_eligible_voters where election_id=e.id;
 else
  select count(*) into eligible from public.students s where private.kandid_student_matches_optional_eligibility(e.id,s.id);
 end if;
 editable:=e.electorate_policy_version=1 and e.electorate_frozen_at is null and e.removed_at is null
  and not exists(select 1 from private.election_eligible_voters where election_id=e.id)
  and not exists(select 1 from public.vote_ballots where election_id=e.id)
  and not exists(select 1 from public.votes where election_id=e.id);
 state_value:=coalesce(q.state,'unscheduled');
 if e.electorate_policy_version<>1 then reason:='This election uses the legacy compatibility policy.';state_value:='legacy';
 elsif e.electorate_frozen_at is not null then state_value:='finalized';
 elsif e.removed_at is not null or e.status in('closed','done','archived') then reason:='This election is unavailable for finalization.';state_value:='cancelled';
 elsif e.status<>'active' then reason:='Activate this election to schedule automatic electorate finalization.';state_value:='draft';
 elsif e.start_date is null or e.end_date is null or e.start_date>=e.end_date then reason:='Set a valid voting window before activation.';state_value:='blocked';
 elsif clock_timestamp()>=(e.start_date at time zone 'Asia/Manila') then
  reason:='The electorate was not finalized before voting start. Voting is blocked. Choose an authorized future voting window.';state_value:='missed';
 elsif q.election_id is null then reason:='Save this active election with a future voting window to schedule finalization.';
 elsif not ready then reason:='Automatic electorate finalization is unavailable. Voting remains blocked.';
 elsif q.reason_code='NO_ELIGIBLE_MEMBERS' then reason:='No eligible organization members are enrolled for this term yet. Retrying before voting starts.';
 elsif q.reason_code='TERM_UNAVAILABLE' then reason:='The election academic term is unavailable. Retrying before voting starts.';
 elsif q.reason_code='AUTHORIZATION_REVOKED' then reason:='The authorizing Board assignment changed. The current Board may reauthorize a due retry.';
 elsif q.reason_code='HISTORY_REVIEW_REQUIRED' then reason:='Existing electorate or voting history requires administrator review.';
 elsif q.reason_code='STALE_REQUEST' then reason:='The saved finalization request no longer matches this election. Refresh its configuration.';
 elsif q.reason_code='FINALIZATION_FAILED' then reason:='Electorate finalization failed. Kandid will retry before voting starts.';
 elsif eligible=0 then reason:='No eligible organization members are enrolled for this term yet. The electorate is not finalized.';
 end if;
 retry_allowed:=e.electorate_policy_version=1 and e.electorate_frozen_at is null and e.status='active'
  and e.removed_at is null and ready and eligible>0 and q.election_id is not null
  and (q.state in('scheduled','retrying') or q.reason_code='AUTHORIZATION_REVOKED')
  and clock_timestamp()>=q.due_at and clock_timestamp()>=q.next_attempt_at
  and clock_timestamp()<(e.start_date at time zone 'Asia/Manila');
 return jsonb_build_object('election_id',e.id,'election_title',e.title,'academic_term_id',e.academic_term_id,
  'semester',t.semester,'academic_year',t.academic_year,'scheduled_voting_start',e.start_date,'scheduled_voting_end',e.end_date,
  'eligible_voters',eligible,'is_locked',e.electorate_frozen_at is not null,'locked_at',e.electorate_frozen_at,
  'policy_version',e.electorate_policy_version,'eligibility_contract',case when e.electorate_policy_version=1 then 'membership-optional-rules-v1' else null end,
  'rule_count',rules,'eligibility_mode',case when rules=0 then 'membership_only' else 'membership_plus_rules' end,
  'automatic_finalization',true,'finalization_state',state_value,'scheduled_finalization_at',q.due_at,
  'next_attempt_at',q.next_attempt_at,'last_attempt_at',q.last_attempt_at,'attempts',coalesce(q.attempts,0),
  'reason_code',q.reason_code,'scheduler_ready',ready,'rules_editable',editable,'locking_allowed',coalesce(retry_allowed,false),
  'blocking_reason',reason);
end;
$function$;

-- Existing public signature retained as an authenticated, due-time retry only.
-- Normal activation creates the queue request automatically; this RPC cannot
-- force an early freeze, create a snapshot on ballot access or forge an actor.
create or replace function public.kandid_lock_board_electorate(p_election_id integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare e public.elections%rowtype;q private.election_electorate_finalizations%rowtype;
 assignments integer;board_id bigint;
begin
 if auth.uid() is null then raise exception using errcode='28000',message='Authentication required.';end if;
 select count(*)::integer,min(id) into assignments,board_id from public.admin_users
  where auth_user_id=auth.uid() and role='electoral_board' and status='active';
 if assignments<>1 then raise exception using errcode='42501',message='One active Electoral Board assignment is required.';end if;
 select x.* into e from public.elections x join public.admin_users a on a.organization_id=x.organization_id
  where x.id=p_election_id and a.id=board_id for update of x;
 if not found then raise exception using errcode='42501',message='Election is unavailable.';end if;
 if e.electorate_frozen_at is not null then
  return jsonb_build_object('election_id',e.id,'is_locked',true,'locked_at',e.electorate_frozen_at,
   'eligible_voters',(select count(*) from private.election_eligible_voters where election_id=e.id));end if;
 if not private.kandid_electorate_scheduler_ready() then
  raise exception using errcode='55000',message='Automatic electorate finalization is unavailable.';end if;
 select * into q from private.election_electorate_finalizations where election_id=e.id for update;
 if q.reason_code='AUTHORIZATION_REVOKED' and clock_timestamp()>=q.due_at
  and clock_timestamp()<(e.start_date at time zone 'Asia/Manila') then
  update private.election_electorate_finalizations set requested_by=board_id,requested_uid=auth.uid(),
   requested_at=clock_timestamp(),generation=generation+1,state='retrying',reason_code=null,next_attempt_at=clock_timestamp()
   where election_id=e.id;
 end if;
 return private.kandid_attempt_electorate(e.id);
end;
$function$;

-- Preserve existing RPC owners and authenticated/server-only ACLs; do not
-- broaden a service-only path or expose a private function through PUBLIC.
create function public.kandid_get_board_electorate_scheduler_readiness()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $function$
declare assignments integer;organization_value integer;
begin
 if auth.uid() is null then raise exception using errcode='28000',message='Authentication required.';end if;
 select count(*)::integer,min(organization_id) into assignments,organization_value from public.admin_users
  where auth_user_id=auth.uid() and role='electoral_board' and status='active';
 if assignments<>1 or organization_value is null then
  raise exception using errcode='42501',message='One active Electoral Board organization assignment is required.';end if;
 return jsonb_build_object('eligibility_contract','membership-optional-rules-v1',
  'organization_id',organization_value,'scheduler_ready',private.kandid_electorate_scheduler_ready(),
  'server_time',clock_timestamp(),'lead_minutes',10);
end;
$function$;
revoke all on function public.kandid_get_board_electorate_scheduler_readiness() from public,anon,authenticated,service_role;
grant execute on function public.kandid_get_board_electorate_scheduler_readiness() to authenticated;

do $postflight$
declare signature text;
begin
 foreach signature in array array['public.kandid_get_board_electorate_preview(integer)',
  'public.kandid_get_student_ballot_candidates(integer)','public.kandid_lock_board_electorate(integer)',
  'public.kandid_get_board_electorate_scheduler_readiness()'] loop
  if not has_function_privilege('authenticated',signature,'EXECUTE')
   or has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('service_role',signature,'EXECUTE') then
   raise exception 'Authenticated electorate RPC ACL drift: %',signature;end if;
 end loop;
 if not has_function_privilege('service_role','public.kandid_is_locked_electorate_member(integer,integer)','EXECUTE')
  or has_function_privilege('authenticated','public.kandid_is_locked_electorate_member(integer,integer)','EXECUTE')
  or has_function_privilege('anon','public.kandid_is_locked_electorate_member(integer,integer)','EXECUTE') then
  raise exception 'Server membership ACL drift.';end if;
end;
$postflight$;
notify pgrst,'reload schema';
commit;
