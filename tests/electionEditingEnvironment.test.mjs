import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { electionEditBlockReason } from "../src/utils/electionEditingEnvironment.js";
import { validateSupabaseBuildEnvironment } from "../scripts/supabase-env-policy.js";
import { fetchDevelopmentProductionRequest } from "../src/utils/developmentProductionWriteGuard.js";

test("normal development uses backend authorization while inspection remains read-only", () => {
  for (const value of [undefined, false, "false", true]) {
    assert.equal(electionEditBlockReason({ MODE: "development", VITE_ENABLE_ELECTION_MANAGEMENT: value }), "");
  }
  assert.equal(electionEditBlockReason({ MODE: "development", VITE_ENABLE_ELECTION_MANAGEMENT: "true" }), "");
  assert.match(electionEditBlockReason({ MODE: "localhost-production-readonly", VITE_ENABLE_ELECTION_MANAGEMENT: "true" }), /read-only/);
  assert.equal(electionEditBlockReason({ MODE: "production" }), "");
});

test("isolated editor mode accepts loopback only and rejects either cloud project and server keys", () => {
  const env = { VITE_SUPABASE_URL: "http://127.0.0.1:59431", VITE_SUPABASE_KEY: "synthetic-local-public-key" };
  assert.deepEqual(validateSupabaseBuildEnvironment("local-election-editor", env), { target: "local", mode: "local-election-editor" });
  assert.equal(electionEditBlockReason({ MODE: "local-election-editor" }), "");
  for (const url of ["https://fszgdxqxonqqcrzsnkca.supabase.co", "https://jkkgzhteacaafdnpeomy.supabase.co", "http://external.example.invalid"]) {
    assert.throws(() => validateSupabaseBuildEnvironment("local-election-editor", { ...env, VITE_SUPABASE_URL: url }));
  }
  assert.throws(() => validateSupabaseBuildEnvironment("local-election-editor", { ...env, VITE_SUPABASE_KEY: "sb_secret_synthetic" }), /server-only/);
  const config = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(config.scripts["dev:elections:local"], /--mode local-election-editor.*--host localhost.*--strictPort/);
});

test("the actual production transport still refuses an election mutation before fetch", async () => {
  let requests = 0;
  await assert.rejects(fetchDevelopmentProductionRequest("https://fszgdxqxonqqcrzsnkca.supabase.co/rest/v1/elections?id=eq.92001&organization_id=eq.92001&select=id", {
    method: "PATCH", body: JSON.stringify({ title: "Synthetic title" }),
  }, async () => { requests++; return new Response(); }), /temporary official-production development write safeguard/);
  assert.equal(requests, 0);
});

test("editing shows the restriction before saving, blocks submit and cover uploads, and preserves the existing contract", () => {
  const page = readFileSync("src/pages/board/Elections.jsx", "utf8");
  const sheet = readFileSync("src/pages/board/BoardElectionSetup.jsx", "utf8");
  assert.match(page, /saveBlockedReason=\{editing \? editBlockReason : ""\}/);
  assert.match(page, /async function handleSubmit\(e\)[\s\S]*?if \(editing && editBlockReason\)[\s\S]*?return;[\s\S]*?saveElectionEdit/);
  assert.match(page, /async function handleCoverUpload\(file\)[\s\S]*?if \(editing && editBlockReason\)[\s\S]*?return;[\s\S]*?uploadElectionCover/);
  assert.match(sheet, /role="status"[\s\S]*?\{saveBlockedReason\}/);
  assert.match(sheet, /disabled=\{submitting \|\| coverUploading \|\| Boolean\(saveBlockedReason\)\}/);
});
