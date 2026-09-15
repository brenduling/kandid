BEGIN;

ALTER TABLE public.masterlist_import_rows
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS reviewed_by integer NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS review_decision text NULL,
  ADD COLUMN IF NOT EXISTS review_note text NULL,
  ADD COLUMN IF NOT EXISTS review_fingerprint text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.conname = 'masterlist_import_rows_review_status_check'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE public.masterlist_import_rows
      ADD CONSTRAINT masterlist_import_rows_review_status_check
      CHECK (review_status IN ('none', 'pending_review', 'approved', 'rejected'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.conname = 'masterlist_import_rows_review_decision_check'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE public.masterlist_import_rows
      ADD CONSTRAINT masterlist_import_rows_review_decision_check
      CHECK (
        review_decision IS NULL
        OR review_decision IN (
          'approve_shifted_program',
          'reject_incoming_program'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.conname = 'masterlist_import_rows_reviewed_by_fkey'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE public.masterlist_import_rows
      ADD CONSTRAINT masterlist_import_rows_reviewed_by_fkey
      FOREIGN KEY (reviewed_by)
      REFERENCES public.admin_users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reconcile_masterlist_import(target_import_id integer)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  target_term_id integer;
  target_academic_year text;
  target_semester text;
  target_year_start integer;
  target_semester_order integer;
  previous_term_id integer;
begin
  select
    at.id,
    at.academic_year,
    at.semester,
    split_part(at.academic_year, '-', 1)::integer,
    case
      when at.semester = '1st Semester' then 1
      when at.semester = '2nd Semester' then 2
    end
  into
    target_term_id,
    target_academic_year,
    target_semester,
    target_year_start,
    target_semester_order
  from public.masterlist_imports mi
  join public.academic_terms at
    on at.id = mi.academic_term_id
  where mi.id = target_import_id;

  if target_term_id is null then
    raise exception 'Masterlist import not found.';
  end if;

  select at.id
  into previous_term_id
  from public.academic_terms at
  where at.status in ('active', 'closed')
    and (
      split_part(at.academic_year, '-', 1)::integer,
      case
        when at.semester = '1st Semester' then 1
        when at.semester = '2nd Semester' then 2
      end
    ) < (
      target_year_start,
      target_semester_order
    )
  order by
    split_part(at.academic_year, '-', 1)::integer desc,
    case
      when at.semester = '1st Semester' then 1
      when at.semester = '2nd Semester' then 2
    end desc
  limit 1;

  update public.masterlist_import_rows r
  set
    matched_student_id = s.id,
    reconciliation_status =
      case
        when nullif(trim(r.student_number), '') is null
          or nullif(trim(r.first_name), '') is null
          or nullif(trim(r.last_name), '') is null
        then 'invalid'
        when (
          select count(*)
          from public.masterlist_import_rows d
          where d.import_id = target_import_id
            and lower(trim(d.student_number)) =
                lower(trim(r.student_number))
            and nullif(trim(d.student_number), '') is not null
        ) > 1
        then 'conflict'
        when
          lower(trim(coalesce(s.first_name, ''))) <>
            lower(trim(coalesce(r.first_name, '')))
          or
          lower(trim(coalesce(s.last_name, ''))) <>
            lower(trim(coalesce(r.last_name, '')))
        then 'conflict'
        when exists (
          select 1
          from public.student_term_enrollments ste
          where ste.student_id = s.id
            and ste.academic_term_id = previous_term_id
            and ste.enrollment_status = 'enrolled'
            and lower(trim(coalesce(ste.program, ''))) <>
                lower(trim(coalesce(r.program, '')))
        )
        then 'shifted_program'
        when exists (
          select 1
          from public.student_term_enrollments ste
          where ste.student_id = s.id
            and ste.academic_term_id = previous_term_id
            and ste.enrollment_status = 'enrolled'
        )
        then 'continuing'
        when exists (
          select 1
          from public.student_term_enrollments ste
          join public.academic_terms history_term
            on history_term.id = ste.academic_term_id
          where ste.student_id = s.id
            and ste.enrollment_status = 'enrolled'
            and (
              split_part(history_term.academic_year, '-', 1)::integer,
              case
                when history_term.semester = '1st Semester' then 1
                when history_term.semester = '2nd Semester' then 2
              end
            ) < (
              target_year_start,
              target_semester_order
            )
        )
        then 'returnee'
        else 'conflict'
      end,
    issue_message =
      case
        when nullif(trim(r.student_number), '') is null
        then 'Student number is required.'
        when nullif(trim(r.first_name), '') is null
          or nullif(trim(r.last_name), '') is null
        then 'Student name is required.'
        when (
          select count(*)
          from public.masterlist_import_rows d
          where d.import_id = target_import_id
            and lower(trim(d.student_number)) =
                lower(trim(r.student_number))
            and nullif(trim(d.student_number), '') is not null
        ) > 1
        then 'Duplicate student number appears more than once in this masterlist.'
        when
          lower(trim(coalesce(s.first_name, ''))) <>
            lower(trim(coalesce(r.first_name, '')))
          or
          lower(trim(coalesce(s.last_name, ''))) <>
            lower(trim(coalesce(r.last_name, '')))
        then 'Student number matches an existing student, but the name differs.'
        when exists (
          select 1
          from public.student_term_enrollments ste
          where ste.student_id = s.id
            and ste.academic_term_id = previous_term_id
            and ste.enrollment_status = 'enrolled'
            and lower(trim(coalesce(ste.program, ''))) <>
                lower(trim(coalesce(r.program, '')))
        )
        then concat(
          'Program change detected: ',
          coalesce((
            select trim(ste.program)
            from public.student_term_enrollments ste
            where ste.student_id = s.id
              and ste.academic_term_id = previous_term_id
              and ste.enrollment_status = 'enrolled'
            limit 1
          ), ''),
          ' -> ',
          coalesce(trim(r.program), ''),
          '. Review required.'
        )
        else null
      end,
    review_fingerprint =
      case
        when exists (
          select 1
          from public.student_term_enrollments ste
          where ste.student_id = s.id
            and ste.academic_term_id = previous_term_id
            and ste.enrollment_status = 'enrolled'
            and lower(trim(coalesce(ste.program, ''))) <>
                lower(trim(coalesce(r.program, '')))
        )
        then concat_ws(
          '|',
          'shifted_program',
          s.id::text,
          lower(trim(coalesce(r.student_number, ''))),
          lower(trim(coalesce((
            select ste.program
            from public.student_term_enrollments ste
            where ste.student_id = s.id
              and ste.academic_term_id = previous_term_id
              and ste.enrollment_status = 'enrolled'
            limit 1
          ), ''))),
          lower(trim(coalesce(r.program, '')))
        )
        else null
      end,
    review_status =
      case
        when exists (
          select 1
          from public.student_term_enrollments ste
          where ste.student_id = s.id
            and ste.academic_term_id = previous_term_id
            and ste.enrollment_status = 'enrolled'
            and lower(trim(coalesce(ste.program, ''))) <>
                lower(trim(coalesce(r.program, '')))
        )
        then
          case
            when r.review_status = 'approved'
              and r.review_fingerprint = concat_ws(
                '|',
                'shifted_program',
                s.id::text,
                lower(trim(coalesce(r.student_number, ''))),
                lower(trim(coalesce((
                  select ste.program
                  from public.student_term_enrollments ste
                  where ste.student_id = s.id
                    and ste.academic_term_id = previous_term_id
                    and ste.enrollment_status = 'enrolled'
                  limit 1
                ), ''))),
                lower(trim(coalesce(r.program, '')))
              )
            then r.review_status
            else 'pending_review'
          end
        else 'none'
      end,
    reviewed_by =
      case
        when exists (
          select 1
          from public.student_term_enrollments ste
          where ste.student_id = s.id
            and ste.academic_term_id = previous_term_id
            and ste.enrollment_status = 'enrolled'
            and lower(trim(coalesce(ste.program, ''))) <>
                lower(trim(coalesce(r.program, '')))
        )
          and r.review_status = 'approved'
          and r.review_fingerprint = concat_ws(
            '|',
            'shifted_program',
            s.id::text,
            lower(trim(coalesce(r.student_number, ''))),
            lower(trim(coalesce((
              select ste.program
              from public.student_term_enrollments ste
              where ste.student_id = s.id
                and ste.academic_term_id = previous_term_id
                and ste.enrollment_status = 'enrolled'
              limit 1
            ), ''))),
            lower(trim(coalesce(r.program, '')))
          )
        then r.reviewed_by
        else null
      end,
    reviewed_at =
      case
        when exists (
          select 1
          from public.student_term_enrollments ste
          where ste.student_id = s.id
            and ste.academic_term_id = previous_term_id
            and ste.enrollment_status = 'enrolled'
            and lower(trim(coalesce(ste.program, ''))) <>
                lower(trim(coalesce(r.program, '')))
        )
          and r.review_status = 'approved'
          and r.review_fingerprint = concat_ws(
            '|',
            'shifted_program',
            s.id::text,
            lower(trim(coalesce(r.student_number, ''))),
            lower(trim(coalesce((
              select ste.program
              from public.student_term_enrollments ste
              where ste.student_id = s.id
                and ste.academic_term_id = previous_term_id
                and ste.enrollment_status = 'enrolled'
              limit 1
            ), ''))),
            lower(trim(coalesce(r.program, '')))
          )
        then r.reviewed_at
        else null
      end,
    review_decision =
      case
        when exists (
          select 1
          from public.student_term_enrollments ste
          where ste.student_id = s.id
            and ste.academic_term_id = previous_term_id
            and ste.enrollment_status = 'enrolled'
            and lower(trim(coalesce(ste.program, ''))) <>
                lower(trim(coalesce(r.program, '')))
        )
          and r.review_status = 'approved'
          and r.review_fingerprint = concat_ws(
            '|',
            'shifted_program',
            s.id::text,
            lower(trim(coalesce(r.student_number, ''))),
            lower(trim(coalesce((
              select ste.program
              from public.student_term_enrollments ste
              where ste.student_id = s.id
                and ste.academic_term_id = previous_term_id
                and ste.enrollment_status = 'enrolled'
              limit 1
            ), ''))),
            lower(trim(coalesce(r.program, '')))
          )
        then r.review_decision
        else null
      end,
    review_note =
      case
        when exists (
          select 1
          from public.student_term_enrollments ste
          where ste.student_id = s.id
            and ste.academic_term_id = previous_term_id
            and ste.enrollment_status = 'enrolled'
            and lower(trim(coalesce(ste.program, ''))) <>
                lower(trim(coalesce(r.program, '')))
        )
          and r.review_status = 'approved'
          and r.review_fingerprint = concat_ws(
            '|',
            'shifted_program',
            s.id::text,
            lower(trim(coalesce(r.student_number, ''))),
            lower(trim(coalesce((
              select ste.program
              from public.student_term_enrollments ste
              where ste.student_id = s.id
                and ste.academic_term_id = previous_term_id
                and ste.enrollment_status = 'enrolled'
              limit 1
            ), ''))),
            lower(trim(coalesce(r.program, '')))
          )
        then r.review_note
        else null
      end
  from public.students s
  where lower(trim(s.student_number)) =
        lower(trim(r.student_number))
    and r.import_id = target_import_id;

  update public.masterlist_import_rows r
  set
    matched_student_id = null,
    reconciliation_status =
      case
        when (
          select count(*)
          from public.masterlist_import_rows d
          where d.import_id = target_import_id
            and lower(trim(d.student_number)) =
                lower(trim(r.student_number))
            and nullif(trim(d.student_number), '') is not null
        ) > 1
        then 'conflict'
        else 'new'
      end,
    issue_message =
      case
        when (
          select count(*)
          from public.masterlist_import_rows d
          where d.import_id = target_import_id
            and lower(trim(d.student_number)) =
                lower(trim(r.student_number))
            and nullif(trim(d.student_number), '') is not null
        ) > 1
        then 'Duplicate student number appears more than once in this masterlist.'
        else null
      end,
    review_status = 'none',
    reviewed_by = null,
    reviewed_at = null,
    review_decision = null,
    review_note = null,
    review_fingerprint = null
  where r.import_id = target_import_id
    and not exists (
      select 1
      from public.students s
      where lower(trim(s.student_number)) =
            lower(trim(r.student_number))
    )
    and nullif(trim(r.student_number), '') is not null
    and nullif(trim(r.first_name), '') is not null
    and nullif(trim(r.last_name), '') is not null;

  update public.masterlist_import_rows r
  set
    reconciliation_status = 'invalid',
    matched_student_id = null,
    issue_message =
      case
        when nullif(trim(r.student_number), '') is null
        then 'Student number is required.'
        else 'Student name is required.'
      end,
    review_status = 'none',
    reviewed_by = null,
    reviewed_at = null,
    review_decision = null,
    review_note = null,
    review_fingerprint = null
  where r.import_id = target_import_id
    and (
      nullif(trim(r.student_number), '') is null
      or nullif(trim(r.first_name), '') is null
      or nullif(trim(r.last_name), '') is null
    );

  update public.masterlist_imports mi
  set
    total_rows = (
      select count(*)
      from public.masterlist_import_rows
      where import_id = target_import_id
    ),
    valid_rows = (
      select count(*)
      from public.masterlist_import_rows
      where import_id = target_import_id
        and (
          reconciliation_status in (
            'new',
            'continuing',
            'returnee'
          )
          or (
            reconciliation_status = 'shifted_program'
            and review_status = 'approved'
          )
        )
    ),
    invalid_rows = (
      select count(*)
      from public.masterlist_import_rows
      where import_id = target_import_id
        and reconciliation_status = 'invalid'
    ),
    conflict_rows = (
      select count(*)
      from public.masterlist_import_rows
      where import_id = target_import_id
        and reconciliation_status = 'conflict'
    ),
    import_status = 'review'
  where mi.id = target_import_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_masterlist_import(target_import_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  target_term_id integer;
  current_import_status text;
  current_term_status text;
  actual_total integer;
  actual_invalid integer;
  actual_conflicts integer;
  actual_pending integer;
  actual_unapproved_shifted integer;
  r record;
  resolved_student_id integer;
begin
  select
    mi.academic_term_id,
    mi.import_status,
    at.status
  into
    target_term_id,
    current_import_status,
    current_term_status
  from public.masterlist_imports mi
  join public.academic_terms at
    on at.id = mi.academic_term_id
  where mi.id = target_import_id
  for update of mi;

  if target_term_id is null then
    raise exception 'Masterlist import % does not exist.',
      target_import_id;
  end if;

  if current_import_status <> 'review' then
    raise exception
      'Masterlist import % must be in review status before finalization. Current status: %.',
      target_import_id,
      current_import_status;
  end if;

  if current_term_status = 'closed' then
    raise exception
      'Cannot finalize a masterlist for a closed academic term.';
  end if;

  select
    count(*),
    count(*) filter (
      where reconciliation_status = 'invalid'
    ),
    count(*) filter (
      where reconciliation_status = 'conflict'
    ),
    count(*) filter (
      where reconciliation_status = 'pending'
    ),
    count(*) filter (
      where reconciliation_status = 'shifted_program'
        and review_status <> 'approved'
    )
  into
    actual_total,
    actual_invalid,
    actual_conflicts,
    actual_pending,
    actual_unapproved_shifted
  from public.masterlist_import_rows
  where import_id = target_import_id;

  if actual_total = 0 then
    raise exception
      'Cannot finalize an empty masterlist import.';
  end if;

  if actual_pending > 0 then
    raise exception
      'Cannot finalize masterlist import %. % row(s) are still pending reconciliation.',
      target_import_id,
      actual_pending;
  end if;

  if actual_invalid > 0 then
    raise exception
      'Cannot finalize masterlist import %. % invalid row(s) must be resolved first.',
      target_import_id,
      actual_invalid;
  end if;

  if actual_conflicts > 0 then
    raise exception
      'Cannot finalize masterlist import %. % conflict row(s) must be resolved first.',
      target_import_id,
      actual_conflicts;
  end if;

  if actual_unapproved_shifted > 0 then
    raise exception
      'Cannot finalize masterlist import %. % shifted program row(s) require approval first.',
      target_import_id,
      actual_unapproved_shifted;
  end if;

  for r in
    select *
    from public.masterlist_import_rows
    where import_id = target_import_id
      and reconciliation_status in (
        'new',
        'continuing',
        'shifted_program',
        'returnee'
      )
    order by row_number
  loop
    resolved_student_id := null;

    if r.reconciliation_status = 'new' then
      insert into public.students (
        student_number,
        first_name,
        last_name,
        email,
        program,
        year_level,
        is_shs,
        status
      )
      values (
        trim(r.student_number),
        trim(r.first_name),
        trim(r.last_name),
        nullif(trim(r.email), ''),
        r.program,
        r.year_level,
        r.is_shs,
        'pending'
      )
      returning id
      into resolved_student_id;

      update public.masterlist_import_rows
      set matched_student_id = resolved_student_id
      where id = r.id;
    else
      resolved_student_id := r.matched_student_id;

      if resolved_student_id is null then
        raise exception
          'Row % is classified as % but has no matched student.',
          r.row_number,
          r.reconciliation_status;
      end if;
    end if;

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
      resolved_student_id,
      target_term_id,
      r.program,
      r.year_level,
      r.is_shs,
      'enrolled',
      'masterlist'
    )
    on conflict (student_id, academic_term_id)
    do update set
      program = excluded.program,
      year_level = excluded.year_level,
      is_shs = excluded.is_shs,
      enrollment_status = 'enrolled',
      source = 'masterlist',
      updated_at = now();
  end loop;

  insert into public.student_term_enrollments (
    student_id,
    academic_term_id,
    program,
    year_level,
    is_shs,
    enrollment_status,
    source
  )
  select
    previous_enrollment.student_id,
    target_term_id,
    previous_enrollment.program,
    previous_enrollment.year_level,
    previous_enrollment.is_shs,
    'not_in_masterlist',
    'masterlist'
  from public.student_term_enrollments previous_enrollment
  join public.academic_terms previous_term
    on previous_term.id = previous_enrollment.academic_term_id
  join public.academic_terms target_term
    on target_term.id = target_term_id
  where previous_enrollment.enrollment_status = 'enrolled'
    and previous_enrollment.academic_term_id = (
      select candidate.id
      from public.academic_terms candidate
      where candidate.status in ('active', 'closed')
        and (
          split_part(candidate.academic_year, '-', 1)::integer,
          case
            when candidate.semester = '1st Semester' then 1
            when candidate.semester = '2nd Semester' then 2
          end
        ) < (
          split_part(target_term.academic_year, '-', 1)::integer,
          case
            when target_term.semester = '1st Semester' then 1
            when target_term.semester = '2nd Semester' then 2
          end
        )
      order by
        split_part(candidate.academic_year, '-', 1)::integer desc,
        case
          when candidate.semester = '1st Semester' then 1
          when candidate.semester = '2nd Semester' then 2
        end desc
      limit 1
    )
    and not exists (
      select 1
      from public.masterlist_import_rows current_row
      where current_row.import_id = target_import_id
        and current_row.matched_student_id =
            previous_enrollment.student_id
        and current_row.reconciliation_status in (
          'continuing',
          'shifted_program',
          'returnee'
        )
    )
  on conflict (student_id, academic_term_id)
  do update set
    enrollment_status = 'not_in_masterlist',
    source = 'masterlist',
    updated_at = now();

  update public.masterlist_imports
  set
    import_status = 'finalized',
    finalized_at = now(),
    total_rows = actual_total,
    invalid_rows = actual_invalid,
    conflict_rows = actual_conflicts
  where id = target_import_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_masterlist_import_row(
  target_row_id integer,
  expected_review_fingerprint text,
  decision text,
  note text DEFAULT null
)
RETURNS public.masterlist_import_rows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
declare
  reviewer public.admin_users;
  reviewed_row public.masterlist_import_rows;
begin
  select *
  into reviewer
  from public.admin_users
  where auth_user_id = auth.uid()
    and role = 'super_admin'
    and status = 'active';

  if reviewer.id is null then
    raise exception 'Active Super Admin authorization required.';
  end if;

  if decision not in (
    'approve_shifted_program',
    'reject_incoming_program'
  ) then
    raise exception 'Unsupported review decision.';
  end if;

  select *
  into reviewed_row
  from public.masterlist_import_rows
  where id = target_row_id
  for update;

  if reviewed_row.id is null then
    raise exception 'Masterlist import row not found.';
  end if;

  if reviewed_row.reconciliation_status <> 'shifted_program' then
    raise exception 'Only shifted program rows can be reviewed in this phase.';
  end if;

  if reviewed_row.review_status <> 'pending_review' then
    raise exception 'Only pending review rows can be resolved.';
  end if;

  if reviewed_row.review_fingerprint is null then
    raise exception 'Review data is incomplete. Re-run reconciliation and review this row again.';
  end if;

  if reviewed_row.review_fingerprint <> expected_review_fingerprint then
    raise exception 'Review data has changed. Refresh and review this row again.';
  end if;

  update public.masterlist_import_rows
  set
    review_status =
      case
        when decision = 'approve_shifted_program' then 'approved'
        when decision = 'reject_incoming_program' then 'rejected'
      end,
    review_decision = decision,
    reviewed_by = reviewer.id,
    reviewed_at = now(),
    review_note = nullif(trim(note), '')
  where id = target_row_id
  returning *
  into reviewed_row;

  return reviewed_row;
end;
$function$;

REVOKE ALL ON FUNCTION public.review_masterlist_import_row(integer, text, text, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.review_masterlist_import_row(integer, text, text, text)
  TO authenticated;

COMMIT;
