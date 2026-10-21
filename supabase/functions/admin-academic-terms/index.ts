import { corsHeaders, handleCorsPreflight, rejectDisallowedOrigin, serveWithKandidCors } from "../_shared/kandidProductionSecurity.mjs";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.1";


const semesters = new Set(["1st Semester", "2nd Semester"]);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
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
  if (error.code === "42501") return "Super Admin authorization could not be verified.";
  if (error.code === "P0002") return "The academic term or transition review is unavailable for this administrator.";
  if (error.code === "55P03") return "Term or enrollment management is busy. Refresh the impact preview and retry.";
  if (error.code === "40001") return "The impact review expired or changed. Preview and confirm again.";
  if (error.code === "55000" || error.code === "23514") return "The transition has blocking impacts. Review the preview before continuing.";
  if (error.code === "22023") return "Choose a valid term and provide the required acknowledgement and exact confirmation.";
  if (error.code === "PGRST202" || error.code === "42883") return "Academic term backend is not installed or its API schema is out of date. Ask an administrator to complete the approved deployment.";
  if (message.includes("only draft academic terms")) return "Only draft academic terms can be activated.";
  if (message.includes("no longer draft")) return "Academic term activation conflicted with another update.";
  if (message.includes("academic term is required")) return "Academic term is required.";

  return "Academic term request could not be completed.";
}

function termErrorResponse(error: { code?: string; message?: string }) {
  const status = error.code === "42501" ? 403
    : error.code === "P0002" ? 404
    : ["40001", "55P03", "55000", "23514", "23505"].includes(error.code || "") ? 409
    : error.code === "22023" ? 400 : 503;
  return jsonResponse({ error: sanitizeTermError(error) }, status);
}

const fields: Record<string, string[]> = {
  create: ["action", "semester", "startYear"],
  preview: ["action", "termId"],
  activate: ["action", "operationId", "acknowledged", "confirmationText"],
  transition_status: ["action", "operationId"],
};
const isPositiveInteger = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

serveWithKandidCors(async (request: Request) => {
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

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }

  try {
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
      .limit(2);

    if (adminError) {
      return jsonResponse({ error: "Unable to verify administrator access." }, 500);
    }

    if (
      !Array.isArray(adminProfile) || adminProfile.length !== 1 ||
      adminProfile[0].auth_user_id !== user.id ||
      adminProfile[0].role !== "super_admin" ||
      adminProfile[0].status !== "active"
    ) {
      return jsonResponse({ error: "Super Admin authorization required." }, 403);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    if (!body || Array.isArray(body) || typeof body !== "object" ||
      typeof body.action !== "string" || !Object.hasOwn(fields, body.action) ||
      Object.keys(body).some((key) => !fields[String(body.action)].includes(key))) {
      return jsonResponse({ error: "Unsupported academic term action or field." }, 400);
    }

    try {
      if (body.action === "create") {
        const semester = String(body.semester || "");
        if (!semesters.has(semester)) {
          return jsonResponse({ error: "Choose a supported semester." }, 400);
        }

        validateAcademicYear(body.startYear);
        const { data, error } = await adminClient.rpc("kandid_create_next_academic_term", {
          p_actor_auth_user_id: user.id, p_semester: semester, p_start_year: Number(body.startYear),
        });

        if (error) return termErrorResponse(error);
        if (!data?.id || data.status !== "draft") return jsonResponse({ error: "Draft creation could not be verified. Refresh the term list before retrying." }, 503);
        return jsonResponse({ data });
      }

      if (body.action === "preview") {
        if (!isPositiveInteger(body.termId)) {
          return jsonResponse({ error: "Academic term is required." }, 400);
        }
        const { data, error } = await adminClient.rpc("kandid_preview_academic_term_transition", {
          p_actor_auth_user_id: user.id,
          p_target_term_id: body.termId,
        });
        if (error) return termErrorResponse(error);
        if (!data?.operation_id || !data?.impact) return jsonResponse({ error: "Impact preview could not be verified." }, 503);
        return jsonResponse({ data });
      }
      if (body.action === "activate" || body.action === "transition_status") {
        if (!isUuid(body.operationId)) return jsonResponse({ error: "A valid transition review is required." }, 400);
        if (body.action === "activate" && (body.acknowledged !== true || typeof body.confirmationText !== "string" || body.confirmationText.length > 160)) {
          return jsonResponse({ error: "Explicit acknowledgement and exact term confirmation are required." }, 400);
        }
        const rpcName = body.action === "activate" ? "kandid_commit_academic_term_transition" : "kandid_get_academic_term_transition";
        const { data, error } = await adminClient.rpc(rpcName, {
          p_actor_auth_user_id: user.id,
          p_operation_id: body.operationId,
          ...(body.action === "activate" ? { p_acknowledged: true, p_confirmation_text: body.confirmationText } : {}),
        });
        if (error) return termErrorResponse(error);
        if (!data?.operation_id || (body.action === "activate" && data.status !== "committed")) {
          return jsonResponse({ error: "Transition outcome is unconfirmed. Check the transition status before retrying." }, 503);
        }
        return jsonResponse({ data });
      }
    } catch (error) {
      const invalidYear = body.action === "create" && error instanceof Error && error.message === "Enter a valid four-digit academic year start.";
      return jsonResponse(
        { error: invalidYear
          ? "Enter a valid four-digit academic year start." : "Academic term request could not be completed. Check transition status before retrying activation." },
        invalidYear ? 400 : 503,
      );
    }

    return jsonResponse({ error: "Unsupported academic term action." }, 400);
  } catch {
    return jsonResponse({ error: "Academic term service is unavailable. Check transition status before retrying activation." }, 503);
  }
});
