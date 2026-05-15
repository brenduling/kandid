import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { supabase } from "../../lib/supabaseClient";
import { readFileAsDataUrl } from "../../utils/files";

function BoardPartylists() {
  const [partylists, setPartylists] = useState([]);
  const [elections, setElections] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [form, setForm] = useState({
    election_id: "",
    name: "",
    description: "",
    logo_url: "",
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
      logo_url: "",
    });
    setFormOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      election_id: item.election_id,
      name: item.name,
      description: item.description || "",
      logo_url: item.logo_url || "",
    });
    setFormOpen(true);
  }

  async function handleLogoUpload(file) {
    if (!file) return;

    const dataUrl = await readFileAsDataUrl(file);
    setForm({ ...form, logo_url: dataUrl });
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      election_id: Number(form.election_id),
      name: form.name,
      description: form.description,
      logo_url: form.logo_url || null,
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
      <div className="page-head">
        <div>
          <div className="page-kicker">Organization Groups</div>
          <h1 className="page-title">Board partylists</h1>
          <p className="page-subtitle">
            Manage partylists for elections under your organization.
          </p>
        </div>

        <button onClick={openCreate} className="primary-btn self-start lg:self-auto">
          <Plus size={18} />
          Add Partylist
        </button>
      </div>

      <div className="table-shell mt-8">
        <table className="app-table">
          <thead>
            <tr>
              <th>Logo</th>
              <th>Name</th>
              <th>Election</th>
              <th>Description</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {partylists.length === 0 ? (
              <tr>
                <td colSpan="5" className="p-6 text-center empty-copy">
                  No partylists yet.
                </td>
              </tr>
            ) : (
              partylists.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.logo_url ? (
                      <img
                        src={p.logo_url}
                        alt={`${p.name} logo`}
                        className="h-12 w-12 rounded-2xl object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(17,128,106,0.12)] text-xs font-black text-[#11806a]">
                        LOGO
                      </div>
                    )}
                  </td>
                  <td className="font-bold">{p.name}</td>
                  <td>
                    {p.elections?.title}
                  </td>
                  <td className="text-[#5a5548]">
                    {p.description || "-"}
                  </td>

                  <td>
                    <button
                      onClick={() => openEdit(p)}
                      className="icon-action mr-2"
                    >
                      <Pencil size={16} />
                    </button>

                    <button
                      onClick={() => handleDelete(p.id)}
                      className="icon-action icon-action-danger"
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
        <PopupOverlay>
          <div className="modal-card w-full max-w-md">
            <div className="flex justify-between mb-4">
              <h2 className="text-xl font-black">
                {editing ? "Edit Partylist" : "Add Partylist"}
              </h2>

              <button onClick={() => setFormOpen(false)}>
                <X />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="modal-form-stack">
              <div>
                <label className="field-label">Election</label>
              <select
                required
                value={form.election_id}
                onChange={(e) =>
                  setForm({ ...form, election_id: e.target.value })
                }
                className="field-shell w-full"
              >
                <option value="">Select Election</option>
                {elections.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
              </div>

              <div>
                <label className="field-label">Partylist Name</label>
              <input
                required
                placeholder="Partylist Name"
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
                className="field-shell w-full"
              />
              </div>

              <div>
                <label className="field-label">Description</label>
              <textarea
                placeholder="Description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                className="field-shell min-h-[140px] w-full"
              />
              </div>

              <div>
                <label className="field-label">Logo URL</label>
              <input
                placeholder="Partylist logo URL optional"
                value={form.logo_url}
                onChange={(e) =>
                  setForm({ ...form, logo_url: e.target.value })
                }
                className="field-shell w-full"
              />
              </div>

              <div className="upload-shell">
                <p className="mb-3 text-sm font-bold text-[#1d262f]">Partylist Logo</p>
                <div className="flex items-center gap-4">
                  {form.logo_url ? (
                    <img
                      src={form.logo_url}
                      alt="Partylist logo preview"
                      className="h-16 w-16 rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(17,128,106,0.12)] text-xs font-black text-[#11806a]">
                      LOGO
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleLogoUpload(e.target.files?.[0])}
                    className="text-sm text-[#5a5548]"
                  />
                </div>
              </div>

              <button className="primary-btn w-full">
                Save
              </button>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default BoardPartylists;
