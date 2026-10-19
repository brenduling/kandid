\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() !~ '^kandid_sm_v7_[a-f0-9]{12}$'
    OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN
    RAISE EXCEPTION 'ISOLATION_GUARD_FAILED';
  END IF;
END $$;

CREATE FUNCTION pg_temp.sm_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  RAISE NOTICE '[PASS] %',label;
END $$;
CREATE TEMP TABLE history_enrollments AS SELECT to_jsonb(t) AS row_data FROM public.student_term_enrollments t WHERE academic_term_id=3;
CREATE TEMP TABLE history_memberships AS SELECT to_jsonb(t) AS row_data FROM public.student_organization_terms t WHERE academic_term_id=3;
CREATE TEMP TABLE history_elections AS SELECT to_jsonb(t) AS row_data FROM public.elections t;
CREATE TEMP TABLE history_votes AS SELECT to_jsonb(t) AS row_data FROM public.votes t;
CREATE TEMP TABLE history_ballots AS SELECT to_jsonb(t) AS row_data FROM public.vote_ballots t;
CREATE TEMP TABLE history_imports AS SELECT to_jsonb(t) AS row_data FROM public.masterlist_imports t;

-- Exercise real PostgreSQL operations as the same restricted DB role as the Edge
-- client. Auth session verification and password reauthentication remain covered
-- by handler tests and the authenticated application acceptance test.
SET LOCAL ROLE service_role;
DO $$
DECLARE result jsonb; sid integer; participation record; baseline_notifications integer;
BEGIN
  result := public.kandid_board_register_verified_student_for_term_v1(
    1,100,'72601','Synthetic','Institution',null,'BSIT',2,'school_id',true,true);
  sid := (result->>'student_id')::integer;
  PERFORM pg_temp.sm_assert(sid IS NOT NULL,'ADD: real registration RPC creates synthetic identity');
  PERFORM pg_temp.sm_assert((SELECT count(*)=3 FROM public.student_organization_terms
    WHERE student_id=sid AND academic_term_id=1 AND status='active' AND organization_id IN(100,101,102)),
    'ADD: institution and both configured BSIT organization memberships');
  PERFORM pg_temp.sm_assert((SELECT verification_method='school_id' AND verified_by_admin_id=1 AND verified_at IS NOT NULL
    FROM public.student_term_enrollments WHERE student_id=sid AND academic_term_id=1),
    'ADD: evidence method, Board actor and verification timestamp persisted');

  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      1,100,'72601','Synthetic','Duplicate',null,'BSIT',2,'school_id',true,true);
    RAISE EXCEPTION 'duplicate identity unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.sm_assert((SELECT count(*)=1 FROM public.students WHERE student_number='72601'),'ADD: duplicate identity rejected');
  END;
  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      1,100,'72602','Synthetic','Unverified',null,'BSIT',2,'school_id',false,true);
    RAISE EXCEPTION 'unverified evidence unexpectedly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    PERFORM pg_temp.sm_assert(NOT EXISTS(SELECT 1 FROM public.students WHERE student_number='72602'),'ADD: invalid evidence has no partial identity');
  END;
  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      3,103,'72603','Synthetic','Foreign',null,'BSIT',2,'registration_form',true,true);
    RAISE EXCEPTION 'foreign-program registration unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.sm_assert(NOT EXISTS(SELECT 1 FROM public.students WHERE student_number='72603'),'ADD: program Board scope rejects cross-organization tampering');
  END;
  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      2,103,'72604','Synthetic','Forged',null,'BSIT',2,'school_id',true,true);
    RAISE EXCEPTION 'forged organization unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '[PASS] ADD: actor and organization mismatch rejected by RPC';
  END;

  PERFORM public.kandid_board_register_verified_student_for_term_v1(
    1,100,'90000','Historical','Student',null,'BSHM',3,'registration_form',true,false);
  PERFORM pg_temp.sm_assert((SELECT program='BSHM' FROM public.student_term_enrollments
    WHERE student_id=900 AND academic_term_id=1),'ENROLL: existing identity receives independent current-term enrollment');
  PERFORM pg_temp.sm_assert((SELECT count(*)=3 FROM public.student_organization_terms
    WHERE student_id=900 AND academic_term_id=1 AND organization_id IN(100,103,104) AND status='active'),
    'ENROLL: BSHM mappings are configuration-derived');

  -- Exact persistence operation used by update_student_names after the handler's
  -- organization/enrollment checks. No program, term, ID or status is changed.
  PERFORM pg_temp.sm_assert(EXISTS(SELECT 1 FROM public.student_organization_terms p
    JOIN public.student_term_enrollments e USING(student_id,academic_term_id)
    WHERE p.student_id=sid AND p.organization_id=100 AND p.academic_term_id=1
      AND p.status='active' AND e.enrollment_status='enrolled'),'EDIT: current-term scope precondition');
  UPDATE public.students SET first_name='Corrected',last_name='Synthetic' WHERE id=sid;
  INSERT INTO public.audit_logs(user_id,action,actor_name,actor_role,entity_id,entity_type,
    organization_id,event_type,event_category,event_origin,metadata)
  VALUES(1,'student_identity_updated','WITSG Board','electoral_board',sid::text,'student',100,
    'student_identity_updated','students','trusted_edge','{"academic_term_id":1,"changed_fields":["first_name","last_name"]}');
  PERFORM pg_temp.sm_assert((SELECT first_name='Corrected' AND last_name='Synthetic' AND program='BSIT'
    FROM public.students WHERE id=sid),'EDIT: names persist without changing academic identity');

  result := public.kandid_board_register_verified_student_for_term_v1(
    6,106,'72605','Synthetic','Manual',null,'BSIT',2,'department_masterlist',true,true);
  sid := (result->>'student_id')::integer;
  SELECT * INTO participation FROM public.board_update_student_participation(sid,106,6,'remove','Synthetic correction');
  PERFORM pg_temp.sm_assert(participation.status='removed' AND NOT participation.already_applied,'REMOVE: real participation RPC removes only manual term membership');
  SELECT * INTO participation FROM public.board_update_student_participation(sid,106,6,'remove','Retry');
  PERFORM pg_temp.sm_assert(participation.already_applied,'REMOVE: duplicate request is idempotent');
  SELECT * INTO participation FROM public.board_update_student_participation(sid,106,6,'restore',null);
  PERFORM pg_temp.sm_assert(participation.status='active' AND NOT participation.already_applied,'RESTORE: real RPC restores eligible manual participation');
  SELECT * INTO participation FROM public.board_update_student_participation(sid,106,6,'restore',null);
  PERFORM pg_temp.sm_assert(participation.already_applied,'RESTORE: duplicate request is idempotent');
  PERFORM pg_temp.sm_assert((SELECT count(*)=1 FROM public.student_organization_terms
    WHERE student_id=sid AND organization_id=106 AND academic_term_id=1),'REMOVE/RESTORE: no duplicate participation row');
  BEGIN
    PERFORM public.board_update_student_participation(sid,101,6,'remove','Forbidden');
    RAISE EXCEPTION 'program membership removal unexpectedly allowed';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE '[PASS] REMOVE: program membership remains system-managed'; END;
  BEGIN
    PERFORM public.board_update_student_participation(sid,100,6,'remove','Forbidden');
    RAISE EXCEPTION 'institution membership removal unexpectedly allowed';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE '[PASS] REMOVE: institution membership remains system-managed'; END;
