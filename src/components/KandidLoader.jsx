import logo from "../assets/kandidlogo.png";

export function KandidVoteLoader({ message = "Counting access..." }) {
  return (
    <div className="kandid-vote-loader" role="status" aria-live="polite">
      <span />
      <span />
      <span />
      <span />
      <strong>{message}</strong>
    </div>
  );
}

export function KandidRouteLoader({ message = "Opening KANDID..." }) {
  return (
    <div className="kandid-route-loader" role="status" aria-live="polite">
      <div className="kandid-loader-card">
        <img src={logo} alt="KANDID" />
        <div>
          <strong>Wait, you can count on me.</strong>
          <p>{message}</p>
          <KandidVoteLoader message="" />
        </div>
      </div>
    </div>
  );
}

export function KandidInlineLoader({ message = "Loading..." }) {
  return (
    <div className="kandid-inline-loader" role="status" aria-live="polite">
      <i />
      <i />
      <i />
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
      <i />
      <i />
      <i />
      {label}
    </span>
  );
}
