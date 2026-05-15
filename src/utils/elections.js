export function formatLocalDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

export function getElectionPhase(election, now = new Date()) {
  const campaignStart = election?.campaign_start
    ? new Date(election.campaign_start)
    : null;
  const votingStart = election?.start_date ? new Date(election.start_date) : null;
  const votingEnd = election?.end_date ? new Date(election.end_date) : null;
  const status = election?.status || "draft";

  if (status === "archived") return "archived";
  if (status === "closed") return "closed";

  if (
    campaignStart &&
    votingStart &&
    now >= campaignStart &&
    now < votingStart
  ) {
    return "campaign";
  }

  if (votingStart && votingEnd && now >= votingStart && now <= votingEnd) {
    return "voting";
  }

  if (votingEnd && now > votingEnd) {
    return "closed";
  }

  if (status === "active" && votingStart && now < votingStart) {
    return "scheduled";
  }

  return status;
}

export function canStudentViewResults(election, now = new Date()) {
  if (!election) return false;

  if (election.student_result_visibility === "realtime") {
    return true;
  }

  const phase = getElectionPhase(election, now);
  return phase === "closed";
}
