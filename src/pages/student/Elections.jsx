import { useEffect, useState } from "react";
import { Vote, CheckCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

function StudentElections() {
  const [elections, setElections] = useState([]);
  const [votes, setVotes] = useState([]);
  const [loading, setLoading] = useState(true);

  const user = JSON.parse(localStorage.getItem("user"));
  const navigate = useNavigate();

  useEffect(() => {
    fetchElections();
  }, []);

  async function fetchElections() {
    setLoading(true);

    const { data: studentOrgs } = await supabase
      .from("student_organizations")
      .select("organization_id")
      .eq("student_id", user.id);

    const organizationIds =
      studentOrgs?.map((item) => item.organization_id) || [];

    if (organizationIds.length === 0) {
      setElections([]);
      setLoading(false);
      return;
    }

    const { data: electionData } = await supabase
      .from("elections")
      .select(`
        *,
        organizations (
          name
        )
      `)
      .in("organization_id", organizationIds)
      .eq("status", "active");

    const { data: voteData } = await supabase
      .from("votes")
      .select("election_id")
      .eq("student_id", user.id);

    setElections(electionData || []);
    setVotes(voteData || []);
    setLoading(false);
  }

  function hasVoted(electionId) {
    return votes.some((vote) => vote.election_id === electionId);
  }

  return (
    <div>
      <h1 className="text-3xl font-black">Available Elections</h1>
      <p className="text-gray-500 mt-1">
        View active elections for your assigned organizations.
      </p>

      {loading ? (
        <p className="mt-8 text-gray-500">Loading elections...</p>
      ) : (
        <div className="grid grid-cols-3 gap-6 mt-8">
          {elections.length === 0 ? (
            <div className="col-span-3 bg-white p-8 rounded-2xl shadow-sm text-gray-500">
              No active elections available for your account.
            </div>
          ) : (
            elections.map((election) => {
              const alreadyVoted = hasVoted(election.id);

              return (
                <div
                  key={election.id}
                  className="bg-white p-6 rounded-2xl shadow-sm"
                >
                  <p className="text-xs font-bold text-[#ff5a1f]">
                    {election.organizations?.name || "Organization"}
                  </p>

                  <h2 className="text-xl font-black mt-2">
                    {election.title}
                  </h2>

                  <p className="text-sm text-gray-500 mt-3">
                    {election.start_date
                      ? new Date(election.start_date).toLocaleString()
                      : "-"}{" "}
                    —{" "}
                    {election.end_date
                      ? new Date(election.end_date).toLocaleString()
                      : "-"}
                  </p>

                  <div className="mt-6">
                    {alreadyVoted ? (
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

export default StudentElections;