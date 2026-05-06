import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function BoardResults() {
  const [votes, setVotes] = useState([]);
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState("");

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    if (!orgId) return;

    const { data: orgElections } = await supabase
      .from("elections")
      .select("id, title")
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

  const grouped = {};

  filteredVotes.forEach((vote) => {
    if (!grouped[vote.position_id]) {
      grouped[vote.position_id] = {
        position: vote.positions?.name,
        candidates: {},
        abstain: 0,
      };
    }

    if (vote.is_abstain) {
      grouped[vote.position_id].abstain++;
    } else if (vote.candidate_id) {
      const candidateId = vote.candidate_id;

      if (!grouped[vote.position_id].candidates[candidateId]) {
        grouped[vote.position_id].candidates[candidateId] = {
          name: `${vote.candidates?.students?.first_name || ""} ${
            vote.candidates?.students?.last_name || ""
          }`,
          votes: 0,
        };
      }

      grouped[vote.position_id].candidates[candidateId].votes++;
    }
  });

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
        ) : Object.keys(grouped).length === 0 ? (
          <div className="bg-white p-8 rounded-2xl shadow-sm text-gray-500">
            No results yet.
          </div>
        ) : (
          Object.values(grouped).map((group, index) => {
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
          })
        )}
      </div>
    </div>
  );
}

export default BoardResults;