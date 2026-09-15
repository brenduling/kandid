begin;

alter table public.votes
drop constraint if exists votes_blockchain_anchor_status_check;

alter table public.votes
add constraint votes_blockchain_anchor_status_check
check (
  blockchain_anchor_status = any (
    array[
      'legacy_unanchored'::text,
      'pending'::text,
      'anchoring'::text,
      'anchored'::text,
      'anchor_failed'::text,
      'manual_review'::text,
      'ballot_grouped'::text
    ]
  )
);

create or replace function public.set_vote_ballots_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists vote_ballots_set_updated_at
on public.vote_ballots;

create trigger vote_ballots_set_updated_at
before update on public.vote_ballots
for each row
execute function public.set_vote_ballots_updated_at();

drop function if exists public.insert_v2_vote_rows(integer, integer, jsonb);

create or replace function public.insert_v2_vote_rows(
  p_student_id integer,
  p_election_id integer,
  p_votes jsonb
)
returns table (
  vote_id integer,
  vote_hash text,
  canonical_vote_timestamp text,
  ballot_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
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

revoke all
on function public.set_vote_ballots_updated_at()
from public;

revoke all
on function public.set_vote_ballots_updated_at()
from anon;

revoke all
on function public.set_vote_ballots_updated_at()
from authenticated;

grant execute
on function public.set_vote_ballots_updated_at()
to service_role;

notify pgrst, 'reload schema';

commit;
