import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  boardStudentMutationFailureMessage,
  validateBoardStudentRemoval,
} from "../src/utils/boardStudentMutationFeedback.js";

const STUDENTS = readFileSync("src/pages/board/Students.jsx", "utf8");
const REGISTRATION = readFileSync("src/pages/board/BoardStudentRegistration.jsx", "utf8");
const CLIENT = readFileSync("src/utils/boardManualEnrollment.js", "utf8");
const DEVELOPMENT_GUARD = readFileSync("src/utils/developmentProductionWriteGuard.js", "utf8");
const REGISTRATION_ONLY_CANDIDATE = readFileSync(
  "supabase/functions/board-manual-enrollment-registration-deploy/registryHandler.mjs",
  "utf8",
);

test("removal form rejects invalid input before its mutation helper can run", () => {
  const base = {
    studentNumber: "12345",
    confirmStudentNumber: "12345",
    password: "board-password",
    reason: "Administrative correction",
    selectedReason: "Administrative correction",
    customReason: "",
  };

  assert.equal(validateBoardStudentRemoval({ ...base, reason: "" }), "Removal reason is required.");
  assert.equal(validateBoardStudentRemoval({ ...base, selectedReason: "Other", reason: "", customReason: "" }), "Enter a custom removal reason.");
  assert.equal(validateBoardStudentRemoval({ ...base, selectedReason: "Other", reason: "", customReason: "  " }), "Enter a custom removal reason.");
  assert.equal(validateBoardStudentRemoval({ ...base, confirmStudentNumber: "" }), "Enter the student's ID to confirm this removal.");
  assert.equal(validateBoardStudentRemoval({ ...base, confirmStudentNumber: "54321" }), "The Student ID does not match the selected student.");
  assert.equal(validateBoardStudentRemoval({ ...base, password: "" }), "Enter your account password to confirm this removal.");
  assert.equal(validateBoardStudentRemoval(base), "");
});

test("mutation failures distinguish local guard, unsupported deployed action, and network failure", () => {
  assert.match(
    boardStudentMutationFailureMessage({
      name: "FunctionsFetchError",
      message: "Failed to send a request to the Edge Function",
      context: new Error("Blocked by the temporary official-production development write safeguard pending backend activation."),
    }, "edit"),
    /blocked by the local production-write safeguard.*No request was sent/i,
  );
  assert.match(
    boardStudentMutationFailureMessage(new Error("This endpoint is read-only; action is not allowed."), "remove"),
    /not supported by the deployed Board function.*No change was made/i,
  );
  assert.match(
    boardStudentMutationFailureMessage(new Error("Failed to send a request to the Edge Function"), "edit"),
    /could not reach the Board function.*not confirmed/i,
  );
  assert.doesNotMatch(
    boardStudentMutationFailureMessage({ message: "fetch failed", context: new Error("student password=secret") }, "remove"),
    /secret|password=/i,
  );
});

