import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./RemainingPages.css";
import { CalendarDays, Filter, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { fetchAuditLogs } from "../../utils/auditLog";
import SuperAdminPageHeader from "../../components/SuperAdminPageHeader";
import PopupOverlay from "../../components/PopupOverlay";
import { formatLocalDateTime, parseAbsoluteTimestamp } from "../../utils/time";

const pageSize = 50;

function uniqueOptions(logs, key) {
  return Array.from(new Set(logs.map((log) => log[key]).filter(Boolean))).sort();
}

function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    action: "",
    entityType: "",
    status: "",
    organization: "",
    date: "",
  });
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const queryState = useRef({ search, filters });

  useEffect(() => {
    queryState.current = { search, filters };
  }, [search, filters]);

  const fetchLogs = useCallback(async (cursor = null, append = false) => {
    const { search: currentSearch, filters: currentFilters } = queryState.current;
    setLoading(true);
    const result = await fetchAuditLogs({
      limit: pageSize,
      cursor,
      search: currentSearch.trim(),
      action: currentFilters.action,
      entityType: currentFilters.entityType,
      status: currentFilters.status,
      organizationId: currentFilters.organization,
      date: currentFilters.date,
    });

    if (result.error) {
      console.error("Failed to load audit logs:", result.error);
    } else {
      setLogs((current) => append ? [...current, ...result.data] : result.data);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => fetchLogs());
    const handleAuditRefresh = () => fetchLogs();
    window.addEventListener("kandid-audit-updated", handleAuditRefresh);
    return () => window.removeEventListener("kandid-audit-updated", handleAuditRefresh);
  }, [fetchLogs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesOrganization =
        !filters.organization || String(log.organizationId) === filters.organization;
      const matchesDate =
        !filters.date ||
        (log.createdAt &&
          parseAbsoluteTimestamp(log.createdAt)?.toISOString().slice(0, 10) === filters.date);
      return matchesOrganization && matchesDate;
    });
  }, [logs, filters.organization, filters.date]);

  const actionOptions = useMemo(() => uniqueOptions(logs, "action"), [logs]);
  const entityOptions = useMemo(() => uniqueOptions(logs, "entityType"), [logs]);
  const statusOptions = useMemo(() => uniqueOptions(logs, "status"), [logs]);
  const organizationOptions = useMemo(() => {
    const options = new Map();
    logs.forEach((log) => {
      if (log.organizationId) options.set(String(log.organizationId), log.organization);
    });
    return Array.from(options, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [logs]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="sa-remaining-page sa-audit-logs">
      <SuperAdminPageHeader
        section="System record"
        title="Audit Trail"
        description="Review trusted Super Admin activity recorded across Kandid."
        actions={(
          <button type="button" onClick={() => fetchLogs()} className="primary-btn" disabled={loading}>
            <RefreshCw size={18} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        )}
      />

      <div className="toolbar-row">
        <div className="search-shell">
          <Search size={18} className="text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") fetchLogs();
            }}
            placeholder="Search actor, action, entity, organization..."
          />
        </div>
        <button type="button" onClick={() => fetchLogs()} className="secondary-btn">
          <Filter size={16} />
          Apply Filters
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
        <select className="field-shell" value={filters.action} onChange={(e) => updateFilter("action", e.target.value)}>
          <option value="">All actions</option>
          {actionOptions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="field-shell" value={filters.entityType} onChange={(e) => updateFilter("entityType", e.target.value)}>
          <option value="">All entities</option>
          {entityOptions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="field-shell" value={filters.organization} onChange={(e) => updateFilter("organization", e.target.value)}>
          <option value="">All organizations</option>
          {organizationOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select className="field-shell" value={filters.status} onChange={(e) => updateFilter("status", e.target.value)}>
          <option value="">All statuses</option>
          {statusOptions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <label className="field-shell flex items-center gap-2">
          <CalendarDays size={16} />
          <input
            type="date"
            value={filters.date}
            onChange={(e) => updateFilter("date", e.target.value)}
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
        </label>
      </div>

      <div className="table-shell mt-6">
        <div className="overflow-x-auto">
          <table className="app-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Role</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Organization</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>

            <tbody>
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-6 py-10 text-center empty-copy">
                    {loading ? "Loading audit logs..." : "No audit logs found."}
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="text-[#5a5548]">
                      {formatLocalDateTime(log.createdAt, "-")}
                    </td>
                    <td className="font-bold">{log.actor}</td>
                    <td>{log.actorRole}</td>
                    <td>{log.event}</td>
                    <td>{log.entityLabel || log.entityType || "-"}</td>
                    <td>{log.organization}</td>
                    <td>
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">
                        <ShieldCheck size={13} />
                        {log.status}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="secondary-btn" onClick={() => setSelectedLog(log)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {hasMore ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => fetchLogs(nextCursor, true)}
            className="secondary-btn"
            disabled={loading}
          >
            {loading ? "Loading..." : "Load more logs"}
          </button>
        </div>
      ) : null}

      {selectedLog ? (
        <PopupOverlay>
          <div className="popup-sheet max-h-[90vh] overflow-y-auto sa-remaining-dialog">
            <div className="popup-header">
              <div>
                <p className="field-label">Audit Event</p>
                <h2 className="surface-title mt-2 text-2xl font-black">{selectedLog.event}</h2>
              </div>
              <button type="button" className="popup-close" onClick={() => setSelectedLog(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="popup-content grid gap-3">
              {[
                ["Actor", selectedLog.actor],
                ["Role", selectedLog.actorRole],
                ["Date & Time", formatLocalDateTime(selectedLog.createdAt, "-")],
                ["Organization", selectedLog.organization],
                ["Affected Record", selectedLog.entityLabel || selectedLog.entityId || "-"],
                ["Action", selectedLog.action],
                ["Result", selectedLog.status],
              ].map(([label, value]) => (
                <div key={label} className="info-row">
                  <span className="text-sm font-semibold text-gray-600">{label}</span>
                  <span className="text-sm font-bold text-[#1d262f]">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </PopupOverlay>
      ) : null}
    </div>
  );
}

export default AuditLogs;
