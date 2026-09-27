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

function normalizeEmail(email: unknown) {
  return cleanText(email, 320).toLowerCase();
}

function genericLoginResponse() {
  return jsonResponse({
    data: {
      login_available: false,
      setup_required: false,
      legacy_migration_available: false,
      recovery_available: false,
      login_email: null,
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
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Server configuration is incomplete." }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const studentNumber = cleanText(body.student_number, 80);
  if (!studentNumber) return genericLoginResponse();

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } },
    auth: { persistSession: false },
  });

  const { data: studentRows, error: studentError } = await adminClient
    .from("students")
    .select("id, auth_user_id, student_number, email, status")
    .eq("student_number", studentNumber)
    .limit(2);

  if (studentError) {
    console.error("[resolve-student-login] student lookup failed", {
      code: studentError.code || null,
      message: studentError.message || "Unknown database error.",
    });
    return jsonResponse({ error: "Unable to verify student sign-in." }, 500);
  }

  if (!studentRows || studentRows.length !== 1) {
    return genericLoginResponse();
  }

  const student = studentRows[0];
  const studentEmail = normalizeEmail(student.email);

  if (!studentEmail || !["active", "pending"].includes(String(student.status || ""))) {
    return genericLoginResponse();
  }

  const { data: adminRows, error: adminError } = await adminClient
    .from("admin_users")
    .select("id, auth_user_id, email, status")
    .not("email", "is", null);

  if (adminError) {
    console.error("[resolve-student-login] admin collision lookup failed", {
      code: adminError.code || null,
      message: adminError.message || "Unknown database error.",
    });
    return jsonResponse({ error: "Unable to verify student sign-in." }, 500);
  }

  const adminEmailCollision = (adminRows || []).some((admin) =>
    normalizeEmail(admin.email) === studentEmail
  );

  if (adminEmailCollision) {
    return genericLoginResponse();
  }

  const { data: activeEmailRows, error: activeEmailError } = await adminClient
    .from("students")
    .select("id, email, status")
    .eq("status", "active")
    .not("email", "is", null);

  if (activeEmailError) {
    console.error("[resolve-student-login] student email uniqueness lookup failed", {
      code: activeEmailError.code || null,
      message: activeEmailError.message || "Unknown database error.",
    });
    return jsonResponse({ error: "Unable to verify student sign-in." }, 500);
  }

  const activeStudentEmailMatches = (activeEmailRows || []).filter((row) =>
    normalizeEmail(row.email) === studentEmail
  );

  if (student.status === "pending" && activeStudentEmailMatches.length > 0) {
    return genericLoginResponse();
  }

  if (
    student.status === "active" &&
    (
      activeStudentEmailMatches.length !== 1 ||
      Number(activeStudentEmailMatches[0].id) !== Number(student.id)
    )
  ) {
    return genericLoginResponse();
  }

  return jsonResponse({
    data: {
      login_available: student.status === "active" && Boolean(student.auth_user_id),
      setup_required: student.status === "pending",
      legacy_migration_available: student.status === "active" && !student.auth_user_id,
      recovery_available: student.status === "active" && Boolean(student.auth_user_id),
      login_email: studentEmail,
      auth_linked: Boolean(student.auth_user_id),
    },
  });
});
