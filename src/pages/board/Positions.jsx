import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PopupOverlay from "../../components/PopupOverlay";
import ElectionCover from "../../components/ElectionCover";
import { supabase } from "../../lib/supabaseClient";
import { createPositionSubmission, savePositionEdit, changePositionStatus, reorderPositions, deleteUnreferencedPosition, positionSaveError } from "../../utils/positionManagementContract";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies } from "../../utils/deleteGuards";
import {
  isMissingPositionOrderError,
  sortPositions,
} from "../../utils/positionOrder";
import { getElectionPhase, isMissingElectionCoverColumn } from "../../utils/elections";
import { useElectionClock } from "../../utils/useElectionClock";
import BoardPositionDeleteSheet from "./BoardPositionDeleteSheet";
import { electionPhaseLabel } from "./electionDisplay";
import "./Positions.css";

const localProductionReadonly = import.meta.env.MODE === "localhost-production-readonly";

function isMissingPositionStatusError(error) {
  return /positions\.status|column positions\.status does not exist/i.test(
    error?.message || ""
  );
}



function isPositionReorderSetupError(error) {
  return /reorder_election_positions|schema cache|function .*not.*exist/i.test(
    error?.message || ""
  );
}

/* The three phases that make position forms unavailable. This is the same list
   the closed-election check has always used, named once so the guard in
   openCreate, the guard in handleSubmit and the read-only banner below all read
   from one place. The lifecycle values themselves are unchanged. */
const CLOSED_PHASES = ["closed", "archived", "done"];

function isClosedPhase(election, now) {
  return CLOSED_PHASES.includes(String(getElectionPhase(election, now)).toLowerCase());
}

/* Reads the stored max_votes only. No rule is inferred: the number shown is the
   number of selections the database column already holds. */
function selectionLimitLabel(maxVotes) {
  const limit = Number(maxVotes || 1);
  return `Select up to ${limit} candidate${limit === 1 ? "" : "s"}`;
}

/* One row of the election context register. This is only the SELECTOR: once an
   election is chosen its context is presented by the workspace header instead, so
   a row here is always an action and is rendered as a real button. The three
   tracks match the column header above them and the row template is a CSS
   variable, so the labels and the data cannot drift apart. */
function ElectionContextRow({ election, count, onSelect, now }) {
  const phase = getElectionPhase(election, now);
  const title = election?.title || "Untitled Election";

  return (
    <button
      type="button"
      className="board-positions-context-row"
      data-phase={phase}
      onClick={() => onSelect(election.id)}
    >
      <span className="board-positions-context-identity">
        <ElectionCover election={election} compact className="board-positions-cover" />
        <span className="board-positions-context-text">
          <span className="board-positions-context-name">{title}</span>
        </span>
      </span>

      <span className="board-positions-context-structure">
        <strong>{count}</strong>
        <span>position{count === 1 ? "" : "s"}</span>
      </span>

      <span className="board-positions-context-phase" title={`Election phase: ${phase}`}>
        {electionPhaseLabel(election, now)}
      </span>
    </button>
  );
}


