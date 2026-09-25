import logo from "../assets/kandidlogo.png";

export function KandidLoadingRule() {
  return <span className="kandid-loading-rule" aria-hidden="true" />;
}

export function KandidRouteLoader({ message = "Opening Kandid..." }) {
  return (
    <main className="kandid-route-loader">
      <div className="kandid-loader-content">
        <div className="kandid-loader-brand">
          <img src={logo} alt="" />
          <span>KANDID</span>
        </div>
        <div className="kandid-loader-message" role="status" aria-live="polite">
          <strong>Wait, you can count on me.</strong>
          <p>{message}</p>
          <KandidLoadingRule />
        </div>
      </div>
    </main>
  );
}

export function KandidInlineLoader({ message = "Preparing records..." }) {
  return (
    <div className="kandid-inline-loader" role="status" aria-live="polite">
      <KandidLoadingRule />
      <span>{message}</span>
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
      <KandidLoadingRule />
      {label}
    </span>
  );
}
