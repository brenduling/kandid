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

function admissionOutcomeResponse(reason: string, organizationName?: string) {
  return jsonResponse({
    data: { outcome: reason },
    error: admissionMessage(reason, organizationName),
    code: reason.toLowerCase(),
  }, ["NOT_CURRENTLY_ENROLLED", "TERM_NOT_ACTIVE", "ACTIVE_TERM_UNAVAILABLE"].includes(reason) ? 409 : 403);
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
  if (value === "TERM_NOT_ACTIVE" || value === "ACTIVE_TERM_UNAVAILABLE") {
    return "Membership can only be added for the current active academic term.";
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
    return "This organization's membership classification is unavailable. Contact a system administrator.";
  }
  return "Organization membership could not be verified. Try again.";
}

function cleanText(value: unknown, maxLength = 255) {
  return String(value || "").trim().slice(0, maxLength);
}

function parseRequiredPositiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} is required.`);
  }
  return parsed;
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

async function ensureProgram(
  adminClient: ReturnType<typeof createClient>,
  program: string,
  actorAdminId: number,
) {
  if (!program) return null;

  const { data, error } = await adminClient.rpc(
    "kandid_ensure_program_catalog_entry_for_server_actor",
    { p_code: normalizeProgram(program), p_actor_admin_id: actorAdminId },
  );

  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.id || null;
}

async function resolveMembershipOrganizationIds(
  adminClient: ReturnType<typeof createClient>,
  program: string,
  explicitOrganizationId: unknown,
  actorAdminId: number,
) {
  const explicitId = Number(explicitOrganizationId);
  const explicitOrganizationIds = Number.isInteger(explicitId) && explicitId > 0 ? [explicitId] : [];

  const { data: institutionOrganizations, error: institutionError } = await adminClient
    .from("organizations")
    .select("id")
    .eq("membership_scope", "institution");

  if (institutionError) {
    throw new Error("Institution-wide membership configuration could not be verified.");
  }

  const programId = await ensureProgram(adminClient, program, actorAdminId);
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
        ...(institutionOrganizations || []).map((organization) => organization.id),
        ...(programOrganizations || []).map((link) => link.organization_id),
      ]
        .map((id) => Number(id))
        .filter(Boolean),
    ),
  ];
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
    .select("id, auth_user_id, full_name, role, status")
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

function organizationAuditContext(event: { organizationId?: number; organizationName?: string }) {
  if (!event.organizationId) return {};
  return {
    organization_id: event.organizationId,
    organization_name: event.organizationName ?? null,
  };
}

async function auditSuperAdminEvent(
  adminClient: ReturnType<typeof createClient>,
  adminProfile: { id: number; full_name: string },
  event: {
    eventType: string;
    entityType: string;
    entityId: number;
    entityLabel: string;
    metadata: Record<string, unknown>;
    organizationId?: number;
    organizationName?: string;
  },
) {
  const { error } = await adminClient.from("audit_logs").insert({
    user_id: Number(adminProfile.id),
    actor_name: adminProfile.full_name,
    actor_role: "super_admin",
    action: event.eventType,
    event_type: event.eventType,
    event_category: "students",
    event_origin: "trusted_edge",
    entity_type: event.entityType,
    entity_id: String(event.entityId),
    entity_label: event.entityLabel,
    ...organizationAuditContext(event),
    status: "completed",
    metadata: event.metadata,
  });
  if (error) {
    console.error("[super-admin-manual-enrollment] trusted audit write failed", { code: error.code });
    return false;
  }
  return true;
}

function rpcFailure(error: { code?: string }) {
  if (error.code === "42501") return jsonResponse({ error: "Active Super Admin authorization required." }, 403);
  if (error.code === "22023") return jsonResponse({ error: "Student update is invalid." }, 400);
  if (error.code === "P0002") return jsonResponse({ error: "Student record was not found." }, 404);
  return jsonResponse({ error: "Student operation could not be completed." }, 500);
}

function validProfilePhoto(value: unknown) {
  if (value === null || value === "") return true;
  if (typeof value !== "string" || value.length > 500_000) return false;
  return /^https:\/\//i.test(value) || /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(value);
}

async function updateStudentRecord(adminClient: any, adminProfile: { id: number }, input: Record<string, unknown>) {
  const studentId = Number(input.student_id);
  const student = (input.student || {}) as Record<string, unknown>;
  let yearLevel: number;
  try {
    yearLevel = parseYearLevel(student.year_level);
  } catch {
    return jsonResponse({ error: "Year level must be a valid whole number." }, 400);
  }
  const normalized = {
    student_number: cleanText(student.student_number, 80),
    first_name: cleanText(student.first_name),
    last_name: cleanText(student.last_name),
    email: normalizeEmail(student.email),
    photo_url: typeof student.photo_url === "string" ? student.photo_url.trim() || null : null,
    program: normalizeProgram(student.program),
    year_level: yearLevel,
    precinct_code: cleanText(student.precinct_code, 80) || null,
    batch_code: cleanText(student.batch_code, 80) || null,
    status: cleanText(student.status, 30),
  };
  if (!Number.isInteger(studentId) || studentId < 1 || !/^\d{5}$/.test(normalized.student_number) ||
      !normalized.first_name || !normalized.last_name || !normalized.program ||
      !["pending", "active", "disabled"].includes(normalized.status) ||
      (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) ||
      !validProfilePhoto(normalized.photo_url)) {
    return jsonResponse({ error: "Student details are invalid. Review the fields and try again." }, 400);
  }
  const { data, error } = await adminClient.rpc("kandid_super_admin_update_student", {
    p_actor_admin_id: Number(adminProfile.id),
    p_student_id: studentId,
    p_student: normalized,
  });
  if (error) return rpcFailure(error);
  return jsonResponse({ data });
}

async function unenrollStudentForCurrentTerm(
  adminClient: any,
  adminProfile: { id: number },
  body: Record<string, unknown>,
) {
  if (Object.keys(body).some((field) => !["action", "student_id"].includes(field))) {
    return jsonResponse({ error: "Unsupported term unenrollment field." }, 400);
  }
  const studentId = Number(body.student_id);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    return jsonResponse({ error: "A valid Student record is required." }, 400);
  }

  // The bearer session is already verified by requireSuperAdmin. The
  // service-role-only RPC independently rechecks this active admin identity.
  const { data, error } = await adminClient.rpc(
    "kandid_super_admin_unenroll_student_for_current_term",
    {
      p_actor_admin_id: Number(adminProfile.id),
      p_student_id: studentId,
    },
  );
  if (error) {
    if (error.code === "42501") return jsonResponse({ error: "Active Super Admin authorization required." }, 403);
    if (error.code === "22023") return jsonResponse({ error: "Student unenrollment request is invalid." }, 400);
    if (error.code === "P0002") return jsonResponse({ error: "Student or current-term enrollment was not found." }, 404);
    if (error.code === "55000") return jsonResponse({ error: "The active term or enrollment state could not be verified." }, 409);
    console.error("[super-admin-manual-enrollment] trusted term unenrollment failed", { code: error.code || "unknown" });
    return jsonResponse({ error: "Current-term unenrollment could not be completed." }, 500);
  }
  if (!["UNENROLLED_CURRENT_TERM", "ALREADY_UNENROLLED_CURRENT_TERM"].includes(data?.outcome)) {
    return jsonResponse({ error: "Current-term unenrollment could not be verified." }, 500);
  }
  return jsonResponse({ data });
}

async function deleteStudentRecord(adminClient: any, adminProfile: { id: number }, input: Record<string, unknown>) {
  const studentId = Number(input.student_id);
  if (!Number.isInteger(studentId) || studentId < 1) return jsonResponse({ error: "Student record is invalid." }, 400);
  const { data, error } = await adminClient.rpc("kandid_super_admin_delete_student", {
    p_actor_admin_id: Number(adminProfile.id),
    p_student_id: studentId,
    p_confirmed: input.confirmed === true,
  });
  if (error) return rpcFailure(error);
  return jsonResponse({ data });
}

function parseStudentIds(value: unknown, limit = 50000): number[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > limit) return [];
  const ids = [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  return ids;
}

async function listSuperAdminStudents(adminClient: any, adminProfile: { id: number }, body: Record<string, unknown>) {
  const studentIds = parseStudentIds(body.student_ids);
  if (Array.isArray(body.student_ids) && !studentIds?.length) {
    return jsonResponse({ data: { total_count: 0, data: [] } });
  }
  const { data, error } = await adminClient.rpc("kandid_super_admin_list_students", {
    p_actor_admin_id: Number(adminProfile.id),
    p_search: cleanText(body.search, 120) || null,
    p_status: cleanText(body.status, 30) || "all",
    p_student_ids: studentIds,
    p_sort: cleanText(body.sort, 30) || "name_asc",
    p_page: Math.max(1, Number(body.page) || 1),
    p_page_size: Math.min(250, Math.max(1, Number(body.page_size) || 10)),
  });
  if (error) return rpcFailure(error);
  return jsonResponse({ data: data || { total_count: 0, data: [] } });
}

async function listSuperAdminStudentReport(adminClient: any, adminProfile: { id: number }) {
  const collected: unknown[] = [];
  let page = 1;
  let total = 0;
  do {
    const { data, error } = await adminClient.rpc("kandid_super_admin_list_students", {
      p_actor_admin_id: Number(adminProfile.id),
      p_search: null,
      p_status: "all",
      p_student_ids: null,
      p_sort: "newest",
      p_page: page,
      p_page_size: 250,
    });
    if (error) return rpcFailure(error);
    total = Number(data?.total_count) || 0;
    collected.push(...(Array.isArray(data?.data) ? data.data : []));
    page += 1;
    if (page > 401) return jsonResponse({ error: "Student report exceeds the export safety limit." }, 413);
  } while (collected.length < total);
  return jsonResponse({ data: collected });
}

async function resolveSuperAdminStudentLabels(adminClient: any, adminProfile: { id: number }, body: Record<string, unknown>) {
  const ids = parseStudentIds(body.student_ids, 500);
  if (ids === null || (Array.isArray(body.student_ids) && ids.length !== body.student_ids.length)) {
    return jsonResponse({ error: "Student identity request is invalid." }, 400);
  }
  const { data, error } = await adminClient.rpc("kandid_super_admin_student_labels", {
    p_actor_admin_id: Number(adminProfile.id),
    p_student_ids: ids,
  });
  if (error) return rpcFailure(error);
  return jsonResponse({ data: Array.isArray(data) ? data : [] });
}

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

function safeParticipationError(message: unknown) {
  const safeMessage = cleanText(message, 300);
  return SAFE_PARTICIPATION_MESSAGES.has(safeMessage)
    ? safeMessage
    : "Current-term organization membership could not be updated.";
}

async function removeCurrentOrganizationMembership(
  adminClient: ReturnType<typeof createClient>,
  adminProfile: { id: number; full_name: string },
  body: Record<string, unknown>,
) {
  if (Object.keys(body).some((field) => !["action", "student_id", "organization_id", "reason"].includes(field))) {
    return jsonResponse({ error: "Unsupported membership removal field." }, 400);
  }

  let studentId: number;
  let organizationId: number;
  let reason: string;
  try {
    studentId = parseRequiredPositiveInteger(body.student_id, "Student");
    organizationId = parseRequiredPositiveInteger(body.organization_id, "Organization");
    reason = cleanText(body.reason, 500);
    if (!reason) throw new Error("Removal reason is required.");
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : "Invalid membership removal request.",
    }, 400);
  }

  const { data: organization, error: organizationError } = await adminClient
    .from("organizations")
    .select("id, name, organization_type, membership_scope")
    .eq("id", organizationId)
    .maybeSingle();
  if (organizationError || !organization?.id) {
    return jsonResponse({ error: "The selected organization could not be verified." }, 400);
  }
  const scopeFailure = organizationScopeFailure(organization);
  if (scopeFailure) return admissionOutcomeResponse(scopeFailure, organization.name);
  if (organization.membership_scope !== "manual") {
    const reason = organization.membership_scope
      ? "ACTIVATION_SYNC_REQUIRED"
      : "UNSUPPORTED_MEMBERSHIP_SCOPE";
    return admissionOutcomeResponse(reason, organization.name);
  }

  // The active Super Admin was resolved from the authenticated JWT by
  // requireSuperAdmin. The service-role-only RPC owns the shared term-scoped
  // mutation; the browser cannot choose an acting administrator identity.
  const { data, error } = await adminClient.rpc("board_update_student_participation", {
    target_student_id: studentId,
    target_organization_id: organizationId,
    actor_admin_id: Number(adminProfile.id),
    target_action: "remove",
    target_reason: reason,
  });

  if (error) {
    return jsonResponse({ error: safeParticipationError(error.message) }, 400);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return jsonResponse({ error: "Current-term organization membership could not be verified." }, 500);
  }

  if (!row.already_applied) {
    const auditRecorded = await auditSuperAdminEvent(adminClient, adminProfile, {
      eventType: "membership_removed",
      entityType: "student_organization",
      entityId: studentId,
      entityLabel: "Organization participation",
      organizationId,
      organizationName: cleanText(row.organization_name, 255),
      metadata: { academic_term_id: Number(row.academic_term_id) || null },
    });
    if (!auditRecorded) {
      return jsonResponse({
        error: "Membership was removed, but its audit record could not be saved. Refresh before retrying.",
        code: "audit_record_failed",
      }, 500);
    }
  }

  return jsonResponse({
    data: {
      status: row.status,
      already_applied: Boolean(row.already_applied),
      academic_term: {
        id: Number(row.academic_term_id),
        academic_year: row.academic_year,
        semester: row.semester,
      },
      organization_name: row.organization_name,
    },
  });
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
  actorAdminId: number,
) {
  const { error: syncError } = await adminClient.rpc(
    "kandid_super_admin_sync_current_term_memberships",
    {
      p_actor_admin_id: actorAdminId,
      p_student_id: studentId,
    },
  );
  if (syncError) {
    return {
      error: syncError,
      admissionReason: null,
      createdOrganizationIds: [],
      existingOrganizationIds: [],
      removedOrganizationIds: [],
      createdTermOrganizationIds: [],
    };
  }

  const explicitId = Number(explicitOrganizationId);
  const resolvedOrganizationIds = await resolveMembershipOrganizationIds(
    adminClient,
    program,
    explicitOrganizationId,
    actorAdminId,
  );

  resolvedOrganizationIds.sort((left, right) => Number(right === explicitId) - Number(left === explicitId));
  const organizationIds: number[] = [];
  for (const organizationId of resolvedOrganizationIds) {
    const { admission, error: admissionError } = await checkOrganizationAdmission(
      adminClient, studentId, organizationId, academicTermId,
    );
    if (admissionError || !admission) {
      return {
        error: admissionError || new Error("Organization admission could not be verified."),
        admissionReason: null,
        createdOrganizationIds: [],
        existingOrganizationIds: [],
        removedOrganizationIds: [],
        createdTermOrganizationIds: [],
      };
    }
    if (!admission.allowed) {
      if (organizationId === explicitId) {
        return {
          error: new Error(admission.reason),
          admissionReason: admission.reason,
          createdOrganizationIds: [],
          existingOrganizationIds: [],
          removedOrganizationIds: [],
          createdTermOrganizationIds: [],
        };
      }
      // Automatic program/name fan-out stays additive. A denied secondary
      // organization is skipped and cannot bootstrap another membership.
      continue;
    }
    organizationIds.push(organizationId);
  }

  if (organizationIds.length === 0) {
    return {
      error: null,
      admissionReason: null,
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
      admissionReason: null,
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
  const removedOrganizationIds: number[] = [];
  const createdTermOrganizationIds: number[] = [];
  const admittedOrganizationIds: number[] = [];

  for (const organizationId of organizationIds) {
    const { data: rows, error: participationError } = await adminClient.rpc(
      "ensure_student_organization_term_participation",
      {
        target_student_id: studentId,
        target_organization_id: organizationId,
        target_academic_term_id: academicTermId,
        target_source: "manual",
      },
    );
    const participation = Array.isArray(rows) ? rows[0] : rows;
    const admissionReason = decodeMembershipAdmissionReason(participationError) ||
      (participation?.status === "denied"
        ? decodeMembershipAdmissionReason(participation?.reason)
        : null);

    if (participationError || participation?.status === "denied") {
      if (admissionReason && organizationId !== explicitId) continue;
      return {
        error: participationError || { message: admissionReason || participation?.reason || "Term participation could not be verified." },
        admissionReason,
        createdOrganizationIds: [],
        existingOrganizationIds,
        removedOrganizationIds,
        createdTermOrganizationIds,
      };
    }
    if (participation?.status === "removed") {
      removedOrganizationIds.push(Number(organizationId));
      continue;
    }
    if (participation?.status !== "active") {
      return {
        error: { message: "Term participation could not be verified." },
        admissionReason: null,
        createdOrganizationIds: [],
        existingOrganizationIds,
        removedOrganizationIds,
        createdTermOrganizationIds,
      };
    }

    const { error: membershipError } = await adminClient
      .from("student_organizations")
      .upsert(
        [{ student_id: studentId, organization_id: organizationId, role: "member" }],
        { onConflict: "student_id,organization_id", ignoreDuplicates: true },
      );
    if (membershipError) {
      return {
        error: membershipError,
        admissionReason: null,
        createdOrganizationIds: [],
        existingOrganizationIds,
        removedOrganizationIds,
        createdTermOrganizationIds,
      };
    }

    admittedOrganizationIds.push(Number(organizationId));
    if (participation?.created) createdTermOrganizationIds.push(Number(organizationId));
  }

  return {
    error: null,
    admissionReason: null,
    createdOrganizationIds: admittedOrganizationIds.filter(
      (organizationId) => !existingOrganizationIds.includes(Number(organizationId)),
    ),
    existingOrganizationIds,
    removedOrganizationIds,
    createdTermOrganizationIds,
  };
}

async function handleTermAwareRegistration(
  adminClient: any,
  adminProfile: { id: number; full_name: string },
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

  const explicitOrganizationId = Number(input.organization_id);
  let explicitOrganization: { id: number; name: string; organization_type: string; membership_scope: string | null } | null = null;
  if (Number.isInteger(explicitOrganizationId) && explicitOrganizationId > 0) {
    const { data, error } = await adminClient
      .from("organizations")
      .select("id, name, organization_type, membership_scope")
      .eq("id", explicitOrganizationId)
      .maybeSingle();
    if (error || !data?.id) return jsonResponse({ error: "The selected organization could not be verified." }, 400);
    explicitOrganization = data;
  }

  if (explicitOrganization) {
    const scopeFailure = organizationScopeFailure(explicitOrganization);
    if (scopeFailure) return admissionOutcomeResponse(scopeFailure, explicitOrganization.name);
  }

  if (explicitOrganization && explicitOrganization.membership_scope !== "manual") {
    if (explicitOrganization.membership_scope !== "program" && explicitOrganization.membership_scope !== "institution") {
      return admissionOutcomeResponse("UNSUPPORTED_MEMBERSHIP_SCOPE", explicitOrganization.name);
    }
    if (mode === "create") {
      return admissionOutcomeResponse("ACTIVATION_SYNC_REQUIRED", explicitOrganization.name);
    }
  }

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
    const { data: currentEnrollment, error: currentEnrollmentError } = await adminClient
      .from("student_term_enrollments")
      .select("program, enrollment_status")
      .eq("student_id", studentId)
      .eq("academic_term_id", Number(activeTerm.id))
      .maybeSingle();
    if (currentEnrollmentError) {
      return jsonResponse({ error: "Current-term enrollment could not be verified." }, 500);
    }
    if (
      currentEnrollment?.enrollment_status === "not_in_masterlist" &&
      normalizeProgram(currentEnrollment.program) !== program
    ) {
      return jsonResponse({
        data: { outcome: "PROGRAM_CHANGE_REQUIRES_MASTERLIST_REVIEW" },
      }, 409);
    }
    if (explicitOrganization && explicitOrganization.membership_scope !== "manual") {
      const { data: existingParticipation, error: participationError } = await adminClient
        .from("student_organization_terms")
        .select("status")
        .eq("student_id", studentId)
        .eq("organization_id", explicitOrganization.id)
        .eq("academic_term_id", Number(activeTerm.id))
        .maybeSingle();
      if (participationError) return jsonResponse({ error: "Organization participation could not be verified." }, 500);
      if (existingParticipation?.status !== "active") {
        return admissionOutcomeResponse("ACTIVATION_SYNC_REQUIRED", explicitOrganization.name);
      }
    }
    if (explicitOrganization?.membership_scope === "manual") {
      if (currentEnrollment?.enrollment_status !== "enrolled") {
        return admissionOutcomeResponse("NOT_CURRENTLY_ENROLLED", explicitOrganization.name);
      }
      const { admission, error: admissionError } = await checkOrganizationAdmission(
        adminClient, Number(studentId), explicitOrganization.id, Number(activeTerm.id),
      );
      if (admissionError || !admission) {
        return jsonResponse({ error: "Organization membership could not be verified. Try again." }, 500);
      }
      if (!admission.allowed) {
        return admissionOutcomeResponse(admission.reason, explicitOrganization.name);
      }
    }
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
    Number(adminProfile.id),
  );
  if (membership.error) {
    if (membership.admissionReason) {
      return admissionOutcomeResponse(membership.admissionReason, explicitOrganization?.name);
    }
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

  const auditRecorded = await auditSuperAdminEvent(adminClient, adminProfile, {
    eventType: "student_term_enrolled",
    entityType: "student",
    entityId: studentId,
    entityLabel: "Student term enrollment",
    metadata: {
      academic_term_id: Number(activeTerm.id),
      created_organization_count: membership.createdOrganizationIds.length,
      existing_organization_count: membership.existingOrganizationIds.length,
    },
  });
  if (!auditRecorded) {
    return jsonResponse({ error: "Enrollment completed, but its audit record could not be saved. Refresh before retrying.", code: "audit_record_failed" }, 500);
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

  const auth = await requireSuperAdmin(request, supabaseUrl, anonKey, serviceRoleKey);
  if ("response" in auth) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const action = cleanText(body.action, 80);
  if (action === "list_students") {
    return await listSuperAdminStudents(auth.adminClient, auth.adminProfile, body);
  }
  if (action === "student_report") {
    return await listSuperAdminStudentReport(auth.adminClient, auth.adminProfile);
  }
  if (action === "student_labels") {
    return await resolveSuperAdminStudentLabels(auth.adminClient, auth.adminProfile, body);
  }
  if (action === "update_student") {
    return await updateStudentRecord(auth.adminClient, auth.adminProfile, body);
  }
  if (action === "unenroll_student_for_current_term") {
    return await unenrollStudentForCurrentTerm(auth.adminClient, auth.adminProfile, body);
  }
  if (action === "student_deletion_readiness" || action === "delete_student") {
    return await deleteStudentRecord(auth.adminClient, auth.adminProfile, {
      ...body,
      confirmed: action === "delete_student" && body.confirmed === true,
    });
  }
  if (action === "remove_current_organization_membership") {
    return await removeCurrentOrganizationMembership(auth.adminClient, auth.adminProfile, body);
  }
  if (action === "resolve_student_for_term") {
    return await resolveStudentForTerm(auth.adminClient, body.student_number);
  }
  if (action === "create_new_student_for_term") {
    return await handleTermAwareRegistration(auth.adminClient, auth.adminProfile, body, "create");
  }
  if (action === "enroll_existing_student_for_term") {
    return await handleTermAwareRegistration(auth.adminClient, auth.adminProfile, body, "enroll_existing");
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

  const explicitOrganizationId = Number(input.organization_id);
  if (Number.isInteger(explicitOrganizationId) && explicitOrganizationId > 0) {
    const { data: explicitOrganization, error: organizationError } = await adminClient
      .from("organizations")
      .select("id, name, organization_type, membership_scope")
      .eq("id", explicitOrganizationId)
      .maybeSingle();
    if (organizationError || !explicitOrganization?.id) {
      return jsonResponse({ error: "The selected organization could not be verified." }, 400);
    }
    const scopeFailure = organizationScopeFailure(explicitOrganization);
    if (scopeFailure) return admissionOutcomeResponse(scopeFailure, explicitOrganization.name);
    if (explicitOrganization.membership_scope !== "manual") {
      return admissionOutcomeResponse(
        explicitOrganization.membership_scope === "program" || explicitOrganization.membership_scope === "institution"
          ? "ACTIVATION_SYNC_REQUIRED"
          : "UNSUPPORTED_MEMBERSHIP_SCOPE",
        explicitOrganization.name,
      );
    }
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

  const membership = await ensureSuperAdminMemberships(
    adminClient,
    Number(student.id),
    program,
    input.organization_id,
    Number(activeTerm.id),
    Number(auth.adminProfile.id),
  );
  if (membership.error) {
    if (membership.admissionReason) {
      return admissionOutcomeResponse(membership.admissionReason, explicitOrganization?.name);
    }
    return jsonResponse({ error: "Student was enrolled, but organization membership could not be saved." }, 400);
  }
  const createdOrganizationIds = membership.createdOrganizationIds;
  const existingOrganizationIds = membership.existingOrganizationIds;
  const removedOrganizationIds = membership.removedOrganizationIds;
  const createdTermOrganizationIds = membership.createdTermOrganizationIds;

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
