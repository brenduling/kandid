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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Audit Logs</h1>
          <p className="text-gray-500 mt-1">
            Track important system and administrator activities.
          </p>
        </div>

        <button
          onClick={fetchLogs}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold hover:bg-[#e24d17]"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      <div className="mt-8 flex items-center gap-3 bg-white px-4 py-3 rounded-xl shadow-sm w-96">
        <Search size={18} className="text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="outline-none w-full text-sm"
          placeholder="Search logs..."
        />
      </div>

      <div className="mt-6 bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#1d1d1d] text-white">
            <tr>
              <th className="px-6 py-4 text-sm">Log ID</th>
              <th className="px-6 py-4 text-sm">User ID</th>
              <th className="px-6 py-4 text-sm">Action</th>
              <th className="px-6 py-4 text-sm">Timestamp</th>
              <th className="px-6 py-4 text-sm">Status</th>
            </tr>
          </thead>

          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-6 py-10 text-center text-gray-500">
                  No audit logs found.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => (
                <tr key={log.id} className="border-b last:border-b-0">
                  <td className="px-6 py-4 font-bold">#{log.id}</td>
                  <td className="px-6 py-4">{log.user_id || "System"}</td>
                  <td className="px-6 py-4">{log.action}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {log.timestamp
                      ? new Date(log.timestamp).toLocaleString()
                      : "-"}
                  </td>
                  <td className="px-6 py-4">
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