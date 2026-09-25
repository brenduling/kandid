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

function cleanOptionalStudentStatus(value: unknown) {
  const status = cleanText(value, 40);
  return ["active", "pending", "disabled", "inactive"].includes(status) ? status : null;
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
  if (message.includes("identity") || message.includes("student_number") || message.includes("email")) {
    return "Student identity could not be verified. Check the student number and email.";
  }

  return "Student registration could not be completed.";
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
  explicitOrganizationId: unknown,
) {
  const explicitId = Number(explicitOrganizationId);
  const explicitOrganizationIds = Number.isInteger(explicitId) && explicitId > 0 ? [explicitId] : [];

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
        ...explicitOrganizationIds,
        ...(requiredOrganizations || []).map((organization) => organization.id),
        ...(programOrganizations || []).map((link) => link.organization_id),
      ]
        .map((id) => Number(id))
        .filter(Boolean),
    ),
  ];
}

async function ensureTermParticipations(
  adminClient: ReturnType<typeof createClient>,
  studentId: number,
  organizationIds: number[],
  academicTermId: number,
  source: string,
) {
  const removedOrganizationIds: number[] = [];
  const createdTermOrganizationIds: number[] = [];

  for (const organizationId of organizationIds) {
    const { data: participationRows, error } = await adminClient.rpc(
      "ensure_student_organization_term_participation",
      {
        target_student_id: studentId,
        target_organization_id: organizationId,
        target_academic_term_id: academicTermId,
        target_source: source,
      },
    );

    if (error) {
      return {
        error,
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
        removedOrganizationIds,
        createdTermOrganizationIds,
      };
    } else if (participation?.created) {
      createdTermOrganizationIds.push(Number(organizationId));
    }
  }

  return {
    error: null,
    removedOrganizationIds,
    createdTermOrganizationIds,
  };
}

async function requireSuperAdmin(
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
    .select("id, auth_user_id, role, status")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (adminError) {
    return { response: jsonResponse({ error: "Unable to verify Super Admin access." }, 500) };
  }

  if (
    !adminProfile ||
    adminProfile.auth_user_id !== user.id ||
    adminProfile.role !== "super_admin" ||
    adminProfile.status !== "active"
  ) {
    return { response: jsonResponse({ error: "Active Super Admin authorization required." }, 403) };
  }

  return { adminClient, user, adminProfile };
}

async function loadActiveTerm(adminClient: any) {
  return await adminClient
    .from("academic_terms")
    .select("id, academic_year, semester, status")
    .eq("status", "active")
    .maybeSingle();
}

async function resolveStudentForTerm(
  adminClient: any,
  studentNumberInput: unknown,
) {
  const studentNumber = cleanText(studentNumberInput, 80);
  const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);

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

  const { data: enrollment, error: enrollmentError } = await adminClient
    .from("student_term_enrollments")
    .select("program, year_level, enrollment_status, source")
    .eq("student_id", student.id)
    .eq("academic_term_id", activeTerm.id)
    .maybeSingle();

  if (enrollmentError) {
    return jsonResponse({ error: "Unable to verify the current-term enrollment." }, 500);
  }

  return jsonResponse({
    data: {
      outcome: enrollment?.enrollment_status === "enrolled"
        ? "ALREADY_ENROLLED_CURRENT_TERM"
        : enrollment?.enrollment_status === "not_in_masterlist"
        ? "EXISTING_STUDENT_NOT_IN_MASTERLIST"
        : "EXISTING_STUDENT_NEW_TERM",
      student: {
        student_number: student.student_number,
        first_name: student.first_name,
        last_name: student.last_name,
        program: enrollment?.program || student.program,
        year_level: enrollment?.year_level || student.year_level,
        status: student.status,
      },
      enrollment: enrollment
        ? {
          status: enrollment.enrollment_status,
          source: enrollment.source,
        }
        : null,
      academic_term: activeTerm,
    },
  });
}

