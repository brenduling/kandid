import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEVELOPMENT_PRODUCTION_WRITE_GUARD_MESSAGE,
  PENDING_BOARD_STUDENT_WRITE_PERMISSIONS,
  fetchDevelopmentProductionRequest,
  isAllowedDevelopmentProductionRequest,
} from "../src/utils/developmentProductionWriteGuard.js";
import { isBoardStudentRegistrationEnabled } from "../src/utils/boardStudentRegistrationFeatureGate.js";
import { isStudentAccountSetupEnabled } from "../src/utils/studentAccountSetupFeatureGate.js";

const api = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const allowed = (path, method = "GET", body = null) => isAllowedDevelopmentProductionRequest({
  input: `${api}${path}`,
  method,
  body: body === null ? null : JSON.stringify(body),
});

test("temporary development guard permits official-project reads and login session calls", () => {
  assert.equal(allowed("/rest/v1/elections?select=id"), true);
  assert.equal(allowed("/auth/v1/token?grant_type=password", "POST", { email: "a", password: "b" }), true);
  assert.equal(allowed("/auth/v1/token?grant_type=refresh_token", "POST", { refresh_token: "x" }), true);
  assert.equal(allowed("/auth/v1/user"), true);
  assert.equal(allowed("/functions/v1/resolve-student-login", "POST", { action: "login" }), true);
  assert.equal(allowed("/functions/v1/resolve-student-login", "POST", { action: "begin_access" }), false);
  assert.equal(allowed("/functions/v1/resolve-student-login", "POST", { action: "verify_access" }), false);
  assert.equal(allowed("/functions/v1/link-student-identity", "POST", {
    student_number: "123456", setup_mode: true, password: "Secure!123",
  }), false);
  assert.equal(allowed("/functions/v1/vote-access", "POST", {
    action: "board_dashboard_counts", election_ids: [1],
  }), true);
  assert.equal(allowed("/rest/v1/rpc/kandid_get_board_voting_monitor", "POST", {}), true);
});

test("temporary development guard rejects writes, voting and unexpected targets", () => {
  assert.equal(allowed("/rest/v1/students", "POST", { first_name: "Ada" }), false);
  assert.equal(allowed("/rest/v1/rpc/unknown_mutation", "POST", {}), false);
  assert.equal(allowed("/functions/v1/submit-vote", "POST", { election_id: 1 }), false);
  assert.equal(allowed("/functions/v1/vote-access", "POST", { action: "submit_vote" }), false);
  assert.equal(allowed("/auth/v1/signup", "POST", {}), false);
  assert.equal(isAllowedDevelopmentProductionRequest({
    input: "https://jkkgzhteacaafdnpeomy.supabase.co/rest/v1/elections",
    method: "GET",
  }), false);
  assert.equal(isAllowedDevelopmentProductionRequest({
    input: "http://127.0.0.1:55321/rest/v1/elections",
    method: "GET",
  }), false);
  assert.match(DEVELOPMENT_PRODUCTION_WRITE_GUARD_MESSAGE, /temporary.*pending backend activation/);
});

test("Board results reads pass strictly while result finalization stays protected in development", () => {
  assert.equal(allowed("/functions/v1/vote-access", "POST", {
    action: "election_results", election_id: 3,
  }), true);
  assert.equal(allowed("/functions/v1/vote-access", "POST", { action: "election_results" }), false);
  assert.equal(allowed("/functions/v1/vote-access", "POST", {
    action: "election_results", election_id: 0,
  }), false);
  assert.equal(allowed("/functions/v1/vote-access", "POST", {
    action: "election_results", election_id: "3",
  }), false);
  assert.equal(allowed("/functions/v1/vote-access", "POST", {
    action: "election_results", election_id: 3, organization_id: 2,
  }), false, "extra scope fields stay rejected");
  assert.equal(allowed("/rest/v1/rpc/kandid_get_election_turnout", "POST", { p_election_id: 3 }), true);
  assert.equal(allowed("/rest/v1/rpc/kandid_get_election_turnout", "POST", {}), false);
  assert.equal(allowed("/rest/v1/rpc/kandid_get_election_turnout", "POST", {
    p_election_id: 3, p_organization_id: 2,
  }), false);
  assert.equal(allowed("/rest/v1/rpc/kandid_finalize_officer_results", "POST", { p_election_id: 3 }), false,
    "result release stays blocked pending approved backend activation");
  assert.equal(allowed("/functions/v1/officers-contract", "POST", {
    action: "finalize_results", election_id: 3,
  }), false);
});

