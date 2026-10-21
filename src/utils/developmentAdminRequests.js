import { ELECTION_EDIT_FIELDS } from "./electionEditContract.js";

// This is a transport allow-list, NOT authorization. Requests retain the SDK's
// JWT and reach the same RLS / authenticated Edge / RPC contracts as production.
// No browser role, localStorage value or localhost origin grants permissions.
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const only = (value, keys) => object(value) && Object.keys(value).length > 0 && Object.keys(value).every(key => keys.includes(key));
const positive = value => Number.isSafeInteger(value) && value > 0;
const idFilter = url => url.searchParams.getAll("id").length === 1 && /^eq\.[1-9][0-9]*$/.test(url.searchParams.get("id"));
const tableFields = {
  elections: [...ELECTION_EDIT_FIELDS, "voting_results_visible"],
  positions: ["election_id", "name", "max_votes", "display_order", "status"],
  partylists: ["organization_id", "name", "description", "logo_url"],
  election_access_tokens: ["election_id", "token", "scope_type", "scope_value", "expires_at", "is_active"],
};
const officerActions = {
  list: [], organizations: [], student_counts: ["student_id", "organization_id"],
  winners: ["election_id", "organization_id"], incoming_leadership: ["organization_id"],
  finalize_results: ["election_id"], update_service: ["officer_id", "changes"], delete: ["officer_id"],
  add_incoming_elected: ["organization_id", "candidate_id", "service"],
  add_incoming_appointed: ["organization_id", "student_id", "position_title", "service"],
  add_current_officer: ["organization_id", "selection_type", "student_id", "candidate_id", "position_title", "service", "confirm_term_context"],
  update_new_officer: ["organization_id", "new_officer_id", "changes"],
  remove_new_officer: ["organization_id", "new_officer_id"], release_leadership: ["organization_id"],
};
const adminActions = {
  list: [], create: ["admin"], update: ["id", "admin"], disable: ["id"], delete: ["id"],
  invite_existing_admin: ["id"], relink_existing_admin: ["id"], update_self_profile: ["profile"],
};
const orgReads = {
  student_organization_ids: ["student_id"], eligible_students_for_organization: ["organization_id"],
  current_organization_member_count: ["organization_id"], current_organization_members: ["organization_id"],
  current_memberships_for_students: ["student_ids"],
};
const rpcFields = {
  kandid_ensure_program_catalog_entry: ["p_code"],
  kandid_replace_organization_program_coverage: ["p_organization_id", "p_program_ids"],
  kandid_save_organization_configuration: ["p_organization_id", "p_name", "p_description", "p_logo_url", "p_organization_type", "p_program_ids"],
  kandid_get_organization_deletion_readiness: ["p_organization_id"],
  kandid_delete_organization: ["p_organization_id"],
};

export function isBackendAuthorizedAdminRequest(url, method, payload, headers) {
  // Stay in the public API contract; no alternate schema or merge-upsert route.
  if (["content-profile", "accept-profile"].some(key => headers.has(key) && headers.get(key) !== "public") ||
      /resolution=/i.test(headers.get("prefer") || "")) return false;

  const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
  if (table === "archived_elections") return method === "DELETE" && idFilter(url) && payload == null;
  if (Object.hasOwn(tableFields, table)) {
    const fields = tableFields[table];
    if (![...url.searchParams.keys()].every(key => ["select", "columns", "id", "electorate_frozen_at", "electorate_policy_version", "results_released_at", ...fields].includes(key))) return false;
    if (method === "POST") {
      const rows = Array.isArray(payload) ? payload : [payload];
      return rows.length > 0 && rows.length <= 500 && rows.every(row => only(row, fields) &&
        (table !== "elections" || positive(row.organization_id) && positive(row.academic_term_id)) &&
        (!["positions", "election_access_tokens"].includes(table) || positive(row.election_id)) &&
        (table !== "partylists" || positive(row.organization_id)));
    }
    if (!idFilter(url)) return false;
    // Physical election deletion stays behind the existing password-protected
    // soft-removal operation. Term, freeze, release and policy fields never PATCH.
    if (method === "DELETE") return ["positions", "partylists"].includes(table) && payload == null;
    return method === "PATCH" && only(payload, fields) &&
      (table !== "elections" || !Object.hasOwn(payload, "academic_term_id"));
  }
  if (method !== "POST" || url.search || !object(payload)) return false;
  const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)?.[1];
  // The Board workflow checks the reviewed preview capability before this
  // trusted operation. The backend remains responsible for every permission,
  // cutoff, snapshot and rule check; no manual electorate write is admitted.
  if (rpc === "kandid_lock_board_electorate") return only(payload, ["p_election_id"]) && positive(payload.p_election_id);
  if (Object.hasOwn(rpcFields, rpc)) return only(payload, rpcFields[rpc]);
  const endpoint = url.pathname.match(/^\/functions\/v1\/([a-z-]+)$/)?.[1];
  const actions = endpoint === "officers-contract" ? officerActions : endpoint === "admin-user-management" ? adminActions : endpoint === "organization-eligibility" ? orgReads : null;
  if (actions) return Object.hasOwn(actions, payload.action) && only(payload, ["action", ...actions[payload.action]]);
  // These existing UI workflows require their own JWT-checked deployments.
  // A missing deployment still returns an error; never substitute direct table
  // access or a caller-supplied server actor for the trusted endpoint.
  if (["admin-academic-terms", "super-admin-manual-enrollment", "super-admin-masterlist-import"].includes(endpoint)) {
    return typeof payload.action === "string" && /^[a-z_]{1,80}$/.test(payload.action) &&
      !Object.keys(payload).some(key => /^(?:p_)?actor_|^(?:admin_id|auth_user_id|service_role|role)$/.test(key));
  }
  return false;
}
