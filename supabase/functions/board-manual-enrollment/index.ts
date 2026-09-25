import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REQUIRED_STUDENT_ORGANIZATION_NAMES = [
  "WITSG",
  "WIT-SG",
  "WIT SG",
  "Western Institute of Technology Student Government",
];

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
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

function parseYearLevel(value: unknown) {
  const yearLevel = Number(value);
  if (!Number.isInteger(yearLevel) || yearLevel <= 0 || yearLevel > 12) {
    throw new Error("Enter a valid year level.");
  }
  return yearLevel;
}

function parseTermEnrollmentYearLevel(value: unknown) {
  const yearLevel = Number(value);
  if (!Number.isInteger(yearLevel) || yearLevel < 1 || yearLevel > 6) {
    throw new Error("Enter a valid year level.");
  }
  return yearLevel;
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

function sameStudentIdentity(student: Record<string, unknown>, row: Record<string, unknown>) {
  return sameText(student.first_name, row.first_name) && sameText(student.last_name, row.last_name);
}

function cleanOptionalStudentStatus(value: unknown) {
  const status = cleanText(value, 40);
  return ["active", "pending", "inactive"].includes(status) ? status : null;
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

function sanitizeEnrollmentError(error: { code?: string; message?: string } | null) {
  if (!error) return "Student registration could not be completed.";

  const message = String(error.message || "").toLowerCase();
  if (error.code === "23505" || message.includes("duplicate")) {
    return "A student record with these details already exists.";
  }
  if (message.includes("active academic term") || message.includes("academic term")) {
    return "Manual registration requires an active academic term.";
  }
  if (message.includes("email")) return "Enter a valid student email address.";
  if (message.includes("student")) return "Student registration could not be completed.";

  return "Student registration could not be completed.";
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
      if (status === "ready") summary.ready += 1;
      else if (status === "imported") summary.imported += 1;
      else if (status === "already_member") summary.already_member += 1;
      else if (status === "previously_removed") summary.previously_removed += 1;
      else summary.issues += 1;
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

async function ensureProgram(adminClient: ReturnType<typeof createClient>, program: string) {
  if (!program) return null;

  const { data, error } = await adminClient
    .from("programs")
    .upsert(
      {
        code: program,
        name: program,
      },
      { onConflict: "code" },
    )
    .select("id")
    .single();

  if (error) return null;
  return data?.id || null;
}

async function resolveMembershipOrganizationIds(
  adminClient: ReturnType<typeof createClient>,
  program: string,
  boardOrganizationId: number,
) {
  const { data: requiredOrganizations } = await adminClient
    .from("organizations")
    .select("id")
    .in("name", REQUIRED_STUDENT_ORGANIZATION_NAMES);

  const programId = await ensureProgram(adminClient, program);
  const { data: programOrganizations } = programId
    ? await adminClient
      .from("organization_programs")
      .select("organization_id")
      .eq("program_id", programId)
    : { data: [] };

  return [
    ...new Set(
      [
        boardOrganizationId,
        ...(requiredOrganizations || []).map((organization) => organization.id),
        ...(programOrganizations || []).map((link) => link.organization_id),
      ]
        .map((id) => Number(id))
        .filter(Boolean),
    ),
  ];
}

async function isProgramEligibleForBoard(
  adminClient: ReturnType<typeof createClient>,
  program: string,
  boardOrganizationId: number,
) {
  const normalizedProgram = normalizeProgram(program);
  if (!normalizedProgram || !boardOrganizationId) {
    return { eligible: false, error: null };
  }

  const { data: links, error: linkError } = await adminClient
    .from("organization_programs")
    .select("program_id")
    .eq("organization_id", boardOrganizationId)
    .limit(100);

  if (linkError) {
    console.error("[board-manual-enrollment] organization_programs lookup failed", {
      code: linkError.code,
      message: linkError.message,
    });
    return { eligible: false, error: linkError };
  }

  const programIds = [
    ...new Set((links || []).map((link) => Number(link.program_id)).filter(Boolean)),
  ];

  if (programIds.length === 0) {
    return { eligible: false, error: null };
  }

  const { data: programs, error: programError } = await adminClient
    .from("programs")
    .select("id, code, name")
    .in("id", programIds);

  if (programError) {
    console.error("[board-manual-enrollment] programs lookup failed", {
      code: programError.code,
      message: programError.message,
    });
    return { eligible: false, error: programError };
  }

  return {
    eligible: (programs || []).some((linkedProgram) => {
      return (
        sameProgram(linkedProgram?.code, normalizedProgram) ||
        sameProgram(linkedProgram?.name, normalizedProgram)
      );
    }),
    error: null,
  };
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

async function ensureStudentMemberships(
  adminClient: ReturnType<typeof createClient>,
  studentId: number,
  program: string,
  boardOrganizationId: number,
  academicTermId: number,
  source: string,
) {
  const organizationIds = await resolveMembershipOrganizationIds(
    adminClient,
    program,
    boardOrganizationId,
  );

  const { data: existingMemberships, error: existingMembershipError } = await adminClient
    .from("student_organizations")
    .select("organization_id")
    .eq("student_id", studentId)
    .in("organization_id", organizationIds);

  if (existingMembershipError) {
    return {
      error: existingMembershipError,
      errorStage: "lookup",
      organizationIds,
      createdOrganizationIds: [],
      existingOrganizationIds: [],
      removedOrganizationIds: [],
      createdTermOrganizationIds: [],
    };
  }

  const existingOrganizationIds = [
    ...new Set((existingMemberships || []).map((membership) => Number(membership.organization_id))),
  ];

  const rows = organizationIds.map((organizationId) => ({
    student_id: studentId,
    organization_id: organizationId,
    role: "member",
  }));

  const { error } = await adminClient
    .from("student_organizations")
    .upsert(rows, {
      onConflict: "student_id,organization_id",
      ignoreDuplicates: true,
    });

  let removedOrganizationIds: number[] = [];
  let createdTermOrganizationIds: number[] = [];

  if (!error) {
    for (const organizationId of organizationIds) {
      const { data: participationRows, error: participationError } = await adminClient.rpc(
        "ensure_student_organization_term_participation",
        {
          target_student_id: studentId,
          target_organization_id: organizationId,
          target_academic_term_id: academicTermId,
          target_source: source,
        },
      );

      if (participationError) {
        return {
          error: participationError,
          errorStage: "term_participation",
          organizationIds,
          createdOrganizationIds: [],
          existingOrganizationIds,
          removedOrganizationIds,
          createdTermOrganizationIds,
        };
      }

      const participation = Array.isArray(participationRows)
        ? participationRows[0]
        : participationRows;

      if (participation?.status === "removed") {
        removedOrganizationIds.push(Number(organizationId));
      } else if (participation?.status !== "active") {
        return {
          error: { message: participation?.reason || "Term participation could not be verified." },
          errorStage: "term_participation",
          organizationIds,
          createdOrganizationIds: [],
          existingOrganizationIds,
          removedOrganizationIds,
          createdTermOrganizationIds,
        };
      } else if (participation?.created) {
        createdTermOrganizationIds.push(Number(organizationId));
      }
    }
  }

  const createdOrganizationIds = organizationIds.filter(
    (organizationId) => !existingOrganizationIds.includes(Number(organizationId)),
  );

  return {
    error,
    errorStage: error ? "upsert" : null,
    organizationIds,
    createdOrganizationIds: error ? [] : createdOrganizationIds,
    existingOrganizationIds,
    removedOrganizationIds,
    createdTermOrganizationIds,
  };
}

async function requireElectoralBoard(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return { response: jsonResponse({ error: "Authentication required." }, 401) };

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user?.id) {
    return { response: jsonResponse({ error: "Invalid or expired session." }, 401) };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: adminProfile, error: adminError } = await adminClient
    .from("admin_users")
    .select("id, auth_user_id, role, status, organization_id")
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
    return { response: jsonResponse({ error: "Active Electoral Board authorization required." }, 403) };
  }

  return { adminClient, user, adminProfile };
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
        outcome: "NEW_STUDENT",
        student_number: studentNumber,
        academic_term: activeTerm,
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

  const officialProgram = normalizeProgram(enrollment?.program || student.program);
  const eligibility = await isProgramEligibleForBoard(
    adminClient,
    officialProgram,
    boardOrganizationId,
  );
  if (eligibility.error) {
    return jsonResponse({ error: "Program eligibility could not be verified." }, 500);
  }

  let organizationOutcome = eligibility.eligible ? "AVAILABLE_FOR_ORGANIZATION" : "INELIGIBLE";
  if (participation?.status === "removed") organizationOutcome = "RESTORATION_REQUIRED";
  else if (participation?.status === "active") organizationOutcome = "ALREADY_MEMBER";

  const scopedStudent = eligibility.eligible || participation
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
      outcome: enrollment?.enrollment_status === "enrolled"
        ? "ALREADY_ENROLLED_CURRENT_TERM"
        : enrollment?.enrollment_status === "not_in_masterlist"
        ? "EXISTING_STUDENT_NOT_IN_MASTERLIST"
        : "EXISTING_STUDENT_NEW_TERM",
      organization_outcome: organizationOutcome,
      student: scopedStudent,
      academic_term: activeTerm,
    },
  });
}

