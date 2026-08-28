import logo from "../assets/kandidlogo.png";

export function KandidRouteLoader({ message = "Loading KANDID..." }) {
  return (
    <div className="kandid-route-loader" role="status" aria-live="polite">
      <div className="kandid-loader-card">
        <img src={logo} alt="KANDID" />
        <div>
          <p>{message}</p>
          <span />
        </div>
      </div>
    </div>
  );
}

export function KandidInlineLoader({ message = "Loading..." }) {
  return (
    <div className="kandid-inline-loader" role="status" aria-live="polite">
      <span />
      {message}
    </div>
  );
}

export function KandidSkeleton({ rows = 3 }) {
  return (
    <div className="kandid-skeleton-stack" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function KandidButtonLoader({ label = "Saving..." }) {
  return (
    <span className="kandid-button-loader">
      <span />
      {label}
    </span>
  );
}
