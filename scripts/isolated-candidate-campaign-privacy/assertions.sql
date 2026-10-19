\set ON_ERROR_STOP on

do $catalog$
declare b record; f text; expected_snapshot jsonb; actual_snapshot jsonb;
begin
  if current_setting('server_version_num')::integer < 170000 then raise exception 'PostgreSQL 17 required'; end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid='public.candidates'::regclass) then raise exception 'candidate RLS disabled'; end if;
  if has_table_privilege('anon','public.candidates','SELECT') or has_table_privilege('authenticated','public.candidates','SELECT') then raise exception 'table SELECT remains'; end if;
  if has_column_privilege('anon','public.candidates','id','SELECT') then raise exception 'anonymous candidate column grant remains'; end if;
  if has_column_privilege('authenticated','public.candidates','bio','SELECT') is distinct from
    exists(select 1 from supabase_migrations.schema_migrations where version='20261018231601') then
    raise exception 'Admin compatibility column grant does not match the installed contract';
  end if;
  if not has_column_privilege('authenticated','public.candidates','id','SELECT') or not has_column_privilege('authenticated','public.candidates','position_id','SELECT') then raise exception 'admin id/position read grant missing'; end if;
  foreach f in array array['public.kandid_can_admin_read_candidate_v1(integer)','public.kandid_get_student_published_campaign(integer)','public.get_student_campaign(integer)','public.kandid_get_student_ballot_candidates(integer)','public.kandid_get_student_result_candidates(integer)'] loop
    if not exists(select 1 from pg_catalog.pg_proc p where p.oid=f::regprocedure and p.prosecdef and p.proconfig=array['search_path=pg_catalog']::text[] and pg_catalog.pg_get_userbyid(p.proowner)='postgres') then raise exception 'function security mismatch: %',f; end if;
    if has_function_privilege('anon',f,'EXECUTE') then raise exception 'anonymous execute: %',f; end if;
  end loop;
  select * into b from public.test_fixture_before_counts;
  if (select count(*) from public.elections)<>b.elections or (select count(*) from public.positions)<>b.positions or (select count(*) from public.candidates)<>b.candidates or (select count(*) from public.vote_ballots)<>b.ballots or (select count(*) from public.votes)<>b.votes or (select count(*) from private.election_eligible_voters)<>b.frozen_electorate or (select count(*) from public.partylists)<>b.partylists then raise exception 'protected fixture records changed'; end if;
  IF to_regclass('public.test_fixture_preservation_before') IS NOT NULL THEN
    SELECT snapshot INTO expected_snapshot FROM public.test_fixture_preservation_before;
    WITH f(table_name,row_count,row_digest) AS (
      SELECT 'organizations',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.organizations t UNION ALL
      SELECT 'academic_terms',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.academic_terms t UNION ALL
      SELECT 'students',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.students t UNION ALL
      SELECT 'student_term_enrollments',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.student_term_enrollments t UNION ALL
      SELECT 'student_organization_terms',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.student_organization_terms t UNION ALL
      SELECT 'elections',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.elections t UNION ALL
      SELECT 'positions',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.positions t UNION ALL
      SELECT 'candidates',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.candidates t UNION ALL
      SELECT 'candidate_media',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.candidate_media t UNION ALL
      SELECT 'partylists',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.partylists t UNION ALL
      SELECT 'eligibility_rules',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.eligibility_rules t UNION ALL
      SELECT 'election_access_tokens',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.election_access_tokens t UNION ALL
      SELECT 'election_campaign_snapshots',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.election_campaign_snapshots t UNION ALL
      SELECT 'archived_elections',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.archived_elections t UNION ALL
      SELECT 'votes',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.votes t UNION ALL
      SELECT 'vote_ballots',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.vote_ballots t UNION ALL
      SELECT 'election_eligible_voters',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM private.election_eligible_voters t UNION ALL
      SELECT 'officers',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.officers t UNION ALL
      SELECT 'officer_new_roster',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.officer_new_roster t UNION ALL
      SELECT 'officer_leadership_releases',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.officer_leadership_releases t UNION ALL
      SELECT 'election_officer_publications',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.election_officer_publications t UNION ALL
      SELECT 'election_officer_publication_entries',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.election_officer_publication_entries t UNION ALL
      SELECT 'audit_logs',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) FROM public.audit_logs t
    ) SELECT jsonb_object_agg(table_name,jsonb_build_object('rows',row_count,'md5',row_digest) ORDER BY table_name) INTO actual_snapshot FROM f;
    IF expected_snapshot IS DISTINCT FROM actual_snapshot THEN RAISE EXCEPTION 'One or more 23-group preservation fingerprints changed'; END IF;
  END IF;
  if (select public from storage.buckets where id='campaign-materials') is distinct from false then raise exception 'campaign bucket must be private'; end if;
