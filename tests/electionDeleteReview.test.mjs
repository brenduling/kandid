import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedDevelopmentProductionRequest } from "../src/utils/developmentProductionWriteGuard.js";
import {
  ELECTION_DELETE_DEPENDENCIES,
  buildElectionDeleteReview,
  loadElectionDeleteReview,
} from "../src/utils/electionDeleteReview.js";

const emptySummary = () => ({
  schema_version: 1,
  election_id: 7,
  counts: Object.fromEntries(ELECTION_DELETE_DEPENDENCIES.map(({ key }) => [key, 0])),
  protected_history: false,
  may_delete: true,
});

test("zero dependency summary permits soft-removal review only after every count is present", () => {
  const review = buildElectionDeleteReview(emptySummary());
  assert.equal(review.blocked, false);
  assert.equal(review.severity, "soft_removal");
  assert.equal(review.dependencies.length, ELECTION_DELETE_DEPENDENCIES.length);
});

test("votes and frozen electorate remain protected records and do not block reversible removal", () => {
  const summary = emptySummary();
  summary.counts.votes = 1;
  summary.counts.frozen_electorate = 3;
  summary.protected_history = true;
  summary.may_delete = false;
  const review = buildElectionDeleteReview(summary);
  assert.equal(review.blocked, false);
  assert.equal(review.severity, "preserved_history");
  assert.equal(review.dependencies.find(({ key }) => key === "votes").count, 1);
});

test("setup references and protected history are presented as preserved data", () => {
  const summary = emptySummary();
  summary.counts.positions = 1;
  summary.counts.candidates = 1;
  summary.counts.frozen_electorate = 1;
  summary.protected_history = true;
  summary.may_delete = false;
  assert.equal(buildElectionDeleteReview(summary).severity, "preserved_history");

  summary.counts.frozen_electorate = 0;
  summary.protected_history = false;
  assert.equal(buildElectionDeleteReview(summary).severity, "preserved_related_records");
});

test("missing, contradictory, or incomplete dependency data fails closed", () => {
  const incomplete = emptySummary();
  delete incomplete.counts.audit_references;
  assert.equal(buildElectionDeleteReview(incomplete).severity, "unavailable");

  const contradictory = emptySummary();
  contradictory.counts.votes = 1;
  assert.equal(buildElectionDeleteReview(contradictory).severity, "unavailable");

  const wrongProtectionFlag = emptySummary();
  wrongProtectionFlag.counts.ballot_records = 1;
  wrongProtectionFlag.may_delete = false;
  assert.equal(buildElectionDeleteReview(wrongProtectionFlag).severity, "unavailable");
});

test("loader invokes only the Board-scoped action with election ID and rejects wrong-election data", async () => {
  const calls = [];
  const review = await loadElectionDeleteReview(7, async (...args) => {
    calls.push(args);
    return { data: emptySummary(), error: null };
  });
  assert.equal(review.severity, "soft_removal");
  assert.deepEqual(calls, [["election_dependency_summary", { election_id: 7 }]]);
  assert.equal(review.blocked, true, "unactivated review cannot authorize removal");

  const mismatched = await loadElectionDeleteReview(7, async () => ({
    data: { ...emptySummary(), election_id: 8 }, error: null,
  }));
  assert.equal(mismatched.severity, "unavailable");
});

test("network and server errors fail closed rather than becoming zero dependencies", async () => {
  const review = await loadElectionDeleteReview(7, async () => ({ data: null, error: new Error("offline") }));
  assert.equal(review.severity, "unavailable");
  assert.equal(review.blocked, true);
});

test("localhost guard admits only the exact new dependency read contract", () => {
  const allowed = (body) => isAllowedDevelopmentProductionRequest({
    input: "https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/vote-access",
    method: "POST", body: JSON.stringify(body),
  });
  assert.equal(allowed({ action: "election_dependency_summary", election_id: 1 }), true);
  for (const body of [
    { action: "election_dependency_summary", election_id: "1" },
    { action: "election_dependency_summary", election_id: 1, organization_id: 10 },
    { action: "election_dependency_summary", election_id: 1, actor_id: 2 },
    { action: "delete_election", election_id: 1 },
  ]) assert.equal(allowed(body), false);
});
