import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { toBoardFacingError } from "../../utils/boardFeedback";
import { formatTurnoutPercentage, turnoutAvailabilityLabel, turnoutMetricValue } from "../../utils/electionTurnout";
import {
  buildBoardReportCsv,
  buildVotingSummaryRows,
  boardVotingSummaryCsvColumns,
  electionReportFilename,
  formatElectionPeriod,
  getBoardOrganizationName,
  getReportRecordCount,
} from "../../utils/boardReports";
import "./Reports.css";

const REPORT_DEFINITIONS = [
  {
    key: "election_report",
    title: "Election Report",
    description: "Election details and schedule for this record.",
    columns: [
      "election_id", "title", "organization_id", "campaign_start", "campaign_end",
      "start_date", "end_date", "status", "location_label", "created_at",
    ],
  },
  {
    key: "position_report",
    title: "Position Report",
    description: "Ballot positions and selection limits for this election.",
    columns: ["position_id", "election_id", "position_name", "max_votes"],
  },
  {
    key: "candidate_report",
    title: "Candidate Report",
    description: "Candidate roster with flattened student and position details.",
    columns: [
      "candidate_id", "position_name", "student_id", "candidate_name", "student_number",
      "partylist_id", "partylist_name", "platform", "photo", "campaign_status", "created_at",
    ],
  },
  {
    key: "voting_summary",
    title: "Voting Summary",
    description: "Candidate vote totals, abstentions, and ballot-count availability.",
    columns: boardVotingSummaryCsvColumns,
  },
];

function readBoardUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

function ElectionRegisterRow({ election, onSelect }) {
  const statusLabel = election.status
    ? String(election.status).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Status unavailable";

  return (
    <button
      type="button"
      className="board-reports-election-row"
      onClick={() => onSelect(election.id)}
    >
      <span className="board-reports-election-identity">
        <span className="board-reports-election-name">{election.title || "Untitled Election"}</span>
        <span className="board-reports-election-meta">
          <span>Voting</span>
          <span className="board-reports-meta-separator" aria-hidden="true">·</span>
          <span>{formatElectionPeriod(election)}</span>
          <span className="board-reports-meta-separator" aria-hidden="true">·</span>
          <span className="board-reports-election-status">Status: {statusLabel}</span>
        </span>
      </span>
    </button>
  );
}

