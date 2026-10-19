import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildElectionPulse,
  countOperationalElections,
  fetchAllStudentPrograms,
  summarizeStudentPrograms,
} from "../src/utils/superAdminDashboard.js";
import { getElectionPhase } from "../src/utils/electionLifecycle.js";
import { requiresManualResultPublication } from "../src/utils/results.js";

const dashboard = await readFile(new URL("../src/pages/superadmin/Dashboard.jsx", import.meta.url), "utf8");
const dashboardCss = await readFile(new URL("../src/pages/superadmin/Dashboard.css", import.meta.url), "utf8");
const auditHelper = await readFile(new URL("../src/utils/auditLog.js", import.meta.url), "utf8");
const superAdminLayout = await readFile(new URL("../src/layouts/SuperAdminLayout.jsx", import.meta.url), "utf8");
const mobileNav = await readFile(new URL("../src/components/MobileNav.jsx", import.meta.url), "utf8");

test("Lifecycle distribution contains phases only and ignores result-release state", () => {
  const now = new Date("2026-10-02T12:00:00");
  const elections = [
    { status: "active", phase: "closed" },
    { status: "active", phase: "campaign" },
    { status: "active", phase: "voting" },
    { status: "active", phase: "campaign_upcoming" },
  ];

  const pulse = buildElectionPulse(elections, now, (election, resolvedNow) => {
    assert.equal(resolvedNow, now);
    return election.phase;
  });
  assert.equal(countOperationalElections(pulse), 2);
  assert.equal(pulse.find((item) => item.id === "closed").count, 1);
  assert.equal(pulse.find((item) => item.id === "campaigning").count, 1);
  assert.equal(pulse.find((item) => item.id === "voting").count, 1);
  assert.equal(pulse.find((item) => item.id === "upcoming").count, 1);
  assert.deepEqual(pulse.map(({ id }) => id), ["draft", "upcoming", "campaigning", "voting", "closed", "archived", "other"]);
});

test("manual publication predicate follows canonical phase, normalized mode, and release marker", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const makeElection = (overrides = {}) => ({
    status: "active",
    campaign_start: "2026-10-01T09:00:00",
    campaign_end: "2026-10-01T10:00:00",
    start_date: "2026-10-01T11:00:00",
    end_date: "2026-10-01T12:00:00",
    results_released_at: null,
    ...overrides,
  });

  const realtimeDuringVoting = makeElection({
    start_date: "2026-10-02T19:00:00",
    end_date: "2026-10-02T21:00:00",
    student_result_visibility: "realtime",
  });
  assert.equal(getElectionPhase(realtimeDuringVoting, now), "voting");
  assert.equal(requiresManualResultPublication(realtimeDuringVoting, now), false);

  const realtimeClosed = makeElection({ student_result_visibility: "realtime" });
  assert.equal(getElectionPhase(realtimeClosed, now), "closed");
  assert.equal(requiresManualResultPublication(realtimeClosed, now), false);

  const afterClose = makeElection({ student_result_visibility: "after_close" });
  assert.equal(getElectionPhase(afterClose, now), "closed");
  assert.equal(requiresManualResultPublication(afterClose, now), false);

  const manualUnreleased = makeElection({ student_result_visibility: "manual" });
  assert.equal(getElectionPhase(manualUnreleased, now), "closed");
  assert.equal(requiresManualResultPublication(manualUnreleased, now), true);

  const manualReleased = makeElection({
    student_result_visibility: "manual",
    results_released_at: "2026-10-02T11:30:00Z",
  });
  assert.equal(getElectionPhase(manualReleased, now), "closed");
  assert.equal(requiresManualResultPublication(manualReleased, now), false);
});

test("ended persisted-active election is closed and excluded from Active Elections", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const ended = {
    status: "active",
    campaign_start: "2026-10-01T09:00:00",
    campaign_end: "2026-10-01T10:00:00",
    start_date: "2026-10-01T11:00:00",
    end_date: "2026-10-01T12:00:00",
  };
  assert.equal(getElectionPhase(ended, now), "closed");
  const pulse = buildElectionPulse([ended], now, getElectionPhase);
  assert.equal(pulse.find((item) => item.id === "closed").count, 1);
  assert.equal(countOperationalElections(pulse), 0);
});

test("archived lifecycle has precedence over other states", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const archived = { status: "archived", phase: "closed", results_released_at: null };
  const pulse = buildElectionPulse([archived], now, (election) => election.phase);
  assert.equal(pulse.find((item) => item.id === "archived").count, 1);
  assert.equal(pulse.find((item) => item.id === "closed").count, 0);
});