async function handleBoardTermAwareRegistration(
  adminClient: any,
  adminProfile: { organization_id: number },
  body: Record<string, unknown>,
  mode: "create" | "enroll_existing",
) {
  const input = (body.student || {}) as Record<string, unknown>;
  const studentNumber = cleanText(input.student_number, 80);
  const boardOrganizationId = Number(adminProfile.organization_id);
  const { data: activeTermData, error: termError } = await loadActiveTerm(adminClient);
  const activeTerm = activeTermData as {
    id: number;
    academic_year: string;
    semester: string;
    status: string;
  } | null;

  if (termError) return jsonResponse({ error: "Unable to verify the active academic term." }, 500);
  if (!activeTerm?.id) return jsonResponse({ data: { outcome: "INVALID_TERM" } }, 409);

  let studentId: number | null = null;
  let program = normalizeProgram(input.program);
  let yearLevel: number;
  let rpcResult: Record<string, unknown> | null = null;

  if (mode === "create") {
    if (Object.prototype.hasOwnProperty.call(input, "status")) {
      return jsonResponse({ data: { outcome: "CLIENT_STATUS_NOT_ALLOWED" } }, 400);
    }

    const firstName = cleanText(input.first_name);
    const lastName = cleanText(input.last_name);
    try {
      yearLevel = parseTermEnrollmentYearLevel(input.year_level);
    } catch {
      return jsonResponse({ data: { outcome: "INVALID_INPUT" } }, 400);
    }

    if (!isFiveDigitStudentNumber(studentNumber)) {
      return jsonResponse({ data: { outcome: "INVALID_FORMAT" } }, 400);
    }
    if (!firstName || !lastName || !program) {
      return jsonResponse({ data: { outcome: "INVALID_INPUT" } }, 400);
    }

    const eligibility = await isProgramEligibleForBoard(adminClient, program, boardOrganizationId);
    if (eligibility.error) {
      return jsonResponse({ error: "Program eligibility could not be verified." }, 500);
    }
    if (!eligibility.eligible) {
      return jsonResponse({ data: { outcome: "INELIGIBLE" } }, 403);
    }

    const { data, error } = await adminClient.rpc("create_manual_student_for_term_v1", {
      p_academic_term_id: Number(activeTerm.id),
      p_student_number: studentNumber,
      p_first_name: firstName,
      p_last_name: lastName,
      p_email: normalizeEmail(input.email),
      p_program: program,
      p_year_level: yearLevel,
      p_is_shs: false,
      p_photo_url: cleanText(input.photo_url, 500_000) || null,
      p_precinct_code: cleanText(input.precinct_code, 80) || null,
      p_batch_code: cleanText(input.batch_code, 80) || null,
    });
    if (error) return jsonResponse({ error: "Student registration could not be completed." }, 500);
    rpcResult = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    studentId = Number(rpcResult?.student_id) || null;
  } else {
    const { data: students, error: lookupError } = await adminClient
      .from("students")
      .select("id, first_name, last_name, program, year_level")
      .eq("student_number", studentNumber)
      .limit(2);
    if (lookupError) return jsonResponse({ error: "Unable to resolve the student identity." }, 500);
    if ((students || []).length !== 1) {
      return jsonResponse({ data: { outcome: "IDENTITY_RECHECK_REQUIRED" } }, 409);
    }

    const existingStudent = students?.[0];
    if (
      (input.first_name && !sameText(input.first_name, existingStudent?.first_name)) ||
      (input.last_name && !sameText(input.last_name, existingStudent?.last_name)) ||
      (program && !sameProgram(program, existingStudent?.program))
    ) {
      return jsonResponse({ data: { outcome: "IDENTITY_RECONCILIATION_REQUIRED" } }, 409);
    }

    studentId = Number(existingStudent?.id) || null;
    program = normalizeProgram(existingStudent?.program);
    try {
      yearLevel = parseTermEnrollmentYearLevel(input.year_level ?? existingStudent?.year_level);
    } catch {
      return jsonResponse({ data: { outcome: "IDENTITY_RECONCILIATION_REQUIRED" } }, 409);
    }

    const eligibility = await isProgramEligibleForBoard(adminClient, program, boardOrganizationId);
    if (eligibility.error) {
      return jsonResponse({ error: "Program eligibility could not be verified." }, 500);
    }
    if (!eligibility.eligible) {
      return jsonResponse({ data: { outcome: "INELIGIBLE" } }, 403);
    }

    const { data, error } = await adminClient.rpc("enroll_existing_student_for_term_v1", {
      p_student_id: studentId,
      p_academic_term_id: Number(activeTerm.id),
      p_program: program,
      p_year_level: yearLevel,
      p_is_shs: false,
    });
    if (error) return jsonResponse({ error: "Term enrollment could not be completed." }, 500);
    rpcResult = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  }

  const outcome = cleanText(rpcResult?.outcome, 80) || "SAFE_SERVER_ERROR";
  if (
    !["NEW_STUDENT_CREATED", "EXISTING_STUDENT_ENROLLED", "EXISTING_STUDENT_TERM_RESTORED"].includes(outcome) ||
    !studentId
  ) {
    const status = ["IDENTITY_RECHECK_REQUIRED", "ALREADY_ENROLLED_CURRENT_TERM"].includes(outcome)
      ? 409
      : outcome === "INVALID_FORMAT" || outcome === "INVALID_INPUT" ? 400 : 500;
    return jsonResponse({ data: { outcome } }, status);
  }

  const membership = await ensureStudentMemberships(
    adminClient,
    studentId,
    program,
    boardOrganizationId,
    Number(activeTerm.id),
    "manual",
  );
  if (membership.error) {
    return jsonResponse({ error: "The student was enrolled, but organization participation could not be saved." }, 500);
  }
  if (membership.removedOrganizationIds.includes(boardOrganizationId)) {
    return jsonResponse({
      data: {
        outcome,
        organization_outcome: "RESTORATION_REQUIRED",
        academic_term: activeTerm,
        student_status: rpcResult?.student_status || null,
      },
    }, 409);
  }

  return jsonResponse({
    data: {
      outcome,
      organization_outcome: membership.existingOrganizationIds.includes(boardOrganizationId)
        ? "ALREADY_MEMBER"
        : "AVAILABLE_FOR_ORGANIZATION",
      student_number: studentNumber,
      student_status: rpcResult?.student_status || null,
      academic_term: activeTerm,
    },
  });
}

