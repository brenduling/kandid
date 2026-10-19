import { useCallback, useEffect, useState } from "react";
import "./BoardRemainingPages.css";
import { RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./VotingMonitor.css";

const EMPTY_SUMMARY = {
  ballots_submitted: 0,
  students_voted: 0,
  anchored: 0,
  processing: 0,
  needs_attention: 0,
};

async function requestBoardMonitor(electionId) {
  try {
    return await supabase.rpc("kandid_get_board_voting_monitor", {
      p_election_id: electionId,
      p_offset: 0,
      p_limit: 50,
    });
  } catch (error) {
    return { data: null, error };
  }
}

function BoardVotingMonitor() {
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");

  const user = JSON.parse(localStorage.getItem("user"));
  const orgName = user?.organizations?.name || "your organization";

  const applyResponse = useCallback(({ data, error }) => {
    if (error) {
      console.error("Unable to load Board ballot monitor.", error.message || error);
      setLoadError("Ballot activity could not be loaded. Refresh and try again.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const result = data || {};
    setElections(Array.isArray(result.elections) ? result.elections : []);
    setSummary({ ...EMPTY_SUMMARY, ...(result.summary || {}) });
    setLoading(false);
    setRefreshing(false);
  }, []);

  const fetchData = useCallback(async (electionValue = selectedElection) => {
    setLoadError("");
    setRefreshing(true);
    setLoading(true);
    const electionId = electionValue === "all" ? null : Number(electionValue);
    applyResponse(await requestBoardMonitor(electionId));
  }, [applyResponse, selectedElection]);

  useEffect(() => {
    let active = true;
    requestBoardMonitor(null).then((response) => {
      if (active) applyResponse(response);
    });
    return () => { active = false; };
  }, [applyResponse]);

  function handleElectionChange(event) {
    const value = event.target.value;
    setSelectedElection(value);
    fetchData(value);
  }

  return (
    <div className="board-remaining-page board-voting-monitor">
      <header className="board-voting-masthead">
        <div className="board-voting-masthead-context">
          <span className="board-voting-eyebrow">Electoral Board / {orgName}</span>
          <span className="board-voting-masthead-rule" aria-hidden="true" />
        </div>

        <div className="board-voting-baseline">
          <h1 className="page-title board-voting-title">Voting Monitor</h1>
          <button
            type="button"
            className="board-voting-refresh"
            onClick={() => fetchData()}
            disabled={refreshing}
          >
            <RefreshCw size={15} aria-hidden="true" className={refreshing ? "is-spinning" : ""} />
            Refresh
          </button>
        </div>

        <p className="board-voting-standfirst">
          Aggregate turnout and anchoring health for {orgName}.
        </p>
      </header>

      <section className="board-voting-context" aria-labelledby="board-voting-context-title">
        <div className="board-voting-section-heading">
          <p className="board-voting-section-label">Election context</p>
          <h2 id="board-voting-context-title">
            {selectedElection === "all"
              ? "All elections"
              : elections.find((election) => String(election.id) === selectedElection)?.title || "Selected election"}
          </h2>
        </div>
        <label className="board-voting-filter">
          <span className="board-voting-filter-label-desktop">Monitor</span>
          <span className="board-voting-filter-label-mobile">Election</span>
          <select value={selectedElection} onChange={handleElectionChange}>
            <option value="all">All Elections</option>
            {elections.map((election) => (
              <option key={election.id} value={election.id}>
                {election.title}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="board-voting-summary" aria-label="Ballot summary" aria-busy={loading}>
        {loading ? (
          <div className="board-voting-summary-skeleton" role="status" aria-label="Loading ballot summary">
            {[0, 1, 2, 3, 4].map((index) => <span key={index} />)}
          </div>
        ) : loadError ? (
          <p className="board-voting-summary-unavailable" role="status">Ballot summary is unavailable.</p>
        ) : (
          <>
            <div className="board-voting-metric board-voting-metric-primary">
              <span>{summary.ballots_submitted === 1 ? "Ballot submitted" : "Ballots submitted"}</span>
              <strong>{summary.ballots_submitted}</strong>
            </div>
            <div className="board-voting-metric board-voting-metric-context">
              <span>{summary.students_voted === 1 ? "Student voted" : "Students voted"}</span>
              <strong>{summary.students_voted}</strong>
            </div>
            <div className="board-voting-anchor-metrics" role="group" aria-label="Ballot anchor status">
              <div className="board-voting-metric is-anchored">
                <span>Anchored</span>
                <strong>{summary.anchored}</strong>
              </div>
              <div className="board-voting-metric is-processing">
                <span>Processing</span>
                <strong>{summary.processing}</strong>
              </div>
              <div className="board-voting-metric is-attention">
                <span>Needs attention</span>
                <strong>{summary.needs_attention}</strong>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="board-voting-activity" aria-labelledby="board-voting-activity-title">
        <div className="board-voting-activity-heading">
          <div>
            <p className="board-voting-section-label">Privacy-protected activity</p>
            <h2 id="board-voting-activity-title">Aggregate ballot status</h2>
          </div>
        </div>
        {loadError ? (
          <p className="board-voting-state is-error" role="alert">{loadError}</p>
        ) : (
          <p className="board-voting-state">
            This monitor reports aggregate turnout and anchoring health. It does not display voter identities or individual ballot activity.
          </p>
        )}
      </section>
    </div>
  );
}

export default BoardVotingMonitor;
