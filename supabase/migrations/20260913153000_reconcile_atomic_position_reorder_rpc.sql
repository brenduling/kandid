begin;

alter table public.positions
  drop constraint if exists positions_election_display_order_unique;

alter table public.positions
  add constraint positions_election_display_order_unique
  unique (election_id, display_order)
  deferrable initially immediate;

create or replace function public.reorder_election_positions(
  p_election_id integer,
  p_position_ids integer[],
  p_display_orders integer[]
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  requested_count integer;
  matched_count integer;
begin
  if p_election_id is null then
    raise exception 'Election is required.';
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
$$;

revoke execute on function public.reorder_election_positions(integer, integer[], integer[])
  from public;

grant execute on function public.reorder_election_positions(integer, integer[], integer[])
  to authenticated;

notify pgrst, 'reload schema';

commit;
