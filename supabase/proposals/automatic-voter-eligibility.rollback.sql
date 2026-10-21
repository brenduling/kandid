-- Restore the captured frozen-policy contracts. Stop new submissions first.
begin;
set local lock_timeout='5s';
do $rollback_guard$ declare item record; begin
  for item in select * from (values ('public.insert_v2_vote_rows(integer,integer,jsonb)','06c1a917a670d36d223073964329470f'),('public.kandid_get_student_ballot_candidates(integer)','93972621573d22af7910a72fbdd1cd39'),('private.kandid_require_locked_electorate_for_ballot()','6226c2238878c80e4ae52080b4937dd1'),('public.kandid_get_board_electorate_preview(integer)','a578006537d266bb99d96eeb6f078776'),('private.kandid_student_is_live_eligible(integer,integer)','c122407d1063ead1dbad5692d05fed5a'),('private.kandid_voting_is_open(integer)','a9432954240ebb9eabfbc4e898fe93a5'),('public.kandid_check_student_ballot_eligibility(integer)','82bdc5aed7e509fc5a73111c8e0aa67b'),('private.kandid_guard_live_eligibility_rules()','015761edd08e04a8e6ecf2cf4ee0747e')) expected(signature,digest) loop
    if to_regprocedure(item.signature) is null or
      (select md5(prosrc) from pg_proc where oid=to_regprocedure(item.signature)) is distinct from item.digest then
      raise exception 'Installed automatic-eligibility source differs: %. Stop rollback.',item.signature;
    end if;
  end loop;
end $rollback_guard$;
drop trigger eligibility_rules_serialize_live_voting on public.eligibility_rules;
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
  if not coalesce(participation_allowed,false) then
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
$function$
;
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
  return new;
end;
$function$
;
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
$function$
;
drop function private.kandid_guard_live_eligibility_rules();
drop function public.kandid_check_student_ballot_eligibility(integer);
drop function private.kandid_voting_is_open(integer);
drop function private.kandid_student_is_live_eligible(integer,integer);
notify pgrst,'reload schema';
commit;
