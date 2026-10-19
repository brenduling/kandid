import { useEffect, useState } from "react";
import { X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import {
  getCurrentOfficerTermContext,
  getCurrentPositionConflict,
  getCurrentStudentAvailability,
  getCurrentWinnerConflict,
  getIncomingPositionConflict,
  getIncomingStudentAvailability,
  getIncomingWinnerPositionConflict,
  formatOfficerTermLabel,
  getOfficerServiceDateError,
  formatOfficerPositionTitle,
  submitAppointedCurrentOfficer,
} from "../../utils/officerLeadership";
import "./Officers.css";

function IncomingAppointmentDialog({
  incoming,
  incomingError = "",
  incomingLoading = false,
  target = "new",
  currentOfficers = [],
  students,
  studentsLoaded = false,
  studentsError = "",
  studentsLoading = false,
  onLoadEligibleStudents,
  onRetryIncoming,
  busy,
  editingOfficer,
  onClose,
  onAddElected,
  onAddAppointed,
  onAddCurrentElected,
  onAddCurrentAppointed,
  onUpdate,
}) {
  const currentTermContext = getCurrentOfficerTermContext(currentOfficers);
  const [mode, setMode] = useState(editingOfficer?.selection_type || (incoming?.source_election ? "elected" : "appointed"));
  const [query, setQuery] = useState("");
  const [studentId, setStudentId] = useState("");
  const [positionTitle, setPositionTitle] = useState(editingOfficer?.position_title || "");
  const [termEnd, setTermEnd] = useState(editingOfficer?.service?.term_end || (target === "current" ? currentTermContext.defaults.term_end : ""));
  const [selectedWinner, setSelectedWinner] = useState(null);

  useEffect(() => {
    if (!editingOfficer && mode === "appointed" && !studentsLoaded && !studentsLoading) {
      onLoadEligibleStudents?.();
    }
  }, [editingOfficer, mode, onLoadEligibleStudents, studentsLoaded, studentsLoading]);

  const visibleStudents = students.filter((student) => {
    const search = query.trim().toLowerCase();
    if (!search) return true;
    const fullName = `${student.first_name || ""} ${student.last_name || ""}`.trim();
    return [student.first_name, student.last_name, fullName, student.student_number, student.id]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(search);
  }).slice(0, 10);

  const service = {
    term_end: termEnd || null,
  };
  // A new officer's actual start is server-recorded when they become Current.
  // Do not compare an optional end date against the wider academic-term start.
  const serviceDateError = editingOfficer?.service?.term_start
    ? getOfficerServiceDateError(editingOfficer.service.term_start, termEnd)
    : "";
  const appointedPositionConflict = mode === "appointed" || editingOfficer?.selection_type === "appointed"
    ? target === "current"
      ? getCurrentPositionConflict(positionTitle, currentOfficers)
      : getIncomingPositionConflict(positionTitle, incoming, editingOfficer?.id)
    : null;

  function submitCurrentWinner(event) {
    event.preventDefault();
    if (selectedWinner) onAddCurrentElected?.(selectedWinner.candidate_id, service, false);
  }

  async function submit(event) {
    event.preventDefault();
    if (editingOfficer) {
      const changes = { service };
      if (editingOfficer.selection_type === "appointed") changes.position_title = positionTitle;
      await onUpdate(editingOfficer, changes);
      return;
    }
    if (mode === "appointed") {
      if (target === "current") {
        const result = await submitAppointedCurrentOfficer({
          studentId,
          positionTitle,
          positionConflict: appointedPositionConflict,
          serviceDateError,
          service,
          onSubmit: onAddCurrentAppointed,
        });
        if (!result.submitted) return;
      } else {
        await onAddAppointed({ student_id: studentId, position_title: positionTitle, service });
      }
    }
  }

  const heading = editingOfficer ? "Edit new officer" : target === "current" ? "Add to Current Leadership" : "Add to New Officers";

  function renderCurrentTermFields() {
    return (
      <section className="board-officer-service-section">
        <p className="board-officer-section-label">Election semester</p>
        <p className="board-officer-current-term-context">
          <strong>From the verified election record</strong>
          <span>Service begins when this officer is added to Current Leadership.</span>
        </p>
        {incoming?.leadership_academic_year && <p className="board-officer-current-term-context"><strong>Leadership year</strong><span>{formatOfficerTermLabel({ leadership_academic_year: incoming.leadership_academic_year })}</span></p>}
        {serviceDateError && <p role="alert" className="board-officer-conflict">{serviceDateError}</p>}
      </section>
    );
  }

  function renderCurrentAppointedTermFields() {
    const currentLeadershipYear = incoming?.current_leadership_academic_year !== undefined
      ? incoming.current_leadership_academic_year
      : currentOfficers.find((officer) => officer?.leadership_academic_year)?.leadership_academic_year
        || incoming?.leadership_academic_year;
    return (
      <section className="board-officer-service-section">
        <p className="board-officer-section-label">Leadership academic year</p>
        <p className="board-officer-current-term-context">
          <strong>Resolved from Kandid's leadership context</strong>
          <span>{formatOfficerTermLabel({ leadership_academic_year: currentLeadershipYear }) || "Kandid resolves the year from the established academic context."} Service start is recorded when this officer becomes Current.</span>
        </p>
        {serviceDateError && <p role="alert" className="board-officer-conflict">{serviceDateError}</p>}
      </section>
    );
  }

  return (
    <PopupOverlay>
      <div className="popup-sheet board-officer-modal" role="dialog" aria-modal="true" aria-labelledby="incoming-appointment-title">
        <header className="board-officer-modal-header">
          <div>
            <p className="board-officer-modal-eyebrow">{target === "current" ? "Current leadership" : "New officers"}</p>
            <h2 id="incoming-appointment-title" className="board-officer-modal-title">{heading}</h2>
            <p className="board-officer-modal-intro">
              {target === "current"
                ? "Add one verified winner or eligible student to the leadership serving now. Existing officers remain unchanged."
                : "Choose a verified winner or an eligible student. Added officers stay New until you release the roster."}
            </p>
          </div>
          <button type="button" className="board-officer-modal-close" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {!editingOfficer && (
          <div className="board-officer-mode-tabs" role="tablist" aria-label="Officer selection type">
            <button type="button" role="tab" aria-selected={mode === "elected"} className={mode === "elected" ? "is-active" : ""} disabled={!incoming?.source_election && !incomingLoading && !incomingError} onClick={() => setMode("elected")}>Elected</button>
            <button type="button" role="tab" aria-selected={mode === "appointed"} className={mode === "appointed" ? "is-active" : ""} onClick={() => setMode("appointed")}>Appointed</button>
          </div>
        )}

        {!incoming?.source_election && !editingOfficer && mode === "elected" && incomingLoading && (
          <p className="board-officers-register-empty" role="status">Checking published election results…</p>
        )}

        {!incoming?.source_election && !editingOfficer && mode === "elected" && !incomingLoading && (
          <div className="board-officers-register-empty" role={incomingError ? "alert" : undefined}>
            <p>{incomingError || "No published election results are available."}</p>
            {incomingError && <button type="button" className="board-officer-action" onClick={onRetryIncoming} disabled={busy}>Retry</button>}
          </div>
        )}

        {editingOfficer?.selection_type === "elected" && (
          <div className="board-officer-mode-intro">
            <p className="board-officer-section-label">Verified winner · {incoming?.source_election?.election_title}</p>
            <strong>{editingOfficer.student_name} — {formatOfficerPositionTitle(editingOfficer.position_title)}</strong>
          </div>
        )}

        {editingOfficer?.selection_type === "appointed" && (
          <div className="board-officer-mode-intro">
            <p className="board-officer-section-label">Appointed student</p>
            <strong>{editingOfficer.student_name}</strong>
          </div>
        )}

        {!editingOfficer && incoming?.source_election && mode === "elected" && (
          <section className="board-officer-staging-section" aria-label="Verified election winners">
            <p className="board-officer-section-label">Verified winners · {incoming?.source_election?.election_title || "Most recent published election"}</p>
            {(incoming?.available_winners || []).length ? incoming.available_winners.map((winner) => (
              (() => {
                const positionConflict = target === "current"
                  ? getCurrentWinnerConflict(winner, currentOfficers)
                  : getIncomingWinnerPositionConflict(winner, incoming);
                const alreadyAdded = target === "new" && winner.already_added;
                const selected = String(selectedWinner?.candidate_id) === String(winner.candidate_id);
                return <div className={`board-officer-stage-option${alreadyAdded || positionConflict ? " is-unavailable" : ""}${selected ? " is-selected" : ""}`} key={winner.candidate_id}>
                  <div>
                  <strong>{formatOfficerPositionTitle(winner.position_title)}</strong>
                  <span>{winner.student_name || "Student"}{winner.student_number ? ` · ${winner.student_number}` : ""}</span>
                    {positionConflict && <small role="status" className="board-officer-conflict">{positionConflict.message}</small>}
                  </div>
                  <button type="button" disabled={busy || alreadyAdded || Boolean(positionConflict)} onClick={() => target === "current" ? setSelectedWinner(winner) : onAddElected(winner.candidate_id, {})}>
                    {positionConflict ? "Occupied" : alreadyAdded ? "Already added" : selected ? "Selected" : target === "current" ? "Select winner" : "Add winner"}
                  </button>
                </div>;
              })()
            )) : <p className="board-officers-register-empty">No unique positive-vote winners are available to add.</p>}
            {(incoming?.unresolved || []).length > 0 && (
              <div className="board-officer-unresolved-list">
                <strong>Unresolved positions</strong>
                {incoming.unresolved.map((position) => (
                  <span key={position.position_id}>{position.position_name} · {position.outcome === "tie" ? "Tie" : "No winner"}</span>
                ))}
              </div>
            )}
          </section>
        )}

        {target === "current" && !editingOfficer && mode === "elected" && selectedWinner && (
          <form className="board-officer-form" onSubmit={submitCurrentWinner}>
            <div className="board-officer-mode-intro">
              <p className="board-officer-section-label">Selected verified winner</p>
              <strong>{formatOfficerPositionTitle(selectedWinner.position_title)} — {selectedWinner.student_name || "Student"}</strong>
            </div>
            {renderCurrentTermFields()}
            <div className="board-officer-modal-actions">
              <button type="button" onClick={() => setSelectedWinner(null)} className="board-officer-cancel" disabled={busy}>Choose another</button>
              <button type="submit" className="board-officer-submit" disabled={busy || Boolean(serviceDateError)}>
                {busy ? "Adding…" : "Add winner to Current"}
              </button>
            </div>
          </form>
        )}

        {(Boolean(!editingOfficer && mode === "appointed")) || editingOfficer?.selection_type === "appointed" ? (
          <form className="board-officer-form" onSubmit={submit}>
            {!editingOfficer && (
              <section className="board-officer-appointment-picker">
                <label className="board-officer-field">
                  <span>Eligible organization students</span>
                  <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search student name or ID" autoComplete="off" />
                </label>
                <div className="board-officer-appointment-options" role="list" aria-label="Eligible students">
                  {studentsError ? (
                    <div className="board-officers-register-empty" role="alert">
                      <p>{studentsError}</p>
                      <button type="button" className="board-officer-action" onClick={() => onLoadEligibleStudents?.({ retry: true })} disabled={studentsLoading}>Retry</button>
                    </div>
                  ) : studentsLoading ? (
                    <p className="board-officers-register-empty" role="status">Loading eligible organization students…</p>
                  ) : !studentsLoaded ? (
                    <p className="board-officers-register-empty" role="status">Preparing the eligible student list...</p>
                  ) : visibleStudents.length === 0 ? (
                    <p className="board-officers-register-empty">No eligible students match this search.</p>
                  ) : visibleStudents.map((student) => {
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
                        <span className="board-officer-appointment-reason">{unavailable ? availability.reason : studentId === id ? "Selected" : "Selectable"}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            <label className="board-officer-field">
              <span>Appointed position</span>
              <input required maxLength={160} value={positionTitle} onChange={(event) => setPositionTitle(event.target.value)} placeholder="e.g. Treasurer" readOnly={editingOfficer?.selection_type === "elected"} />
            </label>
            {appointedPositionConflict && <p role="alert" className="board-officer-conflict">{appointedPositionConflict.message}{target === "new" ? " Resolve the existing New Officers assignment first." : ""}</p>}
            {target === "current" ? renderCurrentAppointedTermFields() : <section className="board-officer-service-section">
              <p className="board-officer-section-label">Leadership year &amp; service</p>
              <p>The leadership year is recorded from the verified election or established Current leadership when released.</p>
              <label className="board-officer-field"><span>End of service <small>Optional</small></span><input type="date" value={termEnd} onChange={(event) => setTermEnd(event.target.value)} /></label>
            </section>}
            {serviceDateError && <p role="alert" className="board-officer-conflict">{serviceDateError}</p>}
            <div className="board-officer-modal-actions">
              <button type="button" onClick={onClose} className="board-officer-cancel" disabled={busy}>Cancel</button>
              <button type="submit" className="board-officer-submit" disabled={busy || (!editingOfficer && !studentId) || !positionTitle.trim() || Boolean(appointedPositionConflict) || Boolean(serviceDateError)}>
                {busy ? "Saving…" : editingOfficer ? "Save changes" : target === "current" ? "Add to Current Leadership" : "Add to New Officers"}
              </button>
            </div>
          </form>
        ) : editingOfficer ? (
          <form className="board-officer-form" onSubmit={submit}>
            <section className="board-officer-service-section">
              <p className="board-officer-section-label">Leadership year &amp; service</p>
              <p>{formatOfficerTermLabel(editingOfficer) || "Leadership year is retained from the officer record."}</p>
              <label className="board-officer-field"><span>End of service</span><input type="date" value={termEnd} onChange={(event) => setTermEnd(event.target.value)} /></label>
            </section>
            {serviceDateError && <p role="alert" className="board-officer-conflict">{serviceDateError}</p>}
            <div className="board-officer-modal-actions">
              <button type="button" onClick={onClose} className="board-officer-cancel" disabled={busy}>Cancel</button>
              <button type="submit" className="board-officer-submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
            </div>
          </form>
        ) : null}
      </div>
    </PopupOverlay>
  );
}

export default IncomingAppointmentDialog;
