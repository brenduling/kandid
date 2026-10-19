import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Ellipsis, Plus, Pencil, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { KandidButtonLoader } from "../../components/KandidLoader";
import "./Officers.css";
import OfficerFormDialog from "./OfficerFormDialog";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../../utils/deleteGuards";
import { fetchEligibleStudentsForOrganization } from "../../utils/organizationAccess";
import { formatOfficerPositionTitle, formatOfficerServiceDate, formatOfficerServicePeriod, formatOfficerTermLabel, sortOfficerRoster } from "../../utils/officerLeadership";
import { officersContract } from "../../utils/officersContract";

const emptyForm = {
  student_id: "",
  officer_name: "",
  position_title: "",
  term_label: "",
  term_start: "",
  term_end: "",
  photo_url: "",
  display_order: 0,
};

/* Officer tenure is academic-year based. Election semester context remains
   separate and is shown only in election-specific details. */
function formatOfficerTermForDisplay(officer) {
  return formatOfficerTermLabel(officer);
}

/* One compact row action menu, used only on mobile.

   On mobile every officer row showed a permanent Edit + Delete pair, which meant
   the roster repeated management controls far more often than it repeated
   officers. This collapses those controls into a single overflow button that
   reveals the same actions, with the same handlers and labels, behind one tap.

   It is a disclosure rather than an ARIA menu: the trigger carries aria-expanded
   and an accessible name of "Actions for <officer>", and the panel holds the two
   real buttons, so no keyboard behaviour is implied that is not implemented.
   Clicking outside or pressing Escape closes it. */
function OfficerRowMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="board-officer-menu" ref={ref}>
      <button
        type="button"
        className="board-officer-menu-trigger"
        aria-expanded={open}
        aria-label={`Actions for ${label}`}
        title={`Actions for ${label}`}
        onClick={() => setOpen((current) => !current)}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="board-officer-menu-list">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`board-officer-menu-item${item.danger ? " is-danger" : ""}`}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* Display-only: derive ONE leadership year for a whole register.

   The academic year describes the roster, not the person, so when every officer
   a section displays carries the same authoritative leadership_academic_year it
   belongs once in that section's context rather than repeated under each record.

   This is deliberately conservative and returns null — meaning "leave the
   per-record term exactly as it is" — whenever a shared year cannot be stated
   truthfully: no records, more than one distinct year, or any record whose year
   is unknown. It reads only leadership_academic_year, which the register has
   already loaded, and infers nothing. It is never applied to Past Leadership,
   which spans more than one roster. */
function sharedLeadershipAcademicYear(officers) {
  if (!Array.isArray(officers) || officers.length === 0) return null;
  const years = new Set();
  for (const officer of officers) {
    const year = String(officer?.leadership_academic_year || "").trim();
    if (!year) return null;
    years.add(year);
  }
  if (years.size !== 1) return null;
  return Array.from(years)[0];
}

