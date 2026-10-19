import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.1";
import { handleCorsPreflight, rejectDisallowedOrigin, serveWithKandidCors } from "../_shared/kandidProductionSecurity.mjs";

const PROFILE_FIELDS = "id, student_number, first_name, last_name, email, photo_url, program, year_level, is_shs, status, created_at";
function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function currentMemberships(admin: ReturnType<typeof createClient>, studentId: number) {
  const loadTerm = () => admin.from("academic_terms").select("id, academic_year, semester, status").eq("status", "active").limit(2);
  const { data: terms, error: termError } = await loadTerm();
  if (termError) return respond({ error: "Current memberships are unavailable." }, 503);
  if (terms?.length !== 1) return respond({ error: "The active academic term could not be verified." }, 409);
  const term = terms[0];
  const { data: enrollments, error: enrollmentError } = await admin.from("student_term_enrollments")
    .select("academic_term_id, enrollment_status, program, year_level").eq("student_id", studentId).eq("academic_term_id", term.id).limit(2);
  if (enrollmentError) return respond({ error: "Current memberships are unavailable." }, 503);
  if (!Array.isArray(enrollments) || enrollments.length > 1) return respond({ error: "Current enrollment could not be verified." }, 409);
  const enrollment = enrollments[0]?.enrollment_status === "enrolled" ? enrollments[0] : null;
  const memberships: Array<Record<string, unknown>> = [];
  if (enrollment) {
    const { data: rows, error } = await admin.from("student_organization_terms")
      .select("organization_id, source").eq("student_id", studentId).eq("academic_term_id", term.id).eq("status", "active")
      .order("organization_id", { ascending: true }).limit(1001);
    if (error || !Array.isArray(rows) || rows.length > 1000) return respond({ error: "Current memberships are unavailable." }, 503);
    const ids = rows.map(row => Number(row.organization_id));
    if (ids.some(id => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) return respond({ error: "Current participation could not be verified." }, 409);
    if (ids.length) {
      const { data: organizations, error: organizationError } = await admin.from("organizations")
        .select("id, name, description, organization_type, membership_scope").in("id", ids);
      if (organizationError || !Array.isArray(organizations) || organizations.length !== ids.length) return respond({ error: "Current memberships are unavailable." }, 503);
      for (let offset = 0; offset < rows.length; offset += 8) {
        const checked = await Promise.all(rows.slice(offset, offset + 8).map(async row => {
          // Reuse the installed STABLE canonical resolver; do not reconstruct
          // memberships from today's program mappings or legacy password data.
          const result = await admin.rpc("resolve_student_organization_participation", {
            target_student_id: studentId, target_organization_id: Number(row.organization_id), target_academic_term_id: Number(term.id),
          });
          const resolved = Array.isArray(result.data) ? result.data.length === 1 ? result.data[0] : null : result.data;
          return { row, resolved, error: result.error };
        }));
        for (const { row, resolved, error: resolveError } of checked) {
          if (resolveError || typeof resolved?.allowed !== "boolean") return respond({ error: "Current memberships are unavailable." }, 503);
          if (!resolved.allowed) continue;
          if (resolved.status !== "active") return respond({ error: "Current memberships are unavailable." }, 503);
          const organization = organizations.find(org => Number(org.id) === Number(row.organization_id));
          if (!organization || !["program", "manual", "institution"].includes(organization.membership_scope)) return respond({ error: "Current memberships are unavailable." }, 503);
          memberships.push({ organization_id: Number(row.organization_id), academic_term_id: Number(term.id), membership_status: "active",
            source: resolved.source || row.source || null,
            organization: { id: organization.id, name: organization.name, description: organization.description,
              organization_type: organization.organization_type, membership_scope: organization.membership_scope } });
        }
      }
    }
  }
  const latest = await loadTerm();
  if (latest.error || latest.data?.length !== 1 || Number(latest.data[0].id) !== Number(term.id)) return respond({ error: "The academic term changed. Retry the request." }, 409);
  return respond({ data: { student_id: studentId, academic_term: term, enrollment, memberships, count: memberships.length } });
}

async function currentOrganizationCount(admin: ReturnType<typeof createClient>, studentId: number, organizationId: number) {
  // A Student may see an aggregate only for their own canonically authorized
  // current-term organization. No roster or other Student identity is returned.
  const loadTerm = () => admin.from("academic_terms").select("id, academic_year, semester, status").eq("status", "active").limit(2);
  const { data: terms, error: termError } = await loadTerm();
  if (termError) return respond({ error: "Member count unavailable." }, 503);
  if (terms?.length !== 1) return respond({ error: "The active academic term could not be verified." }, 409);
  const term = terms[0];
  // Canonical eligibility authorizes the caller's access to this organization;
  // it is not an additional filter on the organization's member count.
  const access = await admin.rpc("resolve_student_organization_participation", {
    target_student_id: studentId, target_organization_id: organizationId, target_academic_term_id: Number(term.id),
  });
  const resolved = Array.isArray(access.data) ? access.data.length === 1 ? access.data[0] : null : access.data;
  if (access.error || typeof resolved?.allowed !== "boolean") return respond({ error: "Member count unavailable." }, 503);
  if (!resolved.allowed || resolved.status !== "active") {
    return respond({ error: "Current organization access is required." }, 403);
  }
  const candidates = new Set<number>();
  let complete = false;
  // Explicit pages avoid the Data API's default response cap. Fail closed on
  // oversized or incomplete reads rather than publishing a truncated count.
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data: rows, error } = await admin.from("student_organization_terms")
      .select("id, student_id").eq("organization_id", organizationId)
      .eq("academic_term_id", term.id).eq("status", "active")
      .order("id", { ascending: true }).range(offset, offset + 499);
    if (error || !Array.isArray(rows)) return respond({ error: "Member count unavailable." }, 503);
    for (const row of rows) {
      const id = Number(row.student_id);
      if (!Number.isSafeInteger(id) || id <= 0) return respond({ error: "Member count unavailable." }, 503);
      candidates.add(id);
    }
    if (rows.length < 500) { complete = true; break; }
  }
  if (!complete) return respond({ error: "Member count unavailable." }, 503);
  const latest = await loadTerm();
  if (latest.error || latest.data?.length !== 1 || Number(latest.data[0].id) !== Number(term.id)) return respond({ error: "The academic term changed. Retry the request." }, 409);
  return respond({ data: { organization_id: organizationId, academic_term: term, count: candidates.size } });
}

