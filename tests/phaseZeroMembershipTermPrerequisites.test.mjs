import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scopeMigration = await readFile(
  new URL("../supabase/migrations/20261003110000_organization_membership_scope.sql", import.meta.url),
  "utf8",
);
const activationMigration = await readFile(
  new URL("../supabase/migrations/20261003120000_version_academic_term_activation.sql", import.meta.url),
  "utf8",
);
const membershipActivationSyncMigration = await readFile(
  new URL("../supabase/migrations/20261003130000_term_scoped_membership_activation_sync.sql", import.meta.url),
  "utf8",
);
const masterlistScopeMigration = await readFile(
  new URL("../supabase/migrations/20261018100000_masterlist_import_scope_and_safe_finalization.sql", import.meta.url),
  "utf8",
);
const boardRegistrationMigration = await readFile(
  new URL("../supabase/migrations/20261021120000_board_verified_student_registration.sql", import.meta.url),
  "utf8",
);
const organizationsPage = await readFile(
  new URL("../src/pages/superadmin/Organizations.jsx", import.meta.url),
  "utf8",
);
const organizationAccess = await readFile(
  new URL("../src/utils/organizationAccess.js", import.meta.url),
  "utf8",
);
const enrollmentFunctions = await Promise.all([
  readFile(new URL("../supabase/functions/board-manual-enrollment/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/super-admin-manual-enrollment/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/super-admin-masterlist-import/index.ts", import.meta.url), "utf8"),
]);

test("membership scope backfill verifies the approved WITSG identity once and fails closed on ambiguity", () => {
  assert.match(scopeMigration, /o\.id = 2/i);
  assert.match(scopeMigration, /witsg_row\.name is distinct from 'WITSG'/i);
  assert.match(scopeMigration, /witsg_row\.description is distinct from 'Western Institute of Technology Student Government'/i);
  assert.match(scopeMigration, /witsg_candidate_count <> 1/i);
  assert.match(scopeMigration, /organization_programs op[\s\S]*?op\.organization_id = 2/i);
  assert.match(scopeMigration, /raise exception/i);
  assert.doesNotMatch(organizationsPage + organizationAccess, /WITSG|WIT-SG|WIT SG|Western Institute of Technology Student Government/i);
  for (const functionSource of enrollmentFunctions) {
    assert.doesNotMatch(functionSource, /WITSG|WIT-SG|WIT SG|Western Institute of Technology Student Government/i);
  }
});

test("membership scope classifies organizations deterministically and enforces cross-table invariants", () => {
  assert.match(scopeMigration, /membership_scope text/i);
  assert.match(scopeMigration, /when o\.organization_type = 'departmental' then 'program'/i);
  assert.match(scopeMigration, /when o\.organization_type = 'non_departmental' then 'manual'/i);
  assert.match(scopeMigration, /when o\.id = 2 then 'institution'/i);
  assert.match(scopeMigration, /membership_scope in \('program', 'manual', 'institution'\)/i);
  assert.match(scopeMigration, /organization_type is not null\s+and organization_type in/i);
  assert.match(scopeMigration, /organizations_one_institution_scope_idx[\s\S]*?where membership_scope = 'institution'/i);
  assert.match(scopeMigration, /create constraint trigger organizations_validate_membership_scope[\s\S]*?deferrable initially deferred/i);
  assert.match(scopeMigration, /create constraint trigger organization_programs_validate_membership_scope[\s\S]*?deferrable initially deferred/i);
  assert.match(scopeMigration, /program-scoped organizations must be Departmental and cover at least one program/i);
  assert.match(scopeMigration, /manual-scoped organizations must be Non-departmental and have no program coverage/i);
  assert.match(scopeMigration, /institution-scoped organizations cannot have program coverage/i);
});