test("Board Officers and eligible-student reads pass narrowly while mutations stay blocked", () => {
  assert.equal(allowed("/functions/v1/officers-contract", "POST", { action: "list" }), true);
  assert.equal(allowed("/functions/v1/officers-contract", "POST", {
    action: "incoming_leadership", organization_id: 7,
  }), true);
  assert.equal(allowed("/functions/v1/officers-contract", "POST", {
    action: "incoming_leadership", organization_id: 7, role: "super_admin",
  }), false, "caller-supplied role and extra authority fields stay rejected");
  assert.equal(allowed("/functions/v1/officers-contract", "POST", {
    action: "incoming_leadership", organization_id: "7",
  }), false, "organization scope must be a positive integer");
  assert.equal(allowed("/functions/v1/officers-contract", "POST", {
    action: "organizations",
  }), false, "the Board read allow-list does not enable Super Admin organization access");
  for (const action of ["add_current_officer", "add_incoming_elected", "add_incoming_appointed", "update_service", "delete", "release_leadership", "finalize_results"]) {
    assert.equal(allowed("/functions/v1/officers-contract", "POST", { action, organization_id: 7 }), false, `${action} remains blocked in local development`);
  }

  assert.equal(allowed("/functions/v1/organization-eligibility", "POST", {
    action: "eligible_students_for_organization", organization_id: 7,
  }), true);
  assert.equal(allowed("/functions/v1/organization-eligibility", "POST", {
    action: "eligible_students_for_organization", organization_id: 7, include_member_ids: true,
  }), false, "only the scoped eligibility response is allowed");
  assert.equal(allowed("/functions/v1/organization-eligibility", "POST", {
    action: "current_organization_members", organization_id: 7,
  }), false);
});

test("isolated setup testing permits only strict OTP actions to the named disposable API", () => {
  const local = "http://127.0.0.1:59321/functions/v1/resolve-student-login";
  const allowLocalSetup = (body, origin = local, enabled = true) => isAllowedDevelopmentProductionRequest({
    input: origin,
    method: "POST",
    body: JSON.stringify(body),
    allowIsolatedStudentSetupTests: enabled,
  });
  assert.equal(allowLocalSetup({ action: "begin_access", student_number: "123456" }), true);
  assert.equal(allowLocalSetup({ action: "verify_access", student_number: "123456", registered_email: "s@example.invalid", verification_code: "012345" }), true);
  assert.equal(allowLocalSetup({ action: "begin_access", student_number: "123456", email: "attacker@example.invalid" }), false);
  assert.equal(allowLocalSetup({ action: "verify_access", student_number: "123456", registered_email: "s@example.invalid", verification_code: "12" }), false);
  assert.equal(allowLocalSetup({ action: "login", student_number: "123456" }), false);
  assert.equal(allowLocalSetup({ action: "begin_access", student_number: "123456" }, local, false), false);
  assert.equal(allowLocalSetup({ action: "begin_access", student_number: "123456" }, "http://127.0.0.1:55321/functions/v1/resolve-student-login"), false);
  assert.equal(allowLocalSetup({ action: "begin_access", student_number: "123456" }, "https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/resolve-student-login"), false);
  const allowLocalLink = (body, origin = "http://127.0.0.1:59321/functions/v1/link-student-identity", enabled = true) => isAllowedDevelopmentProductionRequest({
    input: origin,
    method: "POST",
    body: JSON.stringify(body),
    allowIsolatedStudentSetupTests: enabled,
  });
  assert.equal(allowLocalLink({ student_number: "123456", setup_mode: true, password: "Secure!123" }), true);
  assert.equal(allowLocalLink({ student_number: "123456", setup_mode: true, password: "Secure!123", auth_user_id: "forged" }), false);
  assert.equal(allowLocalLink({ student_number: "123456", setup_mode: true, password: "weak" }), false);
  assert.equal(allowLocalLink({ student_number: "123456", setup_mode: true, password: "Secure!123" }, undefined, false), false);
});

