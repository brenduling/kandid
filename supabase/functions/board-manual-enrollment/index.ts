import { corsHeaders, handleCorsPreflight, rejectDisallowedOrigin, serveWithKandidCors } from "../_shared/kandidProductionSecurity.mjs";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeMembershipAdmissionReason } from "../_shared/membershipAdmission.js";


function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function checkOrganizationAdmission(
  adminClient: any,
  studentId: number,
  organizationId: number,
  academicTermId: number,
) {
  const { data, error } = await adminClient.rpc("kandid_check_student_organization_admission", {
    p_student_id: studentId,
    p_organization_id: organizationId,
    p_academic_term_id: academicTermId,
  });
  const admission = Array.isArray(data) ? data[0] : data;
  return { admission: admission || null, error };
}

function admissionMessage(reason: unknown, organizationName?: unknown) {
  const value = typeof reason === "string" ? reason : "";
  const name = typeof organizationName === "string" && organizationName.trim()
    ? organizationName.trim()
    : "this organization";
  if (value === "NOT_CURRENTLY_ENROLLED") {
    return "This student must be enrolled for the current academic term before joining this organization.";
  }
  if (value === "TERM_NOT_ACTIVE") {
    return "The active academic term changed while this request was being checked. Refresh and review again.";
  }
  if (value === "ACTIVE_TERM_UNAVAILABLE") {
    return "Current-term membership is unavailable because the active academic term could not be verified. Ask a Super Admin to review term setup.";
  }
  if (value === "NON_DEPARTMENTAL_NEW_STUDENT") {
    return `This student must first be enrolled through the institutional or departmental student workflow before joining ${name}.`;
  }
  if (value === "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION") {
    return "This student's official program is not eligible for this organization.";
  }
  if (value === "ACTIVATION_SYNC_REQUIRED") {
    return "Program and institution memberships are established when an academic term is activated and cannot be added, removed, or restored manually.";
  }
  if (value === "UNSUPPORTED_MEMBERSHIP_SCOPE") {
    return "This organization's membership scope needs administrator review.";
  }
  if (value === "UNSUPPORTED_ORGANIZATION_TYPE") {
    return "This organization's membership setup needs administrator review.";
  }
  return "Organization membership could not be verified. Try again.";
}

function cleanText(value: unknown, maxLength = 255) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeEmail(value: unknown) {
  return cleanText(value, 320).toLowerCase();
}

function normalizeProgram(value: unknown) {
  return cleanText(value, 80).toUpperCase();
}

function isFiveDigitStudentNumber(value: string) {
  return /^[0-9]{5}$/.test(value);
}

async function checkProgramScopeEligibility(adminClient: any, organizationId: number, enrollmentProgram: unknown) {
  const normalizedProgram = normalizeProgram(enrollmentProgram);
  if (!normalizedProgram) return { eligible: false, error: null };

  const { data: catalogRows, error: catalogError } = await adminClient
    .from("programs")
    .select("id, code, name");
  if (catalogError) return { eligible: false, error: catalogError };
  const matches = (catalogRows || []).filter((program: Record<string, unknown>) =>
    [program.code, program.name].some((value) => normalizeProgram(value) === normalizedProgram));
  const uniqueMatches = [...new Map(matches.map((program: Record<string, unknown>) => [Number(program.id), program])).values()];
  if (uniqueMatches.length > 1) return { eligible: false, error: new Error("Ambiguous program catalog identity") };
  if (!uniqueMatches.length) return { eligible: false, error: null };

  const { data: coverageRows, error: coverageError } = await adminClient
    .from("organization_programs")
    .select("program_id")
    .eq("organization_id", organizationId);
  if (coverageError) return { eligible: false, error: coverageError };
  return {
    eligible: (coverageRows || []).some((coverage: Record<string, unknown>) => Number(coverage.program_id) === Number((uniqueMatches[0] as Record<string, unknown>).id)),
    error: null,
  };
}

function parseCollegeYearLevel(value: unknown) {
  const yearLevel = Number(value);
  if (!Number.isInteger(yearLevel) || yearLevel <= 0 || yearLevel > 6) {
    throw new Error("Enter a valid college year level.");
  }
  return yearLevel;
}

function sameText(left: unknown, right: unknown) {
  return cleanText(left).toLowerCase() === cleanText(right).toLowerCase();
}

function sameProgram(left: unknown, right: unknown) {
  return normalizeProgram(left) === normalizeProgram(right);
}

function admissionOutcomeResponse(reason: string, organizationName?: string) {
  const status = ["NOT_CURRENTLY_ENROLLED", "TERM_NOT_ACTIVE", "ACTIVE_TERM_UNAVAILABLE"].includes(reason) ? 409 : 403;
  return jsonResponse({
    data: { outcome: reason },
    error: admissionMessage(reason, organizationName),
    code: reason.toLowerCase(),
  }, status);
}

function organizationScopeFailure(organization: Record<string, unknown>) {
  const scope = cleanText(organization.membership_scope, 40);
  const type = cleanText(organization.organization_type, 40);
  if (!["program", "institution", "manual"].includes(scope)) return "UNSUPPORTED_MEMBERSHIP_SCOPE";
  if (!(["departmental", "non_departmental"].includes(type)) ||
    (scope === "program" && type !== "departmental") ||
    (scope === "manual" && type !== "non_departmental")) {
    return "UNSUPPORTED_ORGANIZATION_TYPE";
  }
  return null;
}

async function loadOrganizationContext(adminClient: any, organizationId: number) {
  return await adminClient
    .from("organizations")
    .select("id, name, organization_type, membership_scope")
    .eq("id", organizationId)
    .maybeSingle();
}

function parsePositiveInteger(value: unknown, fallback: number, maximum = 100) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function parseRequiredPositiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} is required.`);
  }
  return parsed;
}

function cleanRemovalReason(value: unknown) {
  const reason = cleanText(value, 500);
  if (!reason) {
    throw new Error("Removal reason is required.");
  }
  return reason;
}

function boardPreviewMessage(status: string, context: Record<string, unknown> = {}) {
  const organizationName = cleanText(context.organization_name) || "this organization";
  if (status === "ready") return `Ready to add to ${organizationName}.`;
  if (status === "already_member") {
    return `This student already participates in ${organizationName} for the current academic term.`;
  }
  if (status === "previously_removed") {
    return `This student was previously removed from ${organizationName} for the current academic term. CSV import cannot restore this student.`;
  }
  if (status === "identity_conflict") {
    return "The uploaded identity does not match the existing student record.";
  }
  if (status === "program_mismatch") {
    return `This student's official program is not eligible for ${organizationName}.`;
  }
  if (status === "program_change_requires_super_admin") {
    return "The uploaded program differs from the student's official record. Program changes require Super Admin review.";
  }
  if (status === "not_enrolled_current_term") {
    return "This student is not enrolled in the current academic term.";
  }
  if (status === "new_student_not_in_masterlist") {
    return "This student is not found in the current university masterlist.";
  }
  if (status === "duplicate_csv") return "This Student ID appears more than once in this CSV.";
  return "This row needs review before it can be imported.";
}

