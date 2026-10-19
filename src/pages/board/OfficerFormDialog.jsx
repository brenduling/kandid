import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { KandidButtonLoader } from "../../components/KandidLoader";
import {
  getCurrentOfficerTermContext,
  getCurrentPositionConflict,
  getCurrentStudentAvailability,
  getCurrentWinnerConflict,
  getIncomingPositionConflict,
  getIncomingStudentAvailability,
  getIncomingWinnerPositionConflict,
  getOfficerServiceDateError,
  formatOfficerTermLabel,
  formatOfficerPositionTitle,
  submitAppointedCurrentOfficer,
} from "../../utils/officerLeadership";
import "../superadmin/Students.css";
import "./Officers.css";

/* The Board Add/Edit Officer wizard.

   This deliberately uses the SAME sheet, header, progress rule, question
   block, fields and footer as the Board "Add Student" wizard
   (popup-sheet popup-sheet-wide sa-students-modal is-registration +
   sa-registration-* in superadmin/Students.css), so a Board member meets the
   exact form language they already know. It replaces the previous one-off
   officer dialog and its separate destination dialog with one wizard.

   Only presentation is new here. Every selection rule, conflict check and
   submit payload is the same helper and the same handler the previous dialog
   used, so officer business behaviour is unchanged. */
