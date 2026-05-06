import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function BoardElections() {
  const [elections, setElections] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [form, setForm] = useState({
    title: "",
    start_date: "",
    end_date: "",
    status: "draft",
  });

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;

  useEffect(() => {
    fetchElections();
  }, []);

  async function fetchElections() {
    if (!orgId) return;

    const { data } = await supabase
      .from("elections")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    setElections(data || []);
  }

  function openCreate() {
    setEditing(null);
    setForm({
      title: "",
      start_date: "",
      end_date: "",
      status: "draft",
    });
    setFormOpen(true);
  }

  function openEdit(election) {
    setEditing(election);
    setForm({
      title: election.title,
      start_date: election.start_date || "",
      end_date: election.end_date || "",
      status: election.status || "draft",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      ...form,
      organization_id: orgId, // 🔐 IMPORTANT
    };

    if (editing) {
      await supabase
        .from("elections")
        .update(payload)
        .eq("id", editing.id);
    } else {
      await supabase.from("elections").insert([payload]);
    }

    setFormOpen(false);
    fetchElections();
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this election?")) return;

    await supabase.from("elections").delete().eq("id", id);
    fetchElections();
  }

  return (
    <div>
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-black">Board Elections</h1>

        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold"
        >
          <Plus size={18} />
          Create Election
        </button>
      </div>

      <div className="mt-8 bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#1d1d1d] text-white">
            <tr>
              <th className="px-6 py-4">Title</th>
              <th className="px-6 py-4">Start</th>
              <th className="px-6 py-4">End</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {elections.length === 0 ? (
              <tr>
                <td colSpan="5" className="p-6 text-center text-gray-500">
                  No elections yet.
                </td>
              </tr>
            ) : (
              elections.map((e) => (
                <tr key={e.id} className="border-b">
                  <td className="px-6 py-4 font-bold">{e.title}</td>
                  <td className="px-6 py-4 text-sm">
                    {e.start_date
                      ? new Date(e.start_date).toLocaleString()
                      : "-"}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {e.end_date
                      ? new Date(e.end_date).toLocaleString()
                      : "-"}
                  </td>

                  <td className="px-6 py-4">
                    <span className="px-3 py-1 bg-gray-100 rounded-full text-xs font-bold">
                      {e.status}
                    </span>
                  </td>

                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => openEdit(e)}
                      className="p-2 mr-2 bg-gray-100 rounded"
                    >
                      <Pencil size={16} />
                    </button>

                    <button
                      onClick={() => handleDelete(e.id)}
                      className="p-2 bg-red-100 text-red-600 rounded"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="bg-white p-6 rounded-2xl w-full max-w-md">
            <div className="flex justify-between mb-4">
              <h2 className="text-xl font-black">
                {editing ? "Edit Election" : "Create Election"}
              </h2>

              <button onClick={() => setFormOpen(false)}>
                <X />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                required
                placeholder="Title"
                value={form.title}
                onChange={(e) =>
                  setForm({ ...form, title: e.target.value })
                }
                className="w-full p-3 border rounded-xl"
              />

              <input
                type="datetime-local"
                value={form.start_date}
                onChange={(e) =>
                  setForm({ ...form, start_date: e.target.value })
                }
                className="w-full p-3 border rounded-xl"
              />

              <input
                type="datetime-local"
                value={form.end_date}
                onChange={(e) =>
                  setForm({ ...form, end_date: e.target.value })
                }
                className="w-full p-3 border rounded-xl"
              />

              <select
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value })
                }
                className="w-full p-3 border rounded-xl"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>

              <button className="w-full bg-[#ff5a1f] text-white py-3 rounded-xl font-bold">
                Save
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default BoardElections;