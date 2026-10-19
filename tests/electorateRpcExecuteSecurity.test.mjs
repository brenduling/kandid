import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const aclMigration = await readFile("supabase/migrations/20261009170000_restrict_electorate_rpc_execution.sql", "utf8");
const electorateMigration = await readFile("supabase/migrations/20261002150000_freeze_election_electorates.sql", "utf8");
const reportsMigration = await readFile("supabase/migrations/20261002100000_board_election_reports_read_rpcs.sql", "utf8");
const voteAccess = await readFile("supabase/functions/vote-access/index.ts", "utf8");
const submitVote = await readFile("supabase/functions/submit-vote/index.ts", "utf8");
const readonlyReport = await readFile("supabase/runtime-validation/vote_security_contract_readonly.sql", "utf8");

function functionBody(source, name) {
  const start = source.search(new RegExp(`function public\\.${name}\\(`, "i"));
  assert.notEqual(start, -1, `Expected ${name} function definition`);
  const end = source.indexOf("$function$;", start);
  assert.notEqual(end, -1, `Expected ${name} function terminator`);
  return source.slice(start, end);
}

test("forward ACL migration restores the five explicit effective-execution contracts", () => {
  const authenticatedOnly = [
    "kandid_get_board_election_report_package(integer)",
    "kandid_get_board_electorate_preview(integer)",
    "kandid_get_election_turnout(integer)",
    "kandid_lock_board_electorate(integer)",
  ];
  for (const signature of authenticatedOnly) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(aclMigration, new RegExp(`revoke all on function public\\.${escaped}\\s+from public, anon, authenticated, service_role`, "i"));
    assert.match(aclMigration, new RegExp(`grant execute on function public\\.${escaped}\\s+to authenticated`, "i"));
    assert.match(aclMigration, new RegExp(`has_function_privilege\\('authenticated', 'public\\.${escaped}', 'EXECUTE'\\)`, "i"));
    assert.match(aclMigration, new RegExp(`has_function_privilege\\('anon', 'public\\.${escaped}', 'EXECUTE'\\)`, "i"));
    assert.match(aclMigration, new RegExp(`has_function_privilege\\('service_role', 'public\\.${escaped}', 'EXECUTE'\\)`, "i"));
  }

  const membershipSignature = "kandid_is_locked_electorate_member(integer,integer)";
  assert.match(aclMigration, /revoke all on function public\.kandid_is_locked_electorate_member\(integer, integer\)\s+from public, anon, authenticated, service_role/i);
  assert.match(aclMigration, /grant execute on function public\.kandid_is_locked_electorate_member\(integer, integer\)\s+to service_role/i);
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(aclMigration, new RegExp(`has_function_privilege\\('${role}', 'public\\.${membershipSignature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}', 'EXECUTE'\\)`, "i"));
  }
  assert.match(aclMigration, /to_regprocedure\(signature\) is null/i);
  assert.match(readonlyReport, /when expected_executor = 'authenticated'[\s\S]*?not has_function_privilege\('service_role', procedure_oid, 'EXECUTE'\)/i);
});

test("Board report, preview, and lock enforce active Electoral Board identity and organization scope", () => {
  const report = functionBody(reportsMigration, "kandid_get_board_election_report_package");
  const preview = functionBody(electorateMigration, "kandid_get_board_electorate_preview");
  const lock = functionBody(electorateMigration, "kandid_lock_board_electorate");

  for (const body of [report, preview, lock]) {
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path = pg_catalog/i);
    assert.match(body, /auth\.uid\(\)/i);
    assert.match(body, /role = 'electoral_board'/i);
    assert.match(body, /status = 'active'/i);
  }
  assert.match(report, /e\.organization_id = organization_id_value/i);
  assert.match(preview, /e\.organization_id = board_admin\.organization_id/i);
  assert.match(lock, /e\.organization_id = board_admin\.organization_id/i);
});

test("turnout retains authorized Student visibility and administrator scope; membership check stays server-only", () => {
  const turnout = functionBody(electorateMigration, "kandid_get_election_turnout");
  const memberCheck = functionBody(electorateMigration, "kandid_is_locked_electorate_member");

  assert.match(turnout, /caller_uid uuid := auth\.uid\(\)/i);
  assert.match(turnout, /admin_row\.role = 'electoral_board'[\s\S]*?admin_row\.organization_id = election_row\.organization_id/i);
  assert.match(turnout, /admin_row\.role = 'super_admin'/i);
  assert.match(turnout, /s\.auth_user_id = caller_uid[\s\S]*?s\.status = 'active'/i);
  assert.match(turnout, /not visible_to_student or not student_participation_allowed/i);

  assert.match(memberCheck, /auth\.role\(\) is distinct from 'service_role'/i);
  assert.match(submitVote, /authUser\.id/);
  assert.match(submitVote, /student\.auth_user_id !== authUser\.id[\s\S]*?student\.status !== "active"/);
  assert.match(submitVote, /p_student_id: Number\(student\.id\)/);
  assert.match(submitVote, /adminClient\.rpc\([\s\S]*?"kandid_is_locked_electorate_member"/);
});

test("frontend callers continue using authenticated Supabase sessions for user-facing RPCs", () => {
  assert.match(voteAccess, /authClient\.rpc\("kandid_get_election_turnout"/);
  assert.match(voteAccess, /authClient\.auth\.getUser\(\)/);
  assert.match(aclMigration, /to authenticated/i);
  assert.match(aclMigration, /to service_role/i);
});