test("official Student account setup uses a narrow opt-in gate with exact request contracts", () => {
  const resolve = `${api}/functions/v1/resolve-student-login`;
  const link = `${api}/functions/v1/link-student-identity`;
  const allowedWithFlag = (input, body) => isAllowedDevelopmentProductionRequest({
    input, method: "POST", body: JSON.stringify(body), allowStudentAccountSetup: true,
  });
  assert.equal(isStudentAccountSetupEnabled({}), false);
  assert.equal(isStudentAccountSetupEnabled({ VITE_ENABLE_STUDENT_ACCOUNT_SETUP: "false" }), false);
  assert.equal(isStudentAccountSetupEnabled({ VITE_ENABLE_STUDENT_ACCOUNT_SETUP: "true" }), true);
  assert.equal(allowedWithFlag(resolve, { action: "begin_access", student_number: "123456" }), true);
  assert.equal(allowedWithFlag(resolve, { action: "verify_access", student_number: "123456", verification_code: "012345" }), true);
  assert.equal(allowedWithFlag(resolve, { action: "verify_access", student_number: "123456", verification_code: "012345", email: "forged@example.invalid" }), false);
  assert.equal(allowedWithFlag(resolve, { action: "verify_access", student_number: "123456", verification_code: "012345", registered_email: null }), false);
  assert.equal(allowedWithFlag(resolve, { action: "verify_access", student_number: "123456", registered_email: "student@example.invalid", verification_code: "012345" }), true);
  assert.equal(allowedWithFlag(link, { student_number: "123456", setup_mode: true, password: "Secure!123" }), true);
  assert.equal(allowedWithFlag(resolve, { action: "begin_access", student_number: "123456", registered_email: "attacker@example.invalid" }), false);
  assert.equal(allowedWithFlag(resolve, { action: "verify_access", student_number: "123456", registered_email: "student@example.invalid", verification_code: "bad" }), false);
  assert.equal(allowedWithFlag(link, { student_number: "123456", setup_mode: true, password: "Secure!123", auth_user_id: "forged" }), false);
  assert.equal(allowed("/functions/v1/link-student-identity", "POST", {
    student_number: "123456", setup_mode: true, password: "Secure!123",
  }), false, "setup identity linking remains blocked unless explicitly enabled");
});

test("election publication allows one scoped RPC and rejects direct candidate status writes", () => {
  const input = `${api}/rest/v1/rpc/kandid_publish_election_campaigns_v1`;
  const body = { p_election_id: 3, p_roster_fingerprint: "a".repeat(32) };
  const request = (payload, enabled = true, target = input) => isAllowedDevelopmentProductionRequest({ input: target, method: "POST", body: JSON.stringify(payload), allowCandidateManagement: enabled });
  assert.equal(request(body), true);
  assert.equal(request(body, false), false);
  for (const extra of [{ organization_id: 1 }, { actor_id: 1 }, { candidate_ids: [3] }]) assert.equal(request({ ...body, ...extra }), false);
  assert.equal(request({ ...body, p_roster_fingerprint: "bad" }), false);
  assert.equal(request(body, true, input + "?election_id=eq.4"), false);
  assert.equal(request({ p_election_id: 3 }, false, `${api}/rest/v1/rpc/kandid_get_election_campaign_publication_v1`), true);
  assert.equal(isAllowedDevelopmentProductionRequest({ input: `${api}/rest/v1/candidates?id=eq.3&position_id=eq.3&select=id`, method: "PATCH", body: JSON.stringify({ campaign_status: "published" }), allowCandidateManagement: true }), false);
});