function summarizeBoardImportRows(results: Array<Record<string, unknown>>) {
  return results.reduce(
    (summary, row) => {
      const status = cleanText(row.status, 80) || "invalid";
      summary.total += 1;
      summary[status] = (summary[status] || 0) + 1;
      if (!new Set(["ready", "imported", "already_member", "previously_removed"]).has(status)) {
        summary.issues += 1;
      }
      return summary;
    },
    {
      total: 0,
      ready: 0,
      imported: 0,
      already_member: 0,
      previously_removed: 0,
      issues: 0,
    } as Record<string, number>,
  );
}

function normalizeBoardCsvRows(inputRows: unknown) {
  const rows = Array.isArray(inputRows) ? inputRows : [];
  const seenStudentNumbers = new Map<string, number>();

  return rows.map((input, index) => {
    const row = (input || {}) as Record<string, unknown>;
    const rowNumber = Number(row.row_number) || index + 2;
    const studentNumber = cleanText(row.student_number, 80);
    const firstName = cleanText(row.first_name);
    const lastName = cleanText(row.last_name);
    const email = normalizeEmail(row.email);
    const program = normalizeProgram(row.program);
    const normalizedStudentNumber = studentNumber.toLowerCase();
    let yearLevel: number | null = null;
    let invalidMessage = "";

    try {
      yearLevel = parseCollegeYearLevel(row.year_level);
    } catch (error) {
      invalidMessage = error instanceof Error ? error.message : "Enter a valid college year level.";
    }

    if (!studentNumber || !firstName || !lastName || !program) {
      invalidMessage = "Student ID, first name, last name, program, and year level are required.";
    } else if (email && !email.includes("@")) {
      invalidMessage = "Email must be blank or use a valid email format.";
    } else if (normalizedStudentNumber && seenStudentNumbers.has(normalizedStudentNumber)) {
      invalidMessage = boardPreviewMessage("duplicate_csv");
    }

    if (normalizedStudentNumber && !seenStudentNumbers.has(normalizedStudentNumber)) {
      seenStudentNumbers.set(normalizedStudentNumber, rowNumber);
    }

    return {
      row_number: rowNumber,
      student_number: studentNumber,
      first_name: firstName,
      last_name: lastName,
      email,
      program,
      year_level: yearLevel,
      invalid_message: invalidMessage,
    };
  });
}

async function loadActiveTerm(adminClient: ReturnType<typeof createClient>) {
  return await adminClient
    .from("academic_terms")
    .select("id, academic_year, semester, status")
    .eq("status", "active")
    .maybeSingle();
}

function compareBoardStudents(left: Record<string, unknown>, right: Record<string, unknown>, sortBy: string) {
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

async function requireElectoralBoard(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return { response: jsonResponse({ error: "Authentication required.", code: "session_invalid" }, 401) };
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user?.id) {
    return { response: jsonResponse({ error: "Invalid or expired session.", code: "session_invalid" }, 401) };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: adminProfile, error: adminError } = await adminClient
    .from("admin_users")
    .select("id, auth_user_id, full_name, role, status, organization_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (adminError) {
    return { response: jsonResponse({ error: "Unable to verify Electoral Board access." }, 500) };
  }

  if (
    !adminProfile ||
    adminProfile.auth_user_id !== user.id ||
    adminProfile.role !== "electoral_board" ||
    adminProfile.status !== "active" ||
    !adminProfile.organization_id
  ) {
    return {
      response: jsonResponse(
        { error: "Active Electoral Board authorization required.", code: "board_forbidden" },
        403,
      ),
    };
  }

  return { adminClient, user, adminProfile };
}

/**
 * Step-up reauthentication for destructive Board actions.
 *
 * The credential is presented to Supabase Auth (GoTrue) for the ALREADY verified
 * board identity, so the browser never decides whether a password is valid and no
 * custom comparison or plaintext column is involved.
 *
 * The password is held only for the duration of this call: it is never stored,
 * logged, returned, or written to any session store (`persistSession: false`), and
 * the session GoTrue issues is discarded unread.
 */
async function verifyBoardAccountPassword(
  supabaseUrl: string,
  anonKey: string,
  expectedAuthUserId: string,
  boardEmail: string,
  password: string,
) {
  const expectedId = cleanText(expectedAuthUserId, 64);
  if (!expectedId || !boardEmail || !password) return false;

  // Deliberately a clean client: no caller Authorization header and no persisted
  // session, so the only thing presented to GoTrue is the submitted credential.
  const reauthClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  let signInResult: { data?: { user?: { id?: string } | null } | null; error?: unknown };
  try {
    signInResult = await reauthClient.auth.signInWithPassword({ email: boardEmail, password });
  } catch {
    return false;
  }

  if (signInResult?.error) return false;

  // Defence in depth: the verified identity must be the caller's own account.
  return cleanText(signInResult?.data?.user?.id, 64) === expectedId;
}

