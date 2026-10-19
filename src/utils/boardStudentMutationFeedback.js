const LOCAL_WRITE_GUARD_MARKER = "Blocked by the temporary official-production development write safeguard";

function errorMessages(error) {
  return [
    error?.message,
    error?.context?.message,
    error?.context?.cause?.message,
    error?.cause?.message,
  ].filter((message) => typeof message === "string");
}

export function boardStudentMutationFailureMessage(error, actionLabel) {
  const label = actionLabel === "remove"
    ? "Membership removal"
    : actionLabel === "restore"
      ? "Membership restoration"
      : "Name changes";
  const verb = actionLabel === "remove" || actionLabel === "restore" ? "is" : "are";
  const messages = errorMessages(error);

  if (error?.code === "development_write_blocked" || messages.some((message) => message.includes(LOCAL_WRITE_GUARD_MARKER))) {
    return `${label} ${verb} blocked by the local production-write safeguard. No request was sent.`;
  }

  if (error?.code === "backend_action_unavailable" || messages.some((message) => /read-only; action is not allowed|action is not supported/i.test(message))) {
    return `${label} ${verb} not supported by the deployed Board function. No change was made.`;
  }

  if (messages.some((message) => message === "Failed to send a request to the Edge Function")) {
    return `Kandid could not reach the Board function. ${label} were not confirmed.`;
  }

  return messages[0] || `${label} could not be completed. Try again.`;
}

export function validateBoardStudentRemoval({
  studentNumber,
  confirmStudentNumber,
  password,
  reason,
  selectedReason,
  customReason,
}) {
  if (selectedReason === "Other" && !customReason?.trim()) return "Enter a custom removal reason.";
  if (!reason?.trim()) return "Removal reason is required.";
  if (!confirmStudentNumber?.trim()) return "Enter the student's ID to confirm this removal.";
  if (confirmStudentNumber.trim() !== String(studentNumber || "").trim()) {
    return "The Student ID does not match the selected student.";
  }
  if (!password) return "Enter your account password to confirm this removal.";
  return "";
}
