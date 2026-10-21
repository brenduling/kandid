-- READ ONLY. Capture before installation and compare after installation/runs.
-- Does not select student identity, candidate choices, abstentions, or nonces.
select b.id as ballot_id,b.election_id,b.ballot_hash,b.hash_version,
  b.created_at,b.updated_at,b.canonical_submitted_at,
  b.blockchain_anchor_status,b.blockchain_tx_id,b.blockchain_retry_count,
  b.blockchain_anchor_claimed_at,b.blockchain_next_retry_at,
  (select count(*) from public.votes v where v.ballot_id=b.id) as grouped_vote_count,
  md5(jsonb_build_object(
    'ballot',jsonb_build_object('id',b.id,'election',b.election_id,'hash',b.ballot_hash,
      'version',b.hash_version,'created_at',b.created_at,'updated_at',b.updated_at,
      'canonical_timestamp',b.canonical_submitted_at,'status',b.blockchain_anchor_status,
      'tx',b.blockchain_tx_id,'network',b.blockchain_network,'contract',b.blockchain_contract_address,
      'block',b.blockchain_block_number,'anchored_at',b.blockchain_anchored_at,
      'retry_count',b.blockchain_retry_count,'error',b.blockchain_last_error,
      'claimed_at',b.blockchain_anchor_claimed_at,'next_retry_at',b.blockchain_next_retry_at),
    'group_metadata',(select jsonb_agg(jsonb_build_object(
      'id',v.id,'election',v.election_id,'hash',v.vote_hash,'version',v.hash_version,
      'timestamp',v.vote_timestamp,'canonical_timestamp',v.canonical_vote_timestamp,
      'status',v.blockchain_anchor_status,'tx',v.blockchain_tx_id,
      'network',v.blockchain_network,'contract',v.blockchain_contract_address,
      'block',v.blockchain_block_number,'anchored_at',v.blockchain_anchored_at,
      'retry_count',v.blockchain_retry_count,'error',v.blockchain_last_error,
      'claimed_at',v.blockchain_anchor_claimed_at,'next_retry_at',v.blockchain_next_retry_at
    ) order by v.id) from public.votes v where v.ballot_id=b.id)
  )::text) as preservation_fingerprint
from public.vote_ballots b
where b.id in ('3c5a6c0f-5c69-49d1-bd66-ee4f97383cc1','a9bb5581-acb0-4c1b-9d7a-b08cf358368c')
order by b.election_id;

select blockchain_anchor_status,count(*) from public.vote_ballots
group by blockchain_anchor_status order by blockchain_anchor_status;
select count(*) as lease_rows,count(*) filter(where expires_at>clock_timestamp()) as active_leases
from public.blockchain_signer_leases;

-- AFTER approved installation only; SELECT as the authorized database operator.
-- Do not call claim/mark/worker RPCs for validation: those write records.
select ballot_id,election_id,ballot_hash,reason,recorded_at,recorded_by
from private.ballot_anchor_exclusions order by election_id;
select p.proname,p.prosecdef,p.proconfig,p.proacl
from pg_proc p where p.oid in ('public.claim_next_ballot_anchor()'::regprocedure,
  'public.claim_next_submitted_ballot_anchor()'::regprocedure);
select count(*) as eligible_nonexcluded_queue_rows from public.vote_ballots b
where not exists(select 1 from private.ballot_anchor_exclusions e where e.ballot_id=b.id)
  and b.hash_version='KANDID_BALLOT_V1' and b.ballot_hash ~ '^0x[0-9a-f]{64}$'
  and ((b.blockchain_anchor_status in ('pending','anchor_failed')
    and (b.blockchain_next_retry_at is null or b.blockchain_next_retry_at<=clock_timestamp()))
    or (b.blockchain_anchor_status='anchoring' and (b.blockchain_anchor_claimed_at is null
      or b.blockchain_anchor_claimed_at<clock_timestamp()-interval '10 minutes')));