function BoardOfficers() {
  const user = JSON.parse(localStorage.getItem("user"));
  const organizationId = Number(user?.organization_id);
  const orgId = Number.isInteger(organizationId) && organizationId > 0 ? organizationId : null;
  const orgName = user?.organization_name || user?.organizations?.name || "your organization";
  const prompt = usePrompt();
  const [officers, setOfficers] = useState([]);
  const [officersLoading, setOfficersLoading] = useState(Boolean(orgId));
  const [officersError, setOfficersError] = useState("");
  const [students, setStudents] = useState([]);
  const [studentQuery, setStudentQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [officerFormOpen, setOfficerFormOpen] = useState(false);
  const [officerFormTarget, setOfficerFormTarget] = useState(null);
  const [editingNewOfficer, setEditingNewOfficer] = useState(null);
  const [editingOfficer, setEditingOfficer] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [incoming, setIncoming] = useState(null);
  const [incomingError, setIncomingError] = useState(orgId ? "" : "Your organization context could not be verified.");
  const [incomingLoading, setIncomingLoading] = useState(Boolean(orgId));
  const [studentsError, setStudentsError] = useState("");
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsLoaded, setStudentsLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const initialRequestsRef = useRef({ organizationId: null, officers: null, incoming: null });
  const studentsRequestRef = useRef(null);
  const studentsLoadedRef = useRef(false);

  useEffect(() => {
    let active = true;
    if (!orgId) return () => { active = false; };

    const organizationKey = String(orgId);
    if (initialRequestsRef.current.organizationId !== organizationKey) {
      initialRequestsRef.current = {
        organizationId: organizationKey,
        officers: officersContract("list"),
        incoming: officersContract("incoming_leadership", { organization_id: Number(orgId) }),
      };
    }

    initialRequestsRef.current.officers
      .then((data) => {
        if (active) {
          setOfficers(data || []);
          setOfficersError("");
        }
      })
      .catch((error) => {
        console.error("Failed to load officer records:", error);
        if (active) setOfficersError("Current and past officer records could not be loaded.");
      })
      .finally(() => {
        if (active) setOfficersLoading(false);
      });

    initialRequestsRef.current.incoming
      .then((data) => {
        if (!active) return;
        setIncoming(data);
        setIncomingError("");
      })
      .catch((error) => {
        console.error("Failed to load the prepared officer roster:", error);
        if (active) setIncomingError("Published election and prepared officer information could not be loaded.");
      })
      .finally(() => {
        if (active) setIncomingLoading(false);
      });

    return () => {
      active = false;
    };
  }, [orgId]);

  const loadEligibleStudents = useCallback(async ({ retry = false } = {}) => {
    if (!orgId) {
      setStudentsError("Your organization context could not be verified.");
      setStudentsLoaded(true);
      return;
    }
    if (studentsLoadedRef.current && !retry) return;
    if (studentsRequestRef.current) return studentsRequestRef.current;

    setStudentsLoading(true);
    setStudentsError("");
    const request = fetchEligibleStudentsForOrganization(orgId);
    studentsRequestRef.current = request;
    try {
      const studentData = await request;
      setStudents(studentData);
      setStudentsLoaded(true);
      studentsLoadedRef.current = true;
    } catch (error) {
      console.error("Failed to load eligible officer students:", error);
      setStudents([]);
      setStudentsLoaded(true);
      setStudentsError("Eligible students could not be loaded. Try again.");
    } finally {
      if (studentsRequestRef.current === request) studentsRequestRef.current = null;
      setStudentsLoading(false);
    }
  }, [orgId]);

  async function refreshLeadership() {
    if (!orgId) return;

    setOfficersLoading(true);
    setIncomingLoading(true);
    const [officerResult, incomingResult] = await Promise.allSettled([
        officersContract("list"),
        officersContract("incoming_leadership", { organization_id: Number(orgId) }),
    ]);
    if (officerResult.status === "fulfilled") {
      setOfficers(officerResult.value || []);
      setOfficersError("");
    } else {
      console.error("Failed to refresh officer records:", officerResult.reason);
      setOfficersError("Current and past officer records could not be refreshed.");
      prompt.error("Officer records could not be refreshed. The last loaded roster remains visible.");
    }
    if (incomingResult.status === "fulfilled") {
      setIncoming(incomingResult.value);
      setIncomingError("");
    } else {
      console.error("Failed to refresh leadership records:", incomingResult.reason);
      setIncomingError("Published election and prepared officer information could not be loaded.");
      prompt.error("Leadership information could not be refreshed. Try again shortly.");
    }
    setOfficersLoading(false);
    setIncomingLoading(false);
  }

  function openOfficerForm(target = null) {
    setEditingNewOfficer(null);
    setOfficerFormTarget(target);
    setOfficerFormOpen(true);
  }

  function openOfficerFormForEdit(officer) {
    setEditingNewOfficer(officer);
    setOfficerFormTarget("new");
    setOfficerFormOpen(true);
  }

  function closeOfficerForm() {
    setOfficerFormOpen(false);
    setEditingNewOfficer(null);
    setOfficerFormTarget(null);
  }

  async function addCurrentOfficer({ selection_type, student_id, candidate_id, position_title, service, confirm_term_context }) {
    setSubmitting(true);
    try {
      const result = await officersContract("add_current_officer", {
        organization_id: Number(orgId),
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
        organizationId: orgId,
        organizationName: orgName,
        status: "completed",
        metadata: { selection_type },
      });
      prompt.success("Officer added to Current Leadership.");
      setOfficerFormOpen(false);
      await refreshLeadership();
    } catch (error) {
      prompt.error(error.message || "Officer could not be added to Current Leadership.");
    } finally {
      setSubmitting(false);
    }
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
    if (!editingOfficer) return;
    setSubmitting(true);

    const service = {
      term_end: form.term_end || null,
      photo_url: form.photo_url || null,
    };
    try {
      if (editingOfficer) {
        const changes = { ...service };
        if (editingOfficer.selection_type === "appointed") {
          if (form.student_id) changes.student_id = Number(form.student_id);
          changes.position_title = form.position_title;
        } else if (editingOfficer.selection_type !== "elected") {
          if (form.student_id) changes.student_id = Number(form.student_id);
          changes.position_title = form.position_title;
          changes.officer_name = form.officer_name || null;
        }
        await officersContract("update_service", {
          officer_id: editingOfficer.id,
          changes,
        });
      }
    } catch (error) {
      prompt.error(error.message || "Officer record could not be saved.");
      setSubmitting(false);
      return;
    }

    prompt.success("Officer updated.");
    await logAuditEvent({
      action: "officer_updated",
      entityType: "officer",
      entityId: editingOfficer?.id,
      entityLabel: editingOfficer?.position_title || "Officer",
      organizationId: orgId,
      organizationName: orgName,
      status: "completed",
      metadata: { selection_type: editingOfficer?.selection_type || "legacy_unknown" },
    });
    setFormOpen(false);
    setSubmitting(false);
    refreshLeadership();
  }

  async function addIncomingElected(candidateId, service = {}) {
    setSubmitting(true);
    try {
      const result = await officersContract("add_incoming_elected", {
        organization_id: Number(orgId),
        candidate_id: Number(candidateId),
        service,
      });
      await logAuditEvent({
        action: "officer_new_elected_added",
        entityType: "officer_new_roster",
        entityId: result?.id,
        entityLabel: "Verified elected winner",
        organizationId: orgId,
        organizationName: orgName,
        status: "completed",
      });
      prompt.success("Winner added to New Officers.");
      setOfficerFormOpen(false);
      await refreshLeadership();
    } catch (error) {
      prompt.error(error.message || "Winner could not be added to New Officers.");
    } finally {
      setSubmitting(false);
    }
  }

  async function addIncomingAppointment(appointment) {
    setSubmitting(true);
    try {
      const result = await officersContract("add_incoming_appointed", {
        organization_id: Number(orgId),
        student_id: Number(appointment.student_id),
        position_title: appointment.position_title,
        service: appointment.service,
      });
      await logAuditEvent({
        action: "officer_incoming_appointment_added",
        entityType: "officer_new_roster",
        entityId: result?.id,
        entityLabel: appointment.position_title,
        organizationId: orgId,
        organizationName: orgName,
        status: "completed",
      });
      prompt.success("Appointed officer added to New Officers.");
      setOfficerFormOpen(false);
      await refreshLeadership();
    } catch (error) {
      prompt.error(error.message || "Appointed officer could not be added.");
    } finally {
      setSubmitting(false);
    }
  }

  async function updateNewOfficer(officer, changes) {
    setSubmitting(true);
    try {
      await officersContract("update_new_officer", {
        new_officer_id: Number(officer.id),
        organization_id: Number(orgId),
        changes,
      });
      prompt.success("New officer updated.");
      setOfficerFormOpen(false);
      await refreshLeadership();
    } catch (error) {
      prompt.error(error.message || "New officer could not be updated.");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeNewOfficer(officer) {
    const name = officer.student_name || "this student";
    const confirmed = await prompt.confirm({
      title: "Remove from New Officers?",
      message: `${name} will be removed from the prepared leadership roster.`,
      type: "warning",
      confirmText: "Remove officer",
    });
    if (!confirmed) return;
    try {
      await officersContract("remove_new_officer", {
        new_officer_id: Number(officer.id),
        organization_id: Number(orgId),
      });
      prompt.success("Officer removed from New Officers.");
      await refreshLeadership();
    } catch (error) {
      prompt.error(error.message || "New officer could not be removed.");
    }
  }

  async function releaseIncomingLeadership() {
    const termLabel = incoming?.source_election?.election_title;
    const confirmed = await prompt.confirm({
      title: `Release the new ${orgName} officers?`,
      message: termLabel
        ? `Current officers will move to Past Leadership. The prepared officers from ${termLabel} will become the current leadership.`
        : "Current officers will move to Past Leadership. The prepared appointed officers will become the current leadership.",
      type: "warning",
      confirmText: "Release leadership",
    });
    if (!confirmed) return;

    setReleasing(true);
    try {
      const result = await officersContract("release_leadership", { organization_id: Number(orgId) });
      prompt.success("New leadership released.");
      await logAuditEvent({
        action: "officer_leadership_released",
        entityType: "officer_leadership",
        entityId: result?.election_id,
        entityLabel: incoming?.source_election?.election_title || "Appointed leadership",
        organizationId: orgId,
        organizationName: orgName,
        status: "completed",
        metadata: {
          elected_count: result?.elected_count || 0,
          appointed_count: result?.appointed_count || 0,
        },
      });
      await refreshLeadership();
    } catch (error) {
      prompt.error(error.message || "Leadership could not be released. No changes were applied.");
    } finally {
      setReleasing(false);
    }
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

    try {
      await officersContract("delete", { officer_id: id });
    } catch (error) {
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
    refreshLeadership();
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
    return formatOfficerServicePeriod(officer);
  }

  const currentOfficers = sortOfficerRoster(officers.filter((officer) => officer.is_current));
  const previousOfficers = sortOfficerRoster(officers.filter((officer) => !officer.is_current));
  const newOfficers = sortOfficerRoster(incoming?.new_officers || []);
  // Display-only term for the officer form subtitle, matching the roster voice.
  const officerTermLabel = formatOfficerTermLabel(currentOfficers[0] || {})
    || formatOfficerTermLabel({ leadership_academic_year: incoming?.leadership_academic_year });

  // One year for the whole Current register, but only when every displayed
  // current officer genuinely shares it. Empty string means "no shared year", and
  // each row then keeps its own truthful term on mobile exactly as before.
  const currentSharedYear = sharedLeadershipAcademicYear(currentOfficers);
  const currentSharedTerm = currentSharedYear
    ? formatOfficerTermLabel({ leadership_academic_year: currentSharedYear })
    : "";

  /* One officer as a ruled register row.

     The office leads the row because this is a leadership register: the office is
     the structural fact and the person is the detail that fills it. The index
     follows this sorted display result rather than a stored database value.

     Only fields that exist on the officer record are shown: position_title, the
     linked student's name and number, authoritative academic term and the term window. There is
     no programme, course or year on this data, so none is implied. */

  function renderOfficerRow(officer, index, { sharedTerm = "" } = {}) {
    const officerName = officerDisplayName(officer);
    const order = String(index + 1).padStart(2, "0");
    const termLabel = formatOfficerTermForDisplay(officer);

    return (
      <article key={officer.id} className="board-officer-entry">
        <span className="board-officer-entry-index" aria-hidden="true">
          {order}
        </span>

        <h3 className="board-officer-office">{formatOfficerPositionTitle(officer.position_title)}</h3>

        <div className="board-officer-person">
          <div className="board-officer-avatar">
            {officer.photo_url ? (
              <img src={officer.photo_url} alt="" loading="lazy" />
            ) : (
              <span>{officerInitials(officer)}</span>
            )}
          </div>
          <div className="board-officer-identity">
            <span className="board-officer-name">{officerName}</span>
            <span className="board-officer-reference">
              {officer.students?.student_number
                ? `Student No. ${officer.students.student_number}`
                : "Unlinked officer record"}
            </span>
          </div>
        </div>

        {/* The term is a property of the roster, not of the person, so when the
            section states one shared year the row's copy is redundant on mobile
            and is collapsed there only. The element is still rendered and still
            visible on desktop, where the Term column is the point. */}
        {(termLabel || (!officer.is_current && officerPeriod(officer))) && <div className={`board-officer-term${sharedTerm ? " is-shared-term" : ""}`}>
          {termLabel && <span className="board-officer-term-label">{termLabel}</span>}
          {!officer.is_current && officerPeriod(officer) && <span className="board-officer-term-period">{officerPeriod(officer)}</span>}
        </div>}

        <OfficerRowMenu
          label={officerName}
          items={[
            { label: "Edit officer", onSelect: () => openEditForm(officer) },
            { label: "Delete officer", onSelect: () => handleDelete(officer), danger: true },
          ]}
        />

        {/* Both controls are kept on every row, current and historical. The
            existing behaviour lets a Board member maintain a past officer record
            the same way, so the previous register offers the same actions rather
            than controls that could not succeed. The same pair is repeated behind
            the row's overflow menu on mobile; the handlers are the ones below in
            both cases. */}
        <div className="board-officer-actions board-officer-row-actions">
          <button
            type="button"
            onClick={() => openEditForm(officer)}
            className="board-officer-action"
            aria-label={`Edit ${officerName}`}
          >
            <Pencil size={14} aria-hidden="true" />
            <span>Edit</span>
          </button>
          <button
            type="button"
            onClick={() => handleDelete(officer)}
            className="board-officer-action is-danger"
            aria-label={`Delete ${officerName}`}
          >
            <Trash2 size={14} aria-hidden="true" />
            <span>Delete</span>
          </button>
        </div>
      </article>
    );
  }

  /* The leadership register.

     One register, one direction: a ruled column header over ruled rows, matching
     the Positions register so an officer row and a position row are read the same
     way. The column header and the rows share one grid template held in a custom
     property on the register, so the labels and the data cannot drift apart.

     `history` only changes the register's tone. The previous register is set in
     the softer ink behind a hairline instead of the 2px ink rule, so a past term
     reads as history rather than as a disabled or discarded record. It stays
     legible and keeps the same controls. */

  function renderLeadershipRegister({ label, description, records, empty, history, action, sharedTerm = "", loading = false, error = "" }) {
    return (
      <section
        className={`board-officers-register${history ? " is-history" : ""}`}
        aria-label={label}
      >
        <div className={`board-officers-register-head${sharedTerm ? " has-shared-term" : ""}`}>
          <div className="board-officers-register-copy">
            <p className="board-officers-section-kicker">{label}</p>
            <h2>{description}</h2>
            {/* The one shared leadership year for this section. Hidden on desktop,
                where the Term column already states it per row, and shown on mobile
                as quiet context beside the count. Plain muted type, never a pill. */}
            {sharedTerm && <p className="board-officers-register-shared-term">{sharedTerm}</p>}
          </div>
          {/* Count first, action second: the count is quiet metadata and the
              outlined action is the loudest thing in this group, so it belongs
              on the outer edge where the eye finishes. Order only; both were
              already rendered here and both keep their handlers. */}
          <div className="board-officers-register-tools">
            <span className="board-officers-register-count">
              <strong>{loading && records.length === 0 ? "—" : String(records.length).padStart(2, "0")}</strong>
              <span className="board-officers-register-count-word">{loading && records.length === 0 ? "loading" : records.length === 1 ? "officer" : "officers"}</span>
            </span>
            {action}
          </div>
        </div>

        {error ? <p className="board-officers-register-load-error" role={records.length ? "status" : "alert"}>{error}{records.length ? " The last loaded records remain visible." : ""}</p> : null}
        {loading && records.length === 0 ? (
          <div className="board-officers-register-skeleton" role="status" aria-label={`Loading ${label}`} aria-busy="true">
            {[0, 1, 2, 3].map((row) => <div className="board-officers-register-skeleton-row" key={row}><span /><span /><span /><span /></div>)}
          </div>
        ) : records.length === 0 && error ? null : records.length === 0 ? (
          <p className="board-officers-register-empty">{empty}</p>
        ) : (
          <>
            <div className="board-officers-register-columns" aria-hidden="true">
              <span>No.</span>
              <span>Office</span>
              <span>Officer</span>
              <span>Term</span>
              <span>Actions</span>
            </div>

            <div className="board-officer-list">
              {records.map((officer, index) => renderOfficerRow(officer, index, { sharedTerm }))}
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <div className="board-officers-desktop">
      <header className="board-officers-masthead">
        <div className="board-officers-context">
          <span className="board-officers-eyebrow">
            Electoral Board / {orgName}
          </span>
          <span className="board-officers-context-rule" aria-hidden="true" />
        </div>

        {/* The action sits on the title's baseline rather than below it. As a
            direct child of this grid it stretched to the full column width, so
            the one orange element on the page read as a solid bar. Sharing the
            baseline row with the title keeps it a button of ordinary width and
            keeps the two at the same optical line. Same handler, same class. */}
        <div className="board-officers-baseline">
          <h1 className="page-title board-officers-title">Officer record</h1>

          <button type="button" className="board-officers-create" aria-label="Add officer" onClick={() => openOfficerForm()}>
            <Plus size={16} aria-hidden="true" /> Add<span className="board-officers-create-detail"> officer</span>
          </button>
        </div>

        <p className="board-officers-standfirst">
          Maintain current and previous leadership records for {orgName}.
        </p>
      </header>

      {renderLeadershipRegister({
        label: "Current Leadership",
        description: `The officers currently serving ${orgName}.`,
        records: currentOfficers,
        empty: "No current officers recorded.",
        sharedTerm: currentSharedTerm,
        loading: officersLoading,
        error: officersError,
        action: <button type="button" className="board-officers-create board-officers-create-secondary" aria-label="Add to Current" onClick={() => openOfficerForm("current")} disabled={officersLoading}><Plus size={15} aria-hidden="true" /> Add<span className="board-officers-create-detail"> to Current</span></button>,
      })}

      {(incoming || incomingLoading) && (
        <section className="board-officers-incoming board-officers-new" aria-label="New Officers">
          <div className="board-officers-incoming-head">
            <div>
              <p className="board-officers-section-kicker">New Officers{incoming?.source_election?.election_title ? ` · ${incoming.source_election.election_title}` : " · Appointed roster"}</p>
              <h2>Preparing the next leadership record</h2>
              <p>Only officers added to this roster will become current when released.{incoming?.leadership_academic_year ? ` Leadership year · AY ${incoming.leadership_academic_year.replace(/\b(\d{4})-(\d{4})\b/u, "$1\u2013$2")}.` : ""}</p>
            </div>
            <div className="board-officers-incoming-actions">
              <button type="button" className="board-officers-add-appointed" onClick={() => openOfficerForm("new")}><Plus size={15} aria-hidden="true" /> Add to New Officers</button>
              <button type="button" className="board-officers-release" onClick={releaseIncomingLeadership} disabled={releasing || newOfficers.length === 0}>
                {releasing ? "Releasing…" : "Release new officers"}
              </button>
            </div>
          </div>
          {incomingLoading && !incoming ? <p className="board-officers-register-empty" role="status">Loading the New Officers roster…</p> : newOfficers.length === 0 ? <p className="board-officers-register-empty">No New Officers prepared yet. Add a verified winner or an eligible appointed student to begin.</p> : <div className="board-officers-incoming-group">
            {newOfficers.map((officer, index) => (
              <article className="board-officers-incoming-row" key={officer.id}>
                <span className="board-officers-incoming-index">{String(index + 1).padStart(2, "0")}</span>
                <div className="board-officers-incoming-office">
                  <strong>{formatOfficerPositionTitle(officer.position_title)}</strong>
                  {officer.student_number && <small>Student No. {officer.student_number}</small>}
                </div>
                <div className="board-officers-incoming-person">
                  <strong>{officer.student_name || "Student"}</strong>
                  <span>{officer.selection_type === "elected" ? "Elected" : "Appointed"}</span>
                </div>
                <div className="board-officer-actions">
                  <button type="button" className="board-officer-action" onClick={() => openOfficerFormForEdit(officer)}>Edit</button>
                  <button type="button" className="board-officer-action is-danger" onClick={() => removeNewOfficer(officer)}>Remove</button>
                </div>
              </article>
            ))}
          </div>}
        </section>
      )}
      {renderLeadershipRegister({
        label: "Past Leadership",
        description: `Officers who have previously served ${orgName}.`,
        records: previousOfficers,
        empty: "No past officer records.",
        history: true,
        loading: officersLoading,
      })}

      {incomingError && <p className="board-officers-register-empty" role="alert">{incomingError}</p>}

      {officerFormOpen && (
        <OfficerFormDialog
          key={editingNewOfficer?.id || officerFormTarget || "add-officer"}
          orgName={orgName}
          termLabel={officerTermLabel}
          initialTarget={officerFormTarget}
          editingOfficer={editingNewOfficer}
          incoming={incoming}
          incomingError={incomingError}
          incomingLoading={incomingLoading}
          currentOfficers={currentOfficers}
          students={students}
          studentsLoaded={studentsLoaded}
          studentsError={studentsError}
          studentsLoading={studentsLoading}
          onLoadEligibleStudents={loadEligibleStudents}
          onRetryIncoming={() => refreshLeadership()}
          busy={submitting}
          onClose={closeOfficerForm}
          onAddElected={addIncomingElected}
          onAddAppointed={addIncomingAppointment}
          onAddCurrentAppointed={(appointment) => addCurrentOfficer({ ...appointment, selection_type: "appointed" })}
          onAddCurrentElected={(candidateId, service, confirmTermContext) => addCurrentOfficer({
            candidate_id: candidateId,
            service,
            confirm_term_context: confirmTermContext,
            selection_type: "elected",
          })}
          onUpdate={updateNewOfficer}
        />
      )}

      {formOpen && editingOfficer && (
        <PopupOverlay>
          <div className="popup-sheet popup-sheet-wide sa-students-modal is-registration board-officer-registration" role="dialog" aria-modal="true" aria-labelledby="board-officer-edit-title">
            <div className="popup-header">
              <div className="popup-header-copy">
                <h2 id="board-officer-edit-title" className="surface-title">Edit Officer</h2>
                <p className="surface-copy">
                  {officerDisplayName(editingOfficer)} · {formatOfficerPositionTitle(editingOfficer.position_title)}
                </p>
              </div>
              <button type="button" className="popup-close" onClick={() => setFormOpen(false)} aria-label="Close edit officer" disabled={submitting}>
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="popup-content sa-registration-workspace">
              <ol className="sa-registration-progress" style={{ gridTemplateColumns: "1fr" }} aria-label="Edit officer progress">
                <li className="is-current" aria-current="step"><span>01</span><strong>Officer details</strong></li>
              </ol>

              <div className="sa-registration-focus">
                <h3>Update officer details</h3>
                <p>Leadership academic year is retained from the existing officer record.</p>
              </div>

              {editingOfficer.selection_type !== "elected" && (
                <div className="sa-registration-field">
                  <label htmlFor="edit-officer-student">Officer</label>
                  <select id="edit-officer-student" value={form.student_id} onChange={(event) => setForm({ ...form, student_id: event.target.value })}>
                    {!students.some((student) => String(student.id) === String(form.student_id)) && form.student_id && (
                      <option value={form.student_id}>{studentQuery || "Current linked student"}</option>
                    )}
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>{student.first_name} {student.last_name} · {student.student_number}</option>
                    ))}
                  </select>
                </div>
              )}

              {editingOfficer.selection_type !== "elected" && editingOfficer.selection_type !== "appointed" && (
                <div className="sa-registration-field">
                  <label htmlFor="edit-officer-name">Officer name</label>
                  <input id="edit-officer-name" value={form.officer_name} onChange={(event) => setForm({ ...form, officer_name: event.target.value })} />
                </div>
              )}

              {editingOfficer.selection_type === "elected" ? (
                <div className="sa-registration-note">
                  <strong>Office</strong>
                  <p>{formatOfficerPositionTitle(editingOfficer.position_title)}</p>
                </div>
              ) : (
                <div className="sa-registration-field">
                  <label htmlFor="edit-officer-position">Position</label>
                  <input id="edit-officer-position" required value={form.position_title} onChange={(event) => setForm({ ...form, position_title: event.target.value })} />
                </div>
              )}

              <div className="sa-registration-note">
                <strong>Leadership year &amp; service</strong>
                <p>{formatOfficerTermLabel(editingOfficer) || "Leadership year is retained from its election or leadership record."}</p>
                <p>{editingOfficer.service_started_at
                  ? `Service began ${formatOfficerServiceDate(editingOfficer.service_started_at)}.`
                  : editingOfficer.term_start
                    ? `Recorded service date: ${formatOfficerServiceDate(editingOfficer.term_start)}.`
                    : "Service time is recorded automatically when an officer becomes Current."}</p>
              </div>

              <div className="sa-registration-field">
                <label htmlFor="edit-officer-term-end">End of service</label>
                <input id="edit-officer-term-end" type="date" value={form.term_end} onChange={(event) => setForm({ ...form, term_end: event.target.value })} />
              </div>

              <div className="sa-registration-field">
                <label htmlFor="edit-officer-photo">Image URL <span>Optional</span></label>
                <input id="edit-officer-photo" type="url" value={form.photo_url} onChange={(event) => setForm({ ...form, photo_url: event.target.value })} />
              </div>

              <div className="sa-registration-actions">
                <button type="button" className="secondary-btn" onClick={() => setFormOpen(false)} disabled={submitting}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={submitting}>
                  {submitting ? <KandidButtonLoader label="Saving..." /> : <>Save changes<ArrowRight size={16} aria-hidden="true" /></>}
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