END $$;
RESET ROLE;

-- Direct browser-role table/RPC access must fail independently of UI flags.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    UPDATE public.students SET first_name='Unauthorized' WHERE student_number='72601';
    RAISE EXCEPTION 'direct identity write unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '[PASS] SECURITY: direct authenticated identity update denied'; END;
  BEGIN
    PERFORM public.board_update_student_participation(1,106,6,'restore',null);
    RAISE EXCEPTION 'direct participation RPC unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '[PASS] SECURITY: direct authenticated participation RPC denied'; END;
  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      1,100,'72609','Unauthorized','Student',null,'BSIT',1,'school_id',true,true);
    RAISE EXCEPTION 'direct registration RPC unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '[PASS] SECURITY: direct authenticated registration RPC denied'; END;
END $$;
RESET ROLE;

-- Force a downstream failure after the RPC UPDATE; the entire RPC must roll back.
CREATE FUNCTION pg_temp.sm_reject_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING errcode='23514',message='synthetic notification failure'; END $$;
CREATE TRIGGER sm_reject_notification BEFORE INSERT ON public.student_notifications
FOR EACH ROW EXECUTE FUNCTION pg_temp.sm_reject_notification();
SET LOCAL ROLE service_role;
DO $$ DECLARE sid integer; BEGIN
  SELECT id INTO sid FROM public.students WHERE student_number='72605';
  BEGIN
    PERFORM public.board_update_student_participation(sid,106,6,'remove','Atomic failure test');
    RAISE EXCEPTION 'downstream failure unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.sm_assert((SELECT status='active' FROM public.student_organization_terms
      WHERE student_id=sid AND organization_id=106 AND academic_term_id=1),'ATOMICITY: failed notification rolls back participation change');
  END;
