grant usage on schema public to anon, authenticated;

grant select, insert, update, delete
  on table public.programs
  to anon, authenticated;

grant select, insert, update, delete
  on table public.organization_programs
  to anon, authenticated;

grant usage, select
  on sequence public.programs_id_seq
  to anon, authenticated;

notify pgrst, 'reload schema';
