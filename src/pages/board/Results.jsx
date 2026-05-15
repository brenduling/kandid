import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { buildElectionAnalytics } from "../../utils/results";

function BoardResults() {
  const [votes, setVotes] = useState([]);
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState("");

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;

  useEffect(() => {
    let active = true;

    async function loadData() {
      if (!orgId) return;

      const { data: orgElections } = await supabase
        .from("elections")
        .select("id, title, organization_id, organizations(name)")
        .eq("organization_id", orgId);

      const electionIds = orgElections?.map((e) => e.id) || [];

      if (!active) return;
      setElections(orgElections || []);

      if (electionIds.length === 0) {
        setVotes([]);
        return;
      }

      const { data: voteData, error } = await supabase
        .from("votes")
        .select(`
          *,
          students (
            program,
            year_level
          ),
          candidates (
            id,
            students (
              first_name,
              last_name
            )
          ),
          positions (
            id,
            name
          ),
          elections (
            id,
            title
          )
        `)
        .in("election_id", electionIds);

      if (!active) return;

      if (!error) setVotes(voteData || []);
      if (error) console.log(error);
    }

    loadData();

    return () => {
      active = false;
    };
  }, [orgId]);

  async function fetchData() {
    if (!orgId) return;

    const { data: orgElections } = await supabase
      .from("elections")
      .select("id, title, organization_id, organizations(name)")
      .eq("organization_id", orgId);

    const electionIds = orgElections?.map((e) => e.id) || [];

    setElections(orgElections || []);

    if (electionIds.length === 0) {
      setVotes([]);
      return;
    }

    const { data: voteData, error } = await supabase
      .from("votes")
      .select(`
        *,
        students (
          program,
          year_level
        ),
        candidates (
          id,
          students (
            first_name,
            last_name
          )
        ),
        positions (
          id,
          name
        ),
        elections (
          id,
          title
        )
      `)
      .in("election_id", electionIds);

    if (!error) setVotes(voteData || []);
    if (error) console.log(error);
  }

  const filteredVotes = selectedElection
    ? votes.filter((vote) => vote.election_id === Number(selectedElection))
    : [];
  const activeElection = elections.find(
    (election) => election.id === Number(selectedElection)
  );
  const analytics = buildElectionAnalytics(filteredVotes, activeElection);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Board Results</h1>
          <p className="text-gray-500 mt-1">
            View vote tallies for your organization elections.
          </p>
        </div>

        <button
          onClick={fetchData}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold hover:bg-[#e24d17]"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      <div className="mt-6">
        <select
          value={selectedElection}
          onChange={(e) => setSelectedElection(e.target.value)}
          className="bg-white px-4 py-3 rounded-xl shadow-sm outline-none"
        >
          <option value="">Select Election</option>
          {elections.map((election) => (
            <option key={election.id} value={election.id}>
              {election.title}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-8 space-y-6">
        {!selectedElection ? (
          <div className="bg-white p-8 rounded-2xl shadow-sm text-gray-500">
            Select an election to view results.
          </div>
        ) : Object.keys(analytics.groupedResults).length === 0 ? (
          <div className="bg-white p-8 rounded-2xl shadow-sm text-gray-500">
            No results yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {[
                ["Vote Entries", analytics.totalVoteEntries],
                ["Unique Voters", analytics.totalUniqueVoters],
                ["Abstain Count", analytics.totalAbstains],
              ].map(([label, value]) => (
                <div key={label} className="metric-card lift-card">
                  <p className="text-sm font-semibold text-gray-500">{label}</p>
                  <h2 className="mt-4 text-5xl font-black tracking-tight">{value}</h2>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
              <div className="soft-card">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                      {analytics.allocationLabel}
                    </p>
                    <h3 className="mt-2 text-2xl font-black">Voter distribution</h3>
                  </div>
                  <span className="status-pill">{analytics.organizationName}</span>
                </div>

                <div className="mt-6 space-y-4">
                  {analytics.allocationItems.map((item) => (
                    <div key={item.label} className="info-row">
                      <div>
                        <p className="text-sm font-bold text-[#1d262f]">{item.label}</p>
                        <p className="mt-1 text-xs text-gray-500">{item.percentage}% of voters</p>
                      </div>
                      <span className="text-lg font-black text-[#d35a25]">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass-panel-dark rounded-[30px] p-7 text-white">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                  Historical Tracking
                </p>
                <h3 className="mt-3 text-3xl font-black">Previous and current elections</h3>
                <p className="mt-4 text-sm leading-7 text-white/65">
                  Choose any election from your organization to review exact counts,
                  turnout, and program or year-level allocation, including older cycles.
                </p>
              </div>
            </div>

            {Object.values(analytics.groupedResults).map((group, index) => {
            const sortedCandidates = Object.values(group.candidates).sort(
              (a, b) => b.votes - a.votes
            );

            return (
              <div key={index} className="bg-white p-6 rounded-2xl shadow-sm">
                <h2 className="text-xl font-black mb-4">{group.position}</h2>

                <table className="w-full text-left">
                  <thead className="border-b">
                    <tr>
                      <th className="py-3 text-sm">Candidate</th>
                      <th className="py-3 text-sm">Votes</th>
                      <th className="py-3 text-sm">Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {sortedCandidates.map((candidate, i) => (
                      <tr key={i} className="border-b last:border-b-0">
                        <td className="py-3 font-semibold">
                          {candidate.name}
                        </td>
                        <td className="py-3">{candidate.votes}</td>
                        <td className="py-3">
                          {i === 0 ? (
                            <span className="text-green-600 font-bold">
                              Leading
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}

                    <tr>
                      <td className="py-3 font-semibold text-gray-500">
                        Abstain
                      </td>
                      <td className="py-3">{group.abstain}</td>
                      <td className="py-3">-</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
            })}
          </>
        )}
      </div>
    </div>
  );
}

export default BoardResults;
