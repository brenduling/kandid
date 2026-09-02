import { supabase } from "../lib/supabaseClient";

function uniqueIds(values = []) {
  return [
    ...new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  ];
}

function byId(rows = []) {
  return new Map((rows || []).map((row) => [Number(row.id), row]));
}

async function fetchRowsByIds(table, ids, select) {
  const safeIds = uniqueIds(ids);
  if (safeIds.length === 0) return { data: [], error: null };

  return supabase.from(table).select(select).in("id", safeIds);
}

export async function fetchElectionResultDataset(elections = []) {
  const electionRows = (Array.isArray(elections) ? elections : [elections]).filter(Boolean);
  const electionIds = uniqueIds(electionRows.map((election) => election.id));

  if (electionIds.length === 0) {
    return { votes: [], candidates: [], error: null };
  }

  const electionById = new Map(
    electionRows.map((election) => [Number(election.id), election]),
  );

  const [voteResult, positionResult] = await Promise.all([
    supabase
      .from("votes")
      .select("id, student_id, election_id, position_id, candidate_id, is_abstain, vote_hash")
      .in("election_id", electionIds),
    supabase
      .from("positions")
      .select("id, name, election_id, max_votes")
      .in("election_id", electionIds)
      .order("id", { ascending: true }),
  ]);

  if (voteResult.error) {
    return { votes: [], candidates: [], error: voteResult.error };
  }

  if (positionResult.error) {
    return { votes: [], candidates: [], error: positionResult.error };
  }

  const positions = (positionResult.data || []).map((position, index) => ({
    ...position,
    display_order: index + 1,
  }));
  const positionById = byId(positions);
  const positionIds = positions.map((position) => position.id);

  const candidateResult =
    positionIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("candidates")
          .select("id, photo, position_id, student_id, partylist_id")
          .in("position_id", positionIds);

  if (candidateResult.error) {
    return { votes: [], candidates: [], error: candidateResult.error };
  }

  const candidateRows = candidateResult.data || [];
  const voteRows = voteResult.data || [];
  const voterStudentIds = voteRows.map((vote) => vote.student_id);
  const candidateStudentIds = candidateRows.map((candidate) => candidate.student_id);
  const partylistIds = candidateRows.map((candidate) => candidate.partylist_id);

  const [studentResult, partylistResult] =
    await Promise.all([
      fetchRowsByIds(
        "students",
        [...voterStudentIds, ...candidateStudentIds],
        "id, first_name, last_name, student_number, photo_url, program, year_level",
      ),
      fetchRowsByIds("partylists", partylistIds, "id, name"),
    ]);

  const metadataError =
    studentResult.error ||
    partylistResult.error;

  if (metadataError) {
    return { votes: [], candidates: [], error: metadataError };
  }

  const studentById = byId(studentResult.data);
  const partylistById = byId(partylistResult.data);

  const candidates = candidateRows.map((candidate) => {
    const position = positionById.get(Number(candidate.position_id));

    return {
      ...candidate,
      students: studentById.get(Number(candidate.student_id)) || null,
      partylists: partylistById.get(Number(candidate.partylist_id)) || null,
      positions: position
        ? {
            id: position.id,
            name: position.name,
            election_id: position.election_id,
            display_order: position.display_order,
          }
        : null,
    };
  });

  const candidateById = byId(candidates);
  const votes = voteRows.map((vote) => {
    const election = electionById.get(Number(vote.election_id));
    const position = positionById.get(Number(vote.position_id));
    const candidate = candidateById.get(Number(vote.candidate_id));

    return {
      ...vote,
      students: studentById.get(Number(vote.student_id)) || null,
      candidates: candidate || null,
      positions: position
        ? {
            id: position.id,
            name: position.name,
            display_order: position.display_order,
          }
        : null,
      elections: election
        ? {
            id: election.id,
            title: election.title,
            organization_id: election.organization_id,
            organizations: election.organizations || null,
          }
        : null,
    };
  });

  return {
    votes,
    candidates,
    error: null,
    metrics: {
      voteCount: voteRows.length,
      candidateCount: candidateRows.length,
      positionCount: positions.length,
      uniqueStudentCount: uniqueIds(voterStudentIds).length,
    },
  };
}
