import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const migration = await read("supabase/migrations/20261005100000_retire_profile_derived_membership_sync.sql");
const setup = await read("src/pages/auth/StudentSetup.jsx");
const superAdminStudents = await read("src/pages/superadmin/Students.jsx");
const organizationAccess = await read("src/utils/organizationAccess.js");
const coverageMigration = await read("supabase/migrations/20261002110000_secure_organization_program_coverage.sql");
const boardEnrollment = await read("supabase/functions/board-manual-enrollment/index.ts");
const boardRegistration = await read("supabase/migrations/20261021120000_board_verified_student_registration.sql");
const superAdminEnrollment = await read("supabase/functions/super-admin-manual-enrollment/index.ts");
const masterlistImport = await read("supabase/functions/super-admin-masterlist-import/index.ts");
const masterlistScopeMigration = await read("supabase/migrations/20261018100000_masterlist_import_scope_and_safe_finalization.sql");
const activation = await read("supabase/migrations/20261003130000_term_scoped_membership_activation_sync.sql");
const membershipScopeMigration = await read("supabase/migrations/20261003110000_organization_membership_scope.sql");
const candidateEligibility = await read("supabase/functions/organization-eligibility/index.ts");
const deletion = await read("supabase/migrations/20261002160000_trusted_organization_deletion_contract.sql");
const audit = await read("supabase/migrations/20261002130000_trusted_audit_foundation.sql");
const frozenElectorate = await read("supabase/migrations/20261002150000_freeze_election_electorates.sql");

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `start marker exists: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `end marker exists: ${endMarker}`);
  return source.slice(start, end);
}

function functionDefinition(source, functionName) {
  const start = source.toLowerCase().indexOf(`create or replace function public.${functionName}`.toLowerCase());
  assert.notEqual(start, -1, `${functionName} is defined`);
  const end = source.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${functionName} body terminates`);
  return source.slice(start, end + "$function$;".length);
}

test("StudentSetup still links identity and completes setup without profile-derived organization writes", () => {
  const completion = between(setup, "async function completeSetup()", "async function verifyOtp(");
  assert.match(completion, /linkCurrentStudentIdentity/);
  assert.match(completion, /studentNumber: student\.student_number/);
  assert.match(completion, /setupMode: true/);
  assert.match(completion, /linkResult\.data\?\.status !== "active"/);
  assert.match(completion, /setPassword\(""\)/);
  assert.match(completion, /setStep\("success"\)/);
  assert.doesNotMatch(completion, /syncStudentOrganizationMemberships|student_organizations|organization_programs/);
  assert.doesNotMatch(setup, /syncStudentOrganizationMemberships/);
});

test("Super Admin student profile edits update profile fields only and no longer offer the obsolete organization selector", () => {
  const edit = between(superAdminStudents, "async function handleSubmit(e)", "async function handleDelete(id)");
  assert.match(edit, /updateSuperAdminStudent\(savedStudentId, payload\)/);
  assert.doesNotMatch(edit, /\.from\("students"\)\s*\.update\(/);
  assert.match(edit, /program: form\.program/);
  assert.doesNotMatch(edit, /syncStudentOrganizationMemberships|student_organizations|organization_programs/);
  assert.doesNotMatch(superAdminStudents, /syncStudentOrganizationMemberships/);
  const editModal = between(superAdminStudents, "{editingStudent ? (", ") : (");
  assert.doesNotMatch(editModal, /Specific Organization|additional organization/i);
  assert.match(superAdminStudents, /organization_id: form\.organization_id \|\| null/,
    "the distinct trusted Add Student/enrollment flow retains its organization input");
  assert.match(superAdminStudents, /enrollExistingSuperAdminStudent|registerNewSuperAdminStudent/);
});

test("profile-derived structural sync utility and its profile/program lookup helpers are retired", () => {
  assert.doesNotMatch(organizationAccess, /syncStudentOrganizationMemberships|getProgramCoveredOrganizationIds|getInstitutionWideOrganizationIds/);
  assert.doesNotMatch(setup + superAdminStudents, /syncStudentOrganizationMemberships/);
});

test("versioned migration drops only the legacy student profile sync trigger and preserves rows/function/audit trigger", () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /drop trigger if exists trg_sync_student_organization_memberships on public\.students;/i);
  assert.match(migration, /current membership is term-scoped/i);
  assert.doesNotMatch(migration, /drop function[^;]*sync_student_organization_memberships/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.student_organizations/i);
  assert.doesNotMatch(migration, /truncate\s+.*student_organizations/i);
  assert.doesNotMatch(migration, /drop trigger[^;]*audit_student_organization_memberships/i);
  assert.doesNotMatch(migration, /student_organization_terms|election_eligible_voters/i);
  assert.match(migration, /commit;\s*$/i);
});

