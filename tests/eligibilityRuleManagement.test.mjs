import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  createEligibilityRuleSubmission, deleteEligibilityRule, eligibilityRuleConflict,
  eligibilityRuleErrorMessage, saveEligibilityRuleEdit, validateEligibilityRuleValues,
} from "../src/utils/eligibilityRuleManagement.js";
import { fetchDevelopmentProductionRequest, isAllowedDevelopmentProductionRequest as allowed } from "../src/utils/developmentProductionWriteGuard.js";

const origin = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const values = { election_id: "3", program: " bsit ", min_year_level: "1", max_year_level: "4", allow_shs: false };
const normalized = { program: "BSIT", min_year_level: 1, max_year_level: 4, allow_shs: false, election_id: 3 };
const existing = { ...normalized, id: 42 };
function harness(options = {}) {
  const calls = [], rows = structuredClone(options.rows || []);
  const profile = { auth_user_id: "trusted-actor", role: "electoral_board", status: "active", organization_id: 2, ...options.profile };
  const election = { id: 3, organization_id: 2, academic_term_id: 1, removed_at: null, ...options.election };
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  const rawFetch = async (input, init) => {
    const url = new URL(input), method = init.method || "GET", table = url.pathname.split("/").at(-1), body = init.body && JSON.parse(init.body);
    calls.push({ input: String(input), method, body: init.body, headers: init.headers });
    if (table === "admin_users") return json(options.noProfile ? [] : [profile]);
    if (table === "elections") return json([election].filter((e) => ["id", "organization_id"].every((key) => url.searchParams.get(key) === `eq.${e[key]}`)));
    if (table === "academic_terms") return json(options.missingTerm ? [] : [{ id: election.academic_term_id }]);
    if (table === "programs") return json([{ code: "BSIT" }, { code: "BSCS" }]);
    if (table === "vote-access") {
      assert.deepEqual(body, { action: "vote_dependency_count", entity_type: "eligibility_rule", entity_id: 42 });
      return json({ data: { count: options.voteCount || 0 } }, options.historyUnavailable ? 503 : 200);
    }
    assert.equal(table, "eligibility_rules");
    const matches = rows.filter((row) => ["id", "election_id"].every((key) => !url.searchParams.has(key) || url.searchParams.get(key) === `eq.${row[key]}`));
    if (method === "GET") return json(matches);
    if (options.throwMutation) throw new Error("Synthetic lost response");
    if (options.mutationError) return json(options.mutationError, options.mutationStatus || 403);
    if (options.emptyResponse) return json(null);
    if (method === "POST") { rows.push({ ...body[0], id: 42 }); return json({ id: 42 }, 201); }
    if (!matches.length) return json({ code: "PGRST116" }, 406);
    if (method === "PATCH") Object.assign(matches[0], body);
    if (method === "DELETE") rows.splice(rows.indexOf(matches[0]), 1);
    return json({ id: matches[0].id });
  };
  const client = createClient(origin, "synthetic-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetchDevelopmentProductionRequest(input, init, rawFetch) },
  });
  client.auth.getUser = async () => ({ data: { user: options.anonymous ? null : { id: "trusted-actor" } }, error: null });
  return { client, calls, rows, mutations: () => calls.filter((r) => /\/eligibility_rules\?/.test(r.input) && ["POST", "PATCH", "DELETE"].includes(r.method)) };
}

test("Prac Elec BSIT 1–4 without SHS reaches actual SDK fetch through the guard once", async () => {
  const h = harness(), save = createEligibilityRuleSubmission(h.client);
  const [a, b] = await Promise.all([save(values, 2), save(values, 2)]);
  assert.equal(a.data.id, 42); assert.equal(b.data.id, 42);
  assert.equal((await save(values, 2)).data.id, 42);
  assert.equal(h.mutations().length, 1);
  assert.deepEqual(JSON.parse(h.mutations()[0].body), [normalized]);
  assert.equal(new URL(h.mutations()[0].input).searchParams.get("select"), "id");
});

