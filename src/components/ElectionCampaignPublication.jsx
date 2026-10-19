import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { usePrompt } from "../context/PromptContext";
import { loadElectionCampaignPublication, publishElectionCampaigns, campaignPublicationError } from "../utils/electionCampaignPublication";
import "./ElectionCampaignPublication.css";

const statusLabels = { empty: "No eligible campaigns", draft: "Draft", published: "Published", changes_pending: "New campaigns awaiting publication", blocked: "Review required" };

export default function ElectionCampaignPublication({ electionId, revision, readonly = false, onPublished }) {
  const prompt = usePrompt();
  const [loaded, setLoaded] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  const activeElection = useRef(electionId);
  const enabled = import.meta.env.VITE_ENABLE_CANDIDATE_MANAGEMENT === "true";
  const current = loaded?.electionId === electionId && loaded?.revision === revision && loaded?.reload === reload;
  const loading = !current;
  const review = current ? loaded.review : null;
  const error = operationError?.electionId === electionId ? operationError.message : current ? loaded.error : "";

  useEffect(() => {
    let current = true;
    activeElection.current = electionId;
    loadElectionCampaignPublication(supabase, electionId)
      .then(data => { if (current) setLoaded({ electionId, revision, reload, review: data, error: "" }); })
      .catch(failure => { if (current) setLoaded({ electionId, revision, reload, review: null, error: campaignPublicationError(failure) }); });
    return () => { current = false; activeElection.current = null; };
  }, [electionId, revision, reload]);

  async function publish() {
    if (!review?.can_publish || readonly || !enabled || inFlight.current) return;
    inFlight.current = true;
    const targetElection = electionId;
    try {
      const confirmed = await prompt.confirm({
        title: "Publish all eligible campaigns?",
        message: `${review.eligible_candidates} eligible candidate campaign(s) in this election will be visible to eligible students during its campaign window. ${review.hidden_candidates} hidden campaign(s) remain excluded. Candidates added later will stay Draft until you review and publish again.`,
        confirmText: "Publish All Campaigns", cancelText: "Cancel", type: "warning",
      });
      if (!confirmed || activeElection.current !== targetElection) return;
      setPublishing(true);
      setOperationError(null);
      let mutationError;
      try { await publishElectionCampaigns(supabase, review); }
      catch (failure) { mutationError = failure; }
      // This readback confirms actual persisted state, including an ambiguous
      // response. It never retries the write or publishes later additions.
      const persisted = await loadElectionCampaignPublication(supabase, targetElection);
      if (activeElection.current !== targetElection) return;
      setLoaded({ electionId, revision, reload, review: persisted, error: "" });
      await onPublished?.();
      if (persisted.publication_status === "published" && persisted.draft_candidates === 0 && persisted.invalid_candidates === 0) {
        prompt.success("All eligible campaigns are published.");
      } else {
        setOperationError({ electionId, message: mutationError ? campaignPublicationError(mutationError) : "The roster has new or changed campaigns. Review the current state before publishing again." });
      }
    } catch (failure) {
      if (activeElection.current === targetElection) setOperationError({ electionId, message: campaignPublicationError(failure) });
    } finally {
      inFlight.current = false;
      setPublishing(false);
    }
  }

  return (
    <section className="election-campaign-publication" aria-labelledby="election-campaign-publication-title" aria-busy={loading || publishing}>
      <div className="election-campaign-publication-heading">
        <div><p className="page-kicker">Student campaign visibility</p><h3 id="election-campaign-publication-title">Campaign publication</h3></div>
        <button type="button" className="primary-btn" disabled={loading || publishing || !review?.can_publish || readonly || !enabled} onClick={publish}>
          {publishing ? "Publishing..." : "Publish All Campaigns"}
        </button>
      </div>
      {loading ? <p role="status">Checking the selected election&apos;s saved roster...</p> : null}
      {!loading && review ? <>
        <dl className="election-campaign-publication-summary">
          <div><dt>Publication status</dt><dd>{statusLabels[review.publication_status]}</dd></div>
          <div><dt>Total candidates</dt><dd>{review.total_candidates}</dd></div>
          <div><dt>Eligible for publication</dt><dd>{review.eligible_candidates}</dd></div>
          <div><dt>Published</dt><dd>{review.published_candidates}</dd></div>
        </dl>
        <p>New candidates save as Draft and require explicit publication. Editing does not change a campaign&apos;s publication status; changes to published campaigns remain visible. Save the complete roster and materials before publishing.</p>
        {review.hidden_candidates > 0 ? <p>{review.hidden_candidates} hidden campaign(s) remain excluded.</p> : null}
        {review.issues.length > 0 ? <ul className="election-campaign-publication-issues">{review.issues.map((issue, index) => <li key={`${issue.candidate_id}-${index}`}>{issue.candidate_id ? `Candidate ${issue.candidate_id}: ` : ""}{issue.message}</li>)}</ul> : null}
      </> : null}
      {!enabled && !readonly ? <p>Publication writes are disabled in this development session.</p> : null}
      {error ? <div className="election-campaign-publication-error" role="alert"><p>{error}</p><button type="button" className="secondary-btn" disabled={loading || publishing} onClick={() => { setOperationError(null); setReload(value => value + 1); }}>Retry review</button></div> : null}
    </section>
  );
}