async function ensureSuperAdminMemberships(
  adminClient: any,
  studentId: number,
  program: string,
  explicitOrganizationId: unknown,
  academicTermId: number,
) {
  const organizationIds = await resolveMembershipOrganizationIds(
    adminClient,
    program,
    explicitOrganizationId,
  );

  if (organizationIds.length === 0) {
    return {
      error: null,
      createdOrganizationIds: [],
      existingOrganizationIds: [],
      removedOrganizationIds: [],
      createdTermOrganizationIds: [],
    };
  }

  const { data: existingMemberships, error: lookupError } = await adminClient
    .from("student_organizations")
    .select("organization_id")
    .eq("student_id", studentId)
    .in("organization_id", organizationIds);

  if (lookupError) {
    return {
      error: lookupError,
      createdOrganizationIds: [],
      existingOrganizationIds: [],
      removedOrganizationIds: [],
      createdTermOrganizationIds: [],
    };
  }

  const existingOrganizationIds = [
    ...new Set((existingMemberships || []).map(
      (membership: { organization_id: number }) => Number(membership.organization_id),
    )),
  ];
  const { error: membershipError } = await adminClient
    .from("student_organizations")
    .upsert(
      organizationIds.map((organizationId) => ({
        student_id: studentId,
        organization_id: organizationId,
        role: "member",
      })),
      { onConflict: "student_id,organization_id", ignoreDuplicates: true },
    );

  if (membershipError) {
    return {
      error: membershipError,
      createdOrganizationIds: [],
      existingOrganizationIds,
      removedOrganizationIds: [],
      createdTermOrganizationIds: [],
    };
  }

  const participation = await ensureTermParticipations(
    adminClient,
    studentId,
    organizationIds,
    academicTermId,
    "manual",
  );

  return {
    error: participation.error,
    createdOrganizationIds: organizationIds.filter(
      (organizationId) => !existingOrganizationIds.includes(Number(organizationId)),
    ),
    existingOrganizationIds,
    removedOrganizationIds: participation.removedOrganizationIds,
    createdTermOrganizationIds: participation.createdTermOrganizationIds,
  };
}

