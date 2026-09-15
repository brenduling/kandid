import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const semesters = new Set(["1st Semester", "2nd Semester"]);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function validateAcademicYear(startYear: unknown) {
  const year = Number(startYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    throw new Error("Enter a valid four-digit academic year start.");
  }

  return `${year}-${year + 1}`;
}

function sanitizeTermError(error: { code?: string; message?: string } | null) {
  if (!error) return "Academic term request failed.";
  const message = String(error.message || "").toLowerCase();

  if (error.code === "23505") return "That academic term already exists.";
  if (message.includes("only draft academic terms")) return "Only draft academic terms can be activated.";
  if (message.includes("no longer draft")) return "Academic term activation conflicted with another update.";
  if (message.includes("academic term is required")) return "Academic term is required.";

  return "Academic term request could not be completed.";
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

  if (userError || !user?.id) {
    return jsonResponse({ error: "Invalid or expired session." }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: adminProfile, error: adminError } = await adminClient
    .from("admin_users")
    .select("id, auth_user_id, email, role, status")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (adminError) {
    return jsonResponse({ error: "Unable to verify administrator access." }, 500);
  }

  if (
    !adminProfile ||
    adminProfile.auth_user_id !== user.id ||
    adminProfile.role !== "super_admin" ||
    adminProfile.status !== "active"
  ) {
    return jsonResponse({ error: "Super Admin authorization required." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  try {
    if (body.action === "create") {
      const semester = String(body.semester || "");
      if (!semesters.has(semester)) {
        return jsonResponse({ error: "Choose a supported semester." }, 400);
      }

      const academicYear = validateAcademicYear(body.startYear);
      const { data, error } = await adminClient
        .from("academic_terms")
        .insert([{ academic_year: academicYear, semester, status: "draft" }])
        .select("id, academic_year, semester, status, created_at, activated_at, closed_at")
        .single();

      if (error) return jsonResponse({ error: sanitizeTermError(error) }, 400);
      return jsonResponse({ data });
    }

    if (body.action === "activate") {
      const termId = Number(body.termId);
      if (!Number.isInteger(termId) || termId <= 0) {
        return jsonResponse({ error: "Academic term is required." }, 400);
      }

      const { data, error } = await adminClient.rpc("activate_academic_term", {
        target_term_id: termId,
      });

      if (error) return jsonResponse({ error: sanitizeTermError(error) }, 400);
      return jsonResponse({ data });
    }
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Request failed." },
      400,
    );
  }

  return jsonResponse({ error: "Unsupported academic term action." }, 400);
});
