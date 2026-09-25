begin;

create or replace function public.create_manual_student_for_term_v1(
  p_academic_term_id integer,
  p_student_number text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_program text,
  p_year_level integer,
  p_is_shs boolean default false,
  p_photo_url text default null,
  p_precinct_code text default null,
  p_batch_code text default null
)
returns table (
  outcome text,
  student_id integer,
  student_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  normalized_student_number text := trim(coalesce(p_student_number, ''));
  normalized_first_name text := trim(coalesce(p_first_name, ''));
  normalized_last_name text := trim(coalesce(p_last_name, ''));
  normalized_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  normalized_program text := upper(trim(coalesce(p_program, '')));
  created_student_id integer;
  violated_constraint text;
begin
  if normalized_student_number !~ '^[0-9]{5}$' then
    outcome := 'INVALID_FORMAT';
    student_id := null;
    student_status := null;
    return next;
    return;
  end if;

  if normalized_first_name = ''
    or normalized_last_name = ''
    or normalized_program = ''
    or (normalized_email is not null and position('@' in normalized_email) <= 1)
    or p_year_level is null
    or p_year_level < 1
    or p_year_level > 6 then
    outcome := 'INVALID_INPUT';
    student_id := null;
    student_status := null;
    return next;
    return;
  end if;

  if not exists (
    select 1
    from public.academic_terms at
    where at.id = p_academic_term_id
      and at.status = 'active'
  ) then
    outcome := 'INVALID_TERM';
    student_id := null;
    student_status := null;
    return next;
    return;
  end if;

  begin
    insert into public.students (
      student_number,
      first_name,
      last_name,
      email,
      photo_url,
      program,
      year_level,
      precinct_code,
      batch_code,
      is_shs,
      status
    )
    values (
      normalized_student_number,
      normalized_first_name,
      normalized_last_name,
      normalized_email,
      nullif(trim(coalesce(p_photo_url, '')), ''),
      normalized_program,
      p_year_level,
      nullif(trim(coalesce(p_precinct_code, '')), ''),
      nullif(trim(coalesce(p_batch_code, '')), ''),
      coalesce(p_is_shs, false),
      'pending'
    )
    returning id into created_student_id;

    insert into public.student_term_enrollments (
      student_id,
      academic_term_id,
      program,
      year_level,
      is_shs,
      enrollment_status,
      source
    )
    values (
      created_student_id,
      p_academic_term_id,
      normalized_program,
      p_year_level,
      coalesce(p_is_shs, false),
      'enrolled',
      'manual'
    );
  exception
    when unique_violation then
      get stacked diagnostics violated_constraint = constraint_name;

      if violated_constraint = 'students_student_number_key' then
        outcome := 'IDENTITY_RECHECK_REQUIRED';
      elsif violated_constraint = 'student_term_enrollments_unique_student_term' then
        outcome := 'ALREADY_ENROLLED_CURRENT_TERM';
      else
        outcome := 'SAFE_SERVER_ERROR';
      end if;

      student_id := null;
      student_status := null;
      return next;
      return;
    when others then
      outcome := 'SAFE_SERVER_ERROR';
      student_id := null;
      student_status := null;
      return next;
      return;
  end;

  outcome := 'NEW_STUDENT_CREATED';
  student_id := created_student_id;
  student_status := 'pending';
  return next;
end;
$$;

create or replace function public.enroll_existing_student_for_term_v1(
  p_student_id integer,
  p_academic_term_id integer,
  p_program text,
  p_year_level integer,
  p_is_shs boolean default false
)
returns table (
  outcome text,
  student_id integer,
  student_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  normalized_program text := upper(trim(coalesce(p_program, '')));
  existing_status text;
  existing_enrollment_id integer;
  existing_enrollment_status text;
  enrollment_found boolean := false;
begin
  if p_student_id is null
    or p_student_id <= 0
    or normalized_program = ''
    or p_year_level is null
    or p_year_level < 1
    or p_year_level > 6 then
    outcome := 'INVALID_INPUT';
    student_id := null;
    student_status := null;
    return next;
    return;
  end if;

  if not exists (
    select 1
    from public.academic_terms at
    where at.id = p_academic_term_id
      and at.status = 'active'
  ) then
    outcome := 'INVALID_TERM';
    student_id := null;
    student_status := null;
    return next;
    return;
  end if;

  select s.status
  into existing_status
  from public.students s
  where s.id = p_student_id
  for update;

  if not found then
    outcome := 'IDENTITY_RECHECK_REQUIRED';
    student_id := null;
    student_status := null;
    return next;
    return;
  end if;

  select ste.id, ste.enrollment_status
  into existing_enrollment_id, existing_enrollment_status
  from public.student_term_enrollments ste
  where ste.student_id = p_student_id
    and ste.academic_term_id = p_academic_term_id
  for update;

  enrollment_found := found;

  if enrollment_found and existing_enrollment_status = 'enrolled' then
    outcome := 'ALREADY_ENROLLED_CURRENT_TERM';
    student_id := p_student_id;
    student_status := existing_status;
    return next;
    return;
  end if;

  if enrollment_found and existing_enrollment_status <> 'not_in_masterlist' then
    outcome := 'SAFE_SERVER_ERROR';
    student_id := null;
    student_status := null;
    return next;
    return;
  end if;

  begin
    if existing_enrollment_id is null then
    insert into public.student_term_enrollments (
      student_id,
      academic_term_id,
      program,
      year_level,
      is_shs,
      enrollment_status,
      source
    )
    values (
      p_student_id,
      p_academic_term_id,
      normalized_program,
      p_year_level,
      coalesce(p_is_shs, false),
      'enrolled',
      'manual'
      );

      outcome := 'EXISTING_STUDENT_ENROLLED';
    else
      update public.student_term_enrollments
      set program = normalized_program,
          year_level = p_year_level,
          is_shs = coalesce(p_is_shs, false),
          enrollment_status = 'enrolled',
          updated_at = now()
      where id = existing_enrollment_id;

      outcome := 'EXISTING_STUDENT_TERM_RESTORED';
    end if;
  exception
    when unique_violation then
      outcome := 'ALREADY_ENROLLED_CURRENT_TERM';
      student_id := p_student_id;
      student_status := existing_status;
      return next;
      return;
    when others then
      outcome := 'SAFE_SERVER_ERROR';
      student_id := null;
      student_status := null;
      return next;
      return;
  end;

  student_id := p_student_id;
  student_status := existing_status;
  return next;
end;
$$;

revoke all on function public.create_manual_student_for_term_v1(
  integer, text, text, text, text, text, integer, boolean, text, text, text
) from public, anon, authenticated;

revoke all on function public.enroll_existing_student_for_term_v1(
  integer, integer, text, integer, boolean
) from public, anon, authenticated;

grant execute on function public.create_manual_student_for_term_v1(
  integer, text, text, text, text, text, integer, boolean, text, text, text
) to service_role;

grant execute on function public.enroll_existing_student_for_term_v1(
  integer, integer, text, integer, boolean
) to service_role;

comment on function public.create_manual_student_for_term_v1(
  integer, text, text, text, text, text, integer, boolean, text, text, text
) is 'Atomically creates one new five-digit manual student identity with pending status and an active-term enrollment.';

comment on function public.enroll_existing_student_for_term_v1(
  integer, integer, text, integer, boolean
) is 'Adds an existing student identity to the active academic term without changing central student identity or status.';

notify pgrst, 'reload schema';

commit;
