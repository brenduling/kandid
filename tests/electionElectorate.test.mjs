import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261002150000_freeze_election_electorates.sql", "utf8");
const submitVote = readFileSync("supabase/functions/submit-vote/index.ts", "utf8");
const setup = readFileSync("src/pages/board/BoardElectionSetup.jsx", "utf8");
const electoratePanel = readFileSync("src/pages/board/ElectionElectoratePanel.jsx", "utf8");
const reports = readFileSync("src/pages/board/Reports.jsx", "utf8");
const turnout = readFileSync("src/utils/electionTurnout.js", "utf8");
const saReports = readFileSync("src/pages/superadmin/Reports.jsx", "utf8");
const saMonitor = readFileSync("src/pages/superadmin/VotingMonitor.jsx", "utf8");

function sqlFunction(name) {
  const start = migration.search(new RegExp(`function (?:public|private)\\.${name}`));
  assert.notEqual(start, -1, `Expected ${name}`);
  const end = migration.indexOf("$function$;", start);
  assert.notEqual(end, -1, `Expected ${name} terminator`);
  return migration.slice(start, end);
}

test("existing elections are explicitly legacy and new elections default to frozen policy", () => {
  assert.match(migration, /set electorate_policy_version = 0\s+where electorate_policy_version is null/i);
  assert.match(migration, /alter column electorate_policy_version set default 1/i);
  assert.match(migration, /electorate_policy_version <> 1[\s\S]*?cannot be pre-locked/i);
  assert.match(migration, /check \(electorate_policy_version in \(0, 1\)\)/i);
});

test("private electorate identities are inaccessible and protected by restrictive references", () => {
  assert.match(migration, /create table if not exists private\.election_eligible_voters[\s\S]*?primary key \(election_id, student_id\)/i);
  assert.match(migration, /references public\.elections\(id\) on delete restrict/i);
  assert.match(migration, /references public\.students\(id\) on delete restrict/i);
  assert.match(migration, /alter table private\.election_eligible_voters enable row level security/i);
  assert.match(migration, /revoke all on table private\.election_eligible_voters from public, anon, authenticated, service_role/i);
});

test("preview and lock derive Board scope from auth.uid and resolver uses the election academic term", () => {
  const preview = sqlFunction("kandid_get_board_electorate_preview");
  const lock = sqlFunction("kandid_lock_board_electorate");
  for (const body of [preview, lock]) {
    assert.match(body, /auth\.uid\(\)/i);
    assert.match(body, /role = 'electoral_board'[\s\S]*?status = 'active'/i);
    assert.match(body, /e\.organization_id = board_admin\.organization_id/i);
    assert.doesNotMatch(body, /p_organization_id|p_academic_term_id|student_ids|eligible_count\s+bigint\s*[,)]/i);
    assert.match(body, /resolve_student_organization_participation\([\s\S]*?election_row\.organization_id, election_row\.academic_term_id/i);
    assert.doesNotMatch(body, /eligibility_rules/i);
  }
  assert.match(preview, /returns jsonb[\s\S]*?'eligible_voters', eligible_count/i);
  assert.match(preview, /'blocking_reason', block_reason/i);
  assert.doesNotMatch(preview, /'student_id'|'voters'\s*,/i);
});

test("lock rejects cutoff misses, writes membership and audit atomically, and is idempotent", () => {
  const lock = sqlFunction("kandid_lock_board_electorate");
  assert.match(lock, /for update/i);
  assert.match(lock, /now_manila >= election_row\.start_date/i);
  assert.match(lock, /if election_row\.electorate_frozen_at is not null[\s\S]*?return pg_catalog\.jsonb_build_object/i);
  assert.match(lock, /insert into private\.election_eligible_voters[\s\S]*?update public\.elections[\s\S]*?electorate_frozen_at = pg_catalog\.clock_timestamp\(\)/i);
  assert.match(lock, /insert into public\.audit_logs[\s\S]*?'election_electorate_locked'[\s\S]*?'eligible_count', eligible_count/i);
  assert.doesNotMatch(lock, /student_id.*metadata|metadata.*student_id/i);
});

