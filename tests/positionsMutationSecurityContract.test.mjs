import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260928130000_harden_board_position_mutations.sql",
  "utf8",
);

function functionDefinition(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = migration.match(
    new RegExp(`create or replace function public\\.${escapedName}\\([\\s\\S]*?\\$function\\$;`, "i"),
  );
  assert.ok(match, `Expected a definition for public.${name}`);
  return match[0];
}

const authorization = functionDefinition("kandid_can_mutate_election_positions");
const reorder = functionDefinition("reorder_election_positions");

test("active Board identity is bound to auth.uid and its assigned election organization", () => {
  assert.match(authorization, /caller_uid\s+uuid\s*:=\s*auth\.uid\(\)/i);
  assert.match(authorization, /a\.role\s*=\s*'electoral_board'/i);
  assert.match(authorization, /a\.status\s*=\s*'active'/i);
  assert.match(authorization, /a\.organization_id\s*=\s*e\.organization_id/i);
  assert.match(authorization, /a\.role\s*=\s*'super_admin'/i);
  assert.match(authorization, /a\.status\s*=\s*'active'/i);
});

test("editability follows the existing phase precedence using Manila wall time", () => {
  assert.match(authorization, /election_status\s*=\s*'draft'[\s\S]*?return true/i);
  assert.match(authorization, /lower\(election_status\)\s+in\s*\('closed',\s*'archived',\s*'done'\)/i);
  assert.match(authorization, /timezone\([\s\S]*?'Asia\/Manila'[\s\S]*?clock_timestamp\(\)/i);
  assert.match(authorization, /campaign_start[\s\S]*?campaign_end[\s\S]*?start_date[\s\S]*?end_date/i);
  assert.match(authorization, /now_manila\s*>=\s*election_row\.end_date[\s\S]*?return false/i);
  assert.match(authorization, /return election_status = 'active'/i);
  assert.doesNotMatch(authorization, /'completed'/i);
  assert.doesNotMatch(authorization, /p_phase|p_status|client_phase/i);
});

test("only authorized authenticated users receive insert, update, and delete RLS policies", () => {
  assert.match(migration, /drop policy if exists "open positions"/i);
  assert.match(migration, /drop policy if exists positions_all_access/i);
  assert.match(migration, /for insert\s+to authenticated\s+with check \(public\.kandid_can_mutate_election_positions\(election_id\)\)/i);
  assert.match(migration, /for update\s+to authenticated\s+using \(public\.kandid_can_mutate_election_positions\(election_id\)\)\s+with check \(public\.kandid_can_mutate_election_positions\(election_id\)\)/i);
  assert.match(migration, /for delete\s+to authenticated\s+using \(public\.kandid_can_mutate_election_positions\(election_id\)\)/i);
  assert.match(migration, /for select\s+to anon, authenticated\s+using \(true\)/i);
});

test("anonymous mutation and excess table/sequence privileges are revoked", () => {
  assert.match(migration, /revoke all privileges on table public\.positions\s+from public, anon, authenticated/i);
  assert.match(migration, /grant select on table public\.positions to anon, authenticated/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]*\bto anon\b/i);
  assert.match(migration, /grant insert \(election_id, name, max_votes, display_order\)[\s\S]*?to authenticated/i);
  assert.match(migration, /grant update \(election_id, name, max_votes, display_order, status\)[\s\S]*?to authenticated/i);
  assert.match(migration, /grant delete on table public\.positions to authenticated/i);
  assert.match(migration, /revoke all privileges on sequence public\.positions_id_seq\s+from public, anon, authenticated/i);
  assert.match(migration, /grant usage, select on sequence public\.positions_id_seq to authenticated/i);
});

test("position parent election is immutable even when the update repeats its current ID", () => {
  const trigger = functionDefinition("prevent_position_election_change");
  assert.match(trigger, /new\.election_id is distinct from old\.election_id/i);
  assert.match(migration, /before update of election_id on public\.positions[\s\S]*?when \(old\.election_id is distinct from new\.election_id\)/i);
});

test("reorder preserves its ordering validation and adds trusted caller/scope/lifecycle checks", () => {
  assert.match(reorder, /auth\.uid\(\) is null/i);
  assert.match(reorder, /kandid_can_mutate_election_positions\(p_election_id\)/i);
  assert.match(reorder, /all reordered positions must belong to the selected election/i);
  assert.match(reorder, /display order conflicts with another position in this election/i);
  assert.match(migration, /revoke all on function public\.reorder_election_positions\([\s\S]*?from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.reorder_election_positions\([\s\S]*?to authenticated/i);
});
