import { BarChart3, CircleSlash } from "lucide-react";
import { useState } from "react";
import KandidImage from "./KandidImage";

function entryLabel(entry) {
  return String(
    typeof entry === "string" ? entry : entry?.label || entry?.code || entry?.name || "",
  ).trim();
}

function chartRows(items = [], options = {}) {
  const max = Math.max(...items.map((item) => Number(item.count || item.votes || 0)), 0);

  return items.map((item) => {
    const value = Number(item.count ?? item.votes ?? 0);
    const width = max > 0 ? Math.max((value / max) * 100, value > 0 ? 5 : 0) : 0;
    const label = item.label || item.name || "Unspecified";

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
  filters = [],
  activeFilter,
  onFilterChange,
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
        <div className="horizontal-chart-actions">
          {badge ? <span className="status-pill">{badge}</span> : null}
          {filters.length > 0 ? (
            <div className="result-chart-segmented" aria-label={`${title} filter`}>
              {filters.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  className={activeFilter === filter.value ? "is-active" : ""}
                  onClick={() => onFilterChange?.(filter.value)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="horizontal-chart-empty">
          <BarChart3 size={18} />
          <span>No demographic data yet.</span>
        </div>
      ) : (
        <div className="horizontal-chart-list">
          {rows.map((row) => {
            const isCompactYear = mode === "year_level" && /^\d+$/.test(String(row.label));
            const hasProgramName = mode === "program" && row.name;

            return (
            <div className={`horizontal-chart-row ${hasProgramName ? "has-detail" : ""}`} key={row.label}>
              <span className={`horizontal-chart-label ${isCompactYear ? "is-year" : ""}`}>
                {hasProgramName ? (
                  <span className="result-program-copy">
                    <strong>{row.label}</strong>
                    <small>{row.name}</small>
                  </span>
                ) : (
                  row.label
                )}
              </span>
              <span className="horizontal-chart-track" aria-label={`${row.label}: ${row.value}`}>
                <span
                  className="horizontal-chart-fill"
                  style={{ width: `${row.width}%` }}
                />
              </span>
              <strong>{row.value}</strong>
            </div>
          );
          })}
        </div>
      )}
    </section>
  );
}

const RESULT_VIEW_MODES = [
  { value: "overall", label: "Overall" },
  { value: "program", label: "By Program" },
  { value: "year_level", label: "By Year Level" },
];

function demographicRows(candidate, mode, expectedLabels = []) {
  const counts = { ...(candidate.demographics?.[mode] || {}) };
  const metadata = new Map();

  expectedLabels.forEach((entry) => {
    const value = entryLabel(entry);
    if (typeof entry !== "string") {
      metadata.set(value.toUpperCase(), entry);
    }
    if (!value || counts[value] !== undefined) return;
    counts[value] = 0;
  });

  const entries = Object.entries(counts);
  const max = Math.max(...entries.map(([, count]) => Number(count || 0)), 0);

  return entries
    .map(([label, count]) => ({
      ...(metadata.get(String(label).toUpperCase()) || {}),
      label,
      count,
      width: max > 0 ? Math.max((Number(count) / max) * 100, 7) : 0,
    }))
    .sort((first, second) => {
      if (mode === "year_level") {
        const firstYear = Number(String(first.label).match(/\d+/)?.[0] || 0);
        const secondYear = Number(String(second.label).match(/\d+/)?.[0] || 0);
        return firstYear - secondYear;
      }

      return second.count - first.count;
    });
}

function CandidateResultRow({ candidate, total, demographicMode, expectedLabels }) {
  const value = Number(candidate.votes || 0);
  const width = total > 0 ? Math.max((value / total) * 100, value > 0 ? 5 : 0) : 0;
  const isAbstain = candidate.isAbstain;
  const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
  const breakdownRows =
    isAbstain || demographicMode === "overall"
      ? []
      : demographicRows(candidate, demographicMode, expectedLabels);

  return (
    <div className={`candidate-result-item ${isAbstain ? "is-abstain" : ""}`}>
      <div className="candidate-result-row">
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
          <small>
            {candidate.partylistName || "Independent"} / {value} votes / {percentage}%
          </small>
        </span>

        <span className="candidate-result-track" aria-label={`${candidate.name}: ${value} votes`}>
          <span
            className="candidate-result-fill"
            style={{ width: `${width}%` }}
          />
        </span>

        <strong className="candidate-result-value">{value}</strong>
      </div>

      {breakdownRows.length > 0 ? (
        <div className="candidate-demographic-list">
          {breakdownRows.map((row) => (
            <div key={row.label} className="candidate-demographic-row">
              <span>{row.label}</span>
              <span className="candidate-demographic-track">
                <span style={{ width: `${row.width}%` }} />
              </span>
              <strong>{row.count}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PositionResultsChart({
  group,
  index = 0,
  totalVoters = 0,
  demographicMode,
  expectedLabels = [],
}) {
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
  const validVotesForPosition = candidates.reduce(
    (sum, candidate) => sum + Number(candidate.votes || 0),
    0,
  );
  const barTotal = validVotesForPosition > 0 ? validVotesForPosition : maxVotes;

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
            demographicMode={demographicMode}
            expectedLabels={expectedLabels}
          />
        ))}
      </div>
    </section>
  );
}

export function ElectionResultsChart({ groups = [], totalVoters = 0, dimensions = {} }) {
  const [demographicMode, setDemographicMode] = useState("overall");
  const sortedGroups = [...groups].sort(
    (first, second) => Number(first.displayOrder || 0) - Number(second.displayOrder || 0),
  );
  const expectedLabels =
    demographicMode === "program"
      ? dimensions.programMetadata || dimensions.programs || []
      : demographicMode === "year_level"
        ? dimensions.yearLevels || []
        : [];

  return (
    <section className="election-results-chart">
      <div className="result-chart-toolbar">
        <div>
          <p className="chart-eyebrow">Result View</p>
          <h3>
            {demographicMode === "overall"
              ? "Official candidate tally"
              : "Candidate votes by demographic"}
          </h3>
        </div>
        <div className="result-chart-segmented" aria-label="Candidate demographic filter">
          {RESULT_VIEW_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              className={demographicMode === mode.value ? "is-active" : ""}
              onClick={() => setDemographicMode(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
      {sortedGroups.map((group, index) => (
        <PositionResultsChart
          key={group.positionId || group.position}
          group={group}
          index={index}
          totalVoters={totalVoters}
          demographicMode={demographicMode}
          expectedLabels={expectedLabels}
        />
      ))}
    </section>
  );
}
