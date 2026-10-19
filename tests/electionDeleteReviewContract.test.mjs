import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAllowedDevelopmentProductionRequest } from "../src/utils/developmentProductionWriteGuard.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/pages/board/Elections.jsx");
const sheet = read("../src/pages/board/BoardElectionDeleteSheet.jsx");
const superAdmin = read("../src/pages/superadmin/Elections.jsx");
const sql = read("../supabase/migrations/20261018130000_password_protected_election_soft_removal.sql");
const edge = read("../supabase/functions/manage-election-removal/index.ts");
const config = read("../supabase/config.toml");

test("Board and Super Admin filter removal columns only after backend readiness verification", () => {
  for (const source of [page, superAdmin]) {
    assert.match(source, /verifyElectionRemovalReadiness\(requested, callElectionRemoval\)/);
    assert.match(source, /electionManagementQuery\(supabase, \{[^}]*removalReady: ready/);
    assert.doesNotMatch(source, /\.is\("removed_at", null\)/);
    assert.match(source, /\{removalReady \? <button[^\n]*openRemovedElections/);
  }
});

test("related review leads to a password-protected Danger Zone without permanent delete controls", () => {
  assert.match(sheet, /Continue to Danger Zone/);
  assert.match(sheet, /type="password"/);
  assert.match(sheet, /autoComplete="current-password"/);
  assert.match(sheet, /Confirm Removal/);
  assert.match(sheet, /votes, ballots, frozen electorate, receipts, results, blockchain evidence/i);
  assert.doesNotMatch(page, /\.from\("elections"\)\.delete\(\)/);
  assert.doesNotMatch(superAdmin, /\.from\("elections"\)\.delete\(\)/);
});

test("Edge verifies JWT user, active admin scope, and current password for that same Auth identity", () => {
  assert.match(edge, /sessionClient\.auth\.getUser\(\)/);
  assert.match(edge, /admin\.from\("admin_users"\)[\s\S]*?\.eq\("auth_user_id", authId\)/);
  assert.match(edge, /signInWithPassword\(\{ email, password \}\)/);
  assert.match(edge, /data\.user\?\.id === authId/);
  assert.doesNotMatch(edge, /admin_users[\s\S]{0,400}\.select\([^)]*password/i);
  assert.doesNotMatch(edge, /console\.(log|error|warn).*password/i);
  assert.match(edge, /data\.user\?\.id === authId/);
  assert.match(edge, /role === "electoral_board"[\s\S]*?organization_id/);
  assert.match(config, /\[functions\.manage-election-removal\]\s+verify_jwt = true/);
});

test("review and Removed Elections actions are read-only and reject extra fields", () => {
  assert.match(edge, /if \(action === "review"\)[\s\S]*?loadDependencySummary/);
  assert.match(edge, /if \(action === "list_removed"\)[\s\S]*?admin\.role === "electoral_board"/);
  assert.match(edge, /\["soft_remove", "restore"\]/);
  assert.match(edge, /Action is not supported/);
  assert.match(sql, /create or replace function public\.kandid_get_election_removal_electorate_count[\s\S]*?returns bigint[\s\S]*?select count\(\*\) into electorate_count from private\.election_eligible_voters/i);
});

test("removal and restore are atomic RPC operations restricted to service_role", () => {
  assert.match(sql, /create or replace function public\.kandid_soft_remove_election[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i);
  assert.match(sql, /create or replace function public\.kandid_restore_removed_election[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i);
  assert.match(sql, /grant execute on function public\.kandid_soft_remove_election\(integer, uuid\) to service_role/i);
  assert.match(sql, /grant execute on function public\.kandid_restore_removed_election\(integer, uuid\) to service_role/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /election_soft_removed/);
  assert.match(sql, /election_restored/);
  assert.match(sql, /Only draft or concluded elections can be removed/);
  assert.match(sql, /Active, scheduled, campaigning, waiting, or voting elections are protected/);
  assert.match(sql, /cannot be physically deleted/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.elections|on delete cascade/i);
});

test("removed election child writes are guarded and history is not rewritten", () => {
  assert.match(sql, /for key share/i);
  assert.match(sql, /related records are read-only/i);
  assert.match(sql, /'public\.votes'[\s\S]*?'public\.vote_ballots'[\s\S]*?'private\.election_eligible_voters'/i);
  assert.match(sql, /create trigger guard_removed_election_mutation before insert or update or delete on %I\.%I/i);
  assert.doesNotMatch(sql, /update\s+public\.(votes|vote_ballots|audit_logs|election_eligible_voters)/i);
});

test("election state trigger checks the caller instead of running as SECURITY DEFINER", () => {
  const stateGuard = sql.match(/create or replace function private\.kandid_guard_election_removal_state\(\)([\s\S]*?)\$function\$;/i)?.[1] || "";
  assert.match(stateGuard, /returns trigger[\s\S]*?set search_path = pg_catalog/i);
  assert.doesNotMatch(stateGuard, /security definer/i);
  assert.match(stateGuard, /current_user <> 'postgres'/i);
});

test("migration preflight fails closed on missing dependencies and pre-existing target objects", () => {
  assert.match(sql, /required_relations text\[\][\s\S]*?'public\.election_officer_publications'[\s\S]*?'public\.archived_elections'/i);
  assert.match(sql, /Required election dependency relation % is missing/);
  assert.match(sql, /Election soft-removal function names already exist/);
  assert.match(sql, /Election soft-removal trigger names already exist/);
  assert.match(sql, /Election dependency columns do not match the reviewed trigger contract/);
  assert.match(sql, /Election removal marker or index already exists/);
  assert.match(sql, /^\s*begin;[\s\S]*commit;\s*$/i);
});

test("unknown and in-progress phases cannot be soft removed", () => {
  assert.match(sql, /if normalized_status in \('draft', 'archived', 'closed', 'done'\) then return true; end if;[\s\S]*?if normalized_status <> 'active' then return false; end if;/i);
  assert.match(sql, /Active, scheduled, campaigning, waiting, or voting elections are protected/);
});

test("Removed Elections retrieval is authenticated and organization-scoped", () => {
  assert.match(edge, /if \(action === "list_removed"\)/);
  assert.match(edge, /admin\.role === "electoral_board"\) query = query\.eq\("organization_id", admin\.organization_id\)/);
  assert.match(edge, /\.not\("removed_at", "is", null\)/);
  assert.match(superAdmin, /Removed Elections/);
  assert.match(page, /Removed Elections/);
  assert.match(superAdmin, /mode: "restore"/);
  assert.match(page, /mode: "restore"/);
});

test("soft-removal writes stay default-off behind a scoped local flag", () => {
  const guard = read("../src/utils/developmentProductionWriteGuard.js");
  const gate = read("../src/utils/electionRemovalFeatureGate.js");
  assert.match(gate, /VITE_ENABLE_ELECTION_SOFT_REMOVAL === "true"/);
  const request = {
    input: "https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/manage-election-removal",
    method: "POST",
  };
  assert.equal(isAllowedDevelopmentProductionRequest({ ...request, body: JSON.stringify({ action: "list_removed" }) }), true);
  for (const action of ["soft_remove", "restore"]) {
    assert.equal(isAllowedDevelopmentProductionRequest({
      ...request,
      body: JSON.stringify({ action, election_id: 4, password: "transient" }),
    }), false);
  }
  assert.match(guard, /allowElectionSoftRemoval = false/);
  assert.doesNotMatch(read("../src/pages/board/Elections.jsx"), /localStorage\.setItem\([^\n]*password/i);
});