async function resolveBoardStudentForTerm(
  adminClient: any,
  adminProfile: { organization_id: number },
  studentNumberInput: unknown,
) {
  const studentNumber = cleanText(studentNumberInput, 80);
  const boardOrganizationId = Number(adminProfile.organization_id);
  const { data: activeTermData, error: termError } = await loadActiveTerm(adminClient);
  const activeTerm = activeTermData as {
    id: number;
    academic_year: string;
    semester: string;
    status: string;
  } | null;

  if (termError) {
    return jsonResponse({ error: "Unable to verify the active academic term." }, 500);
  }
  if (!activeTerm?.id) {
    return jsonResponse({ data: { outcome: "INVALID_TERM" } }, 409);
  }

  const { data: boardOrganization, error: boardOrganizationError } = await loadOrganizationContext(
    adminClient, boardOrganizationId,
  );
  if (boardOrganizationError || !boardOrganization?.id) {
    return jsonResponse({ error: "The Board organization could not be verified." }, 500);
  }
  const scopeFailure = organizationScopeFailure(boardOrganization);
  if (scopeFailure) return admissionOutcomeResponse(scopeFailure, boardOrganization.name);

  const { data: students, error: studentError } = await adminClient
    .from("students")
    .select("id, student_number, first_name, last_name, program, year_level, status")
    .eq("student_number", studentNumber)
    .limit(2);

  if (studentError) {
    return jsonResponse({ error: "Unable to resolve the student identity." }, 500);
  }
  if ((students || []).length > 1) {
    return jsonResponse({ data: { outcome: "IDENTITY_RECONCILIATION_REQUIRED" } }, 409);
  }

  const student = students?.[0] || null;
  if (!student) {
    if (!isFiveDigitStudentNumber(studentNumber)) {
      return jsonResponse({ data: { outcome: "INVALID_FORMAT" } }, 400);
    }

    return jsonResponse({
      data: {
        outcome: "STUDENT_IDENTITY_NOT_FOUND",
      },
    });
  }

  const [{ data: enrollment, error: enrollmentError }, { data: participation, error: participationError }] =
    await Promise.all([
      adminClient
        .from("student_term_enrollments")
        .select("program, year_level, enrollment_status, source")
        .eq("student_id", student.id)
        .eq("academic_term_id", activeTerm.id)
        .maybeSingle(),
      adminClient
        .from("student_organization_terms")
        .select("status")
        .eq("student_id", student.id)
        .eq("organization_id", boardOrganizationId)
        .eq("academic_term_id", activeTerm.id)
        .maybeSingle(),
    ]);

  if (enrollmentError || participationError) {
    return jsonResponse({ error: "Unable to verify current-term participation." }, 500);
  }

  const officialProgram = enrollment?.enrollment_status === "enrolled"
    ? normalizeProgram(enrollment.program)
    : normalizeProgram(enrollment?.program || student.program);
  const isCurrentlyEnrolled = enrollment?.enrollment_status === "enrolled";
  const canBeVerifiedForActiveTerm = !enrollment || enrollment.enrollment_status === "not_in_masterlist";
  let organizationOutcome: string;
  let organizationEligible = false;
  if (participation?.status === "active" && isCurrentlyEnrolled) {
    organizationOutcome = "ALREADY_MEMBER";
    organizationEligible = true;
  } else if (!canBeVerifiedForActiveTerm) {
    organizationOutcome = "NOT_CURRENTLY_ENROLLED";
  } else if (boardOrganization.membership_scope === "institution") {
    // Institution membership is established only inside the verified enrollment RPC.
    organizationEligible = true;
    organizationOutcome = isCurrentlyEnrolled ? "ACTIVATION_SYNC_REQUIRED" : "NOT_CURRENTLY_ENROLLED";
  } else if (boardOrganization.membership_scope === "program") {
    const eligibility = await checkProgramScopeEligibility(
      adminClient, boardOrganizationId, officialProgram,
    );
    if (eligibility.error) {
      return jsonResponse({ error: "Organization eligibility could not be verified." }, 500);
    }
    organizationEligible = eligibility.eligible;
    organizationOutcome = organizationEligible
      ? isCurrentlyEnrolled ? "ACTIVATION_SYNC_REQUIRED" : "NOT_CURRENTLY_ENROLLED"
      : "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION";
  } else {
    // Manual-scope Boards may enroll existing identities as part of this same
    // evidence-backed operation; admission is checked again in the transaction.
    organizationEligible = true;
    organizationOutcome = isCurrentlyEnrolled ? "AVAILABLE_FOR_ORGANIZATION" : "NOT_CURRENTLY_ENROLLED";
    if (participation?.status === "removed" && isCurrentlyEnrolled) organizationOutcome = "RESTORATION_REQUIRED";
  }

  const scopedStudent = organizationEligible || participation
    ? {
      student_number: student.student_number,
      first_name: student.first_name,
      last_name: student.last_name,
      program: officialProgram,
      year_level: enrollment?.year_level || student.year_level,
      status: student.status,
    }
    : null;

  return jsonResponse({
    data: {
      outcome: isCurrentlyEnrolled
        ? "ALREADY_ENROLLED_CURRENT_TERM"
        : enrollment?.enrollment_status === "not_in_masterlist"
        ? "EXISTING_STUDENT_NOT_IN_MASTERLIST"
        : "EXISTING_STUDENT_NEW_TERM",
      organization_outcome: organizationOutcome,
      organization_type: boardOrganization.organization_type,
      organization_scope: boardOrganization.membership_scope,
      student: scopedStudent,
      academic_term: activeTerm,
    },
  });
}

