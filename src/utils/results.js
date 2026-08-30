import { sortVotesByPositionOrder } from "./positionOrder";

export const RESULT_VISIBILITY_MODES = {
  REALTIME: "realtime",
  AFTER_CLOSE: "after_close",
  MANUAL: "manual",
};

export function normalizeResultVisibilityMode(value) {
  if (value === RESULT_VISIBILITY_MODES.REALTIME) return RESULT_VISIBILITY_MODES.REALTIME;
  if (value === RESULT_VISIBILITY_MODES.MANUAL) return RESULT_VISIBILITY_MODES.MANUAL;
  return RESULT_VISIBILITY_MODES.AFTER_CLOSE;
}

export function resultVisibilityLabel(value, releasedAt) {
  if (releasedAt) return "Released";
  const mode = normalizeResultVisibilityMode(value);
  if (mode === RESULT_VISIBILITY_MODES.REALTIME) return "Real-time";
  if (mode === RESULT_VISIBILITY_MODES.MANUAL) return "Manual release";
  return "After voting ends";
}

export function serializeResultVisibilityForDatabase(value) {
  const mode = normalizeResultVisibilityMode(value);
  if (mode === RESULT_VISIBILITY_MODES.REALTIME) return RESULT_VISIBILITY_MODES.REALTIME;
  return "hidden";
}

export function isMissingResultReleaseColumn(error) {
  const message = String(error?.message || "");
  return /results_released_at|results_released_by|schema cache|column .*does not exist/i.test(message);
}

export function getResultVerificationSummary(votes = []) {
  const totalVoteEntries = votes.length;
  const missingHash = votes.filter((vote) => !vote.vote_hash).length;
  const duplicateVoteIds = totalVoteEntries - new Set(votes.map((vote) => vote.id)).size;

  return {
    totalVoteEntries,
    missingHash,
    duplicateVoteIds,
    verified: totalVoteEntries > 0 && missingHash === 0 && duplicateVoteIds === 0,
  };
}

export function buildGroupedResults(votes = [], candidates = []) {
  const grouped = {};

  candidates.forEach((candidate) => {
    const positionId = candidate.position_id || candidate.positions?.id;

    if (!positionId) return;

    if (!grouped[positionId]) {
      grouped[positionId] = {
        positionId,
        position: candidate.positions?.name || "Position",
        displayOrder: candidate.positions?.display_order || 0,
        candidates: {},
        abstain: 0,
      };
    }

    const student = candidate.students;
    const candidateName = `${student?.first_name || ""} ${student?.last_name || ""}`.trim();

    grouped[positionId].candidates[candidate.id] = {
      id: candidate.id,
      name: candidateName || "Candidate",
      position: candidate.positions?.name || grouped[positionId].position,
      partylistName: candidate.partylists?.name || "Independent",
      photoUrl: candidate.photo || student?.photo_url || null,
      votes: 0,
    };
  });

  sortVotesByPositionOrder(votes).forEach((vote) => {
    if (!grouped[vote.position_id]) {
      grouped[vote.position_id] = {
        positionId: vote.position_id,
        position: vote.positions?.name || "Position",
        displayOrder: vote.positions?.display_order || 0,
        candidates: {},
        abstain: 0,
      };
    }

    if (vote.is_abstain) {
      grouped[vote.position_id].abstain += 1;
      return;
    }

    if (!vote.candidate_id) {
      return;
    }

    const candidateId = vote.candidate_id;

    if (!grouped[vote.position_id].candidates[candidateId]) {
      const student = vote.candidates?.students;

      grouped[vote.position_id].candidates[candidateId] = {
        id: candidateId,
        name: `${student?.first_name || ""} ${
          student?.last_name || ""
        }`.trim(),
        position: vote.positions?.name || "Position",
        partylistName: vote.candidates?.partylists?.name || "Independent",
        photoUrl: vote.candidates?.photo || student?.photo_url || null,
        votes: 0,
      };
    }

    grouped[vote.position_id].candidates[candidateId].votes += 1;
  });

  return grouped;
}

export function buildElectionAnalytics(votes = [], election = null, candidates = []) {
  const groupedResults = buildGroupedResults(votes, candidates);
  const uniqueVoters = new Map();
  let abstainCount = 0;

  votes.forEach((vote) => {
    if (vote.is_abstain) {
      abstainCount += 1;
    }

    if (vote.student_id && !uniqueVoters.has(vote.student_id)) {
      uniqueVoters.set(vote.student_id, {
        program: vote.students?.program || "Unspecified Program",
        year_level: vote.students?.year_level || "Unspecified Year",
      });
    }
  });

  const voterRecords = [...uniqueVoters.values()];
  const uniquePrograms = [...new Set(voterRecords.map((record) => record.program))];
  const allocationMode = uniquePrograms.length > 1 ? "program" : "year_level";
  const allocationLabel =
    allocationMode === "program" ? "Program Allocation" : "Year Level Allocation";
  const allocation = {};

  voterRecords.forEach((record) => {
    const key =
      allocationMode === "program"
        ? record.program
        : `Year ${record.year_level}`;

    if (!allocation[key]) {
      allocation[key] = 0;
    }

    allocation[key] += 1;
  });

  const allocationItems = Object.entries(allocation)
    .map(([label, count]) => ({
      label,
      count,
      percentage:
        voterRecords.length > 0 ? ((count / voterRecords.length) * 100).toFixed(1) : "0.0",
    }))
    .sort((a, b) => b.count - a.count);

  return {
    groupedResults,
    totalVoteEntries: votes.length,
    totalUniqueVoters: voterRecords.length,
    totalAbstains: abstainCount,
    allocationMode,
    allocationLabel,
    allocationItems,
    organizationName: election?.organizations?.name || "Organization",
  };
}
