import { OrganizationLogo } from "../KandidImage";

export function getOrganizationTypeLabel(organization) {
  return organization?.organization_type === "non_departmental"
    ? "Non-Departmental"
    : "Departmental";
}

export function getOrganizationDescription(organization) {
  return (
    String(organization?.description || "").trim() ||
    "No organization description has been added yet."
  );
}

function StudentOrganizationCard({
  organization,
  membershipState = "explore",
  onView,
  compact = false,
}) {
  const typeLabel = getOrganizationTypeLabel(organization);
  const description = getOrganizationDescription(organization);

  return (
    <article
      className={`student-directory-card group ${
        compact ? "student-directory-card-compact" : ""
      }`}
    >
      <div className="student-directory-card-art">
        <OrganizationLogo
          organization={organization}
          className="student-directory-logo"
          loading="lazy"
        />

        <span className="student-directory-type-chip">{typeLabel}</span>
      </div>

      <div className="student-directory-card-body">
        <div className="student-directory-card-title-row">
          <h2>{organization?.name || "Organization"}</h2>

          <span
            className={`student-directory-state-chip ${
              membershipState === "member"
                ? "student-directory-state-chip-member"
                : "student-directory-state-chip-explore"
            }`}
          >
            {membershipState === "member" ? "Member" : "Explore"}
          </span>
        </div>

        <p className="student-directory-card-description">{description}</p>

        <div className="student-directory-card-footer">
          <div>
            <p className="student-directory-card-label">Organization Type</p>
            <p className="student-directory-card-value">{typeLabel}</p>
          </div>

          <button
            type="button"
            onClick={() => onView?.(organization)}
            className="student-directory-view-btn"
          >
            View
          </button>
        </div>
      </div>
    </article>
  );
}

export default StudentOrganizationCard;
