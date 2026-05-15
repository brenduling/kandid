import { useEffect, useState } from "react";
import {
  BarChart3,
  Building2,
  CheckCircle,
  Clock,
  RefreshCw,
  ShieldCheck,
  Users,
  Vote,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function Dashboard() {
  const [stats, setStats] = useState({
    organizations: 0,
    students: 0,
    elections: 0,
    activeElections: 0,
    votes: 0,
    verifiedVotes: 0,
  });
  const [programStats, setProgramStats] = useState([]);
  const [recentElections, setRecentElections] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  async function fetchDashboardData() {
    setLoading(true);

    const { count: orgCount } = await supabase
      .from("organizations")
      .select("*", { count: "exact", head: true });
    const { count: studentCount } = await supabase
      .from("students")
      .select("*", { count: "exact", head: true });
    const { data: studentPrograms } = await supabase
      .from("students")
      .select("program");
    const { count: electionCount } = await supabase
      .from("elections")
      .select("*", { count: "exact", head: true });
    const { count: activeElectionCount } = await supabase
      .from("elections")
      .select("*", { count: "exact", head: true })
      .eq("status", "active");
    const { count: voteCount } = await supabase
      .from("votes")
      .select("*", { count: "exact", head: true });
    const { count: verifiedVoteCount } = await supabase
      .from("votes")
      .select("*", { count: "exact", head: true })
      .not("blockchain_tx_id", "is", null);

    const { data: electionsData } = await supabase
      .from("elections")
      .select("*, organizations(name)")
      .order("created_at", { ascending: false })
      .limit(5);

    const { data: logsData } = await supabase
      .from("audit_logs")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(5);

    setStats({
      organizations: orgCount || 0,
      students: studentCount || 0,
      elections: electionCount || 0,
      activeElections: activeElectionCount || 0,
      votes: voteCount || 0,
      verifiedVotes: verifiedVoteCount || 0,
    });
    const programCounts = (studentPrograms || []).reduce((accumulator, student) => {
      const key = student.program || "Unassigned";
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {});
    const totalPrograms = Object.values(programCounts).reduce(
      (sum, count) => sum + count,
      0,
    );
    const normalizedPrograms = Object.entries(programCounts)
      .map(([program, count]) => ({
        program,
        count,
        percent:
          totalPrograms > 0 ? Math.max(8, Math.round((count / totalPrograms) * 100)) : 0,
      }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 10);
    setProgramStats(normalizedPrograms);
    setRecentElections(electionsData || []);
    setRecentLogs(logsData || []);
    setLoading(false);
  }

  const turnout =
    stats.students > 0
      ? ((stats.votes / stats.students) * 100).toFixed(1)
      : 0;
  const verificationRate =
    stats.votes > 0
      ? Math.round((stats.verifiedVotes / stats.votes) * 100)
      : 0;
  const activeElectionShare =
    stats.elections > 0
      ? Math.round((stats.activeElections / stats.elections) * 100)
      : 0;

  const cards = [
    { title: "Organizations", value: stats.organizations, icon: Building2, tone: "text-[#2563eb] bg-[rgba(37,99,235,0.12)]" },
    { title: "Students", value: stats.students, icon: Users, tone: "text-[#0891b2] bg-[rgba(34,211,238,0.14)]" },
    { title: "Total Elections", value: stats.elections, icon: Vote, tone: "text-[#5b63d3] bg-[rgba(99,102,241,0.14)]" },
    { title: "Active Elections", value: stats.activeElections, icon: CheckCircle, tone: "text-[#059669] bg-[rgba(16,185,129,0.14)]" },
    { title: "Vote Casts", value: stats.votes, icon: BarChart3, tone: "text-[#d97706] bg-[rgba(248,217,107,0.18)]" },
    { title: "Blockchain Verified", value: stats.verifiedVotes, icon: ShieldCheck, tone: "text-[#2563eb] bg-[rgba(37,99,235,0.12)]" },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">System Overview</div>
          <h1 className="page-title">
            Super admin
            <span className="page-title-accent"> command center</span>
          </h1>
          <p className="page-subtitle">
            Monitor institutional election health, participation, and audit
            activity from a cleaner oversight dashboard.
          </p>
        </div>

        <button onClick={fetchDashboardData} className="primary-btn self-start lg:self-auto">
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
          <div className="section-grid grid-cols-1 xl:grid-cols-[1.08fr_1fr]">
            <div className="graph-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#f97316]">Turnout Snapshot</p>
                  <h2 className="mt-2 text-5xl font-black tracking-tight text-[#1d262f]">
                    {turnout}%
                  </h2>
                </div>
                <span className="rounded-full border border-[rgba(37,99,235,0.14)] bg-[rgba(37,99,235,0.06)] px-3 py-1 text-xs font-bold text-[#2563eb]">
                  2026-2027
                </span>
              </div>

              <div className="mt-8">
                <div className="flex h-[280px] items-end gap-2 overflow-hidden rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(241,245,255,0.92))] px-4 pb-10 pt-6">
                  {(programStats.length > 0 ? programStats : [{ program: "No Data", count: 0, percent: 12 }]).map((item) => (
                    <div key={item.program} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-3">
                      <div
                        className="w-full rounded-t-[10px] bg-[linear-gradient(180deg,#f59e0b,#d97706)] shadow-[0_8px_18px_rgba(217,119,6,0.2)]"
                        style={{ height: `${Math.max(item.percent * 2, 24)}px` }}
                      />
                      <p className="w-full truncate text-center text-[10px] font-medium uppercase tracking-[0.08em] text-[#7a8498]">
                        {item.program}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-2">
              {cards.map((card) => {
                const Icon = card.icon;

                return (
                  <div key={card.title} className="metric-card lift-card flex min-h-[156px] flex-col justify-between">
                    <div className="flex items-start justify-between gap-3">
                      <p className="max-w-[10rem] text-sm font-semibold text-[#f97316]">
                        {card.title}
                      </p>
                      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${card.tone}`}>
                        <Icon size={20} />
                      </div>
                    </div>
                    <h2 className="mt-6 text-right text-5xl font-black tracking-tight text-[#1d262f]">
                      {card.value}
                    </h2>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="section-grid grid-cols-1 xl:grid-cols-2">
            <div className="graph-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8ba4c7]">
                    System Graph
                  </p>
                  <h3 className="mt-2 text-2xl font-black text-[#1d262f]">Election Activity Mix</h3>
                </div>
                <span className="status-pill">Live</span>
              </div>

              <div className="mt-6 space-y-4">
                {[
                  ["Active election share", activeElectionShare, `${stats.activeElections}/${stats.elections || 0}`, "chart-fill"],
                  ["Turnout against students", Math.min(Number(turnout), 100), `${stats.votes}/${stats.students || 0}`, "chart-fill-blue"],
                  ["Blockchain verification", verificationRate, `${stats.verifiedVotes}/${stats.votes || 0}`, "chart-fill-gold"],
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
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8ba4c7]">
                    Participation Graph
                  </p>
                  <h3 className="mt-2 text-2xl font-black text-[#1d262f]">Voting Funnel</h3>
                </div>
                <span className="status-pill">Colored View</span>
              </div>

              <div className="mt-6 space-y-4">
                {[
                  ["Registered Students", stats.students, 100, "chart-fill-dark"],
                  [
                    "Vote Entries",
                    stats.votes,
                    stats.students > 0 ? Math.min(Math.round((stats.votes / stats.students) * 100), 100) : 0,
                    "chart-fill",
                  ],
                  [
                    "Verified Records",
                    stats.verifiedVotes,
                    verificationRate,
                    "chart-fill-gold",
                  ],
                ].map(([label, value, percent, tone]) => (
                  <div key={label} className="graph-row">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-bold text-[#102220]">{label}</p>
                      <p className="text-sm font-bold text-[#7ddff3]">{value}</p>
                    </div>
                    <div className="chart-track">
                      <div className={tone} style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="section-grid grid-cols-1 xl:grid-cols-2">
            <div className="table-shell">
              <div className="border-b border-[rgba(104,86,72,0.1)] px-6 py-5">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8ba4c7]">
                  Recent Elections
                </p>
                <h3 className="mt-2 text-xl font-black text-[#1d262f]">Latest created elections</h3>
              </div>

              <div>
                {recentElections.length === 0 ? (
                  <p className="p-6 text-sm text-gray-500">No elections found.</p>
                ) : (
                  recentElections.map((election) => (
                    <div
                      key={election.id}
                      className="flex items-center justify-between border-b border-[rgba(104,86,72,0.08)] px-6 py-4 last:border-b-0"
                    >
                      <div>
                        <p className="font-bold text-[#1d262f]">{election.title}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Organization: {election.organizations?.name || "Unknown"}
                        </p>
                      </div>
                      <span className="status-pill">{election.status}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="table-shell">
              <div className="border-b border-[rgba(104,86,72,0.1)] px-6 py-5">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8ba4c7]">
                  Audit Activity
                </p>
                <h3 className="mt-2 text-xl font-black text-[#1d262f]">Latest system actions</h3>
              </div>

              <div>
                {recentLogs.length === 0 ? (
                  <p className="p-6 text-sm text-gray-500">No recent activities yet.</p>
                ) : (
                  recentLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex gap-4 border-b border-[rgba(104,86,72,0.08)] px-6 py-4 last:border-b-0"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(17,128,106,0.12)] text-[#11806a]">
                        <Clock size={16} />
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-[#1d262f]">{log.action}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {log.timestamp
                            ? new Date(log.timestamp).toLocaleString()
                            : "-"}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default Dashboard;
