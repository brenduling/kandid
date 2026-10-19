import assert from "node:assert/strict";
import test from "node:test";
import { buildElectionAnalytics, getResultVerificationSummary } from "../src/utils/results.js";

test("sanitized result aggregates preserve totals and demographic charts without voter mappings", () => {
  const votes = [
    {
      election_id: 7,
      position_id: 3,
      candidate_id: 21,
      aggregate_count: 3,
      program_counts: { "Computer Science": 2, "Information Systems": 1 },
      year_level_counts: { "1st Year": 2, "2nd Year": 1 },
      organization_counts: { "Computer Society": 3 },
    },
    { election_id: 7, position_id: 3, candidate_id: null, is_abstain: true, aggregate_count: 1 },
    {
      _aggregate_summary: true,
      election_id: 7,
      totalVoteEntries: 4,
      totalUniqueVoters: 3,
      totalAbstains: 1,
      missingHashCount: 0,
      allocationMode: "program",
      allocationItems: { "Computer Science": 2, "Information Systems": 1 },
      programItems: { "Computer Science": 2, "Information Systems": 1 },
      yearLevelItems: { "1st Year": 2, "2nd Year": 1 },
      organizationItems: { "Computer Society": 3 },
    },
  ];
  const candidates = [{
    id: 21,
    position_id: 3,
    students: { first_name: "Synthetic", last_name: "Candidate" },
    positions: { id: 3, name: "Chair", display_order: 1 },
  }];
  const analytics = buildElectionAnalytics(votes, { organizations: { name: "Computer Society" } }, candidates);
  const position = analytics.groupedResults[3];

  assert.equal(position.candidates[21].votes, 3);
  assert.equal(position.candidates[21].demographics.program["Computer Science"], 2);
  assert.equal(position.abstain, 1);
  assert.equal(analytics.totalVoteEntries, 4);
  assert.equal(analytics.totalUniqueVoters, 3);
  assert.equal(analytics.totalAbstains, 1);
  assert.equal(analytics.programItems.reduce((sum, item) => sum + item.count, 0), 3);
  assert.equal(getResultVerificationSummary(votes).verified, true);
  assert.ok(votes.every((row) => !("student_id" in row) && !("vote_id" in row)));
});
