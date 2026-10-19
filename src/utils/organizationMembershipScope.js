const MEMBERSHIP_SCOPES = new Set(["program", "manual", "institution"]);

/** Resolve the scope saved by the organization configuration contract. */
export function resolveOrganizationMembershipScope(organization, organizationType) {
  const storedScope = organization?.membership_scope;

  // Institution scope is a durable configuration independent of the visible
  // organization type. Editing the classification must not add program rows.
  if (storedScope === "institution") return "institution";

  if (organizationType === undefined) {
    return MEMBERSHIP_SCOPES.has(storedScope) ? storedScope : null;
  }

  if (organizationType === "departmental") return "program";
  if (organizationType === "non_departmental") return "manual";
  return null;
}

export function organizationMembershipScopeLabel(scope) {
  switch (scope) {
    case "program":
      return "Program coverage";
    case "manual":
      return "Manually managed membership";
    case "institution":
      return "Institution-wide eligibility";
    default:
      return "Membership scope unavailable";
  }
}
