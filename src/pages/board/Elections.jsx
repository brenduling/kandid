import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, Pencil, Trash2, X, QrCode, Power, ImagePlus } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { KandidButtonLoader, KandidInlineLoader } from "../../components/KandidLoader";
import PopupOverlay from "../../components/PopupOverlay";
import ElectionCover from "../../components/ElectionCover";
import ElectionManagementCard from "../../components/ElectionManagementCard";
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
import { copyLatestOrganizationPositions } from "../../utils/positionReuse";
import {
  isResultVisibilityConstraintError,
  resultVisibilityLabel,
  serializeResultVisibilityForDatabase,
  serializeResultVisibilityForLegacyDatabase,
} from "../../utils/results";

function BoardElections() {
  const prompt = usePrompt();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [elections, setElections] = useState([]);
  const [accessTokens, setAccessTokens] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [createdElection, setCreatedElection] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [tokenForm, setTokenForm] = useState({
    scope_type: "general",
    scope_value: "",
    expires_at: "",
  });
  const [form, setForm] = useState({
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

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;
  const orgName = user?.organizations?.name;
  const searchQuery = (searchParams.get("q") || "").trim().toLowerCase();
  const scheduleMin = editing ? "" : currentDateTimeInputValue();

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

      const { data, error } = await supabase
        .from("elections")
        .select(`
          *,
          organizations (
            name,
            logo_url
          )
        `)
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (!active) return;

      if (error) {
        console.error("Failed to load board elections:", error);
        setLoadError(error.message || "Unable to load elections.");
        setElections([]);
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

    const { data, error } = await supabase
      .from("elections")
      .select(`
        *,
        organizations (
          name,
          logo_url
        )
      `)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to refresh board elections:", error);
      setLoadError(error.message || "Unable to load elections.");
      setElections([]);
      setLoading(false);
      return;
    }

    setElections(data || []);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({
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
    setEditing(election);
    setForm({
      title: election.title || "",
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

    if (submitting) return;

    if (!orgId) {
      prompt.error("No organization is assigned to this Electoral Board account.");
      return;
    }

    setSubmitting(true);

    const validationMessage = validateElectionSchedule({
      ...form,
      organization_id: orgId,
    });
    if (validationMessage) {
      prompt.error(validationMessage);
      setSubmitting(false);
      return;
    }

    const payload = {
      ...form,
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
        ? supabase
            .from("elections")
            .update(nextPayload)
            .eq("id", editing.id)
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
          : result.error.message || "Failed to save election."
      );
      setSubmitting(false);
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
      setCreatedElection({
        ...payload,
        id: result.data.id,
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
      console.error("Board election cover upload failed:", error);
      prompt.error(
        `${error.message || "Failed to upload cover image."} Make sure the election-covers storage bucket migration is applied.`,
      );
    } finally {
      setCoverUploading(false);
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

  async function handleDelete(id) {
    const election = elections.find((item) => item.id === id) || {};
    const analysis = await analyzeDeleteDependencies("election", { id });

    if (analysis.blocked) {
      await logAuditEvent({
        action: "election_delete_blocked",
        entityType: "election",
        entityId: id,
        entityLabel: election.title || "Election",
        organizationId: orgId,
        organizationName: orgName,
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

    const ok = await prompt.confirm({
      title: "Delete Election?",
      message: dependencyMessage(election.title || "This election", analysis),
      type: "danger",
      confirmText: "Delete Election",
    });
    if (!ok) return;

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
      organizationId: orgId,
      organizationName: orgName,
      status: "completed",
    });
    refreshElections();
  }

  const filteredElections = useMemo(() => {
    if (!searchQuery) return elections;

    return elections.filter((election) => {
      const values = [
        election.title,
        election.status,
        getElectionPhase(election),
        getVotingAccessModeLabel(election.voting_access_mode),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return values.includes(searchQuery);
    });
  }, [elections, searchQuery]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Election Setup</div>
          <h1 className="page-title">Board elections</h1>
          <p className="page-subtitle">
            Create and manage elections for your assigned organization.
          </p>
        </div>

        <button
          onClick={openCreate}
          className="primary-btn self-start lg:self-auto"
        >
          <Plus size={18} />
          Create Election
        </button>
      </div>

      {loading ? (
        <div className="empty-state mt-8">
          <KandidInlineLoader message="Loading elections..." />
        </div>
      ) : loadError ? (
        <div className="empty-state mt-8">
          <p className="font-bold text-rose-600">Unable to load elections.</p>
          <p className="text-sm text-gray-500">{loadError}</p>
          <button type="button" onClick={refreshElections} className="secondary-btn mt-3">
            Retry
          </button>
        </div>
      ) : filteredElections.length === 0 ? (
        <div className="empty-state mt-8">
          {searchQuery ? "No elections match your search." : "No elections yet."}
        </div>
      ) : (
        <div className="election-management-grid mt-8">
          {filteredElections.map((election) => (
            <article key={election.id} className="entity-card">
              <ElectionManagementCard
                election={election}
                organization={election.organizations || user?.organizations}
                eyebrow="Election Setup"
                onClick={() => navigate(`/board/positions?election=${election.id}`)}
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
                <button type="button" onClick={() => navigate(`/board/positions?election=${election.id}`)} className="secondary-btn !px-3 !py-2 text-xs">
                  Manage Setup
                </button>
                <button type="button" onClick={() => openEdit(election)} className="icon-action">
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

      {formOpen && (
        <PopupOverlay>
          <div className="modal-card max-w-xl">
            <div className="mb-4 flex justify-between">
              <h2 className="text-xl font-black">
                {editing ? "Edit Election" : "Create Election"}
              </h2>

              <button type="button" onClick={() => setFormOpen(false)} className="popup-close">
                <X />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
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
                  placeholder="Election Title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="field-shell w-full"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <ScheduleDateTimePicker
                  label="Campaign Start Date & Time"
                  required={form.status !== "draft"}
                  value={form.campaign_start}
                  min={scheduleMin}
                  max={form.campaign_end || form.start_date}
                  onChange={(value) => setForm({ ...form, campaign_start: value })}
                />

                <ScheduleDateTimePicker
                  label="Campaign End Date & Time"
                  required={form.status !== "draft"}
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
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                  Voting Access Rule
                </p>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
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
                    onChange={(e) => setForm({ ...form, location_label: e.target.value })}
                    placeholder="Location label optional"
                    className="field-shell w-full"
                  />
                </div>

                {form.voting_access_mode === "location_range" ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <input type="number" step="any" value={form.geo_lat} onChange={(e) => setForm({ ...form, geo_lat: e.target.value })} placeholder="Latitude" className="field-shell w-full" />
                    <input type="number" step="any" value={form.geo_lng} onChange={(e) => setForm({ ...form, geo_lng: e.target.value })} placeholder="Longitude" className="field-shell w-full" />
                    <input type="number" min="1" value={form.geo_radius_meters} onChange={(e) => setForm({ ...form, geo_radius_meters: e.target.value })} placeholder="Radius in meters" className="field-shell w-full" />
                  </div>
                ) : null}
              </div>

              {editing && form.voting_access_mode !== "anywhere" && form.voting_access_mode !== "location_range" ? (
                <div className="rounded-2xl border border-[rgba(24,54,49,0.08)] p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                      Access Tokens / QR
                    </p>
                    <QrCode size={18} className="text-[#ff5a1f]" />
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <select value={tokenForm.scope_type} onChange={(e) => setTokenForm({ ...tokenForm, scope_type: e.target.value, scope_value: e.target.value === "general" ? "" : tokenForm.scope_value })} className="field-shell w-full">
                      {TOKEN_SCOPE_TYPES.map((scope) => (
                        <option key={scope.value} value={scope.value}>{scope.label}</option>
                      ))}
                    </select>
                    <input value={tokenForm.scope_value} onChange={(e) => setTokenForm({ ...tokenForm, scope_value: e.target.value })} placeholder="Scope value" disabled={tokenForm.scope_type === "general"} className="field-shell w-full" />
                    <input type="datetime-local" value={tokenForm.expires_at} onChange={(e) => setTokenForm({ ...tokenForm, expires_at: e.target.value })} className="field-shell w-full" />
                  </div>

                  <button type="button" onClick={handleCreateAccessToken} className="secondary-btn mt-4">
                    Generate Token
                  </button>

                  <div className="mt-4 space-y-3">
                    {accessTokens.length === 0 ? (
                      <div className="rounded-2xl bg-gray-50 px-4 py-4 text-sm text-gray-500">
                        No tokens yet for this election.
                      </div>
                    ) : (
                      accessTokens.map((tokenRow) => (
                        <div key={tokenRow.id} className="rounded-2xl bg-gray-50 p-4">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <p className="font-black tracking-[0.12em]">{tokenRow.token}</p>
                              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">
                                {tokenRow.scope_type}{tokenRow.scope_value ? ` • ${tokenRow.scope_value}` : ""}
                              </p>
                              <p className="mt-2 text-xs text-gray-500">
                                Expires: {formatLocalDateTime(tokenRow.expires_at)}
                              </p>
                            </div>
                            <div className="flex items-start gap-4">
                              <img src={getAccessQrImageUrl(tokenRow.token)} alt={`QR for ${tokenRow.token}`} className="h-24 w-24 rounded-2xl border bg-white p-2" />
                              <button type="button" onClick={() => handleToggleToken(tokenRow)} className="rounded-xl bg-white px-4 py-3 text-sm font-bold text-[#102220]">
                                <Power size={15} className="inline" /> {tokenRow.is_active ? " Disable" : " Enable"}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              <button className="primary-btn w-full" disabled={submitting}>
                {submitting ? <KandidButtonLoader label="Saving..." /> : "Save"}
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
                  openEdit(createdElection);
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
                  navigate(`/board/positions?election=${election.id}`);
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

export default BoardElections;
