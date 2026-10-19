import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hasDuplicateCandidateSelection } from "../supabase/functions/_shared/ballotSelection.js";
import { optionalPositiveId } from "../supabase/functions/_shared/idValidation.js";
import { buildOfficerRpcOperation } from "../supabase/functions/_shared/officersRpcOperations.js";

const migration = await readFile(
  new URL("../supabase/migrations/20260929110000_trusted_officers_contract.sql", import.meta.url),
  "utf8",
);
const lockdown = await readFile(
  new URL("../supabase/migrations/20260929120000_lock_down_officers_direct_access.sql", import.meta.url),
  "utf8",
);
const edge = await readFile(
  new URL("../supabase/functions/officers-contract/index.ts", import.meta.url),
  "utf8",
);
const rpcOperations = await readFile(
  new URL("../supabase/functions/_shared/officersRpcOperations.js", import.meta.url),
  "utf8",
);
const board = await readFile(new URL("../src/pages/board/Officers.jsx", import.meta.url), "utf8");
const dialogSource = await readFile(new URL("../src/pages/board/IncomingAppointmentDialog.jsx", import.meta.url), "utf8");
const superAdmin = await readFile(new URL("../src/pages/superadmin/Officers.jsx", import.meta.url), "utf8");
const results = await Promise.all([
  readFile(new URL("../src/pages/board/Results.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/superadmin/Results.jsx", import.meta.url), "utf8"),
]);

test("officer selection blocks duplicate candidate rows per position, not abstentions", () => {
  assert.equal(hasDuplicateCandidateSelection([
    { position_id: 1, candidate_id: 9, is_abstain: false },
    { position_id: 1, candidate_id: 9, is_abstain: false },
  ]), true);
  assert.equal(hasDuplicateCandidateSelection([
    { position_id: 1, candidate_id: 9, is_abstain: false },
    { position_id: 2, candidate_id: 9, is_abstain: false },
  ]), false);
  assert.equal(hasDuplicateCandidateSelection([
    { position_id: 1, candidate_id: null, is_abstain: true },
    { position_id: 1, candidate_id: null, is_abstain: true },
  ]), false);
});

