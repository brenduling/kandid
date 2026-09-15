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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function logStage(stage: string, details: Record<string, unknown> = {}) {
  console.log(`[link-admin-identity] ${stage}`, details);
}

function logDbFailure(stage: string, error: { code?: string; message?: string } | null) {
  console.error(`[link-admin-identity] ${stage}`, {
    code: error?.code || null,
    message: error?.message || "Unknown database error.",
  });
}

Deno.serve(async (request) => {
  logStage("start", { method: request.method });

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const linkingEnabled = Deno.env.get("KANDID_ADMIN_IDENTITY_LINKING_ENABLED") === "true";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Server configuration is incomplete." }, 500);
  }

  if (!linkingEnabled) {
    return jsonResponse({ error: "Administrator identity linking is not enabled." }, 403);
  }

  logStage("feature-flag-ok");

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

  logStage("auth-user-resolved", {
    user_id: user.id,
    email: normalizeEmail(user.email),
  });

  if (!user.email_confirmed_at) {
    return jsonResponse({ error: "Verified email is required before linking." }, 403);
  }

  logStage("confirmed-email-ok");

  const verifiedEmail = normalizeEmail(user.email);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } },
    auth: { persistSession: false },
  });

  logStage("admin-profile-query-start", { query: "existing-auth-user-link" });

  const { data: existingProfile, error: existingError } = await adminClient
    .from("admin_users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (existingError) {
    logDbFailure("admin-profile-query-failed", existingError);
    return jsonResponse({ error: "Unable to verify existing administrator link." }, 500);
  }

  if (existingProfile) {
    logStage("admin-profile-found", {
      profile_id: existingProfile.id,
      already_linked: true,
    });

    const { data: linkedProfile, error: linkedError } = await adminClient
      .from("admin_users")
      .select("id, auth_user_id, email, full_name, role, status, organization_id")
      .eq("auth_user_id", user.id)
      .single();

    if (linkedError) {
      logDbFailure("admin-profile-query-failed", linkedError);
      return jsonResponse({ error: "Unable to verify existing administrator link." }, 500);
    }

    logStage("linked-successfully", {
      profile_id: linkedProfile.id,
      already_linked: true,
    });

    return jsonResponse({ data: linkedProfile, already_linked: true });
  }

  logStage("admin-profile-query-start", { query: "verified-email-candidate" });

  const { data: candidateRows, error: lookupError } = await adminClient
    .from("admin_users")
    .select("id, auth_user_id, email, role, status")
    .eq("email", verifiedEmail)
    .limit(2);

  if (lookupError) {
    logDbFailure("admin-profile-query-failed", lookupError);
    return jsonResponse({ error: "Unable to find administrator profile." }, 500);
  }

  if (!candidateRows || candidateRows.length === 0) {
    return jsonResponse({ error: "No administrator profile matches this verified email." }, 403);
  }

  if (candidateRows.length > 1) {
    return jsonResponse({ error: "Administrator email is not unique." }, 409);
  }

  const candidate = candidateRows[0];

  logStage("admin-profile-found", {
    profile_id: candidate.id,
    role: candidate.role,
    status: candidate.status,
    has_auth_user_id: Boolean(candidate.auth_user_id),
  });

  if (candidate.auth_user_id) {
    return jsonResponse({ error: "Administrator profile is already linked." }, 409);
  }

  if (candidate.status !== "active") {
    return jsonResponse({ error: "Administrator profile is disabled." }, 403);
  }

  if (!["super_admin", "electoral_board"].includes(candidate.role)) {
    return jsonResponse({ error: "Administrator role is not supported for linking." }, 403);
  }

  logStage("atomic-link-start", { profile_id: candidate.id });

  const { data: linkedProfile, error: updateError } = await adminClient
    .from("admin_users")
    .update({ auth_user_id: user.id })
    .eq("id", candidate.id)
    .is("auth_user_id", null)
    .select("id, auth_user_id, email, full_name, role, status, organization_id")
    .single();

  if (updateError) {
    logDbFailure("atomic-link-failed", updateError);
    return jsonResponse({ error: updateError.message }, 400);
  }

  logStage("linked-successfully", { profile_id: linkedProfile.id });

  return jsonResponse({ data: linkedProfile });
});
