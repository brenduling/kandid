-- Read-only preflight and immediate post-lock validation for official Election 3.
-- Project: fszgdxqxonqqcrzsnkca. This file performs SELECTs only.
-- Run through an authorized administrative read-only connection.
-- It returns no voter identities or vote choices.
-- "current_eligible" is the old membership-only admission predicate.
-- Declared-rule and proposed-rule counts are separate; no rule is changed here.
-- Compare sets immediately after locking; later enrollment/membership/identity
-- changes may legitimately differ from an immutable historical snapshot.
with target as (
  select id, organization_id, academic_term_id, status, start_date, end_date,
         campaign_start, campaign_end, electorate_policy_version,
         electorate_frozen_at, electorate_frozen_by is not null as has_frozen_by,
         removed_at is not null as is_removed,
         results_released_at is not null as results_released
  from public.elections where id = 3
),
current_eligible as (
  select s.id
  from target e
  join public.students s on s.status = 'active' and s.auth_user_id is not null
  cross join lateral public.resolve_student_organization_participation(
    s.id, e.organization_id, e.academic_term_id
  ) participation
  where participation.allowed is true
),
snapshot as (
  select student_id as id from private.election_eligible_voters where election_id = 3
),
declared_rule_review as (
  select c.id, exists (
    select 1 from public.eligibility_rules r
    where r.election_id = 3
      and (r.program is null or upper(trim(ste.program)) = upper(trim(r.program)))
      and (
        (ste.is_shs is true and r.allow_shs is true)
        or (ste.is_shs is false
          and (r.min_year_level is null or ste.year_level >= r.min_year_level)
          and (r.max_year_level is null or ste.year_level <= r.max_year_level))
      )
  ) as matches_declared_rule
  from current_eligible c
  cross join target e
  left join public.student_term_enrollments ste
    on ste.student_id = c.id and ste.academic_term_id = e.academic_term_id
),
missing_from_snapshot as (
  select id from declared_rule_review where matches_declared_rule
  except select id from snapshot
),
extra_in_snapshot as (
  select id from snapshot
  except select id from declared_rule_review where matches_declared_rule
),
proposed_eligible as (
  select c.id from current_eligible c
  cross join target e
  join public.academic_terms t on t.id=e.academic_term_id and t.status='active'
  join public.student_term_enrollments ste on ste.student_id=c.id
    and ste.academic_term_id=e.academic_term_id and ste.enrollment_status='enrolled'
  where e.status='active' and not e.is_removed
    and (select count(*) from public.academic_terms where status='active')=1
    and upper(btrim(ste.program))='BSIT' and ste.year_level between 1 and 4
    and ste.is_shs is false
),
other_affected as (
  select id from public.elections
  where id <> 3 and status = 'active'
    and electorate_policy_version = 1 and electorate_frozen_at is null
)
select jsonb_build_object(
  'checked_at_manila', timezone('Asia/Manila', statement_timestamp()),
  'election', (select to_jsonb(e) from target e),
  'active_term_count', (select count(*) from public.academic_terms where status = 'active'),
  'election_term_is_active', coalesce((select exists (
    select 1 from public.academic_terms t where t.id = e.academic_term_id and t.status = 'active'
  ) from target e), false),
  'schedule_allows_lock', coalesce((select
    e.status = 'active' and e.electorate_policy_version = 1
    and not e.is_removed and not e.results_released
    and e.electorate_frozen_at is null
    and e.start_date < e.end_date
    and timezone('Asia/Manila', statement_timestamp()) < e.start_date
    from target e), false),
  'current_membership_eligible_count', (select count(*) from current_eligible),
  'proposed_bsit_years_1_to_4_eligible_count', (select count(*) from proposed_eligible),
  'proposed_pending_or_unlinked_count', (select count(*) from proposed_eligible p
    join public.students s on s.id=p.id where s.status<>'active' or s.auth_user_id is null),
  'declared_rule_count', (select count(*) from public.eligibility_rules where election_id = 3),
  'current_eligible_matching_term_rule_count', (select count(*) from declared_rule_review where matches_declared_rule),
  'current_eligible_not_matching_term_rule_count', (select count(*) from declared_rule_review where not matches_declared_rule),
  'snapshot_count', (select count(*) from snapshot),
  'missing_from_snapshot_count', (select count(*) from missing_from_snapshot),
  'extra_in_snapshot_count', (select count(*) from extra_in_snapshot),
  'vote_ballots_count', (select count(*) from public.vote_ballots where election_id = 3),
  'vote_rows_count', (select count(*) from public.votes where election_id = 3),
  'legacy_vote_rows_count', (select count(*) from public.votes where election_id = 3 and ballot_id is null),
  'completed_lock_audit_count', (select count(*) from public.audit_logs
    where election_id = 3 and action = 'election_electorate_locked'
      and status = 'completed' and event_origin = 'trusted_database'),
  'other_active_unfrozen_v1_count', (select count(*) from other_affected),
  'other_active_unfrozen_v1_ids', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from other_affected)
);
