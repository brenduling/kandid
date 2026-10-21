-- REVIEW PROPOSAL ONLY. No election, student, snapshot, vote, or receipt rows are changed.
begin;
set local lock_timeout='5s';
do $guard$ declare item record; begin
  for item in select * from (values ('public.insert_v2_vote_rows(integer,integer,jsonb)','6b99f18237fbe72cc96cf63c9f1cc8af'),('public.kandid_get_student_ballot_candidates(integer)','f61151200968d5c3601eebb29d61b18b'),('private.kandid_require_locked_electorate_for_ballot()','471f6b34836dd2d6fb4bb10bc5e99868'),('public.kandid_get_board_electorate_preview(integer)','c551f3def42e6326d291a48c42854a1d'),('public.resolve_student_organization_participation(integer,integer,integer)','9fa37fb5446954fa855bce11a63f2aa7')) expected(signature,digest) loop
    if to_regprocedure(item.signature) is null or
      md5(pg_get_functiondef(to_regprocedure(item.signature))) is distinct from item.digest or
      (select pg_get_userbyid(proowner) from pg_proc where oid=to_regprocedure(item.signature)) is distinct from 'postgres' then
      raise exception 'Reviewed function baseline differs: %. Stop.',item.signature;
    end if;
  end loop;
  if to_regprocedure('private.kandid_student_is_live_eligible(integer,integer)') is not null or
    to_regprocedure('private.kandid_voting_is_open(integer)') is not null or
    to_regprocedure('public.kandid_check_student_ballot_eligibility(integer)') is not null or
    to_regprocedure('private.kandid_guard_live_eligibility_rules()') is not null then
    raise exception 'Automatic eligibility already exists; inspect before installation.';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.vote_ballots'::regclass
    and tgname='vote_ballots_require_locked_electorate' and tgenabled in ('O','A')
    and tgfoid='private.kandid_require_locked_electorate_for_ballot()'::regprocedure) then
    raise exception 'Expected ballot trigger is absent or disabled.';
  end if;
  if has_function_privilege('authenticated','public.insert_v2_vote_rows(integer,integer,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.insert_v2_vote_rows(integer,integer,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.insert_v2_vote_rows(integer,integer,jsonb)','EXECUTE') then
    raise exception 'Atomic insertion privilege baseline differs.';
  end if;
end $guard$;
-- LOCAL REVIEW PROPOSAL. Applied only by the guarded forward file after approval.
-- Existing snapshots and their mutation guards remain untouched.
create function private.kandid_student_is_live_eligible(p_election_id integer, p_student_id integer)
returns boolean language sql stable security definer set search_path=pg_catalog
as $function$
  select exists (
    select 1 from public.elections e
    join public.academic_terms t on t.id=e.academic_term_id and t.status='active'
    join public.students s on s.id=p_student_id and s.status='active' and s.auth_user_id is not null
    join auth.users u on u.id=s.auth_user_id and u.email_confirmed_at is not null
      and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=pg_catalog.statement_timestamp())
    join public.student_term_enrollments ste on ste.student_id=s.id
      and ste.academic_term_id=e.academic_term_id and ste.enrollment_status='enrolled'
    cross join lateral public.resolve_student_organization_participation(s.id,e.organization_id,e.academic_term_id) membership
    where e.id=p_election_id and e.removed_at is null
      and (select count(*) from public.students other where other.auth_user_id=s.auth_user_id)=1
      and (select count(*) from public.academic_terms where status='active')=1
      and membership.allowed is true and membership.status='active'
      and (not exists (select 1 from public.eligibility_rules r where r.election_id=e.id)
        or exists (
          select 1 from public.eligibility_rules r where r.election_id=e.id
            and (r.program is null or upper(btrim(ste.program))=upper(btrim(r.program)))
            and ((ste.is_shs is true and r.allow_shs is true)
              or (ste.is_shs is false and ste.year_level between 1 and 6
                and (r.min_year_level is null or ste.year_level>=r.min_year_level)
                and (r.max_year_level is null or ste.year_level<=r.max_year_level)))
        ))
  );
$function$;
alter function private.kandid_student_is_live_eligible(integer,integer) owner to postgres;
revoke all on function private.kandid_student_is_live_eligible(integer,integer) from public,anon,authenticated,service_role;