async function auditBoardEvent(
  adminClient: any,
  adminProfile: { id: number; full_name: string; organization_id: number },
  event: {
    eventType: string;
    entityType: string;
    entityId?: string | number | null;
    entityLabel: string;
    metadata?: Record<string, unknown>;
  },
) {
  const organizationId = Number(adminProfile.organization_id);
  const { data: organization } = await adminClient
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  const { error } = await adminClient.from("audit_logs").insert({
    user_id: Number(adminProfile.id),
    actor_name: adminProfile.full_name,
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
  if (error) {
    console.error("[board-manual-enrollment] trusted audit write failed", { code: error.code });
    return false;
  }
  return true;
}

async function handleBoardVerifiedRegistration(
  adminClient: ReturnType<typeof createClient>,
  adminProfile: { id: number; full_name: string; organization_id: number },
  body: Record<string, unknown>,
  createIdentity: boolean,
) {
  const student = (body.student || {}) as Record<string, unknown>;
  const studentNumber = cleanText(student.student_number, 80);
  const method = cleanText(body.verification_method, 40);
  if (!isFiveDigitStudentNumber(studentNumber)) {
    return jsonResponse({ data: { outcome: "INVALID_FORMAT" } }, 400);
  }
  if (body.evidence_reviewed !== true || !["school_id", "registration_form", "department_masterlist"].includes(method)) {
    return jsonResponse({ data: { outcome: "ENROLLMENT_EVIDENCE_REVIEW_REQUIRED" } }, 400);
  }
  const yearLevel = Number(student.year_level);
  const firstName = cleanText(student.first_name);
  const lastName = cleanText(student.last_name);
  const program = normalizeProgram(student.program);
  if (!firstName || !lastName || !program || !Number.isInteger(yearLevel) || yearLevel < 1 || yearLevel > 6) {
    return jsonResponse({ data: { outcome: "INVALID_INPUT" } }, 400);
  }
  if (Object.prototype.hasOwnProperty.call(student, "status")) {
    return jsonResponse({ data: { outcome: "CLIENT_STATUS_NOT_ALLOWED" } }, 400);
  }

  const { data, error } = await adminClient.rpc("kandid_board_register_verified_student_for_term_v1", {
    p_actor_admin_id: Number(adminProfile.id),
    p_board_organization_id: Number(adminProfile.organization_id),
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
    if (reason.includes("IDENTITY_RECHECK_REQUIRED")) {
      return jsonResponse({ data: { outcome: "IDENTITY_RECHECK_REQUIRED" } }, 409);
    }
    if (reason.includes("STUDENT_IDENTITY_NOT_FOUND")) {
      return jsonResponse({ data: { outcome: "STUDENT_IDENTITY_NOT_FOUND" } }, 404);
    }
    if (/Program is not a unique configured catalog entry|Program is outside this Board organization coverage/.test(reason)) {
      return jsonResponse({ data: { outcome: "INELIGIBLE" } }, 403);
    }
    if (/authorization required/i.test(reason)) return jsonResponse({ error: "Board authorization could not be verified." }, 403);
    console.error("[board-manual-enrollment] verified registration failed", { code: error.code || "database_error" });
    return jsonResponse({ error: "Verified student registration could not be completed." }, 500);
  }

  const result = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!result?.student_id || !result?.academic_term_id || result.organization_outcome !== "REGISTERED") {
    return jsonResponse({ error: "Verified registration returned an incomplete result." }, 500);
  }
  return jsonResponse({ data: {
    outcome: result.outcome,
    organization_outcome: "REGISTERED",
    student_number: studentNumber,
    student_status: result.student_status || null,
    academic_term: { id: result.academic_term_id },
    verification_method: result.verification_method,
    verified_by_admin_id: result.verified_by_admin_id,
  } });
}

async function handleBatchEnroll(
  adminClient: ReturnType<typeof createClient>,
  adminProfile: { id: number; full_name: string; organization_id: number },
  body: Record<string, unknown>,
) {
  return await handleConfirmBoardCsvImport(adminClient, adminProfile, body);
}
async function previewBoardCsvRows(
  adminClient: ReturnType<typeof createClient>,
  adminProfile: { organization_id: number },
  inputRows: unknown,
) {
  const rows = normalizeBoardCsvRows(inputRows);
  if (rows.length === 0) {
    return { response: jsonResponse({ error: "CSV rows are required." }, 400) };
  }

  const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);
  if (termError) {
    return { response: jsonResponse({ error: "Unable to verify the active academic term." }, 500) };
  }

  if (!activeTerm?.id) {
    return { response: jsonResponse({ error: "Board CSV import requires an active academic term." }, 409) };
  }

  const boardOrganizationId = Number(adminProfile.organization_id);
  const { data: organization, error: organizationError } = await loadOrganizationContext(
    adminClient, boardOrganizationId,
  );
  if (organizationError || !organization?.id) {
    return { response: jsonResponse({ error: "The Board organization could not be verified." }, 500) };
  }
  const scopeFailure = organizationScopeFailure(organization);
  if (scopeFailure) return { response: admissionOutcomeResponse(scopeFailure, organization.name) };
  const organizationName = organization?.name || "this organization";
  const { data: programCatalog, error: catalogError } = await adminClient
    .from("programs")
    .select("id, code, name")
    .limit(1000);
  if (catalogError) return { response: jsonResponse({ error: "Program eligibility could not be verified." }, 500) };
  let coveredProgramIds: number[] | null = null;
  if (organization.membership_scope === "program") {
    const { data: links, error: linksError } = await adminClient
      .from("organization_programs")
      .select("program_id")
      .eq("organization_id", boardOrganizationId);
    if (linksError) return { response: jsonResponse({ error: "Program eligibility could not be verified." }, 500) };
    coveredProgramIds = (links || []).map((link) => Number(link.program_id));
  }
  const results: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const baseResult = {
      row_number: row.row_number,
      student_number: row.student_number,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      program: row.program,
      year_level: row.year_level,
    };

    if (row.invalid_message) {
      results.push({
        ...baseResult,
        status: row.invalid_message === boardPreviewMessage("duplicate_csv") ? "duplicate_csv" : "invalid",
        message: row.invalid_message,
      });
      continue;
    }

    const matchingPrograms = (programCatalog || []).filter((entry) =>
      sameProgram(entry.code, row.program) || sameProgram(entry.name, row.program));
    if (matchingPrograms.length !== 1 ||
        (coveredProgramIds && !coveredProgramIds.includes(Number(matchingPrograms[0]?.id)))) {
      results.push({
        ...baseResult,
        status: "program_mismatch",
        message: coveredProgramIds
          ? "Program must be a unique catalog entry covered by this Board."
          : "Program must be a unique configured catalog entry.",
      });
      continue;
    }

    const { data: matchingStudents, error: studentError } = await adminClient
      .from("students")
      .select("id, student_number, first_name, last_name, email, program, year_level, status")
      .eq("student_number", row.student_number)
      .limit(2);

    if (studentError) {
      results.push({
        ...baseResult,
        status: "invalid",
        message: "Unable to verify the central student record.",
      });
      continue;
    }

    if ((matchingStudents || []).length > 1) {
      results.push({
        ...baseResult,
        status: "identity_conflict",
        message: `Multiple central student records use Student ID ${row.student_number}.`,
      });
      continue;
    }

    const student = matchingStudents?.[0] || null;
    if (!student?.id) {
      results.push({
        ...baseResult,
        status: "ready",
        message: `New student identity and active-term enrollment will be created for ${organizationName} after the official masterlist confirmation.`,
        student_id: null,
      });
      continue;
    }

    const identityCorrection = !sameText(student.first_name, row.first_name)
      || !sameText(student.last_name, row.last_name);

    const { data: enrollment, error: enrollmentError } = await adminClient
      .from("student_term_enrollments")
      .select("id, student_id, program, year_level, enrollment_status, source")
      .eq("student_id", student.id)
      .eq("academic_term_id", activeTerm.id)
      .maybeSingle();

    if (enrollmentError) {
      results.push({
        ...baseResult,
        student_id: student.id,
        status: "invalid",
        message: "Unable to verify current-term enrollment.",
      });
      continue;
    }

    const officialProgram = normalizeProgram(enrollment?.program || student.program);
    const { data: participation, error: participationLookupError } = await adminClient
      .from("student_organization_terms")
      .select("id, status, source, removal_reason, removed_at")
      .eq("student_id", student.id)
      .eq("organization_id", boardOrganizationId)
      .eq("academic_term_id", activeTerm.id)
      .maybeSingle();

    if (participationLookupError) {
      results.push({
        ...baseResult,
        student_id: student.id,
        status: "invalid",
        message: "Unable to verify current-term organization participation.",
      });
      continue;
    }

    if (participation?.status === "removed" && participation.removal_reason !== "program_change_reconciliation") {
      results.push({
        ...baseResult,
        student_id: student.id,
        status: "previously_removed",
        message: boardPreviewMessage("previously_removed", { organization_name: organizationName }),
        removal_reason: participation.removal_reason,
        removed_at: participation.removed_at,
      });
      continue;
    }

    const enrollmentMatchesImport = enrollment?.enrollment_status === "enrolled"
      && sameProgram(enrollment.program, row.program)
      && Number(enrollment.year_level) === Number(row.year_level);
    if (participation?.status === "active" && enrollmentMatchesImport) {
      results.push({
        ...baseResult,
        student_id: student.id,
        status: "already_member",
        message: boardPreviewMessage("already_member", { organization_name: organizationName }),
      });
      continue;
    }

    results.push({
      ...baseResult,
      student_id: student.id,
      status: "ready",
      message: identityCorrection
        ? `Official masterlist details differ from the existing identity. Review the correction before confirming enrollment for ${organizationName}.`
        : `Official enrollment evidence will register or update this student's active-term record for ${organizationName}.`,
      identity_correction: identityCorrection,
      ...(identityCorrection ? { official: {
        first_name: student.first_name,
        last_name: student.last_name,
        program: student.program,
        year_level: student.year_level,
      } } : {}),
      official_program: officialProgram,
    });
  }

  return {
    data: {
      academic_term: activeTerm,
      board_organization_id: boardOrganizationId,
      organization_name: organizationName,
      organization_type: organization.organization_type,
      results,
      summary: summarizeBoardImportRows(results),
    },
  };
}