test("coverage RPC keeps trusted Super Admin validation and atomic configuration audit without projection writes", () => {
  const rpc = functionDefinition(migration, "kandid_replace_organization_program_coverage");
  assert.match(rpc, /security definer[\s\S]*?set search_path = pg_catalog/i);
  assert.match(rpc, /caller_uid uuid := auth\.uid\(\)/i);
  assert.match(rpc, /a\.role = 'super_admin'[\s\S]*?a\.status = 'active'/i);
  assert.match(rpc, /where o\.id = p_organization_id\s+for update/i);
  assert.match(rpc, /duplicate programs are not allowed/i);
  assert.match(rpc, /one or more programs were not found/i);
  assert.match(rpc, /delete from public\.organization_programs[\s\S]*?insert into public\.organization_programs/i);
  assert.doesNotMatch(rpc, /insert into public\.student_organizations|update public\.student_organizations|delete from public\.student_organizations/i);
  assert.doesNotMatch(rpc, /public\.student_organization_terms/i);
  assert.match(rpc, /insert into public\.audit_logs/i);
  assert.match(rpc, /'before_programs', before_programs[\s\S]*?'after_programs', after_programs/i);
  assert.match(rpc, /'synchronized_membership_insert_count', 0/i);
  assert.match(migration, /revoke all on function public\.kandid_replace_organization_program_coverage\(bigint, bigint\[\]\)\s+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.kandid_replace_organization_program_coverage\(bigint, bigint\[\]\)\s+to authenticated/i);
});

test("coverage change does not rewrite existing rows or retroactively alter current-term participation", () => {
  const rpc = functionDefinition(migration, "kandid_replace_organization_program_coverage");
  assert.doesNotMatch(rpc, /delete\s+from\s+public\.student_organizations|delete\s+from\s+public\.student_organization_terms/i);
  assert.doesNotMatch(rpc, /insert\s+into\s+public\.student_organizations|insert\s+into\s+public\.student_organization_terms/i);
  assert.doesNotMatch(rpc, /update\s+public\.student_organization_terms/i);
  assert.match(rpc, /delete from public\.organization_programs/i,
    "only organization coverage rows are replaced");
});

