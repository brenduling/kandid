import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function BoardPartylists() {
  const [partylists, setPartylists] = useState([]);
  const [elections, setElections] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [form, setForm] = useState({
    election_id: "",
    name: "",
    description: "",
  });

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;

  useEffect(() => {
    fetchElections();
    fetchPartylists();
  }, []);

  async function fetchElections() {
    if (!orgId) return;

    const { data } = await supabase
      .from("elections")
      .select("id, title")
      .eq("organization_id", orgId);

    setElections(data || []);
  }

  async function fetchPartylists() {
    if (!orgId) return;

    const { data: orgElections } = await supabase
      .from("elections")
      .select("id")
      .eq("organization_id", orgId);

    const electionIds = orgElections?.map((e) => e.id) || [];

    if (electionIds.length === 0) {
      setPartylists([]);
      return;
    }

    const { data } = await supabase
      .from("partylists")
      .select(`
        *,
        elections (
          title
        )
      `)
      .in("election_id", electionIds);

    setPartylists(data || []);
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

  function openEdit(item) {
    setEditing(item);
    setForm({
      election_id: item.election_id,
      name: item.name,
      description: item.description || "",
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
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-black">Board Partylists</h1>

        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold"
        >
          <Plus size={18} />
          Add Partylist
        </button>
      </div>

      <div className="mt-8 bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#1d1d1d] text-white">
            <tr>
              <th className="px-6 py-4">Name</th>
              <th className="px-6 py-4">Election</th>
              <th className="px-6 py-4">Description</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {partylists.length === 0 ? (
              <tr>
                <td colSpan="4" className="p-6 text-center text-gray-500">
                  No partylists yet.
                </td>
              </tr>
            ) : (
              partylists.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="px-6 py-4 font-bold">{p.name}</td>
                  <td className="px-6 py-4 text-sm">
                    {p.elections?.title}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {p.description || "-"}
                  </td>

                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => openEdit(p)}
                      className="p-2 mr-2 bg-gray-100 rounded"
                    >
                      <Pencil size={16} />
                    </button>

                    <button
                      onClick={() => handleDelete(p.id)}
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
                className="w-full p-3 border rounded-xl"
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
                placeholder="Partylist Name"
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
                className="w-full p-3 border rounded-xl"
              />

              <textarea
                placeholder="Description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                className="w-full p-3 border rounded-xl"
              />

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

export default BoardPartylists;