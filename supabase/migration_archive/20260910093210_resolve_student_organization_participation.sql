BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_student_organization_participation(
  target_student_id integer,
  target_organization_id integer,
  target_academic_term_id integer
)
RETURNS TABLE (
  allowed boolean,
  status text,
  source text,
  reason text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  enrolled_program text;
  participation_status text;
  participation_source text;
  has_structural_membership boolean;
  has_program_eligibility boolean;
  organization_exists boolean;
begin
  if target_student_id is null
    or target_organization_id is null
    or target_academic_term_id is null
  then
    return query
    select
      false,
      null::text,
      null::text,
      'invalid_request'::text;
    return;
  end if;

  select ste.program
  into enrolled_program
  from public.student_term_enrollments ste
  where ste.student_id = target_student_id
    and ste.academic_term_id = target_academic_term_id
    and ste.enrollment_status = 'enrolled'
  limit 1;

  if not found then
    return query
    select
      false,
      null::text,
      null::text,
      'not_enrolled_for_term'::text;
    return;
  end if;

  select sot.status, sot.source
  into participation_status, participation_source
  from public.student_organization_terms sot
  where sot.student_id = target_student_id
    and sot.organization_id = target_organization_id
    and sot.academic_term_id = target_academic_term_id
  limit 1;

  if found then
    if participation_status = 'removed' then
      return query
      select
        false,
        participation_status,
        participation_source,
        'term_participation_removed'::text;
      return;
    end if;

    if participation_status = 'active' then
      return query
      select
        true,
        participation_status,
        participation_source,
        'term_participation_active'::text;
      return;
    end if;
  end if;

  select exists (
    select 1
    from public.organizations o
    where o.id = target_organization_id
  )
  into organization_exists;

  if not organization_exists then
    return query
    select
      false,
      null::text,
      null::text,
      'organization_not_found'::text;
    return;
  end if;

  select exists (
    select 1
    from public.student_organizations so
    where so.student_id = target_student_id
      and so.organization_id = target_organization_id
  )
  into has_structural_membership;

  if has_structural_membership then
    return query
    select
      true,
      'active'::text,
      'structural'::text,
      'structural_membership_fallback'::text;
    return;
  end if;

  select exists (
    select 1
    from public.organization_programs op
    join public.programs p
      on p.id = op.program_id
    where op.organization_id = target_organization_id
      and (
        lower(trim(coalesce(p.code, ''))) = lower(trim(coalesce(enrolled_program, '')))
        or lower(trim(coalesce(p.name, ''))) = lower(trim(coalesce(enrolled_program, '')))
      )
  )
  into has_program_eligibility;

  if has_program_eligibility then
    return query
    select
      true,
      'active'::text,
      'program'::text,
      'program_eligibility_fallback'::text;
    return;
  end if;

  return query
  select
    false,
    null::text,
    null::text,
    'not_eligible_for_organization'::text;
end;
$function$;

REVOKE ALL ON FUNCTION public.resolve_student_organization_participation(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_student_organization_participation(integer, integer, integer)
  TO service_role;

COMMIT;
