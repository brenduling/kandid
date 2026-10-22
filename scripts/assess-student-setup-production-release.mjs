// Historical deployed v9/v6 baseline diagnostics. These packages are frozen;
// assess the hardened candidate with the student-setup-security suites instead.
// Release diagnostics against real handler source and synthetic in-memory services.
// No environment files, production credentials, network or email delivery are used.
// The imported harness also runs its existing Node tests. Nonzero means blocked.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { harness } from "../tests/studentAuthCaptchaFree.test.mjs";

const record = {
  id: 42, student_number: "700001", email: "synthetic.student@example.invalid",
  status: "pending", auth_user_id: null,
};
const bearer = { Authorization: "Bearer synthetic-session" };
const lookup = { action: "inspect_setup", student_number: record.student_number };
const linking = { student_number: record.student_number, setup_mode: true, password: "Synthetic!9" };
const findings = [];

async function compareAdmission(name, options) {
  const resolver = harness("resolve-student-login-recognition-deploy", options);
  const linker = harness("link-student-identity", options);
  const recognized = await resolver.invoke(lookup);
  assert.equal(recognized.status, 404, "recognition must reject this collision fixture");
  const linked = await linker.invoke(linking, bearer);
  findings.push({
    case: name, resolverStatus: recognized.status, directLinkerStatus: linked.status,
    blocked: linked.status < 400 || linker.events.some(e => e.kind === "passwordUpdate"),
  });
}

await compareAdmission("duplicate_pending_email", {
  students: [record, { ...record, id: 43, student_number: "700002" }],
});

const admins = Array.from({ length: 1001 }, (_, index) => ({
  id: index + 1, auth_user_id: null, email: `synthetic-${index}@example.invalid`, status: "active",
}));
admins[1000].email = record.email;
await compareAdmission("privileged_email_after_1000_row_cap", { students: [record], admins, rowCap: 1000 });

const raced = harness("link-student-identity", {
  students: [record],
  beforeRead(table, database, events) {
    if (table === "students" && events.at(-1)?.data.operation === "update") {
      database.students[0].status = "disabled";
      database.students[0].email = "changed@example.invalid";
    }
  },
});
const linked = await raced.invoke(linking, bearer);
findings.push({
  case: "identity_and_status_change_before_final_update", directLinkerStatus: linked.status,
  blocked: raced.db.students[0].status !== "disabled" || linked.status < 400,
  note: "Production catalog review must also exclude a compensating database guard.",
});

const active = harness("link-student-identity");
const existing = await active.invoke(linking, bearer);
const observations = [{
  case: "already_active_direct_linker", status: existing.status,
  passwordWrite: active.events.some(e => e.kind === "passwordUpdate"),
  note: "The UI login branch is not an endpoint prohibition on owner-authorized password changes.",
}];

const report = {
  syntheticOnly: true, productionRequests: 0, realEmails: 0, realAccountsCreated: 0,
  backendAdmissionAssessment: findings.some(f => f.blocked) ? "NO_GO" : "PASS",
  findings, observations,
  limitation: "Does not validate production SMTP, OTP templates, delivery, or privacy approval.",
};
mkdirSync(".tmp/student-setup-readiness", { recursive: true });
writeFileSync(".tmp/student-setup-readiness/release-assessment.json", JSON.stringify(report, null, 2) + "\n");
console.log("STUDENT_SETUP_RELEASE_ASSESSMENT " + JSON.stringify(report));
if (findings.some(f => f.blocked)) process.exitCode = 2;