for (const options of [
  { anonymous: true }, { noProfile: true }, { profile: { auth_user_id: "foreign" } },
  { profile: { role: "student" } }, { profile: { status: "disabled" } }, { profile: { organization_id: 9 } },
  { election: { organization_id: 9 } }, { election: { removed_at: "2026-10-01T00:00:00Z" } }, { missingTerm: true },
]) test(`invalid Board/election scope sends no write: ${JSON.stringify(options)}`, async () => {
  const h = harness(options);
  assert.ok((await createEligibilityRuleSubmission(h.client)(values, 2)).error);
  assert.equal(h.mutations().length, 0);
});

test("historical or legacy term declarations retain their election term without substituting a current term", async () => {
  for (const academic_term_id of [7, null]) {
    const h = harness({ election: { academic_term_id } });
    assert.equal((await createEligibilityRuleSubmission(h.client)(values, 2)).data.id, 42);
    const termRead = h.calls.find((call) => call.input.includes("/academic_terms?"));
    if (academic_term_id === null) assert.equal(termRead, undefined);
    else assert.equal(new URL(termRead.input).searchParams.get("id"), "eq.7");
  }
});

test("invalid programs, years, SHS values and organization claims never submit", async () => {
  for (const changes of [
    { min_year_level: 0 }, { max_year_level: 7 }, { min_year_level: 4, max_year_level: 1 },
    { min_year_level: 1.5 }, { min_year_level: true }, { allow_shs: "false" },
    { program: {} }, { election_id: true }, { organization_id: 9 },
  ]) assert.throws(() => validateEligibilityRuleValues({ ...values, ...changes }));
  const h = harness();
  assert.ok((await createEligibilityRuleSubmission(h.client)({ ...values, program: "NOT_IN_CATALOG" }, 2)).error);
  assert.equal(h.mutations().length, 0);
  assert.equal(validateEligibilityRuleValues({ ...values, program: "", min_year_level: "", max_year_level: "", allow_shs: true }).program, null);
});

test("SHS is independent declared coverage and nullable college bounds remain nullable", () => {
  const row = validateEligibilityRuleValues({ ...values, min_year_level: "", allow_shs: true });
  assert.equal(row.min_year_level, null); assert.equal(row.max_year_level, 4); assert.equal(row.allow_shs, true);
  assert.equal(eligibilityRuleConflict({ ...normalized, min_year_level: 1, max_year_level: 2, allow_shs: true }, [{ ...existing, min_year_level: 3, max_year_level: 4, allow_shs: true }]), "overlap");
  assert.equal(eligibilityRuleConflict({ ...normalized, max_year_level: 2 }, [{ ...existing, min_year_level: 3 }]), null);
});

test("duplicates and inclusive/all-program overlap are rejected; different programs may coexist", async () => {
  for (const [row, expected] of [
    [existing, "RULE_DUPLICATE"], [{ ...existing, min_year_level: 4, max_year_level: 6 }, "RULE_OVERLAP"],
    [{ ...existing, program: null, min_year_level: null, max_year_level: null }, "RULE_OVERLAP"],
    [{ ...existing, program: "  " }, "RULE_OVERLAP"],
  ]) {
    const h = harness({ rows: [row] });
    assert.equal((await createEligibilityRuleSubmission(h.client)(values, 2)).error.code, expected);
    assert.equal(h.mutations().length, 0);
  }
  const h = harness({ rows: [{ ...existing, program: "BSCS" }] });
  assert.equal((await createEligibilityRuleSubmission(h.client)(values, 2)).data.id, 42);
});

test("Edit confirms ID and filters election without allowing parent reassignment", async () => {
  const h = harness({ rows: [existing] });
  assert.equal((await saveEligibilityRuleEdit(h.client, existing, { ...values, allow_shs: true }, 2)).data.id, 42);
  const request = h.mutations()[0], url = new URL(request.input);
  assert.equal(request.method, "PATCH"); assert.equal(url.searchParams.get("id"), "eq.42"); assert.equal(url.searchParams.get("election_id"), "eq.3");
  assert.equal(Object.hasOwn(JSON.parse(request.body), "election_id"), false);
  const forged = harness({ rows: [existing] });
  assert.ok((await saveEligibilityRuleEdit(forged.client, { ...existing, election_id: 9 }, values, 2)).error);
  assert.equal(forged.mutations().length, 0);
});

