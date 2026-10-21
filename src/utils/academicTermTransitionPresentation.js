function termSequence(term) {
  const match = /^(\d{4})-(\d{4})$/.exec(String(term?.academic_year || ""));
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
  const semester = ["1st Semester", "2nd Semester"].indexOf(term.semester);
  if (semester < 0 || Number(match[1]) < 2000 || Number(match[1]) > 2200) return null;
  return Number(match[1]) * 2 + semester;
}

// Presentation only. Authorization, impact counts and commit validation belong
// to the trusted server contract; this helper never authorizes activation.
export function getAcademicTermTransitionView(terms = []) {
  const rows = Array.isArray(terms) ? terms : [];
  const active = rows.filter((term) => term?.status === "active");
  const activeTerm = active.length === 1 ? active[0] : null;
  let blockedReason = "";
  if (active.length > 1) blockedReason = "Multiple active terms require administrator review.";
  else if (!activeTerm) blockedReason = "No active academic term is confirmed. Initial setup or recovery requires a separate administrative review.";
  else if (termSequence(activeTerm) === null || !Number.isSafeInteger(Number(activeTerm.id)) || Number(activeTerm.id) <= 0) {
    blockedReason = "The current academic term is invalid and requires administrator review.";
  }

  const nextDraftTerms = blockedReason ? [] : rows.filter((term) =>
    term?.status === "draft" && termSequence(term) === termSequence(activeTerm) + 1 &&
    Number.isSafeInteger(Number(term.id)) && Number(term.id) > 0
  );
  if (nextDraftTerms.length > 1) blockedReason = "Conflicting next-term drafts require administrator review.";

  const nextSequence = activeTerm && !blockedReason ? termSequence(activeTerm) + 1 : null;
  const nextStartYear = nextSequence === null ? null : Math.floor(nextSequence / 2);
  const nextTerm = nextSequence === null ? null : {
    semester: nextSequence % 2 ? "2nd Semester" : "1st Semester",
    startYear: nextStartYear, academic_year: `${nextStartYear}-${nextStartYear + 1}`,
  };
  const nextExists = nextSequence !== null && rows.some(term => termSequence(term) === nextSequence);

  return {
    activeTerm,
    nextTerm,
    canCreateDraft: Boolean(nextTerm && !nextExists),
    blockedReason,
    nextDraftTerms: blockedReason ? [] : nextDraftTerms,
    closedTerms: rows.filter((term) => term?.status === "closed"),
  };
}
