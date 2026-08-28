import { useEffect, useState } from "react";
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
  const [loading, setLoading] = useState(true);

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;
  const orgName = user?.organizations?.name || "Assigned Organization";

  async function fetchDashboardData() {
    await loadDashboardData(() => true);
  }

  useEffect(() => {
    let active = true;

    loadDashboardData(() => active);

    return () => {
      active = false;
    };
  }, [orgId]);

  async function loadDashboardData(isActive = () => true) {
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
          .select("id, election_id")
          .in("election_id", electionIds),
        supabase
          .from("votes")
          .select("id, student_id, election_id")
          .in("election_id", electionIds),
      ]);

      positionsData = posData || [];
      votesData = voteData || [];

      const positionIds = positionsData.map((position) => position.id);

      if (positionIds.length > 0) {
        const { data: candData } = await supabase
          .from("candidates")
          .select("id, position_id")
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
    setLoading(false);
  }

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
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Board Overview</div>
          <h1 className="page-title">
            Election board
            <span className="page-title-accent"> command desk</span>
          </h1>
          <p className="page-subtitle">
            Manage election operations for{" "}
            <span className="font-bold text-[#11806a]">{orgName}</span> with a
            cleaner summary of turnout, setup progress, and recent activity.
          </p>
        </div>

        <button
          onClick={fetchDashboardData}
          className="primary-btn self-start lg:self-auto"
        >
          <RefreshCw size={18} />
          Refresh Dashboard
        </button>
      </div>

      {loading ? (
        <div className="glass-panel mt-8 rounded-[28px] p-8 text-gray-500">
          Loading dashboard...
        </div>
      ) : (
        <>
          <div className="section-grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => {
              const Icon = card.icon;

              return (
                <div key={card.title} className="metric-card lift-card">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-500">{card.title}</p>
                      <h2 className="mt-4 text-5xl font-black tracking-tight">
                        {card.value}
                      </h2>
                    </div>
                    <div
                      className={`flex h-14 w-14 items-center justify-center rounded-2xl ${card.tone}`}
                    >
                      <Icon size={24} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="section-grid grid-cols-1 xl:grid-cols-[0.86fr_1.14fr]">
            <div className="glass-panel-dark rounded-[30px] p-7 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                    Organization Focus
                  </p>
                  <h2 className="mt-3 text-3xl font-black">{orgName}</h2>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
                  <Layers3 size={24} />
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <div className="rounded-2xl bg-white/8 px-4 py-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                    Participation Index
                  </p>
                  <p className="mt-2 text-4xl font-black">
                    {stats.voters > 0 && stats.votes > 0
                      ? `${Math.round((stats.voters / stats.votes) * 100)}`
                      : "0"}
                    <span className="ml-1 text-base font-semibold text-white/60">%</span>
                  </p>
                </div>

                <div className="space-y-3">
                  {[
                    ["Total ballots recorded", stats.votes],
                    ["Unique student voters", stats.voters],
                    ["Configured candidates", stats.candidates],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between rounded-2xl bg-white/8 px-4 py-3"
                    >
                      <span className="text-sm text-white/65">{label}</span>
                      <span className="text-sm font-bold text-white">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="soft-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                    Board Readiness
                  </p>
                  <h3 className="mt-2 text-2xl font-black">Operational Snapshot</h3>
                </div>
                <span className="status-pill">Ready</span>
              </div>

              <div className="mt-6 space-y-4">
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

          <div className="section-grid grid-cols-1 xl:grid-cols-2">
            <div className="graph-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                    Board Graph
                  </p>
                  <h3 className="mt-2 text-2xl font-black">Election Progress View</h3>
                </div>
                <span className="status-pill">Live</span>
              </div>

              <div className="mt-6 space-y-4">
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

            <div className="graph-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                    Operations Graph
                  </p>
                  <h3 className="mt-2 text-2xl font-black">Board Capacity Mix</h3>
                </div>
                <span className="status-pill">Colored View</span>
              </div>

              <div className="mt-6 space-y-4">
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

          <div className="section-grid grid-cols-1">
            <div className="table-shell">
              <div className="border-b border-[rgba(104,86,72,0.1)] px-6 py-5">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                  Recent Elections
                </p>
                <h3 className="mt-2 text-xl font-black">
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
                          ? new Date(election.start_date).toLocaleString()
                          : "No start date"}
                        {" - "}
                        {election.end_date
                          ? new Date(election.end_date).toLocaleString()
                          : "No end date"}
                      </p>
                    </div>

                    <span className="status-pill">{election.status}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default BoardDashboard;