async function handlePreviewBoardCsvImport(
  adminClient: ReturnType<typeof createClient>,
  adminProfile: { organization_id: number },
  body: Record<string, unknown>,
) {
  const preview = await previewBoardCsvRows(adminClient, adminProfile, body.rows);
  if ("response" in preview) return preview.response;
  return jsonResponse({ data: preview.data });
}

async function handleConfirmBoardCsvImport(
  adminClient: ReturnType<typeof createClient>,
  adminProfile: { id: number; full_name: string; organization_id: number },
  body: Record<string, unknown>,
) {
  if (body.evidence_reviewed !== true) {
    return jsonResponse({ data: { outcome: "ENROLLMENT_EVIDENCE_REVIEW_REQUIRED" } }, 400);
  }
  const preview = await previewBoardCsvRows(adminClient, adminProfile, body.rows);
  if ("response" in preview) return preview.response;

  const readyRows = (preview.data.results || []).filter((row) => row.status === "ready");
  const committedRows: Array<Record<string, unknown>> = [];
  const skippedRows = (preview.data.results || []).filter((row) => row.status !== "ready");

  for (const row of readyRows) {
    const registrationResponse = await handleBoardVerifiedRegistration(adminClient, adminProfile, {
      evidence_reviewed: true,
      verification_method: "department_masterlist",
      student: {
        student_number: row.student_number,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        program: row.program,
        year_level: row.year_level,
      },
    }, !row.student_id);
    const registrationPayload = await registrationResponse.clone().json().catch(() => null);
    if (!registrationResponse.ok || registrationPayload?.data?.organization_outcome !== "REGISTERED") {
      skippedRows.push({
        ...row,
        status: "not_imported",
        message: "This row could not be imported after final validation.",
      });
      continue;
    }

    committedRows.push({
      ...row,
      status: "imported",
      message: `Student identity and verified enrollment registered for ${preview.data.organization_name}.`,
    });
  }

  const results = [...committedRows, ...skippedRows].sort(
    (left, right) => Number(left.row_number) - Number(right.row_number),
  );
  const summary = {
    ...summarizeBoardImportRows(results),
    imported: committedRows.filter((row) => row.status === "imported").length,
    committed: committedRows.length,
    skipped: skippedRows.length,
  };

  if (summary.imported > 0) {
    const auditRecorded = await auditBoardEvent(adminClient, adminProfile, {
      eventType: "student_batch_imported",
      entityType: "student_import",
      entityLabel: "Board CSV import",
      metadata: {
        imported_count: summary.imported,
        committed_count: summary.committed,
        skipped_count: summary.skipped,
      },
    });
    if (!auditRecorded) {
      return jsonResponse({
        error: "Import completed, but its audit record could not be saved. Refresh before retrying.",
        code: "audit_record_failed",
        data: { imported_count: summary.imported, committed_count: summary.committed },
      }, 500);
    }
  }

  return jsonResponse({
    data: {
      academic_term: preview.data.academic_term,
      board_organization_id: preview.data.board_organization_id,
      organization_name: preview.data.organization_name,
      organization_type: preview.data.organization_type,
      results,
      committed_rows: committedRows,
      skipped_rows: skippedRows,
      summary,
    },
  });
}

