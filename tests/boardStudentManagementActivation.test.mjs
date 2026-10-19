import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isBoardStudentManagementEnabled } from "../src/utils/boardStudentManagementFeatureGate.js";
import { isAllowedDevelopmentProductionRequest } from "../src/utils/developmentProductionWriteGuard.js";
import { runBoardStudentManagementGateOffSmoke } from "../src/utils/boardStudentManagementSmoke.js";

const official = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const payloads = [
  { action: "update_student_names", student_id: 303, changes: { first_name: "Synthetic", last_name: "Student" } },
  { action: "remove_student_participation", student_id: 303, reason: "Synthetic acceptance", confirm_student_number: "12345", password: "test-only" },
  { action: "restore_student_participation", student_id: 303 },
];
const allowed = (body, options = {}, target = official) => isAllowedDevelopmentProductionRequest({
  input: `${target}/functions/v1/board-manual-enrollment`, method: "POST", body: JSON.stringify(body), ...options,
});

test("management build gate defaults off and accepts only the exact enable value", () => {
  for (const value of [undefined, "false", "TRUE", " true ", true]) {
    assert.equal(isBoardStudentManagementEnabled({ VITE_ENABLE_BOARD_STUDENT_MANAGEMENT: value }), false);
  }
  assert.equal(isBoardStudentManagementEnabled({ VITE_ENABLE_BOARD_STUDENT_MANAGEMENT: "true" }), true);
});

test("management guard requires its own flag, exact payloads and official target", () => {
  for (const body of payloads) {
    assert.equal(allowed(body), false);
    assert.equal(allowed(body, { allowBoardStudentRegistration: true }), false);
    assert.equal(allowed(body, { allowBoardStudentManagement: true }), true);
    assert.equal(allowed({ ...body, organization_id: 999 }, { allowBoardStudentManagement: true }), false);
    assert.equal(allowed({ ...body, student_id: 0 }, { allowBoardStudentManagement: true }), false);
    assert.equal(allowed(body, { allowBoardStudentManagement: true }, "https://unapproved.invalid"), false);
  }
  assert.equal(allowed({ ...payloads[0], changes: { first_name: "A", last_name: "B", program: "BSHM" } }, { allowBoardStudentManagement: true }), false);
  assert.equal(allowed({ ...payloads[0], changes: { first_name: "A", last_name: "Student\u0000" } }, { allowBoardStudentManagement: true }), false);
  assert.equal(allowed({ ...payloads[1], password: "" }, { allowBoardStudentManagement: true }), false);
  assert.equal(allowed({ ...payloads[1], reason: " " }, { allowBoardStudentManagement: true }), false);
  for (const action of ["create_new_student_for_term", "enroll_existing_student_for_term", "batch_enroll", "confirm_board_csv_import", "unknown"]) {
    assert.equal(allowed({ action }, { allowBoardStudentManagement: true }), false);
  }
});

function loadHelpers(enabled, invoke) {
  const source = readFileSync("src/utils/boardManualEnrollment.js", "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  return new Function("supabase", "isBoardStudentRegistrationEnabled", "isBoardStudentManagementEnabled", `${source}\nreturn { updateBoardStudentNames, removeBoardStudentParticipation, restoreBoardStudentParticipation };`)(
    { functions: { invoke } }, () => false, () => enabled,
  );
}

test("all management helpers stop before invoke when disabled, including production builds", async () => {
  let calls = 0;
  const helpers = loadHelpers(false, async () => { calls += 1; });
  const responses = await Promise.all([
    helpers.updateBoardStudentNames({ studentId: 303, firstName: "A", lastName: "B" }),
    helpers.removeBoardStudentParticipation({ studentId: 303, reason: "Test", confirmStudentNumber: "12345", password: "test-only" }),
    helpers.restoreBoardStudentParticipation({ studentId: 303 }),
  ]);
  assert.equal(calls, 0);
  for (const result of responses) {
    assert.equal(result.data, null);
    assert.equal(result.error.code, "student_management_not_enabled");
  }
});

test("enabled helpers preserve the exact reviewed server contracts and return failures", async () => {
  const calls = [];
  const helpers = loadHelpers(true, async (name, options) => {
    calls.push({ name, body: options.body });
    return { data: { error: "Board student management is not enabled on this deployment.", code: "student_management_not_enabled" }, error: null };
  });
  const results = await Promise.all([
    helpers.updateBoardStudentNames({ studentId: 303, firstName: "Synthetic", lastName: "Student" }),
    helpers.removeBoardStudentParticipation({ studentId: 303, reason: "Synthetic acceptance", confirmStudentNumber: "12345", password: "test-only" }),
    helpers.restoreBoardStudentParticipation({ studentId: 303 }),
  ]);
  assert.deepEqual(calls.map((call) => call.body), payloads);
  assert.ok(calls.every((call) => call.name === "board-manual-enrollment"));
  for (const result of results) assert.equal(result.error.code, "student_management_not_enabled");
});

function loadCsvHelpers(registrationEnabled, invoke) {
  const source = readFileSync("src/utils/boardManualEnrollment.js", "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  return new Function("supabase", "isBoardStudentRegistrationEnabled", "isBoardStudentManagementEnabled", `${source}\nreturn { previewBoardCsvImport, confirmBoardCsvImport };`)(
    { functions: { invoke } }, () => registrationEnabled, () => false,
  );
}

