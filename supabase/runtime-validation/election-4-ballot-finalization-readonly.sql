-- READ ONLY. Run counts/metadata only; never print voter identities or choices.
select timezone('Asia/Manila',clock_timestamp()) as manila_now;
select id,organization_id,status,academic_term_id,start_date,end_date,
 electorate_policy_version,electorate_frozen_at,removed_at,results_released_at
from public.elections where id=4;
select id,status,semester,academic_year from public.academic_terms
where id=(select academic_term_id from public.elections where id=4);
select program,min_year_level,max_year_level,allow_shs
from public.eligibility_rules where election_id=4;
select (select count(*) from private.election_eligible_voters where election_id=4) as snapshot_count,
 (select count(*) from public.vote_ballots where election_id=4) as ballot_count,
 (select count(*) from public.votes where election_id=4) as vote_row_count;
select count(*) as proposed_eligible_count
from public.elections e
join public.academic_terms t on t.id=e.academic_term_id and t.status='active'
join public.students s on s.status='active' and s.auth_user_id is not null
join public.student_term_enrollments ste on ste.student_id=s.id
 and ste.academic_term_id=e.academic_term_id and ste.enrollment_status='enrolled'
cross join lateral public.resolve_student_organization_participation(s.id,e.organization_id,e.academic_term_id) p
where e.id=4 and (select count(*) from public.academic_terms where status='active')=1
 and p.allowed is true and upper(btrim(ste.program))='BSIT'
 and ste.year_level between 1 and 4 and ste.is_shs is false;
select p.id,p.name,p.status,count(c.id) as candidates,
 count(c.id) filter(where c.campaign_status='published') as published_campaigns
from public.positions p left join public.candidates c on c.position_id=p.id
where p.election_id=4 group by p.id,p.name,p.status;
select n.nspname,p.proname,pg_get_userbyid(p.proowner) as owner,
 md5(pg_get_functiondef(p.oid)) as definition_md5,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname in (
 'kandid_get_board_electorate_preview','kandid_lock_board_electorate',
 'kandid_get_student_ballot_candidates','kandid_is_locked_electorate_member',
 'kandid_require_locked_electorate_for_ballot','kandid_guard_frozen_electorate',
 'kandid_guard_frozen_ballot_rules','kandid_guard_unfinalized_ballot_start');
-- Authenticated scoped checks after approved backend installation, under the
-- REAL Board/student session only (never forge claims in production):
-- Board: kandid_get_board_electorate_preview(p_election_id => 4)
-- Eligible student during voting: kandid_get_student_ballot_candidates(p_election_id => 4)
-- Do not invoke the lock or submission RPC as a "validation" query.
