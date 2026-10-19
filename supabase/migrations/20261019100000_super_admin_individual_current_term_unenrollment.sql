begin;

do $preflight$
declare
  status_check text;
begin
  if to_regclass('public.students') is null
     or to_regclass('public.student_term_enrollments') is null
     or to_regclass('public.academic_terms') is null
     or to_regclass('public.admin_users') is null
     or to_regclass('public.audit_logs') is null
     or to_regprocedure('public.kandid_audit_category_for_event(text)') is null
     or to_regprocedure('public.enroll_existing_student_for_term_v1(integer,integer,text,integer,boolean)') is null
     or to_regprocedure('public.resolve_student_organization_participation(integer,integer,integer)') is null then
    raise exception 'Required Student enrollment or audit contract is missing.';
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
    raise exception 'Trusted re-enrollment execution contract differs.';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.resolve_student_organization_participation(integer,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'Current-term organization eligibility resolver is unavailable to trusted server operations.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.student_term_enrollments'::regclass
      and a.attname = 'enrollment_status' and not a.attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.student_term_enrollments'::regclass
      and a.attname = 'source' and not a.attisdropped
  ) then
    raise exception 'Student term enrollment columns differ from the reviewed contract.';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_constraintdef(c.oid)) into status_check
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.student_term_enrollments'::regclass
    and c.conname = 'student_term_enrollments_status_check'
    and c.contype = 'c';
  if status_check is null
     or position('enrolled' in status_check) = 0
     or position('not_in_masterlist' in status_check) = 0 then
    raise exception 'Existing unenrolled status is not supported by the enrollment constraint.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.student_term_enrollments'::regclass
      and c.contype = 'u'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%(student_id, academic_term_id)%'
  ) then
    raise exception 'Student-term enrollment uniqueness contract is missing.';
  end if;
end;
$preflight$;

create or replace function public.kandid_super_admin_unenroll_student_for_current_term(
  p_actor_admin_id bigint,
  p_student_id integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor_row public.admin_users%rowtype;
  active_term_count integer;
  active_term_id integer;
  enrollment_id integer;
  enrollment_status_value text;
  student_found boolean;
begin
  select a.* into actor_row
  from public.admin_users a
  where a.id = p_actor_admin_id
    and a.role = 'super_admin'
    and a.status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'Active Super Admin authorization is required.';
  end if;

  if p_student_id is null or p_student_id <= 0 then
    raise exception using errcode = '22023', message = 'A valid Student record is required.';
  end if;

  -- Lock the active-term row(s) while counting so term activation cannot race
  -- the single-Student transition.
  perform 1 from public.academic_terms t where t.status = 'active' for share;
  select pg_catalog.count(*)::integer, pg_catalog.min(t.id)
    into active_term_count, active_term_id
  from public.academic_terms t
  where t.status = 'active';
  if active_term_count <> 1 then
    raise exception using errcode = '55000', message = 'Exactly one active academic term is required.';
  end if;

  select true into student_found
  from public.students s
  where s.id = p_student_id
  for update;
  if not coalesce(student_found, false) then
    raise exception using errcode = 'P0002', message = 'Student record was not found.';
  end if;

  select ste.id, ste.enrollment_status
    into enrollment_id, enrollment_status_value
  from public.student_term_enrollments ste
  where ste.student_id = p_student_id
    and ste.academic_term_id = active_term_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Current-term enrollment was not found.';
  end if;

  if enrollment_status_value = 'not_in_masterlist' then
    return pg_catalog.jsonb_build_object(
      'outcome', 'ALREADY_UNENROLLED_CURRENT_TERM',
      'student_id', p_student_id,
      'academic_term_id', active_term_id,
      'enrollment_status', 'not_in_masterlist'
    );
  end if;
  if enrollment_status_value <> 'enrolled' then
    raise exception using errcode = '55000', message = 'Current-term enrollment status is unsupported.';
  end if;

  -- Keep the existing enrollment row, program, provenance, account, membership
  -- records, and election evidence. All current participation resolvers require
  -- enrollment_status = enrolled, so this status transition denies eligibility.
  update public.student_term_enrollments ste
  set enrollment_status = 'not_in_masterlist',
      updated_at = pg_catalog.clock_timestamp()
  where ste.id = enrollment_id;

  insert into public.audit_logs (
    user_id, actor_name, actor_role, action, event_type, event_category,
    entity_type, entity_id, entity_label, status, event_origin, metadata
  ) values (
    actor_row.id, actor_row.full_name, actor_row.role,
    'student_term_unenrolled', 'student_term_unenrolled',
    public.kandid_audit_category_for_event('student_term_unenrolled'),
    'student', p_student_id::text, 'Student #' || p_student_id::text,
    'completed', 'trusted_server',
    pg_catalog.jsonb_build_object(
      'academic_term_id', active_term_id,
      'enrollment_status', 'not_in_masterlist'
    )
  );

  return pg_catalog.jsonb_build_object(
    'outcome', 'UNENROLLED_CURRENT_TERM',
    'student_id', p_student_id,
    'academic_term_id', active_term_id,
    'enrollment_status', 'not_in_masterlist'
  );
end;
$function$;

alter function public.kandid_super_admin_unenroll_student_for_current_term(bigint, integer) owner to postgres;
revoke all on function public.kandid_super_admin_unenroll_student_for_current_term(bigint, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_super_admin_unenroll_student_for_current_term(bigint, integer)
  to service_role;
comment on function public.kandid_super_admin_unenroll_student_for_current_term(bigint, integer) is
  'Idempotently marks one Student unenrolled in the unique active term; preserves identity and historical records and independently verifies the active Super Admin actor.';

do $postflight$
declare
  target_oid oid := pg_catalog.to_regprocedure(
    'public.kandid_super_admin_unenroll_student_for_current_term(bigint,integer)'
  );
  security_definer boolean;
  owner_name text;
  function_config text[];
begin
  if target_oid is null then
    raise exception 'Trusted individual unenrollment function was not installed.';
  end if;
  select p.prosecdef, r.rolname, p.proconfig
    into security_definer, owner_name, function_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where p.oid = target_oid;
  if not security_definer or owner_name <> 'postgres'
     or not ('search_path=pg_catalog' = any(coalesce(function_config, array[]::text[]))) then
    raise exception 'Trusted individual unenrollment function security configuration differs.';
  end if;
  if not has_function_privilege('service_role', target_oid, 'EXECUTE')
     or has_function_privilege('anon', target_oid, 'EXECUTE')
     or has_function_privilege('authenticated', target_oid, 'EXECUTE') then
    raise exception 'Trusted individual unenrollment execute grants differ.';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_proc p,
         lateral pg_catalog.aclexplode(
           coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) acl
    where p.oid = target_oid
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC can execute the trusted individual unenrollment function.';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
commit;
