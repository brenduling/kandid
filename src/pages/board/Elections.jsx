import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Plus, Pencil, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { currentDateTimeInputValue } from "../../components/ScheduleDateTimePicker";
import BoardElectionSetup from "./BoardElectionSetup";
import BoardElectionWorkspace from "./BoardElectionWorkspace";
import BoardElectionDeleteSheet from "./BoardElectionDeleteSheet";
import { electionPhaseLabel, formatElectionSchedule } from "./electionDisplay";
import { buildElectionPhaseSummary } from "./electionPhaseSummary";
import "./Elections.css";
import { supabase } from "../../lib/supabaseClient";
import { loadElectionForEdit, saveElectionEdit, electionSaveError } from "../../utils/electionEditContract";
import { electionEditBlockReason } from "../../utils/electionEditingEnvironment";
import { createElectionSubmission } from "../../utils/electionCreateContract";
import { electionManagementQuery, verifyElectionRemovalReadiness } from "../../utils/electionManagementCompatibility";
import { isElectionSoftRemovalEnabled } from "../../utils/electionRemovalFeatureGate";
import { useElectionClock } from "../../utils/useElectionClock";
import {
  formValueToScheduleTimestamp,
  getElectionPhase,
  isMissingElectionCoverColumn,
  scheduleTimestampToFormValue,
  validateElectionSchedule,
} from "../../utils/elections";
import { uploadElectionCover, electionCoverError } from "../../utils/electionCovers";
import {
  generateAccessToken,
  getVotingAccessModeLabel,
} from "../../utils/votingAccess";
import { usePrompt } from "../../context/PromptContext";
import { toBoardFacingError } from "../../utils/boardFeedback";
import { logAuditEvent } from "../../utils/auditLog";
import { loadElectionDeleteReview } from "../../utils/electionDeleteReview";
import { callElectionRemoval, electionRemovalErrorMessage } from "../../utils/electionRemoval";
import { copyLatestOrganizationPositions } from "../../utils/positionReuse";
import { assertElectorateSchedulingReady } from "../../utils/electorateFinalization";
import { isAutomaticVoterEligibilityEnabled } from "../../utils/automaticVoterEligibility";
import {
  isResultVisibilityConstraintError,
  resultVisibilityLabel,
  serializeResultVisibilityForDatabase,
  serializeResultVisibilityForLegacyDatabase,
} from "../../utils/results";

