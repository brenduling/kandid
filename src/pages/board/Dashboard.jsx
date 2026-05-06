import { useEffect, useState } from "react";
import {
  Vote,
  Users,
  BarChart3,
  CheckCircle,
  RefreshCw,
  UserCheck,
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

  useEffect(() => {
    fetchDashboardData();
  }, []);

  async function fetchDashboardData() {
    setLoading(true);

    if (!orgId) {
      setLoading(false);
      return;
    }

    const { data: electionsData } = await supabase
      .from("elections")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    const electionIds = electionsData?.map((election) => election.id) || [];

    let positionsData = [];
    let candidatesData = [];
    let votesData = [];

    if (electionIds.length > 0) {
      const { data: posData } = await supabase
        .from("positions")
        .select("*")
        .in("election_id", electionIds);

      positionsData = posData || [];

      const positionIds = positionsData.map((position) => position.id);

      if (positionIds.length > 0) {
        const { data: candData } = await supabase
          .from("candidates")
          .select("*")
          .in("position_id", positionIds);

        candidatesData = candData || [];
      }

      const { data: voteData } = await supabase
        .from("votes")
        .select("*")
        .in("election_id", electionIds);

      votesData = voteData || [];
    }

    const uniqueVoters = new Set(votesData.map((vote) => vote.student_id));

    setStats({
      elections: electionsData?.length || 0,
      activeElections:
        electionsData?.filter((election) => election.status === "active")
          .length || 0,
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
      title: "Positions",
      value: stats.positions,
      icon: Users,
      bg: "bg-blue-100",
      text: "text-blue-700",
    },
    {
      title: "Candidates",
      value: stats.candidates,
      icon: UserCheck,
      bg: "bg-orange-100",
      text: "text-orange-700",
    },
    {
      title: "Votes Cast",
      value: stats.votes,
      icon: BarChart3,
      bg: "bg-yellow-100",
      text: "text-yellow-700",
    },
    {
      title: "Unique Voters",
      value: stats.voters,
      icon: Users,
      bg: "bg-emerald-100",
      text: "text-emerald-700",
    },
  ];

  if (!orgId) {
    return (
      <div className="bg-white p-8 rounded-2xl shadow-sm">
        <h1 className="text-3xl font-black text-red-600">
          No Organization Assigned
        </h1>
        <p className="text-gray-500 mt-2">
          This Electoral Board account has no assigned organization. Please ask
          the Super Admin to assign one.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Board Dashboard</h1>
          <p className="text-gray-500 mt-1">
            Managing election records for{" "}
            <span className="font-bold text-[#ff5a1f]">{orgName}</span>.
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
        <p className="mt-10 text-gray-500">Loading dashboard...</p>
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

          <div className="mt-8 bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="p-6 border-b">
              <h3 className="text-lg font-black">Recent Elections</h3>
              <p className="text-sm text-gray-500">
                Latest elections created for {orgName}.
              </p>
            </div>

            {recentElections.length === 0 ? (
              <p className="p-6 text-gray-500 text-sm">
                No elections found for this organization.
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
                      {election.start_date
                        ? new Date(election.start_date).toLocaleString()
                        : "No start date"}{" "}
                      —{" "}
                      {election.end_date
                        ? new Date(election.end_date).toLocaleString()
                        : "No end date"}
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
        </>
      )}
    </div>
  );
}

export default BoardDashboard;