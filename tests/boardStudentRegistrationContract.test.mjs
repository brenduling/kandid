import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as membershipAdmission from "../supabase/functions/_shared/membershipAdmission.js";
import {
  handleCorsPreflight,
  rejectDisallowedOrigin,
  withKandidCors,
} from "../supabase/functions/_shared/kandidProductionSecurity.mjs";

const source = readFileSync("supabase/functions/board-manual-enrollment/index.ts", "utf8");

function fixture() {
  return {
    userId: "board-auth",
    profiles: [{ id: 9, auth_user_id: "board-auth", full_name: "Board Tester", role: "electoral_board", status: "active", organization_id: 7 }],
    terms: [{ id: 5, status: "active", academic_year: "2026-2027", semester: "1st Semester" }],
    students: [{ id: 1, student_number: "62035", first_name: "Jane", last_name: "Ben", email: "school@example.test", program: "BSIT", year_level: 2, status: "active", auth_user_id: "student-auth" }],
    enrollments: [{ student_id: 1, academic_term_id: 5, program: "BSIT", year_level: 2, enrollment_status: "enrolled" }],
    participations: [],
    memberships: [],
    organizations: [{ id: 7, name: "PSITS", organization_type: "non_departmental", membership_scope: "manual" }],
    programs: [{ id: 3, code: "BSIT", name: "BSIT" }],
    programLinks: [{ organization_id: 7, program_id: 3 }],
    audits: [],
    calls: [],
    lastBoardOrganizationId: null,
    programWrites: 0,
    raceEnroll: false,
    participationRaceReason: null,
    participationRaceStudentIds: [],
    failedRegistrationStudentNumbers: [],
  };
}

function query(table, state) {
  const tables = {
    admin_users: state.profiles,
    academic_terms: state.terms,
    students: state.students,
    student_term_enrollments: state.enrollments,
    student_organization_terms: state.participations,
    student_organizations: state.memberships,
    organizations: state.organizations,
    programs: state.programs,
    organization_programs: state.programLinks,
  };
  const rows = tables[table] || [];
  const filters = {};
  const inFilters = {};
  let maximum = Infinity;
  let upserted = null;
  const current = () => rows.filter((row) =>
    Object.entries(filters).every(([key, value]) => row[key] === value) &&
    Object.entries(inFilters).every(([key, values]) => values.includes(row[key])),
  ).slice(0, maximum);
  const result = () => ({ data: upserted || current(), error: null });
  const q = {
    select() { return q; },
    eq(key, value) { filters[key] = value; return q; },
    in(key, values) { inFilters[key] = values; return q; },
    limit(value) { maximum = value; return q; },
    order() { return q; },
    async maybeSingle() { return { data: (upserted || current())[0] || null, error: null }; },
    async single() { return { data: (upserted || current())[0] || null, error: null }; },
    upsert(values) {
      if (table === "programs") state.programWrites += 1;
      const entries = Array.isArray(values) ? values : [values];
      for (const entry of entries) {
        const existing = rows.find((row) => table === "programs"
          ? row.code === entry.code
          : row.student_id === entry.student_id && row.organization_id === entry.organization_id);
        if (!existing) rows.push(table === "programs" ? { ...entry, id: rows.length + 3 } : { ...entry });
      }
      upserted = entries.map((entry) => rows.find((row) => table === "programs"
        ? row.code === entry.code
        : row.student_id === entry.student_id && row.organization_id === entry.organization_id));
      return q;
    },
    async insert(values) {
      if (table === "audit_logs" && state.failAudit) return { error: new Error("audit write unavailable") };
      if (table === "audit_logs") state.audits.push(values);
      return { error: null };
    },
    then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
  };
  return q;
}

