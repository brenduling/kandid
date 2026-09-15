begin;

alter table public.positions
  add column if not exists status text;

update public.positions
set status = 'active'
where status is null;

alter table public.positions
  alter column status set default 'active';

alter table public.positions
  alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'positions_status_check'
      and conrelid = 'public.positions'::regclass
  ) then
    alter table public.positions
      add constraint positions_status_check
      check (status in ('active', 'retired'));
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
