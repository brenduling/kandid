import test from "node:test";
import assert from "node:assert/strict";
import { buildElectionPhaseSummary } from "../src/pages/board/electionPhaseSummary.js";

test("summary counts the exact supplied phase result and omits absent metrics", () => {
  const elections = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    phase: "closed",
  }));

  const summary = buildElectionPhaseSummary(elections, (election) => election.phase);

  assert.deepEqual(summary.metrics, [{ phase: "closed", label: "Closed", count: 6 }]);
  assert.deepEqual(elections.map(({ id }) => summary.phasesByElectionId.get(id)),
    Array(6).fill("closed"));
});

test("summary renders only phases present and preserves their labels", () => {
  const elections = [
    { id: "draft", phase: "draft" },
    { id: "scheduled", phase: "scheduled" },
    { id: "closed", phase: "closed" },
    { id: "archived", phase: "archived" },
  ];

  const summary = buildElectionPhaseSummary(elections, (election) => election.phase);

  assert.deepEqual(summary.metrics, [
    { phase: "draft", label: "Draft", count: 1 },
    { phase: "scheduled", label: "Scheduled", count: 1 },
    { phase: "closed", label: "Closed", count: 1 },
    { phase: "archived", label: "Archived", count: 1 },
  ]);
});

test("empty filtered records keep no lifecycle metrics", () => {
  const summary = buildElectionPhaseSummary([], () => "closed");

  assert.deepEqual(summary.metrics, []);
  assert.equal(summary.phasesByElectionId.size, 0);
});