test("CSV helpers send the exact preview/confirmed-evidence contracts and preserve partial server row results", async () => {
  const calls = [];
  const rows = [{ row_number: 2, student_number: "12345", first_name: "Synthetic", last_name: "Student", email: "", program: "BSIT", year_level: 2, is_shs: false, status: "pending" }];
  const helpers = loadCsvHelpers(true, async (name, options) => {
    calls.push({ name, body: options.body });
    if (options.body.action === "confirm_board_csv_import") {
      return { data: null, error: { message: "Edge Function returned non-2xx", context: new Response(JSON.stringify({
        error: "Audit summary failed after row processing.", code: "audit_record_failed",
        data: { summary: { imported: 1, skipped: 0 }, results: [{ row_number: 2, status: "imported" }] },
      }), { status: 500 }) } };
    }
    return { data: { data: { summary: { ready: 1 } } }, error: null };
  });
  const preview = await helpers.previewBoardCsvImport(rows);
  assert.equal(preview.data.summary.ready, 1);
  const confirmed = await helpers.confirmBoardCsvImport(rows, { evidenceReviewed: true });
  assert.equal(confirmed.data.summary.imported, 1);
  assert.equal(confirmed.error.code, "audit_record_failed");
  assert.equal(confirmed.status, 500);
  assert.deepEqual(calls.map((call) => call.body), [
    { action: "preview_board_csv_import", rows },
    { action: "confirm_board_csv_import", rows, evidence_reviewed: true },
  ]);
  assert.ok(calls.every((call) => call.name === "board-manual-enrollment"));
});

test("CSV confirmation helper respects the registration frontend gate and does not call fetch while off", async () => {
  let calls = 0;
  const helpers = loadCsvHelpers(false, async () => { calls += 1; });
  const result = await helpers.confirmBoardCsvImport([], { evidenceReviewed: true });
  assert.equal(calls, 0);
  assert.equal(result.error.code, "registration_not_enabled");
});

function smokeFixture({ failRead = false, gateStatus = 403 } = {}) {
  const requests = [];
  const client = {
    supabaseUrl: official,
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-only-session" } }, error: null }),
      getUser: async () => ({ data: { user: { id: "synthetic-board" } }, error: null }),
    },
    functions: { invoke: async (_name, { body }) => {
      requests.push({ read: body });
      if (failRead) return { data: null, error: new Error("forbidden") };
      if (body.action === "resolve_student_for_term") return { data: { data: { academic_term: { id: 1 }, outcome: "ALREADY_ENROLLED_CURRENT_TERM" } }, error: null };
      return { data: { data: { students: [{ student_number: "12345", first_name: "NEVER_OUTPUT_THIS" }], academic_term: { id: 1 } } }, error: null };
    } },
  };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, probe: body });
    const code = body.action.includes("_for_term") ? "registration_not_enabled" : "student_management_not_enabled";
    return new Response(JSON.stringify({ code }), { status: gateStatus });
  };
  return { client, requests, fetchImpl };
}

test("authenticated smoke performs three reads and five action-only probes, never returning credentials or students", async () => {
  const f = smokeFixture();
  const results = await runBoardStudentManagementGateOffSmoke({ ...f, url: official, publicKey: "test-only-public" });
  assert.equal(results.length, 8);
  assert.ok(results.every((row) => row.result.startsWith("PASS")));
  const probes = f.requests.filter((request) => request.probe);
  assert.equal(probes.length, 5);
  assert.ok(probes.every((request) => Object.keys(request.probe).join(",") === "action"));
  assert.ok(probes.every((request) => request.url === `${official}/functions/v1/board-manual-enrollment`));
  assert.doesNotMatch(JSON.stringify(results), /test-only-session|test-only-public|NEVER_OUTPUT_THIS|12345/);
});

test("smoke stops for unapproved targets, failed Board reads or unexpected gate responses", async () => {
  const normal = smokeFixture();
  await assert.rejects(runBoardStudentManagementGateOffSmoke({ ...normal, url: "https://unapproved.invalid", publicKey: "test" }), /official/);
  assert.equal(normal.requests.length, 0);
  const noBoard = smokeFixture({ failRead: true });
  await assert.rejects(runBoardStudentManagementGateOffSmoke({ ...noBoard, url: official, publicKey: "test" }), /list_students failed/);
  assert.equal(noBoard.requests.filter((request) => request.probe).length, 0);
  const badGate = smokeFixture({ gateStatus: 400 });
  const results = await runBoardStudentManagementGateOffSmoke({ ...badGate, url: official, publicKey: "test" });
  assert.equal(results.at(-1).result, "FAIL");
  assert.equal(badGate.requests.filter((request) => request.probe).length, 1);
});

test("registration-ON readiness probes remain action-only and require validation failure before any write", async () => {
  const fixture = smokeFixture();
  const probes = [];
  const results = await runBoardStudentManagementGateOffSmoke({ ...fixture, url: official, publicKey: "test-only", registrationEnabled: true,
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(init.body); probes.push(payload);
      return payload.action.endsWith("_for_term")
        ? new Response(JSON.stringify({ data: { outcome: "INVALID_INPUT" } }), { status: 400 })
        : new Response(JSON.stringify({ code: "student_management_not_enabled" }), { status: 403 });
    },
  });
  assert.equal(results.length, 8);
  assert.ok(results.every((row) => row.result.startsWith("PASS")));
  assert.ok(probes.every((payload) => Object.keys(payload).join(",") === "action"));
  assert.equal(results.filter((row) => row.http_status === 400).length, 2);
  assert.equal(results.filter((row) => row.http_status === 403).length, 3);
});
