import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const root = resolve(import.meta.dirname, "..");
const release = resolve(root, "deploy/election-delete-review");
const snapshot = resolve(release, "rollback/vote-access-v6");
const read = (path) => readFileSync(path, "utf8");
const metadata = JSON.parse(read(resolve(snapshot, "metadata.json")));
assert.equal(metadata.slug, "vote-access");
assert.equal(metadata.version, 6);
assert.equal(metadata.verify_jwt, true);
const baseline = read(resolve(snapshot, "functions/vote-access/index.ts"));
const source = read(resolve(root, "supabase/functions/vote-access/index.ts"));
const helperStart = source.indexOf("function dependencyId(");
const helperEnd = source.indexOf("serveWithKandidCors(async", helperStart);
assert.ok(helperStart > 0 && helperEnd > helperStart);
const helpers = source.slice(helperStart, helperEnd);
const typecheckDir = resolve(release, "typecheck");
mkdirSync(typecheckDir, { recursive: true });
writeFileSync(resolve(typecheckDir, "new-contract.ts"),
  'import { type SupabaseClient } from "@supabase/supabase-js";\n' +
  'type Profile = { id:number; auth_user_id:string; role?:string; status:string; organization_id?:number|null };\n' +
  'const pageSize=1000;\n' + helpers);
const actionStart = source.indexOf('    if (action === "election_dependency_summary")');
const actionEnd = source.indexOf('    if (action === "prepare_vote_anchor")', actionStart);
assert.ok(actionStart > 0 && actionEnd > actionStart);
const action = source.slice(actionStart, actionEnd);
assert.ok(!baseline.includes("election_dependency_summary"));
let candidate = baseline.replace("serveWithKandidCors(async", helpers + "serveWithKandidCors(async");
candidate = candidate.replace('    if (action === "prepare_vote_anchor")', action + '    if (action === "prepare_vote_anchor")');
assert.equal(candidate.replace(helpers, "").replace(action, ""), baseline,
  "Removing only the two reviewed insertions must recover production v6 byte-for-byte");
const entries = ["vote-access/index.ts", "_shared/kandidProductionSecurity.mjs",
  "_shared/voteAccessContracts.mjs", "_shared/legacyVoteAnchorEvidence.mjs"];
const config = 'project_id = "kandid-election-delete-review"\n\n[functions.vote-access]\nverify_jwt = true\nentrypoint = "./functions/vote-access/index.ts"\n';
const written = [];
for (const kind of ["candidate", "rollback-package"]) {
  for (const entry of entries) {
    const dest = resolve(release, kind, "supabase/functions", entry);
    mkdirSync(dirname(dest), { recursive: true });
    if (kind === "candidate" && entry === "vote-access/index.ts") writeFileSync(dest, candidate);
    else copyFileSync(resolve(snapshot, "functions", entry), dest);
    written.push(dest);
  }
  const dest = resolve(release, kind, "supabase/config.toml");
  writeFileSync(dest, config);
  written.push(dest);
}
const migration = "supabase/migrations/20261018120000_board_election_delete_dependency_count.sql";
const migrationDest = resolve(release, "migration", migration.split("/").at(-1));
mkdirSync(dirname(migrationDest), { recursive: true });
copyFileSync(resolve(root, migration), migrationDest);
written.push(migrationDest, resolve(root, migration), resolve(snapshot, "metadata.json"));
for (const entry of entries) written.push(resolve(snapshot, "functions", entry));
const frontend = ["src/pages/board/Elections.jsx", "src/pages/board/BoardElectionDeleteSheet.jsx",
  "src/pages/board/Elections.css", "src/utils/electionDeleteReview.js", "src/utils/developmentProductionWriteGuard.js"];
written.push(...frontend.map((file) => resolve(root, file)));
for (const file of ["PREFLIGHT.sql", "POSTFLIGHT.sql", "PRESERVATION.sql", "REVOKE_RPC_REVIEW.sql", "REVIEW.md",
  "tsconfig.json", "tsconfig-new-contract.json", "typecheck-globals.d.ts"]) written.push(resolve(release, file));
const manifest = {
  project_ref: "fszgdxqxonqqcrzsnkca", baseline_version: 6, verify_jwt: true,
  production_bundle_hash: metadata.ezbr_sha256,
  preserved_existing_source: true, excluded_unrelated_local_actions: ["student_verify_geofence"],
  files: Object.fromEntries(written.map((file) => [file.slice(root.length + 1).replaceAll("\\", "/"),
    createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase()])),
};
writeFileSync(resolve(release, "SHA256SUMS.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ project: manifest.project_ref, files: written.length,
  existingSourceBytePreserved: true, manifest: "deploy/election-delete-review/SHA256SUMS.json" }));
