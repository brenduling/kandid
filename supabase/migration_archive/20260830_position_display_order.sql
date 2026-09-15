alter table public.positions
  add column if not exists display_order integer;

with ordered_positions as (
  select
    id,
    row_number() over (
      partition by election_id
      order by id asc
    ) as inferred_order
  from public.positions
)
update public.positions p
set display_order = ordered_positions.inferred_order
from ordered_positions
where p.id = ordered_positions.id
  and p.display_order is null;

alter table public.positions
  alter column display_order set default 1;

alter table public.positions
  alter column display_order set not null;

alter table public.positions
  add constraint positions_display_order_positive
  check (display_order > 0);

create unique index if not exists positions_election_display_order_idx
  on public.positions (election_id, display_order);

create index if not exists positions_election_order_lookup_idx
  on public.positions (election_id, display_order, id);
