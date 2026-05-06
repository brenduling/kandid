import { useEffect, useState } from "react";
import { Vote, CheckCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useNavigate } from "react-router-dom";

function StudentDashboard() {
  const [elections, setElections] = useState([]);
  const [votedMap, setVotedMap] = useState({});
  const [loading, setLoading] = useState(true);

  const user = JSON.parse(localStorage.getItem("user"));
  const navigate = useNavigate();

  useEffect(() => {
    fetchDashboard();
  }, []);

  async function fetchDashboard() {
    setLoading(true);

    if (!user) return;

    // 1. Get elections (we will refine eligibility later)
    const { data: electionData } = await supabase
      .from("elections")
      .select("*")
      .eq("status", "active");

    setElections(electionData || []);

    // 2. Get votes of this student
    const { data: voteData } = await supabase
      .from("votes")
      .select("election_id")
      .eq("student_id", user.id);

    const voted = {};
    voteData?.forEach((v) => {
      voted[v.election_id] = true;
    });

    setVotedMap(voted);

    setLoading(false);
  }

  return (
    <div>
      <div>
        <h1 className="text-3xl font-black">Welcome</h1>
        <p className="text-gray-500 mt-1">
          Participate in your organization elections.
        </p>
      </div>

      {loading ? (
        <p className="mt-10 text-gray-500">Loading...</p>
      ) : (
        <div className="grid grid-cols-3 gap-6 mt-8">
          {elections.length === 0 ? (
            <p className="text-gray-500 col-span-3">
              No active elections available.
            </p>
          ) : (
            elections.map((election) => {
              const hasVoted = votedMap[election.id];

              return (
                <div
                  key={election.id}
                  className="bg-white p-6 rounded-2xl shadow-sm flex flex-col justify-between"
                >
                  <div>
                    <h2 className="text-xl font-black">
                      {election.title}
                    </h2>

                    <p className="text-sm text-gray-500 mt-2">
                      {election.start_date
                        ? new Date(
                            election.start_date
                          ).toLocaleString()
                        : "-"}{" "}
                      —{" "}
                      {election.end_date
                        ? new Date(
                            election.end_date
                          ).toLocaleString()
                        : "-"}
                    </p>
                  </div>

                  <div className="mt-6">
                    {hasVoted ? (
                      <div className="flex items-center gap-2 text-green-600 font-bold">
                        <CheckCircle size={18} />
                        Already Voted
                      </div>
                    ) : (
                      <button
                        onClick={() =>
                          navigate(`/student/vote/${election.id}`)
                        }
                        className="w-full flex items-center justify-center gap-2 bg-[#ff5a1f] text-white py-3 rounded-xl font-bold hover:bg-[#e24d17]"
                      >
                        <Vote size={18} />
                        Vote Now
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default StudentDashboard;