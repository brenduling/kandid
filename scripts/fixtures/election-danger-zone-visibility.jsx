// Isolated component acceptance only: no Supabase client, credentials or network backend.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import BoardElectionDeleteSheet from "../../src/pages/board/BoardElectionDeleteSheet.jsx";
import { verifyElectionRemovalReadiness } from "../../src/utils/electionManagementCompatibility.js";
import { loadElectionDeleteReview, ELECTION_DELETE_DEPENDENCIES } from "../../src/utils/electionDeleteReview.js";
import "../../src/index.css";

export default function Acceptance() {
  const options = new URLSearchParams(location.search);
  const enabled = options.get("enabled") === "true";
  const available = options.get("available") === "true";
  const [state, setState] = useState(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    window.acceptanceEvidence = { readinessCalls: 0, confirmationCalls: 0 };
    void (async () => {
      const ready = await verifyElectionRemovalReadiness(enabled, async () => {
        window.acceptanceEvidence.readinessCalls++;
        return available ? { data: { elections: [], total: 0, limit: 1, offset: 0 } } : { error: new Error("Synthetic unavailable backend") };
      });
      const analysis = await loadElectionDeleteReview(1, async () => ({ data: {
        schema_version: 1, election_id: 1, protected_history: true, may_delete: false,
        counts: Object.fromEntries(ELECTION_DELETE_DEPENDENCIES.map(({ key }) => [key, key === "votes" ? 1 : 0])),
      } }), { removalReady: ready });
      if (!cancelled) setState({ ready, analysis, phase: "review", error: "" });
    })();
    return () => { cancelled = true; };
  }, [enabled, available]);
  if (closed) return <p id="closed">Cancelled without changes</p>;
  if (!state) return <p>Preparing synthetic review</p>;
  return <BoardElectionDeleteSheet
    election={{ id: 1, title: "Synthetic concluded election" }} orgName="Synthetic organization"
    phase={state.phase} analysis={state.analysis} error={state.error} removalReady={state.ready}
    onClose={() => setClosed(true)} onRetry={() => {}}
    onContinue={() => { if (state.ready) setState(current => ({ ...current, phase: "danger_zone" })); }}
    onConfirm={async () => {
      // Deliberately no request or mutation; simulate a server rejection for error rendering.
      window.acceptanceEvidence.confirmationCalls++;
      setState(current => ({ ...current, error: "Synthetic password could not be verified. Retry." }));
    }}
  />;
}

createRoot(document.getElementById("root")).render(<Acceptance />);
