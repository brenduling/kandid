import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildBoardReportCsv,
  buildVotingSummaryRows,
  electionReportFilename,
  formatElectionPeriod,
  getReportRecordCount,
} from "../src/utils/boardReports.js";

const reportsSource = readFileSync("src/pages/board/Reports.jsx", "utf8");

test("Board Reports uses only its two trusted RPCs and never queries report tables directly", () => {
  assert.match(reportsSource, /supabase\.rpc\("kandid_list_board_report_elections"\)/);
  assert.match(reportsSource, /supabase\.rpc\("kandid_get_board_election_report_package",\s*\{\s*p_election_id:\s*electionId/);
  assert.doesNotMatch(reportsSource, /\.from\("(?:votes|positions|candidates|partylists|elections)"\)/);
  assert.doesNotMatch(reportsSource, /p_organization_id|organization_id:\s*org/i);
});

test("Voting Summary CSV rows flatten trusted aggregates without voter or ballot identifiers", () => {
  const rows = buildVotingSummaryRows({
    election: { election_id: 12, title: "S-Elect" },
    ballot_count_source: "vote_ballots",
    ballot_count_availability: "mixed_ballot_and_legacy",
    authoritative_ballot_count: 4,
    legacy_vote_rows_without_ballot: 3,
    positions: [{
      position_id: 2,
      position_name: "President",
      candidates: [{ candidate_id: 7, candidate_name: "A Student", vote_total: 3 }],
      abstention_total: 1,
    }],
  });

  assert.deepEqual(rows.map((row) => row.row_type), ["turnout_summary", "candidate_total", "position_abstention"]);
  assert.equal(rows[1].candidate_vote_total, 3);
  assert.equal(rows[1].position_abstention_total, "");
  assert.equal(rows[2].candidate_vote_total, "");
  assert.equal(rows[2].position_abstention_total, 1);
  assert.equal(rows[1].authoritative_ballot_count, 4);
  assert.equal(rows[1].ballot_count_availability, "mixed_ballot_and_legacy");
  assert.equal(rows[0].row_type, "turnout_summary");
  for (const forbidden of ["student_id", "student_number", "ballot_id", "vote_hash", "blockchain_tx_id"]) {
    assert.equal(Object.hasOwn(rows[0], forbidden), false);
  }
});

test("legacy unavailable ballot count remains blank and positions without candidates retain abstention rows", () => {
  const rows = buildVotingSummaryRows({
    election: { election_id: 13, title: "Legacy election" },
    ballot_count_source: "vote_ballots",
    ballot_count_availability: "legacy_unavailable",
    authoritative_ballot_count: null,
    legacy_vote_rows_without_ballot: 9,
    positions: [{ position_id: 3, position_name: "Auditor", candidates: [], abstention_total: 2 }],
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[1].row_type, "position_abstention");
  assert.equal(rows[1].authoritative_ballot_count, "");
  assert.equal(rows[1].legacy_vote_rows_without_ballot, 9);
});

test("CSV escaping handles commas, quotes, newlines, nulls, and empty reports", () => {
  const csv = buildBoardReportCsv([{ title: 'A, "quoted"\nname', detail: null }], ["title", "detail"]);
  assert.equal(csv, '"title","detail"\r\n"A, ""quoted""\nname",""');
  assert.equal(buildBoardReportCsv([], ["id", "name"]), '"id","name"');
});

test("filenames are election-specific and sanitized", () => {
  assert.equal(
    electionReportFilename("PSITS", "S-Elect / 2026", "Candidate Report"),
    "psits-s-elect-2026-candidate-report.csv",
  );
});

test("election period and zero-row report state handle missing data explicitly", () => {
  assert.equal(formatElectionPeriod({ start_date: null, end_date: null }), "Voting period not set");
  assert.equal(getReportRecordCount({ position_report: [] }, "position_report"), 0);
  assert.equal(getReportRecordCount({ voting_summary: { positions: [] } }, "voting_summary"), 1);
});
