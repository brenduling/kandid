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

    if reconciliation_actor_id is null
       or reconciliation_student_id is distinct from new.student_id
       or reconciliation_term_id is distinct from new.academic_term_id
       or old.student_id is distinct from new.student_id
       or old.organization_id is distinct from new.organization_id
       or old.academic_term_id is distinct from new.academic_term_id
       or not exists (
         select 1 from public.admin_users a
         where a.id = reconciliation_actor_id
           and a.role = 'super_admin'
           and a.status = 'active'
       ) then
      raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
    end if;

    if old.status = 'active' and new.status = 'removed' then
      select pg_catalog.count(*)::integer, pg_catalog.min(t.id)
        into active_term_count, active_term_id
      from public.academic_terms t where t.status = 'active';
      if active_term_count <> 1 or new.academic_term_id <> active_term_id
         or organization_scope <> 'program'
         or new.removed_by is distinct from reconciliation_actor_id
         or new.removed_at is null
         or new.removal_reason is distinct from 'program_change_reconciliation' then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
      end if;

      select ste.program into enrollment_program
      from public.student_term_enrollments ste
      where ste.student_id = new.student_id
        and ste.academic_term_id = new.academic_term_id
        and ste.enrollment_status = 'enrolled';
      if not found then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:NOT_CURRENTLY_ENROLLED';
      end if;
      resolved_program_id := public.kandid_resolve_program_catalog_id(enrollment_program);
      if resolved_program_id is null or exists (
        select 1 from public.organization_programs op
        where op.organization_id = new.organization_id
          and op.program_id = resolved_program_id
      ) then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:PROGRAM_STILL_ELIGIBLE';
      end if;
      return new;
    elsif old.status = 'removed' and new.status = 'active' then
      if new.source <> 'system'
         or new.removed_by is not null
         or new.removed_at is not null
         or new.removal_reason is not null then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
      end if;
    else
      raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
    end if;
  end if;

  if new.status is distinct from 'active' then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.status = 'active'
    and old.student_id = new.student_id
    and old.organization_id = new.organization_id
    and old.academic_term_id = new.academic_term_id then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(new.student_id, new.academic_term_id);
  select pg_catalog.count(*)::integer, pg_catalog.min(t.id)
    into active_term_count, active_term_id
  from public.academic_terms t where t.status = 'active';
  if active_term_count <> 1 or new.academic_term_id <> active_term_id then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:TERM_NOT_ACTIVE';
  end if;

  select ste.program into enrollment_program
  from public.student_term_enrollments ste
  where ste.student_id = new.student_id
    and ste.academic_term_id = new.academic_term_id
    and ste.enrollment_status = 'enrolled';
  if not found then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:NOT_CURRENTLY_ENROLLED';
  end if;

  sync_term_setting := pg_catalog.current_setting('kandid.membership_activation_term_id', true);
  if new.source = 'system' and sync_term_setting = new.academic_term_id::text then
    if organization_scope = 'manual' then
      select t.academic_year, t.semester into previous_academic_year, previous_semester
      from public.academic_terms t where t.id = new.academic_term_id;
      if previous_semester = '2nd Semester' then
        previous_semester := '1st Semester';
      elsif previous_semester = '1st Semester' then
        previous_academic_year :=
          (pg_catalog.split_part(previous_academic_year, '-', 1)::integer - 1)::text
          || '-' || pg_catalog.split_part(previous_academic_year, '-', 1);
        previous_semester := '2nd Semester';
      else
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:UNSUPPORTED_ACADEMIC_TERM';
      end if;
      select t.id into previous_term_id from public.academic_terms t
      where t.academic_year = previous_academic_year and t.semester = previous_semester and t.status = 'closed';
      if previous_term_id is null or not exists (
        select 1 from public.student_organization_terms prior
        where prior.student_id = new.student_id and prior.organization_id = new.organization_id
          and prior.academic_term_id = previous_term_id and prior.status = 'active'
      ) then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
      end if;
      return new;
    end if;
    if organization_scope = 'program' then
      resolved_program_id := public.kandid_resolve_program_catalog_id(enrollment_program);
      if resolved_program_id is null or not exists (
        select 1 from public.organization_programs op
        where op.organization_id = new.organization_id and op.program_id = resolved_program_id
      ) then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION';
      end if;
    end if;
    return new;
  end if;

  if organization_scope <> 'manual' then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
  end if;
  select * into admission_row from public.kandid_check_student_organization_admission(
    new.student_id, new.organization_id, new.academic_term_id
  );
  if not coalesce(admission_row.allowed, false) then
    raise exception using errcode = '23514',
      message = 'MEMBERSHIP_ADMISSION_DENIED:' || coalesce(admission_row.reason, 'ACTIVE_TERM_UNAVAILABLE');
  end if;
  return new;
end;
$function$;

alter function public.guard_student_organization_term_admission() owner to postgres;
revoke all on function public.guard_student_organization_term_admission() from public, anon, authenticated, service_role;
CREATE TRIGGER student_organization_terms_admission_guard
BEFORE INSERT OR UPDATE OF student_id, organization_id, academic_term_id, status
ON public.student_organization_terms
FOR EACH ROW EXECUTE FUNCTION public.guard_student_organization_term_admission();