alter table public.votes
add column if not exists blockchain_anchor_claimed_at timestamptz;

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
begin
  select v.id
  into v_id
  from public.votes v
  where v.hash_version = 'KANDID_VOTE_V2'
    and v.blockchain_anchor_status in ('pending', 'anchor_failed')
  order by
    case when v.blockchain_anchor_status = 'pending' then 0 else 1 end,
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
    blockchain_last_error = null
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
