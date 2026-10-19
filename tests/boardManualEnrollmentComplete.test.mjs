import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createBoardStudentRegistrationHandler } from "../supabase/functions/board-manual-enrollment-complete-deploy/registryHandler.mjs";

const URL = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const board = { id: 41, auth_user_id: "board-uuid", full_name: "Synthetic Board", role: "electoral_board", status: "active", organization_id: 73 };
const activeTerm = { id: 81, academic_year: "2026-2027", semester: "1st Semester", status: "active" };
const fixtures = (scope = "manual") => ({
  academic_terms: [activeTerm],
  organizations: [{ id: 73, name: "Synthetic Org", organization_type: scope === "program" ? "departmental" : "non_departmental", membership_scope: scope }],
  student_organization_terms: [{ id: 901, student_id: 303, organization_id: 73, academic_term_id: 81, status: "active", source: "manual" }],
  student_term_enrollments: [{ student_id: 303, academic_term_id: 81, program: "BSIT", year_level: 2, enrollment_status: "enrolled", source: "department_masterlist" }],
  students: [{ id: 303, student_number: "12345", first_name: "Ari", last_name: "Student", program: "BSIT", year_level: 2, status: "active" }],
  programs: [{ id: 1, code: "BSIT", name: "Information Technology" }],
  organization_programs: [{ organization_id: 73, program_id: 1 }],
});

function setup({ actionGate, registrationGate, userId = "board-uuid", userEmail = "board@example.invalid", authError = null, profile = board, data = fixtures(), admission = { allowed: true }, rpcResponse, failures = {} } = {}) {
  const calls = { rpc: [], updates: [], inserts: [], auth: [] };
  const createClient = (_url, key) => {
    if (key === "publishable") return {
      auth: {
        getUser: async () => ({ data: { user: authError ? null : userId ? { id: userId, email: userEmail } : null }, error: authError }),
        signInWithPassword: async (credentials) => {
          calls.auth.push(credentials);
          return { data: { user: { id: userId } }, error: null };
        },
      },
    };
    return {
      from(table) {
        let filters = [];
        let inFilters = [];
        let updateValues = null;
        const rows = () => (table === "admin_users" ? (profile ? [profile] : []) : (data[table] || []))
          .filter((row) => filters.every(([column, value]) => row[column] === value))
          .filter((row) => inFilters.every(([column, values]) => values.includes(row[column])));
        const builder = {
          select() { return builder; },
          eq(column, value) { filters.push([column, value]); return builder; },
          in(column, values) { inFilters.push([column, values]); return builder; },
          limit() { return builder; },
          update(values) { updateValues = values; calls.updates.push({ table, values, filters }); return builder; },
          insert(values) {
            calls.inserts.push({ table, values });
            return Promise.resolve({ data: null, error: failures.audit ? { message: "audit down" } : null });
          },
          maybeSingle: async () => {
            if (failures.throwQuery === table) throw new Error("network unavailable");
            if (failures[table]) return { data: null, error: { message: "database unavailable" } };
            if (updateValues) {
              if (failures.update) return { data: null, error: { message: "update denied" } };
              const row = rows()[0];
              return { data: row ? { id: row.id, ...updateValues } : null, error: null };
            }
            return { data: rows()[0] || null, error: null };
          },
          then(resolve, reject) {
            if (failures[table]) return Promise.resolve({ data: null, error: { message: "database unavailable" } }).then(resolve, reject);
            return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
          },
        };
        return builder;
      },
      rpc: async (name, args) => {
        calls.rpc.push({ name, args });
        if (failures[name]) return { data: null, error: { message: "RPC unavailable" } };
        if (name === "kandid_board_register_verified_student_for_term_v1" &&
          failures.registrationStudentNumber === args.p_student_number) {
          return { data: null, error: { message: "Synthetic row registration failure" } };
        }
        if (name === "kandid_check_student_organization_admission") return { data: [admission], error: null };
        if (name === "board_update_student_participation") return rpcResponse || { data: [{ student_id: 303, organization_id: 73, academic_term_id: 81, status: args.target_action === "remove" ? "removed" : "active", already_applied: false }], error: null };
        return { data: [{ student_id: 303, academic_term_id: 81, outcome: "STUDENT_CREATED", organization_outcome: "REGISTERED", verification_method: "school_id", verified_by_admin_id: 41 }], error: null };
      },
    };
  };
  const handler = createBoardStudentRegistrationHandler({
    createClient,
    getEnv: (name) => ({ SUPABASE_URL: URL, SUPABASE_ANON_KEY: "publishable", SUPABASE_SERVICE_ROLE_KEY: "server-only",
      BOARD_STUDENT_REGISTRATION_ENABLED: registrationGate, BOARD_STUDENT_MANAGEMENT_ENABLED: actionGate })[name],
  });
  return { handler, calls };
}

