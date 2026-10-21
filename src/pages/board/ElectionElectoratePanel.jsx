import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { formatLocalDateTime, scheduleTimestampToFormValue } from "../../utils/elections";
import { electorateLockBlock, electorateReadinessLabel, finalizeElectorate, readElectoratePreview } from "../../utils/electorateFinalization";

function readableLockError(message) {
  const value = String(message || "");
  if (/Voting start has passed/i.test(value)) {
    return "Voting cannot open because the electorate was not locked before the scheduled start. Move the voting start into the future, save the schedule, then lock the electorate.";
  }
  if (/academic term/i.test(value)) return "Choose an academic term before locking the electorate.";
  if (/valid voting start and end/i.test(value)) return "Set a valid voting start and end before locking the electorate.";
  if (/Active before locking/i.test(value)) return "Set the election to Active before locking its electorate.";
  if (/eligibility|eligible voters|snapshot|voting history|active academic term|backend|confirmed/i.test(value)) return value;
  return "The electorate could not be locked. Refresh the preview and try again.";
}

function isElection4LegacyPreview(preview, electionId) {
  return Number(electionId) === 4 && Number(preview?.policy_version) === 1 && preview?.eligibility_contract == null;
}

export default function ElectionElectoratePanel({ election, form, onLocked }) {
  const prompt = usePrompt();
  const electionId = Number(election?.id);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const notifiedLock = useRef(null);

  useEffect(() => {
    if (!electionId) return undefined;
    let current = true;
    const load = () => readElectoratePreview(supabase, electionId)
      .then((data) => {
        if (!current) return;
        setError("");
        setPreview(data);
        if (data.is_locked && data.locked_at && notifiedLock.current !== data.locked_at) {
          notifiedLock.current = data.locked_at;
          onLocked?.(data);
        }
      })
      .catch(() => {
        if (!current) return;
        setError("Electorate preview could not be verified. Refresh or check your Board session.");
        setPreview(null);
      });
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [electionId, onLocked]);

  const refreshPreview = useCallback(async () => {
    if (!electionId) return;
    setBusy(true);
    setError("");
    try {
      setPreview(await readElectoratePreview(supabase, electionId));
    } catch {
      setError("Electorate preview could not be verified. Refresh or check your Board session.");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, [electionId]);

  async function retryFinalization() {
    if (busy || electorateLockBlock(preview, electionId)) return;
    const election4Recovery = isElection4LegacyPreview(preview, electionId);
    const term = [preview.semester, preview.academic_year && `AY ${preview.academic_year}`]
      .filter(Boolean)
      .join(" ");
    const confirmed = await prompt.confirm({
      title: election4Recovery ? "Lock Election 4 electorate?" : "Retry electorate finalization?",
      message: `${preview.election_title || election.title}\n\nAcademic term: ${term || "Unavailable"}\nScheduled voting start: ${formatLocalDateTime(preview.scheduled_voting_start)}\nCurrent preview: ${preview.eligible_voters ?? "Unavailable"} eligible members\n\n${election4Recovery
        ? "The existing authenticated Board operation recomputes verified active organization membership for this term and freezes the electorate atomically. The lock is immutable."
        : "The scheduled worker normally finalizes automatically. This retry is available only after its due time. The server recomputes the electorate and freezes it atomically."}`,
      type: "primary",
      confirmText: election4Recovery ? "Lock Electorate" : "Retry Finalization",
    });
    if (!confirmed) return;

    setBusy(true);
    setError("");
    try {
      const data = await finalizeElectorate(supabase, electionId);
      setPreview(data);
      if (data.is_locked) {
        notifiedLock.current = data.locked_at;
        onLocked?.(data);
        prompt.success(election4Recovery
          ? "Election 4's electorate is locked. Candidates become available when the voting window is open."
          : "The election electorate is finalized.");
      } else {
        prompt.info(data.reason_code === "NOT_DUE" ? "Finalization is scheduled automatically before voting starts." : "Finalization is still pending. Refresh the readiness details.");
        await refreshPreview();
      }
    } catch (requestError) {
      setError(readableLockError(requestError.message));
      // No automatic replay after an uncertain response. Refresh reconciles the
      // authoritative frozen state, including a lock committed before disconnect.
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  const termLabel = preview
    ? [preview.semester, preview.academic_year && `AY ${preview.academic_year}`].filter(Boolean).join(" ")
    : "Loading term context";
  const locked = Boolean(preview?.is_locked);
  const lockBlock = electorateLockBlock(preview, electionId);
  const election4Recovery = isElection4LegacyPreview(preview, electionId);
  const hasUnsavedLockContext = Boolean(form) && (
    String(form.academic_term_id || "") !== String(election.academic_term_id || "")
    || String(form.start_date || "") !== scheduleTimestampToFormValue(election.start_date)
    || String(form.end_date || "") !== scheduleTimestampToFormValue(election.end_date)
    || String(form.status || "") !== String(election.status || "")
  );

  return (
    <section className="board-election-electorate" aria-labelledby="board-election-electorate-title">
      <div className="board-election-setup-heading">
        <p className="board-election-sheet-kicker">Electorate</p>
        <div>
          <h3 id="board-election-electorate-title">Voting eligibility</h3>
          <p>{election4Recovery
            ? "Keep Election 4's existing voting schedule. Its current-window electorate recovery requires separate approval."
            : "Activation schedules the electorate freeze automatically, ten minutes before voting begins."}</p>
        </div>
      </div>

      <dl className="board-election-electorate-facts">
        <div><dt>Academic term</dt><dd>{termLabel || "Term unavailable"}</dd></div>
        <div><dt>Eligible voters</dt><dd>{preview?.eligible_voters ?? "—"}</dd></div>
        <div><dt>Voting starts</dt><dd>{preview?.scheduled_voting_start ? formatLocalDateTime(preview.scheduled_voting_start) : "Not set"}</dd></div>
        <div><dt>Status</dt><dd>{election4Recovery && !locked
          ? (lockBlock ? "Recovery required" : "Ready to lock")
          : electorateReadinessLabel(preview)}{locked ? ` · ${formatLocalDateTime(preview.locked_at)}` : ""}</dd></div>
      </dl>

      {locked ? (
        <p className="board-election-electorate-note">
          This snapshot and the turnout denominator are immutable. Current authentication, enrollment, membership, eligibility and voting-time checks still apply when a student opens or submits a ballot.
        </p>
      ) : (
        <>
          <p className="board-election-electorate-note">{election4Recovery
            ? "No additional eligibility rules are configured. The Board lock operation recomputes verified active organization membership and enrollment for this term."
            : `${preview?.eligibility_mode === "membership_only"
              ? "No additional rules are configured. Eligibility uses verified active organization membership and enrollment for this term."
              : preview?.eligibility_mode === "membership_plus_rules"
                ? "Saved eligibility rules further restrict verified active organization membership and enrollment for this term."
                : "Eligibility readiness is not available from the backend."} The worker refreshes the audience at finalization time, so legitimate enrollment completed before then is included.`}</p>
          {preview?.blocking_reason ? <p className="board-election-electorate-block" role="status">{election4Recovery && /Voting start has passed/i.test(preview.blocking_reason)
            ? "The normal lock deadline has passed. Keep the current voting schedule; the approved one-time recovery operation is required."
            : preview.blocking_reason}</p> : null}
          {!election4Recovery && preview?.scheduled_finalization_at ? <p className="board-election-electorate-note">Scheduled for {formatLocalDateTime(preview.scheduled_finalization_at)} · {preview.attempts || 0} attempt(s){preview.next_attempt_at ? ` · next retry ${formatLocalDateTime(preview.next_attempt_at)}` : ""}</p> : null}
          {lockBlock && lockBlock !== preview?.blocking_reason ? <p className="board-election-electorate-block" role="status">{lockBlock}</p> : null}
          {hasUnsavedLockContext ? <p className="board-election-electorate-block" role="status">Save the term, voting schedule, and status changes before locking this electorate.</p> : null}
          {error ? <p className="board-election-electorate-error" role="alert">{error}</p> : null}
          <div className="board-election-electorate-actions">
            <button type="button" className="board-election-setup-quiet" onClick={refreshPreview} disabled={busy}>
              <RefreshCw size={15} aria-hidden="true" /> Refresh preview
            </button>
            <button type="button" className="board-election-setup-next" onClick={retryFinalization} disabled={busy || Boolean(lockBlock) || hasUnsavedLockContext}>
              {election4Recovery ? "Lock electorate" : "Retry finalization"}
            </button>
          </div>
        </>
      )}
      {error && locked ? <p className="board-election-electorate-error" role="alert">{error}</p> : null}
    </section>
  );
}
