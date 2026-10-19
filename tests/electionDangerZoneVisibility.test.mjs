import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyElectionRemovalReadiness, electionManagementQuery } from "../src/utils/electionManagementCompatibility.js";
import { loadElectionDeleteReview, ELECTION_DELETE_DEPENDENCIES } from "../src/utils/electionDeleteReview.js";

const summary = {
  schema_version: 1, election_id: 1, may_delete: false, protected_history: true,
  counts: Object.fromEntries(ELECTION_DELETE_DEPENDENCIES.map(({ key }) => [key, key === "votes" ? 1 : 0])),
};

for (const [label, enabled, available, expected] of [
  ["feature OFF / backend absent", false, false, false],
  ["feature ON / backend absent", true, false, false],
  ["feature OFF / backend ready", false, true, false],
  ["feature ON / backend ready", true, true, true],
]) {
  test(label, async () => {
    const probes = [];
    const ready = await verifyElectionRemovalReadiness(enabled, async (...args) => {
      probes.push(args);
      return available ? { data: { elections: [], total: 0, limit: 1, offset: 0 } } : { error: new Error("not deployed") };
    });
    assert.equal(ready, expected);
    assert.equal(probes.length, enabled ? 1 : 0, "OFF never probes the unavailable endpoint");
    let reviewAction;
    const analysis = await loadElectionDeleteReview(1, async (action) => {
      reviewAction = action;
      return { data: summary };
    }, { removalReady: ready });
    assert.equal(reviewAction, expected ? "review" : "election_dependency_summary");
    assert.equal(analysis.blocked, !expected);
    const filters = [];
    const query = { select() { return this; }, is(...args) { filters.push(args); return this; }, order() { return this; } };
    electionManagementQuery({ from: () => query }, { removalReady: ready });
    assert.deepEqual(filters, expected ? [["removed_at", null]] : []);
  });
}

test("both portals use the same readiness, password and backend action contract", () => {
  for (const role of ["board", "superadmin"]) {
    const source = readFileSync(`src/pages/${role}/Elections.jsx`, "utf8");
    assert.match(source, /verifyElectionRemovalReadiness\(requested, callElectionRemoval\)/);
    assert.match(source, /removalReady=\{removalReady\}/);
    assert.match(source, /onContinue=\{\(\) => \{ if \(removalReady\)/);
    if (role === "board") {
      assert.match(source, /callElectionRemoval\("soft_remove", \{ election_id: Number\(id\), password \}\)/);
      assert.match(source, /callElectionRemoval\("restore", \{ election_id: Number\(id\), password \}\)/);
    } else {
      assert.match(source, /const action = mode === "restore" \? "restore" : "soft_remove"/);
      assert.match(source, /callElectionRemoval\(action, \{ election_id: Number\(deleteReview.id\), password \}\)/);
    }
    assert.match(source, /phase !== "danger_zone" \|\| !password/);
  }
});

test("incomplete dependencies remain blocked even when readiness succeeded", async () => {
  const analysis = await loadElectionDeleteReview(1, async () => ({ data: { ...summary, counts: {} } }), { removalReady: true });
  assert.equal(analysis.blocked, true);
  assert.equal(analysis.error, true);
});
