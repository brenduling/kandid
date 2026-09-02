import { useEffect, useState } from "react";
import { CheckCircle2, Plus, Pencil, Trash2, X, QrCode, Power, ImagePlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import PopupOverlay from "../../components/PopupOverlay";
import ElectionCover from "../../components/ElectionCover";
import ElectionManagementCard from "../../components/ElectionManagementCard";
import OrganizationSelect from "../../components/OrganizationSelect";
import ScheduleDateTimePicker, {
  currentDateTimeInputValue,
} from "../../components/ScheduleDateTimePicker";
import { supabase } from "../../lib/supabaseClient";
import {
  formatLocalDateTime,
  formValueToScheduleTimestamp,
  getElectionPhase,
  isMissingElectionCoverColumn,
  scheduleTimestampToFormValue,
  validateElectionSchedule,
} from "../../utils/elections";
import { uploadPublicImage } from "../../utils/files";
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

function Elections() {
  const prompt = usePrompt();
  const navigate = useNavigate();
  const [elections, setElections] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [accessTokens, setAccessTokens] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [createdElection, setCreatedElection] = useState(null);
  const [editingElection, setEditingElection] = useState(null);

  // Position management for the selected election
  const [positions, setPositions] = useState([]);
  const [positionsOpen, setPositionsOpen] = useState(false);
  const [selectedElection, setSelectedElection] = useState(null);
  const [editingPosition, setEditingPosition] = useState(null);
  const [coverUploading, setCoverUploading] = useState(false);
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
    const { data, error } = await supabase
      .from("elections")
      .select(`
        *,
        organizations (
          name,
          logo_url
        )
      `)
      .order("created_at", { ascending: false });

    if (!error) setElections(data || []);
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
        prompt.error(error.message || "Failed to update position.");
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
        prompt.error(error.message || "Failed to create position.");
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
    setEditingElection(null);
    setForm({
      organization_id: "",
      title: "",
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
    setEditingElection(election);
    setForm({
      organization_id: election.organization_id || "",
      title: election.title || "",
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
      geo_lat: election.geo_lat ?? "",
      geo_lng: election.geo_lng ?? "",
      geo_radius_meters: election.geo_radius_meters ?? "",
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

    const validationMessage = validateElectionSchedule(form);
    if (validationMessage) {
      prompt.error(validationMessage);
      return;
    }

    const payload = {
      organization_id: Number(form.organization_id),
      title: form.title,
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
        ? supabase
            .from("elections")
            .update(nextPayload)
            .eq("id", editingElection.id)
            .select("id")
            .single()
        : supabase.from("elections").insert([nextPayload]).select("id").single();

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
          : error.message || "Failed to save election."
      );
      return;
    }

    const organization = organizations.find(
      (org) => String(org.id) === String(payload.organization_id),
    );

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
  }

  async function handleCoverUpload(file) {
    if (!file) return;

    setCoverUploading(true);
    try {
      const publicUrl = await uploadPublicImage(supabase, file, {
        bucket: "election-covers",
        folder: "covers",
      });
      setForm((currentForm) => ({ ...currentForm, cover_url: publicUrl }));
      prompt.success("Election cover uploaded.");
    } catch (error) {
      console.error("Election cover upload failed:", error);
      prompt.error(
        `${error.message || "Failed to upload cover image."} Make sure the election-covers storage bucket migration is applied.`,
      );
    } finally {
      setCoverUploading(false);
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
    const election = elections.find((item) => item.id === id) || {};
    const analysis = await analyzeDeleteDependencies("election", { id });

    if (analysis.blocked) {
      await logAuditEvent({
        action: "election_delete_blocked",
        entityType: "election",
        entityId: id,
        entityLabel: election.title || "Election",
        organizationId: election.organization_id,
        organizationName: election.organizations?.name,
        status: "requires_action",
        metadata: { dependencies: analysis.dependencies },
      });

      await prompt.alert({
        title: analysis.severity === "archive" ? "Archive Recommended" : "Election Cannot Be Deleted Yet",
        message: dependencyMessage(election.title || "This election", analysis),
        type: "warning",
        confirmText: "Review Related Records",
      });
      return;
    }

    const confirmDelete = await prompt.confirm({
      title: "Delete Election?",
      message: dependencyMessage(election.title || "This election", analysis),
      type: "danger",
      confirmText: "Delete Election",
    });
    if (!confirmDelete) return;

    const recheck = await analyzeDeleteDependencies("election", { id });
    if (recheck.blocked) {
      prompt.error(dependencyMessage(election.title || "This election", recheck));
      return;
    }

    const { error } = await supabase.from("elections").delete().eq("id", id);
    if (error) {
      prompt.error(error.message || "Failed to delete election.");
      return;
    }
    prompt.success("Election deleted.");
    await logAuditEvent({
      action: "election_deleted",
      entityType: "election",
      entityId: id,
      entityLabel: election.title || "Election",
      organizationId: election.organization_id,
      organizationName: election.organizations?.name,
      status: "completed",
    });
    fetchElections();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Election Setup</div>
          <h1 className="page-title">
            Election lifecycle
            <span className="page-title-accent"> management</span>
          </h1>
          <p className="page-subtitle">
            Create and manage elections across organizations.
          </p>
        </div>

        <button
          onClick={openCreateForm}
          className="primary-btn self-start lg:self-auto"
        >
          <Plus size={18} />
          Add Election
        </button>
      </div>

      {elections.length === 0 ? (
        <div className="empty-state mt-8">No elections found.</div>
      ) : (
        <div className="election-management-grid mt-8">
          {elections.map((election) => (
            <article key={election.id} className="entity-card">
              <ElectionManagementCard
                election={election}
                eyebrow="Election Setup"
                onClick={() => openPositions(election)}
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <span className="status-pill">{getElectionPhase(election)}</span>
                <span className="status-pill">
                  {resultVisibilityLabel(
                    election.student_result_visibility,
                    election.results_released_at,
                  )}
                </span>
                <span className="status-pill">
                  {getVotingAccessModeLabel(election.voting_access_mode)}
                </span>
              </div>

              <div className="mt-4 grid gap-2 text-sm text-[#5f6f86]">
                <p><span className="font-black text-[#111827]">Campaign:</span> {formatLocalDateTime(election.campaign_start)}</p>
                <p><span className="font-black text-[#111827]">Voting:</span> {formatLocalDateTime(election.start_date)} - {formatLocalDateTime(election.end_date)}</p>
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => openPositions(election)} className="secondary-btn !px-3 !py-2 text-xs">
                  Manage Setup
                </button>
                <button type="button" onClick={() => openEditForm(election)} className="icon-action">
                  <Pencil size={16} />
                </button>
                <button type="button" onClick={() => handleDelete(election.id)} className="icon-action icon-action-danger">
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

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
          <div className="modal-card max-w-xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black">
                {editingElection ? "Edit Election" : "Add Election"}
              </h2>

              <button
                onClick={() => setFormOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <OrganizationSelect
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
                          accept="image/*"
                          disabled={coverUploading}
                          onChange={(event) => handleCoverUpload(event.target.files?.[0])}
                          className="sr-only"
                        />
                      </label>
                      {form.cover_url ? (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, cover_url: "" })}
                          className="secondary-btn"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <input
                      value={form.cover_url}
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

              <div className="grid gap-4 md:grid-cols-2">
                <ScheduleDateTimePicker
                  label="Campaign Start Date & Time"
                  required={form.status !== "draft" && form.status !== "archived"}
                  value={form.campaign_start}
                  min={scheduleMin}
                  max={form.campaign_end || form.start_date}
                  onChange={(value) => setForm({ ...form, campaign_start: value })}
                />

                <ScheduleDateTimePicker
                  label="Campaign End Date & Time"
                  required={form.status !== "draft" && form.status !== "archived"}
                  value={form.campaign_end}
                  min={form.campaign_start || scheduleMin}
                  max={form.start_date}
                  onChange={(value) => setForm({ ...form, campaign_end: value })}
                />

                <ScheduleDateTimePicker
                  label="Voting Start Date & Time"
                  required
                  value={form.start_date}
                  min={form.campaign_end || scheduleMin}
                  max={form.end_date}
                  onChange={(value) => setForm({ ...form, start_date: value })}
                />

                <ScheduleDateTimePicker
                  label="Voting End Date & Time"
                  required
                  value={form.end_date}
                  min={form.start_date || form.campaign_end || scheduleMin}
                  onChange={(value) => setForm({ ...form, end_date: value })}
                />
              </div>

              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="field-shell w-full"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
                <option value="archived">Archived</option>
              </select>

              <select
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

              <div className="rounded-2xl border border-[rgba(24,54,49,0.08)] p-4">
                <p className="field-label">Voting Access Rule</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <select
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

                  <input
                    value={form.location_label}
                    onChange={(e) =>
                      setForm({ ...form, location_label: e.target.value })
                    }
                    placeholder="Location label optional"
                    className="field-shell w-full"
                  />
                </div>

                {form.voting_access_mode === "location_range" ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <input
                      type="number"
                      step="any"
                      value={form.geo_lat}
                      onChange={(e) => setForm({ ...form, geo_lat: e.target.value })}
                      placeholder="Latitude"
                      className="field-shell w-full"
                    />
                    <input
                      type="number"
                      step="any"
                      value={form.geo_lng}
                      onChange={(e) => setForm({ ...form, geo_lng: e.target.value })}
                      placeholder="Longitude"
                      className="field-shell w-full"
                    />
                    <input
                      type="number"
                      min="1"
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

              {editingElection && form.voting_access_mode !== "anywhere" && form.voting_access_mode !== "location_range" ? (
                <div className="rounded-2xl border border-[rgba(24,54,49,0.08)] p-4">
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
                </div>
              ) : null}

              <button className="primary-btn w-full">
                {editingElection ? "Save Changes" : "Create Election"}
              </button>
            </form>
          </div>
        </PopupOverlay>
      )}

      {createdElection && (
        <PopupOverlay>
          <div className="modal-card max-w-lg text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
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
    </div>
  );
}

export default Elections;
