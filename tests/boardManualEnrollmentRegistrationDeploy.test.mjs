import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createBoardStudentRegistrationHandler } from "../supabase/functions/board-manual-enrollment-registration-deploy/registryHandler.mjs";
import { KANDID_WEB_ORIGINS, withKandidCors } from "../supabase/functions/board-manual-enrollment-registration-deploy/kandidRegistryCors.mjs";

const projectUrl = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const adminProfile = { id: 41, auth_user_id: "board-uuid", role: "electoral_board", status: "active", organization_id: 73 };

function setup({ userId = "board-uuid", authError = null, profile = adminProfile, rpcResult = null, tables = {}, registrationGate } = {}) {
  const calls = { rpc: [], clients: [] };
  const createClient = (url, key, options) => {
    const client = { url, key, options };
    calls.clients.push(client);
    if (key === "publishable") {
      client.auth = { getUser: async () => authError
        ? { data: { user: null }, error: authError }
        : { data: { user: userId ? { id: userId } : null }, error: null } };
      return client;
    }
    client.from = (table) => {
      let selected = "";
      const filters = [];
      let limit = null;
      const rows = () => (table === "admin_users"
        ? (profile ? [profile] : [])
        : (tables[table] || [])).filter((row) => filters.every(([column, value]) => row[column] === value))
        .slice(0, limit || undefined);
      const builder = {
        select(value) { selected = value; return builder; },
        eq(column, value) { filters.push([column, value]); return builder; },
        limit(value) { limit = value; return builder; },
        maybeSingle: async () => {
          if (table === "admin_users") assert.match(selected, /organization_id/);
          const selectedRows = rows();
          return { data: selectedRows[0] || null, error: null };
        },
        then(resolve, reject) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject); },
      };
      return builder;
    };
    client.rpc = async (name, args) => {
      calls.rpc.push({ name, args });
      return rpcResult || { data: [{
        student_id: 303,
        academic_term_id: 81,
        outcome: "STUDENT_CREATED",
        organization_outcome: "REGISTERED",
        student_status: "active",
        verification_method: "school_id",
        verified_by_admin_id: 41,
      }], error: null };
    };
    return client;
  };
  return {
    calls,
    handler: createBoardStudentRegistrationHandler({
      createClient,
      getEnv: (name) => ({
        SUPABASE_URL: projectUrl,
        SUPABASE_ANON_KEY: "publishable",
        SUPABASE_SERVICE_ROLE_KEY: "server-only",
        BOARD_STUDENT_REGISTRATION_ENABLED: registrationGate,
      })[name],
    }),
  };
}

function request(body, { authorization = "Bearer test-session", origin = "http://localhost:5174" } = {}) {
  return new Request(`${projectUrl}/functions/v1/board-manual-enrollment`, {
    method: "POST",
    headers: { ...(authorization ? { Authorization: authorization } : {}), ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const registration = (action = "create_new_student_for_term", overrides = {}) => ({
  action,
  student: {
    student_number: "12345", first_name: "Synthetic", last_name: "Student", email: "synthetic@example.invalid",
    program: "bsit", year_level: 2,
  },
  verification_method: "school_id",
  evidence_reviewed: true,
  ...overrides,
});

test("registration deployment calls only the trusted RPC with server-derived Board scope", async () => {
  const { handler, calls } = setup({ registrationGate: "true" });
  const response = await handler(request(registration()));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.organization_outcome, "REGISTERED");
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.rpc[0].name, "kandid_board_register_verified_student_for_term_v1");
  assert.equal(calls.rpc[0].args.p_board_organization_id, adminProfile.organization_id);
  assert.equal(calls.rpc[0].args.p_actor_admin_id, adminProfile.id);
  assert.equal(calls.rpc[0].args.p_create_identity, true);
  assert.equal(calls.rpc[0].args.p_program, "BSIT");
  assert.equal(calls.rpc[0].args.p_evidence_reviewed, true);
  assert.ok(!JSON.stringify(body).includes("server-only"));
});

test("existing identity enrollment uses the same reviewed evidence contract", async () => {
  const { handler, calls } = setup({ registrationGate: "true" });
  const response = await handler(request(registration("enroll_existing_student_for_term")));
  assert.equal(response.status, 200);
  assert.equal(calls.rpc[0].args.p_create_identity, false);
});

test("server registration write gate defaults off for both actions and rejects non-exact enable values", async (t) => {
  for (const action of ["create_new_student_for_term", "enroll_existing_student_for_term"]) {
    for (const registrationGate of [undefined, "false", "TRUE", " true "]) {
      await t.test(`${action} with gate=${String(registrationGate)}`, async () => {
        const { handler, calls } = setup({ registrationGate });
        const response = await handler(request(registration(action)));
        const body = await response.json();
        assert.equal(response.status, 403);
        assert.equal(body.data.outcome, "REGISTRATION_NOT_ENABLED");
        assert.equal(body.code, "registration_not_enabled");
        assert.equal(calls.rpc.length, 0);
      });
    }
  }
});

test("duplicate-identity RPC outcome remains a conflict for an authorized Board", async () => {
  const { handler, calls } = setup({
    registrationGate: "true",
    rpcResult: { data: null, error: { message: "IDENTITY_RECHECK_REQUIRED" } },
  });
  const response = await handler(request(registration("create_new_student_for_term")));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.data.outcome, "IDENTITY_RECHECK_REQUIRED");
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.rpc[0].args.p_board_organization_id, adminProfile.organization_id);
});

