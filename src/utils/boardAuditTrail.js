export const BOARD_AUDIT_CATEGORIES = [
  { value: "elections", label: "Elections" },
  { value: "positions", label: "Positions" },
  { value: "candidates", label: "Candidates" },
  { value: "partylists", label: "Partylists" },
  { value: "eligibility", label: "Eligibility" },
  { value: "officers", label: "Officers" },
  { value: "students", label: "Students & membership" },
  { value: "organization", label: "Organization" },
  { value: "security", label: "Security" },
  { value: "system", label: "System" },
];

const EVENT_LABELS = {
  election_created: "Election created",
  election_updated: "Election updated",
  election_deleted: "Election deleted",
  election_status_changed: "Election status changed",
  election_archived: "Election archived",
  results_published: "Results published",
  position_created: "Position created",
  position_updated: "Position updated",
  position_deleted: "Position deleted",
  position_retired: "Position retired",
  candidate_created: "Candidate added",
  candidate_updated: "Candidate updated",
  candidate_removed: "Candidate removed",
  candidate_status_changed: "Candidate status changed",
  partylist_created: "Partylist created",
  partylist_updated: "Partylist updated",
  partylist_removed: "Partylist removed",
  eligibility_rule_created: "Eligibility rule created",
  eligibility_rule_updated: "Eligibility rule updated",
  eligibility_rule_removed: "Eligibility rule removed",
  officer_current_added: "Officer added to Current leadership",
  officer_elected_staged: "Elected officer prepared",
  officer_appointed_staged: "Appointed officer prepared",
  officer_staged_removed: "Prepared officer removed",
  officer_staged_updated: "Prepared officer updated",
  officer_roster_released: "Officer roster released",
  officer_release_removed: "Leadership release removed",
  officer_updated: "Officer updated",
  officer_removed: "Officer removed",
  student_created: "Student created",
  student_updated: "Student updated",
  student_deleted: "Student deleted",
  student_enrolled: "Student enrolled",
  student_term_enrolled: "Student enrolled for term",
  student_batch_imported: "Student roster imported",
  student_identity_updated: "Student identity updated",
  membership_added: "Organization membership added",
  membership_removed: "Organization membership removed",
  membership_restored: "Organization membership restored",
  membership_updated: "Organization membership updated",
  organization_created: "Organization created",
  organization_updated: "Organization updated",
  organization_deleted: "Organization deleted",
  organization_program_coverage_changed: "Program coverage changed",
  organization_program_coverage_replaced: "Program coverage changed",
  program_catalog_entry_created: "Program catalog entry created",
  security_login: "Signed in",
  security_logout: "Signed out",
  login: "Signed in",
  logout: "Signed out",
};

const FIELD_LABELS = {
  campaign_start: "Campaign start",
  campaign_end: "Campaign end",
  start_date: "Voting start",
  end_date: "Voting end",
  status: "Status",
  title: "Title",
  name: "Name",
  position_title: "Position",
  max_votes: "Maximum votes",
  partylist_id: "Partylist",
  academic_term_id: "Academic term",
  leadership_academic_year: "Leadership year",
  selection_type: "Selection type",
  program_ids: "Covered programs",
};

function humanize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function boardAuditActionLabel(eventType) {
  const key = String(eventType || "").trim().toLowerCase();
  return EVENT_LABELS[key] || humanize(key) || "Activity recorded";
}

export function boardAuditCategoryLabel(category) {
  return BOARD_AUDIT_CATEGORIES.find((item) => item.value === category)?.label || humanize(category) || "System";
}

export function boardAuditActorLabel(event) {
  const actorName = String(event?.actor_name || "").trim();
  if (event?.is_legacy && (!actorName || actorName.toLowerCase() === "legacy administrator")) {
    return "Legacy record";
  }
  return actorName || "Actor not recorded";
}

export function boardAuditActorRole(event) {
  const role = String(event?.actor_role || "").trim();
  if (!role || role.toLowerCase() === "unknown") {
    return event?.is_legacy ? "Historical activity" : "Role unavailable";
  }
  return humanize(role);
}

export function boardAuditTargetLabel(event) {
  const label = String(event?.entity_label || "").trim();
  if (label) return label;
  const entityType = String(event?.entity_type || "").trim();
  return entityType ? humanize(entityType) : "Record";
}

export function boardAuditStatusLabel(status) {
  return humanize(status) || "Completed";
}

export function boardAuditChangedFieldLabels(fields) {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((field) => typeof field === "string" && field.trim())
    .map((field) => FIELD_LABELS[field] || humanize(field));
}

function programNames(value) {
  if (!Array.isArray(value)) return [];
  return value.map((program) => {
    if (typeof program === "string") return program;
    if (!program || typeof program !== "object") return "";
    const name = typeof program.name === "string" ? program.name.trim() : "";
    const code = typeof program.code === "string" ? program.code.trim() : "";
    return name && code ? `${name} (${code})` : name || code;
  }).filter(Boolean);
}

export function boardAuditSafeDetails(event) {
  const details = event?.safe_details && typeof event.safe_details === "object"
    ? event.safe_details
    : {};
  const changedFields = boardAuditChangedFieldLabels(event?.changed_fields);
  const beforePrograms = programNames(details.before_programs);
  const afterPrograms = programNames(details.after_programs);
  if (!changedFields.length && !beforePrograms.length && !afterPrograms.length) return null;
  return { changedFields, beforePrograms, afterPrograms };
}

export function buildBoardAuditRpcArgs({ cursor, pageSize = 50, category, eventType, electionId, search } = {}) {
  return {
    p_before_created_at: cursor?.created_at || null,
    p_before_id: cursor?.id || null,
    p_page_size: pageSize,
    p_category: category || null,
    p_event_type: eventType || null,
    p_election_id: electionId || null,
    p_search: search || null,
  };
}