test("edit handles rejected requests and resets its saving state on every path", () => {
  const start = STUDENTS.indexOf("async function saveEditedStudent(event)");
  const end = STUDENTS.indexOf("function resetRemoveReauthentication", start);
  const handler = STUDENTS.slice(start, end);
  assert.match(handler, /try\s*\{/);
  assert.match(handler, /catch\s*\(error\)\s*\{[\s\S]*?setEditError\(boardStudentMutationFailureMessage/);
  assert.match(handler, /finally\s*\{\s*setEditSubmitting\(false\);\s*\}/);
  assert.match(handler, /if\s*\(!data\?\.id[\s\S]*?No success was recorded/);
  assert.ok(handler.indexOf("prompt.success") > handler.indexOf("if (!data?.id"));
});

test("remove validates before invocation and only closes or reports success after server confirmation", () => {
  const start = STUDENTS.indexOf("async function confirmRemoveMembership");
  const end = STUDENTS.indexOf("function handleRestoreMembership", start);
  const handler = STUDENTS.slice(start, end);
  assert.match(handler, /validateBoardStudentRemoval\(/);
  assert.ok(handler.indexOf("if (validationMessage)") < handler.indexOf("removeBoardStudentParticipation("));
  assert.match(handler, /if\s*\(!data\?\.result\)[\s\S]*?No success was recorded/);
  assert.match(handler, /catch\s*\(error\)\s*\{[\s\S]*?setRemoveError\(removeFailureMessage\(error\)\)/);
  assert.match(handler, /finally\s*\{[\s\S]*?setRemovePassword\(""\)[\s\S]*?setParticipationSubmitting\(false\)/);
  assert.match(STUDENTS, /removeError \? <p className="board-registry-error" role="alert">/);
  assert.match(STUDENTS, /onClick=\{confirmRemoveMembership\}[\s\S]*?disabled=\{participationSubmitting\}/);
});

test("restore reports errors, requires a confirmed result, and refreshes only after confirmed success", () => {
  const start = STUDENTS.indexOf("async function confirmRestoreMembership()");
  const end = STUDENTS.indexOf("const totalPages", start);
  const handler = STUDENTS.slice(start, end);
  assert.match(handler, /try\s*\{/);
  assert.match(handler, /if\s*\(!data\?\.result\)[\s\S]*?No success was recorded/);
  assert.ok(handler.indexOf("prompt.success") > handler.indexOf("if (!data?.result)"));
  assert.ok(handler.indexOf("await fetchStudents()") > handler.indexOf("prompt.success"));
  assert.match(handler, /catch\s*\(error\)[\s\S]*?boardStudentMutationFailureMessage\(error, "restore"\)/);
  assert.match(handler, /finally\s*\{\s*setParticipationSubmitting\(false\)/);
});

test("lookup stops only for a same-term active organization member and routes eligible existing identities to enrollment", () => {
  assert.match(REGISTRATION, /data\?\.organization_outcome === "ALREADY_MEMBER"/);
  assert.match(REGISTRATION, /if \(applyOutcome\(data\)\) return;/);
  assert.match(REGISTRATION, /"AVAILABLE_FOR_ORGANIZATION", "ACTIVATION_SYNC_REQUIRED", "NOT_CURRENTLY_ENROLLED", "ALREADY_MEMBER"/);
  assert.match(REGISTRATION, /registerExistingBoardStudentForTerm\(/);
  assert.match(REGISTRATION, /Existing identity, new term enrollment/);
  assert.match(REGISTRATION, /resolution\?\.organization_outcome === "NOT_CURRENTLY_ENROLLED"/);
  assert.doesNotMatch(REGISTRATION, /data\.organization_scope === "program" && data\.organization_outcome/);
  assert.match(CLIENT, /resolve_student_for_term/);
  assert.match(CLIENT, /enroll_existing_student_for_term/);
});

test("Add Student waits for the trusted organization profile instead of misreporting a loading context as unsupported", () => {
  assert.match(STUDENTS, /const \[organizationContextLoadedFor, setOrganizationContextLoadedFor\] = useState\(null\)/);
  assert.match(STUDENTS, /const organizationContextLoading = organizationContextLoadedFor !== String\(orgId\)/);
  assert.match(STUDENTS, /finally\(\(\) => \{\s*if \(active\) setOrganizationContextLoadedFor\(String\(orgId\)\)/);
  assert.match(STUDENTS, /className="board-students-action is-create"\s+disabled=\{organizationContextLoading\}/);
  assert.match(REGISTRATION, /disabled=\{busy \|\| activeTermLoading\}/);
});

test("production write safeguards default off and the prior registration-only artifact remains separate", () => {
  assert.match(DEVELOPMENT_GUARD, /remove_student_participation: false/);
  assert.match(DEVELOPMENT_GUARD, /restore_student_participation: false/);
  assert.match(DEVELOPMENT_GUARD, /update_student_names: false/);
  for (const action of ["list_students", "list_removed_students", "resolve_student_for_term", "create_new_student_for_term", "enroll_existing_student_for_term"]) {
    assert.ok(REGISTRATION_ONLY_CANDIDATE.includes(action), `${action} remains supported in the prior artifact`);
  }
  for (const action of ["update_student_names", "remove_student_participation", "restore_student_participation"]) {
    assert.ok(!REGISTRATION_ONLY_CANDIDATE.includes(action), `${action} must not be added to the prior artifact`);
  }
  assert.match(CLIENT, /action: "update_student_names"/);
  assert.match(CLIENT, /action: "remove_student_participation"/);
  assert.match(CLIENT, /action: "restore_student_participation"/);
});
