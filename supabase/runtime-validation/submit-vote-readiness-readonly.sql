-- Official project: fszgdxqxonqqcrzsnkca. SELECT-only deployment preflight.
-- Counts and function metadata only: no vote choices, hashes, nonces or identities.
select timezone('UTC', clock_timestamp()) as checked_at_utc,
       timezone('Asia/Manila', clock_timestamp()) as checked_at_manila;

select id, organization_id, academic_term_id, status, electorate_policy_version,
       electorate_frozen_at, start_date, end_date,
       (select count(*) from private.election_eligible_voters v where v.election_id=e.id) as snapshot_count,
       (select count(*) from public.vote_ballots b where b.election_id=e.id) as ballot_count,
       (select count(*) from public.votes v where v.election_id=e.id) as vote_row_count
from public.elections e where id=3;

select count(*) as incomplete_active_policy_v1_count,
       coalesce(jsonb_agg(id order by id),'[]'::jsonb) as election_ids
from public.elections
where status='active' and electorate_policy_version=1 and electorate_frozen_at is null;

-- The ballot worker is global; approval must cover this existing backlog.
select blockchain_anchor_status, count(*) as ballot_count
from public.vote_ballots group by blockchain_anchor_status order by blockchain_anchor_status;

-- Election metadata and aggregate queue conditions only. Never call a claim RPC.
select b.election_id,e.title as election_title,e.status as election_status,
       e.electorate_policy_version,e.electorate_frozen_at,e.start_date,e.end_date,
       e.removed_at is null as election_not_removed,
       b.blockchain_anchor_status,count(*) as ballot_count,
       min(b.created_at) as earliest_created_at,
       max(b.blockchain_retry_count) as maximum_retry_count,
       bool_and(b.hash_version='KANDID_BALLOT_V1') as ballot_v1,
       bool_and(b.ballot_hash ~ '^0x[0-9a-f]{64}$') as hash_format_valid,
       bool_and(b.blockchain_tx_id is null) as transaction_absent,
       bool_and(b.blockchain_next_retry_at is null or b.blockchain_next_retry_at <= now()) as retry_due,
       bool_and(b.blockchain_anchor_claimed_at is null) as currently_unclaimed,
       sum((select count(*) from public.votes v where v.ballot_id=b.id)) as grouped_vote_row_count
from public.vote_ballots b join public.elections e on e.id=b.election_id
where b.blockchain_anchor_status='pending'
group by b.election_id,e.title,e.status,e.electorate_policy_version,
         e.electorate_frozen_at,e.start_date,e.end_date,e.removed_at,b.blockchain_anchor_status;

select count(*) filter(where max_votes>1) as multiselect_position_count,
       count(*) filter(where status is distinct from 'active') as nonactive_position_count
from public.positions;

select p.oid::regprocedure::text as signature, r.rolname as owner,
       p.prosecdef as security_definer, p.proconfig as configuration,
       md5(pg_get_functiondef(p.oid)) as definition_md5,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.proname in (
 'insert_v2_vote_rows','kandid_is_locked_electorate_member',
 'resolve_student_organization_participation',
 'acquire_ballot_anchor_signer_lease','release_ballot_anchor_signer_lease',
 'claim_next_ballot_anchor','claim_next_submitted_ballot_anchor',
 'mark_ballot_anchor_failure','mark_ballot_anchor_submitted',
 'mark_ballot_anchor_success','mark_ballot_manual_review')
order by signature;

select c.relname as table_name,t.tgname,t.tgenabled,
       pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('votes','vote_ballots') and not t.tgisinternal
order by c.relname,t.tgname;

select role_name,table_name,
       has_table_privilege(role_name,'public.'||table_name,'SELECT') as can_select,
       has_table_privilege(role_name,'public.'||table_name,'INSERT') as can_insert,
       has_table_privilege(role_name,'public.'||table_name,'UPDATE') as can_update,
       has_table_privilege(role_name,'public.'||table_name,'DELETE') as can_delete
from (values('anon'),('authenticated'),('service_role')) roles(role_name)
cross join (values('votes'),('vote_ballots')) tables(table_name)
order by role_name,table_name;

select e.extname,e.extversion,n.nspname as extension_schema
from pg_extension e join pg_namespace n on n.oid=e.extnamespace
where e.extname in ('pgcrypto','pg_cron');
select to_regclass('cron.job') is not null as database_cron_catalog_exists;