END $$;
RESET ROLE;
DROP TRIGGER sm_reject_notification ON public.student_notifications;

UPDATE public.academic_terms SET status='closed' WHERE id=1;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      1,100,'72608','Closed','Term',null,'BSIT',1,'school_id',true,true);
    RAISE EXCEPTION 'registration without an active term unexpectedly allowed';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    PERFORM pg_temp.sm_assert(NOT EXISTS(SELECT 1 FROM public.students WHERE student_number='72608'),'TERM: registration cannot mutate a closed/no-active term');
  END;
END $$;
RESET ROLE;
UPDATE public.academic_terms SET status='active' WHERE id=1;

DO $$ BEGIN
  PERFORM pg_temp.sm_assert(NOT EXISTS(SELECT row_data FROM history_enrollments EXCEPT SELECT to_jsonb(t) FROM public.student_term_enrollments t WHERE academic_term_id=3), 'HISTORY: previous-term enrollments unchanged');
  PERFORM pg_temp.sm_assert(NOT EXISTS(SELECT row_data FROM history_memberships EXCEPT SELECT to_jsonb(t) FROM public.student_organization_terms t WHERE academic_term_id=3), 'HISTORY: previous-term memberships unchanged');
  PERFORM pg_temp.sm_assert(NOT EXISTS(SELECT row_data FROM history_elections EXCEPT SELECT to_jsonb(t) FROM public.elections t), 'HISTORY: elections unchanged');
  PERFORM pg_temp.sm_assert(NOT EXISTS(SELECT row_data FROM history_votes EXCEPT SELECT to_jsonb(t) FROM public.votes t), 'HISTORY: votes unchanged');
  PERFORM pg_temp.sm_assert(NOT EXISTS(SELECT row_data FROM history_ballots EXCEPT SELECT to_jsonb(t) FROM public.vote_ballots t), 'HISTORY: ballots unchanged');
  PERFORM pg_temp.sm_assert(NOT EXISTS(SELECT row_data FROM history_imports EXCEPT SELECT to_jsonb(t) FROM public.masterlist_imports t), 'HISTORY: imports unchanged');
  PERFORM pg_temp.sm_assert((SELECT count(*)=2 FROM public.student_notifications WHERE student_id=(SELECT id FROM public.students WHERE student_number='72605')), 'AUDIT: only non-duplicate remove and restore create notifications');
  PERFORM pg_temp.sm_assert(EXISTS(SELECT 1 FROM public.audit_logs WHERE user_id=6 AND organization_id=106 AND event_type='student_enrollment_verified' AND metadata->>'verification_method'='department_masterlist'), 'AUDIT: registration attribution is recorded by trusted RPC');
  PERFORM pg_temp.sm_assert(EXISTS(SELECT 1 FROM public.audit_logs WHERE user_id=1 AND organization_id=100 AND event_type='student_identity_updated' AND metadata->>'academic_term_id'='1'), 'AUDIT: name edit attribution and term recorded');
END $$;
ROLLBACK;
\echo 'COMPLETE_STUDENT_MANAGEMENT_PG17_TESTS_PASSED (all test writes rolled back)'
