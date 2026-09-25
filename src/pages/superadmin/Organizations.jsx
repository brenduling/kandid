import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Plus,
  Pencil,
  RefreshCw,
  Trash2,
  X,
  Users,
  Building2,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import PopupOverlay from "../../components/PopupOverlay";
import { StudentAvatar } from "../../components/KandidImage";
import { supabase } from "../../lib/supabaseClient";
import { readFileAsDataUrl } from "../../utils/files";
import {
  attachProgramCoverage,
  clearOrganizationAccessCache,
  deactivateStudentOrganizationMembership,
  ensureProgram,
  getPrograms,
  reactivateStudentOrganizationMembership,
  removeStudentOrganizationMembership,
  selectActiveMemberships,
  selectOrganizationMembershipsForManagement,
  syncStudentsForOrganizationCoverage,
} from "../../utils/organizationAccess";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import {
  analyzeDeleteDependencies,
  analyzeMembershipDependencies,
  dependencyMessage,
} from "../../utils/deleteGuards";
import "./Organizations.css";

function Organizations() {
  const prompt = usePrompt();
  const [searchParams] = useSearchParams();

  const [organizations, setOrganizations] = useState([]);
  const [search] = useState(() => searchParams.get("q") || "");
  const [filter, setFilter] = useState("all");
  const [programs, setPrograms] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState(null);
  const [selectedProgramIds, setSelectedProgramIds] = useState([]);
  const [newProgram, setNewProgram] = useState("");

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
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState("");
  const [organizationCountsLoading, setOrganizationCountsLoading] = useState(true);

  async function loadPrograms() {
    const data = await getPrograms();
    setPrograms(data || []);
  }

  async function fetchOrganizations() {
    setDirectoryLoading(true);
    setDirectoryError("");

    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, description, organization_type, created_at")
      .order("id", { ascending: true });

    if (error) {
      console.error("Failed to load organizations:", error);

      prompt.error(
        error.message || "Failed to load organizations."
      );

      setDirectoryError("The organization directory could not be loaded.");
      setDirectoryLoading(false);

      return;
    }

    const organizationData = await attachProgramCoverage(data || []);

    setOrganizations(organizationData);

    fetchOrganizationCounts(organizationData);
    fetchOrganizationLogos(organizationData);
    setDirectoryLoading(false);
  }

  async function fetchOrganizationLogos(orgs = organizations) {
    const organizationIds = orgs.map((org) => org.id);

    if (organizationIds.length === 0) return;

    const { data, error } = await supabase
      .from("organizations")
      .select("id, logo_url")
      .in("id", organizationIds);

    if (error) {
      console.error("Failed to load organization logos:", error);
      return;
    }

    const logoMap = new Map(
      (data || []).map((org) => [org.id, org.logo_url])
    );

    setOrganizations((previous) =>
      previous.map((org) => ({
        ...org,
        logo_url: logoMap.get(org.id) || null,
      }))
    );
  }

  async function fetchOrganizationCounts(orgs = organizations) {
    setOrganizationCountsLoading(true);

    if (!orgs || orgs.length === 0) {
      setOrganizationCounts({});
      setOrganizationCountsLoading(false);
      return;
    }

    const { data, error } = await selectActiveMemberships(
      "student_id, organization_id",
    );

    if (error) {
      console.error(
        "Failed to load organization student counts:",
        error
      );

      prompt.error(
        error.message ||
        "Failed to load organization student counts."
      );

      setOrganizationCountsLoading(false);

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
    setOrganizationCountsLoading(false);
  }

  async function openOrganizationDetails(org) {
    setSelectedOrg(org);
    setOrganizationStudents([]);
    setStudentsLoading(true);

    // Organization membership is stored in the
    // student_organizations junction table.
    const { data, error } =
      await selectOrganizationMembershipsForManagement(org.id);

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
          membership_status: item.membership_status || "active",
          deactivation_reason: item.deactivation_reason || "",
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const lastNameA = a.last_name || "";
        const lastNameB = b.last_name || "";

        return lastNameA.localeCompare(lastNameB);
      });

    setOrganizationStudents(students);

    // Keep the card count synchronized with active members.
    setOrganizationCounts((previous) => ({
      ...previous,
      [org.id]: students.filter(
        (student) => student.membership_status !== "inactive",
      ).length,
    }));

    setStudentsLoading(false);
  }

  function closeOrganizationDetails() {
    setSelectedOrg(null);
    setOrganizationStudents([]);
  }

  function studentDisplayName(student) {
    return (
      [student?.first_name, student?.last_name]
        .filter(Boolean)
        .join(" ") ||
      student?.student_number ||
      "Student"
    );
  }

  async function handleDeactivateMembership(student) {
    if (!selectedOrg?.id || !student?.id) return;

    const label = studentDisplayName(student);
    const confirmed = await prompt.confirm({
      title: `Deactivate ${selectedOrg.name} Access?`,
      message: `${label} will remain in KANDID and other organization memberships will not be changed.`,
      type: "warning",
      confirmText: "Deactivate Access",
    });

    if (!confirmed) return;

    const { error } = await deactivateStudentOrganizationMembership({
      studentId: student.id,
      organizationId: selectedOrg.id,
      reason: "Deactivated from organization directory",
    });

    if (error) {
      prompt.error(error.message || `Failed to deactivate ${selectedOrg.name} access.`);
      return;
    }

    prompt.success(`${selectedOrg.name} access deactivated for ${label}.`);

    await logAuditEvent({
      action: "membership_deactivated",
      entityType: "student_organization",
      entityId: student.id,
      entityLabel: label,
      organizationId: selectedOrg.id,
      organizationName: selectedOrg.name,
      status: "completed",
      metadata: {
        student_id: student.id,
        organization_id: selectedOrg.id,
      },
    });

    openOrganizationDetails(selectedOrg);
    fetchOrganizationCounts();
  }

  async function handleReactivateMembership(student) {
    if (!selectedOrg?.id || !student?.id) return;

    const label = studentDisplayName(student);
    const confirmed = await prompt.confirm({
      title: `Reactivate ${selectedOrg.name} Access?`,
      message: `${label} will regain active membership access for ${selectedOrg.name}.`,
      type: "info",
      confirmText: "Reactivate Access",
    });

    if (!confirmed) return;

    const { error } = await reactivateStudentOrganizationMembership({
      studentId: student.id,
      organizationId: selectedOrg.id,
    });

    if (error) {
      prompt.error(error.message || `Failed to reactivate ${selectedOrg.name} access.`);
      return;
    }

    prompt.success(`${selectedOrg.name} access reactivated for ${label}.`);

    await logAuditEvent({
      action: "membership_reactivated",
      entityType: "student_organization",
      entityId: student.id,
      entityLabel: label,
      organizationId: selectedOrg.id,
      organizationName: selectedOrg.name,
      status: "completed",
      metadata: {
        student_id: student.id,
        organization_id: selectedOrg.id,
      },
    });

    openOrganizationDetails(selectedOrg);
    fetchOrganizationCounts();
  }

  async function handleRemoveMembership(student) {
    if (!selectedOrg?.id || !student?.id) return;

    const label = studentDisplayName(student);
    const analysis = await analyzeMembershipDependencies({
      studentId: student.id,
      organizationId: selectedOrg.id,
    });

    if (analysis.blocked) {
      await prompt.alert({
        title: `Do Not Remove from ${selectedOrg.name}`,
        message: `${analysis.recommendation}\n\nRelated records: ${
          analysis.dependencies
            .map((dependency) => `${dependency.label}: ${dependency.count}`)
            .join(", ") || "None"
        }`,
        type: "warning",
        confirmText: "Review",
      });
      return;
    }

    const confirmed = await prompt.confirm({
      title: `Remove from ${selectedOrg.name}?`,
      message: `${label} will remain in KANDID. Only the ${selectedOrg.name} membership will be removed.`,
      type: analysis.severity === "warning" ? "warning" : "danger",
      confirmText: `Remove from ${selectedOrg.name}`,
    });

    if (!confirmed) return;

    const { error } = await removeStudentOrganizationMembership({
      studentId: student.id,
      organizationId: selectedOrg.id,
    });

    if (error) {
      prompt.error(error.message || `Failed to remove student from ${selectedOrg.name}.`);
      return;
    }

    prompt.success(`${label} removed from ${selectedOrg.name}.`);

    await logAuditEvent({
      action: "membership_removed",
      entityType: "student_organization",
      entityId: student.id,
      entityLabel: label,
      organizationId: selectedOrg.id,
      organizationName: selectedOrg.name,
      status: "completed",
      metadata: {
        student_id: student.id,
        organization_id: selectedOrg.id,
        dependencies: analysis.dependencies,
      },
    });

    openOrganizationDetails(selectedOrg);
    fetchOrganizationCounts();
  }

  function openCreateForm() {
    setEditingOrg(null);

    setForm({
      name: "",
      description: "",
      logo_url: "",
      organization_type: "departmental",
    });
    setSelectedProgramIds([]);
    setNewProgram("");

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
    setSelectedProgramIds(
      (org.organization_programs || [])
        .map((link) => String(link.program_id))
        .filter(Boolean)
    );
    setNewProgram("");

    setFormOpen(true);
  }

  function toggleProgram(programId) {
    setSelectedProgramIds((previous) =>
      previous.includes(String(programId))
        ? previous.filter((id) => id !== String(programId))
        : [...previous, String(programId)]
    );
  }

  async function handleAddProgram() {
    const { data, error } = await ensureProgram(newProgram);

    if (error) {
      prompt.error(
        error.message ||
        "Program could not be added. Apply the organization sync migration first."
      );
      return;
    }

    if (!data) return;

    setPrograms((previous) => {
      const exists = previous.some(
        (program) => String(program.id) === String(data.id)
      );
      return exists
        ? previous
        : [...previous, data].sort((a, b) =>
            String(a.code || a.name).localeCompare(String(b.code || b.name))
          );
    });
    setSelectedProgramIds((previous) =>
      previous.includes(String(data.id))
        ? previous
        : [...previous, String(data.id)]
    );
    setNewProgram("");
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

    if (
      form.organization_type === "departmental" &&
      programs.length > 0 &&
      selectedProgramIds.length === 0
    ) {
      prompt.error("Select at least one covered program for this departmental organization.");
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
        .eq("id", editingOrg.id)
        .select("id")
        .single();
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
        ])
        .select("id")
        .single();
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

    const organizationId = result?.data?.id || editingOrg?.id;

    if (programs.length > 0) {
      const { error: deleteProgramError } = await supabase
        .from("organization_programs")
        .delete()
        .eq("organization_id", organizationId);

      if (deleteProgramError) {
        console.warn("Program coverage update skipped:", deleteProgramError);
        prompt.error(
          "Organization saved, but program coverage needs the organization sync migration."
        );
      } else if (
        form.organization_type === "departmental" &&
        selectedProgramIds.length > 0
      ) {
        const programRows = selectedProgramIds.map((programId) => ({
          organization_id: organizationId,
          program_id: Number(programId),
        }));

        const { error: programError } = await supabase
          .from("organization_programs")
          .insert(programRows);

        if (programError) {
          console.warn("Program coverage insert skipped:", programError);
          prompt.error(
            "Organization saved, but program coverage needs the organization sync migration."
          );
        }
      }
    }

    clearOrganizationAccessCache();
    const { error: syncError } = await syncStudentsForOrganizationCoverage(
      organizationId
    );

    if (syncError) {
      console.warn("Student membership backfill skipped:", syncError);
      prompt.error(
        syncError.message ||
        "Organization saved, but matching students could not be synced."
      );
    }

    prompt.success(
      editingOrg
        ? "Organization updated."
        : "Organization created."
    );

    await logAuditEvent({
      action: editingOrg ? "organization_updated" : "organization_created",
      entityType: "organization",
      entityId: organizationId,
      entityLabel: form.name.trim(),
      organizationId,
      organizationName: form.name.trim(),
      status: "completed",
      metadata: {
        organization_type: form.organization_type,
        program_count: selectedProgramIds.length,
      },
    });

    setLoading(false);
    setFormOpen(false);

    await fetchOrganizations();
  }

  async function handleDelete(id) {
    const organization =
      organizations.find((org) => org.id === id) || selectedOrg || {};
    const analysis = await analyzeDeleteDependencies("organization", { id });

    if (analysis.blocked) {
      await logAuditEvent({
        action: "organization_delete_blocked",
        entityType: "organization",
        entityId: id,
        entityLabel: organization.name || "Organization",
        organizationId: id,
        organizationName: organization.name,
        status: "requires_action",
        metadata: { dependencies: analysis.dependencies },
      });

      await prompt.alert({
        title: "Organization Cannot Be Deleted Yet",
        message: dependencyMessage(organization.name || "This organization", analysis),
        type: "warning",
        confirmText: "Review Related Records",
      });
      return;
    }

    const confirmDelete = await prompt.confirm({
      title: "Delete Organization?",
      message: dependencyMessage(organization.name || "This organization", analysis),
      type: "danger",
      confirmText: "Delete Organization",
    });

    if (!confirmDelete) return;

    const recheck = await analyzeDeleteDependencies("organization", { id });
    if (recheck.blocked) {
      prompt.error(dependencyMessage(organization.name || "This organization", recheck));
      return;
    }

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

    await logAuditEvent({
      action: "organization_deleted",
      entityType: "organization",
      entityId: id,
      entityLabel: organization.name || "Organization",
      organizationId: id,
      organizationName: organization.name,
      status: "completed",
    });

    if (selectedOrg?.id === id) {
      closeOrganizationDetails();
    }

    await fetchOrganizations();
  }

  useEffect(() => {
    const loadInitialData = async () => {
      await Promise.all([
        fetchOrganizations(),
        loadPrograms(),
      ]);
    };

    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const filteredOrganizations = useMemo(() => {
    let filtered = organizations;

    if (filter !== "all") {
      filtered = filtered.filter(
        (org) => org.organization_type === filter
      );
    }

    const query = search.trim().toLowerCase();
    if (!query) return filtered;

    return filtered.filter((org) => {
      const coveredPrograms = (org.organization_programs || [])
        .map((link) => link.programs)
        .filter(Boolean)
        .map((program) => `${program.code || ""} ${program.name || ""}`)
        .join(" ");

      return [
        org.name,
        org.description,
        getOrganizationTypeLabel(org),
        coveredPrograms,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [organizations, search, filter]);

  const organizationSummary = useMemo(() => {
    const departmental = organizations.filter(
      (org) => org.organization_type !== "non_departmental"
    ).length;
    const nonDepartmental = organizations.length - departmental;
    const activeMemberships = Object.values(organizationCounts).reduce(
      (total, count) => total + count,
      0
    );

    return {
      departmental,
      nonDepartmental,
      activeMemberships,
    };
  }, [organizationCounts, organizations]);

  return (
    <div className="sa-organizations">
      <header className="sa-organizations-masthead">
        <div className="sa-organizations-masthead-copy">
          <p className="sa-organizations-brandline">
            <span>Kandid</span>
            <span>/</span>
            <span>Super Admin</span>
          </p>
          <p className="sa-organizations-eyebrow">Organization Directory</p>
          <h1>Organizations</h1>
          <p className="sa-organizations-deck">
            Manage the organizations that make up the Kandid election network.
          </p>
        </div>

        <div className="sa-organizations-masthead-aside">
          <span>Directory status</span>
          <strong>
            {directoryLoading ? "Loading records" : `${organizations.length} registered`}
          </strong>
          <button
            onClick={openCreateForm}
            className="sa-organizations-add"
            type="button"
          >
            <Plus size={17} aria-hidden="true" />
            Add organization
          </button>
        </div>
      </header>

      {directoryLoading ? (
        <section className="sa-organizations-loading" aria-live="polite">
          <p className="sa-organizations-eyebrow">Registry loading</p>
          <strong>Preparing organization records.</strong>
          <div className="sa-organizations-loading-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
      ) : directoryError ? (
        <section className="sa-organizations-error" role="alert">
          <p className="sa-organizations-eyebrow">Directory unavailable</p>
          <h2>Organization records could not be displayed.</h2>
          <p>{directoryError} Try again when the connection is available.</p>
          <button type="button" onClick={fetchOrganizations} className="sa-organizations-retry">
            <RefreshCw size={16} aria-hidden="true" />
            Retry directory
          </button>
        </section>
      ) : (
        <>
          <section className="sa-organizations-summary" aria-label="Organization directory summary">
            <div className="sa-organizations-summary-item">
              <span>01 / Registered</span>
              <strong>{organizations.length}</strong>
              <small>Organization records</small>
            </div>
            <div className="sa-organizations-summary-item">
              <span>02 / Departmental</span>
              <strong>{organizationSummary.departmental}</strong>
              <small>Program-linked organizations</small>
            </div>
            <div className="sa-organizations-summary-item">
              <span>03 / Non-departmental</span>
              <strong>{organizationSummary.nonDepartmental}</strong>
              <small>Cross-program organizations</small>
            </div>
            <div className="sa-organizations-summary-item">
              <span>04 / Memberships</span>
              <strong>{organizationCountsLoading ? "--" : organizationSummary.activeMemberships}</strong>
              <small>Active organization links</small>
            </div>
          </section>

          <section className="sa-organizations-directory" aria-labelledby="organization-records-title">
            <div className="sa-organizations-directory-head">
              <div>
                <p className="sa-organizations-eyebrow">Organization records / 01</p>
                <h2 id="organization-records-title">Institutional registry</h2>
              </div>
              <div className="sa-organizations-filters" aria-label="Filter organizations">
                {["all", "departmental", "non_departmental"].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setFilter(type)}
                    className={filter === type ? "is-active" : ""}
                    aria-pressed={filter === type}
                  >
                    {type === "all"
                      ? "All"
                      : type === "departmental"
                      ? "Departmental"
                      : "Non-departmental"}
                  </button>
                ))}
              </div>
            </div>

            {filteredOrganizations.length === 0 ? (
              <div className="sa-organizations-empty">
                <span aria-hidden="true">00</span>
                <div>
                  <h3>{search ? "No matching records" : "The directory is empty"}</h3>
                  <p>
                    {search
                      ? "No organizations match the current global search and directory filter."
                      : "Add the first organization to begin the institutional registry."}
                  </p>
                </div>
                {!search && (
                  <button type="button" onClick={openCreateForm} className="sa-organizations-text-action">
                    Add organization
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            ) : (
              <div className="sa-organizations-records">
                <div className="sa-organizations-column-head" aria-hidden="true">
                  <span>Index</span>
                  <span>Organization</span>
                  <span>Membership</span>
                  <span>Classification</span>
                  <span>Actions</span>
                </div>

                {filteredOrganizations.map((org, index) => {
                  const studentCount = organizationCounts[org.id] ?? 0;
                  const sequence = String(index + 1).padStart(2, "0");

                  return (
                    <article className="sa-organizations-record" key={org.id}>
                      <span className="sa-organizations-index" aria-hidden="true">{sequence}</span>

                      <button
                        type="button"
                        className="sa-organizations-identity"
                        onClick={() => openOrganizationDetails(org)}
                        aria-label={`View ${org.name} students and organization details`}
                      >
                        {org.logo_url ? (
                          <img
                            src={org.logo_url}
                            alt=""
                            className="sa-organizations-logo"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="sa-organizations-monogram" aria-hidden="true">
                            {(org.name || "O").slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <span className="sa-organizations-identity-copy">
                          <strong>{org.name}</strong>
                          <span>{org.description || "No organization description yet."}</span>
                          <small>
                            View member record
                            <ArrowRight size={14} aria-hidden="true" />
                          </small>
                        </span>
                      </button>

                      <div className="sa-organizations-membership">
                        <strong>{organizationCountsLoading ? "--" : studentCount}</strong>
                        <span>Active students</span>
                      </div>

                      <div className="sa-organizations-type">
                        <span aria-hidden="true" />
                        <div>
                          <strong>{getOrganizationTypeLabel(org)}</strong>
                          <small>
                            Added {org.created_at
                              ? new Date(org.created_at).toLocaleDateString()
                              : "date unavailable"}
                          </small>
                        </div>
                      </div>

                      <div className="sa-organizations-actions">
                        <button
                          onClick={() => openEditForm(org)}
                          type="button"
                          aria-label={`Edit ${org.name}`}
                        >
                          <Pencil size={15} aria-hidden="true" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(org.id)}
                          type="button"
                          className="sa-organizations-delete"
                          aria-label={`Delete ${org.name}`}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                          Delete
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
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
                      loading="lazy"
                      decoding="async"
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

                            <th className="px-5 py-4 text-right text-xs font-black uppercase tracking-[0.12em] text-gray-500">
                              Membership
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
                                    <StudentAvatar
                                      student={student}
                                      loading="lazy"
                                      className="!h-10 !w-10 !rounded-xl"
                                    />

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

                                <td className="px-5 py-4">
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <span
                                      className={`rounded-full px-3 py-1 text-xs font-bold ${
                                        student.membership_status === "inactive"
                                          ? "bg-amber-100 text-amber-700"
                                          : "bg-emerald-100 text-emerald-700"
                                      }`}
                                    >
                                      {student.membership_status === "inactive"
                                        ? "Inactive"
                                        : "Active"}
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
                                      {student.membership_status === "inactive"
                                        ? `Reactivate ${selectedOrg?.name}`
                                        : `Deactivate ${selectedOrg?.name}`}
                                    </button>

                                    <button
                                      type="button"
                                      className="danger-btn min-h-[2.35rem] px-3 text-xs"
                                      onClick={() => handleRemoveMembership(student)}
                                    >
                                      Remove from {selectedOrg?.name}
                                    </button>
                                  </div>
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
          <div
            className="sa-organizations-form-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="organization-form-title"
          >
            <header className="sa-organizations-form-header">
              <div>
                <p className="sa-organizations-form-kicker">
                  Organization record / {editingOrg ? "Edit" : "New"}
                </p>
                <h2 id="organization-form-title">
                  {editingOrg ? "Edit Organization" : "Add Organization"}
                </h2>
                <p className="sa-organizations-form-intro">
                  {editingOrg
                    ? "Update this organization record for the Kandid election network."
                    : "Create an official organization record for the Kandid election network."}
                </p>
                <p className="sa-organizations-form-required">* Required field</p>
              </div>

              <button
                onClick={() => setFormOpen(false)}
                className="sa-organizations-form-close"
                type="button"
                aria-label={`Close ${editingOrg ? "Edit" : "Add"} Organization form`}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <form onSubmit={handleSubmit} className="sa-organizations-form">
              <section className="sa-organizations-form-section" aria-labelledby="organization-identity-heading">
                <div className="sa-organizations-form-section-head">
                  <span>01</span>
                  <div>
                    <p>Record section</p>
                    <h3 id="organization-identity-heading">Identity</h3>
                  </div>
                </div>

                <div className="sa-organizations-form-identity-grid">
                  <div className="sa-organizations-form-fields">
                    <div className="sa-organizations-form-field">
                      <label htmlFor="organization-name">
                        Organization Name <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="organization-name"
                        value={form.name}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            name: e.target.value,
                          })
                        }
                        required
                        autoComplete="organization"
                        placeholder="Enter organization name"
                      />
                      <small>Used to identify the organization across Kandid.</small>
                    </div>

                    <div className="sa-organizations-form-field">
                      <label htmlFor="organization-description">Description</label>
                      <textarea
                        id="organization-description"
                        value={form.description}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            description: e.target.value,
                          })
                        }
                        placeholder="Short description"
                        rows="5"
                      />
                    </div>
                  </div>

                  <div className="sa-organizations-logo-field">
                    <div className="sa-organizations-logo-heading">
                      <label htmlFor="organization-logo-file">Organization Logo</label>
                      <span>Optional</span>
                    </div>

                    <div className="sa-organizations-logo-preview-row">
                      {form.logo_url ? (
                        <img
                          src={form.logo_url}
                          alt="Organization logo preview"
                          className="sa-organizations-logo-preview"
                        />
                      ) : (
                        <div className="sa-organizations-logo-placeholder" aria-hidden="true">
                          <Building2 size={22} />
                          <span>Logo</span>
                        </div>
                      )}

                      <div>
                        <input
                          id="organization-logo-file"
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleLogoUpload(e.target.files?.[0])}
                        />
                        <small>Select an image from this device.</small>
                      </div>
                    </div>

                    <div className="sa-organizations-form-field sa-organizations-logo-url">
                      <label htmlFor="organization-logo-url">Or use an image URL</label>
                      <input
                        id="organization-logo-url"
                        value={form.logo_url}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            logo_url: e.target.value,
                          })
                        }
                        inputMode="url"
                        placeholder="Paste logo image URL"
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className="sa-organizations-form-section" aria-labelledby="organization-classification-heading">
                <div className="sa-organizations-form-section-head">
                  <span>02</span>
                  <div>
                    <p>Record section</p>
                    <h3 id="organization-classification-heading">Classification &amp; Coverage</h3>
                  </div>
                </div>

                <fieldset className="sa-organizations-type-fieldset">
                  <legend>
                    Organization Type <span aria-hidden="true">*</span>
                  </legend>
                  <div className="sa-organizations-type-options">
                    <label className={form.organization_type === "departmental" ? "is-selected" : ""}>
                      <input
                        type="radio"
                        name="organization_type"
                        value="departmental"
                        checked={form.organization_type === "departmental"}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            organization_type: e.target.value,
                          })
                        }
                      />
                      <span>
                        <strong>Departmental</strong>
                        <small>Organization tied to a department or program.</small>
                      </span>
                    </label>

                    <label className={form.organization_type === "non_departmental" ? "is-selected" : ""}>
                      <input
                        type="radio"
                        name="organization_type"
                        value="non_departmental"
                        checked={form.organization_type === "non_departmental"}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            organization_type: e.target.value,
                          })
                        }
                      />
                      <span>
                        <strong>Non-departmental</strong>
                        <small>Organization open across departments.</small>
                      </span>
                    </label>
                  </div>
                </fieldset>

                {form.organization_type === "departmental" && (
                  <div className="sa-organizations-coverage">
                    <div className="sa-organizations-coverage-heading">
                      <div>
                        <h4>Covered Programs{programs.length > 0 ? " *" : ""}</h4>
                        <p>Select every program represented by this organization.</p>
                      </div>
                      <span>{selectedProgramIds.length} selected</span>
                    </div>

                    <div className="sa-organizations-program-entry">
                      <label htmlFor="organization-new-program">Add program code</label>
                      <div>
                        <input
                          id="organization-new-program"
                          value={newProgram}
                          onChange={(event) => setNewProgram(event.target.value)}
                          placeholder="Program code"
                        />
                        <button
                          type="button"
                          onClick={handleAddProgram}
                          disabled={!newProgram.trim()}
                        >
                          <Plus size={15} aria-hidden="true" />
                          Add Program
                        </button>
                      </div>
                    </div>

                    <div className="sa-organizations-program-list">
                      {programs.length === 0 ? (
                        <p className="sa-organizations-program-empty">
                          No programs found. Programs are seeded from student records by the organization sync migration.
                        </p>
                      ) : (
                        programs.map((program) => {
                          const checked = selectedProgramIds.includes(String(program.id));

                          return (
                            <label key={program.id} className={checked ? "is-selected" : ""}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleProgram(program.id)}
                              />
                              <span>{program.code || program.name}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </section>

              <footer className="sa-organizations-form-actions">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="sa-organizations-form-cancel"
                >
                  Cancel
                </button>

                <button
                  disabled={loading}
                  className="sa-organizations-form-submit"
                  type="submit"
                >
                  <span>
                    {loading
                      ? "Saving..."
                      : editingOrg
                        ? "Save Changes"
                        : "Create Organization"}
                  </span>
                  {!loading && <ArrowRight size={17} aria-hidden="true" />}
                </button>
              </footer>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default Organizations;
