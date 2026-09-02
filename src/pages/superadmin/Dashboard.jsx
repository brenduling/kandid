import { useEffect, useState } from "react";
import {
  Building2,
  CheckCircle,
  Clock,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { fetchAuditLogs } from "../../utils/auditLog";

function Dashboard() {
  const [stats, setStats] = useState({
    organizations: 0,
    students: 0,
    activeElections: 0,
    votes: 0,
    pendingReview: 0,
  });
  const [programStats, setProgramStats] = useState([]);
  const [recentActivities, setRecentActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const voteGraphTones = [
    "linear-gradient(180deg, #ff6a33 0%, #d63d12 100%)",
    "linear-gradient(180deg, #f59e0b 0%, #c2410c 100%)",
    "linear-gradient(180deg, #14b8a6 0%, #0f766e 100%)",
    "linear-gradient(180deg, #64748b 0%, #334155 100%)",
    "linear-gradient(180deg, #fb7185 0%, #be123c 100%)",
    "linear-gradient(180deg, #38bdf8 0%, #2563eb 100%)",
  ];

  useEffect(() => {
    fetchDashboardData();
    window.addEventListener("kandid-audit-updated", fetchDashboardData);
    return () => window.removeEventListener("kandid-audit-updated", fetchDashboardData);
  }, []);

  async function fetchDashboardData() {
    setLoading(true);

    try {
      const [
        { count: orgCount },
        { count: studentCount },
        { count: activeElectionCount },
        { count: voteCount },
        { count: pendingCount },
        { data: studentPrograms },
      ] = await Promise.all([
        supabase.from("organizations").select("id", { count: "exact", head: true }),
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase
          .from("elections")
          .select("id", { count: "exact", head: true })
          .eq("status", "active"),
        supabase.from("votes").select("id", { count: "exact", head: true }),
        supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase.from("students").select("program"),
      ]);

      setStats({
        organizations: orgCount || 0,
        students: studentCount || 0,
        activeElections: activeElectionCount || 0,
        votes: voteCount || 0,
        pendingReview: pendingCount || 0,
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
          share: totalPrograms > 0 ? Math.round((count / totalPrograms) * 100) : 0,
          percent:
            totalPrograms > 0 ? Math.max(8, Math.round((count / totalPrograms) * 100)) : 0,
        }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 6);

      setProgramStats(normalizedPrograms);

      const { data: auditActivities, error: auditError } = await fetchAuditLogs({ limit: 5 });
      if (auditError) {
        console.warn("Failed to load recent audit activity:", auditError);
      }
      setRecentActivities(auditActivities || []);
    } catch (err) {
      console.error("Error fetching dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }

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

        <button onClick={fetchDashboardData} className="primary-btn self-start lg:self-auto uppercase tracking-wider text-xs">
          <RefreshCw size={14} />
          Refresh Data
        </button>
      </div>

      {loading ? (
        <div className="glass-panel mt-8 rounded-[28px] p-8 text-gray-500">
          Loading dashboard...
        </div>
      ) : (
        <>
          {/* Main Grid: Turnout (Left) + Metrics (Right) */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr] mt-8">
            
            {/* Turnout Snapshot (Left Column) */}
            <div className="graph-card flex flex-col justify-between min-h-[380px]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Total Votes Cast</p>
                  <h2 className="mt-2 text-6xl font-black tracking-tight text-[#c2410c]">
                    {stats.votes.toLocaleString()}
                  </h2>
                </div>
                <span className="inline-flex items-center gap-1.2 rounded-full bg-[#c2410c]/8 px-3.5 py-1 text-xs font-bold text-[#c2410c]">
                  <TrendingUp size={13} />
                  +12% this week
                </span>
              </div>

              {/* Bar Chart */}
              <div className="mt-6">
                <div className="flex h-[200px] items-end gap-3 overflow-visible rounded-[24px] bg-slate-50/50 border border-slate-100/80 px-6 pb-6 pt-6">
                  {(programStats.length > 0
                    ? programStats
                    : [
                        { program: "CSIT", count: 40, percent: 80 },
                        { program: "ECE", count: 25, percent: 50 },
                        { program: "ME", count: 20, percent: 40 },
                        { program: "CE", count: 15, percent: 30 },
                        { program: "EE", count: 10, percent: 20 },
                        { program: "BBA", count: 10, percent: 20 },
                      ]
                  ).map((item, index) => (
                    <div
                      key={item.program}
                      className="group relative flex min-w-0 flex-1 flex-col items-center justify-end gap-3 h-full"
                      tabIndex={0}
                    >
                      <div className="pointer-events-none absolute bottom-[calc(100%+0.75rem)] left-1/2 z-20 w-44 -translate-x-1/2 rounded-2xl border border-orange-100 bg-white px-4 py-3 text-left opacity-0 shadow-2xl shadow-orange-100/70 transition duration-150 group-hover:opacity-100 group-focus:opacity-100">
                        <p className="truncate text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                          {item.program}
                        </p>
                        <div className="mt-2 flex items-end justify-between gap-3">
                          <strong className="text-2xl font-black leading-none text-[#c2410c]">
                            {item.count.toLocaleString()}
                          </strong>
                          <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-black text-[#c2410c]">
                            {item.share ?? item.percent}%
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          votes from this program
                        </p>
                      </div>
                      <div
                        className="w-full rounded-t-[10px] shadow-[0_8px_18px_rgba(194,65,12,0.15)] transition duration-150 group-hover:-translate-y-1 group-hover:shadow-[0_14px_28px_rgba(194,65,12,0.24)] group-focus:-translate-y-1 group-focus:shadow-[0_14px_28px_rgba(194,65,12,0.24)]"
                        style={{
                          height: `${Math.max(item.percent * 1.5, 20)}px`,
                          background: voteGraphTones[index % voteGraphTones.length],
                        }}
                      />
                      <p className="w-full truncate text-center text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                        {item.program}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 2x2 Grid of Metrics (Right Column) */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                {
                  title: "ORGANIZATIONS",
                  value: stats.organizations,
                  icon: Building2,
                },
                {
                  title: "STUDENTS",
                  value: stats.students,
                  icon: Users,
                },
                {
                  title: "ACTIVE ELECTIONS",
                  value: stats.activeElections,
                  icon: CheckCircle,
                },
                {
                  title: "PENDING REVIEW",
                  value: stats.pendingReview,
                  icon: Clock,
                },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.title}
                    className="metric-card flex flex-col justify-between p-6 hover:translate-y-[-2px] transition-transform duration-200"
                  >
                    <div className="flex items-start justify-between">
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400">
                        {card.title}
                      </p>
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#c2410c]/10 text-[#c2410c]">
                        <Icon size={18} />
                      </div>
                    </div>
                    <h3 className="mt-6 text-4xl font-black text-slate-900 leading-none sm:text-5xl">
                      {card.value}
                    </h3>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Full Width Recent Activity Table */}
          <div className="table-shell mt-6">
            <div className="border-b border-slate-100 px-6 py-5">
              <h3 className="text-lg font-black text-slate-900">Recent Activity</h3>
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
                  ) : recentActivities.map((activity) => (
                    <tr key={activity.id}>
                      <td className="font-bold text-slate-800">
                        {activity.event}
                      </td>
                      <td className="text-slate-500 font-medium">{activity.organization}</td>
                      <td>
                        <span className={`status-pill ${
                          activity.status === "Completed" ? "bg-emerald-50 text-emerald-700 border border-emerald-100/60" :
                          activity.status === "Draft" ? "bg-slate-100 text-slate-700 border border-slate-200/60" :
                          "bg-rose-50 text-rose-700 border border-rose-100/60"
                        }`}>
                          {activity.status}
                        </span>
                      </td>
                      <td className="text-slate-400 font-medium">{activity.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default Dashboard;
