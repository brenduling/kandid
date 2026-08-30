import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Filter, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { fetchAuditLogs } from "../../utils/auditLog";
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
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);

  useEffect(() => {
    fetchLogs(0);
    window.addEventListener("kandid-audit-updated", handleAuditRefresh);
    return () => window.removeEventListener("kandid-audit-updated", handleAuditRefresh);
  }, []);

  function handleAuditRefresh() {
    fetchLogs(0);
  }

  async function fetchLogs(nextPage = page) {
    setLoading(true);
    const from = nextPage * pageSize;
    const { data, error } = await fetchAuditLogs({
      limit: pageSize,
      from,
      search: search.trim(),
      action: filters.action,
      entityType: filters.entityType,
      status: filters.status,
    });

    if (error) {
      console.error("Failed to load audit logs:", error);
    } else {
      setLogs(nextPage === 0 ? data : [...logs, ...data]);
      setPage(nextPage);
    }
    setLoading(false);
  }

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesOrganization =
        !filters.organization || log.organization === filters.organization;
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
  const organizationOptions = useMemo(() => uniqueOptions(logs, "organization"), [logs]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Security Ledger</div>
          <h1 className="page-title">Audit logs</h1>
          <p className="page-subtitle">
            Search, filter, and inspect real administrative activity records.
          </p>
        </div>

        <button
          type="button"
          onClick={() => fetchLogs(0)}
          className="primary-btn self-start lg:self-auto"
          disabled={loading}
        >
          <RefreshCw size={18} />
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="toolbar-row">
        <div className="search-shell">
          <Search size={18} className="text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") fetchLogs(0);
            }}
            placeholder="Search actor, action, entity, organization..."
          />
        </div>
        <button type="button" onClick={() => fetchLogs(0)} className="secondary-btn">
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
          {organizationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
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

      {logs.length >= (page + 1) * pageSize ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => fetchLogs(page + 1)}
            className="secondary-btn"
            disabled={loading}
          >
            {loading ? "Loading..." : "Load more logs"}
          </button>
        </div>
      ) : null}

      {selectedLog ? (
        <PopupOverlay>
          <div className="popup-sheet max-h-[90vh] overflow-y-auto">
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
