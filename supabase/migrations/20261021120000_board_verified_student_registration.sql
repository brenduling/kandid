begin;

-- Board enrollment is one trusted transaction: identity correction/creation,
-- current-term verification, organization eligibility, and membership sync.
do $preflight$
begin
  if to_regclass('public.admin_users') is null
     or to_regclass('public.students') is null
     or to_regclass('public.student_term_enrollments') is null
     or to_regclass('public.academic_terms') is null
     or to_regclass('public.organizations') is null
     or to_regclass('public.organization_programs') is null
     or to_regclass('public.programs') is null
     or to_regclass('public.student_organization_terms') is null
     or to_regclass('public.student_organizations') is null
     or to_regclass('public.audit_logs') is null
     or to_regprocedure('public.kandid_resolve_program_catalog_id(text)') is null then
    raise exception 'Board verified registration prerequisites are missing.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.student_organization_terms'::regclass
      and t.tgname = 'student_organization_terms_admission_guard'
      and not t.tgisinternal
  ) then
    raise exception 'Board verified registration requires the membership admission guard.';
  end if;
end;
$preflight$;

alter table public.student_term_enrollments
  add column if not exists verification_method text,
  add column if not exists verified_by_admin_id integer references public.admin_users(id),
  add column if not exists verified_at timestamptz;

do $verification_constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.student_term_enrollments'::regclass
      and conname = 'student_term_enrollments_verification_contract'
  ) then
    alter table public.student_term_enrollments
      add constraint student_term_enrollments_verification_contract check (
        (verification_method is null and verified_by_admin_id is null and verified_at is null)
        or (verification_method is not null
          and verification_method in ('school_id', 'registration_form', 'department_masterlist')
          and verified_by_admin_id is not null and verified_at is not null)
      );
  end if;
end;
$verification_constraint$;

create or replace function public.guard_student_organization_term_admission()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  organization_scope text;
  organization_type_value text;
  active_term_id integer;
  active_term_count integer;
  enrollment_program text;
  resolved_program_id bigint;
  previous_term_id integer;
  previous_academic_year text;
  previous_semester text;
  sync_term_setting text;
  reconciliation_actor_id bigint;
  reconciliation_student_id integer;
  reconciliation_term_id integer;
  board_actor_id bigint;
  board_org_id integer;
  actor_is_authorized boolean := false;
  admission_row record;
