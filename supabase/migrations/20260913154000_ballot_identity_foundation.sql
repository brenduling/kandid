begin;

create table if not exists public.vote_ballots (
  id uuid primary key default extensions.gen_random_uuid(),
  student_id integer not null
    references public.students(id) on delete restrict,
  election_id integer not null
    references public.elections(id) on delete restrict,
  canonical_submitted_at text not null,
  ballot_hash text,
  hash_version text not null default 'KANDID_BALLOT_V1',
  ballot_nonce text,
  blockchain_anchor_status text not null default 'pending',
  blockchain_tx_id text,
  blockchain_network text,
  blockchain_contract_address text,
  blockchain_block_number bigint,
  blockchain_anchored_at timestamptz,
  blockchain_retry_count integer not null default 0,
  blockchain_last_error text,
  blockchain_anchor_claimed_at timestamptz,
  blockchain_next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vote_ballots_hash_version_check
    check (hash_version in ('KANDID_BALLOT_V1')),
  constraint vote_ballots_anchor_status_check
    check (
      blockchain_anchor_status in (
        'pending',
        'anchoring',
        'submitted',
        'anchored',
        'anchor_failed',
        'manual_review'
      )
    ),
  constraint vote_ballots_retry_count_check
    check (blockchain_retry_count >= 0),
  constraint vote_ballots_block_number_check
    check (
      blockchain_block_number is null
      or blockchain_block_number >= 0
    ),
  constraint vote_ballots_hash_material_check
    check (
      ballot_hash is null
      or ballot_hash ~ '^0x[0-9a-f]{64}$'
    ),
  constraint vote_ballots_nonce_check
    check (
      ballot_nonce is null
      or ballot_nonce ~ '^[0-9a-f]{64}$'
    ),
  constraint vote_ballots_tx_hash_check
    check (
      blockchain_tx_id is null
      or blockchain_tx_id ~ '^0x[0-9a-fA-F]{64}$'
    ),
  constraint vote_ballots_contract_address_check
    check (
      blockchain_contract_address is null
      or blockchain_contract_address ~ '^0x[0-9a-fA-F]{40}$'
    ),
  constraint vote_ballots_submitted_metadata_check
    check (
      blockchain_anchor_status <> 'submitted'
      or (
        blockchain_tx_id is not null
        and btrim(blockchain_tx_id) <> ''
      )
    ),
  constraint vote_ballots_anchored_metadata_check
    check (
      blockchain_anchor_status <> 'anchored'
      or (
        ballot_hash is not null
        and blockchain_tx_id is not null
        and btrim(blockchain_tx_id) <> ''
        and blockchain_network is not null
        and btrim(blockchain_network) <> ''
        and blockchain_contract_address is not null
        and blockchain_block_number is not null
        and blockchain_anchored_at is not null
      )
    )
);

alter table public.votes
  add column if not exists ballot_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'votes_ballot_id_fkey'
      and conrelid = 'public.votes'::regclass
  ) then
    alter table public.votes
      add constraint votes_ballot_id_fkey
      foreign key (ballot_id)
      references public.vote_ballots(id)
      on delete restrict;
  end if;
end
$$;

create index if not exists vote_ballots_student_election_idx
  on public.vote_ballots (student_id, election_id);

create index if not exists vote_ballots_anchor_status_idx
  on public.vote_ballots (blockchain_anchor_status);

create index if not exists vote_ballots_anchor_queue_idx
  on public.vote_ballots (
    blockchain_anchor_status,
    blockchain_next_retry_at,
    blockchain_retry_count,
    created_at
  )
  where blockchain_anchor_status in ('pending', 'anchor_failed');

create index if not exists votes_ballot_id_idx
  on public.votes (ballot_id)
  where ballot_id is not null;

alter table public.vote_ballots enable row level security;

revoke all on table public.vote_ballots from public;
revoke all on table public.vote_ballots from anon;
revoke all on table public.vote_ballots from authenticated;

grant select, insert, update, delete on table public.vote_ballots to service_role;

notify pgrst, 'reload schema';

commit;
