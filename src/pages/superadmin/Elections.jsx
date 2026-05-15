import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, QrCode, Power } from "lucide-react";
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

function Elections() {
  const [elections, setElections] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [accessTokens, setAccessTokens] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingElection, setEditingElection] = useState(null);
  const [tokenForm, setTokenForm] = useState({
    scope_type: "general",
    scope_value: "",
    expires_at: "",
  });

  const [form, setForm] = useState({
    organization_id: "",
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

  useEffect(() => {
    fetchOrganizations();
    fetchElections();
  }, []);

  async function fetchOrganizations() {
    const { data } = await supabase
      .from("organizations")
      .select("id, name")
      .order("name", { ascending: true });

    setOrganizations(data || []);
  }

  async function fetchElections() {
    const { data, error } = await supabase
      .from("elections")
      .select(`
        *,
        organizations (
          name
        )
      `)
      .order("id", { ascending: true });

    if (!error) setElections(data || []);
  }

  function openCreateForm() {
    setEditingElection(null);
    setForm({
      organization_id: "",
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
      campaign_start: election.campaign_start
        ? election.campaign_start.slice(0, 16)
        : "",
      start_date: election.start_date
        ? election.start_date.slice(0, 16)
        : "",
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

    const payload = {
      organization_id: Number(form.organization_id),
      title: form.title,
      campaign_start: form.campaign_start || null,
      start_date: form.start_date,
      end_date: form.end_date,
      status: form.status,
      student_result_visibility: form.student_result_visibility,
      voting_access_mode: form.voting_access_mode,
      location_label: form.location_label || null,
      geo_lat: form.geo_lat === "" ? null : Number(form.geo_lat),
      geo_lng: form.geo_lng === "" ? null : Number(form.geo_lng),
      geo_radius_meters:
        form.geo_radius_meters === "" ? null : Number(form.geo_radius_meters),
    };

    let result;

    if (editingElection) {
      result = await supabase
        .from("elections")
        .update(payload)
        .eq("id", editingElection.id);
    } else {
      result = await supabase.from("elections").insert([payload]);
    }

    const error = result?.error;
    if (error) {
      console.error("Election save failed:", error);
      alert(error.message || "Failed to save election.");
      return;
    }

    setFormOpen(false);
    fetchElections();
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
      alert(error.message || "Failed to create access token.");
      return;
    }

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
      alert(error.message || "Failed to update token.");
      return;
    }

    await fetchAccessTokens(editingElection.id);
  }

  async function handleDelete(id) {
    const confirmDelete = window.confirm("Delete this election?");
    if (!confirmDelete) return;

    await supabase.from("elections").delete().eq("id", id);
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

      <div className="table-shell mt-8">
        <table className="w-full text-left">
          <thead className="table-head text-white">
            <tr>
              <th className="px-6 py-4 text-sm">Election</th>
              <th className="px-6 py-4 text-sm">Organization</th>
              <th className="px-6 py-4 text-sm">Phase</th>
              <th className="px-6 py-4 text-sm">Campaign Starts</th>
              <th className="px-6 py-4 text-sm">Start</th>
              <th className="px-6 py-4 text-sm">End</th>
              <th className="px-6 py-4 text-sm">Student Results</th>
              <th className="px-6 py-4 text-sm">Voting Access</th>
              <th className="px-6 py-4 text-sm text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {elections.length === 0 ? (
              <tr>
                <td colSpan="9" className="px-6 py-10 text-center text-gray-500">
                  No elections found.
                </td>
              </tr>
            ) : (
              elections.map((election) => (
                <tr key={election.id} className="border-b last:border-b-0">
                  <td className="px-6 py-4 font-bold">{election.title}</td>
                  <td className="px-6 py-4">
                    {election.organizations?.name || "Unknown"}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-700">
                      {getElectionPhase(election)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {formatLocalDateTime(election.campaign_start)}
                  </td>
                  <td className="px-6 py-4">
                    {formatLocalDateTime(election.start_date)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {formatLocalDateTime(election.end_date)}
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700">
                      {election.student_result_visibility === "realtime"
                        ? "Real-time"
                        : "After close"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {getVotingAccessModeLabel(election.voting_access_mode)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditForm(election)}
                        className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        onClick={() => handleDelete(election.id)}
                        className="p-2 rounded-lg bg-red-100 text-red-600 hover:bg-red-200"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
                <label className="field-label">Organization</label>
                <select
                  required
                  value={form.organization_id}
                  onChange={(e) =>
                    setForm({ ...form, organization_id: e.target.value })
                  }
                  className="field-shell w-full"
                >
                  <option value="">Select Organization</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
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

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="field-label">Campaign Start Date & Time</label>
                  <input
                    type="datetime-local"
                    value={form.campaign_start}
                    onChange={(e) =>
                      setForm({ ...form, campaign_start: e.target.value })
                    }
                    className="field-shell w-full"
                  />
                </div>

                <div>
                  <label className="field-label">Voting Start Date & Time</label>
                  <input
                    required
                    type="datetime-local"
                    value={form.start_date}
                    onChange={(e) =>
                      setForm({ ...form, start_date: e.target.value })
                    }
                    className="field-shell w-full"
                  />
                </div>

                <div>
                  <label className="field-label">Voting End Date & Time</label>
                  <input
                    required
                    type="datetime-local"
                    value={form.end_date}
                    onChange={(e) =>
                      setForm({ ...form, end_date: e.target.value })
                    }
                    className="field-shell w-full"
                  />
                </div>
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
                <option value="hidden">Students see results after close</option>
                <option value="realtime">Students see real-time results</option>
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
    </div>
  );
}

export default Elections;
