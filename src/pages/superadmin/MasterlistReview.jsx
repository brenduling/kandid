import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle,
  Edit3,
  FileUp,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { formatAcademicTerm } from "../../utils/academicTerms";
import {
  finalizeMasterlistImport,
  getMasterlistImport,
  removeMasterlistImportRow,
  reviewMasterlistImportRow,
  updateMasterlistImportRow,
} from "../../utils/superAdminMasterlistImport";
import { usePrompt } from "../../context/PromptContext";

const CATEGORY_TABS = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "continuing", label: "Continuing" },
  { key: "returnee", label: "Returnees" },
  { key: "shifted_program", label: "Program Changes" },
  { key: "conflict", label: "Conflicts" },
  { key: "invalid", label: "Invalid" },
];

const STATUS_LABELS = {
  new: "New",
  continuing: "Continuing",
  returnee: "Returnee",
  shifted_program: "Program Change",
  conflict: "Conflict",
  invalid: "Invalid",
  pending: "Pending",
};

function badgeClass(status) {
  if (status === "new") return "rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700";
  if (status === "continuing") return "rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700";
  if (status === "returnee") return "rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700";
  if (status === "shifted_program") return "rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700";
  if (status === "conflict" || status === "invalid") {
    return "rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700";
  }
  return "rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600";
}

function reviewBadgeClass(status) {
  if (status === "approved") return "rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700";
  if (status === "pending_review") return "rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700";
  if (status === "rejected") return "rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700";
  return "rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600";
}

