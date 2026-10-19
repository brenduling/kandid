import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const source = readFileSync(fileURLToPath(new URL("../supabase/functions/manage-election-removal/index.ts", import.meta.url)), "utf8");
const AUTH_ID = "10000000-0000-4000-8000-000000000001";

function makeHandler({ session = { id: AUTH_ID }, profile = null, passwordAccepted = true, passwordIdentity = AUTH_ID, rpcError = null, releaseGate = "true", reviewFixture = false } = {}) {
  const calls = { clients: [], reauth: [], rpcs: [], reads: [], passwordsLogged: false };
  const adminProfile = profile || {
    id: 10, auth_user_id: AUTH_ID, full_name: "Synthetic Board", role: "electoral_board", status: "active", organization_id: 20,
  };
  const createClient = (url, key, options = {}) => {
    calls.clients.push({ url, key, options });
    if (options.global?.headers?.Authorization) {
      return { auth: { getUser: async () => session?.error ? { data: { user: null }, error: session.error } : { data: { user: session }, error: null } } };
    }
    if (key === "anon-test-key" && options.auth?.persistSession === false) {
      return { auth: { signInWithPassword: async ({ email, password }) => {
        calls.reauth.push({ email, password });
        return passwordAccepted
          ? { data: { user: { id: passwordIdentity }, session: { access_token: "synthetic-only" } }, error: null }
          : { data: { user: null, session: null }, error: new Error("invalid credentials") };
      } } };
    }
    return {
      auth: { admin: { getUserById: async (id) => ({ data: { user: id === AUTH_ID ? { id, email: "board@example.invalid" } : null }, error: null }) } },
      from: (table) => ({ select: (_columns, options = {}) => {
        const filters = {};
        const result = () => {
          if (Object.values(filters).includes(undefined)) return { data: null, count: null, error: new Error("undefined equality filter") };
          if (Object.values(filters).some(value => Array.isArray(value) && value.some(id => typeof id === "number" && !Number.isFinite(id)))) return { data: null, count: null, error: new Error("invalid identifier filter") };
          if (options.head) return { data: null, count: 1, error: null };
          const fixtures = {
            positions: [{ id: 401 }], candidates: [{ id: 402, partylist_id: 403 }],
            partylists: [{ id: 403 }], election_officer_publications: [{ id: "40000000-0000-4000-8000-000000000001" }],
            officers: [{ id: 404 }], officer_new_roster: [{ id: 405 }],
          };
          return { data: reviewFixture ? fixtures[table] || [] : [], count: 0, error: null };
        };
        const builder = {
          eq: (column, value) => { filters[column] = value; return builder; },
          in: (column, value) => { filters[column] = value; return builder; },
          or: () => builder,
          not: () => builder,
          order: () => builder,
          range: () => builder,
          limit: async () => ({ data: Object.entries(filters).every(([key, value]) => adminProfile[key] === value) ? [adminProfile] : [], error: null }),
          maybeSingle: async () => ({ data: { id: 41, organization_id: 20, results_released_at: null }, error: null }),
          then: (accept, reject) => {
            calls.reads.push({ table, filters });
            return Promise.resolve(result()).then(accept, reject);
          },
        };
        return builder;
      } }),
      rpc: async (name, args) => {
        calls.rpcs.push({ name, args });
        if (name === "kandid_get_election_removal_electorate_count") return { data: 1, error: null };
        return rpcError ? { data: null, error: rpcError } : { data: { removed: true, election_id: 41 }, error: null };
      },
    };
  };
  let handler;
  const shared = {
    corsHeaders: { "Access-Control-Allow-Origin": "http://localhost:5174" },
    handleCorsPreflight: () => null,
    rejectDisallowedOrigin: () => null,
    serveWithKandidCors: (fn) => { handler = fn; },
  };
  const context = {
    module: { exports: {} }, exports: {}, Request, Response, URL,
    Deno: { env: { get: (key) => ({ SUPABASE_URL: "https://project.example.invalid", SUPABASE_ANON_KEY: "anon-test-key", SUPABASE_SERVICE_ROLE_KEY: "service-test-key", ELECTION_SOFT_REMOVAL_ENABLED: releaseGate ?? undefined })[key] } },
    require: (specifier) => specifier.includes("supabase-js") ? { createClient } : shared,
    console: { log: (...values) => { if (values.some((value) => String(value).includes("synthetic-password"))) calls.passwordsLogged = true; }, error: () => {}, warn: () => {} },
  };
  const output = esbuild.transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
  vm.runInNewContext(output, context);
  assert.equal(typeof handler, "function", "Edge handler should register with serveWithKandidCors");
  return { handler, calls };
}

async function invoke(handler, body, authorization = "Bearer synthetic-session") {
  return handler(new Request("https://function.example.invalid", {
    method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json", Origin: "http://localhost:5174" }, body: JSON.stringify(body),
  }));
}

test("unset and non-true server gates deny both writes before password verification or RPC", async () => {
  for (const releaseGate of [null, "false", "TRUE", "1", ""]) {
    for (const action of ["soft_remove", "restore"]) {
      const { handler, calls } = makeHandler({ releaseGate });
      const result = await invoke(handler, { action });
      assert.equal(result.status, 403);
      assert.equal((await result.json()).code, "election_removal_not_enabled");
      assert.equal(calls.reauth.length, 0);
      assert.equal(calls.rpcs.length, 0);
    }
  }
});

