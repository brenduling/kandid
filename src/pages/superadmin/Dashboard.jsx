import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock3,
  ListChecks,
  RefreshCw,
  Users,
  Vote,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { fetchAuditLogs } from "../../utils/auditLog";
import { fetchAuthoritativeNow, getElectionPhase } from "../../utils/elections";
import "./Dashboard.css";

const EMPTY_STATS = {
  organizations: 0,
  students: 0,
  activeElections: 0,
  votes: 0,
  pendingReview: 0,
};

const EMPTY_ELECTION_PULSE = [
  { id: "draft", label: "Draft", count: 0 },
  { id: "upcoming", label: "Upcoming", count: 0 },
  { id: "campaigning", label: "Campaigning", count: 0 },
  { id: "voting", label: "Voting", count: 0 },
  { id: "awaiting-results", label: "Awaiting results", count: 0 },
  { id: "published", label: "Results published", count: 0 },
  { id: "archived", label: "Archived", count: 0 },
  { id: "other", label: "Other status", count: 0 },
];

function buildElectionPulse(elections, now) {
  const counts = Object.fromEntries(EMPTY_ELECTION_PULSE.map((item) => [item.id, 0]));

  elections.forEach((election) => {
    const status = String(election.status || "draft").toLowerCase();
    const phase = getElectionPhase(election, now);

    if (status === "archived" || phase === "archived") {
      counts.archived += 1;
    } else if (election.results_released_at) {
      counts.published += 1;
    } else if (phase === "draft") {
      counts.draft += 1;
    } else if (phase === "campaign") {
      counts.campaigning += 1;
    } else if (phase === "voting") {
      counts.voting += 1;
    } else if (phase === "closed") {
      counts["awaiting-results"] += 1;
    } else if (["campaign_upcoming", "scheduled", "waiting"].includes(phase)) {
      counts.upcoming += 1;
    } else {
      counts.other += 1;
    }
  });

  return EMPTY_ELECTION_PULSE.map((item) => ({ ...item, count: counts[item.id] }));
}

