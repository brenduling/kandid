import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = "../supabase/migrations/20261018100000_masterlist_import_scope_and_safe_finalization.sql";
const [migration, edge, utility, intake, review, programMembership, submitVote] = await Promise.all([
  readFile(new URL(migrationPath, import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/super-admin-masterlist-import/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/utils/superAdminMasterlistImport.js", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/superadmin/CSVImport.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/superadmin/MasterlistReview.jsx", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261017000000_reconcile_memberships_on_current_term_program_change.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/submit-vote/index.ts", import.meta.url), "utf8"),
]);

function functionBody(source, signature, endMarker) {
  const start = source.toLowerCase().indexOf(signature.toLowerCase());
  assert.notEqual(start, -1, `missing function: ${signature}`);
  const end = source.toLowerCase().indexOf(endMarker.toLowerCase(), start);
  assert.notEqual(end, -1, `missing end marker for: ${signature}`);
  return source.slice(start, end);
}

test("legacy imports and new imports fail safe as incremental by default", () => {
  assert.match(migration, /add column if not exists import_scope text not null default 'incremental'/i);
  assert.match(migration, /check \(import_scope in \('incremental', 'full_roster'\)\)/i);
  assert.match(migration, /adding the non-null default classifies every pre-existing import as[\s\S]*?incremental/i);
  assert.match(edge, /body\.import_scope === undefined \? "incremental"/);
  assert.match(edge, /import_scope: importScope/);
  assert.match(utility, /importScope = "incremental"/);
  assert.match(intake, /Incremental \(default\)/);
  assert.match(intake, /Complete full-term roster/);
});

test("a one-Student incremental finalization cannot sweep absent Students", () => {
  const core = functionBody(
    migration,
    "create or replace function public.finalize_masterlist_import(target_import_id integer)",
    "create or replace function public.kandid_finalize_masterlist_import_with_membership_sync(",
  );
  const wrapper = functionBody(
    migration,
    "create or replace function public.kandid_finalize_masterlist_import_with_membership_sync(",
    "alter function public.kandid_masterlist_full_roster_manifest",
  );

  assert.doesNotMatch(core, /not_in_masterlist/i);
  assert.match(wrapper, /if import_scope = 'full_roster' then[\s\S]*?insert into public\.student_term_enrollments[\s\S]*?'not_in_masterlist'/i);
  assert.match(wrapper, /if import_scope is null or import_scope not in \('incremental', 'full_roster'\) then[\s\S]*?scope is missing or unknown/i);
  assert.match(migration, /not exists \([\s\S]*?mir\.reconciliation_status in \('continuing', 'shifted_program', 'returnee'\)/i);
});

test("full-roster absence sweep requires active Super Admin confirmation and fresh preview", () => {
  assert.match(migration, /kandid_preview_masterlist_full_roster\([\s\S]*?a\.role = 'super_admin'[\s\S]*?a\.status = 'active'/i);
  assert.match(migration, /kandid_confirm_masterlist_full_roster\([\s\S]*?p_expected_fingerprint is distinct from current_manifest->>'fingerprint'/i);
  assert.match(migration, /confirmation_actor is distinct from p_actor_admin_id or confirmation_at is null/i);
  assert.match(migration, /confirmation_fingerprint is distinct from current_manifest->>'fingerprint'/i);
  assert.match(edge, /body\.confirm_full_roster !== true/);
  assert.match(edge, /kandid_confirm_masterlist_full_roster/);
  assert.match(review, /affected Student preview/i);
  assert.match(review, /confirmFullRoster: true/);
});

test("a changed affected-Student population between confirmation and finalization is blocked", () => {
  const wrapper = functionBody(
    migration,
    "create or replace function public.kandid_finalize_masterlist_import_with_membership_sync(",
    "alter function public.kandid_masterlist_full_roster_manifest",
  );
  const tableLock = wrapper.indexOf("lock table public.student_term_enrollments in share row exclusive mode");
  const manifestRecheck = wrapper.indexOf("current_manifest := public.kandid_masterlist_full_roster_manifest(p_import_id)");
  const fingerprintCheck = wrapper.indexOf("confirmation_fingerprint is distinct from current_manifest->>'fingerprint'");
  const absenceSweep = wrapper.indexOf("'not_in_masterlist', 'masterlist'");

  assert.ok(tableLock >= 0, "full-roster finalization must prevent concurrent enrollment writes");
  assert.ok(tableLock < manifestRecheck, "the enrollment lock must be taken before fresh manifest validation");
  assert.ok(manifestRecheck < fingerprintCheck, "the fresh affected-Student population must be checked against confirmation");
  assert.ok(fingerprintCheck < absenceSweep, "the absence sweep must run only after the confirmation is revalidated");
  assert.match(wrapper, /from jsonb_array_elements\(current_manifest->'affected_students'\)/i);
  assert.doesNotMatch(wrapper, /select candidate\.id into previous_term_id/i);
  assert.match(migration, /'affected_students', affected_students/i);
  assert.match(migration, /'year_level', absent\.year_level[\s\S]*?'is_shs', absent\.is_shs/i);
  assert.match(wrapper, /Full-roster preview changed after confirmation/);
});

test("only an authenticated active Super Admin can select, preview, confirm, or finalize scope", () => {
  const authFunction = functionBody(edge, "async function requireSuperAdmin(", "async function auditSuperAdminImport(");
  const handler = edge.slice(edge.indexOf("serveWithKandidCors(async (request"));
  const authGate = handler.indexOf("await requireSuperAdmin(request");
  const actionDispatch = handler.indexOf("const action = String(body.action || \"\")");

  assert.match(authFunction, /authClient\.auth\.getUser\(\)/);
  assert.match(authFunction, /adminProfile\.role !== "super_admin"/);
  assert.match(authFunction, /adminProfile\.status !== "active"/);
  assert.ok(authGate >= 0 && authGate < actionDispatch, "the authorization gate must precede action dispatch");
  assert.match(edge, /\.insert\(\[\{ academic_term_id: academicTermId,[\s\S]*?import_scope: importScope \}\]\)/);
  assert.match(edge, /kandid_preview_masterlist_full_roster[\s\S]*?p_actor_admin_id: actorAdminId/);
  assert.match(edge, /kandid_confirm_masterlist_full_roster[\s\S]*?p_actor_admin_id: Number\(auth\.adminProfile\.id\)/);
  assert.match(edge, /kandid_finalize_masterlist_import_with_membership_sync/);
  assert.doesNotMatch(edge, /\.from\("masterlist_imports"\)\s*\.update\(/);
});

test("missing and unknown import scopes fail closed and never imply full-roster permission", () => {
  assert.match(migration, /target_scope is distinct from 'full_roster'/i);
  assert.match(migration, /target_scope not in \('incremental', 'full_roster'\)[\s\S]*?scope is missing or unknown/i);
  assert.match(edge, /!\["incremental", "full_roster"\]\.includes\(importScope\.import_scope\)/);
  assert.match(review, /This import has a missing or unknown scope\. Finalization is blocked/i);
  assert.match(migration, /import_scope text not null default 'incremental'/i);
});

test("BSIT to BSHM reconciliation remains targeted to included Students and preserves WITSG", () => {
  assert.match(programMembership, /set status = 'removed'[\s\S]*?removal_reason = 'program_change_reconciliation'/i);
  assert.match(programMembership, /o\.membership_scope = 'institution'[\s\S]*?o\.membership_scope = 'program'/i);
  assert.match(programMembership, /where mir\.import_id = p_import_id[\s\S]*?mir\.reconciliation_status in \('new', 'continuing', 'shifted_program', 'returnee'\)/i);
});

test("automatic voting still delegates current-term enrollment to its canonical backend", async () => {
  assert.match(submitVote,/authClient\.rpc\(\s*"kandid_check_student_ballot_eligibility"/);
  const current=await readFile(new URL('../supabase/proposals/automatic-voter-eligibility.core.sql',import.meta.url),'utf8');
  assert.match(current,/ste\.enrollment_status='enrolled'/);
});

test("scope migration changes no election, ballot, vote, or historical evidence tables", () => {
  assert.doesNotMatch(migration, /(?:insert|update|delete|truncate)\s+(?:into\s+|from\s+)?public\.(?:votes|vote_ballots|elections|election_electorates|ballot_anchors|vote_anchor_jobs)\b/i);
  assert.match(migration, /revoke all on function public\.kandid_finalize_masterlist_import_with_membership_sync\(integer, bigint\) from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.kandid_finalize_masterlist_import_with_membership_sync\(integer, bigint\) to service_role/i);
});
