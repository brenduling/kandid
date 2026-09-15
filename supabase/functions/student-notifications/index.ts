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

async function resolveStudent(
  adminClient: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const studentNumber = cleanText(body.student_number, 80);
  const password = String(body.password || "");

  if (!studentNumber || !password) {
    return { response: jsonResponse({ error: "Student credentials are required." }, 401) };
  }

  const { data: student, error } = await adminClient
    .from("students")
    .select("id, student_number, password, status")
    .eq("student_number", studentNumber)
    .maybeSingle();

  if (error || !student || student.password !== password) {
    return { response: jsonResponse({ error: "Invalid student credentials." }, 401) };
  }

  if (student.status === "pending" || student.status === "disabled") {
    return { response: jsonResponse({ error: "Student account is not active." }, 403) };
  }

  return { student };
}

async function handleList(
  adminClient: ReturnType<typeof createClient>,
  studentId: number,
  body: Record<string, unknown>,
) {
  const limit = Math.min(parsePositiveInteger(body.limit || 20, "Limit"), 50);
  const { data, error } = await adminClient
    .from("student_notifications")
    .select("id, type, title, message, metadata, is_read, created_at, read_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return jsonResponse({ error: "Unable to load notifications." }, 500);
  }

  return jsonResponse({ data: { notifications: data || [] } });
}

async function handleMarkRead(
  adminClient: ReturnType<typeof createClient>,
  studentId: number,
  body: Record<string, unknown>,
) {
  const notificationId = parsePositiveInteger(body.notification_id, "Notification");

  const { data: notification, error: lookupError } = await adminClient
    .from("student_notifications")
    .select("id, student_id, is_read")
    .eq("id", notificationId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (lookupError) {
    return jsonResponse({ error: "Unable to verify notification." }, 500);
  }

  if (!notification) {
    return jsonResponse({ error: "Notification not found." }, 404);
  }

  if (notification.is_read) {
    return jsonResponse({ data: { notification_id: notificationId, already_read: true } });
  }

  const { error: updateError } = await adminClient
    .from("student_notifications")
    .update({
      is_read: true,
      read_at: new Date().toISOString(),
    })
    .eq("id", notificationId)
    .eq("student_id", studentId);

  if (updateError) {
    return jsonResponse({ error: "Unable to mark notification as read." }, 500);
  }

  return jsonResponse({ data: { notification_id: notificationId, already_read: false } });
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

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const resolved = await resolveStudent(adminClient, body);
  if ("response" in resolved) return resolved.response;

  const action = cleanText(body.action, 80) || "list";
  try {
    if (action === "list") {
      return await handleList(adminClient, Number(resolved.student.id), body);
    }

    if (action === "mark_read") {
      return await handleMarkRead(adminClient, Number(resolved.student.id), body);
    }
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Request could not be completed." },
      400,
    );
  }

  return jsonResponse({ error: "Unsupported action." }, 400);
});
