// Display only allowlisted diagnostics. Never render server bodies or SDK messages.
export function getStudentSetupLookupFailure(error) {
  const status = Number(error?.context?.status || error?.status);
  if (status === 429) {
    const supplied = Number(error?.context?.headers?.get?.("Retry-After"));
    const seconds = Number.isFinite(supplied) && supplied > 0
      ? Math.min(3600, Math.max(60, Math.ceil(supplied))) : 900;
    return { kind: "rate_limit", title: "Too many Student ID checks", message: `Wait ${Math.ceil(seconds / 60)} minutes before checking again. No automatic retry will be sent.` };
  }
  if (status === 401 || status === 403) {
    return { kind: "authorization", title: "Student ID check denied", message: "This check could not be authorized. Refresh the page or contact the Electoral Board." };
  }
  if (status === 404) {
    return { kind: "unavailable", title: "Student details unavailable", message: "Setup can't start for that Student ID. Check the number; if your account is already activated, return to login. Otherwise contact the Electoral Board." };
  }
  if (status >= 400) {
    return { kind: "service", title: "Student ID service unavailable", message: "The Student ID service could not complete this check. Try again later or contact the Electoral Board." };
  }
  if (error?.code === "student_setup_contract_mismatch") {
    return { kind: "contract", title: "Setup compatibility issue", message: "The Student ID service returned an unsupported response. Contact the Electoral Board before trying again." };
  }
  if (["FunctionsFetchError", "FunctionsRelayError", "TypeError", "SyntaxError", "AbortError"].includes(error?.name)) {
    return { kind: "transport", title: "Student ID response interrupted", message: "The Student ID response could not be received completely. Check your connection before trying again. No automatic retry was sent." };
  }
  return { kind: "unknown", title: "Student ID check unavailable", message: "The Student ID check could not be completed securely. Contact the Electoral Board if this continues." };
}
