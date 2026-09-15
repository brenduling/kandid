begin;

create or replace function public.board_update_student_participation(
  target_student_id integer,
  target_organization_id integer,
  actor_admin_id integer,
  target_action text,
  target_reason text default null
)
returns table (
  status text,
  already_applied boolean,
  participation_id integer,
  notification_id integer,
  academic_term_id integer,
  academic_year text,
  semester text,
  organization_name text,
  student_number text,
  first_name text,
  last_name text,
  program text,
  year_level integer,
  removal_reason text,
  removed_at timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  normalized_action text := lower(trim(coalesce(target_action, '')));
  normalized_reason text := nullif(trim(coalesce(target_reason, '')), '');
  active_term public.academic_terms%rowtype;
  participation public.student_organization_terms%rowtype;
  student_record public.students%rowtype;
  org_record public.organizations%rowtype;
  term_enrollment public.student_term_enrollments%rowtype;
  inserted_notification_id integer;
  notification_title text;
  notification_message text;
begin
  if target_student_id is null or target_student_id <= 0
    or target_organization_id is null or target_organization_id <= 0
    or actor_admin_id is null or actor_admin_id <= 0 then
    raise exception 'Invalid participation request.';
  end if;

  if normalized_action not in ('remove', 'restore') then
    raise exception 'Unsupported participation action.';
  end if;

  if normalized_action = 'remove' and normalized_reason is null then
    raise exception 'Removal reason is required.';
  end if;

  select *
    into active_term
  from public.academic_terms
  where academic_terms.status = 'active'
  order by id desc
  limit 1;

  if not found then
    raise exception 'No active academic term is available.';
  end if;

  select *
    into student_record
  from public.students
  where students.id = target_student_id;

  if not found then
    raise exception 'Student not found.';
  end if;

  select *
    into org_record
  from public.organizations
  where organizations.id = target_organization_id;

  if not found then
    raise exception 'Organization not found.';
  end if;

  select *
    into term_enrollment
  from public.student_term_enrollments
  where student_term_enrollments.student_id = target_student_id
    and student_term_enrollments.academic_term_id = active_term.id
    and student_term_enrollments.enrollment_status = 'enrolled'
  limit 1;

  if not found then
    raise exception 'Student is not enrolled for the active academic term.';
  end if;

  select *
    into participation
  from public.student_organization_terms
  where student_organization_terms.student_id = target_student_id
    and student_organization_terms.organization_id = target_organization_id
    and student_organization_terms.academic_term_id = active_term.id
  for update;

  if not found then
    raise exception 'Student does not have current-term participation in this organization.';
  end if;

  if normalized_action = 'remove' then
    if participation.status = 'removed' then
      status := 'removed';
      already_applied := true;
      participation_id := participation.id;
      notification_id := null;
      academic_term_id := active_term.id;
      academic_year := active_term.academic_year;
      semester := active_term.semester;
      organization_name := org_record.name;
      student_number := student_record.student_number;
      first_name := student_record.first_name;
      last_name := student_record.last_name;
      program := term_enrollment.program;
      year_level := term_enrollment.year_level;
      removal_reason := participation.removal_reason;
      removed_at := participation.removed_at;
      return next;
      return;
    end if;

    update public.student_organization_terms
    set
      status = 'removed',
      removed_by = actor_admin_id,
      removed_at = now(),
      removal_reason = normalized_reason,
      updated_at = now()
    where student_organization_terms.id = participation.id
    returning *
      into participation;

    notification_title := 'Organization Membership Update';
    notification_message :=
      'You have been removed from ' || org_record.name ||
      ' for ' || active_term.semester ||
      ' AY ' || active_term.academic_year ||
      '. Reason: ' || normalized_reason ||
      E'\n\nYou are no longer eligible to participate in this organization''s elections for the current academic term.';

    insert into public.student_notifications (
      student_id,
      type,
      title,
      message,
      metadata
    )
    values (
      target_student_id,
      'organization_removed',
      notification_title,
      notification_message,
      jsonb_build_object(
        'organization_id', target_organization_id,
        'organization_name', org_record.name,
        'academic_term_id', active_term.id,
        'academic_year', active_term.academic_year,
        'semester', active_term.semester,
        'reason', normalized_reason
      )
    )
    returning id
      into inserted_notification_id;

    insert into public.audit_logs (user_id, action, timestamp)
    values (actor_admin_id, 'Student Removed from Organization', now());

    status := 'removed';
    already_applied := false;
  else
    if participation.status = 'active' then
      status := 'active';
      already_applied := true;
      participation_id := participation.id;
      notification_id := null;
      academic_term_id := active_term.id;
      academic_year := active_term.academic_year;
      semester := active_term.semester;
      organization_name := org_record.name;
      student_number := student_record.student_number;
      first_name := student_record.first_name;
      last_name := student_record.last_name;
      program := term_enrollment.program;
      year_level := term_enrollment.year_level;
      removal_reason := null;
      removed_at := null;
      return next;
      return;
    end if;

    update public.student_organization_terms
    set
      status = 'active',
      removed_by = null,
      removed_at = null,
      removal_reason = null,
      updated_at = now()
    where student_organization_terms.id = participation.id
    returning *
      into participation;

    notification_title := 'Organization Membership Restored';
    notification_message :=
      'Your participation in ' || org_record.name ||
      ' for ' || active_term.semester ||
      ' AY ' || active_term.academic_year ||
      E' has been restored.\n\nYou are again eligible for applicable organization elections for this academic term.';

    insert into public.student_notifications (
      student_id,
      type,
      title,
      message,
      metadata
    )
    values (
      target_student_id,
      'organization_restored',
      notification_title,
      notification_message,
      jsonb_build_object(
        'organization_id', target_organization_id,
        'organization_name', org_record.name,
        'academic_term_id', active_term.id,
        'academic_year', active_term.academic_year,
        'semester', active_term.semester
      )
    )
    returning id
      into inserted_notification_id;

    insert into public.audit_logs (user_id, action, timestamp)
    values (actor_admin_id, 'Student Restored to Organization', now());

    status := 'active';
    already_applied := false;
  end if;

  participation_id := participation.id;
  notification_id := inserted_notification_id;
  academic_term_id := active_term.id;
  academic_year := active_term.academic_year;
  semester := active_term.semester;
  organization_name := org_record.name;
  student_number := student_record.student_number;
  first_name := student_record.first_name;
  last_name := student_record.last_name;
  program := term_enrollment.program;
  year_level := term_enrollment.year_level;
  removal_reason := participation.removal_reason;
  removed_at := participation.removed_at;
  return next;
end;
$$;

revoke all on function public.board_update_student_participation(integer, integer, integer, text, text)
  from public;
revoke all on function public.board_update_student_participation(integer, integer, integer, text, text)
  from anon;
revoke all on function public.board_update_student_participation(integer, integer, integer, text, text)
  from authenticated;
grant execute on function public.board_update_student_participation(integer, integer, integer, text, text)
  to service_role;

commit;