test("trusted Board and Super Admin enrollment projections follow successful active participation", () => {
  const board = between(
    boardRegistration,
    "create or replace function public.kandid_board_register_verified_student_for_term_v1(",
    "alter function public.kandid_board_register_verified_student_for_term_v1",
  );
  assert.ok(board.indexOf("insert into public.student_term_enrollments") < board.indexOf("insert into public.student_organization_terms"));
  assert.ok(board.indexOf("insert into public.student_organization_terms") < board.indexOf("insert into public.student_organizations"));
  assert.match(board, /for target_org in[\s\S]*?membership_scope = 'institution'[\s\S]*?membership_scope = 'program'[\s\S]*?organization_programs op/i);
  assert.match(boardEnrollment, /adminClient\.rpc\("kandid_board_register_verified_student_for_term_v1"/);

  const superAdminStart = superAdminEnrollment.indexOf("for (const organizationId of organizationIds)");
  assert.notEqual(superAdminStart, -1);
  const superAdmin = superAdminEnrollment.slice(superAdminStart, superAdminEnrollment.indexOf("admittedOrganizationIds.push", superAdminStart));
  const superAdminParticipation = superAdmin.indexOf('"ensure_student_organization_term_participation"');
  const superAdminProjection = superAdmin.indexOf('.from("student_organizations")', superAdminParticipation);
  assert.ok(superAdminParticipation >= 0 && superAdminProjection > superAdminParticipation,
    `expected the super-admin projection after participation; indexes ${superAdminParticipation}/${superAdminProjection}`);
  assert.match(superAdmin.slice(superAdminParticipation, superAdminProjection), /participation\?\.status !== "active"[\s\S]*?return/);

  assert.match(masterlistImport, /rpc\("kandid_finalize_masterlist_import_with_membership_sync"/);
  const finalizer = between(
    masterlistScopeMigration,
    "create or replace function public.kandid_finalize_masterlist_import_with_membership_sync",
    "alter function public.kandid_finalize_masterlist_import_with_membership_sync",
  );
  assert.match(finalizer, /ste\.enrollment_status = 'enrolled'[\s\S]*?membership_scope = 'institution'[\s\S]*?membership_scope = 'program'/i);
  assert.match(finalizer, /insert into public\.student_organization_terms[\s\S]*?insert into public\.student_organizations/i);
});

test("academic-term activation still creates term participation before its compatibility projection", () => {
  const sync = functionDefinition(activation, "sync_organization_term_participation_for_activation");
  assert.match(sync, /inserted as \([\s\S]*?insert into public\.student_organization_terms/i);
  assert.match(sync, /structural as \([\s\S]*?insert into public\.student_organizations/i);
  assert.match(sync, /existing\.status = 'active'/i);
  assert.match(sync, /o\.membership_scope in \('program', 'institution'\)/i);
  assert.match(sync, /o\.membership_scope = 'manual'/i);
});

test("structural links remain non-authoritative for canonical reads and missing links do not revoke term membership", () => {
  assert.match(organizationAccess, /Structural compatibility links; not authoritative current memberships\./);
  assert.match(organizationAccess, /getStudentCurrentMemberships\(student\)/);
  const canonicalReader = between(candidateEligibility, "async function loadCanonicalMembershipRows(", "async function ");
  assert.match(canonicalReader, /from\("student_organization_terms"\)/);
  assert.doesNotMatch(canonicalReader, /\.from\("student_organizations"\)|students\.program|organization_programs/);
  assert.doesNotMatch(candidateEligibility, /\.from\("student_organizations"\)/);
});

test("membership-scope admission and term admission guards remain unchanged", () => {
  assert.match(membershipScopeMigration, /membership_scope in \('program', 'manual', 'institution'\)/i);
  assert.match(membershipScopeMigration, /membership_scope = 'institution'/i);
  assert.match(membershipScopeMigration, /membership_scope = 'manual'/i);
  assert.match(activation, /membership_scope in \('program', 'institution'\)/i);
  assert.match(activation, /membership_scope = 'manual'/i);
  assert.match(migration, /kandid_replace_organization_program_coverage/);
});

test("organization deletion and structural membership audit contracts remain available", () => {
  assert.match(deletion, /student_organizations.*student_memberships/i);
  assert.match(audit, /create trigger audit_student_organization_memberships after insert or update or delete on public\.student_organizations/i);
  assert.doesNotMatch(migration, /(?:insert|update|delete)\s+into?\s+public\.student_organizations/i);
  assert.doesNotMatch(migration, /drop trigger[^;]*audit_student_organization_memberships/i);
});

test("frozen electorate and voting contracts are not modified by the retirement migration", () => {
  assert.doesNotMatch(migration, /election_eligible_voters|submit_vote|vote_ballots|\bvotes\b|receipt|blockchain/i);
  assert.match(frozenElectorate, /private\.election_eligible_voters/i);
  assert.match(frozenElectorate, /kandid_lock_board_electorate/i);
});

test("historical coverage implementation remains versioned while the new migration supersedes its sync behavior", () => {
  const historicalRpc = functionDefinition(coverageMigration, "kandid_replace_organization_program_coverage");
  const replacementRpc = functionDefinition(migration, "kandid_replace_organization_program_coverage");
  assert.match(historicalRpc, /insert into public\.student_organizations/i,
    "the historical migration is not rewritten");
  assert.doesNotMatch(replacementRpc, /insert into public\.student_organizations/i,
    "the latest version removes profile-derived projection");
});
