import { corsHeaders, handleCorsPreflight, rejectDisallowedOrigin, serveWithKandidCors } from "../_shared/kandidProductionSecurity.mjs";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { positiveId } from "../_shared/idValidation.js";
import { buildOfficerRpcOperation } from "../_shared/officersRpcOperations.js";


function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeRpcError(error: { code?: string; message?: string }) {
  const knownMessages = [
    "Authentication required.",
    "Invalid or expired session.",
    "Active administrator authorization required.",
    "Officer record not found.",
    "Election not found.",
    "Election is outside your organization.",
    "Organization is outside your assignment.",
    "Officer record is outside your organization.",
    "Candidate is outside your organization.",
    "Results can only be finalized for a closed election.",
    "Candidate election is not finalized and closed.",
    "Candidate is not the unique positive winner for this position.",
    "Retire the current officer before deletion.",
    "Elected history must be retained; retire the record instead.",
    "Published officer history must be retained.",
    "Select an active eligible organization student.",
    "Student is not eligible for this organization.",
    "Active academic-term eligibility could not be verified.",
    "Only Super Admin may change organization scope.",
    "Elected officer provenance is read-only.",
    "Officer name is derived from the linked student.",
    "A valid appointed position title is required.",
    "A valid position title is required.",
    "Invalid elected officer service fields.",
    "Invalid appointed officer service fields.",
    "Officer changes contain unsupported fields.",
    "No released, closed election is available for incoming leadership.",
    "No released, closed election is available for elected officers.",
    "Select a unique winner from the latest published election.",
    "This student is already in the new officer roster.",
    "Invalid officer service fields.",
    "Officer service details are too long.",
    "End of service must be on or after the start date.",
    "A published winner is no longer linked to a valid student position.",
    "New officer was not found.",
    "New officer is not part of the latest published election roster.",
    "New officer changes contain unsupported fields.",
    "Remove officers prepared for a prior election before release.",
    "Elected position and provenance are read-only.",
    "Officers for this election have already been released.",
    "Add at least one new officer before release.",
    "A staged elected officer is no longer a verified winner in the latest election.",
    "An existing elected record conflicts with the verified winner.",
    "Current leadership changes must use the release workflow.",
    "The election must have an authoritative academic term before its leadership year can be resolved.",
    "Current Leadership has conflicting academic years. Resolve its leadership year before adding or releasing officers.",
    "Establish one authoritative academic year before adding or releasing officers.",
    "The election must have an academic term before its officer leadership year can be resolved.",
    "The elected officer year does not match the prepared leadership year.",
    "The elected officer year conflicts with Current Leadership. Use the prepared leadership release for a new year.",
    "A known leadership academic year is required before an officer becomes Current.",
    "The officer leadership year does not match the prepared release year.",
    "The leadership academic year is not present in Kandid academic terms.",
    "The prepared roster does not have one matching authoritative leadership academic year.",
    "Add at least one New Officer before releasing leadership.",
    "Review and confirm the current leadership term details before adding an officer.",
    "A term label is required when current leadership term details are missing or inconsistent.",
    "The new officer must inherit the current leadership term label.",
    "The new officer must inherit the current leadership term end date.",
    "Current position is already occupied.",
    "Student already serves in Current Leadership.",
    "The selected candidate is not a winner from the latest eligible election.",
    "Officer selection type must be appointed or elected.",
    "A valid appointed student and position are required.",
    "An elected officer must be selected by verified candidate ID only.",
  ];
  const message = knownMessages.find((candidate) => error.message === candidate);
  if (message) return message;
  if (error.code === "23505" && error.message?.includes("officer_new_roster_one_position_uidx")) {
    return "This position is already assigned in the New Officers roster.";
  }
  if (error.code === "23505" && error.message?.includes("officers_current_one_position_uidx")) {
    return "This position is already assigned to a current officer in this organization.";
  }
  if (error.code === "23505" && error.message?.includes("officers_current_one_student_uidx")) {
    return "This student already has a position in the current officer roster.";
  }
  if (error.code === "23505") return "This election position or candidate already has an officer record.";
  if (error.code === "23503") return "The selected record is no longer available.";
  if (error.code === "22023") return "Some officer details are invalid. Review them and try again.";
  if (error.code === "42501") return "This officer action is not allowed for your account or organization.";
  return "Officer request could not be completed.";
}

