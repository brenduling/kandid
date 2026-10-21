-- LOCAL DESIGN COMPONENT ONLY. NOT a complete deployment migration.
-- The scheduled request/worker and public RPC adapters are specified in
-- docs/optional-eligibility-scheduled-finalization.md and require review.
-- This file does not change an election, populate an electorate or schedule a job.
begin;

-- Canonical population predicate, independent of election lifecycle/time.
-- The caller must ALSO enforce active status, voting time and frozen membership
-- for candidate access and submission. Preview may evaluate a draft electorate.
create function private.kandid_student_matches_optional_eligibility(
  p_election_id integer,p_student_id integer
)
returns boolean language sql stable set search_path=pg_catalog
as $function$
 select exists (
  select 1
  from public.elections e
  join public.academic_terms t on t.id=e.academic_term_id and t.status='active'
  join public.students s on s.id=p_student_id and s.status='active'
    and s.auth_user_id is not null
  join public.student_term_enrollments ste on ste.student_id=s.id
    and ste.academic_term_id=e.academic_term_id and ste.enrollment_status='enrolled'
  cross join lateral public.resolve_student_organization_participation(
    s.id,e.organization_id,e.academic_term_id
  ) participation
  where e.id=p_election_id and e.removed_at is null
    and (select count(*) from public.academic_terms where status='active')=1
    and participation.allowed is true
    and (
      not exists (select 1 from public.eligibility_rules r where r.election_id=e.id)
      or exists (
        select 1 from public.eligibility_rules r where r.election_id=e.id
          and (r.program is null or upper(btrim(ste.program))=upper(btrim(r.program)))
          and (
            (ste.is_shs is true and r.allow_shs is true)
            or (ste.is_shs is false and ste.year_level between 1 and 6
              and (r.min_year_level is null or ste.year_level>=r.min_year_level)
              and (r.max_year_level is null or ste.year_level<=r.max_year_level))
          )
      )
    )
 );
$function$;
alter function private.kandid_student_matches_optional_eligibility(integer,integer) owner to postgres;
revoke all on function private.kandid_student_matches_optional_eligibility(integer,integer)
 from public,anon,authenticated,service_role;
commit;
