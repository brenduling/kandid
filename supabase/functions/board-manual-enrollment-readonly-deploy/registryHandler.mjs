import { handleCorsPreflight, rejectDisallowedOrigin } from "./kandidRegistryCors.mjs";

const READ_ACTIONS = new Set(["list_students", "list_removed_students", "resolve_student_for_term"]);
const REGISTRY_BODY_FIELDS = new Set([
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
  const officialProgram = isCurrentlyEnrolled ? cleanText(enrollment.program, 80).toUpperCase() : "";
  let organizationOutcome;
  let organizationEligible = false;
  if (!isCurrentlyEnrolled) {
    organizationOutcome = "NOT_CURRENTLY_ENROLLED";
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

  return response({ data: {
    outcome: isCurrentlyEnrolled
      ? "ALREADY_ENROLLED_CURRENT_TERM"
      : enrollment?.enrollment_status === "not_in_masterlist"
        ? "EXISTING_STUDENT_NOT_IN_MASTERLIST"
        : "EXISTING_STUDENT_NEW_TERM",
    organization_outcome: organizationOutcome,
    organization_type: organization.organization_type,
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

export function createReadOnlyRegistryHandler({ createClient, getEnv }) {
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
      .select("auth_user_id, role, status, organization_id")
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
    if (!READ_ACTIONS.has(action)) return response({ error: "This endpoint is read-only; action is not allowed." }, 403);

    if (action === "resolve_student_for_term") {
      if (Object.keys(body).some((field) => !["action", "student_number"].includes(field))) {
        return response({ error: "Unsupported Student ID lookup field." }, 400);
      }
      return await resolveBoardStudentForTerm(adminClient, profile, body.student_number);
    }

    if (Object.keys(body).some((field) => !REGISTRY_BODY_FIELDS.has(field))) {
      return response({ error: "Unsupported registry request field." }, 400);
    }
    if (body.organization_id !== undefined && Number(body.organization_id) !== Number(profile.organization_id)) {
      return response({ error: "Organization is outside your assignment." }, 403);
    }
    return await loadStudents(adminClient, profile, body, action === "list_removed_students");
  };
}
