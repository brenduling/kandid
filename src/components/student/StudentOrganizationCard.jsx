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

const IDENTITY_MARK_STOP_WORDS = new Set([
  "OF", "AND", "THE", "FOR", "IN", "AT", "ON", "A", "AN",
  "DE", "DEL", "LOS", "LAS", "DAS", "SAN", "SAINT",
]);

export function getOrganizationIdentityMark(organization) {
  const name = String(organization?.name || "").trim();
  if (!name) return "";

  if (!/\s/.test(name)) {
    return name.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 7);
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !IDENTITY_MARK_STOP_WORDS.has(word.toUpperCase()))
    .map((word) => word[0].toUpperCase())
    .join("");

  if (initials.length >= 2) {
    return initials.slice(0, 7);
  }

  return name.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 7);
}

function StudentOrganizationCard({
  organization,
  membershipState = "explore",
  onView,
  compact = false,
  identityMark = "",
  editorial = false,
  displayIndex = 0,
}) {
  const typeLabel = getOrganizationTypeLabel(organization);
  const description = getOrganizationDescription(organization);
  const organizationName = String(organization?.name || "").trim() || "Organization";
  const identityText = String(identityMark || "").trim();
  const showIdentityMark =
    Boolean(identityText) && identityText.toUpperCase() !== organizationName.toUpperCase();

  return (
    <article
      className={`student-directory-card group ${
        compact ? "student-directory-card-compact" : ""
      }`}
    >
      {displayIndex > 0 ? (
        <span
          className="student-directory-display-index"
          aria-hidden="true"
        >
          {String(displayIndex).padStart(2, "0")}
        </span>
      ) : null}

      <div className="student-directory-card-art">
        {showIdentityMark ? (
          <span
            className="student-directory-identity-mark"
            aria-hidden="true"
          >
            {identityText}
          </span>
        ) : null}

        <OrganizationLogo
          organization={organization}
          className="student-directory-logo"
          loading="lazy"
        />

        <span className="student-directory-type-chip">{typeLabel}</span>
      </div>

      <div className="student-directory-card-body">
        <div className="student-directory-card-title-row">
          <h2
            className={
              showIdentityMark
                ? "student-directory-card-title-with-mark"
                : undefined
            }
          >
            {organizationName}
          </h2>

          <span
            className={`student-directory-state-chip ${
              membershipState === "member"
                ? "student-directory-state-chip-member"
                : "student-directory-state-chip-explore"
            }`}
          >
            <span className="student-directory-state-label-default">
              {membershipState === "member" ? "Member" : "Explore"}
            </span>
            {editorial ? (
              <span className="student-directory-state-label-editorial">
                {membershipState === "member" ? "Your organization" : "Explore"}
              </span>
            ) : null}
          </span>
        </div>

        {editorial ? (
          <p className="student-directory-entry-meta">
            <span
              className={`student-directory-entry-meta-state student-directory-entry-meta-state-${
                membershipState === "member" ? "member" : "explore"
              }`}
            >
              {membershipState === "member" ? (
                <>
                  <span className="student-directory-entry-meta-state-full">
                    Your organization
                  </span>
                  <span className="student-directory-entry-meta-state-short">
                    Member
                  </span>
                </>
              ) : (
                "Explore"
              )}
            </span>

            <span
              className="student-directory-entry-meta-separator"
              aria-hidden="true"
            >
              &middot;
            </span>

            <span className="student-directory-entry-meta-type">{typeLabel}</span>
          </p>
        ) : null}

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
            <span className="student-directory-action-label-default">View</span>
            {editorial ? (
              <span className="student-directory-action-label-editorial">
                {membershipState === "member"
                  ? "View organization"
                  : "Explore organization"}{" "}
                <span aria-hidden="true">&rarr;</span>
              </span>
            ) : null}
          </button>
        </div>
      </div>
    </article>
  );
}

export default StudentOrganizationCard;
