import { supabase } from "../lib/supabaseClient";
import { getStoredUser } from "./auth";
import { fetchAuthoritativeNow } from "./elections";
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
    action: record.action || "activity",
    event: humanizeAction(record.action),
    actor: record.actor_name || record.user_id || "System",
    actorRole: record.actor_role || "System",
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
    metadata: record.metadata || {},
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
  if (!action) return { error: null };

  const safeMetadata = { ...metadata };
  delete safeMetadata.password;
  delete safeMetadata.token;
  delete safeMetadata.access_token;
  delete safeMetadata.refresh_token;
  delete safeMetadata.ballot;
  delete safeMetadata.selections;
  delete safeMetadata.selectedCandidates;

  const serverNow = await fetchAuthoritativeNow();
  const authoritativeTimestamp = serverNow.toISOString();

  const richPayload = {
    user_id: user?.id || null,
    actor_name:
      user?.full_name ||
      [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
      user?.email ||
      user?.student_number ||
      "System",
    actor_role: user?.role || "system",
    action,
    entity_type: entityType || null,
    entity_id: entityId == null ? null : String(entityId),
    entity_label: entityLabel || null,
    organization_id: organizationId || user?.organization_id || null,
    organization_name:
      organizationName ||
      user?.organizations?.name ||
      null,
    status,
    metadata: safeMetadata,
    timestamp: authoritativeTimestamp,
    created_at: authoritativeTimestamp,
  };

  const { error } = await supabase.from("audit_logs").insert([richPayload]);
  if (!error) {
    window.dispatchEvent(new CustomEvent("kandid-audit-updated"));
    return { error: null };
  }

  const fallbackPayload = {
    user_id: richPayload.user_id,
    action: humanizeAction(action),
    timestamp: richPayload.timestamp,
  };

  const fallback = await supabase.from("audit_logs").insert([fallbackPayload]);
  if (!fallback.error) {
    window.dispatchEvent(new CustomEvent("kandid-audit-updated"));
  } else {
    console.warn("Audit event was not recorded:", fallback.error);
  }
  return fallback;
}

export async function fetchAuditLogs({
  limit = 5,
  from = 0,
  to,
  organizationId,
  search,
  action,
  entityType,
  status,
} = {}) {
  const end = to ?? from + limit - 1;
  const hasRichFilters = Boolean(search || organizationId || entityType || status);
  let query = supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .range(from, end);

  if (organizationId) query = query.eq("organization_id", organizationId);
  if (action) query = query.ilike("action", `%${action}%`);
  if (entityType) query = query.eq("entity_type", entityType);
  if (status) query = query.eq("status", status);
  if (search) {
    query = query.or(
      `action.ilike.%${search}%,actor_name.ilike.%${search}%,entity_label.ilike.%${search}%,organization_name.ilike.%${search}%`,
    );
  }

  let { data, error } = await query;
  if (error) {
    if (organizationId) {
      return { data: [], error };
    }

    let fallback = supabase
      .from("audit_logs")
      .select("id, user_id, action, timestamp")
      .order("timestamp", { ascending: false })
      .range(from, end);
    if (action) fallback = fallback.ilike("action", `%${action}%`);
    ({ data, error } = await fallback);

    if (!error && hasRichFilters) {
      const normalizedSearch = String(search || "").trim().toLowerCase();
      data = (data || []).filter((record) => {
        const normalized = normalizeAuditRecord(record);
        const matchesSearch =
          !normalizedSearch ||
          [normalized.event, normalized.actor, normalized.action]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch);
        return matchesSearch;
      });
    }
  }

  return {
    data: (data || []).map(normalizeAuditRecord),
    error,
  };
}
