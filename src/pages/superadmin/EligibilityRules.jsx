import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { supabase } from "../../lib/supabaseClient";

function EligibilityRules() {
  const [rules, setRules] = useState([]);
  const [elections, setElections] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [form, setForm] = useState({
    election_id: "",
    program: "",
    min_year_level: "",
    max_year_level: "",
    allow_shs: false,
  });

  useEffect(() => {
    fetchRules();
    fetchElections();
  }, []);

  async function fetchRules() {
    const { data, error } = await supabase
      .from("eligibility_rules")
      .select(`
        *,
        elections (
          title
        )
      `)
      .order("id", { ascending: true });

    if (!error) setRules(data || []);
    if (error) console.log(error);
  }

  async function fetchElections() {
    const { data, error } = await supabase
      .from("elections")
      .select("id, title")
      .order("id", { ascending: true });

    if (!error) setElections(data || []);
    if (error) console.log(error);
  }

  function openCreate() {
    setEditing(null);
    setForm({
      election_id: "",
      program: "",
      min_year_level: "",
      max_year_level: "",
      allow_shs: false,
    });
    setFormOpen(true);
  }

  function openEdit(rule) {
    setEditing(rule);
    setForm({
      election_id: rule.election_id || "",
      program: rule.program || "",
      min_year_level: rule.min_year_level || "",
      max_year_level: rule.max_year_level || "",
      allow_shs: rule.allow_shs || false,
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      election_id: Number(form.election_id),
      program: form.program || null,
      min_year_level: form.min_year_level
        ? Number(form.min_year_level)
        : null,
      max_year_level: form.max_year_level
        ? Number(form.max_year_level)
        : null,
      allow_shs: form.allow_shs,
    };

    if (editing) {
      await supabase
        .from("eligibility_rules")
        .update(payload)
        .eq("id", editing.id);
    } else {
      await supabase.from("eligibility_rules").insert([payload]);
    }

    setFormOpen(false);
    fetchRules();
  }

  async function handleDelete(id) {
    const confirmDelete = window.confirm("Delete this eligibility rule?");
    if (!confirmDelete) return;

    await supabase.from("eligibility_rules").delete().eq("id", id);
    fetchRules();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Voting Access</div>
          <h1 className="page-title">Eligibility rules</h1>
          <p className="page-subtitle">
            Define who is allowed to vote in each election.
          </p>
        </div>

        <button
          onClick={openCreate}
          className="primary-btn self-start lg:self-auto"
        >
          <Plus size={18} />
          Add Rule
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="empty-state mt-8">No eligibility rules found.</div>
      ) : (
        <div className="entity-grid">
          {rules.map((rule) => (
            <div key={rule.id} className="entity-card lift-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff7a35]">
                    {rule.elections?.title || "Unknown election"}
                  </p>
                  <h2 className="entity-card-title mt-2">{rule.program || "All programs"}</h2>
                </div>
                <span className={`status-pill ${rule.allow_shs ? "" : "!bg-red-100 !text-red-700"}`}>
                  {rule.allow_shs ? "SHS on" : "SHS off"}
                </span>
              </div>
              <p className="entity-meta">
                Year level: {rule.min_year_level || "-"} to {rule.max_year_level || "-"}.
              </p>
              <div className="entity-actions">
                <button onClick={() => openEdit(rule)} className="icon-action">
                  <Pencil size={16} />
                </button>
                <button onClick={() => handleDelete(rule.id)} className="icon-action icon-action-danger">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <PopupOverlay>
          <div className="modal-card max-w-lg">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black">
                {editing ? "Edit Eligibility Rule" : "Add Eligibility Rule"}
              </h2>

              <button
                onClick={() => setFormOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <X size={20} />
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
                {elections.map((election) => (
                  <option key={election.id} value={election.id}>
                    {election.title}
                  </option>
                ))}
              </select>
              </div>

              <div>
                <label className="field-label">Program</label>
              <input
                value={form.program}
                onChange={(e) =>
                  setForm({ ...form, program: e.target.value })
                }
                placeholder="Program e.g. BSIT (leave blank for all)"
                className="field-shell w-full"
              />
              </div>

              <div className="modal-form-grid">
                <input
                  type="number"
                  min="1"
                  value={form.min_year_level}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      min_year_level: e.target.value,
                    })
                  }
                  placeholder="Min Year Level"
                  className="field-shell"
                />

                <input
                  type="number"
                  min="1"
                  value={form.max_year_level}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      max_year_level: e.target.value,
                    })
                  }
                  placeholder="Max Year Level"
                  className="field-shell"
                />
              </div>

              <label className="flex items-center gap-3 rounded-2xl border border-[rgba(255,115,22,0.14)] bg-white/45 px-4 py-3">
                <input
                  type="checkbox"
                  checked={form.allow_shs}
                  onChange={(e) =>
                    setForm({ ...form, allow_shs: e.target.checked })
                  }
                />
                <span className="font-semibold text-sm">
                  Allow SHS students to vote
                </span>
              </label>

              <button className="primary-btn w-full">
                {editing ? "Save Changes" : "Create Rule"}
              </button>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default EligibilityRules;
