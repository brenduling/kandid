export function getBlockchainVerificationStatus(vote) {
  if (vote?.blockchain_anchor_status === "manual_review") return "Needs Review";
  if (vote?.blockchain_anchor_status === "anchored") return "Verified";
  if (vote?.blockchain_tx_id || vote?.vote_hash || vote?.ballot_hash) return "Pending";
  return "Missing Hash";
}

export function getBlockchainVerificationCounts(votes) {
  return votes.reduce((counts, vote) => {
    const status = getBlockchainVerificationStatus(vote);
    if (status === "Verified") counts.verified += 1;
    if (status === "Pending") counts.pending += 1;
    if (status === "Needs Review") counts.needsReview += 1;
    if (status === "Missing Hash") counts.missingHash += 1;
    return counts;
  }, { verified: 0, pending: 0, needsReview: 0, missingHash: 0 });
}

export function canRecordVoteHashOnChain(vote) {
  return vote?.blockchain_anchor_status !== "manual_review"
    && !vote?.blockchain_tx_id
    && !vote?.ballot_id
    && Boolean(vote?.vote_hash);
}
