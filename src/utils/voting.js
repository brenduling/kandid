import { supabase } from "../lib/supabaseClient";
import { hashVoteRecord } from "./blockchain";
import { fetchAuthoritativeNow, getElectionPhase } from "./elections";

export async function hasStudentVotedInElection(studentId, electionId) {
  const { data, error } = await supabase
    .from("votes")
    .select("id")
    .eq("student_id", studentId)
    .eq("election_id", Number(electionId))
    .limit(1);

  if (error) {
    return { hasVoted: false, error };
  }

  return { hasVoted: (data || []).length > 0, error: null };
}

export async function submitBallot({
  studentId,
  electionId,
  selectedVotes,
}) {
  const { data: election, error: electionError } = await supabase
    .from("elections")
    .select("id, status, campaign_start, campaign_end, start_date, end_date")
    .eq("id", Number(electionId))
    .single();

  if (electionError) {
    return { error: electionError };
  }

  const serverNow = await fetchAuthoritativeNow();
  if (getElectionPhase(election, serverNow) !== "voting") {
    return {
      error: new Error("Voting is not open for this election right now."),
      alreadyVoted: false,
    };
  }

  const duplicateCheck = await hasStudentVotedInElection(studentId, electionId);

  if (duplicateCheck.error) {
    return { error: duplicateCheck.error };
  }

  if (duplicateCheck.hasVoted) {
    return {
      error: new Error("This student has already voted in this election."),
      alreadyVoted: true,
    };
  }

  const submittedAt = serverNow.toISOString();

  const normalizedVotes = Object.values(selectedVotes).flatMap((vote) => {
    if (vote.is_abstain) return [vote];
    if (Array.isArray(vote.candidate_ids)) {
      return vote.candidate_ids.map((candidateId) => ({
        position_id: vote.position_id,
        candidate_id: candidateId,
        is_abstain: false,
      }));
    }
    return [vote];
  });

  const voteRows = await Promise.all(
    normalizedVotes.map(async (vote) => ({
      student_id: studentId,
      election_id: Number(electionId),
      position_id: vote.position_id,
      candidate_id: vote.candidate_id,
      is_abstain: vote.is_abstain,
      vote_timestamp: submittedAt,
      vote_hash: await hashVoteRecord({
        studentId,
        electionId,
        positionId: vote.position_id,
        candidateId: vote.candidate_id,
        isAbstain: vote.is_abstain,
        submittedAt,
      }),
      blockchain_tx_id: null,
    })),
  );

  const { error } = await supabase.from("votes").insert(voteRows);

  return {
    error,
    alreadyVoted: false,
    submittedAt,
  };
}