test("Board registry reads pass while enrollment, imports and unknown Board actions stay blocked", () => {
  assert.equal(allowed("/functions/v1/board-manual-enrollment", "POST", {
    action: "list_students", page: 1, page_size: 10, search: "", sort_by: "newest",
  }), true);
  assert.equal(allowed("/functions/v1/board-manual-enrollment", "POST", {
    action: "list_removed_students", page: 1, page_size: 10,
  }), true);
  assert.equal(allowed("/functions/v1/board-manual-enrollment", "POST", {
    action: "resolve_student_for_term", student_number: "12345",
  }), true);
  assert.equal(allowed("/functions/v1/board-manual-enrollment", "POST", {
    action: "resolve_student_for_term", student_number: "12345", organization_id: 7,
  }), false);
  assert.equal(allowed("/functions/v1/board-manual-enrollment", "POST", {
    action: "preview_board_csv_import", rows: [{ row_number: 2, student_number: "12345" }],
  }), true);
  assert.equal(allowed("/functions/v1/board-manual-enrollment", "POST", {
    action: "preview_board_csv_import", rows: [], organization_id: 7,
  }), false);
  const csvRows = [{ row_number: 2, student_number: "12345", first_name: "Synthetic", last_name: "Student", email: "", program: "BSIT", year_level: 2, is_shs: false, status: "pending" }];
  const confirmCsv = (rows, extra = {}) => isAllowedDevelopmentProductionRequest({
    input: `${api}/functions/v1/board-manual-enrollment`, method: "POST",
    body: JSON.stringify({ action: "confirm_board_csv_import", rows, evidence_reviewed: true, ...extra }),
    allowBoardStudentRegistration: true,
  });
  assert.equal(allowed("/functions/v1/board-manual-enrollment", "POST", {
    action: "confirm_board_csv_import", rows: csvRows, evidence_reviewed: true,
  }), false, "CSV confirmation remains blocked by default");
  assert.equal(confirmCsv(csvRows), true, "CSV confirmation shares only the explicit registration approval gate");
  assert.equal(confirmCsv(csvRows, { evidence_reviewed: false }), false);
  assert.equal(confirmCsv(csvRows, { organization_id: 73 }), false);
  assert.equal(confirmCsv([{ ...csvRows[0], student_id: 9 }]), false);
  assert.equal(confirmCsv(Array.from({ length: 501 }, (_, index) => ({ ...csvRows[0], row_number: index + 2 }))), false);
  for (const action of [
    "create_new_student_for_term",
    "enroll_existing_student_for_term",
    "batch_enroll",
    "confirm_board_csv_import",
    "remove_student_participation",
    "restore_student_participation",
    "update_student_names",
    "unknown_action",
  ]) {
    assert.equal(allowed("/functions/v1/board-manual-enrollment", "POST", { action }), false, action);
  }
  assert.equal(allowed("/functions/v1/board-manual-enrollment", "POST", {
    action: "list_students", rows: [{ student_number: "12345" }],
  }), false);
  assert.equal(allowed("/functions/v1/board-manual-enrollment", "POST", {
    student: { student_number: "12345", first_name: "Ada", last_name: "Student" },
  }), false, "legacy action-less enrollment remains blocked");
});

test("future Board write access is explicit per action and inactive", () => {
  assert.deepEqual({ ...PENDING_BOARD_STUDENT_WRITE_PERMISSIONS }, {
    create_new_student_for_term: false,
    enroll_existing_student_for_term: false,
    remove_student_participation: false,
    restore_student_participation: false,
    update_student_names: false,
    confirm_board_csv_import: false,
    batch_enroll: false,
  });

  for (const [action, enabled] of Object.entries(PENDING_BOARD_STUDENT_WRITE_PERMISSIONS)) {
    assert.equal(enabled, false, `${action} stays disabled pending approval`);
    assert.equal(allowed("/functions/v1/board-manual-enrollment", "POST", {
      action,
      student: { student_number: "12345" },
      student_id: 1,
      rows: [{ student_number: "12345" }],
      reason: "test",
      changes: { first_name: "Changed" },
    }), false, `${action} must not reach fetch`);
  }
});

test("explicit registration gate permits only the two reviewed actions and a strict payload", () => {
  const request = (action, options = {}, extra = {}) => isAllowedDevelopmentProductionRequest({
    input: `${api}/functions/v1/board-manual-enrollment`,
    method: "POST",
    body: JSON.stringify({
      action,
      student: { student_number: "12345", first_name: "Test", last_name: "Student", program: "BSIT", year_level: 2 },
      verification_method: "school_id",
      evidence_reviewed: true,
      ...extra,
    }),
    ...options,
  });
  assert.equal(request("create_new_student_for_term"), false, "default remains off");
  assert.equal(request("create_new_student_for_term", { allowBoardStudentRegistration: true }), true);
  assert.equal(request("enroll_existing_student_for_term", { allowBoardStudentRegistration: true }), true);
  assert.equal(request("remove_student_participation", { allowBoardStudentRegistration: true }), false);
  assert.equal(request("confirm_board_csv_import", { allowBoardStudentRegistration: true }), false);
  assert.equal(request("unknown_action", { allowBoardStudentRegistration: true }), false);
  assert.equal(request("create_new_student_for_term", { allowBoardStudentRegistration: true }, { evidence_reviewed: false }), false);
  assert.equal(request("create_new_student_for_term", { allowBoardStudentRegistration: true }, { organization_id: 73 }), false);
  assert.equal(request("create_new_student_for_term", { allowBoardStudentRegistration: true }, {
    student: { ...{ student_number: "12345", first_name: "Test", last_name: "Student", program: "BSIT", year_level: 2 }, organization_id: 73 },
  }), false);
  assert.equal(isAllowedDevelopmentProductionRequest({
    input: "https://jkkgzhteacaafdnpeomy.supabase.co/functions/v1/board-manual-enrollment",
    method: "POST",
    body: JSON.stringify({ action: "create_new_student_for_term" }),
    allowBoardStudentRegistration: true,
  }), false);
});