test("Super Admin organization create/edit and coverage replacement share one trusted transaction", () => {
  assert.match(organizationsPage, /saveOrganizationConfiguration\(/);
  assert.match(organizationAccess, /kandid_save_organization_configuration/);
  assert.match(scopeMigration, /create or replace function public\.kandid_save_organization_configuration\([\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i);
  assert.match(scopeMigration, /caller_uid uuid := auth\.uid\(\)/i);
  assert.match(scopeMigration, /a\.role = 'super_admin'[\s\S]*?a\.status = 'active'/i);
  assert.match(scopeMigration, /perform public\.kandid_replace_organization_program_coverage\(/i);
  assert.match(scopeMigration, /revoke all on function public\.kandid_save_organization_configuration\([\s\S]*?from public, anon, authenticated, service_role/i);
  assert.match(scopeMigration, /grant execute on function public\.kandid_save_organization_configuration\([\s\S]*?to authenticated/i);
  for (const table of ["organizations", "organization_programs"]) {
    assert.match(
      scopeMigration,
      new RegExp(`revoke insert, update, delete, truncate, references, trigger\\s+on table public\\.${table}\\s+from public, anon, authenticated, service_role`, "i"),
      `${table} direct writes are unavailable to browser and service-role clients`,
    );
  }
  assert.doesNotMatch(organizationsPage, /from\("organizations"\)[\s\S]{0,220}\.insert\(/i);
  assert.doesNotMatch(organizationsPage, /from\("organizations"\)[\s\S]{0,220}\.update\(/i);
});

test("runtime institution scope uses configured membership_scope rather than organization names", () => {
  assert.doesNotMatch(organizationAccess, /getInstitutionWideOrganizationIds|syncStudentOrganizationMemberships/);
  assert.match(membershipActivationSyncMigration, /o\.membership_scope = 'institution'/);
  assert.match(enrollmentFunctions[0], /rpc\("kandid_board_register_verified_student_for_term_v1"/);
  assert.match(boardRegistrationMigration, /o\.membership_scope = 'institution'[\s\S]*?o\.membership_scope = 'program'[\s\S]*?organization_programs op/i);
  assert.match(enrollmentFunctions[1], /\.eq\("membership_scope", "institution"\)/);
  assert.doesNotMatch(enrollmentFunctions[0] + enrollmentFunctions[1], /REQUIRED_STUDENT_ORGANIZATION_NAMES/);
  assert.match(enrollmentFunctions[2], /rpc\("kandid_finalize_masterlist_import_with_membership_sync"/);
  assert.match(masterlistScopeMigration, /where o\.membership_scope = 'institution' or \(o\.membership_scope = 'program'/i);
  assert.doesNotMatch(masterlistScopeMigration, /WITSG|WIT-SG|WIT SG|Western Institute of Technology Student Government/i);
  assert.match(enrollmentFunctions[1], /institution-wide membership configuration could not be verified/i);
  assert.match(masterlistScopeMigration, /membership_scope = 'institution'[\s\S]*?membership_scope = 'program'/i,
    "Masterlist membership reconciliation reads configured scopes inside the trusted database finalizer");
});

test("term activation preserves RPC signature and only advances bootstrap or the immediate semester successor", () => {
  assert.match(activationMigration, /create or replace function public\.activate_academic_term\(target_term_id integer\)\s+returns public\.academic_terms/i);
  assert.match(activationMigration, /security definer/i);
  assert.match(activationMigration, /set search_path = pg_catalog/i);
  assert.match(activationMigration, /pg_advisory_xact_lock\(20261003, 12000\)/i);
  assert.match(activationMigration, /target_term_row\.id = active_term_row\.id[\s\S]*?return active_term_row/i);
  assert.match(activationMigration, /active_term_row\.semester = '1st Semester'[\s\S]*?expected_semester := '2nd Semester'/i);
  assert.match(activationMigration, /active_term_row\.semester = '2nd Semester'[\s\S]*?expected_start_year := active_start_year \+ 1[\s\S]*?expected_semester := '1st Semester'/i);
  assert.match(activationMigration, /initial activation must use the earliest configured academic term/i);
  assert.match(activationMigration, /No active term exists after prior term history/i);
  assert.match(activationMigration, /alter function public\.activate_academic_term\(integer\) owner to postgres/i);
  assert.match(activationMigration, /revoke all on function public\.activate_academic_term\(integer\) from public, anon, authenticated/i);
  assert.match(activationMigration, /grant execute on function public\.activate_academic_term\(integer\) to service_role/i);
  assert.doesNotMatch(activationMigration, /grant\s+(?:insert|update|delete|all)[^;]*on (?:table )?public\.academic_terms[^;]*to service_role/i);
  assert.doesNotMatch(activationMigration, /execute\s+format|format\s*\(/i);
  assert.match(activationMigration, /from public, anon, authenticated/i);
  assert.doesNotMatch(activationMigration, /grant execute on function public\.activate_academic_term\(integer\) to (?:public|anon|authenticated)/i);
  assert.match(activationMigration, /from public\.academic_terms/i);
  assert.match(activationMigration, /update public\.academic_terms/i);
  assert.doesNotMatch(activationMigration, /student_organizations|student_organization_terms|elections|votes|ballots/i);
});
