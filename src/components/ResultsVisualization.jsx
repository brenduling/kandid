import { BarChart3, CircleSlash } from "lucide-react";
import KandidImage from "./KandidImage";

function chartRows(items = [], options = {}) {
  const max = Math.max(...items.map((item) => Number(item.count || item.votes || 0)), 0);

  return items.map((item) => {
    const value = Number(item.count ?? item.votes ?? 0);
    const width = max > 0 ? Math.max((value / max) * 100, value > 0 ? 5 : 0) : 0;
    const label =
      options.mode === "year_level"
        ? String(item.label || "").replace(/^Year\s+/i, "")
        : item.label || item.name || "Unspecified";

    return {
      ...item,
      label,
      value,
      width,
    };
  });
}

export function HorizontalStatChart({
  eyebrow,
  title,
  subtitle,
  badge,
  items = [],
  mode = "default",
}) {
  const rows = chartRows(items, { mode });

  return (
    <section className="horizontal-chart-panel">
      <div className="horizontal-chart-head">
        <div>
          {eyebrow ? <p className="chart-eyebrow">{eyebrow}</p> : null}
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {badge ? <span className="status-pill">{badge}</span> : null}
      </div>

      {rows.length === 0 ? (
        <div className="horizontal-chart-empty">
          <BarChart3 size={18} />
          <span>No demographic data yet.</span>
        </div>
      ) : (
        <div className="horizontal-chart-list">
          {rows.map((row) => (
            <div key={row.label} className="horizontal-chart-row">
              <span className={`horizontal-chart-label ${mode === "year_level" ? "is-year" : ""}`}>
                {row.label}
              </span>
              <span className="horizontal-chart-track" aria-label={`${row.label}: ${row.value}`}>
                <span
                  className="horizontal-chart-fill"
                  style={{ width: `${row.width}%` }}
                />
              </span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CandidateResultRow({ candidate, total }) {
  const value = Number(candidate.votes || 0);
  const width = total > 0 ? Math.max((value / total) * 100, value > 0 ? 5 : 0) : 0;
  const isAbstain = candidate.isAbstain;

  return (
    <div className={`candidate-result-row ${isAbstain ? "is-abstain" : ""}`}>
      {isAbstain ? (
        <span className="candidate-result-avatar is-abstain">
          <CircleSlash size={18} />
        </span>
      ) : (
        <KandidImage
          src={candidate.photoUrl}
          alt={`${candidate.name} photo`}
          label={candidate.name}
          className="candidate-result-avatar"
          fit="cover"
        />
      )}

      <span className="candidate-result-copy">
        <strong>{candidate.name || "Candidate"}</strong>
        <small>{candidate.partylistName || "Independent"}</small>
      </span>

      <span className="candidate-result-track" aria-label={`${candidate.name}: ${value} votes`}>
        <span
          className="candidate-result-fill"
          style={{ width: `${width}%` }}
        />
      </span>

      <strong className="candidate-result-value">{value}</strong>
    </div>
  );
}

export function PositionResultsChart({ group, index = 0, totalVoters = 0 }) {
  const candidates = Object.values(group.candidates || {}).sort(
    (first, second) => second.votes - first.votes,
  );
  const rows = [
    ...candidates,
    {
      id: `${group.positionId}-abstain`,
      name: "Abstain",
      position: group.position,
      votes: group.abstain || 0,
      isAbstain: true,
    },
  ];
  const maxVotes = Math.max(...rows.map((row) => Number(row.votes || 0)), 0);
  const barTotal = Number(totalVoters) > 0 ? Number(totalVoters) : maxVotes;

  return (
    <section
      className="position-result-chart fade-up"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="position-result-head">
        <div className="position-result-title">
          <div>
            <p className="chart-eyebrow">Position</p>
            <h2>{group.position}</h2>
          </div>
        </div>
      </div>

      <div className="candidate-result-list">
        {rows.map((candidate) => (
          <CandidateResultRow
            key={candidate.id || candidate.name}
            candidate={candidate}
            total={barTotal}
          />
        ))}
      </div>
    </section>
  );
}

export function ElectionResultsChart({ groups = [], totalVoters = 0 }) {
  return (
    <section className="election-results-chart">
      {groups.map((group, index) => (
        <PositionResultsChart
          key={group.positionId || group.position}
          group={group}
          index={index}
          totalVoters={totalVoters}
        />
      ))}
    </section>
  );
}
