begin;

create table if not exists public.blockchain_signer_leases (
  lock_name text primary key,
  owner_token text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint blockchain_signer_leases_lock_name_check
    check (btrim(lock_name) <> ''),
  constraint blockchain_signer_leases_owner_token_check
    check (btrim(owner_token) <> '')
);

alter table public.blockchain_signer_leases enable row level security;

revoke all on table public.blockchain_signer_leases from public;
revoke all on table public.blockchain_signer_leases from anon;
revoke all on table public.blockchain_signer_leases from authenticated;

grant select, insert, update, delete
on table public.blockchain_signer_leases
to service_role;

create or replace function public.acquire_ballot_anchor_signer_lease(
  p_owner_token text,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_acquired boolean := false;
  v_lease_seconds integer;
begin
  if p_owner_token is null or btrim(p_owner_token) = '' then
    raise exception 'Lease owner token is required.';
  end if;

  v_lease_seconds := greatest(30, least(coalesce(p_lease_seconds, 120), 300));

  insert into public.blockchain_signer_leases (
    lock_name,
    owner_token,
    acquired_at,
    expires_at,
    updated_at
  )
  values (
    'sepolia_vote_registry_signer',
    p_owner_token,
    clock_timestamp(),
    clock_timestamp() + make_interval(secs => v_lease_seconds),
    clock_timestamp()
  )
  on conflict (lock_name) do update
  set
    owner_token = excluded.owner_token,
    acquired_at =
      case
        when public.blockchain_signer_leases.owner_token = excluded.owner_token
          then public.blockchain_signer_leases.acquired_at
        else excluded.acquired_at
      end,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at
  where public.blockchain_signer_leases.expires_at < clock_timestamp()
     or public.blockchain_signer_leases.owner_token = excluded.owner_token
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$function$;

create or replace function public.release_ballot_anchor_signer_lease(
  p_owner_token text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_owner_token is null or btrim(p_owner_token) = '' then
    raise exception 'Lease owner token is required.';
  end if;

  delete from public.blockchain_signer_leases
  where lock_name = 'sepolia_vote_registry_signer'
    and owner_token = p_owner_token;

  return found;
end;
$function$;

create or replace function public.claim_next_ballot_anchor()
returns table (
  ballot_id uuid,
  ballot_hash text,
  blockchain_retry_count integer,
  blockchain_anchor_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_ballot_id uuid;
  v_was_stale_claim boolean := false;
begin
  select
    b.id,
    (
      b.blockchain_anchor_status = 'anchoring'
      and (
        b.blockchain_anchor_claimed_at is null
        or b.blockchain_anchor_claimed_at
          < clock_timestamp() - interval '10 minutes'
      )
    )
  into
    v_ballot_id,
    v_was_stale_claim
  from public.vote_ballots b
  where b.hash_version = 'KANDID_BALLOT_V1'
    and b.ballot_hash ~ '^0x[0-9a-f]{64}$'
    and (
      (
        b.blockchain_anchor_status in ('pending', 'anchor_failed')
        and (
          b.blockchain_next_retry_at is null
          or b.blockchain_next_retry_at <= clock_timestamp()
        )
      )
      or (
        b.blockchain_anchor_status = 'anchoring'
        and (
          b.blockchain_anchor_claimed_at is null
          or b.blockchain_anchor_claimed_at
            < clock_timestamp() - interval '10 minutes'
        )
      )
    )
  order by
    case
      when b.blockchain_anchor_status = 'pending' then 0
      when b.blockchain_anchor_status = 'anchor_failed' then 1
      else 2
    end,
    b.blockchain_retry_count asc,
    b.created_at asc,
    b.id asc
  for update skip locked
  limit 1;

  if v_ballot_id is null then
    return;
  end if;

  update public.vote_ballots b
  set
    blockchain_anchor_status = 'anchoring',
    blockchain_anchor_claimed_at = clock_timestamp(),
    blockchain_retry_count =
      b.blockchain_retry_count
      + case when v_was_stale_claim then 1 else 0 end,
    blockchain_last_error =
      case
        when v_was_stale_claim
          then 'Recovered stale ballot blockchain anchor claim.'
        else null
      end
  where b.id = v_ballot_id;

  return query
  select
    b.id,
    b.ballot_hash,
    b.blockchain_retry_count,
    b.blockchain_anchor_status
  from public.vote_ballots b
  where b.id = v_ballot_id;
end;
$function$;

create or replace function public.claim_next_submitted_ballot_anchor()
returns table (
  ballot_id uuid,
  ballot_hash text,
  blockchain_tx_id text,
  blockchain_retry_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_ballot_id uuid;
begin
  select b.id
  into v_ballot_id
  from public.vote_ballots b
  where b.hash_version = 'KANDID_BALLOT_V1'
    and b.ballot_hash ~ '^0x[0-9a-f]{64}$'
    and b.blockchain_anchor_status = 'submitted'
    and b.blockchain_tx_id ~ '^0x[0-9a-fA-F]{64}$'
    and (
      b.blockchain_anchor_claimed_at is null
      or b.blockchain_anchor_claimed_at < clock_timestamp() - interval '1 minute'
    )
    and (
      b.blockchain_next_retry_at is null
      or b.blockchain_next_retry_at <= clock_timestamp()
    )
  order by
    b.blockchain_retry_count asc,
    b.updated_at asc,
    b.id asc
  for update skip locked
  limit 1;

  if v_ballot_id is null then
    return;
  end if;

  update public.vote_ballots b
  set
    blockchain_anchor_claimed_at = clock_timestamp(),
    blockchain_next_retry_at = clock_timestamp() + interval '1 minute'
  where b.id = v_ballot_id;

  return query
  select
    b.id,
    b.ballot_hash,
    b.blockchain_tx_id,
    b.blockchain_retry_count
  from public.vote_ballots b
  where b.id = v_ballot_id;
end;
$function$;

create or replace function public.mark_ballot_anchor_submitted(
  p_ballot_id uuid,
  p_ballot_hash text,
  p_transaction_hash text,
  p_network text,
  p_contract_address text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_ballot_id is null then
    raise exception 'Valid ballot_id is required.';
  end if;

  if p_ballot_hash is null or p_ballot_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Valid ballot hash is required.';
  end if;

  if p_transaction_hash is null or p_transaction_hash !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception 'Valid blockchain transaction hash is required.';
  end if;

  if p_network is null or btrim(p_network) = '' then
    raise exception 'Blockchain network is required.';
  end if;

  if p_contract_address is null
     or p_contract_address !~ '^0x[0-9a-fA-F]{40}$' then
    raise exception 'Valid blockchain contract address is required.';
  end if;

  update public.vote_ballots
  set
    blockchain_anchor_status = 'submitted',
    blockchain_tx_id = lower(p_transaction_hash),
    blockchain_network = btrim(p_network),
    blockchain_contract_address = lower(p_contract_address),
    blockchain_anchor_claimed_at = null,
    blockchain_next_retry_at = clock_timestamp() + interval '1 minute',
    blockchain_last_error = null
  where id = p_ballot_id
    and hash_version = 'KANDID_BALLOT_V1'
    and ballot_hash = p_ballot_hash
    and blockchain_anchor_status = 'anchoring';

  if not found then
    raise exception 'Ballot anchor claim is no longer valid.';
  end if;

  return true;
end;
$function$;

create or replace function public.mark_ballot_anchor_success(
  p_ballot_id uuid,
  p_ballot_hash text,
  p_transaction_hash text,
  p_block_number bigint,
  p_anchored_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_ballot_id is null then
    raise exception 'Valid ballot_id is required.';
  end if;

  if p_ballot_hash is null or p_ballot_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Valid ballot hash is required.';
  end if;

  if p_transaction_hash is null or p_transaction_hash !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception 'Valid blockchain transaction hash is required.';
  end if;

  if p_block_number is null or p_block_number < 0 then
    raise exception 'Valid blockchain block number is required.';
  end if;

  update public.vote_ballots
  set
    blockchain_anchor_status = 'anchored',
    blockchain_tx_id = lower(p_transaction_hash),
    blockchain_block_number = p_block_number,
    blockchain_anchored_at = coalesce(p_anchored_at, clock_timestamp()),
    blockchain_anchor_claimed_at = null,
    blockchain_next_retry_at = null,
    blockchain_last_error = null
  where id = p_ballot_id
    and hash_version = 'KANDID_BALLOT_V1'
    and ballot_hash = p_ballot_hash
    and blockchain_tx_id = lower(p_transaction_hash)
    and blockchain_anchor_status = 'submitted';

  if not found then
    raise exception 'Submitted ballot anchor is no longer valid.';
  end if;

  return true;
end;
$function$;

create or replace function public.mark_ballot_anchor_failure(
  p_ballot_id uuid,
  p_ballot_hash text,
  p_error text,
  p_permanent boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_next_retry_count integer;
  v_next_retry_at timestamptz;
  v_next_status text;
begin
  if p_ballot_id is null then
    raise exception 'Valid ballot_id is required.';
  end if;

  if p_ballot_hash is null or p_ballot_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Valid ballot hash is required.';
  end if;

  select blockchain_retry_count + 1
  into v_next_retry_count
  from public.vote_ballots
  where id = p_ballot_id
    and hash_version = 'KANDID_BALLOT_V1'
    and ballot_hash = p_ballot_hash
    and blockchain_anchor_status in ('anchoring', 'submitted');

  if v_next_retry_count is null then
    raise exception 'Ballot anchor claim is no longer valid.';
  end if;

  v_next_status :=
    case
      when p_permanent or v_next_retry_count >= 4 then 'manual_review'
      else 'anchor_failed'
    end;

  v_next_retry_at :=
    case v_next_retry_count
      when 1 then clock_timestamp() + interval '1 minute'
      when 2 then clock_timestamp() + interval '5 minutes'
      when 3 then clock_timestamp() + interval '15 minutes'
      else null
    end;

  update public.vote_ballots
  set
    blockchain_anchor_status = v_next_status,
    blockchain_retry_count = v_next_retry_count,
    blockchain_anchor_claimed_at = null,
    blockchain_next_retry_at =
      case when v_next_status = 'manual_review' then null else v_next_retry_at end,
    blockchain_last_error = left(
      coalesce(nullif(btrim(p_error), ''), 'Unknown ballot blockchain anchoring error.'),
      1000
    )
  where id = p_ballot_id
    and hash_version = 'KANDID_BALLOT_V1'
    and ballot_hash = p_ballot_hash
    and blockchain_anchor_status in ('anchoring', 'submitted');

  return true;
end;
$function$;

create or replace function public.mark_ballot_manual_review(
  p_ballot_id uuid,
  p_ballot_hash text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_ballot_id is null then
    raise exception 'Valid ballot_id is required.';
  end if;

  if p_ballot_hash is null or p_ballot_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Valid ballot hash is required.';
  end if;

  update public.vote_ballots
  set
    blockchain_anchor_status = 'manual_review',
    blockchain_anchor_claimed_at = null,
    blockchain_next_retry_at = null,
    blockchain_last_error = left(
      coalesce(nullif(btrim(p_reason), ''), 'Ballot blockchain anchor requires manual review.'),
      1000
    )
  where id = p_ballot_id
    and hash_version = 'KANDID_BALLOT_V1'
    and ballot_hash = p_ballot_hash
    and blockchain_anchor_status in ('pending', 'anchoring', 'submitted', 'anchor_failed');

  if not found then
    raise exception 'Ballot anchor state is no longer valid for manual review.';
  end if;

  return true;
end;
$function$;

revoke all on function public.acquire_ballot_anchor_signer_lease(text, integer)
from public, anon, authenticated;
revoke all on function public.release_ballot_anchor_signer_lease(text)
from public, anon, authenticated;
revoke all on function public.claim_next_ballot_anchor()
from public, anon, authenticated;
revoke all on function public.claim_next_submitted_ballot_anchor()
from public, anon, authenticated;
revoke all on function public.mark_ballot_anchor_submitted(uuid, text, text, text, text)
from public, anon, authenticated;
revoke all on function public.mark_ballot_anchor_success(uuid, text, text, bigint, timestamptz)
from public, anon, authenticated;
revoke all on function public.mark_ballot_anchor_failure(uuid, text, text, boolean)
from public, anon, authenticated;
revoke all on function public.mark_ballot_manual_review(uuid, text, text)
from public, anon, authenticated;

grant execute on function public.acquire_ballot_anchor_signer_lease(text, integer)
to service_role;
grant execute on function public.release_ballot_anchor_signer_lease(text)
to service_role;
grant execute on function public.claim_next_ballot_anchor()
to service_role;
grant execute on function public.claim_next_submitted_ballot_anchor()
to service_role;
grant execute on function public.mark_ballot_anchor_submitted(uuid, text, text, text, text)
to service_role;
grant execute on function public.mark_ballot_anchor_success(uuid, text, text, bigint, timestamptz)
to service_role;
grant execute on function public.mark_ballot_anchor_failure(uuid, text, text, boolean)
to service_role;
grant execute on function public.mark_ballot_manual_review(uuid, text, text)
to service_role;

notify pgrst, 'reload schema';

commit;
