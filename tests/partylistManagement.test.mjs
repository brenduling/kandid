import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  createPartylistSubmission, deletePartylist, loadPartylistBoardContext,
  partylistErrorMessage, savePartylistEdit, validatePartylistValues,
} from "../src/utils/partylistManagement.js";
import { fetchDevelopmentProductionRequest, isAllowedDevelopmentProductionRequest } from "../src/utils/developmentProductionWriteGuard.js";

const origin = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const values = { name: "  Forward  ", description: " Shared identity ", logo_url: "" };
const existing = { id: 42, organization_id: 2, election_id: null, name: "Forward", description: "", logo_url: null };
function harness(options = {}) {
  const calls = [], rows = structuredClone(options.rows || []);
  const profile = { auth_user_id: "verified-actor", role: "electoral_board", status: "active", organization_id: 2, ...options.profile };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  const rawFetch = async (input, init) => {
    const url = new URL(input), method = init.method || "GET", body = init.body && JSON.parse(init.body);
    calls.push({ input: String(input), method, body: init.body, headers: init.headers });
    const table = url.pathname.split("/").at(-1);
    if (table === "admin_users") return json(options.noProfile ? [] : [profile]);
    if (table === "candidates") return new Response(null, { status: options.countError ? 403 : 200, headers: { "Content-Range": `*/${options.references || 0}` } });
    assert.equal(table, "partylists");
    const matches = rows.filter((row) => ["id", "organization_id"].every((key) => !url.searchParams.has(key) || `eq.${row[key]}` === url.searchParams.get(key)));
    if (method === "GET") return options.duplicateReadError ? json({ message: "unavailable" }, 503) : json(matches);
    if (options.throwMutation) throw new Error("Synthetic connection lost");
    if (options.mutationError) return json(options.mutationError, options.mutationStatus || 403);
    if (options.noReturnedRow) return json(null, 200);
    if (method === "POST") {
      rows.push({ ...body[0], election_id: null, id: 42 });
      return json({ id: 42 }, 201);
    }
    if (!matches.length) return json({ code: "PGRST116", message: "No row changed" }, 406);
    if (method === "PATCH") Object.assign(matches[0], body);
    if (method === "DELETE") rows.splice(rows.indexOf(matches[0]), 1);
    return json({ id: matches[0].id });
  };
  const client = createClient(origin, "synthetic-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetchDevelopmentProductionRequest(input, init, rawFetch) },
  });
  client.auth.getUser = async () => ({ data: { user: options.anonymous ? null : { id: "verified-actor" } }, error: null });
  return { client, calls, rows, mutations: () => calls.filter((row) => ["POST", "PATCH", "DELETE"].includes(row.method)) };
}

test("actual SDK Create reaches fetch through the narrow guard and returns an organization-wide row", async () => {
  const h = harness(), save = createPartylistSubmission(h.client);
  const [first, second] = await Promise.all([save(values, 2), save(values, 2)]);
  assert.equal(first.data.id, 42);
  assert.equal(second.data.id, 42);
  assert.equal((await save(values, 2)).data.id, 42);
  assert.equal(h.mutations().length, 1);
  assert.deepEqual(JSON.parse(h.mutations()[0].body), [{ name: "Forward", description: "Shared identity", logo_url: null, organization_id: 2 }]);
  assert.equal(h.rows[0].election_id, null);
  assert.equal(new URL(h.mutations()[0].input).searchParams.get("select"), "id");
});

for (const options of [
  { anonymous: true }, { noProfile: true }, { profile: { auth_user_id: "foreign-auth" } },
  { profile: { role: "student" } }, { profile: { role: "super_admin" } },
  { profile: { status: "disabled" } }, { profile: { organization_id: null } },
  { profile: { organization_id: 9 } },
]) test(`unverified or changed Board context sends no mutation: ${JSON.stringify(options)}`, async () => {
  const h = harness(options);
  assert.ok((await createPartylistSubmission(h.client)(values, 2)).error);
  assert.equal(h.mutations().length, 0);
});

test("the Board context comes from verified Auth/profile linkage", async () => {
  const h = harness();
  assert.equal((await loadPartylistBoardContext(h.client)).organization_id, 2);
  assert.equal(new URL(h.calls[0].input).searchParams.get("auth_user_id"), "eq.verified-actor");
});

test("case and whitespace duplicate names are blocked before Create or Edit; other organizations are independent", async () => {
  const other = { ...existing, id: 43, name: "Renew" };
  const h = harness({ rows: [{ ...existing, name: " FORWARD " }, other] });
  assert.equal((await createPartylistSubmission(h.client)(values, 2)).error.code, "PARTYLIST_DUPLICATE");
  assert.equal((await savePartylistEdit(h.client, other, values, 2)).error.code, "PARTYLIST_DUPLICATE");
  assert.equal(h.mutations().length, 0);
  const foreign = harness({ rows: [{ ...existing, organization_id: 9 }] });
  assert.equal((await createPartylistSubmission(foreign.client)(values, 2)).data.id, 42);
});

test("Edit confirms the exact ID and never changes organization/election ownership", async () => {
  const h = harness({ rows: [existing] });
  assert.equal((await savePartylistEdit(h.client, existing, { ...values, name: "Renew" }, 2)).data.id, 42);
  const request = h.mutations()[0], url = new URL(request.input);
  assert.equal(request.method, "PATCH");
  assert.equal(url.searchParams.get("id"), "eq.42");
  assert.equal(url.searchParams.get("organization_id"), "eq.2");
  assert.equal(h.rows[0].organization_id, 2);
  assert.equal(h.rows[0].election_id, null);
  assert.deepEqual(Object.keys(JSON.parse(request.body)).sort(), ["description", "logo_url", "name"]);
});

