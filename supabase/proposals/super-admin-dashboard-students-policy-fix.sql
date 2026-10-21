-- Narrow production proposal: repair the students SELECT policy's candidate
-- lookup without granting authenticated users SELECT on public.candidates.
-- Target project identity must be verified out of band before execution.
-- This file is intentionally outside supabase/migrations and is NOT applied.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog;

do $preflight$
declare
  students_policy text;
  students_policy_normalized text;
  admin_helper_owner text;
  admin_helper_security_definer boolean;
  admin_helper_config text[];
  relation_drift boolean;
begin
  if current_user <> 'postgres' then
    raise exception 'Reviewed postgres executor required.';
  end if;
  if to_regclass('public.students') is null
     or to_regclass('public.candidates') is null
     or to_regclass('public.admin_users') is null
     or to_regclass('public.positions') is null
     or to_regclass('public.elections') is null
     or to_regnamespace('private') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception 'Required Kandid schemas or relations differ from the reviewed baseline.';
  end if;

  select pg_get_expr(p.polqual, p.polrelid)
    into students_policy
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'students'
    and p.polname = 'students_release_safe_select'
    and p.polcmd = 'r'
    and p.polroles = array[(select oid from pg_roles where rolname = 'authenticated')];

  if students_policy is null then
    raise exception 'The students policy/RLS baseline differs; inspect before changing it.';
  end if;
  students_policy_normalized := lower(regexp_replace(students_policy, '\s+', ' ', 'g'));
  -- pg_get_expr may qualify public.candidates under the pinned search_path.
  -- Accept either rendering of this exact relation and alias, not other schemas.
  if students_policy_normalized !~ '(^|[^a-z0-9_])from (public\.)?candidates c([^a-z0-9_]|$)'
     or position('a.auth_user_id = auth.uid()' in students_policy_normalized) = 0
     or position('a.role)::text = ''super_admin''' in students_policy_normalized) = 0
     or position('a.status)::text = ''active''' in students_policy_normalized) = 0
     or regexp_count(students_policy_normalized, 'auth_user_id\s*=\s*auth\.uid\(\)') < 2
     or position('status)::text = ''active''' in students_policy_normalized) = 0
     or position('auth.uid() is not null' in students_policy_normalized) = 0
     or not (select relrowsecurity from pg_class where oid = 'public.students'::regclass) then
    raise exception 'The students policy/RLS baseline differs; inspect before changing it.';
  end if;
  if to_regprocedure('private.kandid_board_can_read_candidate_student(integer)') is not null then
    raise exception 'Candidate-access helper already exists; inspect instead of replacing it.';
  end if;
  select exists (
    select 1
    from (values
      ('students'), ('candidates'), ('admin_users'), ('positions'), ('elections')
    ) expected(relname)
    left join pg_class c
      on c.relnamespace = 'public'::regnamespace
     and c.relname = expected.relname
    left join pg_roles r on r.oid = c.relowner
    where c.oid is null
       or r.rolname is distinct from 'postgres'
       or c.relrowsecurity is distinct from true
       or c.relforcerowsecurity is distinct from false
  ) into relation_drift;
  if relation_drift then
    raise exception 'Authorization relation ownership or RLS metadata differs from the reviewed baseline.';
  end if;
  if has_table_privilege('authenticated', 'public.candidates', 'SELECT') then
    raise exception 'Authenticated candidate SELECT privilege differs from the reviewed baseline.';
  end if;
  if has_schema_privilege('authenticated', 'private', 'USAGE')
     or exists (
       select 1
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private'
         and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
           or has_function_privilege('anon', p.oid, 'EXECUTE'))
     ) then
    raise exception 'Private-schema grants differ from the reviewed baseline; inspect before changing them.';
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
    raise exception 'Direct private-schema relation grants differ from the reviewed baseline.';
  end if;

  select pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    into admin_helper_owner, admin_helper_security_definer, admin_helper_config
  from pg_proc p
  where p.oid = to_regprocedure('private.kandid_active_admin_can_access_organization(bigint)');

  if admin_helper_owner is distinct from 'postgres'
     or admin_helper_security_definer is distinct from true
     or not ('search_path=pg_catalog' = any(coalesce(admin_helper_config, array[]::text[]))) then
    raise exception 'Existing organization-authorization helper differs from the reviewed SECURITY DEFINER baseline.';
  end if;
  if not pg_catalog.has_column_privilege('authenticated', 'public.students', 'id', 'SELECT')
     or not pg_catalog.has_column_privilege('authenticated', 'public.students', 'program', 'SELECT')
     or not pg_catalog.has_column_privilege('authenticated', 'public.students', 'status', 'SELECT') then
    raise exception 'Required column privileges differ from the reviewed baseline.';
  end if;