function request(body, authorization = "Bearer board-session") {
  return new Request(`${URL}/functions/v1/board-manual-enrollment`, {
    method: "POST", headers: { ...(authorization ? { Authorization: authorization } : {}), Origin: "http://localhost:5174", "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

async function invoke(handler, body, authorization) {
  const response = await handler(request(body, authorization));
  return { response, body: await response.json() };
}

test("Board student actions are explicit; management and registration gates are independent and default off", async () => {
  const actions = ["list_students", "list_removed_students", "resolve_student_for_term", "create_new_student_for_term", "enroll_existing_student_for_term", "update_student_names", "remove_student_participation", "restore_student_participation", "preview_board_csv_import", "confirm_board_csv_import"];
  const source = await readFile("supabase/functions/board-manual-enrollment-complete-deploy/registryHandler.mjs", "utf8");
  const config = await readFile("supabase/config.toml", "utf8");
  for (const action of actions) assert.ok(source.includes(action), `${action} appears in complete package`);
  assert.match(config, /\[functions\.board-manual-enrollment\]\s*\nverify_jwt\s*=\s*true\s*\nentrypoint\s*=\s*"\.\/functions\/board-manual-enrollment-complete-deploy\/index\.ts"/);
  for (const action of ["create_new_student_for_term", "enroll_existing_student_for_term"]) {
    const { handler, calls } = setup({});
    const { response, body } = await invoke(handler, { action });
    assert.equal(response.status, 403);
    assert.equal(body.code, "registration_not_enabled");
    assert.equal(calls.rpc.length, 0);
  }
  const csvConfirm = await invoke(setup({}).handler, { action: "confirm_board_csv_import", rows: [], evidence_reviewed: true });
  assert.equal(csvConfirm.response.status, 403);
  assert.equal(csvConfirm.body.code, "registration_not_enabled");
  for (const action of ["update_student_names", "remove_student_participation", "restore_student_participation"]) {
    const { handler, calls } = setup({});
    const { response, body } = await invoke(handler, { action });
    assert.equal(response.status, 403);
    assert.equal(body.code, "student_management_not_enabled");
    assert.equal(calls.rpc.length, 0);
    assert.equal(calls.updates.length, 0);
  }
});

test("all three read contracts stay available under the deployed JWT and Board checks", async () => {
  const { handler } = setup({});
  for (const body of [
    { action: "list_students", page: 1, page_size: 10, search: "", sort_by: "newest" },
    { action: "list_removed_students", page: 1, page_size: 10, search: "", sort_by: "newest" },
    { action: "resolve_student_for_term", student_number: "12345" },
  ]) {
    const { response } = await invoke(handler, body);
    assert.equal(response.status, 200);
  }
  const anonymous = await setup({}).handler(request({ action: "list_students" }, null));
  assert.equal(anonymous.status, 401);
  const student = await setup({ userId: "student-uuid", profile: null }).handler(request({ action: "list_students" }));
  assert.equal(student.status, 403);
});

test("management mutations reject invalid sessions, Student roles, and inactive Boards before writes", async () => {
  const payload = { action: "update_student_names", student_id: 303, changes: { first_name: "Ari", last_name: "Student" } };
  for (const options of [
    { actionGate: "true", authError: new Error("expired") },
    { actionGate: "true", userId: "student-uuid", profile: null },
    { actionGate: "true", profile: { ...board, status: "inactive" } },
    { actionGate: "true", profile: { ...board, role: "super_admin" } },
  ]) {
    const { handler, calls } = setup(options);
    const { response } = await invoke(handler, payload);
    assert.ok([401, 403].includes(response.status));
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.rpc.length, 0);
  }
});

test("update_student_names accepts only exact names for an active scoped participant and audits the actor", async () => {
  const { handler, calls } = setup({ actionGate: "true", data: fixtures("program") });
  const { response, body } = await invoke(handler, { action: "update_student_names", student_id: 303, changes: { first_name: "Arielle", last_name: "Student" } });
  assert.equal(response.status, 200);
  assert.equal(body.data.first_name, "Arielle");
  assert.deepEqual(calls.updates[0], { table: "students", values: { first_name: "Arielle", last_name: "Student" }, filters: [["id", 303]] });
  assert.equal(calls.inserts[0].table, "audit_logs");
  assert.equal(calls.inserts[0].values.event_type, "student_identity_updated");
  assert.equal(calls.inserts[0].values.user_id, board.id);
  assert.equal(calls.rpc.length, 0);
});

test("invalid and forged name edits fail closed without a database mutation", async () => {
  for (const payload of [
    { action: "update_student_names", student_id: 303, changes: { first_name: "", last_name: "Student" } },
    { action: "update_student_names", student_id: 303, changes: { first_name: "Ari", last_name: "Student", program: "BSHM" } },
    { action: "update_student_names", student_id: 303, organization_id: 99, changes: { first_name: "Ari", last_name: "Student" } },
  ]) {
    const { handler, calls } = setup({ actionGate: "true" });
    const { response } = await invoke(handler, payload);
    assert.ok(response.status >= 400);
    assert.equal(calls.updates.length, 0);
  }
  const { handler, calls } = setup({ actionGate: "true", data: { ...fixtures("program"), student_organization_terms: [] } });
  const { response } = await invoke(handler, { action: "update_student_names", student_id: 303, changes: { first_name: "Ari", last_name: "Student" } });
  assert.equal(response.status, 403);
  assert.equal(calls.updates.length, 0);
});

test("manual participation removal requires scoped target, matching ID, step-up auth, and trusted RPC", async () => {
  const payload = { action: "remove_student_participation", student_id: 303, reason: "duplicate test record", confirm_student_number: "12345", password: "synthetic-password" };
  const { handler, calls } = setup({ actionGate: "true" });
  const { response, body } = await invoke(handler, payload);
  assert.equal(response.status, 200);
  assert.equal(body.data.result.status, "removed");
  assert.deepEqual(calls.rpc.map((call) => call.name), ["board_update_student_participation"]);
  assert.equal(calls.rpc[0].args.target_organization_id, board.organization_id);
  assert.equal(calls.rpc[0].args.target_action, "remove");
  assert.equal(calls.auth.length, 1);
  assert.equal(calls.inserts[0].values.event_type, "membership_removed");
});

test("duplicate removal requests use the RPC idempotency result and avoid duplicate audit events", async () => {
  const { handler, calls } = setup({ actionGate: "true", rpcResponse: { data: [{ student_id: 303, academic_term_id: 81, status: "removed", already_applied: true }], error: null } });
  const { response, body } = await invoke(handler, { action: "remove_student_participation", student_id: 303, reason: "duplicate test", confirm_student_number: "12345", password: "synthetic-password" });
  assert.equal(response.status, 200);
  assert.equal(body.data.already_applied, true);
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.inserts.length, 0);
});

test("foreign-organization removal, wrong typed ID, and missing evidence stop before RPC", async () => {
  const base = { action: "remove_student_participation", student_id: 303, reason: "reason", confirm_student_number: "12345", password: "pw" };
  const foreign = setup({ actionGate: "true", data: { ...fixtures(), student_organization_terms: [] } });
  assert.equal((await invoke(foreign.handler, base)).response.status, 403);
  assert.equal(foreign.calls.rpc.length, 0);
  const mismatch = setup({ actionGate: "true" });
  assert.equal((await invoke(mismatch.handler, { ...base, confirm_student_number: "99999" })).response.status, 400);
  assert.equal(mismatch.calls.rpc.length, 0);
  const invalid = setup({ actionGate: "true" });
  assert.equal((await invoke(invalid.handler, { ...base, reason: "" })).response.status, 400);
  assert.equal(invalid.calls.rpc.length, 0);
});

test("system-managed program and institution memberships cannot be removed or restored by Boards", async (t) => {
  for (const scope of ["program", "institution"]) {
    await t.test(`${scope} scope`, async () => {
      for (const body of [
        { action: "remove_student_participation", student_id: 303, reason: "reason", confirm_student_number: "12345", password: "pw" },
        { action: "restore_student_participation", student_id: 303 },
      ]) {
        const { handler, calls } = setup({ actionGate: "true", data: fixtures(scope) });
        const { response, body: responseBody } = await invoke(handler, body);
        assert.equal(response.status, 403);
        assert.equal(responseBody.code, "activation_sync_required");
        assert.equal(calls.rpc.length, 0);
        assert.equal(calls.auth.length, 0);
      }
    });
  }
});

test("restore is manual-scope only, rechecks current admission, and is idempotent", async () => {
  const payload = { action: "restore_student_participation", student_id: 303 };
  const { handler, calls } = setup({ actionGate: "true", rpcResponse: { data: [{ student_id: 303, academic_term_id: 81, already_applied: true, status: "active" }], error: null } });
  const { response, body } = await invoke(handler, payload);
  assert.equal(response.status, 200);
  assert.equal(body.data.already_applied, true);
  assert.deepEqual(calls.rpc.map((call) => call.name), ["kandid_check_student_organization_admission", "board_update_student_participation"]);
  assert.equal(calls.inserts.length, 0);

  const restricted = setup({ actionGate: "true", data: fixtures("program") });
  assert.equal((await invoke(restricted.handler, payload)).response.status, 403);
  assert.equal(restricted.calls.rpc.length, 0);

  const denied = setup({ actionGate: "true", admission: { allowed: false, reason: "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION" } });
  assert.equal((await invoke(denied.handler, payload)).response.status, 403);
  assert.equal(denied.calls.rpc.length, 1);
});

test("foreign Board, malformed action payloads, and server failures do not report success", async () => {
  const foreignData = fixtures("program");
  foreignData.organizations = [{ ...foreignData.organizations[0], id: 99 }];
  foreignData.organization_programs = [{ organization_id: 99, program_id: 1 }];
  const forbidden = setup({ actionGate: "true", profile: { ...board, organization_id: 99 }, data: foreignData });
  const edit = await invoke(forbidden.handler, { action: "update_student_names", student_id: 303, changes: { first_name: "Ari", last_name: "Student" } });
  assert.equal(edit.response.status, 403);
  assert.equal(forbidden.calls.updates.length, 0);

  const badRestore = setup({ actionGate: "true" });
  assert.equal((await invoke(badRestore.handler, { action: "restore_student_participation", student_id: 303, organization_id: 99 })).response.status, 400);
  assert.equal(badRestore.calls.rpc.length, 0);

  const failedUpdate = setup({ actionGate: "true", data: fixtures("program"), failures: { update: true } });
  assert.equal((await invoke(failedUpdate.handler, { action: "update_student_names", student_id: 303, changes: { first_name: "Ari", last_name: "Student" } })).response.status, 500);
  assert.equal(failedUpdate.calls.inserts.length, 0);

  const failedRpc = setup({ actionGate: "true", failures: { board_update_student_participation: true } });
  const failedRemove = await invoke(failedRpc.handler, { action: "restore_student_participation", student_id: 303 });
  assert.equal(failedRemove.response.status, 400);
  assert.equal(failedRemove.body.data, undefined);

  const failedAudit = setup({ actionGate: "true", data: fixtures("program"), failures: { audit: true } });
  const auditFailure = await invoke(failedAudit.handler, { action: "update_student_names", student_id: 303, changes: { first_name: "Ari", last_name: "Student" } });
  assert.equal(auditFailure.response.status, 500);
  assert.equal(auditFailure.body.code, "audit_record_failed");

  const failedNetwork = setup({ actionGate: "true", data: fixtures("program"), failures: { throwQuery: "students" } });
  const networkFailure = await invoke(failedNetwork.handler, { action: "update_student_names", student_id: 303, changes: { first_name: "Ari", last_name: "Student" } });
  assert.equal(networkFailure.response.status, 500);
  assert.equal(networkFailure.body.data, undefined);
});

test("registration gate remains separate and no management action is accepted when unknown", async () => {
  const { handler } = setup({ actionGate: "true", registrationGate: undefined });
  assert.equal((await invoke(handler, { action: "create_new_student_for_term" })).response.status, 403);
  assert.equal((await invoke(handler, { action: "enroll_existing_student_for_term" })).response.status, 403);
  const unknown = await invoke(handler, { action: "purge_students" });
  assert.equal(unknown.response.status, 403);
});

test("final package keeps evidence-verified registration bound to the server-derived Board and trusted RPC", async () => {
  const { handler, calls } = setup({ registrationGate: "true" });
  const payload = {
    action: "create_new_student_for_term",
    student: { student_number: "56789", first_name: "Synthetic", last_name: "Student", email: "synthetic@example.invalid", program: "BSIT", year_level: 2 },
    verification_method: "school_id",
    evidence_reviewed: true,
  };
  const { response, body } = await invoke(handler, payload);
  assert.equal(response.status, 200);
  assert.equal(body.data.organization_outcome, "REGISTERED");
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.rpc[0].name, "kandid_board_register_verified_student_for_term_v1");
  assert.equal(calls.rpc[0].args.p_board_organization_id, board.organization_id);
  assert.equal(calls.rpc[0].args.p_actor_admin_id, board.id);
  assert.equal(calls.rpc[0].args.p_evidence_reviewed, true);
  assert.equal(calls.rpc[0].args.p_create_identity, true);

  const invalid = setup({ registrationGate: "true" });
  const invalidResult = await invoke(invalid.handler, { ...payload, evidence_reviewed: false });
  assert.equal(invalidResult.response.status, 400);
  assert.equal(invalid.calls.rpc.length, 0);
});

const csvRow = (overrides = {}) => ({
  row_number: 2, student_number: "56789", first_name: "Synthetic", last_name: "Student",
  email: "", program: "BSIT", year_level: 2, is_shs: false, status: "pending", ...overrides,
});

test("Board CSV preview classifies new, existing, already registered, duplicate, conflict, and ineligible rows without writes", async () => {
  const emptyData = { ...fixtures(), students: [], student_term_enrollments: [], student_organization_terms: [] };
  const newlyRegistered = setup({ data: emptyData });
  const newPreview = await invoke(newlyRegistered.handler, { action: "preview_board_csv_import", rows: [csvRow()] });
  assert.equal(newPreview.response.status, 200);
  assert.equal(newPreview.body.data.summary.new_students, 1);
  assert.equal(newPreview.body.data.results[0].registration_kind, "new_student");
  assert.equal(newlyRegistered.calls.rpc.length, 0);
  assert.equal(newlyRegistered.calls.inserts.length, 0);

  const existingData = fixtures();
  existingData.students[0].year_level = 2;
  existingData.student_term_enrollments[0].enrollment_status = "not_in_masterlist";
  existingData.student_organization_terms = [];
  const eligible = setup({ data: existingData });
  const existingPreview = await invoke(eligible.handler, { action: "preview_board_csv_import", rows: [csvRow({ student_number: "12345", first_name: "Ari" })] });
  assert.equal(existingPreview.body.data.summary.existing_students, 1);
  assert.equal(existingPreview.body.data.results[0].registration_kind, "existing_student");

  const already = await invoke(setup({}).handler, { action: "preview_board_csv_import", rows: [csvRow({ student_number: "12345", first_name: "Ari" })] });
  assert.equal(already.body.data.summary.already_member, 1);

  const duplicate = await invoke(setup({ data: emptyData }).handler, { action: "preview_board_csv_import", rows: [csvRow(), csvRow({ row_number: 3 })] });
  assert.equal(duplicate.body.data.results[1].status, "duplicate_csv");

  const conflict = setup();
  const conflictPreview = await invoke(conflict.handler, { action: "preview_board_csv_import", rows: [csvRow({ student_number: "12345", first_name: "Different" })] });
  assert.equal(conflictPreview.body.data.results[0].status, "identity_conflict");
  assert.match(conflictPreview.body.data.results[0].message, /left unchanged/);
  assert.equal(conflict.calls.rpc.length, 0);

  const foreignProgram = setup({ data: fixtures("program") });
  const ineligible = await invoke(foreignProgram.handler, { action: "preview_board_csv_import", rows: [csvRow({ student_number: "12345", first_name: "Ari", program: "BSHM" })] });
  assert.equal(ineligible.body.data.results[0].status, "ineligible");
  assert.equal(foreignProgram.calls.rpc.length, 0);
});

test("CSV confirm is default-off, requires reviewed evidence, revalidates, and uses the restricted RPC row by row", async () => {
  const row = csvRow();
  const off = setup({ data: { ...fixtures(), students: [], student_term_enrollments: [], student_organization_terms: [] } });
  const denied = await invoke(off.handler, { action: "confirm_board_csv_import", rows: [row], evidence_reviewed: true });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.code, "registration_not_enabled");
  assert.equal(off.calls.rpc.length, 0);

  const noEvidence = setup({ registrationGate: "true", data: { ...fixtures(), students: [], student_term_enrollments: [], student_organization_terms: [] } });
  const rejected = await invoke(noEvidence.handler, { action: "confirm_board_csv_import", rows: [row], evidence_reviewed: false });
  assert.equal(rejected.response.status, 400);
  assert.equal(noEvidence.calls.rpc.length, 0);

  const data = { ...fixtures(), students: [], student_term_enrollments: [], student_organization_terms: [] };
  const imported = setup({ registrationGate: "true", data });
  const accepted = await invoke(imported.handler, { action: "confirm_board_csv_import", rows: [row], evidence_reviewed: true });
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.data.summary.imported, 1);
  assert.equal(accepted.body.data.summary.skipped, 0);
  assert.deepEqual(imported.calls.rpc.map((call) => call.name), ["kandid_board_register_verified_student_for_term_v1"]);
  assert.equal(imported.calls.rpc[0].args.p_board_organization_id, board.organization_id);
  assert.equal(imported.calls.rpc[0].args.p_actor_admin_id, board.id);
  assert.equal(imported.calls.rpc[0].args.p_verification_method, "department_masterlist");
  assert.equal(imported.calls.rpc[0].args.p_evidence_reviewed, true);
  assert.equal(imported.calls.rpc[0].args.p_create_identity, true);
  assert.equal(imported.calls.inserts[0].values.event_type, "student_batch_imported");
});

