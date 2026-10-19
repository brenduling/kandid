import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createReadOnlyRegistryHandler } from "../supabase/functions/board-manual-enrollment-readonly-deploy/registryHandler.mjs";
import { KANDID_WEB_ORIGINS, withKandidCors } from "../supabase/functions/board-manual-enrollment-readonly-deploy/kandidRegistryCors.mjs";

const actorId = "board-user-1";
const termId = 71;
const organizationId = 11;

function fixtures({ role = "electoral_board", status = "active", boardOrganizationId = organizationId } = {}) {
  return {
    admin_users: role ? [{ auth_user_id: actorId, role, status, organization_id: boardOrganizationId }] : [],
    academic_terms: [{ id: termId, academic_year: "2026-2027", semester: "2nd Semester", status: "active", activated_at: "2026-10-01T00:00:00Z" }],
    organizations: [
      { id: organizationId, organization_type: "departmental", membership_scope: "program" },
      { id: 22, organization_type: "departmental", membership_scope: "program" },
    ],
    programs: [{ id: 3, code: "BSCS", name: "BSCS" }, { id: 4, code: "BSIT", name: "BSIT" }],
    organization_programs: [{ organization_id: organizationId, program_id: 3 }, { organization_id: 22, program_id: 4 }],
    student_organization_terms: [
      ...[1, 2, 3, 4].map((student_id) => ({ id: 100 + student_id, student_id, organization_id: organizationId, academic_term_id: termId, status: "active", source: "fixture" })),
      { id: 199, student_id: 9, organization_id: 22, academic_term_id: termId, status: "active", source: "other-org" },
      { id: 201, student_id: 8, organization_id: organizationId, academic_term_id: termId, status: "removed", source: "fixture", removal_reason: "fixture reason", removed_at: "2026-10-10T00:00:00Z" },
    ],
    student_term_enrollments: [
      ...[1, 2, 3, 4].map((student_id) => ({ student_id, academic_term_id: termId, program: "BSCS", year_level: 2, enrollment_status: "enrolled", source: "fixture" })),
      { student_id: 8, academic_term_id: termId, program: "BSIT", year_level: 3, enrollment_status: "enrolled", source: "fixture" },
    ],
    students: [
      ...[1, 2, 3, 4].map((id) => ({ id, student_number: `2026${id}`, first_name: `Student${id}`, last_name: "Fixture", email: `student${id}@example.invalid`, photo_url: null, status: "active", created_at: `2026-10-0${id}T00:00:00Z`, auth_user_id: "must-not-leak", password_hash: "must-not-leak" })),
      { id: 8, student_number: "20008", first_name: "Removed", last_name: "Fixture", email: "removed@example.invalid", photo_url: null, status: "active", created_at: "2026-10-08T00:00:00Z" },
      { id: 9, student_number: "20009", first_name: "Foreign", last_name: "Fixture", email: "foreign@example.invalid", status: "active", created_at: "2026-10-09T00:00:00Z" },
    ],
  };
}

function makeClientFactory({ data = fixtures(), authenticatedUserId = actorId, authError = null, admissionResult = { allowed: true, reason: "ALLOWED" } } = {}) {
  const queries = [];
  const clients = [];
  const projectKeys = { url: "https://fszgdxqxonqqcrzsnkca.supabase.co", anon: "anon-fixture", service: "service-fixture" };
  const createClient = (url, key, options = {}) => {
    const client = { url, key, options };
    clients.push(client);
    if (key === projectKeys.anon) {
      client.auth = { getUser: async () => authError
        ? { data: { user: null }, error: authError }
        : authenticatedUserId
          ? { data: { user: { id: authenticatedUserId } }, error: null }
          : { data: { user: null }, error: null } };
      return client;
    }
    client.from = (table) => {
      const query = { table, selected: "*", filters: [], ops: [] };
      queries.push(query);
      const builder = {
        select(columns) { query.selected = columns; query.ops.push("select"); return builder; },
        eq(column, value) { query.filters.push(["eq", column, value]); return builder; },
        in(column, values) { query.filters.push(["in", column, [...values]]); return builder; },
        limit(value) { query.limit = value; query.ops.push("limit"); return builder; },
        maybeSingle() {
          const rows = filteredRows(query, data);
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        then(resolve, reject) {
          return Promise.resolve({ data: filteredRows(query, data), error: null }).then(resolve, reject);
        },
      };
      return builder;
    };
    client.rpc = async (name, args) => {
      queries.push({ rpc: name, args });
      if (name !== "kandid_check_student_organization_admission") {
        return { data: null, error: new Error("Unexpected RPC") };
      }
      return { data: [admissionResult], error: null };
    };
    return client;
  };
  return { createClient, queries, clients, projectKeys };
}

function filteredRows(query, tables) {
  const rows = (tables[query.table] || []).filter((row) => query.filters.every(([op, key, value]) =>
    op === "eq" ? row[key] === value : value.includes(row[key]))).map((row) => {
    if (query.selected === "*") return row;
    const keys = query.selected.split(",").map((item) => item.trim());
    return Object.fromEntries(keys.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]));
  });
  return query.limit === undefined ? rows : rows.slice(0, query.limit);
}

