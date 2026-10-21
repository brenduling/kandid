-- Proposed one-time initialization for the official Kandid system settings row.
-- Do not execute against production without separate explicit approval.
-- Run the entire script as one PostgreSQL transaction.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

-- Block concurrent table writes while checking the empty baseline and inserting.
LOCK TABLE public.system_settings IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
DECLARE
  v_table_oid oid := to_regclass('public.system_settings');
  v_schema_mismatch boolean;
  v_constraint_count integer;
  v_index_count integer;
  v_trigger_count integer;
  v_sequence_start bigint;
  v_sequence_increment bigint;
  v_sequence_min bigint;
  v_sequence_max bigint;
  v_sequence_cache bigint;
  v_sequence_cycle boolean;
  v_sequence_last_value bigint;
BEGIN
  IF v_table_oid IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.system_settings is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = v_table_oid
      AND relrowsecurity IS TRUE
      AND relforcerowsecurity IS FALSE
  ) THEN
    RAISE EXCEPTION 'Preflight failed: system_settings RLS configuration differs from the reviewed baseline.';
  END IF;

  WITH expected(column_name, data_type, udt_name, is_nullable, character_maximum_length, column_default) AS (
    VALUES
      ('id', 'integer', 'int4', 'NO', NULL::integer, 'nextval(''system_settings_id_seq''::regclass)'),
      ('system_name', 'character varying', 'varchar', 'YES', 150, '''KANDID Voting System''::character varying'),
      ('allow_multiple_votes', 'boolean', 'bool', 'YES', NULL::integer, 'false'),
      ('allow_abstain', 'boolean', 'bool', 'YES', NULL::integer, 'true'),
      ('default_election_duration', 'integer', 'int4', 'YES', NULL::integer, '2'),
      ('maintenance_mode', 'boolean', 'bool', 'YES', NULL::integer, 'false'),
      ('created_at', 'timestamp without time zone', 'timestamp', 'YES', NULL::integer, 'CURRENT_TIMESTAMP')
  ), actual AS (
    SELECT column_name::text,
      data_type::text,
      udt_name::text,
      is_nullable::text,
      character_maximum_length::integer,
      column_default::text
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'system_settings'
  )
  SELECT
    (SELECT count(*) FROM actual) <> 7
    OR EXISTS (
      SELECT 1
      FROM expected e
      FULL OUTER JOIN actual a USING (column_name)
      WHERE e.column_name IS NULL
        OR a.column_name IS NULL
        OR ROW(e.data_type, e.udt_name, e.is_nullable, e.character_maximum_length, e.column_default)
          IS DISTINCT FROM
          ROW(a.data_type, a.udt_name, a.is_nullable, a.character_maximum_length, a.column_default)
    )
  INTO v_schema_mismatch;

  IF v_schema_mismatch THEN
    RAISE EXCEPTION 'Preflight failed: system_settings columns, nullability, or defaults differ from the reviewed baseline.';
  END IF;

  SELECT count(*) INTO v_constraint_count
  FROM pg_constraint
  WHERE conrelid = v_table_oid;

  IF v_constraint_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = v_table_oid
      AND contype = 'p'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
  ) THEN
    RAISE EXCEPTION 'Preflight failed: system_settings constraints differ from the reviewed primary-key-only baseline.';
  END IF;

  SELECT count(*) INTO v_index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'system_settings';

  IF v_index_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'system_settings'
      AND indexname = 'system_settings_pkey'
      AND indexdef ILIKE '%USING btree (id)%'
  ) THEN
    RAISE EXCEPTION 'Preflight failed: system_settings indexes differ from the reviewed baseline.';
  END IF;

  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger
  WHERE tgrelid = v_table_oid
    AND NOT tgisinternal;

  IF v_trigger_count <> 0 THEN
    RAISE EXCEPTION 'Preflight failed: system_settings has an unexpected user trigger.';
  END IF;

  IF pg_get_serial_sequence('public.system_settings', 'id') IS DISTINCT FROM 'public.system_settings_id_seq' THEN
    RAISE EXCEPTION 'Preflight failed: the id sequence ownership differs from the reviewed baseline.';
  END IF;

  SELECT seqstart, seqincrement, seqmin, seqmax, seqcache, seqcycle
  INTO v_sequence_start, v_sequence_increment, v_sequence_min, v_sequence_max, v_sequence_cache, v_sequence_cycle
  FROM pg_sequence
  WHERE seqrelid = to_regclass('public.system_settings_id_seq');

  IF NOT FOUND
    OR v_sequence_start <> 1
    OR v_sequence_increment <> 1
    OR v_sequence_min <> 1
    OR v_sequence_max <> 2147483647
    OR v_sequence_cache <> 1
    OR v_sequence_cycle IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'Preflight failed: system_settings_id_seq configuration differs from the reviewed baseline.';
  END IF;

  SELECT last_value INTO v_sequence_last_value
  FROM pg_sequences
  WHERE schemaname = 'public'
    AND sequencename = 'system_settings_id_seq';

  IF v_sequence_last_value IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: system_settings_id_seq has already been used; id 1 is not guaranteed.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.system_settings) THEN
    RAISE EXCEPTION 'Preflight failed: an existing system_settings record was found; nothing was changed.';
  END IF;
END
$preflight$;

-- The uncalled sequence is verified above, so its first generated value is id 1.
-- DEFAULT values are guarded above and match the values documented in the runbook.
INSERT INTO public.system_settings (
  system_name,
  allow_multiple_votes,
  allow_abstain,
  default_election_duration,
  maintenance_mode
)
VALUES (DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT)
RETURNING
  id,
  xmin::text AS rollback_xmin,
  created_at,
  system_name,
  allow_multiple_votes,
  allow_abstain,
  default_election_duration,
  maintenance_mode;

DO $postflight$
BEGIN
  IF (SELECT count(*) FROM public.system_settings) <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM public.system_settings
      WHERE id = 1
        AND system_name = 'KANDID Voting System'
        AND allow_multiple_votes IS FALSE
        AND allow_abstain IS TRUE
        AND default_election_duration = 2
        AND maintenance_mode IS FALSE
    ) THEN
    RAISE EXCEPTION 'Postflight failed: the expected single id 1 settings record was not created; the transaction will roll back.';
  END IF;
END
$postflight$;

COMMIT;
