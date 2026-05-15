import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { supabase } from "../../lib/supabaseClient";

function Positions() {
  const [positions, setPositions] = useState([]);
  const [elections, setElections] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPosition, setEditingPosition] = useState(null);

  const [form, setForm] = useState({
    election_id: "",
    name: "",
    max_votes: 1,
  });

  useEffect(() => {
    fetchElections();
    fetchPositions();
  }, []);

  async function fetchElections() {
    const { data } = await supabase
      .from("elections")
      .select("id, title");

    setElections(data || []);
  }

  async function fetchPositions() {
    const { data, error } = await supabase
      .from("positions")
      .select(`
        *,
        elections (title)
      `)
      .order("id", { ascending: true });

    if (!error) setPositions(data || []);
  }

  function openCreateForm() {
    setEditingPosition(null);
    setForm({
      election_id: "",
      name: "",
      max_votes: 1,
    });
    setFormOpen(true);
  }

  function openEditForm(position) {
    setEditingPosition(position);
    setForm({
      election_id: position.election_id,
      name: position.name,
      max_votes: position.max_votes,
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

    if (editingPosition) {
      await supabase
        .from("positions")
        .update(payload)
        .eq("id", editingPosition.id);
    } else {
      await supabase.from("positions").insert([payload]);
    }

    setFormOpen(false);
    fetchPositions();
  }

  async function handleDelete(id) {
    const confirmDelete = window.confirm("Delete this position?");
    if (!confirmDelete) return;

    await supabase.from("positions").delete().eq("id", id);
    fetchPositions();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Ballot Structure</div>
          <h1 className="page-title">Positions</h1>
          <p className="page-subtitle">
            Define positions for each election and voting limits.
          </p>
        </div>

        <button
          onClick={openCreateForm}
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
          {positions.map((pos) => (
            <div key={pos.id} className="entity-card lift-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff7a35]">
                    {pos.elections?.title || "Unknown election"}
                  </p>
                  <h2 className="entity-card-title mt-2">{pos.name}</h2>
                </div>
                <span className="status-pill">{pos.max_votes} vote{pos.max_votes > 1 ? "s" : ""}</span>
              </div>
              <p className="entity-meta">
                Limit how many candidates a voter can select for this position.
              </p>
              <div className="entity-actions">
                <button onClick={() => openEditForm(pos)} className="icon-action">
                  <Pencil size={16} />
                </button>
                <button onClick={() => handleDelete(pos.id)} className="icon-action icon-action-danger">
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
                {editingPosition ? "Edit Position" : "Add Position"}
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
                {elections.map((el) => (
                  <option key={el.id} value={el.id}>
                    {el.title}
                  </option>
                ))}
              </select>
              </div>

              <div>
                <label className="field-label">Position Name</label>
              <input
                required
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
                placeholder="Position Name (e.g. President)"
                className="field-shell w-full"
              />
              </div>

              <div>
                <label className="field-label">Max Votes</label>
              <input
                type="number"
                min="1"
                value={form.max_votes}
                onChange={(e) =>
                  setForm({ ...form, max_votes: e.target.value })
                }
                className="field-shell w-full"
                placeholder="Max Votes"
              />
              </div>

              <button className="primary-btn w-full">
                {editingPosition ? "Save Changes" : "Create Position"}
              </button>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default Positions;
