begin;

do $preflight$
begin
  if to_regclass('public.votes') is null then
    raise exception 'public.votes is required for the vote security migration.';
  end if;
  if to_regclass('public.vote_ballots') is null then
    raise exception 'public.vote_ballots is required for the vote security migration.';
  end if;
  if to_regclass('public.votes_id_seq') is null then
    raise exception 'public.votes_id_seq is required for the vote security migration.';
  end if;
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('votes', 'vote_ballots')
      and (
        tablename <> 'votes'
        or policyname not in ('open votes', 'votes_all_access')
        or cmd <> 'ALL'
        or qual is distinct from 'true'
        or with_check is distinct from 'true'
        or cardinality(roles) <> 2
        or not ('anon' = any (roles))
        or not ('authenticated' = any (roles))
      )
  ) or (
    select count(*) from pg_policies
    where schemaname = 'public'
      and tablename = 'votes'
  ) <> 2 then
    raise exception 'Vote RLS policies differ from the reviewed pre-migration state; inspect them before continuing.';
  end if;
  if to_regprocedure('public.insert_v2_vote_rows(integer,integer,jsonb)') is null then
    raise exception 'Trusted insert_v2_vote_rows RPC is required; refusing partial vote security migration.';
  end if;
  if to_regprocedure('public.claim_next_vote_anchor()') is null then
    raise exception 'Trusted vote anchor worker RPC is required; refusing partial vote security migration.';
  end if;
  if to_regprocedure('public.claim_next_ballot_anchor()') is null then
    raise exception 'Trusted ballot anchor worker RPC is required; refusing partial vote security migration.';
  end if;
  if to_regprocedure('public.mark_vote_anchor_success(integer,text,text,text,text,bigint)') is null
     or to_regprocedure('public.mark_vote_anchor_failure(integer,text,text)') is null
     or to_regprocedure('public.mark_vote_anchor_manual_review(integer,text,text)') is null then
    raise exception 'Trusted legacy vote anchor transition RPCs are required; refusing partial vote security migration.';
  end if;
  if to_regprocedure('public.acquire_ballot_anchor_signer_lease(text,integer)') is null
     or to_regprocedure('public.release_ballot_anchor_signer_lease(text)') is null
     or to_regprocedure('public.claim_next_submitted_ballot_anchor()') is null
     or to_regprocedure('public.mark_ballot_anchor_submitted(uuid,text,text,text,text)') is null
     or to_regprocedure('public.mark_ballot_anchor_success(uuid,text,text,bigint,timestamp with time zone)') is null
     or to_regprocedure('public.mark_ballot_anchor_failure(uuid,text,text,boolean)') is null
     or to_regprocedure('public.mark_ballot_manual_review(uuid,text,text)') is null then
    raise exception 'Trusted ballot anchor worker RPCs are required; refusing partial vote security migration.';
  end if;
end
$preflight$;

drop policy if exists "open votes" on public.votes;
drop policy if exists "votes_all_access" on public.votes;

alter table public.votes enable row level security;
alter table public.vote_ballots enable row level security;

revoke all privileges on table public.votes from public, anon, authenticated;
revoke all privileges on table public.vote_ballots from public, anon, authenticated;
revoke all privileges on sequence public.votes_id_seq from public, anon, authenticated;

revoke all privileges on table public.votes from service_role;
grant select on table public.votes to service_role;

revoke all privileges on table public.vote_ballots from service_role;
grant select on table public.vote_ballots to service_role;

revoke all privileges on sequence public.votes_id_seq from service_role;