// Deploy as student-profile with verify_jwt=true after separate approval.
// This artifact deliberately has no photo update or email synchronization.
serveWithKandidCors(async (request) => {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;
  const rejectedOrigin = rejectDisallowedOrigin(request);
  if (rejectedOrigin) return rejectedOrigin;
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization) return respond({ error: "Authentication required." }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return respond({ error: "Profile service unavailable." }, 503);
  const client = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser();
  const user = data?.user;
  if (error || !user?.id || !user.email_confirmed_at || !user.email) return respond({ error: "Verified session required." }, 401);
  let body;
  try { body = await request.json(); } catch { return respond({ error: "Invalid request." }, 400); }
  const countAction = body?.action === "organization_member_count";
  if (!body || Array.isArray(body) || typeof body !== "object" || !["profile", "organization_memberships", "organization_member_count"].includes(body.action) || Object.keys(body).some(key => key !== "action" && !(countAction && key === "organization_id")) || (countAction && (!Number.isSafeInteger(body.organization_id) || body.organization_id <= 0))) return respond({ error: "Unsupported profile operation." }, 400);
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: rows, error: lookupError } = await admin.from("students").select(PROFILE_FIELDS).eq("auth_user_id", user.id).limit(2);
  if (lookupError) return respond({ error: "Profile service unavailable." }, 503);
  const student = rows?.length === 1 ? rows[0] : null;
  if (!student || student.status !== "active" || String(student.email || "").trim().toLowerCase() !== user.email.trim().toLowerCase()) return respond({ error: "An active matching Student account is required." }, 403);
  if (body.action === "organization_memberships") {
    try { return await currentMemberships(admin, Number(student.id)); }
    catch { return respond({ error: "Current memberships are unavailable." }, 503); }
  }
  if (countAction) {
    try { return await currentOrganizationCount(admin, Number(student.id), body.organization_id); }
    catch { return respond({ error: "Member count unavailable." }, 503); }
  }
  const safeStudent = Object.fromEntries(PROFILE_FIELDS.split(", ").map(field => [field, student[field] ?? null]));
  return respond({ data: { ...safeStudent, role: "student" } });
});
