import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { transformSync } from "esbuild";
import {
  handleCorsPreflight,
  rejectDisallowedOrigin,
  withKandidCors,
} from "../supabase/functions/_shared/kandidProductionSecurity.mjs";

const BOARD_FUNCTION = "supabase/functions/board-manual-enrollment/index.ts";
const ELIGIBILITY_FUNCTION = "supabase/functions/organization-eligibility/index.ts";
const STUDENTS_PAGE = readFileSync("src/pages/board/Students.jsx", "utf8");
const ADMIN_AUTH = readFileSync("src/utils/auth.js", "utf8");

function fixture() {
  return {
    userId: "board-auth",
    profiles: [{ id: 9, auth_user_id: "board-auth", role: "electoral_board", status: "active", organization_id: 7 }],
    terms: [{ id: 5, status: "active", academic_year: "2026-2027", semester: "1st Semester" }],
    students: [{ id: 1, auth_user_id: "student-auth", student_number: "S1", password: "pass", status: "active", first_name: "Jane", last_name: "Ben" }],
    organizations: [{ id: 7, name: "PSITS", organization_type: "departmental", membership_scope: "program" }],
    programs: [{ id: 11, code: "BSIT", name: "Bachelor of Science in Information Technology" }],
    organizationPrograms: [{ organization_id: 7, program_id: 11 }],
    participations: [{ student_id: 1, organization_id: 7, academic_term_id: 5, status: "active" }],
    enrollments: [{ student_id: 1, academic_term_id: 5, enrollment_status: "enrolled" }],
    updates: [],
    audits: [],
    tableReads: [],
  };
}

function matching(rows, filters, inFilters) {
  return rows.filter((row) =>
    Object.entries(filters).every(([key, value]) => row[key] === value) &&
    Object.entries(inFilters).every(([key, values]) => values.includes(row[key])),
  );
}

function mockQuery(table, state) {
  const tables = {
    admin_users: state.profiles,
    academic_terms: state.terms,
    students: state.students,
    organizations: state.organizations,
    programs: state.programs,
    organization_programs: state.organizationPrograms,
    student_organization_terms: state.participations,
    student_term_enrollments: state.enrollments,
  };
  const filters = {};
  const inFilters = {};
  let update = null;
  let range = null;
  let rowLimit = null;
  let head = false;
  const query = {
    select(_fields, options = {}) { head = Boolean(options.head); return query; },
    eq(key, value) { filters[key] = value; return query; },
    in(key, values) { inFilters[key] = values; return query; },
    order() { return query; },
    limit(value) { rowLimit = value; return query; },
    range(from, to) { range = [from, to]; return query; },
    update(changes) { update = changes; return query; },
    insert(row) { state.audits.push(row); return Promise.resolve({ error: null }); },
    async maybeSingle() {
      const row = matching(tables[table] || [], filters, inFilters)[0] || null;
      if (row && update) {
        Object.assign(row, update);
        state.updates.push({ table, changes: update });
      }
      return { data: row, error: null };
    },
    then(resolve, reject) {
      let rows = matching(tables[table] || [], filters, inFilters);
      if (range) rows = rows.slice(range[0], range[1] + 1);
      if (rowLimit !== null) rows = rows.slice(0, rowLimit);
      return Promise.resolve({ data: head ? null : rows, count: head ? rows.length : null, error: null }).then(resolve, reject);
    },
  };
  return query;
}

