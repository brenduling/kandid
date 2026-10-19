begin;

do $preflight$
declare
  function_owner name;
  function_security_definer boolean;
begin
  if to_regprocedure('public.enroll_existing_student_for_term_v1(integer,integer,text,integer,boolean)') is null then
    raise exception 'Existing-student term enrollment RPC is missing.';
  end if;

  select owner_role.rolname, procedure_row.prosecdef
    into function_owner, function_security_definer
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_roles owner_role on owner_role.oid = procedure_row.proowner
  where procedure_row.oid = to_regprocedure(
    'public.enroll_existing_student_for_term_v1(integer,integer,text,integer,boolean)'
  );

  if function_owner is distinct from 'postgres' or function_security_definer is distinct from true then
    raise exception 'Existing-student term enrollment RPC owner or SECURITY DEFINER contract differs.';
  end if;
end;
$preflight$;

-- All application tables and the program resolver in this function are
-- schema-qualified. Built-in functions resolve from pg_catalog, so public
-- and temporary schemas are not needed in this SECURITY DEFINER search path.
alter function public.enroll_existing_student_for_term_v1(
  integer, integer, text, integer, boolean
) set search_path = pg_catalog;

-- Browser users invoke the authenticated Edge Functions. Those functions
-- validate the Super Admin or Electoral Board identity, then call this RPC
-- through their service-role client.
revoke all on function public.enroll_existing_student_for_term_v1(
  integer, integer, text, integer, boolean
) from public, anon, authenticated;
grant execute on function public.enroll_existing_student_for_term_v1(
  integer, integer, text, integer, boolean
) to service_role;

do $postflight$
declare
  function_owner name;
  function_security_definer boolean;
  configured_search_path text[];
begin
  select owner_role.rolname, procedure_row.prosecdef, procedure_row.proconfig
    into function_owner, function_security_definer, configured_search_path
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_roles owner_role on owner_role.oid = procedure_row.proowner
  where procedure_row.oid = to_regprocedure(
    'public.enroll_existing_student_for_term_v1(integer,integer,text,integer,boolean)'
  );

  if function_owner is distinct from 'postgres'
     or function_security_definer is distinct from true
     or configured_search_path is distinct from array['search_path=pg_catalog']::text[] then
    raise exception 'Existing-student enrollment RPC owner, SECURITY DEFINER, or search-path postflight failed.';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.enroll_existing_student_for_term_v1(integer,integer,text,integer,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.enroll_existing_student_for_term_v1(integer,integer,text,integer,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.enroll_existing_student_for_term_v1(integer,integer,text,integer,boolean)',
       'EXECUTE'
     ) then
    raise exception 'Existing-student enrollment RPC execution grants do not match the trusted service-role contract.';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
commit;
