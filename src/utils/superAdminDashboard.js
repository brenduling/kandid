export const EMPTY_ELECTION_PULSE = [
  { id: "draft", label: "Draft", count: 0 },
  { id: "upcoming", label: "Upcoming", count: 0 },
  { id: "campaigning", label: "Campaigning", count: 0 },
  { id: "voting", label: "Voting", count: 0 },
  { id: "closed", label: "Closed", count: 0 },
  { id: "archived", label: "Archived", count: 0 },
  { id: "other", label: "Other status", count: 0 },
];

export const STUDENT_PROGRAM_PAGE_SIZE = 500;

export function buildElectionPulse(elections, now, getPhase) {
  const counts = Object.fromEntries(EMPTY_ELECTION_PULSE.map((item) => [item.id, 0]));

  elections.forEach((election) => {
    const status = String(election.status || "draft").toLowerCase();
    const phase = getPhase(election, now);

    if (status === "archived" || phase === "archived") {
      counts.archived += 1;
    } else if (phase === "draft") {
      counts.draft += 1;
    } else if (phase === "campaign") {
      counts.campaigning += 1;
    } else if (phase === "voting") {
      counts.voting += 1;
    } else if (phase === "closed") {
      counts.closed += 1;
    } else if (["campaign_upcoming", "scheduled", "waiting"].includes(phase)) {
      counts.upcoming += 1;
    } else {
      counts.other += 1;
    }
  });

  return EMPTY_ELECTION_PULSE.map((item) => ({ ...item, count: counts[item.id] }));
}

export function countOperationalElections(electionPulse) {
  const campaigning = electionPulse.find((item) => item.id === "campaigning")?.count || 0;
  const voting = electionPulse.find((item) => item.id === "voting")?.count || 0;
  return campaigning + voting;
}

export async function fetchAllStudentPrograms(
  client,
  pageSize = STUDENT_PROGRAM_PAGE_SIZE,
) {
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from("students")
      .select("program")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) return { data: null, error };

    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return { data: rows, error: null };
}

export function summarizeStudentPrograms(programRows) {
  const programCounts = (programRows || []).reduce((counts, student) => {
    const key = String(student.program || "Unassigned").trim() || "Unassigned";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const totalStudents = Object.values(programCounts).reduce((sum, count) => sum + count, 0);

  return Object.entries(programCounts)
    .map(([program, count]) => ({
      program,
      count,
      share: totalStudents > 0 ? Math.round((count / totalStudents) * 100) : 0,
    }))
    .sort((left, right) => right.count - left.count || left.program.localeCompare(right.program))
    .slice(0, 6);
}
