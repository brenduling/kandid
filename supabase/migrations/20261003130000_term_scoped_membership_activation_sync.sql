begin;

-- Resolve official enrollment program text to one trusted catalog identity.
-- Program names are not unique, so an ambiguous code/name match fails closed.
create or replace function public.kandid_resolve_program_catalog_id(p_program text)
returns bigint
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select case
    when pg_catalog.count(distinct p.id) = 1 then pg_catalog.min(p.id)::bigint
    else null::bigint
  end
  from public.programs p
  where nullif(pg_catalog.btrim(coalesce(p_program, '')), '') is not null
    and (
      pg_catalog.upper(pg_catalog.btrim(coalesce(p.code, ''))) =
        pg_catalog.upper(pg_catalog.btrim(coalesce(p_program, '')))
      or pg_catalog.upper(pg_catalog.btrim(coalesce(p.name, ''))) =
        pg_catalog.upper(pg_catalog.btrim(coalesce(p_program, '')))
    );
$function$;

alter function public.kandid_resolve_program_catalog_id(text) owner to postgres;
revoke all on function public.kandid_resolve_program_catalog_id(text)
  from public, anon, authenticated, service_role;

-- Manual admissions are term-specific. Program and institution membership is
-- generated only by the activation synchronizer below.
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
as $function$
declare
  active_term_count integer;
  active_term_id integer;
  organization_type_value text;
  membership_scope_value text;
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

  select o.organization_type, o.membership_scope
    into organization_type_value, membership_scope_value
  from public.organizations o
  where o.id = p_organization_id;

  if not found then
    reason := 'ORGANIZATION_NOT_FOUND';
    return next;
    return;
  end if;
  target_organization_type := organization_type_value;

  if membership_scope_value is null
     or membership_scope_value not in ('program', 'institution', 'manual') then
    reason := 'UNSUPPORTED_MEMBERSHIP_SCOPE';
    return next;
    return;
  end if;
  if organization_type_value is null
     or organization_type_value not in ('departmental', 'non_departmental')
     or (membership_scope_value = 'program' and organization_type_value <> 'departmental')
     or (membership_scope_value = 'manual' and organization_type_value <> 'non_departmental') then
    reason := 'UNSUPPORTED_ORGANIZATION_TYPE';
    return next;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(p_student_id, p_academic_term_id);

  select pg_catalog.count(*)::integer, pg_catalog.min(t.id)
    into active_term_count, active_term_id
  from public.academic_terms t
  where t.status = 'active';

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

  if not exists (
    select 1
    from public.student_term_enrollments ste
    where ste.student_id = p_student_id
      and ste.academic_term_id = active_term_id
      and ste.enrollment_status = 'enrolled'
  ) then
    reason := 'NOT_CURRENTLY_ENROLLED';
    return next;
    return;
  end if;

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

  if membership_scope_value <> 'manual' then
    reason := 'ACTIVATION_SYNC_REQUIRED';
    return next;
    return;
  end if;

  allowed := true;
  reason := 'ALLOWED';
  return next;
end;
$function$;

