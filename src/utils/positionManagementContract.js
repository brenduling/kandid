import { buildElectionDeleteReview } from "./electionDeleteReview.js";

const integer = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
const failure = message => Object.assign(new Error(message), { code: "POSITION_VALIDATION" });
const uncertain = () => Object.assign(new Error("Position creation could not be confirmed. It may already have been saved. Check the position list before starting another creation; do not resubmit this form."), { code: "POSITION_CREATE_UNCONFIRMED" });

export function validatePositionValues(values, electionId) {
  if (!values || !integer(Number(electionId)) || Number(values.election_id) !== Number(electionId)) throw failure("A position must remain in its selected parent election.");
  const row = { election_id: Number(electionId), name: typeof values.name === "string" ? values.name.trim() : "", max_votes: Number(values.max_votes), display_order: Number(values.display_order) };
  if (!row.name || row.name.length > 100 || [...row.name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw failure("Enter a position name of 1–100 characters.");
  if (!integer(row.max_votes)) throw failure("Maximum votes must be a positive whole number.");
  if (!integer(row.display_order)) throw failure("Display order must be a positive whole number.");
  return row;
}

export async function loadPositionManagementContext(client, electionId) {
  if (!integer(Number(electionId))) throw failure("Choose an available election.");
  const { data: identity, error: authError } = await client.auth.getUser();
  if (authError || !identity?.user?.id) throw Object.assign(failure("Your session has expired. Sign in again."), { status: 401 });
  const { data: actor, error: actorError } = await client.from("admin_users").select("id, role, status, organization_id")
    .eq("auth_user_id", identity.user.id).eq("status", "active").maybeSingle();
  if (actorError || !actor || actor.status !== "active" || !["electoral_board", "super_admin"].includes(actor.role)) throw Object.assign(failure("Active Electoral Board or Super Admin access is required."), { status: 403 });
  let query = client.from("elections").select("id, organization_id, removed_at, electorate_frozen_at, results_released_at").eq("id", Number(electionId));
  if (actor.role === "electoral_board") {
    if (!integer(actor.organization_id)) throw Object.assign(failure("No organization is assigned to this Board."), { status: 403 });
    query = query.eq("organization_id", actor.organization_id);
  }
  const { data: election, error: electionError } = await query.single();
  if (electionError || !election || (actor.role === "electoral_board" && election.organization_id !== actor.organization_id)) throw failure("This election is unavailable in your authorized organization, or its safety settings could not be loaded.");
  if (election.removed_at) throw failure("This election has been removed. Its positions are read-only.");
  // The installed authenticated RPC applies the actual Manila-time lifecycle and
  // trusted Board scope. RLS and triggers recheck on the subsequent mutation.
  const { data: allowed, error: policyError } = await client.rpc("kandid_can_mutate_election_positions", { p_election_id: election.id });
  if (policyError || allowed !== true) throw failure("Position changes are unavailable for this election's current lifecycle or your permissions. Refresh before retrying.");
  return election;
}

async function positionRows(client, electionId) {
  const result = await client.from("positions").select("id, election_id, name, max_votes, display_order, status").eq("election_id", Number(electionId));
  if (result.error || !Array.isArray(result.data)) throw failure("Existing positions could not be checked. No change was submitted; refresh and retry.");
  return result.data;
}

function rejectDuplicates(rows, row, exceptId) {
  const other = rows.filter(p => p.id !== exceptId);
  if (other.some(p => String(p.name || "").trim().toLowerCase() === row.name.toLowerCase())) throw failure("This position already exists in this election.");
  if (other.some(p => p.display_order === row.display_order)) throw failure("Another position already uses that display order. Refresh and choose an available order.");
}

export function createPositionSubmission(client) {
  let pending, confirmed, unconfirmed = false;
  return function submit(values, electionId) {
    if (confirmed) return Promise.resolve(confirmed);
    if (unconfirmed) return Promise.resolve({ data: null, error: uncertain() });
    if (pending) return pending;
    pending = (async () => {
      let insertStarted = false;
      try {
        const row = validatePositionValues(values, electionId);
        await loadPositionManagementContext(client, electionId);
        rejectDuplicates(await positionRows(client, electionId), row);
        insertStarted = true;
        // status uses the installed active default: the existing INSERT column
        // grant intentionally does not include status. Never send a parent override.
        const result = await client.from("positions").insert([row]).select("id").single().retry(false);
        if (result.error && (result.status && result.status < 500)) return result;
        if (result.error || !integer(result.data?.id)) {
          if (/temporary official-production development write safeguard/.test(result.error?.message || "")) return result;
          unconfirmed = true; return { data: null, error: uncertain() };
        }
        confirmed = result; return result;
      } catch (error) {
        if (insertStarted) { unconfirmed = true; return { data: null, error: uncertain() }; }
        return { data: null, error };
      }
    })().finally(() => { pending = null; });
    return pending;
  };
}

async function updatePosition(client, original, patch) {
  if (!integer(original?.id)) throw failure("Choose an available position.");
  await loadPositionManagementContext(client, original.election_id);
  let query = client.from("positions").update(patch).eq("id", original.id).eq("election_id", original.election_id);
  for (const key of ["name", "max_votes", "display_order", "status"]) {
    if (!Object.hasOwn(original, key)) continue;
    query = original[key] == null ? query.is(key, null) : query.eq(key, original[key]);
  }
  const result = await query.select("id").single().retry(false);
  if (!result.error && result.data?.id !== original.id) throw failure("The saved position could not be confirmed. Reload before retrying.");
  return result;
}

export async function savePositionEdit(client, original, values) {
  try {
    const row = validatePositionValues(values, original.election_id);
    await loadPositionManagementContext(client, original.election_id);
    rejectDuplicates(await positionRows(client, original.election_id), row, original.id);
    const patch = Object.fromEntries(["name", "max_votes", "display_order"].filter(k => row[k] !== original[k]).map(k => [k, row[k]]));
    if (!Object.keys(patch).length) return { data: { id: original.id }, error: null, unchanged: true };
    return await updatePosition(client, original, patch);
  } catch (error) { return { data: null, error }; }
}

export async function changePositionStatus(client, original, status) {
  try {
    if (!["active", "retired"].includes(status)) throw failure("Position status is invalid.");
    return await updatePosition(client, original, { status });
  } catch (error) { return { data: null, error }; }
}

export async function reorderPositions(client, electionId, positions, orders) {
  try {
    if (!Array.isArray(positions) || !Array.isArray(orders) || !positions.length || positions.length !== orders.length ||
        !positions.every(integer) || !orders.every(integer) || new Set(positions).size !== positions.length || new Set(orders).size !== orders.length) throw failure("Position IDs and display orders must be unique positive whole numbers.");
    await loadPositionManagementContext(client, electionId);
    const existing = await positionRows(client, electionId);
    if (positions.some(id => !existing.some(row => row.id === id))) throw failure("Every reordered position must belong to the selected election.");
    return await client.rpc("reorder_election_positions", { p_election_id: Number(electionId), p_position_ids: positions, p_display_orders: orders }).retry(false);
  } catch (error) { return { data: null, error }; }
}

export async function deleteUnreferencedPosition(client, original) {
  try {
    await loadPositionManagementContext(client, original.election_id);
    const review = await client.functions.invoke("manage-election-removal", { body: { action: "review", election_id: original.election_id } });
    const summary = review.data?.data;
    if (review.error || buildElectionDeleteReview(summary).error) throw failure("Election history could not be verified. Deletion is blocked; retry the review.");
    const protectedKeys = ["votes", "ballot_records", "frozen_electorate", "published_results", "campaign_snapshots", "officer_references", "prepared_officer_rows", "leadership_releases", "officer_publications", "publication_entries", "archive_references", "blockchain_evidence"];
    if (protectedKeys.some(key => summary.counts[key] > 0)) throw failure("This election contains frozen or historical records. Its position must be preserved.");
    const candidates = await client.from("candidates").select("id", { count: "exact", head: true }).eq("position_id", original.id);
    if (candidates.error || !Number.isSafeInteger(candidates.count) || candidates.count !== 0) throw failure("Linked candidates could not be ruled out. This position cannot be deleted.");
    // No CASCADE. Existing FK, RLS, immutable-parent, removal and audit guards remain authoritative.
    const result = await client.from("positions").delete().eq("id", original.id).eq("election_id", original.election_id).select("id").single().retry(false);
    if (!result.error && result.data?.id !== original.id) throw failure("Position deletion was not confirmed. Refresh the list.");
    return result;
  } catch (error) { return { data: null, error }; }
}

export function positionSaveError(error) {
  if (error?.code === "PGRST116") return "The position changed or your permission is no longer valid. Reload it before saving again.";
  if (error?.code === "23505" && /positions_election_normalized_name_unique/.test([error.constraint, error.message, error.details].filter(Boolean).join(" "))) return "This position already exists in this election.";
  if (error?.code === "23505") return "Another position already uses that display order. Refresh the list before retrying.";
  if (error?.code === "23503") return "Related records protect this position. It was not deleted.";
  if (error?.code === "42501" || error?.status === 403) return "This position change is not permitted by your organization scope or the election lifecycle.";
  if (/temporary official-production development write safeguard/.test(error?.message || "")) return "Position management is not activated for this production-connected development session. No change was saved.";
  return error?.message || "The position change could not be confirmed. Check your connection and refresh before retrying.";
}