-- Clock-time check is separate from membership so previews can count future voters.
create function private.kandid_voting_is_open(p_election_id integer)
returns boolean language sql volatile security definer set search_path=pg_catalog
as $function$
  select exists (select 1 from public.elections e where e.id=p_election_id
    and e.status='active' and e.removed_at is null
    and e.start_date is not null and e.end_date>e.start_date
    and pg_catalog.timezone('Asia/Manila',pg_catalog.clock_timestamp())>=e.start_date
    and pg_catalog.timezone('Asia/Manila',pg_catalog.clock_timestamp())<e.end_date
    and ((e.campaign_start is null and e.campaign_end is null)
      or (e.campaign_start is not null and e.campaign_end is not null
        and e.campaign_start<e.campaign_end and e.campaign_end<=e.start_date
        and pg_catalog.timezone('Asia/Manila',pg_catalog.clock_timestamp())>=e.campaign_end)));
$function$;
alter function private.kandid_voting_is_open(integer) owner to postgres;
revoke all on function private.kandid_voting_is_open(integer) from public,anon,authenticated,service_role;

-- Only the caller's identity is admitted; no client student/organization argument.
create function public.kandid_check_student_ballot_eligibility(p_election_id integer)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog
as $function$
declare student_value integer; student_count integer;
begin
  if auth.uid() is null then raise exception using errcode='28000',message='Student authentication is required.'; end if;
  select count(*)::integer,min(id) into student_count,student_value
    from public.students where auth_user_id=auth.uid();
  return student_count=1 and private.kandid_voting_is_open(p_election_id)
    and private.kandid_student_is_live_eligible(p_election_id,student_value);
end;
$function$;
alter function public.kandid_check_student_ballot_eligibility(integer) owner to postgres;
revoke all on function public.kandid_check_student_ballot_eligibility(integer) from public,anon,authenticated,service_role;
grant execute on function public.kandid_check_student_ballot_eligibility(integer) to authenticated;

-- Keep the installed trigger attachment/name; replace its frozen-roster decision
-- with the same live predicate. Direct browser inserts remain forbidden by grants.
create or replace function private.kandid_require_locked_electorate_for_ballot()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $function$
begin
  if not private.kandid_voting_is_open(new.election_id)
    or not private.kandid_student_is_live_eligible(new.election_id,new.student_id) then
    raise exception using errcode='42501',message='Student is not eligible to vote in this election now.';
  end if;
  return new;
end;
$function$;
alter function private.kandid_require_locked_electorate_for_ballot() owner to postgres;
revoke all on function private.kandid_require_locked_electorate_for_ballot() from public,anon,authenticated,service_role;

-- Serialize optional-rule inserts/edits with atomic submission's election lock.
-- Existing frozen snapshots and elections with recorded votes retain their rules.
create function private.kandid_guard_live_eligibility_rules()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $function$
declare election_value integer;
begin
  if tg_op='UPDATE' and new.election_id is distinct from old.election_id then
    raise exception using errcode='42501',message='Eligibility rules cannot be moved between elections.';
  end if;
  if tg_op='DELETE' then election_value:=old.election_id; else election_value:=new.election_id; end if;
  perform 1 from public.elections where id=election_value for update;
  if exists(select 1 from public.elections where id=election_value and electorate_frozen_at is not null)
    or exists(select 1 from public.vote_ballots where election_id=election_value)
    or exists(select 1 from public.votes where election_id=election_value) then
    raise exception using errcode='42501',message='Eligibility rules are immutable after freezing or a recorded vote.';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;
alter function private.kandid_guard_live_eligibility_rules() owner to postgres;
revoke all on function private.kandid_guard_live_eligibility_rules() from public,anon,authenticated,service_role;
create trigger eligibility_rules_serialize_live_voting before insert or update or delete on public.eligibility_rules
for each row execute function private.kandid_guard_live_eligibility_rules();

