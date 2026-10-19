/**
 * Candidate membership eligibility comes from the trusted organization
 * eligibility response. Do not derive it from a student's profile program,
 * organization labels, or legacy structural membership links.
 */
export function isStudentInTrustedEligibilityPool(students, studentId) {
  if (!Array.isArray(students) || studentId == null || studentId === "") {
    return false;
  }

  return students.some(
    (student) => String(student?.id) === String(studentId),
  );
}
