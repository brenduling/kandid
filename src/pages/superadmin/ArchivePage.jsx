import { useEffect, useState } from "react";
import { Archive, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function Archives() {
  const [archives, setArchives] = useState([]);

  useEffect(() => {
    fetchArchives();
  }, []);

  async function fetchArchives() {
    const { data } = await supabase
      .from("archived_elections")
      .select("*")
      .order("archived_at", { ascending: false });

    setArchives(data || []);
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete archived record?")) return;

    await supabase.from("archived_elections").delete().eq("id", id);
    fetchArchives();
  }

  return (
    <div>
      <h1 className="text-3xl font-black">Archive Center</h1>
      <p className="text-gray-500 mt-1">
        View and manage archived elections.
      </p>

      <div className="mt-8 bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#1d1d1d] text-white">
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
                      <button className="p-2 bg-gray-100 rounded-lg">
                        <Archive size={16} />
                      </button>

                      <button
                        onClick={() => handleDelete(a.id)}
                        className="p-2 bg-red-100 text-red-600 rounded-lg"
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