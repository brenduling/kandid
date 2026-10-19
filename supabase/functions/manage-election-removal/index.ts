import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  handleCorsPreflight,
  rejectDisallowedOrigin,
  serveWithKandidCors,
} from "../_shared/kandidProductionSecurity.mjs";

type Admin = {
  id: number;
  auth_user_id: string;
  full_name: string;
  role: "electoral_board" | "super_admin";
  status: string;
  organization_id: number | null;
};

const response = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

async function rowsFromPages<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await build(offset, offset + 999);
    if (error) throw error;
    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function exactCount(
  admin: SupabaseClient,
  table: string,
  column?: string,
  value?: number,
  extra?: (query: any) => any,
) {
  let query = admin.from(table).select("id", { count: "exact", head: true });
  if (column) query = query.eq(column, value);
  if (extra) query = extra(query);
  const { count, error } = await query;
  if (error || !Number.isSafeInteger(count) || count < 0) throw error || new Error("Dependency count unavailable.");
  return count;
}

async function relatedRecordCount(
  admin: SupabaseClient,
  table: "officers" | "officer_new_roster",
  electionId: number,
  candidateIds: number[],
  positionIds: number[],
) {
  const ids = new Set<number>();
  const filters: Array<(query: any) => any> = [(query) => query.eq("election_id", electionId)];
  if (candidateIds.length) filters.push((query) => query.in("candidate_id", candidateIds));
  if (positionIds.length) filters.push((query) => query.in("position_id", positionIds));
  for (const apply of filters) {
    const records = await rowsFromPages<{ id: number }>((from, to) =>
      apply(admin.from(table).select("id")).order("id").range(from, to));
    records.forEach(({ id }) => ids.add(Number(id)));
  }
  return ids.size;
}