end;
$preflight$;

create function private.kandid_board_can_read_candidate_student(
  p_student_id integer
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select auth.uid() is not null
    and p_student_id is not null
    and exists (
      select 1
      from public.admin_users a
      join public.candidates c on c.student_id = p_student_id
      join public.positions p on p.id = c.position_id
      join public.elections e on e.id = p.election_id
      where a.auth_user_id = auth.uid()
        and a.role = 'electoral_board'
        and a.status = 'active'
        and a.organization_id = e.organization_id
        and private.kandid_active_admin_can_access_organization(e.organization_id)
    );
$function$;
alter function private.kandid_board_can_read_candidate_student(integer) owner to postgres;
revoke all on function private.kandid_board_can_read_candidate_student(integer)
  from public, anon, authenticated, service_role;

-- The private schema is not configured as an API schema locally; production
-- deployment must separately confirm it is not exposed through PostgREST.
grant usage on schema private to authenticated;
grant execute on function private.kandid_board_can_read_candidate_student(integer)
  to authenticated;

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
  or private.kandid_board_can_read_candidate_student(students.id)
);

do $postflight$
declare
  students_policy text;
  students_policy_normalized text;
  helper_owner text;
  helper_security_definer boolean;
  helper_config text[];
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

  select pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    into helper_owner, helper_security_definer, helper_config
  from pg_proc p
  where p.oid = to_regprocedure('private.kandid_board_can_read_candidate_student(integer)');

  students_policy_normalized := lower(regexp_replace(coalesce(students_policy, ''), '\s+', ' ', 'g'));

  if helper_owner is distinct from 'postgres'
     or helper_security_definer is distinct from true
     or not ('search_path=pg_catalog' = any(coalesce(helper_config, array[]::text[])))
     or not has_schema_privilege('authenticated', 'private', 'USAGE')
     or not has_function_privilege('authenticated', 'private.kandid_board_can_read_candidate_student(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'private.kandid_board_can_read_candidate_student(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.kandid_active_admin_can_access_organization(bigint)', 'EXECUTE')
     or position('kandid_board_can_read_candidate_student' in students_policy_normalized) = 0
     or position('a.auth_user_id = auth.uid()' in students_policy_normalized) = 0
     or position('a.role)::text = ''super_admin''' in students_policy_normalized) = 0
     or position('a.status)::text = ''active''' in students_policy_normalized) = 0
     or regexp_count(students_policy_normalized, 'auth_user_id\s*=\s*auth\.uid\(\)') < 2
     or position('status)::text = ''active''' in students_policy_normalized) = 0
     or has_table_privilege('authenticated', 'public.candidates', 'SELECT') then
    raise exception 'Post-install authorization guards did not match the reviewed contract.';
  end if;
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.oid <> to_regprocedure('private.kandid_board_can_read_candidate_student(integer)')
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('anon', p.oid, 'EXECUTE'))
  ) or exists (
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
    raise exception 'Unexpected private-schema object grants were detected after installation.';
  end if;
end;
$postflight$;

commit;
