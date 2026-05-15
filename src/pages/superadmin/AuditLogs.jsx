import { useEffect, useState } from "react";
import { RefreshCw, Search, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchLogs();
  }, []);

  async function fetchLogs() {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .order("timestamp", { ascending: false });

    if (!error) setLogs(data || []);
    if (error) console.log(error);
  }

  const filteredLogs = logs.filter((log) =>
    String(log.action || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Security Ledger</div>
          <h1 className="page-title">Audit logs</h1>
          <p className="page-subtitle">
            Track important system and administrator activities.
          </p>
        </div>

        <button
          onClick={fetchLogs}
          className="primary-btn self-start lg:self-auto"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      <div className="toolbar-row">
      <div className="search-shell">
        <Search size={18} className="text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search logs..."
        />
      </div>
      </div>

      <div className="table-shell mt-6">
        <table className="app-table">
          <thead>
            <tr>
              <th>Log ID</th>
              <th>User ID</th>
              <th>Action</th>
              <th>Timestamp</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-6 py-10 text-center empty-copy">
                  No audit logs found.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => (
                <tr key={log.id}>
                  <td className="font-bold">#{log.id}</td>
                  <td>{log.user_id || "System"}</td>
                  <td>{log.action}</td>
                  <td className="text-[#5a5548]">
                    {log.timestamp
                      ? new Date(log.timestamp).toLocaleString()
                      : "-"}
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">
                      <ShieldCheck size={13} />
                      Recorded
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AuditLogs;
