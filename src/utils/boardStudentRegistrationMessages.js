export function boardStudentRegistrationOutcomePresentation(outcome, organizationName = "this organization") {
  switch (outcome) {
    case "REGISTRATION_NOT_ENABLED":
      return {
        heading: "Registration is not activated",
        message: "Verified student registration is disabled for this build.",
        supporting: "A project administrator must enable it after the backend release is approved.",
      };
    case "STUDENT_IDENTITY_NOT_FOUND":
      return {
        heading: "Student record not found",
        message: "No existing Student record matches this ID.",
        supporting: "A Super Admin must add or import the student before the Board can continue.",
      };
    case "NOT_CURRENTLY_ENROLLED":
      return {
        heading: "Not currently enrolled",
        message: `This student must be officially enrolled for the current academic term before joining ${organizationName}.`,
        supporting: "A Super Admin must complete term enrollment and the system must synchronize eligible memberships.",
      };
    case "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION":
    case "INELIGIBLE":
      return {
        heading: "Program not eligible",
        message: "This student's official program is not eligible for your assigned organization.",
      };
    case "ACTIVATION_SYNC_REQUIRED":
      return {
        heading: "Membership is system-managed",
        message: `This student is enrolled for the active term, but ${organizationName} membership is maintained by term synchronization.`,
        supporting: "A Super Admin must verify the enrollment and synchronization. The Board cannot add, remove, or restore this membership.",
      };
    case "SESSION_INVALID":
      return {
        heading: "Sign-in required",
        message: "Your secure session is invalid or expired. Sign in again to continue.",
      };
    case "BOARD_AUTHORIZATION_REQUIRED":
      return {
        heading: "Board access needs attention",
        message: "An active Electoral Board assignment for this organization is required.",
        supporting: "Sign in again or ask a Super Admin to verify your Board role and organization assignment.",
      };
    default:
      return null;
  }
}

export function boardStudentRegistrationOutcomeMessage(outcome, fallback) {
  return boardStudentRegistrationOutcomePresentation(outcome)?.message || fallback;
}

export function boardStudentRegistrationFailureOutcome(data, code, status) {
  return data?.outcome || (code === "session_invalid" || status === 401
    ? "SESSION_INVALID"
    : code === "board_forbidden" || status === 403 ? "BOARD_AUTHORIZATION_REQUIRED" : null);
}
