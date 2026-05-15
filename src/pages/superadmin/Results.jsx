import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { buildElectionAnalytics } from "../../utils/results";

function Results() {
  const [votes, setVotes] = useState([]);
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState("");

  useEffect(() => {
    let active = true;

    async function loadData() {
      const { data: votesData } = await supabase
        .from("votes")
        .select(`
          *,
          students (
            program,
            year_level
          ),
          candidates (
            id,
            students (first_name, last_name)
          ),
          positions (id, name),
          elections (
            id,
            title,
            organization_id,
            organizations(name)
          )
        `);

      const { data: electionsData } = await supabase
        .from("elections")
        .select("id, title, organization_id, organizations(name)");

      if (!active) return;

      setVotes(votesData || []);
      setElections(electionsData || []);
    }

    loadData();

    return () => {
      active = false;
    };
  }, []);

  const filteredVotes = votes.filter(
    (v) => v.election_id === Number(selectedElection)
  );
  const activeElection = elections.find(
    (election) => election.id === Number(selectedElection)
  );
  const analytics = buildElectionAnalytics(filteredVotes, activeElection);

  return (
    <div>
      <h1 className="text-3xl font-black">Results Management</h1>
      <p className="text-gray-500 mt-1">
        View election results and vote tally.
      </p>

      <div className="mt-6">
        <select
          value={selectedElection}
          onChange={(e) => setSelectedElection(e.target.value)}
          className="bg-white px-4 py-3 rounded-xl shadow-sm outline-none"
        >
          <option value="">Select Election</option>
          {elections.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-8 space-y-6">
        {!selectedElection ? (
          <div className="text-gray-500">Select an election to view results.</div>
        ) : Object.keys(analytics.groupedResults).length === 0 ? (
          <div className="text-gray-500">No results yet.</div>
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
                  Election History
                </p>
                <h3 className="mt-3 text-3xl font-black">Cross-cycle comparison</h3>
                <p className="mt-4 text-sm leading-7 text-white/65">
                  Super admins can review exact vote totals and voter allocation for
                  current and previous elections across all organizations from one place.
                </p>
              </div>
            </div>

            {Object.values(analytics.groupedResults).map((group, idx) => {
            const sortedCandidates = Object.values(group.candidates).sort(
              (a, b) => b.votes - a.votes
            );

            return (
              <div key={idx} className="bg-white p-6 rounded-2xl shadow-sm">
                <h2 className="text-xl font-black mb-4">
                  {group.position}
                </h2>

                <table className="w-full text-left">
                  <thead>
                    <tr>
                      <th className="py-2">Candidate</th>
                      <th className="py-2">Votes</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {sortedCandidates.map((c, i) => (
                      <tr key={i}>
                        <td className="py-2 font-semibold">{c.name}</td>
                        <td className="py-2">{c.votes}</td>
                        <td className="py-2">
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
                      <td className="py-2 font-semibold text-gray-500">
                        Abstain
                      </td>
                      <td className="py-2">{group.abstain}</td>
                      <td>-</td>
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

export default Results;
