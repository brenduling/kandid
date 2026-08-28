import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { supabase } from "../../lib/supabaseClient";
import { readFileAsDataUrl } from "../../utils/files";
import { syncStudentOrganizationMemberships } from "../../utils/organizationAccess";

function BoardStudents() {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);

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
    is_shs: false,
    status: "pending",
  });

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;

  useEffect(() => {
    let active = true;

    async function loadStudents() {
      const { data, error } = await supabase
        .from("student_organizations")
        .select(`
          students (
            id,
            student_number,
            first_name,
            last_name,
            email,
            photo_url,
            program,
            year_level,
            is_shs,
            status,
            created_at
          )
        `)
        .eq("organization_id", orgId);

      if (!active) return;

      if (error) {
        console.log(error);
        return;
      }

      const list = data.map((item) => item.students).filter(Boolean);
      setStudents(list);
    }

    loadStudents();

    return () => {
      active = false;
    };
  }, [orgId]);

  async function fetchStudents() {
    const { data, error } = await supabase
      .from("student_organizations")
      .select(`
        students (
          id,
          student_number,
          first_name,
          last_name,
          email,
          photo_url,
          program,
          year_level,
          is_shs,
          status,
          created_at
        )
      `)
      .eq("organization_id", orgId);

    if (error) {
      console.log(error);
      return;
    }

    const list = data.map((item) => item.students).filter(Boolean);
    setStudents(list);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const { data: insertedStudent, error: studentError } = await supabase
      .from("students")
      .insert([
        {
          ...form,
          photo_url: form.photo_url || null,
          year_level: Number(form.year_level),
          precinct_code: form.precinct_code || null,
          batch_code: form.batch_code || null,
        },
      ])
      .select()
      .single();

    if (studentError) {
      console.error("Board student insert failed:", studentError);
      alert(studentError.message);
      return;
    }

    const { error: orgError } = await syncStudentOrganizationMemberships({
      studentId: insertedStudent.id,
      program: insertedStudent.program,
      explicitOrganizationIds: [orgId],
    });

    if (orgError) {
      console.error("Board student organization link failed:", orgError);
      alert(orgError.message);
      return;
    }

    alert("Student added successfully.");
    setFormOpen(false);
    fetchStudents();
  }

  async function handlePhotoUpload(file) {
    if (!file) return;

    const dataUrl = await readFileAsDataUrl(file);
    setForm({ ...form, photo_url: dataUrl });
  }

  const filteredStudents = students.filter((student) => {
    const fullName = `${student.first_name} ${student.last_name}`.toLowerCase();

    return (
      fullName.includes(search.toLowerCase()) ||
      student.student_number?.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Organization Members</div>
          <h1 className="page-title">Board students</h1>
          <p className="page-subtitle">
            Manage students under your assigned organization.
          </p>
        </div>

        <button
          onClick={() => setFormOpen(true)}
          className="primary-btn self-start lg:self-auto"
        >
          <Plus size={18} />
          Add Student
        </button>
      </div>

      <div className="toolbar-row">
      <div className="search-shell">
        <Search size={18} className="text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search student..."
        />
      </div>
      </div>

      <div className="table-shell mt-6">
        <table className="app-table">
          <thead>
            <tr>
              <th>Student ID</th>
              <th>Name</th>
              <th>Program</th>
              <th>Year</th>
              <th>Status</th>
              <th>Date Added</th>
            </tr>
          </thead>

          <tbody>
            {filteredStudents.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-10 text-center empty-copy">
                  No students found.
                </td>
              </tr>
            ) : (
              filteredStudents.map((student) => (
                <tr key={student.id}>
                  <td className="font-bold">
                    {student.student_number}
                  </td>
                  <td>
                    <div className="flex items-center gap-3">
                      {student.photo_url ? (
                        <img
                          src={student.photo_url}
                          alt={`${student.first_name} ${student.last_name}`}
                          className="h-10 w-10 rounded-2xl object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(47,143,131,0.12)] text-xs font-black text-[#2f8f83]">
                          {`${student.first_name?.[0] || ""}${student.last_name?.[0] || ""}`}
                        </div>
                      )}
                      <div>
                        {student.first_name} {student.last_name}
                        <p className="text-xs text-gray-500">{student.email}</p>
                      </div>
                    </div>
                  </td>
                  <td>{student.program}</td>
                  <td>{student.year_level}</td>
                  <td>
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700">
                      {student.status}
                    </span>
                  </td>
                  <td className="text-[#5a5548]">
                    {student.created_at
                      ? new Date(student.created_at).toLocaleDateString()
                      : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <PopupOverlay>
          <div className="popup-sheet popup-sheet-wide">
            <div className="popup-header">
              <div className="popup-header-copy">
                <p className="field-label !mb-3">Student Registry</p>
                <h2 className="surface-title text-[2rem] font-black tracking-tight">Add student</h2>
                <p className="surface-copy mt-2 text-sm leading-6">
                  Add voter details, voting group codes, and profile information in one view.
                </p>
              </div>
              <button type="button" onClick={() => setFormOpen(false)} className="popup-close">
                <Plus size={16} className="rotate-45" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="popup-content">
              <div className="popup-form-grid">
              <div className="popup-form-grid-compact">
              <div>
                <label className="field-label">Student ID</label>
                <input required placeholder="Student ID" value={form.student_number} onChange={(e) => setForm({ ...form, student_number: e.target.value })} className="field-shell w-full" />
              </div>
              <div>
                <label className="field-label">Email</label>
                <input required placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="field-shell w-full" />
              </div>
              <div>
                <label className="field-label">First Name</label>
                <input required placeholder="First Name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className="field-shell w-full" />
              </div>
              <div>
                <label className="field-label">Last Name</label>
                <input required placeholder="Last Name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className="field-shell w-full" />
              </div>
              <div>
                <label className="field-label">Program</label>
                <input required placeholder="Program" value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} className="field-shell w-full" />
              </div>
              <div>
                <label className="field-label">Precinct Code</label>
                <input placeholder="Precinct Code optional" value={form.precinct_code} onChange={(e) => setForm({ ...form, precinct_code: e.target.value })} className="field-shell w-full" />
              </div>
              <div>
                <label className="field-label">Batch Code</label>
                <input placeholder="Batch Code optional" value={form.batch_code} onChange={(e) => setForm({ ...form, batch_code: e.target.value })} className="field-shell w-full" />
              </div>
              <div>
                <label className="field-label">Year Level</label>
                <input required type="number" placeholder="Year Level" value={form.year_level} onChange={(e) => setForm({ ...form, year_level: e.target.value })} className="field-shell w-full" />
              </div>
              </div>

              <div className="space-y-4">
              <div className="popup-side-panel">
                <label className="field-label">Photo URL</label>
                <input placeholder="Photo URL optional" value={form.photo_url} onChange={(e) => setForm({ ...form, photo_url: e.target.value })} className="field-shell w-full" />
              </div>
              <div className="popup-side-panel">
                <p className="mb-3 text-sm font-bold text-[#1d262f]">Student Photo</p>
                <div className="flex items-center gap-4">
                  {form.photo_url ? (
                    <img src={form.photo_url} alt="Student preview" className="h-16 w-16 rounded-2xl object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(47,143,131,0.12)] text-xs font-black text-[#2f8f83]">
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
                  Save Student
                </button>
              </div>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default BoardStudents;