function request(body, { authorization = "Bearer test-session", origin = "http://localhost:5174", method = "POST" } = {}) {
  return new Request("https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/board-manual-enrollment", {
    method,
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(origin ? { Origin: origin } : {}),
      "Content-Type": "application/json",
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

function handlerFor(clientFactory) {
  return createReadOnlyRegistryHandler({
    createClient: clientFactory.createClient,
    getEnv: (name) => ({
      SUPABASE_URL: clientFactory.projectKeys.url,
      SUPABASE_ANON_KEY: clientFactory.projectKeys.anon,
      SUPABASE_SERVICE_ROLE_KEY: clientFactory.projectKeys.service,
    })[name],
  });
}

test("list_students returns paginated active-term enrollment rows scoped to the authenticated Board", async () => {
  const clientFactory = makeClientFactory();
  const result = await handlerFor(clientFactory)(request({ action: "list_students", page: 1, page_size: 2, search: "fixture", sort_by: "id_asc", organization_id: organizationId }));
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.equal(body.data.count, 4);
  assert.equal(body.data.page, 1);
  assert.equal(body.data.page_size, 2);
  assert.deepEqual(body.data.students.map((student) => student.student_number), ["20261", "20262"]);
  assert.equal(body.data.board_organization_id, organizationId);
  assert.equal(body.data.academic_term.id, termId);
  assert.ok(body.data.students.every((student) => student.membership_status === "active" && student.academic_term_id === termId));
  assert.ok(!JSON.stringify(body).includes("must-not-leak"));
  const membershipQuery = clientFactory.queries.find((query) => query.table === "student_organization_terms");
  assert.deepEqual(membershipQuery.filters, [
    ["eq", "academic_term_id", termId],
    ["eq", "organization_id", organizationId],
    ["eq", "status", "active"],
  ]);
});

test("list_removed_students returns only removed participation in the authenticated Board and active term", async () => {
  const clientFactory = makeClientFactory();
  const result = await handlerFor(clientFactory)(request({ action: "list_removed_students" }));
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.equal(body.data.count, 1);
  assert.equal(body.data.students[0].membership_status, "removed");
  assert.equal(body.data.students[0].removal_reason, "fixture reason");
  const membershipQuery = clientFactory.queries.find((query) => query.table === "student_organization_terms");
  assert.ok(membershipQuery.filters.some(([op, key, value]) => op === "eq" && key === "organization_id" && value === organizationId));
  assert.ok(membershipQuery.filters.some(([op, key, value]) => op === "eq" && key === "academic_term_id" && value === termId));
  assert.ok(membershipQuery.filters.some(([op, key, value]) => op === "eq" && key === "status" && value === "removed"));
});

test("resolve_student_for_term returns the original current-term, Board-scoped response fields", async () => {
  const clientFactory = makeClientFactory();
  const result = await handlerFor(clientFactory)(request({ action: "resolve_student_for_term", student_number: "20261" }));
  const body = await result.json();

  assert.equal(result.status, 200);
  assert.deepEqual(body.data, {
    outcome: "ALREADY_ENROLLED_CURRENT_TERM",
    organization_outcome: "ALREADY_MEMBER",
    organization_type: "departmental",
    student: {
      student_number: "20261",
      first_name: "Student1",
      last_name: "Fixture",
      program: "BSCS",
      year_level: 2,
      status: "active",
    },
    academic_term: {
      id: termId,
      academic_year: "2026-2027",
      semester: "2nd Semester",
      status: "active",
    },
  });
  assert.ok(!JSON.stringify(body).includes("must-not-leak"));
  const studentQuery = clientFactory.queries.find((query) => query.table === "students");
  assert.deepEqual(studentQuery.filters, [["eq", "student_number", "20261"]]);
  const participationQuery = clientFactory.queries.find((query) => query.table === "student_organization_terms");
  assert.ok(participationQuery.filters.some(([op, key, value]) => op === "eq" && key === "organization_id" && value === organizationId));
  assert.ok(participationQuery.filters.some(([op, key, value]) => op === "eq" && key === "academic_term_id" && value === termId));
  assert.equal(clientFactory.queries.some((query) => query.rpc === "kandid_check_student_organization_admission"), false);
});

test("missing identity is a lookup result for WITSG and PSITS, without enrollment or membership writes", async () => {
  const missing = await handlerFor(makeClientFactory())(request({ action: "resolve_student_for_term" }));
  assert.equal(missing.status, 400);
  assert.deepEqual((await missing.json()).data, { outcome: "INVALID_FORMAT" });

  for (const organization of [
    { id: organizationId, name: "WITSG", organization_type: "departmental", membership_scope: "institution" },
    { id: organizationId, name: "PSITS", organization_type: "departmental", membership_scope: "program" },
  ]) {
    const data = fixtures();
    data.organizations[0] = organization;
    const clientFactory = makeClientFactory({ data });
    const result = await handlerFor(clientFactory)(request({ action: "resolve_student_for_term", student_number: "99999" }));
    const payload = await result.json();

    assert.equal(result.status, 200);
    assert.deepEqual(payload.data, { outcome: "STUDENT_IDENTITY_NOT_FOUND" });
    assert.equal(Object.hasOwn(payload.data, "student"), false);
    assert.equal(clientFactory.queries.some((query) => query.rpc), false);
    assert.equal(clientFactory.queries.some((query) => ["student_term_enrollments", "student_organization_terms", "student_organizations"].includes(query.table)), false);
  }
});

test("existing but unenrolled student is distinguished from missing identity", async () => {
  const data = fixtures();
  data.organizations[0] = { id: organizationId, name: "WITSG", organization_type: "departmental", membership_scope: "institution" };
  data.student_term_enrollments = [];
  data.student_organization_terms = data.student_organization_terms.filter((row) => row.student_id !== 1);
  const clientFactory = makeClientFactory({ data, admissionResult: { allowed: false, reason: "NOT_CURRENTLY_ENROLLED" } });
  const result = await handlerFor(clientFactory)(request({ action: "resolve_student_for_term", student_number: "20261" }));
  const payload = await result.json();

  assert.equal(result.status, 200);
  assert.equal(payload.data.outcome, "EXISTING_STUDENT_NEW_TERM");
  assert.equal(payload.data.organization_outcome, "NOT_CURRENTLY_ENROLLED");
  assert.equal(payload.data.student, null);
  assert.equal(clientFactory.queries.some((query) => query.rpc), false);
});

test("WITSG lookup reports an enrolled identity with missing institution membership without failing authorization", async () => {
  const data = fixtures();
  data.organizations[0] = { id: organizationId, name: "WITSG", organization_type: "departmental", membership_scope: "institution" };
  data.student_organization_terms = data.student_organization_terms.filter((row) => row.student_id !== 1);
  const clientFactory = makeClientFactory({ data });
  const result = await handlerFor(clientFactory)(request({ action: "resolve_student_for_term", student_number: "20261" }));
  const payload = await result.json();

  assert.equal(result.status, 200);
  assert.equal(payload.data.outcome, "ALREADY_ENROLLED_CURRENT_TERM");
  assert.equal(payload.data.organization_outcome, "ACTIVATION_SYNC_REQUIRED");
  assert.equal(payload.data.student.student_number, "20261");
  assert.equal(clientFactory.queries.some((query) => query.rpc), false);
  assert.equal(clientFactory.queries.some((query) => ["student_organization_terms", "student_term_enrollments"].includes(query.table) && query.ops.some((op) => ["insert", "update", "upsert"].includes(op))), false);
});

test("PSITS lookup independently checks program coverage and keeps membership system-managed", async () => {
  const data = fixtures();
  data.organizations[0] = { id: organizationId, name: "PSITS", organization_type: "departmental", membership_scope: "program" };
  data.student_organization_terms = data.student_organization_terms.filter((row) => row.student_id !== 1);
  const eligibleFactory = makeClientFactory({ data });
  const eligible = await handlerFor(eligibleFactory)(request({ action: "resolve_student_for_term", student_number: "20261" }));
  const eligibleBody = await eligible.json();
  assert.equal(eligible.status, 200);
  assert.equal(eligibleBody.data.organization_outcome, "ACTIVATION_SYNC_REQUIRED");
  assert.equal(eligibleBody.data.student.student_number, "20261");
  assert.equal(eligibleFactory.queries.some((query) => query.rpc), false);

  const ineligibleData = fixtures();
  ineligibleData.organizations[0] = { id: organizationId, name: "PSITS", organization_type: "departmental", membership_scope: "program" };
  ineligibleData.student_organization_terms = ineligibleData.student_organization_terms.filter((row) => row.student_id !== 1);
  ineligibleData.organization_programs = [{ organization_id: organizationId, program_id: 4 }];
  const ineligibleFactory = makeClientFactory({ data: ineligibleData });
  const ineligible = await handlerFor(ineligibleFactory)(request({ action: "resolve_student_for_term", student_number: "20261" }));
  const ineligibleBody = await ineligible.json();
  assert.equal(ineligible.status, 200);
  assert.equal(ineligibleBody.data.organization_outcome, "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION");
  assert.equal(ineligibleBody.data.student, null);
  const coverage = ineligibleFactory.queries.find((query) => query.table === "organization_programs");
  assert.deepEqual(coverage.filters, [["eq", "organization_id", organizationId]]);
});

test("lookup cannot read foreign organization participation or accept client-selected scope", async () => {
  const data = fixtures();
  data.student_organization_terms = data.student_organization_terms.filter((row) => row.student_id !== 1);
  data.student_organization_terms.push({ student_id: 1, organization_id: 22, academic_term_id: termId, status: "active", source: "foreign" });
  data.organization_programs = [{ organization_id: 22, program_id: 3 }];
  const foreignFactory = makeClientFactory({
    data,
    admissionResult: { allowed: false, reason: "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION" },
  });
  const foreign = await handlerFor(foreignFactory)(request({ action: "resolve_student_for_term", student_number: "20261" }));
  const foreignBody = await foreign.json();
  assert.equal(foreign.status, 200);
  assert.equal(foreignBody.data.organization_outcome, "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION");
  assert.equal(foreignBody.data.student, null);
  const membershipQuery = foreignFactory.queries.find((query) => query.table === "student_organization_terms");
  assert.ok(membershipQuery.filters.some(([op, key, value]) => op === "eq" && key === "organization_id" && value === organizationId));

  const forgedFactory = makeClientFactory();
  const forged = await handlerFor(forgedFactory)(request({
    action: "resolve_student_for_term", student_number: "20261", organization_id: 22,
  }));
  assert.equal(forged.status, 400);
  assert.deepEqual(forgedFactory.queries.map((query) => query.table), ["admin_users"]);
});

test("anonymous and authenticated Student sessions are denied before registry data queries", async () => {
  const anonymousFactory = makeClientFactory({ authenticatedUserId: null });
  const anonymousResponse = await handlerFor(anonymousFactory)(request({ action: "list_students" }, { authorization: null }));
  assert.equal(anonymousResponse.status, 401);

  const studentFactory = makeClientFactory({ authenticatedUserId: "student-user", data: fixtures({ role: null }) });
  const studentResponse = await handlerFor(studentFactory)(request({ action: "list_students" }));
  assert.equal(studentResponse.status, 403);
  assert.equal((await studentResponse.json()).code, "board_forbidden");
  assert.deepEqual(studentFactory.queries.map((query) => query.table), ["admin_users"]);

  const anonymousLookupFactory = makeClientFactory({ authenticatedUserId: null });
  const anonymousLookup = await handlerFor(anonymousLookupFactory)(request(
    { action: "resolve_student_for_term", student_number: "20261" },
    { authorization: null },
  ));
  assert.equal(anonymousLookup.status, 401);
  assert.deepEqual(anonymousLookupFactory.queries, []);

  const invalidSessionFactory = makeClientFactory({ authError: new Error("expired session") });
  const invalidSession = await handlerFor(invalidSessionFactory)(request(
    { action: "resolve_student_for_term", student_number: "20261" },
  ));
  assert.equal(invalidSession.status, 401);
  assert.deepEqual(await invalidSession.json(), { error: "Invalid or expired session.", code: "session_invalid" });
  assert.deepEqual(invalidSessionFactory.queries, []);
});

test("inactive or foreign Board profile cannot select another organization", async () => {
  const foreignFactory = makeClientFactory();
  const foreignResponse = await handlerFor(foreignFactory)(request({ action: "list_students", organization_id: 22 }));
  assert.equal(foreignResponse.status, 403);
  assert.deepEqual(foreignFactory.queries.map((query) => query.table), ["admin_users"]);

  const otherBoardFactory = makeClientFactory({ data: fixtures({ boardOrganizationId: 22 }) });
  const otherBoardResponse = await handlerFor(otherBoardFactory)(request({ action: "list_students", organization_id: organizationId }));
  assert.equal(otherBoardResponse.status, 403);
  assert.deepEqual(otherBoardFactory.queries.map((query) => query.table), ["admin_users"]);

  const inactiveFactory = makeClientFactory({ data: fixtures({ status: "inactive" }) });
  const inactiveResponse = await handlerFor(inactiveFactory)(request({ action: "list_students" }));
  assert.equal(inactiveResponse.status, 403);
});

test("all enrollment, import, removal, restore, edit, and unknown actions fail closed", async () => {
  const deniedActions = [
    "create_new_student_for_term", "enroll_existing_student_for_term",
    "create", "add_student", "batch_enroll", "preview_board_csv_import", "confirm_board_csv_import",
    "remove_student_participation", "restore_student_participation", "update_student_names",
    "enrollment_update", "unknown_future_action",
  ];
  for (const action of deniedActions) {
    const clientFactory = makeClientFactory();
    const result = await handlerFor(clientFactory)(request({ action, student: { student_number: "12345" }, rows: [] }));
    assert.equal(result.status, 403, `${action} must be denied`);
    assert.deepEqual(clientFactory.queries.map((query) => query.table), ["admin_users"]);
  }
  const missingActionFactory = makeClientFactory();
  const missingAction = await handlerFor(missingActionFactory)(request({ student: { student_number: "12345" } }));
  assert.equal(missingAction.status, 403);
});

test("official and approved localhost CORS origins pass; arbitrary browser origins fail", async () => {
  assert.ok(KANDID_WEB_ORIGINS.includes("https://witkandid.vercel.app"));
  assert.ok(KANDID_WEB_ORIGINS.includes("http://localhost:5174"));
  assert.ok(KANDID_WEB_ORIGINS.includes("http://localhost:5173"));
  const allowedFactory = makeClientFactory();
  const allowedRequest = request({ action: "list_students" }, { origin: "https://witkandid.vercel.app" });
  const allowed = withKandidCors(allowedRequest, await handlerFor(allowedFactory)(allowedRequest));
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://witkandid.vercel.app");

  const deniedFactory = makeClientFactory();
  const deniedRequest = request({ action: "list_students" }, { origin: "https://attacker.invalid" });
  const denied = await handlerFor(deniedFactory)(deniedRequest);
  assert.equal(denied.status, 403);
  assert.deepEqual(deniedFactory.queries, []);
});

test("CORS preflight preserves headers and method; absent Origin remains valid for server-to-server requests", async () => {
  const factory = makeClientFactory();
  const handler = handlerFor(factory);
  const preflight = new Request("https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/board-manual-enrollment", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5174",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, apikey, content-type",
    },
  });
  const accepted = await handler(preflight);
  assert.equal(accepted.status, 204);
  assert.equal(accepted.headers.get("access-control-allow-origin"), "http://localhost:5174");
  assert.equal(accepted.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.match(accepted.headers.get("access-control-allow-headers"), /authorization/);

  const serverRequest = await handler(request({ action: "list_students" }, { origin: null, authorization: null }));
  assert.equal(serverRequest.status, 401);
  const serverPreflight = await handler(new Request("https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/board-manual-enrollment", {
    method: "OPTIONS",
    headers: { "Access-Control-Request-Method": "POST" },
  }));
  assert.equal(serverPreflight.status, 204);
});

test("deployment artifact pins JWT verification and matches shared approved origins", async () => {
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const functionConfig = config.match(/\[functions\.board-manual-enrollment\]\s*\nverify_jwt\s*=\s*(\w+)/);
  assert.equal(functionConfig?.[1], "true");
  const sharedCors = await readFile(new URL("../supabase/functions/_shared/kandidProductionSecurity.mjs", import.meta.url), "utf8");
  const deployCors = await readFile(new URL("../supabase/functions/board-manual-enrollment-readonly-deploy/kandidRegistryCors.mjs", import.meta.url), "utf8");
  for (const origin of KANDID_WEB_ORIGINS) {
    assert.ok(sharedCors.includes(`"${origin}"`));
    assert.ok(deployCors.includes(`"${origin}"`));
  }
});
