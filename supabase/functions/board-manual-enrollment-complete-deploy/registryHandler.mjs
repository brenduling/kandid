import { handleCorsPreflight, rejectDisallowedOrigin } from "./kandidRegistryCors.mjs";

const READ_ACTIONS = new Set(["list_students", "list_removed_students", "resolve_student_for_term"]);
const REGISTRATION_ACTIONS = new Set(["create_new_student_for_term", "enroll_existing_student_for_term"]);
const CSV_PREVIEW_ACTION = "preview_board_csv_import";
const CSV_CONFIRM_ACTION = "confirm_board_csv_import";
const MAX_BOARD_CSV_ROWS = 500;
const REGISTRATION_WRITE_GATE = "BOARD_STUDENT_REGISTRATION_ENABLED";
const MANAGEMENT_ACTIONS = new Set(["update_student_names", "remove_student_participation", "restore_student_participation"]);
const MANAGEMENT_WRITE_GATE = "BOARD_STUDENT_MANAGEMENT_ENABLED";
const REGISTRY_READ_BODY_FIELDS = new Set([
  "action", "page", "page_size", "pageSize", "search", "sort_by", "sortBy", "organization_id",
]);

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cleanText(value, maxLength = 255) {
  return String(value || "").trim().slice(0, maxLength);
}

function admissionMessage(reason, organizationName) {
  const name = cleanText(organizationName) || "this organization";
  if (reason === "NOT_CURRENTLY_ENROLLED") return "This student must be enrolled for the current academic term before joining this organization.";
  if (reason === "TERM_NOT_ACTIVE") return "The active academic term changed while this request was being checked. Refresh and review again.";
  if (reason === "ACTIVE_TERM_UNAVAILABLE") return "Current-term membership is unavailable because the active academic term could not be verified. Ask a Super Admin to review term setup.";
  if (reason === "NON_DEPARTMENTAL_NEW_STUDENT") return `This student must first be enrolled through the institutional or departmental student workflow before joining ${name}.`;
  if (reason === "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION") return "This student's official program is not eligible for this organization.";
  if (reason === "ACTIVATION_SYNC_REQUIRED") return "Program and institution memberships are established when an academic term is activated and cannot be added, removed, or restored manually.";
  if (reason === "UNSUPPORTED_MEMBERSHIP_SCOPE") return "This organization's membership scope needs administrator review.";
  if (reason === "UNSUPPORTED_ORGANIZATION_TYPE") return "This organization's membership setup needs administrator review.";
  return "Organization membership could not be verified. Try again.";
}

function admissionOutcomeResponse(reason, organizationName) {
  const status = ["NOT_CURRENTLY_ENROLLED", "TERM_NOT_ACTIVE", "ACTIVE_TERM_UNAVAILABLE"].includes(reason) ? 409 : 403;
  return response({ data: { outcome: reason }, error: admissionMessage(reason, organizationName), code: String(reason).toLowerCase() }, status);
}

function organizationScopeFailure(organization) {
  const scope = cleanText(organization.membership_scope, 40);
  const type = cleanText(organization.organization_type, 40);
  if (!["program", "institution", "manual"].includes(scope)) return "UNSUPPORTED_MEMBERSHIP_SCOPE";
  if (!["departmental", "non_departmental"].includes(type) ||
    (scope === "program" && type !== "departmental") ||
    (scope === "manual" && type !== "non_departmental")) return "UNSUPPORTED_ORGANIZATION_TYPE";
  return null;
}

function isFiveDigitStudentNumber(value) {
  return /^[0-9]{5}$/.test(value);
}

function normalizeProgram(value) {
  return cleanText(value, 80).toUpperCase();
}

function normalizeEmail(value) {
  return cleanText(value, 320).toLowerCase();
}

function csvRowError(row, index) {
  const allowedFields = new Set([
    "row_number", "student_number", "first_name", "last_name", "email", "program", "year_level", "is_shs", "status",
  ]);
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some((field) => !allowedFields.has(field))) {
    return "This row contains unsupported CSV fields.";
  }
  if (typeof row.student_number !== "string" || !isFiveDigitStudentNumber(row.student_number.trim())) return "Student ID must contain exactly five digits.";
  if (typeof row.first_name !== "string" || typeof row.last_name !== "string" ||
    !row.first_name.trim() || !row.last_name.trim()) return "First and last name are required.";
  if (row.first_name.trim().length > 100 || row.last_name.trim().length > 100 ||
    /[\u0000-\u001f\u007f]/.test(row.first_name + row.last_name)) return "First and last name must use 1–100 printable characters.";
  if (typeof row.program !== "string" || !row.program.trim()) return "Program is required.";
  if (row.program.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(row.program)) return "Program must use 1–80 printable characters.";
  const yearLevel = Number(row.year_level);
  if (!Number.isInteger(yearLevel) || yearLevel < 1 || yearLevel > 6) return "Enter a valid college year level.";
  if (row.email !== undefined && typeof row.email !== "string") return "Email must be blank or use a valid email format.";
  if (typeof row.email === "string" && row.email.trim().length > 320) return "Email must be at most 320 characters.";
  const email = normalizeEmail(row.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Email must be blank or use a valid email format.";
  if (row.row_number !== undefined && (!Number.isInteger(Number(row.row_number)) || Number(row.row_number) < 2)) {
    return `CSV row ${index + 1} has an invalid row number.`;
  }
  return "";
}

function normalizeBoardCsvRows(inputRows) {
  if (!Array.isArray(inputRows) || inputRows.length === 0) {
    return { error: response({ error: "CSV rows are required.", code: "invalid_csv_payload" }, 400) };
  }
  if (inputRows.length > MAX_BOARD_CSV_ROWS) {
    return { error: response({ error: `A Board import may contain at most ${MAX_BOARD_CSV_ROWS} rows.`, code: "csv_row_limit_exceeded" }, 413) };
  }

  const seen = new Set();
  const rows = inputRows.map((input, index) => {
    const row = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const studentNumber = cleanText(row.student_number, 80);
    const normalizedNumber = studentNumber.toLowerCase();
    const duplicate = Boolean(normalizedNumber && seen.has(normalizedNumber));
    if (normalizedNumber) seen.add(normalizedNumber);
    return {
      row_number: Number(row.row_number) || index + 2,
      student_number: studentNumber,
      first_name: cleanText(row.first_name, 100),
      last_name: cleanText(row.last_name, 100),
      email: normalizeEmail(row.email),
      program: normalizeProgram(row.program),
      year_level: Number(row.year_level),
      invalid_message: csvRowError(input, index),
      duplicate,
    };
  });
  return { rows };
}

