import { supabase } from "../lib/supabaseClient";
import { callVoteAccess } from "./voteAccess";
import { isMissingPositionOrderError } from "./positionOrder";
import { getStoredUser } from "./auth";
import { loadAdminCandidates } from "./adminCandidates";

function uniqueIds(values = []) {
  return [...new Set(values.map(Number).filter((value) => Number.isFinite(value) && value > 0))];
}

function byId(rows = []) {
  return new Map((rows || []).map((row) => [Number(row.id), row]));
}

export async function fetchElectionResultDataset(elections = []) {
  const electionRows = (Array.isArray(elections) ? elections : [elections]).filter(Boolean);
  const electionIds = uniqueIds(electionRows.map((election) => election.id));
  if (electionIds.length !== 1) return { votes: [], candidates: [], error: null };

  const election = electionRows[0];
  const [voteResult, positionResult] = await Promise.all([
    callVoteAccess("election_results", { election_id: electionIds[0] }),
    supabase.from("positions")
      .select("id, name, election_id, max_votes, display_order")
      .eq("election_id", electionIds[0])
      .order("display_order", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  let resolvedPositions = positionResult;
  if (isMissingPositionOrderError(positionResult.error)) {
    resolvedPositions = await supabase.from("positions")
      .select("id, name, election_id, max_votes")
      .eq("election_id", electionIds[0])
      .order("id", { ascending: true });
  }
  if (voteResult.error) return { votes: [], candidates: [], error: voteResult.error };
  if (resolvedPositions.error) return { votes: [], candidates: [], error: resolvedPositions.error };

  const positions = (resolvedPositions.data || []).map((position, index) => ({
    ...position,
    display_order: position.display_order || index + 1,
  }));
  const positionById = byId(positions);
  const role = getStoredUser()?.role;
  const candidateResult = !positions.length
    ? { data: [], error: null }
    : role === "student"
      ? await supabase.rpc("kandid_get_student_result_candidates", { p_election_id: electionIds[0] })
      : ["super_admin", "electoral_board"].includes(role)
        ? await loadAdminCandidates({ electionIds })
        : { data: null, error: new Error("Authorized candidate results are unavailable.") };
  if (candidateResult.error) return { votes: [], candidates: [], error: candidateResult.error };

  const candidateRows = candidateResult.data || [];
  const candidates = candidateRows.map((candidate) => {
    const position = positionById.get(Number(candidate.position_id));
    return {
      ...candidate,
      students: candidate.students || null,
      partylists: candidate.partylists || null,
      positions: position ? {
        id: position.id,
        name: position.name,
        election_id: position.election_id,
        display_order: position.display_order,
      } : null,
    };
  });
  const candidateById = byId(candidates);
  const voteRows = voteResult.data?.votes || [];
  const votes = voteRows.map((vote) => {
    if (vote._aggregate_summary) return vote;
    const position = positionById.get(Number(vote.position_id));
    const candidate = candidateById.get(Number(vote.candidate_id));
    return {
      ...vote,
      candidates: candidate || null,
      positions: position ? {
        id: position.id,
        name: position.name,
        display_order: position.display_order,
      } : null,
      elections: {
        id: election.id,
        title: election.title,
        organization_id: election.organization_id,
        organizations: election.organizations || null,
      },
    };
  });

  return {
    votes,
    candidates,
    error: null,
    metrics: {
      voteCount: voteRows.find((row) => row._aggregate_summary)?.totalVoteEntries || 0,
      candidateCount: candidates.length,
      positionCount: positions.length,
      uniqueStudentCount: voteRows.find((row) => row._aggregate_summary)?.totalUniqueVoters || 0,
    },
  };
}
