import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { formatLocalDateTime, scheduleTimestampToFormValue } from "../../utils/elections";

function readableLockError(message) {
  const value = String(message || "");
  if (/Voting start has passed/i.test(value)) {
    return "Voting cannot open because the electorate was not locked before the scheduled start. Move the voting start into the future, save the schedule, then lock the electorate.";
  }
  if (/academic term/i.test(value)) return "Choose an academic term before locking the electorate.";
  if (/valid voting start and end/i.test(value)) return "Set a valid voting start and end before locking the electorate.";
  if (/Active before locking/i.test(value)) return "Set the election to Active before locking its electorate.";
  return "The electorate could not be locked. Refresh the preview and try again.";
}

export default function ElectionElectoratePanel({ election, form, onLocked }) {
  const prompt = usePrompt();
  const electionId = Number(election?.id);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!electionId) return undefined;
    let current = true;
    supabase.rpc("kandid_get_board_electorate_preview", { p_election_id: electionId })
      .then(({ data, error: requestError }) => {
        if (!current) return;
        if (requestError) {
          setError("Electorate preview is unavailable. Confirm the Phase 2 database migration is installed, then retry.");
          setPreview(null);
        } else {
          setError("");
          setPreview(data || null);
        }
      })
      .catch(() => {
        if (!current) return;
        setError("Electorate preview is unavailable. Confirm the Phase 2 database migration is installed, then retry.");
        setPreview(null);
      });
    return () => {
      current = false;
    };
  }, [electionId]);

  const refreshPreview = useCallback(async () => {
    if (!electionId) return;
    setBusy(true);
    setError("");
    const { data, error: requestError } = await supabase.rpc(
      "kandid_get_board_electorate_preview",
      { p_election_id: electionId },
    );
    if (requestError) {
      setError("Electorate preview is unavailable. Confirm the Phase 2 database migration is installed, then retry.");
      setPreview(null);
    } else {
      setPreview(data || null);
    }
    setBusy(false);
  }, [electionId]);

  async function lockElectorate() {
    if (!preview?.locking_allowed) return;
    const term = [preview.semester, preview.academic_year && `AY ${preview.academic_year}`]
      .filter(Boolean)
      .join(" ");
    const confirmed = await prompt.confirm({
      title: "Lock election electorate?",
      message: `${preview.election_title || election.title}\n\nAcademic term: ${term || "Unavailable"}\nScheduled voting start: ${formatLocalDateTime(preview.scheduled_voting_start)}\nLive preview: ${preview.eligible_voters ?? "Unavailable"} eligible voters\n\nThe server will recompute the final count. Once locked, this electorate cannot be changed and will determine who may vote and the turnout denominator.`,
      type: "primary",
      confirmText: "Lock Electorate",
    });
    if (!confirmed) return;

    setBusy(true);
    setError("");
    const { data, error: requestError } = await supabase.rpc(
      "kandid_lock_board_electorate",
      { p_election_id: electionId },
    );
    if (requestError) {
      setError(readableLockError(requestError.message));
      setBusy(false);
      return;
    }
    setPreview(data || null);
    onLocked?.(data);
    setBusy(false);
    prompt.success("The election electorate is locked.");
  }

  const termLabel = preview
    ? [preview.semester, preview.academic_year && `AY ${preview.academic_year}`].filter(Boolean).join(" ")
    : "Loading term context";
  const locked = Boolean(preview?.is_locked);
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
          <p>Review the live eligible-member count, then lock the electorate before voting begins.</p>
        </div>
      </div>

      <dl className="board-election-electorate-facts">
        <div><dt>Academic term</dt><dd>{termLabel || "Term unavailable"}</dd></div>
        <div><dt>Eligible voters</dt><dd>{preview?.eligible_voters ?? "—"}</dd></div>
        <div><dt>Voting starts</dt><dd>{preview?.scheduled_voting_start ? formatLocalDateTime(preview.scheduled_voting_start) : "Not set"}</dd></div>
        <div><dt>Status</dt><dd>{locked ? `Locked ${formatLocalDateTime(preview.locked_at)}` : "Live preview"}</dd></div>
      </dl>

      {locked ? (
        <p className="board-election-electorate-note">
          This electorate is authoritative and immutable. Later enrollment, membership, or program-coverage changes will not affect who may vote or the turnout denominator.
        </p>
      ) : (
        <>
          <p className="board-election-electorate-note">
            Eligibility may change until locking. The final electorate is recomputed by Kandid when you confirm.
          </p>
          {preview?.blocking_reason ? <p className="board-election-electorate-block" role="status">{preview.blocking_reason}</p> : null}
          {hasUnsavedLockContext ? <p className="board-election-electorate-block" role="status">Save the term, voting schedule, and status changes before locking this electorate.</p> : null}
          {error ? <p className="board-election-electorate-error" role="alert">{error}</p> : null}
          <div className="board-election-electorate-actions">
            <button type="button" className="board-election-setup-quiet" onClick={refreshPreview} disabled={busy}>
              <RefreshCw size={15} aria-hidden="true" /> Refresh preview
            </button>
            <button type="button" className="board-election-setup-next" onClick={lockElectorate} disabled={busy || !preview?.locking_allowed || hasUnsavedLockContext}>
              Lock electorate
            </button>
          </div>
        </>
      )}
      {error && locked ? <p className="board-election-electorate-error" role="alert">{error}</p> : null}
    </section>
  );
}