test("a Board cannot register a program outside its server-configured coverage", async () => {
  const { handler, calls } = setup({
    registrationGate: "true",
    rpcResult: { data: null, error: { message: "Program is outside this Board organization coverage" } },
  });
  const response = await handler(request(registration("create_new_student_for_term")));
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.data.outcome, "INELIGIBLE");
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.rpc[0].args.p_board_organization_id, adminProfile.organization_id);
});

test("the staged function preserves all three deployed read actions", async () => {
  const tables = {
    academic_terms: [{ id: 81, academic_year: "2026-2027", semester: "1st Semester", status: "active" }],
    organizations: [{ id: 73, name: "Board", organization_type: "departmental", membership_scope: "program" }],
    student_organization_terms: [],
    students: [],
  };
  const { handler, calls } = setup({ tables });
  for (const body of [
    { action: "list_students", page: 1, page_size: 10 },
    { action: "list_removed_students", page: 1, page_size: 10 },
  ]) {
    const response = await handler(request(body));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(result.data.students, []);
    assert.equal(result.data.board_organization_id, adminProfile.organization_id);
  }
  const lookup = await handler(request({ action: "resolve_student_for_term", student_number: "12345" }));
  const lookupBody = await lookup.json();
  assert.equal(lookup.status, 200);
  assert.equal(lookupBody.data.outcome, "STUDENT_IDENTITY_NOT_FOUND");
  assert.equal(calls.rpc.length, 0);
});

