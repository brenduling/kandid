import { useState } from "react";
import { RotateCw, ShieldAlert, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { KandidButtonLoader } from "../../components/KandidLoader";
import "./Elections.css";

const PHASE_COPY = {
  reviewing: ["Danger zone / Election", "Checking related records"],
  review: ["Election review", "Related records are preserved"],
  unavailable: ["Election review", "Related records unavailable"],
  danger_zone: ["Danger zone / Election", "Remove this election"],
  removing: ["Danger zone / Election", "Removing election"],
  restoring: ["Danger zone / Election", "Restoring election"],
};

export default function BoardElectionDeleteSheet({
  election,
  orgName,
  phase,
  analysis,
  mode = "remove",
  removalReady = false,
  error = "",
  onClose,
  onRetry,
  onContinue,
  onConfirm,
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [password, setPassword] = useState("");
  const copy = PHASE_COPY[phase] || PHASE_COPY.reviewing;
  const dependencies = analysis?.dependencies || [];
  const busy = ["removing", "restoring"].includes(phase);
  const isRestore = mode === "restore";

  async function confirm(event) {
    event.preventDefault();
    if (busy || !password) return;
    const submittedPassword = password;
    setPassword("");
    await onConfirm?.(submittedPassword);
  }

  return (
    <PopupOverlay>
      <div
        className="popup-sheet board-election-sheet is-danger"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-election-danger-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="popup-header">
          <div className="popup-header-copy">
            <p className="board-election-danger-label">{copy[0]}</p>
            <h2 id="board-election-danger-title" className="surface-title">{isRestore && phase === "danger_zone" ? "Restore this election" : copy[1]}</h2>
            <p className="board-election-sheet-subject">
              {election?.title || "Untitled Election"}
              <span>{orgName || election?.organizations?.name || "Organization"}</span>
            </p>
          </div>
          <button type="button" className="popup-close" onClick={onClose} disabled={busy} aria-label="Close election removal">
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="popup-content board-election-danger-sheet-body">
          {phase === "reviewing" ? <p className="board-election-danger-wait">Checking the election and its related-record summary.</p> : null}
          {phase === "review" ? (
            <>
              <p className="board-election-danger-lead"><strong>{election?.title || "This election"}</strong>{removalReady ? " can be removed from normal management lists. Related records stay attached and unchanged." : " has the related records shown below. This review is read-only; election removal is not activated."}</p>
              <div className="board-election-blocked">
                <p className="board-election-blocked-label">Records retained</p>
                <ul className="board-election-blocked-counts">
                  {dependencies.filter((item) => item.count > 0).map((item) => (
                    <li key={item.key}><strong>{item.count}</strong><span>{item.label}</span></li>
                  ))}
                  {!dependencies.some((item) => item.count > 0) ? <li><strong>0</strong><span>Related records found</span></li> : null}
                </ul>
              </div>
              <p className="board-election-danger-recommendation">{analysis?.recommendation}</p>
              {detailsOpen ? (
                <section className="board-election-dependency-detail" id="board-election-dependency-detail" aria-label="Detailed election dependencies">
                  <h3>Detailed dependency review</h3>
                  <p>Read-only counts for this election. Removal will not delete or detach these records.</p>
                  <ul>{dependencies.map((item) => (
                    <li key={item.key}><span><strong>{item.label}</strong><small>{item.reason}</small></span><b>{item.count}</b></li>
                  ))}</ul>
                </section>
              ) : null}
            </>
          ) : null}
          {phase === "unavailable" ? (
            <><p className="board-election-danger-lead">Kandid could not verify every related-record category.</p><p className="board-election-danger-recommendation">No election change was made. Retry the read-only review before continuing.</p></>
          ) : null}
          {phase === "danger_zone" ? (
            <form id="election-removal-confirm-form" onSubmit={confirm}>
              <p className="board-election-danger-lead"><strong>{election?.title || "This election"}</strong> will be {isRestore ? "restored to the normal management list" : "hidden from the normal management list"}. Votes, ballots, frozen electorate, receipts, results, blockchain evidence, candidate and position data, officer references, and audit history remain intact.</p>
              <div className="board-election-removal-warning" role="note">
                <ShieldAlert size={17} aria-hidden="true" />
                <p>{isRestore ? "Restoration does not change the election schedule or its history." : "Only draft or concluded elections can be removed. Active, scheduled, campaigning, waiting, and voting elections are protected."}</p>
              </div>
              <label className="board-election-password-label" htmlFor="election-removal-password">Current account password</label>
              <input
                id="election-removal-password"
                name="current-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                maxLength={256}
                disabled={busy}
              />
              {error ? <p className="board-election-removal-error" role="alert">{error}</p> : null}
            </form>
          ) : null}
          {busy ? <p className="board-election-danger-wait">Rechecking your session, permission, password, and current election state.</p> : null}
        </div>

        <div className="board-election-danger-footer">
          {phase === "review" ? (
            <>
              <button type="button" className="board-election-danger-quiet" onClick={onClose}>Cancel</button>
              <button type="button" className="board-election-danger-primary" aria-expanded={detailsOpen} aria-controls="board-election-dependency-detail" onClick={() => setDetailsOpen((open) => !open)}>
                {detailsOpen ? "Hide related" : "Review related"}
              </button>
              {detailsOpen && removalReady && !analysis?.blocked ? <button type="button" className="board-election-danger-button" onClick={onContinue}>Continue to Danger Zone</button> : null}
            </>
          ) : null}
          {phase === "unavailable" ? <><button type="button" className="board-election-danger-quiet" onClick={onClose}>Close</button><button type="button" className="board-election-danger-primary" onClick={onRetry}><RotateCw size={14} aria-hidden="true" /> Retry review</button></> : null}
          {phase === "danger_zone" || busy ? (
            <>
              <button type="button" className="board-election-danger-quiet" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" form="election-removal-confirm-form" className="board-election-danger-button" disabled={busy || phase !== "danger_zone" || !password}>
                {busy ? <KandidButtonLoader label={isRestore ? "Restoring..." : "Removing..."} /> : isRestore ? "Confirm Restoration" : "Confirm Removal"}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </PopupOverlay>
  );
}
