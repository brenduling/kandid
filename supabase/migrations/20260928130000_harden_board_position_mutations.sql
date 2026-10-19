begin;

-- Resolve an election's mutability from trusted identity and election data.
-- Schedule columns are timestamp without time zone and represent Manila wall
-- time, matching the existing trusted campaign RPC convention.
create or replace function public.kandid_can_mutate_election_positions(
  p_election_id integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  election_row record;
  election_status text;
  now_manila timestamp without time zone;
begin
  if caller_uid is null or p_election_id is null then
    return false;
  end if;

  -- Board identity comes from the authenticated UUID and the active
  -- admin_users assignment. Super Admin retains its existing global scope.
  -- Locking the election row serializes a position mutation against a
  -- concurrent status or schedule change.
  select
    e.id,
    e.organization_id,
    e.status,
    e.campaign_start,
    e.campaign_end,
    e.start_date,
    e.end_date
  into election_row
  from public.elections e
  where e.id = p_election_id
    and (
      exists (
        select 1
        from public.admin_users a
        where a.auth_user_id = caller_uid
          and a.role = 'super_admin'
          and a.status = 'active'
      )
      or exists (
        select 1
        from public.admin_users a
        where a.auth_user_id = caller_uid
          and a.role = 'electoral_board'
          and a.status = 'active'
          and a.organization_id = e.organization_id
      )
    )
  for share of e;

  if not found then
    return false;
  end if;

  election_status := coalesce(election_row.status, 'draft');

  -- Match getElectionPhase()/the Board closed-phase guard: draft takes
  -- precedence; closed, archived, and the explicitly handled legacy `done`
  -- state are immutable.
  if election_status = 'draft' then
    return true;
  end if;

  if lower(election_status) in ('closed', 'archived', 'done') then
    return false;
  end if;

  now_manila := pg_catalog.timezone(
    'Asia/Manila',
    pg_catalog.clock_timestamp()
  );

  -- Keep the same precedence and half-open schedule boundaries as
  -- src/utils/elections.js. The remaining time-derived phases are editable.
  if election_row.campaign_start is not null
     and election_row.campaign_end is not null
     and now_manila < election_row.campaign_start then
    return true;
  end if;

  if election_row.campaign_start is not null
     and election_row.campaign_end is not null
     and now_manila >= election_row.campaign_start
     and now_manila < election_row.campaign_end then
    return true;
  end if;

  if election_row.campaign_end is not null
     and election_row.start_date is not null
     and now_manila >= election_row.campaign_end
     and now_manila < election_row.start_date then
    return true;
  end if;

  if election_row.start_date is not null
     and election_row.end_date is not null
     and now_manila >= election_row.start_date
     and now_manila < election_row.end_date then
    return true;
  end if;

  if election_row.end_date is not null
     and now_manila >= election_row.end_date then
    return false;
  end if;

  -- Active without a schedule resolves to the existing `active` fallback
  -- phase. Unknown raw states fail closed unless their schedule already
  -- resolved to a known editable phase above.
  return election_status = 'active';
end;
$function$;

revoke all on function public.kandid_can_mutate_election_positions(integer)
  from public, anon, authenticated;
grant execute on function public.kandid_can_mutate_election_positions(integer)
  to authenticated;

-- Keep the parent election fixed. The current Board update submits the same
-- election_id, so granting that column remains compatible while actual moves
-- are rejected at the database boundary.
create or replace function public.prevent_position_election_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if new.election_id is distinct from old.election_id then
    raise exception using
      errcode = '42501',
      message = 'A position cannot be moved to another election.';
  end if;

  return new;
end;
$function$;

revoke all on function public.prevent_position_election_change()
  from public, anon, authenticated;

drop trigger if exists positions_prevent_election_change
  on public.positions;

create trigger positions_prevent_election_change
before update of election_id on public.positions
for each row
when (old.election_id is distinct from new.election_id)
execute function public.prevent_position_election_change();

-- Replace the unconditional read/write policies with the same public read
-- access and narrowly scoped Board/Super Admin mutation policies.
drop policy if exists "open positions" on public.positions;
drop policy if exists positions_all_access on public.positions;
drop policy if exists positions_public_read on public.positions;
drop policy if exists positions_insert_authorized_election on public.positions;
drop policy if exists positions_update_authorized_election on public.positions;
drop policy if exists positions_delete_authorized_election on public.positions;

alter table public.positions enable row level security;

create policy positions_public_read
on public.positions
for select
to anon, authenticated
using (true);

create policy positions_insert_authorized_election
on public.positions
for insert
to authenticated
with check (public.kandid_can_mutate_election_positions(election_id));

create policy positions_update_authorized_election
on public.positions
for update
to authenticated
using (public.kandid_can_mutate_election_positions(election_id))
with check (public.kandid_can_mutate_election_positions(election_id));

create policy positions_delete_authorized_election
on public.positions
for delete
to authenticated
using (public.kandid_can_mutate_election_positions(election_id));

-- RLS and table privileges are independent gates. Preserve public reads,
-- remove anonymous writes and administrative table privileges, and grant the
-- authenticated app only the columns/actions used by Board position CRUD.
revoke all privileges on table public.positions
  from public, anon, authenticated;

grant select on table public.positions to anon, authenticated;
grant insert (election_id, name, max_votes, display_order)
  on table public.positions to authenticated;
grant update (election_id, name, max_votes, display_order, status)
  on table public.positions to authenticated;
grant delete on table public.positions to authenticated;

revoke all privileges on sequence public.positions_id_seq
  from public, anon, authenticated;
grant usage, select on sequence public.positions_id_seq to authenticated;

-- Retain the atomic ordering checks while applying the same trusted
-- identity/scope/lifecycle rule before any position rows are locked or changed.
create or replace function public.reorder_election_positions(
  p_election_id integer,
  p_position_ids integer[],
  p_display_orders integer[]
)
returns void
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  requested_count integer;
  matched_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if p_election_id is null then
    raise exception 'Election is required.';
  end if;

  if not public.kandid_can_mutate_election_positions(p_election_id) then
    raise exception using errcode = '42501', message = 'Election position changes are not authorized.';
  end if;

  requested_count = coalesce(array_length(p_position_ids, 1), 0);

  if requested_count = 0 then
    raise exception 'At least one position is required.';
  end if;

  if requested_count <> coalesce(array_length(p_display_orders, 1), 0) then
    raise exception 'Position and display order counts must match.';
  end if;

  if exists (
    select 1
    from unnest(p_position_ids, p_display_orders) as requested(position_id, display_order)
    where requested.position_id is null
       or requested.display_order is null
       or requested.display_order <= 0
  ) then
    raise exception 'Position IDs and display orders must be positive.';
  end if;

  if exists (
    select 1
    from unnest(p_position_ids) as requested(position_id)
    group by requested.position_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate position IDs are not allowed.';
  end if;

  if exists (
    select 1
    from unnest(p_display_orders) as requested(display_order)
    group by requested.display_order
    having count(*) > 1
  ) then
    raise exception 'Duplicate display orders are not allowed.';
  end if;

  perform pg_advisory_xact_lock(0, p_election_id);

  set constraints positions_election_display_order_unique deferred;

  with requested as (
    select *
    from unnest(p_position_ids, p_display_orders) as requested_row(position_id, display_order)
  ),
  locked_positions as (
    select p.id
    from public.positions p
    join requested r
      on r.position_id = p.id
    where p.election_id = p_election_id
    for update
  )
  select count(*)
    into matched_count
  from locked_positions;

  if matched_count <> requested_count then
    raise exception 'All reordered positions must belong to the selected election.';
  end if;

  if exists (
    select 1
    from unnest(p_position_ids, p_display_orders) as requested(position_id, display_order)
    join public.positions p
      on p.election_id = p_election_id
     and p.display_order = requested.display_order
     and p.id <> requested.position_id
    where not (p.id = any(p_position_ids))
  ) then
    raise exception 'Display order conflicts with another position in this election.';
  end if;

  update public.positions p
  set display_order = requested.display_order
  from unnest(p_position_ids, p_display_orders) as requested(position_id, display_order)
  where p.id = requested.position_id
    and p.election_id = p_election_id;
end;
$function$;

revoke all on function public.reorder_election_positions(integer, integer[], integer[])
  from public, anon, authenticated;
grant execute on function public.reorder_election_positions(integer, integer[], integer[])
  to authenticated;

notify pgrst, 'reload schema';

commit;
