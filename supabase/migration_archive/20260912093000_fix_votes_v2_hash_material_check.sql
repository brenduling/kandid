begin;

alter table public.votes
  drop constraint if exists votes_v2_hash_material_check;

alter table public.votes
  add constraint votes_v2_hash_material_check
  check (
    hash_version <> 'KANDID_VOTE_V2'
    or (
      vote_hash is not null
      and vote_hash ~ '^0x[0-9a-f]{64}$'
      and vote_nonce is not null
      and vote_nonce ~ '^[0-9a-f]{64}$'
      and canonical_vote_timestamp is not null
      and canonical_vote_timestamp ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    )
  );

commit;
