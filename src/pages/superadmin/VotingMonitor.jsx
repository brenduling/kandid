import { useEffect, useState } from "react";
import { RefreshCw, Vote, Users, Clock, CheckCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function VotingMonitor() {
  const [votes, setVotes] = useState([]);
  const [students, setStudents] = useState([]);
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState("all");

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const [
      { data: votesData, error: votesError },
      { data: studentsData, error: studentsError },
      { data: electionsData, error: electionsError },
    ] = await Promise.all([
      supabase
        .from("votes")
        .select(`
          id,
          election_id,
          position_id,
          candidate_id,
          student_id,
          is_abstain,
          vote_timestamp,
          blockchain_tx_id,
          students (
            student_number,
            first_name,
            last_name
          ),
          elections (
            title
          ),
          positions (
            name
          ),
          candidates (
            students (
              first_name,
              last_name
            )
          )
        `)
        .order("vote_timestamp", { ascending: false }),
      supabase
        .from("students")
        .select("id", { count: "exact" }),
      supabase
        .from("elections")
        .select("id, title")
        .order("id", { ascending: true }),
    ]);

    [votesError, studentsError, electionsError].filter(Boolean).forEach((error) => {
      console.error("Failed to load voting monitor data:", error);
    });

    setVotes(votesData || []);
    setStudents(studentsData || []);
    setElections(electionsData || []);
  }

  const filteredVotes =
    selectedElection === "all"
      ? votes
      : votes.filter((vote) => vote.election_id === Number(selectedElection));

  const uniqueVoters = new Set(filteredVotes.map((vote) => vote.student_id));

  const totalStudents = students.length;
  const totalVotes = filteredVotes.length;
  const totalVoters = uniqueVoters.size;
  const turnout =
    totalStudents > 0 ? ((totalVoters / totalStudents) * 100).toFixed(1) : 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Voting Monitor</h1>
          <p className="text-gray-500 mt-1">
            Monitor vote submissions, turnout, and election activity.
          </p>
        </div>

        <button onClick={fetchData} className="primary-btn">
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      <div className="mt-8 flex justify-between items-center">
        <select
          value={selectedElection}
          onChange={(e) => setSelectedElection(e.target.value)}
          className="field-shell bg-white px-4 py-3 outline-none"
        >
          <option value="all">All Elections</option>
          {elections.map((election) => (
            <option key={election.id} value={election.id}>
              {election.title}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-4 gap-6 mt-6">
        <div className="metric-card">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Total Votes</p>
            <Vote className="text-[#ff5a1f]" size={22} />
          </div>
          <h2 className="text-3xl font-black mt-2">{totalVotes}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Unique Voters</p>
            <Users className="text-[#ff5a1f]" size={22} />
          </div>
          <h2 className="text-3xl font-black mt-2">{totalVoters}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Total Students</p>
            <CheckCircle className="text-[#ff5a1f]" size={22} />
          </div>
          <h2 className="text-3xl font-black mt-2">{totalStudents}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Turnout</p>
            <Clock className="text-[#ff5a1f]" size={22} />
          </div>
          <h2 className="text-3xl font-black mt-2">{turnout}%</h2>
        </div>
      </div>

      <div className="table-shell mt-8">
        <table className="app-table">
          <thead>
            <tr>
              <th className="px-6 py-4 text-sm">Voter</th>
              <th className="px-6 py-4 text-sm">Election</th>
              <th className="px-6 py-4 text-sm">Position</th>
              <th className="px-6 py-4 text-sm">Vote Type</th>
              <th className="px-6 py-4 text-sm">Time</th>
              <th className="px-6 py-4 text-sm">Blockchain</th>
            </tr>
          </thead>

          <tbody>
            {filteredVotes.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-10 text-center text-gray-500">
                  No votes recorded yet.
                </td>
              </tr>
            ) : (
              filteredVotes.map((vote) => (
                <tr key={vote.id} className="border-b last:border-b-0">
                  <td className="px-6 py-4">
                    <p className="font-bold">
                      {vote.students?.first_name} {vote.students?.last_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {vote.students?.student_number}
                    </p>
                  </td>

                  <td className="px-6 py-4">
                    {vote.elections?.title || "-"}
                  </td>

                  <td className="px-6 py-4">
                    {vote.positions?.name || "-"}
                  </td>

                  <td className="px-6 py-4">
                    {vote.is_abstain ? (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700">
                        Abstain
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">
                        Candidate Vote
                      </span>
                    )}
                  </td>

                  <td className="px-6 py-4 text-sm text-gray-600">
                    {vote.vote_timestamp
                      ? new Date(vote.vote_timestamp).toLocaleString()
                      : "-"}
                  </td>

                  <td className="px-6 py-4">
                    {vote.blockchain_tx_id ? (
                      <span className="text-xs font-bold text-green-600">
                        Recorded
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-orange-600">
                        Pending
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default VotingMonitor;
