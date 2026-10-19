import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeMembershipAdmissionReason } from "../supabase/functions/_shared/membershipAdmission.js";

const migration = readFileSync(
  "supabase/migrations/20261003100000_nondepartmental_membership_admission.sql",
  "utf8",
);
const boardRegistrationMigration = readFileSync(
  "supabase/migrations/20261021120000_board_verified_student_registration.sql",
  "utf8",
);
const board = readFileSync("supabase/functions/board-manual-enrollment/index.ts", "utf8");
const superAdmin = readFileSync("supabase/functions/super-admin-manual-enrollment/index.ts", "utf8");
const masterlist = readFileSync("supabase/functions/super-admin-masterlist-import/index.ts", "utf8");
const masterlistScopeMigration = readFileSync(
  "supabase/migrations/20261018100000_masterlist_import_scope_and_safe_finalization.sql",
  "utf8",
);
const boardUi = readFileSync("src/pages/board/BoardStudentRegistration.jsx", "utf8");
const csvUi = readFileSync("src/pages/board/CSVImport.jsx", "utf8");
const admissionHelper = readFileSync("supabase/functions/_shared/membershipAdmission.js", "utf8");

test("shared trusted predicate uses the single active term and official enrollment", () => {
  assert.match(migration, /create or replace function public\.kandid_check_student_organization_admission\(/i);
  assert.match(migration, /from public\.academic_terms at[\s\S]*?where at\.status = 'active'[\s\S]*?active_term_count <> 1/i);
  assert.match(migration, /from public\.student_term_enrollments ste[\s\S]*?ste\.enrollment_status = 'enrolled'[\s\S]*?NOT_CURRENTLY_ENROLLED/i);
  assert.doesNotMatch(migration, /NO_ACTIVE_DEPARTMENTAL_MEMBERSHIP/);
  assert.match(migration, /PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION/);
  assert.match(migration, /organization_type_value = 'non_departmental'[\s\S]*?allowed := true;\s*reason := 'ALLOWED';\s*return next;\s*return;/i);
});

test("currently enrolled non-departmental students are admitted without departmental membership or target coverage", () => {
  const predicate = migration.slice(
    migration.indexOf("create or replace function public.kandid_check_student_organization_admission"),
    migration.indexOf("revoke all on function public.kandid_check_student_organization_admission"),
  );
  const nonDepartmentalBranch = predicate.slice(
    predicate.indexOf("if organization_type_value = 'non_departmental'"),
    predicate.indexOf("if organization_type_value = 'departmental'"),
  );
  assert.match(nonDepartmentalBranch, /allowed := true;\s*reason := 'ALLOWED';\s*return next;\s*return;/i);
  assert.doesNotMatch(nonDepartmentalBranch, /student_organization_terms|student_organizations|organization_programs|programs/i);
  assert.match(predicate, /organization_type_value = 'departmental'[\s\S]*?public\.organization_programs[\s\S]*?public\.programs/i);
  assert.match(predicate, /student_term_enrollments ste[\s\S]*?ste\.academic_term_id = active_term_id[\s\S]*?ste\.enrollment_status = 'enrolled'[\s\S]*?NOT_CURRENTLY_ENROLLED/i);
});

test("unknown, null, and malformed organization types fail closed before eligibility fallbacks", () => {
  const predicate = migration.slice(
    migration.indexOf("create or replace function public.kandid_check_student_organization_admission"),
    migration.indexOf("revoke all on function public.kandid_check_student_organization_admission"),
  );
  assert.match(predicate, /organization_type_value is distinct from 'departmental'[\s\S]*?organization_type_value is distinct from 'non_departmental'[\s\S]*?UNSUPPORTED_ORGANIZATION_TYPE/i);
  assert.match(predicate, /select o\.organization_type[\s\S]*?if not found[\s\S]*?ORGANIZATION_NOT_FOUND/i);

  const resolver = migration.slice(
    migration.indexOf("create or replace function public.resolve_student_organization_participation"),
    migration.lastIndexOf("revoke all on function public.resolve_student_organization_participation"),
  );
  const classificationCheck = resolver.indexOf("organization_type_value is distinct from 'departmental'");
  const structuralFallback = resolver.indexOf("from public.student_organizations so");
  const programFallback = resolver.indexOf("from public.organization_programs op");
  assert.ok(classificationCheck >= 0 && classificationCheck < structuralFallback);
  assert.ok(classificationCheck < programFallback);
  assert.match(resolver, /unsupported_organization_type/i);
});

test("all new active participation grants are restricted to the sole active term", () => {
  const predicate = migration.slice(
    migration.indexOf("create or replace function public.kandid_check_student_organization_admission"),
    migration.indexOf("revoke all on function public.kandid_check_student_organization_admission"),
  );
  assert.match(predicate, /active_term_count <> 1[\s\S]*?ACTIVE_TERM_UNAVAILABLE/i);
  assert.match(predicate, /p_academic_term_id <> active_term_id[\s\S]*?TERM_NOT_ACTIVE/i);
  assert.match(predicate, /academic_term_id := p_academic_term_id;[\s\S]*?if p_academic_term_id <> active_term_id[\s\S]*?TERM_NOT_ACTIVE/i);
  const ensure = migration.slice(
    migration.indexOf("create or replace function public.ensure_student_organization_term_participation"),
    migration.indexOf("revoke all on function public.ensure_student_organization_term_participation"),
  );
  assert.match(ensure, /kandid_check_student_organization_admission[\s\S]*?if not coalesce\(admission_row\.allowed, false\)[\s\S]*?insert into public\.student_organization_terms/i);
  assert.doesNotMatch(ensure, /target_is_active_term|insert into public\.student_organization_terms[\s\S]*?elsif not exists/i);
  const trigger = migration.slice(
    migration.indexOf("create or replace function public.guard_student_organization_term_admission"),
    migration.indexOf("revoke all on function public.guard_student_organization_term_admission"),
  );
  assert.match(trigger, /new\.status is distinct from 'active'[\s\S]*?old\.status = 'active'[\s\S]*?old\.academic_term_id = new\.academic_term_id[\s\S]*?kandid_check_student_organization_admission/i);
  assert.doesNotMatch(trigger, /then\s+return new;\s+end if;[\s\S]*?if not exists \([\s\S]*academic_terms/i);
});

test("all current-term active grants share the admission predicate and a database trigger backstop", () => {
  assert.match(migration, /create or replace function public\.ensure_student_organization_term_participation[\s\S]*?public\.kandid_check_student_organization_admission/i);
  assert.match(migration, /create or replace function public\.guard_student_organization_term_admission[\s\S]*?public\.kandid_check_student_organization_admission/i);
  assert.match(migration, /create trigger student_organization_terms_admission_guard[\s\S]*?before insert or update of student_id, organization_id, academic_term_id, status/i);
  assert.match(migration, /grant execute on function public\.kandid_check_student_organization_admission\(integer, integer, integer\)[\s\S]*?to service_role/i);
  assert.match(migration, /from public, anon, authenticated/i);
});

test("restore is a new admission, while already-active membership is not continuously revalidated", () => {
  assert.match(migration, /participation_status = 'active'[\s\S]*?reason := 'ALREADY_ACTIVE'/i);
  assert.match(migration, /old\.status = 'active'[\s\S]*?old\.academic_term_id = new\.academic_term_id/i);
  assert.match(migration, /before insert or update of student_id, organization_id, academic_term_id, status/i);
  const restore = board.slice(board.indexOf("async function handleParticipationAction"), board.indexOf("async function handleUpdateStudentNames"));
  assert.match(restore, /\} else \{[\s\S]*?checkOrganizationAdmission/i,
    "the only restore path performs current-term admission checks after manual-scope authorization");
  assert.match(restore, /organization\.membership_scope !== "manual"[\s\S]*?ACTIVATION_SYNC_REQUIRED/i,
    "Boards cannot manually restore program or institution memberships");
});

test("non-departmental resolver requires admitted active term participation", () => {
  const resolver = migration.slice(
    migration.indexOf("create or replace function public.resolve_student_organization_participation"),
    migration.lastIndexOf("revoke all on function public.resolve_student_organization_participation"),
  );
  assert.match(resolver, /participation_status = 'active'[\s\S]*?return query select true/i);
  assert.match(resolver, /organization_type_value = 'non_departmental'[\s\S]*?non_departmental_term_participation_required/i);
  assert.match(resolver, /non_departmental_term_participation_required[\s\S]*?student_organizations/i);
  assert.match(resolver, /non_departmental_term_participation_required[\s\S]*?organization_programs/i);
});

test("Board registration, batch, CSV preview/confirmation, and restore use trusted admission checks", () => {
  assert.match(board, /async function handleBoardVerifiedRegistration[\s\S]*?rpc\("kandid_board_register_verified_student_for_term_v1"/i);
  assert.match(board, /p_actor_admin_id:\s*Number\(adminProfile\.id\)[\s\S]*?p_board_organization_id:\s*Number\(adminProfile\.organization_id\)/i);
  assert.match(boardRegistrationMigration, /select a\.organization_id into actor_org_id from public\.admin_users a[\s\S]*?a\.role = 'electoral_board' and a\.status = 'active'/i);
  assert.match(boardRegistrationMigration, /actor_org_id is distinct from p_board_organization_id/i);
  assert.match(boardRegistrationMigration, /if org_scope = 'program' and not exists \([\s\S]*?organization_programs op/i);
  assert.match(board, /async function previewBoardCsvRows[\s\S]*?organization_programs[\s\S]*?coveredProgramIds/i);
  assert.match(board, /async function handleConfirmBoardCsvImport[\s\S]*?handleBoardVerifiedRegistration[\s\S]*?department_masterlist/i);
  const participationAction = board.slice(board.indexOf("async function handleParticipationAction"), board.indexOf("async function handleUpdateStudentNames"));
  assert.match(participationAction, /membership_scope !== "manual"[\s\S]*?ACTIVATION_SYNC_REQUIRED/i);
  assert.match(participationAction, /\} else \{[\s\S]*?checkOrganizationAdmission/i);
  assert.doesNotMatch(board, /NO_ACTIVE_DEPARTMENTAL_MEMBERSHIP|no_active_departmental_membership/);
});

test("Super Admin manual/import paths do not bypass the trusted rule", () => {
  assert.match(superAdmin, /async function ensureSuperAdminMemberships[\s\S]*?checkOrganizationAdmission/i);
  assert.match(superAdmin, /explicitOrganization\?\.membership_scope === "manual"[\s\S]*?checkOrganizationAdmission/i);
  assert.match(masterlist, /async function syncMembershipsForImport[\s\S]*?rpc\("kandid_finalize_masterlist_import_with_membership_sync"/i);
  assert.match(masterlistScopeMigration, /create or replace function public\.kandid_finalize_masterlist_import_with_membership_sync[\s\S]*?a\.role = 'super_admin'[\s\S]*?a\.status = 'active'/i);
  assert.match(masterlistScopeMigration, /where o\.membership_scope = 'institution' or \(o\.membership_scope = 'program'[\s\S]*?organization_programs op/i);
  assert.doesNotMatch(masterlistScopeMigration, /o\.membership_scope\s*=\s*'manual'[\s\S]*?insert into public\.student_organization_terms/i);
  assert.match(superAdmin, /ensure_student_organization_term_participation[\s\S]*?decodeMembershipAdmissionReason/i);
  assert.match(superAdmin, /decodeMembershipAdmissionReason\(participationError\)[\s\S]*?participation\?\.status === "denied"[\s\S]*?decodeMembershipAdmissionReason\(participation\?\.reason\)/i);
  assert.match(masterlist, /admission_skipped_count/);
});

test("Edge paths call one trusted RPC contract and provide safe rejection copy", () => {
  const edgeSources = `${board}\n${superAdmin}\n${masterlist}`;
  assert.equal((edgeSources.match(/kandid_check_student_organization_admission/g) || []).length, 2,
    "Board and individual Super Admin enrollment call the admission RPC; Masterlist uses its atomic finalizer");
  assert.match(masterlist, /rpc\("kandid_finalize_masterlist_import_with_membership_sync"/);
  assert.match(edgeSources, /p_student_id:[\s\S]*?p_organization_id:[\s\S]*?p_academic_term_id:/);
  assert.match(edgeSources, /NOT_CURRENTLY_ENROLLED/);
  assert.doesNotMatch(edgeSources, /NO_ACTIVE_DEPARTMENTAL_MEMBERSHIP|no_active_departmental_membership/);
  assert.match(boardUi, /NOT_CURRENTLY_ENROLLED/);
  assert.doesNotMatch(boardUi, /NO_ACTIVE_DEPARTMENTAL_MEMBERSHIP|departmental membership/);
  assert.doesNotMatch(csvUi, /no_active_departmental_membership|Current departmental memberships|current enrollment and departmental membership/);
});

test("the migration does not rewrite memberships or frozen electorate snapshots", () => {
  assert.doesNotMatch(migration, /delete\s+from\s+public\.student_(?:organizations|organization_terms)/i);
  assert.doesNotMatch(migration, /private\.election_eligible_voters/i);
  assert.doesNotMatch(migration, /update\s+public\.student_organization_terms/i);
});

test("trigger admission errors decode only known safe reasons and unknown errors remain errors", () => {
  assert.match(admissionHelper, /MEMBERSHIP_ADMISSION_DENIED:\(\[A-Z_\]\+\)/);
  assert.equal(decodeMembershipAdmissionReason({ message: "MEMBERSHIP_ADMISSION_DENIED:NO_ACTIVE_DEPARTMENTAL_MEMBERSHIP" }), null);
  assert.equal(decodeMembershipAdmissionReason({ message: "MEMBERSHIP_ADMISSION_DENIED:TERM_NOT_ACTIVE" }), "TERM_NOT_ACTIVE");
  assert.equal(decodeMembershipAdmissionReason({ message: "MEMBERSHIP_ADMISSION_DENIED:UNSUPPORTED_ORGANIZATION_TYPE" }), "UNSUPPORTED_ORGANIZATION_TYPE");
  assert.equal(decodeMembershipAdmissionReason({ message: "MEMBERSHIP_ADMISSION_DENIED:OTHER_INTERNAL_REASON" }), null);
  assert.equal(decodeMembershipAdmissionReason({ message: "permission denied: relation students" }), null);
});

test("Board and Super Admin create structural links after admission; Masterlist uses enrolled scoped finalization", () => {
  const boardRpcStart = boardRegistrationMigration.indexOf("create or replace function public.kandid_board_register_verified_student_for_term_v1(");
  const boardRpcEnd = boardRegistrationMigration.indexOf("$function$;", boardRpcStart);
  const boardRpc = boardRegistrationMigration.slice(boardRpcStart, boardRpcEnd);
  const enrollment = boardRpc.indexOf("insert into public.student_term_enrollments");
  const termParticipation = boardRpc.indexOf("insert into public.student_organization_terms");
  const structuralProjection = boardRpc.indexOf("insert into public.student_organizations");
  assert.ok(enrollment >= 0 && enrollment < termParticipation && termParticipation < structuralProjection,
    "verified enrollment precedes term participation and compatibility membership projection in one RPC transaction");
  assert.match(boardRpc, /set_config\('kandid\.board_verified_enrollment_actor_id'[\s\S]*?set_config\('kandid\.board_verified_enrollment_org_id'/);
  assert.match(board, /adminClient\.rpc\("kandid_board_register_verified_student_for_term_v1"/);

  const adminGrant = superAdmin.slice(superAdmin.indexOf("async function ensureSuperAdminMemberships"), superAdmin.indexOf("async function", superAdmin.indexOf("async function ensureSuperAdminMemberships") + 20));
  const adminTerm = adminGrant.indexOf("ensure_student_organization_term_participation");
  assert.ok(adminTerm < adminGrant.indexOf(".upsert(", adminTerm));
  const finalizer = masterlistScopeMigration.slice(
    masterlistScopeMigration.indexOf("create or replace function public.kandid_finalize_masterlist_import_with_membership_sync"),
    masterlistScopeMigration.indexOf("alter function public.kandid_finalize_masterlist_import_with_membership_sync"),
  );
  assert.match(finalizer, /for r in[\s\S]*?ste\.enrollment_status = 'enrolled'/i);
  assert.match(finalizer, /insert into public\.student_organization_terms[\s\S]*?insert into public\.student_organizations/i);
  assert.match(masterlist, /rpc\("kandid_finalize_masterlist_import_with_membership_sync"/);
});

test("CSV race denials continue unrelated rows and Masterlist reconciliation is import-scoped", () => {
  assert.match(board, /async function handleConfirmBoardCsvImport[\s\S]*?for \(const row of readyRows\)[\s\S]*?handleBoardVerifiedRegistration[\s\S]*?skippedRows\.push[\s\S]*?continue/i);
  assert.match(board, /async function handleBatchEnroll[\s\S]*?handleConfirmBoardCsvImport/i);
  assert.match(masterlist, /rpc\("kandid_finalize_masterlist_import_with_membership_sync"/,
    "Masterlist membership reconciliation is performed atomically by the trusted finalizer");
  assert.match(masterlistScopeMigration, /for r in[\s\S]*?where mir\.import_id = p_import_id[\s\S]*?mir\.matched_student_id is not null/i,
    "the finalizer processes only matched rows from the selected import");
});
