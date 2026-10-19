import { corsHeaders, handleCorsPreflight, rejectDisallowedOrigin, serveWithKandidCors } from "../_shared/kandidProductionSecurity.mjs";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.1";


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

async function resolveStudent(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  adminClient: ReturnType<typeof createClient>,
) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return { response: jsonResponse({ error: "Authentication required." }, 401) };
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user?.id || !user.email_confirmed_at || !user.email) {
    return { response: jsonResponse({ error: "Invalid or expired session." }, 401) };
  }

  // Read up to two mappings so both missing and ambiguous identities fail closed.
  const { data: students, error } = await adminClient
    .from("students")
    .select("id, auth_user_id, status, email")
    .eq("auth_user_id", user.id)
    .limit(2);

  if (error) {
    return { response: jsonResponse({ error: "Student access could not be verified." }, 500) };
  }

  if (!Array.isArray(students) || students.length !== 1) {
    return { response: jsonResponse({ error: "A unique active student account is required." }, 403) };
  }

  const student = students[0];
  if (student.auth_user_id !== user.id || student.status !== "active" || String(student.email || "").trim().toLowerCase() !== user.email.trim().toLowerCase()) {
    return { response: jsonResponse({ error: "A unique active student account is required." }, 403) };
  }
  return { student };
}

async function handleList(
  adminClient: ReturnType<typeof createClient>,
  studentId: number,
  body: Record<string, unknown>,
) {
  const limit = body.limit === undefined ? 20 : Number(body.limit);
  const offset = body.offset === undefined ? 0 : Number(body.offset);
  const { data, error } = await adminClient
    .from("student_notifications")
    .select("id, type, title, message, metadata, is_read, created_at, read_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);

  if (error || !Array.isArray(data)) {
    return jsonResponse({ error: "Unable to load notifications." }, 500);
  }

  // Metadata is not a general-purpose data export or external redirect.
  const notifications = data.slice(0, limit).map(row => ({ ...row, metadata: {
    href: typeof row.metadata?.href === "string" && /^\/student\/(?!\/)[a-z0-9/?=&_%#.-]*$/i.test(row.metadata.href)
      ? row.metadata.href : "/student/notifications",
  } }));
  return jsonResponse({ data: { notifications, limit, offset, has_more: data.length > limit } });
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
  if (!body || Array.isArray(body) || typeof body !== "object") return jsonResponse({ error: "Invalid request." }, 400);
  const action = body.action;
  // Production deployment is read-only. No acknowledgement handler is included.
  if (action !== "list") return jsonResponse({ error: "Notification writes are disabled.", code: "notification_writes_disabled" }, 403);
  const fields = action === "list" ? ["action", "limit", "offset"] : action === "mark_read" ? ["action", "notification_id"] : [];
  if (!fields.length || Object.keys(body).some(key => !fields.includes(key)) ||
    (action === "list" && ((body.limit !== undefined && (!Number.isInteger(body.limit) || Number(body.limit) < 1 || Number(body.limit) > 50)) ||
      (body.offset !== undefined && (!Number.isInteger(body.offset) || Number(body.offset) < 0 || Number(body.offset) > 10000)))) ||
    (action === "mark_read" && (!Number.isSafeInteger(body.notification_id) || Number(body.notification_id) <= 0))) {
    return jsonResponse({ error: "Unsupported notification request." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let resolved: Awaited<ReturnType<typeof resolveStudent>>;
  try {
    resolved = await resolveStudent(request, supabaseUrl, anonKey, adminClient);
  } catch {
    return jsonResponse({ error: "Student access could not be verified." }, 500);
  }
  if ("response" in resolved) return resolved.response;

  try {
    if (action === "list") {
      return await handleList(adminClient, Number(resolved.student.id), body);
    }

  } catch {
    return jsonResponse({ error: "Notification service unavailable." }, 503);
  }

  return jsonResponse({ error: "Unsupported action." }, 400);
});
