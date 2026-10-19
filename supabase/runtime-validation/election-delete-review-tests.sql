\set ON_ERROR_STOP on
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $f$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %', label; end if; end;
$f$;
create function pg_temp.expect_error(statement text, expected_state text) returns void language plpgsql as $f$
begin
  begin execute statement; exception when others then
    if sqlstate = expected_state then return; end if;
    raise exception 'UNEXPECTED FAILURE: expected %, got %', expected_state, sqlstate;
  end;
  raise exception 'EXPECTED DENIAL DID NOT OCCUR';
end;
$f$;
create function pg_temp.state_digest() returns text language sql stable as $f$
  select md5(jsonb_build_array(
    (select jsonb_agg(to_jsonb(t) order by id) from public.admin_users t),
    (select jsonb_agg(to_jsonb(t) order by id) from public.elections t),
    (select jsonb_agg(to_jsonb(t) order by election_id,student_id) from private.election_eligible_voters t),
    (select jsonb_agg(to_jsonb(t) order by id) from public.votes t),
    (select jsonb_agg(to_jsonb(t) order by id) from public.vote_ballots t),
    (select jsonb_agg(to_jsonb(t) order by id) from public.audit_logs t),
    (select jsonb_agg(to_jsonb(t) order by id) from public.student_term_enrollments t),
    (select jsonb_agg(to_jsonb(t) order by id) from public.student_organization_terms t),
    (select jsonb_agg(to_jsonb(t) order by id) from public.masterlist_imports t)
  )::text)
$f$;
select pg_temp.state_digest() as digest \gset baseline_
select pg_temp.assert_true(current_setting('server_version_num')::int between 170000 and 179999,'PostgreSQL 17');
select pg_temp.assert_true((select r.rolname='postgres' and p.prosecdef and p.provolatile='s'
  and p.proconfig=array['search_path=pg_catalog'] from pg_proc p join pg_roles r on r.oid=p.proowner
  where p.oid='public.kandid_get_board_election_delete_dependency_count(integer)'::regprocedure),'owner/search_path/STABLE/SECURITY DEFINER');
select pg_temp.assert_true(has_function_privilege('authenticated','public.kandid_get_board_election_delete_dependency_count(integer)','EXECUTE')
  and not has_function_privilege('anon','public.kandid_get_board_election_delete_dependency_count(integer)','EXECUTE')
  and not has_function_privilege('service_role','public.kandid_get_board_election_delete_dependency_count(integer)','EXECUTE'),'RPC grants');
select pg_temp.assert_true(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a
  where p.oid='public.kandid_get_board_election_delete_dependency_count(integer)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC execution revoked');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='private.election_eligible_voters'::regclass)
  and not has_table_privilege('authenticated','private.election_eligible_voters','SELECT')
  and not has_table_privilege('service_role','private.election_eligible_voters','SELECT'),'private RLS and table restrictions');
select pg_temp.assert_true((select prosrc !~* '\m(insert|update|delete|truncate)\M' from pg_proc
 where oid='public.kandid_get_board_election_delete_dependency_count(integer)'::regprocedure),'RPC body has no data mutation');
\echo PASS 01-06 catalog security

begin read only;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true) is not null as claim_set \gset
select pg_temp.assert_true(public.kandid_get_board_election_delete_dependency_count(1)=
  '{"election_id":1,"frozen_electorate_records":1}'::jsonb,'own Board exact count and no personal fields');
select pg_temp.assert_true(public.kandid_get_board_election_delete_dependency_count(4)=
  '{"election_id":4,"frozen_electorate_records":0}'::jsonb,'genuine zero count');
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(3)','42501');
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(999)','42501');
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(null)','22023');
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(0)','22023');
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(-1)','22023');
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(p_election_id=>1, organization_id=>20)','42883');
select pg_temp.expect_error('select * from private.election_eligible_voters','42501');
\echo PASS 07-15 own/empty/foreign/missing/invalid/forged/private access

select set_config('request.jwt.claims','{"organization_id":20,"role":"super_admin"}',true) is not null as claims_set \gset
select pg_temp.assert_true(public.kandid_get_board_election_delete_dependency_count(1)->>'frozen_electorate_records'='1','forged JWT metadata ignored');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true) is not null as claim_set \gset
select pg_temp.assert_true(public.kandid_get_board_election_delete_dependency_count(3)->>'frozen_electorate_records'='2','other Board own organization');
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(1)','42501');
\echo PASS 16-18 trusted organization derivation

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true) is not null as claim_set \gset
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(1)','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true) is not null as claim_set \gset
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(1)','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true) is not null as claim_set \gset
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(1)','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000006',true) is not null as claim_set \gset
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(1)','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',true) is not null as claim_set \gset
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(1)','42501');
select set_config('request.jwt.claim.sub','',true) is not null as claim_set \gset
select set_config('request.jwt.claims','',true) is not null as claims_set \gset
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(1)','28000');
select set_config('request.jwt.claim.sub','invalid-uuid',true) is not null as claim_set \gset
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(1)','22P02');
\echo PASS 19-25 student/unassigned/inactive/admin/duplicate/missing/invalid identity denial

reset role;
set local role anon;
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(1)','42501');
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true) is not null as claim_set \gset
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(1)','42501');
select pg_temp.expect_error('select * from private.election_eligible_voters','42501');
reset role;
select pg_temp.assert_true(pg_temp.state_digest()=:'baseline_digest','all synthetic historical data unchanged');
rollback;
\echo PASS 26-29 anon/service-role denial and data preservation

create temporary table admin_users(auth_user_id uuid,role text,status text,organization_id bigint);
insert into pg_temp.admin_users values('00000000-0000-4000-8000-000000000003','electoral_board','active',10);
begin read only;
set local search_path=pg_temp,public;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true) is not null as claim_set \gset
select pg_temp.expect_error('select public.kandid_get_board_election_delete_dependency_count(1)','42501');
reset role;
select pg_temp.assert_true(pg_temp.state_digest()=:'baseline_digest','read-only and hostile-search-path calls preserve all data');
rollback;
\echo PASS 30-31 hostile search_path denial and final preservation
