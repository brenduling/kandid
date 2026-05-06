import { useEffect, useState } from "react";
import {
  Building2,
  Users,
  Vote,
  CheckCircle,
  BarChart3,
  ShieldCheck,
  RefreshCw,
  Clock,
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
      .select(`
        *,
        organizations (
          name
        )
      `)
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

    setRecentElections(electionsData || []);
    setRecentLogs(logsData || []);
    setLoading(false);
  }

  const turnout =
    stats.students > 0
      ? ((stats.votes / stats.students) * 100).toFixed(1)
      : 0;

  const cards = [
    {
      title: "Organizations",
      value: stats.organizations,
      icon: Building2,
      bg: "bg-orange-100",
      text: "text-orange-700",
    },
    {
      title: "Students",
      value: stats.students,
      icon: Users,
      bg: "bg-blue-100",
      text: "text-blue-700",
    },
    {
      title: "Total Elections",
      value: stats.elections,
      icon: Vote,
      bg: "bg-purple-100",
      text: "text-purple-700",
    },
    {
      title: "Active Elections",
      value: stats.activeElections,
      icon: CheckCircle,
      bg: "bg-green-100",
      text: "text-green-700",
    },
    {
      title: "Votes Cast",
      value: stats.votes,
      icon: BarChart3,
      bg: "bg-yellow-100",
      text: "text-yellow-700",
    },
    {
      title: "Blockchain Verified",
      value: stats.verifiedVotes,
      icon: ShieldCheck,
      bg: "bg-emerald-100",
      text: "text-emerald-700",
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-gray-800">
            Super Admin Dashboard
          </h1>
          <p className="text-gray-500 mt-1">
            Overview of the entire KANDID voting system.
          </p>
        </div>

        <button
          onClick={fetchDashboardData}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold hover:bg-[#e24d17]"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="mt-10 text-gray-500">Loading dashboard...</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-6 mt-8">
            {cards.map((card) => {
              const Icon = card.icon;

              return (
                <div
                  key={card.title}
                  className="bg-white p-6 rounded-2xl shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-500">{card.title}</p>

                    <div
                      className={`w-11 h-11 rounded-xl ${card.bg} ${card.text} flex items-center justify-center`}
                    >
                      <Icon size={22} />
                    </div>
                  </div>

                  <h2 className="text-4xl font-black mt-4">{card.value}</h2>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-6 mt-8">
            <div className="bg-[#1d1d1d] text-white p-6 rounded-2xl shadow-sm col-span-1">
              <p className="text-white/60 text-sm">Overall Turnout</p>
              <h2 className="text-5xl font-black mt-3">{turnout}%</h2>
              <p className="text-white/50 text-sm mt-3">
                Based on total votes cast compared to total registered students.
              </p>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm col-span-2">
              <h3 className="text-lg font-black mb-4">System Health</h3>

              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-3">
                  <span className="text-gray-600">Database Connection</span>
                  <span className="font-bold text-green-600">Online</span>
                </div>

                <div className="flex items-center justify-between border-b pb-3">
                  <span className="text-gray-600">Voting Module</span>
                  <span className="font-bold text-green-600">Ready</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Blockchain Records</span>
                  <span className="font-bold text-orange-600">
                    {stats.verifiedVotes}/{stats.votes} Verified
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mt-8">
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="p-6 border-b">
                <h3 className="text-lg font-black">Recent Elections</h3>
                <p className="text-sm text-gray-500">
                  Latest elections created in the system.
                </p>
              </div>

              <div>
                {recentElections.length === 0 ? (
                  <p className="p-6 text-gray-500 text-sm">
                    No elections found.
                  </p>
                ) : (
                  recentElections.map((election) => (
                    <div
                      key={election.id}
                      className="px-6 py-4 border-b last:border-b-0 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-bold">{election.title}</p>
                        <p className="text-xs text-gray-500">
                          {election.organizations?.name || "Unknown Organization"}
                        </p>
                      </div>

                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold ${
                          election.status === "active"
                            ? "bg-green-100 text-green-700"
                            : election.status === "closed"
                            ? "bg-gray-100 text-gray-700"
                            : "bg-orange-100 text-orange-700"
                        }`}
                      >
                        {election.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="p-6 border-b">
                <h3 className="text-lg font-black">Recent Activities</h3>
                <p className="text-sm text-gray-500">
                  Latest system audit logs.
                </p>
              </div>

              <div>
                {recentLogs.length === 0 ? (
                  <p className="p-6 text-gray-500 text-sm">
                    No recent activities yet.
                  </p>
                ) : (
                  recentLogs.map((log) => (
                    <div
                      key={log.id}
                      className="px-6 py-4 border-b last:border-b-0 flex gap-3"
                    >
                      <div className="w-9 h-9 rounded-xl bg-orange-100 text-[#ff5a1f] flex items-center justify-center">
                        <Clock size={16} />
                      </div>

                      <div>
                        <p className="font-semibold text-sm">{log.action}</p>
                        <p className="text-xs text-gray-500">
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