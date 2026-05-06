import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function BoardPositions() {
  const [positions, setPositions] = useState([]);
  const [elections, setElections] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [form, setForm] = useState({
    election_id: "",
    name: "",
    max_votes: 1,
  });

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;

  useEffect(() => {
    fetchElections();
    fetchPositions();
  }, []);

  async function fetchElections() {
    if (!orgId) return;

    const { data } = await supabase
      .from("elections")
      .select("id, title")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    setElections(data || []);
  }

  async function fetchPositions() {
    if (!orgId) return;

    const { data: orgElections } = await supabase
      .from("elections")
      .select("id")
      .eq("organization_id", orgId);

    const electionIds = orgElections?.map((e) => e.id) || [];

    if (electionIds.length === 0) {
      setPositions([]);
      return;
    }

    const { data } = await supabase
      .from("positions")
      .select(`
        *,
        elections (
          title,
          organization_id
        )
      `)
      .in("election_id", electionIds)
      .order("id", { ascending: true });

    setPositions(data || []);
  }

  function openCreate() {
    setEditing(null);
    setForm({
      election_id: "",
      name: "",
      max_votes: 1,
    });
    setFormOpen(true);
  }

  function openEdit(position) {
    setEditing(position);
    setForm({
      election_id: position.election_id || "",
      name: position.name || "",
      max_votes: position.max_votes || 1,
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      election_id: Number(form.election_id),
      name: form.name,
      max_votes: Number(form.max_votes),
    };

    if (editing) {
      await supabase.from("positions").update(payload).eq("id", editing.id);
    } else {
      await supabase.from("positions").insert([payload]);
    }

    setFormOpen(false);
    fetchPositions();
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this position?")) return;

    await supabase.from("positions").delete().eq("id", id);
    fetchPositions();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Board Positions</h1>
          <p className="text-gray-500 mt-1">
            Manage election positions for your assigned organization.
          </p>
        </div>

        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold hover:bg-[#e24d17]"
        >
          <Plus size={18} />
          Add Position
        </button>
      </div>

      <div className="mt-8 bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#1d1d1d] text-white">
            <tr>
              <th className="px-6 py-4 text-sm">Position</th>
              <th className="px-6 py-4 text-sm">Election</th>
              <th className="px-6 py-4 text-sm">Max Votes</th>
              <th className="px-6 py-4 text-sm text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {positions.length === 0 ? (
              <tr>
                <td colSpan="4" className="px-6 py-10 text-center text-gray-500">
                  No positions found.
                </td>
              </tr>
            ) : (
              positions.map((position) => (
                <tr key={position.id} className="border-b last:border-b-0">
                  <td className="px-6 py-4 font-bold">{position.name}</td>

                  <td className="px-6 py-4">
                    {position.elections?.title || "Unknown Election"}
                  </td>

                  <td className="px-6 py-4">{position.max_votes}</td>

                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(position)}
                        className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        onClick={() => handleDelete(position.id)}
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
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black">
                {editing ? "Edit Position" : "Add Position"}
              </h2>

              <button
                onClick={() => setFormOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <select
                required
                value={form.election_id}
                onChange={(e) =>
                  setForm({ ...form, election_id: e.target.value })
                }
                className="w-full px-4 py-3 border rounded-xl outline-none"
              >
                <option value="">Select Election</option>
                {elections.map((election) => (
                  <option key={election.id} value={election.id}>
                    {election.title}
                  </option>
                ))}
              </select>

              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Position name, e.g. President"
                className="w-full px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />

              <input
                required
                type="number"
                min="1"
                value={form.max_votes}
                onChange={(e) =>
                  setForm({ ...form, max_votes: e.target.value })
                }
                placeholder="Max votes"
                className="w-full px-4 py-3 border rounded-xl outline-none"
              />

              <button className="w-full bg-[#ff5a1f] text-white py-3 rounded-xl font-bold hover:bg-[#e24d17]">
                {editing ? "Save Changes" : "Create Position"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default BoardPositions;