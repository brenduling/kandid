-- READ ONLY. Prepare/capture only; explicit production SQL approval required.
-- Compare with the reviewed repository contracts before installing the proposal.
begin read only;
set local statement_timeout='15s';
select current_database(),version();
with expected(signature,reviewed_fixture_md5) as (values
 ('public.activate_academic_term(integer)','743fd26961017ee9b988d76586107d2f'),
 ('public.kandid_guard_candidate_mutation()','e5cee55575617f826b5d90c75c1451a5'),
 ('public.insert_v2_vote_rows(integer,integer,jsonb)','197c45b640f429441111c6963feaa5a9'),
 ('private.kandid_require_locked_electorate_for_ballot()','6802a2abfe7ce14749d026e2f3e66e7b'),
 ('public.kandid_check_student_ballot_eligibility(integer)','b6970955d8c23c41ac04be2d4fe83b10'),
 ('public.sync_organization_term_participation_for_activation(integer)','2e9e72f285c76105b6dc3815b4a4fbcc'),
 ('public.resolve_student_organization_participation(integer,integer,integer)','9ba6236c32f519d3f8e210f06023c4da'),
 ('public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)','c19e908f17e1a0bd525a2aa9e20d9763'),
 ('public.kandid_board_register_verified_student_for_term_v1(bigint,integer,text,text,text,text,text,integer,text,boolean,boolean,text,text,text)','7622af7cb09f04f012d970128da12323')
)
select e.signature,p.oid is not null as present,pg_get_userbyid(p.proowner) as owner,
 p.prosecdef as security_definer,p.proconfig,p.proacl,
 md5(pg_get_functiondef(p.oid)) as deployed_md5,e.reviewed_fixture_md5,
 md5(pg_get_functiondef(p.oid))=e.reviewed_fixture_md5 as matches_reviewed_fixture
from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature);
select id,academic_year,semester,status,activated_at,closed_at from public.academic_terms order by id;
select tablename,indexname,indexdef from pg_indexes where schemaname='public'
 and tablename in ('academic_terms','student_term_enrollments','student_organization_terms','student_notifications');
select c.conrelid::regclass as relation,c.conname,pg_get_constraintdef(c.oid)
 from pg_constraint c where c.conrelid in ('public.academic_terms'::regclass,'public.student_notifications'::regclass);
select t.tgrelid::regclass as relation,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)
 from pg_trigger t where not t.tgisinternal and t.tgrelid in
 ('public.candidates'::regclass,'public.vote_ballots'::regclass,'public.audit_logs'::regclass);
select tablename,policyname,roles,cmd,qual,with_check from pg_policies
 where schemaname='public' and tablename in ('academic_terms','system_settings');
select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns
 where table_schema='public' and table_name in
 ('academic_terms','student_term_enrollments','student_organization_terms','system_settings','student_notifications','audit_logs')
 order by table_name,ordinal_position;
select id,system_name,allow_multiple_votes,allow_abstain,default_election_duration,maintenance_mode,created_at
 from public.system_settings order by id;
select sequencename,start_value,increment_by,last_value from pg_sequences
 where schemaname='public' and sequencename='system_settings_id_seq';
select membership_scope,count(*) from public.organizations group by membership_scope;
select id,name,membership_scope,organization_type from public.organizations
 where upper(trim(name)) in ('WITSG','WIT-SG','WIT SG');
select count(*) as persistent_students,count(*) filter(where status='active') as active_accounts from public.students;
select to_regclass('private.academic_term_transition_reviews') as installed_reviews;
rollback;
