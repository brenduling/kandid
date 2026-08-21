import { useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Users,
  Building2,
} from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { supabase } from "../../lib/supabaseClient";
import { readFileAsDataUrl } from "../../utils/files";
import { usePrompt } from "../../context/PromptContext";

function Organizations() {
  const prompt = usePrompt();

  const [organizations, setOrganizations] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState(null);

  const [selectedOrg, setSelectedOrg] = useState(null);
  const [organizationStudents, setOrganizationStudents] = useState([]);
  const [organizationCounts, setOrganizationCounts] = useState({});
  const [studentsLoading, setStudentsLoading] = useState(false);

  const [form, setForm] = useState({
    name: "",
    description: "",
    logo_url: "",
    organization_type: "departmental",
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchOrganizations();
  }, []);

  async function fetchOrganizations() {
    const { data, error } = await supabase
      .from("organizations")
      .select("*")
      .order("id", { ascending: true });

    if (error) {
      console.error("Failed to load organizations:", error);

      prompt.error(
        error.message || "Failed to load organizations."
      );

      return;
    }

    const organizationData = data || [];

    setOrganizations(organizationData);

    // Load the number of students for every organization.
    await fetchOrganizationCounts(organizationData);
  }

  async function fetchOrganizationCounts(orgs = organizations) {
    if (!orgs || orgs.length === 0) {
      setOrganizationCounts({});
      return;
    }

    const { data, error } = await supabase
      .from("student_organizations")
      .select("student_id, organization_id");

    if (error) {
      console.error(
        "Failed to load organization student counts:",
        error
      );

      prompt.error(
        error.message ||
        "Failed to load organization student counts."
      );

      return;
    }

    const counts = {};

    orgs.forEach((org) => {
      counts[org.id] = 0;
    });

    // Prevent duplicate student memberships from inflating the count.
    const uniqueMemberships = new Set();

    (data || []).forEach((membership) => {
      if (
        membership.organization_id == null ||
        membership.student_id == null
      ) {
        return;
      }

      const key = `${membership.organization_id}-${membership.student_id}`;

      if (uniqueMemberships.has(key)) {
        return;
      }

      uniqueMemberships.add(key);

      if (
        Object.prototype.hasOwnProperty.call(
          counts,
          membership.organization_id
        )
      ) {
        counts[membership.organization_id] += 1;
      }
    });

    setOrganizationCounts(counts);
  }

  async function openOrganizationDetails(org) {
    setSelectedOrg(org);
    setOrganizationStudents([]);
    setStudentsLoading(true);

    // Organization membership is stored in the
    // student_organizations junction table.
    const { data, error } = await supabase
      .from("student_organizations")
      .select(`
        student_id,
        organization_id,
        role,
        students (
          id,
          student_number,
          first_name,
          last_name,
          email,
          program,
          year_level,
          photo_url,
          status
        )
      `)
      .eq("organization_id", org.id);

    if (error) {
      console.error(
        "Failed to load organization students:",
        error
      );

      prompt.error(
        error.message ||
        "Failed to load students for this organization."
      );

      setStudentsLoading(false);
      return;
    }

    // Convert the junction-table result into a simple student list.
    // Also remove duplicate student records if duplicate links exist.
    const seenStudents = new Set();

    const students = (data || [])
      .map((item) => {
        if (!item.students) {
          return null;
        }

        if (seenStudents.has(item.student_id)) {
          return null;
        }

        seenStudents.add(item.student_id);

        return {
          ...item.students,
          organization_role: item.role,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const lastNameA = a.last_name || "";
        const lastNameB = b.last_name || "";

        return lastNameA.localeCompare(lastNameB);
      });

    setOrganizationStudents(students);

    // Keep the card count synchronized with the actual list.
    setOrganizationCounts((previous) => ({
      ...previous,
      [org.id]: students.length,
    }));

    setStudentsLoading(false);
  }

  function closeOrganizationDetails() {
    setSelectedOrg(null);
    setOrganizationStudents([]);
  }

  function openCreateForm() {
    setEditingOrg(null);

    setForm({
      name: "",
      description: "",
      logo_url: "",
      organization_type: "departmental",
    });

    setFormOpen(true);
  }

  function openEditForm(org) {
    setEditingOrg(org);

    setForm({
      name: org.name || "",
      description: org.description || "",
      logo_url: org.logo_url || "",
      organization_type:
        org.organization_type || "departmental",
    });

    setFormOpen(true);
  }

  async function handleLogoUpload(file) {
    if (!file) return;

    const dataUrl = await readFileAsDataUrl(file);

    setForm({
      ...form,
      logo_url: dataUrl,
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!form.name.trim()) {
      prompt.error("Organization name is required.");
      return;
    }

    if (
      !["departmental", "non_departmental"].includes(
        form.organization_type
      )
    ) {
      prompt.error("Please select an organization type.");
      return;
    }

    setLoading(true);

    let result;

    if (editingOrg) {
      result = await supabase
        .from("organizations")
        .update({
          name: form.name.trim(),
          description: form.description.trim(),
          logo_url: form.logo_url || null,
          organization_type: form.organization_type,
        })
        .eq("id", editingOrg.id);
    } else {
      result = await supabase
        .from("organizations")
        .insert([
          {
            name: form.name.trim(),
            description: form.description.trim(),
            logo_url: form.logo_url || null,
            organization_type: form.organization_type,
          },
        ]);
    }

    const error = result?.error;

    if (error) {
      console.error(
        "Organization save failed:",
        error
      );

      prompt.error(
        error.message || "Failed to save organization."
      );

      setLoading(false);
      return;
    }

    prompt.success(
      editingOrg
        ? "Organization updated."
        : "Organization created."
    );

    setLoading(false);
    setFormOpen(false);

    await fetchOrganizations();
  }

  async function handleDelete(id) {
    const confirmDelete = await prompt.confirm({
      title: "Delete Organization?",
      message:
        "Are you sure you want to delete this organization? Associated elections, partylists, and students may be affected.",
      type: "danger",
      confirmText: "Delete Organization",
    });

    if (!confirmDelete) return;

    const { error } = await supabase
      .from("organizations")
      .delete()
      .eq("id", id);

    if (error) {
      prompt.error(
        error.message || "Failed to delete organization."
      );

      return;
    }

    prompt.success("Organization deleted.");

    if (selectedOrg?.id === id) {
      closeOrganizationDetails();
    }

    await fetchOrganizations();
  }

  function getOrganizationTypeLabel(org) {
    return org?.organization_type === "non_departmental"
      ? "Non-Departmental"
      : "Departmental";
  }

  function getOrganizationTypeClasses(org) {
    return org?.organization_type === "non_departmental"
      ? "bg-blue-100 text-blue-700 border border-blue-200"
      : "bg-emerald-100 text-emerald-700 border border-emerald-200";
  }

  return (
    <div>
      {/* PAGE HEADER */}
      <div className="page-head">
        <div>
          <div className="page-kicker">
            Organization Directory
          </div>

          <h1 className="page-title">
            Organizations
          </h1>

          <p className="page-subtitle">
            Add, update, and manage student organizations.
          </p>
        </div>

        <button
          onClick={openCreateForm}
          className="primary-btn self-start lg:self-auto"
          type="button"
        >
          <Plus size={18} />
          Add
        </button>
      </div>

      {/* ORGANIZATION CARDS */}
      {organizations.length === 0 ? (
        <div className="empty-state mt-8">
          No organizations found.
        </div>
      ) : (
        <div className="section-grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {organizations.map((org) => {
            const studentCount =
              organizationCounts[org.id] ?? 0;

            return (
              <div
                key={org.id}
                onClick={() =>
                  openOrganizationDetails(org)
                }
                className="metric-card lift-card min-h-[220px] cursor-pointer transition-transform hover:-translate-y-1"
              >
                {/* ORGANIZATION HEADER */}
                <div className="flex items-start gap-4">
                  {org.logo_url ? (
                    <img
                      src={org.logo_url}
                      alt={`${org.name} logo`}
                      className="h-14 w-14 rounded-2xl object-cover ring-1 ring-[rgba(37,99,235,0.08)]"
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(248,115,22,0.14)] text-sm font-black text-[#f97316]">
                      {(org.name || "O")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <h2 className="surface-title truncate text-[1.7rem] font-black tracking-tight">
                      {org.name}
                    </h2>

                    <div className="mt-2">
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${getOrganizationTypeClasses(org)}`}
                      >
                        {getOrganizationTypeLabel(org)}
                      </span>
                    </div>

                    <p className="surface-copy mt-2 line-clamp-2 text-sm leading-6">
                      {org.description ||
                        "No organization description yet."}
                    </p>
                  </div>
                </div>

                {/* STUDENT COUNT */}
                <div className="mt-6 flex items-center gap-3 rounded-2xl bg-white/60 px-4 py-3">
                  <div className="rounded-xl bg-[rgba(37,99,235,0.10)] p-2.5 text-[#2563eb]">
                    <Users size={18} />
                  </div>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500">
                      Total Students
                    </p>

                    <p className="mt-0.5 text-xl font-black text-[#1d262f]">
                      {studentCount}
                    </p>
                  </div>
                </div>

                {/* CARD FOOTER */}
                <div className="mt-6 flex items-center justify-between gap-3">
                  <div className="surface-muted text-xs uppercase tracking-[0.16em]">
                    Added{" "}
                    {org.created_at
                      ? new Date(
                        org.created_at
                      ).toLocaleDateString()
                      : "-"}
                  </div>

                  <div
                    className="flex items-center gap-2"
                    onClick={(e) =>
                      e.stopPropagation()
                    }
                  >
                    <button
                      onClick={() =>
                        openEditForm(org)
                      }
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/70 text-[#1d1d1d] shadow-sm hover:bg-white"
                      type="button"
                      title="Edit organization"
                    >
                      <Pencil size={18} />
                    </button>

                    <button
                      onClick={() =>
                        handleDelete(org.id)
                      }
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/70 text-[#1d1d1d] shadow-sm hover:bg-white"
                      type="button"
                      title="Delete organization"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[#6b7280]">
                  <Users size={14} />
                  Click to view students
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ORGANIZATION DETAILS */}
      {selectedOrg && (
        <PopupOverlay>
          <div className="popup-sheet popup-sheet-wide max-h-[90vh] overflow-hidden">
            {/* HEADER */}
            <div className="popup-header">
              <div className="popup-header-copy">
                <p className="field-label !mb-3">
                  Organization Details
                </p>

                <div className="flex items-center gap-4">
                  {selectedOrg.logo_url ? (
                    <img
                      src={selectedOrg.logo_url}
                      alt={`${selectedOrg.name} logo`}
                      className="h-16 w-16 rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(255,90,31,0.12)] text-sm font-black text-[#ff5a1f]">
                      {(selectedOrg.name || "O")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                  )}

                  <div>
                    <h2 className="surface-title text-[2rem] font-black tracking-tight">
                      {selectedOrg.name}
                    </h2>

                    <div className="mt-2">
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${getOrganizationTypeClasses(selectedOrg)}`}
                      >
                        {getOrganizationTypeLabel(selectedOrg)}
                      </span>
                    </div>

                    <p className="surface-copy mt-2 text-sm">
                      {selectedOrg.description ||
                        "No organization description yet."}
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={
                  closeOrganizationDetails
                }
                className="popup-close"
                type="button"
              >
                <X size={20} />
              </button>
            </div>

            {/* CONTENT */}
            <div className="popup-content overflow-y-auto">
              {/* SUMMARY */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {/* ORGANIZATION */}
                <div className="metric-card">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-[rgba(255,90,31,0.12)] p-3 text-[#ff5a1f]">
                      <Building2 size={20} />
                    </div>

                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-gray-500">
                        Organization
                      </p>

                      <p className="mt-1 text-lg font-black">
                        {selectedOrg.name}
                      </p>
                    </div>
                  </div>
                </div>

                {/* ORGANIZATION TYPE */}
                <div className="metric-card">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-gray-500">
                      Organization Type
                    </p>

                    <span
                      className={`mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-black ${getOrganizationTypeClasses(selectedOrg)}`}
                    >
                      {getOrganizationTypeLabel(selectedOrg)}
                    </span>
                  </div>
                </div>

                {/* TOTAL STUDENTS */}
                <div className="metric-card">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-[rgba(37,99,235,0.10)] p-3 text-blue-600">
                      <Users size={20} />
                    </div>

                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-gray-500">
                        Total Students
                      </p>

                      <p className="mt-1 text-2xl font-black">
                        {studentsLoading
                          ? "..."
                          : organizationStudents.length}
                      </p>
                    </div>
                  </div>
                </div>

                {/* DATE */}
                <div className="metric-card">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-gray-500">
                      Date Added
                    </p>

                    <p className="mt-2 text-lg font-black">
                      {selectedOrg.created_at
                        ? new Date(
                          selectedOrg.created_at
                        ).toLocaleDateString()
                        : "-"}
                    </p>
                  </div>
                </div>
              </div>

              {/* STUDENTS */}
              <div className="mt-8">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-xl font-black">
                      Students
                    </h3>

                    <p className="mt-1 text-sm text-gray-500">
                      All students connected to{" "}
                      {selectedOrg.name}.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-sm font-black">
                    <Users size={15} />

                    {studentsLoading
                      ? "Loading..."
                      : `${organizationStudents.length} student${organizationStudents.length !==
                        1
                        ? "s"
                        : ""
                      }`}
                  </div>
                </div>

                {studentsLoading ? (
                  <div className="empty-state">
                    Loading students...
                  </div>
                ) : organizationStudents.length ===
                  0 ? (
                  <div className="empty-state">
                    No students are currently connected
                    to this organization.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px]">
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
                              Status
                            </th>
                          </tr>
                        </thead>

                        <tbody>
                          {organizationStudents.map(
                            (student) => (
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
                                        className="h-10 w-10 rounded-xl object-cover"
                                      />
                                    ) : (
                                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(37,99,235,0.08)] text-xs font-black text-[#2563eb]">
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

                                {/* STUDENT ID */}
                                <td className="px-5 py-4 text-sm font-semibold text-gray-600">
                                  {student.student_number ||
                                    student.id ||
                                    "-"}
                                </td>

                                {/* PROGRAM */}
                                <td className="px-5 py-4">
                                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
                                    {student.program ||
                                      "-"}
                                  </span>
                                </td>

                                {/* YEAR */}
                                <td className="px-5 py-4 text-sm text-gray-600">
                                  {student.year_level ||
                                    "-"}
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
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* ACTIONS */}
              <div className="popup-actions">
                <button
                  type="button"
                  onClick={
                    closeOrganizationDetails
                  }
                  className="secondary-btn"
                >
                  Close
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const orgToEdit = selectedOrg;

                    closeOrganizationDetails();
                    openEditForm(orgToEdit);
                  }}
                  className="primary-btn"
                >
                  <Pencil size={16} />
                  Edit Organization
                </button>
              </div>
            </div>
          </div>
        </PopupOverlay>
      )}

      {/* CREATE / EDIT ORGANIZATION */}
      {formOpen && (
        <PopupOverlay>
          <div className="popup-sheet popup-sheet-wide">
            <div className="popup-header">
              <div className="popup-header-copy">
                <p className="field-label !mb-3">
                  Organization Directory
                </p>

                <h2 className="surface-title text-[2rem] font-black tracking-tight">
                  {editingOrg
                    ? "Edit organization"
                    : "Add organization"}
                </h2>

                <p className="surface-copy mt-2 text-sm leading-6">
                  Keep the name, summary, and logo in one
                  clean record.
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

            <form
              onSubmit={handleSubmit}
              className="popup-content"
            >
              <div className="popup-form-grid">
                <div className="space-y-4">
                  <div>
                    <label className="field-label">
                      Organization Name
                    </label>

                    <input
                      value={form.name}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          name: e.target.value,
                        })
                      }
                      required
                      className="field-shell w-full"
                      placeholder="Enter organization name"
                    />
                  </div>

                  <div>
                    <label className="field-label">
                      Organization Type
                    </label>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label
                        className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition ${form.organization_type === "departmental"
                            ? "border-emerald-300 bg-emerald-50"
                            : "border-gray-200 bg-white hover:bg-gray-50"
                          }`}
                      >
                        <input
                          type="radio"
                          name="organization_type"
                          value="departmental"
                          checked={
                            form.organization_type === "departmental"
                          }
                          onChange={(e) =>
                            setForm({
                              ...form,
                              organization_type: e.target.value,
                            })
                          }
                          className="h-4 w-4"
                        />

                        <span>
                          <span className="block text-sm font-black text-gray-800">
                            Departmental
                          </span>
                          <span className="block text-xs text-gray-500">
                            Organization tied to a department/program.
                          </span>
                        </span>
                      </label>

                      <label
                        className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition ${form.organization_type === "non_departmental"
                            ? "border-blue-300 bg-blue-50"
                            : "border-gray-200 bg-white hover:bg-gray-50"
                          }`}
                      >
                        <input
                          type="radio"
                          name="organization_type"
                          value="non_departmental"
                          checked={
                            form.organization_type ===
                            "non_departmental"
                          }
                          onChange={(e) =>
                            setForm({
                              ...form,
                              organization_type: e.target.value,
                            })
                          }
                          className="h-4 w-4"
                        />

                        <span>
                          <span className="block text-sm font-black text-gray-800">
                            Non-Departmental
                          </span>
                          <span className="block text-xs text-gray-500">
                            Organization open across departments.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="field-label">
                      Description
                    </label>

                    <textarea
                      value={form.description}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          description: e.target.value,
                        })
                      }
                      className="field-shell min-h-[180px] w-full resize-none"
                      placeholder="Short description"
                      rows="6"
                    />
                  </div>
                </div>

                <div className="popup-side-panel">
                  <label className="field-label">
                    Organization Logo
                  </label>

                  <div className="flex items-center gap-4">
                    {form.logo_url ? (
                      <img
                        src={form.logo_url}
                        alt="Organization logo preview"
                        className="h-16 w-16 rounded-2xl object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(255,90,31,0.12)] text-xs font-black text-[#ff5a1f]">
                        LOGO
                      </div>
                    )}

                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) =>
                        handleLogoUpload(
                          e.target.files?.[0]
                        )
                      }
                      className="text-sm text-[#5a5548]"
                    />
                  </div>

                  <input
                    value={form.logo_url}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        logo_url: e.target.value,
                      })
                    }
                    className="field-shell mt-4 w-full"
                    placeholder="Paste logo image URL"
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

                <button
                  disabled={loading}
                  className="primary-btn min-w-52 disabled:opacity-60"
                  type="submit"
                >
                  {loading
                    ? "Saving..."
                    : editingOrg
                      ? "Save Changes"
                      : "Create Organization"}
                </button>
              </div>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default Organizations;
