const MEMBERSHIP_ADMISSION_REASONS = new Set([
  "ACTIVE_TERM_UNAVAILABLE",
  "ACTIVATION_SYNC_REQUIRED",
  "INVALID_REQUEST",
  "INVALID_SOURCE",
  "NOT_CURRENTLY_ENROLLED",
  "ORGANIZATION_NOT_FOUND",
  "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION",
  "TERM_NOT_ACTIVE",
  "UNSUPPORTED_ORGANIZATION_TYPE",
  "UNSUPPORTED_MEMBERSHIP_SCOPE",
]);

/** Return only recognized, safe admission reasons from RPC rows or DB errors. */
export function decodeMembershipAdmissionReason(value) {
  if (typeof value === "string" && MEMBERSHIP_ADMISSION_REASONS.has(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const reason = typeof value.reason === "string" ? value.reason : "";
    if (MEMBERSHIP_ADMISSION_REASONS.has(reason)) return reason;

    const message = typeof value.message === "string" ? value.message : "";
    const match = message.match(/MEMBERSHIP_ADMISSION_DENIED:([A-Z_]+)/);
    if (match && MEMBERSHIP_ADMISSION_REASONS.has(match[1])) return match[1];
  }

  return null;
}

export function isMembershipAdmissionReason(value) {
  return typeof value === "string" && MEMBERSHIP_ADMISSION_REASONS.has(value);
}
