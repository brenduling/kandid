/** Presentation of failures only; RPCs remain the authorization authority. */
export function studentElectionFailure(error, status) {
  const code = error?.code || error?.cause?.code;
  const http = Number(status || error?.status || error?.context?.status || error?.cause?.context?.status);
  if (http === 401 || error?.name === "AuthSessionMissingError" ||
      ["28000", "PGRST301", "PGRST303", "session_not_found", "session_expired", "bad_jwt"].includes(code)) {
    return { kind: "UNAUTHORIZED", reason: "AUTHENTICATION_REQUIRED", message: "Your session has expired. Sign in again to continue." };
  }
  if (http === 403 || code === "42501") {
    return { kind: "UNAUTHORIZED", reason: "STUDENT_ACCESS_DENIED", message: "This election is not available to this student account." };
  }
  return { kind: "ERROR", reason: "SERVICE_UNAVAILABLE", message: "The election service could not be reached. Retry without signing out." };
}

/** Read-only check: frozen electorate and canonical eligibility stay server-side. */
export async function readStudentBallotAccess(client, electionId) {
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData?.user) return studentElectionFailure(authError, authError ? undefined : 401);
  const { data: vote, error: voteError } = await client.functions.invoke("vote-access", {
    body: { action: "student_has_voted", election_id: Number(electionId) },
  });
  if (voteError) return studentElectionFailure(voteError);
  if (typeof vote?.data?.has_voted !== "boolean") return studentElectionFailure(null);
  if (vote.data.has_voted) return { kind: "VOTED" };
  const { data, error, status } = await client.rpc("kandid_get_student_ballot_candidates", {
    p_election_id: Number(electionId),
  }).retry(false);
  if (error) return studentElectionFailure(error, status);
  if (!Array.isArray(data)) return studentElectionFailure(null);
  return { kind: data.length > 0 ? "ELIGIBLE" : "NOT_READY" };
}