async function handleTermAwareRegistration(
  adminClient: any,
  body: Record<string, unknown>,
  mode: "create" | "enroll_existing",
) {
  const input = (body.student || {}) as Record<string, unknown>;
  const studentNumber = cleanText(input.student_number, 80);
  const program = normalizeProgram(input.program);
  let yearLevel: number;

  try {
    yearLevel = parseTermEnrollmentYearLevel(input.year_level);
  } catch {
    return jsonResponse({ data: { outcome: "INVALID_INPUT" } }, 400);
  }

  const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);
  if (termError) return jsonResponse({ error: "Unable to verify the active academic term." }, 500);
  if (!activeTerm?.id) return jsonResponse({ data: { outcome: "INVALID_TERM" } }, 409);

  let rpcResult;
  let studentId: number | null = null;

  if (mode === "create") {
    if (Object.prototype.hasOwnProperty.call(input, "status")) {
      return jsonResponse({ data: { outcome: "CLIENT_STATUS_NOT_ALLOWED" } }, 400);
    }

    const firstName = cleanText(input.first_name);
    const lastName = cleanText(input.last_name);
    if (!isFiveDigitStudentNumber(studentNumber)) {
      return jsonResponse({ data: { outcome: "INVALID_FORMAT" } }, 400);
    }
    if (!firstName || !lastName || !program) {
      return jsonResponse({ data: { outcome: "INVALID_INPUT" } }, 400);
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
    rpcResult = Array.isArray(data) ? data[0] : data;
    studentId = Number(rpcResult?.student_id) || null;
  } else {
    const { data: matches, error: lookupError } = await adminClient
      .from("students")
      .select("id")
      .eq("student_number", studentNumber)
      .limit(2);
    if (lookupError) return jsonResponse({ error: "Unable to resolve the student identity." }, 500);
    if ((matches || []).length !== 1) {
      return jsonResponse({ data: { outcome: "IDENTITY_RECHECK_REQUIRED" } }, 409);
    }

    studentId = Number(matches?.[0]?.id) || null;
    const { data, error } = await adminClient.rpc("enroll_existing_student_for_term_v1", {
      p_student_id: studentId,
      p_academic_term_id: Number(activeTerm.id),
      p_program: program,
      p_year_level: yearLevel,
      p_is_shs: false,
    });
    if (error) return jsonResponse({ error: "Term enrollment could not be completed." }, 500);
    rpcResult = Array.isArray(data) ? data[0] : data;
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

  const membership = await ensureSuperAdminMemberships(
    adminClient,
    studentId,
    program,
    input.organization_id,
    Number(activeTerm.id),
  );
  if (membership.error) {
    return jsonResponse({ error: "The student was enrolled, but organization participation could not be saved." }, 500);
  }
  if (membership.removedOrganizationIds.length > 0) {
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
      student_number: studentNumber,
      student_status: rpcResult?.student_status || null,
      academic_term: activeTerm,
      created_organization_ids: membership.createdOrganizationIds,
      existing_organization_ids: membership.existingOrganizationIds,
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

  const auth = await requireSuperAdmin(request, supabaseUrl, anonKey, serviceRoleKey);
  if ("response" in auth) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const action = cleanText(body.action, 80);
  if (action === "resolve_student_for_term") {
    return await resolveStudentForTerm(auth.adminClient, body.student_number);
  }
  if (action === "create_new_student_for_term") {
    return await handleTermAwareRegistration(auth.adminClient, body, "create");
  }
  if (action === "enroll_existing_student_for_term") {
    return await handleTermAwareRegistration(auth.adminClient, body, "enroll_existing");
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

  if (!studentNumber) return jsonResponse({ error: "Student Number is required." }, 400);
  if (!firstName) return jsonResponse({ error: "First name is required." }, 400);
  if (!lastName) return jsonResponse({ error: "Last name is required." }, 400);
  if (!program) return jsonResponse({ error: "Program is required." }, 400);

  const { adminClient } = auth;

  const { data: activeTerm, error: termError } = await adminClient
    .from("academic_terms")
    .select("id, academic_year, semester, status")
    .eq("status", "active")
    .maybeSingle();

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

  const organizationIds = await resolveMembershipOrganizationIds(
    adminClient,
    program,
    input.organization_id,
  );

  let existingOrganizationIds: number[] = [];
  let createdOrganizationIds: number[] = [];
  let removedOrganizationIds: number[] = [];
  let createdTermOrganizationIds: number[] = [];

  if (organizationIds.length > 0) {
    const { data: existingMemberships, error: existingMembershipError } = await adminClient
      .from("student_organizations")
      .select("organization_id")
      .eq("student_id", student.id)
      .in("organization_id", organizationIds);

    if (existingMembershipError) {
      return jsonResponse({ error: "Unable to verify existing organization memberships." }, 500);
    }

    existingOrganizationIds = [
      ...new Set((existingMemberships || []).map((membership) => Number(membership.organization_id))),
    ];

    const rows = organizationIds.map((organizationId) => ({
      student_id: student.id,
      organization_id: organizationId,
      role: "member",
    }));

    const { error: membershipError } = await adminClient
      .from("student_organizations")
      .upsert(rows, {
        onConflict: "student_id,organization_id",
        ignoreDuplicates: true,
      });

    if (membershipError) {
      return jsonResponse({ error: "Student was enrolled, but organization membership could not be saved." }, 400);
    }

    const termParticipationResult = await ensureTermParticipations(
      adminClient,
      Number(student.id),
      organizationIds,
      Number(activeTerm.id),
      "manual",
    );

    if (termParticipationResult.error) {
      return jsonResponse({ error: "Student was enrolled, but term participation could not be saved." }, 400);
    }

    createdOrganizationIds = organizationIds.filter(
      (organizationId) => !existingOrganizationIds.includes(Number(organizationId)),
    );
    removedOrganizationIds = termParticipationResult.removedOrganizationIds;
    createdTermOrganizationIds = termParticipationResult.createdTermOrganizationIds;
  }

  if (removedOrganizationIds.length > 0) {
    return jsonResponse(
      {
        error: "Student was previously removed from one or more organizations for the active term. Manual restoration is required.",
        data: student,
        academic_term: activeTerm,
        created_student: !existingStudent,
        created_organization_ids: createdOrganizationIds,
        existing_organization_ids: existingOrganizationIds,
        removed_organization_ids: removedOrganizationIds,
        created_term_organization_ids: createdTermOrganizationIds,
      },
      409,
    );
  }

  return jsonResponse({
    data: student,
    academic_term: activeTerm,
    created_student: !existingStudent,
    created_organization_ids: createdOrganizationIds,
    existing_organization_ids: existingOrganizationIds,
    removed_organization_ids: removedOrganizationIds,
    created_term_organization_ids: createdTermOrganizationIds,
  });
});
