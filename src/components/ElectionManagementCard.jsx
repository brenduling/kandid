import ElectionCover from "./ElectionCover";
import { OrganizationLogo } from "./KandidImage";
import { getElectionPhase } from "../utils/elections";

function ElectionManagementCard({
  election,
  eyebrow = "Election",
  organization,
  counts = [],
  statusLabel,
  actions,
  onClick,
}) {
  const owningOrganization = organization || election?.organizations;
  const phase = getElectionPhase(election);
  const Component = onClick ? "button" : "article";

  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`election-management-card ${onClick ? "" : "is-static"}`}
    >
      <div className="election-management-media">
        <ElectionCover election={election} compact />
        <OrganizationLogo
          organization={owningOrganization}
          className="election-management-logo"
        />
      </div>

      <div className="election-management-body">
        <p>{eyebrow}</p>
        <h2>{election?.title || "Untitled Election"}</h2>
        <span>{owningOrganization?.name || "Organization"}</span>
        <strong>{statusLabel || phase || election?.status || "Status unavailable"}</strong>
      </div>

      {counts.length > 0 ? (
        <div className="election-management-counts">
          {counts.map(({ label, value }) => (
            <span key={label}>
              {value !== undefined && value !== null && value !== "" ? `${value} ` : ""}
              {label}
            </span>
          ))}
        </div>
      ) : null}

      {actions ? (
        <div className="election-management-actions">
          {actions}
        </div>
      ) : null}
    </Component>
  );
}

export default ElectionManagementCard;
