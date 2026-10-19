const VOTING_SUMMARY_COLUMNS = [
  "row_type",
  "election_id",
  "election_title",
  "position_id",
  "position_name",
  "candidate_id",
  "candidate_name",
  "candidate_vote_total",
  "position_abstention_total",
  "ballot_count_source",
  "ballot_count_availability",
  "authoritative_ballot_count",
  "legacy_vote_rows_without_ballot",
  "electorate_policy_version",
  "electorate_availability",
  "eligible_voters",
  "participation_availability",
  "participated_voters",
  "turnout_availability",
  "turnout_percentage",
];

export function getBoardOrganizationName(user) {
  const name = user?.organizations?.name || user?.organization_name;
  return typeof name === "string" && name.trim()
    ? name.trim()
    : "your assigned organization";
}

function formatElectionDate(value) {
  if (!value) return "Date not set";
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Intl.DateTimeFormat("en-PH", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
      year: "numeric",
    }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not set";
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Manila",
    year: "numeric",
  }).format(date);
}

export function formatElectionPeriod(election) {
  const start = election?.start_date;
  const end = election?.end_date;
  if (!start && !end) return "Voting period not set";
  if (!start) return `Through ${formatElectionDate(end)}`;
  if (!end) return `From ${formatElectionDate(start)}`;
  return `${formatElectionDate(start)} – ${formatElectionDate(end)}`;
}

export function buildVotingSummaryRows(summary) {
  const election = summary?.election || {};
  const common = {
    election_id: election.election_id ?? "",
    election_title: election.title ?? "",
    ballot_count_source: summary?.ballot_count_source ?? "",
    ballot_count_availability: summary?.ballot_count_availability ?? "",
    authoritative_ballot_count: summary?.authoritative_ballot_count ?? "",
    legacy_vote_rows_without_ballot: summary?.legacy_vote_rows_without_ballot ?? 0,
    electorate_policy_version: summary?.electorate_policy_version ?? "",
    electorate_availability: summary?.electorate_availability ?? "",
    eligible_voters: summary?.eligible_voters ?? "",
    participation_availability: summary?.participation_availability ?? "",
    participated_voters: summary?.participated_voters ?? "",
    turnout_availability: summary?.turnout_availability ?? "",
    turnout_percentage: summary?.turnout_percentage ?? "",
  };

  const turnoutRow = {
    ...common,
    row_type: "turnout_summary",
    position_id: "",
    position_name: "",
    candidate_id: "",
    candidate_name: "",
    candidate_vote_total: "",
    position_abstention_total: "",
  };
  const positionRows = (Array.isArray(summary?.positions) ? summary.positions : []).flatMap((position) => {
    const candidates = Array.isArray(position?.candidates) ? position.candidates : [];
    const candidateRows = candidates.map((candidate) => ({
      ...common,
      row_type: "candidate_total",
      position_id: position.position_id ?? "",
      position_name: position.position_name ?? "",
      candidate_id: candidate.candidate_id ?? "",
      candidate_name: candidate.candidate_name ?? "",
      candidate_vote_total: candidate.vote_total ?? 0,
      position_abstention_total: "",
    }));

    const abstentionRow = {
      ...common,
      row_type: "position_abstention",
      position_id: position.position_id ?? "",
      position_name: position.position_name ?? "",
      candidate_id: "",
      candidate_name: "",
      candidate_vote_total: "",
      position_abstention_total: position.abstention_total ?? 0,
    };

    return [...candidateRows, abstentionRow];
  });
  return [turnoutRow, ...positionRows];
}

function csvScalar(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function buildBoardReportCsv(rows, columns) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const headers = Array.isArray(columns) && columns.length > 0
    ? columns
    : Object.keys(safeRows[0] || {});
  const quote = (value) => `"${csvScalar(value).replaceAll('"', '""')}"`;

  return [
    headers.map(quote).join(","),
    ...safeRows.map((row) => headers.map((column) => quote(row?.[column])).join(",")),
  ].join("\r\n");
}

function filenamePart(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function electionReportFilename(organizationName, electionTitle, reportTitle) {
  const parts = [organizationName, electionTitle, reportTitle]
    .map(filenamePart)
    .filter(Boolean);
  return `${parts.length ? parts.join("-") : "election"}.csv`;
}

export function getReportRecordCount(reportPackage, reportKey) {
  if (!reportPackage) return 0;
  if (reportKey === "election_report") {
    return reportPackage.election_report && typeof reportPackage.election_report === "object" ? 1 : 0;
  }
  if (reportKey === "voting_summary") {
    return buildVotingSummaryRows(reportPackage.voting_summary).length;
  }
  const records = reportPackage[reportKey];
  return Array.isArray(records) ? records.length : 0;
}

export const boardVotingSummaryCsvColumns = VOTING_SUMMARY_COLUMNS;
