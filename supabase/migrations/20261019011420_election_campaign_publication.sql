-- Prepare locally only. Install AFTER the candidate duplicate privacy repair.
-- No existing table policies, grants, election fields or historical rows change.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
  IF current_user<>'postgres'
     OR to_regprocedure('public.kandid_can_admin_read_candidate_v1(integer)') IS NULL
     OR to_regprocedure('public.resolve_student_organization_participation(integer,integer,integer)') IS NULL
     OR to_regprocedure('private.normalize_student_campaign_materials(jsonb,jsonb)') IS NULL
     OR to_regprocedure('private.kandid_candidate_election_has_history_v1(integer)') IS NULL
     OR to_regprocedure('public.kandid_get_student_published_campaign(integer)') IS NULL
     OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'Reviewed candidate, privacy, term and private Storage dependencies are required';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.prevent_duplicate_candidate_per_election()'::regprocedure
    AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog']::text[] AND pg_get_userbyid(proowner)='postgres')
     OR md5(pg_get_functiondef('private.kandid_guard_candidate_management_contract_v1()'::regprocedure))<>'31041445a3916ca7ba73cc18166ca873'
     OR md5(pg_get_functiondef('public.kandid_get_student_published_campaign(integer)'::regprocedure))<>'20a15381cebff99da07d6163d26db1aa' THEN
    RAISE EXCEPTION 'Reviewed duplicate repair, candidate guard or student publication contract differs';
  END IF;
  IF to_regprocedure('public.kandid_publish_election_campaigns_v1(integer,text)') IS NOT NULL
     OR to_regprocedure('public.kandid_get_election_campaign_publication_v1(integer)') IS NOT NULL
     OR to_regprocedure('private.kandid_election_campaign_publication_state_v1(integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Publication contract already exists; do not replay installation';
  END IF;
END;
$preflight$;

-- Enforce Draft creation and keep publication behind the atomic operation.
-- SECURITY INVOKER is intentional: CURRENT_USER is authenticated for browser
-- DML and postgres inside the explicitly authorized SECURITY DEFINER RPC.
-- A client-settable session variable is never used as publication authority.
CREATE FUNCTION private.kandid_guard_campaign_publication_transition_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $function$
BEGIN
  IF current_user<>'postgres' THEN
    IF (TG_OP='INSERT' AND NEW.campaign_status IS DISTINCT FROM 'draft')
      OR (TG_OP='UPDATE' AND NEW.campaign_status IS DISTINCT FROM OLD.campaign_status) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Campaign publication requires the authorized election-wide publication operation.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION private.kandid_guard_campaign_publication_transition_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.kandid_guard_campaign_publication_transition_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER candidates_campaign_publication_guard BEFORE INSERT OR UPDATE OF campaign_status ON public.candidates
FOR EACH ROW EXECUTE FUNCTION private.kandid_guard_campaign_publication_transition_v1();

-- Read-only aggregate implementation. VOLATILE gives the publisher a fresh
-- snapshot after acquiring locks; this helper itself performs no writes.
CREATE FUNCTION private.kandid_election_campaign_publication_state_v1(p_election_id integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $function$
DECLARE
  actor_count integer; actor_role text; actor_org bigint;
  election_row public.elections%rowtype;
  candidate_row record; material jsonb; materials jsonb;
  issues jsonb:='[]'::jsonb; roster jsonb:='[]'::jsonb;
  reason text; candidate_reason text; object_name text; allowed boolean;
  total_count integer:=0; eligible_count integer:=0; published_count integer:=0;
  draft_count integer:=0; hidden_count integer:=0; invalid_count integer:=0;
  term_count integer; current_term integer;
  now_manila timestamp:=timezone('Asia/Manila',clock_timestamp());
  publication_status text;
BEGIN
  IF auth.uid() IS NULL OR p_election_id IS NULL OR p_election_id<=0 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active administrator authentication required.';
  END IF;
  SELECT count(*),min(a.role),min(a.organization_id) INTO actor_count,actor_role,actor_org
  FROM public.admin_users a WHERE a.auth_user_id=auth.uid() AND a.status='active';
  IF actor_count<>1 OR actor_role NOT IN ('electoral_board','super_admin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Election campaign publication is unavailable.';
  END IF;
  SELECT e.* INTO election_row FROM public.elections e WHERE e.id=p_election_id;
  IF NOT FOUND OR (actor_role='electoral_board' AND (actor_org IS NULL OR actor_org IS DISTINCT FROM election_row.organization_id)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Election campaign publication is unavailable.';
  END IF;
  SELECT count(*),min(id) INTO term_count,current_term FROM public.academic_terms WHERE status='active';
  IF election_row.removed_at IS NOT NULL THEN reason:='Removed elections cannot publish campaigns.';
  ELSIF election_row.status IS DISTINCT FROM 'active' THEN reason:='The election must be active.';
  ELSIF term_count<>1 OR election_row.academic_term_id IS DISTINCT FROM current_term THEN reason:='The election must belong to the official active academic term.';
  ELSIF election_row.campaign_start IS NULL OR election_row.campaign_end IS NULL
    OR election_row.start_date IS NULL OR election_row.end_date IS NULL
    OR election_row.campaign_start>=election_row.campaign_end
    OR election_row.campaign_end>election_row.start_date OR election_row.start_date>=election_row.end_date
    THEN reason:='Configure a valid campaign and voting schedule before publishing.';
  ELSIF now_manila<election_row.campaign_start OR now_manila>=election_row.campaign_end
    THEN reason:='Publication is available only during the campaign window.';
  ELSIF NOT public.kandid_can_mutate_election_positions(p_election_id)
    OR private.kandid_candidate_election_has_history_v1(p_election_id)
    THEN reason:='Frozen, voting, released or historical election records protect this roster.';
  END IF;
  IF reason IS NOT NULL THEN issues:=issues||jsonb_build_array(jsonb_build_object('candidate_id',null,'message',reason)); END IF;

  FOR candidate_row IN
    SELECT c.*,p.name AS position_name,p.status AS position_status,
      s.id AS identity_id,s.first_name,s.last_name
    FROM public.candidates c JOIN public.positions p ON p.id=c.position_id
    LEFT JOIN public.students s ON s.id=c.student_id
    WHERE p.election_id=p_election_id ORDER BY c.id
  LOOP
    total_count:=total_count+1; candidate_reason:=null; allowed:=false;
    IF candidate_row.campaign_status='hidden' THEN
      hidden_count:=hidden_count+1;
    ELSE
      IF candidate_row.campaign_status NOT IN ('draft','published') OR candidate_row.campaign_status IS NULL THEN
        candidate_reason:='Campaign status must be Draft or Published; Hidden records remain excluded.';
      ELSIF candidate_row.identity_id IS NULL OR nullif(btrim(candidate_row.first_name),'') IS NULL OR nullif(btrim(candidate_row.last_name),'') IS NULL THEN
        candidate_reason:='The candidate must have an existing student identity and saved name.';
      ELSIF candidate_row.position_status IS DISTINCT FROM 'active' THEN
        candidate_reason:='The ballot position is retired or unavailable.';
      ELSIF candidate_row.partylist_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM public.partylists pl WHERE pl.id=candidate_row.partylist_id
        AND pl.organization_id=election_row.organization_id AND (pl.election_id IS NULL OR pl.election_id=p_election_id)) THEN
        candidate_reason:='The partylist must belong to this organization and election, or be reusable in this organization.';
      ELSE
        SELECT r.allowed INTO allowed FROM public.resolve_student_organization_participation(
          candidate_row.student_id,election_row.organization_id::integer,election_row.academic_term_id) r LIMIT 1;
        IF allowed IS DISTINCT FROM true THEN candidate_reason:='Current-term organization eligibility could not be verified.'; END IF;
      END IF;
      IF candidate_reason IS NULL THEN
        materials:=private.normalize_student_campaign_materials(candidate_row.campaign_materials,candidate_row.campaign_media_urls);
        IF materials IS NULL OR jsonb_typeof(materials)<>'array' THEN
          candidate_reason:='Save at most three valid campaign materials before publication.';
        ELSIF jsonb_array_length(materials)>3 THEN
          candidate_reason:='Save at most three valid campaign materials before publication.';
        ELSIF candidate_row.campaign_materials IS NOT NULL THEN
          IF jsonb_typeof(candidate_row.campaign_materials)<>'array' THEN
            candidate_reason:='Save campaign materials using the existing array contract.';
          ELSIF jsonb_array_length(candidate_row.campaign_materials)>3
             OR jsonb_array_length(candidate_row.campaign_materials)>jsonb_array_length(materials) THEN
            candidate_reason:='Save at most three valid campaign materials before publication.';
          END IF;
        END IF;
        IF candidate_reason IS NULL THEN
          FOR material IN SELECT value FROM jsonb_array_elements(materials) LOOP
            IF coalesce(material->>'type','') NOT IN ('link','media','document') OR nullif(btrim(material->>'label'),'') IS NULL THEN
              candidate_reason:='Each campaign material needs a supported type and title.'; EXIT;
            END IF;
            IF material->>'url' LIKE 'storage://%' THEN
              object_name:=substr(material->>'url',length('storage://campaign-materials/')+1);
              IF material->>'type'='link' OR material->>'url' !~ (
                '^storage://campaign-materials/'||election_row.organization_id||'/'||p_election_id||'/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|mp4|webm|pdf)$')
                OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='campaign-materials' AND o.name=object_name) THEN
                candidate_reason:='An uploaded file is missing or does not belong to this election organization.'; EXIT;
              END IF;
            ELSIF coalesce(material->>'url','') !~* '^https?://[^[:space:]@]+$'
              OR (material->>'type'='link' AND material->>'url' !~* '^https://') THEN
              candidate_reason:='Campaign links must use HTTPS and material references must be valid.'; EXIT;
            END IF;
          END LOOP;
        END IF;
      END IF;
      IF candidate_reason IS NULL THEN
        eligible_count:=eligible_count+1;
        IF candidate_row.campaign_status='published' THEN published_count:=published_count+1;
        ELSE draft_count:=draft_count+1; END IF;
      ELSE
        invalid_count:=invalid_count+1;
        issues:=issues||jsonb_build_array(jsonb_build_object('candidate_id',candidate_row.id,'message',candidate_reason));
      END IF;
    END IF;
    -- The digest is a concurrency check, never an authorization credential.
    -- No student IDs, personal records or material URLs are returned to callers.
    roster:=roster||jsonb_build_array(jsonb_build_object('candidate',to_jsonb(candidate_row),
      'eligible',allowed,'issue',candidate_reason));
  END LOOP;
  IF eligible_count=0 THEN issues:=issues||jsonb_build_array(jsonb_build_object('candidate_id',null,'message','No eligible, non-hidden candidates are ready for publication.')); END IF;
  publication_status:=CASE WHEN invalid_count>0 THEN 'blocked'
    WHEN eligible_count=0 THEN 'empty' WHEN published_count=0 THEN 'draft'
    WHEN draft_count>0 THEN 'changes_pending' ELSE 'published' END;
  RETURN jsonb_build_object('contract_version',1,'election_id',p_election_id,
    'publication_status',publication_status,'total_candidates',total_count,
    'eligible_candidates',eligible_count,'published_candidates',published_count,
    'draft_candidates',draft_count,'hidden_candidates',hidden_count,'invalid_candidates',invalid_count,
    'issues',issues,'can_publish',jsonb_array_length(issues)=0 AND draft_count>0,
    'roster_fingerprint',md5(jsonb_build_object('roster',roster,'election',jsonb_build_object(
      'id',p_election_id,'organization_id',election_row.organization_id,'academic_term_id',election_row.academic_term_id,
      'status',election_row.status,'removed_at',election_row.removed_at,'campaign_start',election_row.campaign_start,
      'campaign_end',election_row.campaign_end,'start_date',election_row.start_date,'end_date',election_row.end_date),
      'active_term',current_term,'active_term_count',term_count,'issues',issues)::text));
END;
$function$;
ALTER FUNCTION private.kandid_election_campaign_publication_state_v1(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.kandid_election_campaign_publication_state_v1(integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.kandid_get_election_campaign_publication_v1(p_election_id integer)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $function$ SELECT private.kandid_election_campaign_publication_state_v1(p_election_id); $function$;
ALTER FUNCTION public.kandid_get_election_campaign_publication_v1(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.kandid_get_election_campaign_publication_v1(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kandid_get_election_campaign_publication_v1(integer) TO authenticated;

CREATE FUNCTION public.kandid_publish_election_campaigns_v1(p_election_id integer,p_roster_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $function$
DECLARE state jsonb; changed integer;
BEGIN
  state:=private.kandid_election_campaign_publication_state_v1(p_election_id);
  IF p_roster_fingerprint IS NULL OR p_roster_fingerprint !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Review the current election roster before publishing.';
  END IF;
  -- Match the lock taken by trusted candidate/position mutation authorization.
  -- NOWAIT aborts concurrent edits rather than risking a row/parent deadlock.
  PERFORM e.id FROM public.elections e WHERE e.id=p_election_id FOR UPDATE NOWAIT;
  PERFORM a.id FROM public.admin_users a WHERE a.auth_user_id=auth.uid() AND a.status='active' FOR SHARE NOWAIT;
  PERFORM p.id FROM public.positions p WHERE p.election_id=p_election_id ORDER BY p.id FOR SHARE NOWAIT;
  PERFORM c.id FROM public.candidates c JOIN public.positions p ON p.id=c.position_id
    WHERE p.election_id=p_election_id ORDER BY c.id FOR UPDATE OF c NOWAIT;
  state:=private.kandid_election_campaign_publication_state_v1(p_election_id);
  IF state->>'roster_fingerprint' IS DISTINCT FROM p_roster_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='The roster or election changed. Review it again before publishing.';
  END IF;
  IF jsonb_array_length(state->'issues')<>0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Resolve the publication review issues before publishing.';
  END IF;
  -- One statement, one transaction. Existing authorization, term/history,
  -- removed-election and audit triggers execute for every changed candidate.
  -- Any row failure rolls back the entire roster and its audit events.
  UPDATE public.candidates c SET campaign_status='published'
  FROM public.positions p WHERE p.id=c.position_id AND p.election_id=p_election_id AND c.campaign_status='draft';
  GET DIAGNOSTICS changed=ROW_COUNT;
  state:=private.kandid_election_campaign_publication_state_v1(p_election_id);
  IF jsonb_array_length(state->'issues')<>0 OR (state->>'draft_candidates')::integer<>0 OR (state->>'invalid_candidates')::integer<>0
     OR state->>'publication_status'<>'published' THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='The complete publication could not be confirmed; no campaigns were changed.';
  END IF;
  RETURN state||jsonb_build_object('confirmed',true,'updated_candidates',changed);
END;
$function$;
ALTER FUNCTION public.kandid_publish_election_campaigns_v1(integer,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.kandid_publish_election_campaigns_v1(integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kandid_publish_election_campaigns_v1(integer,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