async function loadDependencySummary(admin: SupabaseClient, authId: string, profile: Admin, electionId: number) {
  let electionQuery = admin.from("elections").select("id, organization_id, results_released_at").eq("id", electionId);
  if (profile.role === "electoral_board") electionQuery = electionQuery.eq("organization_id", profile.organization_id);
  const { data: election, error: electionError } = await electionQuery.maybeSingle();
  if (electionError) throw electionError;
  if (!election) throw Object.assign(new Error("Election is unavailable."), { status: 404 });

  const positions = await rowsFromPages<{ id: number }>((from, to) => admin.from("positions")
    .select("id").eq("election_id", electionId).order("id").range(from, to));
  const positionIds = positions.map(({ id }) => Number(id));
  const candidates = positionIds.length ? await rowsFromPages<{ id: number; partylist_id: number | null }>((from, to) => admin.from("candidates")
    .select("id, partylist_id").in("position_id", positionIds).order("id").range(from, to)) : [];
  const candidateIds = candidates.map(({ id }) => Number(id));
  const directPartylists = await rowsFromPages<{ id: number }>((from, to) => admin.from("partylists")
    .select("id").eq("election_id", electionId).order("id").range(from, to));
  const partylistIds = new Set<number>([
    ...directPartylists.map(({ id }) => Number(id)),
    ...candidates.filter((item) => item.partylist_id !== null).map((item) => Number(item.partylist_id)),
  ]);
  const publications = await rowsFromPages<{ id: string }>((from, to) => admin.from("election_officer_publications")
    .select("id").eq("election_id", electionId).order("id").range(from, to));
  const publicationIds = publications.map(({ id }) => id);

  const { data: electorate, error: electorateError } = await admin.rpc("kandid_get_election_removal_electorate_count", {
    p_election_id: electionId,
    p_actor_auth_uid: authId,
  });
  const frozenElectorate = Number(electorate);
  if (electorateError || !Number.isSafeInteger(frozenElectorate) || frozenElectorate < 0) {
    throw electorateError || new Error("Electorate count unavailable.");
  }

  const [votes, ballotRecords, eligibilityRules, accessTokens, campaignSnapshots, officerReferences,
    preparedOfficerRows, leadershipReleases, publicationEntries, candidateMedia, archiveReferences,
    voteAnchors, ballotAnchors, auditReferences] = await Promise.all([
    exactCount(admin, "votes", "election_id", electionId),
    exactCount(admin, "vote_ballots", "election_id", electionId),
    exactCount(admin, "eligibility_rules", "election_id", electionId),
    exactCount(admin, "election_access_tokens", "election_id", electionId),
    exactCount(admin, "election_campaign_snapshots", "election_id", electionId),
    relatedRecordCount(admin, "officers", electionId, candidateIds, positionIds),
    relatedRecordCount(admin, "officer_new_roster", electionId, candidateIds, positionIds),
    exactCount(admin, "officer_leadership_releases", "election_id", electionId),
    publicationIds.length ? exactCount(admin, "election_officer_publication_entries", undefined, undefined,
      (query) => query.in("publication_id", publicationIds)) : 0,
    candidateIds.length ? exactCount(admin, "candidate_media", undefined, undefined,
      (query) => query.in("candidate_id", candidateIds)) : 0,
    exactCount(admin, "archived_elections", "election_id", electionId),
    exactCount(admin, "votes", "election_id", electionId, (query) => query.not("blockchain_tx_id", "is", null)),
    exactCount(admin, "vote_ballots", "election_id", electionId, (query) => query.not("blockchain_tx_id", "is", null)),
    exactCount(admin, "audit_logs", undefined, undefined,
      (query) => query.or(`election_id.eq.${electionId},and(entity_type.eq.election,entity_id.eq.${electionId})`)),
  ]);
  const counts: Record<string, number> = {
    positions: positions.length,
    candidates: candidates.length,
    votes,
    ballot_records: ballotRecords,
    frozen_electorate: frozenElectorate,
    partylists: partylistIds.size,
    eligibility_rules: eligibilityRules,
    published_results: election.results_released_at ? 1 : 0,
    access_tokens: accessTokens,
    campaign_snapshots: campaignSnapshots,
    officer_references: officerReferences,
    prepared_officer_rows: preparedOfficerRows,
    leadership_releases: leadershipReleases,
    officer_publications: publications.length,
    publication_entries: publicationEntries,
    candidate_media: candidateMedia,
    archive_references: archiveReferences,
    blockchain_evidence: voteAnchors + ballotAnchors,
    audit_references: auditReferences,
  };
  const protectedKeys = ["votes", "ballot_records", "frozen_electorate", "published_results", "campaign_snapshots",
    "officer_references", "prepared_officer_rows", "leadership_releases", "officer_publications",
    "publication_entries", "archive_references", "blockchain_evidence", "audit_references"];
  return {
    schema_version: 1,
    election_id: electionId,
    counts,
    protected_history: protectedKeys.some((key) => counts[key] > 0),
    may_delete: Object.values(counts).every((count) => count === 0),
  };
}

function positiveId(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw Object.assign(new Error("Election ID is invalid."), { status: 400 });
  }
  return value;
}

async function requireActiveAdmin(admin: SupabaseClient, authId: string): Promise<Admin> {
  const { data, error } = await admin.from("admin_users")
    .select("id, auth_user_id, full_name, role, status, organization_id")
    .eq("auth_user_id", authId).eq("status", "active").limit(2);
  if (error) throw error;
  if (!Array.isArray(data) || data.length !== 1 || data[0].auth_user_id !== authId ||
      !["electoral_board", "super_admin"].includes(data[0].role) ||
      (data[0].role === "electoral_board" && (data[0].organization_id == null ||
        !Number.isSafeInteger(Number(data[0].organization_id)) || Number(data[0].organization_id) <= 0))) {
    throw Object.assign(new Error("Active Electoral Board or Super Admin access is required."), { status: 403 });
  }
  return data[0] as Admin;
}

async function verifyCurrentPassword(
  url: string,
  anonKey: string,
  service: SupabaseClient,
  authId: string,
  password: string,
) {
  if (typeof password !== "string" || password.length < 1 || password.length > 256) {
    throw Object.assign(new Error("Enter your current account password."), { status: 400 });
  }
  const { data: authUser, error: authUserError } = await service.auth.admin.getUserById(authId);
  const email = authUser?.user?.email;
  if (authUserError || !email || authUser?.user?.id !== authId) {
    throw Object.assign(new Error("Your account could not be reverified. Sign in again and retry."), { status: 401 });
  }

  const reauth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await reauth.auth.signInWithPassword({ email, password });
  const matches = !error && data.user?.id === authId;
  // Drop in-memory response references immediately. No credential or session is logged or returned.
  data.session = null;
  data.user = null;
  if (!matches) {
    throw Object.assign(new Error("The current password could not be verified for this signed-in account."), { status: 401 });
  }
}

