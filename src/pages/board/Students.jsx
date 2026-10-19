import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, MoreHorizontal, Plus, Search, Upload } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { KandidButtonLoader } from "../../components/KandidLoader";
import PopupOverlay from "../../components/PopupOverlay";
import { StudentAvatar } from "../../components/KandidImage";
import { usePrompt } from "../../context/PromptContext";
import { toBoardFacingError } from "../../utils/boardFeedback";
import { boardStudentMutationFailureMessage, validateBoardStudentRemoval } from "../../utils/boardStudentMutationFeedback";
import { formatAcademicTerm, getCurrentAcademicTerm } from "../../utils/academicTerms";
import { getCurrentAdminProfile } from "../../utils/auth";
import {
  listBoardStudents,
  listRemovedBoardStudents,
  removeBoardStudentParticipation,
  restoreBoardStudentParticipation,
  updateBoardStudentNames,
} from "../../utils/boardManualEnrollment";
import BoardStudentRegistration from "./BoardStudentRegistration";
import "./Students.css";

const PAGE_SIZE = 10;
const REMOVAL_REASONS = [
  "Incorrect organization assignment",
  "Added by mistake",
  "Not eligible for this organization",
  "Administrative correction",
  "Other",
];

function BoardStudentMobileActions({ studentId, studentName, isRemoved, canManageParticipation, onEdit, onRemove, onRestore }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const firstItemRef = useRef(null);
  const menuId = `board-student-actions-${studentId}`;

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    firstItemRef.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (isRemoved && !canManageParticipation) return null;

  function handleMenuKeyDown(event) {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...(rootRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  return (
    <div className="board-student-mobile-actions" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="board-student-mobile-actions-trigger"
        aria-label={`Actions for ${studentName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <MoreHorizontal size={20} aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={menuId}
          className="board-student-mobile-actions-menu"
          role="menu"
          aria-label={`Membership actions for ${studentName}`}
          onKeyDown={handleMenuKeyDown}
        >
          {isRemoved ? (
            <button ref={firstItemRef} type="button" role="menuitem" onClick={() => { setOpen(false); onRestore(); }}>
              Restore membership
            </button>
          ) : (
            <>
              <button ref={firstItemRef} type="button" role="menuitem" onClick={() => { setOpen(false); onEdit(); }}>
                Edit student
              </button>
              <button type="button" role="menuitem" onClick={() => { setOpen(false); onRemove(); }}>
                Remove membership
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

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
  const [viewMode, setViewMode] = useState("active");
  const [removeDialog, setRemoveDialog] = useState(null);
  const [restoreDialog, setRestoreDialog] = useState(null);
  const [editingStudent, setEditingStudent] = useState(null);
  const [editNames, setEditNames] = useState({ first_name: "", last_name: "" });
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState("");
  const [removalReason, setRemovalReason] = useState(REMOVAL_REASONS[0]);
  const [customRemovalReason, setCustomRemovalReason] = useState("");
  const [removeConfirmId, setRemoveConfirmId] = useState("");
  const [removePassword, setRemovePassword] = useState("");
  const [removePasswordVisible, setRemovePasswordVisible] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [participationSubmitting, setParticipationSubmitting] = useState(false);
  const [activeTerm, setActiveTerm] = useState(null);
  const [activeTermLoading, setActiveTermLoading] = useState(false);
  const [activeTermError, setActiveTermError] = useState("");

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;
  const orgName = user?.organization_name || user?.organizations?.name || "your organization";
  const [organizationType, setOrganizationType] = useState(null);
  const [membershipScope, setMembershipScope] = useState(null);
  const [organizationContextLoadedFor, setOrganizationContextLoadedFor] = useState(null);
  const organizationContextLoading = organizationContextLoadedFor !== String(orgId);
  // Display-only: gives the password field a correctly paired username for browser
  // password managers so they never treat an unrelated page field as the username.
  const boardAccountEmail = user?.email || "";
  const latestFetchId = useRef(0);

  useEffect(() => {
    let active = true;
    getCurrentAdminProfile({ force: true }).then(({ data }) => {
      if (!active) return;
      const sameAssignedOrganization = Number(data?.organization_id) === Number(orgId);
      const isActiveBoard = data?.role === "electoral_board" && data?.status === "active";
      setOrganizationType(
        sameAssignedOrganization && isActiveBoard
          ? data?.organizations?.organization_type || null
          : null,
      );
      setMembershipScope(
        sameAssignedOrganization && isActiveBoard
          ? data?.organizations?.membership_scope || null
          : null,
      );
    }).catch(() => {
      if (active) {
        setOrganizationType(null);
        setMembershipScope(null);
      }
    }).finally(() => {
      if (active) setOrganizationContextLoadedFor(String(orgId));
    });
    return () => { active = false; };
  }, [orgId]);

  const canManageManualMembership = membershipScope === "manual";

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
          setLoadError(toBoardFacingError(error.message, "Unable to load students."));
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
        setLoadError(toBoardFacingError(error.message, "Unable to load students."));
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
        setActiveTermError(toBoardFacingError(error.message, "Unable to load the active academic term."));
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
        setLoadError(toBoardFacingError(error.message, "Unable to load students."));
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
      setLoadError(toBoardFacingError(error.message, "Unable to load students."));
      setStudents([]);
      setTotalStudents(0);
    } finally {
      if (canCommit()) {
        setLoading(false);
      }
    }
  }

  function studentDisplayName(student) {
    return (
      [student.first_name, student.last_name].filter(Boolean).join(" ") ||
      student.student_number ||
      "this student"
    );
  }

  function openEditStudent(student) {
    if (!orgId || viewMode !== "active" || !student?.id) return;
    setEditNames({ first_name: student.first_name || "", last_name: student.last_name || "" });
    setEditError("");
    setEditingStudent(student);
  }

  async function saveEditedStudent(event) {
    event.preventDefault();
    if (!editingStudent?.id || editSubmitting) return;

    const firstName = editNames.first_name.trim();
    const lastName = editNames.last_name.trim();
    if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
      setEditError("First and last name must each be 1–100 characters.");
      return;
    }

    setEditSubmitting(true);
    setEditError("");
    try {
      const { data, error } = await updateBoardStudentNames({
        studentId: editingStudent.id,
        firstName,
        lastName,
      });
      if (error) {
        setEditError(boardStudentMutationFailureMessage(error, "edit"));
        return;
      }
      if (!data?.id || String(data.id) !== String(editingStudent.id)) {
        setEditError("The server did not confirm the student update. No success was recorded.");
        return;
      }

      setEditingStudent(null);
      prompt.success("Student record updated.");
      await fetchStudents();
    } catch (error) {
      setEditError(boardStudentMutationFailureMessage(error, "edit"));
    } finally {
      setEditSubmitting(false);
    }
  }

  // The password is ephemeral: it is dropped on open, cancel, close, success and failure
  // so it is never retained in component state or in a reopened dialog.
  function resetRemoveReauthentication() {
    setRemoveConfirmId("");
    setRemovePassword("");
    setRemovePasswordVisible(false);
    setRemoveError("");
  }

  function handleRemoveMembership(student) {
    if (!orgId || !student?.id) return;
    setRemovalReason(REMOVAL_REASONS[0]);
    setCustomRemovalReason("");
    resetRemoveReauthentication();
    setRemoveDialog(student);
  }

  function closeRemoveDialog() {
    resetRemoveReauthentication();
    setRemoveDialog(null);
  }

  // Server codes only select a specific safe sentence; they never decide authorization.
  function removeFailureMessage(error) {
    switch (error?.code) {
      case "session_invalid":
        return "Your session needs to be refreshed. Sign in again before removing this student.";
      case "board_forbidden":
      case "target_out_of_scope":
        return "You no longer have permission to manage this organization.";
      case "password_invalid":
        return "Your password could not be verified.";
      case "student_id_mismatch":
        return "The Student ID does not match the selected student.";
      case "confirmation_required":
        return "Enter the student's ID to confirm this removal.";
      default:
        return boardStudentMutationFailureMessage(error, "remove");
    }
  }

  async function confirmRemoveMembership() {
    if (!removeDialog?.id || participationSubmitting) return;
    const reason =
      removalReason === "Other" ? customRemovalReason.trim() : removalReason.trim();

    const validationMessage = validateBoardStudentRemoval({
      studentNumber: removeDialog.student_number,
      confirmStudentNumber: removeConfirmId,
      password: removePassword,
      reason,
      selectedReason: removalReason,
      customReason: customRemovalReason,
    });
    if (validationMessage) {
      setRemoveError(validationMessage);
      return;
    }

    setRemoveError("");
    setParticipationSubmitting(true);
    try {
      const { data, error } = await removeBoardStudentParticipation({
        studentId: removeDialog.id,
        reason,
        confirmStudentNumber: removeConfirmId.trim(),
        password: removePassword,
      });

      if (error) {
        setRemoveError(removeFailureMessage(error));
        return;
      }
      if (!data?.result) {
        setRemoveError("The server did not confirm the membership removal. No success was recorded.");
        return;
      }

      const label = studentDisplayName(removeDialog);
      prompt.success(
        data?.already_applied
          ? `${label} was already removed from ${orgName}.`
          : `${label} removed from ${orgName} for the active term.`,
      );
      resetRemoveReauthentication();
      setRemoveDialog(null);
    } catch (error) {
      // Do not log this error: the request context can contain reauthentication input.
      setRemoveError(removeFailureMessage(error));
    } finally {
      setRemovePassword("");
      setParticipationSubmitting(false);
    }
    await fetchStudents();
  }

  function handleRestoreMembership(student) {
    if (!orgId || !student?.id) return;
    setRestoreDialog(student);
  }

  async function confirmRestoreMembership() {
    if (!restoreDialog?.id || participationSubmitting) return;

    setParticipationSubmitting(true);
    try {
      const { data, error } = await restoreBoardStudentParticipation({
        studentId: restoreDialog.id,
      });

      if (error) {
        prompt.error(boardStudentMutationFailureMessage(error, "restore"));
        return;
      }
      if (!data?.result) {
        prompt.error("The server did not confirm the membership restoration. No success was recorded.");
        return;
      }

      const label = studentDisplayName(restoreDialog);
      prompt.success(
        data.already_applied
          ? `${label} was already active in ${orgName}.`
          : `${label} restored to ${orgName} for the active term.`,
      );
      setRestoreDialog(null);
      await fetchStudents();
    } catch (error) {
      prompt.error(boardStudentMutationFailureMessage(error, "restore"));
    } finally {
      setParticipationSubmitting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalStudents / PAGE_SIZE));
  const pageStart = totalStudents === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, totalStudents);

  function renderStudentRecord(student, position) {
    const rowIndex = String((currentPage - 1) * PAGE_SIZE + position + 1).padStart(2, "0");

    const membershipKey =
      student.membership_status === "removed"
        ? "removed"
        : student.membership_status === "inactive"
          ? "inactive"
          : "active";

    const membershipLabel =
      membershipKey === "removed" ? "Removed" : membershipKey === "inactive" ? "Inactive" : "Active";

    const statusKey =
      student.status === "active"
        ? "active"
        : student.status === "disabled"
          ? "disabled"
          : "pending";

    // "pending" means the student still has to finish Kandid account setup.
    // Spell that out so it never reads as a contradiction beside an active
    // membership. The underlying students.status value is unchanged and stays
    // available on the title attribute.
    const accountLabel =
      statusKey === "pending"
        ? "Pending setup"
        : statusKey === "active"
          ? "Active account"
          : "Disabled account";

    // Mobile-only shorthand for the same account state. Display copy only: the
    // stored students.status value, the status logic and the desktop wording are
    // all unchanged, and the underlying value stays on the title attribute.
    const accountLabelCompact =
      statusKey === "pending" ? "Setup" : statusKey === "active" ? "Ready" : "Disabled";

    const recordDate = viewMode === "removed" ? student.removed_at : student.created_at;

    return (
      <article key={student.id} className={`board-student-record is-${membershipKey}`}>
        <div className="board-student-desktop-record">
        <div className="board-student-person">
          <span className="board-student-index" aria-hidden="true">
            {rowIndex}
          </span>
          <div className="board-student-person-copy">
            <h3>{studentDisplayName(student)}</h3>
            <p className="board-student-number">{student.student_number}</p>
            <p className="board-student-email">{student.email}</p>
          </div>
        </div>

        <div className="board-student-academic">
          <div className="board-student-academic-main">
            <span>Program</span>
            <strong>{student.program || "Unspecified"}</strong>
          </div>
          <p className="board-student-academic-meta">
            <span>Year {student.year_level || "--"}</span>
            <span className="board-student-meta-divider" />
            <span>
              {viewMode === "removed" ? "Removed" : "Added"}{" "}
              {recordDate ? new Date(recordDate).toLocaleDateString() : "--"}
            </span>
          </p>
        </div>

        <div className="board-student-standing">
          <span
            className={`board-student-account is-${statusKey}`}
            title={`Account — students.status: ${student.status}`}
          >
            <span className="board-student-account-full">{accountLabel}</span>
            <span className="board-student-account-compact">{accountLabelCompact}</span>
          </span>
          <span
            className="board-student-membership-line"
            title={`Term membership: ${membershipLabel}`}
          >
            Member <span aria-hidden="true">·</span>{" "}
            <span className={`board-student-membership-state is-${membershipKey}`}>
              {membershipLabel}
            </span>
          </span>
        </div>

        <div className="board-student-record-actions">
          {viewMode === "removed" ? (
            canManageManualMembership ? (
              <button
                type="button"
                className="board-student-record-action is-restore"
                onClick={() => handleRestoreMembership(student)}
              >
                Restore
              </button>
            ) : (
              <span className="board-student-record-action is-managed" aria-label="Membership managed by current-term eligibility">
                Managed by term eligibility
              </span>
            )
          ) : (
            <div className="board-student-action-group">
              <button
                type="button"
                className="board-student-record-action is-quiet"
                onClick={() => openEditStudent(student)}
                aria-label={`Edit ${studentDisplayName(student)}`}
              >
                Edit
              </button>
              {canManageManualMembership ? (
                <button
                  type="button"
                  className="board-student-record-action is-remove"
                  onClick={() => handleRemoveMembership(student)}
                  aria-label={`Remove ${studentDisplayName(student)} from ${orgName}`}
                >
                  Remove
                </button>
              ) : null}
            </div>
          )}
          {viewMode === "removed" && student.removal_reason ? (
            <p className="board-student-reason">{student.removal_reason}</p>
          ) : null}
        </div>
        </div>

        <div className="board-student-mobile-record">
          <span className="board-student-mobile-index" aria-hidden="true">{rowIndex}</span>
          <StudentAvatar student={student} className="board-student-mobile-avatar" loading="lazy" />
          <div className="board-student-mobile-content">
            <strong className="board-student-mobile-name">{studentDisplayName(student)}</strong>
            <span className="board-student-mobile-meta">
              {student.student_number || "Student ID not recorded"}
              <span aria-hidden="true"> · </span>
              {student.program || "Unspecified"}
              <span aria-hidden="true"> · </span>
              {student.year_level ? `Year ${student.year_level}` : "Year not recorded"}
              <span aria-hidden="true"> · </span>
              <span className={`board-student-mobile-membership is-${membershipKey}`}>
                <span className="board-student-mobile-membership-mark" aria-hidden="true" />
                {membershipLabel}
              </span>
            </span>
            <span className="board-student-mobile-email" title={student.email || "Email not recorded"}>
              {student.email || "Email not recorded"}
              {statusKey !== "active" ? (
                <span className={`board-student-mobile-account is-${statusKey}`}>
                  <span aria-hidden="true"> · </span>{accountLabel}
                </span>
              ) : null}
            </span>
            {viewMode === "removed" && student.removal_reason ? (
              <span className="board-student-mobile-reason">Removal reason: {student.removal_reason}</span>
            ) : null}
          </div>
          <div className="board-student-mobile-actions-slot">
            <BoardStudentMobileActions
              studentId={student.id}
              studentName={studentDisplayName(student)}
              isRemoved={membershipKey === "removed"}
              canManageParticipation={canManageManualMembership}
              onEdit={() => openEditStudent(student)}
              onRemove={() => handleRemoveMembership(student)}
              onRestore={() => handleRestoreMembership(student)}
            />
          </div>
        </div>
      </article>
    );
  }


  return (
    <div className="board-students-desktop">
      <header className="board-students-masthead">
        <div className="board-students-context">
          <span className="board-students-eyebrow">Electoral Board / {orgName}</span>
          <span className="board-students-context-rule" aria-hidden="true" />
        </div>

        <div className="board-students-baseline">
          <h1 className="page-title board-students-title">Students</h1>
          <div className="board-students-actions">
            <Link to="/board/csv-import" className="board-students-action is-import">
              <Upload size={15} aria-hidden="true" />
              Import CSV
            </Link>
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="board-students-action is-create"
              disabled={organizationContextLoading}
              aria-busy={organizationContextLoading}
            >
              <Plus size={15} aria-hidden="true" />
              {organizationContextLoading ? "Checking organization..." : "Add Student"}
            </button>
          </div>
        </div>

        <p className="board-students-standfirst">
          Current-term student registry for {orgName}.
        </p>
      </header>


      <section className="board-students-register" aria-label="Student registry">
        <div className="board-students-section-head">
          <div>
            <p className="board-students-section-kicker">
              {viewMode === "removed" ? "Removed records" : "Student records"}
            </p>
            <h2>{viewMode === "removed" ? "Removed organization members" : "Current organization members"}</h2>
          </div>
          <div className="board-students-register-meta">
            <span className="board-students-register-term">
              {activeTerm ? formatAcademicTerm(activeTerm) : "Current term"}
            </span>
            <span className="board-students-register-count">
              <strong>{totalStudents}</strong> {viewMode === "removed" ? "records" : "members"}
            </span>
          </div>
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
          <div className="board-students-controls">
            <div className="search-shell board-students-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search name, student ID, or email"
                aria-label="Search students"
                autoComplete="off"
                spellCheck="false"
              />
            </div>
            <label className="board-students-sort-field">
              <span>Sort</span>
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
            </label>
          </div>
        </div>


        <div className="board-students-register-head" aria-hidden="true">
          <span>Student</span>
          <span>Academic information</span>
          <span>Status</span>
          <span className="board-students-head-actions">Actions</span>
        </div>

        <div className="board-students-list">
          {loading ? (
            <div className="board-students-skeleton" aria-live="polite">
              {[0, 1, 2, 3, 4].map((row) => (
                <div className="board-student-record is-skeleton" key={`board-student-skeleton-${row}`}>
                  <div className="board-student-skeleton-cell is-identity">
                    <span className="board-student-skeleton-bar is-index" />
                    <span className="board-student-skeleton-bar is-name" />
                  </div>
                  <div className="board-student-skeleton-cell">
                    <span className="board-student-skeleton-bar is-medium" />
                    <span className="board-student-skeleton-bar is-short" />
                  </div>
                  <div className="board-student-skeleton-cell">
                    <span className="board-student-skeleton-bar is-medium" />
                    <span className="board-student-skeleton-bar is-short" />
                  </div>
                  <div className="board-student-skeleton-cell is-actions">
                    <span className="board-student-skeleton-bar is-action" />
                  </div>
                </div>
              ))}
              <span className="board-students-skeleton-note">Loading students...</span>
            </div>
          ) : loadError ? (
            <div className="board-students-state is-error" role="alert">
              <p className="board-students-state-kicker">Registry unavailable</p>
              <h3>Unable to load the student registry.</h3>
              <p className="board-students-state-copy">
                The register could not be retrieved for {orgName}. Check your connection and try again.
              </p>
              <button type="button" onClick={fetchStudents} className="secondary-btn board-students-state-action">
                Retry
              </button>
            </div>
          ) : students.length === 0 ? (
            <div className="board-students-state">
              <p className="board-students-state-kicker">
                {debouncedSearch ? "No matches" : viewMode === "removed" ? "No history" : "Empty registry"}
              </p>
              {debouncedSearch ? (
                <>
                  <h3>No students match &ldquo;{debouncedSearch}&rdquo;.</h3>
                  <p className="board-students-state-copy">
                    {totalStudents === 0
                      ? `There are no ${viewMode === "removed" ? "removed" : ""} student records for ${orgName} to search.`
                      : "Try a different name, student ID, or email, or switch the register view."}
                  </p>
                </>
              ) : viewMode === "removed" ? (
                <>
                  <h3>No removed members.</h3>
                  <p className="board-students-state-copy">
                    Students removed from {orgName} will be listed here with their removal reason.
                  </p>
                </>
              ) : (
                <>
                  <h3>No students registered yet.</h3>
                  <p className="board-students-state-copy">
                    {organizationType === "non_departmental"
                      ? `Add currently enrolled students, or preview an eligible CSV roster for ${orgName}.`
                      : `Add a student manually or import a CSV roster to build the ${orgName} registry.`}
                  </p>
                </>
              )}
            </div>
          ) : (
            students.map((student, position) => renderStudentRecord(student, position))
          )}
        </div>
      </section>


      {!loading && !loadError && totalStudents > 0 && (
        <div className="board-students-pagination">
          <p className="board-students-pagination-count">
            Showing <strong>{pageStart}</strong>&ndash;<strong>{pageEnd}</strong> of{" "}
            <strong>{totalStudents}</strong> {viewMode === "removed" ? "records" : "members"}
          </p>
          <div className="board-students-pagination-controls">
            <button
              type="button"
              className="board-student-record-action is-quiet"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            >
              Previous
            </button>
            <span className="board-students-page-indicator">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              className="board-student-record-action is-quiet"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            >
              Next
            </button>
          </div>
        </div>
      )}


      {formOpen && (
        <BoardStudentRegistration
          orgId={orgId}
          orgName={orgName}
          organizationType={organizationType}
          activeTerm={activeTerm}
          activeTermLoading={activeTermLoading}
          activeTermError={activeTermError}
          onClose={() => setFormOpen(false)}
          onRegistered={async () => {
            setFormOpen(false);
            prompt.success(`Student registered to ${orgName}.`);
            await fetchStudents();
          }}
          onShowRemoved={() => {
            setFormOpen(false);
            setViewMode("removed");
            setCurrentPage(1);
          }}
        />
      )}


      {editingStudent && (
        <PopupOverlay>
          <div className="popup-sheet board-registry-sheet" role="dialog" aria-modal="true" aria-labelledby="board-student-edit-title">
            <div className="popup-header">
              <div className="popup-header-copy">
                <p className="board-registry-kicker">Central student record</p>
                <h2 id="board-student-edit-title" className="surface-title">Edit student</h2>
                <p className="surface-copy">Correct this student’s name in the central record.</p>
              </div>
              <button type="button" className="popup-close" onClick={() => setEditingStudent(null)} disabled={editSubmitting} aria-label="Close edit student">
                <Plus size={16} className="rotate-45" aria-hidden="true" />
              </button>
            </div>
            <form className="popup-content" onSubmit={saveEditedStudent}>
              <div className="board-registry-fields">
                <div className="board-registry-field">
                  <label htmlFor="board-student-edit-first">First name</label>
                  <input id="board-student-edit-first" required maxLength={100} autoComplete="given-name" value={editNames.first_name} onChange={(event) => setEditNames((current) => ({ ...current, first_name: event.target.value }))} />
                </div>
                <div className="board-registry-field">
                  <label htmlFor="board-student-edit-last">Last name</label>
                  <input id="board-student-edit-last" required maxLength={100} autoComplete="family-name" value={editNames.last_name} onChange={(event) => setEditNames((current) => ({ ...current, last_name: event.target.value }))} />
                </div>
              </div>

              <section className="board-registry-section">
                <p className="board-registry-kicker">Record context · read only</p>
                <dl className="board-registry-context">
                  <div><dt>Student ID</dt><dd>{editingStudent.student_number}</dd></div>
                  <div><dt>Email</dt><dd>{editingStudent.email}</dd></div>
                  <div><dt>Current term</dt><dd>{formatAcademicTerm(activeTerm)}</dd></div>
                  <div><dt>Program · Year</dt><dd>{editingStudent.program || "Unspecified"} · {editingStudent.year_level || "--"}</dd></div>
                  <div><dt>Account</dt><dd>{editingStudent.status === "pending" ? "Pending setup" : editingStudent.status}</dd></div>
                  <div><dt>{orgName} membership</dt><dd className="is-muted">Active · managed separately</dd></div>
                </dl>
              </section>

              {editError ? <p className="board-registry-error" role="alert">{editError}</p> : null}

              <div className="popup-actions board-registry-actions">
                <button type="button" className="secondary-btn" onClick={() => setEditingStudent(null)} disabled={editSubmitting}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={editSubmitting}>
                  {editSubmitting ? <KandidButtonLoader label="Saving student..." /> : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </PopupOverlay>
      )}

      {removeDialog && (
        <PopupOverlay>
          <div className="popup-sheet board-registry-sheet is-danger" role="dialog" aria-modal="true" aria-labelledby="board-student-remove-title">
            <div className="popup-header">
              <div className="popup-header-copy">
                <p className="board-registry-kicker">Student registry · {orgName}</p>
                <h2 id="board-student-remove-title" className="surface-title">Remove student from {orgName}?</h2>
                <p className="surface-copy">
                  This will remove {studentDisplayName(removeDialog)} from {orgName} participation for the current academic term.
                </p>
              </div>
              <button type="button" className="popup-close" onClick={closeRemoveDialog} disabled={participationSubmitting} aria-label="Close remove student">
                <Plus size={16} className="rotate-45" aria-hidden="true" />
              </button>
            </div>

            <div className="popup-content">
              <div className="board-registry-identity">
                <p className="board-registry-identity-name">{studentDisplayName(removeDialog)}</p>
                <p className="board-registry-identity-meta">{removeDialog.student_number}</p>
              </div>

              <dl className="board-registry-context">
                <div><dt>Organization</dt><dd>{orgName}</dd></div>
                <div><dt>Academic term</dt><dd>{formatAcademicTerm(activeTerm)}</dd></div>
                <div><dt>Program</dt><dd>{removeDialog.program || "Unspecified"}</dd></div>
                <div><dt>Year level</dt><dd>{removeDialog.year_level || "Unspecified"}</dd></div>
              </dl>

              <p className="board-registry-danger-label">Danger zone</p>

              <div className="board-registry-fields">
                <div className="board-registry-field is-wide">
                  <label htmlFor="board-student-remove-reason">Removal reason</label>
                  <select
                    id="board-student-remove-reason"
                    value={removalReason}
                    onChange={(event) => setRemovalReason(event.target.value)}
                  >
                    {REMOVAL_REASONS.map((reason) => (
                      <option key={reason} value={reason}>{reason}</option>
                    ))}
                  </select>
                </div>
                {removalReason === "Other" && (
                  <div className="board-registry-field is-wide">
                    <label htmlFor="board-student-remove-custom">Custom reason</label>
                    <textarea
                      id="board-student-remove-custom"
                      required
                      value={customRemovalReason}
                      onChange={(event) => setCustomRemovalReason(event.target.value)}
                      placeholder="Enter the removal reason"
                    />
                  </div>
                )}
              </div>

              <section className="board-registry-section" aria-labelledby="board-student-remove-consequences">
                <p className="board-registry-kicker" id="board-student-remove-consequences">What this changes</p>
                <p className="board-registry-consequences-note">
                  Removing participation revokes {orgName} election eligibility for the active term. It does not
                  alter the student’s account or university standing.
                </p>
                <div className="board-registry-consequences">
                  <div>
                    <h3>Unchanged</h3>
                    <ul>
                      <li>Student account</li>
                      <li>Program</li>
                      <li>University enrollment</li>
                      <li>Historical records</li>
                    </ul>
                  </div>
                  <div className="is-removed">
                    <h3>Removed</h3>
                    <ul>
                      <li>Current {orgName} participation</li>
                      <li>Current {orgName} election eligibility</li>
                    </ul>
                  </div>
                </div>
              </section>

              <section className="board-registry-section" aria-labelledby="board-student-remove-reauth">
                <p className="board-registry-kicker" id="board-student-remove-reauth">Final confirmation</p>
                <p className="board-registry-reauth-note">
                  To continue, confirm the student&rsquo;s ID and your account password.
                </p>
                <div className="board-registry-fields">
                  <div className="board-registry-field">
                    <label htmlFor="board-student-remove-confirm">Student ID</label>
                    <input
                      id="board-student-remove-confirm"
                      value={removeConfirmId}
                      onChange={(event) => setRemoveConfirmId(event.target.value)}
                      autoComplete="off"
                      inputMode="numeric"
                      spellCheck="false"
                      aria-describedby="board-student-remove-confirm-help"
                    />
                    <small id="board-student-remove-confirm-help">
                      Enter Student ID {removeDialog.student_number} to confirm the selected student.
                    </small>
                  </div>
                  <div className="board-registry-field is-wide">
                    <label htmlFor="board-student-remove-account">Board account</label>
                    <input
                      id="board-student-remove-account"
                      type="email"
                      value={boardAccountEmail}
                      readOnly
                      autoComplete="username"
                      spellCheck="false"
                      aria-describedby="board-student-remove-account-help"
                    />
                    <small id="board-student-remove-account-help">
                      Reauthentication checks the signed-in Board account, not the student&rsquo;s record.
                    </small>
                  </div>
                  <div className="board-registry-field">
                    <label htmlFor="board-student-remove-password">Your password</label>
                    <div className="board-registry-secret">
                      <input
                        id="board-student-remove-password"
                        type={removePasswordVisible ? "text" : "password"}
                        value={removePassword}
                        onChange={(event) => setRemovePassword(event.target.value)}
                        autoComplete="current-password"
                        spellCheck="false"
                      />
                      <button
                        type="button"
                        className="board-registry-secret-toggle"
                        onClick={() => setRemovePasswordVisible((visible) => !visible)}
                        disabled={participationSubmitting}
                        aria-label={removePasswordVisible ? "Hide password" : "Show password"}
                        aria-pressed={removePasswordVisible}
                      >
                        {removePasswordVisible ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                      </button>
                    </div>
                    <small>Your Kandid account password. It is never stored or logged.</small>
                  </div>
                </div>
              </section>

              {removeError ? <p className="board-registry-error" role="alert">{removeError}</p> : null}

              <div className="popup-actions board-registry-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={closeRemoveDialog}
                  disabled={participationSubmitting}
                >
                  Cancel
                </button>
        <button
                  type="button"
                  className="danger-btn"
                  onClick={confirmRemoveMembership}
                  disabled={participationSubmitting}
                >
                  {participationSubmitting ? <KandidButtonLoader label="Verifying..." /> : `Remove from ${orgName}`}
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
