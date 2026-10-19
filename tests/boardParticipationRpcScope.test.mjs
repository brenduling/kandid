import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261003140000_guard_board_participation_scope.sql", import.meta.url),
  "utf8",
);

const start = migration.indexOf("create or replace function public.board_update_student_participation(");
const end = migration.indexOf("alter function public.board_update_student_participation(", start);
assert.notEqual(start, -1, "migration must replace the trusted participation RPC");
assert.notEqual(end, -1, "migration must terminate the RPC definition before ownership/grants");
const rpc = migration.slice(start, end);

test("trusted participation RPC keeps its existing signature and return contract", () => {
  assert.match(rpc, /board_update_student_participation\(\s*target_student_id integer,\s*target_organization_id integer,\s*actor_admin_id integer,\s*target_action text,\s*target_reason text default null\s*\)/i);
  assert.match(rpc, /returns table \([\s\S]*?status text,[\s\S]*?already_applied boolean,[\s\S]*?participation_id integer,[\s\S]*?notification_id integer,[\s\S]*?removed_at timestamptz/i);
  assert.match(rpc, /security invoker[\s\S]*?set search_path = public, pg_temp/i);
});

test("scope validation precedes both trusted action branches and every mutation", () => {
  const scopeGuard = rpc.indexOf("if org_record.membership_scope is distinct from 'manual' then");
  const removeBranch = rpc.indexOf("if normalized_action = 'remove' then");
  assert.ok(scopeGuard >= 0 && scopeGuard < removeBranch, "scope guard must precede both action branches");
  assert.match(rpc.slice(scopeGuard, removeBranch), /MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED/);

  const firstMutation = Math.min(
    ...["update public.student_organization_terms", "insert into public.student_notifications", "insert into public.audit_logs"]
      .map((needle) => rpc.indexOf(needle))
      .filter((index) => index >= 0),
  );
  assert.ok(scopeGuard < firstMutation, "scope rejection must happen before all mutation statements");
  assert.equal((rpc.match(/update public\.student_organization_terms/gi) ?? []).length, 2);
});

for (const scope of ["program", "institution"]) {
  for (const action of ["remove", "restore"]) {
    test(`${scope} scope ${action} is rejected by the RPC-wide pre-mutation guard`, () => {
      const guard = rpc.indexOf("if org_record.membership_scope is distinct from 'manual' then");
      const actionBranch = action === "remove"
        ? rpc.indexOf("if normalized_action = 'remove' then")
        : rpc.indexOf("-- A restore is valid only while the current-term admission contract still");
      assert.ok(guard >= 0 && actionBranch > guard);
      assert.match(rpc.slice(guard, actionBranch), /MEMBERSHIP_ADMISSION_DENIED:ACTIVATION_SYNC_REQUIRED/);
      assert.match(rpc.slice(guard, actionBranch), /membership_scope is distinct from 'manual'/);
    });
  }
}

test("manual removal preserves idempotency, notification and audit behavior", () => {
  const removeBranch = rpc.slice(
    rpc.indexOf("if normalized_action = 'remove' then"),
    rpc.indexOf("else\n    -- A restore", rpc.indexOf("if normalized_action = 'remove' then")),
  );
  assert.match(removeBranch, /if participation\.status = 'removed'[\s\S]*?already_applied := true/i);
  assert.match(removeBranch, /set\s+status = 'removed'[\s\S]*?removed_by = actor_admin_id/i);
  assert.match(removeBranch, /organization_removed/);
  assert.match(removeBranch, /Student Removed from Organization/);
});

test("manual restoration revalidates current-term admission before state change", () => {
  const restoreStart = rpc.indexOf("-- A restore is valid only while the current-term admission contract still");
  const restoreUpdate = rpc.indexOf("update public.student_organization_terms", restoreStart);
  assert.ok(restoreStart >= 0 && restoreUpdate > restoreStart);
  const restoreCheck = rpc.slice(restoreStart, restoreUpdate);
  const restoreMutationPath = rpc.slice(restoreUpdate);
  assert.match(restoreCheck, /public\.kandid_check_student_organization_admission\(\s*target_student_id,\s*target_organization_id,\s*active_term\.id\s*\)/i);
  assert.match(restoreCheck, /if not coalesce\(admission_result\.allowed, false\) then[\s\S]*?MEMBERSHIP_ADMISSION_DENIED:/i);
  assert.match(restoreCheck, /if participation\.status = 'active'[\s\S]*?already_applied := true/i);
  assert.match(restoreMutationPath, /organization_restored/);
  assert.match(restoreMutationPath, /Student Restored to Organization/);
});

test("function remains service-role-only and keeps the Phase 1A guard intact", () => {
  assert.match(migration, /alter function public\.board_update_student_participation\(integer, integer, integer, text, text\)\s+owner to postgres/i);
  assert.match(migration, /revoke all on function public\.board_update_student_participation\(integer, integer, integer, text, text\)\s+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.board_update_student_participation\(integer, integer, integer, text, text\)\s+to service_role/i);
  assert.doesNotMatch(migration, /drop trigger|drop function public\.guard_student_organization_term_admission|create or replace function public\.guard_student_organization_term_admission/i);
});
