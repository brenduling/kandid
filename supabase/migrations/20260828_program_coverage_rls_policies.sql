alter table public.programs enable row level security;
alter table public.organization_programs enable row level security;

drop policy if exists "Programs are readable by app users"
  on public.programs;
drop policy if exists "Programs are manageable by app users"
  on public.programs;
drop policy if exists "Organization program coverage is readable by app users"
  on public.organization_programs;
drop policy if exists "Organization program coverage is manageable by app users"
  on public.organization_programs;

-- KANDID currently stores signed-in role state in application tables/local
-- session data, not Supabase Auth claims. These policies therefore permit the
-- anon/authenticated client to manage only the new coverage lookup tables so
-- existing Super Admin and Electoral Board screens can function.
create policy "Programs are readable by app users"
  on public.programs
  for select
  to anon, authenticated
  using (true);

create policy "Programs are manageable by app users"
  on public.programs
  for all
  to anon, authenticated
  using (true)
  with check (true);

create policy "Organization program coverage is readable by app users"
  on public.organization_programs
  for select
  to anon, authenticated
  using (true);

create policy "Organization program coverage is manageable by app users"
  on public.organization_programs
  for all
  to anon, authenticated
  using (true)
  with check (true);

notify pgrst, 'reload schema';
