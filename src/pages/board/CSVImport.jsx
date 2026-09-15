import { useMemo, useState } from "react";
import Papa from "papaparse";
import { AlertTriangle, CheckCircle, FileUp, ShieldCheck, Upload, XCircle } from "lucide-react";
import { logAuditEvent } from "../../utils/auditLog";
import { formatAcademicTerm } from "../../utils/academicTerms";
import { usePrompt } from "../../context/PromptContext";
import {
  confirmBoardCsvImport,
  previewBoardCsvImport,
} from "../../utils/boardManualEnrollment";

const REVIEW_TABS = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "already_member", label: "Already Members" },
  { key: "previously_removed", label: "Removed" },
  { key: "issues", label: "Needs Review" },
];

const STATUS_STYLES = {
  ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
  imported: "bg-emerald-50 text-emerald-700 border-emerald-200",
  already_member: "bg-slate-50 text-slate-700 border-slate-200",
  previously_removed: "bg-rose-50 text-rose-700 border-rose-200",
  identity_conflict: "bg-amber-50 text-amber-700 border-amber-200",
  program_mismatch: "bg-amber-50 text-amber-700 border-amber-200",
  program_change_requires_super_admin: "bg-amber-50 text-amber-700 border-amber-200",
  not_enrolled_current_term: "bg-amber-50 text-amber-700 border-amber-200",
  new_student_not_in_masterlist: "bg-amber-50 text-amber-700 border-amber-200",
  duplicate_csv: "bg-rose-50 text-rose-700 border-rose-200",
  invalid: "bg-rose-50 text-rose-700 border-rose-200",
  not_imported: "bg-rose-50 text-rose-700 border-rose-200",
};