test("Delete preserves historical-delete checks and confirms scoped ID", async () => {
  const h = harness({ rows: [existing] });
  assert.equal((await deleteEligibilityRule(h.client, existing, 2)).data.id, 42);
  assert.equal(h.rows.length, 0);
  const request = h.mutations()[0], url = new URL(request.input);
  assert.equal(request.method, "DELETE"); assert.equal(url.searchParams.get("election_id"), "eq.3");
  for (const options of [{ voteCount: 1 }, { historyUnavailable: true }, { election: { organization_id: 9 } }]) {
    const blocked = harness({ ...options, rows: [existing] });
    assert.ok((await deleteEligibilityRule(blocked.client, existing, 2)).error);
    assert.equal(blocked.mutations().length, 0);
  }
});

test("RLS and zero-row/uncertain responses are errors; ambiguous Create is not repeated", async () => {
  const denied = harness({ mutationError: { code: "42501" } });
  assert.equal((await createEligibilityRuleSubmission(denied.client)(values, 2)).error.code, "42501");
  for (const options of [{ emptyResponse: true }, { throwMutation: true }, { mutationError: { message: "unavailable" }, mutationStatus: 503 }]) {
    const h = harness(options), save = createEligibilityRuleSubmission(h.client);
    assert.equal((await save(values, 2)).error.code, "RULE_UNCONFIRMED");
    assert.equal((await save(values, 2)).error.code, "RULE_UNCONFIRMED");
    assert.equal(h.mutations().length, 1);
  }
});

test("the guard accepts exact SDK rule CRUD and rejects bulk, upsert, scope and unrelated writes", () => {
  const post = { input: origin + "/rest/v1/eligibility_rules?select=id", method: "POST", body: JSON.stringify([normalized]) };
  assert.equal(allowed(post), true);
  for (const body of [normalized, [normalized, normalized], [{ ...normalized, organization_id: 2 }], [{ ...normalized, min_year_level: 5 }], [{ ...normalized, allow_shs: null }], [{ ...normalized, id: 42 }]]) assert.equal(allowed({ ...post, body: JSON.stringify(body) }), false);
  for (const query of ["", "select=*", "select=id&select=id", "select=id&on_conflict=id", 'select=id&columns="id"']) assert.equal(allowed({ ...post, input: origin + "/rest/v1/eligibility_rules?" + query }), false);
  assert.equal(allowed({ ...post, headers: { "Content-Profile": "private" } }), false);
  assert.equal(allowed({ ...post, headers: { Prefer: "resolution=merge-duplicates" } }), false);
  const { election_id: electionId, ...content } = normalized;
  assert.equal(electionId, 3);
  for (const method of ["PATCH", "DELETE"]) {
    const request = { input: origin + "/rest/v1/eligibility_rules?id=eq.42&election_id=eq.3&select=id", method, body: method === "PATCH" ? JSON.stringify(content) : null };
    assert.equal(allowed(request), true);
    for (const query of ["select=id&id=eq.42", "select=id&election_id=eq.3", "select=id&id=in.(42,43)&election_id=eq.3", "select=id&id=eq.42&election_id=eq.3&or=(id.gt.0)"]) assert.equal(allowed({ ...request, input: origin + "/rest/v1/eligibility_rules?" + query }), false);
    if (method === "PATCH") assert.equal(allowed({ ...request, body: JSON.stringify(normalized) }), false);
  }
  for (const resource of ["students", "votes", "vote_ballots", "elections", "positions", "candidates"]) assert.equal(allowed({ ...post, input: origin + "/rest/v1/" + resource + "?select=id" }), false);
});

test("errors distinguish removed elections, permissions, overlap and unconfirmed changes", () => {
  assert.match(eligibilityRuleErrorMessage({ code: "42501", message: "removed election" }), /read-only/);
  assert.match(eligibilityRuleErrorMessage({ code: "42501" }), /permission/);
  assert.match(eligibilityRuleErrorMessage({ code: "PGRST116" }), /access was revoked/);
  assert.doesNotMatch(eligibilityRuleErrorMessage({ message: "SQL implementation detail" }), /SQL/);
});