test("foreign organization Edit/Delete never reaches mutation", async () => {
  const h = harness({ rows: [existing] }), foreign = { ...existing, organization_id: 9 };
  assert.equal((await savePartylistEdit(h.client, foreign, values, 2)).error.code, "PARTYLIST_SCOPE");
  assert.equal((await deletePartylist(h.client, foreign, 2)).error.code, "PARTYLIST_SCOPE");
  assert.equal(h.mutations().length, 0);
});

test("Delete checks candidate links and confirms the exact ID", async () => {
  const h = harness({ rows: [existing] });
  assert.equal((await deletePartylist(h.client, existing, 2)).data.id, 42);
  assert.equal(h.rows.length, 0);
  assert.equal(h.mutations()[0].method, "DELETE");
  assert.equal(new URL(h.mutations()[0].input).searchParams.get("organization_id"), "eq.2");
  for (const options of [{ references: 1 }, { countError: true }]) {
    const blocked = harness({ rows: [existing], ...options });
    assert.ok((await deletePartylist(blocked.client, existing, 2)).error);
    assert.equal(blocked.mutations().length, 0);
  }
});

test("RLS denial, zero returned rows and uncertain responses never report success or retry Create", async () => {
  const denied = harness({ mutationError: { code: "42501", message: "denied by RLS" } });
  assert.equal((await createPartylistSubmission(denied.client)(values, 2)).error.code, "42501");
  for (const options of [{ noReturnedRow: true }, { throwMutation: true }, { mutationError: { message: "gateway unavailable" }, mutationStatus: 503 }]) {
    const h = harness(options), save = createPartylistSubmission(h.client);
    assert.equal((await save(values, 2)).error.code, "PARTYLIST_UNCONFIRMED");
    assert.equal((await save(values, 2)).error.code, "PARTYLIST_UNCONFIRMED");
    assert.equal(h.mutations().length, 1);
  }
});

test("validation and duplicate-check failures do not submit a write", async () => {
  for (const input of [{ ...values, name: " " }, { ...values, name: "x".repeat(101) }, { ...values, name: "bad\nname" }, { ...values, organization_id: 9 }, { ...values, election_id: 3 }]) assert.throws(() => validatePartylistValues(input));
  const h = harness({ duplicateReadError: true });
  assert.ok((await createPartylistSubmission(h.client)(values, 2)).error);
  assert.equal(h.mutations().length, 0);
});

test("development guard rejects bulk, upsert, parent changes, unscoped or unrelated mutations", () => {
  const row = { ...validatePartylistValues(values), organization_id: 2 };
  const request = { input: origin + "/rest/v1/partylists?select=id", method: "POST", body: JSON.stringify([row]) };
  assert.equal(isAllowedDevelopmentProductionRequest(request), true);
  for (const body of [[row, row], row, [{ ...row, election_id: 3 }], [{ ...row, id: 42 }], [{ ...row, arbitrary: true }], [{ ...row, organization_id: 0 }]]) assert.equal(isAllowedDevelopmentProductionRequest({ ...request, body: JSON.stringify(body) }), false);
  for (const query of ["", "select=*", "select=id&select=id", "select=id&on_conflict=id", 'select=id&columns="name"', "select=id&organization_id=eq.2"]) assert.equal(isAllowedDevelopmentProductionRequest({ ...request, input: origin + "/rest/v1/partylists?" + query }), false);
  for (const headers of [{ "Content-Profile": "private" }, { Prefer: "resolution=merge-duplicates" }]) assert.equal(isAllowedDevelopmentProductionRequest({ ...request, headers }), false);
  for (const method of ["PATCH", "DELETE"]) {
    const scoped = { input: origin + "/rest/v1/partylists?select=id&id=eq.42&organization_id=eq.2", method, body: method === "PATCH" ? JSON.stringify(validatePartylistValues(values)) : null };
    assert.equal(isAllowedDevelopmentProductionRequest(scoped), true);
    for (const query of ["select=id", "select=id&id=eq.42", "select=id&id=in.(42,43)&organization_id=eq.2", "select=id&id=eq.42&organization_id=eq.2&or=(id.gt.0)"]) assert.equal(isAllowedDevelopmentProductionRequest({ ...scoped, input: origin + "/rest/v1/partylists?" + query }), false);
    if (method === "PATCH") assert.equal(isAllowedDevelopmentProductionRequest({ ...scoped, body: JSON.stringify(row) }), false);
  }
  for (const path of ["students", "officers", "candidates", "positions", "elections", "partylists_extra"]) assert.equal(isAllowedDevelopmentProductionRequest({ ...request, input: origin + "/rest/v1/" + path + "?select=id" }), false);
  assert.equal(isAllowedDevelopmentProductionRequest({ ...request, input: "https://foreign-project.invalid/rest/v1/partylists?select=id" }), false);
});

test("permission, duplicate, dependency and unconfirmed errors have accurate messages", () => {
  assert.match(partylistErrorMessage({ code: "42501" }), /permission/);
  assert.match(partylistErrorMessage({ code: "23505" }), /already exists/);
  assert.match(partylistErrorMessage({ code: "23503" }), /linked/);
  assert.match(partylistErrorMessage({ code: "PGRST116" }), /access was revoked/);
  assert.match(partylistErrorMessage({ message: "unknown SQL detail" }), /could not be confirmed/);
});
