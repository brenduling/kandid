import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20261003130000_term_scoped_membership_activation_sync.sql", import.meta.url),
  "utf8",
);
const admissionHelper = await readFile(
  new URL("../supabase/functions/_shared/membershipAdmission.js", import.meta.url),
  "utf8",
);
const boardRegistrationMigration = await readFile(
  new URL("../supabase/migrations/20261021120000_board_verified_student_registration.sql", import.meta.url),
  "utf8",
);
const board = await readFile(
  new URL("../supabase/functions/board-manual-enrollment/index.ts", import.meta.url),
  "utf8",
);
const superAdmin = await readFile(
  new URL("../supabase/functions/super-admin-manual-enrollment/index.ts", import.meta.url),
  "utf8",
);
const masterlist = await readFile(
  new URL("../supabase/functions/super-admin-masterlist-import/index.ts", import.meta.url),
  "utf8",
);
const masterlistScopeMigration = await readFile(
  new URL("../supabase/migrations/20261018100000_masterlist_import_scope_and_safe_finalization.sql", import.meta.url),
  "utf8",
);

function functionBody(source, name, endMarker) {
  const start = source.indexOf(`create or replace function public.${name}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${name} exists`);
  assert.notEqual(end, -1, `${name} end marker exists`);
  return source.slice(start, end);
}