end;
$catalog$;

set role anon;
do $anon$
begin
  begin perform c.id from public.candidates c; raise exception 'anonymous candidate read succeeded'; exception when insufficient_privilege then null; end;
  begin perform public.kandid_get_student_published_campaign(10); raise exception 'anonymous RPC succeeded'; exception when insufficient_privilege then null; end;
end;
$anon$;
reset role;

set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
do $student_a$
declare v jsonb; w jsonb; n integer;
begin
  if (select count(*) from public.candidates)<>0 then raise exception 'student direct candidate rows leaked'; end if;
  if has_column_privilege('authenticated','public.candidates','bio','SELECT') then
    if exists(select 1 from public.candidates where bio is not null) then raise exception 'Student direct bio read leaked rows'; end if;
  else
    begin perform c.bio from public.candidates c; raise exception 'student read bio succeeded'; exception when insufficient_privilege then null; end;
  end if;
  v:=public.kandid_get_student_published_campaign(10);
  if v->>'status'<>'AVAILABLE' or jsonb_array_length(v#>'{data,candidates}')<>1 then raise exception 'published campaign mismatch: %',v; end if;
  if v::text like '%SECRET%' or v::text like '%student_id%' or v::text not like '%123e4567-e89b-42d3-a456-426614174000.webp%' then raise exception 'campaign disclosed draft or wrong file reference'; end if;
  if public.get_student_campaign(10) is distinct from v then raise exception 'legacy RPC bypass or contract mismatch'; end if;
  foreach n in array array[11,12,13,14,15,16] loop
    v:=public.kandid_get_student_published_campaign(n);
    if v->>'status'<>'UNAVAILABLE' or v->'data'<>'null'::jsonb then raise exception 'closed/upcoming/foreign campaign % returned data',n; end if;
  end loop;
  v:=public.kandid_get_student_published_campaign(17);
  if v->>'status'<>'EMPTY' then raise exception 'active-term legacy campaign phase failed'; end if;
  w:=public.kandid_get_student_ballot_candidates(10);
  if jsonb_array_length(w)<>3 then raise exception 'ballot identity count changed'; end if;
  if w::text like '%SECRET%' or w::text like '%campaign_materials%' or w::text like '%student_id%' or w::text like '%bio%' then raise exception 'ballot leaked campaign fields'; end if;
  w:=public.kandid_get_student_ballot_candidates(17);
  if jsonb_array_length(w)<>1 then raise exception 'policy-0 live ballot failed'; end if;
  begin perform public.kandid_get_student_ballot_candidates(16); raise exception 'foreign ballot allowed'; exception when insufficient_privilege then null; end;
  w:=public.kandid_get_student_result_candidates(14);
  if jsonb_array_length(w)<>1 or w::text like '%History Draft Secret%' or w::text like '%campaign_materials%' or w::text like '%student_id%' then raise exception 'historical result projection mismatch'; end if;
  begin perform public.kandid_get_student_result_candidates(15); raise exception 'hidden result allowed'; exception when insufficient_privilege then null; end;
  begin perform public.kandid_get_student_result_candidates(16); raise exception 'foreign result allowed'; exception when insufficient_privilege then null; end;
  if public.kandid_can_admin_read_candidate_v1(1001) then raise exception 'student got admin authorization'; end if;
  if public.kandid_campaign_storage_access_v1('1/10/223e4567-e89b-42d3-a456-426614174000.webp','read') then raise exception 'draft storage ref authorized'; end if;
  if public.kandid_campaign_storage_access_v1('2/16/323e4567-e89b-42d3-a456-426614174000.webp','read') then raise exception 'foreign storage ref authorized'; end if;
end;
$student_a$;
reset role;

set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
do $student_b$
declare v jsonb;
begin
  v:=public.kandid_get_student_published_campaign(16);
  if v->>'status'<>'AVAILABLE' or jsonb_array_length(v#>'{data,candidates}')<>1 then raise exception 'own organization campaign denied'; end if;
  if public.kandid_can_admin_read_candidate_v1(1601) then raise exception 'student got admin row authorization'; end if;
  v:=public.kandid_get_student_published_campaign(10);
  if v->>'status'<>'UNAVAILABLE' or v->'data'<>'null'::jsonb then raise exception 'foreign campaign returned data'; end if;
end;
$student_b$;
reset role;

set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
do $ineligible$
declare v jsonb;
begin
  v:=public.kandid_get_student_published_campaign(10);
  if v->>'status'<>'UNAVAILABLE' or v->'data'<>'null'::jsonb then raise exception 'ineligible campaign visible'; end if;
  begin perform public.kandid_get_student_ballot_candidates(10); raise exception 'ineligible ballot visible'; exception when insufficient_privilege then null; end;
end;
$ineligible$;
reset role;
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
do $disabled$
declare v jsonb;
begin
  v:=public.kandid_get_student_published_campaign(10);
  if v->>'status'<>'UNAUTHORIZED' or v->'data'<>'null'::jsonb then raise exception 'disabled student campaign visible'; end if;
end;
$disabled$;
reset role;

set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',false);
do $board$
declare n integer;
begin
  if (select count(*) from public.candidates)<>9 then raise exception 'Board direct candidate rows not org-scoped'; end if;
  select count(*) into n from public.kandid_admin_candidate_directory(array[10],null);
  if n<>3 then raise exception 'Board admin draft directory failed'; end if;
  if exists(select 1 from public.kandid_admin_candidate_directory(array[16],null)) then raise exception 'Board directory exposed foreign org'; end if;
  if public.kandid_can_admin_read_candidate_v1(1601) or not public.kandid_can_admin_read_candidate_v1(1002) then raise exception 'Board row helper scope mismatch'; end if;
end;
$board$;
reset role;
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000020',false);
do $foreign_board$
begin
  if (select count(*) from public.candidates)<>1 then raise exception 'foreign Board RLS scope failed'; end if;
  if exists(select 1 from public.kandid_admin_candidate_directory(array[10],null)) then raise exception 'foreign Board directory leak'; end if;
  if not public.kandid_can_admin_read_candidate_v1(1601) or public.kandid_can_admin_read_candidate_v1(1001) then raise exception 'foreign Board helper scope mismatch'; end if;
end;
$foreign_board$;
reset role;
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000030',false);
do $super_admin$
declare n integer;
begin
  if (select count(*) from public.candidates)<>10 then raise exception 'Super Admin direct read failed'; end if;
  select count(*) into n from public.kandid_admin_candidate_directory(null,null);
  if n<>10 or not public.kandid_can_admin_read_candidate_v1(1601) then raise exception 'Super Admin draft access failed'; end if;
end;
$super_admin$;
reset role;

set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','',false);
do $no_identity$
begin
  if public.kandid_get_student_published_campaign(10)->>'status'<>'UNAUTHORIZED' then raise exception 'missing identity not rejected'; end if;
  begin perform public.kandid_get_student_ballot_candidates(10); raise exception 'missing identity got ballot'; exception when sqlstate '28000' then null; when insufficient_privilege then null; end;
end;
$no_identity$;
reset role;

-- The frozen Storage migration is applied separately in the disposable fixture.
select 'CAMPAIGN_PRIVACY_ASSERTIONS_PART1=PASS' as result;
