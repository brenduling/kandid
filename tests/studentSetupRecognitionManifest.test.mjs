import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const normalize=source=>source.replace(/\r\n/g,"\n");
const hash=source=>createHash("sha256").update(source).digest("hex");
test("recognition release binds the isolated resolver, unchanged dependency and rollback v8",()=>{
  const m=JSON.parse(readFileSync("docs/student-setup-recognition-manifest.json","utf8"));
  assert.equal(m.project_ref,"fszgdxqxonqqcrzsnkca");assert.equal(m.function_slug,"resolve-student-login");
  assert.equal(m.manifest_revision,2);assert.equal(m.recognition_contract_version,2);
  assert.equal(m.verify_jwt,false);assert.equal(m.baseline_version,8);assert.equal(m.dependencies.sdk_version,"2.118.0");
  assert.deepEqual(m.deployment_files.map(f=>f.deployed_name),["functions/resolve-student-login/index.ts","functions/_shared/kandidProductionSecurity.mjs"]);
  const recovery=JSON.parse(readFileSync("docs/student-setup-frontend-recovery-manifest.json","utf8"));
  const hardened=JSON.parse(readFileSync("docs/student-setup-security-manifest.json","utf8"));
  assert.equal(hardened.contract_version,3);
  assert.equal(recovery.reviewed_manifest_lf_sha256,hash(normalize(readFileSync("docs/student-setup-recognition-manifest.json","utf8"))));
  assert.deepEqual(recovery.patched_review_files.map(f=>f.path).sort(),[
    "src/pages/auth/StudentSetup.jsx","src/utils/auth.js","tests/studentSetupRecognitionManifest.test.mjs","scripts/kandid-student-setup-recognition-browser.mjs",
  ].sort());
  for(const file of [...m.deployment_files,...m.rollback_files,...m.review_files]){
    assert.doesNotMatch(file.path,/(^|\/)\.env|migration|node_modules|\.tmp\//);
    const patch=recovery.patched_review_files.find(f=>f.path===file.path);
    if(patch)assert.equal(patch.reviewed_lf_sha256,file.lf_sha256,file.path);
    // Git for Windows may convert LF/CRLF (including formerly mixed endings).
    // Normalized hashes preserve every source character; backend bytes stay exact.
    const updated=hardened.review_files.find(f=>f.path===file.path);
    assert.equal(hash(normalize(readFileSync(file.path,"utf8"))),updated?.lf_sha256 || patch?.lf_sha256 || file.lf_sha256,file.path);
    if([...m.deployment_files,...m.rollback_files].includes(file))assert.equal(hash(readFileSync(file.path)),file.sha256,file.path);
  }
  for(const file of recovery.new_frontend_files){
    assert.ok(["src/utils/studentSetupLookupFailure.js","tests/studentSetupLookupFailure.test.mjs"].includes(file.path));
    assert.equal(hash(normalize(readFileSync(file.path,"utf8"))),hardened.review_files.find(f=>f.path===file.path)?.lf_sha256 || file.lf_sha256,file.path);
  }
  assert.equal(m.rollback_files[0].lf_sha256,"e79d6efef161760868445c1e54012c08f548ca59f09d2309293a1b9209d13c9a");
  assert.equal(m.activation.default_enabled,false);
});

test("resolver differs from frozen v8 only in approved lookup and post-OTP admission",()=>{
  const baseline=normalize(readFileSync("supabase/functions/resolve-student-login-inspect-deploy/index.ts","utf8"));
  let source=normalize(readFileSync("supabase/functions/resolve-student-login-recognition-deploy/index.ts","utf8"));
  const remove=(pattern,replacement)=>{const updated=source.replace(pattern,replacement);assert.notEqual(updated,source);source=updated;};
  remove(/\/\/ Admission is shared by limited pre-OTP[\s\S]*?(?=function authClient)/,"");
  const inspectStart=baseline.indexOf('  if (action === "inspect_setup") {\n    // This pre-email');
  const inspectEnd=baseline.indexOf('\n  const auth = authClient',inspectStart);
  remove(/  if \(action === "inspect_setup"\) \{\n    \/\/ Owner-approved[\s\S]*?(?=\n  const auth = authClient)/,baseline.slice(inspectStart,inspectEnd));
  remove(/    let admitted;\n[\s\S]*?    if \(!admitted\) return genericLoginFailure\(origin\);\n/,"");
  remove(/authenticated: true, setup_verification: \{[\s\S]*?    }, session:/,"authenticated: true, session:");
  assert.equal(source,baseline);
});
