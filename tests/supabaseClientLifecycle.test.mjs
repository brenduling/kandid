import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync("src/lib/supabaseClient.js", "utf8")
  .replace(/^import\s+[\s\S]*?;\r?\n/gm, "")
  .replaceAll("import.meta", "moduleMeta")
  .replace(/^export /gm, "");

function harness() {
  const clients = [];
  const hot = { data: {} };
  const env = {
    MODE: "development",
    VITE_SUPABASE_URL: "https://synthetic-project.invalid",
    VITE_SUPABASE_KEY: "synthetic-public-key",
  };
  return {
    clients,
    hot,
    evaluate({ guard = async () => new Response("ok"), useHot = true, overrides = {} } = {}) {
      return runInNewContext(`(() => { ${source}\nreturn { supabase, guardedSupabaseFetch }; })()`, {
        moduleMeta: { env: { ...env, ...overrides }, hot: useHot ? hot : undefined },
        Request, Response,
        createClient(url, key, options) {
          const client = { url, key, options, auth: { identity: Symbol("auth") } };
          clients.push(client);
          return client;
        },
        READ_ONLY_DASHBOARD_MODE: "localhost-production-readonly",
        isAllowedLocalProductionDashboardRequest: () => false,
        fetchDevelopmentProductionRequest: guard,
        shouldProfileSupabase: () => false,
        recordSupabaseRequest: () => assert.fail("Profiling is disabled"),
        isBoardStudentRegistrationEnabled: () => false,
        isBoardStudentManagementEnabled: () => false,
        isStudentAccountSetupEnabled: () => false,
        isElectionSoftRemovalEnabled: () => false,
      });
    },
  };
}

test("module reevaluation keeps one main Supabase/Auth client for the same HMR context", () => {
  const h = harness();
  const first = h.evaluate();
  const second = h.evaluate();
  const third = h.evaluate();
  assert.equal(h.clients.length, 1);
  assert.equal(first.supabase, second.supabase);
  assert.equal(first.supabase.auth, third.supabase.auth);
});

test("the reused client uses the latest production write guard after HMR", async () => {
  const h = harness();
  const first = h.evaluate();
  const request = "https://synthetic-project.invalid/functions/v1/officers-contract";
  assert.equal((await first.supabase.options.global.fetch(request)).status, 200);
  h.evaluate({ guard: async () => { throw new Error("Blocked by reloaded guard"); } });
  await assert.rejects(first.supabase.options.global.fetch(request), /Blocked by reloaded guard/);
  assert.equal(h.clients.length, 1);
});

test("main client preserves SDK auth defaults and does not reuse a changed project configuration", () => {
  const h = harness();
  const first = h.evaluate();
  assert.equal(first.supabase.options.auth, undefined);
  assert.equal(first.supabase.url, "https://synthetic-project.invalid");
  assert.equal(first.supabase.key, "synthetic-public-key");
  const changed = h.evaluate({ overrides: { VITE_SUPABASE_URL: "https://another-project.invalid" } });
  assert.notEqual(first.supabase, changed.supabase);
  const production = h.evaluate({ useHot: false, overrides: { MODE: "production" } });
  assert.equal(production.supabase.options.auth, undefined);
});
