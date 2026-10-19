import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Plus,
  Pencil,
  RefreshCw,
  Trash2,
  X,
  Building2,
  MoreHorizontal,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import PopupOverlay from "../../components/PopupOverlay";
import { StudentAvatar } from "../../components/KandidImage";
import { supabase } from "../../lib/supabaseClient";
import { readFileAsDataUrl } from "../../utils/files";
import SuperAdminPageHeader from "../../components/SuperAdminPageHeader";
import {
  attachProgramCoverage,
  ensureProgram,
  getCurrentOrganizationMemberCount,
  getCurrentOrganizationMembers,
  getPrograms,
  saveOrganizationConfiguration,
} from "../../utils/organizationAccess";
import { removeSuperAdminCurrentOrganizationMembership } from "../../utils/superAdminManualEnrollment";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import {
  deleteOrganizationSafely,
  getOrganizationDeletionReadiness,
} from "../../utils/organizationDeletion";
import {
  organizationMembershipScopeLabel,
  resolveOrganizationMembershipScope,
} from "../../utils/organizationMembershipScope";
import {
  getOrganizationDeletionAdvisorySummary,
  normalizeTrustedOrganizationDependencies,
  normalizeOrganizationDeletionAdvisory,
  visibleOrganizationDeletionDependencies,
} from "../../utils/organizationDeletionReview";
import "./Organizations.css";

