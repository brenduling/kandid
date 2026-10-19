import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root = "deploy/election-delete-review/";
const read = path => readFileSync(path, "utf8");
test("deployment package preserves every production v6 source byte outside the two new blocks", () => {
  const candidate = read(root + "candidate/supabase/functions/vote-access/index.ts");
  const baseline = read(root + "rollback/vote-access-v6/functions/vote-access/index.ts");
  const helperStart = candidate.indexOf("function dependencyId(");
  const helperEnd = candidate.indexOf("serveWithKandidCors(async", helperStart);
  let stripped = candidate.slice(0, helperStart) + candidate.slice(helperEnd);
  const actionStart = stripped.indexOf('    if (action === "election_dependency_summary")');
  const actionEnd = stripped.indexOf('    if (action === "prepare_vote_anchor")', actionStart);
  stripped = stripped.slice(0, actionStart) + stripped.slice(actionEnd);
  assert.equal(stripped, baseline);
  assert.doesNotMatch(candidate, /student_verify_geofence|_shared\/geofence/);
  for (const file of ["kandidProductionSecurity.mjs", "voteAccessContracts.mjs", "legacyVoteAnchorEvidence.mjs"]) {
    assert.deepEqual(readFileSync(root + "candidate/supabase/functions/_shared/" + file),
      readFileSync(root + "rollback/vote-access-v6/functions/_shared/" + file));
  }
});
test("frozen archive hashes stay intact and superseded application files match the new reviewed package", () => {
  const manifest = JSON.parse(read(root + "SHA256SUMS.json"));
  assert.equal(manifest.project_ref, "fszgdxqxonqqcrzsnkca");
  const supersession = JSON.parse(read("deploy/election-soft-removal-review/SUPERSEDED_ARTIFACTS.json"));
  const current = JSON.parse(read(supersession.replacement_manifest));
  assert.equal(createHash("sha256").update(readFileSync(supersession.previous_manifest)).digest("hex").toUpperCase(), supersession.previous_manifest_sha256);
  const superseded = [];
  for (const [file, expected] of Object.entries(manifest.files)) {
    const actual = createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase();
    if (file.startsWith(root) || actual === expected) {
      assert.equal(actual, expected, file);
    } else {
      assert.equal(supersession.original_files[file], expected, "Unclassified historical-source drift: " + file);
      assert.equal(current.find(entry => entry.path === "../../" + file)?.sha256, actual, "Superseded source missing from current reviewed manifest: " + file);
      superseded.push(file);
    }
  }
  assert.deepEqual(superseded.sort(), Object.keys(supersession.original_files).sort());
  assert.match(read(root + "candidate/supabase/config.toml"), /verify_jwt = true/);
});
