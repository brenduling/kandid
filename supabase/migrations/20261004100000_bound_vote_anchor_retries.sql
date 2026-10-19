begin;

alter table public.votes
  add column if not exists blockchain_next_retry_at timestamptz;

comment on column public.votes.blockchain_next_retry_at is
  'Next automatic retry time for KANDID_VOTE_V2 blockchain anchoring; null when not delayed or when manual review is required.';

-- Existing failed rows predate this retry timestamp. Give them a conservative
-- first due time based on their recorded failure count instead of retrying all
-- of them immediately after migration.
update public.votes as v
set blockchain_next_retry_at = pg_catalog.clock_timestamp() + case
  when coalesce(v.blockchain_retry_count, 0) <= 1 then interval '1 minute'
  when v.blockchain_retry_count = 2 then interval '5 minutes'
  when v.blockchain_retry_count = 3 then interval '15 minutes'
  when v.blockchain_retry_count = 4 then interval '60 minutes'
  else interval '6 hours'
end
where v.hash_version = 'KANDID_VOTE_V2'
  and v.blockchain_anchor_status = 'anchor_failed'
  and v.blockchain_next_retry_at is null;

create or replace function public.claim_next_vote_anchor()
returns table (
  vote_id integer,
  vote_hash text,
  blockchain_retry_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
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
  from public.votes as v
  where v.hash_version = 'KANDID_VOTE_V2'
    and (
      (
        v.blockchain_anchor_status in ('pending', 'anchor_failed')
        and (
          v.blockchain_next_retry_at is null
          or v.blockchain_next_retry_at <= pg_catalog.clock_timestamp()
        )
      )
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

  update public.votes as v
  set
    blockchain_anchor_status = 'anchoring',
    blockchain_anchor_claimed_at = pg_catalog.clock_timestamp(),
    blockchain_retry_count = case
      when v_was_stale_claim
        and coalesce(v.blockchain_retry_count, 0) < 2147483647
        then coalesce(v.blockchain_retry_count, 0) + 1
      else coalesce(v.blockchain_retry_count, 0)
    end,
    blockchain_next_retry_at = null,
    blockchain_last_error = case
      when v_was_stale_claim then 'Recovered stale blockchain anchor claim.'
      else null
    end
  where v.id = v_id
    and v.hash_version = 'KANDID_VOTE_V2';

  return query
  select v.id, v.vote_hash, v.blockchain_retry_count
  from public.votes as v
  where v.id = v_id;
end;
$function$;

alter function public.claim_next_vote_anchor() owner to postgres;
revoke all on function public.claim_next_vote_anchor() from public, anon, authenticated;
grant execute on function public.claim_next_vote_anchor() to service_role;

create or replace function public.mark_vote_anchor_failure(
  p_vote_id integer,
  p_vote_hash text,
  p_error text
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
  v_last_error text;
begin
  if p_vote_id is null or p_vote_id <= 0 then
    raise exception 'Valid vote_id is required.';
  end if;

  if p_vote_hash is null or p_vote_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Valid vote hash is required.';
  end if;

  select case
    when coalesce(v.blockchain_retry_count, 0) >= 2147483647 then 2147483647
    else coalesce(v.blockchain_retry_count, 0) + 1
  end
  into v_next_retry_count
  from public.votes as v
  where v.id = p_vote_id
    and v.hash_version = 'KANDID_VOTE_V2'
    and v.vote_hash = p_vote_hash
    and v.blockchain_anchor_status = 'anchoring'
  for update;

  if v_next_retry_count is null then
    raise exception 'Vote anchor claim is no longer valid.';
  end if;

  v_next_status := 'anchor_failed';
  v_next_retry_at := case v_next_retry_count
    when 1 then pg_catalog.clock_timestamp() + interval '1 minute'
    when 2 then pg_catalog.clock_timestamp() + interval '5 minutes'
    when 3 then pg_catalog.clock_timestamp() + interval '15 minutes'
    when 4 then pg_catalog.clock_timestamp() + interval '60 minutes'
    else pg_catalog.clock_timestamp() + interval '6 hours'
  end;
  v_last_error := pg_catalog.left(
    coalesce(
      nullif(pg_catalog.btrim(p_error), ''),
      'Unknown blockchain anchoring error.'
    ),
    1000
  );

  update public.votes as v
  set
    blockchain_anchor_status = v_next_status,
    blockchain_retry_count = v_next_retry_count,
    blockchain_anchor_claimed_at = null,
    blockchain_next_retry_at = v_next_retry_at,
    blockchain_last_error = v_last_error
  where v.id = p_vote_id
    and v.hash_version = 'KANDID_VOTE_V2'
    and v.vote_hash = p_vote_hash
    and v.blockchain_anchor_status = 'anchoring';

  if not found then
    raise exception 'Vote anchor claim is no longer valid.';
  end if;

  return true;
end;
$function$;

alter function public.mark_vote_anchor_failure(integer, text, text) owner to postgres;
revoke all on function public.mark_vote_anchor_failure(integer, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_vote_anchor_failure(integer, text, text)
  to service_role;

create or replace function public.mark_vote_anchor_manual_review(
  p_vote_id integer,
  p_vote_hash text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_vote_id is null or p_vote_id <= 0 then
    raise exception 'Valid vote_id is required.';
  end if;

  if p_vote_hash is null or p_vote_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Valid vote hash is required.';
  end if;

  update public.votes as v
  set
    blockchain_anchor_status = 'manual_review',
    blockchain_anchor_claimed_at = null,
    blockchain_next_retry_at = null,
    blockchain_last_error = pg_catalog.left(
      coalesce(
        nullif(pg_catalog.btrim(p_reason), ''),
        'Blockchain anchor requires manual review.'
      ),
      1000
    )
  where v.id = p_vote_id
    and v.hash_version = 'KANDID_VOTE_V2'
    and v.vote_hash = p_vote_hash
    and v.blockchain_anchor_status = 'anchoring';

  if not found then
    raise exception 'Vote anchor claim is no longer valid.';
  end if;

  return true;
end;
$function$;

alter function public.mark_vote_anchor_manual_review(integer, text, text) owner to postgres;
revoke all on function public.mark_vote_anchor_manual_review(integer, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_vote_anchor_manual_review(integer, text, text)
  to service_role;

notify pgrst, 'reload schema';
commit;
