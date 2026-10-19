export const ELECTION_PHASE_LABELS = Object.freeze({
  draft: "Draft",
  campaign_upcoming: "Upcoming",
  campaign: "Campaign",
  waiting: "Awaiting Voting",
  scheduled: "Scheduled",
  voting: "Voting",
  closed: "Closed",
  archived: "Archived",
});

const ELECTION_PHASE_ORDER = Object.keys(ELECTION_PHASE_LABELS);

export function buildElectionPhaseSummary(elections = [], getPhase) {
  const phasesByElectionId = new Map();
  const countsByPhase = new Map();

  elections.forEach((election) => {
    const phase = getPhase(election);
    phasesByElectionId.set(election.id, phase);
    countsByPhase.set(phase, (countsByPhase.get(phase) || 0) + 1);
  });

  const phases = [
    ...ELECTION_PHASE_ORDER.filter((phase) => countsByPhase.has(phase)),
    ...[...countsByPhase.keys()]
      .filter((phase) => !ELECTION_PHASE_ORDER.includes(phase))
      .sort(),
  ];

  return {
    phasesByElectionId,
    metrics: phases.map((phase) => ({
      phase,
      label: ELECTION_PHASE_LABELS[phase] || phase.replace(/_/g, " "),
      count: countsByPhase.get(phase),
    })),
  };
}
