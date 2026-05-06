import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function Organizations() {
  const [organizations, setOrganizations] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchOrganizations();
  }, []);

  async function fetchOrganizations() {
    const { data, error } = await supabase
      .from("organizations")
      .select("*")
      .order("id", { ascending: true });

    if (!error) setOrganizations(data || []);
  }

  function openCreateForm() {
    setEditingOrg(null);
    setForm({ name: "", description: "" });
    setFormOpen(true);
  }

  function openEditForm(org) {
    setEditingOrg(org);
    setForm({
      name: org.name || "",
      description: org.description || "",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);

    if (editingOrg) {
      await supabase
        .from("organizations")
        .update({
          name: form.name,
          description: form.description,
        })
        .eq("id", editingOrg.id);
    } else {
      await supabase.from("organizations").insert([
        {
          name: form.name,
          description: form.description,
        },
      ]);
    }

    setLoading(false);
    setFormOpen(false);
    fetchOrganizations();
  }

  async function handleDelete(id) {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this organization?"
    );

    if (!confirmDelete) return;

    await supabase.from("organizations").delete().eq("id", id);
    fetchOrganizations();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Organization Management</h1>
          <p className="text-gray-500 mt-1">
            Add, update, and manage student organizations.
          </p>
        </div>

        <button
          onClick={openCreateForm}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold shadow-sm hover:bg-[#e24d17]"
        >
          <Plus size={18} />
          Add Organization
        </button>
      </div>

      <div className="mt-8 bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#1d1d1d] text-white">
            <tr>
              <th className="px-6 py-4 text-sm">ID</th>
              <th className="px-6 py-4 text-sm">Organization</th>
              <th className="px-6 py-4 text-sm">Description</th>
              <th className="px-6 py-4 text-sm">Created At</th>
              <th className="px-6 py-4 text-sm text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {organizations.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-6 py-10 text-center text-gray-500">
                  No organizations found.
                </td>
              </tr>
            ) : (
              organizations.map((org) => (
                <tr key={org.id} className="border-b last:border-b-0">
                  <td className="px-6 py-4 text-sm font-semibold">{org.id}</td>
                  <td className="px-6 py-4 font-bold">{org.name}</td>
                  <td className="px-6 py-4 text-gray-600">
                    {org.description || "No description"}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {org.created_at
                      ? new Date(org.created_at).toLocaleDateString()
                      : "-"}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditForm(org)}
                        className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        onClick={() => handleDelete(org.id)}
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
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black">
                {editingOrg ? "Edit Organization" : "Add Organization"}
              </h2>

              <button
                onClick={() => setFormOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-bold">Organization Name</label>
                <input
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                  required
                  className="w-full mt-1 px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
                  placeholder="e.g. PSITS"
                />
              </div>

              <div>
                <label className="text-sm font-bold">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  className="w-full mt-1 px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
                  placeholder="Short organization description"
                  rows="4"
                />
              </div>

              <button
                disabled={loading}
                className="w-full bg-[#ff5a1f] text-white py-3 rounded-xl font-bold hover:bg-[#e24d17] disabled:opacity-60"
              >
                {loading
                  ? "Saving..."
                  : editingOrg
                  ? "Save Changes"
                  : "Create Organization"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Organizations;