serveWithKandidCors(async (request) => {
  const preflightResponse = handleCorsPreflight(request);
  if (preflightResponse) return preflightResponse;

  const originRejection = rejectDisallowedOrigin(request);
  if (originRejection) return originRejection;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Officer service is unavailable." }, 500);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Authentication required." }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user?.id) return json({ error: "Invalid or expired session." }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await adminClient
    .from("admin_users")
    .select("auth_user_id, role, status, organization_id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (profileError) return json({ error: "Unable to verify administrator access." }, 500);
  if (!profile || profile.status !== "active" || !["electoral_board", "super_admin"].includes(profile.role)) {
    return json({ error: "Active administrator authorization required." }, 403);
  }

  try {
    const body = await request.json();
    const action = String(body?.action || "");
    let result: unknown;

    if (action === "student_counts") {
      const studentId = positiveId(body.student_id, "Student");
      let organizationId: number | null = body.organization_id
        ? positiveId(body.organization_id, "Organization")
        : null;
      if (profile.role === "electoral_board") {
        if (!profile.organization_id) return json({ error: "Active administrator authorization required." }, 403);
        if (organizationId && Number(profile.organization_id) !== organizationId) {
          return json({ error: "Organization is outside your assignment." }, 403);
        }
        organizationId = Number(profile.organization_id);
      }
      const countFor = async (isCurrent?: boolean) => {
        let query = adminClient.from("officers").select("id", { count: "exact", head: true }).eq("student_id", studentId);
        if (organizationId) query = query.eq("organization_id", organizationId);
        if (typeof isCurrent === "boolean") query = query.eq("is_current", isCurrent);
        return await query;
      };
      const [all, current, previous] = await Promise.all([countFor(), countFor(true), countFor(false)]);
      if (all.error || current.error || previous.error) throw all.error || current.error || previous.error;
      result = { total: all.count || 0, current: current.count || 0, previous: previous.count || 0 };
    } else if (action === "list") {
      let query = adminClient
        .from("officers")
        .select(`id, organization_id, student_id, officer_name, position_title, term_label, term_start, term_end, academic_term_id, leadership_academic_year, service_started_at, service_ended_at, photo_url, is_current, status, selection_type, election_id, candidate_id, position_id, remarks, display_order, organizations(name), students(first_name, last_name, student_number, photo_url)`)
        .order("is_current", { ascending: false })
        .order("display_order", { ascending: true })
        .order("term_end", { ascending: false });
      if (profile.role === "electoral_board") {
        if (!profile.organization_id) return json({ error: "Active administrator authorization required." }, 403);
        query = query.eq("organization_id", profile.organization_id);
      }
      const { data, error } = await query;
      if (error) throw error;
      result = data || [];
    } else if (action === "organizations") {
      if (profile.role !== "super_admin") return json({ error: "This action requires Super Admin access." }, 403);
      const { data, error } = await adminClient.from("organizations").select("id, name, logo_url").order("name");
      if (error) throw error;
      result = data || [];
    } else {
      const operation = buildOfficerRpcOperation(action, body);
      if (!operation) return json({ error: "Unsupported officer action." }, 400);
      const { data, error } = await authClient.rpc(operation.name, operation.args);
      if (error) return json({ error: safeRpcError(error) }, error.code === "42501" ? 403 : 400);
      if (action === "incoming_leadership") {
        const { data: context, error: contextError } = await authClient.rpc(
          "kandid_get_officer_leadership_context",
          { p_organization_id: operation.args.p_organization_id },
        );
        if (contextError) throw contextError;

        const incoming = data && typeof data === "object" && !Array.isArray(data)
          ? data as Record<string, unknown>
          : {};
        const yearContext = context && typeof context === "object"
          ? context as {
            leadership_academic_year?: string | null;
            current_leadership_academic_year?: string | null;
            new_officers?: Array<{ id: number; leadership_academic_year?: string | null }>;
          }
          : {};
        const yearById = new Map(
          (yearContext.new_officers || []).map((officer) => [String(officer.id), officer.leadership_academic_year || null]),
        );
        const newOfficers = Array.isArray(incoming.new_officers)
          ? incoming.new_officers.map((officer) => {
              if (!officer || typeof officer !== "object") return officer;
              const row = officer as Record<string, unknown>;
              return {
                ...row,
                leadership_academic_year: yearById.get(String(row.id)) || null,
              };
            })
          : incoming.new_officers;
        result = {
          ...incoming,
          leadership_academic_year: yearContext.leadership_academic_year || null,
          current_leadership_academic_year: yearContext.current_leadership_academic_year || null,
          new_officers: newOfficers,
        };
      } else {
        result = data;
      }
    }

    return json({ data: result });
  } catch (error) {
    console.error("officers-contract request failed", error);
    return json({ error: "Officer request could not be completed." }, 400);
  }
});
