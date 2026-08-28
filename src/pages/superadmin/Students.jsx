import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, X, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import PopupOverlay from "../../components/PopupOverlay";
import { supabase } from "../../lib/supabaseClient";
import { readFileAsDataUrl } from "../../utils/files";
import { syncStudentOrganizationMemberships } from "../../utils/organizationAccess";
import { usePrompt } from "../../context/PromptContext";

function Students() {
  const prompt = usePrompt();
  const [searchParams] = useSearchParams();

  const [students, setStudents] = useState([]);
  const [organizations, setOrganizations] = useState([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);

  const [search, setSearch] = useState("");
  const [programFilter, setProgramFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [form, setForm] = useState({
    student_number: "",
    first_name: "",
    last_name: "",
    email: "",
    photo_url: "",
    program: "",
    year_level: 1,
    organization_id: "",
    precinct_code: "",
    batch_code: "",
    is_shs: false,
    status: "pending",
  });

  useEffect(() => {
    fetchStudents();
    fetchOrganizations();
  }, []);

  useEffect(() => {
    setSearch(searchParams.get("q") || "");
  }, [searchParams]);

  async function fetchStudents() {
    const { data, error } = await supabase
      .from("students")
      .select(`
        id,
        student_number,
        first_name,
        last_name,
        email,
        photo_url,
        program,
        year_level,
        precinct_code,
        batch_code,
        is_shs,
        status,
        created_at,
        student_organizations (
          organization_id,
          role,
          organizations (
            id,
            name,
            organization_type
          )
        )
      `)
      .order("last_name", { ascending: true });

    if (error) {
      console.error("Failed to load students:", error);

      prompt.error(
        error.message || "Failed to load students."
      );

      return;
    }

    setStudents(data || []);
  }

  async function fetchOrganizations() {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, organization_type")
      .order("name", { ascending: true });

    if (error) {
      console.error(
        "Failed to load organizations:",
        error
      );

      prompt.error(
        error.message ||
        "Failed to load organizations."
      );

      return;
    }

    setOrganizations(data || []);
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
      year_level: 1,
      organization_id: "",
      precinct_code: "",
      batch_code: "",
      is_shs: false,
      status: "pending",
    });

    setFormOpen(true);
  }

  function openEditForm(student) {
    setEditingStudent(student);

    const existingOrganizations =
      student.student_organizations || [];

    const specificOrganization =
      existingOrganizations.find(
        (item) =>
          item.organizations?.organization_type !==
          "non_departmental"
      );

    setForm({
      student_number:
        student.student_number || "",
      first_name:
        student.first_name || "",
      last_name:
        student.last_name || "",
      email:
        student.email || "",
      photo_url:
        student.photo_url || "",
      program:
        student.program || "",
      year_level:
        student.year_level || 1,
      organization_id:
        specificOrganization?.organization_id || "",
      precinct_code:
        student.precinct_code || "",
      batch_code:
        student.batch_code || "",
      is_shs:
        student.is_shs || false,
      status:
        student.status || "pending",
    });

    setFormOpen(true);
  }

  async function handlePhotoUpload(file) {
    if (!file) return;

    const dataUrl = await readFileAsDataUrl(file);

    setForm((previous) => ({
      ...previous,
      photo_url: dataUrl,
    }));
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
    let savedStudentId =
      editingStudent?.id || null;

    // ============================================================
    // SAVE STUDENT
    // ============================================================

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
      console.error(
        "Student save failed:",
        error
      );

      prompt.error(
        error.message || "Failed to save student."
      );

      return;
    }

    if (!editingStudent) {
      savedStudentId =
        result?.data?.id || null;
    }

    if (!savedStudentId) {
      prompt.error(
        "Student was saved, but the student ID could not be determined."
      );

      return;
    }

    const { error: syncError } =
      await syncStudentOrganizationMemberships({
        studentId: savedStudentId,
        program: form.program,
        explicitOrganizationIds: form.organization_id
          ? [form.organization_id]
          : [],
      });

    if (syncError) {
      console.error(
        "Student organization sync failed:",
        syncError
      );

      prompt.error(
        syncError.message ||
        "Failed to link student to organizations."
      );

      return;
    }

    prompt.success(
      editingStudent
        ? "Student record updated."
        : "Student record created."
    );

    setFormOpen(false);

    fetchStudents();
    return;

  }

  async function handleDelete(id) {
    const confirmDelete =
      await prompt.confirm({
        title: "Delete Student?",
        message:
          "Are you sure you want to delete this student? This will also remove their organization memberships.",
        type: "danger",
        confirmText: "Delete Student",
      });

    if (!confirmDelete) return;

    // Remove organization memberships first
    const {
      error: orgError,
    } = await supabase
      .from("student_organizations")
      .delete()
      .eq("student_id", id);

    if (orgError) {
      prompt.error(
        orgError.message ||
        "Failed to remove student organization memberships."
      );

      return;
    }

    // Delete student
    const { error } = await supabase
      .from("students")
      .delete()
      .eq("id", id);

    if (error) {
      prompt.error(
        error.message ||
        "Failed to delete student."
      );

      return;
    }

    prompt.success("Student deleted.");

    fetchStudents();
  }

  const programs = useMemo(() => {
    return [
      ...new Set(
        students
          .map((student) => student.program)
          .filter(Boolean)
      ),
    ].sort();
  }, [students]);

  const filteredStudents = useMemo(() => {
    const query =
      search.trim().toLowerCase();

    return students.filter((student) => {
      const fullName = [
        student.first_name,
        student.last_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !query ||
        fullName.includes(query) ||
        student.student_number
          ?.toLowerCase()
          .includes(query) ||
        student.email
          ?.toLowerCase()
          .includes(query);

      const matchesProgram =
        programFilter === "all" ||
        student.program === programFilter;

      const matchesStatus =
        statusFilter === "all" ||
        student.status === statusFilter;

      return (
        matchesSearch &&
        matchesProgram &&
        matchesStatus
      );
    });
  }, [
    students,
    search,
    programFilter,
    statusFilter,
  ]);

  function getStudentOrganizations(student) {
    return (
      student.student_organizations || []
    )
      .map(
        (item) => item.organizations
      )
      .filter(Boolean);
  }

  return (
    <div>
      {/* ========================================================
          PAGE HEADER
      ======================================================== */}

      <div className="page-head">
        <div>
          <div className="page-kicker">
            Student Directory
          </div>

          <h1 className="page-title">
            Students
          </h1>

          <p className="page-subtitle">
            Manage verified students,
            programs, organizations, and
            eligibility information.
          </p>
        </div>

        <button
          onClick={openCreateForm}
          className="primary-btn self-start lg:self-auto"
          type="button"
        >
          <Plus size={18} />
          Add Student
        </button>
      </div>

      {/* ========================================================
          SEARCH AND FILTERS
      ======================================================== */}

      <div className="mt-8 flex flex-col gap-4 lg:flex-row">
        <div className="relative flex-1">
          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
          />

          <input
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            className="field-shell w-full pl-11"
            placeholder="Search student number, name, or email..."
          />
        </div>

        <select
          value={programFilter}
          onChange={(e) =>
            setProgramFilter(e.target.value)
          }
          className="field-shell lg:w-56"
        >
          <option value="all">
            All Programs
          </option>

          {programs.map((program) => (
            <option
              key={program}
              value={program}
            >
              {program}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value)
          }
          className="field-shell lg:w-48"
        >
          <option value="all">
            All Status
          </option>

          <option value="active">
            Active
          </option>

          <option value="pending">
            Pending
          </option>

          <option value="disabled">
            Disabled
          </option>
        </select>
      </div>

      {/* ========================================================
          STUDENT TABLE
      ======================================================== */}

      {filteredStudents.length === 0 ? (
        <div className="empty-state mt-8">
          No students found.
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="px-5 py-4 text-xs font-black uppercase tracking-[0.12em] text-gray-500">
                    Student
                  </th>

                  <th className="px-5 py-4 text-xs font-black uppercase tracking-[0.12em] text-gray-500">
                    Student ID
                  </th>

                  <th className="px-5 py-4 text-xs font-black uppercase tracking-[0.12em] text-gray-500">
                    Program
                  </th>

                  <th className="px-5 py-4 text-xs font-black uppercase tracking-[0.12em] text-gray-500">
                    Year
                  </th>

                  <th className="px-5 py-4 text-xs font-black uppercase tracking-[0.12em] text-gray-500">
                    Organizations
                  </th>

                  <th className="px-5 py-4 text-xs font-black uppercase tracking-[0.12em] text-gray-500">
                    Status
                  </th>

                  <th className="px-5 py-4 text-xs font-black uppercase tracking-[0.12em] text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredStudents.map(
                  (student) => {
                    const studentOrganizations =
                      getStudentOrganizations(
                        student
                      );

                    return (
                      <tr
                        key={student.id}
                        className="border-b last:border-b-0 hover:bg-gray-50"
                      >
                        {/* STUDENT */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            {student.photo_url ? (
                              <img
                                src={
                                  student.photo_url
                                }
                                alt={`${student.first_name} ${student.last_name}`}
                                className="h-11 w-11 rounded-xl object-cover"
                              />
                            ) : (
                              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[rgba(37,99,235,0.08)] text-xs font-black text-[#2563eb]">
                                {`${student.first_name?.[0] || ""}${student.last_name?.[0] || ""}`}
                              </div>
                            )}

                            <div>
                              <p className="font-black">
                                {[
                                  student.first_name,
                                  student.last_name,
                                ]
                                  .filter(Boolean)
                                  .join(" ") ||
                                  "Unnamed Student"}
                              </p>

                              {student.email && (
                                <p className="mt-1 text-xs text-gray-500">
                                  {
                                    student.email
                                  }
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* STUDENT NUMBER */}
                        <td className="px-5 py-4 text-sm font-semibold text-gray-600">
                          {student.student_number ||
                            "-"}
                        </td>

                        {/* PROGRAM */}
                        <td className="px-5 py-4">
                          {student.program ||
                            "-"}
                        </td>

                        {/* YEAR */}
                        <td className="px-5 py-4 text-sm text-gray-600">
                          {student.year_level ||
                            "-"}
                        </td>

                        {/* ORGANIZATIONS */}
                        <td className="px-5 py-4">
                          <div className="flex max-w-[320px] flex-wrap gap-2">
                            {studentOrganizations.length >
                              0 ? (
                              studentOrganizations.map(
                                (org) => (
                                  <span
                                    key={
                                      org.id
                                    }
                                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                                      org.organization_type ===
                                      "non_departmental"
                                        ? "bg-blue-100 text-blue-700"
                                        : "bg-orange-100 text-orange-700"
                                    }`}
                                  >
                                    {
                                      org.name
                                    }
                                  </span>
                                )
                              )
                            ) : (
                              <span className="text-sm text-gray-400">
                                No organization
                              </span>
                            )}
                          </div>
                        </td>

                        {/* STATUS */}
                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold ${student.status ===
                                "active"
                                ? "bg-emerald-100 text-emerald-700"
                                : student.status ===
                                  "disabled"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                          >
                            {student.status ||
                              "pending"}
                          </span>
                        </td>

                        {/* ACTIONS */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() =>
                                openEditForm(
                                  student
                                )
                              }
                              className="icon-action"
                              type="button"
                              title="Edit student"
                            >
                              <Pencil
                                size={16}
                              />
                            </button>

                            <button
                              onClick={() =>
                                handleDelete(
                                  student.id
                                )
                              }
                              className="icon-action icon-action-danger"
                              type="button"
                              title="Delete student"
                            >
                              <Trash2
                                size={16}
                              />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================
          CREATE / EDIT FORM
      ======================================================== */}

      {formOpen && (
        <PopupOverlay>
          <div className="popup-sheet popup-sheet-wide max-h-[90vh] overflow-hidden">
            <div className="popup-header">
              <div className="popup-header-copy">
                <p className="field-label !mb-3">
                  Student Directory
                </p>

                <h2 className="surface-title text-[2rem] font-black tracking-tight">
                  {editingStudent
                    ? "Edit Student"
                    : "Add Student"}
                </h2>

                <p className="surface-copy mt-2 text-sm leading-6">
                  Student organization
                  memberships are automatically
                  managed based on the student's
                  program and selected organization.
                </p>
              </div>

              <button
                onClick={() =>
                  setFormOpen(false)
                }
                className="popup-close"
                type="button"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="popup-content overflow-y-auto"
            >
              <div className="popup-form-grid">
                <div className="space-y-4">
                  {/* STUDENT NUMBER */}
                  <div>
                    <label className="field-label">
                      Student Number
                    </label>

                    <input
                      required
                      value={
                        form.student_number
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          student_number:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                      placeholder="Student Number"
                    />
                  </div>

                  {/* FIRST NAME */}
                  <div>
                    <label className="field-label">
                      First Name
                    </label>

                    <input
                      required
                      value={
                        form.first_name
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          first_name:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                      placeholder="First Name"
                    />
                  </div>

                  {/* LAST NAME */}
                  <div>
                    <label className="field-label">
                      Last Name
                    </label>

                    <input
                      required
                      value={
                        form.last_name
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          last_name:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                      placeholder="Last Name"
                    />
                  </div>

                  {/* EMAIL */}
                  <div>
                    <label className="field-label">
                      Email
                    </label>

                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          email:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                      placeholder="Email"
                    />
                  </div>

                  {/* PROGRAM */}
                  <div>
                    <label className="field-label">
                      Program
                    </label>

                    <input
                      required
                      value={
                        form.program
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          program:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                      placeholder="e.g. BSIT"
                    />

                    <p className="mt-2 text-xs text-gray-500">
                      Departmental memberships are synced from covered programs.
                    </p>
                  </div>

                  {/* YEAR */}
                  <div>
                    <label className="field-label">
                      Year Level
                    </label>

                    <input
                      type="number"
                      min="1"
                      value={
                        form.year_level
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          year_level:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                    />
                  </div>
                </div>

                <div className="popup-side-panel">
                  {/* PHOTO */}
                  <div>
                    <label className="field-label">
                      Student Photo
                    </label>

                    <div className="flex items-center gap-4">
                      {form.photo_url ? (
                        <img
                          src={
                            form.photo_url
                          }
                          alt="Student preview"
                          className="h-16 w-16 rounded-2xl object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 text-xs font-black text-gray-400">
                          PHOTO
                        </div>
                      )}

                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          handlePhotoUpload(
                            e.target.files?.[0]
                          )
                        }
                        className="text-sm text-[#5a5548]"
                      />
                    </div>
                  </div>

                  {/* SPECIFIC ORGANIZATION */}
                  <div className="mt-6">
                    <label className="field-label">
                      Specific Organization
                    </label>

                    <select
                      value={
                        form.organization_id
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          organization_id:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                    >
                      <option value="">
                        No additional organization
                      </option>

                      {organizations.map((org) => (
                          <option
                            key={org.id}
                            value={org.id}
                          >
                            {org.name}
                          </option>
                        ))}
                    </select>

                    <div className="mt-3 rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-700">
                      Non-departmental organizations are synced for every student.
                      Departmental organizations are synced from their covered
                      programs.
                      <br />
                      <strong>
                        Specific Organization:
                      </strong>{" "}
                      Optional additional
                      membership.
                    </div>
                  </div>

                  {/* PRECINCT */}
                  <div className="mt-6">
                    <label className="field-label">
                      Precinct Code
                    </label>

                    <input
                      value={
                        form.precinct_code
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          precinct_code:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                      placeholder="Precinct Code"
                    />
                  </div>

                  {/* BATCH */}
                  <div className="mt-4">
                    <label className="field-label">
                      Batch Code
                    </label>

                    <input
                      value={
                        form.batch_code
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          batch_code:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                      placeholder="Batch Code"
                    />
                  </div>

                  {/* STATUS */}
                  <div className="mt-4">
                    <label className="field-label">
                      Status
                    </label>

                    <select
                      value={form.status}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          status:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                    >
                      <option value="pending">
                        Pending
                      </option>

                      <option value="active">
                        Active
                      </option>

                      <option value="disabled">
                        Disabled
                      </option>
                    </select>
                  </div>

                  {/* SHS */}
                  <label className="mt-5 flex items-center gap-3 text-sm font-semibold text-gray-700">
                    <input
                      type="checkbox"
                      checked={form.is_shs}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          is_shs:
                            e.target.checked,
                        })
                      }
                    />

                    Senior High School
                    Student
                  </label>
                </div>
              </div>

              {/* FORM ACTIONS */}
              <div className="popup-actions">
                <button
                  type="button"
                  onClick={() =>
                    setFormOpen(false)
                  }
                  className="secondary-btn"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="primary-btn min-w-52"
                >
                  {editingStudent
                    ? "Save Changes"
                    : "Create Student"}
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

