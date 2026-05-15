import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { supabase } from "../../lib/supabaseClient";
import { readFileAsDataUrl } from "../../utils/files";

function Organizations() {
  const [organizations, setOrganizations] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", logo_url: "" });
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
    setForm({ name: "", description: "", logo_url: "" });
    setFormOpen(true);
  }

  function openEditForm(org) {
    setEditingOrg(org);
    setForm({
      name: org.name || "",
      description: org.description || "",
      logo_url: org.logo_url || "",
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
    setLoading(true);

    let result;

    if (editingOrg) {
      result = await supabase
        .from("organizations")
        .update({
          name: form.name,
          description: form.description,
          logo_url: form.logo_url || null,
        })
        .eq("id", editingOrg.id);
    } else {
      result = await supabase.from("organizations").insert([
        {
          name: form.name,
          description: form.description,
          logo_url: form.logo_url || null,
        },
      ]);
    }

    const error = result?.error;
    if (error) {
      console.error("Organization save failed:", error);
      alert(error.message || "Failed to save organization.");
      setLoading(false);
      return;
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
      <div className="page-head">
        <div>
          <div className="page-kicker">Organization Directory</div>
          <h1 className="page-title">
            Organizations
          </h1>
          <p className="page-subtitle">
            Add, update, and manage student organizations.
          </p>
        </div>

        <button
          onClick={openCreateForm}
          className="primary-btn self-start lg:self-auto"
        >
          <Plus size={18} />
          Add
        </button>
      </div>

      {organizations.length === 0 ? (
        <div className="empty-state mt-8">
          No organizations found.
        </div>
      ) : (
        <div className="section-grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {organizations.map((org) => (
            <div key={org.id} className="metric-card lift-card min-h-[220px]">
              <div className="flex items-start gap-4">
                {org.logo_url ? (
                  <img
                    src={org.logo_url}
                    alt={`${org.name} logo`}
                    className="h-14 w-14 rounded-2xl object-cover ring-1 ring-[rgba(37,99,235,0.08)]"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(248,115,22,0.14)] text-sm font-black text-[#f97316]">
                    {(org.name || "O").slice(0, 2).toUpperCase()}
                  </div>
                )}

                <div className="min-w-0">
                  <h2 className="surface-title truncate text-[1.7rem] font-black tracking-tight">
                    {org.name}
                  </h2>
                  <p className="surface-copy mt-2 line-clamp-2 text-sm leading-6">
                    {org.description || "No organization description yet."}
                  </p>
                </div>
              </div>

              <div className="mt-8 flex items-center justify-between gap-3">
                <div className="surface-muted text-xs uppercase tracking-[0.16em]">
                  Added {org.created_at ? new Date(org.created_at).toLocaleDateString() : "-"}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEditForm(org)}
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/70 text-[#1d1d1d] shadow-sm hover:bg-white"
                  >
                    <Pencil size={18} />
                  </button>

                  <button
                    onClick={() => handleDelete(org.id)}
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/70 text-[#1d1d1d] shadow-sm hover:bg-white"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <PopupOverlay>
          <div className="popup-sheet popup-sheet-wide">
            <div className="popup-header">
              <div className="popup-header-copy">
                <p className="field-label !mb-3">Organization Directory</p>
                <h2 className="surface-title text-[2rem] font-black tracking-tight">
                  {editingOrg ? "Edit organization" : "Add organization"}
                </h2>
                <p className="surface-copy mt-2 text-sm leading-6">
                  Keep the name, summary, and logo in one clean record.
                </p>
              </div>

              <button onClick={() => setFormOpen(false)} className="popup-close" type="button">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="popup-content">
              <div className="popup-form-grid">
                <div className="space-y-4">
                  <div>
                    <label className="field-label">Organization Name</label>
                    <input
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      required
                      className="field-shell w-full"
                      placeholder="Enter organization name"
                    />
                  </div>

                  <div>
                    <label className="field-label">Description</label>
                    <textarea
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                      className="field-shell min-h-[180px] w-full resize-none"
                      placeholder="Short description"
                      rows="6"
                    />
                  </div>
                </div>

                <div className="popup-side-panel">
                  <label className="field-label">Organization Logo</label>
                  <div className="flex items-center gap-4">
                    {form.logo_url ? (
                      <img
                        src={form.logo_url}
                        alt="Organization logo preview"
                        className="h-16 w-16 rounded-2xl object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(255,90,31,0.12)] text-xs font-black text-[#ff5a1f]">
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
                  <input
                    value={form.logo_url}
                    onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
                    className="field-shell mt-4 w-full"
                    placeholder="Paste logo image URL"
                  />
                </div>
              </div>

              <div className="popup-actions">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="secondary-btn"
                >
                  Cancel
                </button>
                <button
                  disabled={loading}
                  className="primary-btn min-w-52 disabled:opacity-60"
                >
                  {loading
                    ? "Saving..."
                    : editingOrg
                    ? "Save Changes"
                    : "Create Organization"}
                </button>
              </div>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default Organizations;
