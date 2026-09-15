begin;

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
set search_path = public, pg_temp
as $$
declare
  normalized_source text := lower(trim(coalesce(target_source, 'system')));
  participation_row public.student_organization_terms%rowtype;
begin
  if target_student_id is null
    or target_student_id <= 0
    or target_organization_id is null
    or target_organization_id <= 0
    or target_academic_term_id is null
    or target_academic_term_id <= 0 then
    status := 'denied';
    source := null;
    reason := 'invalid_input';
    created := false;
    return next;
    return;
  end if;

  if normalized_source not in ('masterlist', 'manual', 'board_csv', 'student_setup', 'program_sync', 'system') then
    status := 'denied';
    source := null;
    reason := 'invalid_source';
    created := false;
    return next;
    return;
  end if;

  select *
    into participation_row
  from public.student_organization_terms
  where student_id = target_student_id
    and organization_id = target_organization_id
    and academic_term_id = target_academic_term_id;

  if found then
    status := participation_row.status;
    source := participation_row.source;
    reason := case
      when participation_row.status = 'removed' then 'term_participation_removed'
      else 'term_participation_active'
    end;
    created := false;
    return next;
    return;
  end if;

  if not exists (
    select 1
    from public.student_term_enrollments
    where student_id = target_student_id
      and academic_term_id = target_academic_term_id
      and enrollment_status = 'enrolled'
  ) then
    status := 'denied';
    source := null;
    reason := 'not_enrolled_for_term';
    created := false;
    return next;
    return;
  end if;

  insert into public.student_organization_terms (
    student_id,
    organization_id,
    academic_term_id,
    status,
    source
  )
  values (
    target_student_id,
    target_organization_id,
    target_academic_term_id,
    'active',
    normalized_source
  )
  on conflict (student_id, organization_id, academic_term_id) do nothing
  returning *
    into participation_row;

  if found then
    status := participation_row.status;
    source := participation_row.source;
    reason := 'term_participation_created';
    created := true;
    return next;
    return;
  end if;

  select *
    into participation_row
  from public.student_organization_terms
  where student_id = target_student_id
    and organization_id = target_organization_id
    and academic_term_id = target_academic_term_id;

  if found then
    status := participation_row.status;
    source := participation_row.source;
    reason := case
      when participation_row.status = 'removed' then 'term_participation_removed'
      else 'term_participation_active'
    end;
    created := false;
    return next;
    return;
  end if;

  status := 'denied';
  source := null;
  reason := 'term_participation_unavailable';
  created := false;
  return next;
end;
$$;

revoke all on function public.ensure_student_organization_term_participation(integer, integer, integer, text) from public;
revoke all on function public.ensure_student_organization_term_participation(integer, integer, integer, text) from anon;
revoke all on function public.ensure_student_organization_term_participation(integer, integer, integer, text) from authenticated;
grant execute on function public.ensure_student_organization_term_participation(integer, integer, integer, text) to service_role;

commit;
