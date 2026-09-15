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

function safeLinkingError(status = 403) {
  return jsonResponse({ error: "Student identity could not be linked." }, status);
}

function logLinkFailure(reason: string, details: Record<string, unknown> = {}) {
  console.warn("[link-student-identity] link rejected", {
    reason,
    ...details,
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

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user?.id || !user.email) {
    return jsonResponse({ error: "Invalid or expired session." }, 401);
  }

  if (!user.email_confirmed_at) {
    logLinkFailure("auth_email_not_verified", {
      auth_user_id: user.id,
    });
    return safeLinkingError(403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const studentNumber = cleanText(body.student_number, 80);
  const legacyPassword = String(body.legacy_password || "");
  const setupMode = body.setup_mode === true;

  if (!studentNumber || (!legacyPassword && !setupMode)) {
    return safeLinkingError(401);
  }

  const verifiedEmail = normalizeEmail(user.email);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } },
    auth: { persistSession: false },
  });

  const { data: privilegedAuthProfiles, error: privilegedAuthError } = await adminClient
    .from("admin_users")
    .select("id, auth_user_id, email, role, status")
    .eq("auth_user_id", user.id)
    .limit(2);

  if (privilegedAuthError) {
    console.error("[link-student-identity] privileged collision check failed", {
      code: privilegedAuthError.code || null,
      message: privilegedAuthError.message || "Unknown database error.",
    });
    return jsonResponse({ error: "Unable to verify account eligibility." }, 500);
  }

  const { data: privilegedEmailRows, error: privilegedEmailError } = await adminClient
    .from("admin_users")
    .select("id, auth_user_id, email, role, status")
    .not("email", "is", null);

  if (privilegedEmailError) {
    console.error("[link-student-identity] privileged email collision check failed", {
      code: privilegedEmailError.code || null,
      message: privilegedEmailError.message || "Unknown database error.",
    });
    return jsonResponse({ error: "Unable to verify account eligibility." }, 500);
  }

  const privilegedEmailProfiles = (privilegedEmailRows || []).filter((profile) =>
    normalizeEmail(profile.email) === verifiedEmail
  );

  if ((privilegedAuthProfiles || []).length > 0 || privilegedEmailProfiles.length > 0) {
    logLinkFailure("privileged_identity_collision", {
      auth_user_id: user.id,
    });
    return safeLinkingError(409);
  }

  const { data: existingLinks, error: existingLinkError } = await adminClient
    .from("students")
    .select("id, auth_user_id, student_number, email, status")
    .eq("auth_user_id", user.id)
    .limit(2);

  if (existingLinkError) {
    console.error("[link-student-identity] existing student link check failed", {
      code: existingLinkError.code || null,
      message: existingLinkError.message || "Unknown database error.",
    });
    return jsonResponse({ error: "Unable to verify existing student link." }, 500);
  }

  const { data: studentRows, error: studentLookupError } = await adminClient
    .from("students")
    .select("id, auth_user_id, student_number, email, password, status")
    .eq("student_number", studentNumber)
    .limit(2);

  if (studentLookupError) {
    console.error("[link-student-identity] student lookup failed", {
      code: studentLookupError.code || null,
      message: studentLookupError.message || "Unknown database error.",
    });
    return jsonResponse({ error: "Unable to verify student account." }, 500);
  }

  if (!studentRows || studentRows.length !== 1) {
    logLinkFailure("student_number_not_unique_or_missing", {
      auth_user_id: user.id,
    });
    return safeLinkingError(401);
  }

  const student = studentRows[0];

  const existingSameStudentLink =
    existingLinks?.length === 1 && Number(existingLinks[0].id) === Number(student.id);

  if (existingLinks?.length && !existingSameStudentLink) {
    logLinkFailure("auth_user_already_linked_to_other_student", {
      auth_user_id: user.id,
    });
    return safeLinkingError(409);
  }

  if (student.status !== "active" && !(setupMode && student.status === "pending")) {
    logLinkFailure("student_status_not_active", {
      student_id: student.id,
      status: student.status || null,
    });
    return safeLinkingError(403);
  }

  if (!setupMode && student.password !== legacyPassword) {
    logLinkFailure("legacy_credentials_invalid", {
      student_id: student.id,
    });
    return safeLinkingError(401);
  }

  const studentEmail = normalizeEmail(student.email);
  if (!studentEmail || studentEmail !== verifiedEmail) {
    logLinkFailure("student_email_mismatch", {
      student_id: student.id,
      auth_user_id: user.id,
    });
    return safeLinkingError(403);
  }

  if (student.auth_user_id && student.auth_user_id !== user.id) {
    logLinkFailure("student_already_linked_to_other_auth_user", {
      student_id: student.id,
    });
    return safeLinkingError(409);
  }

  const { data: emailRows, error: emailLookupError } = await adminClient
    .from("students")
    .select("id, email, status")
    .not("email", "is", null);

  if (emailLookupError) {
    console.error("[link-student-identity] student email collision check failed", {
      code: emailLookupError.code || null,
      message: emailLookupError.message || "Unknown database error.",
    });
    return jsonResponse({ error: "Unable to verify student email uniqueness." }, 500);
  }

  const activeEmailMatches = (emailRows || []).filter((row) =>
    row.status === "active" && normalizeEmail(row.email) === studentEmail
  );

  const activeEmailMatchesExpected =
    student.status === "active"
      ? activeEmailMatches.length === 1 &&
        Number(activeEmailMatches[0].id) === Number(student.id)
      : activeEmailMatches.length === 0;

  if (!activeEmailMatchesExpected) {
    logLinkFailure("active_student_email_not_unique", {
      student_id: student.id,
      match_count: activeEmailMatches.length,
    });
    return safeLinkingError(409);
  }

  if (student.auth_user_id === user.id && existingSameStudentLink && student.status === "active") {
    return jsonResponse({
      linked: true,
      student: {
        id: student.id,
        student_number: student.student_number,
        email: student.email,
        status: student.status,
      },
    });
  }

  let linkUpdate = adminClient
    .from("students")
    .update({
      auth_user_id: user.id,
      ...(setupMode && student.status === "pending" ? { status: "active" } : {}),
    })
    .eq("id", student.id);

  linkUpdate = student.auth_user_id
    ? linkUpdate.eq("auth_user_id", user.id)
    : linkUpdate.is("auth_user_id", null);

  const { data: linkedStudent, error: updateError } = await linkUpdate
    .select("id, student_number, email, status")
    .single();

  if (updateError) {
    console.error("[link-student-identity] student link update failed", {
      code: updateError.code || null,
      message: updateError.message || "Unknown database error.",
    });
    return safeLinkingError(409);
  }

  return jsonResponse({
    linked: true,
    student: linkedStudent,
  });
});