function BoardReports() {
  const prompt = usePrompt();
  const user = readBoardUser();
  const organizationName = getBoardOrganizationName(user);
  const [elections, setElections] = useState([]);
  const [electionsLoading, setElectionsLoading] = useState(true);
  const [electionsError, setElectionsError] = useState("");
  const [electionsRetry, setElectionsRetry] = useState(0);
  const [selectedElectionId, setSelectedElectionId] = useState("");
  const [reportPackage, setReportPackage] = useState(null);
  const [packageLoading, setPackageLoading] = useState(false);
  const [packageError, setPackageError] = useState("");
  const [packageRetry, setPackageRetry] = useState(0);

  useEffect(() => {
    let current = true;
    supabase.rpc("kandid_list_board_report_elections")
      .then(({ data, error }) => {
        if (!current) return;
        if (error) throw error;
        const rows = Array.isArray(data?.elections) ? data.elections : [];
        setElections(rows);
      })
      .catch((error) => {
        if (!current) return;
        setElectionsError(toBoardFacingError(error?.message, "Unable to load the election register."));
      })
      .finally(() => {
        if (current) setElectionsLoading(false);
      });

    return () => {
      current = false;
    };
  }, [electionsRetry]);

  useEffect(() => {
    if (!selectedElectionId) return undefined;

    let current = true;

    const electionId = Number(selectedElectionId);
    if (!Number.isInteger(electionId) || electionId <= 0) {
      Promise.resolve().then(() => {
        if (current) setPackageError("The selected election is unavailable.");
        if (current) setPackageLoading(false);
      });
      return undefined;
    }

    supabase.rpc("kandid_get_board_election_report_package", {
      p_election_id: electionId,
    })
      .then(({ data, error }) => {
        if (!current) return;
        if (error) throw error;
        if (!data || typeof data !== "object") {
          throw new Error("The selected election report package was empty.");
        }
        setReportPackage(data);
      })
      .catch((error) => {
        if (!current) return;
        setPackageError(toBoardFacingError(error?.message, "Unable to load reports for this election."));
      })
      .finally(() => {
        if (current) setPackageLoading(false);
      });

    return () => {
      current = false;
    };
  }, [selectedElectionId, packageRetry]);

  const selectedElection = useMemo(
    () => elections.find((election) => String(election.id) === String(selectedElectionId)),
    [elections, selectedElectionId],
  );
  const packageElection = reportPackage?.election_report;
  const selectedTitle = packageElection?.title || selectedElection?.title || "Selected election";
  const votingSummary = reportPackage?.voting_summary;

  function selectElection(electionId) {
    setSelectedElectionId(String(electionId || ""));
    setReportPackage(null);
    setPackageError("");
    setPackageLoading(Boolean(electionId));
  }

  function retryElectionRegister() {
    setElectionsLoading(true);
    setElectionsError("");
    setElectionsRetry((value) => value + 1);
  }

  function retryReportPackage() {
    setReportPackage(null);
    setPackageError("");
    setPackageLoading(true);
    setPackageRetry((value) => value + 1);
  }

  function exportReport(definition) {
    if (!reportPackage) return;
    const dataset = reportPackage[definition.key];
    let rows;
    if (definition.key === "election_report") {
      rows = dataset && typeof dataset === "object" ? [dataset] : [];
    } else if (definition.key === "voting_summary") {
      rows = buildVotingSummaryRows(dataset);
    } else {
      rows = Array.isArray(dataset) ? dataset : [];
    }

    const csv = buildBoardReportCsv(rows, definition.columns);
    const filename = electionReportFilename(organizationName, selectedTitle, definition.title);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    if (rows.length === 0) {
      prompt.info("This report has no records; the downloaded CSV contains its column headers only.");
    }
  }

  const reportRecordCounts = useMemo(() => {
    if (!reportPackage) return {};
    return Object.fromEntries(REPORT_DEFINITIONS.map((definition) => [
      definition.key,
      getReportRecordCount(reportPackage, definition.key),
    ]));
  }, [reportPackage]);

  return (
    <main className="board-reports-page">
      <header className="board-reports-masthead">
        <div className="board-reports-context">
          <span className="board-reports-eyebrow">Electoral Board / {organizationName}</span>
          <span className="board-reports-context-rule" aria-hidden="true" />
        </div>

        <div className="board-reports-baseline">
          <h1 className="page-title board-reports-title">Reports</h1>
        </div>

        <p className="board-reports-standfirst">Export election records for {organizationName}.</p>
      </header>

      {!selectedElectionId ? (
        <section className="board-reports-selector" aria-labelledby="board-reports-select-title">
          <div className="board-reports-section-head">
            <div>
              <p className="board-reports-section-kicker">Election context</p>
              <h2 id="board-reports-select-title">Select an election</h2>
            </div>
            {!electionsLoading && !electionsError ? (
              <span className="board-reports-count">{elections.length} election{elections.length === 1 ? "" : "s"}</span>
            ) : null}
          </div>

          {electionsLoading ? (
            <div className="board-reports-register-skeleton" role="status" aria-label="Loading election register" aria-busy="true">
              {[0, 1, 2, 3].map((row) => (
                <div className="board-reports-election-skeleton" key={row}>
                  <span className="is-name" />
                  <span className="is-meta" />
                </div>
              ))}
            </div>
          ) : electionsError ? (
            <div className="board-reports-state board-reports-error" role="alert">
              <p>{electionsError}</p>
              <button type="button" onClick={retryElectionRegister} className="board-reports-text-action">
                <RefreshCw size={14} aria-hidden="true" /> Retry
              </button>
            </div>
          ) : elections.length === 0 ? (
            <p className="board-reports-state">No elections are available for this Board organization.</p>
          ) : (
            <>
              <div className="board-reports-election-list">
                {elections.map((election) => (
                  <ElectionRegisterRow key={election.id} election={election} onSelect={selectElection} />
                ))}
              </div>
            </>
          )}
        </section>
      ) : (
        <div className="board-reports-workspace">
          <section className="board-reports-selected" aria-labelledby="board-reports-selected-title">
            <div className="board-reports-selected-copy">
              <p className="board-reports-section-kicker">Reports for</p>
              <h2 id="board-reports-selected-title">{selectedTitle}</h2>
              <p className="board-reports-selected-meta">
                {selectedElection?.status || packageElection?.status || "Election report context"}
                {selectedElection ? ` · ${formatElectionPeriod(selectedElection)}` : ""}
              </p>
            </div>
            <button type="button" onClick={() => selectElection("")} className="board-reports-back">
              <ArrowLeft size={15} aria-hidden="true" /> Change election
            </button>
          </section>

          {packageLoading ? (
            <div className="board-reports-package-skeleton" role="status" aria-label={`Loading reports for ${selectedTitle}`} aria-busy="true">
              {[0, 1, 2, 3].map((row) => (
                <div className="board-reports-package-skeleton-row" key={row}>
                  <span className="is-title" />
                  <span className="is-copy" />
                  <span className="is-action" />
                </div>
              ))}
            </div>
          ) : packageError ? (
            <div className="board-reports-state board-reports-error" role="alert">
              <p>{packageError}</p>
              <button type="button" onClick={retryReportPackage} className="board-reports-text-action">
                <RefreshCw size={14} aria-hidden="true" /> Retry report package
              </button>
              <button type="button" onClick={() => selectElection("")} className="board-reports-text-action">
                Choose another election
              </button>
            </div>
          ) : reportPackage ? (
            <section className="board-reports-available" aria-labelledby="board-reports-available-title">
              <div className="board-reports-section-head board-reports-available-head">
                <div>
                  <p className="board-reports-section-kicker">Available reports</p>
                  <h3 id="board-reports-available-title">Reports for {selectedTitle}</h3>
                </div>
              </div>

              {votingSummary ? (
                <>
                  <dl className="board-reports-turnout" aria-label="Election voter turnout">
                    <div><dt>Eligible Voters</dt><dd>{turnoutMetricValue(votingSummary, "eligible_voters")}</dd></div>
                    <div><dt>Voters Participated</dt><dd>{turnoutMetricValue(votingSummary, "participated_voters")}</dd></div>
                    <div>
                      <dt>Voter Turnout</dt>
                      <dd>{formatTurnoutPercentage(votingSummary)}</dd>
                      <small>{turnoutAvailabilityLabel(votingSummary)}</small>
                    </div>
                  </dl>
                  <div className="board-reports-ballot-note" aria-live="polite">
                    {votingSummary.ballot_count_availability === "legacy_unavailable" ? (
                      <span>Ballot count unavailable for legacy vote records.</span>
                    ) : votingSummary.ballot_count_availability === "mixed_ballot_and_legacy" ? (
                      <span>
                        {votingSummary.authoritative_ballot_count} recorded ballots; legacy vote rows also exist and are not included in that count.
                      </span>
                    ) : (
                      <span>{votingSummary.authoritative_ballot_count} recorded ballots.</span>
                    )}
                  </div>
                </>
              ) : null}

              <div className="board-reports-report-list">
                {REPORT_DEFINITIONS.map((report, index) => {
                  const count = reportRecordCounts[report.key] ?? 0;
                  return (
                    <article className="board-reports-report-row" key={report.key}>
                      <span className="board-reports-report-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                      <div className="board-reports-report-copy">
                        <h4>{report.title}</h4>
                        <p>{report.description}</p>
                        {count === 0 ? (
                          <span className="board-reports-zero-note">No records · CSV will contain headers only</span>
                        ) : (
                          <span className="board-reports-record-count">{count} record{count === 1 ? "" : "s"}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="board-reports-export"
                        onClick={() => exportReport(report)}
                      >
                        <Download size={14} aria-hidden="true" /> Export CSV
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}

export default BoardReports;
