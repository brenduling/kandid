import { corsHeaders, handleCorsPreflight, rejectDisallowedOrigin, serveWithKandidCors } from "../_shared/kandidProductionSecurity.mjs";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


const PROFILE_FIELDS = "id, student_number, first_name, last_name, email, photo_url, program, year_level, precinct_code, batch_code, is_shs, status, created_at";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function validPhotoUrl(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 500_000) return undefined;
  if (/^https:\/\//i.test(normalized)) return normalized;
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(normalized)) return normalized;
  return undefined;
}

serveWithKandidCors(async (request) => {
  const preflightResponse = handleCorsPreflight(request);
  if (preflightResponse) return preflightResponse;

  const originRejection = rejectDisallowedOrigin(request);
  if (originRejection) return originRejection;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Server configuration is incomplete." }, 500);
  }
  if (!authorization) return jsonResponse({ error: "Authentication required." }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  const authUser = authData?.user;
  if (authError || !authUser?.id) return jsonResponse({ error: "Invalid or expired session." }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } },
    auth: { persistSession: false },
  });
  const { data: mappings, error: mappingError } = await adminClient
    .from("students")
    .select(PROFILE_FIELDS)
    .eq("auth_user_id", authUser.id)
    .limit(2);
  if (mappingError) return jsonResponse({ error: "Student identity could not be verified." }, 500);
  if (!mappings || mappings.length !== 1 || mappings[0].status !== "active") {
    return jsonResponse({ error: "An active linked student account is required." }, 403);
  }

  const student = mappings[0];
  const action = String(body.action || "profile");
  if (action === "update_photo") {
    const photoUrl = validPhotoUrl(body.photo_url);
    if (photoUrl === undefined) return jsonResponse({ error: "Choose a valid profile image." }, 400);
    const { error: updateError } = await adminClient
      .from("students")
      .update({ photo_url: photoUrl })
      .eq("id", student.id)
      .eq("auth_user_id", authUser.id)
      .eq("status", "active");
    if (updateError) return jsonResponse({ error: "Profile photo could not be saved." }, 500);
    student.photo_url = photoUrl;
  } else if (action === "profile") {
    // Auth user.email changes only after Supabase completes the configured email
    // verification flow. Until then the Student record remains authoritative.
    const verifiedAuthEmail = authUser.email_confirmed_at
      ? String(authUser.email || "").trim().toLowerCase()
      : "";
    const storedEmail = String(student.email || "").trim().toLowerCase();
    if (verifiedAuthEmail && verifiedAuthEmail !== storedEmail) {
      const [{ data: otherStudents, error: studentCollisionError }, { data: admins, error: adminCollisionError }] = await Promise.all([
        adminClient.from("students").select("id").eq("status", "active").ilike("email", verifiedAuthEmail).neq("id", student.id).limit(1),
        adminClient.from("admin_users").select("id").ilike("email", verifiedAuthEmail).limit(1),
      ]);
      if (studentCollisionError || adminCollisionError) {
        return jsonResponse({ error: "Verified email could not be synchronized." }, 500);
      }
      if ((otherStudents || []).length || (admins || []).length) {
        return jsonResponse({ error: "This verified email is already assigned to another account." }, 409);
      }
      const { error: emailUpdateError } = await adminClient
        .from("students")
        .update({ email: verifiedAuthEmail })
        .eq("id", student.id)
        .eq("auth_user_id", authUser.id)
        .eq("status", "active");
      if (emailUpdateError) return jsonResponse({ error: "Verified email could not be synchronized." }, 500);
      student.email = verifiedAuthEmail;
    }
  } else {
    return jsonResponse({ error: "Unsupported profile operation." }, 400);
  }

  const { auth_user_id: _authUserId, password: _password, ...safeStudent } = student as Record<string, unknown>;
  return jsonResponse({ data: { ...safeStudent, role: "student" } });
});
