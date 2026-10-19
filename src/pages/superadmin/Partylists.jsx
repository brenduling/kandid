import { useEffect, useState } from "react";
import "./RemainingPages.css";
import { Plus, Pencil, Trash2, X, UsersRound } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { supabase } from "../../lib/supabaseClient";
import SuperAdminPageHeader from "../../components/SuperAdminPageHeader";
import { readFileAsDataUrl } from "../../utils/files";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../../utils/deleteGuards";

function Partylists() {
  const prompt = usePrompt();
const [partylists, setPartylists] = useState([]);
  const [candidateCounts, setCandidateCounts] = useState({});
  const [organizations, setOrganizations] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  /* organization_id, not election_id: a partylist belongs to an organization and
     may be referenced by any of that organization's elections. */
  const [form, setForm] = useState({
    organization_id: "",
    name: "",
    description: "",
    logo_url: "",
  });

  useEffect(() => {
    fetchPartylists();
    fetchOrganizations();
  }, []);

  async function fetchPartylists() {
    const { data } = await supabase
      .from("partylists")
      .select(`
        id,
        organization_id,
        name,
        description,
        logo_url,
        organizations (name)
      `)
      .order("id", { ascending: true });

    setPartylists(data || []);

    if (!data?.length) {
      setCandidateCounts({});
      return;
    }

    const { data: candidateRows } = await supabase
      .from("candidates")
      .select("partylist_id")
      .in("partylist_id", data.map((partylist) => partylist.id));

    setCandidateCounts(
      (candidateRows || []).reduce((counts, candidate) => {
        if (!candidate.partylist_id) return counts;
        counts[candidate.partylist_id] = (counts[candidate.partylist_id] || 0) + 1;
        return counts;
      }, {}),
    );
  }

  async function fetchOrganizations() {
    const { data } = await supabase
      .from("organizations")
      .select("id, name")
      .order("name", { ascending: true });

    setOrganizations(data || []);
  }

  function openCreate() {
    setEditing(null);
    setForm({
      organization_id: "",
      name: "",
      description: "",
      logo_url: "",
    });
    setFormOpen(true);
  }

  function openEdit(p) {
    setEditing(p);
    setForm({
      organization_id: p.organization_id,
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
      organization_id: Number(form.organization_id),
      name: form.name,
      description: form.description,
      logo_url: form.logo_url || null,
    };

    if (editing) {
      const { error } = await supabase
        .from("partylists")
        .update(payload)
        .eq("id", editing.id);
      if (error) {
        prompt.error(error.message || "Failed to update partylist.");
        return;
      }
      prompt.success("Partylist updated.");
    } else {
      const { error } = await supabase.from("partylists").insert([payload]);
      if (error) {
        prompt.error(error.message || "Failed to create partylist.");
        return;
      }
      prompt.success("Partylist created.");
    }

    setFormOpen(false);
    fetchPartylists();
  }

  async function handleDelete(partylist) {
    const id = partylist.id;
    const analysis = await analyzeDeleteDependencies("partylist", partylist);

    if (analysis.blocked) {
      await logAuditEvent({
        action: "partylist_delete_blocked",
        entityType: "partylist",
        entityId: id,
        entityLabel: partylist.name,
        status: "requires_action",
        metadata: { dependencies: analysis.dependencies },
      });
      await prompt.alert({
        title: analysis.severity === "archive" ? "Partylist Is Historical" : "Partylist Cannot Be Deleted Yet",
        message: dependencyMessage(partylist.name || "This partylist", analysis),
        type: "warning",
        confirmText: "Review Candidates",
      });
      return;
    }

    const ok = await prompt.confirm({
      title: "Delete Partylist?",
      message: dependencyMessage(partylist.name || "This partylist", analysis),
      type: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;

    const recheck = await analyzeDeleteDependencies("partylist", partylist);
    if (recheck.blocked) {
      prompt.error(dependencyMessage(partylist.name || "This partylist", recheck));
      return;
    }

    const { error } = await supabase.from("partylists").delete().eq("id", id);
    if (error) {
      prompt.error(error.message || "Failed to delete partylist.");
      return;
    }
    prompt.success("Partylist deleted.");
    await logAuditEvent({
      action: "partylist_deleted",
      entityType: "partylist",
      entityId: id,
      entityLabel: partylist.name,
      status: "completed",
    });
    fetchPartylists();
  }

  return (
    <div className="sa-remaining-page sa-partylists">
      <SuperAdminPageHeader
        section="Election operations"
        title="Partylists"
        description="Manage organization-level party affiliations used in elections."
        actions={<button onClick={openCreate} className="primary-btn"><Plus size={18} />Add Partylist</button>}
      />

      {partylists.length === 0 ? (
        <div className="empty-state mt-8">No partylists found.</div>
      ) : (
        <div className="partylist-card-grid mt-8">
          {partylists.map((p) => (
            <article key={p.id} className="partylist-card">
              <div className="partylist-card-logo">
                {p.logo_url ? (
                  <img src={p.logo_url} alt={`${p.name} logo`} />
                ) : (
                  <span>{p.name?.slice(0, 2).toUpperCase() || "PL"}</span>
                )}
              </div>
              <div className="partylist-card-body">
                <p className="page-kicker">{p.organizations?.name || "Organization"}</p>
                <h2>{p.name}</h2>
                <p>{p.description || "No description provided."}</p>
              </div>
              <div className="partylist-card-footer">
                <span>
                  <UsersRound size={16} />
                  {candidateCounts[p.id] || 0} candidate{candidateCounts[p.id] === 1 ? "" : "s"}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(p)} className="icon-action" title="Edit partylist">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => handleDelete(p)} className="icon-action icon-action-danger" title="Delete partylist">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {formOpen && (
        <PopupOverlay>
          <div className="modal-card max-w-xl sa-remaining-dialog">
            <div className="flex justify-between mb-6">
              <h2 className="text-2xl font-black">
                {editing ? "Edit Partylist" : "Add Partylist"}
              </h2>

              <button onClick={() => setFormOpen(false)}>
                <X />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="modal-form-stack">
              {/* Super Admin is not organization-scoped by session, so the owning
                  organization is selected here. This replaces the former
                  Election field rather than being added alongside it. */}
              <div>
                <label className="field-label">Organization</label>
              <select
                required
                value={form.organization_id}
                onChange={(e) =>
                  setForm({ ...form, organization_id: e.target.value })
                }
                className="field-shell w-full"
              >
                <option value="">Select Organization</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
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
