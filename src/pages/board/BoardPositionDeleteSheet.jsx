import { Archive, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { KandidButtonLoader } from "../../components/KandidLoader";

/* Danger Zone delete review for one ballot position.
 *
 * This replaces the generic confirm and alert popups that used to appear for a
 * position delete. It is presentation only: it never decides whether a delete is
 * allowed. The dependency analysis, the retire eligibility rule, the audit
 * events and the delete itself all stay in the page's handleDelete, confirmDelete
 * and confirmRetire, and the sheet only renders the facts those functions hand it:
 *
 *   reviewing  the dependency check is in flight
 *   blocked    analysis.blocked is true, so no delete button is rendered at all
 *   confirm    analysis.blocked is false, so the destructive action is available
 *   deleting   the permitted delete is re-checking and running
 *   retiring   the archive-severity retire is running
 *
 * Two existing behaviours are deliberately preserved:
 *
 * - "Review Candidates" is an acknowledgement only. It does not navigate and it
 *   does not delete, exactly as the prompt.alert it replaced did not.
 * - The related-record wording is the guard's own recommendation, and the counts
 *   shown are only the ones the guard returned. Nothing here states a consequence
 *   the guard did not report.
 */

const PHASE_COPY = {
  reviewing: "Checking related records",
  blocked: "Deletion blocked",
  confirm: "Delete this position",
  deleting: "Deleting position",
  retiring: "Retiring position",
};

export default function BoardPositionDeleteSheet({
  position,
  electionTitle,
  orgName,
  phase,
  analysis,
  onClose,
  onConfirm,
  onRetire,
}) {
  const dependencies = analysis?.dependencies || [];
  const busy = phase === "deleting" || phase === "retiring";
  const name = position?.name || "This position";

  /* True only for the archive severity the guard returns when a position already
     has voting records. It changes nothing about eligibility; the delete is
     blocked for every blocked analysis. It is used to keep the sheet's own copy
     aligned with the recommendation the guard produced. */
  const archiveRecommended = analysis?.severity === "archive";
  const title =
    phase === "blocked" && archiveRecommended ? "Retire this position" : PHASE_COPY[phase] || PHASE_COPY.reviewing;

  return (
    <PopupOverlay>
      <div
        className="popup-sheet board-position-sheet is-danger"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-position-danger-title"
      >
        <div className="popup-header">
          <div className="popup-header-copy">
            <p className="board-position-danger-label">Danger zone / Position</p>
            <h2 id="board-position-danger-title" className="surface-title">
              {title}
            </h2>
            <p className="board-position-sheet-subject">
              {name}
              <span>
                {electionTitle || "Selected election"}
                {orgName ? ` / ${orgName}` : ""}
              </span>
            </p>
          </div>
          <button
            type="button"
            className="popup-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close deletion review"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="popup-content board-position-danger-body">
          {phase === "reviewing" || busy ? (
            <p className="board-position-danger-wait">
              {phase === "deleting"
                ? "Re-checking related records and deleting the position."
                : phase === "retiring"
                  ? "Retiring this position. Historical voting records are preserved."
                  : "Checking this position for related records."}
            </p>
          ) : null}

          {phase === "blocked" ? (
            <>
              <p className="board-position-danger-lead">
                <strong>{name}</strong> cannot be safely deleted yet.
              </p>

              {dependencies.length > 0 ? (
                <div className="board-position-blocked">
                  <p className="board-position-blocked-label">Related records found</p>
                  <ul className="board-position-blocked-counts">
                    {dependencies.map((item) => (
                      <li key={item.label}>
                        <strong>{item.count}</strong>
                        <span>{item.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {archiveRecommended ? (
                <p className="board-position-danger-recommendation">
                  Recommended action: retire this position to remove it from active setup
                  while preserving votes, receipts, results, and verification history.
                </p>
              ) : (
                <>
                  <p className="board-position-danger-recommendation">
                    {analysis?.recommendation}
                  </p>
                  <p className="board-position-danger-wait">
                    Open Candidates to manage records for this election and position.
                  </p>
                </>
              )}
            </>
          ) : null}

          {phase === "confirm" ? (
            <>
              <p className="board-position-danger-lead">
                <strong>{name}</strong> has no detected blocking dependencies. Confirm to
                delete it permanently.
              </p>

              <div className="board-position-blocked">
                <p className="board-position-blocked-label">Existing safeguards</p>
                <ul className="board-position-safeguards">
                  <li>Related records are checked again immediately before the delete.</li>
                  <li>
                    The delete stops without removing anything if that check finds related
                    records.
                  </li>
                </ul>
              </div>
            </>
          ) : null}
        </div>

        <div className="board-position-danger-footer">
          {phase === "blocked" && archiveRecommended ? (
            <>
              <button
                type="button"
                className="board-position-danger-quiet"
                onClick={onClose}
                disabled={busy}
              >
                Keep Active
              </button>
              <button
                type="button"
                className="board-position-danger-primary"
                onClick={onRetire}
                disabled={busy}
              >
                <Archive size={15} aria-hidden="true" />
                Retire Position
              </button>
            </>
          ) : null}

          {phase === "blocked" && !archiveRecommended ? (
            <>
              <button
                type="button"
                className="board-position-danger-quiet"
                onClick={onClose}
                disabled={busy}
              >
                Close
              </button>
              <button
                type="button"
                className="board-position-danger-primary"
                onClick={onClose}
              >
                Review Candidates
              </button>
            </>
          ) : null}

          {phase === "confirm" || phase === "deleting" ? (
            <>
              <button
                type="button"
                className="board-position-danger-quiet"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="board-position-danger-button"
                onClick={onConfirm}
                disabled={busy}
              >
                {phase === "deleting" ? (
                  <KandidButtonLoader label="Deleting..." />
                ) : (
                  <>
                    <Trash2 size={15} aria-hidden="true" />
                    Delete Position
                  </>
                )}
              </button>
            </>
          ) : null}

          {phase === "retiring" ? (
            <>
              <button
                type="button"
                className="board-position-danger-quiet"
                onClick={onClose}
                disabled={busy}
              >
                Close
              </button>
              <button
                type="button"
                className="board-position-danger-primary"
                onClick={onRetire}
                disabled={busy}
              >
                <KandidButtonLoader label="Retiring..." />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </PopupOverlay>
  );
}
