-- Reviewed local candidate only. Exact-target production installation requires approval.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog;
lock table public.positions in share row exclusive mode;

do $preflight$
begin
  if current_user <> 'postgres' then
    raise exception 'Position-name migration requires the reviewed postgres executor.';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint c
    where c.conrelid='public.positions'::regclass and c.conname='positions_election_display_order_unique'
      and c.contype='u' and c.condeferrable
      and pg_catalog.pg_get_constraintdef(c.oid)='UNIQUE (election_id, display_order) DEFERRABLE') then
    raise exception 'Existing election/display-order constraint differs; stop without changing it.';
  end if;
  if pg_catalog.to_regclass('public.positions_election_normalized_name_unique') is not null then
    raise exception 'Position-name index already exists; inspect it and migration history instead of replaying SQL.';
  end if;
  if exists (select 1 from public.positions where election_id is not null and name is not null
    group by election_id,pg_catalog.lower(pg_catalog.btrim(name::text)) having count(*)>1) then
    raise exception 'Normalized position-name duplicates exist. Stop; no records were renamed or deleted.';
  end if;
end;
$preflight$;

create unique index positions_election_normalized_name_unique
  on public.positions (election_id, pg_catalog.lower(pg_catalog.btrim(name::text)));

commit;
