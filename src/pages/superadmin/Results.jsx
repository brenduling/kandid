import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

function Results() {
  const [votes, setVotes] = useState([]);
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const { data: votesData } = await supabase
      .from("votes")
      .select(`
        *,
        candidates (
          id,
          students (first_name, last_name)
        ),
        positions (id, name),
        elections (id, title)
      `);

    const { data: electionsData } = await supabase
      .from("elections")
      .select("id, title");

    setVotes(votesData || []);
    setElections(electionsData || []);
  }

  const filteredVotes = votes.filter(
    (v) => v.election_id === Number(selectedElection)
  );

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
          name:
            vote.candidates?.students?.first_name +
            " " +
            vote.candidates?.students?.last_name,
          votes: 0,
        };
      }

      grouped[vote.position_id].candidates[candidateId].votes++;
    }
  });

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
        {Object.keys(grouped).length === 0 ? (
          <div className="text-gray-500">No results yet.</div>
        ) : (
          Object.values(grouped).map((group, idx) => {
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
          })
        )}
      </div>
    </div>
  );
}

export default Results;