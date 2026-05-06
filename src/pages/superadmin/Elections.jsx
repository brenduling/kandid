import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function Elections() {
  const [elections, setElections] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingElection, setEditingElection] = useState(null);

  const [form, setForm] = useState({
    organization_id: "",
    title: "",
    start_date: "",
    end_date: "",
    status: "draft",
  });

  useEffect(() => {
    fetchOrganizations();
    fetchElections();
  }, []);

  async function fetchOrganizations() {
    const { data } = await supabase
      .from("organizations")
      .select("id, name")
      .order("name", { ascending: true });

    setOrganizations(data || []);
  }

  async function fetchElections() {
    const { data, error } = await supabase
      .from("elections")
      .select(`
        *,
        organizations (
          name
        )
      `)
      .order("id", { ascending: true });

    if (!error) setElections(data || []);
  }

  function openCreateForm() {
    setEditingElection(null);
    setForm({
      organization_id: "",
      title: "",
      start_date: "",
      end_date: "",
      status: "draft",
    });
    setFormOpen(true);
  }

  function openEditForm(election) {
    setEditingElection(election);
    setForm({
      organization_id: election.organization_id || "",
      title: election.title || "",
      start_date: election.start_date
        ? election.start_date.slice(0, 16)
        : "",
      end_date: election.end_date ? election.end_date.slice(0, 16) : "",
      status: election.status || "draft",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      organization_id: Number(form.organization_id),
      title: form.title,
      start_date: form.start_date,
      end_date: form.end_date,
      status: form.status,
    };

    if (editingElection) {
      await supabase
        .from("elections")
        .update(payload)
        .eq("id", editingElection.id);
    } else {
      await supabase.from("elections").insert([payload]);
    }

    setFormOpen(false);
    fetchElections();
  }

  async function handleDelete(id) {
    const confirmDelete = window.confirm("Delete this election?");
    if (!confirmDelete) return;

    await supabase.from("elections").delete().eq("id", id);
    fetchElections();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Election Management</h1>
          <p className="text-gray-500 mt-1">
            Create and manage elections across organizations.
          </p>
        </div>

        <button
          onClick={openCreateForm}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold hover:bg-[#e24d17]"
        >
          <Plus size={18} />
          Add Election
        </button>
      </div>

      <div className="mt-8 bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#1d1d1d] text-white">
            <tr>
              <th className="px-6 py-4 text-sm">Election</th>
              <th className="px-6 py-4 text-sm">Organization</th>
              <th className="px-6 py-4 text-sm">Start</th>
              <th className="px-6 py-4 text-sm">End</th>
              <th className="px-6 py-4 text-sm">Status</th>
              <th className="px-6 py-4 text-sm text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {elections.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-10 text-center text-gray-500">
                  No elections found.
                </td>
              </tr>
            ) : (
              elections.map((election) => (
                <tr key={election.id} className="border-b last:border-b-0">
                  <td className="px-6 py-4 font-bold">{election.title}</td>
                  <td className="px-6 py-4">
                    {election.organizations?.name || "Unknown"}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {election.start_date
                      ? new Date(election.start_date).toLocaleString()
                      : "-"}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {election.end_date
                      ? new Date(election.end_date).toLocaleString()
                      : "-"}
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700">
                      {election.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditForm(election)}
                        className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        onClick={() => handleDelete(election.id)}
                        className="p-2 rounded-lg bg-red-100 text-red-600 hover:bg-red-200"
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
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black">
                {editingElection ? "Edit Election" : "Add Election"}
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
                value={form.organization_id}
                onChange={(e) =>
                  setForm({ ...form, organization_id: e.target.value })
                }
                className="w-full px-4 py-3 border rounded-xl outline-none"
              >
                <option value="">Select Organization</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>

              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Election Title"
                className="w-full px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />

              <div className="grid grid-cols-2 gap-4">
                <input
                  required
                  type="datetime-local"
                  value={form.start_date}
                  onChange={(e) =>
                    setForm({ ...form, start_date: e.target.value })
                  }
                  className="px-4 py-3 border rounded-xl outline-none"
                />

                <input
                  required
                  type="datetime-local"
                  value={form.end_date}
                  onChange={(e) =>
                    setForm({ ...form, end_date: e.target.value })
                  }
                  className="px-4 py-3 border rounded-xl outline-none"
                />
              </div>

              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-4 py-3 border rounded-xl outline-none"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
                <option value="archived">Archived</option>
              </select>

              <button className="w-full bg-[#ff5a1f] text-white py-3 rounded-xl font-bold hover:bg-[#e24d17]">
                {editingElection ? "Save Changes" : "Create Election"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Elections;