test("eligible existing identity without current-term enrollment is routed as an existing-term registration", async () => {
  const tables = {
    academic_terms: [{ id: 81, academic_year: "2026-2027", semester: "1st Semester", status: "active" }],
    organizations: [{ id: 73, name: "Program Board", organization_type: "departmental", membership_scope: "program" }],
    students: [{ id: 303, student_number: "12345", first_name: "Synthetic", last_name: "Student", program: "BSIT", year_level: 2, status: "pending" }],
    student_term_enrollments: [],
    student_organization_terms: [],
    programs: [{ id: 4, code: "BSIT", name: "Information Technology" }],
    organization_programs: [{ organization_id: 73, program_id: 4 }],
  };
  const { handler, calls } = setup({ tables });
  const response = await handler(request({ action: "resolve_student_for_term", student_number: "12345" }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.data.outcome, "EXISTING_STUDENT_NEW_TERM");
  assert.equal(result.data.organization_outcome, "NOT_CURRENTLY_ENROLLED");
  assert.equal(result.data.student.student_number, "12345");
  assert.equal(result.data.student.program, "BSIT");
  assert.equal(calls.rpc.length, 0, "lookup stays read-only");
});

test("existing identity lookup requires configured program coverage before exposing details", async () => {
  const tables = {
    academic_terms: [{ id: 81, academic_year: "2026-2027", semester: "1st Semester", status: "active" }],
    organizations: [{ id: 73, name: "Program Board", organization_type: "departmental", membership_scope: "program" }],
    students: [{ id: 303, student_number: "12345", first_name: "Synthetic", last_name: "Student", program: "BSHM", year_level: 2, status: "active" }],
    student_term_enrollments: [],
    student_organization_terms: [],
    programs: [{ id: 4, code: "BSHM", name: "Hospitality Management" }],
    organization_programs: [{ organization_id: 99, program_id: 4 }],
  };
  const { handler, calls } = setup({ tables });
  const response = await handler(request({ action: "resolve_student_for_term", student_number: "12345" }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.data.organization_outcome, "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION");
  assert.equal(result.data.student, null);
  assert.equal(calls.rpc.length, 0);
});

test("unsupported historical/current enrollment statuses are not offered to a Board for re-enrollment", async () => {
  const tables = {
    academic_terms: [{ id: 81, academic_year: "2026-2027", semester: "1st Semester", status: "active" }],
    organizations: [{ id: 73, name: "Program Board", organization_type: "departmental", membership_scope: "program" }],
    students: [{ id: 303, student_number: "12345", first_name: "Synthetic", last_name: "Student", program: "BSIT", year_level: 2, status: "active" }],
    student_term_enrollments: [{ student_id: 303, academic_term_id: 81, program: "BSIT", year_level: 2, enrollment_status: "withdrawn" }],
    student_organization_terms: [],
    programs: [{ id: 4, code: "BSIT", name: "Information Technology" }],
    organization_programs: [{ organization_id: 73, program_id: 4 }],
  };
  const { handler, calls } = setup({ tables });
  const response = await handler(request({ action: "resolve_student_for_term", student_number: "12345" }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.data.organization_outcome, "NOT_CURRENTLY_ENROLLED");
  assert.equal(result.data.student, null);
  assert.equal(calls.rpc.length, 0);
});

test("existing active same-term organization members remain duplicate-blocked", async () => {
  const tables = {
    academic_terms: [{ id: 81, academic_year: "2026-2027", semester: "1st Semester", status: "active" }],
    organizations: [{ id: 73, name: "Program Board", organization_type: "departmental", membership_scope: "program" }],
    students: [{ id: 303, student_number: "12345", first_name: "Synthetic", last_name: "Student", program: "BSIT", year_level: 2, status: "active" }],
    student_term_enrollments: [{ student_id: 303, academic_term_id: 81, program: "BSIT", year_level: 2, enrollment_status: "enrolled" }],
    student_organization_terms: [{ student_id: 303, organization_id: 73, academic_term_id: 81, status: "active" }],
    programs: [{ id: 4, code: "BSIT", name: "Information Technology" }],
    organization_programs: [{ organization_id: 73, program_id: 4 }],
  };
  const { handler, calls } = setup({ tables });
  const response = await handler(request({ action: "resolve_student_for_term", student_number: "12345" }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.data.organization_outcome, "ALREADY_MEMBER");
  assert.equal(result.data.student.student_number, "12345");
  assert.equal(calls.rpc.length, 0);
});

test("anonymous, invalid-session, inactive, and non-Board actors cannot register", async (t) => {
  const cases = [
    { name: "anonymous", options: { userId: null }, requestOptions: { authorization: null }, status: 401 },
    { name: "invalid session", options: { authError: new Error("invalid") }, status: 401 },
    { name: "student role", options: { profile: { ...adminProfile, role: "student" } }, status: 403 },
    { name: "inactive Board", options: { profile: { ...adminProfile, status: "inactive" } }, status: 403 },
    { name: "unassigned Board", options: { profile: { ...adminProfile, organization_id: null } }, status: 403 },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const { handler, calls } = setup({ ...item.options, registrationGate: "true" });
    const response = await handler(request(registration(), item.requestOptions));
    assert.equal(response.status, item.status);
    assert.equal(calls.rpc.length, 0);
  });
});

test("forged organization input and all unsupported writes are denied before RPC", async () => {
  const actions = [
    "confirm_board_csv_import", "batch_enroll", "remove_student_participation",
    "restore_student_participation", "update_student_names", "unknown_action",
  ];
  const { handler, calls } = setup({ registrationGate: "true" });
  const forged = await handler(request(registration("create_new_student_for_term", { organization_id: 22 })));
  assert.equal(forged.status, 400);
  for (const action of actions) {
    const response = await handler(request({ action, student: registration().student }));
    assert.equal(response.status, 403, action);
  }
  assert.equal(calls.rpc.length, 0);
});

test("unreviewed evidence and malformed fields cannot invoke registration RPC", async () => {
  const { handler, calls } = setup({ registrationGate: "true" });
  const unreviewed = await handler(request(registration("create_new_student_for_term", { evidence_reviewed: false })));
  assert.equal(unreviewed.status, 400);
  const extraStudentField = registration();
  extraStudentField.student.organization_id = 22;
  const malformed = await handler(request(extraStudentField));
  assert.equal(malformed.status, 400);
  assert.equal(calls.rpc.length, 0);
});

test("registration deployment retains verified JWT, CORS, and exactly two write actions", async () => {
  const [config, source] = await Promise.all([
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/board-manual-enrollment-registration-deploy/registryHandler.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(config, /\[functions\.board-manual-enrollment\]\s*\nverify_jwt\s*=\s*true/);
  assert.match(source, /new Set\(\["create_new_student_for_term", "enroll_existing_student_for_term"\]\)/);
  assert.match(source, /if \(!READ_ACTIONS\.has\(action\) && !REGISTRATION_ACTIONS\.has\(action\)\)/);
  assert.ok(KANDID_WEB_ORIGINS.includes("https://witkandid.vercel.app"));
  assert.ok(KANDID_WEB_ORIGINS.includes("http://localhost:5174"));
});

test("registration artifact preflight allows approved origins and rejects arbitrary browser origins", async () => {
  const { handler } = setup();
  const allowedRequest = new Request(`${projectUrl}/functions/v1/board-manual-enrollment`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5174",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, apikey, content-type",
    },
  });
  const allowed = withKandidCors(allowedRequest, await handler(allowedRequest));
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:5174");
  assert.match(allowed.headers.get("access-control-allow-headers"), /authorization/);

  const rejectedRequest = new Request(`${projectUrl}/functions/v1/board-manual-enrollment`, {
    method: "OPTIONS",
    headers: { Origin: "https://attacker.example", "Access-Control-Request-Method": "POST" },
  });
  const rejected = withKandidCors(rejectedRequest, await handler(rejectedRequest));
  assert.equal(rejected.status, 403);
});