async function handleListStudents(
  adminClient: ReturnType<typeof createClient>,
  adminProfile: { organization_id: number },
  body: Record<string, unknown>,
) {
  const page = parsePositiveInteger(body.page, 1, 10000);
  const pageSize = parsePositiveInteger(body.page_size ?? body.pageSize, 10, 100);
  const search = cleanText(body.search, 120).toLowerCase();
  const sortBy = cleanText(body.sort_by ?? body.sortBy, 40) || "newest";
  const statusFilter = cleanText(body.status, 40) === "removed" ? "removed" : "active";
  const boardOrganizationId = Number(adminProfile.organization_id);

  const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);
  if (termError) {
    return jsonResponse({ error: "Unable to verify the active academic term." }, 500);
  }

  if (!activeTerm?.id) {
    return jsonResponse({ error: "Board student listing requires an active academic term." }, 409);
  }

  const { data: organization, error: organizationError } = await loadOrganizationContext(
    adminClient,
    boardOrganizationId,
  );
  if (organizationError || !organization?.id) {
    return jsonResponse({ error: "The Board organization could not be verified." }, 500);
  }

  const { data: termParticipations, error: participationError } = await adminClient
    .from("student_organization_terms")
    .select("student_id, organization_id, source")
    .eq("academic_term_id", activeTerm.id)
    .eq("organization_id", boardOrganizationId)
    .eq("status", statusFilter);

  if (participationError) {
    console.error("[board-manual-enrollment] board term participation listing failed", {
      code: participationError.code,
      message: participationError.message,
    });
    return jsonResponse({ error: "Unable to load organization participation." }, 500);
  }

  const participationsByStudentId = new Map(
    (termParticipations || [])
      .filter((participation) => participation.student_id)
      .map((participation) => [Number(participation.student_id), participation]),
  );
  const memberStudentIds = [...participationsByStudentId.keys()];

  if (memberStudentIds.length === 0) {
    return jsonResponse({
      data: {
        students: [],
        count: 0,
        page,
        page_size: pageSize,
        academic_term: activeTerm,
        board_organization_id: boardOrganizationId,
        organization_type: organization.organization_type,
      },
    });
  }

  const { data: enrollments, error: enrollmentError } = await adminClient
    .from("student_term_enrollments")
    .select("student_id, academic_term_id, program, year_level, enrollment_status, source, created_at")
    .eq("academic_term_id", activeTerm.id)
    .eq("enrollment_status", "enrolled")
    .in("student_id", memberStudentIds);

  if (enrollmentError) {
    console.error("[board-manual-enrollment] board active-term enrollment listing failed", {
      code: enrollmentError.code,
      message: enrollmentError.message,
    });
    return jsonResponse({ error: "Unable to load active-term enrollments." }, 500);
  }

  const enrolledStudentIds = [
    ...new Set((enrollments || []).map((enrollment) => Number(enrollment.student_id)).filter(Boolean)),
  ];

  if (enrolledStudentIds.length === 0) {
    return jsonResponse({
      data: {
        students: [],
        count: 0,
        page,
        page_size: pageSize,
        academic_term: activeTerm,
        board_organization_id: boardOrganizationId,
        organization_type: organization.organization_type,
      },
    });
  }

  const { data: students, error: studentError } = await adminClient
    .from("students")
    .select("id, student_number, first_name, last_name, email, photo_url, status, created_at")
    .in("id", enrolledStudentIds);

  if (studentError) {
    console.error("[board-manual-enrollment] board student listing failed", {
      code: studentError.code,
      message: studentError.message,
    });
    return jsonResponse({ error: "Unable to load students." }, 500);
  }

  const studentsById = new Map((students || []).map((student) => [Number(student.id), student]));
  const list = (enrollments || [])
    .map((enrollment) => {
      const student = studentsById.get(Number(enrollment.student_id));
      const participation = participationsByStudentId.get(Number(enrollment.student_id));
      if (!student || !participation) return null;

      return {
        id: student.id,
        student_number: student.student_number,
        first_name: student.first_name,
        last_name: student.last_name,
        email: student.email,
        photo_url: student.photo_url,
        program: enrollment.program,
        year_level: enrollment.year_level,
        status: student.status,
        created_at: student.created_at,
        membership_status: statusFilter,
        membership_role: "member",
        membership_source: participation.source,
        enrollment_status: enrollment.enrollment_status,
        enrollment_source: enrollment.source,
        academic_term_id: enrollment.academic_term_id,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  const filtered = search
    ? list.filter((student) => {
      const haystack = [
        student.student_number,
        student.first_name,
        student.last_name,
        student.email,
        student.program,
      ]
        .map((value) => cleanText(value).toLowerCase())
        .join(" ");
      return haystack.includes(search);
    })
    : list;

  filtered.sort((left, right) => compareBoardStudents(left, right, sortBy));

  const count = filtered.length;
  const from = (page - 1) * pageSize;
  let pagedStudents = filtered.slice(from, from + pageSize);

  return jsonResponse({
    data: {
      students: pagedStudents,
      count,
      page,
      page_size: pageSize,
      academic_term: activeTerm,
      board_organization_id: boardOrganizationId,
      organization_type: organization.organization_type,
    },
  });
}

async function handleListRemovedStudents(
  adminClient: ReturnType<typeof createClient>,
  adminProfile: { organization_id: number },
  body: Record<string, unknown>,
) {
  const page = parsePositiveInteger(body.page, 1, 10000);
  const pageSize = parsePositiveInteger(body.page_size ?? body.pageSize, 10, 100);
  const search = cleanText(body.search, 120).toLowerCase();
  const sortBy = cleanText(body.sort_by ?? body.sortBy, 40) || "newest";
  const boardOrganizationId = Number(adminProfile.organization_id);

  const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);
  if (termError) {
    return jsonResponse({ error: "Unable to verify the active academic term." }, 500);
  }

  if (!activeTerm?.id) {
    return jsonResponse({ error: "Removed student listing requires an active academic term." }, 409);
  }

  const { data: removedParticipations, error: participationError } = await adminClient
    .from("student_organization_terms")
    .select("id, student_id, organization_id, source, removal_reason, removed_at, academic_term_id")
    .eq("academic_term_id", activeTerm.id)
    .eq("organization_id", boardOrganizationId)
    .eq("status", "removed");

  if (participationError) {
    console.error("[board-manual-enrollment] board removed participation listing failed", {
      code: participationError.code,
      message: participationError.message,
    });
    return jsonResponse({ error: "Unable to load removed students." }, 500);
  }

  const removedStudentIds = [
    ...new Set((removedParticipations || []).map((row) => Number(row.student_id)).filter(Boolean)),
  ];

  if (removedStudentIds.length === 0) {
    return jsonResponse({
      data: {
        students: [],
        count: 0,
        page,
        page_size: pageSize,
        academic_term: activeTerm,
        board_organization_id: boardOrganizationId,
      },
    });
  }

  const [{ data: enrollments, error: enrollmentError }, { data: students, error: studentError }] =
    await Promise.all([
      adminClient
        .from("student_term_enrollments")
        .select("student_id, academic_term_id, program, year_level, enrollment_status, source")
        .eq("academic_term_id", activeTerm.id)
        .in("student_id", removedStudentIds),
      adminClient
        .from("students")
        .select("id, student_number, first_name, last_name, email, photo_url, status, created_at")
        .in("id", removedStudentIds),
    ]);

  if (enrollmentError) {
    console.error("[board-manual-enrollment] board removed enrollment listing failed", {
      code: enrollmentError.code,
      message: enrollmentError.message,
    });
    return jsonResponse({ error: "Unable to load removed student enrollments." }, 500);
  }

  if (studentError) {
    console.error("[board-manual-enrollment] board removed student listing failed", {
      code: studentError.code,
      message: studentError.message,
    });
    return jsonResponse({ error: "Unable to load removed students." }, 500);
  }

  const enrollmentsByStudentId = new Map(
    (enrollments || []).map((enrollment) => [Number(enrollment.student_id), enrollment]),
  );
  const studentsById = new Map((students || []).map((student) => [Number(student.id), student]));
  const list = (removedParticipations || [])
    .map((participation) => {
      const student = studentsById.get(Number(participation.student_id));
      const enrollment = enrollmentsByStudentId.get(Number(participation.student_id));
      if (!student) return null;

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
        membership_status: "removed",
        membership_role: "member",
        membership_source: participation.source,
        enrollment_status: enrollment?.enrollment_status || null,
        enrollment_source: enrollment?.source || null,
        academic_term_id: participation.academic_term_id,
        removal_reason: participation.removal_reason,
        removed_at: participation.removed_at,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  const filtered = search
    ? list.filter((student) => {
      const haystack = [
        student.student_number,
        student.first_name,
        student.last_name,
        student.email,
        student.program,
        student.removal_reason,
      ]
        .map((value) => cleanText(value).toLowerCase())
        .join(" ");
      return haystack.includes(search);
    })
    : list;

  filtered.sort((left, right) => compareBoardStudents(left, right, sortBy));

  const count = filtered.length;
  const from = (page - 1) * pageSize;
  const pagedStudents = filtered.slice(from, from + pageSize);

  return jsonResponse({
    data: {
      students: pagedStudents,
      count,
      page,
      page_size: pageSize,
      academic_term: activeTerm,
      board_organization_id: boardOrganizationId,
    },
  });
}

const REMOVAL_REAUTH_FIELDS = [
  "action",
  "student_id",
  "studentId",
  "reason",
  "confirm_student_number",
  "confirmStudentNumber",
  "password",
];

// Only Kandid-authored participation messages may reach the browser. Anything else
// (Postgres text, auth internals, identifiers) is replaced with a generic message.
const SAFE_PARTICIPATION_MESSAGES = new Set([
  "Invalid participation request.",
  "Unsupported participation action.",
  "Removal reason is required.",
  "No active academic term is available.",
  "Student not found.",
  "Organization not found.",
  "Student is not enrolled for the active academic term.",
  "Student does not have current-term participation in this organization.",
]);

function safeParticipationError(message: unknown, fallback: string) {
  const text = cleanText(message, 300);
  return SAFE_PARTICIPATION_MESSAGES.has(text) ? text : fallback;
}

/**
 * Server-side gate that must pass before any removal mutation runs.
 *
 * Order mirrors the required control order: the target participation is resolved
 * using the caller's own organization and the active term, the submitted Student ID
 * is compared against that already-selected target (never used to select one), and
 * only then is the acting board account reauthenticated.
 *
 * Returns `null` when every check passes, otherwise a ready-to-return Response.
 */
async function verifyRemovalReauthentication(
  context: {
    adminClient: ReturnType<typeof createClient>;
    adminProfile: { organization_id: number };
    user: { id: string; email?: string | null };
    supabaseUrl: string;
    anonKey: string;
  },
  body: Record<string, unknown>,
  studentId: number,
) {
  const { adminClient, adminProfile, user, supabaseUrl, anonKey } = context;

  // 1. Resolve the exact target participation using trusted org + active term scope.
  const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);
  if (termError) {
    return jsonResponse({ error: "The active academic term could not be verified." }, 500);
  }
  if (!activeTerm?.id) {
    return jsonResponse({ error: "An active academic term is required to remove a student." }, 409);
  }

  const [{ data: targetStudent, error: targetError }, { data: participation, error: participationError }] =
    await Promise.all([
      adminClient
        .from("students")
        .select("id, student_number")
        .eq("id", studentId)
        .maybeSingle(),
      adminClient
        .from("student_organization_terms")
        .select("id, status")
        .eq("student_id", studentId)
        .eq("organization_id", Number(adminProfile.organization_id))
        .eq("academic_term_id", activeTerm.id)
        .maybeSingle(),
    ]);

  if (targetError || participationError) {
    return jsonResponse({ error: "The selected student could not be verified." }, 500);
  }
  if (!targetStudent) {
    return jsonResponse({ error: "The selected student is no longer available." }, 409);
  }
  if (!participation) {
    return jsonResponse(
      { error: "This student is not a current-term participant in your organization.", code: "target_out_of_scope" },
      403,
    );
  }

  // 2. Bind the typed Student ID to the target the Board member already selected.
  //    It is only ever compared, never used to look up or switch the target.
  const submittedStudentNumber = cleanText(body.confirm_student_number ?? body.confirmStudentNumber, 80);
  if (!submittedStudentNumber) {
    return jsonResponse(
      { error: "Enter the student's ID to confirm this removal.", code: "confirmation_required" },
      400,
    );
  }
  if (submittedStudentNumber !== cleanText(targetStudent.student_number, 80)) {
    return jsonResponse(
      { error: "The Student ID does not match the selected student.", code: "student_id_mismatch" },
      400,
    );
  }

  // 3. Reauthenticate the CURRENT authenticated board account.
  const boardEmail = normalizeEmail(user?.email);
  if (!boardEmail) {
    return jsonResponse(
      {
        error: "Your account cannot be verified for this action. Sign in again before removing this student.",
        code: "session_invalid",
      },
      401,
    );
  }

  const password = typeof body.password === "string" ? body.password : "";
  const passwordVerified = password
    ? await verifyBoardAccountPassword(supabaseUrl, anonKey, user.id, boardEmail, password)
    : false;
  if (!passwordVerified) {
    return jsonResponse({ error: "Your password could not be verified.", code: "password_invalid" }, 401);
  }

  return null;
}

async function handleParticipationAction(
  context: {
    adminClient: ReturnType<typeof createClient>;
    adminProfile: { id: number; full_name: string; organization_id: number };
    user: { id: string; email?: string | null };
    supabaseUrl: string;
    anonKey: string;
  },
  body: Record<string, unknown>,
  action: "remove" | "restore",
) {
  const { adminClient, adminProfile } = context;
  let studentId: number;
  let reason: string | null = null;

  if (action === "remove") {
    const unexpectedField = Object.keys(body).find((field) => !REMOVAL_REAUTH_FIELDS.includes(field));
    if (unexpectedField) {
      return jsonResponse({ error: "Unsupported removal request field." }, 400);
    }
  }

  try {
    studentId = parseRequiredPositiveInteger(body.student_id ?? body.studentId, "Student");
    if (action === "remove") {
      reason = cleanRemovalReason(body.reason);
    }
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Invalid participation request." },
      400,
    );
  }

  const { data: organization, error: organizationError } = await loadOrganizationContext(
    adminClient, Number(adminProfile.organization_id),
  );
  if (organizationError || !organization?.id) {
    return jsonResponse({ error: "The Board organization could not be verified." }, 500);
  }
  const scopeFailure = organizationScopeFailure(organization);
  if (scopeFailure) return admissionOutcomeResponse(scopeFailure, organization.name);
  if (organization.membership_scope !== "manual") {
    return admissionOutcomeResponse(
      organization.membership_scope ? "ACTIVATION_SYNC_REQUIRED" : "UNSUPPORTED_MEMBERSHIP_SCOPE",
      organization.name,
    );
  }

  if (action === "remove") {
    const rejection = await verifyRemovalReauthentication(context, body, studentId);
    if (rejection) return rejection;
  } else {
    const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);
    if (termError || !activeTerm?.id) {
      return jsonResponse({ error: "Membership could not be verified for the current academic term." }, 409);
    }
    const { admission, error: admissionError } = await checkOrganizationAdmission(
      adminClient,
      studentId,
      Number(adminProfile.organization_id),
      Number(activeTerm.id),
    );
    if (admissionError || !admission) {
      return jsonResponse({ error: "Organization membership could not be verified. Try again." }, 500);
    }
    if (!admission.allowed) {
      return admissionOutcomeResponse(admission.reason);
    }
  }

  const { data, error } = await adminClient.rpc("board_update_student_participation", {
    target_student_id: studentId,
    target_organization_id: Number(adminProfile.organization_id),
    actor_admin_id: Number(adminProfile.id),
    target_action: action,
    target_reason: reason,
  });

  if (error) {
    const admissionReason = decodeMembershipAdmissionReason(error);
    if (action === "restore" && admissionReason) {
      return admissionOutcomeResponse(admissionReason);
    }
    return jsonResponse(
      {
        error: safeParticipationError(
          error.message,
          "Student organization participation could not be updated.",
        ),
      },
      400,
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (row && !row.already_applied) {
    const auditRecorded = await auditBoardEvent(adminClient, adminProfile, {
      eventType: action === "remove" ? "membership_removed" : "membership_restored",
      entityType: "student_organization",
      entityId: studentId,
      entityLabel: "Organization participation",
      metadata: {
        academic_term_id: row.academic_term_id || null,
      },
    });
    if (!auditRecorded) {
      return jsonResponse({
        error: `Participation was ${action === "remove" ? "removed" : "restored"}, but its audit record could not be saved. Refresh before retrying.`,
        code: "audit_record_failed",
      }, 500);
    }
  }
  return jsonResponse({
    data: {
      result: row || null,
      already_applied: Boolean(row?.already_applied),
    },
  });
}

async function handleUpdateStudentNames(
  adminClient: ReturnType<typeof createClient>,
  adminProfile: { id: number; full_name: string; organization_id: number },
  body: Record<string, unknown>,
) {
  if (Object.keys(body).some((field) => !["action", "student_id", "changes"].includes(field))) {
    return jsonResponse({ error: "Unsupported student edit field." }, 400);
  }
  const changes = body.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    return jsonResponse({ error: "Enter the student's first and last name." }, 400);
  }

  const fields = Object.keys(changes);
  if (fields.length !== 2 || !fields.includes("first_name") || !fields.includes("last_name")) {
    return jsonResponse({ error: "Only first and last name may be edited here." }, 400);
  }

  const names = changes as Record<string, unknown>;
  if (typeof names.first_name !== "string" || typeof names.last_name !== "string") {
    return jsonResponse({ error: "Enter a valid first and last name." }, 400);
  }
  const firstName = names.first_name.trim();
  const lastName = names.last_name.trim();
  if (
    !firstName || !lastName || firstName.length > 100 || lastName.length > 100 ||
    /[\u0000-\u001f\u007f]/.test(firstName) || /[\u0000-\u001f\u007f]/.test(lastName)
  ) {
    return jsonResponse({ error: "First and last name must each be 1–100 characters." }, 400);
  }

  let studentId: number;
  try {
    studentId = parseRequiredPositiveInteger(body.student_id, "Student");
  } catch {
    return jsonResponse({ error: "Invalid student request." }, 400);
  }

  const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);
  if (termError || !activeTerm?.id) {
    return jsonResponse({ error: "An active academic term is required to edit this record." }, 409);
  }
  const { data: organization, error: organizationError } = await loadOrganizationContext(
    adminClient, Number(adminProfile.organization_id),
  );
  if (organizationError || !organization?.id) {
    return jsonResponse({ error: "The Board organization could not be verified." }, 500);
  }
  const scopeFailure = organizationScopeFailure(organization);
  if (scopeFailure) return admissionOutcomeResponse(scopeFailure, organization.name);

  const [{ data: participation, error: participationError }, { data: enrollment, error: enrollmentError }] =
    await Promise.all([
      adminClient.from("student_organization_terms")
        .select("student_id")
        .eq("student_id", studentId)
        .eq("organization_id", Number(adminProfile.organization_id))
        .eq("academic_term_id", activeTerm.id)
        .eq("status", "active")
        .maybeSingle(),
      adminClient.from("student_term_enrollments")
        .select("student_id, program")
        .eq("student_id", studentId)
        .eq("academic_term_id", activeTerm.id)
        .eq("enrollment_status", "enrolled")
        .maybeSingle(),
    ]);

  if (participationError || enrollmentError) {
    return jsonResponse({ error: "Student edit access could not be verified." }, 500);
  }
  if (!participation || !enrollment) {
    return jsonResponse({ error: "This student is not available for editing in your current register." }, 403);
  }
  if (organization.membership_scope === "program") {
    const coverage = await checkProgramScopeEligibility(
      adminClient, Number(adminProfile.organization_id), enrollment.program,
    );
    if (coverage.error) return jsonResponse({ error: "Board program coverage could not be verified." }, 500);
    if (!coverage.eligible) return jsonResponse({ error: "This student is outside your configured program coverage." }, 403);
  }

  const { data: student, error: updateError } = await adminClient.from("students")
    .update({ first_name: firstName, last_name: lastName })
    .eq("id", studentId)
    .select("id, first_name, last_name")
    .maybeSingle();

  if (updateError || !student) {
    return jsonResponse({ error: "Student names could not be saved. Try again." }, 500);
  }

  const auditRecorded = await auditBoardEvent(adminClient, adminProfile, {
    eventType: "student_identity_updated",
    entityType: "student",
    entityId: student.id,
    entityLabel: "Student identity",
    metadata: { changed_fields: ["first_name", "last_name"], academic_term_id: activeTerm.id },
  });
  if (!auditRecorded) {
    return jsonResponse({ error: "Student names were saved, but the audit record could not be saved. Refresh before retrying.", code: "audit_record_failed" }, 500);
  }

  return jsonResponse({ data: student });
}

