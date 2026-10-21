import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isStudentAccountSetupEnabled } from "../src/utils/studentAccountSetupFeatureGate.js";
import { isAllowedDevelopmentProductionRequest } from "../src/utils/developmentProductionWriteGuard.js";

const manifest = JSON.parse(readFileSync("docs/student-setup-inspection-manifest.json", "utf8"));
const baseline = JSON.parse(readFileSync("tests/fixtures/studentSetupResolverV7.json", "utf8"));
const normalized = source => source.replace(/\r\n/g, "\n");
const sha256 = source => createHash("sha256").update(source).digest("hex");

test("inspection manifest binds only the reviewed resolver and unchanged shared dependency for deployment", () => {
  assert.equal(manifest.project_ref, "fszgdxqxonqqcrzsnkca");
  assert.equal(manifest.function_slug, "resolve-student-login");
  assert.equal(manifest.verify_jwt, false);
  assert.equal(manifest.baseline_version, 7);
  assert.equal(manifest.dependencies.sdk_version, "2.118.0");
  assert.equal(manifest.dependencies.sdk_import, "https://esm.sh/@supabase/supabase-js@2.118.0");
  const entrypoint = readFileSync(manifest.deployment_files[0].path, "utf8");
  assert.ok(entrypoint.startsWith(`import { createClient } from "${manifest.dependencies.sdk_import}";`));
  assert.ok(readFileSync("tests/studentSetupPinnedSdk.test.ts", "utf8")
    .includes(`import { createClient } from "${manifest.dependencies.sdk_import}";`));
  assert.deepEqual(manifest.deployment_files.map(file => file.deployed_name), [
    "functions/resolve-student-login/index.ts", "functions/_shared/kandidProductionSecurity.mjs",
  ]);
  // Revision 2 remains frozen evidence of the deployed v8 release. Its historical
  // UI/test hashes are superseded by the separately reviewed recognition manifest.
  // Continue enforcing every deployed byte and captured rollback byte here.
  for (const file of manifest.deployment_files) {
    assert.doesNotMatch(file.path, /(^|\/)\.env|migration|node_modules|\.tmp\//);
    const content = readFileSync(file.path);
    assert.equal(sha256(content), file.sha256, file.path);
    assert.equal(sha256(normalized(content.toString("utf8"))), file.lf_sha256, file.path);
  }
  for (const file of manifest.rollback_files) {
    const captured = baseline.files.find(entry => entry.name === file.deployed_name);
    assert.ok(captured);
    assert.equal(sha256(captured.content), file.sha256);
  }
  const shared = manifest.deployment_files[1];
  assert.equal(normalized(readFileSync(shared.path, "utf8")), normalized(baseline.files[1].content));
});

test("prepared deployment differs from production v7 only in inspection support, SDK pin and three type annotations", () => {
  let source = normalized(readFileSync(manifest.deployment_files[0].path, "utf8"));
  const replace = (before, after) => {
    const next = source.replace(before, after);
    assert.notEqual(next, source, "reviewed change must be present");
    source = next;
  };
  replace('"https://esm.sh/@supabase/supabase-js@2.118.0"', '"https://esm.sh/@supabase/supabase-js@2"');
  assert.equal((source.match(/adminClient: ReturnType<typeof authClient>/g) || []).length, 3);
  replace(/adminClient: ReturnType<typeof authClient>/g, "adminClient: ReturnType<typeof createClient>");
  replace('["login", "inspect_setup", "begin_access", "verify_access"]', '["login", "begin_access", "verify_access"]');
  replace('  if (action === "inspect_setup" && Object.keys(body).some((key) => !["action", "student_number"].includes(key))) {\n    return genericLoginFailure(origin);\n  }\n', "");
  replace('["verify_access", "inspect_setup"].includes(String(action)) ? "verify" : "login"', 'action === "verify_access" ? "verify" : "login"');
  replace(/  if \(action === "inspect_setup"\) \{\n    \/\/ This pre-email-verification[\s\S]*?\n  }\n\n(?=  const auth = authClient)/, "");
  assert.equal(source, normalized(baseline.files[0].content));
});

test("setup remains opt-in and the disabled gate blocks inspection without weakening the guard", () => {
  assert.equal(isStudentAccountSetupEnabled({}), false);
  assert.equal(isStudentAccountSetupEnabled({ VITE_ENABLE_STUDENT_ACCOUNT_SETUP: "false" }), false);
  assert.equal(isAllowedDevelopmentProductionRequest({
    input: "https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/resolve-student-login",
    method: "POST", body: JSON.stringify({ action: "inspect_setup", student_number: "12345" }),
    allowBackendAuthorizedAdminCrud: true, allowStudentAccountSetup: false,
  }), false);
});
