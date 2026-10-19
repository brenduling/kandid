import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createElectionSubmission } from "../src/utils/electionCreateContract.js";
import { isAllowedDevelopmentProductionRequest as allowed } from "../src/utils/developmentProductionWriteGuard.js";

const payload = { title: "Synthetic election", organization_id: 2, academic_term_id: 3, status: "draft", start_date: "2099-10-25T08:00:00", end_date: "2099-10-25T17:00:00" };
test("both existing forms use the confirmed single-submission contract and a synchronous submission lock", () => {
  for (const role of ["board", "superadmin"]) {
    const source = readFileSync(`src/pages/${role}/Elections.jsx`, "utf8");
    assert.match(source, /createElectionSubmission\(supabase\)/);
    assert.match(source, /if \(saveInFlight\.current\) return;/);
    assert.match(source, /saveInFlight\.current = true/);
    assert.match(source, /finally \{ saveInFlight\.current = false/);
    assert.doesNotMatch(source, /supabase\.from\("elections"\)\.insert/);
  }
});
function api({ role = "electoral_board", organizationId = 2, status = "active", authenticated = true, termStatus = "active", response = { data: { id: 42 }, error: null, status: 201 }, throwOnInsert = false } = {}) {
  const calls = [];
  return {
    calls,
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: "verified-auth-id" } : null } }) },
    from(table) {
      let insertion = false;
      const q = new Proxy({}, { get: (_, key) => {
        if (key === "then") return (accept, reject) => {
          if (insertion && throwOnInsert) return Promise.reject(new Error("socket closed")).then(accept, reject);
          return Promise.resolve(insertion ? response : { data: table === "admin_users" ? { id: 1, role, organization_id: organizationId, status } : { id: 3, status: termStatus }, error: null }).then(accept, reject);
        };
        return (...args) => { calls.push([table, key, ...args]); if (key === "insert") insertion = true; return q; };
      } });
      return q;
    },
  };
}

test("real SDK array INSERT is allowed only with the explicit gate and exact supported columns", async () => {
  let request;
  const client = createClient("https://fszgdxqxonqqcrzsnkca.supabase.co", "synthetic-key", { global: { fetch: async (input, init) => {
    request = { input, method: init.method, body: init.body };
    return new Response('{"id":42}', { status: 201, headers: { "Content-Type": "application/json" } });
  } } });
  await client.from("elections").insert([payload]).select("id").single();
  assert.ok(new URL(request.input).searchParams.has("columns"));
  assert.equal(allowed(request), false);
  assert.equal(allowed({ ...request, allowElectionManagement: true }), true);
  for (const columns of ['"removed_at"', '"title","organization_id"', '"title","title"', "*", ""]) {
    const url = new URL(request.input); url.searchParams.set("columns", columns);
    assert.equal(allowed({ ...request, input: url.href, allowElectionManagement: true }), false);
  }
  const url = new URL(request.input); url.searchParams.append("columns", url.searchParams.get("columns"));
  assert.equal(allowed({ ...request, input: url.href, allowElectionManagement: true }), false);
  assert.equal(allowed({ ...request, method: "DELETE", allowElectionManagement: true }), false);
});

for (const role of ["electoral_board", "super_admin"]) {
  test(`${role}: confirmed creation retains the exact ID and never re-inserts on repeated/double submission`, async () => {
    const client = api({ role }); const save = createElectionSubmission(client);
    const [a, b] = await Promise.all([save(payload, 2), save(payload, 2)]);
    assert.equal(a.data.id, 42); assert.equal(b.data.id, 42);
    assert.equal((await save(payload, 2)).data.id, 42);
    assert.equal(client.calls.filter(([, method]) => method === "insert").length, 1);
    assert.deepEqual(client.calls.find(([, method]) => method === "insert")[2], [payload]);
    assert.ok(client.calls.some(([, method, value]) => method === "retry" && value === false));
    assert.ok(client.calls.some(([table, method, field, value]) => table === "admin_users" && method === "eq" && field === "auth_user_id" && value === "verified-auth-id"));
  });
}

for (const options of [{ authenticated: false }, { role: "student" }, { status: "disabled" }, { organizationId: null }, { organizationId: 99 }, { termStatus: "closed" }]) {
  test(`unauthorized scope or invalid lifecycle blocks INSERT: ${JSON.stringify(options)}`, async () => {
    const client = api(options); const result = await createElectionSubmission(client)(payload, 2);
    assert.ok(result.error); assert.equal(result.data, null);
    assert.equal(client.calls.some(([, method]) => method === "insert"), false);
  });
}

test("invalid fields and forged organization scope cannot reach INSERT", async () => {
  for (const bad of [{ ...payload, title: "" }, { ...payload, academic_term_id: 0 }, { ...payload, removed_at: "2099-01-01" }, { ...payload, organization_id: 99 }]) {
    const client = api(); assert.ok((await createElectionSubmission(client)(bad, 2)).error);
    assert.equal(client.calls.some(([, method]) => method === "insert"), false);
  }
});

for (const options of [{ response: { data: null, error: { message: "network failed" }, status: 0 } }, { response: { data: null, error: { message: "gateway unavailable" }, status: 503 } }, { response: { data: null, error: null, status: 201 } }, { throwOnInsert: true }]) {
  test("uncertain transport/missing confirmation never succeeds or automatically retries INSERT", async () => {
    const client = api(options), save = createElectionSubmission(client);
    assert.equal((await save(payload, 2)).error.code, "ELECTION_CREATE_UNCONFIRMED");
    assert.equal((await save(payload, 2)).error.code, "ELECTION_CREATE_UNCONFIRMED");
    assert.equal(client.calls.filter(([, method]) => method === "insert").length, 1);
  });
}

test("explicit database rejection preserves its actionable error and permits a corrected submission", async () => {
  const failure = { code: "42501", message: "organization scope denied" };
  const client = api({ response: { data: null, error: failure, status: 403 } });
  assert.equal((await createElectionSubmission(client)(payload, 2)).error, failure);
});
