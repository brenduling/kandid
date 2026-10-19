-- Isolated regression/proposal evaluation only; all grants and changes roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',true);
DO $reproduce$
BEGIN
  BEGIN
    UPDATE public.candidates SET bio='Synthetic compatibility probe'
    WHERE id=1002 AND position_id=100 AND bio='SECRET DRAFT BIO' RETURNING id;
    RAISE EXCEPTION 'Expected the frozen privacy-only UPDATE to lack column permission';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM partylist_id FROM public.candidates WHERE partylist_id=1;
    RAISE EXCEPTION 'Expected the frozen privacy-only partylist count to lack permission';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$reproduce$;
RESET ROLE;
GRANT SELECT (partylist_id,photo,bio,platform,credentials,campaign_materials,campaign_media_urls)
ON public.candidates TO authenticated;
SET LOCAL ROLE authenticated;
DO $own_board$
DECLARE changed integer; changed_id integer;
BEGIN
  UPDATE public.candidates SET bio='Synthetic compatibility probe'
  WHERE id=1002 AND position_id=100 AND bio='SECRET DRAFT BIO'
    AND partylist_id=2 AND photo='https://example.invalid/draft.png'
    AND platform='SECRET DRAFT PLATFORM' AND credentials='SECRET DRAFT CREDENTIALS'
    AND campaign_media_urls='[]'::jsonb RETURNING id INTO changed_id;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 OR changed_id<>1002 THEN RAISE EXCEPTION 'Own Board edit was not confirmed'; END IF;
  UPDATE public.candidates SET bio='Stale overwrite must fail'
  WHERE id=1002 AND position_id=100 AND bio='SECRET DRAFT BIO';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>0 THEN RAISE EXCEPTION 'Optimistic concurrency was lost'; END IF;
  IF (SELECT count(*) FROM public.candidates WHERE partylist_id=1)<1 THEN
    RAISE EXCEPTION 'Own-organization partylist count failed';
  END IF;
END;
$own_board$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000020',true);
DO $foreign_board$
DECLARE changed integer;
BEGIN
  IF EXISTS(SELECT 1 FROM public.candidates WHERE id=1002) THEN RAISE EXCEPTION 'Foreign Board read leaked'; END IF;
  UPDATE public.candidates SET bio='Foreign edit must fail' WHERE id=1002 AND bio='Synthetic compatibility probe';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>0 THEN RAISE EXCEPTION 'Foreign Board edit succeeded'; END IF;
END;
$foreign_board$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $student$
DECLARE changed integer;
BEGIN
  IF (SELECT count(bio) FROM public.candidates)<>0 OR (SELECT count(partylist_id) FROM public.candidates)<>0 THEN
    RAISE EXCEPTION 'Student direct draft/partylist read leaked';
  END IF;
  UPDATE public.candidates SET bio='Student edit must fail' WHERE id=1002 AND bio='Synthetic compatibility probe';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>0 THEN RAISE EXCEPTION 'Student edit succeeded'; END IF;
  BEGIN
    PERFORM student_id FROM public.candidates;
    RAISE EXCEPTION 'Student identity column grant was broadened';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$student$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000030',true);
DO $super_admin$
DECLARE changed integer;
BEGIN
  UPDATE public.candidates SET bio='Super Admin synthetic probe'
  WHERE id=1601 AND bio='Foreign secret';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'Super Admin scope failed'; END IF;
END;
$super_admin$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $anonymous$
BEGIN
  BEGIN
    PERFORM bio FROM public.candidates;
    RAISE EXCEPTION 'Anonymous direct draft read allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anonymous$;
RESET ROLE;
ROLLBACK;
DO $preserved$
BEGIN
  IF (SELECT bio FROM public.candidates WHERE id=1002)<>'SECRET DRAFT BIO'
     OR has_column_privilege('authenticated','public.candidates','bio','SELECT') THEN
    RAISE EXCEPTION 'Synthetic proposal test did not roll back';
  END IF;
END;
$preserved$;
SELECT 'FROZEN_TWO_MIGRATION_PLAN=BLOCKED; PROPOSED_SCOPED_COMPATIBILITY=PASS; ALL_CHANGES_ROLLED_BACK' AS result;
