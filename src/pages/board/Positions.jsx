import { useEffect, useState } from "react";
import { Archive, Plus, Pencil, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../../utils/deleteGuards";

function isMissingPositionStatusError(error) {
  return /positions\.status|column positions\.status does not exist/i.test(
    error?.message || ""
  );
}

function BoardPositions() {
  const prompt = usePrompt();
  const [positions, setPositions] = useState([]);
  const [elections, setElections] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [positionFilter, setPositionFilter] = useState("active");
  const [positionLifecycleReady, setPositionLifecycleReady] = useState(true);

  const [form, setForm] = useState({
    election_id: "",
    name: "",
    max_votes: 1,
  });

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;
  const orgName = user?.organizations?.name;

  useEffect(() => {
    fetchElections();
    fetchPositions();
  }, []);

  async function fetchElections() {
    if (!orgId) return;

    const { data } = await supabase
      .from("elections")
      .select("id, title")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    setElections(data || []);
  }

  async function fetchPositions() {
    if (!orgId) return;

    const { data: orgElections } = await supabase
      .from("elections")
      .select("id")
      .eq("organization_id", orgId);

    const electionIds = orgElections?.map((e) => e.id) || [];

    if (electionIds.length === 0) {
      setPositions([]);
      return;
    }

    const lifecycleSelect = `
        id,
        election_id,
        name,
        max_votes,
        status,
        elections (
          title,
          organization_id
        )
      `;
    const baseSelect = `
        id,
        election_id,
        name,
        max_votes,
        elections (
          title,
          organization_id
        )
      `;

    let { data, error } = await supabase
      .from("positions")
      .select(lifecycleSelect)
      .in("election_id", electionIds)
      .order("id", { ascending: true });

    if (isMissingPositionStatusError(error)) {
      console.warn("Position lifecycle migration is not applied yet:", error);
      setPositionLifecycleReady(false);
      const fallback = await supabase
        .from("positions")
        .select(baseSelect)
        .in("election_id", electionIds)
        .order("id", { ascending: true });
      data = (fallback.data || []).map((position) => ({
        ...position,
        status: "active",
      }));
      error = fallback.error;
    } else {
      setPositionLifecycleReady(true);
    }

    if (error) {
      console.error("Failed to load board positions:", error);
      prompt.error("Unable to load positions because the configuration could not be retrieved.");
      return;
    }

    setPositions(data || []);
  }

  function openCreate() {
    setEditing(null);
    setForm({
      election_id: "",
      name: "",
      max_votes: 1,
    });
    setFormOpen(true);
  }

  function openEdit(position) {
    setEditing(position);
    setForm({
      election_id: position.election_id || "",
      name: position.name || "",
      max_votes: position.max_votes || 1,
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      election_id: Number(form.election_id),
      name: form.name,
      max_votes: Number(form.max_votes),
    };

    let savedId = editing?.id;

    if (editing) {
      const { data, error } = await supabase
        .from("positions")
        .update(payload)
        .eq("id", editing.id)
        .select("id")
        .single();
      if (error) {
        prompt.error(error.message || "Failed to update position.");
        return;
      }
      savedId = data?.id || editing.id;
      prompt.success("Position updated.");
    } else {
      const { data, error } = await supabase
        .from("positions")
        .insert([payload])
        .select("id")
        .single();
      if (error) {
        prompt.error(error.message || "Failed to create position.");
        return;
      }
      savedId = data?.id;
      prompt.success("Position created.");
    }

    await logAuditEvent({
      action: editing ? "position_updated" : "position_created",
      entityType: "position",
      entityId: savedId,
      entityLabel: payload.name,
      organizationId: orgId,
      organizationName: orgName,
      status: "completed",
      metadata: { election_id: payload.election_id, max_votes: payload.max_votes },
    });

    setFormOpen(false);
    fetchPositions();
  }

  async function handleDelete(id) {
    const position = positions.find((item) => item.id === id) || {};
    const analysis = await analyzeDeleteDependencies("position", { id });

    if (analysis.blocked) {
      await logAuditEvent({
        action: "position_delete_blocked",
        entityType: "position",
        entityId: id,
        entityLabel: position.name || "Position",
        organizationId: orgId,
        organizationName: orgName,
        status: "requires_action",
        metadata: { dependencies: analysis.dependencies },
      });

      if (analysis.severity === "archive") {
        const retire = await prompt.confirm({
          title: "Retire Position?",
          message: `${dependencyMessage(position.name || "This position", analysis)}\n\nRecommended action: retire this position to remove it from active setup while preserving votes, receipts, results, and verification history.`,
          type: "warning",
          confirmText: "Retire Position",
          cancelText: "Keep Active",
        });

        if (retire) {
          if (!positionLifecycleReady) {
            prompt.error(
              "Position retirement is unavailable until the position lifecycle migration is applied in Supabase."
            );
            return;
          }

          const { error } = await supabase
            .from("positions")
            .update({ status: "retired" })
            .eq("id", id);

          if (error) {
            prompt.error(
              isMissingPositionStatusError(error)
                ? "Position retirement is unavailable until the position lifecycle migration is applied in Supabase."
                : "Failed to retire position. Please try again."
            );
            return;
          }

          prompt.success("Position retired. Historical voting records were preserved.");
          await logAuditEvent({
            action: "position_retired",
            entityType: "position",
            entityId: id,
            entityLabel: position.name || "Position",
            organizationId: orgId,
            organizationName: orgName,
            status: "completed",
            metadata: { dependencies: analysis.dependencies },
          });
          fetchPositions();
        }
        return;
      }

      await prompt.alert({
        title: "Position Cannot Be Deleted Yet",
        message: `${dependencyMessage(position.name || "This position", analysis)}\n\nOpen Candidates to manage records for this election and position.`,
        type: "warning",
        confirmText: "Review Candidates",
      });
      return;
    }

    const ok = await prompt.confirm({
      title: "Delete Position?",
      message: dependencyMessage(position.name || "This position", analysis),
      type: "danger",
      confirmText: "Delete Position",
    });
    if (!ok) return;

    const recheck = await analyzeDeleteDependencies("position", { id });
    if (recheck.blocked) {
      prompt.error(dependencyMessage(position.name || "This position", recheck));
      return;
    }

    const { error } = await supabase.from("positions").delete().eq("id", id);
    if (error) {
      prompt.error(error.message || "Failed to delete position.");
      return;
    }
    prompt.success("Position deleted.");
    await logAuditEvent({
      action: "position_deleted",
      entityType: "position",
      entityId: id,
      entityLabel: position.name || "Position",
      organizationId: orgId,
      organizationName: orgName,
      status: "completed",
    });
    fetchPositions();
  }

  const visiblePositions = positions.filter((position) => {
    if (!positionLifecycleReady && positionFilter === "retired") return false;
    const status = position.status || "active";
    if (positionFilter === "active") return status !== "retired";
    if (positionFilter === "retired") return status === "retired";
    return true;
  });

  const activePositionCount = positions.filter(
    (position) => (position.status || "active") !== "retired"
  ).length;
  const retiredPositionCount = positions.filter(
    (position) => position.status === "retired"
  ).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Ballot Structure</div>
          <h1 className="page-title">Board positions</h1>
          <p className="page-subtitle">
            Manage election positions for your assigned organization.
          </p>
        </div>

        <button
          onClick={openCreate}
          className="primary-btn self-start lg:self-auto"
        >
          <Plus size={18} />
          Add Position
        </button>
      </div>

      {!positionLifecycleReady ? (
        <div className="mt-6 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm font-semibold leading-6 text-orange-800">
          Position lifecycle migration is not applied in Supabase yet. Existing positions are shown as active, and Retired filtering/Retire Position will be enabled after the migration is applied.
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {[
          ["active", `Active (${activePositionCount})`],
          ["retired", `Retired (${retiredPositionCount})`],
          ["all", `All (${positions.length})`],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            disabled={!positionLifecycleReady && value === "retired"}
            onClick={() => setPositionFilter(value)}
            className={`filter-pill ${positionFilter === value ? "filter-pill-active" : ""} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {label}
          </button>
        ))}
      </div>

      {visiblePositions.length === 0 ? (
        <div className="empty-state mt-8">
          No {positionFilter === "all" ? "" : positionFilter} positions found.
        </div>
      ) : (
        <div className="entity-grid">
          {visiblePositions.map((position) => (
            <div key={position.id} className="entity-card lift-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff7a35]">
                    {position.elections?.title || "Unknown election"}
                  </p>
                  <h2 className="entity-card-title mt-2">{position.name}</h2>
                </div>
                <span className="status-pill">{position.max_votes} vote{position.max_votes > 1 ? "s" : ""}</span>
              </div>
              <p className="entity-meta">Set the number of choices students may submit for this role.</p>
              <div className="entity-actions">
                {position.status === "retired" ? (
                  <span className="status-pill !bg-orange-100 !text-orange-700">
                    <Archive size={14} />
                    Retired
                  </span>
                ) : null}
                <button onClick={() => openEdit(position)} className="icon-action">
                  <Pencil size={16} />
                </button>
                <button onClick={() => handleDelete(position.id)} className="icon-action icon-action-danger">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <PopupOverlay>
          <div className="modal-card max-w-lg">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black">
                {editing ? "Edit Position" : "Add Position"}
              </h2>

              <button
                onClick={() => setFormOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="modal-form-stack">
              <div>
                <label className="field-label">Election</label>
              <select
                required
                value={form.election_id}
                onChange={(e) =>
                  setForm({ ...form, election_id: e.target.value })
                }
                className="field-shell w-full"
              >
                <option value="">Select Election</option>
                {elections.map((election) => (
                  <option key={election.id} value={election.id}>
                    {election.title}
                  </option>
                ))}
              </select>
              </div>

              <div>
                <label className="field-label">Position Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Position name, e.g. President"
                className="field-shell w-full"
              />
              </div>

              <div>
                <label className="field-label">Max Votes</label>
              <input
                required
                type="number"
                min="1"
                value={form.max_votes}
                onChange={(e) =>
                  setForm({ ...form, max_votes: e.target.value })
                }
                placeholder="Max votes"
                className="field-shell w-full"
              />
              </div>

              <button className="primary-btn w-full">
                {editing ? "Save Changes" : "Create Position"}
              </button>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default BoardPositions;
