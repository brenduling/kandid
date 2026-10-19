const STUDENT_NUMBER_PATTERN = /^[0-9]{1,20}$/;
const OTP_PATTERN = /^[0-9]{6}$/;

export function getStudentSetupRequestError({
  studentNumber,
  passwordValid,
  passwordsMatch,
}) {
  if (typeof studentNumber !== "string" || !STUDENT_NUMBER_PATTERN.test(studentNumber.trim())) {
    return "Enter a valid Student ID before requesting email verification.";
  }
  if (!passwordValid) return "Meet each password requirement before requesting a verification code.";
  if (!passwordsMatch) return "The passwords do not match. Retype the same password in both fields.";
  return "";
}

export function getStudentOtpVerificationError({ code }) {
  if (typeof code !== "string" || !OTP_PATTERN.test(code)) {
    return "Enter all six digits from the verification email.";
  }
  return "";
}

export function getStudentOtpFailureMessage(error) {
  const status = Number(error?.context?.status || error?.status);
  if (status === 429) return "Too many verification attempts. Wait before trying again or requesting a new code.";
  if (status === 401 || status === 403) return "This code is incorrect, expired or already used. Check it or request a new code.";
  return "We couldn't verify your code right now. Check your connection and try again.";
}

export function getStudentOtpRetrySeconds(error) {
  const supplied = Number(error?.context?.headers?.get?.("Retry-After"));
  const status = Number(error?.context?.status || error?.status);
  return Number.isFinite(supplied) && supplied > 0
    ? Math.min(3600, Math.max(60, Math.ceil(supplied)))
    : status === 429 ? 900 : 60;
}

export const STUDENT_OTP_REQUEST_NOTICE =
  "Request received. Check your registered inbox for a new code. If no new email arrives, delivery may be limited; wait before retrying. Do not reuse a code already verified.";
