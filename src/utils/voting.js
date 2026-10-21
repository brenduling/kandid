import { guardedSupabaseFetch, supabase } from "../lib/supabaseClient";
import { callVoteAccess } from "./voteAccess";
import { READ_ONLY_DASHBOARD_MODE } from "./localProductionReadOnly";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_KEY;

export async function hasStudentVotedInElection(_studentId, electionId, client = supabase) {
  const { data, error } = await callVoteAccess("student_has_voted", {
    election_id: Number(electionId),
  }, client);

  if (error) {
    return { hasVoted: false, error };
  }

  return { hasVoted: Boolean(data?.has_voted), error: null };
}

export async function submitBallot({
  electionId,
  selectedVotes,
  accessToken,
  accessCode,
  location,
}) {
  // Default-off rollout switch, never an authorization claim. The trusted
  // endpoint still checks Auth, schedule, membership, frozen roster and votes.
  const election4RecoveryEnabled = Number(electionId) === 4 &&
    import.meta.env.VITE_ENABLE_ELECTION_4_RECOVERY === "true";
  if (import.meta.env.MODE === READ_ONLY_DASHBOARD_MODE ||
      (import.meta.env.MODE === "development" && !election4RecoveryEnabled)) {
    return {
      error: new Error("Ballot submission is disabled until the production backend is approved for activation."),
      alreadyVoted: false,
      submittedAt: null,
    };
  }

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

    const response = await guardedSupabaseFetch(`${supabaseUrl}/functions/v1/submit-vote`, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${studentAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        election_id: Number(electionId),
        selected_votes: selectedVotes,
        access_code: String(accessCode || "").trim().toUpperCase(),
        location,
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
