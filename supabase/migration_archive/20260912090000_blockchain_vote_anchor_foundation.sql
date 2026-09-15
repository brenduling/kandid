begin;

alter table public.votes
  add column if not exists hash_version text not null default 'legacy_v1',
  add column if not exists vote_nonce text,
  add column if not exists canonical_vote_timestamp text,
  add column if not exists blockchain_anchor_status text not null default 'legacy_unanchored',
  add column if not exists blockchain_network text,
  add column if not exists blockchain_contract_address text,
  add column if not exists blockchain_block_number bigint,
  add column if not exists blockchain_anchored_at timestamp with time zone,
  add column if not exists blockchain_retry_count integer not null default 0,
  add column if not exists blockchain_last_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'votes_hash_version_check'
      and conrelid = 'public.votes'::regclass
  ) then
    alter table public.votes
      add constraint votes_hash_version_check
      check (hash_version in ('legacy_v1', 'KANDID_VOTE_V2'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'votes_v2_hash_material_check'
      and conrelid = 'public.votes'::regclass
  ) then
    alter table public.votes
      add constraint votes_v2_hash_material_check
      check (
        hash_version <> 'KANDID_VOTE_V2'
        or (
          vote_hash ~ '^0x[0-9a-f]{64}$'
          and vote_nonce ~ '^[0-9a-f]{64}$'
          and canonical_vote_timestamp ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'votes_blockchain_anchor_status_check'
      and conrelid = 'public.votes'::regclass
  ) then
    alter table public.votes
      add constraint votes_blockchain_anchor_status_check
      check (
        blockchain_anchor_status in (
          'legacy_unanchored',
          'pending',
          'anchoring',
          'anchored',
          'anchor_failed'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'votes_v2_anchor_state_check'
      and conrelid = 'public.votes'::regclass
  ) then
    alter table public.votes
      add constraint votes_v2_anchor_state_check
      check (
        hash_version <> 'KANDID_VOTE_V2'
        or blockchain_anchor_status <> 'legacy_unanchored'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'votes_blockchain_retry_count_check'
      and conrelid = 'public.votes'::regclass
  ) then
    alter table public.votes
      add constraint votes_blockchain_retry_count_check
      check (blockchain_retry_count >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'votes_blockchain_block_number_check'
      and conrelid = 'public.votes'::regclass
  ) then
    alter table public.votes
      add constraint votes_blockchain_block_number_check
      check (blockchain_block_number is null or blockchain_block_number >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'votes_blockchain_contract_address_check'
      and conrelid = 'public.votes'::regclass
  ) then
    alter table public.votes
      add constraint votes_blockchain_contract_address_check
      check (
        blockchain_contract_address is null
        or blockchain_contract_address ~ '^0x[0-9a-fA-F]{40}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'votes_blockchain_anchored_metadata_check'
      and conrelid = 'public.votes'::regclass
  ) then
    alter table public.votes
      add constraint votes_blockchain_anchored_metadata_check
      check (
        blockchain_anchor_status <> 'anchored'
        or (
          blockchain_tx_id is not null
          and btrim(blockchain_tx_id) <> ''
          and blockchain_network is not null
          and btrim(blockchain_network) <> ''
          and blockchain_contract_address is not null
          and blockchain_anchored_at is not null
        )
      );
  end if;
end $$;

create index if not exists votes_blockchain_anchor_queue_idx
  on public.votes (blockchain_anchor_status, blockchain_retry_count, id)
  where blockchain_anchor_status in ('pending', 'anchor_failed');

commit;
