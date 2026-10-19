\set ON_ERROR_STOP on
BEGIN;
DO $security$
DECLARE sig text;
BEGIN
  IF has_column_privilege('authenticated','public.candidates','student_id','SELECT')
    OR has_column_privilege('authenticated','public.candidates','campaign_status','SELECT') THEN RAISE EXCEPTION 'Private candidate columns exposed'; END IF;
  FOREACH sig IN ARRAY ARRAY['public.kandid_get_election_campaign_publication_v1(integer)','public.kandid_publish_election_campaigns_v1(integer,text)'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=sig::regprocedure AND prosecdef AND pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=pg_catalog']::text[])
      OR NOT has_function_privilege('authenticated',sig,'EXECUTE') OR has_function_privilege('anon',sig,'EXECUTE') OR has_function_privilege('service_role',sig,'EXECUTE') THEN RAISE EXCEPTION 'RPC security mismatch: %',sig; END IF;
  END LOOP;
  IF has_function_privilege('authenticated','private.kandid_election_campaign_publication_state_v1(integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.prevent_duplicate_candidate_per_election()','EXECUTE') THEN RAISE EXCEPTION 'Internal function exposed'; END IF;
END;
$security$;
SELECT 'RPC_OWNER_SEARCH_PATH_EXECUTE_AND_COLUMN_PRIVACY=PASS';

INSERT INTO public.students(id,auth_user_id,status,student_number,first_name,last_name,program,year_level)
VALUES(5,'00000000-0000-4000-8000-000000000005','active','SYN-5','Synthetic','Five','BSIT',2);
UPDATE public.students SET status='active' WHERE id=4;
INSERT INTO public.student_term_enrollments VALUES(105,5,1,'enrolled','BSIT',2),(106,4,1,'enrolled','BSIT',1);
INSERT INTO public.student_organization_terms VALUES(205,5,1,1,'active','program'),(206,4,1,1,'active','program');
INSERT INTO public.admin_users(id,auth_user_id,role,status,organization_id) VALUES(40,'00000000-0000-4000-8000-000000000040','electoral_board','active',null);
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('campaign-materials','1/18/123e4567-e89b-42d3-a456-426614174000.pdf','00000000-0000-4000-8000-000000000010');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',true);
INSERT INTO public.candidates(position_id,student_id,partylist_id,bio) VALUES(180,1,1,'Synthetic original');
SELECT (c->>'id')::integer AS first_id FROM public.kandid_admin_candidate_directory(ARRAY[18],ARRAY[1]) c WHERE (c->>'position_id')::integer=180 \gset
SELECT set_config('kandid.test_first_id',:'first_id',true);
INSERT INTO public.candidates(id,position_id,student_id,partylist_id) VALUES(3002,180,3,1),(3003,180,5,1);
-- Seed a deliberate Hidden record using the existing authorized contract.
RESET ROLE;
UPDATE public.candidates SET campaign_status='hidden' WHERE id=3003 RETURNING id;
SET LOCAL ROLE authenticated;
DO $no_individual_publish$
BEGIN
  PERFORM set_config('kandid.campaign_publish','true',true);
  BEGIN UPDATE public.candidates SET campaign_status='published' WHERE id=3002 AND position_id=180;
    RAISE EXCEPTION 'Direct publication bypassed the atomic contract'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.candidates(position_id,student_id,campaign_status) VALUES(180,4,'published');
    RAISE EXCEPTION 'New candidate published without election confirmation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$no_individual_publish$;
SELECT 'DIRECT_STATUS_WRITES_AND_FORGED_SESSION_GATE_DENIED=PASS';
DO $add_edit$
DECLARE changed integer; review jsonb;
BEGIN
  review:=public.kandid_get_election_campaign_publication_v1(18);
  IF review->>'publication_status'<>'draft' OR (review->>'draft_candidates')::integer<>2 OR (review->>'hidden_candidates')::integer<>1 THEN RAISE EXCEPTION 'New candidates did not remain draft'; END IF;
  UPDATE public.candidates SET bio='Synthetic updated',campaign_materials='[{"label":"Synthetic PDF","url":"storage://campaign-materials/1/18/123e4567-e89b-42d3-a456-426614174000.pdf","type":"document","downloadable":true}]',
    campaign_media_urls='["storage://campaign-materials/1/18/123e4567-e89b-42d3-a456-426614174000.pdf"]'
    WHERE id=current_setting('kandid.test_first_id')::integer AND position_id=180 AND bio='Synthetic original';
  GET DIAGNOSTICS changed=ROW_COUNT; IF changed<>1 THEN RAISE EXCEPTION 'Candidate edit/material save failed'; END IF;
  BEGIN
    INSERT INTO public.candidates(position_id,student_id) VALUES(180,1);
    RAISE EXCEPTION 'Duplicate accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'This student is already a candidate for %' THEN RAISE; END IF; END;
END;
$add_edit$;
SELECT 'ADD_DEFAULT_DRAFT_EDIT_MATERIALS_AND_DUPLICATE_PROTECTION=PASS';

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $student_before$
DECLARE payload jsonb;
BEGIN
  payload:=public.kandid_get_student_published_campaign(18);
  IF payload->>'status'<>'EMPTY' THEN RAISE EXCEPTION 'Draft/hidden campaign leaked'; END IF;
  IF public.kandid_campaign_storage_access_v1('1/18/123e4567-e89b-42d3-a456-426614174000.pdf','read') THEN RAISE EXCEPTION 'Draft private file exposed'; END IF;
END;
$student_before$;
SELECT 'DRAFT_HIDDEN_AND_PRIVATE_STORAGE_DENIED_BEFORE_PUBLICATION=PASS';

DO $unauthorized$
DECLARE caller text;
BEGIN
  FOREACH caller IN ARRAY ARRAY['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000040',''] LOOP
    PERFORM set_config('request.jwt.claim.sub',caller,true);
    BEGIN PERFORM public.kandid_get_election_campaign_publication_v1(18); RAISE EXCEPTION 'Unauthorized preview accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.kandid_publish_election_campaigns_v1(18,repeat('0',32)); RAISE EXCEPTION 'Unauthorized publish accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN INSERT INTO public.candidates(position_id,student_id) VALUES(180,2); RAISE EXCEPTION 'Unauthorized candidate creation accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END;
$unauthorized$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN BEGIN PERFORM public.kandid_get_election_campaign_publication_v1(18); RAISE EXCEPTION 'Anonymous RPC allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END; $$;
RESET ROLE;
SELECT 'STUDENT_FOREIGN_BOARD_UNASSIGNED_MISSING_IDENTITY_ANON_DENIED=PASS';

-- Any row/statement error after updates and audit triggers must undo all rows.
CREATE FUNCTION public.synthetic_fail_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic publication failure'; END; $$;
CREATE TRIGGER synthetic_fail_publication AFTER UPDATE ON public.candidates FOR EACH STATEMENT EXECUTE FUNCTION public.synthetic_fail_publication();
SELECT set_config('kandid.test_audit_before',(SELECT count(*)::text FROM public.audit_logs),true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',true);
DO $atomic$
DECLARE review jsonb;
BEGIN
  review:=public.kandid_get_election_campaign_publication_v1(18);
  BEGIN PERFORM public.kandid_publish_election_campaigns_v1(18,review->>'roster_fingerprint'); RAISE EXCEPTION 'Injected failure missed';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Synthetic publication failure' THEN RAISE; END IF; END;
  review:=public.kandid_get_election_campaign_publication_v1(18);
  IF (review->>'published_candidates')::integer<>0 OR (review->>'draft_candidates')::integer<>2 THEN RAISE EXCEPTION 'Partial publication committed'; END IF;
END;
$atomic$;
RESET ROLE;
DO $$ BEGIN IF (SELECT count(*) FROM public.audit_logs)<>current_setting('kandid.test_audit_before')::integer THEN RAISE EXCEPTION 'Failed publication left audit writes'; END IF; END; $$;
DROP TRIGGER synthetic_fail_publication ON public.candidates;
DROP FUNCTION public.synthetic_fail_publication();
SELECT 'ATOMIC_FAILURE_ROLLS_BACK_ALL_CANDIDATES_AND_AUDITS=PASS';

-- Ineligible non-hidden candidates block the entire batch, never a partial pass.
UPDATE public.student_organization_terms SET status='removed' WHERE student_id=3 AND organization_id=1 AND academic_term_id=1;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',true);
DO $ineligible$
DECLARE review jsonb;
BEGIN
  review:=public.kandid_get_election_campaign_publication_v1(18);
  IF (review->>'can_publish')::boolean OR (review->>'invalid_candidates')::integer<>1 THEN RAISE EXCEPTION 'Ineligible roster accepted'; END IF;
  BEGIN PERFORM public.kandid_publish_election_campaigns_v1(18,review->>'roster_fingerprint'); RAISE EXCEPTION 'Ineligible publish accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END;
$ineligible$;
RESET ROLE;
UPDATE public.student_organization_terms SET status='active' WHERE student_id=3 AND organization_id=1 AND academic_term_id=1;
SELECT 'INELIGIBLE_ROSTER_FAILS_CLOSED_WITH_NO_PARTIAL_PUBLICATION=PASS';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',true);
SELECT set_config('kandid.test_stale_fingerprint',public.kandid_get_election_campaign_publication_v1(18)->>'roster_fingerprint',true);
UPDATE public.candidates SET platform='Changed after review' WHERE id=3002 AND position_id=180;
DO $$ BEGIN BEGIN PERFORM public.kandid_publish_election_campaigns_v1(18,current_setting('kandid.test_stale_fingerprint')); RAISE EXCEPTION 'Stale review accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END; END; $$;
SELECT 'STALE_ROSTER_FINGERPRINT_REJECTED=PASS';

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000030',true);
DO $success$
DECLARE review jsonb; result jsonb;
BEGIN
  review:=public.kandid_get_election_campaign_publication_v1(18);
  IF NOT (review->>'can_publish')::boolean THEN RAISE EXCEPTION 'Valid roster blocked: %',review; END IF;
  result:=public.kandid_publish_election_campaigns_v1(18,review->>'roster_fingerprint');
  IF result->>'publication_status'<>'published' OR (result->>'updated_candidates')::integer<>2 OR (result->>'hidden_candidates')::integer<>1 THEN RAISE EXCEPTION 'Complete publication failed'; END IF;
  result:=public.kandid_publish_election_campaigns_v1(18,result->>'roster_fingerprint');
  IF (result->>'updated_candidates')::integer<>0 THEN RAISE EXCEPTION 'Repeated publish rewrote records'; END IF;
END;
$success$;
SELECT 'SUPER_ADMIN_ATOMIC_PUBLISH_AND_IDEMPOTENT_REPEAT=PASS';

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $student_after$
DECLARE payload jsonb;
BEGIN
  payload:=public.kandid_get_student_published_campaign(18);
  IF payload->>'status'<>'AVAILABLE' OR jsonb_array_length(payload#>'{data,candidates}')<>2 THEN RAISE EXCEPTION 'Published roster unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload#>'{data,candidates}') c WHERE c->>'id'='3003') THEN RAISE EXCEPTION 'Hidden candidate exposed'; END IF;
  IF NOT public.kandid_campaign_storage_access_v1('1/18/123e4567-e89b-42d3-a456-426614174000.pdf','read') THEN RAISE EXCEPTION 'Published private material unavailable'; END IF;
  BEGIN PERFORM student_id FROM public.candidates; RAISE EXCEPTION 'Student identity foreign key exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$student_after$;
SELECT 'ELIGIBLE_STUDENT_PUBLISHED_ROSTER_AND_PRIVATE_STORAGE_ACCESS=PASS';

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',true);
INSERT INTO public.candidates(position_id,student_id) VALUES(180,4);
DO $later_addition$
DECLARE review jsonb; result jsonb;
BEGIN
  review:=public.kandid_get_election_campaign_publication_v1(18);
  IF review->>'publication_status'<>'changes_pending' OR (review->>'draft_candidates')::integer<>1 OR (review->>'published_candidates')::integer<>2 THEN RAISE EXCEPTION 'New addition was silently published'; END IF;
  result:=public.kandid_publish_election_campaigns_v1(18,review->>'roster_fingerprint');
  IF (result->>'updated_candidates')::integer<>1 THEN RAISE EXCEPTION 'Explicit subsequent publish failed'; END IF;
END;
$later_addition$;
SELECT 'NEW_ADDITIONS_REMAIN_DRAFT_UNTIL_EXPLICIT_BOARD_REPUBLICATION=PASS';
RESET ROLE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.audit_logs WHERE election_id=18 AND event_type='candidate_status_changed' AND (actor_role NOT IN ('super_admin','electoral_board') OR event_origin<>'trusted_database')) THEN RAISE EXCEPTION 'Audit actor invalid'; END IF;
 IF (SELECT count(*) FROM public.audit_logs WHERE election_id=18 AND event_type='candidate_status_changed')<3 THEN RAISE EXCEPTION 'Publication audits missing'; END IF; END; $$;
SELECT 'TRUSTED_PUBLICATION_AUDIT_ATTRIBUTION=PASS';

UPDATE public.elections SET campaign_end=timezone('Asia/Manila',now())-interval '1 hour' WHERE id=18;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',true);
DO $$ DECLARE r jsonb; BEGIN r:=public.kandid_get_election_campaign_publication_v1(18); IF (r->>'can_publish')::boolean OR jsonb_array_length(r->'issues')=0 THEN RAISE EXCEPTION 'Expired campaign accepted'; END IF;
 BEGIN PERFORM public.kandid_publish_election_campaigns_v1(18,r->>'roster_fingerprint'); RAISE EXCEPTION 'Expired publish accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END; END; $$;
RESET ROLE;
UPDATE public.elections SET campaign_end=timezone('Asia/Manila',now())+interval '1 day',removed_at=now() WHERE id=18;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN r:=public.kandid_get_election_campaign_publication_v1(18); IF (r->>'can_publish')::boolean OR jsonb_array_length(r->'issues')=0 THEN RAISE EXCEPTION 'Removed election allowed'; END IF; END; $$;
RESET ROLE;
SELECT 'CAMPAIGN_PHASE_AND_REMOVED_ELECTION_RESTRICTIONS=PASS';
UPDATE public.elections SET removed_at=null,electorate_frozen_at=now() WHERE id=18;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN r:=public.kandid_get_election_campaign_publication_v1(18); IF jsonb_array_length(r->'issues')=0 THEN RAISE EXCEPTION 'Frozen roster publication allowed'; END IF; END; $$;
RESET ROLE;
UPDATE public.elections SET electorate_frozen_at=null,academic_term_id=2 WHERE id=18;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN r:=public.kandid_get_election_campaign_publication_v1(18); IF jsonb_array_length(r->'issues')=0 THEN RAISE EXCEPTION 'Closed academic term publication allowed'; END IF; END; $$;
RESET ROLE;
SELECT 'FROZEN_HISTORY_AND_CLOSED_TERM_PUBLICATION_DENIED=PASS';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $$ DECLARE b jsonb; r jsonb; BEGIN
  b:=public.kandid_get_student_ballot_candidates(10);
  r:=public.kandid_get_student_result_candidates(14);
  IF jsonb_array_length(b)<>3 OR jsonb_array_length(r)<>1 THEN RAISE EXCEPTION 'Ballot or results depended on publication'; END IF;
  IF b::text LIKE '%campaign_materials%' OR r::text LIKE '%SECRET%' THEN RAISE EXCEPTION 'Campaign content leaked into voting or results'; END IF;
END; $$;
RESET ROLE;
SELECT 'BALLOT_AND_RESULTS_INDEPENDENT_OF_CAMPAIGN_PUBLICATION=PASS';
ROLLBACK;
SELECT 'SYNTHETIC_WRITES_ROLLED_BACK=PASS';
