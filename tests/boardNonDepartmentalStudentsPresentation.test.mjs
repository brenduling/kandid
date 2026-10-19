import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const profileSource = read("src/utils/auth.js");
const studentsSource = read("src/pages/board/Students.jsx");
const registrationSource = read("src/pages/board/BoardStudentRegistration.jsx");
const csvSource = read("src/pages/board/CSVImport.jsx");
const styles = read("src/pages/board/Students.css");
const edgeSource = read("supabase/functions/board-manual-enrollment/index.ts");

test("Board presentation reads trusted organization type and fails closed until verified", () => {
  assert.match(profileSource, /organizations\s*\([\s\S]*?organization_type/);
  assert.match(studentsSource, /useState\(null\);[\s\S]*?getCurrentAdminProfile\(\{ force: true \}\)/);
  assert.match(studentsSource, /sameAssignedOrganization[\s\S]*?data\?\.role === "electoral_board" && data\?\.status === "active"/);
  assert.match(registrationSource, /const hasSupportedOrganizationType = organizationType === "departmental" \|\| isNonDepartmental/);
  assert.match(registrationSource, /if \(!hasSupportedOrganizationType\)/);
});

test("departmental and non-departmental admission presentation share the existing registration flow", () => {
  assert.match(registrationSource, /isNonDepartmental\s*\?\s*\["Find student", "Verify eligibility", "Review and add"\]/);
  assert.match(registrationSource, /:\s*\["Student ID", "Student details", "Review"\]/);
  assert.doesNotMatch(registrationSource, /Current departmental memberships|departmental membership/);
  assert.match(registrationSource, /verificationMethod/);
  assert.match(registrationSource, /evidenceReviewed/);
  assert.match(registrationSource, /school_id/);
  assert.match(registrationSource, /registration_form/);
  assert.match(registrationSource, /I reviewed this evidence and confirm the student is enrolled/);
  assert.match(registrationSource, /Historical term enrollments are preserved/);
});

test("Board roster and registration no longer expose departmental affiliations as an admission requirement", () => {
  assert.doesNotMatch(studentsSource, /current_departmental_memberships|departmental-context/i);
  assert.doesNotMatch(registrationSource, /current_departmental_memberships|departmental membership/i);
  assert.doesNotMatch(styles, /board-student-departmental-context|board-registration-context-review/);
});

test("Board backend no longer loads or returns departmental affiliation names", () => {
  assert.doesNotMatch(edgeSource, /loadCurrentDepartmentalMemberships|current_departmental_memberships/);
});

test("non-departmental CSV keeps the existing format and presents term/configuration failures separately", () => {
  const requiredColumns = csvSource.match(/const CSV_REQUIRED_COLUMNS = \[([\s\S]*?)\];/)?.[1] || "";
  assert.match(requiredColumns, /student_number[\s\S]*first_name[\s\S]*last_name[\s\S]*program[\s\S]*year_level/);
  assert.doesNotMatch(requiredColumns, /departmental|organization/i);
  assert.match(csvSource, /term_not_active:\s*"Term \/ configuration issue"/);
  assert.match(csvSource, /configuration_error:\s*"Organization setup needs attention"/);
  assert.match(csvSource, /program_mismatch:\s*"Program outside Board coverage"/);
  assert.match(csvSource, /I confirm this is the official department masterlist/);
  assert.match(csvSource, /masterlistEvidenceReviewed/);
  assert.doesNotMatch(csvSource, /current_departmental_memberships|no_active_departmental_membership/);
});

test("legacy removal and restore actions stay organization-scoped and use the existing trusted actions", () => {
  assert.match(studentsSource, /removeBoardStudentParticipation/);
  assert.match(studentsSource, /restoreBoardStudentParticipation/);
  assert.match(edgeSource, /if \(action === "remove_student_participation"\)/);
  assert.match(edgeSource, /if \(action === "restore_student_participation"\)/);
  assert.match(edgeSource, /target_organization_id:\s*Number\(adminProfile\.organization_id\)/);
  assert.match(edgeSource, /adminClient\.rpc\("board_update_student_participation"/);
  assert.match(edgeSource, /const \{ data: activeTerm, error: termError \} = await loadActiveTerm/);
});