function mapRpcError(error: any) {
  const code = String(error?.code || "");
  if (code === "42501") return { status: 403, message: "You are not authorized to remove or restore this election." };
  if (code === "55000") return { status: 409, message: "This election is active or scheduled and cannot be removed or restored yet." };
  if (code === "23505") return { status: 409, message: "This election has already been removed." };
  if (code === "P0002") return { status: 404, message: "This election is unavailable." };
  if (code === "40001") return { status: 409, message: "The election changed during this request. Refresh and review it again." };
  return { status: 500, message: "The election change could not be confirmed. No success was reported; refresh and try again." };
}

serveWithKandidCors(async (request) => {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;
  const originFailure = rejectDisallowedOrigin(request);
  if (originFailure) return originFailure;
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return response({ error: "Server configuration is incomplete." }, 500);
  const authorization = request.headers.get("Authorization");
  if (!authorization) return response({ error: "Authentication required." }, 401);

  const sessionClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sessionData, error: sessionError } = await sessionClient.auth.getUser();
  const authId = sessionData.user?.id;
  if (sessionError || !authId) return response({ error: "Your session is invalid or expired. Sign in again." }, 401);

  const service = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const body = await request.json();
    const action = body?.action;
    const admin = await requireActiveAdmin(service, authId);

    if (action === "review") {
      if (Object.keys(body).some((key) => !["action", "election_id"].includes(key))) {
        return response({ error: "Request fields are invalid." }, 400);
      }
      const electionId = positiveId(body.election_id);
      return response({ data: await loadDependencySummary(service, authId, admin, electionId) });
    }

    if (action === "list_removed") {
      if (Object.keys(body).some((key) => !["action", "limit", "offset"].includes(key))) {
        return response({ error: "Request fields are invalid." }, 400);
      }
      const limit = body.limit === undefined ? 50 : body.limit;
      const offset = body.offset === undefined ? 0 : body.offset;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
        return response({ error: "Page is invalid." }, 400);
      }
      let query = service.from("elections")
        .select("id, organization_id, title, start_date, end_date, status, created_at, campaign_start, campaign_end, voting_results_visible, student_result_visibility, voting_access_mode, location_label, results_released_at, cover_url, academic_term_id, removed_at, organizations(name, logo_url)", { count: "exact" })
        .not("removed_at", "is", null)
        .order("removed_at", { ascending: false }).range(offset, offset + limit - 1);
      if (admin.role === "electoral_board") query = query.eq("organization_id", admin.organization_id);
      const { data, error, count } = await query;
      if (error) throw error;
      return response({ data: { elections: data || [], total: count || 0, limit, offset } });
    }

    if (!["soft_remove", "restore"].includes(action)) return response({ error: "Action is not supported." }, 400);
    if (Object.keys(body).some((key) => !["action", "election_id", "password"].includes(key))) {
      return response({ error: "Request fields are invalid." }, 400);
    }
    // Deployment must not activate either write operation. Reads remain available
    // while the separately approved server release gate is absent or disabled.
    if (Deno.env.get("ELECTION_SOFT_REMOVAL_ENABLED") !== "true") {
      return response({
        error: "Election removal and restoration are not activated.",
        code: "election_removal_not_enabled",
      }, 403);
    }
    const electionId = positiveId(body.election_id);
    await verifyCurrentPassword(url, anonKey, service, authId, body.password);
    const rpc = action === "soft_remove" ? "kandid_soft_remove_election" : "kandid_restore_removed_election";
    const { data, error } = await service.rpc(rpc, {
      p_election_id: electionId,
      p_actor_auth_uid: authId,
    });
    if (error) {
      const mapped = mapRpcError(error);
      return response({ error: mapped.message, code: error.code || "election_change_failed" }, mapped.status);
    }
    return response({ data });
  } catch (error: any) {
    if (error?.status) return response({ error: error.message }, error.status);
    return response({ error: "The election service is unavailable. No change was confirmed." }, 500);
  }
});