async function handleBatchEnroll(
  adminClient: ReturnType<typeof createClient>,
  adminProfile: { organization_id: number },
  body: Record<string, unknown>,
) {
  const inputRows = Array.isArray(body.rows) ? body.rows : [];
  if (inputRows.length === 0) {
    return jsonResponse({ error: "CSV rows are required." }, 400);
  }

  const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);

  if (termError) {
    return jsonResponse({ error: "Unable to verify the active academic term." }, 500);
  }

  if (!activeTerm?.id) {
    return jsonResponse({ error: "Board CSV import requires an active academic term." }, 409);
  }

  const boardOrganizationId = Number(adminProfile.organization_id);
  const results = [];

  for (let index = 0; index < inputRows.length; index += 1) {
    const row = (inputRows[index] || {}) as Record<string, unknown>;
    const rowNumber = Number(row.row_number) || index + 2;
    const studentNumber = cleanText(row.student_number, 80);
    const firstName = cleanText(row.first_name);
    const lastName = cleanText(row.last_name);
    const email = normalizeEmail(row.email);
    const program = normalizeProgram(row.program);
    let yearLevel: number;

    try {
      yearLevel = parseCollegeYearLevel(row.year_level);
    } catch (error) {
      results.push({
        row_number: rowNumber,
        student_number: studentNumber,
        status: "invalid",
        message: error instanceof Error ? error.message : "Enter a valid college year level.",
      });
      continue;
    }

    if (!studentNumber || !firstName || !lastName || !program) {
      results.push({
        row_number: rowNumber,
        student_number: studentNumber,
        status: "invalid",
        message: "Student ID, first name, last name, program, and year level are required.",
      });
      continue;
    }

    if (email && !email.includes("@")) {
      results.push({
        row_number: rowNumber,
        student_number: studentNumber,
        status: "invalid",
        message: "Email must be blank or use a valid email format.",
      });
      continue;
    }

    const eligibility = await isProgramEligibleForBoard(adminClient, program, boardOrganizationId);
    if (eligibility.error) {
      results.push({
        row_number: rowNumber,
        student_number: studentNumber,
        status: "error",
        message: "Program eligibility could not be verified. Please try again.",
      });
      continue;
    }

    if (!eligibility.eligible) {
      results.push({
        row_number: rowNumber,
        student_number: studentNumber,
        status: "program_mismatch",
        message: `${program} is not eligible for this Electoral Board organization.`,
      });
      continue;
    }

    const { data: matchingStudents, error: lookupError } = await adminClient
      .from("students")
      .select("id, student_number, first_name, last_name, email, program, year_level, status")
      .eq("student_number", studentNumber)
      .limit(2);

    if (lookupError) {
      results.push({
        row_number: rowNumber,
        student_number: studentNumber,
        status: "error",
        message: "Unable to verify the central student record.",
      });
      continue;
    }

    if ((matchingStudents || []).length > 1) {
      results.push({
        row_number: rowNumber,
        student_number: studentNumber,
        status: "identity_conflict",
        message: `Multiple central student records use Student ID ${studentNumber}.`,
      });
      continue;
    }

    const existingStudent = matchingStudents?.[0] || null;
    if (
      existingStudent &&
      (!sameText(existingStudent.first_name, firstName) || !sameText(existingStudent.last_name, lastName))
    ) {
      results.push({
        row_number: rowNumber,
        student_number: studentNumber,
        status: "identity_conflict",
        message: `Student ID ${studentNumber} already belongs to a different student identity.`,
      });
      continue;
    }

    let currentEnrollment = null;
    let previousEnrollment = null;

    if (existingStudent?.id) {
      const { data: currentEnrollmentData, error: currentEnrollmentError } = await adminClient
        .from("student_term_enrollments")
        .select("id, program, year_level, enrollment_status, source")
        .eq("student_id", existingStudent.id)
        .eq("academic_term_id", activeTerm.id)
        .maybeSingle();

      if (currentEnrollmentError) {
        results.push({
          row_number: rowNumber,
          student_number: studentNumber,
          status: "error",
          message: "Unable to verify current-term enrollment.",
        });
        continue;
      }

      currentEnrollment = currentEnrollmentData;

      if (!currentEnrollment) {
        const { data: previousEnrollmentData } = await adminClient
          .from("student_term_enrollments")
          .select("id, academic_term_id, program, year_level, enrollment_status")
          .eq("student_id", existingStudent.id)
          .neq("academic_term_id", activeTerm.id)
          .order("academic_term_id", { ascending: false })
          .limit(1)
          .maybeSingle();

        previousEnrollment = previousEnrollmentData;
      }
    }

    const authoritativeProgram =
      currentEnrollment?.program ||
      existingStudent?.program ||
      previousEnrollment?.program ||
      "";

    if (existingStudent && authoritativeProgram && !sameProgram(authoritativeProgram, program)) {
      results.push({
        row_number: rowNumber,
        student_number: studentNumber,
        status: "program_change_requires_super_admin",
        message: `Program change from ${authoritativeProgram} to ${program} requires Super Admin review.`,
      });
      continue;
    }

    const { error: enrollmentError } = await adminClient.rpc("manual_enroll_student", {
      p_academic_term_id: activeTerm.id,
      p_student_number: studentNumber,
      p_first_name: firstName,
      p_last_name: lastName,
      p_email: email,
      p_program: program,
      p_year_level: yearLevel,
      p_is_shs: false,
    });

    if (enrollmentError) {
      results.push({
        row_number: rowNumber,
        student_number: studentNumber,
        status: "error",
        message: sanitizeEnrollmentError(enrollmentError),
      });
      continue;
    }

    const { data: loadedStudent, error: studentLookupError } = await adminClient
      .from("students")
      .select("id, student_number, first_name, last_name, email, photo_url, program, year_level, is_shs, status, created_at")
      .eq("student_number", studentNumber)
      .single();

    if (studentLookupError || !loadedStudent?.id) {
      results.push({
        row_number: rowNumber,
        student_number: studentNumber,
        status: "error",
        message: "Student was enrolled, but the saved record could not be loaded.",
      });
      continue;
    }

    const membershipResult = await ensureStudentMemberships(
      adminClient,
      Number(loadedStudent.id),
      program,
      boardOrganizationId,
      Number(activeTerm.id),
      "board_csv",
    );

    if (membershipResult.error) {
      results.push({
        row_number: rowNumber,
        student_number: studentNumber,
        status: "error",
        message: "Student was enrolled, but organization membership could not be saved.",
      });
      continue;
    }

    if (membershipResult.removedOrganizationIds.includes(boardOrganizationId)) {
      results.push({
        row_number: rowNumber,
        student_number: studentNumber,
        status: "previously_removed",
        message: "Student was previously removed from this organization for the active term. Manual restoration is required.",
        student_id: loadedStudent.id,
        created_student: !existingStudent,
        created_organization_ids: membershipResult.createdOrganizationIds,
        existing_organization_ids: membershipResult.existingOrganizationIds,
        removed_organization_ids: membershipResult.removedOrganizationIds,
      });
      continue;
    }

    const boardMembershipAlreadyExisted =
      membershipResult.existingOrganizationIds.includes(boardOrganizationId) &&
      !membershipResult.createdOrganizationIds.includes(boardOrganizationId);

    let status = "enrolled";
    if (!existingStudent) status = "created";
    else if (currentEnrollment?.enrollment_status === "enrolled" && boardMembershipAlreadyExisted) {
      status = "already_enrolled";
    } else if (!boardMembershipAlreadyExisted) {
      status = "linked";
    }

    results.push({
      row_number: rowNumber,
      student_number: studentNumber,
      status,
      message:
        status === "created"
          ? "Student created, enrolled, and linked to your organization."
          : status === "already_enrolled"
            ? "Student was already enrolled and linked to your organization."
            : status === "linked"
              ? "Existing student enrolled and linked to your organization."
              : "Student enrolled for the current active term.",
      student_id: loadedStudent.id,
      created_student: !existingStudent,
      created_organization_ids: membershipResult.createdOrganizationIds,
      existing_organization_ids: membershipResult.existingOrganizationIds,
      removed_organization_ids: membershipResult.removedOrganizationIds,
      created_term_organization_ids: membershipResult.createdTermOrganizationIds,
    });
  }

  const summary = results.reduce(
    (counts, result) => ({
      ...counts,
      total: counts.total + 1,
      [result.status]: (counts[result.status] || 0) + 1,
      succeeded: ["created", "enrolled", "already_enrolled", "linked"].includes(result.status)
        ? counts.succeeded + 1
        : counts.succeeded,
      failed: ["created", "enrolled", "already_enrolled", "linked"].includes(result.status)
        ? counts.failed
        : counts.failed + 1,
    }),
    { total: 0, succeeded: 0, failed: 0 } as Record<string, number>,
  );

  return jsonResponse({
    data: {
      academic_term: activeTerm,
      board_organization_id: boardOrganizationId,
      results,
      summary,
    },
  });
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
  const { data: organization } = await adminClient
    .from("organizations")
    .select("id, name")
    .eq("id", boardOrganizationId)
    .maybeSingle();
  const organizationName = organization?.name || "this organization";
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
        status: "new_student_not_in_masterlist",
        message: boardPreviewMessage("new_student_not_in_masterlist"),
      });
      continue;
    }

    if (!sameStudentIdentity(student, row)) {
      results.push({
        ...baseResult,
        student_id: student.id,
        status: "identity_conflict",
        message: boardPreviewMessage("identity_conflict"),
        official: {
          first_name: student.first_name,
          last_name: student.last_name,
          program: student.program,
          year_level: student.year_level,
        },
      });
      continue;
    }

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

    if (!enrollment || enrollment.enrollment_status !== "enrolled") {
      results.push({
        ...baseResult,
        student_id: student.id,
        status: "not_enrolled_current_term",
        message: boardPreviewMessage("not_enrolled_current_term"),
      });
      continue;
    }

    const officialProgram = normalizeProgram(enrollment.program || student.program);
    if (officialProgram && !sameProgram(officialProgram, row.program)) {
      results.push({
        ...baseResult,
        student_id: student.id,
        status: "program_change_requires_super_admin",
        message: boardPreviewMessage("program_change_requires_super_admin"),
        official_program: officialProgram,
      });
      continue;
    }

    const eligibility = await isProgramEligibleForBoard(adminClient, officialProgram, boardOrganizationId);
    if (eligibility.error) {
      results.push({
        ...baseResult,
        student_id: student.id,
        status: "invalid",
        message: "Program eligibility could not be verified. Please try again.",
      });
      continue;
    }

    if (!eligibility.eligible) {
      results.push({
        ...baseResult,
        student_id: student.id,
        status: "program_mismatch",
        message: boardPreviewMessage("program_mismatch", { organization_name: organizationName }),
        official_program: officialProgram,
      });
      continue;
    }

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

    if (participation?.status === "removed") {
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

    if (participation?.status === "active") {
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
      message: boardPreviewMessage("ready", { organization_name: organizationName }),
      official_program: officialProgram,
    });
  }

  return {
    data: {
      academic_term: activeTerm,
      board_organization_id: boardOrganizationId,
      organization_name: organizationName,
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

async function ensureBoardCsvParticipation(
  adminClient: ReturnType<typeof createClient>,
  studentId: number,
  organizationId: number,
  academicTermId: number,
) {
  const { error: membershipError } = await adminClient
    .from("student_organizations")
    .upsert(
      [{ student_id: studentId, organization_id: organizationId, role: "member" }],
      { onConflict: "student_id,organization_id", ignoreDuplicates: true },
    );

  if (membershipError) return { error: membershipError, participation: null };

  const { data: participationRows, error: participationError } = await adminClient.rpc(
    "ensure_student_organization_term_participation",
    {
      target_student_id: studentId,
      target_organization_id: organizationId,
      target_academic_term_id: academicTermId,
      target_source: "board_csv",
    },
  );

  if (participationError) return { error: participationError, participation: null };

  const participation = Array.isArray(participationRows)
    ? participationRows[0]
    : participationRows;

  if (participation?.status !== "active") {
    return {
      error: { message: participation?.reason || "Term participation could not be verified." },
      participation,
    };
  }

  return { error: null, participation };
}

async function handleConfirmBoardCsvImport(
  adminClient: ReturnType<typeof createClient>,
  adminProfile: { organization_id: number },
  body: Record<string, unknown>,
) {
  const preview = await previewBoardCsvRows(adminClient, adminProfile, body.rows);
  if ("response" in preview) return preview.response;

  const readyRows = (preview.data.results || []).filter((row) => row.status === "ready");
  const committedRows: Array<Record<string, unknown>> = [];
  const skippedRows = (preview.data.results || []).filter((row) => row.status !== "ready");

  for (const row of readyRows) {
    const { error, participation } = await ensureBoardCsvParticipation(
      adminClient,
      Number(row.student_id),
      Number(preview.data.board_organization_id),
      Number(preview.data.academic_term?.id),
    );

    if (error) {
      skippedRows.push({
        ...row,
        status: "not_imported",
        message: "This row could not be imported after final validation.",
      });
      continue;
    }

    committedRows.push({
      ...row,
      status: participation?.created ? "imported" : "already_member",
      message: participation?.created
        ? `Student added to ${preview.data.organization_name} for the current academic term.`
        : boardPreviewMessage("already_member", { organization_name: preview.data.organization_name }),
    });
  }

  const results = [...committedRows, ...skippedRows].sort(
    (left, right) => Number(left.row_number) - Number(right.row_number),
  );

  return jsonResponse({
    data: {
      academic_term: preview.data.academic_term,
      board_organization_id: preview.data.board_organization_id,
      organization_name: preview.data.organization_name,
      results,
      committed_rows: committedRows,
      skipped_rows: skippedRows,
      summary: {
        ...summarizeBoardImportRows(results),
        imported: committedRows.filter((row) => row.status === "imported").length,
        committed: committedRows.length,
        skipped: skippedRows.length,
      },
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

async function handleParticipationAction(
  adminClient: ReturnType<typeof createClient>,
  adminProfile: { id: number; organization_id: number },
  body: Record<string, unknown>,
  action: "remove" | "restore",
) {
  let studentId: number;
  let reason: string | null = null;

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

  const { data, error } = await adminClient.rpc("board_update_student_participation", {
    target_student_id: studentId,
    target_organization_id: Number(adminProfile.organization_id),
    actor_admin_id: Number(adminProfile.id),
    target_action: action,
    target_reason: reason,
  });

  if (error) {
    const message = String(error.message || "").trim();
    return jsonResponse(
      { error: message || "Student organization participation could not be updated." },
      400,
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  return jsonResponse({
    data: {
      result: row || null,
      already_applied: Boolean(row?.already_applied),
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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
    return await handleBoardTermAwareRegistration(auth.adminClient, auth.adminProfile, body, "create");
  }

  if (action === "enroll_existing_student_for_term") {
    return await handleBoardTermAwareRegistration(auth.adminClient, auth.adminProfile, body, "enroll_existing");
  }

  if (action === "list_students") {
    return await handleListStudents(auth.adminClient, auth.adminProfile, body);
  }

  if (action === "list_removed_students") {
    return await handleListRemovedStudents(auth.adminClient, auth.adminProfile, body);
  }

  if (action === "remove_student_participation") {
    return await handleParticipationAction(auth.adminClient, auth.adminProfile, body, "remove");
  }

  if (action === "restore_student_participation") {
    return await handleParticipationAction(auth.adminClient, auth.adminProfile, body, "restore");
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

  const input = (body.student || {}) as Record<string, unknown>;
  const studentNumber = cleanText(input.student_number, 80);
  const firstName = cleanText(input.first_name);
  const lastName = cleanText(input.last_name);
  const email = normalizeEmail(input.email);
  const program = normalizeProgram(input.program);
  let yearLevel: number;

  try {
    yearLevel = parseYearLevel(input.year_level);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Enter a valid year level." },
      400,
    );
  }

  if (!studentNumber) return jsonResponse({ error: "Student ID is required." }, 400);
  if (!firstName) return jsonResponse({ error: "First name is required." }, 400);
  if (!lastName) return jsonResponse({ error: "Last name is required." }, 400);
  if (!email || !email.includes("@")) return jsonResponse({ error: "A valid email is required." }, 400);
  if (!program) return jsonResponse({ error: "Program is required." }, 400);

  const { adminClient, adminProfile } = auth;

  const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);

  if (termError) {
    return jsonResponse({ error: "Unable to verify the active academic term." }, 500);
  }

  if (!activeTerm?.id) {
    return jsonResponse({ error: "Manual registration requires an active academic term." }, 409);
  }

  const { data: existingStudent } = await adminClient
    .from("students")
    .select("id")
    .eq("student_number", studentNumber)
    .maybeSingle();

  const { error: enrollmentError } = await adminClient.rpc("manual_enroll_student", {
    p_academic_term_id: activeTerm.id,
    p_student_number: studentNumber,
    p_first_name: firstName,
    p_last_name: lastName,
    p_email: email,
    p_program: program,
    p_year_level: yearLevel,
    p_is_shs: false,
  });

  if (enrollmentError) {
    return jsonResponse({ error: sanitizeEnrollmentError(enrollmentError) }, 400);
  }

  const { data: loadedStudent, error: studentLookupError } = await adminClient
    .from("students")
    .select("id, student_number, first_name, last_name, email, photo_url, program, year_level, is_shs, status, created_at")
    .eq("student_number", studentNumber)
    .single();

  if (studentLookupError || !loadedStudent?.id) {
    return jsonResponse({ error: "Student was enrolled, but the saved record could not be loaded." }, 500);
  }

  let student = loadedStudent;
  if (!existingStudent) {
    const createdStudentUpdates: Record<string, unknown> = {};
    const photoUrl = cleanText(input.photo_url, 500_000);
    const precinctCode = cleanText(input.precinct_code, 80);
    const batchCode = cleanText(input.batch_code, 80);
    const status = cleanOptionalStudentStatus(input.status);

    if (photoUrl) createdStudentUpdates.photo_url = photoUrl;
    if (precinctCode) createdStudentUpdates.precinct_code = precinctCode;
    if (batchCode) createdStudentUpdates.batch_code = batchCode;
    if (status) createdStudentUpdates.status = status;

    if (Object.keys(createdStudentUpdates).length > 0) {
      const { data: updatedStudent, error: updateError } = await adminClient
        .from("students")
        .update(createdStudentUpdates)
        .eq("id", student.id)
        .select("id, student_number, first_name, last_name, email, photo_url, program, year_level, is_shs, status, created_at")
        .single();

      if (updateError) {
        return jsonResponse({ error: "Student was enrolled, but optional profile details could not be saved." }, 400);
      }

      student = updatedStudent;
    }
  }

  const membershipResult = await ensureStudentMemberships(
    adminClient,
    Number(student.id),
    program,
    Number(adminProfile.organization_id),
    Number(activeTerm.id),
    "manual",
  );

  if (membershipResult.error) {
    if (membershipResult.errorStage === "lookup") {
      return jsonResponse({ error: "Unable to verify existing organization memberships." }, 500);
    }
    return jsonResponse({ error: "Student was enrolled, but organization membership could not be saved." }, 400);
  }

  if (membershipResult.removedOrganizationIds.includes(Number(adminProfile.organization_id))) {
    return jsonResponse(
      {
        error: "Student was previously removed from this organization for the active term. Manual restoration is required.",
        data: student,
        academic_term: activeTerm,
        created_student: !existingStudent,
        created_organization_ids: membershipResult.createdOrganizationIds,
        existing_organization_ids: membershipResult.existingOrganizationIds,
        removed_organization_ids: membershipResult.removedOrganizationIds,
      },
      409,
    );
  }

  return jsonResponse({
    data: student,
    academic_term: activeTerm,
    created_student: !existingStudent,
    created_organization_ids: membershipResult.createdOrganizationIds,
    existing_organization_ids: membershipResult.existingOrganizationIds,
    removed_organization_ids: membershipResult.removedOrganizationIds,
    created_term_organization_ids: membershipResult.createdTermOrganizationIds,
  });
});