test("trusted officers SQL binds mutations to auth.uid and active Board/Super Admin profiles", () => {
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /a\.status = 'active'/);
  assert.match(migration, /a\.role in \('electoral_board', 'super_admin'\)/);
  assert.match(migration, /admin_row\.organization_id is distinct from candidate_row\.organization_id/);
  assert.match(migration, /admin_row\.organization_id is distinct from officer_row\.organization_id/);
  for (const action of ["kandid_create_elected_officer", "kandid_create_appointed_officer", "kandid_update_officer_service", "kandid_retire_officer", "kandid_delete_officer"]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${action}\\(`));
  }
});

test("winner resolution is server-side, excludes abstentions and unresolved ties", () => {
  assert.match(migration, /v\.is_abstain is false/);
  assert.match(migration, /highest_candidate_count > 1 then 'tie'/);
  assert.match(migration, /s\.highest_total = 0 then 'no_winner'/);
  assert.match(migration, /'candidate_id', d\.winner_candidate_id/);
  assert.doesNotMatch(migration, /'student_id', d\.winner_student_id/);
  assert.match(migration, /unique index officers_elected_election_position_uidx/);
});

test("winners request without election_id reaches its RPC operation with null", () => {
  const request = { action: "winners", organization_id: 1 };
  const operation = buildOfficerRpcOperation(request.action, request);

  assert.equal(operation.name, "kandid_get_officer_winners");
  assert.deepEqual(operation.args, { p_election_id: null, p_organization_id: 1 });
  for (const electionId of [null, ""]) {
    const optionalOperation = buildOfficerRpcOperation("winners", { ...request, election_id: electionId });
    assert.deepEqual(optionalOperation.args, { p_election_id: null, p_organization_id: 1 });
  }
  assert.match(edge, /buildOfficerRpcOperation\(action, body\)/);
});

test("winners validate a supplied election_id while preserving the organization", () => {
  const request = { action: "winners", organization_id: 1, election_id: 5 };
  const operation = buildOfficerRpcOperation(request.action, request);

  assert.deepEqual(operation.args, { p_election_id: 5, p_organization_id: 1 });
  assert.throws(() => buildOfficerRpcOperation("winners", { ...request, election_id: 0 }), /Election is required/);
  assert.throws(() => buildOfficerRpcOperation("winners", { ...request, election_id: "abc" }), /Election is required/);
});

test("manual New Officers actions map only trusted RPC arguments", () => {
  assert.deepEqual(
    buildOfficerRpcOperation("incoming_leadership", { organization_id: 7 }),
    { name: "kandid_get_incoming_leadership", args: { p_organization_id: 7 } },
  );
  assert.deepEqual(
    buildOfficerRpcOperation("add_incoming_elected", {
      organization_id: 7,
      candidate_id: 19,
      service: { term_label: "AY 2026–2027" },
    }),
    {
      name: "kandid_add_incoming_elected_officer",
      args: {
        p_organization_id: 7,
        p_candidate_id: 19,
        p_service: { term_label: "AY 2026–2027" },
      },
    },
  );
  assert.deepEqual(
    buildOfficerRpcOperation("add_incoming_appointed", {
      organization_id: 7,
      student_id: 42,
      position_title: "Treasurer",
      service: { term_label: "AY 2026–2027" },
    }),
    {
      name: "kandid_add_incoming_appointed_officer",
      args: {
        p_organization_id: 7,
        p_student_id: 42,
        p_position_title: "Treasurer",
        p_service: { term_label: "AY 2026–2027" },
      },
    },
  );
  assert.deepEqual(
    buildOfficerRpcOperation("update_new_officer", { new_officer_id: 5, organization_id: 7, changes: { service: {} } }),
    { name: "kandid_update_new_officer", args: { p_new_officer_id: 5, p_organization_id: 7, p_changes: { service: {} } } },
  );
  assert.deepEqual(
    buildOfficerRpcOperation("remove_new_officer", { new_officer_id: 5, organization_id: 7 }),
    { name: "kandid_remove_new_officer", args: { p_new_officer_id: 5, p_organization_id: 7 } },
  );
  assert.deepEqual(
    buildOfficerRpcOperation("release_leadership", { organization_id: 7 }),
    { name: "kandid_release_officer_leadership", args: { p_organization_id: 7 } },
  );
});

test("finalize_results alone requires an election ID", () => {
  assert.throws(
    () => buildOfficerRpcOperation("finalize_results", { action: "finalize_results" }),
    /Election is required/,
  );
  assert.equal(optionalPositiveId(undefined, "Election"), null);
});

test("edge contract exposes the explicit operations and does not accept client authority fields", () => {
  const actionContract = `${edge}\n${rpcOperations}`;
  for (const action of ["winners", "finalize_results", "update_service", "delete", "list", "student_counts", "incoming_leadership", "add_incoming_elected", "add_incoming_appointed", "update_new_officer", "remove_new_officer", "release_leadership"]) {
    assert.match(actionContract, new RegExp(`action === "${action}"|case "${action}"`));
  }
  for (const obsoleteAction of ["create_elected", "create_appointed", "retire", "remove_incoming_appointment"]) {
    assert.doesNotMatch(actionContract, new RegExp(`action === "${obsoleteAction}"|case "${obsoleteAction}"`));
  }
  assert.match(edge, /auth\.getUser\(\)/);
  assert.match(edge, /profile\.status !== "active"/);
  assert.doesNotMatch(edge, /body\.(role|auth_user_id|selection_type)/);
});

test("officers responses expose authoritative leadership year without using semester joins for tenure", () => {
  assert.match(edge, /term_label, term_start, term_end, academic_term_id, leadership_academic_year/);
  assert.match(edge, /if \(action === "incoming_leadership"\)[\s\S]*kandid_get_officer_leadership_context/);
  assert.match(edge, /p_organization_id: operation\.args\.p_organization_id/);
  assert.match(edge, /leadership_academic_year: yearById\.get\(String\(row\.id\)\) \|\| null/);
  assert.match(edge, /leadership_academic_year: yearContext\.leadership_academic_year \|\| null/);
  assert.match(edge, /current_leadership_academic_year: yearContext\.current_leadership_academic_year \|\| null/);
  assert.doesNotMatch(edge, /academic_term:academic_terms\(semester, academic_year\)/);
  assert.match(edge, /Current Leadership has conflicting academic years\. Resolve its leadership year before adding or releasing officers\./);
  assert.match(edge, /Establish one authoritative academic year before adding or releasing officers\./);
});

test("Board and Super Admin officer UI use contract actions instead of direct table DML", () => {
  for (const source of [board, superAdmin]) {
    assert.match(source, /officersContract\("list"\)/);
    assert.match(source, /officersContract\("update_service"/);
    assert.match(source, /officersContract\("delete"/);
    assert.match(source, /officersContract\("incoming_leadership"/);
    assert.match(source, /officersContract\("add_incoming_elected"/);
    assert.match(source, /officersContract\("add_incoming_appointed"/);
    assert.match(source, /officersContract\("update_new_officer"/);
    assert.match(source, /officersContract\("remove_new_officer"/);
    assert.match(source, /officersContract\("release_leadership"/);
    assert.doesNotMatch(source, /\.from\("officers"\)\.(insert|update|delete)/);
    assert.doesNotMatch(source, /form\.is_current|Mark as current officer|Current leadership<\/strong>/);
  }
  assert.match(board + dialogSource, /Verified winners/);
  assert.match(board, /Add officer/);
  assert.match(board, /Past Leadership/);
  assert.match(superAdmin, /New Officers/);
  assert.match(superAdmin, /Add Officer/);
  assert.match(superAdmin, /Past/);
});

test("both result publication screens call trusted finalization", () => {
  for (const source of results) {
    assert.match(source, /supabase\.rpc\(\s*"kandid_finalize_officer_results"/);
    assert.doesNotMatch(source, /\.from\("elections"\)\s*\.update\(\{[\s\S]{0,100}results_released_at/);
  }
});

test("the public roster projection grants display-only fields and omits student/provenance IDs", () => {
  const viewSql = migration.slice(migration.indexOf("create or replace view public.officer_directory"));
  const projection = viewSql.slice(0, viewSql.indexOf("from public.officers"));
  assert.match(viewSql, /grant select on table public\.officer_directory to anon, authenticated/);
  assert.doesNotMatch(projection, /student_id|candidate_id|position_id|election_id|remarks/);
});

test("B1 keeps legacy direct access until frontend cutover and installs the trusted contract", () => {
  assert.match(migration, /temporary rollout compatibility/i);
  assert.doesNotMatch(migration, /drop policy[^;]*on public\.officers/i);
  assert.doesNotMatch(migration, /revoke all(?: privileges)? on table public\.officers/i);
  assert.doesNotMatch(migration, /revoke all(?: privileges)? on sequence/i);
  assert.match(migration, /grant all on table public\.officers to service_role/i);
  assert.match(migration, /grant usage, select, update on sequence %s to service_role/i);
  assert.match(migration, /grant execute on function public\.kandid_create_appointed_officer/);
  assert.match(migration, /candidate_id integer/);
  assert.match(migration, /position_id integer/);
});

test("B2 removes all Officers policies and browser table/sequence privileges while preserving trusted paths", () => {
  assert.match(lockdown, /from pg_catalog\.pg_policies[\s\S]*p\.schemaname = 'public'[\s\S]*p\.tablename = 'officers'/);
  assert.match(lockdown, /drop policy %I on public\.officers/i);
  assert.match(lockdown, /revoke all privileges on table public\.officers\s+from public, anon, authenticated/i);
  assert.match(lockdown, /grant all privileges on table public\.officers to service_role/i);
  assert.match(lockdown, /revoke all privileges on sequence %s from public, anon, authenticated/i);
  assert.match(lockdown, /grant usage, select, update on sequence %s to service_role/i);
  assert.match(lockdown, /grant select on table public\.officer_directory to anon, authenticated/i);
  assert.doesNotMatch(lockdown, /revoke all(?: privileges)? on function/i);
});

test("runtime browser code has no direct Officers table access after cutover", async () => {
  const runtimeFiles = [
    "../src/pages/board/Officers.jsx",
    "../src/pages/superadmin/Officers.jsx",
    "../src/pages/student/Officers.jsx",
    "../src/pages/student/Dashboard.jsx",
    "../src/pages/student/Organizations.jsx",
    "../src/utils/globalSearch.js",
    "../src/utils/deleteGuards.js",
  ];
  const sources = await Promise.all(runtimeFiles.map((file) =>
    readFile(new URL(file, import.meta.url), "utf8")
  ));
  for (const source of sources) {
    assert.doesNotMatch(source, /\.from\(["']officers["']\)/);
  }
  for (const file of ["../src/pages/student/Officers.jsx", "../src/pages/student/Dashboard.jsx", "../src/pages/student/Organizations.jsx", "../src/utils/globalSearch.js"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /officer_directory/);
  }
});
