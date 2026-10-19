begin;

-- A missing predecessor is valid only when the target is the earliest configured term.
-- Later-term activation history must not block first-term bootstrap; earlier configured
-- terms still require the exact immediately preceding closed term for manual carry-forward.
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
  if previous_term_id is null and exists (
    select 1 from public.academic_terms t
    where t.id <> p_target_term_id
      and (
        pg_catalog.split_part(t.academic_year, '-', 1)::integer
          < pg_catalog.split_part(target_term.academic_year, '-', 1)::integer
        or (
          pg_catalog.split_part(t.academic_year, '-', 1)::integer
            = pg_catalog.split_part(target_term.academic_year, '-', 1)::integer
          and case t.semester when '1st Semester' then 1 when '2nd Semester' then 2 else 3 end
            < case target_term.semester when '1st Semester' then 1 when '2nd Semester' then 2 else 3 end
        )
      )
  ) then
    raise exception using errcode = '55000', message = 'The immediately preceding academic term could not be verified for membership synchronization.';
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

revoke all on function public.sync_organization_term_participation_for_activation(integer) from public, anon, authenticated, service_role;

comment on function public.sync_organization_term_participation_for_activation(integer) is
  'Internal activation synchronization; permits bootstrap only for the earliest configured term, derives program/institution scope from enrollment and configuration, and carries manual scope only from the immediate closed predecessor.';

commit;