serveWithKandidCors(async (request) => {
  const preflightResponse = handleCorsPreflight(request);
  if (preflightResponse) return preflightResponse;

  const originRejection = rejectDisallowedOrigin(request);
  if (originRejection) return originRejection;

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Server configuration is incomplete." }, 500);
  }

  const auth = await requireElectoralBoard(request, supabaseUrl, anonKey, serviceRoleKey);
  if ("response" in auth) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const action = cleanText(body.action, 80);
  if (action === "resolve_student_for_term") {
    return await resolveBoardStudentForTerm(auth.adminClient, auth.adminProfile, body.student_number);
  }

  if (action === "create_new_student_for_term") {
    return await handleBoardVerifiedRegistration(auth.adminClient, auth.adminProfile, body, true);
  }

  if (action === "enroll_existing_student_for_term") {
    return await handleBoardVerifiedRegistration(auth.adminClient, auth.adminProfile, body, false);
  }

  if (action === "list_students") {
    return await handleListStudents(auth.adminClient, auth.adminProfile, body);
  }

  if (action === "list_removed_students") {
    return await handleListRemovedStudents(auth.adminClient, auth.adminProfile, body);
  }

  const participationContext = {
    adminClient: auth.adminClient,
    adminProfile: auth.adminProfile,
    user: auth.user,
    supabaseUrl,
    anonKey,
  };

  if (action === "remove_student_participation") {
    return await handleParticipationAction(participationContext, body, "remove");
  }

  if (action === "restore_student_participation") {
    return await handleParticipationAction(participationContext, body, "restore");
  }

  if (action === "update_student_names") {
    return await handleUpdateStudentNames(auth.adminClient, auth.adminProfile, body);
  }

  if (action === "preview_board_csv_import") {
    return await handlePreviewBoardCsvImport(auth.adminClient, auth.adminProfile, body);
  }

  if (action === "confirm_board_csv_import") {
    return await handleConfirmBoardCsvImport(auth.adminClient, auth.adminProfile, body);
  }

  if (action === "batch_enroll") {
    return await handleBatchEnroll(auth.adminClient, auth.adminProfile, body);
  }

  if (action) {
    return jsonResponse({ error: "Unsupported Board student management action." }, 400);
  }
  return jsonResponse({ error: "An explicit Board student management action is required." }, 400);

});
