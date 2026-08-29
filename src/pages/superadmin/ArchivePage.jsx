import { useEffect, useState } from "react";
import { Archive, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../../utils/deleteGuards";

function Archives() {
  const prompt = usePrompt();
  const [archives, setArchives] = useState([]);

  useEffect(() => {
    fetchArchives();
  }, []);

  async function fetchArchives() {
    const { data } = await supabase
      .from("archived_elections")
      .select("id, title, total_votes, total_voters, archived_at")
      .order("archived_at", { ascending: false })
      .range(0, 99);

    setArchives(data || []);
  }

  async function handleDelete(archive) {
    const analysis = await analyzeDeleteDependencies("archived_election", archive);
    await logAuditEvent({
      action: "archived_election_delete_blocked",
      entityType: "archived_election",
      entityId: archive.id,
      entityLabel: archive.title,
      status: "requires_action",
      metadata: { recommendation: analysis.recommendation },
    });

    const ok = await prompt.confirm({
      title: "Permanently Delete Archive?",
      message: `${dependencyMessage(archive.title || "This archive", analysis)}\n\nThis removes the archive-center record from KANDID.`,
      type: "danger",
      confirmText: "Delete Archive",
      cancelText: "Keep Archive",
    });
    if (!ok) return;

    const { error } = await supabase.from("archived_elections").delete().eq("id", archive.id);
    if (error) {
      prompt.error(error.message || "Failed to delete archived election.");
      return;
    }
    prompt.success("Archived election deleted.");
    await logAuditEvent({
      action: "archived_election_deleted",
      entityType: "archived_election",
      entityId: archive.id,
      entityLabel: archive.title,
      status: "completed",
    });
    fetchArchives();
  }

  return (
    <div>
      <h1 className="text-3xl font-black">Archive Center</h1>
      <p className="text-gray-500 mt-1">
        View and manage archived elections.
      </p>

      <div className="table-shell mt-8">
        <table className="app-table">
          <thead>
            <tr>
              <th className="px-6 py-4">Title</th>
              <th className="px-6 py-4">Votes</th>
              <th className="px-6 py-4">Voters</th>
              <th className="px-6 py-4">Archived At</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {archives.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-6 py-10 text-center text-gray-500">
                  No archived elections.
                </td>
              </tr>
            ) : (
              archives.map((a) => (
                <tr key={a.id} className="border-b">
                  <td className="px-6 py-4 font-bold">{a.title}</td>
                  <td className="px-6 py-4">{a.total_votes}</td>
                  <td className="px-6 py-4">{a.total_voters}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {new Date(a.archived_at).toLocaleString()}
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button className="icon-action">
                        <Archive size={16} />
                      </button>

                      <button
                        onClick={() => handleDelete(a)}
                        className="icon-action icon-action-danger"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
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

export default Archives;