test("registration feature gate is default-off in every build unless explicitly set true", async () => {
  assert.equal(isBoardStudentRegistrationEnabled({}), false);
  assert.equal(isBoardStudentRegistrationEnabled({ VITE_ENABLE_BOARD_STUDENT_REGISTRATION: "false" }), false);
  assert.equal(isBoardStudentRegistrationEnabled({ VITE_ENABLE_BOARD_STUDENT_REGISTRATION: "true" }), true);
  const utility = await readFile(new URL("../src/utils/boardManualEnrollment.js", import.meta.url), "utf8");
  assert.match(utility, /isBoardStudentRegistrationEnabled\(\)/);
  assert.match(utility, /REGISTRATION_NOT_ENABLED/);
});

test("allowed registry reads reach fetch, denied actions do not, and network errors remain failures", async () => {
  let requestCount = 0;
  const successfulFetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ data: { students: [{ id: 1 }], count: 1 } }), { status: 200 });
  };
  const response = await fetchDevelopmentProductionRequest(
    `${api}/functions/v1/board-manual-enrollment`,
    { method: "POST", body: JSON.stringify({ action: "list_students", page: 1, page_size: 10 }) },
    successfulFetch,
  );
  assert.equal(response.status, 200);
  assert.equal(requestCount, 1);

  const previewResponse = await fetchDevelopmentProductionRequest(
    `${api}/functions/v1/board-manual-enrollment`,
    { method: "POST", body: JSON.stringify({
      action: "preview_board_csv_import",
      rows: [{ row_number: 2, student_number: "12345", first_name: "A", last_name: "Student", program: "BSIT", year_level: 1 }],
    }) },
    successfulFetch,
  );
  assert.equal(previewResponse.status, 200);
  assert.equal(requestCount, 2);

  await assert.rejects(fetchDevelopmentProductionRequest(
    `${api}/functions/v1/board-manual-enrollment`,
    { method: "POST", body: JSON.stringify({ action: "create_new_student_for_term" }) },
    successfulFetch,
  ), /temporary.*pending backend activation/);
  assert.equal(requestCount, 2);

  const networkFailure = new TypeError("Failed to fetch");
  await assert.rejects(fetchDevelopmentProductionRequest(
    `${api}/functions/v1/board-manual-enrollment`,
    { method: "POST", body: JSON.stringify({ action: "list_students" }) },
    async () => { throw networkFailure; },
  ), (error) => error === networkFailure);
});

test("Board registry read errors render an unavailable state instead of a valid empty registry", async () => {
  const [page, utility, handler] = await Promise.all([
    readFile(new URL("../src/pages/board/Students.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/utils/boardManualEnrollment.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/board-manual-enrollment/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /viewMode === "removed" \? listRemovedBoardStudents : listBoardStudents/);
  assert.match(utility, /BOARD_MANUAL_ENROLLMENT_FUNCTION = "board-manual-enrollment"/);
  assert.match(utility, /action: "list_students",[\s\S]*?page: options\.page,[\s\S]*?page_size: options\.pageSize,[\s\S]*?search: options\.search,[\s\S]*?sort_by: options\.sortBy/);
  assert.match(utility, /action: "list_removed_students"/);
  assert.match(page, /if \(error\) \{[\s\S]*?setLoadError\(toBoardFacingError/);
  assert.ok(page.indexOf(") : loadError ? (") < page.indexOf(") : students.length === 0 ? ("));
  assert.match(handler, /const auth = await requireElectoralBoard\(request, supabaseUrl, anonKey, serviceRoleKey\)/);
  assert.match(handler, /authClient\.auth\.getUser\(\)/);
  assert.match(handler, /adminProfile\.role !== "electoral_board"[\s\S]*?adminProfile\.status !== "active"[\s\S]*?!adminProfile\.organization_id/);
  assert.match(handler, /if \(action === "list_students"\)[\s\S]*?handleListStudents\(auth\.adminClient, auth\.adminProfile, body\)/);
  assert.match(handler, /if \(action === "list_removed_students"\)[\s\S]*?handleListRemovedStudents\(auth\.adminClient, auth\.adminProfile, body\)/);
  assert.match(handler, /\.eq\("organization_id", boardOrganizationId\)/);
});