begin
  select o.membership_scope, o.organization_type
    into organization_scope, organization_type_value
  from public.organizations o where o.id = new.organization_id;
  if not found or organization_scope is null
     or organization_scope not in ('program', 'institution', 'manual') then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:UNSUPPORTED_MEMBERSHIP_SCOPE';
  end if;
  if organization_type_value is null
     or organization_type_value not in ('departmental', 'non_departmental')
     or (organization_scope = 'program' and organization_type_value <> 'departmental')
     or (organization_scope = 'manual' and organization_type_value <> 'non_departmental') then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:UNSUPPORTED_ORGANIZATION_TYPE';
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status
     and organization_scope <> 'manual' then
    reconciliation_actor_id := nullif(pg_catalog.current_setting('kandid.program_reconcile_actor_id', true), '')::bigint;
    reconciliation_student_id := nullif(pg_catalog.current_setting('kandid.program_reconcile_student_id', true), '')::integer;
    reconciliation_term_id := nullif(pg_catalog.current_setting('kandid.program_reconcile_term_id', true), '')::integer;
    board_actor_id := nullif(pg_catalog.current_setting('kandid.board_verified_enrollment_actor_id', true), '')::bigint;
    board_org_id := nullif(pg_catalog.current_setting('kandid.board_verified_enrollment_org_id', true), '')::integer;

    actor_is_authorized := exists (
      select 1 from public.admin_users a
      where a.id = reconciliation_actor_id and a.role = 'super_admin' and a.status = 'active'
    ) or (
      board_actor_id = reconciliation_actor_id
      and board_org_id is not null
      and exists (
        select 1 from public.admin_users a
        where a.id = board_actor_id and a.role = 'electoral_board' and a.status = 'active'
          and a.organization_id = board_org_id
      )
      and exists (
        select 1 from public.student_term_enrollments ste
        where ste.student_id = new.student_id and ste.academic_term_id = new.academic_term_id
          and ste.enrollment_status = 'enrolled'
          and ste.verification_method in ('school_id', 'registration_form', 'department_masterlist')
          and ste.verified_by_admin_id = board_actor_id and ste.verified_at is not null
      )
    );
    if reconciliation_actor_id is null
       or reconciliation_student_id is distinct from new.student_id
       or reconciliation_term_id is distinct from new.academic_term_id
       or old.student_id is distinct from new.student_id
       or old.organization_id is distinct from new.organization_id
       or old.academic_term_id is distinct from new.academic_term_id
       or not actor_is_authorized then
      raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
    end if;

    if old.status = 'active' and new.status = 'removed' then
      select pg_catalog.count(*)::integer, pg_catalog.min(t.id)
        into active_term_count, active_term_id from public.academic_terms t where t.status = 'active';
      if active_term_count <> 1 or new.academic_term_id <> active_term_id
         or organization_scope <> 'program'
         or new.removed_by is distinct from reconciliation_actor_id
         or new.removed_at is null
         or new.removal_reason is distinct from 'program_change_reconciliation' then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
      end if;
      select ste.program into enrollment_program from public.student_term_enrollments ste
      where ste.student_id = new.student_id and ste.academic_term_id = new.academic_term_id
        and ste.enrollment_status = 'enrolled';
      if not found then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:NOT_CURRENTLY_ENROLLED';
      end if;
      resolved_program_id := public.kandid_resolve_program_catalog_id(enrollment_program);
      if resolved_program_id is null or exists (
        select 1 from public.organization_programs op
        where op.organization_id = new.organization_id and op.program_id = resolved_program_id
      ) then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:PROGRAM_STILL_ELIGIBLE';
      end if;
      return new;
    elsif old.status = 'removed' and new.status = 'active' then
      if new.source <> 'system' or new.removed_by is not null
         or new.removed_at is not null or new.removal_reason is not null then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
      end if;
    else
      raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
    end if;
  end if;

  if new.status is distinct from 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active'
     and old.student_id = new.student_id and old.organization_id = new.organization_id
     and old.academic_term_id = new.academic_term_id then return new; end if;

  perform pg_catalog.pg_advisory_xact_lock(new.student_id, new.academic_term_id);
  select pg_catalog.count(*)::integer, pg_catalog.min(t.id)
    into active_term_count, active_term_id from public.academic_terms t where t.status = 'active';
  if active_term_count <> 1 or new.academic_term_id <> active_term_id then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:TERM_NOT_ACTIVE';
  end if;
  select ste.program into enrollment_program from public.student_term_enrollments ste
  where ste.student_id = new.student_id and ste.academic_term_id = new.academic_term_id
    and ste.enrollment_status = 'enrolled';
  if not found then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:NOT_CURRENTLY_ENROLLED';
  end if;

  sync_term_setting := pg_catalog.current_setting('kandid.membership_activation_term_id', true);
  if new.source = 'system' and sync_term_setting = new.academic_term_id::text then
    if organization_scope = 'manual' then
      select t.academic_year, t.semester into previous_academic_year, previous_semester
      from public.academic_terms t where t.id = new.academic_term_id;
      if previous_semester = '2nd Semester' then previous_semester := '1st Semester';
      elsif previous_semester = '1st Semester' then
        previous_academic_year := (pg_catalog.split_part(previous_academic_year, '-', 1)::integer - 1)::text
          || '-' || pg_catalog.split_part(previous_academic_year, '-', 1);
        previous_semester := '2nd Semester';
      else raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:UNSUPPORTED_ACADEMIC_TERM'; end if;
      select t.id into previous_term_id from public.academic_terms t
      where t.academic_year = previous_academic_year and t.semester = previous_semester and t.status = 'closed';
      if previous_term_id is null or not exists (
        select 1 from public.student_organization_terms prior where prior.student_id = new.student_id
          and prior.organization_id = new.organization_id and prior.academic_term_id = previous_term_id and prior.status = 'active'
      ) then raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED'; end if;
      return new;
    end if;
    if organization_scope = 'program' then
      resolved_program_id := public.kandid_resolve_program_catalog_id(enrollment_program);
      if resolved_program_id is null or not exists (
        select 1 from public.organization_programs op where op.organization_id = new.organization_id and op.program_id = resolved_program_id
      ) then raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION'; end if;
    end if;
    return new;
  end if;
  if organization_scope <> 'manual' then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
  end if;
  select * into admission_row from public.kandid_check_student_organization_admission(new.student_id, new.organization_id, new.academic_term_id);
  if not coalesce(admission_row.allowed, false) then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:' || coalesce(admission_row.reason, 'ACTIVE_TERM_UNAVAILABLE');
  end if;
  return new;
