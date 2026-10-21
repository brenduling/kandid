import { studentElectionFailure } from "./studentElectionAccess.js";

// Only the JWT-authorized RPC decides eligibility. Snapshot metadata is historical
// information, not a prerequisite or an authorization claim made by the browser.
export async function loadStudentBallotCandidates(client, election) {
  const { data, error, status } = await client.rpc("kandid_get_student_ballot_candidates", {
    p_election_id: Number(election.id),
  }).retry(false);
  if (error) return { data: [], error: { ...error, message: studentElectionFailure(error, status).message } };
  if (!Array.isArray(data)) return { data: [], error: { message: "The ballot candidate response could not be verified. Retry before making selections." } };
  return { data, error: null };
}
