-- Real authenticated-role operations against the disposable trusted-guard fixture.
-- All synthetic journey records and edits are rolled back.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000030',true);
INSERT INTO public.elections(id,organization_id,academic_term_id,title,status,campaign_start,campaign_end,start_date,end_date)
VALUES (18,1,1,'Synthetic mutable One','active',timezone('Asia/Manila',now())+interval '1 day',timezone('Asia/Manila',now())+interval '2 days',timezone('Asia/Manila',now())+interval '3 days',timezone('Asia/Manila',now())+interval '4 days'),
       (19,2,1,'Synthetic mutable Two','active',timezone('Asia/Manila',now())+interval '1 day',timezone('Asia/Manila',now())+interval '2 days',timezone('Asia/Manila',now())+interval '3 days',timezone('Asia/Manila',now())+interval '4 days');
INSERT INTO public.positions VALUES (180,18,'Synthetic President',1,1,'active'),(190,19,'Synthetic President',1,1,'active');
INSERT INTO public.candidates(id,position_id,student_id,partylist_id,photo,bio,platform,credentials,campaign_status,campaign_materials,campaign_media_urls)
VALUES (1801,180,1,1,'https://example.invalid/admin.png','Original bio','Original platform','Original credentials','draft','[]','[]'),
       (1901,190,2,3,null,'Foreign original bio','Foreign platform','Foreign credentials','hidden','[]','[]');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',true);
DO $board_edit$
DECLARE changed integer; returned_id integer;
BEGIN
  UPDATE public.candidates SET bio='Board edited bio'
  WHERE id=1801 AND position_id=180 AND partylist_id=1
    AND photo='https://example.invalid/admin.png' AND bio='Original bio'
    AND platform='Original platform' AND credentials='Original credentials'
    AND campaign_materials='[]'::jsonb AND campaign_media_urls='[]'::jsonb
  RETURNING id INTO returned_id;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 OR returned_id<>1801 THEN RAISE EXCEPTION 'Board edit was not confirmed'; END IF;
  UPDATE public.candidates SET bio='Stale overwrite must fail'
  WHERE id=1801 AND position_id=180 AND bio='Original bio';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>0 THEN RAISE EXCEPTION 'Stale update overwrote newer values'; END IF;
  IF (SELECT count(partylist_id) FROM public.candidates WHERE partylist_id=1)<1
     OR EXISTS(SELECT 1 FROM public.candidates WHERE partylist_id=3) THEN
    RAISE EXCEPTION 'Board partylist counts are unavailable or foreign scoped';
  END IF;
  BEGIN
    UPDATE public.candidates SET bio='Historical mutation must fail' WHERE id=1001 AND bio='Published biography';
    RAISE EXCEPTION 'Historical election edit was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.candidates SET student_id=3 WHERE id=1801;
    RAISE EXCEPTION 'Candidate identity change accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$board_edit$;
SELECT 'BOARD_EDIT_STALE_UPDATE_PARTYLIST_AND_HISTORY=PASS' AS result;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000020',true);
DO $foreign_board$
DECLARE changed integer;
BEGIN
  IF EXISTS(SELECT 1 FROM public.candidates WHERE id=1801) THEN RAISE EXCEPTION 'Foreign draft read leaked'; END IF;
  UPDATE public.candidates SET bio='Foreign overwrite' WHERE id=1801 AND bio='Board edited bio';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>0 THEN RAISE EXCEPTION 'Foreign Board edit accepted'; END IF;
  UPDATE public.candidates SET position_id=null WHERE id=1801 AND position_id=180;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>0 THEN RAISE EXCEPTION 'Foreign Board disconnect accepted'; END IF;
END;
$foreign_board$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $student$
DECLARE changed integer;
BEGIN
  IF EXISTS(SELECT 1 FROM public.candidates WHERE bio IS NOT NULL OR campaign_materials IS NOT NULL)
     OR (SELECT count(partylist_id) FROM public.candidates)<>0 THEN RAISE EXCEPTION 'Student direct campaign row access leaked'; END IF;
  UPDATE public.candidates SET bio='Student overwrite' WHERE id=1801 AND bio='Board edited bio';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>0 THEN RAISE EXCEPTION 'Student update accepted'; END IF;
  BEGIN
    PERFORM student_id FROM public.candidates;
    RAISE EXCEPTION 'Student foreign-key column grant broadened';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$student$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $missing_identity$
BEGIN
  IF EXISTS(SELECT 1 FROM public.candidates) THEN RAISE EXCEPTION 'Missing identity read rows'; END IF;
END;
$missing_identity$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $anonymous$
BEGIN
  BEGIN
    PERFORM bio FROM public.candidates;
    RAISE EXCEPTION 'Anonymous draft read succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anonymous$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000030',true);
DO $super_admin$
DECLARE changed integer; returned_id integer;
BEGIN
  UPDATE public.candidates SET platform='Super Admin platform'
  WHERE id=1901 AND position_id=190 AND bio='Foreign original bio'
  RETURNING id INTO returned_id;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 OR returned_id<>1901 THEN RAISE EXCEPTION 'Super Admin edit failed'; END IF;
  IF (SELECT count(partylist_id) FROM public.candidates WHERE partylist_id=3)<2 THEN
    RAISE EXCEPTION 'Super Admin partylist count failed';
  END IF;
  UPDATE public.candidates SET position_id=null
  WHERE id=1801 AND position_id=180 AND partylist_id=1
    AND photo='https://example.invalid/admin.png' AND bio='Board edited bio'
    AND platform='Original platform' AND credentials='Original credentials'
    AND campaign_materials='[]'::jsonb AND campaign_media_urls='[]'::jsonb
  RETURNING id INTO returned_id;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 OR returned_id<>1801 THEN RAISE EXCEPTION 'Authorized disconnect was not confirmed'; END IF;
  BEGIN
    UPDATE public.candidates SET position_id=190 WHERE id=1801 AND position_id IS NULL;
    RAISE EXCEPTION 'Detached candidate was adopted into a foreign election';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$super_admin$;
SELECT 'SUPER_ADMIN_EDIT_AND_DISCONNECT=PASS' AS result;
RESET ROLE;
ROLLBACK;
SELECT 'ADMIN_MUTATIONS_ALL_ROLLED_BACK=PASS' AS result;
