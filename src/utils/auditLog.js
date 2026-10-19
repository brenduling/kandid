import { supabase } from "../lib/supabaseClient";
import { getStoredUser } from "./auth";
import { formatRelativeTime, parseUtcTimestamp } from "./time";

const ACTION_LABELS = {
  organization_created: "Organization Created",
  organization_updated: "Organization Updated",
  organization_deleted: "Organization Deleted",
  organization_delete_blocked: "Organization Delete Blocked",
  student_created: "Student Created",
  student_updated: "Student Updated",
  student_deleted: "Student Deleted",
  student_delete_blocked: "Student Delete Blocked",
  election_created: "Election Created",
  election_updated: "Election Updated",
  election_deleted: "Election Deleted",
  election_archived: "Election Archived",
  election_delete_blocked: "Election Delete Blocked",
  results_published: "Results Published",
  position_created: "Position Created",
  position_updated: "Position Updated",
  position_deleted: "Position Deleted",
  position_retired: "Position Retired",
  candidate_created: "Candidate Created",
  candidate_updated: "Candidate Updated",
  candidate_deleted: "Candidate Deleted",
  candidate_delete_blocked: "Candidate Delete Blocked",
  partylist_created: "Partylist Created",
  partylist_updated: "Partylist Updated",
  partylist_deleted: "Partylist Deleted",
  partylist_delete_blocked: "Partylist Delete Blocked",
  officer_created: "Officer Created",
  officer_updated: "Officer Updated",
  officer_deleted: "Officer Deleted",
  officer_delete_blocked: "Officer Delete Blocked",
  eligibility_rule_created: "Eligibility Rule Created",
  eligibility_rule_updated: "Eligibility Rule Updated",
  eligibility_rule_deleted: "Eligibility Rule Deleted",
  eligibility_rule_delete_blocked: "Eligibility Rule Delete Blocked",
  student_batch_imported: "Students Imported",
  user_created: "User Created",
  user_updated: "User Updated",
  user_deleted: "User Deleted",
  user_delete_blocked: "User Delete Blocked",
  archived_election_delete_blocked: "Archived Election Delete Blocked",
  archived_election_deleted: "Archived Election Deleted",
  system_setting_updated: "System Setting Updated",
  blockchain_tx_updated: "Blockchain Transaction Updated",
  login: "Login",
  logout: "Logout",
};

export function humanizeAction(action = "") {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  return String(action || "Activity")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function inferAuditStatus(action = "", explicitStatus = "") {
  if (explicitStatus) return humanizeAction(explicitStatus);
  const normalized = String(action).toLowerCase();
  if (normalized.includes("blocked")) return "Requires Action";
  if (normalized.includes("failed")) return "Failed";
  if (normalized.includes("archive")) return "Archived";
  if (normalized.includes("update")) return "Updated";
  if (normalized.includes("create") || normalized.includes("import")) return "Created";
  if (normalized.includes("delete") || normalized.includes("removed")) return "Deleted";
  return "Completed";
}

export function relativeTime(value) {
  return formatRelativeTime(value, new Date());
}

function normalizeAuditTimestamp(value) {
  const date = parseUtcTimestamp(value);
  return date ? date.toISOString() : value;
}

export function normalizeAuditRecord(record = {}) {
  const createdAt = normalizeAuditTimestamp(record.created_at || record.timestamp);
  return {
    id: record.id,
    action: record.action || record.event_type || "activity",
    event: humanizeAction(record.action || record.event_type),
    actor: record.actor_name || "Legacy administrator",
    actorRole: record.actor_role || "Unknown",
    entityType: record.entity_type || "",
    entityId: record.entity_id || "",
    entityLabel: record.entity_label || "",
    organization:
      record.organization_name ||
      record.organizations?.name ||
      (record.organization_id ? `Organization #${record.organization_id}` : "System"),
    organizationId: record.organization_id,
    status: inferAuditStatus(record.action, record.status),
    createdAt,
    time: relativeTime(createdAt),
    metadata: record.safe_details || {},
    changedFields: Array.isArray(record.changed_fields) ? record.changed_fields : [],
    category: record.category || "system",
    electionId: record.election_id || null,
    isLegacy: Boolean(record.is_legacy),
  };
}

export async function logAuditEvent({
  action,
  entityType,
  entityId,
  entityLabel,
  organizationId,
  organizationName,
  status = "completed",
  metadata = {},
  user = getStoredUser(),
} = {}) {
  // Compatibility shim for old call sites during local migration rollout.
  // Browser code is never an audit writer; DB triggers and authenticated
  // Edge/server boundaries now record the actual operation.
  void action;
  void entityType;
  void entityId;
  void entityLabel;
  void organizationId;
  void organizationName;
  void status;
  void metadata;
  void user;
  window.dispatchEvent(new CustomEvent("kandid-audit-updated"));
  return { error: null, skipped: true };
}

export async function fetchAuditLogs({
  limit = 5,
  cursor = null,
  organizationId,
  search,
  action,
  entityType,
  status,
  category,
  electionId,
  date,
} = {}) {
  const storedUser = getStoredUser();
  const isBoard = storedUser?.role === "electoral_board";
  const isSuperAdmin = storedUser?.role === "super_admin";
  if (!isBoard && !isSuperAdmin) {
    return { data: [], error: new Error("Audit history is unavailable for this account."), hasMore: false, nextCursor: null };
  }

  const args = {
    p_before_created_at: cursor?.created_at || null,
    p_before_id: cursor?.id || null,
    p_page_size: limit,
    p_category: category || null,
    p_event_type: action || null,
    p_election_id: electionId || null,
    p_search: search || null,
  };
  const { data, error } = isBoard
    ? await supabase.rpc("kandid_list_board_audit_events", args)
    : await supabase.rpc("kandid_list_super_admin_audit_events", {
      ...args,
      p_organization_id: organizationId || null,
      p_entity_type: entityType || null,
      p_status: status || null,
      p_created_on: date || null,
    });
  if (error) return { data: [], error, hasMore: false, nextCursor: null };

  let events = (data?.events || []).map(normalizeAuditRecord);
  // Compatibility filters for the existing Super Admin surface. These are
  // presentation filters only; authorization and tenant scope are enforced by
  // the database RPC before rows reach the browser.
  if (entityType) events = events.filter((event) => event.entityType === entityType);
  if (status) events = events.filter((event) => event.status === status);
  return {
    data: events,
    error: null,
    hasMore: Boolean(data?.has_more),
    nextCursor: data?.next_cursor || null,
  };
}