function OrganizationMobileActions({ organization, onViewMembers, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const firstItemRef = useRef(null);
  const menuId = `organization-actions-${organization.id}`;

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    firstItemRef.current?.focus();

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleMenuKeyDown(event) {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...(rootRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  return (
    <div className="sa-organizations-mobile-actions">
      <button
        type="button"
        className="sa-organizations-mobile-view"
        onClick={onViewMembers}
        aria-label={`View member record for ${organization.name}`}
      >
        View member record
        <ArrowRight size={14} aria-hidden="true" />
      </button>

      <div className="sa-organizations-overflow" ref={rootRef}>
        <button
          ref={triggerRef}
          type="button"
          className="sa-organizations-overflow-trigger"
          aria-label={`Organization actions for ${organization.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
        >
          <MoreHorizontal size={20} aria-hidden="true" />
        </button>
        {open && (
          <div
            id={menuId}
            className="sa-organizations-overflow-menu"
            role="menu"
            aria-label={`Organization actions for ${organization.name}`}
            onKeyDown={handleMenuKeyDown}
          >
            <button ref={firstItemRef} type="button" role="menuitem" onClick={() => { setOpen(false); onEdit(); }}>
              Edit organization
            </button>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onDelete(); }}>
              Delete organization
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Organizations() {
  const prompt = usePrompt();
  const [searchParams] = useSearchParams();

  const [organizations, setOrganizations] = useState([]);
  const [search] = useState(() => searchParams.get("q") || "");
  const [filter, setFilter] = useState("all");
  const [programs, setPrograms] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState(null);
  const [creationStep, setCreationStep] = useState(1);
  const [stepError, setStepError] = useState("");
  const [selectedProgramIds, setSelectedProgramIds] = useState([]);
  const [newProgram, setNewProgram] = useState("");

  const [selectedOrg, setSelectedOrg] = useState(null);
  const [organizationStudents, setOrganizationStudents] = useState([]);
  const [organizationCounts, setOrganizationCounts] = useState({});
  const [organizationMemberStatus, setOrganizationMemberStatus] = useState("idle");
  const [organizationMemberCount, setOrganizationMemberCount] = useState(null);
  const [organizationMemberTerm, setOrganizationMemberTerm] = useState(null);

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
  const [deletionEntry, setDeletionEntry] = useState(null);
  const [deletionReview, setDeletionReview] = useState(null);
  const [deletionReviewBusy, setDeletionReviewBusy] = useState(false);

  async function loadPrograms() {
    const data = await getPrograms();
    setPrograms(data || []);
  }

  async function fetchOrganizations() {
    setDirectoryLoading(true);
    setDirectoryError("");

    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, description, organization_type, membership_scope, created_at")
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

    const counts = {};
    const results = await Promise.all(orgs.map(async (org) => ({
      organizationId: org.id,
      ...(await getCurrentOrganizationMemberCount(org.id)),
    })));
    const failedOrganizations = [];
    results.forEach(({ organizationId, data, error }) => {
      counts[organizationId] = error ? null : data.count;
      if (error) failedOrganizations.push(organizationId);
    });

    setOrganizationCounts(counts);
    setOrganizationCountsLoading(false);
    if (failedOrganizations.length > 0) {
      prompt.error("Some current organization membership counts are unavailable.");
    }
  }

  async function openOrganizationDetails(org) {
    setSelectedOrg(org);
    setOrganizationStudents([]);
    setOrganizationMemberCount(null);
    setOrganizationMemberTerm(null);
    setOrganizationMemberStatus("loading");

    const { data: currentMembership, count, academicTerm, error } = await getCurrentOrganizationMembers(org.id);

    if (error) {
      console.error("Failed to load current organization members:", error);

      prompt.error("Current organization members could not be verified.");

      setOrganizationMemberStatus("unavailable");
      return;
    }

    const students = (currentMembership || []).map((membership) => ({
      ...membership.student,
      organization_role: "member",
      membership_status: membership.membership_status,
      membership_source: membership.source,
      academic_term_id: membership.academic_term_id,
      current_term_program: membership.program,
      current_term_year_level: membership.year_level,
    }));

    setOrganizationStudents(students);

    // Keep the displayed count and term tied to the trusted membership contract.
    setOrganizationCounts((previous) => ({
      ...previous,
      [org.id]: count,
    }));

    setOrganizationMemberCount(count);
    setOrganizationMemberTerm(academicTerm || null);
    setOrganizationMemberStatus("ready");
  }

  function closeOrganizationDetails() {
    setSelectedOrg(null);
    setOrganizationStudents([]);
    setOrganizationMemberCount(null);
    setOrganizationMemberTerm(null);
    setOrganizationMemberStatus("idle");
  }

  function formatOrganizationAcademicTerm(term) {
    if (!term?.semester || !term?.academic_year) return "Term not available";
    return `${term.semester} · AY ${term.academic_year}`;
  }

  function getAccountStatusLabel(status) {
    if (status === "active") return "Active";
    if (status === "disabled") return "Disabled";
    return "Pending setup";
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

  async function handleRemoveMembership(student) {
    if (!selectedOrg?.id || !student?.id) return;

    const label = studentDisplayName(student);
    const reason = await prompt({
      title: "Reason for removing current membership",
      message: `${label} will stop participating in ${selectedOrg.name} for the current academic term. Their student record, enrollment, organization link, and history will remain.`,
      placeholder: "Enter a reason",
      confirmText: "Continue",
      cancelText: "Cancel",
    });
    if (reason === null) return;
    if (!String(reason).trim()) {
      prompt.error("Enter a reason before removing current membership.");
      return;
    }

    const confirmed = await prompt.confirm({
      title: "Remove current membership?",
      message: `${label} will be removed from current-term participation in ${selectedOrg.name}. Enrollment, the structural organization link, and historical records will remain unchanged.`,
      type: "warning",
      confirmText: "Remove membership",
    });

    if (!confirmed) return;

    const { error } = await removeSuperAdminCurrentOrganizationMembership({
      studentId: student.id,
      organizationId: selectedOrg.id,
      reason: String(reason).trim(),
    });

    if (error) {
      prompt.error(error.message || `Failed to remove current ${selectedOrg.name} membership.`);
      return;
    }

    prompt.success(`${label}'s current-term membership was removed from ${selectedOrg.name}.`);

    openOrganizationDetails(selectedOrg);
    fetchOrganizationCounts();
  }

  function openCreateForm() {
    setEditingOrg(null);
    setCreationStep(1);
    setStepError("");

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
    setCreationStep(1);
    setStepError("");

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
    setStepError("");
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
    setStepError("");
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

    const membershipScope = resolveOrganizationMembershipScope(
      editingOrg,
      form.organization_type,
    );

    if (membershipScope === "program" && selectedProgramIds.length === 0) {
      prompt.error(programs.length === 0
        ? "Add a program to the catalog before saving this program-scoped organization."
        : "Select at least one covered program for this organization.");
      return;
    }

    if (!membershipScope) {
      prompt.error("Organization membership scope could not be verified.");
      return;
    }

    setLoading(true);

    const result = await saveOrganizationConfiguration({
      organizationId: editingOrg?.id || null,
      name: form.name,
      description: form.description,
      logoUrl: form.logo_url || null,
      organizationType: form.organization_type,
      programIds: membershipScope === "program" ? selectedProgramIds : [],
    });

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
    if (!organizationId) {
      prompt.error("Organization configuration could not be confirmed. Refresh before retrying.");
      setLoading(false);
      return;
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

  function handleOrganizationFormSubmit(event) {
    if (editingOrg || creationStep === 3) {
      handleSubmit(event);
      return;
    }

    event.preventDefault();
    setStepError("");

    if (creationStep === 1) {
      if (!form.name.trim()) {
        setStepError("Enter an organization name to continue.");
        document.getElementById("organization-name")?.focus();
        return;
      }

      if (!(["departmental", "non_departmental"].includes(form.organization_type))) {
        setStepError("Choose an organization type to continue.");
        document.querySelector('input[name="organization_type"]')?.focus();
        return;
      }

      setCreationStep(2);
      return;
    }

    if (
      resolveOrganizationMembershipScope(editingOrg, form.organization_type) === "program" &&
      selectedProgramIds.length === 0
    ) {
      setStepError(programs.length === 0
        ? "Add a program to the catalog before reviewing this program-scoped organization."
        : "Select at least one covered program before reviewing this organization.");
      document.querySelector('[name="organization_program"]')?.focus();
      return;
    }

    setCreationStep(3);
  }

  async function loadDeletionReview(organization) {
    const [readiness, currentTermMembers, ...categoryResults] = await Promise.all([
      getOrganizationDeletionReadiness(organization.id),
      getCurrentOrganizationMemberCount(organization.id),
      ...[
        ["student_memberships", "student_organizations"],
        ["program_coverage", "organization_programs"],
        ["election_history", "elections"],
        ["officer_history", "officers"],
        ["board_assignments", "admin_users"],
        ["partylists", "partylists"],
        ["prepared_officers", "officer_new_roster"],
        ["leadership_releases", "officer_leadership_releases"],
        ["campaign_snapshots", "election_campaign_snapshots"],
        ["officer_publications", "election_officer_publications"],
      ].map(async ([key, table]) => {
        const { count, error } = await supabase
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organization.id);
        return { key, count, error: Boolean(error) };
      }),
    ]);

    const advisory = normalizeOrganizationDeletionAdvisory(
      Object.fromEntries(categoryResults.map(({ key, ...result }) => [key, result])),
    );

    return {
      organization,
      readiness,
      advisory,
      currentTermMembers: currentTermMembers.error ? null : currentTermMembers.data,
    };
  }

  async function handleDelete(id) {
    const organization = organizations.find((org) => org.id === id) || selectedOrg;
    if (!organization) return;

    setDeletionEntry({ organization, loading: true, review: null });
    try {
      const review = await loadDeletionReview(organization);
      setDeletionEntry({ organization, loading: false, review });
    } catch {
      const advisory = normalizeOrganizationDeletionAdvisory({});
      setDeletionEntry({
        organization,
        loading: false,
        review: {
          organization,
          readiness: { status: "error", data: null },
          advisory,
          currentTermMembers: null,
        },
      });
    }
  }

  async function refreshDeletionReview() {
    if (!deletionReview?.organization) return;
    setDeletionReviewBusy(true);
    try {
      setDeletionReview(await loadDeletionReview(deletionReview.organization));
    } catch {
      setDeletionReview((current) => current && ({
        ...current,
        readiness: { status: "error", data: null },
        advisory: normalizeOrganizationDeletionAdvisory({}),
        currentTermMembers: null,
      }));
    } finally {
      setDeletionReviewBusy(false);
    }
  }

  async function confirmOrganizationDeletion() {
    if (deletionReview?.readiness?.status !== "ready") return;
    const organization = deletionReview.organization;
    const confirmed = await prompt.confirm({
      title: "Delete Organization?",
      message: `Kandid's trusted check found no blocking dependencies for ${organization.name}. This permanent action cannot be undone.`,
      type: "danger",
      confirmText: "Delete Organization",
    });
    if (!confirmed) return;

    setDeletionReviewBusy(true);
    const deletionResult = await deleteOrganizationSafely(organization.id);
    setDeletionReviewBusy(false);

    if (deletionResult.status === "deleted") {
      prompt.success("Organization deleted.");
      await logAuditEvent({
        action: "organization_deleted",
        entityType: "organization",
        entityId: organization.id,
        entityLabel: organization.name || "Organization",
        organizationId: organization.id,
        organizationName: organization.name,
        status: "completed",
      });
      setDeletionReview(null);
      await fetchOrganizations();
      return;
    }

    if (deletionResult.status === "blocked") {
      prompt.error("Trusted verification found records that still prevent deletion. Review the updated dependency list.");
      await refreshDeletionReview();
      return;
    }

    if (deletionResult.status === "unavailable") {
      setDeletionReview((current) => current && ({
        ...current,
        readiness: { status: "unavailable", data: null },
      }));
      return;
    }

    prompt.error("Organization could not be deleted. Its records remain unchanged.");
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

  function getOrganizationMembershipScopeLabel(org) {
    return organizationMembershipScopeLabel(org?.membership_scope);
  }

  const formMembershipScope = resolveOrganizationMembershipScope(
    editingOrg,
    form.organization_type,
  );

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
      (total, count) => total + (Number.isInteger(count) ? count : 0),
      0
    );
    const membershipCountsComplete = organizations.every((org) => Number.isInteger(organizationCounts[org.id]));

    return {
      departmental,
      nonDepartmental,
      activeMemberships,
      membershipCountsComplete,
    };
  }, [organizationCounts, organizations]);

  function renderDeletionReview() {
    const review = deletionReview;
    if (!review) return null;
    const organization = review.organization;
    const trustedStatus = review.readiness?.status || "error";
    const trustedAvailable = trustedStatus === "ready" || trustedStatus === "blocked" || trustedStatus === "verification_required";
    const trustedDependencies = trustedStatus === "blocked" || trustedStatus === "verification_required"
      ? normalizeTrustedOrganizationDependencies(review.readiness?.data?.dependencies || [])
      : null;
    const categories = trustedDependencies || visibleOrganizationDeletionDependencies(review.advisory || []);
    const advisorySummary = getOrganizationDeletionAdvisorySummary(categories);
    const currentTermMemberCount = Number.isSafeInteger(review.currentTermMembers?.count)
      ? review.currentTermMembers.count
      : null;
    const reviewCategories = [...categories];

    if (!trustedAvailable) {
      reviewCategories.push({
        key: "unknown_legacy",
        label: "Additional deletion requirements",
        kind: "unverified",
        status: "unverified",
        count: null,
        explanation: "Kandid must verify every record type before permanent deletion can be considered.",
      });
    }

    const statusCopy = {
      unavailable: ["Verification required", "Kandid cannot yet verify every record required for safe permanent deletion. Until verification is complete, permanent deletion remains unavailable."],
      verification_required: ["Verification required", "Kandid found an organization relationship it cannot safely evaluate. Permanent deletion remains unavailable until that relationship is reviewed."],
      error: ["Verification required", "Kandid could not verify every requirement for safe permanent deletion. Known records are shown below; unavailable information remains unknown."],
      blocked: ["Not ready", "Trusted verification found connected records that must be reviewed or preserved. Removing the records shown here alone does not guarantee deletion."],
      ready: ["Verified", "The trusted contract currently reports no blocking dependencies."],
    }[trustedStatus] || ["Verification unavailable", "Trusted deletion readiness is not available."];

    const managementAction = (category) => {
      if (category.destination === "members") {
        return (
          <button type="button" className="sa-deletion-review-action" onClick={() => openOrganizationDetails(organization)}>
            View current-term members <ArrowRight size={14} aria-hidden="true" />
          </button>
        );
      }
      if (category.destination === "coverage") {
        return (
          <button type="button" className="sa-deletion-review-action" onClick={() => openEditForm(organization)}>
            Manage coverage <ArrowRight size={14} aria-hidden="true" />
          </button>
        );
      }
      if (!category.destination) return null;
      const actionLabel = {
        board_assignments: "Manage Board access",
        partylists: "View partylists",
        prepared_officers: "View officers",
      }[category.sourceKey || category.key] || "View records";
      return (
        <a className="sa-deletion-review-action" href={category.destination} target="_blank" rel="noreferrer">
          {actionLabel} <ArrowRight size={14} aria-hidden="true" />
        </a>
      );
    };

    return (
      <>
        <SuperAdminPageHeader
          section="Super Admin / Organization Management"
          title="Deletion Review"
          description="Review records connected to this organization before permanent deletion."
          actions={(
            <button type="button" className="sa-organizations-text-action" onClick={() => setDeletionReview(null)}>
              <ArrowRight size={15} aria-hidden="true" className="rotate-180" />
              Return to Organizations
            </button>
          )}
        />

        <section className="sa-deletion-review" aria-labelledby="deletion-review-org-title">
          <div className="sa-deletion-review-identity">
            <p className="sa-organizations-eyebrow">Organization deletion / readiness</p>
            <h2 id="deletion-review-org-title">{organization.name}</h2>
            <p>Review what is connected, what can be managed, and what Kandid preserves as history.</p>
          </div>

          <div className={`sa-deletion-review-readiness is-${trustedStatus}`} role="status">
            <div>
              <span>Deletion status</span>
              <strong>{statusCopy[0]}</strong>
              <p>{statusCopy[1]}</p>
            </div>
            <button type="button" className="sa-deletion-review-action" onClick={refreshDeletionReview} disabled={deletionReviewBusy}>
              <RefreshCw size={14} aria-hidden="true" />
              {deletionReviewBusy ? "Checking…" : "Refresh review"}
            </button>
          </div>

          <p className="sa-deletion-review-note">
            {trustedAvailable
              ? "Known records are grouped by purpose. Permanent deletion still depends on trusted verification, not on these navigation counts."
              : "Known connected records are shown below. An unavailable dependency is never assumed to contain zero records."}
          </p>

          <div className="sa-deletion-review-list" aria-label="Organization dependencies">
            <div className="sa-deletion-review-list-head">
              <span>Deletion readiness by record type</span>
              <span>{advisorySummary.unverifiedCount > 0 ? "Some counts unavailable" : "Counts are not deletion approval"}</span>
            </div>
            {reviewCategories.length === 0 ? (
              <p className="sa-deletion-review-empty">
                No visible connected records were returned. This does not establish deletion readiness.
              </p>
            ) : [
              {
                key: "attention",
                label: "Needs attention",
                description: "Known connected records with an existing management or review destination.",
                items: reviewCategories.filter((item) => item.status === "verified" && item.kind !== "history" && item.kind !== "unverified"),
              },
              {
                key: "history",
                label: "Preserved history",
                description: "Historical records are retained as part of Kandid's election and leadership record.",
                items: reviewCategories.filter((item) => item.status === "verified" && item.kind === "history"),
              },
              {
                key: "verification",
                label: "Verification required",
                description: "These values are unknown until verified; they are never treated as zero.",
                items: reviewCategories.filter((item) => item.status === "unverified" || item.kind === "unverified"),
              },
            ].filter((group) => group.items.length > 0).map((group) => (
              <section className="sa-deletion-review-group" key={group.key} aria-label={group.label}>
                <header className="sa-deletion-review-group-head">
                  <div>
                    <p className="sa-deletion-review-kind">{group.label}</p>
                    <p>{group.description}</p>
                  </div>
                </header>
                {group.items.map((category) => {
                  const historical = category.kind === "history";
                  const unverified = category.status === "unverified";
                  const countText = unverified
                    ? "Not verified"
                    : `${category.count} ${category.unit || "records"}`;
                  return (
                    <article className="sa-deletion-review-row" key={category.key}>
                      <div className="sa-deletion-review-count" aria-label={unverified ? "Not verified" : countText}>
                        {unverified ? "—" : category.count}
                      </div>
                      <div className="sa-deletion-review-copy">
                        <h3>{category.label}</h3>
                        <p>{unverified
                          ? "Kandid could not verify this count yet. It remains unknown, not zero."
                          : category.explanation || "Review this connected record using its existing management surface."}</p>
                        {category.sourceKey === "student_memberships" && (
                          <p className="sa-deletion-review-membership-compare">
                            {currentTermMemberCount === null
                              ? "Current-term member count could not be verified in this review."
                              : <><strong>{currentTermMemberCount}</strong> current-term members. Organization links preserve a student's relationship across membership history; current-term membership is calculated separately.</>}
                          </p>
                        )}
                      </div>
                      <div className="sa-deletion-review-row-state">
                        <span>{unverified ? "Verification required" : historical ? "Historical record · no direct removal here" : "Review with existing tools"}</span>
                        {!unverified && managementAction(category)}
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
          </div>

          <section className="sa-deletion-review-final" aria-labelledby="permanent-deletion-title">
            <div>
              <p className="sa-organizations-eyebrow">Permanent deletion</p>
              <h3 id="permanent-deletion-title">{trustedStatus === "ready" ? "Available after final verification" : "Not available"}</h3>
              <p>
                {trustedStatus === "ready"
                  ? "The trusted contract currently reports no blockers and will recheck readiness atomically before deletion."
                  : "Kandid must verify every deletion requirement before an organization can be permanently deleted."}
              </p>
            </div>
            <button
              type="button"
              className="sa-deletion-review-delete"
              disabled={trustedStatus !== "ready" || deletionReviewBusy}
              onClick={confirmOrganizationDeletion}
            >
              <Trash2 size={15} aria-hidden="true" />
              Delete permanently
            </button>
          </section>
        </section>
      </>
    );
  }

  return (
    <div className="sa-organizations">
      {deletionReview ? renderDeletionReview() : <>
      <SuperAdminPageHeader
        section="System structure"
        title="Organizations"
        description="Manage the organizations that make up the Kandid election network."
        actions={(
          <button
            onClick={openCreateForm}
            className="sa-organizations-add"
            type="button"
          >
            <Plus size={17} aria-hidden="true" />
            Add organization
          </button>
        )}
      />

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
              <span>
                <span className="sa-organizations-metric-label-desktop">01 / Registered</span>
                <span className="sa-organizations-metric-label-mobile">Organizations</span>
              </span>
              <strong>{organizations.length}</strong>
              <small>Organization records</small>
            </div>
            <div className="sa-organizations-summary-item">
              <span>
                <span className="sa-organizations-metric-label-desktop">02 / Departmental</span>
                <span className="sa-organizations-metric-label-mobile">Departmental</span>
              </span>
              <strong>{organizationSummary.departmental}</strong>
              <small>Program-linked organizations</small>
            </div>
            <div className="sa-organizations-summary-item">
              <span>
                <span className="sa-organizations-metric-label-desktop">03 / Non-departmental</span>
                <span className="sa-organizations-metric-label-mobile">Non-departmental</span>
              </span>
              <strong>{organizationSummary.nonDepartmental}</strong>
              <small>Cross-program organizations</small>
            </div>
            <div className="sa-organizations-summary-item">
              <span>
                <span className="sa-organizations-metric-label-desktop">04 / Memberships</span>
                <span className="sa-organizations-metric-label-mobile">Memberships</span>
              </span>
              <strong>{organizationCountsLoading || !organizationSummary.membershipCountsComplete ? "--" : organizationSummary.activeMemberships}</strong>
              <small>Current-term active memberships</small>
            </div>
          </section>

          <section className="sa-organizations-directory" aria-labelledby="organization-records-title">
            <div className="sa-organizations-directory-head">
              <div>
                <p className="sa-organizations-eyebrow">
                  <span className="sa-organizations-directory-label-desktop">Organization records</span>
                  <span className="sa-organizations-directory-label-mobile">Institutional directory</span>
                </p>
                <h2 id="organization-records-title">
                  <span className="sa-organizations-directory-title-desktop">Institutional directory</span>
                  <span className="sa-organizations-directory-title-mobile">Organization records</span>
                </h2>
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
                {filteredOrganizations.map((org, index) => {
                  const studentCount = organizationCounts[org.id];
                  const sequence = String(index + 1).padStart(2, "0");
                  const mobileMemberSummary = organizationCountsLoading
                    ? "MEMBERS LOADING"
                    : Number.isInteger(studentCount)
                      ? `${studentCount} MEMBERS`
                      : "MEMBERS UNAVAILABLE";

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
                          <small className="sa-organizations-member-record-link-desktop">
                            View member record
                            <ArrowRight size={14} aria-hidden="true" />
                          </small>
                        </span>
                      </button>

                      <div className="sa-organizations-record-meta" aria-label={`Details for ${org.name}`}>
                        <div className="sa-organizations-type">
                          <span aria-hidden="true" />
                          <div>
                            <strong>{getOrganizationTypeLabel(org)}</strong>
                            <small>{getOrganizationMembershipScopeLabel(org)}</small>
                            <small>
                              Added {org.created_at
                                ? new Date(org.created_at).toLocaleDateString()
                                : "date unavailable"}
                            </small>
                          </div>
                        </div>

                        <div className="sa-organizations-membership">
                          <strong>{organizationCountsLoading || !Number.isInteger(studentCount) ? "--" : studentCount}</strong>
                          <span>current-term members</span>
                        </div>
                        <div className="sa-organizations-mobile-meta" role="group" aria-label={`${getOrganizationTypeLabel(org)} · ${mobileMemberSummary}`}>
                          <span>{getOrganizationTypeLabel(org)} · {getOrganizationMembershipScopeLabel(org)}</span>
                          <span className="sa-organizations-mobile-meta-dot" aria-hidden="true">·</span>
                          <span>{mobileMemberSummary}</span>
                        </div>
                      </div>

                      <OrganizationMobileActions
                        organization={org}
                        onViewMembers={() => openOrganizationDetails(org)}
                        onEdit={() => openEditForm(org)}
                        onDelete={() => handleDelete(org.id)}
                      />

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
      </>}

      {deletionEntry && (
        <PopupOverlay>
          <section className="sa-deletion-entry" role="dialog" aria-modal="true" aria-labelledby="deletion-entry-title">
            <header className="sa-deletion-entry-header">
              <div>
                <p className="sa-organizations-eyebrow">Organization deletion</p>
                <h2 id="deletion-entry-title">
                  {deletionEntry.review?.readiness.status === "blocked"
                    ? `${deletionEntry.organization.name} cannot be deleted yet`
                    : deletionEntry.review?.readiness.status === "ready"
                      ? "Deletion checks are clear"
                      : "Deletion verification required"}
                </h2>
                <p className="sa-deletion-entry-org-name">{deletionEntry.organization.name}</p>
                <p>
                  {deletionEntry.loading
                    ? "Checking known organization records…"
                    : "Review what is connected before considering permanent deletion. Kandid preserves historical election and membership records."}
                </p>
              </div>
              <button type="button" className="sa-deletion-entry-close" onClick={() => setDeletionEntry(null)} aria-label="Cancel deletion review">
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            {deletionEntry.loading ? (
              <p className="sa-deletion-entry-status" role="status">Preparing an advisory dependency summary.</p>
            ) : (() => {
                const blockedDependencies = ["blocked", "verification_required"].includes(deletionEntry.review.readiness.status)
                ? normalizeTrustedOrganizationDependencies(deletionEntry.review.readiness.data?.dependencies || [])
                : null;
              const summary = getOrganizationDeletionAdvisorySummary(
                blockedDependencies || deletionEntry.review.advisory,
              );
              const positiveCategories = summary.visible.filter((category) => category.status === "verified" && category.count > 0);
              return (
                <>
                  <div className="sa-deletion-entry-summary">
                    <p className="is-current-term">
                      <strong>{deletionEntry.review.currentTermMembers?.count ?? "—"}</strong>
                      <span>{deletionEntry.review.currentTermMembers ? "Current-term members" : "Current-term members · not verified"}</span>
                    </p>
                    {positiveCategories.length > 0 ? positiveCategories.map((category) => (
                      <p key={category.key}><strong>{category.count}</strong><span>{category.label}</span></p>
                    )) : (
                      <p><strong>—</strong><span>Connected records · not verified</span></p>
                    )}
                  </div>
                  <p className="sa-deletion-entry-status">
                    {summary.unverifiedCount > 0
                      ? "DELETION VERIFICATION REQUIRED — Kandid cannot yet verify every record required for safe permanent deletion. Known connected records are shown below; unavailable information is never assumed to be zero."
                      : deletionEntry.review.readiness.status === "unavailable"
                        ? "DELETION VERIFICATION REQUIRED — Permanent deletion remains unavailable until Kandid can verify every required record. These known counts do not establish readiness."
                        : deletionEntry.review.readiness.status === "error"
                          ? "DELETION VERIFICATION REQUIRED — Kandid could not verify every requirement. Known connected records are shown below; unavailable information remains unknown."
                          : deletionEntry.review.readiness.status === "blocked"
                            ? "Trusted verification found records that must be reviewed or preserved. Managing the records shown here alone does not guarantee that deletion will become available."
                            : "Trusted checks are clear for now. Permanent deletion still requires a final atomic readiness check."}
                  </p>
                </>
              );
            })()}

            <footer className="sa-deletion-entry-actions">
              <button type="button" className="sa-deletion-entry-cancel" onClick={() => setDeletionEntry(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="sa-deletion-entry-review"
                disabled={deletionEntry.loading || !deletionEntry.review}
                onClick={() => {
                  setDeletionReview(deletionEntry.review);
                  setDeletionEntry(null);
                }}
              >
                Open deletion review <ArrowRight size={15} aria-hidden="true" />
              </button>
            </footer>
          </section>
        </PopupOverlay>
      )}

      {/* ORGANIZATION MEMBER RECORD */}
      {selectedOrg && (
        <PopupOverlay>
          <section
            className="popup-sheet popup-sheet-wide sa-org-member-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sa-org-member-title"
          >
            <header className="sa-org-member-header">
              <div className="sa-org-member-heading">
                <p className="sa-org-member-eyebrow">Organization member record</p>
                <div className="sa-org-member-identity">
                  {selectedOrg.logo_url ? (
                    <img className="sa-org-member-logo" src={selectedOrg.logo_url} alt={selectedOrg.name + " logo"} />
                  ) : (
                    <span className="sa-org-member-logo-fallback" aria-hidden="true">
                      {(selectedOrg.name || "O").slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <div className="sa-org-member-title-copy">
                    <h2 id="sa-org-member-title">{selectedOrg.name}</h2>
                    {selectedOrg.description && <p className="sa-org-member-description">{selectedOrg.description}</p>}
                    <p className="sa-org-member-org-meta">
                      <span>{getOrganizationTypeLabel(selectedOrg)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Added {selectedOrg.created_at
                          ? new Date(selectedOrg.created_at).toLocaleDateString()
                          : "date unavailable"}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={closeOrganizationDetails}
                className="sa-org-member-close"
                type="button"
                aria-label={deletionReview ? "Return to deletion review" : "Close organization details"}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <div className="sa-org-member-body">
              <dl className="sa-org-member-metadata" aria-label="Organization record details">
                <div>
                  <dt>01 / Organization</dt>
                  <dd>{selectedOrg.name}</dd>
                </div>
                <div>
                  <dt>02 / Classification</dt>
                  <dd>{getOrganizationTypeLabel(selectedOrg)} · {getOrganizationMembershipScopeLabel(selectedOrg)}</dd>
                </div>
                <div>
                  <dt>03 / Current term</dt>
                  <dd>
                    {organizationMemberStatus === "loading"
                      ? "Verifying term…"
                      : organizationMemberStatus === "ready"
                        ? formatOrganizationAcademicTerm(organizationMemberTerm)
                        : "Not verified"}
                  </dd>
                </div>
              </dl>

              <section className="sa-org-member-section" aria-labelledby="sa-org-current-members-title">
                <div className="sa-org-member-section-heading">
                  <div>
                    <p className="sa-org-member-eyebrow">Current-term members</p>
                    <h3 id="sa-org-current-members-title">Member registry</h3>
                    <p className="sa-org-member-section-copy">
                      Students with active organization participation and enrolled status for{" "}
                      {organizationMemberTerm?.semester && organizationMemberTerm?.academic_year
                        ? formatOrganizationAcademicTerm(organizationMemberTerm)
                        : "the current academic term"}.
                    </p>
                  </div>
                  <div className="sa-org-member-count" aria-live="polite">
                    {organizationMemberStatus === "loading" ? (
                      <span>Verifying membership…</span>
                    ) : organizationMemberStatus === "unavailable" ? (
                      <span>Unavailable</span>
                    ) : organizationMemberStatus === "ready" ? (
                      <>
                        <strong>{organizationMemberCount ?? 0}</strong>
                        <span>Active</span>
                      </>
                    ) : (
                      <span>Verifying membership…</span>
                    )}
                  </div>
                </div>

                {organizationMemberStatus === "loading" ? (
                  <div className="sa-org-member-state" role="status">Verifying current-term member records…</div>
                ) : organizationMemberStatus === "unavailable" ? (
                  <div className="sa-org-member-state is-unavailable" role="status">
                    <strong>Membership record unavailable</strong>
                    <span>The current-term member record could not be verified.</span>
                  </div>
                ) : organizationMemberStatus !== "ready" ? (
                  <div className="sa-org-member-state" role="status">Verifying current-term member records…</div>
                ) : organizationMemberCount === 0 ? (
                  <div className="sa-org-member-state">
                    <strong>No active members are recorded for this organization in the current academic term.</strong>
                  </div>
                ) : (
                  <div className="sa-org-member-registry" role="table" aria-label={selectedOrg.name + " current-term members"}>
                    <div className="sa-org-member-registry-head" role="row">
                      {[
                        ["Student", "student"],
                        ["Academic", "academic"],
                        ["Account", "account"],
                        ["Membership", "membership"],
                      ].map(([label, column]) => (
                        <span key={column} role="columnheader" className={"is-" + column}>{label}</span>
                      ))}
                    </div>
                    {organizationStudents.map((student, index) => {
                      const name = [student.first_name, student.last_name].filter(Boolean).join(" ") || "Unnamed Student";
                      const accountLabel = getAccountStatusLabel(student.status);
                      return (
                        <article className={"sa-org-member-row" + (accountLabel === "Active" ? " has-active-account" : "")} role="row" key={student.id}>
                          <div className="sa-org-member-student" role="cell" data-label="Student">
                            <span className="sa-org-member-sequence" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                            <StudentAvatar student={student} loading="lazy" className="!h-9 !w-9 !rounded-full" />
                            <div className="sa-org-member-student-copy">
                              <strong>{name}</strong>
                              {student.email && <span className="sa-org-member-email">{student.email}</span>}
                            </div>
                          </div>
                          <div className="sa-org-member-cell is-academic" role="cell" data-label="Academic">
                            <strong>{student.student_number || student.id || "Unavailable"}</strong>
                            {(student.current_term_program || student.current_term_year_level) && <span className="sa-org-member-mobile-separator" aria-hidden="true">·</span>}
                            <span>{student.current_term_program && student.current_term_year_level ? <>{student.current_term_program} &middot; Year {student.current_term_year_level}</> : student.current_term_program || (student.current_term_year_level ? "Year " + student.current_term_year_level : "Academic details unavailable")}</span>
                          </div>
                          <div className="sa-org-member-cell is-account" role="cell" data-label="Account">
                            <span className={"sa-org-member-status is-" + (student.status || "pending")}>{accountLabel}</span>
                          </div>
                          <div className="sa-org-member-cell is-membership" role="cell" data-label="Membership">
                            <span className="sa-org-member-status is-current">Active</span>
                            <button
                              type="button"
                              className="sa-org-member-action is-danger"
                              onClick={() => handleRemoveMembership(student)}
                              aria-label={"Remove current-term membership for " + name + " from " + selectedOrg.name}
                            >
                              <span className="sa-org-member-remove-desktop">Remove membership</span>
                              <span className="sa-org-member-remove-mobile">
                                Remove <ArrowRight size={13} aria-hidden="true" />
                              </span>
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            <footer className="sa-org-member-footer">
              <button type="button" onClick={closeOrganizationDetails} className="sa-org-member-footer-close">
                {deletionReview ? "Return to deletion review" : "Close"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const orgToEdit = selectedOrg;
                  closeOrganizationDetails();
                  openEditForm(orgToEdit);
                }}
                className="sa-org-member-edit"
              >
                <Pencil size={15} aria-hidden="true" />
                Edit Organization
              </button>
            </footer>
          </section>
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

            <form onSubmit={handleOrganizationFormSubmit} className={`sa-organizations-form ${editingOrg ? "is-editing" : "is-creating"}`}>
              <div className="sa-organizations-form-content">
              {!editingOrg && (
                <ol className="sa-organizations-progress" aria-label="Organization creation progress">
                  {["Organization", "Coverage", "Review"].map((label, index) => (
                    <li
                      key={label}
                      className={creationStep === index + 1 ? "is-current" : creationStep > index + 1 ? "is-complete" : ""}
                      aria-current={creationStep === index + 1 ? "step" : undefined}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{label}</strong>
                    </li>
                  ))}
                </ol>
              )}

              {(editingOrg || creationStep === 1) && (
                <section className={`sa-organizations-form-section ${editingOrg ? "is-editing" : ""}`} aria-labelledby="organization-identity-heading">
                  <div className="sa-organizations-step-focus">
                    <p className="sa-organizations-form-kicker">01 / Organization</p>
                    <h3 id="organization-identity-heading">{editingOrg ? "Organization identity" : "Which organization is this?"}</h3>
                    <p>{editingOrg ? "Update the organization's official identity and visual record." : "Establish the official identity and classification used across Kandid."}</p>
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
                          onChange={(e) => {
                            setStepError("");
                            setForm({ ...form, name: e.target.value });
                          }}
                          required
                          autoComplete="organization"
                          placeholder="Enter organization name"
                        />
                        <small>Used to identify the organization across Kandid.</small>
                      </div>

                      <div className="sa-organizations-form-field">
                        <label htmlFor="organization-description">Full organization name / description</label>
                        <textarea
                          id="organization-description"
                          value={form.description}
                          onChange={(e) => setForm({ ...form, description: e.target.value })}
                          placeholder="Enter the organization's full name or a short description"
                          rows="4"
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
                          <small>{editingOrg ? "Choose a new image only if you want to replace the current logo." : "Select an image from this device."}</small>
                        </div>
                      </div>

                      <div className="sa-organizations-form-field sa-organizations-logo-url">
                        <label htmlFor="organization-logo-url">Or use an image URL</label>
                        <input
                          id="organization-logo-url"
                          value={form.logo_url}
                          onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
                          inputMode="url"
                          placeholder="Paste logo image URL"
                        />
                      </div>
                    </div>
                  </div>

                  {!editingOrg && (
                    <fieldset className="sa-organizations-type-fieldset" aria-labelledby="organization-type-legend">
                      <legend id="organization-type-legend">Organization Type <span aria-hidden="true">*</span></legend>
                      <div className="sa-organizations-type-options">
                        <label className={form.organization_type === "departmental" ? "is-selected" : ""}>
                          <input
                            type="radio"
                            name="organization_type"
                            value="departmental"
                            checked={form.organization_type === "departmental"}
                            required
                            onChange={(e) => { setStepError(""); setForm({ ...form, organization_type: e.target.value }); }}
                          />
                          <span><strong>Departmental</strong><small>Program-linked organization.</small></span>
                        </label>
                        <label className={form.organization_type === "non_departmental" ? "is-selected" : ""}>
                          <input
                            type="radio"
                            name="organization_type"
                            value="non_departmental"
                            checked={form.organization_type === "non_departmental"}
                            required
                            onChange={(e) => { setStepError(""); setForm({ ...form, organization_type: e.target.value }); }}
                          />
                          <span><strong>Non-departmental</strong><small>Organization open across programs.</small></span>
                        </label>
                      </div>
                    </fieldset>
                  )}
                </section>
              )}

              {(editingOrg || creationStep === 2) && (
                <section className={`sa-organizations-form-section ${editingOrg ? "is-editing" : ""}`} aria-labelledby="organization-coverage-heading">
                  <div className="sa-organizations-step-focus">
                    <p className="sa-organizations-form-kicker">{editingOrg ? "02 / Classification & membership" : "02 / Membership"}</p>
                    <h3 id="organization-coverage-heading">{editingOrg ? "Classification & membership scope" : "Who does this organization represent?"}</h3>
                    <p>{formMembershipScope === "institution"
                      ? "Membership eligibility is institution-wide and does not use program coverage."
                      : formMembershipScope === "program"
                        ? "Select the programs represented by this organization."
                        : formMembershipScope === "manual"
                          ? "Membership is managed manually and does not use program coverage."
                          : "Membership scope could not be verified."}</p>
                  </div>

                  {editingOrg && (
                    <fieldset className="sa-organizations-type-fieldset" aria-labelledby="organization-type-legend">
                      <legend id="organization-type-legend">Organization Type <span aria-hidden="true">*</span></legend>
                      <div className="sa-organizations-type-options">
                        <label className={form.organization_type === "departmental" ? "is-selected" : ""}>
                          <input type="radio" name="organization_type" value="departmental" checked={form.organization_type === "departmental"}
                            required
                            onChange={(e) => setForm({ ...form, organization_type: e.target.value })} />
                          <span><strong>Departmental</strong><small>Organization tied to a department or program.</small></span>
                        </label>
                        <label className={form.organization_type === "non_departmental" ? "is-selected" : ""}>
                          <input type="radio" name="organization_type" value="non_departmental" checked={form.organization_type === "non_departmental"}
                            required
                            onChange={(e) => setForm({ ...form, organization_type: e.target.value })} />
                          <span><strong>Non-departmental</strong><small>Organization open across departments.</small></span>
                        </label>
                      </div>
                    </fieldset>
                  )}

                  {formMembershipScope === "program" ? (
                    <div className="sa-organizations-coverage">
                      <div className="sa-organizations-coverage-heading">
                        <div>
                          <h4>Covered Programs *</h4>
                          <p>Select every program represented by this organization.</p>
                        </div>
                        <span>{selectedProgramIds.length} selected</span>
                      </div>

                      <div className="sa-organizations-program-entry">
                        <label htmlFor="organization-new-program">Add program code</label>
                        <div>
                          <input id="organization-new-program" value={newProgram}
                            onChange={(event) => setNewProgram(event.target.value)} placeholder="Program code" />
                          <button type="button" onClick={handleAddProgram} disabled={!newProgram.trim()}>
                            <Plus size={15} aria-hidden="true" /> Add Program
                          </button>
                        </div>
                      </div>

                      <div className="sa-organizations-program-list">
                        {programs.length === 0 ? (
                          <p className="sa-organizations-program-empty">
                            No programs are available yet. Add a program before saving this program-scoped organization.
                          </p>
                        ) : (
                          programs.map((program) => {
                            const checked = selectedProgramIds.includes(String(program.id));
                            return (
                              <label key={program.id} className={checked ? "is-selected" : ""}>
                                <input
                                  type="checkbox"
                                  name="organization_program"
                                  checked={checked}
                                  onChange={() => toggleProgram(program.id)}
                                  aria-label={program.code || program.name}
                                />
                                <span>{program.code || program.name}</span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : formMembershipScope === "institution" ? (
                    <div className="sa-organizations-coverage-note">
                      <strong>Institution-wide eligibility</strong>
                      <p>Program coverage does not apply to this organization.</p>
                    </div>
                  ) : formMembershipScope === "manual" ? (
                    <div className="sa-organizations-coverage-note">
                      <strong>Manual membership</strong>
                      <p>Membership is managed directly; program coverage does not apply.</p>
                    </div>
                  ) : null}
                </section>
              )}

              {!editingOrg && creationStep === 3 && (
                <section className="sa-organizations-review-step" aria-labelledby="organization-review-heading">
                  <div className="sa-organizations-step-focus">
                    <p className="sa-organizations-form-kicker">03 / Review</p>
                    <h3 id="organization-review-heading">Ready to add this organization?</h3>
                    <p>Review the organization details before creating its record.</p>
                  </div>

                  <div className="sa-organizations-review">
                    <div className="sa-organizations-review-identity">
                      {form.logo_url ? <img src={form.logo_url} alt="" /> : <Building2 size={24} aria-hidden="true" />}
                      <div><span>Organization</span><strong>{form.name || "Name not entered"}</strong>
                        <p>{form.description || "No full name or description provided."}</p></div>
                    </div>
                    <div className="sa-organizations-review-detail">
                      <span>Classification</span>
                      <strong>{getOrganizationTypeLabel({ organization_type: form.organization_type })}</strong>
                    </div>
                    <div className="sa-organizations-review-detail">
                      <span>Coverage</span>
                      {formMembershipScope === "program" ? (
                        selectedProgramIds.length ? (
                          <ul>{programs.filter((program) => selectedProgramIds.includes(String(program.id))).map((program) => (
                            <li key={program.id}>{program.code || program.name}</li>
                          ))}</ul>
                        ) : <strong>No programs selected</strong>
                      ) : <strong>{organizationMembershipScopeLabel(formMembershipScope)}</strong>}
                    </div>
                  </div>
                </section>
              )}

              {stepError ? <p className="sa-organizations-step-error" role="alert">{stepError}</p> : null}
              </div>

              <footer className="sa-organizations-form-actions">
                <div className="sa-organizations-form-secondary-actions">
                  {!editingOrg && creationStep > 1 && creationStep < 3 && (
                    <button type="button" onClick={() => { setStepError(""); setCreationStep((step) => step - 1); }}
                      className="sa-organizations-form-cancel">Previous step</button>
                  )}
                  <button type="button" onClick={() => setFormOpen(false)} className="sa-organizations-form-cancel">Cancel</button>
                  {!editingOrg && creationStep === 3 && (
                    <button type="button" onClick={() => { setStepError(""); setCreationStep(2); }}
                      className="sa-organizations-form-cancel">Previous step</button>
                  )}
                </div>

                <button
                  disabled={loading}
                  className="sa-organizations-form-submit"
                  type="submit"
                  data-progressive-next={!editingOrg && creationStep < 3 ? "true" : undefined}
                >
                  <span>
                    {loading ? "Saving..." : editingOrg ? "Save Changes" : creationStep === 1 ? "Continue" : creationStep === 2 ? "Review organization" : "Add organization"}
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
