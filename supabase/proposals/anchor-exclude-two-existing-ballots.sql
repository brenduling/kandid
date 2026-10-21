-- REVIEW ONLY. Deliberately outside supabase/migrations (no automatic db push).
-- Apply only to verified project fszgdxqxonqqcrzsnkca after separate approval,
-- with scheduling disabled and no worker invocation or in-flight transaction.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Block lease acquisition and row mutations while checking and installing.
lock table public.blockchain_signer_leases in access exclusive mode;
lock table public.vote_ballots, public.votes in share row exclusive mode;

do $preflight$
begin
  if to_regclass('private.ballot_anchor_exclusions') is not null then
    raise exception 'Exclusions already exist; stop and review, do not reinstall.';
  end if;
  if exists(select 1 from public.blockchain_signer_leases)
     or exists(select 1 from public.vote_ballots where blockchain_anchor_status in ('anchoring','submitted')) then
    raise exception 'Worker is not quiescent; stop before installing exclusions.';
  end if;
  if md5(pg_get_functiondef('public.claim_next_ballot_anchor()'::regprocedure)) <> '86257c05a0a42a28b81b9ff6284385aa'
     or md5(pg_get_functiondef('public.claim_next_submitted_ballot_anchor()'::regprocedure)) <> 'f2cf3eba78531b422495ed6c05f4e4ef' then
    raise exception 'Reviewed claim contract changed; stop and review.';
  end if;
end;
$preflight$;

create table private.ballot_anchor_exclusions (
  ballot_id uuid primary key references public.vote_ballots(id) on delete restrict,
  election_id integer not null,
  ballot_hash text not null,
  reason text not null default 'Preserve the two existing pending ballot groups; anchor new ballots only.',
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by name not null default current_user,
  constraint ballot_anchor_exclusions_exact_scope check (
    (ballot_id = '3c5a6c0f-5c69-49d1-bd66-ee4f97383cc1'::uuid and election_id = 2
      and ballot_hash = '0x6f3aed472bda8be4e04c203070f1941f8cdaea750738aebc8cfc735d646249fc')
    or
    (ballot_id = 'a9bb5581-acb0-4c1b-9d7a-b08cf358368c'::uuid and election_id = 4
      and ballot_hash = '0xf5074400475d07897d657d54903c2edeed6b3d618d472b71393624d50a4f9804')
  )
);
alter table private.ballot_anchor_exclusions enable row level security;
revoke all on table private.ballot_anchor_exclusions from public, anon, authenticated, service_role;

-- Validate UUID + election + immutable Ballot V1 hash + reviewed timestamps/state.
-- Insert only into the private control table, never into either ballot/vote table.
insert into private.ballot_anchor_exclusions(ballot_id,election_id,ballot_hash)
select b.id,b.election_id,b.ballot_hash
from (values
  ('3c5a6c0f-5c69-49d1-bd66-ee4f97383cc1'::uuid,2,
    '0x6f3aed472bda8be4e04c203070f1941f8cdaea750738aebc8cfc735d646249fc',
    '2026-10-10T10:42:49.415608Z'::timestamptz,'2026-10-10T10:42:49.426Z'),
  ('a9bb5581-acb0-4c1b-9d7a-b08cf358368c'::uuid,4,
    '0xf5074400475d07897d657d54903c2edeed6b3d618d472b71393624d50a4f9804',
    '2026-10-20T23:01:49.002167Z'::timestamptz,'2026-10-20T23:01:49.005Z')
) expected(id,election_id,ballot_hash,created_at,submitted_at)
join public.vote_ballots b on b.id=expected.id
where b.election_id=expected.election_id and b.ballot_hash=expected.ballot_hash
  and b.hash_version='KANDID_BALLOT_V1'
  and b.created_at=expected.created_at and b.updated_at=expected.created_at
  and b.canonical_submitted_at=expected.submitted_at
  and b.blockchain_anchor_status='pending' and b.blockchain_tx_id is null
  and b.blockchain_anchor_claimed_at is null and b.blockchain_next_retry_at is null
  and b.blockchain_retry_count=0 and b.blockchain_anchored_at is null
  and b.blockchain_network is null and b.blockchain_contract_address is null
  and b.blockchain_block_number is null and b.blockchain_last_error is null
  and (select count(*) from public.votes v where v.ballot_id=b.id)=1
  and not exists(select 1 from public.votes v where v.ballot_id=b.id
    and (v.election_id is distinct from b.election_id or v.hash_version is distinct from 'KANDID_VOTE_V2'
      or v.blockchain_anchor_status is distinct from 'ballot_grouped' or v.blockchain_tx_id is not null
      or v.blockchain_anchor_claimed_at is not null or v.blockchain_retry_count is distinct from 0));

