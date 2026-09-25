import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  CalendarRange,
  CheckCircle,
  Layers3,
  RefreshCw,
  UserCheck,
  Users,
  Vote,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { KandidInlineLoader } from "../../components/KandidLoader";
import { fetchAuditLogs } from "../../utils/auditLog";
import { formatLocalDateTime } from "../../utils/elections";

function BoardDashboard() {
  const [stats, setStats] = useState({
    elections: 0,
    activeElections: 0,
    positions: 0,
    candidates: 0,
    votes: 0,
    voters: 0,
  });
  const [recentElections, setRecentElections] = useState([]);
  const [recentActivities, setRecentActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;
  const orgName = user?.organizations?.name || "Assigned Organization";

  const loadDashboardData = useCallback(async (isActive = () => true) => {
    if (isActive()) {
      setLoading(true);
    }

    if (!orgId) {
      if (isActive()) {
        setLoading(false);
      }
      return;
    }

    const { data: electionsData, error: electionError } = await supabase
      .from("elections")
      .select("id, title, start_date, end_date, status, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (electionError) {
      console.error("Failed to load board elections:", electionError);
    }

    const electionIds = electionsData?.map((election) => election.id) || [];

    let positionsData = [];
    let candidatesData = [];
    let votesData = [];

    if (electionIds.length > 0) {
      const [{ data: posData }, { data: voteData }] = await Promise.all([
        supabase
          .from("positions")
          .select("id")
          .in("election_id", electionIds),
        supabase
          .from("votes")
          .select("student_id")
          .in("election_id", electionIds),
      ]);

      positionsData = posData || [];
      votesData = voteData || [];

      const positionIds = positionsData.map((position) => position.id);

      if (positionIds.length > 0) {
        const { data: candData } = await supabase
          .from("candidates")
          .select("id")
          .in("position_id", positionIds);

        candidatesData = candData || [];
      }
    }

    if (!isActive()) return;

    const uniqueVoters = new Set(votesData.map((vote) => vote.student_id));

    setStats({
      elections: electionsData?.length || 0,
      activeElections:
        electionsData?.filter((election) => election.status === "active").length || 0,
      positions: positionsData.length,
      candidates: candidatesData.length,
      votes: votesData.length,
      voters: uniqueVoters.size,
    });

    setRecentElections(electionsData?.slice(0, 5) || []);
    const { data: auditActivities, error: auditError } = await fetchAuditLogs({
      limit: 5,
      organizationId: orgId,
    });
    if (auditError) {
      console.warn("Failed to load board audit activity:", auditError);
    }
    setRecentActivities(auditActivities || []);
    setLoading(false);
  }, [orgId]);

  const fetchDashboardData = useCallback(async () => {
    await loadDashboardData(() => true);
  }, [loadDashboardData]);

  useEffect(() => {
    let active = true;

    const loadTimer = window.setTimeout(() => {
      loadDashboardData(() => active);
    }, 0);
    window.addEventListener("kandid-audit-updated", fetchDashboardData);

    return () => {
      active = false;
      window.clearTimeout(loadTimer);
      window.removeEventListener("kandid-audit-updated", fetchDashboardData);
    };
  }, [fetchDashboardData, loadDashboardData]);

  const cards = [
    {
      title: "Elections",
      value: stats.elections,
      icon: Vote,
      tone: "text-[#315f57] bg-[rgba(49,95,87,0.12)]",
    },
    {
      title: "Active Elections",
      value: stats.activeElections,
      icon: CheckCircle,
      tone: "text-[#36936f] bg-[rgba(54,147,111,0.12)]",
    },
    {
      title: "Positions",
      value: stats.positions,
      icon: Users,
      tone: "text-[#3b82f6] bg-[rgba(59,130,246,0.12)]",
    },
    {
      title: "Candidates",
      value: stats.candidates,
      icon: UserCheck,
      tone: "text-[#11806a] bg-[rgba(17,128,106,0.12)]",
    },
    {
      title: "Votes Cast",
      value: stats.votes,
      icon: BarChart3,
      tone: "text-[#b39a2b] bg-[rgba(208,199,109,0.16)]",
    },
    {
      title: "Unique Voters",
      value: stats.voters,
      icon: Users,
      tone: "text-[#0f6a58] bg-[rgba(25,162,140,0.12)]",
    },
  ];
  const participationIndex =
    stats.votes > 0 ? Math.round((stats.voters / stats.votes) * 100) : 0;
  const electionReadiness =
    stats.elections > 0 ? Math.round((stats.activeElections / stats.elections) * 100) : 0;
  const candidateDensity =
    stats.positions > 0 ? Math.min(Math.round((stats.candidates / stats.positions) * 100), 100) : 0;

  if (!orgId) {
    return (
      <div className="empty-state">
        <h1 className="text-3xl font-black text-red-600">No Organization Assigned</h1>
        <p className="mt-2 text-gray-500">
          This Electoral Board account has no assigned organization. Please ask
          the Super Admin to assign one.
        </p>
      </div>
    );
  }

  return (
    <div className="board-dashboard-desktop">
      <div className="page-head board-dashboard-opening">
        <div className="board-dashboard-opening-copy">
          <div className="page-kicker board-dashboard-kicker">Electoral Board</div>
          <h1 className="page-title board-dashboard-title">
            Election operations
            <span className="page-title-accent"> for your organization</span>
          </h1>
          <p className="page-subtitle">
            <span className="font-bold text-[#11806a]">{orgName}</span> is the active workspace for ballots,
            candidates, positions, and board activity.
          </p>
        </div>

        <button
          onClick={fetchDashboardData}
          className="primary-btn board-dashboard-refresh self-start lg:self-auto"
        >
          <RefreshCw size={18} />
          Refresh Dashboard
        </button>
      </div>

      {loading ? (
        <section className="board-dashboard-loading">
          <p>Electoral Board / Dashboard</p>
          <strong>Preparing your board dashboard</strong>
          <KandidInlineLoader message="Checking elections, votes, and recent activity..." />
        </section>
      ) : (
        <>
          <div className="section-grid board-dashboard-metrics grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => {
              const Icon = card.icon;

              return (
                <div key={card.title} className="metric-card lift-card board-dashboard-metric">
                  <div className="board-dashboard-metric-inner">
                    <div>
                      <p className="board-dashboard-metric-label">{card.title}</p>
                      <h2 className="board-dashboard-metric-value">
                        {card.value}
                      </h2>
                    </div>
                    <div
                      className={`board-dashboard-metric-icon ${card.tone}`}
                    >
                      <Icon size={24} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="section-grid board-dashboard-operation-grid grid-cols-1 xl:grid-cols-[0.86fr_1.14fr]">
            <div className="glass-panel-dark board-dashboard-org-panel rounded-[30px] p-7 text-white">
              <div className="board-dashboard-panel-head">
                <div>
                  <p className="board-dashboard-panel-kicker">
                    Organization Scope
                  </p>
                  <h2>{orgName}</h2>
                </div>
                <div className="board-dashboard-panel-icon">
                  <Layers3 size={24} />
                </div>
              </div>

              <div className="board-dashboard-org-stack">
                <div className="board-dashboard-participation">
                  <p>
                    Participation Index
                  </p>
                  <strong>
                    {stats.voters > 0 && stats.votes > 0
                      ? `${Math.round((stats.voters / stats.votes) * 100)}`
                      : "0"}
                    <span>%</span>
                  </strong>
                </div>

                <div className="board-dashboard-org-note">
                  Counts reflect records currently tied to this assigned organization.
                </div>

                <div className="board-dashboard-ledger">
                  {[
                    ["Total ballots recorded", stats.votes],
                    ["Unique student voters", stats.voters],
                    ["Configured candidates", stats.candidates],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="board-dashboard-ledger-row"
                    >
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="soft-card board-dashboard-snapshot">
              <div className="board-dashboard-panel-head">
                <div>
                  <p className="board-dashboard-section-kicker">
                    Board Readiness
                  </p>
                  <h3>Operational Snapshot</h3>
                </div>
                <span className="status-pill">Ready</span>
              </div>

              <div className="board-dashboard-snapshot-list">
                {[
                  ["Configured elections", `${stats.elections} total`],
                  ["Open election windows", `${stats.activeElections} active`],
                  ["Position setup", `${stats.positions} positions available`],
                ].map(([label, value]) => (
                  <div key={label} className="info-row">
                    <span className="text-sm font-semibold text-gray-600">{label}</span>
                    <span className="text-sm font-bold text-[#1d262f]">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="section-grid board-dashboard-graph-grid grid-cols-1 xl:grid-cols-2">
            <div className="graph-card board-dashboard-graph-card">
              <div className="board-dashboard-panel-head">
                <div>
                  <p className="board-dashboard-section-kicker">
                    Election Progress
                  </p>
                  <h3>Current operation</h3>
                </div>
                <span className="status-pill">Live</span>
              </div>

              <div className="board-dashboard-graph-stack">
                {[
                  ["Election readiness", electionReadiness, `${stats.activeElections}/${stats.elections || 0}`, "chart-fill"],
                  ["Participation index", participationIndex, `${stats.voters}/${stats.votes || 0}`, "chart-fill-blue"],
                  ["Candidate density", candidateDensity, `${stats.candidates}/${stats.positions || 0}`, "chart-fill-gold"],
                ].map(([label, value, note, tone]) => (
                  <div key={label} className="graph-row">
                    <div className="mb-3 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold text-[#102220]">{label}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[#6a817b]">
                          {note}
                        </p>
                      </div>
                      <span className="text-lg font-black text-[#102220]">{value}%</span>
                    </div>

                    <div className="chart-track">
                      <div className={tone} style={{ width: `${value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="graph-card board-dashboard-graph-card">
              <div className="board-dashboard-panel-head">
                <div>
                  <p className="board-dashboard-section-kicker">
                    Resource Mix
                  </p>
                  <h3>Management records</h3>
                </div>
                <span className="status-pill">Summary</span>
              </div>

              <div className="board-dashboard-graph-stack">
                {[
                  ["Positions configured", stats.positions, 100, "chart-fill-dark"],
                  ["Candidates added", stats.candidates, candidateDensity, "chart-fill"],
                  ["Unique voters", stats.voters, participationIndex, "chart-fill-blue"],
                ].map(([label, value, percent, tone]) => (
                  <div key={label} className="graph-row">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-bold text-[#102220]">{label}</p>
                      <p className="text-sm font-bold text-[#234742]">{value}</p>
                    </div>
                    <div className="chart-track">
                      <div className={tone} style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="section-grid board-dashboard-list-grid grid-cols-1">
            <div className="table-shell board-dashboard-list-panel">
              <div className="board-dashboard-list-head border-b border-[rgba(104,86,72,0.1)] px-6 py-5">
                <p className="board-dashboard-section-kicker">
                  Recent Elections
                </p>
                <h3>
                  Latest elections for {orgName}
                </h3>
              </div>

              {recentElections.length === 0 ? (
                <p className="p-6 text-sm text-gray-500">
                  No elections found for this organization.
                </p>
              ) : (
                recentElections.map((election) => (
                  <div
                    key={election.id}
                    className="flex items-center justify-between border-b border-[rgba(104,86,72,0.08)] px-6 py-4 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="font-bold">{election.title}</p>
                      <p className="mt-1 inline-flex items-center gap-2 text-xs text-gray-500">
                        <CalendarRange size={14} />
                        {election.start_date
                          ? formatLocalDateTime(election.start_date)
                          : "No start date"}
                        {" - "}
                        {election.end_date
                          ? formatLocalDateTime(election.end_date)
                          : "No end date"}
                      </p>
                    </div>

                    <span className="status-pill">{election.status}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="section-grid board-dashboard-list-grid grid-cols-1">
            <div className="table-shell board-dashboard-list-panel">
              <div className="board-dashboard-list-head border-b border-[rgba(104,86,72,0.1)] px-6 py-5">
                <p className="board-dashboard-section-kicker">
                  Recent Activity
                </p>
                <h3>
                  Latest actions for {orgName}
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Organization</th>
                      <th>Status</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentActivities.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="px-6 py-10 text-center empty-copy">
                          No recent activity yet.
                        </td>
                      </tr>
                    ) : (
                      recentActivities.map((activity) => (
                        <tr key={activity.id}>
                          <td className="font-bold text-slate-800">{activity.event}</td>
                          <td className="text-slate-500 font-medium">{activity.organization}</td>
                          <td><span className="status-pill">{activity.status}</span></td>
                          <td className="text-slate-400 font-medium">{activity.time}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default BoardDashboard;
