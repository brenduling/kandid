begin;

-- One trusted admission predicate shared by registration, import, and restore
-- paths. The term argument is checked against the single active term; callers
-- cannot choose a historical term to satisfy current admission requirements.
create or replace function public.kandid_check_student_organization_admission(
  p_student_id integer,
  p_organization_id integer,
  p_academic_term_id integer
)
returns table (
  allowed boolean,
  reason text,
  target_organization_type text,
  academic_term_id integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  active_term_count integer;
  active_term_id integer;
  enrollment_program text;
  organization_type_value text;
  participation_status text;
begin
  allowed := false;
  reason := 'INVALID_REQUEST';
  target_organization_type := null;
  academic_term_id := null;

  if p_student_id is null or p_student_id <= 0
    or p_organization_id is null or p_organization_id <= 0
    or p_academic_term_id is null or p_academic_term_id <= 0 then
    return next;
    return;
  end if;

  select o.organization_type
    into organization_type_value
  from public.organizations o
  where o.id = p_organization_id;

  if not found then
    reason := 'ORGANIZATION_NOT_FOUND';
    return next;
    return;
  end if;
  target_organization_type := organization_type_value;

  if organization_type_value is distinct from 'departmental'
    and organization_type_value is distinct from 'non_departmental' then
    reason := 'UNSUPPORTED_ORGANIZATION_TYPE';
    return next;
    return;
  end if;

  -- Serialize admission checks with participation inserts/removals for this
  -- student and term. The row trigger below takes the same lock.
  perform pg_catalog.pg_advisory_xact_lock(p_student_id, p_academic_term_id);

  select pg_catalog.count(*)::integer, pg_catalog.min(at.id)
    into active_term_count, active_term_id
  from public.academic_terms at
  where at.status = 'active';

  if active_term_count <> 1 then
    reason := 'ACTIVE_TERM_UNAVAILABLE';
    return next;
    return;
  end if;

  academic_term_id := p_academic_term_id;
  if p_academic_term_id <> active_term_id then
    reason := 'TERM_NOT_ACTIVE';
    return next;
    return;
  end if;

  select ste.program
    into enrollment_program
  from public.student_term_enrollments ste
  where ste.student_id = p_student_id
    and ste.academic_term_id = active_term_id
    and ste.enrollment_status = 'enrolled'
  limit 1;

  if not found then
    reason := 'NOT_CURRENTLY_ENROLLED';
    return next;
    return;
  end if;

  -- Idempotent registration of an already-active target membership is not a
  -- new admission and must not create a continuous departmental dependency.
  select sot.status
    into participation_status
  from public.student_organization_terms sot
  where sot.student_id = p_student_id
    and sot.organization_id = p_organization_id
    and sot.academic_term_id = active_term_id;

  if found and participation_status = 'active' then
    allowed := true;
    reason := 'ALREADY_ACTIVE';
    return next;
    return;
  end if;

  if organization_type_value = 'non_departmental' then
    allowed := true;
    reason := 'ALLOWED';
    return next;
    return;
  end if;

  if organization_type_value = 'departmental' then
    if nullif(pg_catalog.btrim(coalesce(enrollment_program, '')), '') is not null
      and exists (
        select 1
        from public.organization_programs op
        join public.programs p on p.id = op.program_id
        where op.organization_id = p_organization_id
          and (
            pg_catalog.upper(pg_catalog.btrim(coalesce(p.code, ''))) = pg_catalog.upper(pg_catalog.btrim(enrollment_program))
            or pg_catalog.upper(pg_catalog.btrim(coalesce(p.name, ''))) = pg_catalog.upper(pg_catalog.btrim(enrollment_program))
          )
      ) then
      allowed := true;
      reason := 'ALLOWED';
    else
      reason := 'PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION';
    end if;
    return next;
    return;
  end if;

  reason := 'UNSUPPORTED_ORGANIZATION_TYPE';
  return next;
end;
$$;

revoke all on function public.kandid_check_student_organization_admission(integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.kandid_check_student_organization_admission(integer, integer, integer)
  to service_role;

comment on function public.kandid_check_student_organization_admission(integer, integer, integer) is
  'Trusted active-term organization admission predicate; non-departmental admission requires current official enrollment, while departmental admission also enforces program coverage.';

-- Keep the existing service-role helper as the common insert path and return
-- the precise trusted admission reason for current-term requests.
create or replace function public.ensure_student_organization_term_participation(
  target_student_id integer,
  target_organization_id integer,
  target_academic_term_id integer,
  target_source text default 'system'
)
returns table (
  status text,
  source text,
  reason text,
  created boolean
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  normalized_source text := pg_catalog.lower(pg_catalog.btrim(coalesce(target_source, 'system')));
  participation_row public.student_organization_terms%rowtype;
  admission_row record;
begin
  if target_student_id is null or target_student_id <= 0
    or target_organization_id is null or target_organization_id <= 0
    or target_academic_term_id is null or target_academic_term_id <= 0 then
    status := 'denied'; source := null; reason := 'INVALID_REQUEST'; created := false;
    return next; return;
  end if;

  if normalized_source not in ('masterlist', 'manual', 'board_csv', 'student_setup', 'program_sync', 'system') then
    status := 'denied'; source := null; reason := 'INVALID_SOURCE'; created := false;
    return next; return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(target_student_id, target_academic_term_id);

  select * into participation_row
  from public.student_organization_terms sot
  where sot.student_id = target_student_id
    and sot.organization_id = target_organization_id
    and sot.academic_term_id = target_academic_term_id;

  if found then
    status := participation_row.status;
    source := participation_row.source;
    reason := case when participation_row.status = 'removed'
      then 'TERM_PARTICIPATION_REMOVED' else 'TERM_PARTICIPATION_ACTIVE' end;
    created := false;
    return next; return;
  end if;

  select * into admission_row
  from public.kandid_check_student_organization_admission(
    target_student_id, target_organization_id, target_academic_term_id
  );

  if not coalesce(admission_row.allowed, false) then
    status := 'denied'; source := null;
    reason := coalesce(admission_row.reason, 'ADMISSION_DENIED');
    created := false;
    return next; return;
  end if;

  insert into public.student_organization_terms (
    student_id, organization_id, academic_term_id, status, source
  ) values (
    target_student_id, target_organization_id, target_academic_term_id, 'active', normalized_source
  )
  on conflict (student_id, organization_id, academic_term_id) do nothing
  returning * into participation_row;

  if found then
    status := participation_row.status; source := participation_row.source;
    reason := 'TERM_PARTICIPATION_CREATED'; created := true;
    return next; return;
  end if;

  select * into participation_row
  from public.student_organization_terms sot
  where sot.student_id = target_student_id
    and sot.organization_id = target_organization_id
    and sot.academic_term_id = target_academic_term_id;

  if found then
    status := participation_row.status; source := participation_row.source;
    reason := case when participation_row.status = 'removed'
      then 'TERM_PARTICIPATION_REMOVED' else 'TERM_PARTICIPATION_ACTIVE' end;
    created := false;
    return next; return;
  end if;

  status := 'denied'; source := null; reason := 'TERM_PARTICIPATION_UNAVAILABLE'; created := false;
  return next;
end;
$$;

revoke all on function public.ensure_student_organization_term_participation(integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.ensure_student_organization_term_participation(integer, integer, integer, text)
  to service_role;

-- Final database backstop for any trusted direct write. Existing active
-- memberships are left alone; only a new grant/reactivation is an admission.
create or replace function public.guard_student_organization_term_admission()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  admission_row record;
begin
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
  select * into admission_row
  from public.kandid_check_student_organization_admission(
    new.student_id, new.organization_id, new.academic_term_id
  );

  if not coalesce(admission_row.allowed, false) then
    raise exception using
      errcode = '23514',
      message = 'MEMBERSHIP_ADMISSION_DENIED:' || coalesce(admission_row.reason, 'ACTIVE_TERM_UNAVAILABLE');
  end if;

  return new;
end;
$$;

revoke all on function public.guard_student_organization_term_admission()
  from public, anon, authenticated, service_role;
grant execute on function public.guard_student_organization_term_admission()
  to service_role;

drop trigger if exists student_organization_terms_admission_guard on public.student_organization_terms;
create trigger student_organization_terms_admission_guard
before insert or update of student_id, organization_id, academic_term_id, status
on public.student_organization_terms
for each row execute function public.guard_student_organization_term_admission();

-- Admission-only semantics: explicit active target participation remains valid
-- after departmental participation changes, while legacy structural/program
-- fallbacks cannot establish a non-departmental target membership.
create or replace function public.resolve_student_organization_participation(
  target_student_id integer,
  target_organization_id integer,
  target_academic_term_id integer
)
returns table (allowed boolean, status text, source text, reason text)
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  enrolled_program text;
  participation_status text;
  participation_source text;
  has_structural_membership boolean;
  has_program_eligibility boolean;
  organization_type_value text;
begin
  if target_student_id is null or target_organization_id is null or target_academic_term_id is null then
    return query select false, null::text, null::text, 'invalid_request'::text;
    return;
  end if;

  select o.organization_type into organization_type_value
  from public.organizations o where o.id = target_organization_id;

  if not found then
    return query select false, null::text, null::text, 'organization_not_found'::text;
    return;
  end if;

  if organization_type_value is distinct from 'departmental'
    and organization_type_value is distinct from 'non_departmental' then
    return query select false, null::text, null::text, 'unsupported_organization_type'::text;
    return;
  end if;

  select ste.program into enrolled_program
  from public.student_term_enrollments ste
  where ste.student_id = target_student_id
    and ste.academic_term_id = target_academic_term_id
    and ste.enrollment_status = 'enrolled'
  limit 1;

  if not found then
    return query select false, null::text, null::text, 'not_enrolled_for_term'::text;
    return;
  end if;

  select sot.status, sot.source into participation_status, participation_source
  from public.student_organization_terms sot
  where sot.student_id = target_student_id
    and sot.organization_id = target_organization_id
    and sot.academic_term_id = target_academic_term_id
  limit 1;

  if found then
    if participation_status = 'removed' then
      return query select false, participation_status, participation_source, 'term_participation_removed'::text;
      return;
    end if;
    if participation_status = 'active' then
      return query select true, participation_status, participation_source, 'term_participation_active'::text;
      return;
    end if;
  end if;

  if organization_type_value = 'non_departmental' then
    return query select false, null::text, null::text, 'non_departmental_term_participation_required'::text;
    return;
  end if;

  select exists (
    select 1 from public.student_organizations so
    where so.student_id = target_student_id and so.organization_id = target_organization_id
  ) into has_structural_membership;

  if has_structural_membership then
    return query select true, 'active'::text, 'structural'::text, 'structural_membership_fallback'::text;
    return;
  end if;

  select exists (
    select 1
    from public.organization_programs op
    join public.programs p on p.id = op.program_id
    where op.organization_id = target_organization_id
      and (
        pg_catalog.lower(pg_catalog.btrim(coalesce(p.code, ''))) = pg_catalog.lower(pg_catalog.btrim(coalesce(enrolled_program, '')))
        or pg_catalog.lower(pg_catalog.btrim(coalesce(p.name, ''))) = pg_catalog.lower(pg_catalog.btrim(coalesce(enrolled_program, '')))
      )
  ) into has_program_eligibility;

  if has_program_eligibility then
    return query select true, 'active'::text, 'program'::text, 'program_eligibility_fallback'::text;
    return;
  end if;

  return query select false, null::text, null::text, 'not_eligible_for_organization'::text;
end;
$$;

revoke all on function public.resolve_student_organization_participation(integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.resolve_student_organization_participation(integer, integer, integer)
  to service_role;

comment on function public.resolve_student_organization_participation(integer, integer, integer) is
  'Resolves term eligibility; non-departmental fallback eligibility requires an explicit active term participation.';

commit;
