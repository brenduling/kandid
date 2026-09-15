alter table public.votes
drop constraint votes_blockchain_anchor_status_check;

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
      'manual_review'::text
    ]
  )
);


create or replace function public.mark_vote_anchor_manual_review(
  p_vote_id integer,
  p_vote_hash text,
  p_reason text
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
    blockchain_anchor_status = 'manual_review',
    blockchain_anchor_claimed_at = null,
    blockchain_last_error = pg_catalog.left(
      coalesce(
        nullif(pg_catalog.btrim(p_reason), ''),
        'Blockchain anchor requires manual review.'
      ),
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


revoke all on function public.mark_vote_anchor_manual_review(
  integer,
  text,
  text
) from public;

revoke all on function public.mark_vote_anchor_manual_review(
  integer,
  text,
  text
) from anon;

revoke all on function public.mark_vote_anchor_manual_review(
  integer,
  text,
  text
) from authenticated;

grant execute on function public.mark_vote_anchor_manual_review(
  integer,
  text,
  text
) to service_role;
