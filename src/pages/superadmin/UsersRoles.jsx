import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, UserCog } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function UsersRoles() {
  const [users, setUsers] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "electoral_board",
    organization_id: "",
    status: "active",
  });

  useEffect(() => {
    fetchUsers();
    fetchOrganizations();
  }, []);

  async function fetchUsers() {
    const { data, error } = await supabase
      .from("admin_users")
      .select(`
        *,
        organizations (
          name
        )
      `)
      .order("id", { ascending: true });

    if (!error) setUsers(data || []);
    if (error) console.log(error);
  }

  async function fetchOrganizations() {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name")
      .order("name", { ascending: true });

    if (!error) setOrganizations(data || []);
    if (error) console.log(error);
  }

  function openCreate() {
    setEditing(null);
    setForm({
      full_name: "",
      email: "",
      password: "",
      role: "electoral_board",
      organization_id: "",
      status: "active",
    });
    setFormOpen(true);
  }

  function openEdit(user) {
    setEditing(user);
    setForm({
      full_name: user.full_name || "",
      email: user.email || "",
      password: user.password || "",
      role: user.role || "electoral_board",
      organization_id: user.organization_id || "",
      status: user.status || "active",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      full_name: form.full_name,
      email: form.email,
      password: form.password,
      role: form.role,
      organization_id:
        form.role === "super_admin"
          ? null
          : form.organization_id
          ? Number(form.organization_id)
          : null,
      status: form.status,
    };

    if (editing) {
      await supabase
        .from("admin_users")
        .update(payload)
        .eq("id", editing.id);
    } else {
      await supabase.from("admin_users").insert([payload]);
    }

    setFormOpen(false);
    fetchUsers();
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this account?")) return;

    await supabase.from("admin_users").delete().eq("id", id);
    fetchUsers();
  }

  const roleCards = ["super_admin", "electoral_board"];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Users and Roles</h1>
          <p className="text-gray-500 mt-1">
            Manage Super Admin and Electoral Board accounts.
          </p>
        </div>

        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold hover:bg-[#e24d17]"
        >
          <Plus size={18} />
          Add User
        </button>
      </div>

      <div className="grid grid-cols-2 gap-6 mt-8">
        {roleCards.map((role) => (
          <div key={role} className="bg-white p-6 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500 capitalize">
                {role.replaceAll("_", " ")}
              </p>
              <UserCog size={20} className="text-[#ff5a1f]" />
            </div>

            <h2 className="text-3xl font-black mt-2">
              {users.filter((user) => user.role === role).length}
            </h2>
          </div>
        ))}
      </div>

      <div className="mt-8 bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#1d1d1d] text-white">
            <tr>
              <th className="px-6 py-4 text-sm">Name</th>
              <th className="px-6 py-4 text-sm">Email</th>
              <th className="px-6 py-4 text-sm">Role</th>
              <th className="px-6 py-4 text-sm">Organization</th>
              <th className="px-6 py-4 text-sm">Status</th>
              <th className="px-6 py-4 text-sm text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-10 text-center text-gray-500">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="border-b last:border-b-0">
                  <td className="px-6 py-4 font-bold">{user.full_name}</td>
                  <td className="px-6 py-4 text-gray-600">{user.email}</td>

                  <td className="px-6 py-4">
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700 capitalize">
                      {user.role?.replaceAll("_", " ")}
                    </span>
                  </td>

                  <td className="px-6 py-4">
                    {user.role === "super_admin"
                      ? "All Organizations"
                      : user.organizations?.name || "Unassigned"}
                  </td>

                  <td className="px-6 py-4">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold ${
                        user.status === "active"
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {user.status}
                    </span>
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(user)}
                        className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        onClick={() => handleDelete(user.id)}
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
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black">
                {editing ? "Edit User" : "Add User"}
              </h2>

              <button
                onClick={() => setFormOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                required
                value={form.full_name}
                onChange={(e) =>
                  setForm({ ...form, full_name: e.target.value })
                }
                placeholder="Full Name"
                className="w-full px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />

              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Email"
                className="w-full px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />

              <input
                required
                type="password"
                value={form.password}
                onChange={(e) =>
                  setForm({ ...form, password: e.target.value })
                }
                placeholder="Temporary Password"
                className="w-full px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />

              <select
                value={form.role}
                onChange={(e) =>
                  setForm({
                    ...form,
                    role: e.target.value,
                    organization_id:
                      e.target.value === "super_admin"
                        ? ""
                        : form.organization_id,
                  })
                }
                className="w-full px-4 py-3 border rounded-xl outline-none"
              >
                <option value="super_admin">Super Admin</option>
                <option value="electoral_board">Electoral Board</option>
              </select>

              {form.role === "electoral_board" && (
                <select
                  value={form.organization_id}
                  onChange={(e) =>
                    setForm({ ...form, organization_id: e.target.value })
                  }
                  className="w-full px-4 py-3 border rounded-xl outline-none"
                >
                  <option value="">Assign Organization</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-4 py-3 border rounded-xl outline-none"
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>

              <button className="w-full bg-[#ff5a1f] text-white py-3 rounded-xl font-bold hover:bg-[#e24d17]">
                {editing ? "Save Changes" : "Create User"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default UsersRoles;