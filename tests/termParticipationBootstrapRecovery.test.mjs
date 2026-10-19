import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [bootstrapMigration, activationMigration, scopeMigration, witsgScopeMigration, boardFunction, recoveryScript, rollbackScript] = await Promise.all([
  readFile(new URL("../supabase/migrations/20261015110620_term1_membership_bootstrap_history_guard.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261003130000_term_scoped_membership_activation_sync.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migration_archive/20260910091811_student_organization_terms_foundation.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261003110000_organization_membership_scope.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/board-manual-enrollment/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../deploy/ACADEMIC_TERM_TEST_RECOVERY_REVIEW.sql", import.meta.url), "utf8"),
  readFile(new URL("../deploy/ACADEMIC_TERM_TEST_RECOVERY_ROLLBACK_REVIEW.sql", import.meta.url), "utf8"),
]);

function functionBody(source, name, endMarker) {
  const start = source.indexOf(`create or replace function public.${name}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${name} exists`);
  assert.notEqual(end, -1, `${name} end marker exists`);
  return source.slice(start, end);
}

function termOrder(term) {
  const year = Number(term.academic_year.slice(0, 4));
  const semester = term.semester === "1st Semester" ? 1 : 2;
  return year * 10 + semester;
}

function hasEarlierConfiguredTerm(target, terms) {
  return terms.some((term) => term.id !== target.id && termOrder(term) < termOrder(target));
}

const sync = functionBody(
  bootstrapMigration,
  "sync_organization_term_participation_for_activation(",
  "revoke all on function public.sync_organization_term_participation_for_activation",
);

test("future-term history does not block first configured term bootstrap", () => {
  const term1 = { id: 1, academic_year: "2026-2027", semester: "1st Semester" };
  const activeFutureTerm = {
    id: 2,
    academic_year: "2026-2027",
    semester: "2nd Semester",
    status: "active",
    activated_at: "2026-10-09T00:49:02+08:00",
  };

  assert.equal(hasEarlierConfiguredTerm(term1, [term1, activeFutureTerm]), false);
  assert.match(sync, /previous_term_id is null and exists[\s\S]*?t\.academic_year[\s\S]*?< pg_catalog\.split_part\(target_term\.academic_year/i);
  assert.doesNotMatch(sync, /t\.id <> p_target_term_id\s+and \(t\.status = 'closed' or t\.activated_at/i);
});

test("a missing immediate predecessor still fails closed when an earlier term is configured", () => {
  const target = { id: 8, academic_year: "2026-2027", semester: "1st Semester" };
  const earlierButNotImmediate = { id: 4, academic_year: "2025-2026", semester: "1st Semester", status: "closed" };
  const later = { id: 9, academic_year: "2026-2027", semester: "2nd Semester", status: "active" };

  assert.equal(hasEarlierConfiguredTerm(target, [target, earlierButNotImmediate, later]), true);
  assert.match(sync, /if previous_term_id is null and exists[\s\S]*?then\s+raise exception[\s\S]*?immediately preceding academic term could not be verified/i);
  assert.match(activationMigration, /where t\.academic_year = previous_year[\s\S]*?and t\.semester = previous_semester[\s\S]*?and t\.status = 'closed'/i);
});

test("repeated synchronization cannot duplicate term participation or structural links", () => {
  assert.match(sync, /on conflict \(student_id, organization_id, academic_term_id\) do nothing/i);
  assert.match(sync, /on conflict \(student_id, organization_id\) do nothing/i);
  assert.match(scopeMigration, /student_organization_terms_unique[\s\S]*?unique \(student_id, organization_id, academic_term_id\)/i);
  assert.match(sync, /existing\.academic_term_id = p_target_term_id[\s\S]*?existing\.status = 'active'/i);
  assert.match(bootstrapMigration, /language plpgsql\s+security definer\s+set search_path = pg_catalog/i);
  assert.match(bootstrapMigration, /alter function public\.sync_organization_term_participation_for_activation\(integer\) owner to postgres/i);
  assert.match(bootstrapMigration, /revoke all on function public\.sync_organization_term_participation_for_activation\(integer\) from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(bootstrapMigration, /grant execute on function public\.sync_organization_term_participation_for_activation/i);
});

test("initial membership comes only from term enrollment and verified scope; manual scope needs predecessor evidence", () => {
  assert.match(sync, /ste\.academic_term_id = p_target_term_id[\s\S]*?ste\.enrollment_status = 'enrolled'/i);
  assert.match(sync, /public\.kandid_resolve_program_catalog_id\(e\.program\)/i);
  assert.match(sync, /o\.membership_scope = 'institution'[\s\S]*?o\.membership_scope = 'program'[\s\S]*?organization_programs op[\s\S]*?op\.program_id = r\.program_id/i);
  assert.match(sync, /o\.membership_scope = 'manual'[\s\S]*?prior\.academic_term_id = previous_term_id[\s\S]*?prior\.status = 'active'/i);
  assert.doesNotMatch(sync, /student_organizations\s+prior|students\s+prior/i);
});

test("Board registry stays organization and active-term scoped after initialization", () => {
  const start = boardFunction.indexOf("async function handleListStudents(");
  const end = boardFunction.indexOf("async function handleListRemovedStudents(", start);
  assert.notEqual(start, -1, "active Board registry handler exists");
  assert.notEqual(end, -1, "removed Board registry handler follows it");
  const registry = boardFunction.slice(start, end);
  assert.match(registry, /loadActiveTerm\(adminClient\)/);
  assert.match(registry, /\.eq\("academic_term_id", activeTerm\.id\)[\s\S]*?\.eq\("organization_id", boardOrganizationId\)/i);
  assert.match(registry, /student_term_enrollments[\s\S]*?\.eq\("academic_term_id", activeTerm\.id\)[\s\S]*?\.eq\("enrollment_status", "enrolled"\)/i);
  assert.match(witsgScopeMigration, /when o\.id = 2 then 'institution'/i);
});

test("recovery initializes only the reviewed derived scopes and rollback preserves created history", () => {
  assert.match(recoveryScript, /sync_organization_term_participation_for_activation\(1\)/);
  assert.match(recoveryScript, /pg_catalog\.strpos\([\s\S]*?pg_get_functiondef[\s\S]*?previous_term_id is null and exists/i);
  assert.match(recoveryScript, /id = 2 and name = 'WITSG' and membership_scope = 'institution'/i);
  assert.match(recoveryScript, /program_created_count <> 1[\s\S]*?institution_created_count <> 1[\s\S]*?manual_carried_count <> 0[\s\S]*?unresolved_program_count <> 0/i);
  assert.match(recoveryScript, /membership_scope = 'manual'[\s\S]*?raise exception/i);
  assert.match(rollbackScript, /student_organization_terms where academic_term_id = 1\) <> 2/i);
  assert.doesNotMatch(rollbackScript, /delete\s+from\s+public\.(?:student_organization_terms|student_organizations)/i);
});
