import { studentElectionFailure } from "./studentElectionAccess.js";

// Metadata only explains why the UI is unavailable. A frozen timestamp is never
// sufficient authorization: all candidate reads still go through the JWT RPC.
export async function loadStudentBallotCandidates(client, election) {
  if (Number(election?.electorate_policy_version) === 1 && !election.electorate_frozen_at) {
    return { data: [], error: { code: "BALLOT_UNFINALIZED", message: "The Electoral Board has not finalized this election's electorate. Candidates and ballot selection will be available only after a valid electorate lock and while voting is open." } };
  }
  const { data, error, status } = await client.rpc("kandid_get_student_ballot_candidates", {
    p_election_id: Number(election.id),
  }).retry(false);
  if (error) return { data: [], error: { ...error, message: studentElectionFailure(error, status).message } };
  if (!Array.isArray(data)) return { data: [], error: { message: "The ballot candidate response could not be verified. Retry before making selections." } };
  return { data, error: null };
}
