const positiveId = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
const countFields = ["total_candidates", "eligible_candidates", "published_candidates", "draft_candidates", "hidden_candidates", "invalid_candidates"];

export function validateCampaignPublicationState(data, electionId) {
  if (!data || data.contract_version !== 1 || data.election_id !== electionId || !positiveId(electionId) ||
      !["empty", "draft", "published", "changes_pending", "blocked"].includes(data.publication_status) ||
      !countFields.every(key => Number.isInteger(data[key]) && data[key] >= 0) ||
      data.total_candidates !== data.eligible_candidates + data.hidden_candidates + data.invalid_candidates ||
      data.eligible_candidates !== data.published_candidates + data.draft_candidates ||
      typeof data.can_publish !== "boolean" || !Array.isArray(data.issues) ||
      !data.issues.every(issue => issue && typeof issue.message === "string" &&
        (issue.candidate_id === null || positiveId(issue.candidate_id))) ||
      typeof data.roster_fingerprint !== "string" || !/^[0-9a-f]{32}$/.test(data.roster_fingerprint) ||
      data.can_publish && (data.issues.length || !data.draft_candidates || !data.eligible_candidates || data.invalid_candidates)) {
    throw new Error("The campaign publication review is incomplete. Refresh it before continuing.");
  }
  return data;
}

async function authenticatedCall(client, name, args) {
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data?.user?.id) throw new Error("Your session has expired. Sign in again.");
  const { data, error } = await client.rpc(name, args).retry(false);
  if (error) throw error;
  return data;
}

export async function loadElectionCampaignPublication(client, electionId) {
  if (!positiveId(electionId)) throw new Error("Select an available election.");
  return validateCampaignPublicationState(await authenticatedCall(client,
    "kandid_get_election_campaign_publication_v1", { p_election_id: electionId }), electionId);
}

export async function publishElectionCampaigns(client, review) {
  validateCampaignPublicationState(review, review?.election_id);
  if (!review.can_publish) throw new Error("Resolve the campaign publication review issues before publishing.");
  // A single database transaction publishes the confirmed roster. No browser
  // loops, actor/organization overrides, or automatic mutation retries.
  const data = await authenticatedCall(client, "kandid_publish_election_campaigns_v1", {
    p_election_id: review.election_id,
    p_roster_fingerprint: review.roster_fingerprint,
  });
  validateCampaignPublicationState(data, review.election_id);
  if (data.confirmed !== true || data.publication_status !== "published" || data.draft_candidates !== 0 ||
      !Number.isInteger(data.updated_candidates) || data.updated_candidates < 0) {
    throw new Error("Publication could not be confirmed. Refresh the review before trying again.");
  }
  return data;
}

export function campaignPublicationError(error) {
  if (["PGRST202", "42883"].includes(error?.code)) return "Election campaign publication backend is not installed. Candidate preparation remains separate; publication requires the reviewed migration.";
  if (["40001", "40P01", "55P03"].includes(error?.code)) return "The roster is changing or another operation is in progress. Refresh the publication review and confirm again.";
  if (error?.code === "42501") return "Campaign publication was denied. Your active administrator assignment, election scope, or lifecycle no longer permits this action.";
  return error?.message || "Campaign publication is unavailable. Check your connection and retry the review.";
}
