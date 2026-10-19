import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { toBoardFacingError } from "../../utils/boardFeedback";
import {
  BOARD_AUDIT_CATEGORIES,
  boardAuditActionLabel,
  boardAuditCategoryLabel,
  boardAuditActorLabel,
  boardAuditActorRole,
  boardAuditChangedFieldLabels,
  boardAuditSafeDetails,
  boardAuditStatusLabel,
  boardAuditTargetLabel,
  buildBoardAuditRpcArgs,
} from "../../utils/boardAuditTrail";
import "./AuditTrail.css";

const PAGE_SIZE = 50;

function readBoardOrganizationName() {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "null");
    return user?.organization_name || user?.organizations?.name || "your organization";
  } catch {
    return "your organization";
  }
}

function formatAuditTimestamp(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return { label: "Time unavailable", dateTime: undefined };
  return {
    label: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date),
    dateTime: date.toISOString(),
  };
}

function AuditRow({ event, electionsById }) {
  const details = boardAuditSafeDetails(event);
  const timestamp = formatAuditTimestamp(event.created_at);
  const electionTitle = event.election_id
    ? electionsById.get(String(event.election_id)) || `Election #${event.election_id}`
    : "";
  const changedFields = boardAuditChangedFieldLabels(event.changed_fields);

  return (
    <article className="board-audit-event">
      <div className="board-audit-event-main">
        <div className="board-audit-event-action">
          <p className="board-audit-event-category">{boardAuditCategoryLabel(event.category)}</p>
          <h3>{boardAuditActionLabel(event.event_type)}</h3>
        </div>
        <div className="board-audit-event-target">
          <span className="board-audit-label">Record</span>
          <strong>{boardAuditTargetLabel(event)}</strong>
          {electionTitle ? <span className="board-audit-election-context">{electionTitle}</span> : null}
        </div>
        <div className="board-audit-event-actor">
          <span className="board-audit-label">Actor</span>
          <strong>{boardAuditActorLabel(event)}</strong>
          <span>{boardAuditActorRole(event)}</span>
        </div>
        <div className="board-audit-event-time">
          <span className="board-audit-label">Recorded</span>
          <time dateTime={timestamp.dateTime}>{timestamp.label}</time>
          {event.is_legacy ? <span className="board-audit-legacy">Legacy entry</span> : null}
        </div>
      </div>

      {event.status && String(event.status).toLowerCase() !== "completed" ? (
        <p className="board-audit-event-status">{boardAuditStatusLabel(event.status)}</p>
      ) : null}

      {details ? (
        <details className="board-audit-details">
          <summary>View safe details</summary>
          <div className="board-audit-details-content">
            {changedFields.length ? (
              <div>
                <h4>Fields changed</h4>
                <p>{changedFields.join(" · ")}</p>
              </div>
            ) : null}
            {details.beforePrograms.length || details.afterPrograms.length ? (
              <div className="board-audit-program-change">
                {details.beforePrograms.length ? (
                  <div>
                    <h4>Before</h4>
                    <p>{details.beforePrograms.join(" · ") || "No programs"}</p>
                  </div>
                ) : null}
                <div>
                  <h4>After</h4>
                  <p>{details.afterPrograms.join(" · ") || "No programs"}</p>
                </div>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function AuditSkeleton() {
  return (
    <div className="board-audit-skeleton-list" role="status" aria-label="Loading audit activity" aria-busy="true">
      {[0, 1, 2, 3, 4].map((row) => (
        <div className="board-audit-skeleton-row" key={row}>
          <span className="is-action" />
          <span className="is-target" />
          <span className="is-actor" />
          <span className="is-time" />
        </div>
      ))}
      <span className="board-audit-skeleton-note">Reading the activity register...</span>
    </div>
  );
}

function BoardAuditTrail() {
  const organizationName = readBoardOrganizationName();
  const [elections, setElections] = useState([]);
  const [electionsLoading, setElectionsLoading] = useState(true);
  const [electionsError, setElectionsError] = useState("");
  const [electionRetry, setElectionRetry] = useState(0);
  const [category, setCategory] = useState("");
  const [electionId, setElectionId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const latestRequestId = useRef(0);
  const olderRequestId = useRef(0);
  const submittedSearch = useRef(debouncedSearch);
  const currentFilterKey = `${category}\u0000${electionId}\u0000${debouncedSearch}`;
  const currentFilterKeyRef = useRef(currentFilterKey);

  useEffect(() => {
    currentFilterKeyRef.current = currentFilterKey;
  }, [currentFilterKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = search.trim();
      if (submittedSearch.current !== nextSearch) {
        submittedSearch.current = nextSearch;
        setLoading(true);
        setLoadError("");
        setOlderError("");
        olderRequestId.current += 1;
        setOlderLoading(false);
        setDebouncedSearch(nextSearch);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let current = true;
    supabase.rpc("kandid_list_board_report_elections")
      .then(({ data, error }) => {
        if (!current) return;
        if (error) throw error;
        setElections(Array.isArray(data?.elections) ? data.elections : []);
      })
      .catch((error) => {
        if (!current) return;
        setElectionsError(toBoardFacingError(error?.message, "Election filters could not be loaded."));
      })
      .finally(() => {
        if (current) setElectionsLoading(false);
      });
    return () => { current = false; };
  }, [electionRetry]);

  useEffect(() => {
    let current = true;
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    olderRequestId.current += 1;

    supabase.rpc("kandid_list_board_audit_events", buildBoardAuditRpcArgs({
      pageSize: PAGE_SIZE,
      category,
      electionId,
      search: debouncedSearch,
    }))
      .then(({ data, error }) => {
        if (!current || latestRequestId.current !== requestId) return;
        if (error) throw error;
        setEvents(Array.isArray(data?.events) ? data.events : []);
        setHasMore(Boolean(data?.has_more));
        setNextCursor(data?.next_cursor || null);
      })
      .catch((error) => {
        if (!current || latestRequestId.current !== requestId) return;
        setLoadError(toBoardFacingError(error?.message, "Unable to load the audit trail."));
        setEvents([]);
      })
      .finally(() => {
        if (current && latestRequestId.current === requestId) setLoading(false);
      });

    return () => { current = false; };
  }, [category, electionId, debouncedSearch, refreshKey]);

  const electionsById = useMemo(
    () => new Map(elections.map((election) => [String(election.id), election.title || `Election #${election.id}`])),
    [elections],
  );

  async function loadOlderEvents() {
    if (!hasMore || !nextCursor || olderLoading) return;
    const requestId = olderRequestId.current + 1;
    olderRequestId.current = requestId;
    const filterKey = currentFilterKey;
    setOlderLoading(true);
    setOlderError("");
    try {
      const { data, error } = await supabase.rpc("kandid_list_board_audit_events", buildBoardAuditRpcArgs({
        cursor: nextCursor,
        pageSize: PAGE_SIZE,
        category,
        electionId,
        search: debouncedSearch,
      }));
      if (olderRequestId.current !== requestId || currentFilterKeyRef.current !== filterKey) return;
      if (error) throw error;
      const olderEvents = Array.isArray(data?.events) ? data.events : [];
      setEvents((current) => {
        const existing = new Set(current.map((event) => String(event.id)));
        return [...current, ...olderEvents.filter((event) => !existing.has(String(event.id)))];
      });
      setHasMore(Boolean(data?.has_more));
      setNextCursor(data?.next_cursor || null);
    } catch (error) {
      if (olderRequestId.current === requestId && currentFilterKeyRef.current === filterKey) {
        setOlderError(toBoardFacingError(error?.message, "Older activity could not be loaded."));
      }
    } finally {
      if (olderRequestId.current === requestId && currentFilterKeyRef.current === filterKey) {
        setOlderLoading(false);
      }
    }
  }

  function retryElectionOptions() {
    setElectionsLoading(true);
    setElectionsError("");
    setElectionRetry((value) => value + 1);
  }

  function retryAuditTrail() {
    setEvents([]);
    setLoading(true);
    setLoadError("");
    olderRequestId.current += 1;
    setOlderLoading(false);
    setRefreshKey((value) => value + 1);
  }

  function prepareFilterChange() {
    setLoading(true);
    setLoadError("");
    setOlderError("");
    olderRequestId.current += 1;
    setOlderLoading(false);
  }

  function updateCategory(value) {
    prepareFilterChange();
    setCategory(value);
  }

  function updateElection(value) {
    prepareFilterChange();
    setElectionId(value);
  }

  function updateSearch(value) {
    setSearch(value);
  }

  function clearFilters() {
    prepareFilterChange();
    setCategory("");
    setElectionId("");
    setSearch("");
    setDebouncedSearch("");
  }

  const hasActiveFilters = Boolean(category || electionId || debouncedSearch);

  return (
    <main className="board-audit-page">
      <header className="board-audit-masthead board-students-masthead">
        <div className="board-students-context">
          <span className="board-students-eyebrow">Electoral Board / {organizationName}</span>
          <span className="board-students-context-rule" aria-hidden="true" />
        </div>
        <div className="board-students-baseline">
          <h1 className="page-title board-students-title">Audit Trail</h1>
        </div>
        <p className="board-students-standfirst">A trusted record of activity for {organizationName}.</p>
      </header>

      <section className="board-audit-register" aria-labelledby="board-audit-register-title">
        <div className="board-audit-section-head">
          <div>
            <p className="board-audit-kicker">Activity register</p>
            <h2 id="board-audit-register-title">Recent activity</h2>
          </div>
          <button type="button" className="board-audit-refresh" onClick={retryAuditTrail} disabled={loading}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        </div>

        <div className="board-audit-filters" aria-label="Filter audit activity">
          <label className="board-audit-filter">
            <span>Category</span>
            <select value={category} onChange={(event) => updateCategory(event.target.value)}>
              <option value="">All activity</option>
              {BOARD_AUDIT_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="board-audit-filter">
            <span>Election</span>
            <select value={electionId} onChange={(event) => updateElection(event.target.value)} disabled={electionsLoading || Boolean(electionsError)}>
              <option value="">All elections</option>
              {elections.map((election) => (
                <option key={election.id} value={election.id}>{election.title || `Election #${election.id}`}</option>
              ))}
            </select>
          </label>
          <label className="board-audit-filter is-search">
            <span>Search activity</span>
            <input
              type="search"
              value={search}
              onChange={(event) => updateSearch(event.target.value)}
              placeholder="Actor, action, or record"
              autoComplete="off"
            />
          </label>
        </div>
        {electionsError ? (
          <div className="board-audit-filter-error" role="status">
            <span>{electionsError}</span>
            <button type="button" onClick={retryElectionOptions}>Retry election options</button>
          </div>
        ) : null}

        {loading ? <AuditSkeleton /> : loadError ? (
          <div className="board-audit-state is-error" role="alert">
            <h3>Audit activity is unavailable.</h3>
            <p>{loadError}</p>
            <button type="button" onClick={retryAuditTrail}>Retry</button>
          </div>
        ) : events.length === 0 ? (
          <div className="board-audit-state">
            <h3>{hasActiveFilters ? "No activity matches these filters." : "No activity has been recorded yet."}</h3>
            <p>{hasActiveFilters ? "Adjust or clear a filter to see other activity." : "New trusted activity will appear here as it is recorded."}</p>
            {hasActiveFilters ? <button type="button" onClick={clearFilters}>Clear filters</button> : null}
          </div>
        ) : (
          <>
            <div className="board-audit-list" aria-live="polite">
              {events.map((event) => <AuditRow key={event.id} event={event} electionsById={electionsById} />)}
            </div>
            {olderError ? <p className="board-audit-older-error" role="alert">{olderError}</p> : null}
            {hasMore ? (
              <div className="board-audit-load-more">
                <button type="button" onClick={loadOlderEvents} disabled={olderLoading}>
                  {olderLoading ? "Loading older activity..." : "Load older activity"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}

export default BoardAuditTrail;