test("activation sync keeps program scope catalog-bound and institution scope enrollment-wide", () => {
  const sync = functionBody(
    migration,
    "sync_organization_term_participation_for_activation(",
    "alter function public.sync_organization_term_participation_for_activation",
  );
  const resolver = functionBody(
    migration,
    "kandid_resolve_program_catalog_id(",
    "alter function public.kandid_resolve_program_catalog_id",
  );

  assert.match(sync, /ste\.academic_term_id = p_target_term_id[\s\S]*?ste\.enrollment_status = 'enrolled'/i);
  assert.match(sync, /public\.kandid_resolve_program_catalog_id\(e\.program\)/i);
  assert.match(sync, /where o\.membership_scope = 'institution'[\s\S]*?or \([\s\S]*?o\.membership_scope = 'program'[\s\S]*?r\.program_id is not null[\s\S]*?organization_programs op[\s\S]*?op\.program_id = r\.program_id/i);
  assert.doesNotMatch(sync, /where r\.program_id is not null\s+and\s+\(/i);
  assert.match(resolver, /upper\(pg_catalog\.btrim\(coalesce\(p\.code, ''\)\)\)/i);
  assert.match(resolver, /upper\(pg_catalog\.btrim\(coalesce\(p\.name, ''\)\)\)/i);
  assert.match(resolver, /returns bigint[\s\S]*?count\(distinct p\.id\) = 1[\s\S]*?else null::bigint/i);
  assert.match(sync, /student_id, organization_id, academic_term_id, status, source[\s\S]*?select i\.student_id, i\.organization_id, p_target_term_id, 'active', 'system'/i);
  assert.match(sync, /on conflict \(student_id, organization_id, academic_term_id\) do nothing/i);
  assert.match(sync, /order by o\.id[\s\S]*?for share/i);
});

test("manual carry-forward follows only the immediate closed semester predecessor and active prior participation", () => {
  const previous = functionBody(
    migration,
    "kandid_previous_academic_term_id(",
    "alter function public.kandid_previous_academic_term_id",
  );
  const sync = functionBody(
    migration,
    "sync_organization_term_participation_for_activation(",
    "alter function public.sync_organization_term_participation_for_activation",
  );

  assert.match(previous, /target_semester = '2nd Semester'[\s\S]*?previous_semester := '1st Semester'/i);
  assert.match(previous, /target_semester = '1st Semester'[\s\S]*?previous_semester := '2nd Semester'/i);
  assert.match(previous, /t\.academic_year = previous_year[\s\S]*?t\.semester = previous_semester[\s\S]*?t\.status = 'closed'/i);
  assert.doesNotMatch(previous, /max\s*\(/i);
  assert.match(sync, /o\.membership_scope = 'manual'[\s\S]*?prior\.status = 'active'/i);
  assert.doesNotMatch(sync, /prior\.source/i);
  assert.match(sync, /if has_prior_history then[\s\S]*?immediately preceding academic term could not be verified/i);
});

test("the resolver trusts explicit term participation only and leaves historical/frozen records untouched", () => {
  const resolver = functionBody(
    migration,
    "resolve_student_organization_participation(",
    "revoke all on function public.resolve_student_organization_participation",
  );
  const activate = functionBody(
    migration,
    "activate_academic_term(",
    "alter function public.activate_academic_term",
  );

  assert.match(resolver, /student_term_enrollments[\s\S]*?enrollment_status[\s\S]*?student_organization_terms/i);
  assert.doesNotMatch(resolver, /student_organizations|organization_programs|programs/i);
  assert.match(activate, /target_term_row\.id[\s\S]*?public\.sync_organization_term_participation_for_activation/i);
  assert.match(activate, /target_term_row\.id = active_term_row\.id[\s\S]*?return active_term_row/i);
  assert.doesNotMatch(migration, /private\.election_eligible_voters|election_eligible_voters|update public\.elections|delete from public\.(?:student_organization_terms|student_organizations)/i);
  assert.match(migration, /revoke all on function public\.sync_organization_term_participation_for_activation\(integer\)[\s\S]*?from public, anon, authenticated, service_role/i);
  assert.match(migration, /set search_path = pg_catalog/i);
});

test("database admission and trigger guard reserve new rows and restoration for manual scope", () => {
  const admission = functionBody(
    migration,
    "kandid_check_student_organization_admission(",
    "alter function public.kandid_check_student_organization_admission",
  );
  const ensure = functionBody(
    migration,
    "ensure_student_organization_term_participation(",
    "-- One trigger remains",
  );
  const trigger = functionBody(
    migration,
    "guard_student_organization_term_admission(",
    "alter function public.guard_student_organization_term_admission",
  );

  assert.match(admission, /membership_scope_value <> 'manual'[\s\S]*?ACTIVATION_SYNC_REQUIRED/i);
  assert.match(ensure, /normalized_source not in \('masterlist', 'manual', 'board_csv', 'student_setup'\)/i);
  assert.doesNotMatch(ensure, /'system'\s*,\s*'program_sync'/i);
  assert.match(ensure, /participation_row\.status = 'removed' and organization_scope <> 'manual'[\s\S]*?ACTIVATION_SYNC_REQUIRED/i);
  assert.match(trigger, /old\.status is distinct from new\.status[\s\S]*?organization_scope <> 'manual'[\s\S]*?ACTIVATION_SYNC_REQUIRED/i);
  assert.match(trigger, /public\.kandid_check_student_organization_admission/i);
  assert.match(trigger, /if organization_scope = 'program' then[\s\S]*?resolved_program_id := public\.kandid_resolve_program_catalog_id\(enrollment_program\)[\s\S]*?end if;[\s\S]*?return new;/i);
  assert.doesNotMatch(trigger, /resolved_program_id is null[\s\S]*?if organization_scope = 'program'/i);
});

test("manual Edge routes enforce scope early while Masterlist uses configured-scope finalization", () => {
  assert.match(admissionHelper, /"ACTIVATION_SYNC_REQUIRED"/);
  assert.match(board, /adminClient\.rpc\("kandid_board_register_verified_student_for_term_v1"/);
  assert.match(boardRegistrationMigration, /if org_scope = 'program' and not exists \([\s\S]*?organization_programs op/i);
  assert.match(boardRegistrationMigration, /if org_scope = 'manual'[\s\S]*?insert into public\.student_organization_terms/i);
  assert.match(board, /organization\.membership_scope !== "manual"/);
  assert.match(board, /async function handleParticipationAction[\s\S]*?organization\.membership_scope !== "manual"[\s\S]*?board_update_student_participation/i);
  assert.match(superAdmin, /async function removeCurrentOrganizationMembership[\s\S]*?organization\.membership_scope !== "manual"[\s\S]*?board_update_student_participation/i);
  assert.match(superAdmin, /mode === "create"[\s\S]*?ACTIVATION_SYNC_REQUIRED/i);
  assert.match(superAdmin, /existingParticipation\?\.status !== "active"[\s\S]*?ACTIVATION_SYNC_REQUIRED/i);
  assert.match(masterlist, /rpc\("kandid_finalize_masterlist_import_with_membership_sync"/);
  assert.match(masterlistScopeMigration, /where o\.membership_scope = 'institution' or \(o\.membership_scope = 'program'[\s\S]*?organization_programs op/i);
  assert.match(masterlistScopeMigration, /where mir\.import_id = p_import_id[\s\S]*?mir\.matched_student_id is not null/i);
  assert.doesNotMatch(masterlistScopeMigration, /o\.membership_scope\s*=\s*'manual'[\s\S]*?insert into public\.student_organization_terms/i);
  assert.doesNotMatch(board, /isProgramEligibleForBoard/);
});
