begin;

-- Final Officers access cutover. Apply only after officers-contract and the
-- frontend using that contract and officer_directory are deployed and tested.
-- B1 intentionally retained the legacy access needed by the older frontend.

alter table public.officers enable row level security;

-- Remove every policy on this table, including legacy names not represented
-- in tracked migration history. The approved final model has no browser table
-- access; trusted management goes through officers-contract.
do $drop_officer_policies$
declare
  policy_row record;
begin
  for policy_row in
    select p.policyname
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'officers'
  loop
    execute pg_catalog.format(
      'drop policy %I on public.officers',
      policy_row.policyname
    );
  end loop;
end;
$drop_officer_policies$;

-- PUBLIC includes future anon/authenticated callers unless separately
-- granted. Explicit role revokes document and enforce the browser boundary.
revoke all privileges on table public.officers
  from public, anon, authenticated;

-- Preserve only the trusted server-side table/sequence path. Browser code no
-- longer needs officers_id_seq after the contract cutover.
grant all privileges on table public.officers to service_role;

do $officer_sequence_lockdown$
declare
  sequence_name text := pg_catalog.pg_get_serial_sequence('public.officers', 'id');
begin
  if sequence_name is not null then
    execute pg_catalog.format(
      'revoke all privileges on sequence %s from public, anon, authenticated',
      sequence_name
    );
    execute pg_catalog.format(
      'grant usage, select, update on sequence %s to service_role',
      sequence_name
    );
  end if;
end;
$officer_sequence_lockdown$;

-- Keep the deliberately limited public/student display surface.
revoke all privileges on table public.officer_directory
  from public, anon, authenticated;
grant select on table public.officer_directory to anon, authenticated;

notify pgrst, 'reload schema';
commit;