function OfficerFormDialog({
  orgName,
  termLabel = "",
  initialTarget = null,
  editingOfficer = null,
  incoming = null,
  incomingError = "",
  incomingLoading = false,
  currentOfficers = [],
  students = [],
  studentsLoaded = false,
  studentsError = "",
  studentsLoading = false,
  onLoadEligibleStudents,
  onRetryIncoming,
  busy = false,
  onClose,
  onAddElected,
  onAddAppointed,
  onAddCurrentElected,
  onAddCurrentAppointed,
  onUpdate,
}) {
  const isEdit = Boolean(editingOfficer);
  const steps = isEdit
    ? ["Details", "Review"]
    : ["Destination", "Officer Type", "Details", "Review"];
  const currentTermContext = getCurrentOfficerTermContext(currentOfficers);

  const [step, setStep] = useState(isEdit ? 1 : initialTarget ? 2 : 1);
  const [target, setTarget] = useState(initialTarget);
  const [mode, setMode] = useState(
    editingOfficer?.selection_type || (incoming?.source_election ? "elected" : "appointed")
  );
  const [query, setQuery] = useState("");
  const [studentId, setStudentId] = useState("");
  const [positionTitle, setPositionTitle] = useState(editingOfficer?.position_title || "");
  const [termEnd, setTermEnd] = useState(
    editingOfficer?.service?.term_end || (initialTarget === "current" ? currentTermContext.defaults.term_end : "")
  );
  const [selectedWinner, setSelectedWinner] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editingOfficer && mode === "appointed" && !studentsLoaded && !studentsLoading) {
      onLoadEligibleStudents?.();
    }
  }, [editingOfficer, mode, onLoadEligibleStudents, studentsLoaded, studentsLoading]);

  const electedDisabled = !incoming?.source_election && !incomingLoading && !incomingError;

  const search = query.trim().toLowerCase();
  const visibleStudents = students
    .filter((student) => {
      if (!search) return true;
      const fullName = `${student.first_name || ""} ${student.last_name || ""}`.trim();
      return [student.first_name, student.last_name, fullName, student.student_number, student.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search);
    })
    .slice(0, 10);

  const service = { term_end: termEnd || null };
  // A new officer's service start is server-recorded; never compare the
  // optional end date against the wider academic-term start.
  const serviceDateError = editingOfficer?.service?.term_start
    ? getOfficerServiceDateError(editingOfficer.service.term_start, termEnd)
    : "";
  const appointedPositionConflict = mode === "appointed" || editingOfficer?.selection_type === "appointed"
    ? target === "current"
      ? getCurrentPositionConflict(positionTitle, currentOfficers)
      : getIncomingPositionConflict(positionTitle, incoming, editingOfficer?.id)
    : null;

  const selectedStudent = students.find((student) => String(student.id) === String(studentId));
  const subjectName = mode === "elected"
    ? selectedWinner?.student_name || "Verified winner"
    : selectedStudent
      ? `${selectedStudent.first_name || ""} ${selectedStudent.last_name || ""}`.trim() || "Eligible student"
      : "Eligible student";
  const subjectPosition = mode === "elected"
    ? formatOfficerPositionTitle(selectedWinner?.position_title || "")
    : positionTitle || "Position not set";

  const canContinue = isEdit
    ? editingOfficer?.selection_type === "appointed"
      ? Boolean(positionTitle.trim()) && !appointedPositionConflict && !serviceDateError
      : !serviceDateError
    : step === 1
      ? Boolean(target)
      : step === 2
        ? Boolean(mode) && !(mode === "elected" && electedDisabled)
        : step === 3
          ? mode === "elected"
            ? Boolean(selectedWinner)
            : Boolean(studentId) && Boolean(positionTitle.trim()) && !appointedPositionConflict && !serviceDateError
          : true;

  function goNext() {
    if (!canContinue) return;
    setError("");
    setStep((current) => Math.min(current + 1, steps.length));
  }

  function goBack() {
    setError("");
    setStep((current) => Math.max(current - 1, 1));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy || step < steps.length) return;

    if (isEdit) {
      const changes = { service };
      if (editingOfficer.selection_type === "appointed") changes.position_title = positionTitle;
      await onUpdate?.(editingOfficer, changes);
      return;
    }

    if (target === "current") {
      if (mode === "elected") {
        if (selectedWinner) onAddCurrentElected?.(selectedWinner.candidate_id, service, false);
        return;
      }
      await submitAppointedCurrentOfficer({
        studentId,
        positionTitle,
        positionConflict: appointedPositionConflict,
        serviceDateError,
        service,
        onSubmit: onAddCurrentAppointed,
      });
      return;
    }

    if (mode === "elected") {
      if (selectedWinner) await onAddElected?.(selectedWinner.candidate_id, {});
      return;
    }
    await onAddAppointed?.({ student_id: studentId, position_title: positionTitle, service });
  }

  const title = isEdit ? "Edit Officer" : "Add Officer";
  const subtitle = isEdit
    ? `${editingOfficer?.student_name || "Officer"}${editingOfficer?.position_title ? ` · ${formatOfficerPositionTitle(editingOfficer.position_title)}` : ""}`
    : `Leadership record for ${orgName}${termLabel ? ` · ${termLabel}` : ""}`;

  const progress = (
    <ol
      className="sa-registration-progress"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      aria-label="Add officer progress"
    >
      {steps.map((label, index) => (
        <li
          key={label}
          className={step === index + 1 ? "is-current" : step > index + 1 ? "is-complete" : ""}
          aria-current={step === index + 1 ? "step" : undefined}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{label}</strong>
        </li>
      ))}
    </ol>
  );

  function renderCurrentTermNote() {
    return (
      <div className="sa-registration-note">
        <strong>Election semester</strong>
        <p>From the verified election record. Service begins when this officer is added to Current Leadership.</p>
      </div>
    );
  }

  function renderCurrentAppointedTermNote() {
    const currentLeadershipYear = incoming?.current_leadership_academic_year !== undefined
      ? incoming.current_leadership_academic_year
      : currentOfficers.find((officer) => officer?.leadership_academic_year)?.leadership_academic_year
        || incoming?.leadership_academic_year;
    return (
      <div className="sa-registration-note">
        <strong>Leadership academic year</strong>
        <p>{formatOfficerTermLabel({ leadership_academic_year: currentLeadershipYear }) || "Resolved from Kandid's trusted academic-year context."} Service start is recorded when this officer becomes Current.</p>
      </div>
    );
  }

  function renderNewTermField() {
    return (
      <div className="sa-registration-field">
        <label htmlFor="officer-term-end">End of service <span>Optional</span></label>
        <input
          id="officer-term-end"
          type="date"
          value={termEnd}
          onChange={(event) => setTermEnd(event.target.value)}
        />
      </div>
    );
  }

  function renderWinnerList() {
    return (
      <>
        <div className="sa-registration-focus">
          <h3>Choose a verified winner</h3>
          <p>
            {incoming?.source_election?.election_title || "Most recent published election"}.
            Only unique positive-vote winners can be added.
          </p>
        </div>
        <div className="board-officer-staging-section" aria-label="Verified election winners">
          {(incoming?.available_winners || []).length ? (
            incoming.available_winners.map((winner) => {
              const positionConflict = target === "current"
                ? getCurrentWinnerConflict(winner, currentOfficers)
                : getIncomingWinnerPositionConflict(winner, incoming);
              const alreadyAdded = target === "new" && winner.already_added;
              const selected = String(selectedWinner?.candidate_id) === String(winner.candidate_id);
              return (
                <div
                  className={`board-officer-stage-option${alreadyAdded || positionConflict ? " is-unavailable" : ""}`}
                  key={winner.candidate_id}
                >
                  <div>
                    <strong>{formatOfficerPositionTitle(winner.position_title)}</strong>
                    <span>
                      {winner.student_name || "Student"}
                      {winner.student_number ? ` · ${winner.student_number}` : ""}
                    </span>
                    {positionConflict && (
                      <small role="status" className="board-officer-conflict">{positionConflict.message}</small>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={busy || alreadyAdded || Boolean(positionConflict)}
                    onClick={() => setSelectedWinner(winner)}
                  >
                    {positionConflict ? "Occupied" : alreadyAdded ? "Already added" : selected ? "Selected" : "Select"}
                  </button>
                </div>
              );
            })
          ) : (
            <p className="board-officers-register-empty">No unique positive-vote winners are available to add.</p>
          )}
        </div>
        {(incoming?.unresolved || []).length > 0 && (
          <div className="board-officer-unresolved-list">
            <strong>Unresolved positions</strong>
            {incoming.unresolved.map((position) => (
              <span key={position.position_id}>
                {position.position_name} · {position.outcome === "tie" ? "Tie" : "No winner"}
              </span>
            ))}
          </div>
        )}
        {target === "current" && selectedWinner && renderCurrentTermNote()}
      </>
    );
  }

  function renderAppointmentPicker() {
    return (
      <>
        <div className="sa-registration-focus">
          <h3>Choose an eligible student</h3>
          <p>
            {target === "current"
              ? "Add one appointed student to the leadership serving now."
              : "Add one appointed student to the next roster release."}
          </p>
        </div>
        <div className="sa-registration-field">
          <label htmlFor="officer-student-search">Eligible organization students</label>
          <input
            id="officer-student-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search student name or ID"
            autoComplete="off"
          />
        </div>
        <div className="board-officer-appointment-options" role="list" aria-label="Eligible students">
          {studentsError ? (
            <div className="board-officers-register-empty" role="alert">
              <p>{studentsError}</p>
              <button
                type="button"
                className="board-officer-action"
                onClick={() => onLoadEligibleStudents?.({ retry: true })}
                disabled={studentsLoading}
              >
                Retry
              </button>
            </div>
          ) : studentsLoading ? (
            <p className="board-officers-register-empty" role="status">Loading eligible organization students…</p>
          ) : !studentsLoaded ? (
            <p className="board-officers-register-empty" role="status">Preparing the eligible student list...</p>
          ) : visibleStudents.length === 0 ? (
            <p className="board-officers-register-empty">No eligible students match this search.</p>
          ) : (
            visibleStudents.map((student) => {
              const id = String(student.id);
              const availability = target === "current"
                ? getCurrentStudentAvailability(id, currentOfficers)
                : getIncomingStudentAvailability(id, incoming);
              const unavailable = !availability.available;
              const name = `${student.first_name || ""} ${student.last_name || ""}`.trim() || "Unnamed student";
              return (
                <button
                  key={student.id}
                  type="button"
                  role="listitem"
                  className={`board-officer-appointment-option${unavailable ? " is-unavailable" : ""}${studentId === id ? " is-selected" : ""}`}
                  disabled={unavailable || busy}
                  onClick={() => { setStudentId(id); setQuery(name); }}
                >
                  <span><strong>{name}</strong><small>{student.student_number || "No student number"}</small></span>
                  <span className="board-officer-appointment-reason">
                    {unavailable ? availability.reason : studentId === id ? "Selected" : "Selectable"}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="sa-registration-field">
          <label htmlFor="officer-position">Appointed position</label>
          <input
            id="officer-position"
            required
            maxLength={160}
            value={positionTitle}
            onChange={(event) => setPositionTitle(event.target.value)}
            placeholder="e.g. Treasurer"
          />
        </div>
        {appointedPositionConflict && (
          <p role="alert" className="sa-registration-error">
            {appointedPositionConflict.message}
            {target === "new" ? " Resolve the existing New Officers assignment first." : ""}
          </p>
        )}
        {target === "current" ? renderCurrentAppointedTermNote() : renderNewTermField()}
      </>
    );
  }

  function renderDetailsStep() {
    if (mode === "elected") {
      if (!incoming?.source_election) {
        return (
          <div className="sa-registration-focus">
            <h3>Election results</h3>
            {incomingLoading ? (
              <p role="status">Checking published election results…</p>
            ) : (
              <p>{incomingError || "No published election results are available."}</p>
            )}
            {incomingError && (
              <button type="button" className="secondary-btn" onClick={onRetryIncoming} disabled={busy}>
                Retry
              </button>
            )}
          </div>
        );
      }
      return renderWinnerList();
    }
    return renderAppointmentPicker();
  }

  function renderReviewStep() {
    return (
      <>
        <div className="sa-registration-focus">
          <h3>Review this officer</h3>
          <p>Confirm the leadership record before it is added.</p>
        </div>
        <div className="sa-registration-review">
          <section>
            <span>Destination</span>
            <strong>{target === "current" ? "Current Leadership" : "New Officers"}</strong>
            <p>{target === "current" ? "Serving now." : "Prepared for the next release."}</p>
          </section>
          <section>
            <span>Officer type</span>
            <strong>{mode === "elected" ? "Elected" : "Appointed"}</strong>
            <p>{mode === "elected" ? incoming?.source_election?.election_title || "Verified winner" : "Eligible student appointment"}</p>
          </section>
          <section>
            <span>Officer</span>
            <strong>{subjectName}</strong>
            <p>{subjectPosition}</p>
          </section>
        </div>
        {target === "current" && (
          <div className="sa-registration-note">
            <strong>Service</strong>
            <p>Service start is recorded when this officer becomes Current.</p>
          </div>
        )}
      </>
    );
  }

  function renderEditDetails() {
    return (
      <>
        <div className="sa-registration-focus">
          <h3>{editingOfficer?.selection_type === "elected" ? "Service details" : "Officer details"}</h3>
          <p>Update this officer&apos;s record. Leadership year is retained.</p>
        </div>
        {editingOfficer?.selection_type === "elected" ? (
          <div className="sa-registration-note">
            <strong>Office</strong>
            <p>{formatOfficerPositionTitle(editingOfficer.position_title)}</p>
          </div>
        ) : (
          <div className="sa-registration-field">
            <label htmlFor="officer-position">Position</label>
            <input
              id="officer-position"
              required
              maxLength={160}
              value={positionTitle}
              onChange={(event) => setPositionTitle(event.target.value)}
            />
          </div>
        )}
        <div className="sa-registration-note">
          <strong>Leadership year</strong>
          <p>{formatOfficerTermLabel(editingOfficer) || "Leadership year is retained from the officer record."}</p>
        </div>
        <div className="sa-registration-field">
          <label htmlFor="officer-term-end">End of service <span>Optional</span></label>
          <input
            id="officer-term-end"
            type="date"
            value={termEnd}
            onChange={(event) => setTermEnd(event.target.value)}
          />
        </div>
        {serviceDateError && <p role="alert" className="sa-registration-error">{serviceDateError}</p>}
      </>
    );
  }

  function renderEditReview() {
    return (
      <div className="sa-registration-review">
        <section>
          <span>Officer</span>
          <strong>{editingOfficer?.student_name || "Officer"}</strong>
          <p>{formatOfficerPositionTitle(positionTitle || editingOfficer?.position_title)}</p>
        </section>
        <section>
          <span>Leadership year</span>
          <strong>{formatOfficerTermLabel(editingOfficer) || "Retained"}</strong>
          <p>Leadership year is retained.</p>
        </section>
        <section>
          <span>End of service</span>
          <strong>{termEnd || "Not set"}</strong>
          <p>Optional</p>
        </section>
      </div>
    );
  }

  return (
    <PopupOverlay>
      <div
        className="popup-sheet popup-sheet-wide sa-students-modal is-registration board-officer-registration"
        role="dialog"
        aria-modal="true"
        aria-labelledby="officer-form-title"
      >
        <div className="popup-header">
          <div className="popup-header-copy">
            <h2 id="officer-form-title" className="surface-title">{title}</h2>
            <p className="surface-copy">{subtitle}</p>
          </div>
          <button
            type="button"
            className="popup-close"
            onClick={onClose}
            aria-label="Close officer form"
            disabled={busy}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <form className="popup-content sa-registration-workspace" onSubmit={handleSubmit}>
          {progress}

          {isEdit ? (step === 1 ? renderEditDetails() : renderEditReview())
            : step === 1 ? (
              <>
                <div className="sa-registration-focus">
                  <h3>Where should this officer go?</h3>
                  <p>Choose the leadership roster to update.</p>
                </div>
                <div className="sa-registration-fields">
                  <button
                    type="button"
                    className={`board-officer-choice${target === "current" ? " is-selected" : ""}`}
                    aria-pressed={target === "current"}
                    onClick={() => setTarget("current")}
                  >
                    <strong>Current Leadership</strong>
                    <span>Add one officer to the team serving now.</span>
                  </button>
                  <button
                    type="button"
                    className={`board-officer-choice${target === "new" ? " is-selected" : ""}`}
                    aria-pressed={target === "new"}
                    onClick={() => setTarget("new")}
                  >
                    <strong>New Officers</strong>
                    <span>Prepare an officer for the next roster release.</span>
                  </button>
                </div>
              </>
            ) : step === 2 ? (
              <>
                <div className="sa-registration-focus">
                  <h3>How should this officer be selected?</h3>
                  <p>Use a verified election winner, or appoint an eligible student.</p>
                </div>
                <div className="sa-registration-fields">
                  <button
                    type="button"
                    className={`board-officer-choice${mode === "elected" ? " is-selected" : ""}`}
                    aria-pressed={mode === "elected"}
                    disabled={electedDisabled}
                    onClick={() => setMode("elected")}
                  >
                    <strong>Elected</strong>
                    <span>From the verified published election winners.</span>
                  </button>
                  <button
                    type="button"
                    className={`board-officer-choice${mode === "appointed" ? " is-selected" : ""}`}
                    aria-pressed={mode === "appointed"}
                    onClick={() => setMode("appointed")}
                  >
                    <strong>Appointed</strong>
                    <span>Assign an eligible student to a position.</span>
                  </button>
                </div>
                {electedDisabled && (
                  <p className="sa-registration-note">
                    No published election results are available for {orgName}. Choose Appointed, or retry from the next step.
                  </p>
                )}
              </>
            ) : step === 3 ? (
              renderDetailsStep()
            ) : (
              renderReviewStep()
            )}

          {error && <p role="alert" className="sa-registration-error">{error}</p>}

          <div className="sa-registration-actions">
            {step === 1 ? (
              <button type="button" className="secondary-btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
            ) : (
              <button type="button" className="secondary-btn" onClick={goBack} disabled={busy}>
                <ArrowLeft size={16} aria-hidden="true" />Back
              </button>
            )}

            {step < steps.length ? (
              <button type="button" className="primary-btn" onClick={goNext} disabled={busy || !canContinue}>
                Continue<ArrowRight size={16} aria-hidden="true" />
              </button>
            ) : (
              <button type="submit" className="primary-btn" disabled={busy}>
                {busy ? (
                  <KandidButtonLoader label={isEdit ? "Saving..." : "Adding..."} />
                ) : (
                  <>
                    {isEdit ? "Save changes" : "Add Officer"}
                    <ArrowRight size={16} aria-hidden="true" />
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </PopupOverlay>
  );
}

export default OfficerFormDialog;
