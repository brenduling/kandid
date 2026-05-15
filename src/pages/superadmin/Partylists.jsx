import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { supabase } from "../../lib/supabaseClient";
import { readFileAsDataUrl } from "../../utils/files";

function Partylists() {
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
      logo_url: "",
    });
    setFormOpen(true);
  }

  function openEdit(p) {
    setEditing(p);
    setForm({
      election_id: p.election_id,
      name: p.name,
      description: p.description || "",
      logo_url: p.logo_url || "",
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
          <div className="page-kicker">Political Groups</div>
          <h1 className="page-title">Partylist management</h1>
          <p className="page-subtitle">
            Create and manage election partylists.
          </p>
        </div>

        <button
          onClick={openCreate}
          className="primary-btn self-start lg:self-auto"
        >
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
                <td colSpan="5" className="px-6 py-10 text-center empty-copy">
                  No partylists found.
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
                    {p.elections?.title || "-"}
                  </td>
                  <td className="text-[#5a5548]">
                    {p.description || "No description"}
                  </td>
                  <td>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(p)}
                        className="icon-action"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        onClick={() => handleDelete(p.id)}
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

      {formOpen && (
        <PopupOverlay>
          <div className="modal-card max-w-xl">
            <div className="flex justify-between mb-6">
              <h2 className="text-2xl font-black">
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
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
                placeholder="Partylist Name"
                className="field-shell w-full"
              />
              </div>

              <div>
                <label className="field-label">Description</label>
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="Description"
                className="field-shell min-h-[140px] w-full"
              />
              </div>

              <div>
                <label className="field-label">Logo URL</label>
              <input
                value={form.logo_url}
                onChange={(e) =>
                  setForm({ ...form, logo_url: e.target.value })
                }
                placeholder="Partylist logo URL optional"
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
                {editing ? "Save Changes" : "Create Partylist"}
              </button>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default Partylists;
