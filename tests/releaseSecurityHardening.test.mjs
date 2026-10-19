import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("release migration denies anonymous sensitive-table access and scopes authenticated election writes", async () => {
  const sql = await read("../supabase/migrations/20261012000000_release_sensitive_table_access_hardening.sql");
  assert.match(sql, /^begin;[\s\S]*notify pgrst, 'reload schema';\s*commit;\s*$/i);
  assert.doesNotMatch(sql, /\\(?:\*|\.|--)/);
  assert.match(sql, /revoke all privileges on table public\.admin_users from public, anon, authenticated/i);
  assert.match(sql, /grant select \(id, auth_user_id, email, full_name, role, status,/i);
  assert.match(sql, /admin_users_own_auth_profile[\s\S]*?admin_users\.auth_user_id = auth\.uid\(\)/i);
  assert.match(sql, /elections_public_read[\s\S]*?using \(true\)/i);
  assert.match(sql, /grant select \(id, organization_id, academic_term_id, title, cover_url,[\s\S]*?on table public\.elections to anon/i);
  assert.match(sql, /has_column_privilege\('anon', 'public\.elections', 'geo_lat', 'SELECT'\)/i);
  assert.match(sql, /elections_insert_active_admin_scope[\s\S]*?a\.role = 'super_admin'[\s\S]*?a\.organization_id = elections\.organization_id/i);
  assert.match(sql, /elections_update_active_admin_scope[\s\S]*?using \([\s\S]*?with check \(/i);
  assert.match(sql, /election_access_tokens_read_admin_scope[\s\S]*?a\.role = 'electoral_board'[\s\S]*?a\.organization_id = e\.organization_id/i);
  assert.match(sql, /revoke all privileges on table public\.votes, public\.vote_ballots from public, anon, authenticated/i);
  assert.match(sql, /trusted vote and anchoring RPC execution contract failed/i);
  assert.match(sql, /public\.claim_next_ballot_anchor\(\)/i);
  assert.match(sql, /public\.mark_ballot_manual_review\(uuid,text,text\)/i);
});

test("role matrix preserves public election reads and denies Students and cross-organization Board token access", async () => {
  const sql = await read("../supabase/migrations/20261012000000_release_sensitive_table_access_hardening.sql");
  assert.match(sql, /anon', 'public\.students', 'SELECT'/i);
  assert.match(sql, /anon', 'public\.admin_users', 'SELECT'/i);
  assert.match(sql, /anon', 'public\.election_access_tokens', 'SELECT'/i);
  assert.match(sql, /anon', 'public\.votes', 'SELECT'/i);
  assert.match(sql, /authenticated', 'public\.election_access_tokens', 'DELETE'/i);
  assert.match(sql, /grant select on table public\.election_access_tokens to authenticated/i);
  assert.match(sql, /a\.role = 'super_admin' or \(a\.role = 'electoral_board' and a\.organization_id = e\.organization_id\)/i);
  assert.match(sql, /admin_users_own_auth_profile[\s\S]*?auth_user_id = auth\.uid\(\)/i);
  assert.match(sql, /elections_insert_active_admin_scope[\s\S]*?a\.role = 'super_admin'/i);
});

test("structural student memberships deny public reads and browser writes while keeping own-link access", async () => {
  const sql = await read("../supabase/migrations/20261016100000_harden_student_membership_access.sql");
  assert.match(sql, /revoke all privileges on table public\.student_organizations from public, anon, authenticated/i);
  assert.match(sql, /grant select \(student_id, organization_id, role\)[\s\S]*to authenticated/i);
  assert.match(sql, /alter table public\.student_organizations enable row level security/i);
  assert.match(sql, /create policy student_organizations_own_student_or_super_admin_read[\s\S]*for select[\s\S]*to authenticated/i);
  assert.match(sql, /private\.kandid_can_read_student_structural_memberships\(student_id\)/i);
  assert.match(sql, /s\.auth_user_id = auth\.uid\(\)[\s\S]*s\.status = 'active'/i);
  assert.match(sql, /a\.auth_user_id = auth\.uid\(\)[\s\S]*a\.role = 'super_admin'[\s\S]*a\.status = 'active'/i);
  assert.match(sql, /security definer[\s\S]*set search_path = pg_catalog/i);
  assert.match(sql, /alter function private\.kandid_can_read_student_structural_memberships\(integer\) owner to postgres/i);
  assert.match(sql, /revoke all on function private\.kandid_can_read_student_structural_memberships\(integer\) from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute on function private\.kandid_can_read_student_structural_memberships\(integer\) to authenticated/i);
  assert.match(sql, /has_table_privilege\('anon', 'public\.student_organizations', 'SELECT'\)/i);
  assert.match(sql, /has_table_privilege\('authenticated', 'public\.student_organizations', 'DELETE'\)/i);
});

test("Student vote-code verification uses the authenticated trusted endpoint, not direct token reads", async () => {
  const votePage = await read("../src/pages/student/VotePage.jsx");
  const kiosk = await read("../src/pages/shared/KioskVoting.jsx");
  const voteAccess = await read("../supabase/functions/vote-access/index.ts");
  const helper = await read("../src/utils/voteAccess.js");
  const anonymousKioskDiscovery = kiosk.split("async function revalidateSelectedElection")[0];
  for (const source of [votePage, kiosk]) {
    assert.match(source, /verifyStudentElectionAccessCode\(/);
    assert.doesNotMatch(source, /from\("election_access_tokens"\)/);
  }
  assert.match(voteAccess, /action === "student_verify_access_code"[\s\S]*?requireStudent\(admin, authId\)/);
  assert.match(voteAccess, /scope_type === "precinct"[\s\S]*?scope_type === "batch"/);
  assert.match(voteAccess, /granted: scopeMatches/);
  assert.doesNotMatch(voteAccess, /return response\(\{ data: \{[^}]*token:/);
  assert.match(helper, /Authorization: `Bearer \$\{resolvedAccessToken\}`/);
  assert.doesNotMatch(anonymousKioskDiscovery, /geo_lat|geo_lng|geo_radius_meters/);
  assert.doesNotMatch(kiosk, /geo_lat|geo_lng|geo_radius_meters/);
  assert.match(kiosk, /verifyStudentElectionGeofence/);
  assert.match(helper, /action: "student_verify_geofence"/);
  assert.match(voteAccess, /action === "student_verify_geofence"[\s\S]*?requireStudent\(admin, authId\)/);
});

test("Administrator login no longer reads the legacy password column in the browser", async () => {
  const adminLogin = await read("../src/pages/auth/AdminLogin.jsx");
  const boardLogin = await read("../src/pages/auth/BoardLogin.jsx");
  const auth = await read("../src/utils/auth.js");
  for (const source of [adminLogin, boardLogin]) {
    assert.match(source, /supabase\.auth\.signInWithPassword\(/);
    assert.doesNotMatch(source, /from\("admin_users"\)/);
    assert.doesNotMatch(source, /password\s*,\s*full_name/);
  }
  assert.match(auth, /const ADMIN_AUTH_MODE = "supabase"/);
});
