const nullableText = value => value === null || typeof value === "string";
const nullableYear = value => value === null || (Number.isSafeInteger(value) && value >= 1 && value <= 6);

// Public recognition is intentionally limited. It is never an ownership proof.
export function readStudentSetupRecognition(payload, studentNumber) {
  const details = payload?.student_details;
  if (payload?.recognition_version !== 2 || payload.student_number !== studentNumber || !details ||
      Object.keys(details).sort().join(",") !== "full_name,program,year_level" ||
      !nullableText(details.full_name) || !nullableText(details.program) || !nullableYear(details.year_level)) return null;
  return { student_number: studentNumber, full_name: details.full_name, program: details.program, year_level: details.year_level };
}

// Server OTP admission and a freshly checked SDK user are required to complete.
// Email stays in Auth/the server and is never a recognition display field.
export function readStudentSetupVerification(proof, studentNumber, user) {
  if (proof?.contract_version !== 2 || proof.student_number !== studentNumber ||
      !user?.id || proof.auth_user_id !== user.id || !user.email_confirmed_at ||
      !user.email || !["active", "pending"].includes(proof.account_state)) return null;
  return { contract_version: 2, student_number: studentNumber, auth_user_id: user.id, account_state: proof.account_state };
}
