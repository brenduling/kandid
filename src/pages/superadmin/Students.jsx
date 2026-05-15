import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, Search } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { supabase } from "../../lib/supabaseClient";
import { readFileAsDataUrl } from "../../utils/files";

function Students() {
  const [students, setStudents] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [search, setSearch] = useState("");
  const [programFilter, setProgramFilter] = useState("all");

  const [form, setForm] = useState({
    student_number: "",
    first_name: "",
    last_name: "",
    email: "",
    photo_url: "",
    program: "",
    year_level: "",
    precinct_code: "",
    batch_code: "",
    organization_id: "",
    is_shs: false,
    status: "pending",
  });

  useEffect(() => {
    fetchStudents();
    fetchOrganizations();
  }, []);

  async function fetchStudents() {
    const { data, error } = await supabase
      .from("students")
      .select(`
        *,
        student_organizations (
          organization_id,
          organizations (
            id,
            name
          )
        )
      `)
      .order("id", { ascending: true });

    if (!error) setStudents(data || []);
  }

  async function fetchOrganizations() {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name")
      .order("name", { ascending: true });

    if (!error) setOrganizations(data || []);
  }

  function openCreateForm() {
    setEditingStudent(null);
    setForm({
      student_number: "",
      first_name: "",
      last_name: "",
      email: "",
      photo_url: "",
      program: "",
      year_level: "",
      precinct_code: "",
      batch_code: "",
      organization_id: "",
      is_shs: false,
      status: "pending",
    });
    setFormOpen(true);
  }

  function openEditForm(student) {
    const primaryOrgId =
      student.student_organizations?.[0]?.organization_id?.toString() || "";

    setEditingStudent(student);
    setForm({
      student_number: student.student_number || "",
      first_name: student.first_name || "",
      last_name: student.last_name || "",
      email: student.email || "",
      photo_url: student.photo_url || "",
      program: student.program || "",
      year_level: student.year_level || "",
      precinct_code: student.precinct_code || "",
      batch_code: student.batch_code || "",
      organization_id: primaryOrgId,
      is_shs: student.is_shs || false,
      status: student.status || "pending",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      student_number: form.student_number,
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email,
      photo_url: form.photo_url || null,
      program: form.program,
      year_level: Number(form.year_level),
      precinct_code: form.precinct_code || null,
      batch_code: form.batch_code || null,
      is_shs: form.is_shs,
      status: form.status,
    };

    let result;
    let savedStudentId = editingStudent?.id || null;

    if (editingStudent) {
      result = await supabase
        .from("students")
        .update(payload)
        .eq("id", editingStudent.id);
    } else {
      result = await supabase
        .from("students")
        .insert([payload])
        .select("id")
        .single();
    }

    const error = result?.error;
    if (error) {
      console.error("Student save failed:", error);
      alert(error.message || "Failed to save student.");
      return;
    }

    if (!editingStudent) {
      savedStudentId = result?.data?.id || null;
    }

    if (!savedStudentId) {
      alert("Student saved, but no student ID was returned for organization linking.");
      return;
    }

    const { error: deleteOrgLinkError } = await supabase
      .from("student_organizations")
      .delete()
      .eq("student_id", savedStudentId);

    if (deleteOrgLinkError) {
      console.error("Existing organization links cleanup failed:", deleteOrgLinkError);
      alert(deleteOrgLinkError.message || "Failed to update student organization link.");
      return;
    }

    if (form.organization_id) {
      const { error: orgLinkError } = await supabase
        .from("student_organizations")
        .insert([
          {
            student_id: savedStudentId,
            organization_id: Number(form.organization_id),
            role: "member",
          },
        ]);

      if (orgLinkError) {
        console.error("Student organization link failed:", orgLinkError);
        alert(orgLinkError.message || "Failed to link student to organization.");
        return;
      }
    }

    setFormOpen(false);
    fetchStudents();
  }

  async function handleDelete(id) {
    const confirmDelete = window.confirm("Delete this student record?");
    if (!confirmDelete) return;

    await supabase.from("students").delete().eq("id", id);
    fetchStudents();
  }

  async function handlePhotoUpload(file) {
    if (!file) return;

    const dataUrl = await readFileAsDataUrl(file);
    setForm({ ...form, photo_url: dataUrl });
  }

  const filteredStudents = students.filter((student) => {
    const fullName = `${student.first_name} ${student.last_name}`.toLowerCase();
    const matchesSearch =
      fullName.includes(search.toLowerCase()) ||
      student.student_number?.toLowerCase().includes(search.toLowerCase());

    const matchesProgram =
      programFilter === "all" || student.program === programFilter;

    return matchesSearch && matchesProgram;
  });

  const programs = [...new Set(students.map((s) => s.program).filter(Boolean))];

  function getStatusColor(status) {
    if (status === "active") return "bg-emerald-500";
    if (status === "disabled") return "bg-red-500";
    return "bg-amber-500";
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Voter Registry</div>
          <h1 className="page-title">Students</h1>
          <p className="page-subtitle">
            Manage student voter records and eligibility data.
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

      <div className="mt-8 flex flex-col gap-4 lg:flex-row">
        <div className="glass-panel-strong flex items-center gap-3 rounded-2xl px-4 py-3 lg:w-[25rem]">
          <Search size={18} className="text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Search by name or student ID..."
          />
        </div>

        <select
          value={programFilter}
          onChange={(e) => setProgramFilter(e.target.value)}
          className="field-shell lg:min-w-[13rem]"
        >
          <option value="all">All Programs</option>
          {programs.map((program) => (
            <option key={program} value={program}>
              {program}
            </option>
          ))}
        </select>
      </div>

      {filteredStudents.length === 0 ? (
        <div className="empty-state mt-6">No students found.</div>
      ) : (
        <div className="section-grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          {filteredStudents.map((student) => (
            <div key={student.id} className="metric-card lift-card relative min-h-[230px]">
              <span
                className={`absolute right-3 top-3 h-3.5 w-3.5 rounded-full ${getStatusColor(
                  student.status,
                )}`}
              />

              <div className="flex flex-col items-center text-center">
                {student.photo_url ? (
                  <img
                    src={student.photo_url}
                    alt={`${student.first_name} ${student.last_name}`}
                    className="h-24 w-24 rounded-[20px] object-cover ring-1 ring-[rgba(37,99,235,0.08)]"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-[20px] bg-[rgba(37,99,235,0.08)] text-xl font-black text-[#2563eb]">
                    {`${student.first_name?.[0] || ""}${student.last_name?.[0] || ""}`}
                  </div>
                )}

                <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7a8498]">
                  {student.program || "Program"}
                </p>
                <h2 className="mt-2 line-clamp-2 text-sm font-black leading-5 text-[#1d262f]">
                  {student.last_name}, {student.first_name}
                </h2>
                <p className="mt-2 text-xs text-gray-500">{student.student_number}</p>
                <p className="mt-1 line-clamp-1 text-[11px] text-gray-400">
                  {student.student_organizations?.[0]?.organizations?.name || "No organization link"}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  onClick={() => openEditForm(student)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/80 text-[#1d1d1d] shadow-sm hover:bg-white"
                >
                  <Pencil size={14} />
                </button>

                <button
                  onClick={() => handleDelete(student.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/80 text-[#1d1d1d] shadow-sm hover:bg-white"
                >
                  <Trash2 size={14} />
                </button>
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
                <p className="field-label !mb-3">Student Registry</p>
                <h2 className="surface-title text-[2rem] font-black tracking-tight">
                  {editingStudent ? "Edit student" : "Add student"}
                </h2>
                <p className="surface-copy mt-2 text-sm leading-6">
                  Capture voter identity, program details, assignment, and access status in one clean form.
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
              <div className="popup-form-grid">
                <div className="popup-form-grid-compact">
                  <div>
                    <label className="field-label">Student ID</label>
                    <input
                      required
                      value={form.student_number}
                      onChange={(e) =>
                        setForm({ ...form, student_number: e.target.value })
                      }
                      placeholder="Enter student ID"
                      className="field-shell w-full"
                    />
                  </div>

                  <div>
                    <label className="field-label">Email</label>
                    <input
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="Enter email"
                      className="field-shell w-full"
                    />
                  </div>

                  <div>
                    <label className="field-label">Program</label>
                    <input
                      required
                      value={form.program}
                      onChange={(e) => setForm({ ...form, program: e.target.value })}
                      placeholder="Program e.g. BSIT"
                      className="field-shell w-full"
                    />
                  </div>

                  <div>
                    <label className="field-label">First Name</label>
                    <input
                      required
                      value={form.first_name}
                      onChange={(e) =>
                        setForm({ ...form, first_name: e.target.value })
                      }
                      placeholder="First name"
                      className="field-shell w-full"
                    />
                  </div>

                  <div>
                    <label className="field-label">Last Name</label>
                    <input
                      required
                      value={form.last_name}
                      onChange={(e) =>
                        setForm({ ...form, last_name: e.target.value })
                      }
                      placeholder="Last name"
                      className="field-shell w-full"
                    />
                  </div>

                  <div>
                    <label className="field-label">Year Level</label>
                    <input
                      required
                      type="number"
                      value={form.year_level}
                      onChange={(e) =>
                        setForm({ ...form, year_level: e.target.value })
                      }
                      placeholder="Year level"
                      className="field-shell w-full"
                    />
                  </div>

                  <div>
                    <label className="field-label">Precinct Code</label>
                    <input
                      value={form.precinct_code}
                      onChange={(e) =>
                        setForm({ ...form, precinct_code: e.target.value })
                      }
                      placeholder="Optional precinct code"
                      className="field-shell w-full"
                    />
                  </div>

                  <div>
                    <label className="field-label">Batch Code</label>
                    <input
                      value={form.batch_code}
                      onChange={(e) =>
                        setForm({ ...form, batch_code: e.target.value })
                      }
                      placeholder="Optional batch code"
                      className="field-shell w-full"
                    />
                  </div>

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
                      {organizations.map((organization) => (
                        <option key={organization.id} value={organization.id}>
                          {organization.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="popup-side-panel">
                    <div>
                      <label className="field-label">Status</label>
                      <select
                        value={form.status}
                        onChange={(e) => setForm({ ...form, status: e.target.value })}
                        className="field-shell w-full"
                      >
                        <option value="pending">Pending</option>
                        <option value="active">Active</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </div>

                    <label className="toggle-surface mt-4">
                      <input
                        type="checkbox"
                        checked={form.is_shs}
                        onChange={(e) =>
                          setForm({ ...form, is_shs: e.target.checked })
                        }
                      />
                      SHS Student
                    </label>
                  </div>

                  <div className="popup-side-panel">
                    <label className="field-label">Student Photo</label>
                    <div className="flex items-center gap-4">
                      {form.photo_url ? (
                        <img
                          src={form.photo_url}
                          alt="Student preview"
                          className="h-16 w-16 rounded-2xl object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(37,99,235,0.08)] text-xs font-black text-[#2563eb]">
                          PHOTO
                        </div>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handlePhotoUpload(e.target.files?.[0])}
                        className="text-sm text-[#5a5548]"
                      />
                    </div>
                    <input
                      value={form.photo_url}
                      onChange={(e) => setForm({ ...form, photo_url: e.target.value })}
                      placeholder="Paste photo URL"
                      className="field-shell mt-3 w-full"
                    />
                  </div>
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
                  {editingStudent ? "Save Changes" : "Create Student"}
                </button>
              </div>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default Students;