end;
$function$;

alter function public.guard_student_organization_term_admission() owner to postgres;
revoke all on function public.guard_student_organization_term_admission() from public, anon, authenticated, service_role;

create or replace function public.kandid_board_register_verified_student_for_term_v1(
  p_actor_admin_id bigint,
  p_board_organization_id integer,
  p_student_number text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_program text,
  p_year_level integer,
  p_verification_method text,
  p_evidence_reviewed boolean,
  p_create_identity boolean,
  p_photo_url text default null,
  p_precinct_code text default null,
  p_batch_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  active_term_id integer;
  active_term_count integer;
  actor_org_id integer;
  org_scope text;
  org_type text;
  v_student_id integer;
  student_status text;
  v_program_id bigint;
  current_enrollment public.student_term_enrollments%rowtype;
  existing_identity public.students%rowtype;
  target_org record;
  membership record;
  created_ids integer[] := array[]::integer[];
  restored_ids integer[] := array[]::integer[];
  removed_ids integer[] := array[]::integer[];
  active_ids integer[] := array[]::integer[];
  previous_activation text;
  previous_actor text;
  previous_student text;
  previous_term text;
  previous_board_actor text;
  previous_board_org text;
  outcome text;
  identity_exists boolean := false;
  has_current_enrollment boolean := false;
  current_program_id bigint;
begin
  if p_actor_admin_id is null or p_actor_admin_id <= 0
     or p_board_organization_id is null or p_board_organization_id <= 0 then
    raise exception using errcode = '22023', message = 'A valid Board identity and organization are required.';
  end if;
  select a.organization_id into actor_org_id from public.admin_users a
  where a.id = p_actor_admin_id and a.role = 'electoral_board' and a.status = 'active';
  if not found or actor_org_id is distinct from p_board_organization_id then
    raise exception using errcode = '42501', message = 'Active Electoral Board organization authorization required.';
  end if;
  if p_evidence_reviewed is distinct from true
     or p_verification_method is null
     or p_verification_method not in ('school_id', 'registration_form', 'department_masterlist') then
    raise exception using errcode = '22023', message = 'Enrollment evidence review and a supported verification method are required.';
  end if;
  if trim(coalesce(p_student_number, '')) !~ '^[0-9]{5}$'
     or trim(coalesce(p_first_name, '')) = '' or trim(coalesce(p_last_name, '')) = ''
     or trim(coalesce(p_program, '')) = '' or p_year_level is null or p_year_level not between 1 and 6 then
    raise exception using errcode = '22023', message = 'Student identity and current-term academic fields are invalid.';
  end if;
  if nullif(trim(coalesce(p_email, '')), '') is not null
     and position('@' in trim(p_email)) <= 1 then
    raise exception using errcode = '22023', message = 'Student email address is invalid.';
  end if;

  perform 1 from public.academic_terms t where t.status = 'active' for update;
  select pg_catalog.count(*)::integer, pg_catalog.min(t.id) into active_term_count, active_term_id
  from public.academic_terms t where t.status = 'active';
  if active_term_count <> 1 then
    raise exception using errcode = '55000', message = 'Exactly one active academic term is required.';
  end if;

  select o.membership_scope, o.organization_type into org_scope, org_type
  from public.organizations o where o.id = actor_org_id;
  if org_scope is null or org_type is null
     or org_scope not in ('program', 'institution', 'manual')
     or org_type not in ('departmental', 'non_departmental')
     or (org_scope = 'program' and org_type <> 'departmental')
     or (org_scope = 'manual' and org_type <> 'non_departmental') then
    raise exception using errcode = '23514', message = 'Board organization enrollment configuration is invalid.';
  end if;

  select p.id into v_program_id from public.programs p
  where upper(trim(p.code)) = upper(trim(p_program)) or upper(trim(p.name)) = upper(trim(p_program));
  if v_program_id is null or (
    select count(*) from public.programs p
    where upper(trim(p.code)) = upper(trim(p_program)) or upper(trim(p.name)) = upper(trim(p_program))
  ) <> 1 then
    raise exception using errcode = '23503', message = 'Program is not a unique configured catalog entry.';
  end if;
  if org_scope = 'program' and not exists (
    select 1 from public.organization_programs op
    where op.organization_id = actor_org_id and op.program_id = v_program_id
  ) then
    raise exception using errcode = '42501', message = 'Program is outside this Board organization coverage.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(trim(p_student_number)), active_term_id);
  select s.* into existing_identity from public.students s
  where s.student_number = trim(p_student_number) for update;
  identity_exists := found;
  if identity_exists then
    if p_create_identity then
      raise exception using errcode = '23505', message = 'IDENTITY_RECHECK_REQUIRED';
    end if;
    v_student_id := existing_identity.id;
    student_status := existing_identity.status;
  else
    if not p_create_identity then
      raise exception using errcode = 'P0002', message = 'STUDENT_IDENTITY_NOT_FOUND';
    end if;
    insert into public.students (student_number, first_name, last_name, email, photo_url, program, year_level,
      precinct_code, batch_code, is_shs, status)
    values (trim(p_student_number), trim(p_first_name), trim(p_last_name),
      nullif(lower(trim(coalesce(p_email, ''))), ''), nullif(trim(coalesce(p_photo_url, '')), ''),
      upper(trim(p_program)), p_year_level, nullif(trim(coalesce(p_precinct_code, '')), ''),
      nullif(trim(coalesce(p_batch_code, '')), ''), false, 'pending')
    returning id, status into v_student_id, student_status;
  end if;

  select ste.* into current_enrollment from public.student_term_enrollments ste
  where ste.student_id = v_student_id and ste.academic_term_id = active_term_id for update;
  has_current_enrollment := found;
  if has_current_enrollment and org_scope = 'program' then
    select p.id into current_program_id
    from public.programs p
    where upper(trim(p.code)) = upper(trim(current_enrollment.program))
       or upper(trim(p.name)) = upper(trim(current_enrollment.program));
    if current_program_id is null or not exists (
      select 1 from public.organization_programs op
      where op.organization_id = actor_org_id and op.program_id = current_program_id
    ) then
      raise exception using errcode = '42501', message = 'Program is outside this Board organization coverage.';
    end if;
  end if;
  if identity_exists then
    update public.students s set first_name = trim(p_first_name), last_name = trim(p_last_name),
      email = coalesce(nullif(lower(trim(coalesce(p_email, ''))), ''), existing_identity.email),
      program = upper(trim(p_program)),
      year_level = p_year_level
    where s.id = v_student_id;
  end if;
  if has_current_enrollment and current_enrollment.enrollment_status not in ('enrolled', 'not_in_masterlist') then
    raise exception using errcode = '23514', message = 'Unsupported current-term enrollment status.';
  end if;
  if has_current_enrollment and current_enrollment.enrollment_status = 'enrolled' then outcome := 'EXISTING_STUDENT_ENROLLED';
  elsif has_current_enrollment then outcome := 'EXISTING_STUDENT_TERM_RESTORED';
  else outcome := case when p_create_identity then 'NEW_STUDENT_CREATED' else 'EXISTING_STUDENT_ENROLLED' end;
  end if;

  insert into public.student_term_enrollments (student_id, academic_term_id, program, year_level, is_shs,
      enrollment_status, source, verification_method, verified_by_admin_id, verified_at)
  values (v_student_id, active_term_id, upper(trim(p_program)), p_year_level, false, 'enrolled',
      case when p_verification_method = 'department_masterlist' then 'masterlist' else 'manual' end,
      p_verification_method, p_actor_admin_id, pg_catalog.clock_timestamp())
  on conflict (student_id, academic_term_id) do update set
      program = excluded.program, year_level = excluded.year_level, is_shs = false,
      enrollment_status = 'enrolled', source = excluded.source,
      verification_method = excluded.verification_method,
      verified_by_admin_id = excluded.verified_by_admin_id,
      verified_at = excluded.verified_at, updated_at = pg_catalog.clock_timestamp();

  previous_activation := pg_catalog.current_setting('kandid.membership_activation_term_id', true);
  previous_actor := pg_catalog.current_setting('kandid.program_reconcile_actor_id', true);
  previous_student := pg_catalog.current_setting('kandid.program_reconcile_student_id', true);
  previous_term := pg_catalog.current_setting('kandid.program_reconcile_term_id', true);
  previous_board_actor := pg_catalog.current_setting('kandid.board_verified_enrollment_actor_id', true);
  previous_board_org := pg_catalog.current_setting('kandid.board_verified_enrollment_org_id', true);
  perform pg_catalog.set_config('kandid.membership_activation_term_id', active_term_id::text, true);
  perform pg_catalog.set_config('kandid.program_reconcile_actor_id', p_actor_admin_id::text, true);
  perform pg_catalog.set_config('kandid.program_reconcile_student_id', v_student_id::text, true);
  perform pg_catalog.set_config('kandid.program_reconcile_term_id', active_term_id::text, true);
  perform pg_catalog.set_config('kandid.board_verified_enrollment_actor_id', p_actor_admin_id::text, true);
  perform pg_catalog.set_config('kandid.board_verified_enrollment_org_id', actor_org_id::text, true);

  with removed as (
    update public.student_organization_terms sot set status = 'removed', removed_by = p_actor_admin_id,
      removed_at = pg_catalog.clock_timestamp(), removal_reason = 'program_change_reconciliation',
      updated_at = pg_catalog.clock_timestamp()
    from public.organizations o
    where sot.student_id = v_student_id and sot.academic_term_id = active_term_id
      and sot.status = 'active' and sot.source = 'system' and o.id = sot.organization_id
      and o.membership_scope = 'program'
      and not exists (select 1 from public.organization_programs op
        where op.organization_id = o.id and op.program_id = v_program_id)
    returning sot.organization_id
  ) select coalesce(pg_catalog.array_agg(organization_id order by organization_id), array[]::integer[])
    into removed_ids from removed;

  for target_org in
    select o.id, o.membership_scope from public.organizations o
    where o.membership_scope = 'institution'
       or (o.membership_scope = 'program' and exists (select 1 from public.organization_programs op
         where op.organization_id = o.id and op.program_id = v_program_id))
    order by o.id
  loop
    select sot.* into membership from public.student_organization_terms sot
    where sot.student_id = v_student_id and sot.organization_id = target_org.id
      and sot.academic_term_id = active_term_id for update;
    if not found then
      insert into public.student_organization_terms (student_id, organization_id, academic_term_id, status, source)
      values (v_student_id, target_org.id, active_term_id, 'active', 'system');
      created_ids := pg_catalog.array_append(created_ids, target_org.id);
    elsif membership.status = 'removed' and membership.source = 'system'
       and membership.removal_reason = 'program_change_reconciliation' then
      update public.student_organization_terms set status = 'active', source = 'system', removed_by = null,
        removed_at = null, removal_reason = null, updated_at = pg_catalog.clock_timestamp()
      where id = membership.id;
      restored_ids := pg_catalog.array_append(restored_ids, target_org.id);
    elsif membership.status = 'removed' then
      continue;
    elsif membership.status <> 'active' then
      raise exception using errcode = '23514', message = 'Unsupported current-term membership status.';
    end if;
    insert into public.student_organizations (student_id, organization_id, role)
    values (v_student_id, target_org.id, 'member') on conflict (student_id, organization_id) do nothing;
    active_ids := pg_catalog.array_append(active_ids, target_org.id);
  end loop;

  if org_scope = 'manual' then
    select sot.* into membership from public.student_organization_terms sot
    where sot.student_id = v_student_id and sot.organization_id = actor_org_id
      and sot.academic_term_id = active_term_id for update;
    if not found then
      insert into public.student_organization_terms (student_id, organization_id, academic_term_id, status, source)
      values (v_student_id, actor_org_id, active_term_id, 'active', 'manual');
      created_ids := pg_catalog.array_append(created_ids, actor_org_id);
    elsif membership.status = 'removed' then
      raise exception using errcode = '23514', message = 'EXPLICIT_RESTORATION_REQUIRED';
    end if;
    insert into public.student_organizations (student_id, organization_id, role)
    values (v_student_id, actor_org_id, 'member') on conflict (student_id, organization_id) do nothing;
    active_ids := pg_catalog.array_append(active_ids, actor_org_id);
  end if;

  insert into public.audit_logs (user_id, action, actor_name, actor_role, entity_id, entity_type,
    entity_label, organization_id, organization_name, status, event_type, event_category,
    event_origin, metadata)
  select p_actor_admin_id, 'Board-verified Student enrollment', a.full_name, 'electoral_board',
    v_student_id::text, 'student', trim(p_first_name) || ' ' || trim(p_last_name), actor_org_id,
    o.name, 'completed', 'student_enrollment_verified', 'students', 'trusted_server',
    pg_catalog.jsonb_build_object('academic_term_id', active_term_id, 'verification_method', p_verification_method,
      'verified_at', pg_catalog.clock_timestamp(), 'created_identity', p_create_identity,
      'identity_fields_reviewed', pg_catalog.jsonb_build_array('first_name', 'last_name', 'email', 'program', 'year_level'),
      'created_organization_ids', created_ids, 'restored_organization_ids', restored_ids,
      'removed_program_organization_ids', removed_ids)
  from public.admin_users a cross join public.organizations o
  where a.id = p_actor_admin_id and o.id = actor_org_id;

  perform pg_catalog.set_config('kandid.membership_activation_term_id', coalesce(previous_activation, ''), true);
  perform pg_catalog.set_config('kandid.program_reconcile_actor_id', coalesce(previous_actor, ''), true);
  perform pg_catalog.set_config('kandid.program_reconcile_student_id', coalesce(previous_student, ''), true);
  perform pg_catalog.set_config('kandid.program_reconcile_term_id', coalesce(previous_term, ''), true);
  perform pg_catalog.set_config('kandid.board_verified_enrollment_actor_id', coalesce(previous_board_actor, ''), true);
  perform pg_catalog.set_config('kandid.board_verified_enrollment_org_id', coalesce(previous_board_org, ''), true);
  return pg_catalog.jsonb_build_object('outcome', outcome, 'student_id', v_student_id,
    'student_status', student_status, 'academic_term_id', active_term_id,
    'organization_outcome', 'REGISTERED', 'active_organization_ids', active_ids,
    'created_organization_ids', created_ids, 'restored_organization_ids', restored_ids,
    'removed_organization_ids', removed_ids, 'verification_method', p_verification_method,
    'verified_by_admin_id', p_actor_admin_id);
end;
$function$;

alter function public.kandid_board_register_verified_student_for_term_v1(bigint, integer, text, text, text, text, text, integer, text, boolean, boolean, text, text, text) owner to postgres;
revoke all on function public.kandid_board_register_verified_student_for_term_v1(bigint, integer, text, text, text, text, text, integer, text, boolean, boolean, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.kandid_board_register_verified_student_for_term_v1(bigint, integer, text, text, text, text, text, integer, text, boolean, boolean, text, text, text) to service_role;

do $postflight$
declare
  fn oid := pg_catalog.to_regprocedure('public.kandid_board_register_verified_student_for_term_v1(bigint,integer,text,text,text,text,text,integer,text,boolean,boolean,text,text,text)');
begin
  if fn is null or not (select p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig = array['search_path=pg_catalog']::text[] from pg_catalog.pg_proc p where p.oid = fn)
     or not pg_catalog.has_function_privilege('service_role', fn, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', fn, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', fn, 'EXECUTE') then
    raise exception 'Board verified registration security postflight failed.';
  end if;
end;
$postflight$;

commit;
