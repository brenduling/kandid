import { supabase } from "../lib/supabaseClient";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_KEY;

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
  electionId,
  selectedVotes,
  accessToken,
}) {
  try {
    let studentAccessToken = accessToken;

    if (!studentAccessToken) {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        return {
          error: new Error("Your session has expired. Please sign in again."),
          alreadyVoted: false,
          submittedAt: null,
        };
      }

      studentAccessToken = session.access_token;
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/submit-vote`, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${studentAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        election_id: Number(electionId),
        selected_votes: selectedVotes,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        error: new Error(payload?.error || "Failed to submit vote. Please try again."),
        alreadyVoted: Boolean(payload?.already_voted),
        submittedAt: null,
      };
    }

    const ballotId = payload?.data?.ballot_id || null;
    return {
      error: null,
      alreadyVoted: false,
      submittedAt: payload?.data?.submitted_at || null,
      ballotId,
    };
  } catch (error) {
    return {
      error,
      alreadyVoted: false,
      submittedAt: null,
    };
  }
}