alter function public.kandid_check_student_organization_admission(integer, integer, integer) owner to postgres;
revoke all on function public.kandid_check_student_organization_admission(integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.kandid_check_student_organization_admission(integer, integer, integer)
  to service_role;

-- Preserve the trusted RPC contract; reserve system/program_sync provenance
-- for activation-created rows rather than ordinary manual enrollment calls.
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
as $function$
declare
  normalized_source text := pg_catalog.lower(pg_catalog.btrim(coalesce(target_source, 'system')));
  organization_type text;
  organization_scope text;
  participation_row public.student_organization_terms%rowtype;
  admission_row record;
begin
  if target_student_id is null or target_student_id <= 0
    or target_organization_id is null or target_organization_id <= 0
    or target_academic_term_id is null or target_academic_term_id <= 0 then
    status := 'denied'; source := null; reason := 'INVALID_REQUEST'; created := false;
    return next; return;
  end if;

  if normalized_source not in ('masterlist', 'manual', 'board_csv', 'student_setup') then
    status := 'denied'; source := null; reason := 'INVALID_SOURCE'; created := false;
    return next; return;
  end if;

  select o.organization_type, o.membership_scope into organization_type, organization_scope
  from public.organizations o where o.id = target_organization_id;
  if not found then
    status := 'denied'; source := null; reason := 'ORGANIZATION_NOT_FOUND'; created := false;
    return next; return;
  end if;
  if organization_scope is null or organization_scope not in ('program', 'institution', 'manual') then
    status := 'denied'; source := null; reason := 'UNSUPPORTED_MEMBERSHIP_SCOPE'; created := false;
    return next; return;
  end if;
  if organization_type is null
     or organization_type not in ('departmental', 'non_departmental')
     or (organization_scope = 'program' and organization_type <> 'departmental')
     or (organization_scope = 'manual' and organization_type <> 'non_departmental') then
    status := 'denied'; source := null; reason := 'UNSUPPORTED_ORGANIZATION_TYPE'; created := false;
    return next; return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(target_student_id, target_academic_term_id);

  select * into participation_row
  from public.student_organization_terms sot
  where sot.student_id = target_student_id
    and sot.organization_id = target_organization_id
    and sot.academic_term_id = target_academic_term_id;

  if found then
    if participation_row.status = 'removed' and organization_scope <> 'manual' then
      status := 'denied'; source := null; reason := 'ACTIVATION_SYNC_REQUIRED'; created := false;
      return next; return;
    end if;
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
    if participation_row.status = 'removed' and organization_scope <> 'manual' then
      status := 'denied'; source := null; reason := 'ACTIVATION_SYNC_REQUIRED'; created := false;
      return next; return;
    end if;
    status := participation_row.status; source := participation_row.source;
    reason := case when participation_row.status = 'removed'
      then 'TERM_PARTICIPATION_REMOVED' else 'TERM_PARTICIPATION_ACTIVE' end;
    created := false;
    return next; return;
  end if;

  status := 'denied'; source := null; reason := 'TERM_PARTICIPATION_UNAVAILABLE'; created := false;
  return next;
end;
$function$;

-- One trigger remains the database backstop for new grants, restores, and
-- ordinary removal. Non-manual activation writes require the private,
-- transaction-local marker set only by the activation helper.
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
  admission_row record;
begin
  select o.membership_scope, o.organization_type into organization_scope, organization_type_value
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
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
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
  if new.source = 'system'
     and sync_term_setting = new.academic_term_id::text then
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

      select t.id into previous_term_id
      from public.academic_terms t
      where t.academic_year = previous_academic_year
        and t.semester = previous_semester
        and t.status = 'closed';
      if previous_term_id is null or not exists (
        select 1 from public.student_organization_terms prior
        where prior.student_id = new.student_id
          and prior.organization_id = new.organization_id
          and prior.academic_term_id = previous_term_id
          and prior.status = 'active'
      ) then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
      end if;
      return new;
    end if;

    if organization_scope = 'program' then
      resolved_program_id := public.kandid_resolve_program_catalog_id(enrollment_program);
      if resolved_program_id is null or not exists (
        select 1 from public.organization_programs op
        where op.organization_id = new.organization_id
          and op.program_id = resolved_program_id
      ) then
        raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION';
      end if;
    end if;
    return new;
  end if;

  if organization_scope <> 'manual' then
    raise exception using errcode = '23514', message = 'MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED';
  end if;

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
$function$;

alter function public.guard_student_organization_term_admission() owner to postgres;
revoke all on function public.guard_student_organization_term_admission()
  from public, anon, authenticated, service_role;

drop trigger if exists student_organization_terms_admission_guard on public.student_organization_terms;
create trigger student_organization_terms_admission_guard
before insert or update of student_id, organization_id, academic_term_id, status
on public.student_organization_terms
for each row execute function public.guard_student_organization_term_admission();

-- Current membership is established only by an active term participation row.
-- Structural links and current catalog coverage never act as resolver fallbacks.
create or replace function public.resolve_student_organization_participation(
  target_student_id integer,
  target_organization_id integer,
  target_academic_term_id integer
)
returns table (allowed boolean, status text, source text, reason text)
language plpgsql
stable
set search_path = pg_catalog
as $function$
declare
  organization_scope text;
  organization_type_value text;
  enrollment_status_value text;
  participation_status text;
  participation_source text;
begin
  if target_student_id is null or target_student_id <= 0
    or target_organization_id is null or target_organization_id <= 0
    or target_academic_term_id is null or target_academic_term_id <= 0 then
    return query select false, null::text, null::text, 'invalid_request'::text;
    return;
  end if;

  select o.membership_scope, o.organization_type into organization_scope, organization_type_value
  from public.organizations o where o.id = target_organization_id;
  if not found then
    return query select false, null::text, null::text, 'organization_not_found'::text;
    return;
  end if;
  if organization_scope is null
     or organization_scope not in ('program', 'institution', 'manual') then
    return query select false, null::text, null::text, 'unsupported_membership_scope'::text;
    return;
  end if;
  if organization_type_value is null
     or organization_type_value not in ('departmental', 'non_departmental')
     or (organization_scope = 'program' and organization_type_value <> 'departmental')
     or (organization_scope = 'manual' and organization_type_value <> 'non_departmental') then
    return query select false, null::text, null::text, 'unsupported_organization_type'::text;
    return;
  end if;

  select ste.enrollment_status into enrollment_status_value
  from public.student_term_enrollments ste
  where ste.student_id = target_student_id
    and ste.academic_term_id = target_academic_term_id;
  if not found or enrollment_status_value <> 'enrolled' then
    return query select false, null::text, null::text, 'not_enrolled_for_term'::text;
    return;
  end if;

  select sot.status, sot.source into participation_status, participation_source
  from public.student_organization_terms sot
  where sot.student_id = target_student_id
    and sot.organization_id = target_organization_id
    and sot.academic_term_id = target_academic_term_id;
  if not found then
    return query select false, null::text, null::text, 'term_participation_missing'::text;
    return;
  end if;
  if participation_status = 'removed' then
    return query select false, participation_status, participation_source, 'term_participation_removed'::text;
    return;
  end if;
  return query select true, participation_status, participation_source, 'term_participation_active'::text;
end;
$function$;

revoke all on function public.resolve_student_organization_participation(integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.resolve_student_organization_participation(integer, integer, integer)
  to service_role;

-- Derive previous term only from the enforced semester sequence. NULL means
-- bootstrap, not permission to choose an arbitrary older term.
create or replace function public.kandid_previous_academic_term_id(p_target_term_id integer)
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  target_year text;
  target_semester text;
  target_start_year integer;
  previous_year text;
  previous_semester text;
  previous_id integer;
begin
  select t.academic_year, t.semester into target_year, target_semester
  from public.academic_terms t where t.id = p_target_term_id;
  if not found then return null; end if;

  target_start_year := pg_catalog.split_part(target_year, '-', 1)::integer;
  if target_semester = '2nd Semester' then
    previous_year := target_year;
    previous_semester := '1st Semester';
  elsif target_semester = '1st Semester' and target_start_year > 0 then
    previous_year := (target_start_year - 1)::text || '-' || target_start_year::text;
    previous_semester := '2nd Semester';
  else
    return null;
  end if;

  select t.id into previous_id
  from public.academic_terms t
  where t.academic_year = previous_year
    and t.semester = previous_semester
    and t.status = 'closed';
  return previous_id;
end;
$function$;

alter function public.kandid_previous_academic_term_id(integer) owner to postgres;
revoke all on function public.kandid_previous_academic_term_id(integer)
  from public, anon, authenticated, service_role;

create or replace function public.sync_organization_term_participation_for_activation(
  p_target_term_id integer
)
returns table (
  program_created_count integer,
  institution_created_count integer,
  manual_carried_count integer,
  structural_links_created_count integer,
  unresolved_program_count integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_term public.academic_terms%rowtype;
  previous_term_id integer;
  has_prior_history boolean;
  previous_sync_setting text;
begin
  program_created_count := 0;
  institution_created_count := 0;
  manual_carried_count := 0;
  structural_links_created_count := 0;
  unresolved_program_count := 0;

  select t.* into target_term
  from public.academic_terms t
  where t.id = p_target_term_id and t.status = 'active';
  if not found then
    raise exception using errcode = '55000', message = 'Membership synchronization requires the newly active academic term.';
  end if;

  -- Lock configuration rows in deterministic order. The trusted organization
  -- configuration and coverage RPCs lock these same organization rows.
  perform o.id
  from public.organizations o
  order by o.id
  for share;

  previous_term_id := public.kandid_previous_academic_term_id(p_target_term_id);
  if previous_term_id is null then
    select exists (
      select 1 from public.academic_terms t
      where t.id <> p_target_term_id
        and (t.status = 'closed' or t.activated_at is not null or t.closed_at is not null)
    ) into has_prior_history;
    if has_prior_history then
      raise exception using errcode = '55000', message = 'The immediately preceding academic term could not be verified for membership synchronization.';
    end if;
  end if;

  previous_sync_setting := pg_catalog.current_setting('kandid.membership_activation_term_id', true);
  perform pg_catalog.set_config('kandid.membership_activation_term_id', p_target_term_id::text, true);

  with enrolled as materialized (
    select ste.student_id, ste.program
    from public.student_term_enrollments ste
    where ste.academic_term_id = p_target_term_id
      and ste.enrollment_status = 'enrolled'
  ), resolved as materialized (
    select e.student_id, e.program,
      public.kandid_resolve_program_catalog_id(e.program) as program_id
    from enrolled e
  ), intended as materialized (
    select distinct r.student_id, o.id as organization_id, o.membership_scope
    from resolved r
    join public.organizations o on o.membership_scope in ('program', 'institution')
    where o.membership_scope = 'institution'
      or (
        o.membership_scope = 'program'
        and r.program_id is not null
        and exists (
          select 1 from public.organization_programs op
          where op.organization_id = o.id and op.program_id = r.program_id
        )
      )
    union
    select prior.student_id, o.id as organization_id, o.membership_scope
    from public.student_organization_terms prior
    join public.organizations o
      on o.id = prior.organization_id and o.membership_scope = 'manual'
    join enrolled e on e.student_id = prior.student_id
    where previous_term_id is not null
      and prior.academic_term_id = previous_term_id
      and prior.status = 'active'
  ), inserted as (
    insert into public.student_organization_terms (
      student_id, organization_id, academic_term_id, status, source
    )
    select i.student_id, i.organization_id, p_target_term_id, 'active', 'system'
    from intended i
    on conflict (student_id, organization_id, academic_term_id) do nothing
    returning student_id, organization_id
  ), structural_candidates as (
    select i.student_id, i.organization_id from inserted i
    union
    select i.student_id, i.organization_id
    from intended i
    join public.student_organization_terms existing
      on existing.student_id = i.student_id
     and existing.organization_id = i.organization_id
     and existing.academic_term_id = p_target_term_id
     and existing.status = 'active'
  ), structural as (
    insert into public.student_organizations (student_id, organization_id, role)
    select c.student_id, c.organization_id, 'member'
    from structural_candidates c
    on conflict (student_id, organization_id) do nothing
    returning 1
  )
  select
    pg_catalog.count(*) filter (where i_scope.membership_scope = 'program')::integer,
    pg_catalog.count(*) filter (where i_scope.membership_scope = 'institution')::integer,
    pg_catalog.count(*) filter (where i_scope.membership_scope = 'manual')::integer,
    (select pg_catalog.count(*)::integer from structural),
    (select pg_catalog.count(*)::integer
       from resolved r where r.program_id is null)
  into program_created_count, institution_created_count, manual_carried_count,
       structural_links_created_count, unresolved_program_count
  from inserted i
  join intended i_scope
    on i_scope.student_id = i.student_id and i_scope.organization_id = i.organization_id;

  perform pg_catalog.set_config(
    'kandid.membership_activation_term_id', coalesce(previous_sync_setting, ''), true
  );

  return next;
end;
$function$;

alter function public.sync_organization_term_participation_for_activation(integer) owner to postgres;
revoke all on function public.sync_organization_term_participation_for_activation(integer)
  from public, anon, authenticated, service_role;

-- Keep the validated activation contract unchanged except for the transactional
-- synchronization call after a real draft-to-active transition.
create or replace function public.activate_academic_term(target_term_id integer)
returns public.academic_terms
language plpgsql
security definer
volatile
set search_path = pg_catalog
as $function$
declare
  active_term_count integer;
  active_term_row public.academic_terms%rowtype;
  target_term_row public.academic_terms%rowtype;
  bootstrap_term_id integer;
  active_start_year integer;
  target_start_year integer;
  expected_start_year integer;
  expected_semester text;
begin
  if target_term_id is null then
    raise exception using errcode = '22023', message = 'Academic term is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(20261003, 12000);

  select pg_catalog.count(*)::integer into active_term_count
  from public.academic_terms t where t.status = 'active';
  if active_term_count > 1 then
    raise exception using errcode = '55000', message = 'Multiple active academic terms require administrator review.';
  end if;

  select t.* into target_term_row
  from public.academic_terms t where t.id = target_term_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'Academic term was not found.';
  end if;

  if active_term_count = 1 then
    select t.* into active_term_row
    from public.academic_terms t where t.status = 'active' for update;

    if target_term_row.id = active_term_row.id then
      return active_term_row;
    end if;
    if target_term_row.status <> 'draft' then
      raise exception using errcode = '22023', message = 'Only draft academic terms can be activated.';
    end if;

    active_start_year := pg_catalog.split_part(active_term_row.academic_year, '-', 1)::integer;
    target_start_year := pg_catalog.split_part(target_term_row.academic_year, '-', 1)::integer;
    if active_term_row.semester = '1st Semester' then
      expected_start_year := active_start_year;
      expected_semester := '2nd Semester';
    elsif active_term_row.semester = '2nd Semester' then
      expected_start_year := active_start_year + 1;
      expected_semester := '1st Semester';
    else
      raise exception using errcode = '22023', message = 'The active term has an unsupported semester value.';
    end if;
    if target_start_year <> expected_start_year or target_term_row.semester <> expected_semester then
      raise exception using errcode = '22023', message = 'Only the immediate following academic term can be activated.';
    end if;
  else
    if exists (
      select 1 from public.academic_terms t
      where t.status = 'closed' or t.activated_at is not null or t.closed_at is not null
    ) then
      raise exception using errcode = '55000', message = 'No active term exists after prior term history; use an administrator recovery workflow.';
    end if;
    if target_term_row.status <> 'draft' then
      raise exception using errcode = '22023', message = 'Only draft academic terms can be activated.';
    end if;
    select t.id into bootstrap_term_id
    from public.academic_terms t
    where t.status = 'draft'
    order by
      pg_catalog.split_part(t.academic_year, '-', 1)::integer,
      case t.semester when '1st Semester' then 1 when '2nd Semester' then 2 else 3 end,
      t.id
    limit 1 for update;
    if bootstrap_term_id is null or bootstrap_term_id <> target_term_row.id then
      raise exception using errcode = '22023', message = 'Initial activation must use the earliest configured academic term.';
    end if;
  end if;

  if active_term_count = 1 then
    update public.academic_terms t
    set status = 'closed', closed_at = coalesce(t.closed_at, pg_catalog.now())
    where t.id = active_term_row.id;
  end if;

  update public.academic_terms t
  set status = 'active', activated_at = coalesce(t.activated_at, pg_catalog.now()), closed_at = null
  where t.id = target_term_row.id and t.status = 'draft'
  returning t.* into target_term_row;
  if not found then
    raise exception using errcode = '40001', message = 'Academic term activation conflicted with another update.';
  end if;

  perform 1 from public.sync_organization_term_participation_for_activation(target_term_row.id);
  return target_term_row;
end;
$function$;

alter function public.activate_academic_term(integer) owner to postgres;
revoke all on function public.activate_academic_term(integer) from public, anon, authenticated;
grant execute on function public.activate_academic_term(integer) to service_role;

comment on function public.kandid_resolve_program_catalog_id(text) is
  'Resolves normalized enrollment program text to exactly one trusted catalog program; unresolved and ambiguous values return NULL.';
comment on function public.sync_organization_term_participation_for_activation(integer) is
  'Internal activation-only synchronization of program, institution, and carried manual term participation; returns aggregate counts and never changes frozen electorates.';
comment on function public.activate_academic_term(integer) is
  'Activates only the immediate following 1st/2nd semester, permits eligible initial bootstrap, and atomically synchronizes organization participation for the newly active term.';

commit;
