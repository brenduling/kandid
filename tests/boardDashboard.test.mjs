import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const dashboard = await readFile(new URL("src/pages/board/Dashboard.jsx", root), "utf8");
const dashboardCss = await readFile(new URL("src/pages/board/Dashboard.css", root), "utf8");
const electionDisplay = await readFile(new URL("src/pages/board/electionDisplay.js", root), "utf8");
const elections = await readFile(new URL("src/pages/board/Elections.jsx", root), "utf8");
const electionPhases = await readFile(new URL("src/utils/electionLifecycle.js", root), "utf8");
const auditMigration = await readFile(new URL("supabase/migrations/20261002130000_trusted_audit_foundation.sql", root), "utf8");

test("Latest Elections uses the shared phase calculation and Kandid clock", () => {
  assert.match(dashboard, /useElectionClock\(\)/);
  assert.match(dashboard, /select\("id, title, campaign_start, campaign_end, start_date, end_date, status, created_at"\)/);
  assert.match(dashboard, /data-phase=\{getElectionPhase\(election, serverNow \|\| undefined\)\}/);
  assert.match(dashboard, /electionPhaseLabel\(election, serverNow \|\| undefined\)/);
  assert.match(electionDisplay, /export function electionPhaseLabel\(election, now\)/);
  assert.match(electionDisplay, /getElectionPhase\(election, now\)/);
  assert.match(elections, /const phase = phaseSummary\.phasesByElectionId\.get\(election\.id\) \|\| getElectionPhase\(election, now\)/);
  assert.match(electionPhases, /if \(votingStart && votingEnd && currentTime >= votingStart && currentTime < votingEnd\)\s*\{\s*return "voting"/);
  assert.match(electionPhases, /if \(votingEnd && currentTime >= votingEnd\) return "closed"/);
  assert.match(dashboard, /countOperationalElections\(lifecycleElections, serverNow\)/);
  assert.doesNotMatch(dashboard, /data-status=\{election\.status\}/);
  assert.match(dashboard, /setRecentElections\(electionsData\.slice\(0, 5\)\)/);
});

test("Dashboard activity uses the trusted Board Audit Trail RPC and canonical presentation", () => {
  assert.match(dashboard, /supabase\.rpc\([\s\S]*?"kandid_list_board_audit_events"[\s\S]*?buildBoardAuditRpcArgs\(\{ pageSize: 5 \}\)/);
  assert.match(dashboard, /boardAuditActionLabel\(activity\.event_type/);
  assert.match(dashboard, /boardAuditActorLabel\(activity\)/);
  assert.match(dashboard, /boardAuditTargetLabel\(activity\)/);
  assert.match(dashboard, /boardAuditCategoryLabel\(activity\.event_category/);
  assert.match(dashboard, /activity\.is_legacy/);
  assert.doesNotMatch(dashboard, /fetchAuditLogs|from\(["']audit_logs["']\)|p_organization_id|p_organization_id\s*:/);
  assert.doesNotMatch(dashboard, /recentActivities\.sort\(/);
  assert.match(auditMigration, /order by coalesce\(l\.created_at, l\.timestamp\) desc, l\.id desc/i);
});

test("Recent Activity has independent loading, safe retry/error, empty state, and full-history link", () => {
  assert.match(dashboard, /const \[activityLoading, setActivityLoading\] = useState\(true\)/);
  assert.match(dashboard, /board-dashboard-activity-skeleton/);
  assert.match(dashboard, /toBoardFacingError\(error\?\.message, "Recent activity is temporarily unavailable\."\)/);
  assert.match(dashboard, /loadRecentActivity\(\)/);
  assert.match(dashboard, /No recent activity yet\./);
  assert.match(dashboard, /to="\/board\/audit-trail"/);
  assert.doesNotMatch(dashboard, /recentActivities\.length\}[^\n]*actions|0 actions/);
  assert.match(dashboardCss, /\.board-dashboard-activity-row/);
  assert.match(dashboardCss, /@media \(max-width: 640px\)/);
});
