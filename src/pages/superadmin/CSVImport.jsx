import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Papa from "papaparse";
import { AlertTriangle, ArrowRight, FileText, FileUp } from "lucide-react";
import { createMasterlistImport } from "../../utils/superAdminMasterlistImport";
import { formatAcademicTerm, listAcademicTerms } from "../../utils/academicTerms";
import { usePrompt } from "../../context/PromptContext";
import SuperAdminPageHeader from "../../components/SuperAdminPageHeader";
import { validateStudentCsv } from "../../utils/studentCsvValidation.js";
import { studentManagementErrorMessage } from "../../utils/studentManagementRequest.js";
import "./CSVImport.css";

function CSVImport() {
  const navigate = useNavigate();
  const prompt = usePrompt();
  const [rows, setRows] = useState([]);
  const [validRows, setValidRows] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [terms, setTerms] = useState([]);
  const [selectedTermId, setSelectedTermId] = useState("");
  const [importScope, setImportScope] = useState("incremental");
  const [termLoading, setTermLoading] = useState(true);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [parseErrors,setParseErrors] = useState([]);
  const staging = useRef(false);
  const parseRequest = useRef(0);

  const availableTerms = useMemo(
    () => terms.filter((term) => term.status !== "closed"),
    [terms],
  );

  useEffect(() => {
    let active = true;

    async function loadTerms() {
      setTermLoading(true);
      const { data, error } = await listAcademicTerms({ force: true });

      if (!active) return;

      if (error) {
        prompt.error(error.message || "Academic terms could not be loaded.");
        setTerms([]);
      } else {
        const loadedTerms = data || [];
        setTerms(loadedTerms);
        const draftTerm =
          loadedTerms.find((term) => term.status === "draft") ||
          loadedTerms.find((term) => term.status === "active") ||
          null;
        setSelectedTermId(draftTerm?.id ? String(draftTerm.id) : "");
      }

      setTermLoading(false);
    }

    loadTerms();

    return () => {
      active = false;
    };
  }, [prompt]);

  function handleFileUpload(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const request=++parseRequest.current;
    setRows([]);setValidRows([]);setInvalidRows([]);setParseErrors([]);
    setSelectedFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: value => value.replace(/^\uFEFF/,"").trim(),
      complete: (result) => {
        if(request!==parseRequest.current)return;
        const parsedRows = result.data;
        setRows(parsedRows);
        const validated=validateStudentCsv(result);
        setValidRows(validated.validRows);
        setInvalidRows(validated.invalidRows);
        setParseErrors(validated.errors);
      },
      error: () => {if(request===parseRequest.current){setRows([]);setValidRows([]);setInvalidRows([]);setParseErrors(['The CSV file could not be read. Select it again.']);}},
    });
  }

  async function importStudents() {
    if (staging.current || validRows.length === 0 || parseErrors.length) return;
    if (importScope === "full_roster" && invalidRows.length) {
      prompt.error("Correct every invalid row before staging a complete full-term roster.");return;
    }
    if (!selectedTermId) {
      prompt.error("Choose an academic term before staging the masterlist.");
      return;
    }

    staging.current=true;
    setImporting(true);

    const { data, error } = await createMasterlistImport({
      academicTermId: selectedTermId,
      fileName: selectedFileName || "masterlist.csv",
      rows: validRows,
      importScope,
    });

    setImporting(false);
    staging.current=false;

    if (error || !data?.import?.id) {
      prompt.error(error ? studentManagementErrorMessage(error,{write:true}) : "Masterlist staging could not be confirmed. Refresh before retrying.");
      return;
    }

    prompt.success("Masterlist staged for review.");
    navigate(`/super-admin/masterlist/review/${data.import.id}`);
  }

  const currentPhase = importing
    ? "stage"
    : rows.length > 0
      ? "review"
      : selectedTermId
        ? "select"
        : "prepare";
  const workflowPhases = [
    { key: "prepare", index: "01", label: "Prepare", detail: "Choose an academic term" },
    { key: "select", index: "02", label: "Select", detail: "Provide a CSV file" },
    { key: "review", index: "03", label: "Review", detail: "Check parsed records" },
    { key: "stage", index: "04", label: "Stage", detail: "Send valid rows to review" },
  ];
  const currentPhaseIndex = workflowPhases.findIndex((phase) => phase.key === currentPhase);

  return (
    <div className="sa-csv-import">
      <SuperAdminPageHeader
        section="Student records"
        title="CSV Import"
        description="Prepare student masterlists for administrative review before registry import."
        actions={<><span>Record type</span><strong>Student masterlist</strong><small>Accepted format: .csv</small></>}
      />

      <ol className="sa-csv-import-workflow" aria-label="CSV import workflow">
        {workflowPhases.map((phase, index) => {
          const isCurrent = phase.key === currentPhase;
          const isComplete = index < currentPhaseIndex;

          return (
            <li
              key={phase.key}
              className={`${isCurrent ? "is-current" : ""} ${isComplete ? "is-complete" : ""}`.trim()}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span>{phase.index}</span>
              <div>
                <strong>{phase.label}</strong>
                <small>{phase.detail}</small>
              </div>
            </li>
          );
        })}
      </ol>

      <section className="sa-csv-import-prepare" aria-labelledby="csv-prepare-heading">
        <div className="sa-csv-import-section-head">
          <div>
            <p className="sa-csv-import-eyebrow">Format guide / 01</p>
            <h2 id="csv-prepare-heading">Prepare the record file</h2>
          </div>
          <p>Required structure is checked locally before staging.</p>
        </div>

        <div className="sa-csv-import-prepare-grid">
          <label className="sa-csv-import-term" htmlFor="academic-term">
            <span>Academic term</span>
            <strong>Choose where this masterlist belongs.</strong>
            <select
              id="academic-term"
              value={selectedTermId}
              onChange={(event) => setSelectedTermId(event.target.value)}
              disabled={termLoading || importing}
            >
              <option value="">
                {termLoading ? "Loading academic terms..." : "Select academic term"}
              </option>
              {availableTerms.map((term) => (
                <option key={term.id} value={term.id}>
                  {formatAcademicTerm(term)} - {term.status}
                </option>
              ))}
            </select>
            {!termLoading && availableTerms.length === 0 ? (
              <small>No open academic terms are available for staging.</small>
            ) : null}
          </label>

          <fieldset className="sa-csv-import-term" disabled={importing}>
            <legend>Import scope</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="masterlist-import-scope"
                value="incremental"
                checked={importScope === "incremental"}
                onChange={() => setImportScope("incremental")}
              />
              <span>
                <strong>Incremental (default)</strong>
                <small>Update only Students included in this upload. Other enrollments and memberships remain unchanged.</small>
              </span>
            </label>
            <label className="mt-3 flex items-start gap-2">
              <input
                type="radio"
                name="masterlist-import-scope"
                value="full_roster"
                checked={importScope === "full_roster"}
                onChange={() => setImportScope("full_roster")}
              />
              <span>
                <strong>Complete full-term roster</strong>
                <small>Use only when this file is the complete authoritative roster for the selected term.</small>
              </span>
            </label>
            {importScope === "full_roster" ? (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Students absent from a confirmed complete roster may lose current-term enrollment eligibility. The affected Students will be listed for Super Admin review before finalization.
              </p>
            ) : null}
          </fieldset>

          <div className="sa-csv-import-schema" aria-label="CSV column requirements">
            <div>
              <span>Required fields</span>
              <ol>
                <li><b>01</b> student_number</li>
                <li><b>02</b> first_name</li>
                <li><b>03</b> last_name</li>
                <li><b>04</b> program</li>
                <li><b>05</b> year_level</li>
              </ol>
            </div>
            <div>
              <span>Optional field</span>
              <ol>
                <li><b>01</b> email</li>
              </ol>
              <small>Email is checked for basic format when supplied.</small>
            </div>
          </div>
        </div>
      </section>

      <section className="sa-csv-import-intake" aria-labelledby="csv-intake-heading">
        <div className="sa-csv-import-intake-mark" aria-hidden="true">
          <FileText size={24} />
          <span>CSV</span>
        </div>
        <div className="sa-csv-import-intake-copy">
          <p className="sa-csv-import-eyebrow">File intake / 02</p>
          <h2 id="csv-intake-heading">
            {selectedFileName ? "Selected record file" : "Select the student record file"}
          </h2>
          {selectedFileName ? (
            <>
              <strong>{selectedFileName}</strong>
              <p>{rows.length} parsed row{rows.length === 1 ? "" : "s"} ready for local review.</p>
            </>
          ) : (
            <p>Choose a CSV file to parse and validate before any record is staged.</p>
          )}
        </div>
        <label className="sa-csv-import-file-action">
          <FileUp size={16} aria-hidden="true" />
          {selectedFileName ? "Replace CSV file" : "Select CSV file"}
          <input type="file" accept=".csv" disabled={importing} onChange={handleFileUpload} />
        </label>
      </section>

      {parseErrors.length ? <div className="sa-csv-import-attention" role="alert"><AlertTriangle size={18} aria-hidden="true" /><ul>{parseErrors.map((error,index)=><li key={index}>{error}</li>)}</ul></div> : null}

      {rows.length > 0 ? (
        <>
          <section className="sa-csv-import-summary" aria-label="Parsed file summary">
            <div className="is-total">
              <span>Parsed rows</span>
              <strong>{rows.length}</strong>
              <small>Detected in selected file</small>
            </div>
            <div className="is-valid">
              <span>Locally valid</span>
              <strong>{validRows.length}</strong>
              <small>Eligible to be staged</small>
            </div>
            <div className="is-invalid">
              <span>Needs correction</span>
              <strong>{invalidRows.length}</strong>
              <small>Excluded from staging</small>
            </div>
          </section>

          <section className="sa-csv-import-preview" aria-labelledby="csv-preview-heading">
            <div className="sa-csv-import-section-head">
              <div>
                <p className="sa-csv-import-eyebrow">Record preview / 03</p>
                <h2 id="csv-preview-heading">Verify parsed records</h2>
              </div>
              <p>Only locally valid rows move to Masterlist Review.</p>
            </div>

            <div className="sa-csv-import-preview-grid">
              <section className="sa-csv-import-valid" aria-labelledby="csv-valid-heading">
                <header>
                  <span className="sa-csv-import-state-mark is-valid" aria-hidden="true" />
                  <div>
                    <p>Ready for staging</p>
                    <h3 id="csv-valid-heading">Valid records</h3>
                  </div>
                  <strong>{validRows.length}</strong>
                </header>

                {validRows.length > 0 ? (
                  <div className="sa-csv-import-table-wrap" tabIndex="0">
                    <table>
                      <caption className="sr-only">Locally valid CSV records</caption>
                      <thead>
                        <tr>
                          <th scope="col">Row</th>
                          <th scope="col">Student</th>
                          <th scope="col">Program</th>
                          <th scope="col">Year</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validRows.map((row, index) => (
                          <tr key={`${row.row_number}-${row.student_number}-${index}`}>
                            <td>{String(row.row_number).padStart(2, "0")}</td>
                            <td>
                              <strong>{row.first_name} {row.last_name}</strong>
                              <span>{row.student_number}</span>
                            </td>
                            <td>{row.program}</td>
                            <td>{row.year_level}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="sa-csv-import-list-empty">No locally valid rows were found.</p>
                )}
              </section>

              <section className="sa-csv-import-invalid" aria-labelledby="csv-invalid-heading">
                <header>
                  <span className="sa-csv-import-state-mark is-invalid" aria-hidden="true" />
                  <div>
                    <p>Excluded from staging</p>
                    <h3 id="csv-invalid-heading">Records needing correction</h3>
                  </div>
                  <strong>{invalidRows.length}</strong>
                </header>

                {invalidRows.length === 0 ? (
                  <p className="sa-csv-import-list-empty">No local validation issues found.</p>
                ) : (
                  <ol className="sa-csv-import-issue-list">
                    {invalidRows.map((row, index) => (
                      <li key={`${row.row}-${row.reason}-${index}`}>
                        <span>{String(row.row).padStart(2, "0")}</span>
                        <div>
                          <strong>CSV row {row.row}</strong>
                          <p>{row.reason}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </section>
        </>
      ) : null}

      {validRows.length > 0 ? (
        <section className="sa-csv-import-commit" aria-labelledby="csv-commit-heading">
          <div className="sa-csv-import-commit-mark" aria-hidden="true">
            <span />
            <span />
          </div>
          <div>
            <p className="sa-csv-import-eyebrow">Staging desk / 04</p>
            <h2 id="csv-commit-heading">Send valid records to review</h2>
            <p>
              This creates a draft masterlist for the selected term. Student records
              are finalized later from Masterlist Review.
            </p>
            {invalidRows.length > 0 ? (
              <div className="sa-csv-import-attention">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{invalidRows.length} locally invalid row{invalidRows.length === 1 ? " is" : "s are"} excluded.</span>
              </div>
            ) : null}
          </div>
          <button
            onClick={importStudents}
            disabled={importing || !selectedTermId || parseErrors.length > 0 || (importScope === "full_roster" && invalidRows.length > 0)}
            type="button"
          >
            {importing ? "Staging records..." : `Stage ${validRows.length} records`}
            {!importing ? <ArrowRight size={16} aria-hidden="true" /> : null}
          </button>
        </section>
      ) : null}
    </div>
  );
}

export default CSVImport;
