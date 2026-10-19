import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isAllowedDevelopmentProductionRequest, fetchDevelopmentProductionRequest } from "../src/utils/developmentProductionWriteGuard.js";
import { studentElectionFailure, readStudentBallotAccess } from "../src/utils/studentElectionAccess.js";
import { getElectionPhase } from "../src/utils/electionLifecycle.js";

const origin = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const names = ["kandid_get_student_published_campaign", "kandid_get_student_ballot_candidates", "kandid_get_student_result_candidates"];
const allowed = (name, body, suffix = "", method = "POST") => isAllowedDevelopmentProductionRequest({ input: `${origin}/rest/v1/rpc/${name}${suffix}`, method, body: JSON.stringify(body) });
for (const name of names) {
  test(`${name}: only the exact self-authorized read payload is allowed`, () => {
    assert.equal(allowed(name, { p_election_id: 3 }), true);
    for (const body of [null, [], {}, { p_election_id: "3" }, { p_election_id: 0 }, { p_election_id: -1 }, { p_election_id: 1.5 }, { p_election_id: 2147483648 }, { p_election_id: 3, student_id: 99 }, { p_election_id: 3, organization_id: 2 }]) assert.equal(allowed(name, body), false);
    assert.equal(allowed(name, { p_election_id: 3 }, "?student_id=42"), false);
    assert.equal(allowed(name, { p_election_id: 3 }, "", "GET"), false);
    assert.equal(allowed(name, { p_election_id: 3 }, "", "PATCH"), false);
  });
}

test("real SDK campaign RPC passes the local guard and reaches one scoped read", async () => {
  const requests = [];
  const client = createClient(origin, "synthetic-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetchDevelopmentProductionRequest(input, init, async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ status: "EMPTY", data: { candidates: [] } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) },
  });
  const result = await client.rpc(names[0], { p_election_id: 3 }).retry(false);
  assert.equal(result.error, null);
  assert.equal(result.data.status, "EMPTY");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, { p_election_id: 3 });
  const blocked = await client.rpc("unapproved_mutation", {}).retry(false);
  assert.ok(blocked.error);
  assert.equal(requests.length, 1);
});

for (const [label, error, status, kind, reason] of [
  ["expired session", {}, 401, "UNAUTHORIZED", "AUTHENTICATION_REQUIRED"],
  ["PostgREST expired JWT", { code: "PGRST301" }, undefined, "UNAUTHORIZED", "AUTHENTICATION_REQUIRED"],
  ["ineligible student", { code: "42501" }, undefined, "UNAUTHORIZED", "STUDENT_ACCESS_DENIED"],
  ["profile forbidden", { context: { status: 403 } }, undefined, "UNAUTHORIZED", "STUDENT_ACCESS_DENIED"],
  ["network failure", new TypeError("Failed to fetch"), undefined, "ERROR", "SERVICE_UNAVAILABLE"],
  ["server failure", {}, 503, "ERROR", "SERVICE_UNAVAILABLE"],
]) test(`error classification: ${label}`, () => assert.deepEqual(studentElectionFailure(error, status), { kind, reason, message: studentElectionFailure(error, status).message }));

function ballotFixture({ authError = null, user = { id: "synthetic-auth" }, vote = false, voteError = null, rows = [{ id: 1 }], rpcError = null } = {}) {
  const calls = [];
  return { calls, client: {
    auth: { getUser: async () => ({ data: { user }, error: authError }) },
    functions: { invoke: async (name, options) => { calls.push({ name, body: options.body }); return { data: { data: { has_voted: vote } }, error: voteError }; } },
    rpc: (name, body) => ({ retry: async enabled => { assert.equal(enabled, false); calls.push({ name, body }); return { data: rows, error: rpcError }; } }),
  } };
}
for (const [label, settings, expected, callCount] of [
  ["eligible", {}, "ELIGIBLE", 2],
  ["already voted", { vote: true }, "VOTED", 1],
  ["unknown voting status", { vote: null }, "ERROR", 1],
  ["vote status failure", { voteError: new Error("offline") }, "ERROR", 1],
  ["frozen electorate denied", { rpcError: { code: "42501" } }, "UNAUTHORIZED", 2],
  ["empty ballot", { rows: [] }, "NOT_READY", 2],
  ["malformed ballot", { rows: null }, "ERROR", 2],
  ["missing session", { user: null }, "UNAUTHORIZED", 0],
  ["auth network failure", { authError: new Error("offline"), user: null }, "ERROR", 0],
]) test(`ballot availability fails closed: ${label}`, async () => {
  const fixture = ballotFixture(settings);
  const result = await readStudentBallotAccess(fixture.client, 3);
  assert.equal(result.kind, expected);
  assert.equal(fixture.calls.length, callCount);
  for (const call of fixture.calls) assert.ok(!("student_id" in call.body) && !("organization_id" in call.body));
});

const election = { status: "active", campaign_start: "2026-10-18T16:46:00", campaign_end: "2026-10-20T08:00:00", start_date: "2026-10-20T10:00:00", end_date: "2026-10-20T20:00:00" };
for (const [now, expected] of [
  ["2026-10-18T16:45:59+08:00", "campaign_upcoming"],
  ["2026-10-18T16:46:00+08:00", "campaign"],
  ["2026-10-20T07:59:59+08:00", "campaign"],
  ["2026-10-20T08:00:00+08:00", "waiting"],
  ["2026-10-20T10:00:00+08:00", "voting"],
  ["2026-10-20T20:00:00+08:00", "closed"],
]) test(`Prac Elec Manila boundary ${now}`, () => assert.equal(getElectionPhase(election, new Date(now)), expected));

test("membership errors propagate; election listing reuses the installed JWT-scoped contract", () => {
  const source = readFileSync(new URL("../src/utils/organizationAccess.js", import.meta.url), "utf8");
  const helper = source.slice(source.indexOf("export async function getStudentElectionOrganizationIds"), source.indexOf("export async function fetchEligibleStudentsForOrganization"));
  assert.match(helper, /getStudentDashboardMemberships\(student, client\)/);
  assert.doesNotMatch(helper, /getStudentCurrentMemberships|return \[\]|catch/);
});
