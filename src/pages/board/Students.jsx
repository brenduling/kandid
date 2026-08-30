import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { KandidButtonLoader, KandidInlineLoader } from "../../components/KandidLoader";
import PopupOverlay from "../../components/PopupOverlay";
import { StudentAvatar } from "../../components/KandidImage";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { readFileAsDataUrl } from "../../utils/files";
import {
  deactivateStudentOrganizationMembership,
  findOrCreateStudentByNumber,
  reactivateStudentOrganizationMembership,
  removeStudentOrganizationMembership,
  selectOrganizationMembershipsForManagement,
  syncStudentOrganizationMemberships,
} from "../../utils/organizationAccess";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeMembershipDependencies, dependencyMessage } from "../../utils/deleteGuards";

function BoardStudents() {
  const prompt = usePrompt();
  const [searchParams] = useSearchParams();
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
  const orgName = user?.organization_name || user?.organizations?.name || "your organization";

  useEffect(() => {
    const query = searchParams.get("q") || "";
    setSearch(query);
  }, [searchParams]);

  useEffect(() => {
    let active = true;

    async function loadStudents() {
      if (!orgId) {
        setLoadError("No organization is assigned to this Electoral Board account.");
        setStudents([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError("");

      const { data, error } =
        await selectOrganizationMembershipsForManagement(orgId);

      if (!active) return;

      if (error) {
        console.error("Failed to load board students:", error);
        setLoadError(error.message || "Unable to load students.");
        setStudents([]);
        setLoading(false);
        return;
      }

      const list = data
        .map((item) =>
          item.students
            ? {
                ...item.students,
                membership_status: item.membership_status || "active",
                deactivation_reason: item.deactivation_reason || "",
              }
            : null,
        )
        .filter(Boolean);
      setStudents(list);
      setLoading(false);
    }

    loadStudents();

    return () => {
      active = false;
    };
  }, [orgId]);

  async function fetchStudents() {
    if (!orgId) {
      setLoadError("No organization is assigned to this Electoral Board account.");
      setStudents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError("");

    const { data, error } =
      await selectOrganizationMembershipsForManagement(orgId);

    if (error) {
      console.error("Failed to refresh board students:", error);
      setLoadError(error.message || "Unable to load students.");
      setStudents([]);
      setLoading(false);
      return;
    }

    const list = data
      .map((item) =>
        item.students
          ? {
              ...item.students,
              membership_status: item.membership_status || "active",
              deactivation_reason: item.deactivation_reason || "",
            }
          : null,
      )
      .filter(Boolean);
    setStudents(list);
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (submitting) return;

    if (!orgId) {
      prompt.error("No organization is assigned to this Electoral Board account.");
      return;
    }

    setSubmitting(true);

    const {
      data: insertedStudent,
      created: createdStudent,
      error: studentError,
    } = await findOrCreateStudentByNumber({
      ...form,
      photo_url: form.photo_url || null,
      year_level: Number(form.year_level),
      precinct_code: form.precinct_code || null,
      batch_code: form.batch_code || null,
    });

    if (studentError) {
      console.error("Board student insert failed:", studentError);
      prompt.error(studentError.message || "Failed to add student.");
      setSubmitting(false);
      return;
    }

    const {
      error: orgError,
      createdOrganizationIds = [],
      existingOrganizationIds = [],
    } = await syncStudentOrganizationMemberships({
      studentId: insertedStudent.id,
      program: insertedStudent.program,
      explicitOrganizationIds: [orgId],
    });

    if (orgError) {
      console.error("Board student organization link failed:", orgError);
      prompt.error(orgError.message || "Failed to link student to this organization.");
      setSubmitting(false);
      return;
    }

    if (
      existingOrganizationIds.includes(Number(orgId)) &&
      !createdOrganizationIds.includes(Number(orgId))
    ) {
      prompt.info("This central student record is already linked to your organization.", "Already a Member");
    } else {
      prompt.success(
        createdStudent
          ? "Student registered and linked to your organization."
          : "Existing student linked to your organization."
      );
    }
    setFormOpen(false);
    setSubmitting(false);
    await fetchStudents();
  }

  async function handlePhotoUpload(file) {
    if (!file) return;

    const dataUrl = await readFileAsDataUrl(file);
    setForm({ ...form, photo_url: dataUrl });
  }

  function studentDisplayName(student) {
    return (
      [student.first_name, student.last_name].filter(Boolean).join(" ") ||
      student.student_number ||
      "this student"
    );
  }

  async function handleDeactivateMembership(student) {
    if (!orgId || !student?.id) return;

    const label = studentDisplayName(student);
    const confirmed = await prompt.confirm({
      title: `Deactivate ${orgName} Access?`,
      message:
        `${label} will stay in the central student registry, but their membership in ${orgName} will be marked inactive.`,
      confirmText: "Deactivate Access",
      cancelText: "Cancel",
      type: "warning",
    });

    if (!confirmed) return;

    const { error } = await deactivateStudentOrganizationMembership({
      studentId: student.id,
      organizationId: orgId,
      reason: "Deactivated by electoral board",
    });

    if (error) {
      console.error("Failed to deactivate board membership:", error);
      prompt.error(error.message || "Failed to deactivate student access.");
      return;
    }

    await logAuditEvent({
      action: "membership_deactivated",
      entityType: "student_organization",
      entityId: `${student.id}:${orgId}`,
      entityLabel: label,
      organizationId: orgId,
      organizationName: orgName,
      metadata: {
        student_id: student.id,
        student_number: student.student_number,
      },
    });

    prompt.success(`${orgName} access deactivated for ${label}.`);
    await fetchStudents();
  }

  async function handleReactivateMembership(student) {
    if (!orgId || !student?.id) return;

    const label = studentDisplayName(student);
    const confirmed = await prompt.confirm({
      title: `Reactivate ${orgName} Access?`,
      message: `${label} will regain active membership access for ${orgName}.`,
      confirmText: "Reactivate Access",
      cancelText: "Cancel",
      type: "info",
    });

    if (!confirmed) return;

    const { error } = await reactivateStudentOrganizationMembership({
      studentId: student.id,
      organizationId: orgId,
    });

    if (error) {
      console.error("Failed to reactivate board membership:", error);
      prompt.error(error.message || "Failed to reactivate student access.");
      return;
    }

    await logAuditEvent({
      action: "membership_reactivated",
      entityType: "student_organization",
      entityId: `${student.id}:${orgId}`,
      entityLabel: label,
      organizationId: orgId,
      organizationName: orgName,
      metadata: {
        student_id: student.id,
        student_number: student.student_number,
      },
    });

    prompt.success(`${orgName} access reactivated for ${label}.`);
    await fetchStudents();
  }

  async function handleRemoveMembership(student) {
    if (!orgId || !student?.id) return;

    const label = studentDisplayName(student);
    const analysis = await analyzeMembershipDependencies({
      studentId: student.id,
      organizationId: orgId,
    });

    if (analysis.error) {
      console.error("Failed to analyze board membership dependencies:", analysis.error);
      prompt.error(analysis.error.message || "Unable to verify membership dependencies.");
      return;
    }

    if (analysis.blocked) {
      prompt.alert({
        title: `Do Not Remove from ${orgName}`,
        message: dependencyMessage(analysis),
        type: "warning",
      });
      return;
    }

    const confirmed = await prompt.confirm({
      title: `Remove from ${orgName}?`,
      message:
        `${label} will be removed only from ${orgName}. The central student record will remain available for other organizations.`,
      confirmText: `Remove from ${orgName}`,
      cancelText: "Cancel",
      type: "danger",
    });

    if (!confirmed) return;

    const { error } = await removeStudentOrganizationMembership({
      studentId: student.id,
      organizationId: orgId,
    });

    if (error) {
      console.error("Failed to remove board membership:", error);
      prompt.error(error.message || "Failed to remove student from organization.");
      return;
    }

    await logAuditEvent({
      action: "membership_removed",
      entityType: "student_organization",
      entityId: `${student.id}:${orgId}`,
      entityLabel: label,
      organizationId: orgId,
      organizationName: orgName,
      metadata: {
        student_id: student.id,
        student_number: student.student_number,
      },
    });

    prompt.success(`${label} removed from ${orgName}.`);
    await fetchStudents();
  }

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = students.filter((student) => {
      const fullName = `${student.first_name} ${student.last_name}`.toLowerCase();

      return (
        !query ||
        fullName.includes(query) ||
        student.student_number?.toLowerCase().includes(query) ||
        student.email?.toLowerCase().includes(query) ||
        student.program?.toLowerCase().includes(query)
      );
    });

    return [...filtered].sort((a, b) => {
      const nameA = `${a.last_name || ""} ${a.first_name || ""}`.trim();
      const nameB = `${b.last_name || ""} ${b.first_name || ""}`.trim();
      const idA = Number.parseInt(a.student_number, 10);
      const idB = Number.parseInt(b.student_number, 10);

      if (sortBy === "name_desc") return nameB.localeCompare(nameA) || Number(a.id) - Number(b.id);
      if (sortBy === "newest") return new Date(b.created_at || 0) - new Date(a.created_at || 0) || Number(a.id) - Number(b.id);
      if (sortBy === "oldest") return new Date(a.created_at || 0) - new Date(b.created_at || 0) || Number(a.id) - Number(b.id);
      if (sortBy === "id_desc") {
        if (!Number.isNaN(idA) && !Number.isNaN(idB)) return idB - idA || Number(a.id) - Number(b.id);
        return String(b.student_number || "").localeCompare(String(a.student_number || "")) || Number(a.id) - Number(b.id);
      }
      if (sortBy === "id_asc") {
        if (!Number.isNaN(idA) && !Number.isNaN(idB)) return idA - idB || Number(a.id) - Number(b.id);
        return String(a.student_number || "").localeCompare(String(b.student_number || "")) || Number(a.id) - Number(b.id);
      }
      return nameA.localeCompare(nameB) || Number(a.id) - Number(b.id);
    });
  }, [search, sortBy, students]);

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
      <select
        value={sortBy}
        onChange={(event) => setSortBy(event.target.value)}
        className="field-shell lg:w-56"
      >
        <option value="name_asc">Name: A-Z</option>
        <option value="name_desc">Name: Z-A</option>
        <option value="newest">Newest Added</option>
        <option value="oldest">Oldest Added</option>
        <option value="id_asc">Student ID: Low-High</option>
        <option value="id_desc">Student ID: High-Low</option>
      </select>
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
              <th className="text-right">Membership</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan="7" className="px-6 py-10 text-center">
                  <KandidInlineLoader message="Loading students..." />
                </td>
              </tr>
            ) : loadError ? (
              <tr>
                <td colSpan="7" className="px-6 py-10 text-center">
                  <div className="mx-auto max-w-md space-y-3">
                    <p className="font-bold text-rose-600">Unable to load students.</p>
                    <p className="text-sm text-gray-500">{loadError}</p>
                    <button type="button" onClick={fetchStudents} className="secondary-btn">
                      Retry
                    </button>
                  </div>
                </td>
              </tr>
            ) : filteredStudents.length === 0 ? (
              <tr>
                <td colSpan="7" className="px-6 py-10 text-center empty-copy">
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
                      <StudentAvatar student={student} loading="lazy" className="!h-10 !w-10" />
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
                  <td>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          student.membership_status === "inactive"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {student.membership_status === "inactive" ? "Inactive" : "Active"}
                      </span>
                      <button
                        type="button"
                        className="secondary-btn min-h-[2.35rem] px-3 text-xs"
                        onClick={() =>
                          student.membership_status === "inactive"
                            ? handleReactivateMembership(student)
                            : handleDeactivateMembership(student)
                        }
                      >
                        {student.membership_status === "inactive" ? "Reactivate" : "Deactivate"}
                      </button>
                      <button
                        type="button"
                        className="danger-btn min-h-[2.35rem] px-3 text-xs"
                        onClick={() => handleRemoveMembership(student)}
                      >
                        Remove
                      </button>
                    </div>
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

                <button className="primary-btn min-w-52" disabled={submitting}>
                  {submitting ? <KandidButtonLoader label="Saving..." /> : "Save Student"}
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
