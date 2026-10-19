import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ethers } from "https://esm.sh/ethers@6";
import {
  corsHeaders,
  handleCorsPreflight,
  rejectDisallowedOrigin,
  serveWithKandidCors,
} from "../_shared/kandidProductionSecurity.mjs";
import {
  boardCanAccessOrganization,
  boardCanAccessStudentMembership,
  isActiveAdminForAuthUser,
  isActiveStudentForAuthUser,
  projectOwnStudentReceipt,
} from "../_shared/voteAccessContracts.mjs";
import { verifyLegacyVoteAnchorEvidence } from "../_shared/legacyVoteAnchorEvidence.mjs";
import { isWithinGeofence, parseCoordinates } from "../_shared/geofence.js";

const pageSize = 1000;
const registryInterface = new ethers.Interface([
  "event VoteHashRecorded(bytes32 indexed voteHash, address indexed recorder, uint256 recordedAt)",
  "function isVoteHashRecorded(bytes32 voteHash) view returns (bool)",
]);

type Profile = {
  id: number;
  auth_user_id: string;
  role?: string;
  status: string;
  organization_id?: number | null;
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function positiveId(value: unknown, label: string) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} is invalid.`);
  return id;
}

async function rowsFromPages<T>(buildQuery: (from: number, to: number) => any): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function increment(map: Map<string, number>, value: unknown) {
  const label = String(value || "").trim();
  if (!label || /^Unspecified(?:\s|$)/i.test(label)) return;
  map.set(label, (map.get(label) || 0) + 1);
}

function mapObject(value: Map<string, number>) {
  return Object.fromEntries(value.entries());
}

function normalizeYear(value: unknown) {
  const text = String(value || "").trim();
  const number = text.match(/\d+/)?.[0];
  if (!number) return text;
  if (number === "11" || number === "12") return `Grade ${number}`;
  const last = Number(number) % 10;
  const suffix = Number(number) % 100 >= 11 && Number(number) % 100 <= 13
    ? "th"
    : last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th";
  return `${number}${suffix} Year`;
}

async function getProfile(admin: SupabaseClient, table: "students" | "admin_users", authId: string) {
  const selection = table === "students"
    ? "id, auth_user_id, status"
    : "id, auth_user_id, role, status, organization_id";
  const { data, error } = await admin.from(table)
    .select(selection)
    .eq("auth_user_id", authId)
    .limit(2);
  if (error) throw error;
  if (!data || data.length !== 1) return null;
  return data[0] as Profile;
}

async function requireStudent(admin: SupabaseClient, authId: string) {
  const student = await getProfile(admin, "students", authId);
  if (!isActiveStudentForAuthUser(student, authId)) {
    throw new Response(JSON.stringify({ error: "Active Student access is required." }), { status: 403 });
  }
  return student;
}

async function requireAdmin(admin: SupabaseClient, authId: string, role?: "super_admin" | "electoral_board") {
  const profile = await getProfile(admin, "admin_users", authId);
  if (!isActiveAdminForAuthUser(profile, authId, role)) {
    throw new Response(JSON.stringify({ error: "Authorized active administrator access is required." }), { status: 403 });
  }
  if (profile.role === "electoral_board" && !profile.organization_id) {
    throw new Response(JSON.stringify({ error: "This Board account has no assigned organization." }), { status: 403 });
  }
  return profile;
}

async function electionResults(authClient: SupabaseClient, admin: SupabaseClient, profile: Profile, role: string, electionId: number) {
  if (role === "student") {
    const { error: visibilityError } = await authClient.rpc("kandid_get_election_turnout", {
      p_election_id: electionId,
    });
    if (visibilityError) {
      throw new Response(JSON.stringify({ error: "Election results are unavailable." }), { status: 403 });
    }
  }
  const { data: election, error: electionError } = await admin.from("elections")
    .select("id, title, organization_id, student_result_visibility, results_released_at, campaign_start, campaign_end, start_date, end_date, status, organizations(name)")
    .eq("id", electionId)
    .maybeSingle();
  if (electionError) throw electionError;
  if (!election) throw new Response(JSON.stringify({ error: "Election is unavailable." }), { status: 404 });

  if (role === "electoral_board" && !boardCanAccessOrganization(profile, election.organization_id)) {
    throw new Response(JSON.stringify({ error: "Election is unavailable." }), { status: 403 });
  }
  const votes = await rowsFromPages<Record<string, any>>((from, to) => admin.from("votes")
    .select("id, election_id, position_id, candidate_id, student_id, is_abstain, vote_hash")
    .eq("election_id", electionId)
    .range(from, to));
  const studentIds = [...new Set(votes.map((vote) => Number(vote.student_id)).filter(Number.isSafeInteger))];
  const students: Record<string, any>[] = [];
  for (let offset = 0; offset < studentIds.length; offset += 500) {
    const batch = studentIds.slice(offset, offset + 500);
    if (!batch.length) continue;
    const { data, error } = await admin.from("students").select("id, program, year_level").in("id", batch);
    if (error) throw error;
    students.push(...(data || []));
  }
  const studentById = new Map(students.map((student) => [Number(student.id), student]));
  const aggregates = new Map<string, Record<string, any>>();
  const voters = new Map<number, Record<string, string>>();
  let missingHashes = 0;
  let abstains = 0;
  for (const vote of votes) {
    if (!vote.vote_hash) missingHashes += 1;
    const student = studentById.get(Number(vote.student_id)) || {};
    voters.set(Number(vote.student_id), {
      program: String(student.program || ""),
      year_level: normalizeYear(student.year_level),
      organization: String(election.organizations?.name || "Organization"),
    });
    const positionId = Number(vote.position_id);
    if (vote.is_abstain) {
      abstains += 1;
      const key = `${positionId}:abstain`;
      const row = aggregates.get(key) || {
        election_id: electionId, position_id: positionId, candidate_id: null,
        is_abstain: true, aggregate_count: 0, program_counts: new Map(),
        year_level_counts: new Map(), organization_counts: new Map(),
      };
      row.aggregate_count += 1;
      increment(row.program_counts, student.program);
      increment(row.year_level_counts, normalizeYear(student.year_level));
      increment(row.organization_counts, election.organizations?.name);
      aggregates.set(key, row);
      continue;
    }
    if (vote.candidate_id == null) continue;
    const key = `${positionId}:${Number(vote.candidate_id)}`;
    const row = aggregates.get(key) || {
      election_id: electionId, position_id: positionId, candidate_id: Number(vote.candidate_id),
      is_abstain: false, aggregate_count: 0, program_counts: new Map(),
      year_level_counts: new Map(), organization_counts: new Map(),
    };
    row.aggregate_count += 1;
    increment(row.program_counts, student.program);
    increment(row.year_level_counts, normalizeYear(student.year_level));
    increment(row.organization_counts, election.organizations?.name);
    aggregates.set(key, row);
  }
  const totalProgram = new Map<string, number>();
  const totalYears = new Map<string, number>();
  const totalOrganizations = new Map<string, number>();
  for (const voter of voters.values()) {
    increment(totalProgram, voter.program);
    increment(totalYears, voter.year_level);
    increment(totalOrganizations, voter.organization);
  }
  const uniquePrograms = [...new Set([...voters.values()].map((voter) => voter.program).filter(Boolean))];
  const allocationMode = uniquePrograms.length > 1 ? "program" : "year_level";
  const allocation = allocationMode === "program" ? totalProgram : totalYears;
  const summary = {
    _aggregate_summary: true,
    election_id: electionId,
    totalVoteEntries: votes.length,
    totalUniqueVoters: voters.size,
    totalAbstains: abstains,
    missingHashCount: missingHashes,
    allocationMode,
    allocationItems: mapObject(allocation),
    programItems: mapObject(totalProgram),
    yearLevelItems: mapObject(totalYears),
    organizationItems: mapObject(totalOrganizations),
  };
  const aggregateRows = [...aggregates.values()].map((row) => ({
    election_id: row.election_id,
    position_id: row.position_id,
    candidate_id: row.candidate_id,
    is_abstain: row.is_abstain,
    aggregate_count: row.aggregate_count,
    program_counts: mapObject(row.program_counts),
    year_level_counts: mapObject(row.year_level_counts),
    organization_counts: mapObject(row.organization_counts),
  }));
  return { votes: [...aggregateRows, summary], aggregate_only: true };
}

async function ensureBoardEntityScope(admin: SupabaseClient, profile: Profile, entityType: string, id: number) {
  const orgId = Number(profile.organization_id);
  if (entityType === "organization") return id === orgId;
  if (entityType === "student") {
    const { count, error } = await admin.from("student_organizations").select("student_id", { count: "exact", head: true })
      .eq("organization_id", orgId).eq("student_id", id);
    if (error) throw error;
    return Number(count || 0) > 0;
  }
  let query: any;
  if (entityType === "election" || entityType === "archived_election") {
    query = admin.from("elections").select("id").eq("id", id).eq("organization_id", orgId);
  } else if (entityType === "position") {
    query = admin.from("positions").select("id, elections!inner(organization_id)").eq("id", id).eq("elections.organization_id", orgId);
  } else if (entityType === "candidate") {
    query = admin.from("candidates").select("id, positions!inner(elections!inner(organization_id))").eq("id", id).eq("positions.elections.organization_id", orgId);
  } else if (entityType === "partylist") {
    query = admin.from("partylists").select("id").eq("id", id).eq("organization_id", orgId);
  } else if (entityType === "eligibility_rule") {
    query = admin.from("eligibility_rules").select("id, elections!inner(organization_id)").eq("id", id).eq("elections.organization_id", orgId);
  } else return false;
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function voteDependencyCount(admin: SupabaseClient, profile: Profile, entityType: string, id: number, body: Record<string, any>) {
  if (entityType === "student_in_organization") {
    const organizationId = positiveId(body.organization_id, "Organization");
    if (profile.role === "electoral_board" && organizationId !== Number(profile.organization_id)) {
      throw new Response(JSON.stringify({ error: "Record is unavailable." }), { status: 403 });
    }
    if (profile.role === "electoral_board") {
      const { count: membershipCount, error: membershipError } = await admin.from("student_organizations")
        .select("student_id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("student_id", id);
      if (membershipError) throw membershipError;
      if (!boardCanAccessStudentMembership(profile, organizationId, Number(membershipCount || 0) > 0)) {
        throw new Response(JSON.stringify({ error: "Record is unavailable." }), { status: 403 });
      }
    }
    const { data: elections, error: electionError } = await admin.from("elections").select("id").eq("organization_id", organizationId);
    if (electionError) throw electionError;
    const electionIds = (elections || []).map((election) => election.id);
    if (!electionIds.length) return 0;
    const { count, error } = await admin.from("votes").select("id", { count: "exact", head: true })
      .eq("student_id", id).in("election_id", electionIds);
    if (error) throw error;
    return Number(count || 0);
  }
  if (profile.role === "electoral_board" && !await ensureBoardEntityScope(admin, profile, entityType, id)) {
    throw new Response(JSON.stringify({ error: "Record is unavailable." }), { status: 403 });
  }
  const filters: Record<string, string> = {
    student: "student_id", election: "election_id", archived_election: "election_id",
    position: "position_id", candidate: "candidate_id",
  };
  if (entityType === "eligibility_rule") {
    const { data, error } = await admin.from("eligibility_rules").select("election_id").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return 0;
    const { count, error: countError } = await admin.from("votes").select("id", { count: "exact", head: true }).eq("election_id", data.election_id);
    if (countError) throw countError;
    return Number(count || 0);
  }
  if (entityType === "partylist") {
    const { data: candidates, error } = await admin.from("candidates").select("id").eq("partylist_id", id);
    if (error) throw error;
    const candidateIds = (candidates || []).map((candidate) => candidate.id);
    if (!candidateIds.length) return 0;
    const { count, error: countError } = await admin.from("votes").select("id", { count: "exact", head: true }).in("candidate_id", candidateIds);
    if (countError) throw countError;
    return Number(count || 0);
  }
  const column = filters[entityType];
  if (!column) return 0;
  const { count, error } = await admin.from("votes").select("id", { count: "exact", head: true }).eq(column, id);
  if (error) throw error;
  return Number(count || 0);
}

function dependencyId(value: unknown) {
  if (typeof value !== "number" && !(typeof value === "string" && /^[1-9][0-9]*$/.test(value))) {
    throw new Error("Dependency identifier is unavailable.");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Dependency identifier is unavailable.");
  return id;
}

async function dependencyRowsFromPages<T extends { id: unknown }>(
  buildQuery: (from: number, to: number) => any,
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<number>();
  let expectedCount: number | undefined;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error, count } = await buildQuery(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0 ||
      (expectedCount !== undefined && expectedCount !== count)) {
      throw new Error("Complete dependency rows are unavailable.");
    }
    expectedCount = count;
    for (const row of data) {
      const id = dependencyId(row?.id);
      if (seen.has(id)) throw new Error("Dependency pagination changed during review.");
      seen.add(id);
      rows.push(row as T);
    }
    if (rows.length === count) return rows;
    if (rows.length > count || data.length !== pageSize) {
      throw new Error("Dependency pagination is incomplete.");
    }
  }
}

async function exactElectionDependencyCount(
  admin: SupabaseClient,
  options: {
    table: string;
    column?: string;
    value?: number;
    selectColumn?: string;
    extra?: (query: any) => any;
  },
) {
  let query = admin.from(options.table).select(options.selectColumn || "id", { count: "exact", head: true });
  if (options.column && options.value !== undefined) query = query.eq(options.column, options.value);
  if (options.extra) query = options.extra(query);
  const { count, error } = await query;
  if (error) throw error;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Dependency count is unavailable.");
  return count;
}

async function relatedElectionRecordCount(
  admin: SupabaseClient,
  table: "officers" | "officer_new_roster",
  electionId: number,
  candidateIds: number[],
  positionIds: number[],
) {
  const ids = new Set<number>();
  const queries: Array<(query: any) => any> = [
    (query) => query.eq("election_id", electionId),
  ];
  if (candidateIds.length) queries.push((query) => query.in("candidate_id", candidateIds));
  if (positionIds.length) queries.push((query) => query.in("position_id", positionIds));

  for (const apply of queries) {
    const rows = await dependencyRowsFromPages<{ id: number }>((from, to) =>
      apply(admin.from(table).select("id", { count: "exact" })).order("id").range(from, to)
    );
    for (const row of rows) {
      ids.add(dependencyId(row.id));
    }
  }
  return ids.size;
}

async function electionDependencySummary(
  admin: SupabaseClient,
  authClient: SupabaseClient,
  profile: Profile,
  electionId: number,
) {
  const organizationId = dependencyId(profile.organization_id);
  const { data: election, error: electionError } = await admin.from("elections")
    .select("id, organization_id, results_released_at")
    .eq("id", electionId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (electionError) throw electionError;
  if (!election) throw new Response(JSON.stringify({ error: "Election is unavailable." }), { status: 404 });
  if (dependencyId(election.id) !== electionId || dependencyId(election.organization_id) !== organizationId ||
    !Object.hasOwn(election, "results_released_at")) throw new Error("Election dependency scope is unavailable.");

  // The electorate snapshot lives in the deliberately unexposed private schema.
  // Read its count through a narrow Board-scoped SECURITY DEFINER RPC using the
  // caller JWT; never grant direct table access to the Edge Function or browser.
  const { data: electorateResult, error: electorateError } = await authClient.rpc(
    "kandid_get_board_election_delete_dependency_count",
    { p_election_id: electionId },
  );
  if (electorateError) throw electorateError;
  const frozenElectorate = electorateResult?.frozen_electorate_records;
  if (
    electorateResult?.election_id !== electionId ||
    !Number.isSafeInteger(frozenElectorate) || frozenElectorate < 0
  ) {
    throw new Error("Election electorate dependency count is unavailable.");
  }

  const positions = await dependencyRowsFromPages<{ id: number }>((from, to) => admin.from("positions")
    .select("id", { count: "exact" }).eq("election_id", electionId).order("id").range(from, to));
  const positionIds = positions.map((position) => dependencyId(position.id));
  const candidates = positionIds.length
    ? await dependencyRowsFromPages<{ id: number; partylist_id: number | null }>((from, to) => admin.from("candidates")
      .select("id, partylist_id", { count: "exact" }).in("position_id", positionIds).order("id").range(from, to))
    : [];
  const candidateIds = candidates.map((candidate) => dependencyId(candidate.id));
  const directPartylists = await dependencyRowsFromPages<{ id: number }>((from, to) => admin.from("partylists")
    .select("id", { count: "exact" }).eq("election_id", electionId).order("id").range(from, to));
  const partylistIds = new Set([
    ...directPartylists.map((partylist) => dependencyId(partylist.id)),
    ...candidates.filter((candidate) => candidate.partylist_id !== null)
      .map((candidate) => dependencyId(candidate.partylist_id)),
  ]);
  const publicationRows = await dependencyRowsFromPages<{ id: number }>((from, to) => admin.from("election_officer_publications")
    .select("id", { count: "exact" }).eq("election_id", electionId).order("id").range(from, to));
  const publicationIds = publicationRows.map((publication) => dependencyId(publication.id));

  const [
    votes,
    ballotRecords,
    eligibilityRules,
    accessTokens,
    campaignSnapshots,
    officerReferences,
    preparedOfficerRows,
    leadershipReleases,
    officerPublications,
    publicationEntries,
    candidateMedia,
    archiveReferences,
    voteAnchorReferences,
    ballotAnchorReferences,
    auditReferences,
  ] = await Promise.all([
    exactElectionDependencyCount(admin, { table: "votes", column: "election_id", value: electionId }),
    exactElectionDependencyCount(admin, { table: "vote_ballots", column: "election_id", value: electionId }),
    exactElectionDependencyCount(admin, { table: "eligibility_rules", column: "election_id", value: electionId }),
    exactElectionDependencyCount(admin, { table: "election_access_tokens", column: "election_id", value: electionId }),
    exactElectionDependencyCount(admin, { table: "election_campaign_snapshots", column: "election_id", value: electionId }),
    relatedElectionRecordCount(admin, "officers", electionId, candidateIds, positionIds),
    relatedElectionRecordCount(admin, "officer_new_roster", electionId, candidateIds, positionIds),
    exactElectionDependencyCount(admin, { table: "officer_leadership_releases", column: "election_id", value: electionId }),
    Promise.resolve(publicationRows.length),
    publicationIds.length
      ? exactElectionDependencyCount(admin, { table: "election_officer_publication_entries", selectColumn: "publication_id",
        extra: (query) => query.in("publication_id", publicationIds) })
      : Promise.resolve(0),
    candidateIds.length
      ? exactElectionDependencyCount(admin, { table: "candidate_media", selectColumn: "candidate_id",
        extra: (query) => query.in("candidate_id", candidateIds) })
      : Promise.resolve(0),
    exactElectionDependencyCount(admin, { table: "archived_elections", column: "election_id", value: electionId }),
    exactElectionDependencyCount(admin, { table: "votes", column: "election_id", value: electionId,
      extra: (query) => query.not("blockchain_tx_id", "is", null) }),
    exactElectionDependencyCount(admin, { table: "vote_ballots", column: "election_id", value: electionId,
      extra: (query) => query.not("blockchain_tx_id", "is", null) }),
    exactElectionDependencyCount(admin, { table: "audit_logs",
      extra: (query) => query.or(`election_id.eq.${electionId},and(entity_type.eq.election,entity_id.eq.${electionId})`) }),
  ]);

  const counts = {
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
    officer_publications: officerPublications,
    publication_entries: publicationEntries,
    candidate_media: candidateMedia,
    archive_references: archiveReferences,
    blockchain_evidence: voteAnchorReferences + ballotAnchorReferences,
    audit_references: auditReferences,
  };
  const protectedKeys = [
    "votes", "ballot_records", "frozen_electorate", "published_results", "campaign_snapshots",
    "officer_references", "prepared_officer_rows", "leadership_releases", "officer_publications",
    "publication_entries", "archive_references", "blockchain_evidence", "audit_references",
  ];
  const protectedHistory = protectedKeys.some((key) => counts[key] > 0);
  const mayDelete = Object.values(counts).every((count) => count === 0);
  return {
    schema_version: 1,
    election_id: electionId,
    counts,
    protected_history: protectedHistory,
    may_delete: mayDelete,
  };
}

serveWithKandidCors(async (request) => {
  const preflightResponse = handleCorsPreflight(request);
  if (preflightResponse) return preflightResponse;

  const originRejection = rejectDisallowedOrigin(request);
  if (originRejection) return originRejection;

  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return response({ error: "Server configuration is incomplete." }, 500);
  const authorization = request.headers.get("Authorization");
  if (!authorization) return response({ error: "Authentication required." }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user?.id) return response({ error: "Invalid or expired session." }, 401);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  try {
    const body = await request.json();
    const action = String(body?.action || "");
    const authId = authData.user.id;

    if (action === "student_verify_geofence") {
      const student = await requireStudent(admin, authId);
      const electionId = positiveId(body.election_id, "Election");
      const coordinates = parseCoordinates(body.coordinates);
      if (!coordinates) return response({ data: { granted: false } }, 400);
      const { data: election, error: electionError } = await admin.from("elections")
        .select("id, organization_id, academic_term_id, voting_access_mode, geo_lat, geo_lng, geo_radius_meters")
        .eq("id", electionId).maybeSingle();
      if (electionError) throw electionError;
      if (!election || election.voting_access_mode !== "location_range") {
        return response({ data: { granted: false } }, 404);
      }
      let termId = election.academic_term_id;
      if (!termId) {
        const { data: activeTerm, error: termError } = await admin.from("academic_terms")
          .select("id").eq("status", "active").order("created_at", { ascending: false })
          .order("id", { ascending: false }).limit(1).maybeSingle();
        if (termError) throw termError;
        termId = activeTerm?.id;
      }
      if (!termId) return response({ data: { granted: false } }, 403);
      const { data: participation, error: participationError } = await admin.rpc("resolve_student_organization_participation", {
        target_student_id: Number(student.id),
        target_organization_id: Number(election.organization_id),
        target_academic_term_id: Number(termId),
      });
      if (participationError) throw participationError;
      const participationRow = Array.isArray(participation) ? participation[0] : participation;
      const granted = participationRow?.allowed === true && isWithinGeofence(
        coordinates, election.geo_lat, election.geo_lng, election.geo_radius_meters,
      );
      return response({ data: { granted } });
    }

    if (action === "student_has_voted" || action === "student_voted_elections" || action === "student_receipts") {
      const student = await requireStudent(admin, authId);
      if (action === "student_has_voted") {
        const electionId = positiveId(body.election_id, "Election");
        const { count, error } = await admin.from("votes").select("id", { count: "exact", head: true })
          .eq("student_id", student.id).eq("election_id", electionId);
        if (error) throw error;
        return response({ data: { has_voted: Number(count || 0) > 0 } });
      }
      if (action === "student_voted_elections") {
        const rows = await rowsFromPages<Record<string, any>>((from, to) => admin.from("votes")
          .select("election_id, vote_timestamp").eq("student_id", student.id).order("vote_timestamp", { ascending: false }).range(from, to));
        const latest = new Map<number, string>();
        for (const row of rows) {
          const id = Number(row.election_id);
          if (!latest.has(id)) latest.set(id, String(row.vote_timestamp || ""));
        }
        return response({ data: { election_ids: [...latest.keys()], latest_vote_at: Object.fromEntries(latest) } });
      }
      const votes = await rowsFromPages<Record<string, any>>((from, to) => admin.from("votes")
        .select("id, election_id, position_id, is_abstain, ballot_id, vote_hash, blockchain_anchor_status, hash_version, blockchain_network, blockchain_block_number, blockchain_anchored_at, blockchain_tx_id, vote_timestamp, elections(title, organizations(name, description, logo_url)), positions(id, name, display_order)")
        .eq("student_id", student.id).order("vote_timestamp", { ascending: false }).range(from, to));
      return response({ data: { votes: votes.map(projectOwnStudentReceipt) } });
    }

    if (action === "student_verify_access_code") {
      const student = await requireStudent(admin, authId);
      const electionId = positiveId(body.election_id, "Election");
      const token = String(body.token || "").trim().toUpperCase();
      if (!token || token.length > 64) {
        return response({ data: { granted: false, reason: "invalid" } });
      }

      const [{ data: election, error: electionError }, { data: accessToken, error: tokenError }] = await Promise.all([
        admin.from("elections").select("id").eq("id", electionId).maybeSingle(),
        admin.from("election_access_tokens")
          .select("is_active, scope_type, scope_value, expires_at")
          .eq("election_id", electionId)
          .eq("token", token)
          .maybeSingle(),
      ]);
      if (electionError) throw electionError;
      if (tokenError) throw tokenError;
      if (!election || !accessToken || !accessToken.is_active) {
        return response({ data: { granted: false, reason: "invalid" } });
      }
      if (accessToken.expires_at && new Date(accessToken.expires_at).getTime() < Date.now()) {
        return response({ data: { granted: false, reason: "expired" } });
      }

      const { data: studentScope, error: scopeError } = await admin.from("students")
        .select("precinct_code, batch_code")
        .eq("id", student.id)
        .maybeSingle();
      if (scopeError) throw scopeError;
      const normalize = (value: unknown) => String(value || "").trim().toUpperCase();
      const scopeMatches = accessToken.scope_type === "general"
        || (accessToken.scope_type === "precinct"
          && normalize(accessToken.scope_value) !== ""
          && normalize(accessToken.scope_value) === normalize(studentScope?.precinct_code))
        || (accessToken.scope_type === "batch"
          && normalize(accessToken.scope_value) !== ""
          && normalize(accessToken.scope_value) === normalize(studentScope?.batch_code));
      return response({ data: { granted: scopeMatches, reason: scopeMatches ? "granted" : "scope_mismatch" } });
    }

    if (action === "election_results") {
      const [student, administrator] = await Promise.all([
        getProfile(admin, "students", authId),
        getProfile(admin, "admin_users", authId),
      ]);
      const activeAdmin = administrator?.status === "active" ? administrator : null;
      const activeStudent = student?.status === "active" ? student : null;
      const profile = activeAdmin || activeStudent;
      if (!profile || profile.status !== "active") return response({ error: "Active account access is required." }, 403);
      const role = activeAdmin ? profile.role : "student";
      if (!["student", "super_admin", "electoral_board"].includes(String(role))) return response({ error: "Results access is unavailable." }, 403);
      const electionId = positiveId(body.election_id, "Election");
      const data = await electionResults(authClient, admin, profile, String(role), electionId);
      return response({ data });
    }

    if (action === "board_dashboard_counts") {
      const board = await requireAdmin(admin, authId, "electoral_board");
      const electionIds = Array.isArray(body.election_ids)
        ? body.election_ids.map((value: unknown) => positiveId(value, "Election"))
        : [];
      if (!electionIds.length) return response({ data: { by_election: {}, organization_id: board.organization_id } });
      const { data: elections, error: electionError } = await admin.from("elections")
        .select("id").in("id", electionIds).eq("organization_id", board.organization_id);
      if (electionError) throw electionError;
      if ((elections || []).length !== electionIds.length) return response({ error: "Election is unavailable." }, 403);
      const votes = await rowsFromPages<Record<string, any>>((from, to) => admin.from("votes")
        .select("student_id, election_id").in("election_id", electionIds).range(from, to));
      const byElection = new Map<number, { votes: number; voters: Set<number> }>();
      for (const vote of votes) {
        const electionId = Number(vote.election_id);
        const item = byElection.get(electionId) || { votes: 0, voters: new Set<number>() };
        item.votes += 1;
        item.voters.add(Number(vote.student_id));
        byElection.set(electionId, item);
      }
      return response({ data: { by_election: Object.fromEntries([...byElection.entries()].map(([id, item]) => [id, { votes: item.votes, voters: item.voters.size }])), organization_id: board.organization_id } });
    }

    if (action === "super_admin_vote_count") {
      await requireAdmin(admin, authId, "super_admin");
      const { count, error } = await admin.from("votes").select("id", { count: "exact", head: true });
      if (error) throw error;
      return response({ data: { count: Number(count || 0) } });
    }

    if (action === "super_admin_vote_report") {
      await requireAdmin(admin, authId, "super_admin");
      const rows = await rowsFromPages<Record<string, any>>((from, to) => admin.from("votes")
        .select("election_id, position_id, candidate_id, is_abstain").range(from, to));
      const grouped = new Map<string, Record<string, any>>();
      for (const row of rows) {
        const key = `${row.election_id}:${row.position_id}:${row.is_abstain ? "abstain" : row.candidate_id}`;
        const item = grouped.get(key) || { election_id: row.election_id, position_id: row.position_id, candidate_id: row.is_abstain ? null : row.candidate_id, is_abstain: Boolean(row.is_abstain), vote_count: 0 };
        item.vote_count += 1;
        grouped.set(key, item);
      }
      return response({ data: { votes: [...grouped.values()] } });
    }

    if (action === "super_admin_voting_monitor") {
      await requireAdmin(admin, authId, "super_admin");
      const [ballots, legacyVotes] = await Promise.all([
        rowsFromPages<Record<string, any>>((from, to) => admin.from("vote_ballots")
          .select("election_id, canonical_submitted_at, blockchain_anchor_status, elections(title)").range(from, to)),
        rowsFromPages<Record<string, any>>((from, to) => admin.from("votes")
          .select("election_id, student_id, vote_timestamp, blockchain_anchor_status")
          .is("ballot_id", null).range(from, to)),
      ]);
      const grouped = new Map<number, Record<string, any>>();
      for (const ballot of ballots) {
        const electionId = Number(ballot.election_id);
        const item = grouped.get(electionId) || {
          id: `election-${electionId}`, election_id: electionId, elections: ballot.elections,
          ballot_count: 0, legacy_voters: new Set<number>(), latest_submission: null,
          pending_anchors: 0, failed_anchors: 0,
        };
        item.ballot_count += 1;
        if (ballot.blockchain_anchor_status === "anchor_failed" || ballot.blockchain_anchor_status === "manual_review") item.failed_anchors += 1;
        else if (ballot.blockchain_anchor_status !== "anchored") item.pending_anchors += 1;
        const submittedAt = ballot.canonical_submitted_at;
        if (String(submittedAt || "") > String(item.latest_submission || "")) item.latest_submission = submittedAt;
        grouped.set(electionId, item);
      }
      for (const vote of legacyVotes) {
        const electionId = Number(vote.election_id);
        const item = grouped.get(electionId) || {
          id: `election-${electionId}`, election_id: electionId, elections: null,
          ballot_count: 0, legacy_voters: new Set<number>(), latest_submission: null,
          pending_anchors: 0, failed_anchors: 0,
        };
        item.legacy_voters.add(Number(vote.student_id));
        if (vote.blockchain_anchor_status === "anchor_failed" || vote.blockchain_anchor_status === "manual_review") item.failed_anchors += 1;
        else if (vote.blockchain_anchor_status !== "anchored") item.pending_anchors += 1;
        if (String(vote.vote_timestamp || "") > String(item.latest_submission || "")) item.latest_submission = vote.vote_timestamp;
        grouped.set(electionId, item);
      }
      const electionIds = [...grouped.keys()];
      const { data: elections, error: electionError } = electionIds.length
        ? await admin.from("elections").select("id, title").in("id", electionIds)
        : { data: [], error: null };
      if (electionError) throw electionError;
      const electionById = new Map((elections || []).map((election) => [Number(election.id), election]));
      return response({ data: { rows: [...grouped.values()].map((item) => ({
        id: item.id,
        election_id: item.election_id,
        elections: electionById.get(item.election_id) || item.elections,
        ballot_count: item.ballot_count,
        legacy_voter_count: item.legacy_voters.size,
        total_ballots: item.ballot_count + item.legacy_voters.size,
        latest_submission: item.latest_submission,
        pending_anchors: item.pending_anchors,
        failed_anchors: item.failed_anchors,
      })) } });
    }

    if (action === "super_admin_blockchain_queue") {
      await requireAdmin(admin, authId, "super_admin");
      const [legacyVotes, ballots] = await Promise.all([
        rowsFromPages<Record<string, any>>((from, to) => admin.from("votes")
          .select("id, election_id, position_id, hash_version, vote_hash, blockchain_anchor_status, blockchain_tx_id, blockchain_network, blockchain_contract_address, blockchain_block_number, blockchain_anchored_at, vote_timestamp, elections(title), positions(name)")
          .is("ballot_id", null).order("id", { ascending: false }).range(from, to)),
        rowsFromPages<Record<string, any>>((from, to) => admin.from("vote_ballots")
          .select("id, election_id, ballot_hash, hash_version, blockchain_anchor_status, blockchain_tx_id, blockchain_network, blockchain_contract_address, blockchain_block_number, blockchain_anchored_at, canonical_submitted_at, elections(title)")
          .order("created_at", { ascending: false }).range(from, to)),
      ]);
      const legacyRecords = legacyVotes.map((vote) => ({ ...vote, record_type: "legacy_vote" }));
      const ballotRecords = ballots.map((ballot) => ({
        id: ballot.id,
        ballot_id: ballot.id,
        election_id: ballot.election_id,
        vote_hash: ballot.ballot_hash,
        hash_version: ballot.hash_version,
        blockchain_anchor_status: ballot.blockchain_anchor_status,
        blockchain_tx_id: ballot.blockchain_tx_id,
        blockchain_network: ballot.blockchain_network,
        blockchain_contract_address: ballot.blockchain_contract_address,
        blockchain_block_number: ballot.blockchain_block_number,
        blockchain_anchored_at: ballot.blockchain_anchored_at,
        vote_timestamp: ballot.canonical_submitted_at,
        elections: ballot.elections,
        positions: null,
        record_type: "ballot",
      }));
      return response({ data: { votes: [...legacyRecords, ...ballotRecords] } });
    }

    if (action === "vote_dependency_count") {
      const profile = await requireAdmin(admin, authId);
      const entityType = String(body.entity_type || "");
      const entityId = positiveId(body.entity_id, "Record");
      const count = await voteDependencyCount(admin, profile, entityType, entityId, body);
      return response({ data: { count } });
    }

    if (action === "election_dependency_summary") {
      const profile = await requireAdmin(admin, authId, "electoral_board");
      if (Object.keys(body).some((field) => !["action", "election_id"].includes(field))) {
        return response({ error: "Unsupported election dependency review field." }, 400);
      }
      if (!Number.isSafeInteger(body.election_id) || body.election_id <= 0) {
        return response({ error: "A valid election is required." }, 400);
      }
      const electionId = positiveId(body.election_id, "Election");
      const summary = await electionDependencySummary(admin, authClient, profile, electionId);
      return response({ data: summary });
    }

    if (action === "prepare_vote_anchor") {
      await requireAdmin(admin, authId, "super_admin");
      const voteId = positiveId(body.vote_id, "Vote");
      const { data: vote, error } = await admin.from("votes")
        .select("id, ballot_id, vote_hash, blockchain_tx_id, blockchain_anchor_status")
        .eq("id", voteId)
        .maybeSingle();
      if (error) throw error;
      if (!vote || vote.ballot_id || !vote.vote_hash || vote.blockchain_tx_id || vote.blockchain_anchor_status === "manual_review") {
        return response({ error: "This vote is not eligible for legacy per-vote anchoring." }, 409);
      }
      return response({ data: { authorized: true, vote_hash: vote.vote_hash } });
    }

    if (action === "confirm_vote_anchor") {
      await requireAdmin(admin, authId, "super_admin");
      const voteId = positiveId(body.vote_id, "Vote");
      const voteHash = String(body.vote_hash || "");
      const transactionHash = String(body.transaction_hash || "");
      if (!/^0x[0-9a-f]{64}$/i.test(voteHash) || !/^0x[0-9a-f]{64}$/i.test(transactionHash)) {
        return response({ error: "A valid vote hash and transaction hash are required." }, 400);
      }
      const rpcUrl = Deno.env.get("SEPOLIA_RPC_URL");
      const contractAddress = Deno.env.get("VOTE_REGISTRY_ADDRESS");
      if (!rpcUrl || !contractAddress || !ethers.isAddress(contractAddress)) return response({ error: "Blockchain verification is not configured." }, 503);
      const { data: vote, error: voteError } = await admin.from("votes")
        .select("id, ballot_id, vote_hash, blockchain_tx_id").eq("id", voteId).maybeSingle();
      if (voteError) throw voteError;
      if (!vote || vote.ballot_id || vote.vote_hash !== voteHash || vote.blockchain_tx_id) {
        return response({ error: "This vote is not eligible for legacy per-vote anchoring." }, 409);
      }
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const [network, receipt] = await Promise.all([
        provider.getNetwork(), provider.getTransactionReceipt(transactionHash),
      ]);
      if (network.chainId !== 11155111n || !receipt || receipt.status !== 1 || receipt.to?.toLowerCase() !== contractAddress.toLowerCase()) {
        return response({ error: "The transaction is not a successful Sepolia registry transaction." }, 422);
      }
      const contract = new ethers.Contract(contractAddress, registryInterface, provider);
      let evidence;
      try {
        evidence = await verifyLegacyVoteAnchorEvidence({
          requestedTransactionHash: transactionHash,
          expectedVoteHash: voteHash,
          expectedChainId: 11155111n,
          observedChainId: network.chainId,
          configuredContractAddress: contractAddress,
          receipt,
          parseRegistryEvent: (log) => registryInterface.parseLog(log),
          isVoteHashRecorded: (hash) => contract.isVoteHashRecorded(hash),
          getBlock: (blockNumber) => provider.getBlock(blockNumber),
        });
      } catch (error) {
        const unavailable = error && typeof error === "object" && "code" in error && error.code === "RPC_UNAVAILABLE";
        return response({ error: "Blockchain evidence could not be verified." }, unavailable ? 503 : 422);
      }
      const { data: recorded, error: recordError } = await admin.rpc("kandid_record_verified_legacy_vote_anchor", {
        p_vote_id: voteId,
        p_vote_hash: voteHash,
        p_transaction_hash: evidence.transaction_hash,
        p_contract_address: evidence.contract_address,
        p_block_number: evidence.block_number,
        p_anchored_at: evidence.anchored_at,
      });
      if (recordError) throw recordError;
      if (!recorded) return response({ error: "The vote anchor state changed before verification completed." }, 409);
      return response({ data: { recorded: true } });
    }

    return response({ error: "Unsupported vote access operation." }, 400);
  } catch (error) {
    if (error instanceof Response) return new Response(error.body, { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    console.error("Vote access request failed.", error instanceof Error ? error.message : "unknown error");
    return response({ error: "Vote data is temporarily unavailable." }, 500);
  }
});