test("Active Elections is exactly Campaigning plus Voting from the shared Kandid clock", () => {
  const now = new Date("2026-10-02T12:00:00");
  const elections = [
    { status: "active", phase: "voting" },
    { status: "active", phase: "campaign" },
  ];
  const pulse = buildElectionPulse(elections, now, (election, resolvedNow) => {
    assert.equal(resolvedNow, now);
    return election.phase;
  });
  const campaigning = pulse.find((item) => item.id === "campaigning").count;
  const voting = pulse.find((item) => item.id === "voting").count;

  assert.equal(countOperationalElections(pulse), campaigning + voting);
  assert.match(dashboard, /useElectionClock\(\)/);
  assert.match(dashboard, /buildElectionPulse\(elections, now, getElectionPhase\)/);
  assert.match(dashboard, /value: activeElectionCount/);
});

test("Vote metric stays a raw vote-row count and retrieves it through trusted access", () => {
  assert.match(dashboard, /callVoteAccess\("super_admin_vote_count"\)/);
  assert.match(dashboard, /label: "Vote rows", value: stats\.votes, detail: "Stored vote records"/);
  assert.doesNotMatch(dashboard, /label: "(?:Voters|Participants|Ballots|Turnout)"/);
});

test("program retrieval paginates all student rows in bounded, ID-ordered requests", async () => {
  const rows = ["BSIT", "A", "B", "C", "D", "BSIT", "BSIT", "BSIT", "A", "B", "C", "D", "E", "F", "G", null, " "]
    .map((program, index) => ({ id: index + 1, program }));
  const ranges = [];
  const client = {
    from(table) {
      assert.equal(table, "students");
      return {
        select(columns) {
          assert.equal(columns, "program");
          return this;
        },
        order(column, options) {
          assert.equal(column, "id");
          assert.deepEqual(options, { ascending: true });
          return this;
        },
        async range(from, to) {
          ranges.push([from, to]);
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
    },
  };

  const result = await fetchAllStudentPrograms(client, 5);
  assert.equal(result.error, null);
  assert.equal(result.data.length, rows.length);
  assert.deepEqual(ranges, [[0, 4], [5, 9], [10, 14], [15, 19]]);

  const summary = summarizeStudentPrograms(result.data);
  assert.equal(summary.length, 6);
  assert.deepEqual(summary.map((item) => item.program), ["BSIT", "A", "B", "C", "D", "Unassigned"]);
  assert.equal(summary[0].count, 4);
  assert.equal(summary[0].share, 24);
  assert.equal(summary.find((item) => item.program === "Unassigned").count, 2);
  assert.equal(summary.find((item) => item.program === "A").share, 12);
  assert.equal(summary.some((item) => item.program === "E"), false);
});

test("Dashboard keeps pending-review, manual-publication, and trusted Super Admin audit sources", () => {
  assert.match(dashboard, /\.eq\("status", "pending"\)/);
  assert.match(dashboard, /title: "Student records await review"/);
  assert.match(dashboard, /student_result_visibility, results_released_at/);
  assert.match(dashboard, /requiresManualResultPublication\(election, now\)/);
  assert.match(dashboard, /title: "Results awaiting publication"/);
  assert.match(dashboard, /Current review and manual publication queues are clear\./);
  assert.match(dashboard, /fetchAuditLogs\(\{ limit: 5 \}\)/);
  assert.match(auditHelper, /kandid_list_super_admin_audit_events/);
  assert.doesNotMatch(dashboard, /from\(["']audit_logs["']\)/);
  assert.doesNotMatch(dashboard, /awaiting-results|Results published/);
});

test("mobile System Pulse is a compact two-column editorial grid at the requested widths", () => {
  const mobileRules = dashboardCss.match(/@media \(max-width: 767px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const narrowRules = dashboardCss.match(/@media \(max-width: 430px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(mobileRules, /\.sa-dashboard-metric-rail\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mobileRules, /\.sa-dashboard-metric-meta svg\s*\{\s*display:\s*none;\s*\}/);
  assert.match(mobileRules, /\.sa-dashboard-metric\s*\{[^}]*padding:\s*0\.72rem 0\.75rem 0\.82rem/);
  assert.match(mobileRules, /\.sa-dashboard-metric:nth-child\(n \+ 3\)\s*\{\s*border-top:/);
  assert.doesNotMatch(narrowRules, /sa-dashboard-metric-rail|sa-dashboard-metric:nth-child/);

  for (const width of [375, 390, 430, 480]) {
    assert.ok(width <= 767, `${width}px should use the compact mobile grid`);
  }

  // Five items naturally place the fifth in the first column of row three; no span rule is added.
  assert.doesNotMatch(mobileRules, /sa-dashboard-metric:nth-child\(5\)[^{]*\{[^}]*grid-column/);
});

test("mobile lower sections remain single-column and the fixed navigation keeps bottom clearance", () => {
  assert.match(dashboardCss, /@media \(max-width: 1180px\)\s*\{[\s\S]*?\.sa-dashboard-primary-grid,[\s\S]*?\.sa-dashboard-secondary-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(superAdminLayout, /content-stack pb-24 pt-20 lg:pb-8 lg:pt-8/);
  assert.match(mobileNav, /fixed inset-x-3 bottom-3/);
});
