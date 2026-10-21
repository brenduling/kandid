// Local review build: keep earlier Board eligibility edits out of this release.
// Never changes source files, Git state, deployment settings or production data.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
const baseline = "2c20a0277f22a09d2df89a3b82b11d0324eaf82b";
assert.equal(git(["rev-parse", "HEAD"]), baseline, "Checkpoint changed; re-review release scope");
const receiptPaths = [
  "src/pages/student/receiptData.js", "src/utils/blockchainVerification.js",
  "src/pages/student/Receipt.jsx", "src/pages/student/ReceiptDetails.jsx",
  "src/pages/student/BallotVerification.jsx", "src/pages/student/VotePage.jsx",
];
const excludedPaths = ["src/pages/board/EligibilityRules.jsx", "src/utils/eligibilityRuleManagement.js"];
const allowed = new Set([...receiptPaths, ...excludedPaths]);
const changed = git(["diff", "--name-only", "--", "src"]).split(/\r?\n/).filter(Boolean);
assert.ok(changed.every(path => allowed.has(path)), "Unexpected frontend edits; review before packaging");
assert.equal(git(["ls-files", "--others", "--exclude-standard", "--", "src"]), "", "Unreviewed frontend files exist");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const sourceHashes = receiptPaths.map(path => ({ path, sha256: sha256(readFileSync(resolve(root, path))) }));
const baselineModules = new Map(excludedPaths.map(path => [resolve(root, path), execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root, encoding: "utf8", windowsHide: true })]));
const originalExcludedHashes = excludedPaths.map(path => ({ path, workingCopySha256: sha256(readFileSync(resolve(root, path))), buildInputSha256: sha256(baselineModules.get(resolve(root, path))) }));
const taskDirectory = resolve(root, ".tmp/voting-backend-runtime");
const output = resolve(taskDirectory, "receipt-only-release-" + randomBytes(6).toString("hex"));
assert.ok(output.startsWith(taskDirectory + sep));
mkdirSync(output, { recursive: true });
const loadedBaselineModules = new Set();
await build({
  root, configFile: resolve(root, "vite.config.js"),
  plugins: [{
    name: "kandid-reviewed-receipt-scope", enforce: "pre",
    load(id) {
      const path = resolve(id.split("?")[0]);
      if (!baselineModules.has(path)) return null;
      loadedBaselineModules.add(path);
      return baselineModules.get(path);
    },
  }],
  build: { outDir: output, emptyOutDir: false },
});
assert.equal(loadedBaselineModules.size, excludedPaths.length, "Scope filter did not cover both Board modules");
for (const item of originalExcludedHashes) assert.equal(sha256(readFileSync(resolve(root, item.path))), item.workingCopySha256, "Existing source was changed");
for (const item of sourceHashes) assert.equal(sha256(readFileSync(resolve(root, item.path))), item.sha256, "Receipt source changed during build");
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);
}
const artifact = {
  checkpoint: baseline, productionDeployed: false, deploymentApproved: false,
  outputDirectory: relative(root, output).replaceAll(sep, "/"), sourceFiles: sourceHashes,
  excludedWorkingTreeEdits: originalExcludedHashes,
  files: files(output).map(path => ({ path: relative(output, path).replaceAll(sep, "/"), sha256: sha256(readFileSync(path)) })),
};
writeFileSync(resolve(taskDirectory, "receipt-only-release-manifest.json"), JSON.stringify(artifact, null, 2) + "\n");
console.log(JSON.stringify({ receiptOnlyBuild: "passed", outputDirectory: artifact.outputDirectory, frontendFiles: sourceHashes.length, excludedBoardEdits: originalExcludedHashes.length, sourceFilesUntouched: true, artifactFiles: artifact.files.length }));
