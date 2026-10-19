import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { uploadElectionCover, validateElectionCover, electionCoverError, ELECTION_COVER_MAX_BYTES } from "../src/utils/electionCovers.js";
import { fetchDevelopmentProductionRequest, isAllowedDevelopmentProductionRequest } from "../src/utils/developmentProductionWriteGuard.js";
import { createElectionSubmission } from "../src/utils/electionCreateContract.js";
import { saveElectionEdit } from "../src/utils/electionEditContract.js";

const api = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const png = () => new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=", "base64")], { type: "image/png" });
function fixture({ role = "electoral_board", organizationId = 2, status = "active", removed = null, electionOrg = 2, authenticated = true, storageError } = {}) {
  const calls = [];
  const client = createClient(api, "synthetic", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (input, init) =>
    fetchDevelopmentProductionRequest(input, init, async (input, init) => {
      const url = new URL(input); calls.push({ path: url.pathname, query: url.search, ...init });
      let data = [];
      if (url.pathname === "/rest/v1/admin_users") data = [{ role, organization_id: organizationId, status }];
      if (url.pathname === "/rest/v1/elections") data = init.method === "GET" ? { id: 3, organization_id: electionOrg, removed_at: removed } : { id: init.method === "POST" ? 42 : 3 };
      if (url.pathname === "/rest/v1/academic_terms") data = { id: 1, status: "active" };
      if (url.pathname.startsWith("/storage/")) data = storageError || { Key: url.pathname, Id: "synthetic" };
      return new Response(JSON.stringify(data), { status: storageError && url.pathname.startsWith("/storage/") ? 403 : 200, headers: { "Content-Type": "application/json" } });
    }, { allowElectionManagement: true })
  } });
  client.auth.getUser = async () => ({ data: { user: authenticated ? { id: "10000000-0000-4000-8000-000000000001" } : null } });
  return { client, calls };
}
const uploads = (f) => f.calls.filter((r) => r.path.startsWith("/storage/"));
for (const role of ["electoral_board", "super_admin"]) {
  test(`${role}: real SDK scoped immutable upload passes the real guard`, async () => {
    const f = fixture({ role });
    const url = await uploadElectionCover(f.client, png(), { organizationId: 2, electionId: 3 });
    assert.match(url, /\/object\/public\/election-covers\/2\/elections\/3\/[a-f0-9-]+\.png$/);
    const request = uploads(f)[0]; assert.equal(uploads(f).length, 1);
    assert.equal(new Headers(request.headers).get("x-upsert"), "false");
    assert.ok(request.body instanceof FormData); assert.equal(request.body.get("").type, "image/png");
    assert.ok(f.calls.some((r) => r.path.endsWith("/admin_users") && r.query.includes("auth_user_id=eq.")));
  });
}
test("Create covers use an authorized draft path without creating an election", async () => {
  const f = fixture(); const url = await uploadElectionCover(f.client, png(), { organizationId: 2 });
  assert.match(url, /\/2\/drafts\/[a-f0-9-]+\.png$/);
  assert.equal(f.calls.some((r) => r.path.endsWith("/elections")), false);
});
test("Replacement uses a distinct URL, never overwrites/deletes and persists only on Save", async () => {
  const f = fixture(); const old = await uploadElectionCover(f.client, png(), { organizationId: 2, electionId: 3 });
  const next = await uploadElectionCover(f.client, png(), { organizationId: 2, electionId: 3 });
  assert.notEqual(old, next);
  assert.equal(f.calls.filter((r) => ["PATCH", "DELETE"].includes(r.method)).length, 0);
  const saved = await saveElectionEdit(f.client, { id: 3, organization_id: 2, cover_url: old }, { organization_id: 2, cover_url: next });
  assert.equal(saved.error, null); const write = f.calls.find((r) => r.method === "PATCH");
  assert.deepEqual(JSON.parse(write.body), { cover_url: next }); assert.ok(write.query.includes("cover_url=eq."));
});
test("Create Election persists the uploaded draft URL using existing verified submission", async () => {
  const f = fixture(); const url = await uploadElectionCover(f.client, png(), { organizationId: 2 });
  const result = await createElectionSubmission(f.client)({ organization_id: 2, academic_term_id: 1, title: "Synthetic", cover_url: url }, 2);
  assert.equal(result.error, null); assert.equal(result.data.id, 42);
  assert.equal(JSON.parse(f.calls.find((r) => r.path.endsWith("/elections") && r.method === "POST").body)[0].cover_url, url);
});
for (const [name, options, scope] of [
  ["cross-organization", { organizationId: 4 }, { organizationId: 2 }],
  ["disabled account", { status: "disabled" }, { organizationId: 2 }],
  ["student", { role: "student" }, { organizationId: 2 }],
  ["anonymous", { authenticated: false }, { organizationId: 2 }],
  ["foreign election", { electionOrg: 4 }, { organizationId: 2, electionId: 3 }],
  ["removed election", { removed: "2026-10-01" }, { organizationId: 2, electionId: 3 }],
]) test(`${name} is denied before Storage`, async () => {
  const f = fixture(options); await assert.rejects(uploadElectionCover(f.client, png(), scope)); assert.equal(uploads(f).length, 0);
});
test("Unsupported, empty, oversized and disguised image files are rejected", async () => {
  for (const file of [new Blob(["svg"], { type: "image/svg+xml" }), new Blob([], { type: "image/png" }), new Blob([new Uint8Array(ELECTION_COVER_MAX_BYTES + 1)], { type: "image/png" }), new Blob(["<svg/>"], { type: "image/png" })]) {
    const f = fixture(); await assert.rejects(uploadElectionCover(f.client, file, { organizationId: 2 })); assert.equal(f.calls.length, 0);
  }
  for (const [type, bytes] of [["image/jpeg", [255,216,255,224]], ["image/gif", Buffer.from("GIF89a")], ["image/webp", Buffer.from("RIFF1234WEBP")]]) await validateElectionCover(new Blob([new Uint8Array(bytes)], { type }));
});
test("Storage denials and missing bucket errors explain the actual problem", async () => {
  const f = fixture({ storageError: { statusCode: "403", message: "new row violates row-level security policy" } });
  await assert.rejects(uploadElectionCover(f.client, png(), { organizationId: 2 }), /not permitted/);
  assert.match(electionCoverError({ message: "Bucket not found" }), /production approval/);
  assert.equal(f.calls.some((r) => r.method === "PATCH" || r.method === "DELETE"), false);
});
test("Guard admits exact cover inserts only; rejects upsert, bulk, unsafe paths and private buckets", () => {
  const path = "/storage/v1/object/election-covers/2/elections/3/10000000-0000-4000-8000-000000000001.png";
  const base = { input: api + path, method: "POST", body: png(), headers: { "x-upsert": "false", "content-type": "image/png" } };
  assert.equal(isAllowedDevelopmentProductionRequest(base), true);
  for (const change of [
    { method: "PUT" }, { method: "DELETE" }, { headers: { "x-upsert": "true", "content-type": "image/png" } },
    { input: api + path + "?upsert=true" }, { input: api + path.replace("/2/elections/3/", "/covers/") },
    { input: api + path.replace("election-covers", "campaign-materials") }, { input: api + path.replace(".png", ".svg") },
    { input: api + path.replace("/3/", "/0/") }, { input: api + path.replace(".png", ".jpg") },
    { body: new Blob([new Uint8Array(ELECTION_COVER_MAX_BYTES + 1)], { type: "image/png" }) },
  ]) assert.equal(isAllowedDevelopmentProductionRequest({ ...base, ...change }), false, JSON.stringify(change));
  const form = new FormData(); form.append("cacheControl", "3600"); form.append("", png()); form.append("metadata", "{}");
  assert.equal(isAllowedDevelopmentProductionRequest({ ...base, body: form, headers: { "x-upsert": "false" } }), false);
});
test("Board and Student already render the stored cover URL without private Storage access", () => {
  const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
  assert.match(read("src/components/ElectionCover.jsx"), /src=\{coverUrl\}/);
  assert.match(read("src/pages/student/Elections.jsx"), /cover_url/);
  assert.match(read("src/pages/board/Elections.jsx"), /src=\{election.cover_url\}/);
});