test("electorate lock emits only its dedicated event while ordinary election updates stay audited", () => {
  const lock = sqlFunction("kandid_lock_board_electorate");
  const preview = sqlFunction("kandid_get_board_electorate_preview");
  const updateTrigger = migration.match(/create trigger audit_elections_mutations_update[\s\S]*?execute function public\.kandid_audit_admin_row_change\(\);/i)?.[0];
  const insertDeleteTrigger = migration.match(/create trigger audit_elections_mutations after insert or delete on public\.elections[\s\S]*?execute function public\.kandid_audit_admin_row_change\(\);/i)?.[0];

  assert.match(migration, /drop trigger if exists audit_elections_mutations on public\.elections/i);
  assert.ok(insertDeleteTrigger, "election create/delete events retain the existing trusted writer");
  assert.ok(updateTrigger, "election updates retain the existing trusted writer behind a narrow condition");
  assert.match(updateTrigger, /pg_catalog\.to_jsonb\(old\)\s*-\s*'electorate_frozen_at'\s*-\s*'electorate_frozen_by'[\s\S]*?is distinct from[\s\S]*?pg_catalog\.to_jsonb\(new\)\s*-\s*'electorate_frozen_at'\s*-\s*'electorate_frozen_by'/i);
  assert.match(updateTrigger, /after update on public\.elections[\s\S]*?when\s*\(/i);

  const withoutLockMetadata = (row) => {
    const { electorate_frozen_at, electorate_frozen_by, ...auditedFields } = row;
    return auditedFields;
  };
  const before = { id: 28, title: "S-Elect", status: "active", electorate_frozen_at: null, electorate_frozen_by: null };
  const lockOnly = { ...before, electorate_frozen_at: "2026-10-02T10:00:00Z", electorate_frozen_by: 42 };
  const ordinaryEdit = { ...lockOnly, title: "S-Elect 2026" };
  assert.deepEqual(withoutLockMetadata(before), withoutLockMetadata(lockOnly), "lock-only update is excluded from generic auditing");
  assert.notDeepEqual(withoutLockMetadata(lockOnly), withoutLockMetadata(ordinaryEdit), "ordinary election edits still reach generic auditing");

  assert.equal((lock.match(/insert into public\.audit_logs/gi) ?? []).length, 1, "lock has one dedicated audit insert");
  assert.match(lock, /'election_electorate_locked'[\s\S]*?jsonb_build_object\([\s\S]*?'eligible_count'[\s\S]*?'academic_term_id'[\s\S]*?'policy_version'/i);
  const metadataStart = lock.indexOf("pg_catalog.jsonb_build_object(", lock.indexOf("insert into public.audit_logs"));
  const metadataEnd = lock.indexOf("\n    )", metadataStart);
  const lockMetadata = lock.slice(metadataStart, metadataEnd);
  assert.doesNotMatch(lockMetadata, /student_id|student_ids|voter_id|voter_ids/i, "lock audit does not include electorate identities");
  assert.doesNotMatch(preview, /insert\s+into\s+public\.audit_logs/i, "preview produces no audit event");

  const validationEnd = lock.indexOf("insert into public.audit_logs");
  assert.ok(validationEnd > lock.indexOf("now_manila >= election_row.start_date"), "all lock validation precedes the success event");
  const lastFailure = lock.lastIndexOf("raise exception");
  assert.ok(lastFailure < validationEnd, "failed lock paths cannot write the successful event");
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i, "lock update and event execute within the migration-installed transactional RPC path");
});

test("locked policy, organization, term, schedule, and membership are immutable", () => {
  const electionGuard = sqlFunction("kandid_guard_frozen_electorate");
  const memberGuard = sqlFunction("kandid_guard_frozen_electorate_member");
  assert.match(electionGuard, /old\.electorate_frozen_at is not null[\s\S]*?new\.organization_id is distinct from old\.organization_id[\s\S]*?new\.academic_term_id is distinct from old\.academic_term_id[\s\S]*?new\.start_date is distinct from old\.start_date[\s\S]*?new\.end_date is distinct from old\.end_date/i);
  assert.match(memberGuard, /A locked electorate cannot be changed/i);
  assert.match(migration, /before insert or update on public\.elections/i);
});

test("submit-vote uses locked membership for frozen policy and dynamic compatibility only for marked legacy elections", () => {
  assert.match(submitVote, /Number\(election\.electorate_policy_version\) === 1[\s\S]*?electorate_frozen_at[\s\S]*?kandid_is_locked_electorate_member/i);
  assert.match(submitVote, /Number\(election\.electorate_policy_version\) === 0[\s\S]*?resolve_student_organization_participation/i);
  assert.match(submitVote, /electorate has not been locked/i);
  assert.match(migration, /grant execute on function public\.kandid_is_locked_electorate_member\(integer, integer\) to service_role/i);
  assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/i);
});