function loadHandler(state) {
  let handler;
  const compiled = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
  const adminClient = {
    from: (table) => query(table, state),
    async rpc(name, args) {
      state.calls.push(name);
      if (name === "kandid_check_student_organization_admission") {
        const organization = state.organizations.find((row) => row.id === args.p_organization_id);
        if (state.admissionReasonOverride) {
          return { data: [{ allowed: false, reason: state.admissionReasonOverride, target_organization_type: organization?.organization_type || null, academic_term_id: args.p_academic_term_id }], error: null };
        }
        const enrolled = state.enrollments.some((row) => row.student_id === args.p_student_id && row.academic_term_id === args.p_academic_term_id && row.enrollment_status === "enrolled");
        const existing = state.participations.find((row) => row.student_id === args.p_student_id && row.organization_id === args.p_organization_id && row.academic_term_id === args.p_academic_term_id);
        let allowed = enrolled && Boolean(organization);
        let reason = allowed ? "ALLOWED" : "NOT_CURRENTLY_ENROLLED";
        if (!organization) {
          allowed = false;
          reason = "ORGANIZATION_NOT_FOUND";
        } else if (allowed && existing?.status === "active") reason = "ALREADY_ACTIVE";
        else if (allowed && !["departmental", "non_departmental"].includes(organization.organization_type)) {
          allowed = false;
          reason = "UNSUPPORTED_ORGANIZATION_TYPE";
        } else if (allowed && organization.membership_scope !== "manual") {
          allowed = false;
          reason = organization.membership_scope ? "ACTIVATION_SYNC_REQUIRED" : "UNSUPPORTED_MEMBERSHIP_SCOPE";
        }
        return { data: [{ allowed, reason, target_organization_type: organization?.organization_type || null, academic_term_id: args.p_academic_term_id }], error: null };
      }
      if (name === "kandid_board_register_verified_student_for_term_v1") {
        if (state.failedRegistrationStudentNumbers.includes(args.p_student_number)) {
          return { data: null, error: { code: "23514", message: "test-only row validation failure" } };
        }
        const activeTermId = state.terms.find((row) => row.status === "active")?.id;
        state.lastBoardOrganizationId = args.p_board_organization_id;
        const actor = state.profiles.find((row) => row.id === args.p_actor_admin_id && row.status === "active" && row.role === "electoral_board");
        if (!actor || actor.organization_id !== args.p_board_organization_id) return { data: null, error: { message: "Active Electoral Board organization authorization required." } };
        if (args.p_evidence_reviewed !== true || !["school_id", "registration_form", "department_masterlist"].includes(args.p_verification_method)) {
          return { data: null, error: { message: "Enrollment evidence review required." } };
        }
        const organization = state.organizations.find((row) => row.id === actor.organization_id);
        const matchingPrograms = state.programs.filter((row) => row.code === args.p_program || row.name === args.p_program);
        if (matchingPrograms.length !== 1) return { data: null, error: { message: "Program is not a unique configured catalog entry." } };
        const selectedProgramId = matchingPrograms[0].id;
        if (organization?.membership_scope === "program" && !state.programLinks.some((row) => row.organization_id === actor.organization_id && row.program_id === selectedProgramId)) {
          return { data: null, error: { message: "Program is outside this Board organization coverage." } };
        }
        let student = state.students.find((row) => row.student_number === args.p_student_number);
        if (student && args.p_create_identity) return { data: null, error: { message: "IDENTITY_RECHECK_REQUIRED" } };
        if (!student && !args.p_create_identity) return { data: null, error: { message: "STUDENT_IDENTITY_NOT_FOUND" } };
        if (!student) {
          student = { id: state.students.length + 1, student_number: args.p_student_number, status: "pending" };
          state.students.push(student);
        }
        let enrollment = state.enrollments.find((row) => row.student_id === student.id && row.academic_term_id === activeTermId);
        if (enrollment && organization?.membership_scope === "program") {
          const currentProgram = state.programs.find((row) => row.code === enrollment.program || row.name === enrollment.program);
          if (!currentProgram || !state.programLinks.some((row) => row.organization_id === actor.organization_id && row.program_id === currentProgram.id)) {
            return { data: null, error: { message: "Program is outside this Board organization coverage." } };
          }
        }
        Object.assign(student, {
          first_name: args.p_first_name,
          last_name: args.p_last_name,
          email: args.p_email || student.email || null,
          program: args.p_program,
          year_level: args.p_year_level,
        });
        const previousProgram = enrollment?.program || student.program;
        if (!enrollment) {
          enrollment = { student_id: student.id, academic_term_id: activeTermId };
          state.enrollments.push(enrollment);
        }
        Object.assign(enrollment, {
          program: args.p_program,
          year_level: args.p_year_level,
          enrollment_status: "enrolled",
          verification_method: args.p_verification_method,
          verified_by_admin_id: args.p_actor_admin_id,
          verified_at: "2026-10-15T12:00:00Z",
        });
        if (previousProgram && previousProgram !== args.p_program) {
          for (const prior of state.participations.filter((row) => row.student_id === student.id && row.academic_term_id === activeTermId && row.status === "active" && row.source === "system")) {
            const org = state.organizations.find((row) => row.id === prior.organization_id);
            const linked = state.programLinks.some((row) => row.organization_id === org?.id && row.program_id === selectedProgramId);
            if (org?.membership_scope === "program" && !linked) {
              prior.status = "removed";
              prior.removal_reason = "program_change_reconciliation";
              prior.removed_by = args.p_actor_admin_id;
            }
          }
        }
        const organizationIds = state.organizations.filter((row) => row.membership_scope === "institution" ||
          (row.membership_scope === "program" && state.programLinks.some((link) => link.organization_id === row.id && link.program_id === selectedProgramId)))
          .map((row) => row.id);
        if (organization?.membership_scope === "manual") organizationIds.push(organization.id);
        for (const organizationId of new Set(organizationIds)) {
          let participation = state.participations.find((row) => row.student_id === student.id && row.organization_id === organizationId && row.academic_term_id === activeTermId);
          if (!participation) {
            participation = { student_id: student.id, organization_id: organizationId, academic_term_id: activeTermId, status: "active", source: organizationId === organization.id && organization.membership_scope === "manual" ? "manual" : "system" };
            state.participations.push(participation);
          }
          if (participation.status === "active" && !state.memberships.some((row) => row.student_id === student.id && row.organization_id === organizationId)) {
            state.memberships.push({ student_id: student.id, organization_id: organizationId, role: "member" });
          }
        }
        state.audits.push({ event_type: "student_enrollment_verified", user_id: args.p_actor_admin_id, verification_method: args.p_verification_method, academic_term_id: activeTermId });
        return { data: { outcome: args.p_create_identity ? "NEW_STUDENT_CREATED" : "EXISTING_STUDENT_ENROLLED", student_id: student.id, student_status: student.status, academic_term_id: activeTermId, organization_outcome: "REGISTERED", verification_method: args.p_verification_method, verified_by_admin_id: args.p_actor_admin_id }, error: null };
      }
      if (name === "kandid_ensure_program_catalog_entry_for_server_actor") {
        assert.equal(args.p_actor_admin_id, 9);
        const code = String(args.p_code).trim().toUpperCase();
        let program = state.programs.find((row) => row.code === code);
        if (!program) {
          program = { id: state.programs.length + 3, code, name: code };
          state.programs.push(program);
          state.audits.push({ event_type: "program_catalog_entry_created", user_id: args.p_actor_admin_id, entity_id: String(program.id) });
        }
        return { data: [program], error: null };
      }
      if (name === "create_manual_student_for_term_v1") {
        const id = state.students.length + 1;
        state.students.push({ id, student_number: args.p_student_number, first_name: args.p_first_name, last_name: args.p_last_name, email: args.p_email, program: args.p_program, year_level: args.p_year_level, status: "pending" });
        state.enrollments.push({ student_id: id, academic_term_id: args.p_academic_term_id, program: args.p_program, year_level: args.p_year_level, enrollment_status: "enrolled" });
        return { data: { outcome: "NEW_STUDENT_CREATED", student_id: id, student_status: "pending" }, error: null };
      }
      if (name === "enroll_existing_student_for_term_v1") {
        let enrollment = state.enrollments.find((row) => row.student_id === args.p_student_id && row.academic_term_id === args.p_academic_term_id);
        if (state.raceEnroll && !enrollment) {
          enrollment = { student_id: args.p_student_id, academic_term_id: args.p_academic_term_id, program: args.p_program, year_level: args.p_year_level, enrollment_status: "enrolled" };
          state.enrollments.push(enrollment);
        }
        if (enrollment?.enrollment_status === "enrolled") return { data: { outcome: "ALREADY_ENROLLED_CURRENT_TERM", student_id: args.p_student_id }, error: null };
        const outcome = enrollment ? "EXISTING_STUDENT_TERM_RESTORED" : "EXISTING_STUDENT_ENROLLED";
        if (enrollment) enrollment.enrollment_status = "enrolled";
        else state.enrollments.push({ student_id: args.p_student_id, academic_term_id: args.p_academic_term_id, program: args.p_program, year_level: args.p_year_level, enrollment_status: "enrolled" });
        return { data: { outcome, student_id: args.p_student_id, student_status: "active" }, error: null };
      }
      if (name === "manual_enroll_student") {
        let student = state.students.find((row) => row.student_number === args.p_student_number);
        if (!student) {
          student = { id: state.students.length + 1, student_number: args.p_student_number, first_name: args.p_first_name, last_name: args.p_last_name, email: args.p_email, program: args.p_program, year_level: args.p_year_level, status: "active" };
          state.students.push(student);
        }
        if (!state.enrollments.some((row) => row.student_id === student.id && row.academic_term_id === args.p_academic_term_id)) {
          state.enrollments.push({ student_id: student.id, academic_term_id: args.p_academic_term_id, program: args.p_program, year_level: args.p_year_level, enrollment_status: "enrolled" });
        }
        return { data: { outcome: "EXISTING_STUDENT_ENROLLED", student_id: student.id }, error: null };
      }
      if (name === "ensure_student_organization_term_participation") {
        if (state.participationRaceReason &&
          (state.participationRaceStudentIds.length === 0 || state.participationRaceStudentIds.includes(args.target_student_id))) {
          return { data: null, error: { message: `MEMBERSHIP_ADMISSION_DENIED:${state.participationRaceReason}`, code: "23514" } };
        }
        const existing = state.participations.find((row) => row.student_id === args.target_student_id && row.organization_id === args.target_organization_id && row.academic_term_id === args.target_academic_term_id);
        if (existing) return { data: { status: existing.status, created: false }, error: null };
        const enrolled = state.enrollments.some((row) => row.student_id === args.target_student_id && row.academic_term_id === args.target_academic_term_id && row.enrollment_status === "enrolled");
        if (!enrolled) return { data: { status: "denied", created: false }, error: null };
        state.participations.push({ student_id: args.target_student_id, organization_id: args.target_organization_id, academic_term_id: args.target_academic_term_id, status: "active" });
        return { data: { status: "active", created: true }, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  vm.runInNewContext(compiled, {
    require: (specifier) => specifier.includes("membershipAdmission")
      ? membershipAdmission
      : specifier.includes("kandidProductionSecurity")
      ? {
        handleCorsPreflight,
        rejectDisallowedOrigin,
        serveWithKandidCors: (handlerFn) => {
          handler = async (request) => withKandidCors(request, await handlerFn(request));
        },
      }
      : ({ createClient: (_url, key) => key === "anon"
      ? { auth: { getUser: async () => ({ data: { user: { id: state.userId } }, error: null }) } }
      : adminClient }),
    module: { exports: {} }, exports: {},
    Deno: { env: { get: (key) => ({ SUPABASE_URL: "url", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" })[key] }, serve: (value) => { handler = value; } },
    Request, Response, console,
  });
  return handler;
}

async function call(state, body, authenticated = true) {
  const response = await loadHandler(state)(new Request("https://example.test", {
    method: "POST",
    headers: authenticated ? { Authorization: "Bearer test" } : {},
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

const enrollmentRequest = (action, verification = {}) => ({
  action,
  verification_method: verification.method || "school_id",
  evidence_reviewed: verification.reviewed ?? true,
  student: {
    student_number: "62035",
    first_name: "Jane",
    last_name: "Ben",
    email: "school@example.test",
    program: "BSIT",
    year_level: 2,
  },
});

test("lookup remains read-only and does not establish enrollment evidence", async () => {
  const state = fixture();
  const before = structuredClone({ students: state.students, enrollments: state.enrollments, participations: state.participations });
  const result = await call(state, { action: "resolve_student_for_term", student_number: "99999" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.outcome, "STUDENT_IDENTITY_NOT_FOUND");
  assert.deepEqual({ students: state.students, enrollments: state.enrollments, participations: state.participations }, before);
});

test("evidence confirmation is required before any registration RPC runs", async () => {
  const state = fixture();
  const result = await call(state, enrollmentRequest("create_new_student_for_term", { reviewed: false }));
  assert.equal(result.status, 400);
  assert.equal(result.body.data.outcome, "ENROLLMENT_EVIDENCE_REVIEW_REQUIRED");
  assert.equal(state.calls.includes("kandid_board_register_verified_student_for_term_v1"), false);
  assert.equal(state.students.length, 1);
  assert.equal(state.enrollments.length, 1);
  assert.equal(state.participations.length, 0);
});

test("manual Board registration creates identity, verified active-term enrollment, and scoped participation", async () => {
  const state = fixture();
  const requestBody = enrollmentRequest("create_new_student_for_term", { method: "registration_form" });
  requestBody.student.student_number = "71123";
  const result = await call(state, requestBody);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.outcome, "NEW_STUDENT_CREATED");
  assert.equal(state.students.length, 2);
  assert.equal(state.enrollments.at(-1).verification_method, "registration_form");
  assert.equal(state.enrollments.at(-1).verified_by_admin_id, 9);
  assert.ok(state.enrollments.at(-1).verified_at);
  assert.equal(state.enrollments.at(-1).academic_term_id, 5);
  assert.ok(state.participations.some((row) => row.student_id === 2 && row.organization_id === 7 && row.status === "active"));
  assert.ok(state.audits.some((row) => row.event_type === "student_enrollment_verified"));
});

test("current-term correction preserves earlier term enrollment history", async () => {
  const state = fixture();
  state.enrollments.push({ student_id: 1, academic_term_id: 4, program: "BSIT", year_level: 1, enrollment_status: "enrolled" });
  const requestBody = enrollmentRequest("enroll_existing_student_for_term", { method: "school_id" });
  requestBody.student.first_name = "Janet";
  const result = await call(state, requestBody);
  assert.equal(result.status, 200);
  assert.equal(state.students[0].first_name, "Janet");
  assert.deepEqual(state.enrollments.find((row) => row.academic_term_id === 4), {
    student_id: 1, academic_term_id: 4, program: "BSIT", year_level: 1, enrollment_status: "enrolled",
  });
  assert.equal(state.enrollments.find((row) => row.academic_term_id === 5).verified_by_admin_id, 9);
  assert.ok(state.audits.some((row) => row.event_type === "student_enrollment_verified"));
});

test("organization scope and program coverage are server-derived and enforced", async () => {
  const state = fixture();
  state.organizations[0].membership_scope = "program";
  state.organizations.push({ id: 8, name: "Foreign organization", organization_type: "departmental", membership_scope: "program" });
  state.programLinks = [{ organization_id: 8, program_id: 3 }];
  const body = enrollmentRequest("create_new_student_for_term");
  body.organization_id = 999;
  body.student.student_number = "71124";
  const result = await call(state, body);
  assert.equal(result.status, 403);
  assert.equal(result.body.data.outcome, "INELIGIBLE");
  assert.equal(state.lastBoardOrganizationId, 7);
  assert.equal(state.students.length, 1);
  assert.equal(state.enrollments.length, 1);
  assert.equal(state.participations.length, 0);
});

test("configured many-to-many program scope synchronizes every eligible organization idempotently", async () => {
  const state = fixture();
  state.organizations.push({ id: 8, name: "Another configured program organization", organization_type: "departmental", membership_scope: "program" });
  state.programLinks.push({ organization_id: 8, program_id: 3 });
  state.organizations[0].membership_scope = "program";
  const body = enrollmentRequest("create_new_student_for_term");
  body.student.student_number = "71125";
  const first = await call(state, body);
  const repeat = enrollmentRequest("enroll_existing_student_for_term");
  repeat.student.student_number = "71125";
  const second = await call(state, repeat);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(second.status, 200);
  assert.ok(state.participations.some((row) => row.student_id === 2 && row.organization_id === 7));
  assert.ok(state.participations.some((row) => row.student_id === 2 && row.organization_id === 8));
  assert.equal(state.participations.filter((row) => row.student_id === 1).length, 0);
  assert.equal(state.participations.filter((row) => row.student_id === 2 && row.academic_term_id === 5).length, 2);
});

test("program Board cannot change a current-term enrollment outside its configured coverage", async () => {
  const state = fixture();
  state.organizations[0].organization_type = "departmental";
  state.organizations[0].membership_scope = "program";
  state.programs.push({ id: 4, code: "BSHM", name: "BSHM" });
  state.students[0].program = "BSHM";
  state.enrollments[0].program = "BSHM";
  const requestBody = enrollmentRequest("enroll_existing_student_for_term");
  requestBody.student.program = "BSIT";
  const result = await call(state, requestBody);
  assert.equal(result.status, 403);
  assert.equal(result.body.data.outcome, "INELIGIBLE");
  assert.equal(state.students[0].program, "BSHM");
  assert.equal(state.enrollments[0].program, "BSHM");
  assert.equal(state.audits.length, 0);
});

test("verified program shift updates only the active term and reconciles automatic scope memberships", async () => {
  const state = fixture();
  state.organizations.push({ id: 8, name: "Old program organization", organization_type: "departmental", membership_scope: "program" });
  state.programs.push({ id: 4, code: "BSCS", name: "Computer Science" });
  state.programLinks = [{ organization_id: 7, program_id: 4 }, { organization_id: 8, program_id: 3 }];
  state.organizations[0].organization_type = "departmental";
  state.organizations[0].membership_scope = "institution";
  state.enrollments[0].program = "BSIT";
  state.participations.push({ student_id: 1, organization_id: 8, academic_term_id: 5, status: "active", source: "system" });
  state.participations.push({ student_id: 1, organization_id: 8, academic_term_id: 4, status: "active", source: "system" });
  const requestBody = enrollmentRequest("enroll_existing_student_for_term");
  requestBody.student.program = "BSCS";
  const result = await call(state, requestBody);
  assert.equal(result.status, 200);
  assert.equal(state.enrollments.find((row) => row.academic_term_id === 5).program, "BSCS");
  assert.equal(state.participations.find((row) => row.organization_id === 8 && row.academic_term_id === 5).status, "removed");
  assert.equal(state.participations.find((row) => row.organization_id === 8 && row.academic_term_id === 4).status, "active");
  assert.ok(state.participations.some((row) => row.organization_id === 7 && row.academic_term_id === 5 && row.status === "active"));
});

test("anonymous, Student, and inactive Board sessions cannot register", async () => {
  const anonymous = fixture();
  const anonymousResult = await call(anonymous, enrollmentRequest("create_new_student_for_term"), false);
  assert.equal(anonymousResult.status, 401);
  assert.equal(anonymous.students.length, 1);

  const student = fixture();
  student.profiles[0].role = "student";
  const studentResult = await call(student, enrollmentRequest("create_new_student_for_term"));
  assert.equal(studentResult.status, 403);
  assert.equal(student.students.length, 1);

  const inactive = fixture();
  inactive.profiles[0].status = "disabled";
  const inactiveResult = await call(inactive, enrollmentRequest("create_new_student_for_term"));
  assert.equal(inactiveResult.status, 403);
  assert.equal(inactive.students.length, 1);
});

test("official department masterlist import requires explicit evidence review and records method per row", async () => {
  const state = fixture();
  const rows = [{ row_number: 2, student_number: "71126", first_name: "New", last_name: "Student", email: "new@example.test", program: "BSIT", year_level: 1 }];
  const denied = await call(state, { action: "confirm_board_csv_import", rows, evidence_reviewed: false });
  assert.equal(denied.status, 400);
  assert.equal(state.students.length, 1);
  const imported = await call(state, { action: "confirm_board_csv_import", rows, evidence_reviewed: true });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.data.summary.imported, 1);
  assert.equal(state.students.length, 2);
  assert.equal(state.enrollments.at(-1).verification_method, "department_masterlist");
  assert.equal(state.enrollments.at(-1).verified_by_admin_id, 9);
});

test("CSV import keeps successful rows and continues after a row-level registration failure", async () => {
  const state = fixture();
  state.failedRegistrationStudentNumbers = ["81227"];
  const rows = [
    { row_number: 2, student_number: "81226", first_name: "First", last_name: "Good", program: "BSIT", year_level: 1 },
    { row_number: 3, student_number: "81227", first_name: "Rejected", last_name: "Row", program: "BSIT", year_level: 1 },
    { row_number: 4, student_number: "81228", first_name: "Third", last_name: "Good", program: "BSIT", year_level: 1 },
  ];

  const result = await call(state, { action: "confirm_board_csv_import", rows, evidence_reviewed: true });

  assert.equal(result.status, 200);
  assert.equal(result.body.data.summary.imported, 2);
  assert.equal(result.body.data.summary.skipped, 1);
  assert.deepEqual(result.body.data.results.map((row) => row.status), ["imported", "not_imported", "imported"]);
  assert.equal(state.students.some((student) => student.student_number === "81226"), true);
  assert.equal(state.students.some((student) => student.student_number === "81227"), false);
  assert.equal(state.students.some((student) => student.student_number === "81228"), true);
});

test("official masterlist can correct a matched identity after Board review and confirmation", async () => {
  const state = fixture();
  const rows = [{ row_number: 2, student_number: "62035", first_name: "Janet", last_name: "Ben", email: "school@example.test", program: "BSIT", year_level: 2 }];
  const preview = await call(state, { action: "preview_board_csv_import", rows });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.data.results[0].status, "ready");
  assert.equal(preview.body.data.results[0].identity_correction, true);
  assert.equal(preview.body.data.results[0].official.first_name, "Jane");
  assert.equal(state.students[0].first_name, "Jane");

  const imported = await call(state, { action: "confirm_board_csv_import", rows, evidence_reviewed: true });
  assert.equal(imported.status, 200);
  assert.equal(state.students[0].first_name, "Janet");
  assert.equal(state.enrollments.find((row) => row.academic_term_id === 5).verification_method, "department_masterlist");
});

test("CSV summary counts each ready, imported, and existing row once", () => {
  const helper = source.match(/function summarizeBoardImportRows\(results: Array<Record<string, unknown>>\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, "the production CSV summary helper must remain available for contract testing");
  const context = {
    cleanText: (value, maxLength = 255) => String(value || "").trim().slice(0, maxLength),
  };
  const compiled = transformSync(helper, { loader: "ts", format: "cjs", target: "es2022" }).code;
  vm.runInNewContext(`${compiled}\nthis.summarizeBoardImportRows = summarizeBoardImportRows;`, context);
  const summary = JSON.parse(JSON.stringify(context.summarizeBoardImportRows([
    { status: "ready" },
    { status: "ready" },
    { status: "already_member" },
    { status: "imported" },
    { status: "program_mismatch" },
  ])));

  assert.deepEqual(summary, {
    total: 5,
    ready: 2,
    imported: 1,
    already_member: 1,
    previously_removed: 0,
    issues: 1,
    program_mismatch: 1,
  });
});

test("migration confines trusted writes, evidence values, and program fan-out to a service-role RPC", () => {
  const migration = readFileSync("supabase/migrations/20261021120000_board_verified_student_registration.sql", "utf8");
  assert.match(migration, /verification_method in \('school_id', 'registration_form', 'department_masterlist'\)/);
  assert.match(migration, /verified_by_admin_id integer references public\.admin_users\(id\)/);
  assert.match(migration, /verified_at timestamptz/);
  assert.match(migration, /p_actor_admin_id bigint[\s\S]*p_board_organization_id integer/);
  assert.match(migration, /a\.role = 'electoral_board' and a\.status = 'active'/);
  assert.match(migration, /a\.organization_id = board_org_id/);
  assert.match(migration, /board_actor_id = reconciliation_actor_id/);
  assert.match(migration, /ste\.verified_by_admin_id = board_actor_id and ste\.verified_at is not null/);
  assert.match(migration, /new\.source = 'system' and sync_term_setting = new\.academic_term_id::text/);
  assert.match(migration, /join/i);
  assert.match(migration, /organization_programs op/);
  assert.match(migration, /membership_scope = 'institution'/);
  assert.match(migration, /membership_scope = 'program'/);
  assert.match(migration, /has_current_enrollment and org_scope = 'program'[\s\S]*Program is outside this Board organization coverage/);
  assert.doesNotMatch(migration, /PSITS|CREDO|JEHMS|LAS/);
  assert.match(migration, /revoke all on function public\.kandid_board_register_verified_student_for_term_v1[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.kandid_board_register_verified_student_for_term_v1[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.kandid_board_register_verified_student_for_term_v1[^;]*to anon|grant execute on function public\.kandid_board_register_verified_student_for_term_v1[^;]*to authenticated/i);
});
