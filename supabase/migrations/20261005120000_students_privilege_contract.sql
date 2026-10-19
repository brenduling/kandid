begin;

-- Remove every pre-existing student policy, including permissive ALL policies,
-- then grant authenticated users only the safe directory/profile columns.
do $block$
declare policy_row record;
begin
  for policy_row in
    select p.policyname
    from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'students'
  loop
    execute pg_catalog.format('drop policy %I on public.students', policy_row.policyname);
  end loop;
end;
$block$;

revoke all on table public.students from public, anon, authenticated;
revoke all (id, student_number, first_name, last_name, email, password,
  program, year_level, is_shs, status, created_at, photo_url, precinct_code,
  batch_code, auth_user_id) on table public.students from public, anon, authenticated;
grant select (id, first_name, last_name, program, year_level, is_shs,
  status, created_at, photo_url)
  on table public.students to authenticated;

revoke all on sequence public.students_id_seq from public, anon, authenticated;

alter table public.students enable row level security;
create policy students_safe_authenticated_reads
on public.students
for select
to authenticated
using (
  (auth.uid() is not null and exists (
    select 1
    from public.admin_users a
    where a.auth_user_id = auth.uid()
      and a.status = 'active'
      and a.role = 'super_admin'
  ))
  or (auth.uid() is not null and students.auth_user_id = auth.uid() and students.status = 'active')
  or (auth.uid() is not null and exists (
    select 1 from public.candidates c where c.student_id = students.id
  ))
);

do $verify$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if pg_catalog.has_table_privilege(role_name, 'public.students', 'INSERT')
       or pg_catalog.has_table_privilege(role_name, 'public.students', 'UPDATE')
       or pg_catalog.has_table_privilege(role_name, 'public.students', 'DELETE')
       or pg_catalog.has_table_privilege(role_name, 'public.students', 'TRUNCATE')
       or pg_catalog.has_table_privilege(role_name, 'public.students', 'REFERENCES')
       or pg_catalog.has_table_privilege(role_name, 'public.students', 'TRIGGER')
       or exists (
         select 1
         from pg_catalog.pg_attribute a
         where a.attrelid = 'public.students'::regclass
           and a.attnum > 0
           and not a.attisdropped
           and (
             pg_catalog.has_column_privilege(role_name, 'public.students', a.attname, 'INSERT')
             or pg_catalog.has_column_privilege(role_name, 'public.students', a.attname, 'UPDATE')
             or pg_catalog.has_column_privilege(role_name, 'public.students', a.attname, 'REFERENCES')
           )
       )
       or pg_catalog.has_column_privilege(role_name, 'public.students', 'password', 'SELECT')
       or pg_catalog.has_column_privilege(role_name, 'public.students', 'auth_user_id', 'SELECT')
       or pg_catalog.has_column_privilege(role_name, 'public.students', 'student_number', 'SELECT')
       or pg_catalog.has_column_privilege(role_name, 'public.students', 'email', 'SELECT')
       or pg_catalog.has_sequence_privilege(role_name, 'public.students_id_seq', 'USAGE')
       or pg_catalog.has_sequence_privilege(role_name, 'public.students_id_seq', 'SELECT')
       or pg_catalog.has_sequence_privilege(role_name, 'public.students_id_seq', 'UPDATE') then
      raise exception 'Students browser privilege contract failed for role %.', role_name;
    end if;
  end loop;
  if pg_catalog.has_table_privilege('anon', 'public.students', 'SELECT')
     or pg_catalog.has_column_privilege('anon', 'public.students', 'student_number', 'SELECT') then
    raise exception 'Anonymous Student table reads remain available.';
  end if;
  if not pg_catalog.has_column_privilege('authenticated', 'public.students', 'first_name', 'SELECT')
     or not pg_catalog.has_column_privilege('authenticated', 'public.students', 'status', 'SELECT') then
    raise exception 'Required authenticated safe Student reads were not granted.';
  end if;
  if not pg_catalog.has_table_privilege('service_role', 'public.students', 'UPDATE') then
    raise exception 'Required service_role student UPDATE access was not preserved.';
  end if;
  if pg_catalog.has_table_privilege('service_role', 'public.students', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.students', 'DELETE') then
    raise exception 'Unexpected broad service_role Student INSERT/DELETE access exists.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'students' and p.cmd = 'ALL'
  ) then
    raise exception 'A permissive ALL policy remains on public.students.';
  end if;
end;
$verify$;

notify pgrst, 'reload schema';

commit;
