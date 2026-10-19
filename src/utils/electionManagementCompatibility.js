// Keep the baseline projection compatible with the installed production schema.
export const ELECTION_MANAGEMENT_SELECT = `
  id, organization_id, title, start_date, end_date, status, created_at,
  campaign_start, campaign_end, voting_results_visible,
  student_result_visibility, voting_access_mode, location_label,
  results_released_at, cover_url, academic_term_id,
  electorate_policy_version, electorate_frozen_at,
  organizations(name, logo_url)
`;

// A flag requests the feature; a successful authorized backend read proves the
// endpoint and its removal-column query are installed. Never probe while OFF.
export async function verifyElectionRemovalReadiness(enabled, invoke) {
  if (!enabled) return false;
  try {
    const { data, error } = await invoke("list_removed", { limit: 1, offset: 0 });
    return !error && Array.isArray(data?.elections) &&
      Number.isSafeInteger(data.total) && data.total >= data.elections.length &&
      data.limit === 1 && data.offset === 0 && data.elections.length <= 1 &&
      data.elections.every((row) => Number.isSafeInteger(row.id) && row.id > 0 &&
        typeof row.removed_at === "string" && Number.isFinite(Date.parse(row.removed_at)));
  } catch {
    return false;
  }
}

export function electionManagementQuery(client, { organizationId, removalReady = false } = {}) {
  let query = client.from("elections").select(ELECTION_MANAGEMENT_SELECT);
  if (organizationId != null) query = query.eq("organization_id", organizationId);
  if (removalReady === true) query = query.is("removed_at", null);
  return query.order("created_at", { ascending: false });
}
