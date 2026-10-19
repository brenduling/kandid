export const ELECTION_DELETE_DEPENDENCIES = Object.freeze([
  { key: "positions", label: "Positions", reason: "Election positions are linked setup records." },
  { key: "candidates", label: "Candidates", reason: "Candidate records depend on this election's positions." },
  { key: "votes", label: "Votes", reason: "Vote records are protected election history." },
  { key: "ballot_records", label: "Ballot records", reason: "Ballots and their receipts must remain intact." },
  { key: "frozen_electorate", label: "Frozen eligible voters", reason: "The election's frozen eligibility snapshot is preserved." },
  { key: "partylists", label: "Partylists", reason: "Election-linked or candidate-referenced partylists are related records." },
  { key: "eligibility_rules", label: "Eligibility rules", reason: "Eligibility configuration belongs to this election." },
  { key: "published_results", label: "Published results", reason: "Released result state must remain available." },
  { key: "access_tokens", label: "Access tokens", reason: "Election access credentials must not be removed by a cascading delete." },
  { key: "campaign_snapshots", label: "Campaign snapshots", reason: "Captured campaign evidence is immutable history." },
  { key: "officer_references", label: "Officer references", reason: "Officer records refer to this election or its candidates." },
  { key: "prepared_officer_rows", label: "Prepared officer roster rows", reason: "Prepared leadership records refer to this election." },
  { key: "leadership_releases", label: "Leadership releases", reason: "Published leadership transitions are preserved." },
  { key: "officer_publications", label: "Officer publications", reason: "Published officer records are immutable history." },
  { key: "publication_entries", label: "Officer publication entries", reason: "Published officer entries must remain attached to their release." },
  { key: "candidate_media", label: "Candidate media", reason: "Candidate media is a related record and is not removed here." },
  { key: "archive_references", label: "Archive references", reason: "Existing archive records refer to this election." },
  { key: "blockchain_evidence", label: "Blockchain evidence references", reason: "Anchor transaction evidence must remain intact." },
  { key: "audit_references", label: "Audit records", reason: "Election audit history must remain intact." },
]);

const protectedHistoryKeys = new Set([
  "votes",
  "ballot_records",
  "frozen_electorate",
  "published_results",
  "campaign_snapshots",
  "officer_references",
  "prepared_officer_rows",
  "leadership_releases",
  "officer_publications",
  "publication_entries",
  "archive_references",
  "blockchain_evidence",
  "audit_references",
]);

export function buildElectionDeleteReview(summary) {
  const counts = summary?.counts;
  const valid = summary?.schema_version === 1 &&
    ELECTION_DELETE_DEPENDENCIES.every(({ key }) => Number.isSafeInteger(counts?.[key]) && counts[key] >= 0) &&
    typeof summary.may_delete === "boolean" && typeof summary.protected_history === "boolean";

  if (!valid) {
    return {
      blocked: true,
      severity: "unavailable",
      recommendation: "Kandid could not verify every related-record category. Nothing was deleted; retry the review.",
      dependencies: [],
      error: true,
    };
  }

  const dependencies = ELECTION_DELETE_DEPENDENCIES.map((item) => ({
    ...item,
    count: counts[item.key],
    protected: protectedHistoryKeys.has(item.key),
  }));
  const anyRecords = dependencies.some((item) => item.count > 0);
  const protectedHistory = dependencies.some((item) => item.protected && item.count > 0);
  if (
    summary.may_delete === anyRecords ||
    summary.protected_history !== protectedHistory
  ) {
    return {
      blocked: true,
      severity: "unavailable",
      recommendation: "Kandid received an inconsistent dependency result. Nothing was deleted; retry the review.",
      dependencies: [],
      error: true,
    };
  }

  if (!summary.may_delete) {
    return {
      blocked: false,
      severity: summary.protected_history ? "preserved_history" : "preserved_related_records",
      recommendation: summary.protected_history
        ? "Protected voting, ballot, electorate, result, blockchain, officer, and audit history will remain attached. Removal only hides this election from management lists."
        : "Related setup records will remain attached. Removal only hides this election from management lists.",
      dependencies,
      error: false,
    };
  }

  return {
    blocked: false,
    severity: "soft_removal",
    recommendation: "No related records were found. The election will be hidden from management lists and can be restored later.",
    dependencies,
    error: false,
  };
}

export async function loadElectionDeleteReview(electionId, invoke, { removalReady = false } = {}) {
  const id = Number(electionId);
  if (!Number.isSafeInteger(id) || id <= 0) return buildElectionDeleteReview(null);

  try {
    let callAction = invoke;
    if (!callAction) {
      const { callVoteAccess } = await import("./voteAccess.js");
      callAction = callVoteAccess;
    }
    const { data, error } = await callAction(removalReady ? "review" : "election_dependency_summary", { election_id: id });
    if (error || !data || data.election_id !== id) return buildElectionDeleteReview(null);
    const review = buildElectionDeleteReview(data);
    if (review.error || removalReady) return review;
    return {
      ...review,
      blocked: true,
      recommendation: data.protected_history
        ? "Protected election history prevents permanent deletion. These records must remain intact. Soft removal is not activated."
        : "Review the related records below. Soft removal is not activated; no election changes are available here.",
    };
  } catch {
    return buildElectionDeleteReview(null);
  }
}