function loadHandler(filename, state) {
  let handler;
  const source = readFileSync(filename, "utf8");
  const compiled = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
  const createClient = (_url, key, options = {}) => key === "anon"
    ? {
      auth: {
        getUser: async () => options.global?.headers?.Authorization
          ? { data: { user: state.userId ? { id: state.userId } : null }, error: state.userId ? null : new Error("invalid token") }
          : { data: { user: null }, error: new Error("missing token") },
      },
    }
    : {
      from: (table) => { state.tableReads.push(table); return mockQuery(table, state); },
      async rpc(name, args) {
        assert.equal(name, "resolve_student_organization_participation");
        state.activeParticipationCalls = (state.activeParticipationCalls || 0) + 1;
        state.maxParticipationCalls = Math.max(state.maxParticipationCalls || 0, state.activeParticipationCalls);
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (state.failParticipationResolution) {
          state.activeParticipationCalls -= 1;
          return { data: null, error: new Error("internal resolver details") };
        }
        const row = state.participations.find((participation) =>
          participation.student_id === args.target_student_id &&
          participation.organization_id === args.target_organization_id &&
          participation.academic_term_id === args.target_academic_term_id,
        );
        const organization = state.organizations.find((item) => item.id === args.target_organization_id);
        const validScope = organization && ["program", "manual", "institution"].includes(organization.membership_scope) &&
          !(organization.membership_scope === "program" && organization.organization_type !== "departmental") &&
          !(organization.membership_scope === "manual" && organization.organization_type !== "non_departmental");
        state.activeParticipationCalls -= 1;
        return { data: [{ allowed: row?.status === "active" && validScope, source: row?.source || "fixture" }], error: null };
      },
    };
  vm.runInNewContext(compiled, {
    require: (specifier) => specifier.includes("kandidProductionSecurity")
      ? {
        handleCorsPreflight,
        rejectDisallowedOrigin,
        serveWithKandidCors: (handlerFn) => {
          handler = async (request) => withKandidCors(request, await handlerFn(request));
        },
      }
      : ({ createClient }),
    module: { exports: {} },
    exports: {},
    Deno: { env: { get: (key) => ({ SUPABASE_URL: "url", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" })[key] }, serve: (value) => { handler = value; } },
    Request,
    Response,
    console,
  }, { filename });
  return handler;
}

async function call(handler, body, authenticated = true) {
  const response = await handler(new Request("https://example.test", {
    method: "POST",
    headers: authenticated ? { Authorization: "Bearer test" } : {},
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

const editBody = {
  action: "update_student_names",
  student_id: 1,
  changes: { first_name: " Janie ", last_name: " Benn " },
};

test("Board edit updates only names for an active current-term member", async () => {
  const state = fixture();
  state.enrollments[0].program = "BSIT";
  const result = await call(loadHandler(BOARD_FUNCTION, state), editBody);
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(state.updates.map((entry) => entry.changes))), [{ first_name: "Janie", last_name: "Benn" }]);
  assert.equal(state.students[0].auth_user_id, "student-auth");
  assert.equal(state.participations[0].status, "active");
  assert.equal(state.audits.length, 1);
});

test("Board edit rejects unauthenticated and wrong-role requests", async () => {
  const state = fixture();
  const handler = loadHandler(BOARD_FUNCTION, state);
  assert.equal((await call(handler, editBody, false)).status, 401);
  state.profiles[0].role = "super_admin";
  assert.equal((await call(handler, editBody)).status, 403);
  assert.equal(state.updates.length, 0);
});

test("Board edit rejects out-of-scope, removed, and unenrolled students", async () => {
  for (const mode of ["other-org", "removed", "unenrolled"]) {
    const state = fixture();
    if (mode === "other-org") state.participations[0].organization_id = 8;
    if (mode === "removed") state.participations[0].status = "removed";
    if (mode === "unenrolled") state.enrollments[0].enrollment_status = "not_enrolled";
    const result = await call(loadHandler(BOARD_FUNCTION, state), editBody);
    assert.equal(result.status, 403, mode);
    assert.equal(state.updates.length, 0, mode);
  }
});

test("Board edit rejects protected fields and empty names", async () => {
  for (const changes of [
    { ...editBody.changes, auth_user_id: "other" },
    { ...editBody.changes, email: "other@example.test" },
    { ...editBody.changes, student_number: "99999" },
    { ...editBody.changes, password: "secret" },
    { ...editBody.changes, program: "OTHER" },
    { ...editBody.changes, year_level: 4 },
    { ...editBody.changes, membership_status: "removed" },
    { ...editBody.changes, status: "active" },
    { ...editBody.changes, first_name: "  " },
    { ...editBody.changes, first_name: "Jane\nAdmin" },
    { ...editBody.changes, last_name: "X".repeat(101) },
  ]) {
    const state = fixture();
    const result = await call(loadHandler(BOARD_FUNCTION, state), { ...editBody, changes });
    assert.equal(result.status, 400);
    assert.equal(state.updates.length, 0);
  }
  const state = fixture();
  const result = await call(loadHandler(BOARD_FUNCTION, state), { ...editBody, organization_id: 8 });
  assert.equal(result.status, 400);
  assert.equal(state.updates.length, 0);
});

test("Student registry offers remove and restore only for manual-scope memberships", () => {
  assert.match(ADMIN_AUTH, /organization_type,\s*membership_scope/);
  assert.match(STUDENTS_PAGE, /data\?\.organizations\?\.membership_scope/);
  assert.match(STUDENTS_PAGE, /canManageManualMembership = membershipScope === "manual"/);
  assert.match(STUDENTS_PAGE, /canManageManualMembership \? \([\s\S]*?handleRestoreMembership/);
  assert.match(STUDENTS_PAGE, /canManageManualMembership \? \([\s\S]*?handleRemoveMembership/);
  assert.match(STUDENTS_PAGE, /isRemoved && !canManageParticipation\) return null/);
  assert.match(STUDENTS_PAGE, /Managed by term eligibility/);
});

test("Current member count includes pending and disabled accounts, but excludes removed and historical participation", async () => {
  const state = fixture();
  state.userId = "student-auth";
  state.students[0].status = "active";
  state.students.push({ id: 2, status: "pending" }, { id: 3, status: "disabled" }, { id: 4, status: "active" });
  state.participations.push(
    { student_id: 2, organization_id: 7, academic_term_id: 5, status: "active" },
    { student_id: 2, organization_id: 7, academic_term_id: 5, status: "active" },
    { student_id: 3, organization_id: 7, academic_term_id: 5, status: "active" },
    { student_id: 4, organization_id: 7, academic_term_id: 5, status: "removed" },
    { student_id: 4, organization_id: 7, academic_term_id: 4, status: "active" },
  );
  state.enrollments.push(
    { student_id: 2, academic_term_id: 5, enrollment_status: "enrolled" },
    { student_id: 3, academic_term_id: 5, enrollment_status: "enrolled" },
    { student_id: 4, academic_term_id: 5, enrollment_status: "enrolled" },
  );
  const result = await call(loadHandler(ELIGIBILITY_FUNCTION, state), {
    action: "current_organization_member_count",
    organization_id: 7,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.count, 3);
});

test("Current member count requires an active Student or Super Admin session", async () => {
  const state = fixture();
  const handler = loadHandler(ELIGIBILITY_FUNCTION, state);
  const body = { action: "current_organization_member_count", organization_id: 7 };
  assert.equal((await call(handler, body, false)).status, 401);
  assert.equal((await call(handler, body)).status, 403);
  state.userId = "student-auth";
  state.students[0].status = "pending";
  assert.equal((await call(handler, body)).status, 403);
});

test("Board list, Student count, and Super Admin count/roster share active-term membership semantics", async () => {
  const base = fixture();
  base.students = Array.from({ length: 21 }, (_, index) => ({
    id: index + 1,
    auth_user_id: index === 0 ? "student-auth" : null,
    status: "active",
  }));
  base.participations = [
    ...Array.from({ length: 14 }, (_, index) => ({
      student_id: index + 1,
      organization_id: 7,
      academic_term_id: 5,
      status: "active",
    })),
    ...Array.from({ length: 7 }, (_, index) => ({
      student_id: index + 15,
      organization_id: 7,
      academic_term_id: 5,
      status: "removed",
    })),
  ];
  base.enrollments = Array.from({ length: 21 }, (_, index) => ({
    student_id: index + 1,
    academic_term_id: 5,
    enrollment_status: "enrolled",
  }));
  const structuralLinks = Array.from({ length: 21 }, (_, index) => ({ student_id: index + 1, organization_id: 7 }));

  const boardState = structuredClone(base);
  boardState.userId = "board-auth";
  const boardResult = await call(loadHandler(BOARD_FUNCTION, boardState), {
    action: "list_students",
    page: 1,
    page_size: 100,
  });

  const studentState = structuredClone(base);
  studentState.userId = "student-auth";
  const studentResult = await call(loadHandler(ELIGIBILITY_FUNCTION, studentState), {
    action: "current_organization_member_count",
    organization_id: 7,
  });

  const superAdminState = structuredClone(base);
  superAdminState.userId = "super-admin-auth";
  superAdminState.profiles.push({ id: 10, auth_user_id: "super-admin-auth", role: "super_admin", status: "active" });
  const superAdminResult = await call(loadHandler(ELIGIBILITY_FUNCTION, superAdminState), {
    action: "current_organization_member_count",
    organization_id: 7,
    include_member_ids: true,
  });

  assert.equal(structuralLinks.length, 21);
  assert.equal(boardResult.status, 200);
  assert.equal(boardResult.body.data.count, 14);
  assert.equal(studentResult.status, 200);
  assert.equal(studentResult.body.data.count, 14);
  assert.equal("member_student_ids" in studentResult.body.data, false);
  assert.equal(superAdminResult.status, 200);
  assert.equal(superAdminResult.body.data.count, 14);
  assert.deepEqual(superAdminResult.body.data.member_student_ids, Array.from({ length: 14 }, (_, index) => index + 1));
  assert.equal(boardState.students.length, 21);
  assert.equal(studentState.students.length, 21);
  assert.equal(superAdminState.students.length, 21);
  assert.equal(superAdminState.updates.length, 0);
});

test("non-departmental Board roster omits departmental affiliation data", async () => {
  const state = fixture();
  state.organizations[0].organization_type = "non_departmental";
  state.organizations.push(
    { id: 8, name: "PSITS", organization_type: "departmental" },
    { id: 9, name: "JEHMS", organization_type: "departmental" },
    { id: 10, name: "Another Association", organization_type: "non_departmental" },
  );
  state.students.push({ id: 2, auth_user_id: null, status: "active", first_name: "Outside", last_name: "Student" });
  state.enrollments.push({ student_id: 2, academic_term_id: 5, enrollment_status: "enrolled" });
  state.participations.push(
    { student_id: 1, organization_id: 8, academic_term_id: 5, status: "active" },
    { student_id: 1, organization_id: 9, academic_term_id: 5, status: "active" },
    { student_id: 1, organization_id: 8, academic_term_id: 4, status: "active" },
    { student_id: 1, organization_id: 9, academic_term_id: 5, status: "removed" },
    { student_id: 1, organization_id: 10, academic_term_id: 5, status: "active" },
    { student_id: 2, organization_id: 8, academic_term_id: 5, status: "active" },
  );

  const result = await call(loadHandler(BOARD_FUNCTION, state), { action: "list_students", page: 1, page_size: 10 });

  assert.equal(result.status, 200);
  assert.equal(result.body.data.organization_type, "non_departmental");
  assert.deepEqual(result.body.data.students.map((student) => student.id), [1]);
  assert.equal("current_departmental_memberships" in result.body.data.students[0], false);
  assert.equal(state.tableReads.filter((table) => table === "student_organization_terms").length, 1);
  assert.equal(state.tableReads.includes("student_organizations"), false);
});

test("current-term membership roster is available only to an active Super Admin", async () => {
  const body = { action: "current_organization_member_count", organization_id: 7, include_member_ids: true };
  const boardState = fixture();
  assert.equal((await call(loadHandler(ELIGIBILITY_FUNCTION, boardState), body)).status, 403);

  const studentState = fixture();
  studentState.userId = "student-auth";
  const result = await call(loadHandler(ELIGIBILITY_FUNCTION, studentState), body);
  assert.equal(result.status, 200);
  assert.equal("member_student_ids" in result.body.data, false);

  const inactiveAdminState = fixture();
  inactiveAdminState.userId = "super-admin-auth";
  inactiveAdminState.profiles.push({ id: 10, auth_user_id: "super-admin-auth", role: "super_admin", status: "inactive" });
  assert.equal((await call(loadHandler(ELIGIBILITY_FUNCTION, inactiveAdminState), body)).status, 403);
});

test("canonical current-membership reader uses resolver, active participation, and same-term enrollment only", () => {
  const source = readFileSync(ELIGIBILITY_FUNCTION, "utf8");
  const reader = source.match(/async function loadCanonicalMembershipRows\([\s\S]*?\n}\n\nasync function requireAdmin/)?.[0];
  assert.ok(reader);
  assert.match(reader, /from\("student_organization_terms"\)[\s\S]*?\.eq\("status", "active"\)/);
  assert.match(reader, /from\("student_term_enrollments"\)[\s\S]*?\.eq\("enrollment_status", "enrolled"\)/);
  assert.match(reader, /resolve_student_organization_participation/);
  assert.doesNotMatch(reader, /from\("student_organizations"\)|from\("organization_programs"\)|from\("programs"\)|student\.program/);
  assert.match(source, /handleCurrentOrganizationMemberCount[\s\S]*?loadCanonicalMembershipRows\(adminClient, activeTerm, \{ organizationId \}\)/);
  assert.match(source, /handleCurrentOrganizationMembers[\s\S]*?loadCanonicalMembershipRows\(adminClient, activeTerm, \{ organizationId \}\)/);
});

test("student current-membership action excludes structural-only, removed, old-term, and non-enrolled rows", async () => {
  const state = fixture();
  state.userId = "student-auth";
  state.structuralLinks = [{ student_id: 1, organization_id: 8 }];
  const handler = loadHandler(ELIGIBILITY_FUNCTION, state);
  const request = { action: "student_organization_ids" };

  const active = await call(handler, request);
  assert.equal(active.status, 200);
  assert.deepEqual(active.body.data.organization_ids, [7]);
  assert.equal(active.body.data.memberships[0].program, null);
  assert.equal(state.tableReads.includes("student_organizations"), false);

  state.students[0].program = "CHANGED PROFILE VALUE";
  state.enrollments[0].program = "OFFICIAL TERM PROGRAM";
  const changedProfile = await call(handler, request);
  assert.deepEqual(changedProfile.body.data.organization_ids, [7]);
  assert.equal(changedProfile.body.data.memberships[0].program, "OFFICIAL TERM PROGRAM");

  state.participations[0].status = "removed";
  assert.deepEqual((await call(handler, request)).body.data.organization_ids, []);
  state.participations[0].status = "active";
  state.participations[0].academic_term_id = 4;
  assert.deepEqual((await call(handler, request)).body.data.organization_ids, []);
  state.participations[0].academic_term_id = 5;
  state.enrollments[0].enrollment_status = "not_enrolled";
  assert.deepEqual((await call(handler, request)).body.data.organization_ids, []);
  state.enrollments[0].enrollment_status = "enrolled";
  state.organizations[0].membership_scope = "unknown";
  assert.deepEqual((await call(handler, request)).body.data.organization_ids, []);
});

test("manual and institution scope memberships use active same-term participation", async () => {
  const state = fixture();
  state.userId = "student-auth";
  state.organizations.push(
    { id: 8, name: "Association", organization_type: "non_departmental", membership_scope: "manual" },
    { id: 9, name: "Institution", organization_type: "non_departmental", membership_scope: "institution" },
  );
  state.participations.push(
    { student_id: 1, organization_id: 8, academic_term_id: 5, status: "active" },
    { student_id: 1, organization_id: 9, academic_term_id: 5, status: "active" },
  );
  const result = await call(loadHandler(ELIGIBILITY_FUNCTION, state), { action: "student_organization_ids" });
  assert.deepEqual(result.body.data.organization_ids, [7, 8, 9]);
  assert.deepEqual(result.body.data.memberships.map((membership) => membership.organization.membership_scope), ["program", "manual", "institution"]);
  assert.equal(state.tableReads.includes("student_organizations"), false);
});

test("Student self-membership is derived from the authenticated identity, not supplied identifiers", async () => {
  const state = fixture();
  state.userId = "student-auth";
  state.students.push({ id: 2, auth_user_id: "another-student-auth", student_number: "S2", password: "other", status: "active" });
  state.enrollments.push({ student_id: 2, academic_term_id: 5, enrollment_status: "enrolled" });
  state.participations.push({ student_id: 2, organization_id: 8, academic_term_id: 5, status: "active" });
  state.organizations.push({ id: 8, name: "Another Organization", organization_type: "non_departmental", membership_scope: "manual" });
  const handler = loadHandler(ELIGIBILITY_FUNCTION, state);

  const result = await call(handler, {
    action: "student_organization_ids",
    student_id: 2,
    student_number: "S2",
    password: "other",
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.organization_ids, [7]);
  assert.deepEqual(result.body.data.memberships.map((membership) => membership.student_id), [1]);
  assert.equal(state.tableReads.includes("student_organizations"), false);
});

test("Student self-membership fails closed for missing, invalid, inactive, or ambiguous identity", async () => {
  const unauthenticated = fixture();
  unauthenticated.userId = "student-auth";
  const unauthenticatedHandler = loadHandler(ELIGIBILITY_FUNCTION, unauthenticated);
  assert.equal((await call(unauthenticatedHandler, { action: "student_organization_ids" }, false)).status, 401);

  const invalidSession = fixture();
  invalidSession.userId = null;
  assert.equal((await call(loadHandler(ELIGIBILITY_FUNCTION, invalidSession), { action: "student_organization_ids" })).status, 401);

  const noMapping = fixture();
  noMapping.userId = "unmapped-auth";
  assert.equal((await call(loadHandler(ELIGIBILITY_FUNCTION, noMapping), { action: "student_organization_ids" })).status, 403);

  const inactive = fixture();
  inactive.userId = "student-auth";
  inactive.students[0].status = "disabled";
  assert.equal((await call(loadHandler(ELIGIBILITY_FUNCTION, inactive), { action: "student_organization_ids" })).status, 403);

  const ambiguous = fixture();
  ambiguous.userId = "student-auth";
  ambiguous.students.push({ id: 2, auth_user_id: "student-auth", student_number: "S2", status: "active" });
  assert.equal((await call(loadHandler(ELIGIBILITY_FUNCTION, ambiguous), { action: "student_organization_ids" })).status, 403);
});

test("authenticated Student with no current memberships receives a successful empty result", async () => {
  const state = fixture();
  state.userId = "student-auth";
  state.participations = [];
  const result = await call(loadHandler(ELIGIBILITY_FUNCTION, state), { action: "student_organization_ids" });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.organization_ids, []);
  assert.deepEqual(result.body.data.memberships, []);
  assert.equal(result.body.data.academic_term.id, 5);
});

test("Student membership action ignores profile program and does not require a structural projection", async () => {
  const state = fixture();
  state.userId = "student-auth";
  state.students[0].program = "PROFILE PROGRAM DIFFERENT FROM TERM";
  state.enrollments[0].program = "OFFICIAL TERM PROGRAM";
  state.structuralLinks = [];
  const result = await call(loadHandler(ELIGIBILITY_FUNCTION, state), { action: "student_organization_ids" });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.organization_ids, [7]);
  assert.equal(result.body.data.memberships[0].program, "OFFICIAL TERM PROGRAM");
  assert.equal(state.tableReads.includes("student_organizations"), false);
});

test("current organization roster and count agree without structural membership rows", async () => {
  const state = fixture();
  state.userId = "board-auth";
  state.participations.push(
    { student_id: 1, organization_id: 7, academic_term_id: 4, status: "active" },
    { student_id: 1, organization_id: 7, academic_term_id: 5, status: "removed" },
  );
  const handler = loadHandler(ELIGIBILITY_FUNCTION, state);
  const roster = await call(handler, { action: "current_organization_members", organization_id: 7 });
  assert.equal(roster.status, 200);
  assert.equal(roster.body.data.count, 1);
  assert.equal(roster.body.data.members[0].student.id, 1);
  assert.equal(roster.body.data.members[0].program, null);
  assert.equal(state.tableReads.includes("student_organizations"), false);
  assert.equal((await call(handler, { action: "current_organization_members", organization_id: 8 })).status, 403);

  state.userId = "student-auth";
  const count = await call(handler, { action: "current_organization_member_count", organization_id: 7 });
  assert.equal(count.body.data.count, roster.body.data.count);
});

test("Super Admin can load selected students' canonical current affiliations only", async () => {
  const state = fixture();
  state.userId = "super-admin-auth";
  state.profiles.push({ id: 10, auth_user_id: "super-admin-auth", role: "super_admin", status: "active" });
  const handler = loadHandler(ELIGIBILITY_FUNCTION, state);
  const result = await call(handler, { action: "current_memberships_for_students", student_ids: [1] });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.memberships.length, 1);
  assert.equal(result.body.data.memberships[0].student_id, 1);

  state.userId = "board-auth";
  assert.equal((await call(handler, { action: "current_memberships_for_students", student_ids: [1] })).status, 403);
});

test("current membership count is generic across organizations and does not carry removals into a new term", async () => {
  const state = fixture();
  state.userId = "student-auth";
  state.students.push(
    { id: 2, status: "active", first_name: "Sam", last_name: "Student" },
    { id: 3, status: "active", first_name: "Alex", last_name: "Student" },
  );
  state.organizations.push({ id: 8, name: "Association", organization_type: "non_departmental", membership_scope: "manual" });
  state.participations.push(
    { student_id: 2, organization_id: 8, academic_term_id: 5, status: "active" },
    { student_id: 3, organization_id: 8, academic_term_id: 5, status: "active" },
    { student_id: 1, organization_id: 8, academic_term_id: 5, status: "removed" },
  );
  state.enrollments.push(
    { student_id: 2, academic_term_id: 5, enrollment_status: "enrolled" },
    { student_id: 3, academic_term_id: 5, enrollment_status: "enrolled" },
  );
  const handler = loadHandler(ELIGIBILITY_FUNCTION, state);
  const otherOrganization = await call(handler, {
    action: "current_organization_member_count",
    organization_id: 8,
  });
  assert.equal(otherOrganization.body.data.count, 2);

  state.terms.push({ id: 6, status: "active", academic_year: "2026-2027", semester: "2nd Semester", created_at: "later" });
  state.terms[0].status = "closed";
  const nextTerm = await call(handler, {
    action: "current_organization_member_count",
    organization_id: 7,
  });
  assert.equal(nextTerm.body.data.count, 0);
  assert.equal(state.participations.filter((row) => row.academic_term_id === 5 && row.organization_id === 7).length, 1);

  state.participations = [];
  const empty = await call(handler, {
    action: "current_organization_member_count",
    organization_id: 8,
  });
  assert.equal(empty.body.data.count, 0);
});

test("appointed student eligibility stays organization/term scoped and resolves in bounded parallel batches", async () => {
  const state = fixture();
  for (let id = 2; id <= 18; id += 1) {
    state.students.push({ id, student_number: `S${id}`, first_name: `Student ${id}`, last_name: "Test", status: "active" });
    state.enrollments.push({ student_id: id, academic_term_id: 5, enrollment_status: "enrolled" });
    state.participations.push({
      student_id: id,
      organization_id: 7,
      academic_term_id: 5,
      status: id === 4 ? "removed" : "active",
    });
  }
  state.enrollments.push({ student_id: 99, academic_term_id: 5, enrollment_status: "enrolled" });
  state.participations.push({ student_id: 99, organization_id: 8, academic_term_id: 5, status: "active" });

  const result = await call(loadHandler(ELIGIBILITY_FUNCTION, state), {
    action: "eligible_students_for_organization",
    organization_id: 7,
  });

  assert.equal(result.status, 200);
  const ids = result.body.data.students.map((student) => student.id);
  assert.equal(ids.includes(4), false);
  assert.equal(ids.includes(99), false);
  assert.equal(ids.includes(1), true);
  assert.ok(ids.length > 8);
  assert.ok(state.maxParticipationCalls > 1);
  assert.ok(state.maxParticipationCalls <= 8);
});

test("appointed student eligibility fails visibly when the trusted resolver errors", async () => {
  const state = fixture();
  state.failParticipationResolution = true;
  const result = await call(loadHandler(ELIGIBILITY_FUNCTION, state), {
    action: "eligible_students_for_organization",
    organization_id: 7,
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "Unable to verify student eligibility.");
  assert.equal(JSON.stringify(result.body).includes("internal resolver details"), false);
});
