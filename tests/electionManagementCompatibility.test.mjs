import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ELECTION_MANAGEMENT_SELECT, electionManagementQuery, verifyElectionRemovalReadiness } from "../src/utils/electionManagementCompatibility.js";
import { loadElectionDeleteReview, ELECTION_DELETE_DEPENDENCIES } from "../src/utils/electionDeleteReview.js";

function fakeClient(error = null) {
  const calls = [];
  const query = new Proxy({}, { get: (_, method) => {
    if (method === "then") return (accept) => accept({ data: error ? null : [{ id: 1 }, { id: 2 }], error });
    return (...args) => { calls.push([method, ...args]); return query; };
  } });
  return { calls, from: (...args) => { calls.push(["from", ...args]); return query; } };
}
const compatible = { elections: [], total: 0, limit: 1, offset: 0 };

test("OFF never contacts removal endpoint and baseline projection contains no undeployed columns", async () => {
  assert.equal(await verifyElectionRemovalReadiness(false, () => { throw new Error("must not invoke"); }), false);
  assert.doesNotMatch(ELECTION_MANAGEMENT_SELECT, /removed|restored/i);
});
for (const organizationId of [undefined, 1]) {
  test(`production-compatible ${organizationId ? "Board" : "Super Admin"} query returns both existing elections`, async () => {
    const client = fakeClient();
    const result = await electionManagementQuery(client, { organizationId });
    assert.deepEqual(result.data, [{ id: 1 }, { id: 2 }]);
    assert.equal(client.calls.some(([method]) => method === "is"), false);
    assert.equal(client.calls.some(([method, key, value]) => method === "eq" && key === "organization_id" && value === organizationId), organizationId != null);
    assert.doesNotMatch(JSON.stringify(client.calls), /removed_at/);
  });
}
test("frontend ON alone cannot enable removal: unavailable, malformed and failed backend reads fail closed", async () => {
  for (const response of [{ error: new Error("404") }, { data: {} }, { data: { ...compatible, total: -1 } }, { data: { ...compatible, limit: 50 } }, { data: { ...compatible, elections: [{ id: 1 }] } }]) {
    assert.equal(await verifyElectionRemovalReadiness(true, async () => response), false);
  }
  assert.equal(await verifyElectionRemovalReadiness(true, async () => { throw new Error("offline"); }), false);
});
test("only successful scoped backend compatibility read permits removed marker filtering", async () => {
  const calls = [];
  const ready = await verifyElectionRemovalReadiness(true, async (...args) => { calls.push(args); return { data: compatible }; });
  assert.equal(ready, true);
  assert.deepEqual(calls, [["list_removed", { limit: 1, offset: 0 }]]);
  const client = fakeClient();
  await electionManagementQuery(client, { organizationId: 1, removalReady: ready });
  assert.ok(client.calls.some(([method, key, value]) => method === "is" && key === "removed_at" && value === null));
});
test("real query failures remain errors, never successful empty registers", async () => {
  const failure = { code: "503", message: "Unavailable" };
  const result = await electionManagementQuery(fakeClient(failure));
  assert.equal(result.error, failure);
  assert.equal(result.data, null);
});
test("existing dependency endpoint remains available OFF; future verified endpoint is explicit", async () => {
  const summary = { election_id: 1, schema_version: 1, counts: Object.fromEntries(ELECTION_DELETE_DEPENDENCIES.map(({ key }) => [key, 0])), may_delete: true, protected_history: false };
  for (const removalReady of [false, true]) {
    let action;
    const result = await loadElectionDeleteReview(1, async (name) => { action = name; return { data: summary }; }, { removalReady });
    assert.equal(action, removalReady ? "review" : "election_dependency_summary");
    assert.equal(result.blocked, !removalReady);
  }
});
test("both pages hide future controls, guard mutations, and display unavailable counts on load failure", () => {
  for (const role of ["board", "superadmin"]) {
    const page = readFileSync(`src/pages/${role}/Elections.jsx`, "utf8");
    assert.match(page, /if \(!removalReady\) return;/);
    assert.match(page, /if \(!removalReady \|\|/);
    assert.match(page, /removalReady=\{removalReady\}/);
    assert.match(page, /Unavailable|Register unavailable/);
  }
  const sheet = readFileSync("src/pages/board/BoardElectionDeleteSheet.jsx", "utf8");
  assert.match(sheet, /detailsOpen && removalReady && !analysis\?\.blocked/);
});
