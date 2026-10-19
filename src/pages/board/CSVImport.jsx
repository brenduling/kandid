import { useEffect, useMemo, useRef, useState } from "react";
import "./BoardRemainingPages.css";
import Papa from "papaparse";
import { AlertTriangle, FileUp, ShieldCheck, Upload } from "lucide-react";
import { formatAcademicTerm, getCurrentAcademicTerm } from "../../utils/academicTerms";
import { usePrompt } from "../../context/PromptContext";
import {
  confirmBoardCsvImport,
  previewBoardCsvImport,
} from "../../utils/boardManualEnrollment";

/* The importer's actual column contract. validateRows() and the on-screen
   format reference both read these, so the guidance a Board member reads can
   never drift from what the importer actually enforces. The lists, their order
   and their effect on validation are unchanged. */
const CSV_REQUIRED_COLUMNS = [
  "student_number",
  "first_name",
  "last_name",
  "program",
  "year_level",
];
const CSV_OPTIONAL_COLUMNS = ["email"];

/* Upload -> Validate -> Review -> Import. Each step is marked from existing
   component state only; no new lifecycle is introduced. */
const WORKFLOW_STEPS = [
  { key: "upload", index: "01", label: "Upload" },
  { key: "validate", index: "02", label: "Validate" },
  { key: "review", index: "03", label: "Review" },
  { key: "import", index: "04", label: "Import" },
];

const REVIEW_TABS = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "already_member", label: "Already Members" },
  { key: "previously_removed", label: "Removed" },
  { key: "issues", label: "Needs Review" },
];

/* Editorial register, not rounded pills. Each server status maps to one of the
   three register voices so a row reads the same everywhere in the table. */
const STATUS_VOICE = {
  ready: "ready",
  imported: "ready",
  already_member: "settled",
  previously_removed: "settled",
  identity_conflict: "attention",
  program_mismatch: "attention",
  configuration_error: "blocked",
  term_not_active: "attention",
  not_enrolled_current_term: "attention",
  duplicate_csv: "blocked",
  invalid: "blocked",
  not_imported: "blocked",
};

const STATUS_TONE = {
  ready: "#047857",
  settled: "#514d46",
  attention: "#a1550a",
  blocked: "#9f1239",
};

