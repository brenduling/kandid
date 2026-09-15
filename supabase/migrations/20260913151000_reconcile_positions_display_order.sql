begin;

alter table public.positions
  add column if not exists display_order integer;

with ranked_positions as (
  select
    p.id,
    row_number() over (
      partition by p.election_id
      order by
        case
          when n.normalized_name = 'president' then 10
          when n.normalized_name = 'vice president' then 20
          when n.normalized_name = 'secretary' then 30
          when n.normalized_name in (
            'assistant secretary',
            'asst secretary'
          ) then 40
          when n.normalized_name = 'treasurer' then 50
          when n.normalized_name = 'auditor' then 60
          when n.normalized_name in (
            'pio',
            'public information officer'
          ) then 70
          else 1000
        end,
        n.normalized_name,
        p.id
    )::integer as next_display_order
  from public.positions p
  cross join lateral (
    select regexp_replace(
      regexp_replace(
        lower(btrim(coalesce(p.name, ''))),
        '[^a-z0-9]+',
        ' ',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    ) as normalized_name
  ) n
)
update public.positions p
set display_order = ranked_positions.next_display_order
from ranked_positions
where p.id = ranked_positions.id
  and p.display_order is null;

alter table public.positions
  alter column display_order set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'positions_display_order_positive'
      and conrelid = 'public.positions'::regclass
  ) then
    alter table public.positions
      add constraint positions_display_order_positive
      check (display_order > 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'positions_election_display_order_unique'
      and conrelid = 'public.positions'::regclass
  ) then
    alter table public.positions
      add constraint positions_election_display_order_unique
      unique (election_id, display_order);
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