test("canonical turnout uses frozen electorate and distinct vote_ballots participants only", () => {
  const summary = sqlFunction("kandid_election_turnout_summary");
  assert.match(summary, /count\(\*\).*private\.election_eligible_voters/is);
  assert.match(summary, /count\(distinct b\.student_id\).*public\.vote_ballots/is);
  assert.match(summary, /legacy_vote_rows_without_ballot/i);
  assert.match(summary, /electorate_count > 0/i);
  assert.match(summary, /'turnout_percentage', percentage/i);
  assert.match(summary, /'frozen_zero_member'/i);
  assert.match(summary, /'legacy_unavailable'/i);
  assert.doesNotMatch(summary, /count\(distinct .*public\.votes|students\s+table/i);
});

test("ballot writes independently enforce the frozen roster while marked legacy elections remain compatible", () => {
  const ballotGuard = sqlFunction("kandid_require_locked_electorate_for_ballot");
  assert.match(migration, /before insert on public\.vote_ballots\s+for each row execute function private\.kandid_require_locked_electorate_for_ballot\(\)/i);
  assert.match(ballotGuard, /electorate_policy_version = 0[\s\S]*?return new/i);
  assert.match(ballotGuard, /electorate_policy_version <> 1[\s\S]*?electorate_frozen_at is null/i);
  assert.match(ballotGuard, /private\.election_eligible_voters v[\s\S]*?v\.student_id = new\.student_id/i);
});

test("Board report package extension reuses the canonical helper and CSV has a turnout summary row", () => {
  assert.match(migration, /alter function public\.kandid_get_board_election_report_package\(integer\)\s+set schema private/i);
  assert.match(migration, /rename to kandid_get_board_election_report_package_base/i);
  assert.match(migration, /private\.kandid_election_turnout_summary\(p_election_id\)/i);
  assert.match(reports, /kandid_get_board_election_report_package/);
  assert.match(reports, /boardVotingSummaryCsvColumns/);
  assert.match(reports, /Eligible Voters/);
  assert.match(reports, /Voters Participated/);
  assert.match(reports, /Voter Turnout/);
  assert.match(reports, /formatTurnoutPercentage\(votingSummary\)/);
  assert.match(readFileSync("src/utils/boardReports.js", "utf8"), /row_type: "turnout_summary"/);
  assert.doesNotMatch(readFileSync("src/utils/boardReports.js", "utf8"), /student_id|student_number|ballot_id|vote_hash/);
});

test("Board scheduled-finalization UI distinguishes automatic scheduling and immutable completion", () => {
  assert.match(setup, /disabled=\{electorateLocked\}/);
  assert.match(electoratePanel, /schedules the electorate freeze automatically/i);
  assert.match(electoratePanel, /server recomputes the electorate and freezes it atomically/i);
  assert.match(electoratePanel, /locked \? \([\s\S]*?immutable/i);
});

test("Super Admin never calculates turnout against the global student table", () => {
  assert.doesNotMatch(saReports, /uniqueVoters\s*\/\s*students\.length|turnout\s*=\s*\n\s*students\.length/i);
  assert.doesNotMatch(saMonitor, /totalStudents|uniqueVoters\.size|totalVoters\s*\/\s*totalStudents/i);
  assert.match(saMonitor, /loadElectionTurnout/);
  assert.match(turnout, /kandid_get_election_turnout/);
});
