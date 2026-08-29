import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, X, QrCode, Power } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { KandidButtonLoader, KandidInlineLoader } from "../../components/KandidLoader";
import PopupOverlay from "../../components/PopupOverlay";
import { supabase } from "../../lib/supabaseClient";
import { formatLocalDateTime, getElectionPhase } from "../../utils/elections";
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

function BoardElections() {
  const prompt = usePrompt();
  const [searchParams] = useSearchParams();
  const [elections, setElections] = useState([]);
  const [accessTokens, setAccessTokens] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tokenForm, setTokenForm] = useState({
    scope_type: "general",
    scope_value: "",
    expires_at: "",
  });
  const [form, setForm] = useState({
    title: "",
    campaign_start: "",
    start_date: "",
    end_date: "",
    status: "draft",
    student_result_visibility: "hidden",
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
        .select("*")
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
      .select("*")
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
      campaign_start: "",
      start_date: "",
      end_date: "",
      status: "draft",
      student_result_visibility: "hidden",
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
      campaign_start: election.campaign_start
        ? election.campaign_start.slice(0, 16)
        : "",
      start_date: election.start_date ? election.start_date.slice(0, 16) : "",
      end_date: election.end_date ? election.end_date.slice(0, 16) : "",
      status: election.status || "draft",
      student_result_visibility:
        election.student_result_visibility || "hidden",
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

    const payload = {
      ...form,
      campaign_start: form.campaign_start || null,
      organization_id: orgId,
      location_label: form.location_label || null,
      geo_lat: form.geo_lat === "" ? null : Number(form.geo_lat),
      geo_lng: form.geo_lng === "" ? null : Number(form.geo_lng),
      geo_radius_meters:
        form.geo_radius_meters === "" ? null : Number(form.geo_radius_meters),
    };

    let result;

    if (editing) {
      result = await supabase
        .from("elections")
        .update(payload)
        .eq("id", editing.id)
        .select("id")
        .single();
    } else {
      result = await supabase.from("elections").insert([payload]).select("id").single();
    }

    if (result.error) {
      console.error("Board election save failed:", result.error);
      prompt.error(result.error.message || "Failed to save election.");
      setSubmitting(false);
      return;
    }

    prompt.success(editing ? "Election updated." : "Election created.");
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
          <h1 className="page-title">Board Elections</h1>
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

      <div className="table-shell mt-8">
        <table className="app-table">
          <thead>
            <tr>
              <th className="px-6 py-4">Title</th>
              <th className="px-6 py-4">Phase</th>
              <th className="px-6 py-4">Campaign</th>
              <th className="px-6 py-4">Start</th>
              <th className="px-6 py-4">End</th>
              <th className="px-6 py-4">Student Results</th>
              <th className="px-6 py-4">Voting Access</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" className="p-6 text-center">
                  <KandidInlineLoader message="Loading elections..." />
                </td>
              </tr>
            ) : loadError ? (
              <tr>
                <td colSpan="8" className="p-6 text-center">
                  <div className="mx-auto max-w-md space-y-3">
                    <p className="font-bold text-rose-600">Unable to load elections.</p>
                    <p className="text-sm text-gray-500">{loadError}</p>
                    <button type="button" onClick={refreshElections} className="secondary-btn">
                      Retry
                    </button>
                  </div>
                </td>
              </tr>
            ) : filteredElections.length === 0 ? (
              <tr>
                <td colSpan="8" className="p-6 text-center text-gray-500">
                  {searchQuery ? "No elections match your search." : "No elections yet."}
                </td>
              </tr>
            ) : (
              filteredElections.map((election) => (
                <tr key={election.id} className="border-b">
                  <td className="px-6 py-4 font-bold">{election.title}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className="status-pill">
                      {getElectionPhase(election)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {formatLocalDateTime(election.campaign_start)}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {formatLocalDateTime(election.start_date)}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {formatLocalDateTime(election.end_date)}
                  </td>
                  <td className="px-6 py-4">
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold">
                      {election.student_result_visibility === "realtime"
                        ? "Real-time"
                        : "After close"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {getVotingAccessModeLabel(election.voting_access_mode)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => openEdit(election)}
                      className="mr-2 rounded bg-gray-100 p-2"
                    >
                      <Pencil size={16} />
                    </button>

                    <button
                      onClick={() => handleDelete(election.id)}
                      className="rounded bg-red-100 p-2 text-red-600"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <PopupOverlay>
          <div className="modal-card max-w-md">
            <div className="mb-4 flex justify-between">
              <h2 className="text-xl font-black">
                {editing ? "Edit Election" : "Create Election"}
              </h2>

              <button type="button" onClick={() => setFormOpen(false)} className="popup-close">
                <X />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                required
                placeholder="Title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full rounded-xl border p-3"
              />

              <input
                type="datetime-local"
                value={form.campaign_start}
                onChange={(e) =>
                  setForm({ ...form, campaign_start: e.target.value })
                }
                className="w-full rounded-xl border p-3"
              />

              <input
                type="datetime-local"
                value={form.start_date}
                onChange={(e) =>
                  setForm({ ...form, start_date: e.target.value })
                }
                className="w-full rounded-xl border p-3"
              />

              <input
                type="datetime-local"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="w-full rounded-xl border p-3"
              />

              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full rounded-xl border p-3"
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
                className="w-full rounded-xl border p-3"
              >
                <option value="hidden">Students see results after close</option>
                <option value="realtime">Students see real-time results</option>
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
                    className="w-full rounded-xl border p-3"
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
                    className="w-full rounded-xl border p-3"
                  />
                </div>

                {form.voting_access_mode === "location_range" ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <input type="number" step="any" value={form.geo_lat} onChange={(e) => setForm({ ...form, geo_lat: e.target.value })} placeholder="Latitude" className="w-full rounded-xl border p-3" />
                    <input type="number" step="any" value={form.geo_lng} onChange={(e) => setForm({ ...form, geo_lng: e.target.value })} placeholder="Longitude" className="w-full rounded-xl border p-3" />
                    <input type="number" value={form.geo_radius_meters} onChange={(e) => setForm({ ...form, geo_radius_meters: e.target.value })} placeholder="Radius in meters" className="w-full rounded-xl border p-3" />
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
                    <select value={tokenForm.scope_type} onChange={(e) => setTokenForm({ ...tokenForm, scope_type: e.target.value, scope_value: e.target.value === "general" ? "" : tokenForm.scope_value })} className="w-full rounded-xl border p-3">
                      {TOKEN_SCOPE_TYPES.map((scope) => (
                        <option key={scope.value} value={scope.value}>{scope.label}</option>
                      ))}
                    </select>
                    <input value={tokenForm.scope_value} onChange={(e) => setTokenForm({ ...tokenForm, scope_value: e.target.value })} placeholder="Scope value" disabled={tokenForm.scope_type === "general"} className="w-full rounded-xl border p-3" />
                    <input type="datetime-local" value={tokenForm.expires_at} onChange={(e) => setTokenForm({ ...tokenForm, expires_at: e.target.value })} className="w-full rounded-xl border p-3" />
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
    </div>
  );
}

export default BoardElections;
