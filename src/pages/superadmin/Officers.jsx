import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import StudentSearchPicker from "../../components/StudentSearchPicker";
import OrganizationSelect from "../../components/OrganizationSelect";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../../utils/deleteGuards";

const emptyForm = {
  organization_id: "",
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

function Officers() {
  const prompt = usePrompt();
  const [officers, setOfficers] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [students, setStudents] = useState([]);
  const [studentQuery, setStudentQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingOfficer, setEditingOfficer] = useState(null);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    fetchOrganizations();
    fetchOfficers();
  }, []);

  async function fetchOrganizations() {
    const { data } = await supabase
      .from("organizations")
      .select("id, name, logo_url")
      .order("name", { ascending: true });

    setOrganizations(data || []);
  }

  async function fetchStudentsForOrganization(organizationId) {
    if (!organizationId) {
      setStudents([]);
      return;
    }

    const { data } = await supabase
      .from("student_organizations")
      .select(`
        students (
          id,
          first_name,
          last_name,
          student_number,
          photo_url,
          program,
          year_level
        )
      `)
      .eq("organization_id", organizationId);

    setStudents((data || []).map((item) => item.students).filter(Boolean));
  }

  async function fetchOfficers() {
    const { data } = await supabase
      .from("officers")
      .select(`
        *,
        organizations (
          name
        ),
        students (
          first_name,
          last_name,
          student_number
        )
      `)
      .order("is_current", { ascending: false })
      .order("display_order", { ascending: true })
      .order("term_end", { ascending: false });

    setOfficers(data || []);
  }

  function openCreateForm() {
    setEditingOfficer(null);
    setStudents([]);
    setStudentQuery("");
    setForm(emptyForm);
    setFormOpen(true);
  }

  async function openEditForm(officer) {
    setEditingOfficer(officer);
    await fetchStudentsForOrganization(officer.organization_id);
    setForm({
      organization_id: officer.organization_id || "",
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
    setStudentQuery(
      officer.students
        ? `${officer.students.first_name || ""} ${officer.students.last_name || ""}`.trim()
        : ""
    );
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      organization_id: Number(form.organization_id),
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
      await prompt.alert({
        title: "Missing Information",
        message: "Select a student or enter an officer name.",
        type: "warning",
      });
      return;
    }

    const query = editingOfficer
      ? supabase.from("officers").update(payload).eq("id", editingOfficer.id)
      : supabase.from("officers").insert([payload]);

    const { error } = await query;

    if (error) {
      console.error("Officer save failed:", error);
      prompt.error(error.message);
      return;
    }

    prompt.success(editingOfficer ? "Officer updated." : "Officer created.");
    setFormOpen(false);
    fetchOfficers();
  }

  async function handleDelete(officer) {
    const id = officer.id;
    const label =
      officer.students
        ? `${officer.students.first_name} ${officer.students.last_name}`
        : officer.officer_name || "Officer";
    const analysis = await analyzeDeleteDependencies("officer", officer);

    if (analysis.blocked) {
      await logAuditEvent({
        action: "officer_delete_blocked",
        entityType: "officer",
        entityId: id,
        entityLabel: label,
        organizationId: officer.organization_id,
        organizationName: officer.organizations?.name,
        status: "requires_action",
        metadata: { dependencies: analysis.dependencies },
      });
      await prompt.alert({
        title: "Officer Record Should Be Preserved",
        message: dependencyMessage(label, analysis),
        type: "warning",
        confirmText: "Review Officer",
      });
      return;
    }

    const ok = await prompt.confirm({
      title: "Delete Officer Entry?",
      message: dependencyMessage(label, analysis),
      type: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;

    const recheck = await analyzeDeleteDependencies("officer", officer);
    if (recheck.blocked) {
      prompt.error(dependencyMessage(label, recheck));
      return;
    }

    const { error } = await supabase.from("officers").delete().eq("id", id);
    if (error) {
      console.error("Officer delete failed:", error);
      prompt.error(error.message || "Failed to delete officer.");
      return;
    }
    prompt.success("Officer deleted.");
    await logAuditEvent({
      action: "officer_deleted",
      entityType: "officer",
      entityId: id,
      entityLabel: label,
      organizationId: officer.organization_id,
      organizationName: officer.organizations?.name,
      status: "completed",
    });
    fetchOfficers();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Officer Management</div>
          <h1 className="page-title">
            Cross-organization
            <span className="page-title-accent"> officer records</span>
          </h1>
          <p className="page-subtitle">
            Maintain current and previous officers across organizations.
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
                    {officer.organizations?.name || "Organization"}
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
              <p className="entity-meta">{officer.position_title}</p>
              <p className="entity-meta">{officer.term_label || "No term label"}</p>
              <div className="entity-actions">
                <button onClick={() => openEditForm(officer)} className="icon-action">
                  <Pencil size={16} />
                </button>
                <button onClick={() => handleDelete(officer)} className="icon-action icon-action-danger">
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
                  Link officers to organizations, preserve term details, and keep the directory readable.
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
                <OrganizationSelect
                  organizations={organizations}
                  value={form.organization_id}
                  onChange={(organizationId) => {
                    setForm({ ...form, organization_id: organizationId, student_id: "" });
                    fetchStudentsForOrganization(organizationId);
                  }}
                />

                <div>
                  <StudentSearchPicker
                    label="Linked Student"
                    students={students}
                    value={form.student_id}
                    onChange={(studentId) => setForm({ ...form, student_id: studentId })}
                    query={studentQuery}
                    onQueryChange={setStudentQuery}
                    disabled={!form.organization_id}
                    placeholder="Search linked student"
                    emptyText="No students found for this organization."
                  />
                </div>

                <div>
                  <label className="field-label">Fallback Name</label>
                  <input
                    value={form.officer_name}
                    onChange={(e) => setForm({ ...form, officer_name: e.target.value })}
                    placeholder="Officer name fallback"
                    className="field-shell w-full"
                  />
                </div>

                <div>
                  <label className="field-label">Position Title</label>
                  <input
                    required
                    value={form.position_title}
                    onChange={(e) => setForm({ ...form, position_title: e.target.value })}
                    placeholder="Position title"
                    className="field-shell w-full"
                  />
                </div>

                <div>
                  <label className="field-label">Term Label</label>
                  <input
                    value={form.term_label}
                    onChange={(e) => setForm({ ...form, term_label: e.target.value })}
                    placeholder="e.g. AY 2025-2026"
                    className="field-shell w-full"
                  />
                </div>

                <div>
                  <label className="field-label">Photo URL</label>
                  <input
                    value={form.photo_url}
                    onChange={(e) => setForm({ ...form, photo_url: e.target.value })}
                    placeholder="Photo URL optional"
                    className="field-shell w-full"
                  />
                </div>

                <div>
                  <label className="field-label">Term Start Date</label>
                  <input
                    type="date"
                    value={form.term_start}
                    onChange={(e) => setForm({ ...form, term_start: e.target.value })}
                    className="field-shell w-full"
                  />
                </div>

                <div>
                  <label className="field-label">Term End Date</label>
                  <input
                    type="date"
                    value={form.term_end}
                    onChange={(e) => setForm({ ...form, term_end: e.target.value })}
                    className="field-shell w-full"
                  />
                </div>

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

                <div>
                  <label className="field-label">Display Order</label>
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

export default Officers;