function Dashboard() {
  const [stats, setStats] = useState(EMPTY_STATS);
  const [programStats, setProgramStats] = useState([]);
  const [electionPulse, setElectionPulse] = useState(EMPTY_ELECTION_PULSE);
  const [recentActivities, setRecentActivities] = useState([]);
  const [activityUnavailable, setActivityUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [
        organizationsResult,
        studentsResult,
        votesResult,
        pendingResult,
        programsResult,
        electionsResult,
        now,
      ] = await Promise.all([
        supabase.from("organizations").select("id", { count: "exact", head: true }),
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase.from("votes").select("id", { count: "exact", head: true }),
        supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase.from("students").select("program"),
        supabase
          .from("elections")
          .select(
            "id, status, campaign_start, campaign_end, start_date, end_date, results_released_at",
          ),
        fetchAuthoritativeNow(),
      ]);

      const coreResults = [
        organizationsResult,
        studentsResult,
        votesResult,
        pendingResult,
        programsResult,
        electionsResult,
      ];
      if (coreResults.some((result) => result.error)) {
        throw new Error("dashboard_data_unavailable");
      }

      const elections = electionsResult.data || [];
      const nextElectionPulse = buildElectionPulse(elections, now);

      setStats({
        organizations: organizationsResult.count ?? 0,
        students: studentsResult.count ?? 0,
        activeElections: elections.filter((election) => election.status === "active").length,
        votes: votesResult.count ?? 0,
        pendingReview: pendingResult.count ?? 0,
      });
      setElectionPulse(nextElectionPulse);

      const programCounts = (programsResult.data || []).reduce((accumulator, student) => {
        const key = String(student.program || "Unassigned").trim() || "Unassigned";
        accumulator[key] = (accumulator[key] || 0) + 1;
        return accumulator;
      }, {});
      const totalPrograms = Object.values(programCounts).reduce(
        (sum, count) => sum + count,
        0,
      );

      setProgramStats(
        Object.entries(programCounts)
          .map(([program, count]) => ({
            program,
            count,
            share: totalPrograms > 0 ? Math.round((count / totalPrograms) * 100) : 0,
          }))
          .sort((left, right) => right.count - left.count || left.program.localeCompare(right.program))
          .slice(0, 6),
      );

      const { data: auditActivities, error: auditError } = await fetchAuditLogs({ limit: 5 });
      setActivityUnavailable(Boolean(auditError));
      setRecentActivities(auditError ? [] : auditActivities || []);
    } catch (dashboardError) {
      console.error("Error fetching dashboard data:", dashboardError);
      setError("The current system overview could not be loaded. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadTimer = window.setTimeout(fetchDashboardData, 0);
    window.addEventListener("kandid-audit-updated", fetchDashboardData);
    return () => {
      window.clearTimeout(loadTimer);
      window.removeEventListener("kandid-audit-updated", fetchDashboardData);
    };
  }, [fetchDashboardData]);

  const metrics = [
    { label: "Organizations", value: stats.organizations, detail: "Institutional workspaces", path: "/super-admin/organizations", icon: Building2 },
    { label: "Students", value: stats.students, detail: "Student records", path: "/super-admin/students", icon: Users },
    { label: "Active elections", value: stats.activeElections, detail: "Status marked active", path: "/super-admin/elections", icon: BadgeCheck },
    { label: "Votes recorded", value: stats.votes, detail: "Stored vote rows", path: "/super-admin/voting-monitor", icon: Vote },
    { label: "Pending review", value: stats.pendingReview, detail: "Student records", path: "/super-admin/students", icon: ListChecks },
  ];

  const awaitingResults =
    electionPulse.find((item) => item.id === "awaiting-results")?.count || 0;
  const attentionItems = [
    stats.pendingReview > 0
      ? {
          id: "pending-students",
          count: stats.pendingReview,
          title: "Student records await review",
          description: "Review pending student records before they enter election operations.",
          path: "/super-admin/students",
        }
      : null,
    awaitingResults > 0
      ? {
          id: "awaiting-results",
          count: awaitingResults,
          title: "Elections await result publication",
          description: "Voting has closed and official results have not yet been released.",
          path: "/super-admin/results",
        }
      : null,
  ].filter(Boolean);
  const totalElections = electionPulse.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="sa-dashboard">
      <header className="sa-dashboard-masthead">
        <div className="sa-dashboard-masthead-copy">
          <p className="sa-dashboard-brandline">
            <span>Kandid</span><span aria-hidden="true">/</span>Super Admin
          </p>
          <p className="sa-dashboard-eyebrow">System overview</p>
          <h1>Election Command Center</h1>
          <p className="sa-dashboard-deck">
            Monitor election operations, institutional records, and system activity across Kandid.
          </p>
        </div>

        <div className="sa-dashboard-masthead-aside">
          <p>Platform oversight</p>
          <strong>Current records, one operational view.</strong>
          <button type="button" onClick={fetchDashboardData} className="sa-dashboard-refresh" disabled={loading}>
            <RefreshCw size={15} aria-hidden="true" />
            {loading ? "Refreshing" : "Refresh data"}
          </button>
        </div>
      </header>

      {loading ? (
        <section className="sa-dashboard-loading" role="status" aria-live="polite">
          <p className="sa-dashboard-eyebrow">System overview</p>
          <strong>Preparing current platform records</strong>
          <div className="sa-dashboard-loading-lines" aria-hidden="true"><span /><span /><span /></div>
        </section>
      ) : error ? (
        <section className="sa-dashboard-error" role="alert">
          <p className="sa-dashboard-eyebrow">Overview unavailable</p>
          <h2>System records could not be loaded.</h2>
          <p>{error}</p>
          <button type="button" onClick={fetchDashboardData} className="sa-dashboard-text-action">
            Try again <ArrowRight size={15} aria-hidden="true" />
          </button>
        </section>
      ) : (
        <>
          <section className="sa-dashboard-metrics" aria-labelledby="system-pulse-title">
            <div className="sa-dashboard-section-heading sa-dashboard-section-heading-inline">
              <div><p className="sa-dashboard-eyebrow">System pulse</p><h2 id="system-pulse-title">Kandid at a glance</h2></div>
              <p>Live totals from current platform records.</p>
            </div>
            <div className="sa-dashboard-metric-rail">
              {metrics.map((metric, index) => {
                const Icon = metric.icon;
                return (
                <Link key={metric.label} to={metric.path} className="sa-dashboard-metric">
                  <span className="sa-dashboard-metric-meta">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                  </span>
                  <strong>{metric.value.toLocaleString()}</strong>
                  <span>{metric.label}</span>
                  <small>{metric.detail}</small>
                </Link>
                );
              })}
            </div>
          </section>

          <div className="sa-dashboard-primary-grid">
            <section className="sa-dashboard-section sa-dashboard-election-pulse" aria-labelledby="election-pulse-title">
              <div className="sa-dashboard-section-heading sa-dashboard-section-heading-inline">
                <div><p className="sa-dashboard-eyebrow">01 / Election pulse</p><h2 id="election-pulse-title">Lifecycle distribution</h2></div>
                <Link to="/super-admin/elections" className="sa-dashboard-text-action">Manage elections <ArrowRight size={15} aria-hidden="true" /></Link>
              </div>
              {totalElections === 0 ? (
                <p className="sa-dashboard-empty">No election records are available yet.</p>
              ) : (
                <div className="sa-dashboard-pulse-list">
                  {electionPulse.map((item) => (
                    <div key={item.id} className="sa-dashboard-pulse-row" data-phase={item.id}><span className="sa-dashboard-pulse-mark" aria-hidden="true" /><span>{item.label}</span><span aria-hidden="true" /><strong>{item.count.toLocaleString()}</strong></div>
                  ))}
                </div>
              )}
            </section>

            <section className="sa-dashboard-section sa-dashboard-attention" aria-labelledby="attention-title">
              <div className="sa-dashboard-section-heading"><p className="sa-dashboard-eyebrow">02 / System attention</p><h2 id="attention-title">What needs review</h2></div>
              {attentionItems.length === 0 ? (
                <div className="sa-dashboard-attention-clear"><CheckCircle2 size={20} aria-hidden="true" /><div><strong>No immediate system actions need attention.</strong><p>Current review and result-release queues are clear.</p></div></div>
              ) : (
                <div className="sa-dashboard-attention-list">
                  {attentionItems.map((item) => (
                    <Link key={item.id} to={item.path} className="sa-dashboard-attention-item">
                      <span className="sa-dashboard-attention-count">{item.count}</span>
                      <span><strong>{item.title}</strong><small>{item.description}</small></span>
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="sa-dashboard-secondary-grid">
            <section className="sa-dashboard-section sa-dashboard-programs" aria-labelledby="programs-title">
              <div className="sa-dashboard-section-heading"><p className="sa-dashboard-eyebrow">03 / Student composition</p><h2 id="programs-title">Largest program groups</h2><p>Top six program values recorded across student accounts.</p></div>
              {programStats.length === 0 ? (
                <p className="sa-dashboard-empty">No program distribution data is available.</p>
              ) : (
                <div className="sa-dashboard-program-list">
                  {programStats.map((item) => (
                    <div key={item.program} className="sa-dashboard-program-row">
                      <div><span title={item.program}>{item.program}</span><strong>{item.count.toLocaleString()}</strong></div>
                      <div className="sa-dashboard-program-track" aria-hidden="true"><span style={{ width: `${item.share}%` }} /></div>
                      <small>{item.share}% of student records</small>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="sa-dashboard-section sa-dashboard-activity" aria-labelledby="activity-title">
              <div className="sa-dashboard-section-heading sa-dashboard-section-heading-inline">
                <div><p className="sa-dashboard-eyebrow">04 / Recent activity</p><h2 id="activity-title">Audit register</h2></div>
                <Link to="/super-admin/audit-logs" className="sa-dashboard-text-action">View audit logs <ArrowRight size={15} aria-hidden="true" /></Link>
              </div>
              {activityUnavailable ? (
                <div className="sa-dashboard-activity-state"><Clock3 size={18} aria-hidden="true" /><p>Recent audit activity is temporarily unavailable.</p></div>
              ) : recentActivities.length === 0 ? (
                <p className="sa-dashboard-empty">No recent audit activity has been recorded.</p>
              ) : (
                <div className="sa-dashboard-activity-list">
                  {recentActivities.map((activity) => (
                    <article key={activity.id} className="sa-dashboard-activity-row">
                      <div><strong>{activity.event}</strong><span>{activity.organization}</span></div>
                      <div><span className="sa-dashboard-activity-status">{activity.status}</span><time dateTime={activity.createdAt}>{activity.time}</time></div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export default Dashboard;