test("CSV requests reject forged organization scope, invalid rows, oversized files, and non-Board sessions before any write", async () => {
  const forged = setup({ registrationGate: "true" });
  const preview = await invoke(forged.handler, { action: "preview_board_csv_import", organization_id: 99, rows: [csvRow()] });
  assert.equal(preview.response.status, 400);
  assert.equal(forged.calls.rpc.length, 0);

  const invalid = setup({ registrationGate: "true" });
  const invalidPreview = await invoke(invalid.handler, { action: "preview_board_csv_import", rows: [csvRow({ student_number: "not-an-id" })] });
  assert.equal(invalidPreview.body.data.results[0].status, "invalid");
  assert.equal(invalid.calls.rpc.length, 0);

  const oversized = setup();
  const oversizedResponse = await invoke(oversized.handler, { action: "preview_board_csv_import", rows: Array.from({ length: 501 }, (_, index) => csvRow({ row_number: index + 2 })) });
  assert.equal(oversizedResponse.response.status, 413);
  assert.equal(oversized.calls.rpc.length, 0);

  const anonymous = setup({ userId: null });
  assert.equal((await invoke(anonymous.handler, { action: "preview_board_csv_import", rows: [csvRow()] })).response.status, 401);
  const foreign = setup({ profile: { ...board, organization_id: 99 }, data: { ...fixtures(), organizations: [] } });
  assert.equal((await invoke(foreign.handler, { action: "preview_board_csv_import", rows: [csvRow()] })).response.status, 503);
  assert.equal(foreign.calls.rpc.length, 0);
});

test("CSV import reports partial row failures accurately and retains successful row results", async () => {
  const data = { ...fixtures(), students: [], student_term_enrollments: [], student_organization_terms: [] };
  const { handler, calls } = setup({ registrationGate: "true", data, failures: { registrationStudentNumber: "56790" } });
  const response = await invoke(handler, {
    action: "confirm_board_csv_import",
    rows: [csvRow(), csvRow({ row_number: 3, student_number: "56790", first_name: "Other" })],
    evidence_reviewed: true,
  });
  assert.equal(response.response.status, 200);
  assert.equal(response.body.data.summary.imported, 1);
  assert.equal(response.body.data.summary.skipped, 1);
  assert.equal(response.body.data.results.find((row) => row.student_number === "56789").status, "imported");
  assert.equal(response.body.data.results.find((row) => row.student_number === "56790").status, "not_imported");
  assert.equal(calls.rpc.length, 2);
});
