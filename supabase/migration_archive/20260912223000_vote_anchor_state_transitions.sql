create or replace function public.mark_vote_anchor_success(
  p_vote_id integer,
  p_vote_hash text,
  p_transaction_hash text,
  p_network text,
  p_contract_address text,
  p_block_number bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_vote_id is null or p_vote_id <= 0 then
    raise exception 'Valid vote_id is required.';
  end if;

  if p_vote_hash is null or p_vote_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Valid vote hash is required.';
  end if;

  if p_transaction_hash is null or p_transaction_hash !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception 'Valid blockchain transaction hash is required.';
  end if;

  if p_network is null or pg_catalog.btrim(p_network) = '' then
    raise exception 'Blockchain network is required.';
  end if;

  if p_contract_address is null
     or p_contract_address !~ '^0x[0-9a-fA-F]{40}$' then
    raise exception 'Valid blockchain contract address is required.';
  end if;

  if p_block_number is null or p_block_number < 0 then
    raise exception 'Valid blockchain block number is required.';
  end if;

  update public.votes
  set
    blockchain_anchor_status = 'anchored',
    blockchain_tx_id = pg_catalog.lower(p_transaction_hash),
    blockchain_network = pg_catalog.btrim(p_network),
    blockchain_contract_address = pg_catalog.lower(p_contract_address),
    blockchain_block_number = p_block_number,
    blockchain_anchored_at = pg_catalog.clock_timestamp(),
    blockchain_anchor_claimed_at = null,
    blockchain_last_error = null
  where id = p_vote_id
    and hash_version = 'KANDID_VOTE_V2'
    and vote_hash = p_vote_hash
    and blockchain_anchor_status = 'anchoring';

  if not found then
    raise exception 'Vote anchor claim is no longer valid.';
  end if;

  return true;
end;
$$;


create or replace function public.mark_vote_anchor_failure(
  p_vote_id integer,
  p_vote_hash text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_vote_id is null or p_vote_id <= 0 then
    raise exception 'Valid vote_id is required.';
  end if;

  if p_vote_hash is null or p_vote_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Valid vote hash is required.';
  end if;

  update public.votes
  set
    blockchain_anchor_status = 'anchor_failed',
    blockchain_retry_count = blockchain_retry_count + 1,
    blockchain_anchor_claimed_at = null,
    blockchain_last_error = pg_catalog.left(
      coalesce(nullif(pg_catalog.btrim(p_error), ''), 'Unknown blockchain anchoring error.'),
      1000
    )
  where id = p_vote_id
    and hash_version = 'KANDID_VOTE_V2'
    and vote_hash = p_vote_hash
    and blockchain_anchor_status = 'anchoring';

  if not found then
    raise exception 'Vote anchor claim is no longer valid.';
  end if;

  return true;
end;
$$;


revoke all on function public.mark_vote_anchor_success(
  integer,
  text,
  text,
  text,
  text,
  bigint
) from public;

revoke all on function public.mark_vote_anchor_success(
  integer,
  text,
  text,
  text,
  text,
  bigint
) from anon;

revoke all on function public.mark_vote_anchor_success(
  integer,
  text,
  text,
  text,
  text,
  bigint
) from authenticated;

grant execute on function public.mark_vote_anchor_success(
  integer,
  text,
  text,
  text,
  text,
  bigint
) to service_role;


revoke all on function public.mark_vote_anchor_failure(
  integer,
  text,
  text
) from public;

revoke all on function public.mark_vote_anchor_failure(
  integer,
  text,
  text
) from anon;

revoke all on function public.mark_vote_anchor_failure(
  integer,
  text,
  text
) from authenticated;

grant execute on function public.mark_vote_anchor_failure(
  integer,
  text,
  text
) to service_role;
