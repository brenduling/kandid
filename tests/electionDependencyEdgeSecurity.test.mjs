import test from "node:test";
import assert from "node:assert/strict";
import { edgeHarness } from "./helpers/electionDependencyEdgeHarness.mjs";

const payload = { action: "election_dependency_summary", election_id: 1 };
test("authorized Board gets aggregate counts through its own JWT and never calls a write", async () => {
  const h = edgeHarness();
  const response = await h.request(payload);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.counts.frozen_electorate, 1);
  assert.equal(data.counts.positions, 1);
  assert.equal(data.protected_history, true);
  assert.equal(data.may_delete, false);
  assert.deepEqual(h.calls.filter(c => c.rpc), [{ rpc: "kandid_get_board_election_delete_dependency_count", args: { p_election_id: 1 }, caller: "board" }]);
  assert.deepEqual(h.writes, []);
  assert.doesNotMatch(JSON.stringify(data), /student_id|auth_user_id|email|student_number/);
});

for (const [name, token, expected] of [["Student", "student", 403], ["unassigned Board", "unassigned", 403], ["foreign Board", "foreign", 404], ["Super Admin", "super", 403], ["invalid session", "invalid", 401]]) {
  test(`${name} cannot inspect the election`, async () => {
    const h = edgeHarness({ token });
    assert.equal((await h.request(payload)).status, expected);
    assert.equal(h.calls.some(c => c.rpc), false);
    assert.deepEqual(h.writes, []);
  });
}
test("missing JWT is rejected before any dependency query", async () => {
  const h = edgeHarness();
  assert.equal((await h.request(payload, {})).status, 401);
  assert.deepEqual(h.calls, []);
});
for (const failure of ["rpc", "elections", "positions", "candidates", "partylists", "votes", "vote_ballots",
  "eligibility_rules", "election_access_tokens", "election_campaign_snapshots", "officers", "officer_new_roster",
  "officer_leadership_releases", "election_officer_publications", "election_officer_publication_entries",
  "candidate_media", "archived_elections", "audit_logs", "null-count", "incomplete-page", "null-page"]) {
  test(`${failure} failure never returns a usable dependency summary`, async () => {
    const h = edgeHarness({ failure });
    if (failure === "election_officer_publication_entries") h.tables.election_officer_publications.push({ id: 31, election_id: 1 });
    const response = await h.request(payload);
    assert.equal(response.status, 500);
    assert.equal((await response.json()).data, undefined);
    assert.deepEqual(h.writes, []);
  });
}
for (const rpcCount of [null, -1, "0", undefined]) {
  test(`invalid RPC count ${String(rpcCount)} fails closed`, async () => {
    const h = edgeHarness({ rpcCount: rpcCount === undefined ? NaN : rpcCount });
    assert.equal((await h.request(payload)).status, 500);
  });
}
test("complete zero summary is distinct from a failed query", async () => {
  const h = edgeHarness({ empty: true, rpcCount: 0 });
  const { data } = await (await h.request(payload)).json();
  assert.equal(data.may_delete, true);
  assert.equal(data.protected_history, false);
  assert.equal(Object.values(data.counts).every(count => count === 0), true);
});

test("related officer references are deduplicated and legacy audit references remain protected", async () => {
  const h = edgeHarness({ rpcCount: 0 });
  h.tables.officers.push({ id: 40, election_id: 1, position_id: 11, candidate_id: 21 });
  h.tables.audit_logs.push({ id: 50, election_id: null, entity_type: "election", entity_id: "1" });
  const { data } = await (await h.request(payload)).json();
  assert.equal(data.counts.officer_references, 1);
  assert.equal(data.counts.audit_references, 1);
  assert.equal(data.protected_history, true);
});
test("client actor/organization fields and malformed IDs are rejected", async () => {
  for (const extra of [{ organization_id: 10 }, { actor_id: 1 }, { election_id: true }, { election_id: "1" }, { election_id: -1 }]) {
    const h = edgeHarness();
    assert.equal((await h.request({ ...payload, ...extra })).status, 400);
    assert.equal(h.calls.some(c => c.rpc), false);
  }
});
test("allowed origin preflight works, arbitrary browser origin denied, absent Origin allowed", async () => {
  const h = edgeHarness();
  const headers = { Origin: "http://localhost:5174", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" };
  const preflight = await h.request({}, headers, "OPTIONS");
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:5174");
  assert.equal((await h.request(payload, { Authorization: "Bearer synthetic", Origin: "https://untrusted.invalid" })).status, 403);
  assert.equal((await h.request(payload)).status, 200);
});
test("legacy vote count and student vote status retain successful contracts", async () => {
  const board = edgeHarness();
  const result = await board.request({ action: "vote_dependency_count", entity_type: "election", entity_id: 1 });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { data: { count: 0 } });
  const student = edgeHarness({ token: "student" });
  assert.equal((await student.request({ action: "student_voted_elections" })).status, 200);
  assert.deepEqual(student.writes, []);
});
