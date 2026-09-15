import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  adminClient: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const studentNumber = cleanText(body.student_number, 80);
  const password = String(body.password || "");

  if (!studentNumber || !password) {
    return jsonResponse({ error: "Student credentials are required." }, 401);
  }

  const { data: student, error: studentError } = await adminClient
    .from("students")
    .select("id, password, status")
    .eq("student_number", studentNumber)
    .maybeSingle();

  if (studentError || !student || student.password !== password) {
    return jsonResponse({ error: "Invalid student credentials." }, 401);
  }

  if (student.status === "pending" || student.status === "disabled") {
    return jsonResponse({ error: "Student account is not active." }, 403);
  }

  const { data: activeTerm, error: termError } = await loadActiveTerm(adminClient);
  if (termError || !activeTerm?.id) {
    return jsonResponse({ error: "Active academic term could not be verified." }, 409);
  }

  const { data: organizations, error: organizationError } = await adminClient
    .from("organizations")
    .select("id")
    .order("id", { ascending: true });

  if (organizationError) {
    return jsonResponse({ error: "Unable to load organizations." }, 500);
  }

  const organizationIds: number[] = [];
  for (const organization of organizations || []) {
    const { data: participationRows, error } = await adminClient.rpc(
      "resolve_student_organization_participation",
      {
        target_student_id: Number(student.id),
        target_organization_id: Number(organization.id),
        target_academic_term_id: Number(activeTerm.id),
      },
    );

    const participation = Array.isArray(participationRows)
      ? participationRows[0]
      : participationRows;

    if (!error && participation?.allowed === true) {
      organizationIds.push(Number(organization.id));
    }
  }

  return jsonResponse({ data: { organization_ids: organizationIds, academic_term: activeTerm } });
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
  for (const enrollment of enrollments || []) {
    const { data: participationRows, error } = await adminClient.rpc(
      "resolve_student_organization_participation",
      {
        target_student_id: Number(enrollment.student_id),
        target_organization_id: organizationId,
        target_academic_term_id: Number(activeTerm.id),
      },
    );

    const participation = Array.isArray(participationRows)
      ? participationRows[0]
      : participationRows;

    if (!error && participation?.allowed === true) {
      eligibleEnrollments.push(enrollment);
    }
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
      return await handleStudentOrganizationIds(adminClient, body);
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
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Request could not be completed." },
      400,
    );
  }

  return jsonResponse({ error: "Unsupported action." }, 400);
});
