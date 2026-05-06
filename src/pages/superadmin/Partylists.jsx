import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function Partylists() {
  const [partylists, setPartylists] = useState([]);
  const [elections, setElections] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [form, setForm] = useState({
    election_id: "",
    name: "",
    description: "",
  });

  useEffect(() => {
    fetchPartylists();
    fetchElections();
  }, []);

  async function fetchPartylists() {
    const { data } = await supabase
      .from("partylists")
      .select(`
        *,
        elections (title)
      `)
      .order("id", { ascending: true });

    setPartylists(data || []);
  }

  async function fetchElections() {
    const { data } = await supabase
      .from("elections")
      .select("id, title");

    setElections(data || []);
  }

  function openCreate() {
    setEditing(null);
    setForm({
      election_id: "",
      name: "",
      description: "",
    });
    setFormOpen(true);
  }

  function openEdit(p) {
    setEditing(p);
    setForm({
      election_id: p.election_id,
      name: p.name,
      description: p.description || "",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      election_id: Number(form.election_id),
      name: form.name,
      description: form.description,
    };

    if (editing) {
      await supabase
        .from("partylists")
        .update(payload)
        .eq("id", editing.id);
    } else {
      await supabase.from("partylists").insert([payload]);
    }

    setFormOpen(false);
    fetchPartylists();
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this partylist?")) return;

    await supabase.from("partylists").delete().eq("id", id);
    fetchPartylists();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Partylist Management</h1>
          <p className="text-gray-500 mt-1">
            Create and manage election partylists.
          </p>
        </div>

        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold hover:bg-[#e24d17]"
        >
          <Plus size={18} />
          Add Partylist
        </button>
      </div>

      <div className="mt-8 bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#1d1d1d] text-white">
            <tr>
              <th className="px-6 py-4 text-sm">Name</th>
              <th className="px-6 py-4 text-sm">Election</th>
              <th className="px-6 py-4 text-sm">Description</th>
              <th className="px-6 py-4 text-sm text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {partylists.length === 0 ? (
              <tr>
                <td colSpan="4" className="px-6 py-10 text-center text-gray-500">
                  No partylists found.
                </td>
              </tr>
            ) : (
              partylists.map((p) => (
                <tr key={p.id} className="border-b last:border-b-0">
                  <td className="px-6 py-4 font-bold">{p.name}</td>
                  <td className="px-6 py-4">
                    {p.elections?.title || "-"}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {p.description || "No description"}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(p)}
                        className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        onClick={() => handleDelete(p.id)}
                        className="p-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200"
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

      {formOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-xl rounded-2xl shadow-xl p-6">
            <div className="flex justify-between mb-6">
              <h2 className="text-2xl font-black">
                {editing ? "Edit Partylist" : "Add Partylist"}
              </h2>

              <button onClick={() => setFormOpen(false)}>
                <X />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <select
                required
                value={form.election_id}
                onChange={(e) =>
                  setForm({ ...form, election_id: e.target.value })
                }
                className="w-full px-4 py-3 border rounded-xl"
              >
                <option value="">Select Election</option>
                {elections.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>

              <input
                required
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
                placeholder="Partylist Name"
                className="w-full px-4 py-3 border rounded-xl"
              />

              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="Description"
                className="w-full px-4 py-3 border rounded-xl"
              />

              <button className="w-full bg-[#ff5a1f] text-white py-3 rounded-xl font-bold">
                {editing ? "Save Changes" : "Create Partylist"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Partylists;