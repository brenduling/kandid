begin;

-- student_organizations is a legacy structural link table. Current-term
-- participation is served through trusted, term-scoped functions. Browser
-- clients may read only their own structural links, with a Super Admin read
-- path for administrative review; all mutations stay behind trusted RPCs.
do $drop_student_membership_policies$
declare policy_row record;
begin
  for policy_row in
    select p.policyname
    from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'student_organizations'
  loop
    execute pg_catalog.format('drop policy %I on public.student_organizations', policy_row.policyname);
  end loop;
end
$drop_student_membership_policies$;

revoke all privileges on table public.student_organizations from public, anon, authenticated;
grant select (student_id, organization_id, role)
  on table public.student_organizations to authenticated;
alter table public.student_organizations enable row level security;

create or replace function private.kandid_can_read_student_structural_memberships(p_student_id integer)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select auth.uid() is not null and (
    exists (
      select 1 from public.students s
      where s.id = p_student_id
        and s.auth_user_id = auth.uid()
        and s.status = 'active'
    )
    or exists (
      select 1 from public.admin_users a
      where a.auth_user_id = auth.uid()
        and a.role = 'super_admin'
        and a.status = 'active'
    )
  );
$function$;
alter function private.kandid_can_read_student_structural_memberships(integer) owner to postgres;
revoke all on function private.kandid_can_read_student_structural_memberships(integer) from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.kandid_can_read_student_structural_memberships(integer) to authenticated;

create policy student_organizations_own_student_or_super_admin_read
on public.student_organizations
for select
to authenticated
using (private.kandid_can_read_student_structural_memberships(student_id));

do $verify_student_membership_privileges$
begin
  if pg_catalog.has_table_privilege('anon', 'public.student_organizations', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.student_organizations', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.student_organizations', 'UPDATE')
     or pg_catalog.has_table_privilege('anon', 'public.student_organizations', 'DELETE')
     or pg_catalog.has_table_privilege('authenticated', 'public.student_organizations', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.student_organizations', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.student_organizations', 'DELETE')
     or pg_catalog.has_column_privilege('authenticated', 'public.student_organizations', 'student_id', 'INSERT')
     or pg_catalog.has_column_privilege('authenticated', 'public.student_organizations', 'organization_id', 'UPDATE')
     or exists (
       select 1 from pg_catalog.pg_policies p
       where p.schemaname = 'public'
         and p.tablename = 'student_organizations'
         and p.cmd <> 'SELECT'
     ) then
    raise exception 'Student structural membership browser privilege contract failed.';
  end if;
  if not pg_catalog.has_column_privilege('authenticated', 'public.student_organizations', 'student_id', 'SELECT')
     or not pg_catalog.has_column_privilege('authenticated', 'public.student_organizations', 'organization_id', 'SELECT') then
    raise exception 'Required authenticated own-membership columns were not granted.';
  end if;
end
$verify_student_membership_privileges$;

notify pgrst, 'reload schema';
commit;
