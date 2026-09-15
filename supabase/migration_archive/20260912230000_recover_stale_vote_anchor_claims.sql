create or replace function public.claim_next_vote_anchor()
returns table (
  vote_id integer,
  vote_hash text,
  blockchain_retry_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id integer;
  v_was_stale_claim boolean := false;
begin
  select
    v.id,
    (
      v.blockchain_anchor_status = 'anchoring'
      and (
        v.blockchain_anchor_claimed_at is null
        or v.blockchain_anchor_claimed_at
          < pg_catalog.clock_timestamp() - interval '10 minutes'
      )
    )
  into
    v_id,
    v_was_stale_claim
  from public.votes v
  where v.hash_version = 'KANDID_VOTE_V2'
    and (
      v.blockchain_anchor_status in ('pending', 'anchor_failed')
      or (
        v.blockchain_anchor_status = 'anchoring'
        and (
          v.blockchain_anchor_claimed_at is null
          or v.blockchain_anchor_claimed_at
            < pg_catalog.clock_timestamp() - interval '10 minutes'
        )
      )
    )
  order by
    case
      when v.blockchain_anchor_status = 'pending' then 0
      when v.blockchain_anchor_status = 'anchor_failed' then 1
      else 2
    end,
    v.blockchain_retry_count asc,
    v.id asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  update public.votes
  set
    blockchain_anchor_status = 'anchoring',
    blockchain_anchor_claimed_at = pg_catalog.clock_timestamp(),
    blockchain_retry_count =
      blockchain_retry_count
      + case when v_was_stale_claim then 1 else 0 end,
    blockchain_last_error =
      case
        when v_was_stale_claim
          then 'Recovered stale blockchain anchor claim.'
        else null
      end
  where id = v_id;

  return query
  select
    v.id,
    v.vote_hash,
    v.blockchain_retry_count
  from public.votes v
  where v.id = v_id;
end;
$$;

revoke all on function public.claim_next_vote_anchor() from public;
revoke all on function public.claim_next_vote_anchor() from anon;
revoke all on function public.claim_next_vote_anchor() from authenticated;

grant execute on function public.claim_next_vote_anchor() to service_role;
