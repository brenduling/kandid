export function getStudentLoginValidationErrors(studentNumber, password) {
  const errors = {};

  if (!String(studentNumber ?? "").trim()) {
    errors.studentNumber = "Enter your Student ID Number.";
  }

  if (!String(password ?? "")) {
    errors.password = "Enter your password.";
  }

  return errors;
}

export function getStudentLoginFailureMessage(error) {
  const status = Number(error?.context?.status || error?.status);
  if (status === 429) return "Too many sign-in attempts. Wait before trying again.";
  if (status === 401 || status === 403 || error?.message === "We couldn't sign you in. Check your Student ID and password.") return "We couldn't sign you in. Check your Student ID and password.";
  return "We couldn't complete sign-in right now. Check your connection and try again.";
}
