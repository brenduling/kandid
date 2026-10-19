-- Candidate admin column compatibility. Install after the frozen privacy
-- migration and before frozen campaign Storage. Student reads remain behind
-- the sole authenticated, organization-scoped admin SELECT policy.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.candidates IN SHARE ROW EXCLUSIVE MODE;

DO $compatibility_preflight$
DECLARE
  column_name text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Reviewed postgres migration executor required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261018161039')
     OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
                WHERE version IN ('20261018231601','20261018150914')) THEN
    RAISE EXCEPTION 'Expected verified privacy installation before compatibility and Storage';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.candidates'::regclass)
     OR (SELECT count(*) FROM pg_catalog.pg_policy
         WHERE polrelid='public.candidates'::regclass AND polcmd IN ('r','*'))<>1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
       WHERE polrelid='public.candidates'::regclass AND polname='candidates_authenticated_admin_read'
         AND polcmd='r' AND polpermissive AND polroles=ARRAY['authenticated'::regrole::oid]
         AND pg_catalog.pg_get_expr(polqual,polrelid)='kandid_can_admin_read_candidate_v1(id)') THEN
    RAISE EXCEPTION 'The sole reviewed organization-scoped admin SELECT policy is required';
  END IF;
  IF md5(pg_catalog.pg_get_functiondef('public.kandid_can_admin_read_candidate_v1(integer)'::regprocedure))
        <> '70ab896c719c55dee7110c4b86fcb69e'
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
       WHERE oid='public.kandid_can_admin_read_candidate_v1(integer)'::regprocedure
         AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog']::text[]
         AND pg_catalog.pg_get_userbyid(proowner)='postgres')
     OR NOT has_function_privilege('authenticated','public.kandid_can_admin_read_candidate_v1(integer)','EXECUTE')
     OR has_function_privilege('anon','public.kandid_can_admin_read_candidate_v1(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Trusted JWT-derived admin authorization helper differs';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated')
             AND (rolsuper OR rolbypassrls))
     OR pg_catalog.pg_has_role('authenticated',(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.candidates'::regclass),'USAGE')
     OR pg_catalog.pg_has_role('anon',(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.candidates'::regclass),'USAGE')
     OR has_table_privilege('anon','public.candidates','SELECT')
     OR has_table_privilege('authenticated','public.candidates','SELECT') THEN
    RAISE EXCEPTION 'Browser roles must not own/bypass RLS or have table-wide candidate SELECT';
  END IF;
  FOR column_name IN SELECT attname FROM pg_catalog.pg_attribute
    WHERE attrelid='public.candidates'::regclass AND attnum>0 AND NOT attisdropped
  LOOP
    IF has_column_privilege('anon','public.candidates',column_name,'SELECT')
       OR has_column_privilege('authenticated','public.candidates',column_name,'SELECT')
            IS DISTINCT FROM (column_name IN ('id','position_id')) THEN
      RAISE EXCEPTION 'Candidate column grants differ from the privacy-only baseline: %',column_name;
    END IF;
  END LOOP;
  IF to_regprocedure('public.kandid_get_student_published_campaign(integer)') IS NULL
     OR pg_catalog.pg_get_functiondef('public.get_student_campaign(integer)'::regprocedure)
          NOT ILIKE '%kandid_get_student_published_campaign%' THEN
    RAISE EXCEPTION 'Safe published-only Student campaign contract is required';
  END IF;
END;
$compatibility_preflight$;

-- WHERE comparisons in confirmedUpdate require SELECT on these columns even
-- when RETURNING contains only id. partylist_id also supports scoped counts.
GRANT SELECT (partylist_id, photo, bio, platform, credentials, campaign_materials, campaign_media_urls)
ON public.candidates TO authenticated;

DO $compatibility_postflight$
DECLARE
  column_name text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.candidates'::regclass)
     OR (SELECT count(*) FROM pg_catalog.pg_policy
         WHERE polrelid='public.candidates'::regclass AND polcmd IN ('r','*'))<>1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
       WHERE polrelid='public.candidates'::regclass AND polname='candidates_authenticated_admin_read'
         AND polcmd='r' AND polpermissive AND polroles=ARRAY['authenticated'::regrole::oid]
         AND pg_catalog.pg_get_expr(polqual,polrelid)='kandid_can_admin_read_candidate_v1(id)')
     OR md5(pg_catalog.pg_get_functiondef('public.kandid_can_admin_read_candidate_v1(integer)'::regprocedure))
          <> '70ab896c719c55dee7110c4b86fcb69e'
     OR has_table_privilege('anon','public.candidates','SELECT')
     OR has_table_privilege('authenticated','public.candidates','SELECT') THEN
    RAISE EXCEPTION 'Admin-only candidate row privacy boundary changed';
  END IF;
  FOR column_name IN SELECT attname FROM pg_catalog.pg_attribute
    WHERE attrelid='public.candidates'::regclass AND attnum>0 AND NOT attisdropped
  LOOP
    IF has_column_privilege('anon','public.candidates',column_name,'SELECT')
       OR has_column_privilege('authenticated','public.candidates',column_name,'SELECT')
            IS DISTINCT FROM (column_name IN ('id','position_id','partylist_id','photo','bio','platform','credentials','campaign_materials','campaign_media_urls')) THEN
      RAISE EXCEPTION 'Unexpected candidate column privilege after compatibility installation: %',column_name;
    END IF;
  END LOOP;
END;
$compatibility_postflight$;
COMMIT;
