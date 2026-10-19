CREATE FUNCTION pg_temp.assert_true(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %', p_message; END IF;
  RAISE NOTICE '[PASS] %', p_message;
END $$;

CREATE TEMP TABLE preserved_enrollments AS
SELECT * FROM public.student_term_enrollments WHERE student_id = 900;
CREATE TEMP TABLE preserved_participation AS
SELECT * FROM public.student_organization_terms WHERE student_id = 900;
CREATE TEMP TABLE preserved_elections AS SELECT * FROM public.elections;
CREATE TEMP TABLE preserved_votes AS SELECT * FROM public.votes;
CREATE TEMP TABLE preserved_ballots AS SELECT * FROM public.vote_ballots;
CREATE TEMP TABLE preserved_imports AS SELECT * FROM public.masterlist_imports;

DO $$
DECLARE result jsonb; student_id_value integer; row_count integer;
BEGIN
  result := public.kandid_board_register_verified_student_for_term_v1(
    p_actor_admin_id=>1, p_board_organization_id=>100, p_student_number=>'12345',
    p_first_name=>'Test', p_last_name=>'BSIT', p_email=>'bsit@example.invalid',
    p_program=>'BSIT', p_year_level=>2, p_verification_method=>'school_id',
    p_evidence_reviewed=>true, p_create_identity=>true
  );
  student_id_value := (result->>'student_id')::integer;
  PERFORM pg_temp.assert_true(result->>'outcome'='NEW_STUDENT_CREATED', 'verified Board creates a new Student identity');
  PERFORM pg_temp.assert_true(result->>'verification_method'='school_id' AND (result->>'academic_term_id')::integer=1,
    'verification method and active academic term are returned');
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.student_term_enrollments e
    WHERE e.student_id=student_id_value AND e.academic_term_id=1 AND e.enrollment_status='enrolled'
      AND e.source='manual' AND e.verification_method='school_id' AND e.verified_by_admin_id=1 AND e.verified_at IS NOT NULL),
    'school ID verification is stored with the responsible Board actor and timestamp');
  PERFORM pg_temp.assert_true((SELECT count(*)=3 FROM public.student_organization_terms p
    WHERE p.student_id=student_id_value AND p.academic_term_id=1 AND p.status='active'
      AND p.organization_id IN (100,101,102)), 'BSIT configuration synchronizes WITSG, PSITS, and CREDO');
  PERFORM pg_temp.assert_true((SELECT count(*)=3 FROM public.student_organizations m
    WHERE m.student_id=student_id_value AND m.organization_id IN (100,101,102)),
    'BSIT organization mappings create matching structural memberships');
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.audit_logs a
    WHERE a.user_id=1 AND a.actor_role='electoral_board' AND a.organization_id=100
      AND a.event_type='student_enrollment_verified' AND a.metadata->>'verification_method'='school_id'
      AND (a.metadata->>'academic_term_id')::integer=1 AND a.metadata ? 'verified_at'),
    'audit attribution is server-derived from the authorized Board and active term');

  result := public.kandid_board_register_verified_student_for_term_v1(
    p_actor_admin_id=>1, p_board_organization_id=>100, p_student_number=>'23456',
    p_first_name=>'Test', p_last_name=>'BSHM', p_email=>null,
    p_program=>'BSHM', p_year_level=>1, p_verification_method=>'registration_form',
    p_evidence_reviewed=>true, p_create_identity=>true
  );
  student_id_value := (result->>'student_id')::integer;
  PERFORM pg_temp.assert_true((SELECT count(*)=3 FROM public.student_organization_terms p
    WHERE p.student_id=student_id_value AND p.academic_term_id=1 AND p.status='active'
      AND p.organization_id IN (100,103,104)), 'BSHM configuration synchronizes WITSG, JEHMS, and LAS');

  result := public.kandid_board_register_verified_student_for_term_v1(
    p_actor_admin_id=>2, p_board_organization_id=>101, p_student_number=>'55667',
    p_first_name=>'Program', p_last_name=>'Board', p_email=>null,
    p_program=>'BSIT', p_year_level=>1, p_verification_method=>'school_id',
    p_evidence_reviewed=>true, p_create_identity=>true
  );
  student_id_value := (result->>'student_id')::integer;
  PERFORM pg_temp.assert_true((SELECT count(*)=3 FROM public.student_organization_terms p
    WHERE p.student_id=student_id_value AND p.academic_term_id=1 AND p.status='active'
      AND p.organization_id IN (100,101,102)),
    'program-specific PSITS Board can register a covered BSIT student and the server syncs all configured organizations');
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.audit_logs a
    WHERE a.user_id=2 AND a.organization_id=101 AND a.event_type='student_enrollment_verified'),
    'program-Board audit attribution uses that verified Board and its assigned organization');

  result := public.kandid_board_register_verified_student_for_term_v1(
    p_actor_admin_id=>1, p_board_organization_id=>100, p_student_number=>'55668',
    p_first_name=>'Scope', p_last_name=>'Boundary', p_email=>null,
    p_program=>'BSHM', p_year_level=>1, p_verification_method=>'school_id',
    p_evidence_reviewed=>true, p_create_identity=>true
  );
  student_id_value := (result->>'student_id')::integer;
  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      p_actor_admin_id=>2, p_board_organization_id=>101, p_student_number=>'55668',
      p_first_name=>'Scope', p_last_name=>'Boundary', p_email=>null,
      p_program=>'BSIT', p_year_level=>1, p_verification_method=>'school_id',
      p_evidence_reviewed=>true, p_create_identity=>false
    );
    RAISE EXCEPTION 'expected existing-program scope denial';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.assert_true(
      (SELECT s.program='BSHM' AND e.program='BSHM'
       FROM public.students s JOIN public.student_term_enrollments e ON e.student_id=s.id
       WHERE s.id=student_id_value AND e.academic_term_id=1),
      'program Board cannot change an existing current-term enrollment outside its configured coverage'
    );
  END;

  result := public.kandid_board_register_verified_student_for_term_v1(
    p_actor_admin_id=>1, p_board_organization_id=>100, p_student_number=>'55668',
    p_first_name=>'Scope', p_last_name=>'Boundary', p_email=>null,
    p_program=>'BSIT', p_year_level=>1, p_verification_method=>'school_id',
    p_evidence_reviewed=>true, p_create_identity=>false
  );
  PERFORM pg_temp.assert_true(
    (SELECT s.program='BSIT' AND e.program='BSIT'
     FROM public.students s JOIN public.student_term_enrollments e ON e.student_id=s.id
     WHERE s.id=student_id_value AND e.academic_term_id=1),
    'institution-wide WITSG Board can authorize a verified current-term program correction'
  );

  result := public.kandid_board_register_verified_student_for_term_v1(
    p_actor_admin_id=>1, p_board_organization_id=>100, p_student_number=>'34567',
    p_first_name=>'Import', p_last_name=>'Student', p_email=>null,
    p_program=>'BSIT', p_year_level=>3, p_verification_method=>'department_masterlist',
    p_evidence_reviewed=>true, p_create_identity=>true
  );
  student_id_value := (result->>'student_id')::integer;
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.student_term_enrollments e
    WHERE e.student_id=student_id_value AND e.source='masterlist'
      AND e.verification_method='department_masterlist' AND e.verified_by_admin_id=1),
    'CSV-row masterlist method is stored using the authorized Board actor');

  result := public.kandid_board_register_verified_student_for_term_v1(
    p_actor_admin_id=>1, p_board_organization_id=>100, p_student_number=>'12345',
    p_first_name=>'Test', p_last_name=>'BSIT', p_email=>'bsit@example.invalid',
    p_program=>'BSIT', p_year_level=>2, p_verification_method=>'school_id',
    p_evidence_reviewed=>true, p_create_identity=>false
  );
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.students WHERE student_number='12345'),
    'duplicate registration does not create a second Student identity');
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.student_term_enrollments e
    JOIN public.students s ON s.id=e.student_id WHERE s.student_number='12345' AND e.academic_term_id=1),
    'duplicate registration does not create a second current-term enrollment');
  PERFORM pg_temp.assert_true((SELECT count(*)=3 FROM public.student_organization_terms p
    JOIN public.students s ON s.id=p.student_id WHERE s.student_number='12345' AND p.academic_term_id=1 AND p.status='active'),
    'duplicate registration does not duplicate organization participation');

  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      p_actor_admin_id=>1, p_board_organization_id=>100, p_student_number=>'12345',
      p_first_name=>'Tampered', p_last_name=>'Identity', p_email=>null,
      p_program=>'BSIT', p_year_level=>2, p_verification_method=>'school_id',
      p_evidence_reviewed=>false, p_create_identity=>false
    );
    RAISE EXCEPTION 'expected evidence-review denial';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    PERFORM pg_temp.assert_true((SELECT first_name='Test' FROM public.students WHERE student_number='12345'),
      'unreviewed evidence is denied before changing Student identity');
  END;

  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      p_actor_admin_id=>1, p_board_organization_id=>101, p_student_number=>'45678',
      p_first_name=>'Wrong', p_last_name=>'Scope', p_email=>null,
      p_program=>'BSIT', p_year_level=>1, p_verification_method=>'school_id',
      p_evidence_reviewed=>true, p_create_identity=>true
    );
    RAISE EXCEPTION 'expected actor/organization mismatch denial';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.students WHERE student_number='45678'),
      'client organization parameter cannot override the Board user assignment');
  END;

  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      p_actor_admin_id=>2, p_board_organization_id=>101, p_student_number=>'45679',
      p_first_name=>'Wrong', p_last_name=>'Program', p_email=>null,
      p_program=>'BSHM', p_year_level=>1, p_verification_method=>'registration_form',
      p_evidence_reviewed=>true, p_create_identity=>true
    );
    RAISE EXCEPTION 'expected program coverage denial';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.students WHERE student_number='45679'),
      'program Board cannot register a student outside its configured many-to-many coverage');
  END;

  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      p_actor_admin_id=>2, p_board_organization_id=>100, p_student_number=>'45683',
      p_first_name=>'Tampered', p_last_name=>'Board Scope', p_email=>null,
      p_program=>'BSIT', p_year_level=>1, p_verification_method=>'school_id',
      p_evidence_reviewed=>true, p_create_identity=>true
    );
    RAISE EXCEPTION 'expected assigned-organization tampering denial';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.students WHERE student_number='45683'),
      'tampered Board organization ID is rejected against trusted admin_users assignment');
  END;

  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      p_actor_admin_id=>4, p_board_organization_id=>100, p_student_number=>'45680',
      p_first_name=>'Inactive', p_last_name=>'Board', p_email=>null,
      p_program=>'BSIT', p_year_level=>1, p_verification_method=>'school_id',
      p_evidence_reviewed=>true, p_create_identity=>true
    );
    RAISE EXCEPTION 'expected inactive Board denial';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.students WHERE student_number='45680'),
      'inactive Board cannot register a Student');
  END;

  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      p_actor_admin_id=>1, p_board_organization_id=>100, p_student_number=>'45681',
      p_first_name=>'Invalid', p_last_name=>'Evidence', p_email=>null,
      p_program=>'BSIT', p_year_level=>1, p_verification_method=>'unverified',
      p_evidence_reviewed=>true, p_create_identity=>true
    );
    RAISE EXCEPTION 'expected invalid evidence method denial';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.students WHERE student_number='45681'),
      'unknown evidence method is denied');
  END;

  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      p_actor_admin_id=>5, p_board_organization_id=>100, p_student_number=>'45682',
      p_first_name=>'Super', p_last_name=>'Admin', p_email=>null,
      p_program=>'BSIT', p_year_level=>1, p_verification_method=>'school_id',
      p_evidence_reviewed=>true, p_create_identity=>true
    );
    RAISE EXCEPTION 'expected non-Board actor denial';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.students WHERE student_number='45682'),
      'Super Admin id cannot be supplied as a Board actor');
  END;

  -- Advance to Semester 2; current-term writes must leave Semester 1 records intact.
  UPDATE public.academic_terms SET status='closed', closed_at=now() WHERE id=1;
  UPDATE public.academic_terms SET status='active', activated_at=now() WHERE id=2;
  result := public.kandid_board_register_verified_student_for_term_v1(
    p_actor_admin_id=>1, p_board_organization_id=>100, p_student_number=>'12345',
    p_first_name=>'Test', p_last_name=>'BSHM', p_email=>'bsit@example.invalid',
    p_program=>'BSHM', p_year_level=>3, p_verification_method=>'registration_form',
    p_evidence_reviewed=>true, p_create_identity=>false
  );
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.student_term_enrollments e
    JOIN public.students s ON s.id=e.student_id WHERE s.student_number='12345' AND e.academic_term_id=1 AND e.program='BSIT'),
    'semester shift preserves the prior-term program enrollment');
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.student_organization_terms p
    JOIN public.students s ON s.id=p.student_id WHERE s.student_number='12345' AND p.academic_term_id=1
      AND p.organization_id=101 AND p.status='active'), 'semester shift preserves prior-term PSITS participation');
  PERFORM pg_temp.assert_true((SELECT count(*)=3 FROM public.student_organization_terms p
    JOIN public.students s ON s.id=p.student_id WHERE s.student_number='12345' AND p.academic_term_id=2
      AND p.status='active' AND p.organization_id IN (100,103,104)),
    'new semester follows the configured BSHM to WITSG/JEHMS/LAS mapping');

  -- Force a late audit failure after identity/enrollment/sync writes: outer RPC
  -- transaction must roll every earlier write back.
  CREATE FUNCTION public.test_reject_registration_audit() RETURNS trigger LANGUAGE plpgsql AS $audit_fail$
  BEGIN RAISE EXCEPTION 'test-only audit failure'; END $audit_fail$;
  CREATE TRIGGER test_reject_registration_audit BEFORE INSERT ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.test_reject_registration_audit();
  BEGIN
    PERFORM public.kandid_board_register_verified_student_for_term_v1(
      p_actor_admin_id=>1, p_board_organization_id=>100, p_student_number=>'56789',
      p_first_name=>'Rollback', p_last_name=>'Student', p_email=>null,
      p_program=>'BSIT', p_year_level=>1, p_verification_method=>'school_id',
      p_evidence_reviewed=>true, p_create_identity=>true
    );
    RAISE EXCEPTION 'expected forced audit failure';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.students WHERE student_number='56789'),
      'late registration failure rolls back the new identity');
    PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.student_term_enrollments e
      JOIN public.students s ON s.id=e.student_id WHERE s.student_number='56789'),
      'late registration failure rolls back enrollment');
    PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.student_organization_terms p
      JOIN public.students s ON s.id=p.student_id WHERE s.student_number='56789'),
      'late registration failure rolls back synchronized memberships');
  END;
  DROP TRIGGER test_reject_registration_audit ON public.audit_logs;
  DROP FUNCTION public.test_reject_registration_audit();

  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.student_term_enrollments e
    JOIN preserved_enrollments p ON p.student_id=e.student_id AND p.academic_term_id=e.academic_term_id
      AND p.program=e.program AND p.year_level=e.year_level AND p.enrollment_status=e.enrollment_status),
    'pre-existing historical enrollment remains unchanged');
  PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM public.student_organization_terms s
    JOIN preserved_participation p ON p.id=s.id AND p.status=s.status AND p.source=s.source
      AND p.academic_term_id=s.academic_term_id), 'pre-existing historical participation remains unchanged');
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.elections e JOIN preserved_elections p USING(id,title)),
    'pre-existing election remains unchanged');
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.votes v JOIN preserved_votes p USING(id,election_id,payload)),
    'pre-existing vote remains unchanged');
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.vote_ballots b JOIN preserved_ballots p USING(id,election_id,payload)),
    'pre-existing ballot remains unchanged');
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.masterlist_imports i JOIN preserved_imports p USING(id,academic_term_id,payload)),
    'pre-existing masterlist import remains unchanged');

  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.academic_terms WHERE status='active'),
    'exactly one term is active after semester transition');
  PERFORM pg_temp.assert_true((SELECT p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      AND p.proconfig=array['search_path=pg_catalog']::text[]
    FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(
      'public.kandid_board_register_verified_student_for_term_v1(bigint,integer,text,text,text,text,text,integer,text,boolean,boolean,text,text,text)')),
    'registration RPC is postgres-owned SECURITY DEFINER with restricted search_path');
  PERFORM pg_temp.assert_true(pg_catalog.has_function_privilege('service_role',
      'public.kandid_board_register_verified_student_for_term_v1(bigint,integer,text,text,text,text,text,integer,text,boolean,boolean,text,text,text)', 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon',
      'public.kandid_board_register_verified_student_for_term_v1(bigint,integer,text,text,text,text,text,integer,text,boolean,boolean,text,text,text)', 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated',
      'public.kandid_board_register_verified_student_for_term_v1(bigint,integer,text,text,text,text,text,integer,text,boolean,boolean,text,text,text)', 'EXECUTE'),
    'registration RPC EXECUTE is service-role only');
  PERFORM pg_temp.assert_true(pg_catalog.has_table_privilege('service_role','public.audit_logs','INSERT')
    AND NOT pg_catalog.has_table_privilege('service_role','public.audit_logs','UPDATE')
    AND NOT pg_catalog.has_table_privilege('service_role','public.audit_logs','DELETE'),
    'trusted audit table permits service-role inserts only, preventing attribution edits/deletes');
END $$;

-- Row-level CSV semantics: a valid row persists independently; the next bad
-- row fails without deleting or changing the already committed valid row.
SELECT public.kandid_board_register_verified_student_for_term_v1(
  p_actor_admin_id=>1, p_board_organization_id=>100, p_student_number=>'67890',
  p_first_name=>'CSV', p_last_name=>'Good Row', p_email=>null,
  p_program=>'BSIT', p_year_level=>1, p_verification_method=>'department_masterlist',
  p_evidence_reviewed=>true, p_create_identity=>true
);
