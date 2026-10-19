import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Plus, Pencil, Trash2, X, QrCode, Power, ImagePlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import PopupOverlay from "../../components/PopupOverlay";
import ElectionCover from "../../components/ElectionCover";
import OrganizationSelect from "../../components/OrganizationSelect";
import AcademicTermSelect from "../../components/AcademicTermSelect";
import SuperAdminPageHeader from "../../components/SuperAdminPageHeader";
import ScheduleDateTimePicker, {
  currentDateTimeInputValue,
} from "../../components/ScheduleDateTimePicker";
import { supabase } from "../../lib/supabaseClient";
import { loadElectionForEdit, saveElectionEdit, electionSaveError, electionEditLocks } from "../../utils/electionEditContract";
import { createElectionSubmission } from "../../utils/electionCreateContract";
import { electionManagementQuery, verifyElectionRemovalReadiness } from "../../utils/electionManagementCompatibility";
import { isElectionSoftRemovalEnabled } from "../../utils/electionRemovalFeatureGate";
import { useElectionClock } from "../../utils/useElectionClock";
import {
  formatLocalDateTime,
  formValueToScheduleTimestamp,
  getElectionPhase,
  isMissingElectionCoverColumn,
  scheduleTimestampToFormValue,
  validateElectionSchedule,
} from "../../utils/elections";
import { uploadElectionCover, electionCoverError } from "../../utils/electionCovers";
import {
  generateAccessToken,
  getAccessQrImageUrl,
  getVotingAccessModeLabel,
  TOKEN_SCOPE_TYPES,
  VOTING_ACCESS_MODES,
} from "../../utils/votingAccess";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../../utils/deleteGuards";
import BoardElectionDeleteSheet from "../board/BoardElectionDeleteSheet";
import { loadElectionDeleteReview } from "../../utils/electionDeleteReview";
import { callElectionRemoval, electionRemovalErrorMessage } from "../../utils/electionRemoval";
import {
  fetchOrderedPositions,
  isMissingPositionOrderError,
} from "../../utils/positionOrder";
import { copyLatestOrganizationPositions } from "../../utils/positionReuse";
import {
  isResultVisibilityConstraintError,
  resultVisibilityLabel,
  serializeResultVisibilityForDatabase,
  serializeResultVisibilityForLegacyDatabase,
} from "../../utils/results";
import "./Elections.css";

const ELECTION_PHASE_LABELS = {
  draft: "Draft",
  archived: "Archived",
  closed: "Concluded",
  campaign_upcoming: "Campaign upcoming",
  campaign: "Campaigning",
  waiting: "Awaiting voting",
  voting: "Voting now",
  scheduled: "Scheduled",
  active: "Active",
};

const electionPhaseLabel = (phase) =>
  ELECTION_PHASE_LABELS[phase] || String(phase || "Status unavailable").replaceAll("_", " ");

const electionScheduleValue = (value) =>
  value ? formatLocalDateTime(value) : "Not scheduled";

const isPositionOrderConflict = (error) =>
  /positions_election_display_order_unique|duplicate key/i.test(error?.message || "");

