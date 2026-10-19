import test from "node:test";
import assert from "node:assert/strict";
import { buildElectionEditPatch, loadElectionForEdit, saveElectionEdit, electionSaveError } from "../src/utils/electionEditContract.js";
import { isAllowedDevelopmentProductionRequest } from "../src/utils/developmentProductionWriteGuard.js";

const election = { id: 1, organization_id: 2, academic_term_id: 3, title: "Saved title", status: "active",
  start_date: "2026-10-01T08:00:00", end_date: "2026-10-01T17:00:00", campaign_start: null, campaign_end: null,
  electorate_frozen_at: "2026-09-30T00:00:00Z", electorate_policy_version: 1, results_released_at: null,
  geo_lat: null, geo_lng: null, geo_radius_meters: null };
function client({ actor = { role: "electoral_board", organization_id: 2 }, session = true, rpcError = { code: "PGRST202" }, saveError = null } = {}) {
  const calls = [];
  return {
    calls,
    auth: { getUser: async () => ({ data: { user: session ? { id: "verified-id" } : null } }) },
    rpc: async (...args) => { calls.push(["rpc", ...args]); return { data: rpcError ? null : { geo_lat: 1, geo_lng: 2, geo_radius_meters: 5 }, error: rpcError }; },
    from(table) {
      calls.push(["from", table]);
      let editing = false, geo = false;
      const query = new Proxy({}, { get: (_, method) => {
        if (method === "then") return (accept) => accept({ data: editing ? (saveError ? null : { id: 1 }) : table === "admin_users" ? actor : geo ? { geo_lat: null, geo_lng: null, geo_radius_meters: null } : election, error: editing ? saveError : null });
        return (...args) => { calls.push([method, ...args]); if (method === "update") editing = true; if (method === "select" && args[0].startsWith("geo_lat")) geo = true; return query; };
      } });
      return query;
    },
  };
}
test("Edit loads actual saved fields and authorized legacy geofence when the future RPC is absent", async () => {
  const api = client();
  assert.equal((await loadElectionForEdit(api, 1)).title, "Saved title");
  assert.ok(api.calls.some(([method, key, value]) => method === "eq" && key === "auth_user_id" && value === "verified-id"));
  assert.ok(api.calls.some(([method, key, value]) => method === "eq" && key === "organization_id" && value === 2));
  assert.ok(api.calls.some(([method, columns]) => method === "select" && columns.startsWith("geo_lat")));
});
test("installed privacy RPC remains authoritative; permission denial never falls back to table reads", async () => {
  const api = client({ rpcError: null });
  assert.equal((await loadElectionForEdit(api, 1)).geo_lat, 1);
  assert.ok(!api.calls.some(([method, columns]) => method === "select" && columns.startsWith("geo_lat")));
  const denied = client({ rpcError: { code: "42501" } });
  await assert.rejects(loadElectionForEdit(denied, 1), /could not be verified/);
  assert.ok(!denied.calls.some(([method, columns]) => method === "select" && columns.startsWith("geo_lat")));
});
for (const options of [{ session: false }, { actor: null }, { actor: { role: "student" } }, { actor: { role: "electoral_board", organization_id: null } }]) {
  test(`unauthorized edit load denied: ${JSON.stringify(options)}`, async () => {
    const api = client(options);
    await assert.rejects(loadElectionForEdit(api, 1));
    assert.ok(!api.calls.some(([method, table]) => method === "from" && table === "elections"));
  });
}
test("frozen title edit sends only changed permitted fields and retains all history settings", () => {
  assert.deepEqual(buildElectionEditPatch(election, { ...election, title: "Corrected", start_date: "2026-10-01 08:00:00" }), { title: "Corrected" });
  for (const [key, value] of Object.entries({ organization_id: 9, academic_term_id: 8, start_date: "2026-10-02T08:00:00", end_date: "2026-10-02T17:00:00", status: "draft", voting_access_mode: "token" })) {
    assert.throws(() => buildElectionEditPatch(election, { [key]: value }), /Locked/);
  }
  assert.throws(() => buildElectionEditPatch({ ...election, results_released_at: "2026-10-01" }, { student_result_visibility: "manual" }), /Locked/);
});
test("even unfrozen elections retain their recorded academic term", () => {
  assert.throws(() => buildElectionEditPatch({ ...election, electorate_frozen_at: null }, { academic_term_id: 8 }), /Locked/);
});
test("minute-only picker serialization never rewrites saved seconds or fractional precision", () => {
  const precise = { ...election, start_date: "2026-10-01T08:00:37.123456", end_date: "2026-10-01T17:00:42.56789" };
  assert.deepEqual(buildElectionEditPatch(precise, { title: "Corrected", start_date: "2026-10-01T08:00", end_date: "2026-10-01T17:00" }), { title: "Corrected" });
  assert.throws(() => buildElectionEditPatch(precise, { start_date: "2026-10-01T08:01" }), /Locked/);
});
test("atomic save compares original scope, freeze state, release state and editable fields", async () => {
  const api = client();
  const result = await saveElectionEdit(api, election, { title: "Correction" });
  assert.equal(result.error, null);
  assert.ok(api.calls.some(([method, payload]) => method === "update" && JSON.stringify(payload) === '{"title":"Correction"}'));
  for (const field of ["id", "organization_id", "title", "electorate_frozen_at", "status"]) assert.ok(api.calls.some(([method, key]) => method === "eq" && key === field), field);
  assert.ok(api.calls.some(([method, key]) => method === "is" && key === "results_released_at"));
});
test("no-op, conflicts and server failures never claim a successful write", async () => {
  const api = client();
  assert.equal((await saveElectionEdit(api, election, { title: election.title })).unchanged, true);
  assert.ok(!api.calls.some(([method]) => method === "update"));
  for (const error of [{ code: "PGRST116" }, { code: "42501" }, { message: "Network unavailable" }]) {
    assert.equal((await saveElectionEdit(client({ saveError: error }), election, { title: "Correction" })).error, error);
    assert.ok(electionSaveError(error).length > 0);
  }
});
test("production election saves require a separate default-OFF scoped activation; physical delete remains denied", () => {
  const request = { input: "https://fszgdxqxonqqcrzsnkca.supabase.co/rest/v1/elections?id=eq.1&organization_id=eq.2&select=id", method: "PATCH", body: '{"title":"Correction"}' };
  assert.equal(isAllowedDevelopmentProductionRequest(request), false);
  assert.equal(isAllowedDevelopmentProductionRequest({ ...request, allowElectionManagement: true }), true);
  for (const changes of [{ method: "DELETE" }, { body: '{"removed_at":"today"}' }, { body: '{"academic_term_id":9}' }, { input: "https://fszgdxqxonqqcrzsnkca.supabase.co/rest/v1/elections" }]) {
    assert.equal(isAllowedDevelopmentProductionRequest({ ...request, ...changes, allowElectionManagement: true }), false);
  }
});
test("verified geofence and electorate preview reads have exact ID-only contracts; electorate locking stays denied", () => {
  for (const name of ["kandid_get_admin_election_geofence", "kandid_get_board_electorate_preview"]) {
    const request = { input: `https://fszgdxqxonqqcrzsnkca.supabase.co/rest/v1/rpc/${name}`, method: "POST" };
    assert.equal(isAllowedDevelopmentProductionRequest({ ...request, body: '{"p_election_id":1}' }), true);
    for (const body of ['{"p_election_id":"1"}', '{"p_election_id":1,"actor_id":2}', '{}']) assert.equal(isAllowedDevelopmentProductionRequest({ ...request, body }), false);
  }
  assert.equal(isAllowedDevelopmentProductionRequest({ input: "https://fszgdxqxonqqcrzsnkca.supabase.co/rest/v1/rpc/kandid_lock_board_electorate", method: "POST", body: '{"p_election_id":1}', allowElectionManagement: true }), false);
});