function titleizeStatus(status) {
  return String(status || "needs_review")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function BoardCSVImport() {
  const prompt = usePrompt();
  const [rows, setRows] = useState([]);
  const [validRows, setValidRows] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [previewResult, setPreviewResult] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  const user = JSON.parse(localStorage.getItem("user"));
  const orgName = user?.organizations?.name;

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        setRows(result.data);
        setPreviewResult(null);
        setActiveTab("all");
        validateRows(result.data);
      },
    });
  }

  function validateRows(data) {
    const valid = [];
    const invalid = [];

    data.forEach((row, index) => {
      const requiredFields = [
        "student_number",
        "first_name",
        "last_name",
        "program",
        "year_level",
      ];

      const missing = requiredFields.filter((field) => !row[field]);
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

    setPreviewing(true);
    const { data, error } = await previewBoardCsvImport(validRows);
    setPreviewing(false);

    if (error || !data) {
      prompt.error(error?.message || "Board CSV preview failed.");
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
    const { data, error } = await confirmBoardCsvImport(validRows);
    setConfirming(false);

    if (error || !data) {
      prompt.error(error?.message || "Board CSV import failed.");
      return;
    }

    setPreviewResult(data);
    const summary = data.summary || {};
    prompt.success(
      `${summary.imported || 0} students imported. ${summary.skipped || 0} rows were skipped.`,
      "Import Complete",
    );

    await logAuditEvent({
      action: "student_batch_imported",
      entityType: "student",
      entityLabel: "Board CSV Import",
      organizationId: data.board_organization_id || user?.organization_id,
      organizationName,
      status: "completed",
      metadata: {
        imported_count: summary.imported || 0,
        committed_count: summary.committed || 0,
        skipped_count: summary.skipped || 0,
        already_member_count: summary.already_member || 0,
        previously_removed_count: summary.previously_removed || 0,
        identity_conflict_count: summary.identity_conflict || 0,
        program_mismatch_count: summary.program_mismatch || 0,
        program_change_count: summary.program_change_requires_super_admin || 0,
        not_enrolled_current_term_count: summary.not_enrolled_current_term || 0,
        new_student_not_in_masterlist_count: summary.new_student_not_in_masterlist || 0,
        invalid_count: (summary.invalid || 0) + invalidRows.length,
      },
    });
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

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Student Records</div>
          <h1 className="page-title">Board CSV import</h1>
          <p className="page-subtitle">
            Upload and review current-term organization participation before importing.
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <p className="field-label">Total Rows</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,90,31,0.1)] text-[#ff5a1f]">
              <Upload size={18} />
            </span>
          </div>
          <h2 className="mt-6 text-4xl font-black leading-none">{rows.length}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <p className="field-label">Valid Rows</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <CheckCircle size={18} />
            </span>
          </div>
          <h2 className="mt-6 text-4xl font-black leading-none">{validRows.length}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <p className="field-label">Invalid Rows</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
              <XCircle size={18} />
            </span>
          </div>
          <h2 className="mt-6 text-4xl font-black leading-none">{invalidRows.length}</h2>
        </div>
      </div>

      <div className="upload-shell mt-8 rounded-[28px] border-2 border-dashed border-[rgba(255,115,22,0.16)] p-8">
        <label className="flex cursor-pointer flex-col items-center justify-center text-center">
          <FileUp size={42} className="text-[#ff5a1f]" />
          <h3 className="surface-heading mt-4 text-xl font-black">Upload CSV File</h3>
          <p className="surface-subcopy mt-1 text-sm">
            Required columns: student_number, first_name, last_name, program,
            year_level. Email is optional.
          </p>

          <input
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>
      </div>

      {rows.length > 0 && (
        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          <div className="soft-card overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-[rgba(255,115,22,0.12)] px-5 py-5">
              <CheckCircle className="text-green-600" size={20} />
              <h3 className="surface-heading font-black">Locally Valid Records</h3>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {validRows.map((row, index) => (
                <div
                  key={index}
                  className="border-b border-[rgba(255,115,22,0.08)] px-5 py-3 text-sm last:border-b-0"
                >
                  <p className="surface-heading font-bold">
                    {row.student_number} - {row.first_name} {row.last_name}
                  </p>
                  <p className="surface-subcopy">
                    {row.program} | Year {row.year_level}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="soft-card overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-[rgba(255,115,22,0.12)] px-5 py-5">
              <XCircle className="text-red-600" size={20} />
              <h3 className="surface-heading font-black">Local Invalid Records</h3>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {invalidRows.length === 0 ? (
                <p className="empty-copy p-5">No invalid records found.</p>
              ) : (
                invalidRows.map((row, index) => (
                  <div
                    key={index}
                    className="border-b border-[rgba(255,115,22,0.08)] px-5 py-3 text-sm last:border-b-0"
                  >
                    <p className="surface-heading font-bold">CSV Row {row.row}</p>
                    <p className="text-red-600">{row.reason}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {previewResult && (
        <div className="mt-8 soft-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="field-label">Board Import Review</p>
              <h3 className="surface-heading mt-1 text-xl font-black">
                {importedCount > 0 ? `${importedCount} imported` : `${readyCount} ready to import`}
              </h3>
              <p className="surface-subcopy mt-1 text-sm">
                {previewResult.organization_name || orgName || "Your organization"} - {formatAcademicTerm(previewResult.academic_term)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              {[
                ["Ready", readyCount],
                ["Imported", importedCount],
                ["Already Members", previewSummary.already_member || 0],
                ["Removed", previewSummary.previously_removed || 0],
                ["Needs Review", issueCount],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-white/70 px-4 py-3">
                  <p className="surface-subcopy text-xs font-bold">{label}</p>
                  <p className="surface-heading text-lg font-black">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {REVIEW_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-2xl border px-4 py-2 text-sm font-black transition ${
                  activeTab === tab.key
                    ? "border-[#ff5a1f] bg-[#ff5a1f] text-white"
                    : "border-[rgba(15,23,42,0.12)] bg-white/70 text-slate-700 hover:border-[#ff5a1f]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-[rgba(255,115,22,0.12)]">
            <div className="border-b border-[rgba(255,115,22,0.12)] px-4 py-3">
              <p className="field-label">Server Review Rows</p>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {filteredServerRows.length === 0 ? (
                <p className="empty-copy p-5">No rows in this category.</p>
              ) : (
                filteredServerRows.map((row) => (
                  <div
                    key={`${row.row_number}-${row.student_number}-${row.status}`}
                    className="border-b border-[rgba(255,115,22,0.08)] px-4 py-4 text-sm last:border-b-0"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="surface-heading font-black">
                          Row {row.row_number} - {row.student_number || "No Student ID"}
                        </p>
                        <p className="surface-subcopy">
                          {row.first_name} {row.last_name} | {row.program || "No program"} | Year {row.year_level || "-"}
                        </p>
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-xs font-black ${STATUS_STYLES[row.status] || STATUS_STYLES.invalid}`}>
                        {titleizeStatus(row.status)}
                      </span>
                    </div>
                    <p className="surface-subcopy mt-3">{row.message}</p>
                    {(row.official_program || row.official) && (
                      <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
                        {row.official_program && <p>Official program: {row.official_program}</p>}
                        {row.official && (
                          <p>
                            Official identity: {row.official.first_name} {row.official.last_name}, {row.official.program || "No program"}, Year {row.official.year_level || "-"}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {readyCount === 0 && importedCount === 0 && (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
              <p>No rows are currently eligible for Board import. Rows requiring Super Admin review or restore action were left unchanged.</p>
            </div>
          )}
        </div>
      )}

      {validRows.length > 0 && (
        <div className="mt-8 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={previewStudents}
            disabled={previewing || confirming}
            className="secondary-btn disabled:opacity-60"
          >
            {previewing ? "Reviewing..." : `Preview ${validRows.length} Records`}
          </button>
          {previewResult && importedCount === 0 && (
            <button
              type="button"
              onClick={confirmImport}
              disabled={confirming || readyCount === 0}
              className="primary-btn disabled:opacity-60"
            >
              <ShieldCheck size={18} />
              {confirming ? "Importing..." : `Import ${readyCount} Ready Students`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default BoardCSVImport;
