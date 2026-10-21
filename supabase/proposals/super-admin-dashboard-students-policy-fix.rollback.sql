-- Exact rollback for super-admin-dashboard-students-policy-fix.sql.
-- This restores the captured production policy and therefore restores the
-- original dashboard 42501 failure. Do not use as a substitute for fix-forward
-- unless the new policy causes an authorization or availability regression.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog;

do $preflight$
declare
  students_policy text;
  students_policy_normalized text;
  helper_owner text;
  helper_security_definer boolean;
  helper_config text[];
begin
  if current_user <> 'postgres' then
    raise exception 'Reviewed postgres executor required.';
  end if;

  select pg_get_expr(p.polqual, p.polrelid)
    into students_policy
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'students'
    and p.polname = 'students_release_safe_select'
    and p.polcmd = 'r';

  select pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    into helper_owner, helper_security_definer, helper_config
  from pg_proc p
  where p.oid = to_regprocedure('private.kandid_board_can_read_candidate_student(integer)');

  students_policy_normalized := lower(regexp_replace(coalesce(students_policy, ''), '\s+', ' ', 'g'));

  if position('kandid_board_can_read_candidate_student' in students_policy_normalized) = 0
     or position('a.auth_user_id = auth.uid()' in students_policy_normalized) = 0
     or position('a.role)::text = ''super_admin''' in students_policy_normalized) = 0
     or position('a.status)::text = ''active''' in students_policy_normalized) = 0
     or regexp_count(students_policy_normalized, 'auth_user_id\s*=\s*auth\.uid\(\)') < 2
     or position('status)::text = ''active''' in students_policy_normalized) = 0
     or students_policy_normalized ~ '(^|[^a-z0-9_])from (public\.)?candidates c([^a-z0-9_]|$)'
     or helper_owner is distinct from 'postgres'
     or helper_security_definer is distinct from true
     or not ('search_path=pg_catalog' = any(coalesce(helper_config, array[]::text[])))
     or not has_schema_privilege('authenticated', 'private', 'USAGE')
     or not has_function_privilege('authenticated', 'private.kandid_board_can_read_candidate_student(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'private.kandid_board_can_read_candidate_student(integer)', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.candidates', 'SELECT') then
    raise exception 'Installed correction differs from the reviewed rollback baseline.';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.oid <> to_regprocedure('private.kandid_board_can_read_candidate_student(integer)')
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('anon', p.oid, 'EXECUTE'))
  ) then
    raise exception 'Other private-function grants changed; preserve them and review rollback manually.';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(privilege)
    where n.nspname = 'private'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (has_table_privilege('authenticated', c.oid, p.privilege)
        or has_table_privilege('anon', c.oid, p.privilege))
  ) or exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) p(privilege)
    where n.nspname = 'private'
      and c.relkind = 'S'
      and (has_sequence_privilege('authenticated', c.oid, p.privilege)
        or has_sequence_privilege('anon', c.oid, p.privilege))
  ) then
    raise exception 'Other private-schema object grants changed; preserve them and review rollback manually.';
  end if;
end;
$preflight$;

drop policy students_release_safe_select on public.students;
create policy students_release_safe_select
on public.students for select to authenticated
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

revoke execute on function private.kandid_board_can_read_candidate_student(integer)
  from authenticated;
drop function private.kandid_board_can_read_candidate_student(integer);
revoke usage on schema private from authenticated;

do $postflight$
declare
  students_policy text;
  students_policy_normalized text;
begin
  select pg_get_expr(p.polqual, p.polrelid)
    into students_policy
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'students'
    and p.polname = 'students_release_safe_select'
    and p.polcmd = 'r';

  students_policy_normalized := lower(regexp_replace(coalesce(students_policy, ''), '\s+', ' ', 'g'));

  if to_regprocedure('private.kandid_board_can_read_candidate_student(integer)') is not null
     or has_schema_privilege('authenticated', 'private', 'USAGE')
     or students_policy_normalized !~ '(^|[^a-z0-9_])from (public\.)?candidates c([^a-z0-9_]|$)'
     or position('a.auth_user_id = auth.uid()' in students_policy_normalized) = 0
     or position('a.role)::text = ''super_admin''' in students_policy_normalized) = 0
     or position('a.status)::text = ''active''' in students_policy_normalized) = 0
     or regexp_count(students_policy_normalized, 'auth_user_id\s*=\s*auth\.uid\(\)') < 2
     or position('status)::text = ''active''' in students_policy_normalized) = 0 then
    raise exception 'Rollback did not restore the captured baseline.';
  end if;
end;
$postflight$;

commit;