test("gate OFF preserves the authorized organization-scoped Removed Elections read", async () => {
  const { handler, calls } = makeHandler({ releaseGate: null });
  const result = await invoke(handler, { action: "list_removed", limit: 50, offset: 0 });
  assert.equal(result.status, 200);
  assert.deepEqual(calls.reads, [{ table: "elections", filters: { organization_id: 20 } }]);
  assert.equal(calls.reauth.length, 0);
  assert.equal(calls.rpcs.length, 0);
});

test("protected dependency review counts candidate media and publication entries without undefined equality filters", async () => {
  const { handler, calls } = makeHandler({ releaseGate: null, reviewFixture: true });
  const result = await invoke(handler, { action: "review", election_id: 41 });
  assert.equal(result.status, 200);
  const { data } = await result.json();
  assert.equal(data.counts.candidate_media, 1);
  assert.equal(data.counts.publication_entries, 1);
  assert.equal(data.protected_history, true);
  assert.deepEqual(Array.from(calls.reads.find(call => call.table === "election_officer_publication_entries").filters.publication_id), ["40000000-0000-4000-8000-000000000001"]);
  assert.equal(calls.reauth.length, 0);
  assert.deepEqual(calls.rpcs.map(call => call.name), ["kandid_get_election_removal_electorate_count"]);
  assert.ok(calls.reads.every(call => !Object.values(call.filters).includes(undefined)));
});

test("missing JWT and unsupported actions stay denied with the server gate OFF", async () => {
  const { handler, calls } = makeHandler({ releaseGate: null });
  assert.equal((await invoke(handler, { action: "soft_remove" }, "")).status, 401);
  assert.equal((await invoke(handler, { action: "delete" })).status, 400);
  assert.equal(calls.reauth.length, 0);
  assert.equal(calls.rpcs.length, 0);
});

test("current password verification is bound to the authenticated user and uses transient Auth client", async () => {
  const { handler, calls } = makeHandler();
  const response = await invoke(handler, { action: "soft_remove", election_id: 41, password: "synthetic-password" });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.reauth, [{ email: "board@example.invalid", password: "synthetic-password" }]);
  assert.equal(calls.rpcs.length, 1);
  assert.equal(calls.rpcs[0].name, "kandid_soft_remove_election");
  assert.equal(calls.rpcs[0].args.p_actor_auth_uid, AUTH_ID);
  assert.equal(calls.clients.find((client) => client.key === "anon-test-key" && client.options.auth?.persistSession === false)?.options.auth.autoRefreshToken, false);
  assert.equal(calls.passwordsLogged, false);
});

test("active Super Admin can reach the server-side RPC without an organization assignment", async () => {
  const superAdmin = { id: 11, auth_user_id: AUTH_ID, full_name: "Synthetic Super Admin", role: "super_admin", status: "active", organization_id: null };
  const { handler, calls } = makeHandler({ profile: superAdmin });
  const response = await invoke(handler, { action: "soft_remove", election_id: 41, password: "synthetic-password" });
  assert.equal(response.status, 200);
  assert.equal(calls.rpcs.length, 1);
  assert.equal(calls.rpcs[0].args.p_actor_auth_uid, AUTH_ID);
});

test("wrong password, mismatched Auth identity, and expired session never call a mutation RPC", async (t) => {
  const cases = [
    ["wrong password", { passwordAccepted: false }, 401],
    ["password belongs to another Auth identity", { passwordIdentity: "20000000-0000-4000-8000-000000000002" }, 401],
    ["expired session", { session: { error: new Error("expired") } }, 401],
  ];
  for (const [name, options, status] of cases) await t.test(name, async () => {
    const { handler, calls } = makeHandler(options);
    const response = await invoke(handler, { action: "soft_remove", election_id: 41, password: "synthetic-password" });
    assert.equal(response.status, status);
    assert.equal(calls.rpcs.length, 0);
  });
});

test("inactive or unsupported administrator identity is denied before password or RPC", async () => {
  const { handler, calls } = makeHandler({ profile: { id: 10, auth_user_id: AUTH_ID, full_name: "Board", role: "electoral_board", status: "disabled", organization_id: 20 } });
  const response = await invoke(handler, { action: "soft_remove", election_id: 41, password: "synthetic-password" });
  assert.equal(response.status, 403);
  assert.equal(calls.reauth.length, 0);
  assert.equal(calls.rpcs.length, 0);
});

test("restore uses only the restore RPC and duplicate/state errors remain non-success responses", async () => {
  const good = makeHandler();
  const restored = await invoke(good.handler, { action: "restore", election_id: 41, password: "synthetic-password" });
  assert.equal(restored.status, 200);
  assert.equal(good.calls.rpcs[0].name, "kandid_restore_removed_election");

  const duplicate = makeHandler({ rpcError: { code: "23505", message: "already removed" } });
  const denied = await invoke(duplicate.handler, { action: "soft_remove", election_id: 41, password: "synthetic-password" });
  assert.equal(denied.status, 409);
  assert.equal((await denied.json()).error, "This election has already been removed.");
});
