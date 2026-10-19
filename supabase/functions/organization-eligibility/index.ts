import { corsHeaders, handleCorsPreflight, rejectDisallowedOrigin, serveWithKandidCors } from "../_shared/kandidProductionSecurity.mjs";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


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

function parsePositiveInteger(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} is required.`);
  }
  return number;
}

async function loadActiveTerm(adminClient: ReturnType<typeof createClient>) {
  return await adminClient
    .from("academic_terms")
    .select("id, academic_year, semester, status")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
}

function uniquePositiveIds(value: unknown, max = 100) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, max);
}

/**
 * Canonical Phase 1B-A current-membership reader. Candidate rows come only from
 * active term participation and same-term enrolled records, then pass the
 * Phase 1A resolver so membership_scope rules and fail-closed validation remain
 * authoritative. student_organizations is intentionally not consulted.
 */
async function loadCanonicalMembershipRows(
  adminClient: ReturnType<typeof createClient>,
  activeTerm: Record<string, unknown>,
  { organizationId, studentIds, includeStudentEmail = false }: {
    organizationId?: number;
    studentIds?: number[];
    includeStudentEmail?: boolean;
  } = {},
) {
  let participationQuery = adminClient
    .from("student_organization_terms")
    .select("student_id, organization_id, source")
    .eq("academic_term_id", Number(activeTerm.id))
    .eq("status", "active")
    .order("organization_id", { ascending: true })
    .order("student_id", { ascending: true });

  if (organizationId) participationQuery = participationQuery.eq("organization_id", organizationId);
  if (studentIds?.length) participationQuery = participationQuery.in("student_id", studentIds);

  const participationRows: Array<Record<string, unknown>> = [];
  for (let from = 0;; from += 1000) {
    const { data, error } = await participationQuery.range(from, from + 999);
    if (error) throw new Error("Unable to load active-term organization participation.");
    participationRows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  if (!participationRows.length) return [];

  const candidateStudentIds = [...new Set(participationRows.map((row) => Number(row.student_id)))];
  const enrollmentRows: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < candidateStudentIds.length; offset += 500) {
    const { data, error } = await adminClient
      .from("student_term_enrollments")
      .select("student_id, program, year_level")
      .eq("academic_term_id", Number(activeTerm.id))
      .eq("enrollment_status", "enrolled")
      .in("student_id", candidateStudentIds.slice(offset, offset + 500));
    if (error) throw new Error("Unable to verify active-term student enrollment.");
    enrollmentRows.push(...(data || []));
  }

  const enrollmentByStudentId = new Map(
    (enrollmentRows || []).map((row) => [Number(row.student_id), row]),
  );
  const enrolledCandidates = participationRows.filter((row) =>
    enrollmentByStudentId.has(Number(row.student_id)),
  );
  const allowedRows: Array<Record<string, unknown>> = [];
  const resolverBatchSize = 8;

  for (let offset = 0; offset < enrolledCandidates.length; offset += resolverBatchSize) {
    const batch = enrolledCandidates.slice(offset, offset + resolverBatchSize);
    const resolved = await Promise.all(batch.map(async (row) => {
      const { data, error } = await adminClient.rpc("resolve_student_organization_participation", {
        target_student_id: Number(row.student_id),
        target_organization_id: Number(row.organization_id),
        target_academic_term_id: Number(activeTerm.id),
      });
      if (error) throw new Error("Unable to verify current organization membership.");
      const result = Array.isArray(data) ? data[0] : data;
      return result?.allowed === true ? { ...row, source: result.source || row.source } : null;
    }));
    allowedRows.push(...resolved.filter(Boolean));
  }

  if (!allowedRows.length) return [];
  const allowedStudentIds = [...new Set(allowedRows.map((row) => Number(row.student_id)))];
  const allowedOrganizationIds = [...new Set(allowedRows.map((row) => Number(row.organization_id)))];
  const students: Array<Record<string, unknown>> = [];
  const organizations: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < allowedStudentIds.length; offset += 500) {
    const { data, error } = await adminClient.from("students")
      .select(includeStudentEmail
        ? "id, student_number, first_name, last_name, email, photo_url, status, created_at"
        : "id, student_number, first_name, last_name, photo_url, status, created_at")
      .in("id", allowedStudentIds.slice(offset, offset + 500));
    if (error) throw new Error("Unable to load current organization membership details.");
    students.push(...(data || []));
  }
  for (let offset = 0; offset < allowedOrganizationIds.length; offset += 500) {
    const { data, error } = await adminClient.from("organizations")
      .select("id, name, description, organization_type, membership_scope, logo_url")
      .in("id", allowedOrganizationIds.slice(offset, offset + 500));
    if (error) throw new Error("Unable to load current organization membership details.");
    organizations.push(...(data || []));
  }

  const studentsById = new Map((students || []).map((student) => [Number(student.id), student]));
  const organizationsById = new Map((organizations || []).map((organization) => [Number(organization.id), organization]));

  return allowedRows
    .map((row) => {
      const studentId = Number(row.student_id);
      const currentOrganizationId = Number(row.organization_id);
      const enrollment = enrollmentByStudentId.get(studentId);
      const student = studentsById.get(studentId);
      const organization = organizationsById.get(currentOrganizationId);
      if (!student || !organization || !enrollment) return null;
      return {
        student_id: studentId,
        organization_id: currentOrganizationId,
        academic_term_id: Number(activeTerm.id),
        membership_status: "active",
        source: row.source || null,
        program: enrollment.program || null,
        year_level: enrollment.year_level || null,
        student,
        organization,
      };
    })
    .filter(Boolean)
    .sort((left, right) =>
      `${left.organization_id}:${left.student.last_name || ""} ${left.student.first_name || ""}`.localeCompare(
        `${right.organization_id}:${right.student.last_name || ""} ${right.student.first_name || ""}`,
      ),
    );
}

async function requireAdmin(
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
    return { response: jsonResponse({ error: "Unable to verify administrator access." }, 500) };
  }

  if (
    !adminProfile ||
    adminProfile.auth_user_id !== user.id ||
    !["super_admin", "electoral_board"].includes(adminProfile.role) ||
    adminProfile.status !== "active"
  ) {
    return { response: jsonResponse({ error: "Active administrator authorization required." }, 403) };
  }

  return { adminClient, adminProfile };
}

async function handleStudentOrganizationIds(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  adminClient: ReturnType<typeof createClient>,
) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return jsonResponse({ error: "Authentication required." }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: userError } = await authClient.auth.getUser();
  if (userError || !user?.id) {
    return jsonResponse({ error: "Invalid or expired session." }, 401);
  }

  const { data: matchingStudents, error: studentError } = await adminClient
    .from("students")
    .select("id, auth_user_id, status")
    .eq("auth_user_id", user.id)
    .limit(2);

  if (studentError) {
    return jsonResponse({ error: "Student identity could not be verified." }, 500);
  }

  if (!Array.isArray(matchingStudents) || matchingStudents.length !== 1) {
    return jsonResponse({ error: "Student identity could not be verified." }, 403);
  }
  const student = matchingStudents[0];
  if (student.auth_user_id !== user.id || student.status !== "active") {
    return jsonResponse({ error: "Student account is not active." }, 403);
  }

  const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);
  if (termError || !activeTerm?.id) {
    return jsonResponse({ error: "Active academic term could not be verified." }, 409);
  }

  const memberships = await loadCanonicalMembershipRows(adminClient, activeTerm, {
    studentIds: [Number(student.id)],
  });
  const organizationIds = [...new Set(memberships.map((membership) => Number(membership.organization_id)))];
  return jsonResponse({
    data: {
      organization_ids: organizationIds,
      memberships,
      academic_term: activeTerm,
    },
  });
}

async function handleCurrentOrganizationMembers(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
  body: Record<string, unknown>,
) {
  const auth = await requireAdmin(request, supabaseUrl, anonKey, serviceRoleKey);
  if ("response" in auth) return auth.response;

  const organizationId = parsePositiveInteger(body.organization_id, "Organization");
  const { adminClient, adminProfile } = auth;
  if (
    adminProfile.role === "electoral_board" &&
    Number(adminProfile.organization_id) !== organizationId
  ) {
    return jsonResponse({ error: "This board account cannot access that organization." }, 403);
  }

  const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);
  if (termError || !activeTerm?.id) {
    return jsonResponse({ error: "Active academic term could not be verified." }, 409);
  }
  const { data: organization, error: organizationError } = await adminClient
    .from("organizations")
    .select("id, name, organization_type, membership_scope")
    .eq("id", organizationId)
    .maybeSingle();
  if (organizationError) return jsonResponse({ error: "Unable to load organization." }, 500);
  if (!organization) return jsonResponse({ error: "Organization is unavailable." }, 404);

  const members = await loadCanonicalMembershipRows(adminClient, activeTerm, {
    organizationId,
    includeStudentEmail: adminProfile.role === "super_admin",
  });
  return jsonResponse({
    data: { organization, members, count: members.length, academic_term: activeTerm },
  });
}

async function handleCurrentMembershipsForStudents(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
  body: Record<string, unknown>,
) {
  const auth = await requireAdmin(request, supabaseUrl, anonKey, serviceRoleKey);
  if ("response" in auth) return auth.response;
  if (auth.adminProfile.role !== "super_admin") {
    return jsonResponse({ error: "Super Admin access is required." }, 403);
  }

  const studentIds = uniquePositiveIds(body.student_ids, 100);
  if (!Array.isArray(body.student_ids) || body.student_ids.length > 100) {
    return jsonResponse({ error: "Student membership request is invalid." }, 400);
  }
  if (!studentIds.length) {
    return jsonResponse({ data: { memberships: [], academic_term: null } });
  }
  const { data: activeTerm, error: termError } = await loadActiveTerm(auth.adminClient);
  if (termError || !activeTerm?.id) {
    return jsonResponse({ error: "Active academic term could not be verified." }, 409);
  }
  const memberships = await loadCanonicalMembershipRows(auth.adminClient, activeTerm, {
    studentIds,
    includeStudentEmail: true,
  });
  return jsonResponse({ data: { memberships, academic_term: activeTerm } });
}

async function handleEligibleStudentsForOrganization(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
  body: Record<string, unknown>,
) {
  const auth = await requireAdmin(request, supabaseUrl, anonKey, serviceRoleKey);
  if ("response" in auth) return auth.response;

  const organizationId = parsePositiveInteger(body.organization_id, "Organization");
  const { adminClient, adminProfile } = auth;

  if (
    adminProfile.role === "electoral_board" &&
    Number(adminProfile.organization_id) !== Number(organizationId)
  ) {
    return jsonResponse({ error: "This board account cannot access that organization." }, 403);
  }

  const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);
  if (termError || !activeTerm?.id) {
    return jsonResponse({ error: "Active academic term could not be verified." }, 409);
  }

  const { data: enrollments, error: enrollmentError } = await adminClient
    .from("student_term_enrollments")
    .select("student_id, program, year_level")
    .eq("academic_term_id", activeTerm.id)
    .eq("enrollment_status", "enrolled");

  if (enrollmentError) {
    return jsonResponse({ error: "Unable to load active-term enrollments." }, 500);
  }

  const eligibleEnrollments = [];
  const resolverBatchSize = 8;
  const enrolledRows = enrollments || [];
  for (let offset = 0; offset < enrolledRows.length; offset += resolverBatchSize) {
    const batch = enrolledRows.slice(offset, offset + resolverBatchSize);
    const results = await Promise.all(batch.map(async (enrollment) => {
      const { data: participationRows, error } = await adminClient.rpc(
        "resolve_student_organization_participation",
        {
          target_student_id: Number(enrollment.student_id),
          target_organization_id: organizationId,
          target_academic_term_id: Number(activeTerm.id),
        },
      );

      if (error) throw new Error("Unable to verify student eligibility.");

      const participation = Array.isArray(participationRows)
        ? participationRows[0]
        : participationRows;

      return participation?.allowed === true ? enrollment : null;
    }));
    eligibleEnrollments.push(...results.filter(Boolean));
  }

  const studentIds = eligibleEnrollments
    .map((enrollment) => Number(enrollment.student_id))
    .filter(Boolean);

  if (studentIds.length === 0) {
    return jsonResponse({ data: { students: [], academic_term: activeTerm } });
  }

  const { data: students, error: studentError } = await adminClient
    .from("students")
    .select("id, student_number, first_name, last_name, photo_url, status")
    .in("id", studentIds);

  if (studentError) {
    return jsonResponse({ error: "Unable to load eligible students." }, 500);
  }

  const enrollmentByStudentId = new Map(
    eligibleEnrollments.map((enrollment) => [Number(enrollment.student_id), enrollment]),
  );

  const rows = (students || [])
    .map((student) => {
      const enrollment = enrollmentByStudentId.get(Number(student.id));
      return {
        ...student,
        program: enrollment?.program || null,
        year_level: enrollment?.year_level || null,
      };
    })
    .sort((left, right) =>
      `${left.last_name || ""} ${left.first_name || ""}`.localeCompare(
        `${right.last_name || ""} ${right.first_name || ""}`,
      )
    );

  return jsonResponse({ data: { students: rows, academic_term: activeTerm } });
}

async function handleCurrentOrganizationMemberCount(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  adminClient: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return jsonResponse({ error: "Authentication required." }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: userError } = await authClient.auth.getUser();
  if (userError || !user?.id) return jsonResponse({ error: "Invalid or expired session." }, 401);

  const [
    { data: student, error: studentError },
    { data: superAdmin, error: adminError },
  ] = await Promise.all([
    adminClient.from("students")
      .select("id")
      .eq("auth_user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
    adminClient.from("admin_users")
      .select("id, auth_user_id, role, status")
      .eq("auth_user_id", user.id)
      .eq("role", "super_admin")
      .eq("status", "active")
      .maybeSingle(),
  ]);
  if (studentError || adminError) {
    return jsonResponse({ error: "Membership access could not be verified." }, 500);
  }
  const isActiveStudent = Boolean(student?.id);
  const isActiveSuperAdmin = Boolean(superAdmin?.id && superAdmin.auth_user_id === user.id);
  if (!isActiveStudent && !isActiveSuperAdmin) {
    return jsonResponse({ error: "An authorized student or Super Admin session is required." }, 403);
  }

  let organizationId: number;
  try {
    organizationId = parsePositiveInteger(body.organization_id, "Organization");
  } catch {
    return jsonResponse({ error: "Invalid organization request." }, 400);
  }

  const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);
  if (termError || !activeTerm?.id) {
    return jsonResponse({ error: "Active academic term could not be verified." }, 409);
  }
  const members = await loadCanonicalMembershipRows(adminClient, activeTerm, { organizationId });
  const memberIds = [...new Set(members.map((membership) => Number(membership.student_id)))];

  return jsonResponse({
    data: {
      count: memberIds.length,
      academic_term: activeTerm,
      ...(isActiveSuperAdmin && body.include_member_ids === true
        ? { member_student_ids: memberIds.sort((left, right) => left - right) }
        : {}),
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const action = cleanText(body.action, 80);

  try {
    if (action === "student_organization_ids") {
      return await handleStudentOrganizationIds(request, supabaseUrl, anonKey, adminClient);
    }

    if (action === "eligible_students_for_organization") {
      return await handleEligibleStudentsForOrganization(
        request,
        supabaseUrl,
        anonKey,
        serviceRoleKey,
        body,
      );
    }

    if (action === "current_organization_member_count") {
      return await handleCurrentOrganizationMemberCount(
        request,
        supabaseUrl,
        anonKey,
        adminClient,
        body,
      );
    }

    if (action === "current_organization_members") {
      return await handleCurrentOrganizationMembers(
        request,
        supabaseUrl,
        anonKey,
        serviceRoleKey,
        body,
      );
    }

    if (action === "current_memberships_for_students") {
      return await handleCurrentMembershipsForStudents(
        request,
        supabaseUrl,
        anonKey,
        serviceRoleKey,
        body,
      );
    }
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Request could not be completed." },
      400,
    );
  }

  return jsonResponse({ error: "Unsupported action." }, 400);
});
