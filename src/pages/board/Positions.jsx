import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
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
      <div className="page-head">
        <div>
          <div className="page-kicker">Ballot Structure</div>
          <h1 className="page-title">Board positions</h1>
          <p className="page-subtitle">
            Manage election positions for your assigned organization.
          </p>
        </div>

        <button
          onClick={openCreate}
          className="primary-btn self-start lg:self-auto"
        >
          <Plus size={18} />
          Add Position
        </button>
      </div>

      {positions.length === 0 ? (
        <div className="empty-state mt-8">No positions found.</div>
      ) : (
        <div className="entity-grid">
          {positions.map((position) => (
            <div key={position.id} className="entity-card lift-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff7a35]">
                    {position.elections?.title || "Unknown election"}
                  </p>
                  <h2 className="entity-card-title mt-2">{position.name}</h2>
                </div>
                <span className="status-pill">{position.max_votes} vote{position.max_votes > 1 ? "s" : ""}</span>
              </div>
              <p className="entity-meta">Set the number of choices students may submit for this role.</p>
              <div className="entity-actions">
                <button onClick={() => openEdit(position)} className="icon-action">
                  <Pencil size={16} />
                </button>
                <button onClick={() => handleDelete(position.id)} className="icon-action icon-action-danger">
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
                {editing ? "Edit Position" : "Add Position"}
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
                <label className="field-label">Position Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Position name, e.g. President"
                className="field-shell w-full"
              />
              </div>

              <div>
                <label className="field-label">Max Votes</label>
              <input
                required
                type="number"
                min="1"
                value={form.max_votes}
                onChange={(e) =>
                  setForm({ ...form, max_votes: e.target.value })
                }
                placeholder="Max votes"
                className="field-shell w-full"
              />
              </div>

              <button className="primary-btn w-full">
                {editing ? "Save Changes" : "Create Position"}
              </button>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default BoardPositions;