function formatName(row) {
  return `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Unnamed student";
}

function blockingRow(row) {
  return (
    row.reconciliation_status === "invalid" ||
    row.reconciliation_status === "conflict" ||
    (row.reconciliation_status === "shifted_program" &&
      row.review_status !== "approved")
  );
}

function explainConflict(row) {
  const message = String(row.issue_message || "");
  if (message.toLowerCase().includes("duplicate")) {
    return "Duplicate Student ID inside this CSV.";
  }
  if (message.toLowerCase().includes("name differs")) {
    return "Identity conflict. The Student ID belongs to a different KANDID record.";
  }
  return message || "Action required before finalization.";
}

function programChangeText(row) {
  return `${row.previous_program || "None"} -> ${row.incoming_program || row.program || "None"}`;
}

function reviewText(row) {
  if (row.reconciliation_status === "shifted_program") {
    return row.review_status === "approved"
      ? "Approved"
      : row.review_status === "rejected"
        ? "Rejected"
        : "Pending review";
  }
  if (row.reconciliation_status === "conflict") return explainConflict(row);
  if (row.reconciliation_status === "invalid") {
    return row.issue_message || "Missing or invalid information.";
  }
  return "Ready";
}

function blankEditForm(row) {
  return {
    student_number: row?.student_number || "",
    first_name: row?.first_name || "",
    last_name: row?.last_name || "",
    email: row?.email || "",
    program: row?.program || "",
    year_level: row?.year_level ? String(row.year_level) : "",
  };
}

function MasterlistReview() {
  const { importId } = useParams();
  const navigate = useNavigate();
  const prompt = usePrompt();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [editingRow, setEditingRow] = useState(null);
  const [editForm, setEditForm] = useState(blankEditForm());

  const loadImport = useCallback(async () => {
    if (!importId) return;
    setLoading(true);
    const { data, error } = await getMasterlistImport(importId);

    if (error || !data) {
      prompt.error(error?.message || "Masterlist review could not be loaded.");
      setPayload(null);
    } else {
      setPayload(data);
    }

    setLoading(false);
  }, [importId, prompt]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadImport();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadImport]);

  const rows = useMemo(() => payload?.rows || [], [payload]);
  const masterlistImport = payload?.import || null;
  const term = masterlistImport?.academic_terms || null;

  const counts = useMemo(() => {
    const nextCounts = {
      all: rows.length,
      new: 0,
      continuing: 0,
      returnee: 0,
      shifted_program: 0,
      conflict: 0,
      invalid: 0,
      blocking: 0,
      approvedProgramChanges: 0,
    };

    rows.forEach((row) => {
      if (Object.prototype.hasOwnProperty.call(nextCounts, row.reconciliation_status)) {
        nextCounts[row.reconciliation_status] += 1;
      }
      if (blockingRow(row)) nextCounts.blocking += 1;
      if (
        row.reconciliation_status === "shifted_program" &&
        row.review_status === "approved"
      ) {
        nextCounts.approvedProgramChanges += 1;
      }
    });

    return nextCounts;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (activeTab === "all") return rows;
    return rows.filter((row) => row.reconciliation_status === activeTab);
  }, [activeTab, rows]);

  const canFinalize =
    masterlistImport?.import_status === "review" && rows.length > 0 && counts.blocking === 0;
  const canMutateRows = masterlistImport?.import_status !== "finalized";
  const pendingProgramChanges = rows.filter(
    (row) =>
      row.reconciliation_status === "shifted_program" &&
      row.review_status === "pending_review",
  ).length;
  const rejectedProgramChanges = rows.filter(
    (row) =>
      row.reconciliation_status === "shifted_program" &&
      row.review_status === "rejected",
  ).length;
  const readinessItems = [
    { label: "identity conflicts", count: counts.conflict },
    { label: "invalid rows", count: counts.invalid },
    { label: "program changes awaiting review", count: pendingProgramChanges },
    { label: "rejected program changes", count: rejectedProgramChanges },
  ].filter((item) => item.count > 0);

  function openEditRow(row) {
    setEditingRow(row);
    setEditForm(blankEditForm(row));
  }

  function closeEditRow() {
    if (actionLoading) return;
    setEditingRow(null);
    setEditForm(blankEditForm());
  }

  function updateEditForm(field, value) {
    setEditForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function duplicateRowNumbers(row) {
    const studentNumber = String(row.student_number || "").trim().toLowerCase();
    if (!studentNumber) return [];
    return rows
      .filter(
        (candidate) =>
          String(candidate.student_number || "").trim().toLowerCase() === studentNumber,
      )
      .map((candidate) => candidate.row_number);
  }

  async function handleSaveIncomingRecord(event) {
    event.preventDefault();
    if (!editingRow || actionLoading) return;

    setActionLoading(true);
    const { data, error } = await updateMasterlistImportRow({
      importId,
      rowId: editingRow.id,
      row: editForm,
    });

    if (error || !data) {
      prompt.error(error?.message || "Incoming record could not be updated.");
      setActionLoading(false);
      return;
    }

    setPayload(data);
    setEditingRow(null);
    setEditForm(blankEditForm());
    prompt.success("Incoming record updated.");
    setActionLoading(false);
  }

  async function handleRemoveRow(row) {
    if (!row || actionLoading) return;
    const confirmed = await prompt.confirm({
      type: "danger",
      title: "Remove Incoming Row",
      message:
        "This removes only the staged CSV row from this import. Existing KANDID students, enrollments, and memberships will not be changed.",
      confirmText: "Remove Row",
    });

    if (!confirmed) return;

    setActionLoading(true);
    const { data, error } = await removeMasterlistImportRow({
      importId,
      rowId: row.id,
    });

    if (error || !data) {
      prompt.error(error?.message || "Incoming row could not be removed.");
      setActionLoading(false);
      return;
    }

    setPayload(data);
    prompt.success("Incoming row removed.");
    setActionLoading(false);
  }

  async function handleProgramChange(row, decision) {
    if (!row.review_fingerprint || actionLoading) return;

    setActionLoading(true);
    const { error } = await reviewMasterlistImportRow({
      rowId: row.id,
      expectedReviewFingerprint: row.review_fingerprint,
      decision,
      note:
        decision === "approve_shifted_program"
          ? "Approved from masterlist review."
          : "Rejected from masterlist review.",
    });

    if (error) {
      prompt.error(error.message || "Program change review failed.");
      setActionLoading(false);
      return;
    }

    prompt.success(
      decision === "approve_shifted_program"
        ? "Program change approved."
        : "Program change rejected.",
    );
    await loadImport();
    setActionLoading(false);
  }

  async function handleFinalize() {
    if (!canFinalize || actionLoading) return;

    setActionLoading(true);
    const { data, error } = await finalizeMasterlistImport(importId);

    if (error || !data) {
      prompt.error(error?.message || "Masterlist could not be finalized.");
      setActionLoading(false);
      return;
    }

    setPayload(data);
    prompt.success("Masterlist finalized.");
    setActionLoading(false);
  }

  if (loading) {
    return (
      <div className="content-section">
        <div className="soft-card">
          <p className="surface-heading font-black">Loading masterlist review...</p>
        </div>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="content-section">
        <div className="soft-card">
          <p className="surface-heading font-black">Masterlist review unavailable.</p>
          <button
            type="button"
            className="secondary-btn mt-4"
            onClick={() => navigate("/super-admin/csv-import")}
          >
            Return to CSV Import
          </button>
        </div>
      </div>
    );
  }

  const finalized = masterlistImport?.import_status === "finalized";

  return (
    <div className="content-section">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="page-kicker">Semester Masterlist</div>
          <h1 className="text-3xl font-black">
            {finalized ? "Masterlist Finalized" : "Masterlist Review"}
          </h1>
          <p className="surface-subcopy mt-1">
            {term ? formatAcademicTerm(term) : "Academic term"} -{" "}
            {masterlistImport?.file_name || "CSV Import"}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link to="/super-admin/csv-import" className="secondary-btn">
            <FileUp size={18} />
            Upload Corrected Masterlist
          </Link>
          <button
            type="button"
            className="secondary-btn"
            onClick={loadImport}
            disabled={actionLoading}
          >
            <RefreshCw size={18} />
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="metric-card">
          <p className="field-label">Total Records</p>
          <h2 className="mt-3 text-4xl font-black">{counts.all}</h2>
        </div>
        <div className="metric-card">
          <p className="field-label">Ready Records</p>
          <h2 className="mt-3 text-4xl font-black text-emerald-600">
            {masterlistImport?.valid_rows || 0}
          </h2>
        </div>
        <div className="metric-card">
          <p className="field-label">Program Changes</p>
          <h2 className="mt-3 text-4xl font-black text-orange-600">
            {counts.shifted_program}
          </h2>
        </div>
        <div className="metric-card">
          <p className="field-label">Blocking Issues</p>
          <h2 className="mt-3 text-4xl font-black text-rose-600">
            {counts.blocking}
          </h2>
        </div>
      </div>

      {finalized ? (
        <div className="soft-card mt-8 border-emerald-200">
          <div className="flex items-start gap-3">
            <CheckCircle className="mt-1 text-emerald-600" size={24} />
            <div>
              <h2 className="surface-heading text-xl font-black">
                Masterlist Finalized
              </h2>
              <p className="surface-subcopy mt-1">
                {counts.all} students processed. {counts.new} new,{" "}
                {counts.continuing} continuing, {counts.returnee} returnees,{" "}
                {counts.approvedProgramChanges} approved program changes.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="soft-card mt-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="surface-heading text-xl font-black">
                Finalization Readiness
              </h2>
              <p className="surface-subcopy mt-1">
                {counts.blocking > 0
                  ? `${counts.blocking} ${counts.blocking === 1 ? "item still requires" : "items still require"} attention.`
                  : "All staged rows are ready for finalization."}
              </p>
              {readinessItems.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                  {readinessItems.map((item) => (
                    <span key={item.label}>
                      {item.count} {item.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="primary-btn disabled:opacity-60"
              onClick={handleFinalize}
              disabled={!canFinalize || actionLoading}
            >
              {actionLoading ? "Working..." : "Finalize Masterlist"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={
              activeTab === tab.key
                ? "rounded-full border border-[#ff5a1f] bg-[#ff5a1f] px-4 py-2 text-sm font-black text-white shadow-sm"
                : "rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-sm font-bold text-slate-600 transition hover:border-orange-200 hover:text-[#ef4e23]"
            }
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            <span className="ml-2">{counts[tab.key] || 0}</span>
          </button>
        ))}
      </div>

      <div className="soft-card mt-6 overflow-hidden p-0">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-[#101322] text-xs font-bold text-white">
              <tr>
                <th className="px-6 py-4">Student</th>
                <th className="px-6 py-4">Program</th>
                <th className="px-6 py-4">Year</th>
                <th className="px-6 py-4">Classification</th>
                <th className="px-6 py-4">Review</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-10 text-center text-slate-500">
                    No rows in this category.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-100 align-middle last:border-b-0"
                  >
                    <td className="px-6 py-6">
                      <p className="font-bold text-[#101322]">{formatName(row)}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {row.student_number || "No Student ID"}{" "}
                        <span className="text-slate-400">#{row.row_number}</span>
                      </p>
                      {row.matched_student && row.reconciliation_status === "conflict" && (
                        <div className="mt-3 space-y-1 text-xs text-slate-600">
                          <p>
                            <span className="font-bold text-rose-700">Existing:</span>{" "}
                            {formatName(row.matched_student)} - {row.matched_student.program || "No program"}
                          </p>
                          <p>
                            <span className="font-bold text-rose-700">Incoming:</span>{" "}
                            {formatName(row)} - {row.program || "No program"} - Year {row.year_level || "None"}
                          </p>
                        </div>
                      )}
                      {!row.matched_student &&
                        row.reconciliation_status === "conflict" &&
                        String(row.issue_message || "").toLowerCase().includes("duplicate") && (
                          <p className="mt-3 text-xs font-medium text-amber-700">
                            Duplicate staged rows: {duplicateRowNumbers(row).join(", ")}
                          </p>
                        )}
                    </td>
                    <td className="px-6 py-6">
                      {row.reconciliation_status === "shifted_program" ? (
                        <span className="font-bold text-orange-700">{programChangeText(row)}</span>
                      ) : (
                        row.program || "None"
                      )}
                    </td>
                    <td className="px-6 py-6">{row.year_level || "None"}</td>
                    <td className="px-6 py-6">
                      <span className={badgeClass(row.reconciliation_status)}>
                        {STATUS_LABELS[row.reconciliation_status] ||
                          row.reconciliation_status}
                      </span>
                    </td>
                    <td className="px-6 py-6">
                      {row.reconciliation_status === "shifted_program" ? (
                        <div className="space-y-2">
                          <p className="font-bold text-slate-800">{programChangeText(row)}</p>
                          <span className={reviewBadgeClass(row.review_status)}>
                            {String(row.review_status || "none").replaceAll("_", " ")}
                          </span>
                          {row.review_note && (
                            <p className="surface-subcopy text-xs">{row.review_note}</p>
                          )}
                        </div>
                      ) : row.reconciliation_status === "conflict" ? (
                        <div className="flex gap-2 text-rose-700">
                          <AlertTriangle size={16} />
                          <span>{explainConflict(row)}</span>
                        </div>
                      ) : row.reconciliation_status === "invalid" ? (
                        <div className="flex gap-2 text-rose-700">
                          <XCircle size={16} />
                          <span>{row.issue_message || "Missing or invalid information."}</span>
                        </div>
                      ) : (
                        <span className="text-slate-500">Ready</span>
                      )}
                    </td>
                    <td className="px-6 py-6 text-right">
                      {row.reconciliation_status === "shifted_program" &&
                      row.review_status === "pending_review" ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            className="rounded-full bg-[#ff5a1f] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                            disabled={actionLoading}
                            onClick={() =>
                              handleProgramChange(row, "approve_shifted_program")
                            }
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-60"
                            disabled={actionLoading}
                            onClick={() =>
                              handleProgramChange(row, "reject_incoming_program")
                            }
                          >
                            Reject
                          </button>
                        </div>
                      ) : canMutateRows &&
                        (row.reconciliation_status === "conflict" ||
                          row.reconciliation_status === "invalid") ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-60"
                            disabled={actionLoading}
                            onClick={() => openEditRow(row)}
                          >
                            <Edit3 size={15} />
                            Edit Incoming
                          </button>
                          <button
                            type="button"
                            className="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-60"
                            disabled={actionLoading}
                            onClick={() => handleRemoveRow(row)}
                          >
                            <Trash2 size={15} />
                            Remove
                          </button>
                        </div>
                      ) : blockingRow(row) ? (
                        <span className="text-sm font-bold text-rose-700">Action required</span>
                      ) : (
                        <span className="text-sm text-slate-400">No action needed</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-slate-100 md:hidden">
          {filteredRows.length === 0 ? (
            <p className="px-5 py-10 text-center text-slate-500">No rows in this category.</p>
          ) : (
            filteredRows.map((row) => (
              <div key={row.id} className="px-5 py-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-[#101322]">{formatName(row)}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {row.student_number || "No Student ID"} #{row.row_number}
                    </p>
                  </div>
                  <span className={badgeClass(row.reconciliation_status)}>
                    {STATUS_LABELS[row.reconciliation_status] ||
                      row.reconciliation_status}
                  </span>
                </div>

                {row.matched_student && row.reconciliation_status === "conflict" && (
                  <div className="mt-4 space-y-1 text-xs text-slate-600">
                    <p>
                      <span className="font-bold text-rose-700">Existing:</span>{" "}
                      {formatName(row.matched_student)} - {row.matched_student.program || "No program"}
                    </p>
                    <p>
                      <span className="font-bold text-rose-700">Incoming:</span>{" "}
                      {formatName(row)} - {row.program || "No program"} - Year {row.year_level || "None"}
                    </p>
                  </div>
                )}

                {!row.matched_student &&
                  row.reconciliation_status === "conflict" &&
                  String(row.issue_message || "").toLowerCase().includes("duplicate") && (
                    <p className="mt-4 text-xs font-medium text-amber-700">
                      Duplicate staged rows: {duplicateRowNumbers(row).join(", ")}
                    </p>
                  )}

                <div className="mt-4 grid gap-3 text-sm">
                  <div>
                    <p className="text-xs font-bold text-slate-400">Program</p>
                    <p className={row.reconciliation_status === "shifted_program" ? "font-bold text-orange-700" : "font-bold text-slate-700"}>
                      {row.reconciliation_status === "shifted_program" ? programChangeText(row) : row.program || "None"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400">Year</p>
                    <p className="font-bold text-slate-700">{row.year_level || "None"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400">Review</p>
                    <p className="text-slate-700">{reviewText(row)}</p>
                    {row.reconciliation_status === "shifted_program" && (
                      <span className={`mt-2 inline-flex ${reviewBadgeClass(row.review_status)}`}>
                        {String(row.review_status || "none").replaceAll("_", " ")}
                      </span>
                    )}
                    {row.review_note && (
                      <p className="surface-subcopy mt-2 text-xs">{row.review_note}</p>
                    )}
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {row.reconciliation_status === "shifted_program" &&
                  row.review_status === "pending_review" ? (
                    <>
                      <button
                        type="button"
                        className="rounded-full bg-[#ff5a1f] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                        disabled={actionLoading}
                        onClick={() => handleProgramChange(row, "approve_shifted_program")}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-60"
                        disabled={actionLoading}
                        onClick={() => handleProgramChange(row, "reject_incoming_program")}
                      >
                        Reject
                      </button>
                    </>
                  ) : canMutateRows &&
                    (row.reconciliation_status === "conflict" ||
                      row.reconciliation_status === "invalid") ? (
                    <>
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-60"
                        disabled={actionLoading}
                        onClick={() => openEditRow(row)}
                      >
                        <Edit3 size={14} />
                        Edit Incoming
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-60"
                        disabled={actionLoading}
                        onClick={() => handleRemoveRow(row)}
                      >
                        <Trash2 size={14} />
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="text-sm text-slate-400">No action needed</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {editingRow && (
        <div className="modal-overlay">
          <div className="modal-card max-w-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="page-kicker">Staged Masterlist Row</p>
                <h2 className="text-2xl font-black">Edit Incoming Record</h2>
                <p className="surface-subcopy mt-1">
                  Updates only this staged CSV row. The central KANDID student
                  record is not edited.
                </p>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={closeEditRow}
                aria-label="Close edit incoming record"
              >
                <XCircle size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveIncomingRecord} className="modal-form-stack">
              <div className="modal-form-grid">
                <label className="block">
                  <span className="field-label">Student ID</span>
                  <input
                    className="input mt-2"
                    value={editForm.student_number}
                    onChange={(event) =>
                      updateEditForm("student_number", event.target.value)
                    }
                    required
                  />
                </label>
                <label className="block">
                  <span className="field-label">Email</span>
                  <input
                    className="input mt-2"
                    type="email"
                    value={editForm.email}
                    onChange={(event) => updateEditForm("email", event.target.value)}
                    required
                  />
                </label>
                <label className="block">
                  <span className="field-label">First Name</span>
                  <input
                    className="input mt-2"
                    value={editForm.first_name}
                    onChange={(event) =>
                      updateEditForm("first_name", event.target.value)
                    }
                    required
                  />
                </label>
                <label className="block">
                  <span className="field-label">Last Name</span>
                  <input
                    className="input mt-2"
                    value={editForm.last_name}
                    onChange={(event) =>
                      updateEditForm("last_name", event.target.value)
                    }
                    required
                  />
                </label>
                <label className="block">
                  <span className="field-label">Program</span>
                  <input
                    className="input mt-2"
                    value={editForm.program}
                    onChange={(event) => updateEditForm("program", event.target.value)}
                    required
                  />
                </label>
                <label className="block">
                  <span className="field-label">Year Level</span>
                  <input
                    className="input mt-2"
                    type="number"
                    min="1"
                    max="6"
                    value={editForm.year_level}
                    onChange={(event) =>
                      updateEditForm("year_level", event.target.value)
                    }
                    required
                  />
                </label>
              </div>

              <div className="config-footer">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={closeEditRow}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={actionLoading}
                >
                  {actionLoading ? "Saving..." : "Save Incoming Record"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default MasterlistReview;
