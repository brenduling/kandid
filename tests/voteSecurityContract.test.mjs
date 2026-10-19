import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(root, "supabase/migrations/20261009160000_secure_vote_access_contract.sql");
const edgePath = path.join(root, "supabase/functions/vote-access/index.ts");
const verificationPath = path.join(root, "supabase/runtime-validation/vote_security_contract_readonly.sql");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  }));
  return paths.flat();
}

test("browser source has no direct vote or ballot table requests", async () => {
  const files = await sourceFiles(path.join(root, "src"));
  const directVoteRequest = /\.from\s*\(\s*["'](?:votes|vote_ballots)["']\s*\)/;
  const matches = [];
  for (const file of files) {
    const contents = await readFile(file, "utf8");
    if (directVoteRequest.test(contents)) matches.push(path.relative(root, file));
  }
  assert.deepEqual(matches, []);
});

test("forward migration removes browser policies and all direct vote privileges", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /drop policy if exists "open votes" on public\.votes/i);
  assert.match(sql, /drop policy if exists "votes_all_access" on public\.votes/i);
  assert.match(sql, /revoke all privileges on table public\.votes from public, anon, authenticated/i);
  assert.match(sql, /revoke all privileges on table public\.vote_ballots from public, anon, authenticated/i);
  assert.match(sql, /revoke all privileges on sequence public\.votes_id_seq from public, anon, authenticated/i);
  assert.match(sql, /grant select on table public\.votes to service_role/i);
  assert.match(sql, /grant execute on function public\.kandid_record_verified_legacy_vote_anchor[\s\S]*?to service_role/i);
  assert.match(sql, /grant select on table public\.vote_ballots to service_role/i);
  assert.match(sql, /has_table_privilege\('authenticated', 'public\.votes', 'TRUNCATE'\)/i);
  assert.match(sql, /has_table_privilege\('authenticated', 'public\.votes', 'TRIGGER'\)/i);
  assert.match(sql, /revoke all on function public\.insert_v2_vote_rows\(integer, integer, jsonb\)\s+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.insert_v2_vote_rows\(integer, integer, jsonb\)\s+to service_role/i);
  assert.match(sql, /revoke all on function public\.claim_next_ballot_anchor\(\)\s+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.claim_next_ballot_anchor\(\)\s+to service_role/i);
  assert.match(sql, /has_function_privilege\('anon', resolved\.procedure_oid, 'EXECUTE'\)/i);
  assert.match(sql, /not has_function_privilege\('service_role', resolved\.procedure_oid, 'EXECUTE'\)/i);
  assert.match(sql, /SECURITY DEFINER vote submission owner cannot advance public\.votes_id_seq/i);
  assert.match(sql, /has_sequence_privilege\('postgres', 'public\.votes_id_seq', 'USAGE'\)/i);
  assert.match(sql, /vote RLS policies differ from the reviewed pre-migration state/i);
  assert.match(sql, /policyname not in \('open votes', 'votes_all_access'\)/i);
  assert.match(sql, /cardinality\(roles\) <> 2/i);
  assert.doesNotMatch(sql, /for policy_row in[\s\S]*?execute format\(\s*'drop policy/i);
  assert.doesNotMatch(sql, /(?:insert\s+into|delete\s+from)\s+public\.(?:votes|vote_ballots)/i);
  assert.equal((sql.match(/update\s+public\.votes/gi) || []).length, 1);
  assert.match(sql, /create or replace function public\.kandid_record_verified_legacy_vote_anchor[\s\S]*?update public\.votes[\s\S]*?where id = p_vote_id[\s\S]*?ballot_id is null[\s\S]*?blockchain_tx_id is null/i);
});

test("trusted access derives identity and scopes each action", async () => {
  const source = await readFile(edgePath, "utf8");
  for (const action of [
    "student_has_voted",
    "student_voted_elections",
    "student_receipts",
    "election_results",
    "board_dashboard_counts",
    "super_admin_vote_count",
    "super_admin_vote_report",
    "super_admin_voting_monitor",
    "super_admin_blockchain_queue",
    "prepare_vote_anchor",
    "vote_dependency_count",
    "confirm_vote_anchor",
  ]) {
    assert.ok(source.includes(`action === "${action}"`), `missing ${action} handler`);
  }
  assert.match(source, /authClient\.auth\.getUser\(\)/);
  assert.match(source, /isActiveStudentForAuthUser\(student, authId\)/);
  assert.match(source, /isActiveAdminForAuthUser\(profile, authId, role\)/);
  assert.match(source, /boardCanAccessOrganization\(profile, election\.organization_id\)/);
  assert.match(source, /authClient\.rpc\("kandid_get_election_turnout"/);
  assert.match(source, /boardCanAccessOrganization\(profile, election\.organization_id\)/);
});

test("Student receipt response and Super Admin monitor omit voter-to-candidate mappings", async () => {
  const source = await readFile(edgePath, "utf8");
  const receiptSelect = source.match(/action === "student_receipts"[\s\S]*?\.select\("([^"]+)"\)/)?.[1] || "";
  assert.ok(receiptSelect);
  assert.doesNotMatch(receiptSelect, /student_id|candidate_id/);
  const monitor = source.slice(source.indexOf('action === "super_admin_voting_monitor"'), source.indexOf('action === "super_admin_blockchain_queue"'));
  assert.match(monitor, /\.select\("election_id, student_id, vote_timestamp, blockchain_anchor_status"\)/);
  assert.match(monitor, /return response\(\{ data: \{ rows: \[\.\.\.grouped\.values\(\)\]\.map\(\(item\) => \(\{/);
  assert.doesNotMatch(monitor.slice(monitor.indexOf("map((item) => ({")), /student_id|candidate_id|vote_hash/);
});

test("manual legacy anchor confirmation requires a verified Sepolia registry event", async () => {
  const source = await readFile(edgePath, "utf8");
  const evidence = await readFile(path.join(root, "supabase/functions/_shared/legacyVoteAnchorEvidence.mjs"), "utf8");
  const anchorHandler = source.slice(source.indexOf('action === "confirm_vote_anchor"'));
  assert.match(anchorHandler, /requireAdmin\(admin, authId, "super_admin"\)/);
  assert.match(anchorHandler, /expectedChainId: 11155111n/);
  assert.match(anchorHandler, /parseRegistryEvent: \(log\) => registryInterface\.parseLog\(log\)/);
  assert.match(anchorHandler, /isVoteHashRecorded: \(hash\) => contract\.isVoteHashRecorded\(hash\)/);
  assert.match(anchorHandler, /vote\.ballot_id \|\| vote\.vote_hash !== voteHash \|\| vote\.blockchain_tx_id/);
  assert.match(anchorHandler, /admin\.rpc\("kandid_record_verified_legacy_vote_anchor"/);
  assert.match(anchorHandler, /p_transaction_hash: evidence\.transaction_hash/);
  assert.match(anchorHandler, /p_block_number: evidence\.block_number/);
  assert.match(anchorHandler, /p_anchored_at: evidence\.anchored_at/);
  assert.match(evidence, /Number\(receipt\.status\) !== 1/);
  assert.match(evidence, /sameHex\(receipt\.to, configuredContractAddress\)/);
  assert.match(evidence, /sameHex\(receipt\.hash, requestedTransactionHash\)/);
  assert.match(evidence, /event\?\.name === "VoteHashRecorded"/);
  assert.match(evidence, /sameHex\(block\.hash, receipt\.blockHash\)/);
  assert.match(source, /action === "prepare_vote_anchor"[\s\S]*?requireAdmin\(admin, authId, "super_admin"\)[\s\S]*?blockchain_anchor_status === "manual_review"/);
});

test("read-only privilege report handles the new function being absent before migration", async () => {
  const sql = await readFile(verificationPath, "utf8");
  assert.match(sql, /to_regprocedure\(signature\)/i);
  assert.match(sql, /info: expected absent until migration/i);
  assert.doesNotMatch(sql, /'public\.kandid_record_verified_legacy_vote_anchor[^']*'::regprocedure/i);
  assert.match(sql, /has_table_privilege\(role_name, table_name, 'SELECT'\)/i);
  assert.match(sql, /pg_has_role\(requested\.role_oid, granted\.oid, 'USAGE'\)/i);
  assert.match(sql, /expected_execution_contract_holds/i);
  assert.match(sql, /public\.mark_vote_anchor_success\(integer,text,text,text,text,bigint\)/i);
  assert.match(sql, /public\.claim_next_submitted_ballot_anchor\(\)/i);
});

test("trusted vote submission and anchoring RPCs deny browser execution but retain service execution", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const submitFunction = await readFile(path.join(root, "supabase/migrations/20260913155000_create_ballot_v1_submission_rpc.sql"), "utf8");
  const submitEdge = await readFile(path.join(root, "supabase/functions/submit-vote/index.ts"), "utf8");
  const anchorMigration = await readFile(path.join(root, "supabase/migrations/20260913160000_ballot_anchor_worker_rpcs.sql"), "utf8");
  const insertRpc = submitFunction.slice(submitFunction.indexOf("create or replace function public.insert_v2_vote_rows"), submitFunction.indexOf("alter function public.insert_v2_vote_rows"));
  const claimRpc = anchorMigration.slice(anchorMigration.indexOf("create or replace function public.claim_next_ballot_anchor"), anchorMigration.indexOf("create or replace function public.claim_next_submitted_ballot_anchor"));

  assert.match(insertRpc, /security definer/i);
  assert.match(insertRpc, /set search_path = pg_catalog, public/i);
  assert.doesNotMatch(insertRpc, /auth\.uid\s*\(/i);
  assert.match(claimRpc, /security definer/i);
  assert.match(claimRpc, /update public\.vote_ballots[\s\S]*?return query[\s\S]*?ballot_hash/i);
  assert.match(submitEdge, /authClient\.auth\.getUser\(\)/);
  assert.match(submitEdge, /\.eq\("auth_user_id", authUser\.id\)/);
  assert.match(submitEdge, /p_student_id: Number\(student\.id\)/);
  assert.match(submitEdge, /adminClient\.rpc\([\s\S]*?"insert_v2_vote_rows"/);
  assert.match(migration, /revoke all on function public\.insert_v2_vote_rows\(integer, integer, jsonb\)\s+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.insert_v2_vote_rows\(integer, integer, jsonb\)\s+to service_role/i);
  assert.match(migration, /revoke all on function public\.claim_next_ballot_anchor\(\)\s+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.claim_next_ballot_anchor\(\)\s+to service_role/i);
  assert.match(migration, /has_function_privilege\('authenticated', resolved\.procedure_oid, 'EXECUTE'\)/i);
  assert.match(migration, /not has_function_privilege\('service_role', resolved\.procedure_oid, 'EXECUTE'\)/i);
});
