-- Proposed rollback for the one-time system settings initialization.
-- Do not execute without approval. Replace both placeholders with the exact
-- rollback_xmin and created_at returned by the forward INSERT.
-- This removes the row only if its original tuple version and values are intact.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.system_settings IN SHARE ROW EXCLUSIVE MODE;

DO $rollback$
DECLARE
  v_expected_xmin text := 'REPLACE_WITH_RETURNED_ROLLBACK_XMIN';
  v_expected_created_at text := 'REPLACE_WITH_RETURNED_CREATED_AT';
  v_table_oid oid := to_regclass('public.system_settings');
  v_deleted integer;
BEGIN
  IF v_table_oid IS NULL THEN
    RAISE EXCEPTION 'Rollback stopped: public.system_settings is missing.';
  END IF;

  IF v_expected_xmin = 'REPLACE_WITH_RETURNED_ROLLBACK_XMIN'
    OR v_expected_created_at = 'REPLACE_WITH_RETURNED_CREATED_AT' THEN
    RAISE EXCEPTION 'Rollback stopped: paste the captured insertion fingerprint before running.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = v_table_oid
      AND relrowsecurity IS TRUE
      AND relforcerowsecurity IS FALSE
  ) THEN
    RAISE EXCEPTION 'Rollback stopped: system_settings RLS configuration changed.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = v_table_oid
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Rollback stopped: an unexpected trigger could cause side effects.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = v_table_oid
  ) THEN
    RAISE EXCEPTION 'Rollback stopped: an unexpected foreign key could make deletion affect related records.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.system_settings
    WHERE id = 1
      AND xmin::text = v_expected_xmin
      AND created_at::text = v_expected_created_at
      AND system_name = 'KANDID Voting System'
      AND allow_multiple_votes IS FALSE
      AND allow_abstain IS TRUE
      AND default_election_duration = 2
      AND maintenance_mode IS FALSE
  ) THEN
    RAISE EXCEPTION 'Rollback stopped: id 1 is missing or has changed since initialization; no record was deleted.';
  END IF;

  DELETE FROM public.system_settings
  WHERE id = 1
    AND xmin::text = v_expected_xmin
    AND created_at::text = v_expected_created_at
    AND system_name = 'KANDID Voting System'
    AND allow_multiple_votes IS FALSE
    AND allow_abstain IS TRUE
    AND default_election_duration = 2
    AND maintenance_mode IS FALSE;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'Rollback stopped: expected exactly one unchanged settings record, deleted %.', v_deleted;
  END IF;
END
$rollback$;

COMMIT;
