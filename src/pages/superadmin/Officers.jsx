import { useCallback, useEffect, useRef, useState } from "react";
import "./RemainingPages.css";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import StudentSearchPicker from "../../components/StudentSearchPicker";
import OrganizationSelect from "../../components/OrganizationSelect";
import IncomingAppointmentDialog from "../board/IncomingAppointmentDialog";
import OfficerDestinationDialog from "../board/OfficerDestinationDialog";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../../utils/deleteGuards";
import { fetchEligibleStudentsForOrganization } from "../../utils/organizationAccess";
import { formatOfficerPositionTitle, formatOfficerServiceDate, formatOfficerServicePeriod, formatOfficerTermLabel, sortOfficerRoster } from "../../utils/officerLeadership";
import SuperAdminPageHeader from "../../components/SuperAdminPageHeader";
import { officersContract } from "../../utils/officersContract";

const emptyForm = {
  organization_id: "",
  student_id: "",
  officer_name: "",
  position_title: "",
  term_label: "",
  term_start: "",
  term_end: "",
  photo_url: "",
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
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [incoming, setIncoming] = useState(null);
  const [incomingOrganizationId, setIncomingOrganizationId] = useState("");
  const [incomingError, setIncomingError] = useState("");
  const [incomingLoading, setIncomingLoading] = useState(false);
  const [incomingStudents, setIncomingStudents] = useState([]);
  const [studentsOrganizationId, setStudentsOrganizationId] = useState("");
  const [studentsLoaded, setStudentsLoaded] = useState(false);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState("");
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [currentAddOpen, setCurrentAddOpen] = useState(false);
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [editingNewOfficer, setEditingNewOfficer] = useState(null);
  const [incomingBusy, setIncomingBusy] = useState(false);
  const selectedOrganizationRef = useRef("");
  const studentsRequestRef = useRef(null);

  useEffect(() => {
    fetchOrganizations();
    fetchOfficers();
    // This is the mount-time directory load; writes refresh the list explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedOrganizationId) return undefined;
    let active = true;
    const organizationKey = String(selectedOrganizationId);
    officersContract("incoming_leadership", { organization_id: Number(selectedOrganizationId) })
      .then((data) => {
        if (!active) return;
        setIncoming(data);
        setIncomingOrganizationId(organizationKey);
        setIncomingError("");
      })
      .catch((error) => {
        if (!active) return;
        setIncoming(null);
        setIncomingError(error.message || "The prepared officer roster could not be loaded.");
      })
      .finally(() => { if (active) setIncomingLoading(false); });
    return () => { active = false; };
  }, [selectedOrganizationId]);

  async function fetchOrganizations() {
    const { data } = await supabase
      .from("organizations")
      .select("id, name, logo_url")
      .order("name", { ascending: true });

    setOrganizations(data || []);
  }

  const loadEligibleStudents = useCallback(async ({ retry = false } = {}) => {
    const organizationId = selectedOrganizationId;
    const organizationKey = String(organizationId || "");
    if (!organizationKey) {
      setStudentsError("Select an organization before loading eligible students.");
      setStudentsLoaded(true);
      return;
    }
    if (studentsOrganizationId === organizationKey && studentsLoaded && !retry) return;
    if (studentsRequestRef.current?.organizationId === organizationKey) return studentsRequestRef.current.promise;

    setStudentsOrganizationId(organizationKey);
    setStudentsLoading(true);
    setStudentsLoaded(false);
    setStudentsError("");
    const request = fetchEligibleStudentsForOrganization(organizationKey);
    studentsRequestRef.current = { organizationId: organizationKey, promise: request };
    try {
      const data = await request;
      if (selectedOrganizationRef.current === organizationKey) {
        setIncomingStudents(data || []);
        setStudentsLoaded(true);
      }
    } catch (error) {
      console.error("Failed to load eligible officer students:", error);
      if (selectedOrganizationRef.current === organizationKey) {
        setIncomingStudents([]);
        setStudentsLoaded(true);
        setStudentsError("Eligible students could not be loaded. Try again.");
      }
    } finally {
      if (studentsRequestRef.current?.promise === request) studentsRequestRef.current = null;
      if (selectedOrganizationRef.current === organizationKey) setStudentsLoading(false);
    }
  }, [selectedOrganizationId, studentsLoaded, studentsOrganizationId]);

  async function fetchStudentsForOrganization(organizationId) {
    if (!organizationId) {
      setStudents([]);
      return;
    }
    try {
      setStudents(await fetchEligibleStudentsForOrganization(organizationId));
    } catch (error) {
      console.error("Failed to load eligible officer students:", error);
      prompt.error("Eligible organization students could not be loaded.");
      setStudents([]);
    }
  }

  async function fetchOfficers() {
    try {
      setOfficers((await officersContract("list")) || []);
    } catch (error) {
      console.error("Failed to load officer records:", error);
      prompt.error(error.message);
    }
  }

  async function openEditForm(officer) {
    setEditingOfficer(officer);
    if (String(officer.organization_id) !== String(selectedOrganizationId)) {
      selectedOrganizationRef.current = String(officer.organization_id || "");
      setIncomingLoading(Boolean(officer.organization_id));
      setIncoming(null);
      setIncomingError("");
      setIncomingOrganizationId("");
      setSelectedOrganizationId(String(officer.organization_id || ""));
    }
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
    if (!editingOfficer) return;

    const service = {
      term_end: form.term_end || null,
      photo_url: form.photo_url || null,
    };
    let savedOfficer;
    try {
      const changes = { ...service };
      if (editingOfficer.selection_type !== "elected") {
        changes.organization_id = Number(form.organization_id);
        if (form.student_id) changes.student_id = Number(form.student_id);
        if (editingOfficer.selection_type === "appointed") changes.position_title = form.position_title;
        else {
          changes.position_title = form.position_title;
          changes.officer_name = form.officer_name || null;
        }
      }
      savedOfficer = await officersContract("update_service", { officer_id: editingOfficer.id, changes });
    } catch (error) {
      console.error("Officer save failed:", error);
      prompt.error(error.message || "Officer record could not be saved.");
      return;
    }

    prompt.success("Officer updated.");
    await logAuditEvent({
      action: "officer_updated",
      entityType: "officer",
      entityId: savedOfficer?.id || editingOfficer?.id,
      entityLabel: savedOfficer?.position_title || form.position_title || "Officer",
      organizationId: savedOfficer?.organization_id || form.organization_id,
      organizationName: organizations.find((org) => String(org.id) === String(savedOfficer?.organization_id || form.organization_id))?.name,
      status: "completed",
      metadata: { selection_type: savedOfficer?.selection_type || editingOfficer?.selection_type || "appointed" },
    });
    setFormOpen(false);
    fetchOfficers();
  }

  async function refreshIncoming() {
    if (!selectedOrganizationId) return;
    const organizationKey = String(selectedOrganizationId);
    setIncomingLoading(true);
    try {
      const [leadership, records] = await Promise.all([
        officersContract("incoming_leadership", { organization_id: Number(selectedOrganizationId) }),
        officersContract("list"),
      ]);
      if (selectedOrganizationRef.current !== organizationKey) return;
      setIncoming(leadership);
      setIncomingOrganizationId(organizationKey);
      setIncomingError("");
      setOfficers(records || []);
    } catch (error) {
      prompt.error(error.message || "Leadership could not be refreshed.");
    } finally {
      if (selectedOrganizationRef.current === organizationKey) setIncomingLoading(false);
    }
  }

  const selectedOfficers = selectedOrganizationId
    ? officers.filter((officer) => String(officer.organization_id) === String(selectedOrganizationId))
    : [];
  const currentOfficers = sortOfficerRoster(selectedOfficers.filter((officer) => officer.is_current));
  const previousOfficers = sortOfficerRoster(selectedOfficers.filter((officer) => !officer.is_current));
  const selectedIncoming = incomingOrganizationId === String(selectedOrganizationId) ? incoming : null;
  const newOfficers = sortOfficerRoster(selectedIncoming?.new_officers || []);

  function selectAddDestination(target) {
    setDestinationOpen(false);
    setEditingNewOfficer(null);
    if (target === "current") setCurrentAddOpen(true);
    else setAppointmentOpen(true);
  }

  async function addCurrentOfficer({ selection_type, student_id, candidate_id, position_title, service, confirm_term_context }) {
    setIncomingBusy(true);
    try {
      const result = await officersContract("add_current_officer", {
        organization_id: Number(selectedOrganizationId),
        selection_type,
        student_id: student_id ? Number(student_id) : null,
        candidate_id: candidate_id ? Number(candidate_id) : null,
        position_title: position_title || "",
        service,
        confirm_term_context,
      });
      await logAuditEvent({
        action: "officer_current_added",
        entityType: "officer",
        entityId: result?.id,
        entityLabel: result?.position_title || position_title || "Officer",
        organizationId: selectedOrganizationId,
        organizationName: organizations.find((org) => String(org.id) === String(selectedOrganizationId))?.name,
        status: "completed",
        metadata: { selection_type },
      });
      prompt.success("Officer added to Current Leadership.");
      setCurrentAddOpen(false);
      await refreshIncoming();
    } catch (error) {
      prompt.error(error.message || "Officer could not be added to Current Leadership.");
    } finally {
      setIncomingBusy(false);
    }
  }

  async function addIncomingAppointment(appointment) {
    setIncomingBusy(true);
    try {
      const result = await officersContract("add_incoming_appointed", {
        organization_id: Number(selectedOrganizationId),
        student_id: Number(appointment.student_id),
        position_title: appointment.position_title,
        service: appointment.service,
      });
      await logAuditEvent({
        action: "officer_new_appointed_added",
        entityType: "officer_new_roster",
        entityId: result?.id,
        entityLabel: appointment.position_title,
        organizationId: selectedOrganizationId,
        organizationName: organizations.find((org) => String(org.id) === String(selectedOrganizationId))?.name,
        status: "completed",
      });
      prompt.success("Appointed officer added to New Officers.");
      setAppointmentOpen(false);
      await refreshIncoming();
    } catch (error) {
      prompt.error(error.message || "Incoming appointment could not be added.");
    } finally {
      setIncomingBusy(false);
    }
  }

  async function addIncomingElected(candidateId, service = {}) {
    setIncomingBusy(true);
    try {
      const result = await officersContract("add_incoming_elected", {
        organization_id: Number(selectedOrganizationId),
        candidate_id: Number(candidateId),
        service,
      });
      await logAuditEvent({
        action: "officer_new_elected_added",
        entityType: "officer_new_roster",
        entityId: result?.id,
        entityLabel: "Verified elected winner",
        organizationId: selectedOrganizationId,
        organizationName: organizations.find((org) => String(org.id) === String(selectedOrganizationId))?.name,
        status: "completed",
      });
      prompt.success("Winner added to New Officers.");
      setAppointmentOpen(false);
      await refreshIncoming();
    } catch (error) {
      prompt.error(error.message || "Winner could not be added to New Officers.");
    } finally {
      setIncomingBusy(false);
    }
  }

  async function updateNewOfficer(officer, changes) {
    setIncomingBusy(true);
    try {
      await officersContract("update_new_officer", {
        new_officer_id: Number(officer.id),
        organization_id: Number(selectedOrganizationId),
        changes,
      });
      prompt.success("New officer updated.");
      setAppointmentOpen(false);
      setEditingNewOfficer(null);
      await refreshIncoming();
    } catch (error) {
      prompt.error(error.message || "New officer could not be updated.");
    } finally {
      setIncomingBusy(false);
    }
  }

  async function releaseIncomingLeadership() {
    const organizationName = organizations.find((org) => String(org.id) === String(selectedOrganizationId))?.name || "this organization";
    const term = incoming?.source_election?.election_title || "the published election";
    const confirmed = await prompt.confirm({
      title: `Release the new ${organizationName} officers?`,
      message: `The current officers will move to Past Leadership. The officers manually prepared from ${term} will become the current leadership.`,
      type: "warning",
      confirmText: "Release leadership",
    });
    if (!confirmed) return;

    setIncomingBusy(true);
    try {
      const result = await officersContract("release_leadership", { organization_id: Number(selectedOrganizationId) });
      await logAuditEvent({
        action: "officer_leadership_released",
        entityType: "officer_leadership",
        entityId: result?.election_id,
        entityLabel: term,
        organizationId: selectedOrganizationId,
        organizationName,
        status: "completed",
        metadata: { elected_count: result?.elected_count || 0, appointed_count: result?.appointed_count || 0 },
      });
      prompt.success("New leadership released.");
      await refreshIncoming();
    } catch (error) {
      prompt.error(error.message || "Leadership could not be released. No changes were applied.");
    } finally {
      setIncomingBusy(false);
    }
  }

  async function removeNewOfficer(appointment) {
    const ok = await prompt.confirm({
      title: "Remove from New Officers?",
      message: `${appointment.student_name || "This officer"} will be removed from the prepared roster.`,
      type: "warning",
      confirmText: "Remove officer",
    });
    if (!ok) return;
    try {
      await officersContract("remove_new_officer", {
        new_officer_id: Number(appointment.id),
        organization_id: Number(selectedOrganizationId),
      });
      await refreshIncoming();
    } catch (error) {
      prompt.error(error.message || "New officer could not be removed.");
    }
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

    try {
      await officersContract("delete", { officer_id: id });
    } catch (error) {
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
    <div className="sa-remaining-page sa-officers">
      <SuperAdminPageHeader section="Election operations" title="Officers" description="Review current and historical officers across organizations." />

      <div className="sa-officer-context">
        <div>
          <p className="field-label">Officer record</p>
          {selectedIncoming?.source_election ? <strong>Available winners · {selectedIncoming.source_election.election_title}</strong> : <span>{incomingLoading ? "Checking published results and the prepared roster…" : selectedOrganizationId ? "No published results; Appointed officers can still be prepared." : "Select an organization to manage its officer record."}</span>}
        </div>
        <OrganizationSelect
          organizations={organizations}
          value={selectedOrganizationId}
          onChange={(organizationId) => {
            selectedOrganizationRef.current = String(organizationId || "");
            setIncomingLoading(Boolean(organizationId));
            setIncoming(null);
            setIncomingError("");
            setIncomingOrganizationId("");
            setSelectedOrganizationId(organizationId);
            setIncoming(null);
            setIncomingError("");
            setIncomingLoading(Boolean(organizationId));
            setIncomingStudents([]);
            setStudentsOrganizationId("");
            setStudentsLoaded(false);
            setStudentsLoading(false);
            setStudentsError("");
            studentsRequestRef.current = null;
          }}
        />
        <button type="button" className="primary-btn" disabled={!selectedOrganizationId} onClick={() => setDestinationOpen(true)}>
          <Plus size={16} /> Add Officer
        </button>
      </div>
      {incomingError ? <p role="alert" className="sa-officer-incoming-error">{incomingError}</p> : null}
      {selectedOrganizationId && (selectedIncoming || incomingLoading) && (
        <section className="sa-officer-incoming" aria-label="New Officers">
          <div className="sa-officer-incoming-source">
            <div><span>New Officers{selectedIncoming?.source_election?.election_title ? ` · ${selectedIncoming.source_election.election_title}` : " · Appointed roster"}</span><strong>Preparing the next leadership record</strong>{selectedIncoming?.leadership_academic_year && <small>Leadership year · {formatOfficerTermLabel({ leadership_academic_year: selectedIncoming.leadership_academic_year })}</small>}</div>
            <div className="sa-officer-incoming-actions">
              <button type="button" className="text-action" onClick={() => { setEditingNewOfficer(null); setAppointmentOpen(true); }}><Plus size={15} /> Add to New Officers</button>
              <button type="button" className="primary-btn" onClick={releaseIncomingLeadership} disabled={incomingBusy || newOfficers.length === 0}>
                {incomingBusy ? "Releasing…" : "Release new officers"}
              </button>
            </div>
          </div>
          {incomingLoading && !incoming ? <p className="sa-officer-incoming-empty" role="status">Loading the New Officers roster…</p> : newOfficers.length === 0 ? <p className="sa-officer-incoming-empty">No New Officers prepared yet. Add a verified winner or an eligible appointed student to begin.</p> : <div className="sa-officer-incoming-register">
            <div className="sa-officer-incoming-register-head"><span>Office</span><span>Student</span><span>Route</span></div>
            {newOfficers.map((person, index) => (
              <div className="sa-officer-incoming-register-row" key={person.id}>
                <span className="sa-officer-incoming-index">{String(index + 1).padStart(2, "0")}</span>
                <strong>{formatOfficerPositionTitle(person.position_title)}</strong>
                <span>{person.student_name || "Student"}{person.student_number ? <small>Student No. {person.student_number}</small> : null}</span>
                <span>{person.selection_type === "elected" ? "Elected" : "Appointed"}</span>
                <div className="sa-officer-incoming-row-actions">
                  <button type="button" className="text-action" onClick={() => { setEditingNewOfficer(person); setAppointmentOpen(true); }}>Edit</button>
                  <button type="button" className="text-action-danger" onClick={() => removeNewOfficer(person)}>Remove</button>
                </div>
              </div>
            ))}
          </div>}
        </section>
      )}
      {!selectedOrganizationId ? (
        <div className="empty-state mt-8">Select an organization to view and manage its current, New, and past officers.</div>
      ) : (
        <>
          {[{ label: "Current Leadership", records: currentOfficers }, { label: "Past Leadership", records: previousOfficers }].map(({ label, records }) => (
            <section className="sa-officer-history" key={label} aria-label={label}>
              <div className="sa-officer-history-head">
                <h2 className="surface-title">{label}</h2>
                {label === "Current Leadership" && <button type="button" className="text-action" onClick={() => setCurrentAddOpen(true)}><Plus size={15} /> Add to Current</button>}
              </div>
              {records.length === 0 ? <p className="empty-state">No {label.toLowerCase()} records for this organization.</p> : (
                <div className="entity-grid">
                  {records.map((officer) => (
                    <div key={officer.id} className="entity-card lift-card">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff7a35]">{organizations.find((org) => String(org.id) === String(selectedOrganizationId))?.name || "Organization"}</p>
                          <h3 className="entity-card-title mt-2">{officer.students ? `${officer.students.first_name} ${officer.students.last_name}` : officer.officer_name}</h3>
                        </div>
                        <span className={`status-pill ${officer.is_current ? "" : "!bg-white/60 !text-[#5a5548]"}`}>{officer.is_current ? "Current" : "Past"}</span>
                      </div>
                      <p className="entity-meta">{formatOfficerPositionTitle(officer.position_title)}</p>
                      {formatOfficerTermLabel(officer) && <p className="entity-meta">{formatOfficerTermLabel(officer)}</p>}
                      {!officer.is_current && formatOfficerServicePeriod(officer) && <p className="entity-meta">{formatOfficerServicePeriod(officer)}</p>}
                      <div className="entity-actions">
                        <button onClick={() => openEditForm(officer)} className="icon-action" aria-label={`Edit ${officer.position_title}`}><Pencil size={16} /></button>
                        <button onClick={() => handleDelete(officer)} className="icon-action icon-action-danger" aria-label={`Delete ${officer.position_title}`}><Trash2 size={16} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </>
      )}

      {formOpen && (
        <PopupOverlay>
          <div className="popup-sheet popup-sheet-wide sa-remaining-dialog">
            <div className="popup-header !mb-4">
              <div className="popup-header-copy">
                <p className="field-label !mb-3">Officer Directory</p>
                <h2 className="surface-title text-[1.7rem] font-black tracking-tight">
                  Edit officer
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
                {editingOfficer?.selection_type === "elected" ? (
                  <div>
                    <label className="field-label">Organization</label>
                    <div className="field-shell w-full">{editingOfficer.organizations?.name || "Election organization"}</div>
                  </div>
                ) : <OrganizationSelect
                  id="sa-officer-organization"
                  required={editingOfficer?.selection_type !== "elected"}
                  organizations={organizations}
                  value={form.organization_id}
                  onChange={(organizationId) => {
                    setForm({ ...form, organization_id: organizationId, student_id: "" });
                    fetchStudentsForOrganization(organizationId);
                  }}
                />}

                {editingOfficer?.selection_type !== "elected" && <div>
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
                </div>}

                {editingOfficer && editingOfficer.selection_type !== "elected" && editingOfficer.selection_type !== "appointed" && <div>
                  <label className="field-label">Fallback Name</label>
                  <input
                    value={form.officer_name}
                    onChange={(e) => setForm({ ...form, officer_name: e.target.value })}
                    placeholder="Officer name fallback"
                    className="field-shell w-full"
                  />
                </div>}

                <div>
                  <label className="field-label">Position Title</label>
                  {editingOfficer?.selection_type === "elected" ? <div className="field-shell w-full">{formatOfficerPositionTitle(editingOfficer.position_title)}</div> : <input
                    required
                    value={form.position_title}
                    onChange={(e) => setForm({ ...form, position_title: e.target.value })}
                    placeholder="Position title"
                    className="field-shell w-full"
                  />}
                </div>

                <div>
                  <label className="field-label">Leadership year</label>
                  <div className="field-shell w-full">{formatOfficerTermLabel(editingOfficer) || "Retained from the election or leadership record"}</div>
                  <small>{editingOfficer?.service_started_at
                    ? `Service began ${formatOfficerServiceDate(editingOfficer.service_started_at)}.`
                    : editingOfficer?.term_start
                      ? `Recorded service date: ${formatOfficerServiceDate(editingOfficer.term_start)}.`
                      : "Service time is recorded automatically when an officer becomes Current."}</small>
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
                  <label className="field-label">Term End Date</label>
                  <input
                    type="date"
                    value={form.term_end}
                    onChange={(e) => setForm({ ...form, term_end: e.target.value })}
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
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </PopupOverlay>
      )}
      {appointmentOpen && (
        <IncomingAppointmentDialog
          key={editingNewOfficer?.id || "add-officer"}
          incoming={selectedIncoming}
          incomingError={incomingError}
          incomingLoading={incomingLoading}
          target="new"
          students={incomingStudents}
          studentsLoaded={studentsLoaded && studentsOrganizationId === String(selectedOrganizationId)}
          studentsError={studentsError}
          studentsLoading={studentsLoading}
          onLoadEligibleStudents={loadEligibleStudents}
          onRetryIncoming={() => refreshIncoming()}
          busy={incomingBusy}
          editingOfficer={editingNewOfficer}
          onClose={() => { setAppointmentOpen(false); setEditingNewOfficer(null); }}
          onAddElected={addIncomingElected}
          onAddAppointed={addIncomingAppointment}
          onUpdate={updateNewOfficer}
        />
      )}
      {currentAddOpen && selectedOrganizationId && (
        <IncomingAppointmentDialog
          key={`add-current-${selectedOrganizationId}`}
          target="current"
          currentOfficers={currentOfficers}
          incoming={selectedIncoming}
          incomingError={incomingError}
          incomingLoading={incomingLoading}
          students={incomingStudents}
          studentsLoaded={studentsLoaded && studentsOrganizationId === String(selectedOrganizationId)}
          studentsError={studentsError}
          studentsLoading={studentsLoading}
          onLoadEligibleStudents={loadEligibleStudents}
          onRetryIncoming={() => refreshIncoming()}
          busy={incomingBusy}
          onClose={() => setCurrentAddOpen(false)}
          onAddCurrentAppointed={(appointment) => addCurrentOfficer({ ...appointment, selection_type: "appointed" })}
          onAddCurrentElected={(candidateId, service, confirmTermContext) => addCurrentOfficer({
            candidate_id: candidateId,
            service,
            confirm_term_context: confirmTermContext,
            selection_type: "elected",
          })}
        />
      )}
      {destinationOpen && <OfficerDestinationDialog onSelect={selectAddDestination} onClose={() => setDestinationOpen(false)} />}
    </div>
  );
}

export default Officers;