function BoardElections() {
  const prompt = usePrompt();
  const now = useElectionClock();
  const [searchParams] = useSearchParams();
  const [elections, setElections] = useState([]);
  const [expandedElectionSchedules, setExpandedElectionSchedules] = useState({});
  const [accessTokens, setAccessTokens] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [workspaceElection, setWorkspaceElection] = useState(null);
  /* Danger Zone delete review state. One sheet, four states, and the phase is
     only ever set from the guard's own result. */
  const [deleteReview, setDeleteReview] = useState(null);
  const [removalReady, setRemovalReady] = useState(false);
  const [removalUnavailable, setRemovalUnavailable] = useState(false);
  const [removedView, setRemovedView] = useState(false);
  const [removedElections, setRemovedElections] = useState([]);
  const [removedTotal, setRemovedTotal] = useState(0);
  const [removedOffset, setRemovedOffset] = useState(0);
  const [removedError, setRemovedError] = useState("");
  const deleteReviewRequest = useRef(0);
  const deleteInFlight = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const saveInFlight = useRef(false);
  const createSubmission = useRef(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const coverUploadRequest = useRef(0);
  const coverUploadBusy = useRef(false);
  /* Covers that failed to resolve. A missing or broken cover leaves an empty
     ruled cell; the record is carried entirely by its name, phase, schedule and
     actions, so it stays readable in every one of those cases, and no stand-in
     image is generated. */
  const [brokenCovers, setBrokenCovers] = useState({});
  const [tokenForm, setTokenForm] = useState({
    scope_type: "general",
    scope_value: "",
    expires_at: "",
  });
  const [form, setForm] = useState({
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

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;
  const orgName = user?.organizations?.name;
  const searchQuery = (searchParams.get("q") || "").trim().toLowerCase();
  const scheduleMin = editing ? "" : currentDateTimeInputValue();
  const editBlockReason = electionEditBlockReason(import.meta.env);

  useEffect(() => {
    let active = true;

    async function loadElections() {
      if (!orgId) {
        setLoadError("No organization is assigned to this Electoral Board account.");
        setElections([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError("");

      const requested = isElectionSoftRemovalEnabled();
      const ready = await verifyElectionRemovalReadiness(requested, callElectionRemoval);
      if (!active) return;
      setRemovalReady(ready);
      setRemovalUnavailable(requested && !ready);
      if (!ready) setRemovedView(false);
      const { data, error } = await electionManagementQuery(supabase, { organizationId: orgId, removalReady: ready });

      if (!active) return;

      if (error) {
        console.error("Failed to load board elections:", error);
        setLoadError(toBoardFacingError(error.message, "Unable to load elections."));

        setLoading(false);
        return;
      }

      setElections(data || []);
      setLoading(false);
    }

    loadElections();

    return () => {
      active = false;
    };
  }, [orgId]);

  async function refreshElections() {
    if (!orgId) {
      setLoadError("No organization is assigned to this Electoral Board account.");
      setElections([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError("");

    const requested = isElectionSoftRemovalEnabled();
    const ready = await verifyElectionRemovalReadiness(requested, callElectionRemoval);
    setRemovalReady(ready);
    setRemovalUnavailable(requested && !ready);
    if (!ready) setRemovedView(false);
    const { data, error } = await electionManagementQuery(supabase, { organizationId: orgId, removalReady: ready });

    if (error) {
      console.error("Failed to refresh board elections:", error);
      setLoadError(toBoardFacingError(error.message, "Unable to load elections."));

      setLoading(false);
      return;
    }

    setElections(data || []);
    setLoading(false);
  }

  function openCreate() {
    coverUploadRequest.current++;
    coverUploadBusy.current = false;
    setCoverUploading(false);
    createSubmission.current = createElectionSubmission(supabase);
    setEditing(null);
    setForm({
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

  async function openEdit(election) {
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
    setEditing(election);
    setForm({
      title: election.title || "",
      academic_term_id: election.academic_term_id ?? "",
      cover_url: election.cover_url || "",
      campaign_start: election.campaign_start
        ? scheduleTimestampToFormValue(election.campaign_start)
        : "",
      campaign_end: election.campaign_end
        ? scheduleTimestampToFormValue(election.campaign_end)
        : "",
      start_date: election.start_date ? scheduleTimestampToFormValue(election.start_date) : "",
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

    if (editing && editBlockReason) {
      prompt.info(editBlockReason);
      return;
    }

    if (saveInFlight.current) return;
    if (coverUploadBusy.current) return;

    if (!orgId) {
      prompt.error("No organization is assigned to this Electoral Board account.");
      return;
    }

    if (!form.academic_term_id) {
      prompt.error("Choose the academic term this election belongs to.");
      return;
    }

    saveInFlight.current = true;
    setSubmitting(true);
    try {

    const validationMessage = validateElectionSchedule({
      ...form,
      academic_term_id: Number(form.academic_term_id),
      organization_id: orgId,
    });
    if (validationMessage) {
      prompt.error(validationMessage);
      setSubmitting(false);
      return;
    }

    const payload = {
      ...form,
      academic_term_id: Number(form.academic_term_id),
      cover_url: form.cover_url || null,
      campaign_start: formValueToScheduleTimestamp(form.campaign_start),
      campaign_end: formValueToScheduleTimestamp(form.campaign_end),
      start_date: formValueToScheduleTimestamp(form.start_date),
      end_date: formValueToScheduleTimestamp(form.end_date),
      organization_id: orgId,
      student_result_visibility: serializeResultVisibilityForDatabase(
        form.student_result_visibility,
      ),
      location_label: form.location_label || null,
      geo_lat: form.geo_lat === "" ? null : Number(form.geo_lat),
      geo_lng: form.geo_lng === "" ? null : Number(form.geo_lng),
      geo_radius_meters:
        form.geo_radius_meters === "" ? null : Number(form.geo_radius_meters),
    };

    const saveElection = (nextPayload) =>
      editing
        ? saveElectionEdit(supabase, editing, nextPayload)
        : (createSubmission.current ||= createElectionSubmission(supabase))(nextPayload, orgId);

    try {
      if (!isAutomaticVoterEligibilityEnabled(import.meta.env)) {
        await assertElectorateSchedulingReady(supabase, editing, payload);
      }
    } catch (readinessError) {
      prompt.error(readinessError.message || "Automatic electorate finalization is not ready. The election was not saved.");
      setSubmitting(false);
      return;
    }

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

    if (isMissingElectionCoverColumn(result.error)) {
      const payloadWithoutCover = { ...payload };
      delete payloadWithoutCover.cover_url;
      result = await saveElection(payloadWithoutCover);
      if (!result.error) {
        prompt.info(
          "Election saved without a cover. Apply the election cover migration in Supabase to enable cover photos.",
        );
      }
    }

    if (result.error) {
      console.error("Board election save failed:", result.error);
      prompt.error(
        isResultVisibilityConstraintError(result.error) && form.student_result_visibility === "manual"
          ? "Manual admin release requires the updated result visibility schema in Supabase."
          : electionSaveError(result.error)
      );
      setSubmitting(false);
      return;
    }

    if (result.unchanged) {
      prompt.info("No changes to save.");
      return;
    }
    let reusedPositions = { copiedCount: 0, sourceElection: null };

    if (editing) {
      prompt.success("Election updated.");
    } else if (result?.data?.id) {
      reusedPositions = await copyLatestOrganizationPositions(supabase, {
        organizationId: orgId,
        targetElectionId: result.data.id,
      });

      if (reusedPositions.error) {
        console.warn("Unable to reuse previous election positions:", reusedPositions.error);
      }
    }
    await logAuditEvent({
      action: editing ? "election_updated" : "election_created",
      entityType: "election",
      entityId: result?.data?.id || editing?.id,
      entityLabel: payload.title,
      organizationId: orgId,
      organizationName: orgName,
      status: "completed",
      metadata: {
        election_status: payload.status,
        voting_access_mode: payload.voting_access_mode,
      },
    });
    setFormOpen(false);
    setSubmitting(false);
    await refreshElections();

    if (!editing && result?.data?.id) {
      prompt.success("Election created successfully");
      setWorkspaceElection({
        ...payload,
        id: result.data.id,
        reusedPositionCount: reusedPositions.copiedCount || 0,
        reusedFromElectionTitle: reusedPositions.sourceElection?.title || "",
      });
    }
    } catch (error) { prompt.error(electionSaveError(error)); } finally { saveInFlight.current = false; setSubmitting(false); }
  }

  async function handleCoverUpload(file) {
    if (!file || coverUploadBusy.current || saveInFlight.current) return;
    if (editing && editBlockReason) {
      prompt.info(editBlockReason);
      return;
    }

    const request = ++coverUploadRequest.current;
    coverUploadBusy.current = true;
    setCoverUploading(true);
    try {
      const publicUrl = await uploadElectionCover(supabase, file, {
        organizationId: orgId,
        electionId: editing?.id ?? null,
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
    if (!editing) return;

    const token = generateAccessToken();
    const payload = {
      election_id: editing.id,
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
    await fetchAccessTokens(editing.id);
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
    await fetchAccessTokens(editing.id);
  }

  useEffect(() => () => { deleteReviewRequest.current += 1; }, [orgId]);

  function closeDeleteReview() {
    if (deleteInFlight.current) return;
    deleteReviewRequest.current += 1;
    setDeleteReview(null);
  }

  /* Merely inspecting dependencies is read-only. Ignore responses belonging to
     a closed dialog, another election, or an earlier organization context. */
  async function handleDelete(id) {
    if (deleteInFlight.current) return;
    const request = ++deleteReviewRequest.current;
    const election = elections.find((item) => item.id === id) || {};
    setDeleteReview({ id, election, phase: "reviewing", analysis: null });

    const analysis = await loadElectionDeleteReview(id, removalReady ? callElectionRemoval : undefined, { removalReady });
    if (request !== deleteReviewRequest.current) return;

    if (analysis.severity === "unavailable") {
      setDeleteReview({ id, election, phase: "unavailable", analysis });
      return;
    }

    setDeleteReview({ id, election, phase: "review", analysis, mode: "remove", error: "" });
  }

  // Future soft removal requires both explicit opt-in and verified backend
  // compatibility. Its server independently rechecks password, scope and phase.
  async function confirmDelete(password) {
    if (!removalReady || deleteInFlight.current || deleteReview?.phase !== "danger_zone" || !password) return;
    deleteInFlight.current = true;
    const { id, election } = deleteReview;

    try {
      setDeleteReview((current) => ({ ...current, phase: "removing", error: "" }));
      const { data, error } = await callElectionRemoval("soft_remove", { election_id: Number(id), password });
      if (error || data?.removed !== true) throw error || new Error("Removal was not confirmed.");
      prompt.success("Election removed. Related records remain preserved.");
      setDeleteReview(null);
      await refreshElections();
    } catch (error) {
      setDeleteReview((current) => ({ ...current, id, election, phase: "danger_zone", error: electionRemovalErrorMessage(error) }));
    } finally {
      deleteInFlight.current = false;
    }
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

  async function confirmRestore(password) {
    if (!removalReady || deleteInFlight.current || deleteReview?.phase !== "danger_zone" || !password) return;
    deleteInFlight.current = true;
    const { id, election } = deleteReview;
    try {
      setDeleteReview((current) => ({ ...current, phase: "restoring", error: "" }));
      const { data, error } = await callElectionRemoval("restore", { election_id: Number(id), password });
      if (error || data?.restored !== true) throw error || new Error("Restoration was not confirmed.");
      setDeleteReview(null);
      prompt.success("Election restored to the normal management list.");
      await refreshElections();
      await openRemovedElections(removedOffset);
    } catch (error) {
      setDeleteReview((current) => ({ ...current, id, election, mode: "restore", phase: "danger_zone", error: electionRemovalErrorMessage(error) }));
    } finally {
      deleteInFlight.current = false;
    }
  }

  const filteredElections = useMemo(() => {
    if (!searchQuery) return elections;

    return elections.filter((election) => {
      const values = [
        election.title,
        election.status,
        getElectionPhase(election, now),
        getVotingAccessModeLabel(election.voting_access_mode),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return values.includes(searchQuery);
    });
  }, [elections, searchQuery, now]);

  const phaseSummary = useMemo(
    () => buildElectionPhaseSummary(filteredElections, (election) => getElectionPhase(election, now)),
    [filteredElections, now],
  );

  /* Display copy for the phase the lifecycle logic actually returned. The stored
     value from getElectionPhase() is unchanged and stays on the title attribute,
     so no status is introduced, renamed or reinterpreted here. The same label is
     used by the register and the Manage Setup workspace. */
  function phaseLabel(election) {
    return electionPhaseLabel(election, now);
  }

  /* Field updates arrive as a patch from the guided setup sheet so it can never
     hold a stale copy of the form object. The resulting state is identical to the
     previous per-field setForm({ ...form, key: value }). */
  function updateForm(patch) {
    setForm((previous) => ({ ...previous, ...patch }));
  }

  function updateTokenForm(patch) {
    setTokenForm((previous) => ({ ...previous, ...patch }));
  }

  /* Manage Setup is a workspace for the selected election. It performs no
     queries and no writes; each of its actions is one of the navigations or
     handlers the register already uses. */
  function openWorkspace(election) {
    setWorkspaceElection(election);
  }

  return (
    <div className="board-elections-desktop">
      <header className="board-elections-masthead">
        <div className="board-elections-context">
          <span className="board-elections-eyebrow">Electoral Board / {orgName}</span>
          <span className="board-elections-context-rule" aria-hidden="true" />
        </div>

        <div className="board-elections-baseline">
          <h1 className="page-title board-elections-title">Elections</h1>
          <div className="board-elections-header-actions">
          <button
            type="button"
            onClick={openCreate}
            className="board-elections-create"
          >
            <Plus size={15} aria-hidden="true" />
            Create Election
          </button>
          {removalReady ? <button type="button" className="board-election-action is-quiet" onClick={() => openRemovedElections()}>
            Removed Elections
          </button> : null}
          </div>
        </div>

        <p className="board-elections-standfirst">
          Create and manage elections for {orgName}.
        </p>
      </header>

      {removalUnavailable ? <div role="status"><p>Soft removal is unavailable. The existing election register remains available.</p><button type="button" className="board-elections-state-action" onClick={refreshElections}>Retry readiness check</button></div> : null}
      <section className="board-elections-summary" aria-label="Election summary">
        <dl
          className="board-elections-snapshot"
          style={{ "--board-elections-summary-columns": phaseSummary.metrics.length + 1 }}
          data-metric-count={phaseSummary.metrics.length + 1}
        >
          <div className="board-elections-snapshot-total">
            <dd data-unavailable={Boolean(loadError)}>{loading ? "Loading" : loadError ? "Unavailable" : filteredElections.length}</dd>
            <dt>Elections</dt>
          </div>
          {phaseSummary.metrics.map(({ phase, label, count }) => (
            <div className="board-elections-snapshot-state" data-phase={phase} key={phase}>
              <dd>{loading ? "…" : loadError ? "—" : count}</dd>
              <dt>{label}</dt>
            </div>
          ))}
        </dl>
      </section>

      {removalReady && removedView ? (
        <section className="board-elections-register" aria-label="Removed elections">
          <div className="board-elections-register-head">
            <div><p className="board-elections-section-kicker">Preserved register</p><h2>Removed Elections</h2></div>
            <button type="button" className="board-elections-state-action" onClick={() => setRemovedView(false)}>Back to Elections</button>
          </div>
          {removedError ? <p className="board-election-removal-error" role="alert">{removedError}</p> : null}
          {removedElections.length === 0 && !removedError ? <p className="board-elections-state-copy">No removed elections are available in this organization.</p> : null}
          <div className="board-elections-list">
            {removedElections.map((election) => <article className="board-election-record" key={election.id}>
              <div className="board-election-identity-copy"><h3>{election.title || "Untitled Election"}</h3><p>{election.status} · Removed {election.removed_at ? new Date(election.removed_at).toLocaleString() : ""}</p></div>
              <button type="button" className="board-election-action is-quiet" onClick={() => setDeleteReview({ id: election.id, election, phase: "danger_zone", mode: "restore", analysis: null, error: "" })}>Restore</button>
            </article>)}
          </div>
          <div className="board-election-danger-footer" aria-label="Removed election pages">
            <button type="button" className="board-election-danger-quiet" onClick={() => openRemovedElections(Math.max(0, removedOffset - 50))} disabled={removedOffset === 0}>Previous</button>
            <span>{removedTotal ? `${removedOffset + 1}–${Math.min(removedOffset + removedElections.length, removedTotal)} of ${removedTotal}` : "0 removed elections"}</span>
            <button type="button" className="board-election-danger-quiet" onClick={() => openRemovedElections(removedOffset + 50)} disabled={removedOffset + 50 >= removedTotal}>Next</button>
          </div>
        </section>
      ) : loading ? (
        <div className="board-elections-skeleton" role="status" aria-label="Loading elections" aria-busy="true">
          {[0, 1, 2, 3].map((row) => (
            <div className="board-elections-skeleton-row" key={row}>
              <span className="is-cover" />
              <span className="is-title" />
              <span className="is-schedule" />
              <span className="is-phase" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="board-elections-state is-error" role="alert">
          <p className="board-elections-state-kicker">Register unavailable</p>
          <h3>Unable to load elections.</h3>
          <p className="board-elections-state-copy">{loadError}</p>
          <button type="button" onClick={refreshElections} className="board-elections-state-action">
            Retry
          </button>
        </div>
      ) : filteredElections.length === 0 ? (
        <div className="board-elections-state">
          <p className="board-elections-state-kicker">
            {searchQuery ? "No matches" : "Empty register"}
          </p>
          <h3>{searchQuery ? "No elections match your search." : "No elections yet."}</h3>
          <p className="board-elections-state-copy">
            {searchQuery
              ? "Try a different title, status or voting access rule."
              : `Create an election to start configuring positions, candidates and the ballot for ${orgName}.`}
          </p>
        </div>
      ) : (
        <section className="board-elections-register" aria-label="Election records">
          <div className="board-elections-register-head">
            <div>
              <p className="board-elections-section-kicker">Election register</p>
              <h2>Election records</h2>
            </div>
            <span className="board-elections-register-count">
              <strong>{filteredElections.length}</strong>{" "}
              {searchQuery ? "matching" : "shown"}
            </span>
          </div>

            <div className="board-elections-register-columns" aria-hidden="true">
              <span>Election</span>
              <span>Campaign</span>
              <span>Voting</span>
              <span>Phase</span>
              <span className="board-elections-head-actions">Actions</span>
            </div>

          <div className="board-elections-list">
            {filteredElections.map((election, position) => {
              const phase = phaseSummary.phasesByElectionId.get(election.id) || getElectionPhase(election, now);
              const coverFailed = brokenCovers[election.id] === election.cover_url;
              const hasCover = Boolean(election.cover_url) && !coverFailed;

              /* Read-only display formatting over the stored timestamps. Only the
                 campaign timestamps the record actually holds are used, so a
                 single campaign value is never given an invented end. */
              const campaignSchedule = formatElectionSchedule(
                election.campaign_start,
                election.campaign_end,
              );
              const votingSchedule = formatElectionSchedule(
                election.start_date,
                election.end_date,
              );
              const scheduleDetails = (
                <>
                  <dl
                    className="board-election-window"
                    data-absent={campaignSchedule.time ? undefined : "yes"}
                  >
                    <dt>Campaign</dt>
                    <dd>
                      <span className="board-election-when">
                        <span className="board-election-when-date">
                          {campaignSchedule.date}
                        </span>
                        <span className="board-election-when-time">
                          {campaignSchedule.time}
                        </span>
                      </span>
                    </dd>
                  </dl>

                  <dl
                    className="board-election-window"
                    data-absent={votingSchedule.time ? undefined : "yes"}
                  >
                    <dt>Voting</dt>
                    <dd>
                      <span className="board-election-when">
                        <span className="board-election-when-date">
                          {votingSchedule.date}
                        </span>
                        <span className="board-election-when-time">
                          {votingSchedule.time}
                        </span>
                      </span>
                    </dd>
                  </dl>
                </>
              );

              return (
                <article
                  key={election.id}
                  className="board-election-record"
                  data-phase={phase}
                >
                  <div className="board-election-mobile-head">
                    <div className="board-election-identity">
                      <span className="board-election-index" aria-hidden="true">
                        {String(position + 1).padStart(2, "0")}
                      </span>

                      <span
                        className={`board-election-cover${hasCover ? "" : " is-empty"}`}
                        aria-hidden="true"
                      >
                        {hasCover && (
                          <img
                            src={election.cover_url}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onError={() =>
                              setBrokenCovers((current) => ({
                                ...current,
                                [election.id]: election.cover_url,
                              }))
                            }
                          />
                        )}
                      </span>

                      <div className="board-election-identity-copy">
                        <h3>{election.title || "Untitled Election"}</h3>
                        <p className="board-election-config-line">
                          {resultVisibilityLabel(
                            election.student_result_visibility,
                            election.results_released_at,
                          )}
                          <span className="board-election-config-divider" aria-hidden="true" />
                          {getVotingAccessModeLabel(election.voting_access_mode)}
                        </p>
                      </div>
                    </div>

                    <div className="board-election-standing">
                      <span className="board-election-phase" title={`Election phase: ${phase}`}>
                        {phaseLabel(election)}
                      </span>
                    </div>
                  </div>

                  {/* Desktop keeps the schedule values in their register columns.
                      Mobile uses the native disclosure below so long schedules
                      do not expand every election row by default.

                      Each window keeps exactly the date and time the formatter
                      returned for it, so a cross-day range stays two dates and
                      never merges into the label or the neighbouring column. The
                      separator the earlier inline prose treatment needed is gone
                      with that treatment.

                      data-absent marks a window with no timestamps at all. The
                      formatter returns the absent marker "-" as the date then,
                      which reads as a stray dash in a column, and an empty time
                      already says the window is unset, so the marker is dropped
                      on this layout only. */}
                  <div className="board-election-schedules is-desktop-schedule">
                    {scheduleDetails}
                  </div>

                  <div className="board-election-mobile-utility-row">
                    <details
                      className="board-election-schedule-disclosure"
                      open={Boolean(expandedElectionSchedules[election.id])}
                      onToggle={(event) => {
                        const expanded = event.currentTarget.open;
                        setExpandedElectionSchedules((current) =>
                          current[election.id] === expanded
                            ? current
                            : { ...current, [election.id]: expanded },
                        );
                      }}
                    >
                      <summary
                        aria-expanded={Boolean(expandedElectionSchedules[election.id])}
                        aria-controls={`election-schedule-${election.id}`}
                      >
                        <span>Schedule</span>
                      </summary>
                      <div
                        className="board-election-schedules"
                        id={`election-schedule-${election.id}`}
                      >
                        {scheduleDetails}
                      </div>
                    </details>

                    <div className="board-election-record-actions">
                      <button
                        type="button"
                        onClick={() => openWorkspace(election)}
                        className="board-election-action is-manage"
                        title={`Manage election ${election.title || ""}`.trim()}
                        aria-label={`Manage election ${election.title || ""}`.trim()}
                      >
                        Manage
                        <ArrowRight
                          size={14}
                          strokeWidth={2.5}
                          aria-hidden="true"
                          className="board-election-action-arrow"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(election)}
                        className="board-election-action is-quiet"
                        title={`Edit election ${election.title || ""}`.trim()}
                        aria-label={`Edit election ${election.title || ""}`.trim()}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(election.id)}
                        className="board-election-action is-danger"
                        title={`Delete election ${election.title || ""}`.trim()}
                        aria-label={`Delete election ${election.title || ""}`.trim()}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {formOpen && (
        <BoardElectionSetup
          editing={editing}
          saveBlockedReason={editing ? editBlockReason : ""}
          onElectorateLocked={(lockResult) => {
            setEditing((current) => current ? { ...current, electorate_frozen_at: lockResult?.locked_at } : current);
          }}
          form={form}
          updateForm={updateForm}
          onSubmit={handleSubmit}
          submitting={submitting}
          onClose={() => {
            coverUploadRequest.current++;
            coverUploadBusy.current = false;
            setCoverUploading(false);
            setFormOpen(false);
          }}
          coverUploading={coverUploading}
          onCoverUpload={handleCoverUpload}
          scheduleMin={scheduleMin}
          accessTokens={accessTokens}
          tokenForm={tokenForm}
          updateTokenForm={updateTokenForm}
          onCreateAccessToken={handleCreateAccessToken}
          onToggleToken={handleToggleToken}
        />
      )}

      {workspaceElection && (
        <BoardElectionWorkspace
          election={workspaceElection}
          orgName={orgName}
          onClose={() => setWorkspaceElection(null)}
          onEdit={() => {
            setWorkspaceElection(null);
            openEdit(workspaceElection);
          }}
          onDelete={() => {
            setWorkspaceElection(null);
            handleDelete(workspaceElection.id);
          }}
        />
      )}

      {deleteReview && (
        <BoardElectionDeleteSheet
          key={deleteReview.id}
          election={deleteReview.election}
          orgName={orgName}
          phase={deleteReview.phase}
          analysis={deleteReview.analysis}
          mode={deleteReview.mode}
          removalReady={removalReady}
          error={deleteReview.error}
          onClose={closeDeleteReview}
          onRetry={() => handleDelete(deleteReview.id)}
          onContinue={() => { if (removalReady) setDeleteReview((current) => ({ ...current, phase: "danger_zone" })); }}
          onConfirm={deleteReview.mode === "restore" ? confirmRestore : confirmDelete}
        />
      )}

    </div>
  );
}

export default BoardElections;
