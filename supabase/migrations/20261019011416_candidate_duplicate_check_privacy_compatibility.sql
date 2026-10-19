-- Local candidate only. Repairs the confirmed invoker-trigger/column-privacy
-- conflict without granting student_id SELECT to any browser role.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
  IF current_user <> 'postgres'
     OR to_regprocedure('public.prevent_duplicate_candidate_per_election()') IS NULL
     OR to_regprocedure('public.kandid_can_mutate_election_positions(integer)') IS NULL
     OR to_regprocedure('public.kandid_can_admin_read_candidate_v1(integer)') IS NULL THEN
    RAISE EXCEPTION 'Reviewed candidate privacy and authorization prerequisites are required';
  END IF;
  IF md5(pg_catalog.pg_get_functiondef('public.prevent_duplicate_candidate_per_election()'::regprocedure))
      <> '4f2aa5d30eabebf092c0c7eb0eb95646' THEN
    RAISE EXCEPTION 'Duplicate trigger predecessor differs; inspect before installation';
  END IF;
  IF pg_catalog.has_column_privilege('authenticated','public.candidates','student_id','SELECT')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.candidates'::regclass
       AND tgname='candidates_one_student_per_election_guard'
       AND tgfoid='public.prevent_duplicate_candidate_per_election()'::regprocedure AND tgenabled='O') THEN
    RAISE EXCEPTION 'Candidate identity privacy or duplicate trigger association differs';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_candidate_per_election()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  target_election_id integer;
  original_election_id integer;
  duplicate_position text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Active administrator authentication required.';
  END IF;
  IF TG_OP='UPDATE' AND OLD.position_id IS NOT NULL THEN
    SELECT p.election_id INTO original_election_id FROM public.positions p WHERE p.id=OLD.position_id;
    IF original_election_id IS NULL OR NOT public.kandid_can_mutate_election_positions(original_election_id) THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Candidate changes are not authorized for the original election.';
    END IF;
  END IF;
  -- The existing mutation guards still authorize disconnects and reject
  -- missing identity/position values. Do not inspect other students here.
  IF NEW.student_id IS NULL OR NEW.position_id IS NULL THEN RETURN NEW; END IF;
  SELECT p.election_id INTO target_election_id FROM public.positions p WHERE p.id=NEW.position_id;
  IF target_election_id IS NULL OR NOT public.kandid_can_mutate_election_positions(target_election_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Candidate changes are not authorized for this election.';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(target_election_id,NEW.student_id);
  SELECT p.name INTO duplicate_position
  FROM public.candidates c JOIN public.positions p ON p.id=c.position_id
  WHERE c.student_id=NEW.student_id AND p.election_id=target_election_id
    AND c.id IS DISTINCT FROM NEW.id ORDER BY p.id LIMIT 1;
  IF duplicate_position IS NOT NULL THEN
    RAISE EXCEPTION 'This student is already a candidate for % in this election.',duplicate_position;
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.prevent_duplicate_candidate_per_election() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_duplicate_candidate_per_election() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