CREATE OR REPLACE FUNCTION public.insert_v2_vote_rows(p_student_id integer, p_election_id integer, p_votes jsonb)
 RETURNS TABLE(vote_id integer, vote_hash text, canonical_vote_timestamp text, ballot_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_item jsonb;

  v_ballot_id uuid;
  v_ballot_nonce text;
  v_ballot_payload text;
  v_ballot_hash text;
  v_ordered_row_hashes text;
  v_row_count integer;

  v_vote_id integer;
  v_position_id integer;
  v_candidate_id integer;
  v_is_abstain boolean;

  v_submitted_at timestamptz;
  v_canonical_timestamp text;
  v_nonce text;
  v_canonical_payload text;
  v_vote_hash text;
begin
  ---------------------------------------------------------------------------
  -- Basic trusted-server input validation
  ---------------------------------------------------------------------------

  if p_student_id is null then
    raise exception 'student_id is required';
  end if;

  if p_election_id is null then
    raise exception 'election_id is required';
  end if;

  if p_votes is null
     or jsonb_typeof(p_votes) <> 'array'
     or jsonb_array_length(p_votes) = 0 then
    raise exception 'votes must be a non-empty JSON array';
  end if;

  ---------------------------------------------------------------------------
  -- Serialize submissions for this exact student/election pair.
  ---------------------------------------------------------------------------

  perform pg_catalog.pg_advisory_xact_lock(
    p_student_id,
    p_election_id
  );

  -- Lock authoritative inputs until commit; membership revocations and schedule
  -- changes serialize with this transaction. Service-only invocation is unchanged.
  perform 1 from public.elections where id=p_election_id for share;
  perform 1 from public.students where id=p_student_id for share;
  perform 1 from auth.users where id=(select auth_user_id from public.students where id=p_student_id) for share;
  perform 1 from public.academic_terms where status='active' for share;
  perform 1 from public.organizations where id=(select organization_id from public.elections where id=p_election_id) for share;
  perform 1 from public.student_term_enrollments where student_id=p_student_id
    and academic_term_id=(select academic_term_id from public.elections where id=p_election_id) for share;
  perform 1 from public.student_organization_terms where student_id=p_student_id
    and academic_term_id=(select academic_term_id from public.elections where id=p_election_id)
    and organization_id=(select organization_id from public.elections where id=p_election_id) for share;
  if not private.kandid_voting_is_open(p_election_id)
    or not private.kandid_student_is_live_eligible(p_election_id,p_student_id) then
    raise exception using errcode='42501',message='Student is not eligible to vote in this election now.';
  end if;
  perform 1 from public.positions where election_id=p_election_id for share;
  perform 1 from public.candidates where position_id in
    (select id from public.positions where election_id=p_election_id) for share;
  -- Recheck active ballot shape inside the same atomic hashing/insertion RPC.
  if exists(select 1 from jsonb_array_elements(p_votes) v where
      jsonb_typeof(v->'position_id') is distinct from 'number' or
      jsonb_typeof(v->'is_abstain') is distinct from 'boolean') then
    raise exception using errcode='22023',message='Invalid ballot shape.';
  end if;
  if not exists(select 1 from public.positions where election_id=p_election_id and status='active')
    or exists(select 1 from jsonb_array_elements(p_votes) v where not exists (
      select 1 from public.positions p where p.id=(v->>'position_id')::integer
        and p.election_id=p_election_id and p.status='active'))
    or exists(select 1 from public.positions p where p.election_id=p_election_id and p.status='active'
      and not exists(select 1 from jsonb_array_elements(p_votes) v where (v->>'position_id')::integer=p.id)) then
    raise exception using errcode='22023',message='Ballot must cover exactly the active election positions.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_votes) v where
    ((v->>'is_abstain')::boolean and v->>'candidate_id' is not null) or
    (not (v->>'is_abstain')::boolean and not exists(select 1 from public.candidates c
      where c.id=(v->>'candidate_id')::integer and c.position_id=(v->>'position_id')::integer))) then
    raise exception using errcode='22023',message='Invalid candidate or abstention.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_votes) v
    join public.positions p on p.id=(v->>'position_id')::integer group by p.id,p.max_votes
    having (count(*) filter(where (v->>'is_abstain')::boolean)>0 and count(*)>1)
      or count(*)>greatest(1,p.max_votes)
      or count(v->>'candidate_id')<>count(distinct v->>'candidate_id')) then
    raise exception using errcode='22023',message='Duplicate or excessive ballot selections.';
  end if;

  ---------------------------------------------------------------------------
  -- Authoritative duplicate-ballot guard remains the existing votes check.
  ---------------------------------------------------------------------------

  if exists (
    select 1
    from public.votes
    where student_id = p_student_id
      and election_id = p_election_id
  ) then
    raise exception 'This student has already voted in this election.';
  end if;

  ---------------------------------------------------------------------------
  -- One canonical timestamp and one private ballot nonce for the ballot.
  ---------------------------------------------------------------------------

  v_submitted_at := clock_timestamp();

  v_canonical_timestamp :=
    to_char(
      v_submitted_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );

  v_ballot_nonce :=
    encode(
      extensions.gen_random_bytes(32),
      'hex'
    );

  insert into public.vote_ballots (
    student_id,
    election_id,
    canonical_submitted_at,
    ballot_hash,
    hash_version,
    ballot_nonce,
    blockchain_anchor_status,
    blockchain_retry_count
  )
  values (
    p_student_id,
    p_election_id,
    v_canonical_timestamp,
    null,
    'KANDID_BALLOT_V1',
    v_ballot_nonce,
    'pending',
    0
  )
  returning id into v_ballot_id;

  ---------------------------------------------------------------------------
  -- Process each already-validated vote choice.
  ---------------------------------------------------------------------------

  for v_item in
    select value
    from jsonb_array_elements(p_votes)
  loop
    -------------------------------------------------------------------------
    -- Extract persisted vote fields
    -------------------------------------------------------------------------

    if not (v_item ? 'position_id') then
      raise exception 'position_id is required for every vote row';
    end if;

    if not (v_item ? 'is_abstain') then
      raise exception 'is_abstain is required for every vote row';
    end if;

    begin
      v_position_id := (v_item ->> 'position_id')::integer;
    exception
      when others then
        raise exception 'position_id must be an integer';
    end;

    begin
      v_is_abstain := (v_item ->> 'is_abstain')::boolean;
    exception
      when others then
        raise exception 'is_abstain must be a boolean';
    end;

    if v_position_id is null then
      raise exception 'position_id cannot be null';
    end if;

    if v_is_abstain is null then
      raise exception 'is_abstain cannot be null';
    end if;

    if v_item ? 'candidate_id'
       and v_item -> 'candidate_id' <> 'null'::jsonb then
      begin
        v_candidate_id := (v_item ->> 'candidate_id')::integer;
      exception
        when others then
          raise exception 'candidate_id must be an integer or null';
      end;
    else
      v_candidate_id := null;
    end if;

    -------------------------------------------------------------------------
    -- Preserve abstain/candidate invariant
    -------------------------------------------------------------------------

    if v_is_abstain and v_candidate_id is not null then
      raise exception 'abstain vote cannot contain candidate_id';
    end if;

    if not v_is_abstain and v_candidate_id is null then
      raise exception 'non-abstain vote requires candidate_id';
    end if;

    -------------------------------------------------------------------------
    -- Allocate persisted vote ID and generate private row nonce
    -------------------------------------------------------------------------

    v_vote_id := nextval('public.votes_id_seq'::regclass);

    v_nonce :=
      encode(
        extensions.gen_random_bytes(32),
        'hex'
      );

    -------------------------------------------------------------------------
    -- Frozen KANDID_VOTE_V2 canonical serialization
    -------------------------------------------------------------------------

    v_canonical_payload :=
        'KANDID_VOTE_V2'
      || '|vote_id:' || v_vote_id::text
      || '|election_id:' || p_election_id::text
      || '|position_id:' || v_position_id::text
      || '|candidate_id:'
      || case
           when v_candidate_id is null then 'null'
           else v_candidate_id::text
         end
      || '|abstain:'
      || case
           when v_is_abstain then '1'
           else '0'
         end
      || '|submitted_at:' || v_canonical_timestamp
      || '|nonce:' || v_nonce;

    v_vote_hash :=
      '0x'
      || encode(
           extensions.digest(
             convert_to(v_canonical_payload, 'UTF8'),
             'sha256'
           ),
           'hex'
         );

    -------------------------------------------------------------------------
    -- Insert the V2 integrity row, grouped under one ballot.
    --
    -- New ballot-level submissions keep row hashes for diagnostics, but rows
    -- are not individual blockchain jobs. The old worker only claims queueable
    -- row statuses, so 'ballot_grouped' prevents duplicate row anchoring.
    -------------------------------------------------------------------------

    insert into public.votes (
      id,
      student_id,
      election_id,
      position_id,
      candidate_id,
      is_abstain,
      vote_timestamp,
      vote_hash,
      blockchain_tx_id,
      hash_version,
      vote_nonce,
      canonical_vote_timestamp,
      blockchain_anchor_status,
      blockchain_network,
      blockchain_contract_address,
      blockchain_block_number,
      blockchain_anchored_at,
      blockchain_retry_count,
      blockchain_last_error,
      ballot_id
    )
    values (
      v_vote_id,
      p_student_id,
      p_election_id,
      v_position_id,
      v_candidate_id,
      v_is_abstain,
      v_submitted_at at time zone 'UTC',
      v_vote_hash,
      null,
      'KANDID_VOTE_V2',
      v_nonce,
      v_canonical_timestamp,
      'ballot_grouped',
      null,
      null,
      null,
      null,
      0,
      null,
      v_ballot_id
    );
  end loop;

  select
    count(*)::integer,
    string_agg(v.vote_hash, E'\n' order by
      p.display_order asc,
      v.position_id asc,
      case when v.is_abstain then 1 else 0 end asc,
      v.candidate_id asc nulls last,
      v.id asc
    )
  into
    v_row_count,
    v_ordered_row_hashes
  from public.votes v
  join public.positions p
    on p.id = v.position_id
   and p.election_id = v.election_id
  where v.ballot_id = v_ballot_id;

  if v_row_count is distinct from jsonb_array_length(p_votes)
     or v_ordered_row_hashes is null then
    raise exception 'Ballot row hash assembly failed.';
  end if;

  ---------------------------------------------------------------------------
  -- KANDID_BALLOT_V1 canonical ordering:
  -- position display_order, position_id, selection type (candidate before
  -- abstain), candidate_id with abstain/null last, then vote_id as final
  -- deterministic tie-breaker.
  ---------------------------------------------------------------------------

  v_ballot_payload :=
      'KANDID_BALLOT_V1'
    || '|ballot_id:' || v_ballot_id::text
    || '|election_id:' || p_election_id::text
    || '|submitted_at:' || v_canonical_timestamp
    || '|ballot_nonce:' || v_ballot_nonce
    || '|row_count:' || v_row_count::text
    || '|row_hashes:' || E'\n'
    || v_ordered_row_hashes;

  v_ballot_hash :=
    '0x'
    || encode(
         extensions.digest(
           convert_to(v_ballot_payload, 'UTF8'),
           'sha256'
         ),
         'hex'
       );

  update public.vote_ballots
  set
    ballot_hash = v_ballot_hash,
    hash_version = 'KANDID_BALLOT_V1',
    blockchain_anchor_status = 'pending'
  where id = v_ballot_id;

  return query
  select
    v.id,
    v.vote_hash,
    v.canonical_vote_timestamp,
    v.ballot_id
  from public.votes v
  join public.positions p
    on p.id = v.position_id
   and p.election_id = v.election_id
  where v.ballot_id = v_ballot_id
  order by
    p.display_order asc,
    v.position_id asc,
    case when v.is_abstain then 1 else 0 end asc,
    v.candidate_id asc nulls last,
    v.id asc;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.kandid_get_student_ballot_candidates(p_election_id integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
declare election_row record; candidate_data jsonb;
begin
  if auth.uid() is null or p_election_id is null or p_election_id<=0 then
    raise exception using errcode='28000',message='Eligible Student authentication is required.';
  end if;
  if not public.kandid_check_student_ballot_eligibility(p_election_id) then
    raise exception using errcode='42501',message='Ballot choices are unavailable.';
  end if;
  select e.id,e.organization_id into election_row from public.elections e where e.id=p_election_id;
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
$function$
;
CREATE OR REPLACE FUNCTION public.kandid_get_board_electorate_preview(p_election_id integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
declare board_admin public.admin_users%rowtype; election_row public.elections%rowtype; eligible_count bigint;
begin
  if auth.uid() is null then raise exception using errcode='28000',message='Authentication required.'; end if;
  if (select count(*) from public.admin_users where auth_user_id=auth.uid() and role='electoral_board' and status='active')<>1 then
    raise exception using errcode='42501',message='One active Electoral Board assignment is required.';
  end if;
  select * into board_admin from public.admin_users where auth_user_id=auth.uid() and role='electoral_board' and status='active';
  select * into election_row from public.elections where id=p_election_id and organization_id=board_admin.organization_id and removed_at is null;
  if not found then raise exception using errcode='42501',message='Election is unavailable.'; end if;
  select count(*) into eligible_count from public.students s where private.kandid_student_is_live_eligible(p_election_id,s.id);
  return jsonb_build_object('election_id',election_row.id,'eligible_voters',eligible_count,
    'eligibility_contract','automatic-membership-optional-rules-v1','lock_required',false,
    'rule_count',(select count(*) from public.eligibility_rules where election_id=p_election_id),
    'is_locked',election_row.electorate_frozen_at is not null,'locked_at',election_row.electorate_frozen_at,
    'policy_version',election_row.electorate_policy_version,'locking_allowed',false,
    'blocking_reason','Eligibility is checked automatically; no electorate lock is required.');
end;
$function$
;
revoke all on function public.kandid_get_board_electorate_preview(integer) from public,anon,authenticated,service_role;
grant execute on function public.kandid_get_board_electorate_preview(integer) to authenticated;
notify pgrst,'reload schema';
commit;