do $validated$
begin
  if (select count(*) from private.ballot_anchor_exclusions) <> 2 then
    raise exception 'The two reviewed pending groups do not match; nothing may be installed.';
  end if;
end;
$validated$;

-- These guards also protect stale/direct marking RPC calls. No status is rewritten
-- to manufacture an exclusion; existing receipts continue to show pending.
create function private.kandid_guard_excluded_ballot() returns trigger
language plpgsql security definer set search_path = pg_catalog
as $guard$
begin
  if exists(select 1 from private.ballot_anchor_exclusions e where e.ballot_id=old.id) then
    raise exception 'Ballot group is excluded from automatic anchoring.' using errcode='42501';
  end if;
  if tg_op='UPDATE' then
    if exists(select 1 from private.ballot_anchor_exclusions e where e.ballot_id=new.id) then
      raise exception 'Ballot group is excluded from automatic anchoring.' using errcode='42501';
    end if;
    return new;
  end if;
  return old;
end;
$guard$;

create function private.kandid_guard_excluded_ballot_votes() returns trigger
language plpgsql security definer set search_path = pg_catalog
as $guard$
begin
  if tg_op in ('UPDATE','DELETE') then
    if exists(select 1 from private.ballot_anchor_exclusions e where e.ballot_id=old.ballot_id) then
      raise exception 'Ballot group is excluded from automatic anchoring.' using errcode='42501';
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    if exists(select 1 from private.ballot_anchor_exclusions e where e.ballot_id=new.ballot_id) then
      raise exception 'Ballot group is excluded from automatic anchoring.' using errcode='42501';
    end if;
    return new;
  end if;
  return old;
end;
$guard$;

create function private.kandid_guard_anchor_exclusion_register() returns trigger
language plpgsql set search_path = pg_catalog
as $guard$
begin
  raise exception 'Reviewed anchoring exclusions are immutable; separate approval is required.' using errcode='42501';
end;
$guard$;

revoke all on function private.kandid_guard_excluded_ballot() from public,anon,authenticated,service_role;
revoke all on function private.kandid_guard_excluded_ballot_votes() from public,anon,authenticated,service_role;
revoke all on function private.kandid_guard_anchor_exclusion_register() from public,anon,authenticated,service_role;

create trigger kandid_preserve_excluded_ballot before update or delete on public.vote_ballots
for each row execute function private.kandid_guard_excluded_ballot();
create trigger kandid_preserve_excluded_ballot_votes before insert or update or delete on public.votes
for each row execute function private.kandid_guard_excluded_ballot_votes();
create trigger kandid_preserve_anchor_exclusion_register before update or delete on private.ballot_anchor_exclusions
for each row execute function private.kandid_guard_anchor_exclusion_register();
create trigger kandid_preserve_anchor_exclusion_register_truncate before truncate on private.ballot_anchor_exclusions
for each statement execute function private.kandid_guard_anchor_exclusion_register();

-- CLAIM_FUNCTIONS: unchanged reviewed definitions except a UUID anti-join before LIMIT.

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
  where not exists (select 1 from private.ballot_anchor_exclusions e where e.ballot_id = b.id)
    and b.hash_version = 'KANDID_BALLOT_V1'
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
  where not exists (select 1 from private.ballot_anchor_exclusions e where e.ballot_id = b.id)
    and b.hash_version = 'KANDID_BALLOT_V1'
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

-- Preserve the existing service-only RPC execution contract.
revoke all on function public.claim_next_ballot_anchor() from public,anon,authenticated;
revoke all on function public.claim_next_submitted_ballot_anchor() from public,anon,authenticated;
grant execute on function public.claim_next_ballot_anchor() to service_role;
grant execute on function public.claim_next_submitted_ballot_anchor() to service_role;
commit;
