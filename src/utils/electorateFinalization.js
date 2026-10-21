// Capability/readiness checks are presentation and workflow checks. The lock
// RPC always derives the Board identity, recomputes eligibility and commits
// snapshot + freeze + audit atomically. Never send student IDs or a client count.
export const ELECTORATE_RULE_CONTRACT = "membership-optional-rules-v1";

export function electorateLockBlock(preview, electionId) {
  if (!preview || Number(preview.election_id) !== Number(electionId)) return "Refresh the electorate preview before continuing.";
  if (preview.is_locked) return "This electorate is already locked.";
  // Election 4 uses the installed policy-v1 preview and lock RPCs, whose
  // response predates the optional-rules capability marker. Keep this
  // exception election-scoped; the trusted lock RPC still recomputes and
  // authorizes the electorate.
  const election4LegacyPreview = Number(electionId) === 4 && Number(preview.policy_version) === 1 &&
    preview.eligibility_contract == null;
  if (!election4LegacyPreview && preview.eligibility_contract !== ELECTORATE_RULE_CONTRACT) {
    return "Electorate finalization is unavailable until the reviewed eligibility backend is activated. No electorate was changed.";
  }
  if (!preview.locking_allowed) return preview.blocking_reason || "This election is not ready for electorate finalization.";
  if ((!election4LegacyPreview && (!Number.isSafeInteger(preview.rule_count) || preview.rule_count < 0)) ||
      !Number.isSafeInteger(preview.eligible_voters) || preview.eligible_voters < 1) {
    return "Refresh a nonempty eligible-member preview before retrying finalization. Additional eligibility rules are optional.";
  }
  return "";
}

export function electorateReadinessLabel(preview) {
  if (!preview) return "Readiness unavailable";
  if (preview.is_locked) return "Electorate finalized";
  if (preview.eligibility_contract !== ELECTORATE_RULE_CONTRACT &&
      !(Number(preview.election_id) === 4 && Number(preview.policy_version) === 1 && preview.eligibility_contract == null)) return "Backend activation required";
  return ({ draft: "Not activated", scheduled: "Finalization scheduled", retrying: "Finalization failed — retry scheduled",
    processing: "Finalization processing", missed: "Voting blocked — finalization cutoff missed",
    blocked: "Finalization blocked", cancelled: "Finalization cancelled", legacy: "Legacy election",
    unscheduled: "Finalization not scheduled" })[preview.finalization_state] || "Readiness unavailable";
}

export async function assertElectorateSchedulingReady(client, original, values) {
  if (values.status !== "active" || original?.electorate_frozen_at) return;
  const changed = !original || original.status !== "active" ||
    Number(original.organization_id) !== Number(values.organization_id) ||
    Number(original.academic_term_id) !== Number(values.academic_term_id) ||
    new Date(original.start_date).getTime() !== new Date(values.start_date).getTime() ||
    new Date(original.end_date).getTime() !== new Date(values.end_date).getTime();
  if (!changed) return;
  // Election 4's existing authenticated Board editor and backend schedule
  // checks remain the supported path to move its elapsed start into the
  // future, so its recovery is not gated on the uninstalled scheduler.
  if (Number(original?.id) === 4 && Number(original?.electorate_policy_version) === 1 &&
      Number(values.organization_id) === Number(original.organization_id) &&
      Number(values.academic_term_id) === Number(original.academic_term_id)) return;
  const result = await client.rpc("kandid_get_board_electorate_scheduler_readiness", {}).retry(false);
  if (result.error || result.data?.eligibility_contract !== ELECTORATE_RULE_CONTRACT ||
      result.data?.scheduler_ready !== true || Number(result.data?.organization_id) !== Number(values.organization_id)) {
    throw Object.assign(new Error("Automatic electorate finalization is unavailable for this Board. Activation or pending election changes were not saved. Refresh readiness or contact the administrator."),
      { code: "ELECTORATE_SCHEDULER_UNAVAILABLE" });
  }
}

export async function readElectoratePreview(client, electionId) {
  const result = await client.rpc("kandid_get_board_electorate_preview", { p_election_id: Number(electionId) }).retry(false);
  if (result.error) throw result.error;
  if (Number(result.data?.election_id) !== Number(electionId)) throw new Error("The electorate preview could not be verified.");
  return result.data;
}

export async function finalizeElectorate(client, electionId) {
  // Refresh after confirmation, so an obsolete preview never authorizes a lock.
  const preview = await readElectoratePreview(client, electionId);
  const block = electorateLockBlock(preview, electionId);
  if (block) throw new Error(block);
  const result = await client.rpc("kandid_lock_board_electorate", { p_election_id: Number(electionId) }).retry(false);
  if (result.error) throw result.error;
  if (Number(result.data?.election_id) !== Number(electionId) || typeof result.data?.is_locked !== "boolean" ||
      (result.data.is_locked && (!result.data.locked_at || !Number.isSafeInteger(result.data.eligible_voters) || result.data.eligible_voters < 1)) ||
      (!result.data.is_locked && typeof result.data.reason_code !== "string")) {
    throw new Error("The lock result could not be confirmed. Refresh the preview before taking any further action.");
  }
  return result.data;
}
