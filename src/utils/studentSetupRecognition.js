const nullableText = value => value === null || typeof value === "string";
const nullableYear = value => value === null || (Number.isSafeInteger(value) && value >= 1 && value <= 6);

// Before OTP, the response is identical for every syntactically valid Student ID.
export function readStudentSetupRecognition(payload, studentNumber) {
  if (payload?.recognition_version !== 3 || payload.student_number !== studentNumber || payload.verification_required !== true ||
      Object.keys(payload).sort().join(",") !== "recognition_version,student_number,verification_required") return null;
  return { student_number: studentNumber, verification_required: true };
}

// Server OTP admission and a freshly checked SDK user are required to complete.
// Email stays in Auth/the server and is never a recognition display field.
export function readStudentSetupVerification(proof, studentNumber, user) {
  const details = proof?.student_details;
  if (proof?.contract_version !== 3 || proof.student_number !== studentNumber ||
      !user?.id || proof.auth_user_id !== user.id || !user.email_confirmed_at ||
      !user.email || !["active", "pending"].includes(proof.account_state) || !details ||
      Object.keys(details).sort().join(",") !== "full_name,program,year_level" ||
      !nullableText(details.full_name) || !nullableText(details.program) || !nullableYear(details.year_level)) return null;
  if (proof.account_state === "pending" && (typeof proof.setup_token !== "string" || !/^[0-9a-f]{64}$/.test(proof.setup_token) ||
      !Number.isSafeInteger(proof.expires_at) || proof.expires_at * 1000 <= Date.now() || proof.expires_at * 1000 > Date.now() + 330000)) return null;
  if (proof.account_state === "active" && (proof.setup_token !== null || proof.expires_at !== null)) return null;
  return { contract_version: 3, student_number: studentNumber, auth_user_id: user.id, account_state: proof.account_state,
    student_details: {...details}, setup_token: proof.setup_token, expires_at: proof.expires_at };
}