function BoardPositions() {
  const prompt = usePrompt();
  const now = useElectionClock();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const electionSelectorRef = useRef(null);
  const focusedElectionId = searchParams.get("election") || "";
  const [positions, setPositions] = useState([]);
  const [elections, setElections] = useState([]);
  const [electionsLoading, setElectionsLoading] = useState(true);
  const [electionsLoadError, setElectionsLoadError] = useState("");
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionsLoadError, setPositionsLoadError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [savingPosition, setSavingPosition] = useState(false);
  const positionSaveInFlight = useRef(false);
  const createSubmission = useRef(null);
  const positionOperationInFlight = useRef(false);
  const [editing, setEditing] = useState(null);
  const [positionFilter, setPositionFilter] = useState("active");
  const [positionLifecycleReady, setPositionLifecycleReady] = useState(true);
  const [selectedElectionFallbackId, setSelectedElectionId] = useState("");
  const [positionCounts, setPositionCounts] = useState({});

  const [draggedPositionId, setDraggedPositionId] = useState(null);

  /* Danger Zone delete review state. One sheet, five states, and the sheet never
     decides whether a delete is allowed: the analysis, both audit events, the
     retire eligibility rule and the delete itself all stay in the handlers. */
  const [deleteReview, setDeleteReview] = useState(null);


  const [form, setForm] = useState({
    election_id: "",
    name: "",
    max_votes: 1,
    display_order: 1,
  });

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;
  const orgName = user?.organizations?.name;
  const selectedElectionId = focusedElectionId || selectedElectionFallbackId;

  useEffect(() => {
    fetchElections();
  }, []);

  useEffect(() => {
    if (!selectedElectionId) {
      return;
    }

    let cancelled = false;
    fetchPositions(selectedElectionId, () => cancelled);

    return () => {
      cancelled = true;
    };
  }, [selectedElectionId]);

  async function fetchElections() {
    setElectionsLoading(true);
    setElectionsLoadError("");
    if (!orgId) {
      setElectionsLoadError("No organization is assigned to this Electoral Board account.");
      setElectionsLoading(false);
      return;
    }

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
      setElectionsLoadError("Election context could not be loaded. Refresh and try again.");
      setElectionsLoading(false);
      return;
    }

    setElections(data || []);
    fetchPositionCounts(data || []);
    setElectionsLoading(false);
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

    if (!isStale()) {
      setPositionsLoading(true);
      setPositionsLoadError("");
    }

    const baseSelect = `
        id,
        election_id,
        name,
        max_votes,
        status,
        display_order,
        elections (
          title,
          organization_id
        )
      `;

    let { data, error } = await supabase
      .from("positions")
      .select(baseSelect)
      .eq("election_id", electionId)
      .order("display_order", { ascending: true })
      .order("id", { ascending: true });

    let lifecycleReady = true;

    if (isMissingPositionStatusError(error) || isMissingPositionOrderError(error)) {
      const fallback = await supabase
        .from("positions")
        .select(`
          id,
          election_id,
          name,
          max_votes,
          elections (
            title,
            organization_id
          )
        `)
        .eq("election_id", electionId)
        .order("id", { ascending: true });

      data = fallback.data;
      error = fallback.error;
      lifecycleReady = false;
    }

    setPositionLifecycleReady(lifecycleReady);

    if (error) {
      console.error("Failed to load board positions:", error);
      if (isStale()) return;
      setPositionsLoadError("Positions could not be loaded. Try again to refresh this ballot structure.");
      setPositionsLoading(false);
      prompt.error("Unable to load positions because the configuration could not be retrieved.");
      return;
    }

    if (isStale()) return;
    const nextPositions = (data || []).map((position, index) => ({
      ...position,
      status: position.status || "active",
      display_order: position.display_order || index + 1,
    }));
    setPositions(nextPositions);
    setPositionCounts((current) => ({
      ...current,
      [electionId]: nextPositions.length,
    }));
    setPositionsLoadError("");
    setPositionsLoading(false);
  }

  /* The one place that changes the selected election, so the URL parameter and
     the local fallback state cannot disagree. An empty id clears both, which is
     what the context register, the "change election" control and the
     not-found state all use. */
  function selectElection(electionId) {
    setSelectedElectionId(String(electionId || ""));
    setSearchParams(electionId ? { election: String(electionId) } : {});
  }


  function openCreate(electionId = "") {
    if (localProductionReadonly) return;
    createSubmission.current = createPositionSubmission(supabase);
    const defaultElectionId = electionId || selectedElectionId || "";
    if (!defaultElectionId) {
      electionSelectorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const election = elections.find((item) => String(item.id) === String(defaultElectionId));
    if (!election) {
      prompt.error("Choose an available election before adding a position.");
      return;
    }

    if (election && isClosedPhase(election, now)) {
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
    if (localProductionReadonly) return;
    setEditing(position);
    setForm({
      election_id: position.election_id || "",
      name: position.name || "",
      max_votes: position.max_votes || 1,
      display_order: position.display_order || positions.indexOf(position) + 1,
    });
    setFormOpen(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (localProductionReadonly || positionSaveInFlight.current) return;
    positionSaveInFlight.current = true;
    setSavingPosition(true);
    try {
      const parentId = Number(selectedElectionId);
      const values = { ...form, election_id: Number(form.election_id) };
      const result = editing
        ? await savePositionEdit(supabase, editing, values)
        : await (createSubmission.current ||= createPositionSubmission(supabase))(values, parentId);
      if (result.error) { prompt.error(positionSaveError(result.error)); return; }
      if (!Number.isSafeInteger(result.data?.id) || result.data.id <= 0) { prompt.error('The saved position could not be confirmed. Refresh before retrying.'); return; }
      if (result.unchanged) { prompt.info('No changes to save.'); return; }
      const savedId = result.data.id;
      const creating = !editing;
      setFormOpen(false);
      await fetchPositions(parentId);
      prompt.success(creating ? 'Position created.' : 'Position updated.');
      if (creating) {
        const addCandidateNow = await prompt.confirm({ title: 'Add Candidate Now?', message: values.name.trim() + ' was created. You can add a candidate now or finish setup later from Candidate Management.', type: 'success', confirmText: 'Add Candidate', cancelText: 'Done' });
        if (addCandidateNow) navigate(`/board/candidates?position=${savedId}`);
      }
    } catch (error) { prompt.error(positionSaveError(error)); }
    finally { positionSaveInFlight.current = false; setSavingPosition(false); }
  }

  /* Danger Zone delete review.
     The eligibility rule, the analysis call, all three audit events, the retire
     guard and the delete itself are unchanged. Only the presentation changed:
     the prompt.confirm and prompt.alert popups are replaced by the Danger Zone
     sheet, which is driven through the states below. The check still runs first,
     a blocked result still stops the delete and still logs position_delete_blocked
     before anything is offered, and a permitted delete still re-checks
     immediately before removing anything. */
  async function handleDelete(id) {
    if (localProductionReadonly) return;
    const position = positions.find((item) => item.id === id) || {};
    setDeleteReview({ id, position, phase: "reviewing", analysis: null });

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

      setDeleteReview({ id, position, phase: "blocked", analysis });
      return;
    }

    setDeleteReview({ id, position, phase: "confirm", analysis });
  }

  /* Runs only from the permitted state, so the destructive action exists only
     where the guard has already allowed the delete. The recheck is the existing
     safeguard: if the second check finds related records, nothing is deleted. */
  async function confirmDelete() {
    if (localProductionReadonly) return;
    if (!deleteReview) return;
    const { id, position } = deleteReview;

    setDeleteReview((current) => ({ ...current, phase: "deleting" }));

    const recheck = await analyzeDeleteDependencies("position", { id });
    if (recheck.blocked) {
      setDeleteReview({ id, position, phase: "blocked", analysis: recheck });
      return;
    }

    const { error } = await deleteUnreferencedPosition(supabase, position);
    if (error) {
      prompt.error(positionSaveError(error));
      setDeleteReview(null);
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

    setDeleteReview(null);
    fetchPositions();
  }

  /* Runs only from the archive-severity blocked state, which is the only state
     that offers it. The lifecycle guard, the update, the error wording, the
     success message and the audit event with the same dependency metadata are
     unchanged. */
  async function confirmRetire() {
    if (localProductionReadonly) return;
    if (!deleteReview) return;
    const { id, position, analysis } = deleteReview;

    setDeleteReview((current) => ({ ...current, phase: "retiring" }));

    if (!positionLifecycleReady) {
      prompt.error(
        "Position retirement is unavailable until the position lifecycle migration is applied in Supabase."
      );
      setDeleteReview(null);
      return;
    }

    const { error } = await changePositionStatus(supabase, position, "retired");

    if (error) {
      prompt.error(
        isMissingPositionStatusError(error)
          ? "Position retirement is unavailable until the position lifecycle migration is applied in Supabase."
          : "Failed to retire position. Please try again."
      );
      setDeleteReview(null);
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
      metadata: { dependencies: analysis?.dependencies },
    });

    setDeleteReview(null);
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
  const formElection = elections.find(
    (election) => String(election.id) === String(form.election_id)
  );
  const positionCountsByElection = positionCounts;

  /* The one presentation read of the lifecycle helper. The database is the
     authority on whether a mutation is allowed; this only decides whether the
     mutation controls are drawn at all, so a closed ballot is a read-only view
     rather than a view full of controls that would refuse to work. The same
     helper still guards openCreate and handleSubmit. */
  const selectedElectionPhase = selectedElection ? getElectionPhase(selectedElection, now) : "";
  const selectedElectionReadOnly = selectedElection
    ? isClosedPhase(selectedElection, now)
    : false;
  const positionActionsDisabled = localProductionReadonly || selectedElectionReadOnly;
  const selectedPositionTotal =
    positionCountsByElection[selectedElectionId] ?? positions.length;

  async function movePosition(position, direction) {
    if (positionOperationInFlight.current) return;
    if (localProductionReadonly) return;

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
    positionOperationInFlight.current = true;
    const { error } = await reorderPositions(supabase, Number(position.election_id), [Number(position.id), Number(target.id)], [targetOrder, currentOrder]);
    positionOperationInFlight.current = false;

    if (error) {
      prompt.error(
        isMissingPositionOrderError(error) || isPositionReorderSetupError(error)
          ? "Position sequencing requires the display order migration in Supabase."
          : positionSaveError(error)
      );
      return;
    }

    await fetchPositions();
  }

  async function dropPosition(targetPosition) {
    if (localProductionReadonly) return;
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
    <div className="board-positions-desktop">
      <header className="board-positions-masthead">
        <div className="board-positions-masthead-context">
          <span className="board-positions-eyebrow">
            Electoral Board / {orgName || "your assigned organization"}
          </span>
          <span className="board-positions-masthead-rule" aria-hidden="true" />
        </div>

        <div className="board-positions-baseline">
          <h1 className="page-title board-positions-title">Ballot positions</h1>
        </div>

        <p className="board-positions-standfirst">
          Structure offices and selection limits for {orgName || "your assigned organization"}.
        </p>
      </header>


      {!positionLifecycleReady ? (
        <div className="board-positions-warning">
          Position lifecycle migration is not applied in Supabase yet. Existing positions are shown as active, and Retired filtering/Retire Position will be enabled after the migration is applied.
        </div>
      ) : null}

      {!selectedElectionId ? (
        electionsLoading ? (
          <div className="board-positions-context-skeleton" role="status" aria-label="Loading election context" aria-busy="true">
            {[0, 1, 2, 3].map((row) => <div className="board-positions-context-skeleton-row" key={row}><span /><span /><span /></div>)}
          </div>
        ) : electionsLoadError ? (
          <div className="board-positions-state is-error" role="alert">
            <p>Election context could not be loaded.</p>
            <button type="button" onClick={fetchElections} className="board-positions-state-action">Retry</button>
          </div>
        ) : elections.length === 0 ? (
          <div className="board-positions-state">
            <p>No elections available.</p>
          </div>
        ) : (
          <section
            className="board-positions-selector"
            aria-label="Election context"
            ref={electionSelectorRef}
          >
            <div className="board-positions-register-head">
              <div>
                <p className="board-positions-section-kicker">Election context</p>
                <h2>Select an election</h2>
              </div>
              <span className="board-positions-register-count">
                <strong>{elections.length}</strong> election{elections.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="board-positions-context-columns" aria-hidden="true">
              <span>Election</span>
              <span>Ballot structure</span>
              <span>Phase</span>
            </div>

            <div className="board-positions-context-list">
              {elections.map((election) => (
                <ElectionContextRow
                  key={election.id}
                  election={election}
                  count={positionCountsByElection[election.id] || 0}
                  onSelect={selectElection}
                  now={now}
                />
              ))}
            </div>
          </section>
        )
      ) : !selectedElection ? (
        <div className="board-positions-state">
          <p>Selected election could not be found.</p>
          <button
            type="button"
            onClick={() => selectElection("")}
            className="board-positions-state-action"
          >
            Choose another election
          </button>
        </div>
      ) : (

        <div className="board-positions-workspace">
          <section className="board-positions-election-context" aria-label="Selected election">
            <div className="board-positions-context-identity">
              <ElectionCover
                election={selectedElection}
                compact
                className="board-positions-cover"
              />

              <div className="board-positions-context-text">
                <p className="board-positions-section-kicker">
                  Election context / {orgName || "your assigned organization"}
                </p>
                <h2>{selectedElection.title || "Untitled Election"}</h2>
                <p className="board-positions-context-meta">
                  {selectedPositionTotal} position{selectedPositionTotal === 1 ? "" : "s"}
                </p>
              </div>

              {selectedElectionReadOnly ? (
                <span className="board-positions-context-lock">
                  Closed · Read only
                </span>
              ) : (
                <span
                  className="board-positions-context-phase"
                  data-phase={selectedElectionPhase}
                >
                  {electionPhaseLabel(selectedElection)}
                </span>
              )}
            </div>

            <div className="board-positions-working-actions">
              <button
                type="button"
                onClick={() => selectElection("")}
                className="board-positions-change"
              >
                Switch election
              </button>

              {selectedElectionReadOnly ? null : (
                <button
                  type="button"
                  disabled={localProductionReadonly}
                  title={localProductionReadonly ? "Unavailable during read-only production inspection" : undefined}
                  onClick={() => openCreate(selectedElection.id)}
                  className="board-positions-create"
                >
                  <Plus size={15} aria-hidden="true" />
                  Add Position
                </button>
              )}
            </div>

            {localProductionReadonly ? (
              <p className="board-positions-context-note" role="note">
                Production inspection is read only. Position creation, editing, deletion, retirement, and reordering are disabled.
              </p>
            ) : selectedElectionReadOnly ? (
              <p className="board-positions-context-note">
                This election is closed, so its ballot is kept exactly as it was voted. The offices,
                their selection limits and their order are shown for reference only.
              </p>
            ) : null}
          </section>

          <div className="board-positions-filters">
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
                className={`board-positions-filter${
                  positionFilter === value ? " is-active" : ""
                }`}
              >
                {label}
              </button>
            ))}
            {selectedElectionReadOnly ? null : (
              <p className="board-positions-hint">Drag or use arrows to reorder</p>
            )}
          </div>

          {positionsLoading ? (
            <div className="board-positions-list-skeleton" role="status" aria-label="Loading ballot positions" aria-busy="true">
              {[0, 1, 2, 3].map((row) => <div className="board-positions-list-skeleton-row" key={row}><span /><span /><span /><span /></div>)}
            </div>
          ) : positionsLoadError ? (
            <div className="board-positions-state is-error" role="alert">
              <p>{positionsLoadError}</p>
              <button type="button" onClick={() => fetchPositions(selectedElection.id)} className="board-positions-state-action">Retry</button>
            </div>
          ) : visiblePositions.length === 0 ? (
            <div className="board-positions-state">
              <p>
                {selectedElectionReadOnly
                  ? "This election closed without any positions on its ballot."
                  : "No positions have been created for this election yet."}
              </p>
            </div>
          ) : (
            <section
              className={`board-positions-structure${
                selectedElectionReadOnly ? " is-readonly" : ""
              }`}
              aria-label={
                selectedElectionReadOnly
                  ? "Ballot positions, read only"
                  : "Ballot position order"
              }
            >
              <div className="board-positions-register-columns" aria-hidden="true">
                <span>Order</span>
                <span>Position</span>
                <span>Max selections</span>
                <span>Status</span>
                {selectedElectionReadOnly ? null : <span>Actions</span>}
              </div>

              <div className="board-position-list">
                {visiblePositions.map((position, index) => {
                  const retired = position.status === "retired";

                  return (
                    <div
                      key={position.id}
                      className={`board-position-entry${
                        Number(draggedPositionId) === Number(position.id) ? " is-dragging" : ""
                      }`}
                      draggable={!positionActionsDisabled && !retired}
                      onDragStart={
                        positionActionsDisabled
                          ? undefined
                          : () => setDraggedPositionId(position.id)
                      }
                      onDragOver={positionActionsDisabled ? undefined : (event) => event.preventDefault()}
                      onDragEnd={positionActionsDisabled ? undefined : () => setDraggedPositionId(null)}
                      onDrop={positionActionsDisabled ? undefined : () => dropPosition(position)}
                      onDoubleClick={
                        positionActionsDisabled ? undefined : () => movePosition(position, 1)
                      }
                      title={
                        positionActionsDisabled
                          ? undefined
                          : "Drag to reorder, or double-click to move down."
                      }
                    >
                      <span className="board-position-entry-index" aria-hidden="true">
                        {String(Number(position.display_order || index + 1)).padStart(2, "0")}
                      </span>

                      <h3 className="board-position-entry-name">{position.name}</h3>

                      <span className="board-position-entry-limit">
                        {selectionLimitLabel(position.max_votes)}
                      </span>

                      <span
                        className={`board-position-entry-state${retired ? " is-retired" : ""}`}
                      >
                        {retired ? "Retired" : "Active"}
                      </span>

                      {selectedElectionReadOnly ? null : (
                        <div className="board-position-entry-actions">
                          <button
                            type="button"
                            disabled={localProductionReadonly}
                            title={localProductionReadonly ? "Unavailable during read-only production inspection" : "Move up"}
                            onClick={() => movePosition(position, -1)}
                            className="board-position-move"
                            title="Move up"
                            aria-label={`Move ${position.name} up`}
                          >
                            <ArrowUp size={15} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={localProductionReadonly}
                            title={localProductionReadonly ? "Unavailable during read-only production inspection" : "Move down"}
                            onClick={() => movePosition(position, 1)}
                            className="board-position-move"
                            title="Move down"
                            aria-label={`Move ${position.name} down`}
                          >
                            <ArrowDown size={15} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={localProductionReadonly}
                            title={localProductionReadonly ? "Unavailable during read-only production inspection" : undefined}
                            onClick={() => openEdit(position)}
                            className="board-position-action"
                            aria-label={`Edit ${position.name}`}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={localProductionReadonly}
                            title={localProductionReadonly ? "Unavailable during read-only production inspection" : undefined}
                            onClick={() => handleDelete(position.id)}
                            className="board-position-action is-danger"
                            aria-label={`Delete ${position.name}`}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}



      {formOpen && (
        <PopupOverlay>
          <div
            className="popup-sheet board-position-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="board-position-form-title"
          >
            <div className="popup-header">
              <div className="popup-header-copy">
                <p className="board-position-sheet-kicker">
                  Ballot position / {orgName || "your assigned organization"}
                </p>
                <h2 id="board-position-form-title" className="surface-title">
                  {editing ? "Edit position" : "Add position"}
                </h2>
                {editing ? (
                  <p className="board-position-sheet-subject">
                    {form.name || "This position"}
                    <span>
                      {(elections.find((election) => String(election.id) === String(form.election_id)) || {})
                        .title || "Selected election"}
                    </span>
                  </p>
                ) : (
                  <p className="board-position-sheet-subject">
                    {formElection?.title || "Selected election"}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="popup-close"
                onClick={() => { if (!positionSaveInFlight.current) setFormOpen(false); }}
                aria-label={editing ? "Close edit position" : "Close add position"}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <form className="popup-content board-position-sheet-body" onSubmit={handleSubmit}>
              <section className="board-position-sheet-section" aria-labelledby="board-position-form-01">
                <div className="board-position-sheet-heading">
                  <p className="board-position-sheet-kicker">01</p>
                  <div>
                    <h3 id="board-position-form-01">Position</h3>
                    <p>The office and where it sits in this ballot.</p>
                  </div>
                </div>

                <div className="board-position-sheet-fields">
                  <div className="board-position-sheet-field is-wide">
                    <span className="board-position-sheet-field-label">Parent election</span>
                    <div className="board-position-election-readonly">
                      {formElection?.title || "Selected election"}
                    </div>
                    <small>
                      Read only. A position belongs to the election it was created on and cannot be
                      moved to another ballot.
                    </small>
                  </div>


                  <div className="board-position-sheet-field">
                    <label htmlFor="board-position-name">Position name</label>
                    <input
                      id="board-position-name"
                      maxLength={100}
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Position name, e.g. President"
                    />
                  </div>

                  <div className="board-position-sheet-field">
                    <label htmlFor="board-position-order">Order</label>
                    <input
                      id="board-position-order"
                      step="1"
                      required
                      type="number"
                      min="1"
                      value={form.display_order}
                      onChange={(e) =>
                        setForm({ ...form, display_order: e.target.value })
                      }
                      placeholder="Order"
                    />
                  </div>
                </div>
              </section>

              <section className="board-position-sheet-section" aria-labelledby="board-position-form-02">
                <div className="board-position-sheet-heading">
                  <p className="board-position-sheet-kicker">02</p>
                  <div>
                    <h3 id="board-position-form-02">Voting rule</h3>
                    <p>How many candidates a voter may select for this office.</p>
                  </div>
                </div>

                <div className="board-position-sheet-fields">
                  <div className="board-position-sheet-field">
                    <label htmlFor="board-position-max-votes">Max votes</label>
                    <input
                      id="board-position-max-votes"
                      step="1"
                      required
                      type="number"
                      min="1"
                      value={form.max_votes}
                      onChange={(e) =>
                        setForm({ ...form, max_votes: e.target.value })
                      }
                      placeholder="Max votes"
                    />
                  </div>
                </div>
              </section>

              <div className="board-position-sheet-actions board-position-sheet-footer">
                <button
                  type="button"
                  className="board-position-sheet-quiet"
                  onClick={() => { if (!positionSaveInFlight.current) setFormOpen(false); }}
                >
                  Cancel
                </button>
                <button type="submit" className="board-position-sheet-next" disabled={savingPosition}>
                  {savingPosition ? "Saving..." : editing ? "Save Changes" : "Add Position"}
                </button>
              </div>
            </form>
          </div>
        </PopupOverlay>
      )}

      {deleteReview && (
        <BoardPositionDeleteSheet
          position={deleteReview.position}
          electionTitle={selectedElection?.title}
          orgName={orgName}
          phase={deleteReview.phase}
          analysis={deleteReview.analysis}
          onClose={() => setDeleteReview(null)}
          onConfirm={confirmDelete}
          onRetire={confirmRetire}
        />
      )}
    </div>
  );
}


export default BoardPositions;
