-- Add atomic duplicate-ballot protection to KANDID V2 vote insertion.
--
-- The lock + existence check prevents two near-simultaneous submissions
-- for the same student/election from both being accepted.
--
-- Existing vote rows are not modified.

create or replace function public.insert_v2_vote_rows(
  p_student_id integer,
  p_election_id integer,
  p_votes jsonb
)
returns table (
  vote_id integer,
  vote_hash text,
  canonical_vote_timestamp text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_item jsonb;

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
  --
  -- This prevents:
  --
  -- Request A: checks no existing vote
  -- Request B: checks no existing vote
  -- Request A: inserts
  -- Request B: inserts
  --
  -- The advisory lock lasts only for the current database transaction.
  ---------------------------------------------------------------------------

  perform pg_catalog.pg_advisory_xact_lock(
    p_student_id,
    p_election_id
  );

  ---------------------------------------------------------------------------
  -- Authoritative duplicate-ballot guard.
  --
  -- A ballot creates multiple vote rows, so (student_id, election_id)
  -- cannot be a UNIQUE constraint. Instead, once ANY row exists for this
  -- student/election, another ballot submission must be rejected.
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
  -- One canonical timestamp for every persisted row in this ballot call.
  ---------------------------------------------------------------------------

  v_submitted_at := clock_timestamp();

  v_canonical_timestamp :=
    to_char(
      v_submitted_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );

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
    -- Allocate persisted vote ID
    -------------------------------------------------------------------------

    v_vote_id := nextval('public.votes_id_seq'::regclass);

    -------------------------------------------------------------------------
    -- Generate private 256-bit nonce
    -------------------------------------------------------------------------

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

    -------------------------------------------------------------------------
    -- SHA-256 over UTF-8 canonical payload
    -------------------------------------------------------------------------

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
    -- Insert fully formed V2 row
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
      blockchain_last_error
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
      'pending',
      null,
      null,
      null,
      null,
      0,
      null
    );

    vote_id := v_vote_id;
    vote_hash := v_vote_hash;
    canonical_vote_timestamp := v_canonical_timestamp;

    return next;
  end loop;

  return;
end;
$function$;


alter function public.insert_v2_vote_rows(integer, integer, jsonb)
  owner to postgres;


revoke all
on function public.insert_v2_vote_rows(integer, integer, jsonb)
from public;

revoke all
on function public.insert_v2_vote_rows(integer, integer, jsonb)
from anon;

revoke all
on function public.insert_v2_vote_rows(integer, integer, jsonb)
from authenticated;


grant execute
on function public.insert_v2_vote_rows(integer, integer, jsonb)
to service_role;