function Elections() {
  const prompt = usePrompt();
  const now = useElectionClock();
  const navigate = useNavigate();
  const [elections, setElections] = useState([]);
  const [removalReady, setRemovalReady] = useState(false);
  const [removalUnavailable, setRemovalUnavailable] = useState(false);
  const [removedView, setRemovedView] = useState(false);
  const [removedElections, setRemovedElections] = useState([]);
  const [removedTotal, setRemovedTotal] = useState(0);
  const [removedOffset, setRemovedOffset] = useState(0);
  const [removedError, setRemovedError] = useState("");
  const [deleteReview, setDeleteReview] = useState(null);
  const [removalBusy, setRemovalBusy] = useState(false);
  const removalReviewRequest = useRef(0);
  const [organizations, setOrganizations] = useState([]);
  const [accessTokens, setAccessTokens] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [createdElection, setCreatedElection] = useState(null);
  const [editingElection, setEditingElection] = useState(null);
  const [electionsLoading, setElectionsLoading] = useState(true);
  const [electionsError, setElectionsError] = useState("");

  // Position management for the selected election
  const [positions, setPositions] = useState([]);
  const [positionsOpen, setPositionsOpen] = useState(false);
  const [selectedElection, setSelectedElection] = useState(null);
  const [editingPosition, setEditingPosition] = useState(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const coverUploadRequest = useRef(0);
  const coverUploadBusy = useRef(false);
  function closeCoverForm() {
    coverUploadRequest.current++;
    coverUploadBusy.current = false;
    setCoverUploading(false);
    setFormOpen(false);
  }
  const [positionForm, setPositionForm] = useState({
    name: "",
    max_votes: 1,
    display_order: 1,
  });
  const [tokenForm, setTokenForm] = useState({
    scope_type: "general",
    scope_value: "",
    expires_at: "",
  });

  const [form, setForm] = useState({
    organization_id: "",
    title: "",
    academic_term_id: "",
    cover_url: "",
    campaign_start: "",
    campaign_end: "",
    start_date: "",
    end_date: "",
    status: "draft",
    student_result_visibility: "after_close",
    voting_access_mode: "anywhere",
    location_label: "",
    geo_lat: "",
    geo_lng: "",
    geo_radius_meters: "",
  });
  const scheduleMin = editingElection ? "" : currentDateTimeInputValue();
  const editLocks = electionEditLocks(editingElection);
  const [savingElection, setSavingElection] = useState(false);
  const saveInFlight = useRef(false);
  const createSubmission = useRef(null);

  useEffect(() => {
    fetchOrganizations();
    fetchElections();
  }, []);

  async function fetchOrganizations() {
    const { data } = await supabase
      .from("organizations")
      .select("id, name, logo_url")
      .order("name", { ascending: true });

    setOrganizations(data || []);
  }

  async function fetchElections() {
    setElectionsLoading(true);
    setElectionsError("");
    const requested = isElectionSoftRemovalEnabled();
    const ready = await verifyElectionRemovalReadiness(requested, callElectionRemoval);
    setRemovalReady(ready);
    setRemovalUnavailable(requested && !ready);
    if (!ready) setRemovedView(false);
    const { data, error } = await electionManagementQuery(supabase, { removalReady: ready });

    if (error) {
      console.error("Failed to load elections:", error);
      setElectionsError("Election records could not be loaded. Please try again.");
    } else {
      setElections(data || []);
    }
    setElectionsLoading(false);
  }

  async function fetchPositions(electionId) {
    const { data, error } = await fetchOrderedPositions(supabase, electionId);

    if (error) {
      console.error("Failed to load positions:", error);
      prompt.error(error.message || "Failed to load positions.");
      return [];
    }

    setPositions(data || []);
    return data || [];
  }

  async function openPositions(election) {
    setSelectedElection(election);
    setEditingPosition(null);
    setPositionForm({
      name: "",
      max_votes: 1,
      display_order: 1,
    });
    setPositionsOpen(true);
    const loadedPositions = await fetchPositions(election.id);
    setPositionForm((currentForm) => ({
      ...currentForm,
      display_order: loadedPositions.length + 1,
    }));
  }

  function closePositions() {
    setPositionsOpen(false);
    setSelectedElection(null);
    setPositions([]);
    setEditingPosition(null);
    setPositionForm({
      name: "",
      max_votes: 1,
      display_order: positions.length + 1,
    });
  }

  function openCreatePositionForm() {
    setEditingPosition(null);
    setPositionForm({
      name: "",
      max_votes: 1,
      display_order: positions.length + 1,
    });
  }

  function openEditPositionForm(position) {
    setEditingPosition(position);
    setPositionForm({
      name: position.name || "",
      max_votes: position.max_votes || 1,
      display_order: position.display_order || positions.indexOf(position) + 1,
    });
  }

  async function handlePositionSubmit(e) {
    e.preventDefault();

    if (!selectedElection) {
      prompt.error("No election selected.");
      return;
    }

    const name = positionForm.name.trim();
    const maxVotes = Number(positionForm.max_votes);

    if (!name) {
      prompt.error("Position name is required.");
      return;
    }

    if (!Number.isInteger(maxVotes) || maxVotes < 1) {
      prompt.error("Maximum votes must be at least 1.");
      return;
    }

    const payload = {
      election_id: selectedElection.id,
      name,
      max_votes: maxVotes,
      display_order: Number(positionForm.display_order || positions.length + 1),
    };

    const creatingPosition = !editingPosition;
    let savedPositionId = editingPosition?.id;

    if (editingPosition) {
      let { error } = await supabase
        .from("positions")
        .update({
          name: payload.name,
          max_votes: payload.max_votes,
          display_order: payload.display_order,
        })
        .eq("id", editingPosition.id);

      if (isMissingPositionOrderError(error)) {
        const fallback = await supabase
          .from("positions")
          .update({
            name: payload.name,
            max_votes: payload.max_votes,
          })
          .eq("id", editingPosition.id);
        error = fallback.error;
      }

      if (error) {
        console.error("Position update failed:", error);
        prompt.error(
          isPositionOrderConflict(error)
            ? "Another position already uses that order in this election."
            : error.message || "Failed to update position."
        );
        return;
      }

      prompt.success("Position updated.");
    } else {
      let { data, error } = await supabase
        .from("positions")
        .insert([payload])
        .select("id")
        .single();

      if (isMissingPositionOrderError(error)) {
        const fallback = await supabase
          .from("positions")
          .insert([{
            election_id: payload.election_id,
            name: payload.name,
            max_votes: payload.max_votes,
          }])
          .select("id")
          .single();
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        console.error("Position creation failed:", error);
        prompt.error(
          isPositionOrderConflict(error)
            ? "Another position already uses that order in this election."
            : error.message || "Failed to create position."
        );
        return;
      }

      savedPositionId = data?.id;
      prompt.success("Position created.");
    }

    setEditingPosition(null);
    setPositionForm({
      name: "",
      max_votes: 1,
      display_order: positions.length + 1,
    });

    await fetchPositions(selectedElection.id);

    if (creatingPosition && savedPositionId) {
      const addCandidateNow = await prompt.confirm({
        title: "Add Candidate Now?",
        message: `${name} was created. You can add candidates now or continue setting up positions.`,
        type: "success",
        confirmText: "Add Candidate",
        cancelText: "Continue Setup",
      });

      if (addCandidateNow) {
        closePositions();
        navigate(`/super-admin/candidates?position=${savedPositionId}`);
      }
    }
  }

  async function handleDeletePosition(position) {
    const analysis = await analyzeDeleteDependencies("position", position);

    if (analysis.blocked) {
      await logAuditEvent({
        action: "position_delete_blocked",
        entityType: "position",
        entityId: position.id,
        entityLabel: position.name || "Position",
        organizationId: selectedElection?.organization_id,
        organizationName: selectedElection?.organizations?.name,
        status: "requires_action",
        metadata: { dependencies: analysis.dependencies },
      });
      await prompt.alert({
        title: analysis.severity === "archive" ? "Position Is Historical" : "Position Cannot Be Deleted Yet",
        message: dependencyMessage(position.name || "This position", analysis),
        type: "warning",
        confirmText: "Review Candidates",
      });
      return;
    }

    const confirmDelete = await prompt.confirm({
      title: "Delete Position?",
      message: dependencyMessage(position.name || "This position", analysis),
      type: "danger",
      confirmText: "Delete Position",
    });

    if (!confirmDelete) return;

    const recheck = await analyzeDeleteDependencies("position", position);
    if (recheck.blocked) {
      prompt.error(dependencyMessage(position.name || "This position", recheck));
      return;
    }

    const { error } = await supabase
      .from("positions")
      .delete()
      .eq("id", position.id);

    if (error) {
      console.error("Position deletion failed:", error);
      prompt.error(
        error.message ||
        "This position cannot be deleted because it is being used by another record."
      );
      return;
    }

    prompt.success("Position deleted.");
    await logAuditEvent({
      action: "position_deleted",
      entityType: "position",
      entityId: position.id,
      entityLabel: position.name || "Position",
      organizationId: selectedElection?.organization_id,
      organizationName: selectedElection?.organizations?.name,
      status: "completed",
    });
    await fetchPositions(selectedElection.id);
  }

  function openCreateForm() {
    coverUploadRequest.current++;
    coverUploadBusy.current = false;
    setCoverUploading(false);
    createSubmission.current = createElectionSubmission(supabase);
    setEditingElection(null);
    setForm({
      organization_id: "",
      title: "",
      academic_term_id: "",
      cover_url: "",
      campaign_start: "",
      campaign_end: "",
      start_date: "",
      end_date: "",
      status: "draft",
      student_result_visibility: "after_close",
      voting_access_mode: "anywhere",
      location_label: "",
      geo_lat: "",
      geo_lng: "",
      geo_radius_meters: "",
    });
    setAccessTokens([]);
    setTokenForm({
      scope_type: "general",
      scope_value: "",
      expires_at: "",
    });
    setFormOpen(true);
  }

  async function fetchAccessTokens(electionId) {
    const { data } = await supabase
      .from("election_access_tokens")
      .select("*")
      .eq("election_id", electionId)
      .order("created_at", { ascending: false });

    setAccessTokens(data || []);
  }

  async function openEditForm(election) {
    coverUploadRequest.current++;
    coverUploadBusy.current = false;
    setCoverUploading(false);
    try {
      election = await loadElectionForEdit(supabase, election.id);
    } catch (error) {
      prompt.error(electionSaveError(error));
      return;
    }
    const geofence = election;
    setEditingElection(election);
    setForm({
      organization_id: election.organization_id || "",
      title: election.title || "",
      academic_term_id: election.academic_term_id ?? "",
      cover_url: election.cover_url || "",
      campaign_start: election.campaign_start
        ? scheduleTimestampToFormValue(election.campaign_start)
        : "",
      campaign_end: election.campaign_end
        ? scheduleTimestampToFormValue(election.campaign_end)
        : "",
      start_date: election.start_date
        ? scheduleTimestampToFormValue(election.start_date)
        : "",
      end_date: election.end_date ? scheduleTimestampToFormValue(election.end_date) : "",
      status: election.status || "draft",
      student_result_visibility:
        election.student_result_visibility === "hidden"
          ? "after_close"
          : election.student_result_visibility || "after_close",
      voting_access_mode: election.voting_access_mode || "anywhere",
      location_label: election.location_label || "",
      geo_lat: geofence.geo_lat ?? "",
      geo_lng: geofence.geo_lng ?? "",
      geo_radius_meters: geofence.geo_radius_meters ?? "",
    });
    await fetchAccessTokens(election.id);
    setTokenForm({
      scope_type: "general",
      scope_value: "",
      expires_at: "",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (saveInFlight.current) return;
    if (coverUploadBusy.current) return;
    saveInFlight.current = true;
    setSavingElection(true);
    try {

    if (!form.academic_term_id) {
      prompt.error("Choose the academic term this election belongs to.");
      return;
    }

    const validationMessage = validateElectionSchedule(form);
    if (validationMessage) {
      prompt.error(validationMessage);
      return;
    }

    const payload = {
      organization_id: Number(form.organization_id),
      title: form.title,
      academic_term_id: Number(form.academic_term_id),
      cover_url: form.cover_url || null,
      campaign_start: formValueToScheduleTimestamp(form.campaign_start),
      campaign_end: formValueToScheduleTimestamp(form.campaign_end),
      start_date: formValueToScheduleTimestamp(form.start_date),
      end_date: formValueToScheduleTimestamp(form.end_date),
      status: form.status,
      student_result_visibility: serializeResultVisibilityForDatabase(
        form.student_result_visibility,
      ),
      voting_access_mode: form.voting_access_mode,
      location_label: form.location_label || null,
      geo_lat: form.geo_lat === "" ? null : Number(form.geo_lat),
      geo_lng: form.geo_lng === "" ? null : Number(form.geo_lng),
      geo_radius_meters:
        form.geo_radius_meters === "" ? null : Number(form.geo_radius_meters),
    };

    const saveElection = (nextPayload) =>
      editingElection
        ? saveElectionEdit(supabase, editingElection, nextPayload)
        : (createSubmission.current ||= createElectionSubmission(supabase))(nextPayload);

    let result = await saveElection(payload);

    if (
      isResultVisibilityConstraintError(result?.error) &&
      form.student_result_visibility !== "manual"
    ) {
      result = await saveElection({
        ...payload,
        student_result_visibility: serializeResultVisibilityForLegacyDatabase(
          form.student_result_visibility,
        ),
      });
    }

    if (isMissingElectionCoverColumn(result?.error)) {
      const payloadWithoutCover = { ...payload };
      delete payloadWithoutCover.cover_url;
      result = await saveElection(payloadWithoutCover);
      if (!result?.error) {
        prompt.info(
          "Election saved without a cover. Apply the election cover migration in Supabase to enable cover photos.",
        );
      }
    }

    const error = result?.error;
    if (error) {
      console.error("Election save failed:", error);
      prompt.error(
        isResultVisibilityConstraintError(error) && form.student_result_visibility === "manual"
          ? "Manual admin release requires the updated result visibility schema in Supabase."
          : electionSaveError(error)
      );
      return;
    }

    const organization = organizations.find(
      (org) => String(org.id) === String(payload.organization_id),
    );

    if (result.unchanged) {
      prompt.info("No changes to save.");
      return;
    }
    let reusedPositions = { copiedCount: 0, sourceElection: null };

    if (editingElection) {
      prompt.success("Election updated.");
    } else if (result?.data?.id) {
      reusedPositions = await copyLatestOrganizationPositions(supabase, {
        organizationId: payload.organization_id,
        targetElectionId: result.data.id,
      });

      if (reusedPositions.error) {
        console.warn("Unable to reuse previous election positions:", reusedPositions.error);
      }
    }
    await logAuditEvent({
      action: editingElection ? "election_updated" : "election_created",
      entityType: "election",
      entityId: result?.data?.id || editingElection?.id,
      entityLabel: payload.title,
      organizationId: payload.organization_id,
      organizationName: organization?.name,
      status: "completed",
      metadata: {
        election_status: payload.status,
        voting_access_mode: payload.voting_access_mode,
      },
    });
    setFormOpen(false);
    fetchElections();

    if (!editingElection && result?.data?.id) {
      setCreatedElection({
        ...payload,
        id: result.data.id,
        organizations: organization ? { name: organization.name, logo_url: organization.logo_url } : null,
        reusedPositionCount: reusedPositions.copiedCount || 0,
        reusedFromElectionTitle: reusedPositions.sourceElection?.title || "",
      });
    }
    } catch (error) { prompt.error(electionSaveError(error)); } finally { saveInFlight.current = false; setSavingElection(false); }
  }

  async function handleCoverUpload(file) {
    if (!file || coverUploadBusy.current || saveInFlight.current) return;

    const request = ++coverUploadRequest.current;
    coverUploadBusy.current = true;
    setCoverUploading(true);
    try {
      const publicUrl = await uploadElectionCover(supabase, file, {
        organizationId: form.organization_id,
        electionId: editingElection?.id ?? null,
      });
      if (request !== coverUploadRequest.current) return;
      setForm((currentForm) => ({ ...currentForm, cover_url: publicUrl }));
      prompt.success("Cover uploaded. Save the election to keep this change.");
    } catch (error) {
      if (request === coverUploadRequest.current) prompt.error(electionCoverError(error));
    } finally {
      if (request === coverUploadRequest.current) {
        coverUploadBusy.current = false;
        setCoverUploading(false);
      }
    }
  }

  async function handleCreateAccessToken() {
    if (!editingElection) return;

    const token = generateAccessToken();
    const payload = {
      election_id: editingElection.id,
      token,
      scope_type: tokenForm.scope_type,
      scope_value:
        tokenForm.scope_type === "general" ? null : tokenForm.scope_value || null,
      expires_at: tokenForm.expires_at || null,
      is_active: true,
    };

    const { error } = await supabase.from("election_access_tokens").insert([payload]);

    if (error) {
      prompt.error(error.message || "Failed to create access token.");
      return;
    }

    prompt.success("Access token created.");
    await fetchAccessTokens(editingElection.id);
    setTokenForm({
      scope_type: "general",
      scope_value: "",
      expires_at: "",
    });
  }

  async function handleToggleToken(tokenRow) {
    const { error } = await supabase
      .from("election_access_tokens")
      .update({ is_active: !tokenRow.is_active })
      .eq("id", tokenRow.id);

    if (error) {
      prompt.error(error.message || "Failed to update token.");
      return;
    }

    prompt.info(`Token ${!tokenRow.is_active ? "activated" : "deactivated"}.`);
    await fetchAccessTokens(editingElection.id);
  }

  async function handleDelete(id) {
    const request = ++removalReviewRequest.current;
    const election = elections.find((item) => item.id === id) || {};
    setDeleteReview({ id, election, phase: "reviewing", mode: "remove", analysis: null, error: "" });
    const analysis = await loadElectionDeleteReview(id, removalReady ? callElectionRemoval : undefined, { removalReady });
    if (request !== removalReviewRequest.current) return;
    if (analysis.severity === "unavailable") {
      setDeleteReview({ id, election, phase: "unavailable", mode: "remove", analysis, error: "" });
      return;
    }
    setDeleteReview({ id, election, phase: "review", mode: "remove", analysis, error: "" });
  }

  function closeElectionRemovalReview() {
    if (removalBusy) return;
    removalReviewRequest.current += 1;
    setDeleteReview(null);
  }

  async function openRemovedElections(offset = 0) {
    if (!removalReady) return;
    setRemovedError("");
    const { data, error } = await callElectionRemoval("list_removed", { limit: 50, offset });
    if (error || !Array.isArray(data?.elections)) {
      setRemovedError(electionRemovalErrorMessage(error));
      setRemovedElections([]);
    } else {
      setRemovedElections(data.elections);
      setRemovedTotal(Number(data.total || 0));
      setRemovedOffset(Number(data.offset || 0));
    }
    setRemovedView(true);
  }

  async function confirmElectionChange(password) {
    if (!removalReady || removalBusy || deleteReview?.phase !== "danger_zone" || !password) return;
    setRemovalBusy(true);
    const mode = deleteReview.mode;
    const action = mode === "restore" ? "restore" : "soft_remove";
    setDeleteReview((current) => ({ ...current, phase: mode === "restore" ? "restoring" : "removing", error: "" }));
    try {
      const { data, error } = await callElectionRemoval(action, { election_id: Number(deleteReview.id), password });
      if (error || (mode === "restore" ? data?.restored !== true : data?.removed !== true)) throw error || new Error("The election change was not confirmed.");
      setDeleteReview(null);
      prompt.success(mode === "restore" ? "Election restored to the normal management list." : "Election removed. Related records remain preserved.");
      await fetchElections();
      if (mode === "restore") await openRemovedElections(removedOffset);
    } catch (error) {
      setDeleteReview((current) => ({ ...current, phase: "danger_zone", error: electionRemovalErrorMessage(error) }));
    } finally {
      setRemovalBusy(false);
    }
  }

  const phaseCounts = elections.reduce(
    (counts, election) => {
      const phase = getElectionPhase(election, now);
      if (["campaign", "waiting", "voting"].includes(phase)) counts.inProgress += 1;
      if (["campaign_upcoming", "scheduled"].includes(phase)) counts.scheduled += 1;
      if (["closed", "archived"].includes(phase)) counts.concluded += 1;
      return counts;
    },
    { inProgress: 0, scheduled: 0, concluded: 0 },
  );

  return (
    <div className="sa-elections">
      <SuperAdminPageHeader
        section="Election operations"
        title="Elections"
        description="Review and manage elections across Kandid organizations."
        actions={(
          <>
          <span>Schedule control</span>
          <strong>{electionsLoading ? "Loading" : electionsError ? "Register unavailable" : `${elections.length} recorded`}</strong>
          <button type="button" onClick={openCreateForm} className="sa-elections-add">
            <Plus size={17} />
            Add Election
          </button>
          </>
        )}
      />

      {removalUnavailable ? <div role="status"><p>Soft removal is unavailable. The existing election register remains available.</p><button type="button" onClick={fetchElections}>Retry readiness check</button></div> : null}
      <section className="sa-elections-summary" aria-label="Election summary">
        {[
          ["Total elections", elections.length],
          ["In progress", phaseCounts.inProgress],
          ["Scheduled", phaseCounts.scheduled],
          ["Concluded", phaseCounts.concluded],
        ].map(([label, value], index) => (
          <div key={label} className="sa-elections-summary-item">
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong data-unavailable={Boolean(electionsError)}>{electionsLoading ? "Loading" : electionsError ? "Unavailable" : value}</strong>
            <p>{label}</p>
          </div>
        ))}
      </section>

      <section className="sa-elections-register" aria-labelledby="election-register-title">
        <div className="sa-elections-register-head">
          <div>
            <p className="sa-elections-eyebrow">Register / {electionsError ? "Unavailable" : String(elections.length).padStart(2, "0")}</p>
            <h2 id="election-register-title">Election schedule</h2>
          </div>
          <div><p>Campaign, voting, result release, and ballot setup in one operational register.</p>{removalReady ? <button type="button" className="sa-election-primary-action" onClick={() => openRemovedElections()}>Removed Elections</button> : null}</div>
        </div>

        {removalReady && removedView ? (
          <div className="sa-elections-list" aria-label="Removed elections">
            <div className="sa-elections-register-head"><h3>Removed Elections</h3><button type="button" onClick={() => setRemovedView(false)}>Back to schedule</button></div>
            {removedError ? <p role="alert">{removedError}</p> : null}
            {!removedError && removedElections.length === 0 ? <p>No removed elections are available.</p> : null}
            {removedElections.map((election) => <article key={election.id} className="sa-election-record">
              <div className="sa-election-identity"><p>{election.organizations?.name || "Organization unavailable"}</p><h3>{election.title || "Untitled Election"}</h3><span>Removed {election.removed_at ? new Date(election.removed_at).toLocaleString() : ""}</span></div>
              <div className="sa-election-actions"><button type="button" onClick={() => setDeleteReview({ id: election.id, election, phase: "danger_zone", mode: "restore", analysis: null, error: "" })}>Restore</button></div>
            </article>)}
            <div className="sa-election-actions" aria-label="Removed election pages">
              <button type="button" onClick={() => openRemovedElections(Math.max(0, removedOffset - 50))} disabled={removedOffset === 0}>Previous</button>
              <span>{removedTotal ? `${removedOffset + 1}–${Math.min(removedOffset + removedElections.length, removedTotal)} of ${removedTotal}` : "0 removed elections"}</span>
              <button type="button" onClick={() => openRemovedElections(removedOffset + 50)} disabled={removedOffset + 50 >= removedTotal}>Next</button>
            </div>
          </div>
        ) : electionsLoading ? (
          <div className="sa-elections-loading" role="status">
            <strong>Loading election register</strong>
            <div aria-hidden="true"><span /><span /><span /></div>
          </div>
        ) : electionsError ? (
          <div className="sa-elections-error" role="alert">
            <p className="sa-elections-eyebrow">Register unavailable</p>
            <h3>Election records could not be displayed.</h3>
            <p>{electionsError}</p>
            <button type="button" onClick={fetchElections}>Try Again</button>
          </div>
        ) : elections.length === 0 ? (
          <div className="sa-elections-empty">
            <span>01</span>
            <div>
              <h3>No elections recorded</h3>
              <p>Create an election to begin configuring its schedule and ballot structure.</p>
            </div>
            <button type="button" onClick={openCreateForm}>Add Election</button>
          </div>
        ) : (
          <div className="sa-elections-list">
            {elections.map((election, index) => {
              const phase = getElectionPhase(election, now);
              return (
                <article key={election.id} className="sa-election-record">
                  <div className="sa-election-index">{String(index + 1).padStart(2, "0")}</div>

                  <div className="sa-election-identity">
                    <div className={`sa-election-phase is-${phase}`}>
                      <span aria-hidden="true" />
                      {electionPhaseLabel(phase)}
                    </div>
                    <p>{election.organizations?.name || "Organization unavailable"}</p>
                    <h3>{election.title || "Untitled Election"}</h3>
                    <div className="sa-election-control-meta">
                      <span>{resultVisibilityLabel(election.student_result_visibility, election.results_released_at)}</span>
                      <span>{getVotingAccessModeLabel(election.voting_access_mode)}</span>
                    </div>
                  </div>

                  <div className="sa-election-schedules">
                    <section>
                      <span>Campaign</span>
                      <strong>{electionScheduleValue(election.campaign_start)}</strong>
                      <p>to {electionScheduleValue(election.campaign_end)}</p>
                    </section>
                    <section className="is-voting">
                      <span>Voting</span>
                      <strong>{electionScheduleValue(election.start_date)}</strong>
                      <p>to {electionScheduleValue(election.end_date)}</p>
                    </section>
                  </div>

                  <div className="sa-election-actions">
                    <button type="button" className="sa-election-primary-action" onClick={() => openPositions(election)}>
                      Manage Setup
                    </button>
                    <button type="button" onClick={() => openEditForm(election)}>
                      <Pencil size={14} />
                      Edit
                    </button>
                    <button type="button" className="is-danger" onClick={() => handleDelete(election.id)}>
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {positionsOpen && selectedElection && (
        <PopupOverlay>
          <div className="modal-card max-w-4xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="field-label">Ballot Structure</p>
                <h2 className="text-2xl font-black">
                  {selectedElection.title}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Manage the positions available for this election.
                </p>
              </div>

              <button
                type="button"
                onClick={closePositions}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black">
                    {editingPosition ? "Edit Position" : "Add Position"}
                  </h3>
                  <p className="text-sm text-gray-500">
                    Define the position and maximum number of candidates a voter may select.
                  </p>
                </div>

                {editingPosition && (
                  <button
                    type="button"
                    onClick={openCreatePositionForm}
                    className="secondary-btn"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>

              <form
                onSubmit={handlePositionSubmit}
                className="mt-4 grid gap-4 md:grid-cols-[1fr_140px_140px_auto]"
              >
                <div>
                  <label className="field-label">Position Name</label>
                  <input
                    required
                    value={positionForm.name}
                    onChange={(e) =>
                      setPositionForm({
                        ...positionForm,
                        name: e.target.value,
                      })
                    }
                    placeholder="e.g. President"
                    className="field-shell w-full"
                  />
                </div>

                <div>
                  <label className="field-label">Max Votes</label>
                  <input
                    required
                    type="number"
                    min="1"
                    step="1"
                    value={positionForm.max_votes}
                    onChange={(e) =>
                      setPositionForm({
                        ...positionForm,
                        max_votes: e.target.value,
                      })
                    }
                    className="field-shell w-full"
                  />
                </div>

                <div>
                  <label className="field-label">Order</label>
                  <input
                    required
                    type="number"
                    min="1"
                    step="1"
                    value={positionForm.display_order}
                    onChange={(e) =>
                      setPositionForm({
                        ...positionForm,
                        display_order: e.target.value,
                      })
                    }
                    className="field-shell w-full"
                  />
                </div>

                <div className="flex items-end">
                  <button type="submit" className="primary-btn w-full">
                    {editingPosition ? "Save Changes" : "Add Position"}
                  </button>
                </div>
              </form>
            </div>

            <div className="mt-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black">Available Positions</h3>
                  <p className="text-sm text-gray-500">
                    {positions.length} position{positions.length !== 1 ? "s" : ""} configured.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={openCreatePositionForm}
                  className="secondary-btn"
                >
                  <Plus size={16} />
                  Add Position
                </button>
              </div>

              {positions.length === 0 ? (
                <div className="empty-state">
                  No positions configured for this election yet.
                </div>
              ) : (
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {positions.map((position) => (
                    <div
                      key={position.id}
                      className="position-card-tile position-card-tile-row"
                    >
                      <div>
                        <h4 className="text-lg font-black">
                          {position.name}
                        </h4>
                        <p className="mt-1 text-sm text-gray-500">
                          Voter can select up to{" "}
                          <span className="font-bold text-gray-800">
                            {position.max_votes}
                          </span>{" "}
                          candidate{position.max_votes !== 1 ? "s" : ""}.
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-700">
                          {position.max_votes} vote
                          {position.max_votes !== 1 ? "s" : ""}
                        </span>

                        <button
                          type="button"
                          onClick={() => openEditPositionForm(position)}
                          className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
                          title="Edit position"
                        >
                          <Pencil size={16} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeletePosition(position)}
                          className="p-2 rounded-lg bg-red-100 text-red-600 hover:bg-red-200"
                          title="Delete position"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={closePositions}
                className="secondary-btn"
              >
                Close
              </button>
            </div>
          </div>
        </PopupOverlay>
      )}

      {formOpen && (
        <PopupOverlay>
          <div className="modal-card election-form-dialog">
            <header className="election-form-header">
              <div>
                <p>Election record</p>
                <h2>{editingElection ? "Edit Election" : "Add Election"}</h2>
                <span>Define institutional ownership, schedule, and existing election controls.</span>
              </div>
              <button
                type="button"
                onClick={closeCoverForm}
                className="election-form-close"
                aria-label="Close election form"
              >
                <X size={20} />
              </button>
            </header>

            <form onSubmit={handleSubmit} className="election-form-workspace">
              {editingElection ? <p role="note">The academic term is permanent. {editLocks.settings ? "Frozen or released elections retain their organization, schedules and voting settings. Only permitted presentation fields remain editable." : "All changes remain subject to current permissions and election lifecycle rules."}</p> : null}
              <section className="election-form-section">
                <header>
                  <span>01</span>
                  <div>
                    <h3>Election identity</h3>
                    <p>Name the election and assign its responsible organization.</p>
                  </div>
                </header>
                <div className="election-form-fields">
              <div>
                <OrganizationSelect
                  disabled={editLocks.frozen || coverUploading || savingElection}
                  id="sa-election-organization"
                  required
                  organizations={organizations}
                  value={form.organization_id}
                  onChange={(organizationId) =>
                    setForm({ ...form, organization_id: organizationId })
                  }
                />
              </div>

              <div className="upload-shell">
                <div className="grid gap-4">
                  <ElectionCover
                    election={{ title: form.title || "Election", cover_url: form.cover_url }}
                    compact
                  />
                  <div className="min-w-0">
                    <label className="field-label">Election Cover Photo</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <label className="secondary-btn cursor-pointer">
                        <ImagePlus size={16} />
                        {form.cover_url ? "Change Cover" : "Add Cover"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          disabled={coverUploading || savingElection}
                          onChange={(event) => {
                            handleCoverUpload(event.target.files?.[0]);
                            event.target.value = "";
                          }}
                          className="sr-only"
                        />
                      </label>
                      {form.cover_url ? (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, cover_url: "" })}
                          disabled={coverUploading || savingElection}
                          className="secondary-btn"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <input
                      value={form.cover_url}
                      disabled={coverUploading || savingElection}
                      onChange={(event) =>
                        setForm({ ...form, cover_url: event.target.value })
                      }
                      placeholder="Cover image URL optional"
                      className="field-shell mt-3 w-full"
                    />
                    <p className="mt-2 text-xs font-semibold text-gray-500">
                      {coverUploading ? "Uploading cover..." : "Stored as a public image URL."}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="field-label">Election Title</label>
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Election Title"
                  className="field-shell w-full"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="sa-election-academic-term">Academic Term</label>
                <AcademicTermSelect
                  disabled={editLocks.term}
                  id="sa-election-academic-term"
                  required
                  value={form.academic_term_id}
                  onChange={(academicTermId) => setForm({ ...form, academic_term_id: academicTermId })}
                  className="field-shell w-full"
                />
              </div>
                </div>
              </section>

              <section className="election-form-section">
                <header>
                  <span>02</span>
                  <div>
                    <h3>Election schedule</h3>
                    <p>Campaign timing provides context; the voting window controls participation.</p>
                  </div>
                </header>
              <div className="grid gap-4 md:grid-cols-2">
                <ScheduleDateTimePicker
                  label="Campaign Start Date & Time"
                  disabled={editLocks.settings}
                  validationId="sa-election-campaign-start"
                  beforeField="#sa-election-campaign-end"
                  beforeLabel="campaign end"
                  beforeMessage="Campaign start must be before campaign end."
                  required={form.status !== "draft" && form.status !== "archived"}
                  value={form.campaign_start}
                  min={scheduleMin}
                  max={form.campaign_end || form.start_date}
                  onChange={(value) => setForm({ ...form, campaign_start: value })}
                />

                <ScheduleDateTimePicker
                  label="Campaign End Date & Time"
                  disabled={editLocks.settings}
                  validationId="sa-election-campaign-end"
                  afterField="#sa-election-campaign-start"
                  afterLabel="campaign start"
                  afterMessage="Campaign end must be after campaign start."
                  beforeField="#sa-election-voting-start"
                  beforeLabel="voting start"
                  beforeMessage="Campaign end must be before or equal to voting start."
                  beforeInclusive
                  required={form.status !== "draft" && form.status !== "archived"}
                  value={form.campaign_end}
                  min={form.campaign_start || scheduleMin}
                  max={form.start_date}
                  onChange={(value) => setForm({ ...form, campaign_end: value })}
                />

                <ScheduleDateTimePicker
                  label="Voting Start Date & Time"
                  disabled={editLocks.frozen}
                  validationId="sa-election-voting-start"
                  afterField="#sa-election-campaign-end"
                  afterLabel="campaign end"
                  afterMessage="Voting must start at or after campaign end."
                  afterInclusive
                  beforeField="#sa-election-voting-end"
                  beforeLabel="voting end"
                  beforeMessage="Voting must end after it starts."
                  required
                  value={form.start_date}
                  min={form.campaign_end || scheduleMin}
                  max={form.end_date}
                  onChange={(value) => setForm({ ...form, start_date: value })}
                />

                <ScheduleDateTimePicker
                  label="Voting End Date & Time"
                  disabled={editLocks.frozen}
                  validationId="sa-election-voting-end"
                  afterField="#sa-election-voting-start"
                  afterLabel="voting start"
                  afterMessage="Voting must end after it starts."
                  required
                  value={form.end_date}
                  min={form.start_date || form.campaign_end || scheduleMin}
                  onChange={(value) => setForm({ ...form, end_date: value })}
                />
              </div>
              </section>

              <section className="election-form-section">
                <header>
                  <span>03</span>
                  <div>
                    <h3>Operational settings</h3>
                    <p>Apply the existing lifecycle, result release, and voting access rules.</p>
                  </div>
                </header>
                <div className="election-form-settings">
                  <label>
                    <span className="field-label">Election Status</span>
                    <select
                      data-validation-dependents="#sa-election-campaign-start,#sa-election-campaign-end"
                      disabled={editLocks.settings}
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className="field-shell w-full"
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="closed">Closed</option>
                      <option value="archived">Archived</option>
                    </select>
                  </label>

                  <label>
                    <span className="field-label">Student Result Visibility</span>
                    <select
                      disabled={editLocks.visibility}
                      value={form.student_result_visibility}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          student_result_visibility: e.target.value,
                        })
                      }
                      className="field-shell w-full"
                    >
                      <option value="realtime">Real-time results</option>
                      <option value="after_close">Show after voting ends</option>
                      <option value="manual">Manual admin release</option>
                    </select>
                  </label>
                </div>

              <div className="election-form-access">
                <p className="field-label">Voting Access Rule</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <label>
                    <span className="sr-only">Voting access mode</span>
                    <select
                      data-validation-dependents="#sa-election-geo-lat,#sa-election-geo-lng,#sa-election-geo-radius"
                      disabled={editLocks.settings}
                      value={form.voting_access_mode}
                      onChange={(e) =>
                        setForm({ ...form, voting_access_mode: e.target.value })
                      }
                      className="field-shell w-full"
                    >
                      {VOTING_ACCESS_MODES.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="sr-only">Voting location label</span>
                    <input
                      disabled={editLocks.settings}
                      value={form.location_label}
                      onChange={(e) =>
                        setForm({ ...form, location_label: e.target.value })
                      }
                      placeholder="Location label optional"
                      className="field-shell w-full"
                    />
                  </label>
                </div>

                {form.voting_access_mode === "location_range" ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <input
                      id="sa-election-geo-lat"
                      aria-label="Latitude"
                      type="number"
                      step="any"
                      required={form.voting_access_mode === "location_range"}
                      disabled={editLocks.settings}
                      value={form.geo_lat}
                      onChange={(e) => setForm({ ...form, geo_lat: e.target.value })}
                      placeholder="Latitude"
                      className="field-shell w-full"
                    />
                    <input
                      id="sa-election-geo-lng"
                      aria-label="Longitude"
                      type="number"
                      step="any"
                      required={form.voting_access_mode === "location_range"}
                      disabled={editLocks.settings}
                      value={form.geo_lng}
                      onChange={(e) => setForm({ ...form, geo_lng: e.target.value })}
                      placeholder="Longitude"
                      className="field-shell w-full"
                    />
                    <input
                      id="sa-election-geo-radius"
                      aria-label="Radius in meters"
                      type="number"
                      min="1"
                      required={form.voting_access_mode === "location_range"}
                      disabled={editLocks.settings}
                      value={form.geo_radius_meters}
                      onChange={(e) =>
                        setForm({ ...form, geo_radius_meters: e.target.value })
                      }
                      placeholder="Radius in meters"
                      className="field-shell w-full"
                    />
                  </div>
                ) : null}
              </div>
              </section>

              {editingElection && form.voting_access_mode !== "anywhere" && form.voting_access_mode !== "location_range" ? (
                <section className="election-form-section election-token-section">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="field-label">Access Tokens / QR</p>
                      <p className="text-sm text-gray-500">
                        Generate QR-backed access tokens for this election.
                      </p>
                    </div>
                    <QrCode size={18} className="text-[#11806a]" />
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <select
                      value={tokenForm.scope_type}
                      onChange={(e) =>
                        setTokenForm({
                          ...tokenForm,
                          scope_type: e.target.value,
                          scope_value: e.target.value === "general" ? "" : tokenForm.scope_value,
                        })
                      }
                      className="field-shell w-full"
                    >
                      {TOKEN_SCOPE_TYPES.map((scope) => (
                        <option key={scope.value} value={scope.value}>
                          {scope.label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={tokenForm.scope_value}
                      onChange={(e) =>
                        setTokenForm({ ...tokenForm, scope_value: e.target.value })
                      }
                      placeholder="Scope value e.g. P1 or AM-BATCH"
                      disabled={tokenForm.scope_type === "general"}
                      className="field-shell w-full"
                    />
                    <input
                      type="datetime-local"
                      value={tokenForm.expires_at}
                      onChange={(e) =>
                        setTokenForm({ ...tokenForm, expires_at: e.target.value })
                      }
                      className="field-shell w-full"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleCreateAccessToken}
                    className="secondary-btn mt-4"
                  >
                    <Plus size={16} />
                    Generate Token
                  </button>

                  <div className="mt-4 space-y-3">
                    {accessTokens.length === 0 ? (
                      <div className="rounded-2xl bg-white/50 px-4 py-4 text-sm text-gray-500">
                        No tokens yet for this election.
                      </div>
                    ) : (
                      accessTokens.map((tokenRow) => (
                        <div
                          key={tokenRow.id}
                          className="rounded-2xl bg-white/55 p-4"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <p className="font-black tracking-[0.12em] text-[#102220]">
                                {tokenRow.token}
                              </p>
                              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[#55726b]">
                                {tokenRow.scope_type}
                                {tokenRow.scope_value ? ` • ${tokenRow.scope_value}` : ""}
                              </p>
                              <p className="mt-2 text-xs text-gray-500">
                                Expires: {formatLocalDateTime(tokenRow.expires_at)}
                              </p>
                              <p className="mt-1 text-xs text-gray-500">
                                Status: {tokenRow.is_active ? "Active" : "Inactive"}
                              </p>
                            </div>

                            <div className="flex items-start gap-4">
                              <img
                                src={getAccessQrImageUrl(tokenRow.token)}
                                alt={`QR for ${tokenRow.token}`}
                                className="h-24 w-24 rounded-2xl border border-[rgba(24,54,49,0.08)] bg-white p-2"
                              />
                              <button
                                type="button"
                                onClick={() => handleToggleToken(tokenRow)}
                                className="secondary-btn !w-auto !px-4 !py-2 text-sm"
                              >
                                <Power size={15} />
                                {tokenRow.is_active ? "Disable" : "Enable"}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              ) : null}

              <footer className="election-form-actions">
                <button type="button" className="secondary-btn" onClick={closeCoverForm}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn" disabled={savingElection || coverUploading}>
                  {savingElection ? "Saving..." : editingElection ? "Save Changes" : "Create Election"}
                </button>
              </footer>
            </form>
          </div>
        </PopupOverlay>
      )}

      {createdElection && (
        <PopupOverlay>
          <div className="modal-card election-success-dialog">
            <div className="election-success-mark">
              <CheckCircle2 size={28} />
            </div>
            <p className="field-label mt-5">Configuration Complete</p>
            <h2 className="mt-2 text-2xl font-black">Election created successfully</h2>
            <p className="mt-3 text-sm leading-6 text-gray-500">
              {createdElection.title} has been created. Continue configuring the ballot by adding positions and candidates.
            </p>
            {createdElection.reusedPositionCount > 0 ? (
              <p className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                {createdElection.reusedPositionCount} position
                {createdElection.reusedPositionCount === 1 ? "" : "s"} reused
                {createdElection.reusedFromElectionTitle
                  ? ` from ${createdElection.reusedFromElectionTitle}`
                  : ""}.
              </p>
            ) : null}
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setCreatedElection(null);
                  openEditForm(createdElection);
                }}
                className="secondary-btn justify-center"
              >
                View Election
              </button>
              <button
                type="button"
                onClick={() => {
                  const election = createdElection;
                  setCreatedElection(null);
                  openPositions(election);
                }}
                className="primary-btn justify-center"
              >
                Continue Setup
              </button>
            </div>
          </div>
        </PopupOverlay>
      )}

      {deleteReview ? <BoardElectionDeleteSheet
        key={deleteReview.id}
        election={deleteReview.election}
        orgName={deleteReview.election?.organizations?.name || "All organizations"}
        phase={deleteReview.phase}
        analysis={deleteReview.analysis}
        mode={deleteReview.mode}
          removalReady={removalReady}
        error={deleteReview.error}
        onClose={closeElectionRemovalReview}
        onRetry={() => handleDelete(deleteReview.id)}
        onContinue={() => { if (removalReady) setDeleteReview((current) => ({ ...current, phase: "danger_zone" })); }}
        onConfirm={confirmElectionChange}
      /> : null}
    </div>
  );
}

export default Elections;
