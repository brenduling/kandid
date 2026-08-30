import { sortVotesByPositionOrder } from "./positionOrder";

export function buildGroupedResults(votes = []) {
  const grouped = {};

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
      grouped[vote.position_id].candidates[candidateId] = {
        name: `${vote.candidates?.students?.first_name || ""} ${
          vote.candidates?.students?.last_name || ""
        }`.trim(),
        votes: 0,
      };
    }

    grouped[vote.position_id].candidates[candidateId].votes += 1;
  });

  return grouped;
}

export function buildElectionAnalytics(votes = [], election = null) {
  const groupedResults = buildGroupedResults(votes);
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
