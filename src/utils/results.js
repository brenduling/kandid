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
  if (mode === RESULT_VISIBILITY_MODES.MANUAL) return RESULT_VISIBILITY_MODES.MANUAL;
  return RESULT_VISIBILITY_MODES.AFTER_CLOSE;
}

export function serializeResultVisibilityForLegacyDatabase(value) {
  const mode = normalizeResultVisibilityMode(value);
  return mode === RESULT_VISIBILITY_MODES.REALTIME ? RESULT_VISIBILITY_MODES.REALTIME : "hidden";
}

export function isResultVisibilityConstraintError(error) {
  const message = String(error?.message || "");
  return /elections_student_result_visibility_check|student_result_visibility/i.test(message);
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

function ordinalSuffix(value) {
  const number = Number(value);
  const lastTwo = number % 100;

  if (lastTwo >= 11 && lastTwo <= 13) return "th";

  switch (number % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function yearLevelLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const number = text.match(/\d+/)?.[0];
  if (!number) return text;
  if (number === "11" || number === "12") return `Grade ${number}`;

  return `${number}${ordinalSuffix(number)} Year`;
}

export function buildGroupedResults(votes = [], candidates = []) {
  const grouped = {};
  const candidateDirectory = new Map();

  candidates.forEach((candidate) => {
    candidateDirectory.set(String(candidate.id), candidate);
  });

  function emptyDemographics() {
    return {
      program: {},
      year_level: {},
      organization: {},
    };
  }

  function incrementDemographic(candidate, key, label) {
    const value = String(label || "").trim();
    if (!value || /^Unspecified(?:\s|$)/i.test(value)) return;
    candidate.demographics[key][value] = (candidate.demographics[key][value] || 0) + 1;
  }

  function candidateProfile(candidate = {}, vote = {}) {
    const student = candidate.students || vote.candidates?.students;
    const candidateName = `${student?.first_name || ""} ${student?.last_name || ""}`.trim();

    return {
      id: candidate.id || vote.candidate_id,
      name: candidateName || candidate.name || `Candidate #${candidate.id || vote.candidate_id}`,
      position: candidate.positions?.name || vote.positions?.name || "Position",
      partylistName: candidate.partylists?.name || vote.candidates?.partylists?.name || "Independent",
      photoUrl: candidate.photo || vote.candidates?.photo || student?.photo_url || null,
      votes: 0,
      demographics: emptyDemographics(),
    };
  }

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

    grouped[positionId].candidates[candidate.id] = candidateProfile(candidate);
  });

  sortVotesByPositionOrder(votes).forEach((vote) => {
    const candidateRecord = candidateDirectory.get(String(vote.candidate_id));

    if (!grouped[vote.position_id]) {
      grouped[vote.position_id] = {
        positionId: vote.position_id,
        position: vote.positions?.name || candidateRecord?.positions?.name || "Position",
        displayOrder: vote.positions?.display_order || candidateRecord?.positions?.display_order || 0,
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
      grouped[vote.position_id].candidates[candidateId] = candidateProfile(candidateRecord, vote);
    }

    const candidate = grouped[vote.position_id].candidates[candidateId];
    candidate.votes += 1;
    incrementDemographic(candidate, "program", vote.students?.program);
    incrementDemographic(candidate, "year_level", yearLevelLabel(vote.students?.year_level));
    incrementDemographic(candidate, "organization", vote.elections?.organizations?.name);
  });

  return grouped;
}

export function buildElectionAnalytics(votes = [], election = null, candidates = []) {
  const dimensions = election?.resultDimensions || {};
  const expectedPrograms = dimensions.programs || [];
  const expectedYearLevels = dimensions.yearLevels || [];
  const programMetadata = new Map();

  expectedPrograms.forEach((program) => {
    const label = typeof program === "string" ? program : program.label || program.code || program.name;
    const key = String(label || "").trim().toUpperCase();
    if (!key) return;
    programMetadata.set(key, typeof program === "string" ? { label: program } : program);
  });
  const groupedResults = buildGroupedResults(votes, candidates);
  const uniqueVoters = new Map();
  let abstainCount = 0;

  votes.forEach((vote) => {
    if (vote.is_abstain) {
      abstainCount += 1;
    }

    if (vote.student_id && !uniqueVoters.has(vote.student_id)) {
      uniqueVoters.set(vote.student_id, {
        program: vote.students?.program || "",
        year_level: yearLevelLabel(vote.students?.year_level),
        organization: vote.elections?.organizations?.name || election?.organizations?.name || "Organization",
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
        : record.year_level;

    if (!allocation[key]) {
      allocation[key] = 0;
    }

    allocation[key] += 1;
  });

  function buildBreakdownItems(key, labelFormatter = (value) => value) {
    const counts = {};

    voterRecords.forEach((record) => {
      const label = labelFormatter(record[key] || "");
      if (!label || /^Unspecified(?:\s|$)/i.test(label)) return;
      counts[label] = (counts[label] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([label, count]) => ({
        label,
        count,
        percentage:
          voterRecords.length > 0 ? ((count / voterRecords.length) * 100).toFixed(1) : "0.0",
      }))
      .sort((a, b) => b.count - a.count);
  }

  function mergeExpectedItems(items, expectedLabels = []) {
    const itemMap = new Map(
      items.map((item) => [String(item.label || "").trim().toUpperCase(), item]),
    );

    expectedLabels.forEach((entry) => {
      const normalizedLabel = String(
        typeof entry === "string" ? entry : entry?.label || entry?.code || entry?.name || "",
      ).trim();
      const key = normalizedLabel.toUpperCase();
      if (!normalizedLabel) return;
      const metadata = typeof entry === "string" ? {} : entry;

      if (itemMap.has(key)) {
        itemMap.set(key, {
          ...metadata,
          ...itemMap.get(key),
        });
        return;
      }

      itemMap.set(key, {
        ...metadata,
        label: normalizedLabel,
        count: 0,
        percentage: "0.0",
      });
    });

    return [...itemMap.values()];
  }

  const allocationItems = Object.entries(allocation)
    .map(([label, count]) => ({
      label,
      count,
      percentage:
        voterRecords.length > 0 ? ((count / voterRecords.length) * 100).toFixed(1) : "0.0",
    }))
    .sort((a, b) => b.count - a.count);
  const programItems = mergeExpectedItems(
    buildBreakdownItems("program"),
    expectedPrograms,
  ).sort((a, b) => {
    return String(a.label).localeCompare(String(b.label));
  });
  const yearLevelItems = mergeExpectedItems(
    buildBreakdownItems("year_level", yearLevelLabel),
    expectedYearLevels.map(yearLevelLabel),
  );
  const organizationItems = buildBreakdownItems("organization");

  yearLevelItems.sort((first, second) => {
    const firstYear = Number(String(first.label).match(/\d+/)?.[0] || 0);
    const secondYear = Number(String(second.label).match(/\d+/)?.[0] || 0);
    return firstYear - secondYear;
  });

  return {
    groupedResults,
    totalVoteEntries: votes.length,
    totalUniqueVoters: voterRecords.length,
    totalAbstains: abstainCount,
    allocationMode,
    allocationLabel,
    allocationItems,
    programItems,
    yearLevelItems,
    organizationItems,
    resultDimensions: {
      programs: expectedPrograms,
      yearLevels: expectedYearLevels.map(yearLevelLabel),
      programMetadata: [...programMetadata.values()],
    },
    organizationName: election?.organizations?.name || "Organization",
  };
}
