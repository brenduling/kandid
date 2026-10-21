import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { activateAcademicTerm, createAcademicTerm, formatAcademicTerm, getAcademicTermTransitionStatus, previewAcademicTerm } from "../../utils/academicTerms";
import { getAcademicTermTransitionView } from "../../utils/academicTermTransitionPresentation";
import { formatUtcTimestampAsManilaDateTime } from "../../utils/time";
import "./AcademicTermDangerZone.css";

const impactCounts = [
  ["persistent_accounts", "Persistent student accounts"],
  ["source_enrolled_students", "Students enrolled in the current term"],
  ["target_enrolled_students", "Verified enrollment in the selected term"],
  ["active_accounts_requiring_verification", "Active accounts requiring enrollment verification"],
  ["verified_program_shifts", "Verified program shifts"],
  ["intended_program_memberships", "Program memberships derived from verified enrollment"],
  ["intended_institution_memberships", "Institution-wide memberships derived from verified enrollment"],
  ["target_explicit_removals_preserved", "Explicit target-term removals preserved"],
  ["conflicting_program_memberships", "Program membership conflicts"],
  ["blocking_elections", "Blocking ongoing or scheduled elections"],
  ["notification_recipients", "Students receiving a semester notification"],
];

function Confirmation({ review, busy, onActivate }) {
  const heading = useRef(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [now, setNow] = useState(Date.now);
  const expired = !Number.isFinite(Date.parse(review.expires_at)) || now >= Date.parse(review.expires_at);
  useEffect(() => {
    heading.current?.focus();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <form className="term-review" onSubmit={event => {
    event.preventDefault();
    if (!busy && !expired && acknowledged && confirmation === review.confirmation_text) onActivate(confirmation);
  }}>
    <h3 ref={heading} tabIndex={-1}>Confirm academic term activation</h3>
    <p>Review expires: {formatUtcTimestampAsManilaDateTime(review.expires_at)}. Any relevant data change requires a fresh preview.</p>
    <label className="term-acknowledgement">
      <input type="checkbox" disabled={busy || expired} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
      <span>I understand this closes the current term and requires verified new-term enrollment for voting and candidacy. Student accounts and historical records are preserved.</span>
    </label>
    <label htmlFor="term-confirmation">Type <strong>{review.confirmation_text}</strong></label>
    <input id="term-confirmation" className="field-shell" autoComplete="off" spellCheck={false} disabled={busy || expired}
      value={confirmation} onChange={event => setConfirmation(event.target.value)} aria-describedby="term-confirmation-help" />
    <p id="term-confirmation-help">Exact text and acknowledgement required. Activation sends student notifications and records a durable audit event.</p>
    {expired ? <p role="alert">This review has expired. Request a new impact preview.</p> : null}
    <button type="submit" className="term-activate-button" disabled={busy || expired || !acknowledged || confirmation !== review.confirmation_text}>
      {busy ? "Activating academic term…" : "Activate academic term"}
    </button>
  </form>;
}

export default function AcademicTermDangerZone({ terms, loading, unavailable, error, onRefresh, authorized, actorKey }) {
  const storageKey = actorKey ? `kandid-academic-term-operation-${actorKey}` : null;
  const [selectedId, setSelectedId] = useState("");
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(null);
  const [pending, setPending] = useState(() => {
    try {
      const operation = storageKey && sessionStorage.getItem(storageKey);
      return /^[0-9a-f-]{36}$/i.test(operation || "") ? operation : null;
    } catch { return null; }
  });
  const [receipt, setReceipt] = useState(null);
  const actionLock = useRef(false);
  const { activeTerm, nextTerm, canCreateDraft, nextDraftTerms, closedTerms, blockedReason } = getAcademicTermTransitionView(terms);
  const selectedTerm = nextDraftTerms.find(term => String(term.id) === selectedId);
  const readFailed = unavailable || Boolean(error);

  function clearPending() {
    if (storageKey) sessionStorage.removeItem(storageKey);
    setPending(null);
  }
  async function run(action, operation) {
    if (actionLock.current || !authorized) return;
    actionLock.current = true; setBusy(action); setMessage(null);
    try { await operation(); }
    catch (failure) { setMessage({ error: true, text: failure.message || "Request interrupted. Recover any pending operation before retrying." }); }
    finally { actionLock.current = false; setBusy(""); }
  }
  async function committed(data) {
    setReceipt(data); setReview(null); clearPending();
    setMessage({ text: `${formatAcademicTerm(data.academic_term)} activated. ${data.notification_count} student notifications recorded. Audit #${data.audit_id}.` });
    await onRefresh();
  }
  function activate(confirmationText) {
    run("activate", async () => {
      // Persist before sending: a lost response is not proof of rollback.
      if (!storageKey) throw Error("Administrator identity is unavailable. Sign in again before activation.");
      sessionStorage.setItem(storageKey, review.operation_id);
      setPending(review.operation_id);
      const result = await activateAcademicTerm({ operationId: review.operation_id, confirmationText });
      if (result.error) {
        setReview(null);
        setMessage({ error: true, text: result.error.message }); return;
      }
      await committed(result.data);
    });
  }
  function recover() {
    run("recover", async () => {
      const { data, error: failure } = await getAcademicTermTransitionStatus(pending);
      if (failure) { setMessage({ error: true, text: failure.message }); return; }
      if (data.status === "committed") { await committed(data); return; }
      if (data.can_refresh === true) {
        clearPending(); setReview(null);
        setMessage({ text: "The server invalidated this expired or changed review. Request a fresh impact preview before activation." }); return;
      }
      // A visible review can belong to an in-flight transaction. Retry only
      // this same idempotent operation; never silently create a new review.
      setReview(data);
      setMessage({ text: "No committed receipt is visible yet. Check again, or explicitly confirm a retry of this same operation. An in-flight request may still finish." });
    });
  }
  const locked = loading || readFailed || Boolean(busy) || !authorized;
  return <section className="academic-term-danger-zone" aria-labelledby="term-management-title" aria-busy={Boolean(busy)}>
    <div className="term-zone-heading">
      <div>
        <p className="term-danger-label"><AlertTriangle size={15} aria-hidden="true" /> Danger Zone</p>
        <h2 id="term-management-title">Academic Term Management</h2>
        <p>Changing the academic year or semester affects enrollment verification and election eligibility across the institution.</p>
      </div>
      <button className="secondary-btn" type="button" disabled={loading || Boolean(busy)} onClick={() => { setReview(null); setSelectedId(""); onRefresh(); }}>
        <RefreshCw size={16} aria-hidden="true" /> Refresh terms
      </button>
    </div>
    {message ? <p className={message.error ? "term-load-error" : "term-review-feedback"} role={message.error ? "alert" : "status"}>{message.text}</p> : null}
    {pending ? <div className="term-review-feedback">
      <p>Transition outcome needs verification. Operation: <code>{pending}</code>. Keep this reference until a committed receipt is recovered.</p>
      <button type="button" className="secondary-btn" disabled={Boolean(busy) || !authorized} onClick={recover}>{busy === "recover" ? "Checking transition…" : "Check transition status"}</button>
    </div> : null}
    {loading ? <p role="status">Loading current academic term…</p> : readFailed ? <p role="alert" className="term-load-error">{unavailable
      ? "The academic term database contract is unavailable. Complete the approved backend installation before managing terms."
      : "Academic terms could not be loaded. Refresh to retry; the current term is unconfirmed."}</p> : <>
      <dl className="term-current-register">
        <div><dt>Current academic year</dt><dd>{activeTerm?.academic_year || "Unconfirmed"}</dd></div>
        <div><dt>Current semester</dt><dd>{activeTerm?.semester || "Unconfirmed"}</dd></div>
        <div><dt>Term status</dt><dd>{activeTerm ? "Active" : "Requires review"}</dd></div>
      </dl>
      {activeTerm ? <p>Activated: {formatUtcTimestampAsManilaDateTime(activeTerm.activated_at)}</p> : null}
      {!authorized ? <p role="alert">A verified, linked Supabase Auth Super Admin session is required for term changes.</p> : null}
      {blockedReason ? <p role="alert" className="term-load-error">{blockedReason}</p> : <>
        <div className="term-next-selection">
          <label htmlFor="next-academic-term">Next academic term</label>
          <select id="next-academic-term" className="field-shell" disabled={locked || Boolean(pending)} value={selectedId} onChange={event => { setSelectedId(event.target.value); setReview(null); setMessage(null); }}>
            <option value="">Select the immediate next draft</option>
            {nextDraftTerms.map(term => <option key={term.id} value={term.id}>{formatAcademicTerm(term)}</option>)}
          </select>
          {!nextDraftTerms.length ? <p>No immediate next draft is available. {canCreateDraft ? "Prepare it below before reviewing activation." : "The next term already exists; its status requires administrative review."}</p> : null}
        </div>
        {canCreateDraft ? <div className="term-draft-creation">
          <h3>Prepare next semester</h3>
          <p>{formatAcademicTerm(nextTerm)}. Creating this draft leaves current eligibility unchanged and sends no notifications.</p>
          <button type="button" className="secondary-btn" disabled={locked || Boolean(pending)} onClick={() => run("create", async () => {
            const result = await createAcademicTerm(nextTerm);
            if (result.error) { setMessage({ error: true, text: result.error.message }); return; }
            setReview(null); setSelectedId(String(result.data.id));
            setMessage({ text: `${formatAcademicTerm(result.data)} is ready as a draft. The current term is unchanged.` });
            await onRefresh();
          })}>{busy === "create" ? "Creating draft…" : "Create Draft Term"}</button>
        </div> : null}
        <div className="term-impact-summary">
          <h3>Activation impact</h3>
          <ul className="term-safeguards">
            <li>Accounts and normal navigation remain available under existing access policies. Voting and candidacy require verified current-term enrollment.</li>
            <li>Authorized masterlist and Electoral Board verification restore eligibility. Year levels are not advanced automatically.</li>
            <li>Verified program shifts reconcile current program memberships. WITSG remains institution-wide under institutional eligibility rules.</li>
            <li>Previous memberships, enrollment, elections, candidates, officers, votes and receipts are preserved. Election schedules are unchanged.</li>
          </ul>
          <button type="button" className="secondary-btn" disabled={locked || !selectedTerm || Boolean(pending)} onClick={() => run("preview", async () => {
            setReview(null);
            const result = await previewAcademicTerm(selectedTerm.id);
            if (result.error) { setMessage({ error: true, text: result.error.message }); return; }
            setReceipt(null); setReview(result.data);
          })}>{busy === "preview" ? "Calculating impact…" : "Preview activation impact"}</button>
          {review ? <>
            <p>Authoritative preview: {formatAcademicTerm(review.impact?.source_term)} → {formatAcademicTerm(review.impact?.target_term)}</p>
            <dl className="term-impact-counts">{impactCounts.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{Number.isSafeInteger(review.impact?.counts?.[key]) ? review.impact.counts[key].toLocaleString() : "Unavailable"}</dd></div>)}</dl>
            {review.impact?.blockers?.length ? <ul role="alert" className="term-load-error">{review.impact.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul> : null}
          </> : <p>Request a server impact preview to see actual affected counts and activation blockers.</p>}
        </div>
        {review?.impact?.can_activate === true && authorized ? <Confirmation key={review.operation_id} review={review} busy={Boolean(busy) || loading || readFailed} onActivate={activate} /> : null}
      </>}
      <details className="term-configuration-history"><summary>Closed academic terms <span>({closedTerms.length})</span></summary>
        {closedTerms.length ? <ul>{closedTerms.map(term => <li key={term.id}>{formatAcademicTerm(term)} <span>Closed</span></li>)}</ul> : <p>No closed academic terms were returned.</p>}
      </details>
    </>}
    <div className="term-audit-note">
      <h3>Transition audit trail</h3>
      <p>Activations record the verified administrator, source and target terms, time, impact and notification outcome in one database transaction.</p>
      {receipt ? <p>Operation {receipt.operation_id} · Audit #{receipt.audit_id} · {formatUtcTimestampAsManilaDateTime(receipt.committed_at)}</p> : null}
      <Link to="/super-admin/audit-logs">Open Audit Logs</Link>
    </div>
  </section>;
}
