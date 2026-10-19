import { useCallback, useEffect, useRef, useState } from "react";
import "./Dashboard.css";
import { RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { getElectionPhase } from "../../utils/elections";
import { countOperationalElections } from "../../utils/electionLifecycle";
import { useElectionClock } from "../../utils/useElectionClock";
import { callVoteAccess } from "../../utils/voteAccess";
import { toBoardFacingError } from "../../utils/boardFeedback";
import {
  boardAuditActionLabel,
  boardAuditActorLabel,
  boardAuditCategoryLabel,
  boardAuditTargetLabel,
  buildBoardAuditRpcArgs,
} from "../../utils/boardAuditTrail";
import { electionPhaseLabel } from "./electionDisplay";
import { usePrompt } from "../../context/PromptContext";

const SCHEDULE_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const SCHEDULE_CLOCK = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/* Presentation only: typesets the existing start/end timestamps into a
   compact single-line schedule. Same values, no data or query change. */
function formatElectionSchedule(start, end) {
  if (!start && !end) return "No schedule recorded";
  if (!start) return `No start date \u00b7 ${SCHEDULE_DAY.format(new Date(end))}`;
  if (!end) return `${SCHEDULE_DAY.format(new Date(start))} \u00b7 No end date`;

  const from = new Date(start);
  const to = new Date(end);
  const sameDay = SCHEDULE_DAY.format(from) === SCHEDULE_DAY.format(to);

  if (sameDay) {
    return `${SCHEDULE_DAY.format(from)} \u00b7 ${SCHEDULE_CLOCK.format(from)} \u2013 ${SCHEDULE_CLOCK.format(to)}`;
  }

  return `${SCHEDULE_DAY.format(from)} \u2013 ${SCHEDULE_DAY.format(to)}`;
}

function formatDashboardActivityTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function DashboardSkeleton() {
  return (
    <div className="board-dashboard-skeleton" role="status" aria-label="Loading dashboard" aria-busy="true">
      <span className="sr-only">Loading dashboard information</span>
      <section className="board-dashboard-pulse">
        <div className="board-dashboard-section-head">
          <div className="board-dashboard-skeleton-copy">
            <span className="board-dashboard-skeleton-bar is-short" />
            <span className="board-dashboard-skeleton-bar is-heading" />
          </div>
        </div>
        <div className="board-dashboard-skeleton-metrics">
          {Array.from({ length: 6 }, (_, index) => <span className="board-dashboard-skeleton-metric" key={index} />)}
        </div>
      </section>
      {[
        ["Elections", "Election record"],
        ["Recent activity", "Recent action"],
      ].map(([label, rowLabel]) => (
        <section className="board-dashboard-skeleton-register" key={label} aria-label={`Loading ${label}`}>
          <div className="board-dashboard-skeleton-copy">
            <span className="board-dashboard-skeleton-bar is-short" />
            <span className="board-dashboard-skeleton-bar is-heading" />
          </div>
          {[0, 1, 2].map((row) => (
            <div className="board-dashboard-skeleton-row" key={`${rowLabel}-${row}`}>
              <span className="board-dashboard-skeleton-bar is-medium" />
              <span className="board-dashboard-skeleton-bar is-long" />
              <span className="board-dashboard-skeleton-bar is-short" />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function BoardDashboard() {
  const { error: showError } = usePrompt();
  const hasLoaded = useRef(false);
  const activityRequestId = useRef(0);
  const [stats, setStats] = useState({
    elections: 0,
    positions: 0,
    candidates: 0,
    votes: 0,
    voters: 0,
  });
  const [recentElections, setRecentElections] = useState([]);
  const [lifecycleElections, setLifecycleElections] = useState([]);
  const [recentActivities, setRecentActivities] = useState([]);
  const serverNow = useElectionClock();
  const activeElectionCount = countOperationalElections(lifecycleElections, serverNow);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState("");

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;
  const orgName = user?.organizations?.name || "Assigned Organization";

  const loadDashboardData = useCallback(async (isActive = () => true) => {
    const firstLoad = !hasLoaded.current;
    if (firstLoad) setLoading(true);
    else setRefreshing(true);
    setLoadError("");

    try {
      if (!orgId) {
        throw new Error("This Electoral Board account has no assigned organization. Ask a Super Admin to assign one.");
      }

      const electionResult = await supabase
        .from("elections")
        .select("id, title, campaign_start, campaign_end, start_date, end_date, status, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (electionResult.error) throw electionResult.error;
      const electionsData = electionResult.data || [];
      const electionIds = electionsData.map((election) => election.id);

      let positionsData = [];
      let candidatesData = [];
      let voteSummary = { votes: 0, voters: 0 };

      if (electionIds.length > 0) {
        const [positionResult, voteResult] = await Promise.all([
          supabase.from("positions").select("id").in("election_id", electionIds),
          callVoteAccess("board_dashboard_counts", { election_ids: electionIds }),
        ]);
        if (positionResult.error) throw positionResult.error;
        if (voteResult.error) throw voteResult.error;
        positionsData = positionResult.data || [];
        voteSummary = Object.values(voteResult.data?.by_election || {}).reduce((summary, item) => ({
          votes: summary.votes + Number(item.votes || 0),
          voters: summary.voters + Number(item.voters || 0),
        }), { votes: 0, voters: 0 });

        const positionIds = positionsData.map((position) => position.id);
        if (positionIds.length > 0) {
          const candidateResult = await supabase.from("candidates").select("id").in("position_id", positionIds);
          if (candidateResult.error) throw candidateResult.error;
          candidatesData = candidateResult.data || [];
        }
      }

      if (!isActive()) return;

      setStats({
        elections: electionsData.length,
        positions: positionsData.length,
        candidates: candidatesData.length,
        votes: voteSummary.votes,
        voters: voteSummary.voters,
      });
      setLifecycleElections(electionsData);
      setRecentElections(electionsData.slice(0, 5));
      hasLoaded.current = true;
    } catch (error) {
      console.error("Failed to load Board dashboard data:", error);
      if (!isActive()) return;
      if (hasLoaded.current) {
        showError("Dashboard refresh failed. The last loaded information is still shown.");
      } else {
        setLoadError("Dashboard information could not be loaded. Check your connection and try again.");
      }
    } finally {
      if (isActive()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [orgId, showError]);

  const loadRecentActivity = useCallback(async (isActive = () => true) => {
    const requestId = activityRequestId.current + 1;
    activityRequestId.current = requestId;
    setActivityLoading(true);
    setActivityError("");

    try {
      const { data, error } = await supabase.rpc(
        "kandid_list_board_audit_events",
        buildBoardAuditRpcArgs({ pageSize: 5 }),
      );
      if (error) throw error;
      if (!isActive() || activityRequestId.current !== requestId) return;
      setRecentActivities(Array.isArray(data?.events) ? data.events.slice(0, 5) : []);
    } catch (error) {
      if (!isActive() || activityRequestId.current !== requestId) return;
      setActivityError(toBoardFacingError(error?.message, "Recent activity is temporarily unavailable."));
      setRecentActivities([]);
    } finally {
      if (isActive() && activityRequestId.current === requestId) setActivityLoading(false);
    }
  }, []);

  const fetchDashboardData = useCallback(async () => {
    await Promise.all([loadDashboardData(() => true), loadRecentActivity(() => true)]);
  }, [loadDashboardData, loadRecentActivity]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) {
        loadDashboardData(() => active);
        loadRecentActivity(() => active);
      }
    });
    window.addEventListener("kandid-audit-updated", fetchDashboardData);

    return () => {
      active = false;
      window.removeEventListener("kandid-audit-updated", fetchDashboardData);
    };
  }, [fetchDashboardData, loadDashboardData, loadRecentActivity]);

  const cards = [
    {
      title: "Elections",
      value: stats.elections,
    },
    {
      title: "Active Elections",
      value: activeElectionCount,
    },
    {
      title: "Positions",
      value: stats.positions,
    },
    {
      title: "Candidates",
      value: stats.candidates,
    },
    {
      title: "Vote Records",
      value: stats.votes,
    },
    {
      title: "Unique Voters",
      value: stats.voters,
    },
  ];
  return (
    <div className="board-dashboard-desktop">
      <header className="board-dashboard-masthead">
        <div className="board-dashboard-context">
          <span className="board-dashboard-kicker">Electoral Board / {orgName}</span>
          <span className="board-dashboard-context-rule" aria-hidden="true" />
        </div>
        <div className="board-dashboard-baseline">
          <h1 className="page-title board-dashboard-title">Dashboard</h1>
          <button
            onClick={fetchDashboardData}
            type="button"
            className="board-dashboard-refresh"
            disabled={refreshing || loading}
          >
            <RefreshCw size={15} aria-hidden="true" className={refreshing ? "is-spinning" : ""} />
            {loading ? "Loading" : refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
        <p className="page-subtitle board-dashboard-standfirst">
          Elections, candidates, ballots, and recent activity for {orgName}.
        </p>
      </header>

      {loading ? (
        <DashboardSkeleton />
      ) : loadError ? (
        <section className="board-dashboard-load-error" role="alert">
          <p className="board-dashboard-section-kicker">Workspace unavailable</p>
          <h2>Dashboard information could not be loaded.</h2>
          <p>{loadError}</p>
          <button type="button" onClick={fetchDashboardData} className="board-dashboard-refresh" disabled={refreshing || loading}>
            {refreshing ? "Refreshing" : "Try again"}
          </button>
        </section>
      ) : (
        <>
          <section className="board-dashboard-pulse" aria-label="Operational pulse">
            <div className="board-dashboard-section-head">
              <div>
                <p className="board-dashboard-section-kicker">At a glance</p>
                <h2>Operational pulse</h2>
                <p className="board-dashboard-scope-note">
                  Across {orgName} election records
                </p>
              </div>
            </div>
            <dl className="board-dashboard-metrics">
              {cards.map((card) => (
                <div key={card.title} className="board-dashboard-metric">
                  <dt className="board-dashboard-metric-label">{card.title}</dt>
                  <dd className="board-dashboard-metric-value">{card.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="section-grid board-dashboard-list-grid grid-cols-1">
            <div className="table-shell board-dashboard-list-panel">
              <div className="board-dashboard-list-head board-dashboard-elections-head border-b border-[rgba(104,86,72,0.1)] px-6 py-5">
                <div>
                  <p className="board-dashboard-section-kicker">
                    Recent Elections
                  </p>
                  <h3>
                    Latest elections for {orgName}
                  </h3>
                  <p className="board-dashboard-list-meta">
                    {recentElections.length}{" "}
                    {recentElections.length === 1
                      ? "election"
                      : "elections"}
                  </p>
                </div>
              </div>

              {recentElections.length === 0 ? (
                <p className="p-6 text-sm text-gray-500">
                  No elections found for this organization.
                </p>
              ) : (
                recentElections.map((election) => (
                  <div key={election.id} className="board-dashboard-election-row">
                    <p className="board-dashboard-election-name">
                      {election.title}
                    </p>
                    <p className="board-dashboard-election-when">
                      {formatElectionSchedule(
                        election.start_date,
                        election.end_date,
                      )}
                    </p>
                    <span
                      className="board-dashboard-election-status"
                      data-phase={getElectionPhase(election, serverNow || undefined)}
                    >
                      {electionPhaseLabel(election, serverNow || undefined)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="section-grid board-dashboard-list-grid grid-cols-1">
            <div className="table-shell board-dashboard-list-panel">
              <div className="board-dashboard-list-head board-dashboard-activity-head border-b border-[rgba(104,86,72,0.1)] px-6 py-5">
                <div>
                  <p className="board-dashboard-section-kicker">
                    Recent Activity
                  </p>
                  <h3>
                    Latest activity for {orgName}
                  </h3>
                  <p className="board-dashboard-list-meta board-dashboard-activity-note">
                    The latest organization-scoped records
                  </p>
                </div>
                <Link className="board-dashboard-audit-link" to="/board/audit-trail">
                  View full Audit Trail <span aria-hidden="true">{"\u2192"}</span>
                </Link>
              </div>

              <div className="board-dashboard-activity-register">
                {activityLoading ? (
                  <div className="board-dashboard-activity-skeleton" role="status" aria-label="Loading recent activity">
                    {[0, 1, 2].map((row) => (
                      <div className="board-dashboard-activity-row-skeleton" key={row} aria-hidden="true">
                        <span className="board-dashboard-skeleton-bar is-medium" />
                        <span className="board-dashboard-skeleton-bar is-long" />
                      </div>
                    ))}
                  </div>
                ) : activityError ? (
                  <div className="board-dashboard-activity-message" role="alert">
                    <p>{activityError}</p>
                    <button type="button" className="board-dashboard-activity-retry" onClick={() => loadRecentActivity()}>
                      Try again
                    </button>
                  </div>
                ) : recentActivities.length === 0 ? (
                  <p className="board-dashboard-activity-empty empty-copy">
                    No recent activity yet.
                  </p>
                ) : (
                  recentActivities.map((activity) => {
                    const target = boardAuditTargetLabel(activity);
                    const timeLabel = formatDashboardActivityTime(activity.created_at || activity.timestamp);
                    return (
                      <article key={activity.id} className="board-dashboard-activity-row">
                        <div className="board-dashboard-activity-main">
                          <strong className="board-dashboard-activity-actor">{boardAuditActorLabel(activity)}</strong>
                          <p className="board-dashboard-activity-event">
                            {boardAuditActionLabel(activity.event_type || activity.action)}
                            {target !== "Record" ? <>{"\u00b7"} {target}</> : ""}
                          </p>
                        </div>
                        <div className="board-dashboard-activity-meta">
                          <span>{boardAuditCategoryLabel(activity.event_category || activity.category)}</span>
                          <time dateTime={activity.created_at || activity.timestamp || undefined}>{timeLabel}</time>
                          {activity.is_legacy ? <span className="board-dashboard-activity-legacy">Legacy entry</span> : null}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default BoardDashboard;
