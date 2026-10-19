import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const roleMigration = await readFile(new URL("supabase/migrations/20261002140000_audit_trail_role_separation.sql", root), "utf8");
const foundation = await readFile(new URL("supabase/migrations/20261002130000_trusted_audit_foundation.sql", root), "utf8");
const dashboard = await readFile(new URL("src/pages/board/Dashboard.jsx", root), "utf8");

function functionBlock(source, name) {
  return source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`, "i"))?.[0] || "";
}

function functionSignature(block) {
  return block.match(/\(([^]*?)\)\s*returns\s+jsonb/i)?.[1]?.replace(/\s+/g, " ").trim() || "";
}

function functionBody(block) {
  return block.match(/as \$function\$([^]*?)\$function\$/i)?.[1] || "";
}

const board = functionBlock(roleMigration, "kandid_list_board_audit_events");
const boardOriginal = functionBlock(foundation, "kandid_list_board_audit_events");
const superAdmin = functionBlock(roleMigration, "kandid_list_super_admin_audit_events");
const superAdminOriginal = functionBlock(foundation, "kandid_list_super_admin_audit_events");
const boardBody = functionBody(board);
const superAdminBody = functionBody(superAdmin);
const trustedOrigins = /l\.event_origin in \('trusted_database', 'trusted_edge', 'trusted_server'\)/i;

test("same-organization Board accounts share the Electoral Board event stream", () => {
  assert.match(boardBody, /where l\.organization_id = board_org_id\s+and l\.actor_role = 'electoral_board'/i);
  assert.doesNotMatch(boardBody, /l\.user_id\s*=|actor_id|p_actor/i);
});

test("PSITS Board cannot see another organization's Board events", () => {
  assert.match(boardBody, /where l\.organization_id = board_org_id/i);
  assert.match(boardBody, /a\.auth_user_id = caller_uid and a\.role = 'electoral_board' and a\.status = 'active'/i);
  assert.match(boardBody, /assignment_count <> 1 or board_org_id is null/i);
});

test("JHEMS Board receives only its own server-derived organization stream", () => {
  assert.match(boardBody, /select count\(\*\)::integer, min\(a\.organization_id\)\s+into assignment_count, board_org_id[\s\S]*?a\.auth_user_id = caller_uid/i);
  assert.doesNotMatch(boardBody, /p_organization_id|p_org_id/i);
});

test("Board stream excludes Super Admin events for the same organization", () => {
  assert.match(boardBody, /l\.actor_role = 'electoral_board'/i);
  assert.match(boardBody, trustedOrigins);
});

test("Super Admin stream excludes Electoral Board events", () => {
  assert.match(superAdminBody, /l\.actor_role = 'super_admin'/i);
  assert.match(superAdminBody, trustedOrigins);
});

test("Super Admin can read trusted Super Admin events across organizations", () => {
  assert.match(superAdminBody, /a\.auth_user_id = caller_uid and a\.role = 'super_admin' and a\.status = 'active'/i);
  assert.match(superAdminBody, /where \(p_organization_id is null or l\.organization_id = p_organization_id\)\s+and l\.actor_role = 'super_admin'/i);
});

test("legacy rows without trusted actor role and provenance match neither surface", () => {
  assert.match(boardBody, /l\.actor_role = 'electoral_board'[\s\S]*?l\.event_origin in/i);
  assert.match(superAdminBody, /l\.actor_role = 'super_admin'[\s\S]*?l\.event_origin in/i);
  assert.match(roleMigration, /'is_legacy', p\.event_origin is null/i);
});

test("legacy audit rows remain stored and are not rewritten", () => {
  assert.doesNotMatch(roleMigration, /\b(?:insert|update|delete)\s+into?\s+public\.audit_logs\b/i);
  assert.doesNotMatch(roleMigration, /\bdelete\s+from\s+public\.audit_logs\b/i);
  assert.doesNotMatch(roleMigration, /\bupdate\s+public\.audit_logs\b/i);
});

test("Board RPC accepts neither organization nor actor authorization scope", () => {
  const signature = functionSignature(board);
  assert.doesNotMatch(signature, /organization|actor|user_id/i);
  assert.match(boardBody, /caller_uid uuid := auth\.uid\(\)/i);
});

test("Board RPC continues to require exactly one active Board assignment", () => {
  assert.match(boardBody, /a\.role = 'electoral_board' and a\.status = 'active'/i);
  assert.match(boardBody, /assignment_count <> 1 or board_org_id is null/i);
  assert.match(boardBody, /caller_uid is null/i);
});

test("Board Dashboard Recent Activity continues using the shared Board RPC", () => {
  assert.match(dashboard, /"kandid_list_board_audit_events"[\s\S]*?buildBoardAuditRpcArgs\(\{ pageSize: 5 \}\)/);
  assert.doesNotMatch(dashboard, /p_organization_id|p_actor_id|from\(["']audit_logs["']\)/i);
});

test("RPC signatures remain unchanged", () => {
  assert.ok(board && boardOriginal && superAdmin && superAdminOriginal);
  assert.equal(functionSignature(board), functionSignature(boardOriginal));
  assert.equal(functionSignature(superAdmin), functionSignature(superAdminOriginal));
});

test("pagination, ordering, filters, and search remain in both read contracts", () => {
  for (const body of [boardBody, superAdminBody]) {
    assert.match(body, /\(coalesce\(l\.created_at, l\.timestamp\), l\.id\) < \(p_before_created_at, p_before_id\)/i);
    assert.match(body, /p_category is null/i);
    assert.match(body, /p_event_type is null/i);
    assert.match(body, /p_election_id is null/i);
    assert.match(body, /pg_catalog\.btrim\(p_search\)/i);
    assert.match(body, /order by coalesce\(l\.created_at, l\.timestamp\) desc, l\.id desc/i);
    assert.match(body, /limit page_limit \+ 1/i);
    assert.match(body, /'has_more'/i);
    assert.match(body, /'next_cursor'/i);
  }
  assert.match(superAdminBody, /p_organization_id is null/i);
  assert.match(superAdminBody, /p_entity_type is null/i);
  assert.match(superAdminBody, /p_status is null/i);
  assert.match(superAdminBody, /p_created_on is null/i);
});

test("privacy projection remains allow-listed and does not expose raw metadata", () => {
  for (const body of [boardBody, superAdminBody]) {
    assert.match(body, /'changed_fields', p\.changed_fields, 'safe_details', p\.safe_details/i);
    assert.doesNotMatch(body, /'metadata'\s*,\s*l\.metadata/i);
    assert.doesNotMatch(body, /ballot_contents|vote_hash|transaction_hash|nonce|receipt_secret|voter_candidate/i);
  }
});

test("migration only replaces the two trusted read RPC definitions", () => {
  assert.equal((roleMigration.match(/create or replace function/gi) || []).length, 2);
  assert.doesNotMatch(roleMigration, /alter table|create table|drop table|create trigger|drop trigger|grant |revoke /i);
});
