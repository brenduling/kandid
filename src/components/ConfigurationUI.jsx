export function InlineKandidLoader({ bars = 4, label }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-kandid-loader" aria-hidden="true">
        {Array.from({ length: bars }).map((_, index) => (
          <span key={index} />
        ))}
      </span>
      {label ? <span>{label}</span> : null}
    </span>
  );
}

export function DependencyRow({ label, count, badge }) {
  return (
    <div className="dependency-row">
      <span>{label}</span>
      <span className="dependency-count">{count}</span>
      {badge ? <span className="config-badge">{badge}</span> : <span />}
    </div>
  );
}
