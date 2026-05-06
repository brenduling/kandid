import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

function StudentVotePage() {
  const { electionId } = useParams();
  const navigate = useNavigate();

  const user = JSON.parse(localStorage.getItem("user"));

  const [election, setElection] = useState(null);
  const [positions, setPositions] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selectedVotes, setSelectedVotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchBallot();
  }, []);

  async function fetchBallot() {
    setLoading(true);

    const { data: electionData } = await supabase
      .from("elections")
      .select("*, organizations(name)")
      .eq("id", electionId)
      .single();

    const { data: positionData } = await supabase
      .from("positions")
      .select("*")
      .eq("election_id", electionId)
      .order("id", { ascending: true });

    const positionIds = positionData?.map((p) => p.id) || [];

    let candidateData = [];

    if (positionIds.length > 0) {
      const { data } = await supabase
        .from("candidates")
        .select(`
          *,
          students(first_name, last_name, student_number),
          partylists(name)
        `)
        .in("position_id", positionIds);

      candidateData = data || [];
    }

    setElection(electionData);
    setPositions(positionData || []);
    setCandidates(candidateData);
    setLoading(false);
  }

  function handleSelect(position, candidateId) {
    setSelectedVotes({
      ...selectedVotes,
      [position.id]: {
        position_id: position.id,
        candidate_id: candidateId,
        is_abstain: false,
      },
    });
  }

  function handleAbstain(position) {
    setSelectedVotes({
      ...selectedVotes,
      [position.id]: {
        position_id: position.id,
        candidate_id: null,
        is_abstain: true,
      },
    });
  }

  async function handleSubmitVotes() {
    const missingPosition = positions.find(
      (position) => !selectedVotes[position.id]
    );

    if (missingPosition) {
      alert(`Please select a vote or abstain for ${missingPosition.name}.`);
      return;
    }

    if (!window.confirm("Submit your votes? This action cannot be undone.")) {
      return;
    }

    setSubmitting(true);

    const voteRows = Object.values(selectedVotes).map((vote) => {
      const rawHash = `${user.id}-${electionId}-${vote.position_id}-${vote.candidate_id || "abstain"}-${Date.now()}`;
      const voteHash = btoa(rawHash);

      return {
        student_id: user.id,
        election_id: Number(electionId),
        position_id: vote.position_id,
        candidate_id: vote.candidate_id,
        is_abstain: vote.is_abstain,
        vote_hash: voteHash,
        blockchain_tx_id: null,
      };
    });

    const { error } = await supabase.from("votes").insert(voteRows);

    if (error) {
      alert(error.message);
      setSubmitting(false);
      return;
    }

    alert("Vote submitted successfully.");
    navigate("/student/receipt");
  }

  if (loading) {
    return <p className="text-gray-500">Loading ballot...</p>;
  }

  if (!election) {
    return <p className="text-red-600 font-bold">Election not found.</p>;
  }

  return (
    <div>
      <div className="bg-white p-6 rounded-2xl shadow-sm">
        <p className="text-sm font-bold text-[#ff5a1f]">
          {election.organizations?.name}
        </p>
        <h1 className="text-3xl font-black mt-1">{election.title}</h1>
        <p className="text-gray-500 mt-2">
          Select your preferred candidate for each position. You may also abstain.
        </p>
      </div>

      <div className="mt-8 space-y-6">
        {positions.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl text-gray-500">
            No positions found for this election.
          </div>
        ) : (
          positions.map((position) => {
            const positionCandidates = candidates.filter(
              (candidate) => candidate.position_id === position.id
            );

            return (
              <div
                key={position.id}
                className="bg-white p-6 rounded-2xl shadow-sm"
              >
                <h2 className="text-xl font-black">{position.name}</h2>
                <p className="text-sm text-gray-500 mb-4">
                  Choose one candidate or abstain.
                </p>

                <div className="grid grid-cols-2 gap-4">
                  {positionCandidates.map((candidate) => {
                    const selected =
                      selectedVotes[position.id]?.candidate_id === candidate.id;

                    return (
                      <button
                        key={candidate.id}
                        onClick={() => handleSelect(position, candidate.id)}
                        className={`text-left p-4 rounded-xl border transition ${
                          selected
                            ? "border-[#ff5a1f] bg-orange-50"
                            : "border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        <p className="font-black">
                          {candidate.students?.first_name}{" "}
                          {candidate.students?.last_name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {candidate.partylists?.name || "Independent"}
                        </p>
                        {candidate.bio && (
                          <p className="text-sm text-gray-600 mt-2">
                            {candidate.bio}
                          </p>
                        )}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => handleAbstain(position)}
                    className={`text-left p-4 rounded-xl border transition ${
                      selectedVotes[position.id]?.is_abstain
                        ? "border-gray-800 bg-gray-100"
                        : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <p className="font-black">Abstain</p>
                    <p className="text-xs text-gray-500">
                      I choose not to vote for this position.
                    </p>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {positions.length > 0 && (
        <div className="mt-8 flex justify-end">
          <button
            disabled={submitting}
            onClick={handleSubmitVotes}
            className="bg-[#ff5a1f] text-white px-8 py-4 rounded-xl font-black hover:bg-[#e24d17] disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit Ballot"}
          </button>
        </div>
      )}
    </div>
  );
}

export default StudentVotePage;