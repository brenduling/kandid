import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { supabase } from "../../lib/supabaseClient";

const emptyForm = {
  student_id: "",
  officer_name: "",
  position_title: "",
  term_label: "",
  term_start: "",
  term_end: "",
  photo_url: "",
  is_current: true,
  display_order: 0,
};

function BoardOfficers() {
  const [officers, setOfficers] = useState([]);
  const [students, setStudents] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingOfficer, setEditingOfficer] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;

  useEffect(() => {
    let active = true;

    async function loadData() {
      if (!orgId) return;

      const { data: studentData } = await supabase
        .from("student_organizations")
        .select(`
          students (
            id,
            first_name,
            last_name,
            student_number
          )
        `)
        .eq("organization_id", orgId);

      const { data: officerData } = await supabase
        .from("officers")
        .select(`
          *,
          students (
            first_name,
            last_name,
            student_number
          )
        `)
        .eq("organization_id", orgId)
        .order("is_current", { ascending: false })
        .order("display_order", { ascending: true })
        .order("term_end", { ascending: false });

      if (!active) return;

      setStudents((studentData || []).map((item) => item.students).filter(Boolean));
      setOfficers(officerData || []);
    }

    loadData();

    return () => {
      active = false;
    };
  }, [orgId]);

  async function refreshOfficers() {
    if (!orgId) return;

    const { data } = await supabase
      .from("officers")
      .select(`
        *,
        students (
          first_name,
          last_name,
          student_number
        )
      `)
      .eq("organization_id", orgId)
      .order("is_current", { ascending: false })
      .order("display_order", { ascending: true })
      .order("term_end", { ascending: false });

    setOfficers(data || []);
  }

  function openCreateForm() {
    setEditingOfficer(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEditForm(officer) {
    setEditingOfficer(officer);
    setForm({
      student_id: officer.student_id || "",
      officer_name: officer.officer_name || "",
      position_title: officer.position_title || "",
      term_label: officer.term_label || "",
      term_start: officer.term_start || "",
      term_end: officer.term_end || "",
      photo_url: officer.photo_url || "",
      is_current: Boolean(officer.is_current),
      display_order: officer.display_order || 0,
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      organization_id: orgId,
      student_id: form.student_id ? Number(form.student_id) : null,
      officer_name: form.officer_name || null,
      position_title: form.position_title,
      term_label: form.term_label || null,
      term_start: form.term_start || null,
      term_end: form.term_end || null,
      photo_url: form.photo_url || null,
      is_current: form.is_current,
      display_order: Number(form.display_order || 0),
    };

    if (!payload.student_id && !payload.officer_name) {
      alert("Select a student or enter an officer name.");
      return;
    }

    const query = editingOfficer
      ? supabase.from("officers").update(payload).eq("id", editingOfficer.id)
      : supabase.from("officers").insert([payload]);

    const { error } = await query;

    if (error) {
      alert(error.message);
      return;
    }

    setFormOpen(false);
    refreshOfficers();
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this officer entry?")) return;

    await supabase.from("officers").delete().eq("id", id);
    refreshOfficers();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Officer Directory</div>
          <h1 className="page-title">Board officers</h1>
          <p className="page-subtitle">
            Manage current and previous officers for your organization.
          </p>
        </div>

        <button
          onClick={openCreateForm}
          className="primary-btn self-start lg:self-auto"
        >
          <Plus size={18} />
          Add Officer
        </button>
      </div>

      {officers.length === 0 ? (
        <div className="empty-state mt-8">No officers found.</div>
      ) : (
        <div className="entity-grid">
          {officers.map((officer) => (
            <div key={officer.id} className="entity-card lift-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff7a35]">
                    {officer.position_title}
                  </p>
                  <h2 className="entity-card-title mt-2">
                    {officer.students
                      ? `${officer.students.first_name} ${officer.students.last_name}`
                      : officer.officer_name}
                  </h2>
                </div>
                <span className={`status-pill ${officer.is_current ? "" : "!bg-white/60 !text-[#5a5548]"}`}>
                  {officer.is_current ? "Current" : "Previous"}
                </span>
              </div>
              <p className="entity-meta">{officer.term_label || "No term label"}</p>
              <div className="entity-actions">
                <button onClick={() => openEditForm(officer)} className="icon-action">
                  <Pencil size={16} />
                </button>
                <button onClick={() => handleDelete(officer.id)} className="icon-action icon-action-danger">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <PopupOverlay>
          <div className="popup-sheet popup-sheet-wide">
            <div className="popup-header !mb-4">
              <div className="popup-header-copy">
                <p className="field-label !mb-3">Officer Directory</p>
                <h2 className="surface-title text-[1.7rem] font-black tracking-tight">
                  {editingOfficer ? "Edit officer" : "Add officer"}
                </h2>
                <p className="surface-copy mt-1 text-sm leading-5">
                  Keep officer assignments and term details in a cleaner, wider form.
                </p>
              </div>
              <button
                onClick={() => setFormOpen(false)}
                className="popup-close"
                type="button"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="popup-content">
              <div className="popup-form-grid-compact !md:grid-cols-3 !xl:grid-cols-4">
                <select
                  value={form.student_id}
                  onChange={(e) => setForm({ ...form, student_id: e.target.value })}
                  className="field-shell w-full"
                >
                  <option value="">Select Student (optional)</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.last_name}, {student.first_name} - {student.student_number}
                    </option>
                  ))}
                </select>

                <input
                  value={form.officer_name}
                  onChange={(e) => setForm({ ...form, officer_name: e.target.value })}
                  placeholder="Officer name fallback"
                  className="field-shell w-full"
                />

                <input
                  required
                  value={form.position_title}
                  onChange={(e) => setForm({ ...form, position_title: e.target.value })}
                  placeholder="Position title"
                  className="field-shell w-full"
                />

                <input
                  value={form.term_label}
                  onChange={(e) => setForm({ ...form, term_label: e.target.value })}
                  placeholder="Term label"
                  className="field-shell w-full"
                />

                <input
                  type="date"
                  value={form.term_start}
                  onChange={(e) => setForm({ ...form, term_start: e.target.value })}
                  className="field-shell w-full"
                />

                <input
                  type="date"
                  value={form.term_end}
                  onChange={(e) => setForm({ ...form, term_end: e.target.value })}
                  className="field-shell w-full"
                />

                <input
                  value={form.photo_url}
                  onChange={(e) => setForm({ ...form, photo_url: e.target.value })}
                  placeholder="Photo URL optional"
                  className="field-shell w-full md:col-span-2 xl:col-span-2"
                />

                <label className="toggle-surface xl:col-span-2">
                  <input
                    type="checkbox"
                    checked={form.is_current}
                    onChange={(e) =>
                      setForm({ ...form, is_current: e.target.checked })
                    }
                  />
                  Mark as current officer
                </label>

                <input
                  type="number"
                  value={form.display_order}
                  onChange={(e) =>
                    setForm({ ...form, display_order: e.target.value })
                  }
                  placeholder="Display order"
                  className="field-shell w-full"
                />
              </div>

              <div className="popup-actions">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="secondary-btn"
                >
                  Cancel
                </button>

                <button className="primary-btn min-w-52">
                  {editingOfficer ? "Save Changes" : "Add Officer"}
                </button>
              </div>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default BoardOfficers;
