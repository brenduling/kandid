import { ELECTION_MANAGEMENT_SELECT } from "./electionManagementCompatibility.js";

export const ELECTION_EDIT_FIELDS = Object.freeze([
  "organization_id", "academic_term_id", "title", "cover_url", "campaign_start", "campaign_end",
  "start_date", "end_date", "status", "student_result_visibility", "voting_access_mode",
  "location_label", "geo_lat", "geo_lng", "geo_radius_meters",
]);
const schedules = new Set(["campaign_start", "campaign_end", "start_date", "end_date"]);
const same = (key, a, b) => {
  if (a == null && b == null) return true;
  if (key === "student_result_visibility" && [a, b].every((value) => ["hidden", "after_close"].includes(value))) return true;
  if (schedules.has(key) && a && b) {
    // The existing picker edits minutes, not seconds. Preserve the complete
    // stored timestamp when its displayed minute was not changed.
    const wallClock = (v) => String(v).replace(" ", "T").slice(0, 16);
    return wallClock(a) === wallClock(b);
  }
  return a === b;
};

export function electionEditLocks(election) {
  const frozen = Boolean(election?.electorate_frozen_at);
  return {
    frozen,
    term: Boolean(election),
    settings: frozen || Boolean(election?.results_released_at),
    visibility: Boolean(election?.results_released_at),
  };
}

export async function loadElectionForEdit(client, electionId) {
  if (!Number.isSafeInteger(Number(electionId)) || Number(electionId) <= 0) throw new Error("Election ID is invalid.");
  const { data: identity, error: sessionError } = await client.auth.getUser();
  if (sessionError || !identity?.user?.id) throw new Error("Your session has expired. Sign in again.");
  const { data: actor, error: actorError } = await client.from("admin_users")
    .select("id, role, status, organization_id").eq("auth_user_id", identity.user.id).eq("status", "active").maybeSingle();
  if (actorError || !actor || !["electoral_board", "super_admin"].includes(actor.role) ||
      (actor.role === "electoral_board" && !actor.organization_id)) throw new Error("An active authorized administrator is required.");
  let query = client.from("elections").select(ELECTION_MANAGEMENT_SELECT).eq("id", Number(electionId));
  if (actor.role === "electoral_board") query = query.eq("organization_id", actor.organization_id);
  const { data: election, error } = await query.single();
  if (error || !election) throw new Error("This election is unavailable in your authorized scope. Reload and retry.");
  let geo = await client.rpc("kandid_get_admin_election_geofence", { p_election_id: Number(electionId) });
  // The installed legacy schema permits this administrator read. Once the
  // privacy RPC is installed it is authoritative; never fall back on denial.
  if (geo.error?.code === "PGRST202") {
    geo = await client.from("elections").select("geo_lat, geo_lng, geo_radius_meters")
      .eq("id", election.id).eq("organization_id", election.organization_id).single();
  }
  if (geo.error || !geo.data) throw new Error("Election location settings could not be verified. Reload and retry.");
  return { ...election, ...geo.data };
}

export function buildElectionEditPatch(original, values) {
  const locks = electionEditLocks(original);
  const patch = {};
  for (const field of ELECTION_EDIT_FIELDS) {
    if (!Object.hasOwn(values, field) || same(field, original[field] ?? null, values[field])) continue;
    const frozenSettings = ["organization_id", "campaign_start", "campaign_end", "start_date", "end_date", "status",
      "voting_access_mode", "location_label", "geo_lat", "geo_lng", "geo_radius_meters"];
    if (field === "academic_term_id" || (locks.settings && frozenSettings.includes(field)) ||
        (locks.visibility && field === "student_result_visibility")) {
      throw new Error("Locked election settings cannot be changed. Reload the election to review its current state.");
    }
    patch[field] = values[field];
  }
  return patch;
}

export async function saveElectionEdit(client, original, values) {
  try {
    const patch = buildElectionEditPatch(original, values);
    if (!Object.keys(patch).length) return { data: { id: original.id }, error: null, unchanged: true };
    let query = client.from("elections").update(patch).eq("id", original.id);
    // Compare the saved snapshot atomically in the UPDATE predicate. The
    // existing RLS and lifecycle triggers remain the authority for the write.
    for (const field of [...ELECTION_EDIT_FIELDS, "electorate_frozen_at", "electorate_policy_version", "results_released_at"]) {
      if (!Object.hasOwn(original, field)) continue;
      query = original[field] == null ? query.is(field, null) : query.eq(field, original[field]);
    }
    const result = await query.select("id").single();
    if (!result.error && result.data?.id !== original.id) return { data: null, error: new Error("The saved election could not be confirmed. Reload before retrying.") };
    return result;
  } catch (error) {
    return { data: null, error };
  }
}

export function electionSaveError(error) {
  if (error?.code === "PGRST116") return "The election changed or your permission is no longer valid. Reload it before saving again.";
  if (error?.code === "42501" || error?.status === 403) return "This change is not permitted by your organization scope or the election lifecycle rules.";
  if (error?.status === 401) return "Your session has expired. Sign in again.";
  if (/temporary official-production development write safeguard/.test(error?.message || "")) return "Election saving is not activated for this production-connected development session. Your changes were not saved.";
  return error?.message || "The election could not be saved. Check your connection and retry.";
}