function summarizeBoardCsvRows(rows) {
  const summary = {
    total: rows.length, ready: 0, new_students: 0, existing_students: 0,
    imported: 0, already_member: 0, previously_removed: 0, identity_conflict: 0,
    ineligible: 0, invalid: 0, duplicate_csv: 0, not_imported: 0, issues: 0, skipped: 0,
  };
  for (const row of rows) {
    const status = cleanText(row.status, 40) || "invalid";
    if (status === "ready") {
      summary.ready += 1;
      summary[row.registration_kind === "new_student" ? "new_students" : "existing_students"] += 1;
    } else {
      summary[status] = (summary[status] || 0) + 1;
      if (!["already_member", "previously_removed", "imported"].includes(status)) summary.issues += 1;
    }
  }
  summary.skipped = summary.total - summary.imported;
  return summary;
}

async function previewBoardCsvImport(adminClient, profile, inputRows) {
  const normalized = normalizeBoardCsvRows(inputRows);
  if (normalized.error) return { response: normalized.error };

  const { data: term, error: termError } = await adminClient.from("academic_terms")
    .select("id, academic_year, semester, status").eq("status", "active").maybeSingle();
  if (termError) return { response: response({ error: "Unable to verify the active academic term.", code: "term_unavailable" }, 503) };
  if (!term?.id) return { response: response({ error: "Board CSV import requires one active academic term.", code: "term_unavailable" }, 409) };

  const organizationId = Number(profile.organization_id);
  const { data: organization, error: organizationError } = await adminClient.from("organizations")
    .select("id, name, organization_type, membership_scope").eq("id", organizationId).maybeSingle();
  if (organizationError || !organization?.id) return { response: response({ error: "The Board organization could not be verified.", code: "organization_unavailable" }, 503) };
  const scopeFailure = organizationScopeFailure(organization);
  if (scopeFailure) return { response: admissionOutcomeResponse(scopeFailure, organization.name) };

  const [{ data: programs, error: programsError }, coverageResult] = await Promise.all([
    adminClient.from("programs").select("id, code, name").limit(1000),
    organization.membership_scope === "program"
      ? adminClient.from("organization_programs").select("program_id").eq("organization_id", organizationId)
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (programsError || coverageResult.error) return { response: response({ error: "Board program coverage could not be verified.", code: "eligibility_unavailable" }, 503) };
  const coveredProgramIds = new Set((coverageResult.data || []).map((row) => Number(row.program_id)));
  const validRows = normalized.rows.filter((row) => !row.invalid_message && !row.duplicate);
  const studentNumbers = [...new Set(validRows.map((row) => row.student_number))];
  let students = [];
  if (studentNumbers.length) {
    const result = await adminClient.from("students")
      .select("id, student_number, first_name, last_name, email, program, year_level, status")
      .in("student_number", studentNumbers).limit(1000);
    if (result.error) return { response: response({ error: "Student identities could not be checked.", code: "identity_lookup_unavailable" }, 503) };
    students = result.data || [];
  }
  const studentIds = [...new Set(students.map((student) => Number(student.id)).filter(Number.isFinite))];
  let enrollments = [];
  let memberships = [];
  if (studentIds.length) {
    const [enrollmentResult, membershipResult] = await Promise.all([
      adminClient.from("student_term_enrollments")
        .select("student_id, program, year_level, enrollment_status")
        .eq("academic_term_id", term.id).in("student_id", studentIds),
      adminClient.from("student_organization_terms")
        .select("student_id, status, source, removal_reason")
        .eq("organization_id", organizationId).eq("academic_term_id", term.id).in("student_id", studentIds),
    ]);
    if (enrollmentResult.error || membershipResult.error) {
      return { response: response({ error: "Current-term enrollment and membership could not be checked.", code: "eligibility_unavailable" }, 503) };
    }
    enrollments = enrollmentResult.data || [];
    memberships = membershipResult.data || [];
  }

  const byStudentNumber = new Map();
  for (const student of students) {
    const key = cleanText(student.student_number, 80).toLowerCase();
    if (!byStudentNumber.has(key)) byStudentNumber.set(key, []);
    byStudentNumber.get(key).push(student);
  }
  const enrollmentByStudent = new Map(enrollments.map((row) => [Number(row.student_id), row]));
  const membershipByStudent = new Map(memberships.map((row) => [Number(row.student_id), row]));
  const results = [];

  for (const row of normalized.rows) {
    const base = {
      row_number: row.row_number, student_number: row.student_number, first_name: row.first_name,
      last_name: row.last_name, email: row.email, program: row.program, year_level: row.year_level,
    };
    if (row.invalid_message) {
      results.push({ ...base, status: "invalid", message: row.invalid_message });
      continue;
    }
    if (row.duplicate) {
      results.push({ ...base, status: "duplicate_csv", message: "This Student ID appears more than once in this CSV." });
      continue;
    }

    const programMatches = (programs || []).filter((program) =>
      [program.code, program.name].some((value) => normalizeProgram(value) === row.program));
    const uniqueProgramMatches = [...new Map(programMatches.map((program) => [Number(program.id), program])).values()];
    if (uniqueProgramMatches.length !== 1 ||
      (organization.membership_scope === "program" && !coveredProgramIds.has(Number(uniqueProgramMatches[0]?.id)))) {
      results.push({ ...base, status: "ineligible", message: "Program is not uniquely configured or is outside this Board's assigned coverage." });
      continue;
    }

    const matches = byStudentNumber.get(row.student_number.toLowerCase()) || [];
    if (matches.length > 1) {
      results.push({ ...base, status: "identity_conflict", message: "Multiple student identities use this Student ID." });
      continue;
    }
    if (!matches.length) {
      results.push({ ...base, status: "ready", registration_kind: "new_student", message: `New student identity and active-term enrollment will be created for ${cleanText(organization.name)} after you confirm the official masterlist.` });
      continue;
    }

    const student = matches[0];
    const enrollment = enrollmentByStudent.get(Number(student.id));
    const membership = membershipByStudent.get(Number(student.id));
    const identityMatches = cleanText(student.first_name, 100) === row.first_name &&
      cleanText(student.last_name, 100) === row.last_name &&
      cleanText(student.program, 80) === row.program && Number(student.year_level) === row.year_level &&
      (!row.email || cleanText(student.email, 320) === row.email) &&
      (!enrollment || (cleanText(enrollment.program, 80) === row.program && Number(enrollment.year_level) === row.year_level));
    if (!identityMatches) {
      results.push({ ...base, status: "identity_conflict", message: "CSV details differ from the existing student or current-term record. Existing identity, email, and enrollment were left unchanged." });
      continue;
    }
    if (student.status === "disabled") {
      results.push({ ...base, student_id: student.id, status: "ineligible", message: "This student identity is disabled and requires administrator review." });
      continue;
    }
    if (enrollment && !["enrolled", "not_in_masterlist"].includes(enrollment.enrollment_status)) {
      results.push({ ...base, student_id: student.id, status: "ineligible", message: "The current-term enrollment status does not allow Board registration." });
      continue;
    }
    if (membership?.status === "removed") {
      results.push({ ...base, student_id: student.id, status: "previously_removed", message: "This student has a removed current-term organization membership. CSV import cannot restore it." });
      continue;
    }
    if (membership?.status === "active" && enrollment?.enrollment_status === "enrolled") {
      results.push({ ...base, student_id: student.id, status: "already_member", message: `This student is already registered in ${cleanText(organization.name)} for the active term.` });
      continue;
    }
    if (organization.membership_scope === "manual" && enrollment?.enrollment_status === "enrolled") {
      const { data: admissionResult, error: admissionError } = await adminClient.rpc("kandid_check_student_organization_admission", {
        p_student_id: Number(student.id), p_organization_id: organizationId, p_academic_term_id: Number(term.id),
      });
      const admission = Array.isArray(admissionResult) ? admissionResult[0] : admissionResult;
      if (admissionError || !admission) return { response: response({ error: "Manual organization eligibility could not be verified.", code: "eligibility_unavailable" }, 503) };
      if (!admission.allowed) {
        results.push({ ...base, student_id: student.id, status: "ineligible", message: admissionMessage(admission.reason, organization.name) });
        continue;
      }
    }
    results.push({
      ...base, student_id: student.id, status: "ready", registration_kind: "existing_student",
      message: `Existing student is eligible for verified enrollment in ${cleanText(organization.name)} for the active term.`,
    });
  }

  const { data: currentTerm, error: currentTermError } = await adminClient.from("academic_terms")
    .select("id").eq("status", "active").maybeSingle();
  if (currentTermError || Number(currentTerm?.id) !== Number(term.id)) {
    return { response: response({ error: "The active academic term changed during CSV review. Refresh the preview.", code: "term_changed" }, 409) };
  }
  return { data: {
    academic_term: term, board_organization_id: organizationId, organization_name: organization.name,
    organization_type: organization.organization_type, results, summary: summarizeBoardCsvRows(results),
  } };
}

async function handleConfirmBoardCsvImport(adminClient, profile, body) {
  if (Object.keys(body).some((field) => !new Set(["action", "rows", "evidence_reviewed"]).has(field))) {
    return response({ error: "Unsupported CSV import request field.", code: "invalid_csv_payload" }, 400);
  }
  if (body.evidence_reviewed !== true) {
    return response({ error: "Confirm that the official department masterlist was reviewed before importing.", code: "enrollment_evidence_review_required" }, 400);
  }
  const preview = await previewBoardCsvImport(adminClient, profile, body.rows);
  if (preview.response) return preview.response;
  const ready = preview.data.results.filter((row) => row.status === "ready");
  const importedRows = [];
  const failedRows = [];
  for (const row of ready) {
    const student = {
      student_number: row.student_number, first_name: row.first_name, last_name: row.last_name,
      email: row.email, program: row.program, year_level: row.year_level,
    };
    const registration = await registerVerifiedStudent(adminClient, profile, {
      action: row.registration_kind === "new_student" ? "create_new_student_for_term" : "enroll_existing_student_for_term",
      student, verification_method: "department_masterlist", evidence_reviewed: true,
    }, row.registration_kind === "new_student");
    const payload = await registration.clone().json().catch(() => null);
    if (!registration.ok || payload?.data?.organization_outcome !== "REGISTERED") {
      failedRows.push({ ...row, status: "not_imported", message: "The row failed final server validation and was not imported." });
      continue;
    }
    importedRows.push({ ...row, status: "imported", message: "Verified enrollment was registered for the active term." });
  }
  const notReady = preview.data.results.filter((row) => row.status !== "ready");
  const allResults = [...importedRows, ...failedRows, ...notReady].sort((a, b) => Number(a.row_number) - Number(b.row_number));
  const summary = summarizeBoardCsvRows(allResults);
  summary.imported = importedRows.length;
  summary.ready = ready.length;
  summary.new_students = ready.filter((row) => row.registration_kind === "new_student").length;
  summary.existing_students = ready.filter((row) => row.registration_kind === "existing_student").length;
  summary.skipped = allResults.length - importedRows.length;

  if (importedRows.length) {
    const audited = await auditBoardEvent(adminClient, profile, {
      eventType: "student_batch_imported", entityType: "student_import", entityLabel: "Board CSV import",
      metadata: { imported_count: importedRows.length, skipped_count: summary.skipped, active_term_id: preview.data.academic_term.id },
    });
    if (!audited) {
      return response({
        error: "Student rows were processed, but the import summary audit could not be saved. Review the row results before retrying.",
        code: "audit_record_failed",
        data: { ...preview.data, results: allResults, summary },
      }, 500);
    }
  }
  return response({ data: { ...preview.data, results: allResults, summary } });
}

const REGISTRATION_BODY_FIELDS = new Set(["action", "student", "verification_method", "evidence_reviewed"]);
const REGISTRATION_STUDENT_FIELDS = new Set([
  "student_number", "first_name", "last_name", "email", "program", "year_level",
  "photo_url", "precinct_code", "batch_code",
]);

async function registerVerifiedStudent(adminClient, profile, body, createIdentity) {
  if (Object.keys(body).some((field) => !REGISTRATION_BODY_FIELDS.has(field))) {
    return response({ error: "Unsupported registration request field." }, 400);
  }
  if (!body.student || typeof body.student !== "object" || Array.isArray(body.student) ||
    Object.keys(body.student).some((field) => !REGISTRATION_STUDENT_FIELDS.has(field))) {
    return response({ data: { outcome: "INVALID_INPUT" } }, 400);
  }

  const student = body.student;
  const studentNumber = cleanText(student.student_number, 80);
  const firstName = cleanText(student.first_name);
  const lastName = cleanText(student.last_name);
  const program = normalizeProgram(student.program);
  const yearLevel = Number(student.year_level);
  const method = cleanText(body.verification_method, 40);
  if (!isFiveDigitStudentNumber(studentNumber)) return response({ data: { outcome: "INVALID_FORMAT" } }, 400);
  if (body.evidence_reviewed !== true || !["school_id", "registration_form", "department_masterlist"].includes(method)) {
    return response({ data: { outcome: "ENROLLMENT_EVIDENCE_REVIEW_REQUIRED" } }, 400);
  }
  if (!firstName || !lastName || !program || !Number.isInteger(yearLevel) || yearLevel < 1 || yearLevel > 6) {
    return response({ data: { outcome: "INVALID_INPUT" } }, 400);
  }

  const { data, error } = await adminClient.rpc("kandid_board_register_verified_student_for_term_v1", {
    p_actor_admin_id: Number(profile.id),
    p_board_organization_id: Number(profile.organization_id),
    p_student_number: studentNumber,
    p_first_name: firstName,
    p_last_name: lastName,
    p_email: normalizeEmail(student.email),
    p_program: program,
    p_year_level: yearLevel,
    p_verification_method: method,
    p_evidence_reviewed: true,
    p_create_identity: createIdentity,
    p_photo_url: cleanText(student.photo_url, 500_000) || null,
    p_precinct_code: cleanText(student.precinct_code, 80) || null,
    p_batch_code: cleanText(student.batch_code, 80) || null,
  });
  if (error) {
    const reason = String(error.message || "");
    if (reason.includes("IDENTITY_RECHECK_REQUIRED")) return response({ data: { outcome: "IDENTITY_RECHECK_REQUIRED" } }, 409);
    if (reason.includes("STUDENT_IDENTITY_NOT_FOUND")) return response({ data: { outcome: "STUDENT_IDENTITY_NOT_FOUND" } }, 404);
    if (/Program is not a unique configured catalog entry|Program is outside this Board organization coverage/.test(reason)) {
      return response({ data: { outcome: "INELIGIBLE" } }, 403);
    }
    if (/authorization required/i.test(reason)) return response({ error: "Board authorization could not be verified." }, 403);
    return response({ error: "Verified student registration could not be completed." }, 500);
  }

  const result = (Array.isArray(data) ? data[0] : data) || null;
  if (!result?.student_id || !result?.academic_term_id || result.organization_outcome !== "REGISTERED") {
    return response({ error: "Verified registration returned an incomplete result." }, 500);
  }
  return response({ data: {
    outcome: result.outcome,
    organization_outcome: "REGISTERED",
    student_number: studentNumber,
    student_status: result.student_status || null,
    academic_term: { id: result.academic_term_id },
    verification_method: result.verification_method,
    verified_by_admin_id: result.verified_by_admin_id,
  } });
}

async function checkProgramScopeEligibility(adminClient, organizationId, enrollmentProgram) {
  const normalizedProgram = cleanText(enrollmentProgram, 80).toUpperCase();
  if (!normalizedProgram) return { eligible: false, error: null };

  const { data: catalogRows, error: catalogError } = await adminClient.from("programs")
    .select("id, code, name");
  if (catalogError) return { eligible: false, error: catalogError };
  const matches = (catalogRows || []).filter((program) =>
    [program.code, program.name].some((value) => cleanText(value, 80).toUpperCase() === normalizedProgram));
  const uniqueMatches = [...new Map(matches.map((program) => [Number(program.id), program])).values()];
  if (uniqueMatches.length > 1) return { eligible: false, error: new Error("Ambiguous program catalog identity") };
  if (!uniqueMatches.length) return { eligible: false, error: null };

  const { data: coverageRows, error: coverageError } = await adminClient.from("organization_programs")
    .select("program_id").eq("organization_id", organizationId);
  if (coverageError) return { eligible: false, error: coverageError };
  return {
    eligible: (coverageRows || []).some((coverage) => Number(coverage.program_id) === Number(uniqueMatches[0].id)),
    error: null,
  };
}

async function resolveBoardStudentForTerm(adminClient, profile, studentNumberInput) {
  const studentNumber = cleanText(studentNumberInput, 80);
  const organizationId = Number(profile.organization_id);
  const { data: activeTerm, error: termError } = await adminClient.from("academic_terms")
    .select("id, academic_year, semester, status").eq("status", "active").maybeSingle();
  if (termError) return response({ error: "Unable to verify the active academic term." }, 500);
  if (!activeTerm?.id) return response({ data: { outcome: "INVALID_TERM" } }, 409);

  const { data: organization, error: organizationError } = await adminClient.from("organizations")
    .select("id, name, organization_type, membership_scope").eq("id", organizationId).maybeSingle();
  if (organizationError || !organization?.id) return response({ error: "The Board organization could not be verified." }, 500);
  const scopeFailure = organizationScopeFailure(organization);
  if (scopeFailure) return admissionOutcomeResponse(scopeFailure, organization.name);

  const { data: matches, error: studentError } = await adminClient.from("students")
    .select("id, student_number, first_name, last_name, program, year_level, status")
    .eq("student_number", studentNumber).limit(2);
  if (studentError) return response({ error: "Unable to resolve the student identity." }, 500);
  if ((matches || []).length > 1) return response({ data: { outcome: "IDENTITY_RECONCILIATION_REQUIRED" } }, 409);

  const student = matches?.[0] || null;
  if (!student) {
    if (!isFiveDigitStudentNumber(studentNumber)) return response({ data: { outcome: "INVALID_FORMAT" } }, 400);
    return response({ data: { outcome: "STUDENT_IDENTITY_NOT_FOUND" } });
  }

  const [{ data: enrollment, error: enrollmentError }, { data: participation, error: participationError }] = await Promise.all([
    adminClient.from("student_term_enrollments")
      .select("program, year_level, enrollment_status, source")
      .eq("student_id", student.id).eq("academic_term_id", activeTerm.id).maybeSingle(),
    adminClient.from("student_organization_terms")
      .select("status")
      .eq("student_id", student.id).eq("organization_id", organizationId).eq("academic_term_id", activeTerm.id).maybeSingle(),
  ]);
  if (enrollmentError || participationError) return response({ error: "Unable to verify current-term participation." }, 500);

  const isCurrentlyEnrolled = enrollment?.enrollment_status === "enrolled";
  const canBeVerifiedForActiveTerm = !enrollment || enrollment.enrollment_status === "not_in_masterlist";
  const officialProgram = normalizeProgram(enrollment?.program || student.program);
  let organizationOutcome;
  let organizationEligible = false;
  if (!isCurrentlyEnrolled) {
    if (!canBeVerifiedForActiveTerm) {
      organizationOutcome = "NOT_CURRENTLY_ENROLLED";
    } else if (organization.membership_scope === "institution") {
      // The verified enrollment RPC establishes the active-term enrollment and
      // system memberships together after the Board reviews physical evidence.
      organizationEligible = true;
      organizationOutcome = "NOT_CURRENTLY_ENROLLED";
    } else if (organization.membership_scope === "program") {
      const eligibility = await checkProgramScopeEligibility(adminClient, organizationId, officialProgram);
      if (eligibility.error) return response({ error: "Organization eligibility could not be verified." }, 500);
      organizationEligible = eligibility.eligible;
      organizationOutcome = organizationEligible ? "NOT_CURRENTLY_ENROLLED" : "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION";
    } else {
      // Manual-scope membership eligibility is checked transactionally by the
      // trusted registration RPC after it records the verified term enrollment.
      organizationEligible = true;
      organizationOutcome = "NOT_CURRENTLY_ENROLLED";
    }
  } else if (participation?.status === "active") {
    organizationOutcome = "ALREADY_MEMBER";
    organizationEligible = true;
  } else if (organization.membership_scope === "institution") {
    // Institution participation is system-synchronized; current-term enrollment
    // establishes eligibility, while the Board remains unable to add membership.
    organizationEligible = true;
    organizationOutcome = "ACTIVATION_SYNC_REQUIRED";
  } else if (organization.membership_scope === "program") {
    const eligibility = await checkProgramScopeEligibility(adminClient, organizationId, officialProgram);
    if (eligibility.error) return response({ error: "Organization eligibility could not be verified." }, 500);
    organizationEligible = eligibility.eligible;
    organizationOutcome = organizationEligible ? "ACTIVATION_SYNC_REQUIRED" : "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION";
  } else {
    const { data: admissionRows, error: admissionError } = await adminClient.rpc("kandid_check_student_organization_admission", {
      p_student_id: Number(student.id),
      p_organization_id: organizationId,
      p_academic_term_id: Number(activeTerm.id),
    });
    const admission = Array.isArray(admissionRows) ? admissionRows[0] : admissionRows;
    if (admissionError || !admission) return response({ error: "Organization eligibility could not be verified." }, 500);
    organizationEligible = Boolean(admission.allowed);
    organizationOutcome = admission.allowed ? "AVAILABLE_FOR_ORGANIZATION" : admission.reason;
    if (participation?.status === "removed" && admission.allowed) organizationOutcome = "RESTORATION_REQUIRED";
  }

  const scopedStudent = organizationEligible || (isCurrentlyEnrolled && participation)
    ? {
      student_number: student.student_number,
      first_name: student.first_name,
      last_name: student.last_name,
      program: officialProgram,
      year_level: enrollment?.year_level || student.year_level,
      status: student.status,
    }
    : null;

  return response({ data: {
    outcome: isCurrentlyEnrolled
      ? "ALREADY_ENROLLED_CURRENT_TERM"
      : enrollment?.enrollment_status === "not_in_masterlist"
        ? "EXISTING_STUDENT_NOT_IN_MASTERLIST"
        : "EXISTING_STUDENT_NEW_TERM",
    organization_outcome: organizationOutcome,
    organization_type: organization.organization_type,
    organization_scope: organization.membership_scope,
    student: scopedStudent,
    academic_term: activeTerm,
  } });
}

function parsePositiveInteger(value, fallback, maximum = 100) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function compareStudents(left, right, sortBy) {
  const leftName = `${cleanText(left.last_name)} ${cleanText(left.first_name)}`.trim();
  const rightName = `${cleanText(right.last_name)} ${cleanText(right.first_name)}`.trim();
  const leftNumber = cleanText(left.student_number);
  const rightNumber = cleanText(right.student_number);
  const leftCreated = Date.parse(cleanText(left.created_at)) || 0;
  const rightCreated = Date.parse(cleanText(right.created_at)) || 0;
  if (sortBy === "name_desc") return rightName.localeCompare(leftName) || rightNumber.localeCompare(leftNumber);
  if (sortBy === "oldest") return leftCreated - rightCreated || leftNumber.localeCompare(rightNumber);
  if (sortBy === "id_asc") return leftNumber.localeCompare(rightNumber, undefined, { numeric: true });
  if (sortBy === "id_desc") return rightNumber.localeCompare(leftNumber, undefined, { numeric: true });
  if (sortBy === "newest") return rightCreated - leftCreated || rightNumber.localeCompare(leftNumber);
  return leftName.localeCompare(rightName) || leftNumber.localeCompare(rightNumber);
}

function getSearchableList(rows, search, removed) {
  const term = search.toLowerCase();
  return rows.filter((student) => {
    if (!term) return true;
    const values = [student.student_number, student.first_name, student.last_name, student.email, student.program];
    if (removed) values.push(student.removal_reason);
    return values.map((value) => cleanText(value).toLowerCase()).join(" ").includes(term);
  });
}

async function loadStudents(adminClient, profile, body, removed) {
  const page = parsePositiveInteger(body.page, 1, 10000);
  const pageSize = parsePositiveInteger(body.page_size ?? body.pageSize, 10, 100);
  const search = cleanText(body.search, 120);
  const sortBy = cleanText(body.sort_by ?? body.sortBy, 40) || "newest";
  const organizationId = Number(profile.organization_id);

  const { data: activeTerm, error: termError } = await adminClient.from("academic_terms")
    .select("id, academic_year, semester, status")
    .eq("status", "active").maybeSingle();
  if (termError) return response({ error: "Unable to verify the active academic term." }, 500);
  if (!activeTerm?.id) return response({ error: "Board student listing requires an active academic term." }, 409);

  const { data: organization, error: organizationError } = await adminClient.from("organizations")
    .select("id, organization_type, membership_scope").eq("id", organizationId).maybeSingle();
  if (organizationError || !organization?.id) return response({ error: "The Board organization could not be verified." }, 500);

  const status = removed ? "removed" : "active";
  const participationQuery = adminClient.from("student_organization_terms")
    .select(removed
      ? "id, student_id, organization_id, source, removal_reason, removed_at, academic_term_id"
      : "student_id, organization_id, source")
    .eq("academic_term_id", activeTerm.id)
    .eq("organization_id", organizationId)
    .eq("status", status);
  const { data: participations, error: participationError } = await participationQuery;
  if (participationError) return response({ error: "Unable to load organization participation." }, 500);

  const participationsByStudentId = new Map((participations || [])
    .filter((row) => row.student_id)
    .map((row) => [Number(row.student_id), row]));
  const studentIds = [...participationsByStudentId.keys()];
  let list = [];
  if (studentIds.length > 0) {
    const enrollmentQuery = adminClient.from("student_term_enrollments")
      .select("student_id, academic_term_id, program, year_level, enrollment_status, source")
      .eq("academic_term_id", activeTerm.id).in("student_id", studentIds);
    const activeEnrollmentQuery = removed ? enrollmentQuery : enrollmentQuery.eq("enrollment_status", "enrolled");
    const [{ data: enrollments, error: enrollmentError }, { data: students, error: studentError }] = await Promise.all([
      activeEnrollmentQuery,
      adminClient.from("students")
        .select("id, student_number, first_name, last_name, email, photo_url, status, created_at")
        .in("id", studentIds),
    ]);
    if (enrollmentError) return response({ error: "Unable to load active-term enrollments." }, 500);
    if (studentError) return response({ error: "Unable to load students." }, 500);

    const enrollmentsByStudentId = new Map((enrollments || []).map((row) => [Number(row.student_id), row]));
    const studentsById = new Map((students || []).map((row) => [Number(row.id), row]));
    list = [...studentIds].map((studentId) => {
      const student = studentsById.get(studentId);
      const enrollment = enrollmentsByStudentId.get(studentId);
      const participation = participationsByStudentId.get(studentId);
      if (!student || (!removed && (!enrollment || enrollment.enrollment_status !== "enrolled"))) return null;
      return {
        id: student.id,
        student_number: student.student_number,
        first_name: student.first_name,
        last_name: student.last_name,
        email: student.email,
        photo_url: student.photo_url,
        program: enrollment?.program || "",
        year_level: enrollment?.year_level || "",
        status: student.status,
        created_at: student.created_at,
        membership_status: status,
        membership_role: "member",
        membership_source: participation.source,
        enrollment_status: enrollment?.enrollment_status || null,
        enrollment_source: enrollment?.source || null,
        academic_term_id: removed ? participation.academic_term_id : enrollment.academic_term_id,
        ...(removed ? { removal_reason: participation.removal_reason, removed_at: participation.removed_at } : {}),
      };
    }).filter(Boolean);
  }

  const filtered = getSearchableList(list, search, removed);
  filtered.sort((left, right) => compareStudents(left, right, sortBy));
  const count = filtered.length;
  const students = filtered.slice((page - 1) * pageSize, page * pageSize);
  return response({ data: {
    students,
    count,
    page,
    page_size: pageSize,
    academic_term: activeTerm,
    board_organization_id: organizationId,
    ...(!removed ? { organization_type: organization.organization_type } : {}),
  } });
}

function parseRequiredPositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} is required.`);
  return parsed;
}

async function auditBoardEvent(adminClient, profile, event) {
  const organizationId = Number(profile.organization_id);
  const { data: organization } = await adminClient.from("organizations")
    .select("name").eq("id", organizationId).maybeSingle();
  const { error } = await adminClient.from("audit_logs").insert({
    user_id: Number(profile.id),
    actor_name: cleanText(profile.full_name),
    actor_role: "electoral_board",
    action: event.eventType,
    event_type: event.eventType,
    event_category: event.eventType.startsWith("organization_") ? "organization" : "students",
    event_origin: "trusted_edge",
    entity_type: event.entityType,
    entity_id: event.entityId == null ? null : String(event.entityId),
    entity_label: event.entityLabel,
    organization_id: organizationId,
    organization_name: organization?.name || null,
    status: "completed",
    metadata: event.metadata || {},
  });
  return !error;
}

const REMOVAL_FIELDS = new Set(["action", "student_id", "reason", "confirm_student_number", "password"]);
const SAFE_PARTICIPATION_ERRORS = new Set([
  "Invalid participation request.", "Unsupported participation action.", "Removal reason is required.",
  "No active academic term is available.", "Student not found.", "Organization not found.",
  "Student is not enrolled for the active academic term.",
  "Student does not have current-term participation in this organization.",
]);

function safeParticipationError(message) {
  const safe = cleanText(message, 300);
  return SAFE_PARTICIPATION_ERRORS.has(safe) ? safe : "Student organization participation could not be updated.";
}

async function verifyBoardPassword({ createClient, supabaseUrl, anonKey, user }, password) {
  const email = normalizeEmail(user?.email);
  if (!email || !password) return false;
  const reauthClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    const { data, error } = await reauthClient.auth.signInWithPassword({ email, password });
    return !error && cleanText(data?.user?.id, 64) === cleanText(user?.id, 64);
  } catch {
    return false;
  }
}

async function verifyRemovalTarget({ adminClient, profile, user, body, studentId, createClient, supabaseUrl, anonKey }) {
  const { data: activeTerm, error: termError } = await adminClient.from("academic_terms")
    .select("id").eq("status", "active").maybeSingle();
  if (termError) return response({ error: "The active academic term could not be verified." }, 500);
  if (!activeTerm?.id) return response({ error: "An active academic term is required to remove a student." }, 409);

  const [{ data: student, error: studentError }, { data: participation, error: participationError }] = await Promise.all([
    adminClient.from("students").select("id, student_number").eq("id", studentId).maybeSingle(),
    adminClient.from("student_organization_terms").select("id, status")
      .eq("student_id", studentId).eq("organization_id", Number(profile.organization_id))
      .eq("academic_term_id", activeTerm.id).maybeSingle(),
  ]);
  if (studentError || participationError) return response({ error: "The selected student could not be verified." }, 500);
  if (!student) return response({ error: "The selected student is no longer available." }, 409);
  if (!participation) return response({ error: "This student is not a current-term participant in your organization.", code: "target_out_of_scope" }, 403);

  const submittedNumber = cleanText(body.confirm_student_number, 80);
  if (!submittedNumber) return response({ error: "Enter the student's ID to confirm this removal.", code: "confirmation_required" }, 400);
  if (submittedNumber !== cleanText(student.student_number, 80)) {
    return response({ error: "The Student ID does not match the selected student.", code: "student_id_mismatch" }, 400);
  }
  if (!await verifyBoardPassword({ createClient, supabaseUrl, anonKey, user }, body.password)) {
    return response({ error: "Your password could not be verified.", code: "password_invalid" }, 401);
  }
  return null;
}

async function updateStudentNames(adminClient, profile, body) {
  if (Object.keys(body).some((field) => !["action", "student_id", "changes"].includes(field))) {
    return response({ error: "Unsupported student edit field." }, 400);
  }
  if (!body.changes || typeof body.changes !== "object" || Array.isArray(body.changes)) {
    return response({ error: "Enter the student's first and last name." }, 400);
  }
  const changes = body.changes;
  if (Object.keys(changes).length !== 2 || !Object.hasOwn(changes, "first_name") || !Object.hasOwn(changes, "last_name") ||
      typeof changes.first_name !== "string" || typeof changes.last_name !== "string") {
    return response({ error: "Only first and last name may be edited here." }, 400);
  }
  const firstName = changes.first_name.trim();
  const lastName = changes.last_name.trim();
  if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100 || /[\u0000-\u001f\u007f]/.test(firstName + lastName)) {
    return response({ error: "First and last name must each be 1–100 characters." }, 400);
  }
  let studentId;
  try { studentId = parseRequiredPositiveInteger(body.student_id, "Student"); }
  catch { return response({ error: "Invalid student request." }, 400); }

  const { data: term, error: termError } = await adminClient.from("academic_terms")
    .select("id").eq("status", "active").maybeSingle();
  if (termError) return response({ error: "An active academic term could not be verified." }, 500);
  if (!term?.id) return response({ error: "An active academic term is required to edit this record." }, 409);
  const { data: organization, error: orgError } = await adminClient.from("organizations")
    .select("id, name, organization_type, membership_scope")
    .eq("id", Number(profile.organization_id)).maybeSingle();
  if (orgError || !organization?.id) return response({ error: "The Board organization could not be verified." }, 500);
  const scopeFailure = organizationScopeFailure(organization);
  if (scopeFailure) return admissionOutcomeResponse(scopeFailure, organization.name);

  const [{ data: participation, error: participationError }, { data: enrollment, error: enrollmentError }] = await Promise.all([
    adminClient.from("student_organization_terms").select("student_id")
      .eq("student_id", studentId).eq("organization_id", Number(profile.organization_id))
      .eq("academic_term_id", term.id).eq("status", "active").maybeSingle(),
    adminClient.from("student_term_enrollments").select("student_id, program")
      .eq("student_id", studentId).eq("academic_term_id", term.id)
      .eq("enrollment_status", "enrolled").maybeSingle(),
  ]);
  if (participationError || enrollmentError) return response({ error: "Student edit access could not be verified." }, 500);
  if (!participation || !enrollment) return response({ error: "This student is not available for editing in your current register." }, 403);
  if (organization.membership_scope === "program") {
    const coverage = await checkProgramScopeEligibility(adminClient, Number(profile.organization_id), enrollment.program);
    if (coverage.error) return response({ error: "Board program coverage could not be verified." }, 500);
    if (!coverage.eligible) return response({ error: "This student is outside your configured program coverage." }, 403);
  }

  const { data: student, error: updateError } = await adminClient.from("students")
    .update({ first_name: firstName, last_name: lastName }).eq("id", studentId)
    .select("id, first_name, last_name").maybeSingle();
  if (updateError || !student) return response({ error: "Student names could not be saved. Try again." }, 500);
  if (!await auditBoardEvent(adminClient, profile, {
    eventType: "student_identity_updated", entityType: "student", entityId: student.id,
    entityLabel: "Student identity", metadata: { changed_fields: ["first_name", "last_name"], academic_term_id: term.id },
  })) {
    return response({ error: "Student names were saved, but the audit record could not be saved. Refresh before retrying.", code: "audit_record_failed" }, 500);
  }
  return response({ data: student });
}

async function updateParticipation({ adminClient, profile, user, body, action, createClient, supabaseUrl, anonKey }) {
  if (action === "remove_student_participation") {
    if (Object.keys(body).some((field) => !REMOVAL_FIELDS.has(field))) return response({ error: "Unsupported removal request field." }, 400);
  } else if (Object.keys(body).some((field) => !["action", "student_id"].includes(field))) {
    return response({ error: "Unsupported restoration request field." }, 400);
  }
  let studentId;
  try { studentId = parseRequiredPositiveInteger(body.student_id, "Student"); }
  catch { return response({ error: "Invalid participation request." }, 400); }
  let reason = null;
  if (action === "remove_student_participation") {
    reason = cleanText(body.reason, 500);
    if (!reason) return response({ error: "Removal reason is required." }, 400);
  }

  const organizationId = Number(profile.organization_id);
  const { data: organization, error: orgError } = await adminClient.from("organizations")
    .select("id, name, organization_type, membership_scope").eq("id", organizationId).maybeSingle();
  if (orgError || !organization?.id) return response({ error: "The Board organization could not be verified." }, 500);
  const scopeFailure = organizationScopeFailure(organization);
  if (scopeFailure) return admissionOutcomeResponse(scopeFailure, organization.name);
  if (organization.membership_scope !== "manual") {
    return admissionOutcomeResponse(organization.membership_scope ? "ACTIVATION_SYNC_REQUIRED" : "UNSUPPORTED_MEMBERSHIP_SCOPE", organization.name);
  }

  if (action === "remove_student_participation") {
    const rejection = await verifyRemovalTarget({ adminClient, profile, user, body, studentId, createClient, supabaseUrl, anonKey });
    if (rejection) return rejection;
  } else {
    const { data: term, error: termError } = await adminClient.from("academic_terms")
      .select("id").eq("status", "active").maybeSingle();
    if (termError || !term?.id) return response({ error: "Membership could not be verified for the current academic term." }, 409);
    const { data, error } = await adminClient.rpc("kandid_check_student_organization_admission", {
      p_student_id: studentId, p_organization_id: organizationId, p_academic_term_id: Number(term.id),
    });
    const admission = Array.isArray(data) ? data[0] : data;
    if (error || !admission) return response({ error: "Organization membership could not be verified. Try again." }, 500);
    if (!admission.allowed) return admissionOutcomeResponse(admission.reason, organization.name);
  }

  const { data, error } = await adminClient.rpc("board_update_student_participation", {
    target_student_id: studentId, target_organization_id: organizationId,
    actor_admin_id: Number(profile.id),
    target_action: action === "remove_student_participation" ? "remove" : "restore",
    target_reason: reason,
  });
  if (error) {
    const match = String(error.message || "").match(/MEMBERSHIP_ADMISSION_DENIED:([A-Z_]+)/);
    const safeReasons = new Set(["ACTIVE_TERM_UNAVAILABLE", "ACTIVATION_SYNC_REQUIRED", "NOT_CURRENTLY_ENROLLED", "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION", "TERM_NOT_ACTIVE", "UNSUPPORTED_ORGANIZATION_TYPE", "UNSUPPORTED_MEMBERSHIP_SCOPE"]);
    if (action === "restore_student_participation" && match && safeReasons.has(match[1])) return admissionOutcomeResponse(match[1], organization.name);
    return response({ error: safeParticipationError(error.message) }, 400);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return response({ error: "Student organization participation could not be updated." }, 500);
  if (!row.already_applied && !await auditBoardEvent(adminClient, profile, {
    eventType: action === "remove_student_participation" ? "membership_removed" : "membership_restored",
    entityType: "student_organization", entityId: studentId, entityLabel: "Organization participation",
    metadata: { academic_term_id: row.academic_term_id || null },
  })) {
    const verb = action === "remove_student_participation" ? "removed" : "restored";
    return response({ error: `Participation was ${verb}, but its audit record could not be saved. Refresh before retrying.`, code: "audit_record_failed" }, 500);
  }
  return response({ data: {
    result: {
      status: row.status,
      participation_id: row.participation_id,
      academic_term_id: row.academic_term_id,
    },
    already_applied: Boolean(row.already_applied),
  } });
}

async function handleManagementAction(deps, profile, user, body, action) {
  if (action === "update_student_names") return updateStudentNames(deps.adminClient, profile, body);
  return updateParticipation({ ...deps, profile, user, body, action });
}

export function createBoardStudentRegistrationHandler({ createClient, getEnv }) {
  return async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;
    const originError = rejectDisallowedOrigin(request);
    if (originError) return originError;
    if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);

    const supabaseUrl = getEnv("SUPABASE_URL");
    const anonKey = getEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) return response({ error: "Server configuration is incomplete." }, 500);

    const authorization = request.headers.get("Authorization");
    if (!authorization) return response({ error: "Authentication required.", code: "session_invalid" }, 401);
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    const user = authData?.user;
    if (authError || !user?.id) return response({ error: "Invalid or expired session.", code: "session_invalid" }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await adminClient.from("admin_users")
      .select("id, auth_user_id, full_name, role, status, organization_id")
      .eq("auth_user_id", user.id).maybeSingle();
    if (profileError) return response({ error: "Unable to verify Electoral Board access." }, 500);
    if (!profile || profile.auth_user_id !== user.id || profile.role !== "electoral_board" ||
      profile.status !== "active" || !Number.isInteger(Number(profile.organization_id)) || Number(profile.organization_id) <= 0) {
      return response({ error: "Active Electoral Board authorization required.", code: "board_forbidden" }, 403);
    }

    let body;
    try { body = await request.json(); } catch { return response({ error: "Invalid JSON body." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "Invalid request body." }, 400);
    const action = cleanText(body.action, 80);
    if (!READ_ACTIONS.has(action) && !REGISTRATION_ACTIONS.has(action) && !MANAGEMENT_ACTIONS.has(action) &&
      action !== CSV_PREVIEW_ACTION && action !== CSV_CONFIRM_ACTION) {
      return response({ error: "This endpoint does not allow the requested action.", code: "unsupported_action" }, 403);
    }

    if (REGISTRATION_ACTIONS.has(action)) {
      // The deployment package is safe by default. Only the exact server-side
      // value "true" enables these two reviewed registration actions; every
      // other value, including an absent setting, leaves registration disabled.
      if (getEnv(REGISTRATION_WRITE_GATE) !== "true") {
        return response({
          data: { outcome: "REGISTRATION_NOT_ENABLED" },
          error: "Board student registration is not enabled on this deployment.",
          code: "registration_not_enabled",
        }, 403);
      }
      return await registerVerifiedStudent(
        adminClient,
        profile,
        body,
        action === "create_new_student_for_term",
      );
    }

    if (action === CSV_PREVIEW_ACTION) {
      if (Object.keys(body).some((field) => !new Set(["action", "rows"]).has(field))) {
        return response({ error: "Unsupported CSV preview request field.", code: "invalid_csv_payload" }, 400);
      }
      const preview = await previewBoardCsvImport(adminClient, profile, body.rows);
      return preview.response || response({ data: preview.data });
    }

    if (action === CSV_CONFIRM_ACTION) {
      if (getEnv(REGISTRATION_WRITE_GATE) !== "true") {
        return response({
          data: { outcome: "REGISTRATION_NOT_ENABLED" },
          error: "Board student registration is not enabled on this deployment.",
          code: "registration_not_enabled",
        }, 403);
      }
      return await handleConfirmBoardCsvImport(adminClient, profile, body);
    }

    if (MANAGEMENT_ACTIONS.has(action)) {
      // This independent gate is intentionally default-off. Registration and
      // student-management mutations require separate operator activation.
      if (getEnv(MANAGEMENT_WRITE_GATE) !== "true") {
        return response({ data: { outcome: "STUDENT_MANAGEMENT_NOT_ENABLED" },
          error: "Board student management is not enabled on this deployment.",
          code: "student_management_not_enabled" }, 403);
      }
      try {
        return await handleManagementAction({ adminClient, createClient, supabaseUrl, anonKey }, profile, user, body, action);
      } catch {
        return response({ error: "Student management could not be completed. Refresh and try again." }, 500);
      }
    }

    if (action === "resolve_student_for_term") {
      if (Object.keys(body).some((field) => !["action", "student_number"].includes(field))) {
        return response({ error: "Unsupported Student ID lookup field." }, 400);
      }
      return await resolveBoardStudentForTerm(adminClient, profile, body.student_number);
    }

    if (Object.keys(body).some((field) => !REGISTRY_READ_BODY_FIELDS.has(field))) {
      return response({ error: "Unsupported registry request field." }, 400);
    }
    if (body.organization_id !== undefined && Number(body.organization_id) !== Number(profile.organization_id)) {
      return response({ error: "Organization is outside your assignment." }, 403);
    }
    return await loadStudents(adminClient, profile, body, action === "list_removed_students");
  };
}
