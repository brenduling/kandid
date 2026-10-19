import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { readStudentBallotAccess, studentElectionFailure } from "../../utils/studentElectionAccess";

export default function StudentBallotAction({ electionId }) {
  const navigate = useNavigate();
  const [response, setResponse] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const result = response?.electionId === electionId && response?.attempt === attempt
    ? response.result : { kind: "LOADING" };
  useEffect(() => {
    let active = true;
    readStudentBallotAccess(supabase, electionId)
      .then(result => { if (active) setResponse({ electionId, attempt, result }); })
      .catch(error => { if (active) setResponse({ electionId, attempt, result: studentElectionFailure(error) }); });
    return () => { active = false; };
  }, [electionId, attempt]);
  if (result.kind === "ELIGIBLE") return (
    <button type="button" className="student-election-action student-participation-action" onClick={() => navigate(`/student/vote/${electionId}`)}>
      Cast Your Vote
    </button>
  );
  return (
    <div className="student-participation-unavailable" aria-live="polite">
      {result.kind === "LOADING" ? "Checking ballot eligibility…" :
        result.kind === "VOTED" ? "Ballot submitted. Your vote is already recorded." :
        result.kind === "NOT_READY" ? "The ballot is not available yet. Check again shortly." : result.message}
      {["ERROR", "NOT_READY"].includes(result.kind) ? (
        <button type="button" className="student-outline-btn" onClick={() => setAttempt(value => value + 1)}>Retry</button>
      ) : null}
      {result.reason === "AUTHENTICATION_REQUIRED" ? (
        <button type="button" className="student-outline-btn" onClick={() => navigate("/student-login")}>Sign in</button>
      ) : null}
    </div>
  );
}
