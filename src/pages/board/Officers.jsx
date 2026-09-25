import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import StudentSearchPicker from "../../components/StudentSearchPicker";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../../utils/deleteGuards";
import { fetchEligibleStudentsForOrganization } from "../../utils/organizationAccess";

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
  const prompt = usePrompt();
  const [officers, setOfficers] = useState([]);
  const [students, setStudents] = useState([]);
  const [studentQuery, setStudentQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingOfficer, setEditingOfficer] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;
  const orgName = user?.organization_name || user?.organizations?.name || "your organization";

  useEffect(() => {
    let active = true;

    async function loadData() {
      if (!orgId) return;

      let studentData = [];
      try {
        studentData = await fetchEligibleStudentsForOrganization(orgId);
      } catch (error) {
        console.error("Failed to load eligible officer students:", error);
      }

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

      setStudents(studentData || []);
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
    setStudentQuery("");
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
      prompt.error(error.message);
      return;
    }

    prompt.success(editingOfficer ? "Officer updated." : "Officer created.");
    setFormOpen(false);
    refreshOfficers();
  }

  async function handleDelete(officer) {
    const id = officer.id;
    const label =
      officer.students
        ? `${officer.students.first_name} ${officer.students.last_name}`
        : officer.officer_name || "Officer";
    const analysis = await analyzeDeleteDependencies("officer", {
      ...officer,
      organization_id: orgId,
    });

    if (analysis.blocked) {
      await logAuditEvent({
        action: "officer_delete_blocked",
        entityType: "officer",
        entityId: id,
        entityLabel: label,
        organizationId: orgId,
        organizationName: user?.organizations?.name,
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

    const recheck = await analyzeDeleteDependencies("officer", {
      ...officer,
      organization_id: orgId,
    });
    if (recheck.blocked) {
      prompt.error(dependencyMessage(label, recheck));
      return;
    }

    const { error } = await supabase.from("officers").delete().eq("id", id);
    if (error) {
      prompt.error(error.message || "Failed to delete officer.");
      return;
    }
    prompt.success("Officer deleted.");
    await logAuditEvent({
      action: "officer_deleted",
      entityType: "officer",
      entityId: id,
      entityLabel: label,
      organizationId: orgId,
      organizationName: user?.organizations?.name,
      status: "completed",
    });
    refreshOfficers();
  }

  function officerDisplayName(officer) {
    return officer.students
      ? `${officer.students.first_name || ""} ${officer.students.last_name || ""}`.trim()
      : officer.officer_name || "Officer";
  }

  function officerInitials(officer) {
    const name = officerDisplayName(officer);
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "O";
  }

  function officerPeriod(officer) {
    if (officer.term_start && officer.term_end) return `${officer.term_start} - ${officer.term_end}`;
    if (officer.term_start) return `From ${officer.term_start}`;
    if (officer.term_end) return `Until ${officer.term_end}`;
    return "Period not set";
  }

  const currentOfficers = officers.filter((officer) => officer.is_current);
  const previousOfficers = officers.filter((officer) => !officer.is_current);

  function renderOfficerRecord(officer, section = "current") {
    return (
      <article key={officer.id} className={`board-officer-record is-${section}`}>
        <div className="board-officer-office">
          <span>Office</span>
          <strong>{officer.position_title}</strong>
        </div>

        <div className="board-officer-person">
          <div className="board-officer-avatar">
            {officer.photo_url ? (
              <img src={officer.photo_url} alt="" loading="lazy" />
            ) : (
              <span>{officerInitials(officer)}</span>
            )}
          </div>
          <div>
            <h3>{officerDisplayName(officer)}</h3>
            <p>
              {officer.students?.student_number
                ? `Student No. ${officer.students.student_number}`
                : "Unlinked officer record"}
            </p>
          </div>
        </div>

        <div className="board-officer-period">
          <span>{officer.term_label || "No term label"}</span>
          <strong>{officerPeriod(officer)}</strong>
        </div>

        <div className="board-officer-actions">
          <span className={`board-officer-state ${officer.is_current ? "is-current" : "is-previous"}`}>
            {officer.is_current ? "Current" : "Previous"}
          </span>
          <button
            type="button"
            onClick={() => openEditForm(officer)}
            className="icon-action"
            aria-label={`Edit ${officerDisplayName(officer)}`}
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            onClick={() => handleDelete(officer)}
            className="icon-action icon-action-danger"
            aria-label={`Delete ${officerDisplayName(officer)}`}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </article>
    );
  }

  return (
    <div className="board-officers-desktop">
      <div className="page-head board-officers-opening">
        <div className="board-officers-opening-copy">
          <div className="page-kicker board-officers-kicker">Organizational Leadership</div>
          <h1 className="page-title board-officers-title">Officer record</h1>
          <p className="page-subtitle">
            Maintain current and previous leadership records for {orgName}.
          </p>
        </div>

        <button
          onClick={openCreateForm}
          className="primary-btn board-officers-create self-start lg:self-auto"
        >
          <Plus size={18} />
          Add Officer
        </button>
      </div>

      {officers.length === 0 ? (
        <div className="empty-state board-officers-state">No officers found.</div>
      ) : (
        <>
          <section className="board-officers-roster" aria-label="Current officers">
            <div className="board-officers-section-head">
              <div>
                <p className="board-officers-section-kicker">Current leadership</p>
                <h2>Current officers</h2>
              </div>
              <span>{currentOfficers.length} records</span>
            </div>

            {currentOfficers.length === 0 ? (
              <div className="board-officers-empty">No current officers recorded.</div>
            ) : (
              <div className="board-officers-list">
                {currentOfficers.map((officer) => renderOfficerRecord(officer, "current"))}
              </div>
            )}
          </section>

          <section className="board-officers-roster is-history" aria-label="Previous officers">
            <div className="board-officers-section-head">
              <div>
                <p className="board-officers-section-kicker">Leadership history</p>
                <h2>Previous officers</h2>
              </div>
              <span>{previousOfficers.length} records</span>
            </div>

            {previousOfficers.length === 0 ? (
              <div className="board-officers-empty">No previous officer records.</div>
            ) : (
              <div className="board-officers-list">
                {previousOfficers.map((officer) => renderOfficerRecord(officer, "previous"))}
              </div>
            )}
          </section>
        </>
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
                  Keep office assignments, linked students, and term details in one record.
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
                <StudentSearchPicker
                  label="Linked Student"
                  students={students}
                  value={form.student_id}
                  onChange={(studentId) => setForm({ ...form, student_id: studentId })}
                  query={studentQuery}
                  onQueryChange={setStudentQuery}
                  placeholder="Search linked student"
                  emptyText="No students found for this organization."
                />

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
