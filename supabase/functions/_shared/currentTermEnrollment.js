function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function hasCurrentTermEnrollment({
  studentId,
  activeTermId,
  electionTermId,
  enrollmentRows,
}) {
  const student = positiveInteger(studentId);
  const activeTerm = positiveInteger(activeTermId);
  const electionTerm = positiveInteger(electionTermId);

  if (!student || !activeTerm || !electionTerm || activeTerm !== electionTerm) {
    return false;
  }

  return (Array.isArray(enrollmentRows) ? enrollmentRows : []).some((row) =>
    positiveInteger(row?.student_id) === student &&
    positiveInteger(row?.academic_term_id) === activeTerm &&
    String(row?.enrollment_status || "").toLowerCase() === "enrolled"
  );
}