-- These SECURITY DEFINER RPCs trust the server-side caller. Reassert their
-- service-role-only contract here so stale grants cannot expose vote mutation
-- or anchoring claims to browser roles.
revoke all on function public.insert_v2_vote_rows(integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.insert_v2_vote_rows(integer, integer, jsonb)
  to service_role;

revoke all on function public.claim_next_ballot_anchor()
  from public, anon, authenticated;
grant execute on function public.claim_next_ballot_anchor()
  to service_role;

revoke all on function public.claim_next_vote_anchor()
  from public, anon, authenticated;
grant execute on function public.claim_next_vote_anchor()
  to service_role;

revoke all on function public.mark_vote_anchor_success(integer, text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.mark_vote_anchor_success(integer, text, text, text, text, bigint)
  to service_role;
revoke all on function public.mark_vote_anchor_failure(integer, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_vote_anchor_failure(integer, text, text)
  to service_role;
revoke all on function public.mark_vote_anchor_manual_review(integer, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_vote_anchor_manual_review(integer, text, text)
  to service_role;

revoke all on function public.acquire_ballot_anchor_signer_lease(text, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_ballot_anchor_signer_lease(text, integer)
  to service_role;
revoke all on function public.release_ballot_anchor_signer_lease(text)
  from public, anon, authenticated;
grant execute on function public.release_ballot_anchor_signer_lease(text)
  to service_role;
revoke all on function public.claim_next_submitted_ballot_anchor()
  from public, anon, authenticated;
grant execute on function public.claim_next_submitted_ballot_anchor()
  to service_role;
revoke all on function public.mark_ballot_anchor_submitted(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_ballot_anchor_submitted(uuid, text, text, text, text)
  to service_role;
revoke all on function public.mark_ballot_anchor_success(uuid, text, text, bigint, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mark_ballot_anchor_success(uuid, text, text, bigint, timestamptz)
  to service_role;
revoke all on function public.mark_ballot_anchor_failure(uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.mark_ballot_anchor_failure(uuid, text, text, boolean)
  to service_role;
revoke all on function public.mark_ballot_manual_review(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_ballot_manual_review(uuid, text, text)
  to service_role;

create or replace function public.kandid_record_verified_legacy_vote_anchor(
  p_vote_id integer,
  p_vote_hash text,
  p_transaction_hash text,
  p_contract_address text,
  p_block_number bigint,
  p_anchored_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if p_vote_id is null or p_vote_id <= 0
     or p_vote_hash is null or p_vote_hash !~ '^0x[0-9a-fA-F]{64}$'
     or p_transaction_hash is null or p_transaction_hash !~ '^0x[0-9a-fA-F]{64}$'
     or p_contract_address is null or p_contract_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_block_number is null or p_block_number < 0
     or p_anchored_at is null then
    raise exception using errcode = '22023', message = 'Verified vote anchor metadata is invalid.';
  end if;

  update public.votes
  set blockchain_tx_id = p_transaction_hash,
      blockchain_anchor_status = 'anchored',
      blockchain_network = 'sepolia',
      blockchain_contract_address = p_contract_address,
      blockchain_block_number = p_block_number,
      blockchain_anchored_at = p_anchored_at
  where id = p_vote_id
    and vote_hash = p_vote_hash
    and ballot_id is null
    and blockchain_tx_id is null
    and blockchain_anchor_status <> 'manual_review';

  return found;
end
$function$;

alter function public.kandid_record_verified_legacy_vote_anchor(integer, text, text, text, bigint, timestamptz)
  owner to postgres;
revoke all on function public.kandid_record_verified_legacy_vote_anchor(integer, text, text, text, bigint, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_record_verified_legacy_vote_anchor(integer, text, text, text, bigint, timestamptz)
  to service_role;

do $postflight$
begin
  if has_table_privilege('anon', 'public.votes', 'SELECT')
     or has_table_privilege('anon', 'public.votes', 'INSERT')
     or has_table_privilege('anon', 'public.votes', 'UPDATE')
     or has_table_privilege('anon', 'public.votes', 'DELETE')
     or has_table_privilege('anon', 'public.votes', 'TRUNCATE')
     or has_table_privilege('anon', 'public.votes', 'TRIGGER')
     or has_table_privilege('anon', 'public.votes', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.votes', 'SELECT')
     or has_table_privilege('authenticated', 'public.votes', 'INSERT')
     or has_table_privilege('authenticated', 'public.votes', 'UPDATE')
     or has_table_privilege('authenticated', 'public.votes', 'DELETE')
     or has_table_privilege('authenticated', 'public.votes', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.votes', 'TRIGGER')
     or has_table_privilege('authenticated', 'public.votes', 'REFERENCES') then
    raise exception 'Browser privileges remain on public.votes.';
  end if;

  if has_table_privilege('anon', 'public.vote_ballots', 'SELECT')
     or has_table_privilege('anon', 'public.vote_ballots', 'INSERT')
     or has_table_privilege('anon', 'public.vote_ballots', 'UPDATE')
     or has_table_privilege('anon', 'public.vote_ballots', 'DELETE')
     or has_table_privilege('anon', 'public.vote_ballots', 'TRUNCATE')
     or has_table_privilege('anon', 'public.vote_ballots', 'TRIGGER')
     or has_table_privilege('anon', 'public.vote_ballots', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.vote_ballots', 'SELECT')
     or has_table_privilege('authenticated', 'public.vote_ballots', 'INSERT')
     or has_table_privilege('authenticated', 'public.vote_ballots', 'UPDATE')
     or has_table_privilege('authenticated', 'public.vote_ballots', 'DELETE')
     or has_table_privilege('authenticated', 'public.vote_ballots', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.vote_ballots', 'TRIGGER')
     or has_table_privilege('authenticated', 'public.vote_ballots', 'REFERENCES') then
    raise exception 'Browser privileges remain on public.vote_ballots.';
  end if;

  if not has_table_privilege('service_role', 'public.votes', 'SELECT')
     or not has_table_privilege('service_role', 'public.vote_ballots', 'SELECT') then
    raise exception 'Required trusted vote access is missing.';
  end if;
  if has_table_privilege('service_role', 'public.votes', 'INSERT')
     or has_table_privilege('service_role', 'public.votes', 'UPDATE')
     or has_table_privilege('service_role', 'public.votes', 'DELETE')
     or has_table_privilege('service_role', 'public.votes', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.votes', 'TRIGGER')
     or has_table_privilege('service_role', 'public.votes', 'REFERENCES')
     or has_table_privilege('service_role', 'public.vote_ballots', 'INSERT')
     or has_table_privilege('service_role', 'public.vote_ballots', 'UPDATE')
     or has_table_privilege('service_role', 'public.vote_ballots', 'DELETE')
     or has_table_privilege('service_role', 'public.vote_ballots', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.vote_ballots', 'TRIGGER')
     or has_table_privilege('service_role', 'public.vote_ballots', 'REFERENCES') then
    raise exception 'Unnecessary service-role vote mutation privileges remain.';
  end if;
  if has_sequence_privilege('anon', 'public.votes_id_seq', 'USAGE')
     or has_sequence_privilege('anon', 'public.votes_id_seq', 'SELECT')
     or has_sequence_privilege('anon', 'public.votes_id_seq', 'UPDATE')
     or has_sequence_privilege('authenticated', 'public.votes_id_seq', 'USAGE')
     or has_sequence_privilege('authenticated', 'public.votes_id_seq', 'SELECT')
     or has_sequence_privilege('authenticated', 'public.votes_id_seq', 'UPDATE')
     or has_sequence_privilege('service_role', 'public.votes_id_seq', 'USAGE')
     or has_sequence_privilege('service_role', 'public.votes_id_seq', 'SELECT')
     or has_sequence_privilege('service_role', 'public.votes_id_seq', 'UPDATE') then
    raise exception 'Unnecessary votes sequence privileges remain.';
  end if;
  if not (has_sequence_privilege('postgres', 'public.votes_id_seq', 'USAGE')
          or has_sequence_privilege('postgres', 'public.votes_id_seq', 'UPDATE')) then
    raise exception 'SECURITY DEFINER vote submission owner cannot advance public.votes_id_seq.';
  end if;
  if not has_function_privilege('service_role', 'public.kandid_record_verified_legacy_vote_anchor(integer,text,text,text,bigint,timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('anon', 'public.kandid_record_verified_legacy_vote_anchor(integer,text,text,text,bigint,timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.kandid_record_verified_legacy_vote_anchor(integer,text,text,text,bigint,timestamp with time zone)', 'EXECUTE') then
    raise exception 'Verified legacy anchor RPC grants are incorrect.';
  end if;

  if exists (
    select 1
    from (values
      ('public.insert_v2_vote_rows(integer,integer,jsonb)'),
      ('public.claim_next_vote_anchor()'),
      ('public.claim_next_ballot_anchor()'),
      ('public.mark_vote_anchor_success(integer,text,text,text,text,bigint)'),
      ('public.mark_vote_anchor_failure(integer,text,text)'),
      ('public.mark_vote_anchor_manual_review(integer,text,text)'),
      ('public.acquire_ballot_anchor_signer_lease(text,integer)'),
      ('public.release_ballot_anchor_signer_lease(text)'),
      ('public.claim_next_submitted_ballot_anchor()'),
      ('public.mark_ballot_anchor_submitted(uuid,text,text,text,text)'),
      ('public.mark_ballot_anchor_success(uuid,text,text,bigint,timestamptz)'),
      ('public.mark_ballot_anchor_failure(uuid,text,text,boolean)'),
      ('public.mark_ballot_manual_review(uuid,text,text)')
    ) required(signature)
    cross join lateral (select to_regprocedure(required.signature) as procedure_oid) resolved
    where resolved.procedure_oid is null
       or has_function_privilege('anon', resolved.procedure_oid, 'EXECUTE')
       or has_function_privilege('authenticated', resolved.procedure_oid, 'EXECUTE')
       or not has_function_privilege('service_role', resolved.procedure_oid, 'EXECUTE')
  ) then
    raise exception 'Vote submission or anchoring RPC privileges are not service-role-only.';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('votes', 'vote_ballots')
  ) then
    raise exception 'A direct RLS policy remains on a sensitive vote table.';
  end if;
end
$postflight$;

notify pgrst, 'reload schema';
commit;
