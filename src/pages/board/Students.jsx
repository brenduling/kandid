import { useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { KandidButtonLoader, KandidInlineLoader } from "../../components/KandidLoader";
import PopupOverlay from "../../components/PopupOverlay";
import { StudentAvatar } from "../../components/KandidImage";
import { usePrompt } from "../../context/PromptContext";
import { readImageFileAsCompressedDataUrl } from "../../utils/files";
import { formatAcademicTerm, getCurrentAcademicTerm } from "../../utils/academicTerms";
import { isSupabaseAdminAuthMode } from "../../utils/auth";
import {
  listBoardStudents,
  listRemovedBoardStudents,
  manuallyEnrollBoardStudent,
  removeBoardStudentParticipation,
  restoreBoardStudentParticipation,
} from "../../utils/boardManualEnrollment";

const PAGE_SIZE = 10;
const REMOVAL_REASONS = [
  "Incorrect organization assignment",
  "Added by mistake",
  "Not eligible for this organization",
  "Administrative correction",
  "Other",
];

function BoardStudents() {
  const prompt = usePrompt();
  const [searchParams] = useSearchParams();
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get("q") || "");
  const [sortBy, setSortBy] = useState("newest");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalStudents, setTotalStudents] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState("active");
  const [removeDialog, setRemoveDialog] = useState(null);
  const [restoreDialog, setRestoreDialog] = useState(null);
  const [removalReason, setRemovalReason] = useState(REMOVAL_REASONS[0]);
  const [customRemovalReason, setCustomRemovalReason] = useState("");
  const [participationSubmitting, setParticipationSubmitting] = useState(false);
  const [activeTerm, setActiveTerm] = useState(null);
  const [activeTermLoading, setActiveTermLoading] = useState(false);
  const [activeTermError, setActiveTermError] = useState("");

  const [form, setForm] = useState({
    student_number: "",
    first_name: "",
    last_name: "",
    email: "",
    photo_url: "",
    program: "",
    year_level: "",
    precinct_code: "",
    batch_code: "",
    status: "pending",
  });

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;
  const orgName = user?.organization_name || user?.organizations?.name || "your organization";
  const latestFetchId = useRef(0);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    let active = true;

    async function loadStudents() {
      const fetchId = latestFetchId.current + 1;
      latestFetchId.current = fetchId;

      const canCommit = () => active && latestFetchId.current === fetchId;

      setLoading(true);
      setLoadError("");

      try {
        const loader = viewMode === "removed" ? listRemovedBoardStudents : listBoardStudents;
        const { data, error } = await loader({
          page: currentPage,
          pageSize: PAGE_SIZE,
          search: debouncedSearch,
          sortBy,
        });

        if (!canCommit()) return;

        if (error) {
          console.error("Failed to load board students:", error);
          setLoadError(error.message || "Unable to load students.");
          setStudents([]);
          setTotalStudents(0);
          return;
        }

        const list = data?.students || [];
        const count = data?.count || 0;

        setStudents(list);
        setTotalStudents(count);
        setActiveTerm(data?.academic_term || null);

        if (list.length === 0 && count > 0 && currentPage > 1) {
          setCurrentPage(Math.max(1, Math.ceil(count / PAGE_SIZE)));
        }
      } catch (error) {
        if (!canCommit()) return;
        console.error("Failed to load board students:", error);
        setLoadError(error.message || "Unable to load students.");
        setStudents([]);
        setTotalStudents(0);
      } finally {
        if (canCommit()) {
          setLoading(false);
        }
      }
    }

    loadStudents();

    return () => {
      active = false;
    };
  }, [currentPage, debouncedSearch, sortBy, viewMode]);

  useEffect(() => {
    if (!formOpen) return;

    let active = true;
    async function loadActiveTerm() {
      setActiveTermLoading(true);
      setActiveTermError("");

      const { data, error, unavailable } = await getCurrentAcademicTerm({ force: true });
      if (!active) return;

      setActiveTerm(data || null);
      if (unavailable) {
        setActiveTermError("Academic term setup is not available yet.");
      } else if (error) {
        setActiveTermError(error.message || "Unable to load the active academic term.");
      } else if (!data) {
        setActiveTermError("No active academic term. Ask a Super Admin to activate a term first.");
      }
      setActiveTermLoading(false);
    }

    loadActiveTerm();

    return () => {
      active = false;
    };
  }, [formOpen]);

  async function fetchStudents() {
    const fetchId = latestFetchId.current + 1;
    latestFetchId.current = fetchId;
    const canCommit = () => latestFetchId.current === fetchId;

    setLoading(true);
    setLoadError("");

    try {
      const loader = viewMode === "removed" ? listRemovedBoardStudents : listBoardStudents;
      const { data, error } = await loader({
        page: currentPage,
        pageSize: PAGE_SIZE,
        search: debouncedSearch,
        sortBy,
      });

      if (!canCommit()) return;

      if (error) {
        console.error("Failed to refresh board students:", error);
        setLoadError(error.message || "Unable to load students.");
        setStudents([]);
        setTotalStudents(0);
        return;
      }

      const list = data?.students || [];
      const count = data?.count || 0;

      setStudents(list);
      setTotalStudents(count);
      setActiveTerm(data?.academic_term || null);
    } catch (error) {
      if (!canCommit()) return;
      console.error("Failed to refresh board students:", error);
      setLoadError(error.message || "Unable to load students.");
      setStudents([]);
      setTotalStudents(0);
    } finally {
      if (canCommit()) {
        setLoading(false);
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (submitting) return;

    if (!orgId) {
      prompt.error("No organization is assigned to this Electoral Board account.");
      return;
    }

    if (!isSupabaseAdminAuthMode()) {
      prompt.error(
        "Manual semester enrollment requires the secure Supabase Auth Electoral Board flow."
      );
      return;
    }

    if (activeTermLoading) {
      prompt.info("Checking the active academic term. Try again in a moment.");
      return;
    }

    if (!activeTerm) {
      prompt.error(activeTermError || "Manual registration requires an active academic term.");
      return;
    }

    setSubmitting(true);

    const {
      createdStudent,
      error: studentError,
      createdOrganizationIds = [],
      existingOrganizationIds = [],
    } = await manuallyEnrollBoardStudent({
      ...form,
      photo_url: form.photo_url || null,
      year_level: Number(form.year_level),
      precinct_code: form.precinct_code || null,
      batch_code: form.batch_code || null,
    });

    if (studentError) {
      console.error("Board student insert failed:", studentError);
      prompt.error(studentError.message || "Failed to add student.");
      setSubmitting(false);
      return;
    }

    const boardOrgId = Number(orgId);
    const boardMembershipAlreadyExisted =
      !createdStudent &&
      existingOrganizationIds.includes(boardOrgId) &&
      !createdOrganizationIds.includes(boardOrgId);

    if (boardMembershipAlreadyExisted) {
      prompt.info("This central student record is already linked to your organization.", "Already a Member");
    } else {
      prompt.success(
        createdStudent
          ? "Student registered and linked to your organization."
          : "Existing student linked to your organization."
      );
    }
    setFormOpen(false);
    setSubmitting(false);
    await fetchStudents();
  }

  async function handlePhotoUpload(file) {
    if (!file) return;

    const dataUrl = await readImageFileAsCompressedDataUrl(file);
    setForm({ ...form, photo_url: dataUrl });
  }

  function studentDisplayName(student) {
    return (
      [student.first_name, student.last_name].filter(Boolean).join(" ") ||
      student.student_number ||
      "this student"
    );
  }

  function handleRemoveMembership(student) {
    if (!orgId || !student?.id) return;
    setRemovalReason(REMOVAL_REASONS[0]);
    setCustomRemovalReason("");
    setRemoveDialog(student);
  }

  async function confirmRemoveMembership() {
    if (!removeDialog?.id || participationSubmitting) return;
    const reason =
      removalReason === "Other" ? customRemovalReason.trim() : removalReason.trim();

    if (!reason) {
      prompt.error("Removal reason is required.");
      return;
    }

    setParticipationSubmitting(true);
    const { data, error } = await removeBoardStudentParticipation({
      studentId: removeDialog.id,
      reason,
    });

    if (error) {
      console.error("Failed to remove board membership:", error);
      prompt.error(error.message || "Failed to remove student participation.");
      setParticipationSubmitting(false);
      return;
    }

    const label = studentDisplayName(removeDialog);
    prompt.success(
      data?.already_applied
        ? `${label} was already removed from ${orgName}.`
        : `${label} removed from ${orgName} for the active term.`,
    );
    setRemoveDialog(null);
    setParticipationSubmitting(false);
    await fetchStudents();
  }

  function handleRestoreMembership(student) {
    if (!orgId || !student?.id) return;
    setRestoreDialog(student);
  }

  async function confirmRestoreMembership() {
    if (!restoreDialog?.id || participationSubmitting) return;

    setParticipationSubmitting(true);
    const { data, error } = await restoreBoardStudentParticipation({
      studentId: restoreDialog.id,
    });

    if (error) {
      console.error("Failed to restore board membership:", error);
      prompt.error(error.message || "Failed to restore student participation.");
      setParticipationSubmitting(false);
      return;
    }

    const label = studentDisplayName(restoreDialog);
    prompt.success(
      data?.already_applied
        ? `${label} was already active in ${orgName}.`
        : `${label} restored to ${orgName} for the active term.`,
    );
    setRestoreDialog(null);
    setParticipationSubmitting(false);
    await fetchStudents();
  }

  const totalPages = Math.max(1, Math.ceil(totalStudents / PAGE_SIZE));
  const pageStart = totalStudents === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, totalStudents);

  return (
    <div className="board-students-desktop">
      <div className="page-head board-students-opening">
        <div className="board-students-opening-copy">
          <div className="page-kicker board-students-kicker">Organization Electorate</div>
          <h1 className="page-title board-students-title">Student registry</h1>
          <p className="page-subtitle">
            Manage student membership records for {orgName}.
          </p>
        </div>

        <div className="board-students-actions">
          <Link to="/board/csv-import" className="secondary-btn board-students-secondary-action">
            Import CSV
          </Link>
          <button
            onClick={() => setFormOpen(true)}
            className="primary-btn board-students-create self-start lg:self-auto"
          >
            <Plus size={18} />
            Add Student
          </button>
        </div>
      </div>

      <section className="board-students-summary" aria-label="Student registry summary">
        <div className="board-students-summary-main">
          <p className="board-students-section-kicker">Registry</p>
          <strong>{totalStudents}</strong>
          <span>{viewMode === "removed" ? "removed records" : "current members"}</span>
        </div>
        <div className="board-students-ledger" aria-label="Registry context">
          <div>
            <span>Organization</span>
            <strong>{orgName}</strong>
          </div>
          <div>
            <span>Academic Term</span>
            <strong>{activeTerm ? formatAcademicTerm(activeTerm) : "Current term"}</strong>
          </div>
        </div>
      </section>

      <section className="board-students-register" aria-label="Student registry">
        <div className="board-students-section-head">
          <div>
            <p className="board-students-section-kicker">Student records</p>
            <h2>{viewMode === "removed" ? "Removed organization members" : "Current organization members"}</h2>
          </div>
          <span>
            Showing {pageStart}-{pageEnd} of {totalStudents}
          </span>
        </div>

        <div className="board-students-toolbar">
          <div className="board-students-view-toggle" aria-label="Student membership view">
            <button
              type="button"
              onClick={() => {
                setViewMode("active");
                setCurrentPage(1);
              }}
              className={viewMode === "active" ? "is-active" : undefined}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("removed");
                setCurrentPage(1);
              }}
              className={viewMode === "removed" ? "is-active" : undefined}
            >
              Removed
            </button>
          </div>
          <div className="search-shell board-students-search">
            <Search size={18} className="text-gray-400" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search student..."
            />
          </div>
          <select
            value={sortBy}
            onChange={(event) => {
              setSortBy(event.target.value);
              setCurrentPage(1);
            }}
            className="field-shell board-students-sort"
          >
            <option value="name_asc">Name: A-Z</option>
            <option value="name_desc">Name: Z-A</option>
            <option value="newest">Newest Added</option>
            <option value="oldest">Oldest Added</option>
            <option value="id_asc">Student ID: Low-High</option>
            <option value="id_desc">Student ID: High-Low</option>
          </select>
        </div>

      <div className="table-shell board-students-table-shell">
        <table className="app-table board-students-table">
          <thead>
            <tr>
              <th>Student ID</th>
              <th>Name</th>
              <th>Program</th>
              <th>Year</th>
              <th>Status</th>
              <th>{viewMode === "removed" ? "Removed Date" : "Date Added"}</th>
              <th className="text-right">Membership</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan="7" className="board-students-state-cell">
                  <KandidInlineLoader message="Loading students..." />
                </td>
              </tr>
            ) : loadError ? (
              <tr>
                <td colSpan="7" className="board-students-state-cell">
                  <div className="mx-auto max-w-md space-y-3">
                    <p className="font-bold text-rose-600">Unable to load students.</p>
                    <p className="text-sm text-gray-500">{loadError}</p>
                    <button type="button" onClick={fetchStudents} className="secondary-btn">
                      Retry
                    </button>
                  </div>
                </td>
              </tr>
            ) : students.length === 0 ? (
              <tr>
                <td colSpan="7" className="board-students-state-cell empty-copy">
                  {debouncedSearch ? "No matching student records found." : "No students found."}
                </td>
              </tr>
            ) : (
              students.map((student) => (
                <tr key={student.id} className="board-student-row">
                  <td className="board-student-number">
                    {student.student_number}
                  </td>
                  <td>
                    <div className="board-student-identity">
                      <StudentAvatar
                        student={student}
                        loading="lazy"
                        className="!h-10 !w-10"
                      />
                      <div>
                        <p className="board-student-name">{student.first_name} {student.last_name}</p>
                        <p className="board-student-email">{student.email}</p>
                      </div>
                    </div>
                  </td>
                  <td>{student.program}</td>
                  <td>{student.year_level}</td>
                  <td>
                    <span className="board-student-status">
                      {student.status}
                    </span>
                  </td>
                  <td className="board-student-date">
                    {(viewMode === "removed" ? student.removed_at : student.created_at)
                      ? new Date(
                          viewMode === "removed" ? student.removed_at : student.created_at,
                        ).toLocaleDateString()
                      : "-"}
                    {viewMode === "removed" && student.removal_reason ? (
                      <p className="board-student-reason">
                        {student.removal_reason}
                      </p>
                    ) : null}
                  </td>
                  <td>
                    <div className="board-student-membership">
                      <span
                        className={`board-student-membership-pill ${
                          student.membership_status === "removed"
                            ? "is-removed"
                            : student.membership_status === "inactive"
                              ? "is-inactive"
                              : "is-active"
                        }`}
                      >
                        {student.membership_status === "removed"
                          ? "Removed"
                          : student.membership_status === "inactive"
                            ? "Inactive"
                            : "Active"}
                      </span>
                      {viewMode === "removed" ? (
                        <button
                          type="button"
                          className="primary-btn board-student-record-action"
                          onClick={() => handleRestoreMembership(student)}
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="danger-btn board-student-record-action"
                          onClick={() => handleRemoveMembership(student)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </section>

      {!loading && !loadError && totalStudents > 0 && (
        <div className="board-students-pagination">
          <p className="font-semibold">
            Showing {pageStart}-{pageEnd} of {totalStudents} students · {PAGE_SIZE} per page
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="secondary-btn min-h-[2.35rem] px-4 text-xs"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            >
              Previous
            </button>
            <span className="rounded-full bg-[#fff4ed] px-3 py-1 text-xs font-black text-[#f4512c]">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              className="secondary-btn min-h-[2.35rem] px-4 text-xs"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {formOpen && (
        <PopupOverlay>
          <div className="popup-sheet popup-sheet-wide">
            <div className="popup-header">
              <div className="popup-header-copy">
                <p className="field-label !mb-3">Student Registry</p>
                <h2 className="surface-title text-[2rem] font-black tracking-tight">Add student</h2>
                <p className="surface-copy mt-2 text-sm leading-6">
                  Add student registry details, organization codes, and profile information in one view.
                </p>
              </div>
              <button type="button" onClick={() => setFormOpen(false)} className="popup-close">
                <Plus size={16} className="rotate-45" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="popup-content">
              <div
                className={`rounded-[1.35rem] border px-4 py-3 text-sm font-semibold ${
                  activeTerm
                    ? "border-[#ffd7c9] bg-[#fff4ed] text-[#c2410c]"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                }`}
              >
                {activeTermLoading
                  ? "Checking active academic term..."
                  : activeTerm
                    ? `Active term: ${formatAcademicTerm(activeTerm)}`
                    : activeTermError || "Manual registration requires an active academic term."}
              </div>
              <div className="popup-form-grid">
              <div className="popup-form-grid-compact">
              <div>
                <label className="field-label">Student ID</label>
                <input required placeholder="Student ID" value={form.student_number} onChange={(e) => setForm({ ...form, student_number: e.target.value })} className="field-shell w-full" />
              </div>
              <div>
                <label className="field-label">Email</label>
                <input required placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="field-shell w-full" />
              </div>
              <div>
                <label className="field-label">First Name</label>
                <input required placeholder="First Name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className="field-shell w-full" />
              </div>
              <div>
                <label className="field-label">Last Name</label>
                <input required placeholder="Last Name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className="field-shell w-full" />
              </div>
              <div>
                <label className="field-label">Program</label>
                <input required placeholder="Program" value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} className="field-shell w-full" />
              </div>
              <div>
                <label className="field-label">Precinct Code</label>
                <input placeholder="Precinct Code optional" value={form.precinct_code} onChange={(e) => setForm({ ...form, precinct_code: e.target.value })} className="field-shell w-full" />
              </div>
              <div>
                <label className="field-label">Batch Code</label>
                <input placeholder="Batch Code optional" value={form.batch_code} onChange={(e) => setForm({ ...form, batch_code: e.target.value })} className="field-shell w-full" />
              </div>
              <div>
                <label className="field-label">Year Level</label>
                <input required type="number" placeholder="Year Level" value={form.year_level} onChange={(e) => setForm({ ...form, year_level: e.target.value })} className="field-shell w-full" />
              </div>
              </div>

              <div className="space-y-4">
              <div className="popup-side-panel">
                <label className="field-label">Photo URL</label>
                <input placeholder="Photo URL optional" value={form.photo_url} onChange={(e) => setForm({ ...form, photo_url: e.target.value })} className="field-shell w-full" />
              </div>
              <div className="popup-side-panel">
                <p className="mb-3 text-sm font-bold text-[#1d262f]">Student Photo</p>
                <div className="flex items-center gap-4">
                  {form.photo_url ? (
                    <img src={form.photo_url} alt="Student preview" className="h-16 w-16 rounded-2xl object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(47,143,131,0.12)] text-xs font-black text-[#2f8f83]">
                      PHOTO
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handlePhotoUpload(e.target.files?.[0])}
                    className="text-sm text-[#5a5548]"
                  />
                </div>
              </div>
              </div>
              </div>

              <div className="popup-actions">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="secondary-btn"
                >
                  Cancel
                </button>

                <button className="primary-btn min-w-52" disabled={submitting}>
                  {submitting ? <KandidButtonLoader label="Saving..." /> : "Save Student"}
                </button>
              </div>
            </form>
          </div>
        </PopupOverlay>
      )}

      {removeDialog && (
        <PopupOverlay>
          <div className="popup-sheet max-w-2xl">
            <div className="popup-header">
              <div>
                <p className="field-label !mb-3">Current-Term Participation</p>
                <h2 className="surface-title text-[2rem] font-black tracking-tight">
                  Remove student
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setRemoveDialog(null)}
                className="popup-close"
                disabled={participationSubmitting}
              >
                <Plus size={16} className="rotate-45" />
              </button>
            </div>

            <div className="popup-content">
              <div className="rounded-[1.35rem] border border-[#e7edf3] bg-white p-4">
                <div className="flex items-center gap-3">
                  <StudentAvatar student={removeDialog} className="!h-12 !w-12" />
                  <div>
                    <p className="font-black text-[#111827]">{studentDisplayName(removeDialog)}</p>
                    <p className="text-sm font-semibold text-[#667085]">
                      {removeDialog.student_number}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <p><span className="font-bold text-[#667085]">Organization:</span> {orgName}</p>
                  <p><span className="font-bold text-[#667085]">Academic Term:</span> {formatAcademicTerm(activeTerm)}</p>
                  <p><span className="font-bold text-[#667085]">Program:</span> {removeDialog.program || "Unspecified"}</p>
                  <p><span className="font-bold text-[#667085]">Year Level:</span> {removeDialog.year_level || "Unspecified"}</p>
                </div>
              </div>

              <div>
                <label className="field-label">Removal Reason</label>
                <select
                  value={removalReason}
                  onChange={(event) => setRemovalReason(event.target.value)}
                  className="field-shell w-full"
                >
                  {REMOVAL_REASONS.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
              </div>

              {removalReason === "Other" && (
                <div>
                  <label className="field-label">Custom Reason</label>
                  <textarea
                    required
                    value={customRemovalReason}
                    onChange={(event) => setCustomRemovalReason(event.target.value)}
                    placeholder="Enter the removal reason"
                    className="field-shell min-h-28 w-full resize-y"
                  />
                </div>
              )}

              <div className="rounded-[1.35rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                <p className="font-black">This action removes the student's participation from this organization for the current academic term.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <p>Student account: <span className="font-black">UNCHANGED</span></p>
                  <p>Program: <span className="font-black">UNCHANGED</span></p>
                  <p>University enrollment: <span className="font-black">UNCHANGED</span></p>
                  <p>Historical records: <span className="font-black">PRESERVED</span></p>
                  <p>Current organization participation: <span className="font-black">REMOVED</span></p>
                  <p>Current election eligibility: <span className="font-black">REMOVED</span></p>
                </div>
              </div>

              <div className="popup-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setRemoveDialog(null)}
                  disabled={participationSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-btn min-w-48"
                  onClick={confirmRemoveMembership}
                  disabled={participationSubmitting}
                >
                  {participationSubmitting ? <KandidButtonLoader label="Removing..." /> : "Confirm Removal"}
                </button>
              </div>
            </div>
          </div>
        </PopupOverlay>
      )}

      {restoreDialog && (
        <PopupOverlay>
          <div className="popup-sheet max-w-2xl">
            <div className="popup-header">
              <div>
                <p className="field-label !mb-3">Current-Term Participation</p>
                <h2 className="surface-title text-[2rem] font-black tracking-tight">
                  Restore student
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setRestoreDialog(null)}
                className="popup-close"
                disabled={participationSubmitting}
              >
                <Plus size={16} className="rotate-45" />
              </button>
            </div>

            <div className="popup-content">
              <div className="rounded-[1.35rem] border border-[#e7edf3] bg-white p-4">
                <div className="flex items-center gap-3">
                  <StudentAvatar student={restoreDialog} className="!h-12 !w-12" />
                  <div>
                    <p className="font-black text-[#111827]">{studentDisplayName(restoreDialog)}</p>
                    <p className="text-sm font-semibold text-[#667085]">
                      {restoreDialog.student_number}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <p><span className="font-bold text-[#667085]">Organization:</span> {orgName}</p>
                  <p><span className="font-bold text-[#667085]">Academic Term:</span> {formatAcademicTerm(activeTerm)}</p>
                  <p><span className="font-bold text-[#667085]">Previous Reason:</span> {restoreDialog.removal_reason || "-"}</p>
                  <p><span className="font-bold text-[#667085]">Removed Date:</span> {restoreDialog.removed_at ? new Date(restoreDialog.removed_at).toLocaleString() : "-"}</p>
                </div>
              </div>

              <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                Restoring this student will make them eligible to participate in applicable current-term organization elections again.
              </div>

              <div className="popup-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setRestoreDialog(null)}
                  disabled={participationSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-btn min-w-48"
                  onClick={confirmRestoreMembership}
                  disabled={participationSubmitting}
                >
                  {participationSubmitting ? <KandidButtonLoader label="Restoring..." /> : "Confirm Restore"}
                </button>
              </div>
            </div>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default BoardStudents;
