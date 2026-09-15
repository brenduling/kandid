alter table public.positions
  add column if not exists status text not null default 'active';

update public.positions
set status = 'active'
where status is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'positions_status_check'
  ) then
    alter table public.positions
      add constraint positions_status_check
      check (status in ('active', 'retired'));
  end if;
end $$;

create index if not exists positions_status_idx
  on public.positions(status);

notify pgrst, 'reload schema';
