import { supabase } from "../lib/supabaseClient";

/**
 * Loads candidate identity fields only through the database's active-admin,
 * organization-scoped contract. Ordinary authenticated Students cannot call
 * this successfully and never receive candidates.student_id from PostgREST.
 */
export async function loadAdminCandidates({ electionIds, studentIds } = {}) {
  const normalizedElectionIds = Array.isArray(electionIds)
    ? [...new Set(electionIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    : [];
  const normalizedStudentIds = Array.isArray(studentIds)
    ? [...new Set(studentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    : [];

  if (normalizedElectionIds.length > 200 || normalizedStudentIds.length > 200) {
    return { data: null, error: new Error("Candidate request exceeds the allowed scope.") };
  }
  if (normalizedElectionIds.length === 0 && normalizedStudentIds.length === 0) {
    return { data: [], error: null };
  }

  return supabase.rpc("kandid_admin_candidate_directory", {
    p_election_ids: normalizedElectionIds.length ? normalizedElectionIds : null,
    p_student_ids: normalizedStudentIds.length ? normalizedStudentIds : null,
  });
}