function titleizeStatus(status) {
  return String(status || "needs_review")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function csvImportErrorMessage(error, action) {
  if (error?.code === "registration_not_enabled") return "Board student registration is not enabled on this deployment.";
  if (error?.code === "board_forbidden" || error?.code === "session_invalid" || error?.status === 401) {
    return "Your Electoral Board session could not be verified. Sign in again and retry.";
  }
  if (error?.code === "unsupported_action" || /endpoint does not allow the requested action/i.test(error?.message || "")) {
    return "CSV import is not supported by the currently deployed Board service. No rows were imported.";
  }
  if (error?.code === "enrollment_evidence_review_required") {
    return "Confirm that you reviewed the official department masterlist before importing.";
  }
  if (error?.code === "audit_record_failed") {
    return error.message || "Some rows were processed, but the import audit could not be saved. Review the row results before retrying.";
  }
  if (error?.status === 403) return "Your Board account is not authorized to import students for this organization.";
  if (error?.status === 400 || error?.status === 413) return error.message || "The CSV request did not pass server validation.";
  return error?.message || `${action === "preview" ? "CSV preview" : "CSV import"} failed. No success was reported; retry after checking the connection.`;
}

function previewStatusLabel(status, organizationType) {
  if (organizationType !== "non_departmental") return titleizeStatus(status);
  const labels = {
    ready: "Eligible",
    already_member: "Already active",
    not_enrolled_current_term: "Not currently enrolled",
    term_not_active: "Term / configuration issue",
    configuration_error: "Organization setup needs attention",
    program_mismatch: "Program outside Board coverage",
  };
  return labels[status] || titleizeStatus(status);
}

function BoardCSVImport() {
  const prompt = usePrompt();
  const [rows, setRows] = useState([]);
  const [validRows, setValidRows] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [previewResult, setPreviewResult] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [masterlistEvidenceReviewed, setMasterlistEvidenceReviewed] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [fileName, setFileName] = useState("");
  const [parseErrors, setParseErrors] = useState([]);
  const [activeTerm, setActiveTerm] = useState(null);
  const fileInputRef = useRef(null);

  const user = JSON.parse(localStorage.getItem("user"));
  const orgName = user?.organizations?.name;

  /* The destination term is shown before a file exists, so the Board always
     knows where a list would land. This is the same read-only helper the
     Student Registry already uses; it reads the active term only and adds no
     new table access or authority. */
  useEffect(() => {
    let active = true;
    getCurrentAcademicTerm({ force: true }).then(({ data }) => {
      if (active) setActiveTerm(data || null);
    });
    return () => {
      active = false;
    };
  }, []);

  const termLabel = formatAcademicTerm(previewResult?.academic_term || activeTerm);

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        setRows(result.data);
        setFileName(file.name || "");
        setPreviewResult(null);
        setActiveTab("all");
        /* Papa already returns row-level problems on the result it hands back;
           surfacing them adds no parsing. */
        setParseErrors(result.errors || []);
        validateRows(result.data);
      },
    });
  }

  /* Re-selecting the same filename does not fire a change event, so the upload
     stage is reachable again by clearing the input first. This is what makes
     "correct the CSV and upload it again" actually possible. */
  function handleChooseAnother() {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setRows([]);
    setValidRows([]);
    setInvalidRows([]);
    setPreviewResult(null);
    setParseErrors([]);
    setFileName("");
    setActiveTab("all");
  }

  function validateRows(data) {
    const valid = [];
    const invalid = [];

    data.forEach((row, index) => {
      const missing = CSV_REQUIRED_COLUMNS.filter((field) => !row[field]);
      const email = row.email?.trim() || "";

      if (missing.length > 0) {
        invalid.push({
          row: index + 2,
          reason: `Missing: ${missing.join(", ")}`,
        });
      } else if (email && !email.includes("@")) {
        invalid.push({
          row: index + 2,
          reason: "Invalid email format",
        });
      } else {
        valid.push({
          row_number: index + 2,
          student_number: row.student_number.trim(),
          first_name: row.first_name.trim(),
          last_name: row.last_name.trim(),
          email,
          program: row.program.trim(),
          year_level: Number(row.year_level),
          is_shs: false,
          status: "pending",
        });
      }
    });

    setValidRows(valid);
    setInvalidRows(invalid);
  }

  async function previewStudents() {
    if (validRows.length === 0) return;

    setMasterlistEvidenceReviewed(false);
    setPreviewing(true);
    const { data, error } = await previewBoardCsvImport(validRows);
    setPreviewing(false);

    if (error || !data) {
      prompt.error(csvImportErrorMessage(error, "preview"));
      return;
    }

    setPreviewResult(data);
    const readyCount = data.summary?.ready || 0;
    const issueCount = data.summary?.issues || 0;
    prompt.success(
      `${readyCount} students are ready to import. ${issueCount} rows need review or no action.`,
      "Preview Complete",
    );
  }

  async function confirmImport() {
    const readyCount = previewResult?.summary?.ready || 0;
    if (!readyCount) return;

    const organizationName = previewResult?.organization_name || orgName || "your organization";
    const termLabel = formatAcademicTerm(previewResult?.academic_term);
    const skippedCount = (previewResult?.summary?.total || 0) - readyCount;
    const ok = await prompt.confirm({
      type: "warning",
      title: "Confirm Board CSV Import",
      message: `${readyCount} eligible students will be added to ${organizationName} for ${termLabel}. ${skippedCount} records requiring no action or administrative review will not be imported.`,
      confirmText: "Import Ready Students",
    });

    if (!ok) return;

    setConfirming(true);
    const { data, error } = await confirmBoardCsvImport(validRows, { evidenceReviewed: masterlistEvidenceReviewed });
    setConfirming(false);

    if (!data) {
      prompt.error(csvImportErrorMessage(error, "import"));
      return;
    }

    setPreviewResult(data);
    const summary = data.summary || {};
    if (error) {
      prompt.error(csvImportErrorMessage(error, "import"));
      return;
    }
    if (Number(summary.skipped || 0) > 0) {
      prompt.error(`${summary.imported || 0} rows imported; ${summary.skipped || 0} rows were skipped or need review. Check the row results before retrying.`);
    } else {
      prompt.success(`${summary.imported || 0} students imported.`, "Import Complete");
    }

  }

  const filteredServerRows = useMemo(() => {
    const serverResults = previewResult?.results || [];
    if (activeTab === "all") return serverResults;
    if (activeTab === "issues") {
      return serverResults.filter(
        (row) => !["ready", "imported", "already_member", "previously_removed"].includes(row.status),
      );
    }
    return serverResults.filter(
      (row) => row.status === activeTab || (activeTab === "ready" && row.status === "imported"),
    );
  }, [activeTab, previewResult?.results]);

  const previewSummary = previewResult?.summary || {};
  const importedCount = previewSummary.imported || 0;
  const readyCount = previewSummary.ready || 0;
  const issueCount = previewSummary.issues || 0;
  const hasFile = rows.length > 0;

  /* The step rail is read off existing state, never stored. A file that has not
     been previewed yet is still being validated locally; a preview with an
     import count is a finished import. */
  const activeStep = !hasFile ? "upload" : importedCount > 0 ? "import" : "review";
  const activeStepIndex = WORKFLOW_STEPS.findIndex((step) => step.key === activeStep);
  const parseIssueCount = parseErrors.length;

  return (
    <div className="board-remaining-page board-csv-import">
      <header className="board-csv-head">
        <div className="board-csv-head-context">
          <span className="board-csv-eyebrow">Student Records / CSV Import</span>
          <span className="board-csv-context-rule" aria-hidden="true" />
        </div>
        <h1 className="page-title board-csv-title">Import students</h1>
        <p className="board-csv-subtitle">
          Upload a student list, review every record, then import into{" "}
          <strong>{previewResult?.organization_name || orgName || "your organization"}</strong> for{" "}
          <strong>{termLabel}</strong>. Records that need review or no action are never
          changed.
        </p>
      </header>

      <ol className="board-csv-steps" aria-label="Import progress">
        {WORKFLOW_STEPS.map((step, index) => {
          const state =
            index < activeStepIndex ? "done" : index === activeStepIndex ? "current" : "upcoming";
          return (
            <li key={step.key} className={`board-csv-step is-${state}`}>
              <span className="board-csv-step-index">{step.index}</span>
              <span className="board-csv-step-label">{step.label}</span>
            </li>
          );
        })}
      </ol>

      <section className="board-csv-upload" aria-label="Upload a student list">
        <div className="board-csv-upload-picker">
          <FileUp size={26} aria-hidden="true" className="board-csv-upload-icon" />
          <div>
            <h2 className="board-csv-section-title">
              {hasFile ? "Replace the current file" : "Choose a CSV file"}
            </h2>
            <p className="board-csv-section-copy">
              One student per row. The first row must name each column.
            </p>
          </div>
          <label className="board-csv-file-button">
            <Upload size={15} aria-hidden="true" />
            Select CSV file
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="board-csv-file-input"
            />
          </label>
          {hasFile && (
            <button type="button" className="board-csv-file-clear" onClick={handleChooseAnother}>
              Clear and start over
            </button>
          )}
        </div>

        <div className="board-csv-format">
          <h3 className="board-csv-section-kicker">Required columns</h3>
          <ul className="board-csv-column-list">
            {CSV_REQUIRED_COLUMNS.map((column) => (
              <li key={column} className="board-csv-column is-required">
                {column}
              </li>
            ))}
          </ul>
          <h3 className="board-csv-section-kicker">Optional columns</h3>
          <ul className="board-csv-column-list">
            {CSV_OPTIONAL_COLUMNS.map((column) => (
              <li key={column} className="board-csv-column is-optional">
                {column}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {hasFile && (
        <section className="board-csv-summary" aria-label="Parsed file summary">
          <div className="board-csv-summary-file">
            <p className="board-csv-section-kicker">Current file</p>
            <p className="board-csv-summary-name">{fileName}</p>
            <p className="board-csv-section-copy">
              {rows.length} data {rows.length === 1 ? "row" : "rows"} read.
            </p>
          </div>
          <dl className="board-csv-summary-figures">
            <div className="board-csv-summary-figure">
                <dt>{previewResult ? "Eligible" : "Valid rows"}</dt>
              <dd>{validRows.length}</dd>
            </div>
            <div className="board-csv-summary-figure is-attention">
              <dt>Failed local check</dt>
              <dd>{invalidRows.length}</dd>
            </div>
            {previewResult && (
              <>
                <div className="board-csv-summary-figure">
                  <dt>{importedCount > 0 ? "Imported" : "Ready"}</dt>
                  <dd>{importedCount > 0 ? importedCount : readyCount}</dd>
                </div>
                <div className="board-csv-summary-figure">
                  <dt>New identities</dt>
                  <dd>{previewSummary.new_students || 0}</dd>
                </div>
                <div className="board-csv-summary-figure">
                  <dt>Existing eligible</dt>
                  <dd>{previewSummary.existing_students || 0}</dd>
                </div>
                <div className="board-csv-summary-figure">
                  <dt>Already registered</dt>
                  <dd>{previewSummary.already_member || 0}</dd>
                </div>
                <div className="board-csv-summary-figure is-attention">
                  <dt>Needs review</dt>
                  <dd>{issueCount}</dd>
                </div>
              </>
            )}
          </dl>
        </section>
      )}

      {parseIssueCount > 0 && (
        <section className="board-csv-notice" aria-label="Parser issues">
          <AlertTriangle size={17} aria-hidden="true" className="board-csv-notice-icon" />
          <div>
            <h2 className="board-csv-section-title">
              {parseIssueCount} {parseIssueCount === 1 ? "row needs" : "rows need"} attention
            </h2>
            <p className="board-csv-section-copy">
              The file was read with the columns it provides. Rows with missing required
              columns are not sent for import. Check these lines in your file and upload it
              again.
            </p>
            <ul className="board-csv-notice-list">
              {parseErrors.slice(0, 6).map((error, index) => (
                <li key={`${error.code || "parse"}-${error.row ?? index}`}>
                  {typeof error.row === "number" ? `Line ${error.row + 2}: ` : ""}
                  {error.message}
                </li>
              ))}
            </ul>
            {parseErrors.length > 6 && (
              <p className="board-csv-section-copy">
                {parseErrors.length - 6} more {parseErrors.length - 6 === 1 ? "line" : "lines"}{" "}
                reported.
              </p>
            )}
          </div>
        </section>
      )}

      {invalidRows.length > 0 && (
        <section className="board-csv-register" aria-label="Rows that failed the local check">
          <header className="board-csv-register-head">
            <p className="board-csv-section-kicker">Local check</p>
            <h2 className="board-csv-section-title">
              {invalidRows.length} {invalidRows.length === 1 ? "row" : "rows"} not sent for import
            </h2>
            <p className="board-csv-section-copy">
              Line numbers match the file, counting the header as line 1. These rows are
              skipped; they never reach the Board import.
            </p>
          </header>
          <div className="board-csv-register-body">
            {invalidRows.map((row) => (
              <div key={row.row} className="board-csv-register-row">
                <span className="board-csv-register-line">Line {row.row}</span>
                <span className="board-csv-register-reason">{row.reason}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {previewResult && (
        <section className="board-csv-register" aria-label="Board import review">
          <header className="board-csv-register-head">
            <p className="board-csv-section-kicker">
              {importedCount > 0 ? "Import result" : "Board review"}
            </p>
            <h2 className="board-csv-section-title">
              {importedCount > 0
                ? `${importedCount} imported`
                : `${readyCount} ready to import`}
            </h2>
            <p className="board-csv-section-copy">
              {previewResult.organization_name || orgName || "Your organization"} ·{" "}
              {formatAcademicTerm(previewResult.academic_term)}
            </p>
            <p className="board-csv-section-copy">
              {previewSummary.new_students || 0} new identities · {previewSummary.existing_students || 0} existing students eligible · {previewSummary.already_member || 0} already registered
            </p>
            {previewResult.organization_type === "non_departmental" ? (
              <p className="board-csv-section-copy">
                Program is academic information here; eligibility is checked from current enrollment.
              </p>
            ) : null}
          </header>

          <div className="board-csv-tabs" role="tablist" aria-label="Filter reviewed records">
            {REVIEW_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`board-csv-tab${activeTab === tab.key ? " is-active" : ""}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="board-csv-register-body">
            {filteredServerRows.length === 0 ? (
              <p className="board-csv-empty">No records in this category.</p>
            ) : (
              filteredServerRows.map((row) => {
                const voice = STATUS_VOICE[row.status] || "blocked";
                return (
                  <article
                    key={`${row.row_number}-${row.student_number}-${row.status}`}
                    className="board-csv-review-row"
                  >
                    <div className="board-csv-review-id">
                      <span className="board-csv-register-line">Line {row.row_number}</span>
                      <p className="board-csv-review-name">
                        {row.first_name} {row.last_name}
                      </p>
                      <p className="board-csv-section-copy">
                        {row.student_number || "No Student ID"} · {row.program || "No program"} · Year{" "}
                        {row.year_level || "-"}
                      </p>
                    </div>
                    <div className="board-csv-review-outcome">
                      <span
                        className="board-csv-outcome"
                        style={{ color: STATUS_TONE[voice] }}
                      >
                        <span
                          className="board-csv-outcome-marker"
                          style={{ background: STATUS_TONE[voice] }}
                          aria-hidden="true"
                        />
                        {previewStatusLabel(row.status, previewResult.organization_type)}
                      </span>
                      {row.message && <p className="board-csv-review-message">{row.message}</p>}
                      {(row.official_program || row.official) && (
                        <div className="board-csv-review-official">
                          {row.official_program && (
                            <p>Official program: {row.official_program}</p>
                          )}
                          {row.official && (
                            <p>
                              Official identity: {row.official.first_name}{" "}
                              {row.official.last_name}, {row.official.program || "No program"},
                              Year {row.official.year_level || "-"}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {readyCount === 0 && importedCount === 0 && (
            <div className="board-csv-notice is-warning" role="status">
              <AlertTriangle size={17} aria-hidden="true" className="board-csv-notice-icon" />
              <p>
                No rows are currently eligible for Board import. Rows with identity conflicts,
                unsupported program coverage, or explicit removal history were left unchanged.
              </p>
            </div>
          )}
          {readyCount > 0 && importedCount === 0 && (
            <label className="board-csv-evidence-confirm">
              <input type="checkbox" checked={masterlistEvidenceReviewed}
                onChange={(event) => setMasterlistEvidenceReviewed(event.target.checked)} />
              I confirm this is the official department masterlist and reviewed it as evidence of enrollment for {formatAcademicTerm(previewResult.academic_term)}.
            </label>
          )}
        </section>
      )}

      {validRows.length > 0 && (
        <div className="board-csv-actions">
          <button
            type="button"
            onClick={previewStudents}
            disabled={previewing || confirming}
            className="board-csv-button is-secondary"
          >
            {previewing ? "Reviewing..." : `Preview ${validRows.length} Records`}
          </button>
          {previewResult && importedCount === 0 && (
            <button
              type="button"
              onClick={confirmImport}
              disabled={confirming || readyCount === 0 || !masterlistEvidenceReviewed}
              className="board-csv-button is-primary"
            >
              <ShieldCheck size={17} aria-hidden="true" />
              {confirming ? "Importing..." : `Import ${readyCount} Ready Students`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default BoardCSVImport;
