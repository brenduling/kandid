import { useEffect, useState } from "react";
import { Archive, ArrowDown, ArrowUp, Plus, Pencil, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PopupOverlay from "../../components/PopupOverlay";
import ElectionManagementCard from "../../components/ElectionManagementCard";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../../utils/deleteGuards";
import {
  isMissingPositionOrderError,
  sortPositions,
} from "../../utils/positionOrder";
import { getElectionPhase, isMissingElectionCoverColumn } from "../../utils/elections";

function isMissingPositionStatusError(error) {
  return /positions\.status|column positions\.status does not exist/i.test(
    error?.message || ""
  );
}

function BoardPositions() {
  const prompt = usePrompt();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedElectionId = searchParams.get("election") || "";
  const [positions, setPositions] = useState([]);
  const [elections, setElections] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [positionFilter, setPositionFilter] = useState("active");
  const [positionLifecycleReady, setPositionLifecycleReady] = useState(true);
  const [selectedElectionId, setSelectedElectionId] = useState(focusedElectionId);
  const [positionCounts, setPositionCounts] = useState({});
  const [draggedPositionId, setDraggedPositionId] = useState(null);

  const [form, setForm] = useState({
    election_id: "",
    name: "",
    max_votes: 1,
    display_order: 1,
  });

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;
  const orgName = user?.organizations?.name;

  useEffect(() => {
    fetchElections();
  }, []);

  useEffect(() => {
    setSelectedElectionId(focusedElectionId);
  }, [focusedElectionId]);

  useEffect(() => {
    if (!selectedElectionId) {
      setPositions([]);
      return;
    }

    let cancelled = false;
    fetchPositions(selectedElectionId, () => cancelled);

    return () => {
      cancelled = true;
    };
  }, [selectedElectionId]);

  async function fetchElections() {
    if (!orgId) return;

    let { data, error } = await supabase
      .from("elections")
      .select("id, title, cover_url, status, campaign_start, campaign_end, start_date, end_date")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (isMissingElectionCoverColumn(error)) {
      const fallback = await supabase
        .from("elections")
        .select("id, title, status, campaign_start, campaign_end, start_date, end_date")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      prompt.error(error.message || "Failed to load elections.");
      return;
    }

    setElections(data || []);
    fetchPositionCounts(data || []);
  }

  async function fetchPositionCounts(electionRows) {
    if (!orgId) return;
    const electionIds = (electionRows || []).map((election) => election.id);
    if (electionIds.length === 0) {
      setPositionCounts({});
      return;
    }

    const { data, error } = await supabase
      .from("positions")
      .select("id, election_id")
      .in("election_id", electionIds);

    if (error) return;

    const counts = Object.fromEntries(electionIds.map((id) => [id, 0]));
    (data || []).forEach((position) => {
      counts[position.election_id] = (counts[position.election_id] || 0) + 1;
    });
    setPositionCounts(counts);
  }

  async function fetchPositions(electionId = selectedElectionId, isStale = () => false) {
    if (!orgId || !electionId) return;

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

    const { data, error } = await supabase
      .from("positions")
      .select(baseSelect)
      .eq("election_id", electionId)
      .order("id", { ascending: true });

    setPositionLifecycleReady(false);

    if (error) {
      console.error("Failed to load board positions:", error);
      if (isStale()) return;
      prompt.error("Unable to load positions because the configuration could not be retrieved.");
      return;
    }

    if (isStale()) return;
    const nextPositions = (data || []).map((position, index) => ({
      ...position,
      status: "active",
      display_order: index + 1,
    }));
    setPositions(nextPositions);
    setPositionCounts((current) => ({
      ...current,
      [electionId]: nextPositions.length,
    }));
  }

  function openCreate(electionId = "") {
    const defaultElectionId = electionId || focusedElectionId || "";
    const election = elections.find((item) => String(item.id) === String(defaultElectionId));
    if (
      election &&
      ["closed", "archived", "done"].includes(String(getElectionPhase(election)).toLowerCase())
    ) {
      prompt.error("This election is closed. Position forms are no longer available.");
      return;
    }
    setEditing(null);
    setForm({
      election_id: defaultElectionId,
      name: "",
      max_votes: 1,
      display_order: defaultElectionId
        ? getNextDisplayOrder(defaultElectionId)
        : positions.length + 1,
    });
    setFormOpen(true);
  }

  function getNextDisplayOrder(electionId) {
    const existing = positions.filter(
      (position) => Number(position.election_id) === Number(electionId)
    );
    return existing.length
      ? Math.max(...existing.map((position) => Number(position.display_order || 0))) + 1
      : Number(positionCounts[electionId] || 0) + 1;
  }

  function openEdit(position) {
    setEditing(position);
    setForm({
      election_id: position.election_id || "",
      name: position.name || "",
      max_votes: position.max_votes || 1,
      display_order: position.display_order || positions.indexOf(position) + 1,
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

    const selectedFormElection = elections.find(
      (election) => Number(election.id) === Number(payload.election_id)
    );
    if (
      selectedFormElection &&
      ["closed", "archived", "done"].includes(String(getElectionPhase(selectedFormElection)).toLowerCase())
    ) {
      prompt.error("This election is closed. Position forms are no longer available.");
      return;
    }

    const creatingPosition = !editing;
    let savedId = editing?.id;

    if (editing) {
      const { data, error } = await supabase
        .from("positions")
        .update({
          election_id: payload.election_id,
          name: payload.name,
          max_votes: payload.max_votes,
        })
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
    await fetchPositions();

    if (creatingPosition && savedId) {
      const addCandidateNow = await prompt.confirm({
        title: "Add Candidate Now?",
        message: `${payload.name} was created. You can add a candidate now or finish setup later from Candidate Management.`,
        type: "success",
        confirmText: "Add Candidate",
        cancelText: "Done",
      });

      if (addCandidateNow) {
        navigate(`/board/candidates?position=${savedId}`);
      }
    }
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
    if (selectedElectionId && Number(position.election_id) !== Number(selectedElectionId)) {
      return false;
    }
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
  const selectedElection = elections.find(
    (election) => Number(election.id) === Number(selectedElectionId)
  );
  const positionCountsByElection = positionCounts;

  async function movePosition(position, direction) {
    if (!positionLifecycleReady) {
      prompt.error("Position sequencing requires the display order migration in Supabase.");
      return;
    }

    const siblings = sortPositions(
      positions.filter(
        (item) =>
          Number(item.election_id) === Number(position.election_id) &&
          (item.status || "active") !== "retired"
      )
    );
    const currentIndex = siblings.findIndex((item) => Number(item.id) === Number(position.id));
    const targetIndex = currentIndex + direction;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;

    const target = siblings[targetIndex];
    const currentOrder = Number(position.display_order || currentIndex + 1);
    const targetOrder = Number(target.display_order || targetIndex + 1);
    const tempOrder = 1000000000 + Math.max(Number(position.id || 0), Number(target.id || 0));
    const first = await supabase
      .from("positions")
      .update({ display_order: tempOrder })
      .eq("id", position.id);
    const second = first.error
      ? first
      : await supabase
          .from("positions")
          .update({ display_order: currentOrder })
          .eq("id", target.id);
    const third = second.error
      ? second
      : await supabase
          .from("positions")
          .update({ display_order: targetOrder })
          .eq("id", position.id);
    const error = first.error || second.error || third.error;

    if (error) {
      prompt.error(
        isMissingPositionOrderError(error)
          ? "Position sequencing requires the display order migration in Supabase."
          : error.message || "Failed to move position."
      );
      return;
    }

    await fetchPositions();
  }

  async function dropPosition(targetPosition) {
    if (!draggedPositionId || Number(draggedPositionId) === Number(targetPosition.id)) {
      setDraggedPositionId(null);
      return;
    }

    const draggedPosition = positions.find(
      (position) => Number(position.id) === Number(draggedPositionId)
    );
    setDraggedPositionId(null);

    if (
      !draggedPosition ||
      Number(draggedPosition.election_id) !== Number(targetPosition.election_id)
    ) {
      return;
    }

    const siblings = sortPositions(
      positions.filter(
        (position) =>
          Number(position.election_id) === Number(targetPosition.election_id) &&
          (position.status || "active") !== "retired"
      )
    );
    const fromIndex = siblings.findIndex((position) => Number(position.id) === Number(draggedPosition.id));
    const toIndex = siblings.findIndex((position) => Number(position.id) === Number(targetPosition.id));

    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    await movePosition(draggedPosition, toIndex > fromIndex ? 1 : -1);
  }

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
          onClick={() => openCreate()}
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

      {!selectedElectionId ? (
        elections.length === 0 ? (
          <div className="empty-state mt-8">No elections available.</div>
        ) : (
          <div className="election-management-grid mt-8">
            {elections.map((election) => (
              <ElectionManagementCard
                key={election.id}
                election={election}
                organization={user?.organizations}
                eyebrow="Position Setup"
                counts={[
                  {
                    label: `position${positionCountsByElection[election.id] === 1 ? "" : "s"}`,
                    value: positionCountsByElection[election.id] || 0,
                  },
                ]}
                onClick={() => {
                  setSelectedElectionId(String(election.id));
                  setSearchParams({ election: String(election.id) });
                }}
              />
            ))}
          </div>
        )
      ) : !selectedElection ? (
        <div className="empty-state mt-8">
          Selected election could not be found.
          <button
            type="button"
            onClick={() => {
              setSelectedElectionId("");
              setSearchParams({});
            }}
            className="primary-btn mt-4"
          >
            Back to Elections
          </button>
        </div>
      ) : (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => {
              setSelectedElectionId("");
              setSearchParams({});
            }}
            className="mb-4 text-sm font-black uppercase tracking-[0.12em] text-[#ef4e23]"
          >
            Back to Elections
          </button>

          <div className="entity-card mb-4 grid gap-4 lg:grid-cols-[minmax(0,15rem)_1fr_auto] lg:items-center">
            <ElectionManagementCard
              election={selectedElection}
              organization={user?.organizations}
              eyebrow="Selected Election"
              counts={[
                {
                  label: `position${positionCountsByElection[selectedElection.id] === 1 ? "" : "s"}`,
                  value: positionCountsByElection[selectedElection.id] || 0,
                },
              ]}
            />
            <div>
              <p className="page-kicker">Positions</p>
              <h2 className="entity-card-title mt-2">{selectedElection.title}</h2>
              <p className="entity-meta mt-2">
                Manage only the positions assigned to this election.
              </p>
            </div>
            {["closed", "archived", "done"].includes(String(getElectionPhase(selectedElection)).toLowerCase()) ? (
              <span className="status-pill">Closed</span>
            ) : (
              <button
                type="button"
                onClick={() => openCreate(selectedElection.id)}
                className="primary-btn self-start lg:self-auto"
              >
                <Plus size={18} />
                Add Position
              </button>
            )}
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
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
            <div className="empty-state">
              <p>No positions have been created for this election yet.</p>
              {["closed", "archived", "done"].includes(String(getElectionPhase(selectedElection)).toLowerCase()) ? null : (
                <button
                  type="button"
                  onClick={() => openCreate(selectedElection.id)}
                  className="primary-btn mt-4"
                >
                  <Plus size={18} />
                  Add Position
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visiblePositions.map((position) => (
                      <div
                        key={position.id}
                        className={`position-card-tile ${Number(draggedPositionId) === Number(position.id) ? "is-dragging" : ""}`}
                        draggable={(position.status || "active") !== "retired"}
                        onDragStart={() => setDraggedPositionId(position.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDragEnd={() => setDraggedPositionId(null)}
                        onDrop={() => dropPosition(position)}
                        onDoubleClick={() => movePosition(position, 1)}
                        title="Drag to reorder, or double-click to move down."
                      >
                        <div className="min-w-0 flex-1">
                          <h3 className="text-lg font-black">
                            {position.name}
                          </h3>
                          <p className="mt-1 text-sm text-gray-500">
                            Students may select up to {position.max_votes} candidate{position.max_votes > 1 ? "s" : ""}.
                          </p>
                        </div>
                        <div className="position-card-actions flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => movePosition(position, -1)}
                            className="icon-action"
                            title="Move up"
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => movePosition(position, 1)}
                            className="icon-action"
                            title="Move down"
                          >
                            <ArrowDown size={16} />
                          </button>
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
                  setForm({
                    ...form,
                    election_id: e.target.value,
                    display_order: editing
                      ? form.display_order
                      : getNextDisplayOrder(e.target.value),
                  })
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

              <div>
                <label className="field-label">Order</label>
                <input
                  required
                  type="number"
                  min="1"
                  value={form.display_order}
                  onChange={(e) =>
                    setForm({ ...form, display_order: e.target.value })
                  }
                  placeholder="Order"
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
