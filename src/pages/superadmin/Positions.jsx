import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Unlink,
  Archive,
  Eye,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { DependencyRow, InlineKandidLoader } from "../../components/ConfigurationUI";
import { supabase } from "../../lib/supabaseClient";
import { createPositionSubmission, savePositionEdit, changePositionStatus, reorderPositions, deleteUnreferencedPosition, positionSaveError } from "../../utils/positionManagementContract";
import { createCandidateSubmission, saveCandidateEdit, deleteCandidateSafely, disconnectCandidateSafely, loadCandidateManagementContext, mergeCandidatePartylists, candidateSaveError } from "../../utils/candidateManagementContract";
import SuperAdminPageHeader from "../../components/SuperAdminPageHeader";
import { usePrompt } from "../../context/PromptContext";
import {
  attachProgramCoverage,
} from "../../utils/organizationAccess";
import { isStudentInTrustedEligibilityPool } from "../../utils/candidateEligibility";
import { logAuditEvent } from "../../utils/auditLog";
import {
  isMissingPositionOrderError,
  sortPositions,
} from "../../utils/positionOrder";
import { getElectionPhase, isMissingElectionCoverColumn } from "../../utils/elections";
import { useElectionClock } from "../../utils/useElectionClock";
import { getVoteDependencyCount } from "../../utils/voteAccess";
import { loadAdminCandidates } from "../../utils/adminCandidates";
import "./Positions.css";

const emptyPositionForm = {
  election_id: "",
  name: "",
  max_votes: 1,
  display_order: 1,
};

const emptyCandidateForm = {
  student_id: "",
  partylist_id: "",
};

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

function formatElectionPhase(election, now) {
  const phase = String(getElectionPhase(election, now) || "scheduled");
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function selectionLimitLabel(maxVotes) {
  const limit = Number(maxVotes) || 1;
  return `Voters may select up to ${limit} candidate${limit === 1 ? "" : "s"}.`;
}

function Positions() {
  const prompt = usePrompt();
  const now = useElectionClock();

  const [positions, setPositions] = useState([]);
  const [elections, setElections] = useState([]);
  const [students, setStudents] = useState([]);
  const [partylists, setPartylists] = useState([]);

  const [formOpen, setFormOpen] = useState(false);
  const [savingPosition, setSavingPosition] = useState(false);
  const positionSaveInFlight = useRef(false);
  const createSubmission = useRef(null);
  const positionOperationInFlight = useRef(false);
  const [editingPosition, setEditingPosition] = useState(null);
  const [form, setForm] = useState(emptyPositionForm);

  const [candidateOpen, setCandidateOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateEligibility, setCandidateEligibility] = useState({});
  const [candidateEligibilityAvailable, setCandidateEligibilityAvailable] = useState(false);
  const [candidateForm, setCandidateForm] = useState(emptyCandidateForm);
  const [editingCandidate, setEditingCandidate] = useState(null);
  const [savingCandidate, setSavingCandidate] = useState(false);
  const candidateSaveInFlight = useRef(false);
  const candidateSubmission = useRef(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePosition, setDeletePosition] = useState(null);
  const [deleteCandidates, setDeleteCandidates] = useState([]);
  const [deleteVoteCount, setDeleteVoteCount] = useState(0);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteView, setDeleteView] = useState("summary");
  const [positionFilter, setPositionFilter] = useState("active");
  const [retiringPosition, setRetiringPosition] = useState(false);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionsError, setPositionsError] = useState("");
  const [positionLifecycleReady, setPositionLifecycleReady] = useState(true);
  const [selectedElectionId, setSelectedElectionId] = useState("");
  const [positionCounts, setPositionCounts] = useState({});
  const [draggedPositionId, setDraggedPositionId] = useState(null);

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (!selectedElectionId) {
      // Keep the position collection aligned with the explicitly unselected ballot state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPositions([]);
      return;
    }

    let cancelled = false;
    fetchPositions(selectedElectionId, () => cancelled);

    return () => {
      cancelled = true;
    };
  }, [selectedElectionId]);

  async function loadInitialData() {
    await Promise.all([
      fetchElections(),
      fetchPartylists(),
    ]);
  }

  // ------------------------------------------------------------
  // POSITIONS
  // ------------------------------------------------------------

  async function fetchElections() {
    const { data, error } = await supabase
      .from("elections")
      .select(`
        id,
        title,
        cover_url,
        organization_id,
        status,
        campaign_start,
        campaign_end,
        start_date,
        end_date,
        organizations (
          id,
          name,
          logo_url,
          organization_type
        )
      `)
      .order("id", { ascending: false });

    if (isMissingElectionCoverColumn(error)) {
      const fallback = await supabase
        .from("elections")
        .select(`
          id,
          title,
          organization_id,
          status,
          campaign_start,
          campaign_end,
          start_date,
          end_date,
          organizations (
            id,
            name,
            logo_url,
            organization_type
          )
        `)
        .order("id", { ascending: false });

      if (fallback.error) {
        prompt.error(fallback.error.message || "Failed to load elections.");
        return;
      }

      const organizations = await attachProgramCoverage(
        (fallback.data || []).map((election) => election.organizations).filter(Boolean)
      );
      const organizationById = new Map(
        organizations.map((organization) => [Number(organization.id), organization])
      );

      const nextElections = (fallback.data || []).map((election) => ({
          ...election,
          organizations:
            organizationById.get(Number(election.organization_id)) ||
            election.organizations,
        }));
      setElections(nextElections);
      fetchPositionCounts(nextElections);
      return;
    }

    if (error) {
      prompt.error(error.message || "Failed to load elections.");
      return;
    }

    const organizations = await attachProgramCoverage(
      (data || []).map((election) => election.organizations).filter(Boolean)
    );
    const organizationById = new Map(
      organizations.map((organization) => [Number(organization.id), organization])
    );

    const nextElections = (data || []).map((election) => ({
        ...election,
        organizations:
          organizationById.get(Number(election.organization_id)) ||
          election.organizations,
      }));
    setElections(nextElections);
    fetchPositionCounts(nextElections);
  }

  async function fetchPositionCounts(electionRows) {
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
    if (!electionId) {
      setPositions([]);
      setPositionsLoading(false);
      return;
    }

    setPositionsLoading(true);
    setPositionsError("");

    const baseSelect = `
        id,
        election_id,
        name,
        max_votes,
        status,
        display_order,
        elections (
          id,
          title,
          organization_id,
          organizations (
            id,
            name,
            organization_type
          )
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
            id,
            title,
            organization_id,
            organizations (
              id,
              name,
              organization_type
            )
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
      console.error("Failed to load positions:", error);
      if (isStale()) return;
      setPositionsError(
        "Unable to load positions because the configuration could not be retrieved."
      );
      setPositionsLoading(false);
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
    setPositionsLoading(false);
  }

  async function fetchPartylists() {
    const { data, error } = await supabase
      .from("partylists")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) {
      prompt.error(error.message || "Failed to load partylists.");
      return;
    }

    setPartylists(data || []);
  }

  function openCreateForm(electionId = "") {
    createSubmission.current = createPositionSubmission(supabase);
    const election = elections.find((item) => String(item.id) === String(electionId));
    if (election && ["closed", "archived", "done"].includes(String(getElectionPhase(election, now)).toLowerCase())) {
      prompt.error("This election is closed. Position forms are no longer available.");
      return;
    }
    setEditingPosition(null);
    setForm({
      ...emptyPositionForm,
      election_id: electionId,
      display_order: electionId ? getNextDisplayOrder(electionId) : emptyPositionForm.display_order,
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

  function openEditForm(position) {
    setEditingPosition(position);
    setForm({
      election_id: position.election_id || "",
      name: position.name || "",
      max_votes: position.max_votes ?? 1,
      display_order: position.display_order || positions.indexOf(position) + 1,
    });
    setFormOpen(true);
  }

  function closePositionForm() {
    if (positionSaveInFlight.current) return;
    setFormOpen(false);
    setEditingPosition(null);
    setForm({ ...emptyPositionForm });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (positionSaveInFlight.current) return;
    positionSaveInFlight.current = true;
    setSavingPosition(true);
    try {
      const parentId = Number(editingPosition?.election_id || form.election_id);
      const values = { ...form, election_id: Number(form.election_id) };
      const result = editingPosition
        ? await savePositionEdit(supabase, editingPosition, values)
        : await (createSubmission.current ||= createPositionSubmission(supabase))(values, parentId);
      if (result.error) { prompt.error(positionSaveError(result.error)); return; }
      if (!Number.isSafeInteger(result.data?.id) || result.data.id <= 0) { prompt.error('The saved position could not be confirmed. Refresh before retrying.'); return; }
      if (result.unchanged) { prompt.info('No changes to save.'); return; }
      const savedId = result.data.id;
      const creating = !editingPosition;
      setFormOpen(false);
      await fetchPositions(parentId);
      prompt.success(creating ? 'Position created.' : 'Position updated.');
      if (creating) {
        const addCandidateNow = await prompt.confirm({ title: 'Add Candidate Now?', message: values.name.trim() + ' was created. You can add a candidate now or finish setup later from Candidate Management.', type: 'success', confirmText: 'Add Candidate', cancelText: 'Done' });
        if (addCandidateNow) await openCandidates({ ...values, id: savedId, status: "active" });
      }
    } catch (error) { prompt.error(positionSaveError(error)); }
    finally { positionSaveInFlight.current = false; setSavingPosition(false); }
  }

  async function fetchEligibleStudents(election) {
    setStudents([]);
    setCandidateEligibilityAvailable(false);

    if (!election?.organization_id) {
      prompt.error(
        "This election has no organization assigned. No candidates can be added."
      );
      return null;
    }

    try {
      const context = await loadCandidateManagementContext(supabase, election.id);
      const eligible = context.eligible_students;
      setPartylists((current) => mergeCandidatePartylists(current, context));
      setStudents(eligible);
      setCandidateEligibilityAvailable(true);
      return eligible;
    } catch (error) {
      prompt.error(
        candidateSaveError(error) ||
        "Failed to load organization-eligible students."
      );
      return null;
    }
  }

  function getElectionForPosition(position) {
    return elections.find(
      (election) =>
        String(election.id) === String(position?.election_id)
    );
  }

  // ------------------------------------------------------------
  // CANDIDATES
  // ------------------------------------------------------------

  async function fetchCandidates(positionId) {
    setCandidateLoading(true);
    const position = positions.find((item) => Number(item.id) === Number(positionId));
    const { data: candidateRows, error } = position?.election_id
      ? await loadAdminCandidates({ electionIds: [position.election_id] })
      : { data: null, error: new Error("Election-scoped candidate access is unavailable.") };

    if (error) {
      prompt.error(error.message || "Failed to load candidates.");
      setCandidateLoading(false);
      return [];
    }

    const data = (candidateRows || [])
      .filter((candidate) => Number(candidate.position_id) === Number(positionId))
      .sort((left, right) => Number(left.id) - Number(right.id));
    setCandidates(data);
    setCandidateLoading(false);
    return data;
  }

  async function openCandidates(position) {
    candidateSubmission.current = createCandidateSubmission(supabase);
    setSelectedPosition(position);
    setCandidateForm({ ...emptyCandidateForm });
    setEditingCandidate(null);
    setCandidateOpen(true);
    setCandidateEligibility({});

    const election = getElectionForPosition(position);

    const [loadedCandidates, eligibleStudents] = await Promise.all([
      fetchCandidates(position.id),
      fetchEligibleStudents(election),
    ]);

    const eligibility = {};

    if (Array.isArray(eligibleStudents)) {
      for (const candidate of loadedCandidates || []) {
        eligibility[candidate.id] = isStudentInTrustedEligibilityPool(
          eligibleStudents,
          candidate.student_id,
        );
      }
    }

    setCandidateEligibility(eligibility);
  }

  async function refreshCandidateEligibility(candidateList = candidates) {
    const eligibility = {};

    if (candidateEligibilityAvailable) {
      for (const candidate of candidateList || []) {
        eligibility[candidate.id] = isStudentInTrustedEligibilityPool(
          students,
          candidate.student_id,
        );
      }
    }

    setCandidateEligibility(eligibility);
  }

  function closeCandidates() {
    if (candidateSaveInFlight.current) return;
    setCandidateOpen(false);
    setSelectedPosition(null);
    setCandidates([]);
    setStudents([]);
    setCandidateEligibility({});
    setCandidateEligibilityAvailable(false);
    setCandidateForm({ ...emptyCandidateForm });
    setEditingCandidate(null);
  }

  function startAddCandidate() {
    if (candidateSaveInFlight.current) return;
    candidateSubmission.current = createCandidateSubmission(supabase);
    setEditingCandidate(null);
    setCandidateForm({ ...emptyCandidateForm });
  }

  function startEditCandidate(candidate) {
    setEditingCandidate(candidate);
    setCandidateForm({
      student_id: candidate.student_id || "",
      partylist_id: candidate.partylist_id || "",
    });
  }

  async function handleCandidateSubmit(event) {
    event.preventDefault();
    if (!selectedPosition || candidateSaveInFlight.current) return;
    candidateSaveInFlight.current = true; setSavingCandidate(true);
    try {
      const values = { ...editingCandidate, ...candidateForm, position_id: selectedPosition.id };
      const result = editingCandidate
        ? await saveCandidateEdit(supabase, editingCandidate, values, selectedPosition.election_id)
        : await (candidateSubmission.current ||= createCandidateSubmission(supabase))(values, selectedPosition.election_id);
      if (result.error) { prompt.error(candidateSaveError(result.error)); return; }
      if (!Number.isInteger(result.data?.id) || result.data.id <= 0) { prompt.error("Candidate save was not confirmed. Refresh before retrying."); return; }
      prompt.success(result.unchanged ? "No changes to save." : editingCandidate ? "Candidate updated." : "Candidate added.");
      candidateSubmission.current = createCandidateSubmission(supabase);
      setEditingCandidate(null); setCandidateForm({ ...emptyCandidateForm });
      const refreshed = await fetchCandidates(selectedPosition.id); await refreshCandidateEligibility(refreshed);
    } catch (error) { prompt.error(candidateSaveError(error)); }
    finally { candidateSaveInFlight.current = false; setSavingCandidate(false); }
  }

  async function deleteCandidate(candidate) {
    const parent = selectedPosition;
    if (!parent) { prompt.error('Select the candidate position first.'); return; }
    try { await loadCandidateManagementContext(supabase, parent.election_id); }
    catch (error) { prompt.error(candidateSaveError(error)); return; }
    const studentName = [candidate.students?.first_name, candidate.students?.last_name].filter(Boolean).join(' ') || 'this candidate';
    const confirmed = await prompt.confirm({ title: 'Delete Candidate?', message: `Delete ${studentName}? The student record will not be deleted.`, type: 'danger', confirmText: 'Delete Candidate' });
    if (!confirmed) return;
    const result = await deleteCandidateSafely(supabase, candidate, parent.election_id);
    if (result.error) { prompt.error(candidateSaveError(result.error)); return; }
    prompt.success('Candidate deleted.');
    const election = getElectionForPosition(parent);
    await logAuditEvent({ action: 'candidate_deleted', entityType: 'candidate', entityId: candidate.id, entityLabel: studentName, organizationId: election?.organization_id, organizationName: election?.organizations?.name, status: 'completed' });
    const refreshed = await fetchCandidates(parent.id); await refreshCandidateEligibility(refreshed);
  }

  async function disconnectCandidate(candidate) {
    const parent = selectedPosition;
    if (!parent) { prompt.error('Select the candidate position first.'); return; }
    try { await loadCandidateManagementContext(supabase, parent.election_id); }
    catch (error) { prompt.error(candidateSaveError(error)); return; }
    const studentName = [candidate.students?.first_name, candidate.students?.last_name].filter(Boolean).join(' ') || 'this candidate';
    const confirmed = await prompt.confirm({ title: 'Disconnect Candidate?', message: `Disconnect ${studentName} from this position? The student and candidate record will be retained.`, type: 'danger', confirmText: 'Disconnect' });
    if (!confirmed) return;
    const result = await disconnectCandidateSafely(supabase, candidate, parent.election_id);
    if (result.error) { prompt.error(candidateSaveError(result.error)); return; }
    prompt.success('Candidate disconnected.');
    const election = getElectionForPosition(parent);
    await logAuditEvent({ action: 'candidate_updated', entityType: 'candidate', entityId: candidate.id, entityLabel: studentName, organizationId: election?.organization_id, organizationName: election?.organizations?.name, status: 'completed', metadata: { position_id: null, previous_position_id: parent.id } });
    const refreshed = await fetchCandidates(parent.id); await refreshCandidateEligibility(refreshed);
  }

  async function openDeleteConfiguration(position) {
    const confirmed = await prompt.confirm({
      title: "Delete Position?",
      message:
        `Candidates linked to "${position.name}" must be handled before the position can be deleted.`,
      type: "danger",
      confirmText: "Configure Position",
    });

    if (!confirmed) return;

    setDeletePosition(position);
    setDeleteCandidates([]);
    setDeleteVoteCount(0);
    setDeleteView("summary");
    setDeleteLoading(true);
    setDeleteOpen(true);

    const [{ data, error }, voteResult] = await Promise.all([
      loadAdminCandidates({ electionIds: [position.election_id] }).then((result) => ({
        ...result,
        data: (result.data || []).filter((candidate) => Number(candidate.position_id) === Number(position.id)),
      })),
      getVoteDependencyCount("position", position.id),
    ]);

    if (error) {
      prompt.error(
        error.message ||
        "Failed to load candidates linked to this position."
      );
      closeDeleteConfiguration();
      return;
    }

    if (voteResult.error) {
      prompt.error("Vote dependencies could not be verified. The position cannot be deleted yet.");
      closeDeleteConfiguration();
      return;
    }

    setDeleteCandidates(data || []);
    setDeleteVoteCount(voteResult.count);
    setDeleteLoading(false);
  }

  async function refreshDeleteCandidates() {
    if (!deletePosition) return;

    setDeleteLoading(true);

    const [{ data, error }, voteResult] = await Promise.all([
      loadAdminCandidates({ electionIds: [deletePosition.election_id] }).then((result) => ({
        ...result,
        data: (result.data || []).filter((candidate) => Number(candidate.position_id) === Number(deletePosition.id)),
      })),
      getVoteDependencyCount("position", deletePosition.id),
    ]);

    if (error) {
      prompt.error(error.message || "Failed to refresh candidates.");
      setDeleteLoading(false);
      return;
    }

    if (voteResult.error) {
      prompt.error("Vote dependencies could not be verified. The position cannot be deleted yet.");
      setDeleteLoading(false);
      return;
    }

    setDeleteCandidates(data || []);
    setDeleteVoteCount(voteResult.count);
    setDeleteLoading(false);
  }

  async function openRelatedPositionRecords() {
    await refreshDeleteCandidates();
    setDeleteView("related");
  }

  async function manageBlockingCandidates() {
    if (!deletePosition) return;
    closeDeleteConfiguration();
    await openCandidates(deletePosition);
  }

  async function retirePosition() {
    if (!deletePosition || retiringPosition) return;

    if (!positionLifecycleReady) {
      prompt.error(
        "Position retirement is unavailable until the position lifecycle migration is applied in Supabase."
      );
      return;
    }

    setRetiringPosition(true);

    const { error } = await changePositionStatus(supabase, deletePosition, "retired");

    if (error) {
      setRetiringPosition(false);
      prompt.error(
        error.message ||
          "Failed to retire position. Apply the position lifecycle migration first."
      );
      return;
    }

    const election = getElectionForPosition(deletePosition);

    await logAuditEvent({
      action: "position_retired",
      entityType: "position",
      entityId: deletePosition.id,
      entityLabel: deletePosition.name,
      organizationId: election?.organization_id,
      organizationName: election?.organizations?.name,
      status: "completed",
      metadata: {
        vote_count: deleteVoteCount,
        candidate_count: deleteCandidates.length,
      },
    });

    prompt.success("Position retired. Historical votes and receipts were preserved.");
    setRetiringPosition(false);
    closeDeleteConfiguration();
    if (selectedPosition?.id === deletePosition.id) closeCandidates();
    await fetchPositions();
  }

  async function deleteLinkedCandidate(candidate) {
    const parent = deletePosition;
    if (!parent) { prompt.error('Select the candidate position first.'); return; }
    try { await loadCandidateManagementContext(supabase, parent.election_id); }
    catch (error) { prompt.error(candidateSaveError(error)); return; }
    const studentName = [candidate.students?.first_name, candidate.students?.last_name].filter(Boolean).join(' ') || 'this candidate';
    const confirmed = await prompt.confirm({ title: 'Delete Candidate?', message: `Delete ${studentName}? The student record will not be deleted.`, type: 'danger', confirmText: 'Delete Candidate' });
    if (!confirmed) return;
    const result = await deleteCandidateSafely(supabase, candidate, parent.election_id);
    if (result.error) { prompt.error(candidateSaveError(result.error)); return; }
    prompt.success('Candidate deleted.');
    const election = getElectionForPosition(parent);
    await logAuditEvent({ action: 'candidate_deleted', entityType: 'candidate', entityId: candidate.id, entityLabel: studentName, organizationId: election?.organization_id, organizationName: election?.organizations?.name, status: 'completed' });
    await refreshDeleteCandidates();
  }

  async function disconnectLinkedCandidate(candidate) {
    const parent = deletePosition;
    if (!parent) { prompt.error('Select the candidate position first.'); return; }
    try { await loadCandidateManagementContext(supabase, parent.election_id); }
    catch (error) { prompt.error(candidateSaveError(error)); return; }
    const studentName = [candidate.students?.first_name, candidate.students?.last_name].filter(Boolean).join(' ') || 'this candidate';
    const confirmed = await prompt.confirm({ title: 'Disconnect Candidate?', message: `Disconnect ${studentName} from this position? The student and candidate record will be retained.`, type: 'danger', confirmText: 'Disconnect' });
    if (!confirmed) return;
    const result = await disconnectCandidateSafely(supabase, candidate, parent.election_id);
    if (result.error) { prompt.error(candidateSaveError(result.error)); return; }
    prompt.success('Candidate disconnected.');
    const election = getElectionForPosition(parent);
    await logAuditEvent({ action: 'candidate_updated', entityType: 'candidate', entityId: candidate.id, entityLabel: studentName, organizationId: election?.organization_id, organizationName: election?.organizations?.name, status: 'completed', metadata: { position_id: null, previous_position_id: parent.id } });
    await refreshDeleteCandidates();
  }

  async function confirmPositionDeletion() {
    if (!deletePosition) return;

    if (deleteCandidates.length > 0) {
      prompt.error(
        "Handle all linked candidates before deleting the position."
      );
      return;
    }

    const { count: voteCount, error: voteCountError } = await getVoteDependencyCount("position", deletePosition.id);

    if (voteCountError) {
      prompt.error(
        voteCountError.message ||
        "Failed to check vote records linked to this position."
      );
      return;
    }

    if ((voteCount || 0) > 0) {
      setDeleteVoteCount(voteCount || 0);
      prompt.error(
        `${deletePosition.name} cannot be deleted because ${voteCount} vote record${voteCount === 1 ? "" : "s"} still reference this position. Use Retire Position to preserve election history.`
      );
      return;
    }

    const confirmed = await prompt.confirm({
      title: "Confirm Position Deletion",
      message:
        `Delete "${deletePosition.name}" permanently?`,
      type: "danger",
      confirmText: "Delete Position",
    });

    if (!confirmed) return;

    const { error } = await deleteUnreferencedPosition(supabase, deletePosition);

    if (error) {
      prompt.error(positionSaveError(error));
      return;
    }

    prompt.success("Position deleted.");

    const election = getElectionForPosition(deletePosition);
    await logAuditEvent({
      action: "position_deleted",
      entityType: "position",
      entityId: deletePosition.id,
      entityLabel: deletePosition.name,
      organizationId: election?.organization_id,
      organizationName: election?.organizations?.name,
      status: "completed",
    });

    if (selectedPosition?.id === deletePosition.id) {
      closeCandidates();
    }

    closeDeleteConfiguration();
    await fetchPositions();
  }

  function closeDeleteConfiguration() {
    setDeleteOpen(false);
    setDeletePosition(null);
    setDeleteCandidates([]);
    setDeleteVoteCount(0);
    setDeleteLoading(false);
    setDeleteView("summary");
    setRetiringPosition(false);
  }

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------

  const selectedPositionElection = selectedPosition
    ? getElectionForPosition(selectedPosition)
    : null;
  const selectedElection = elections.find(
    (election) => Number(election.id) === Number(selectedElectionId)
  );

  const selectedOrganizationName =
    selectedPositionElection?.organizations?.name || "Unknown organization";

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
  const multipleSelectionCount = positions.filter(
    (position) => Number(position.max_votes) > 1
  ).length;
  const positionCountsByElection = positionCounts;
  const selectedElectionClosed = selectedElection
    ? ["closed", "archived", "done"].includes(
        String(getElectionPhase(selectedElection, now)).toLowerCase()
      )
    : false;

  async function movePosition(position, direction) {
    if (positionOperationInFlight.current) return;
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
    <div className="sa-positions">
      <SuperAdminPageHeader
        section="Election operations"
        title="Positions"
        description="Define the offices and voting limits that shape each election ballot."
        actions={(
          <>
          <span>Election register</span>
          <strong>{elections.length} election{elections.length === 1 ? "" : "s"}</strong>
          {!selectedElectionId ? (
            <button type="button" onClick={() => openCreateForm()} className="sa-positions-add">
              <Plus size={16} />
              Add Position
            </button>
          ) : null}
          </>
        )}
      />

      {!positionLifecycleReady ? (
        <div className="sa-positions-notice">
          Position lifecycle controls are unavailable until the required database migration is applied.
          Existing positions are shown as active.
        </div>
      ) : null}

      {positionsLoading ? (
        <section className="sa-positions-loading" aria-live="polite">
          <p className="sa-positions-eyebrow">Loading ballot structure</p>
          <strong>Retrieving positions for this election.</strong>
          <div aria-hidden="true"><span /><span /><span /></div>
        </section>
      ) : positionsError ? (
        <section className="sa-positions-error" role="alert">
          <p className="sa-positions-eyebrow">Configuration unavailable</p>
          <h2>Positions could not be loaded.</h2>
          <p>{positionsError}</p>
          <button type="button" onClick={fetchPositions}>Try Again</button>
        </section>
      ) : !selectedElectionId ? (
        elections.length === 0 ? (
          <section className="sa-positions-empty">
            <span>00</span>
            <div>
              <h2>No elections available</h2>
              <p>Create an election before defining its ballot positions.</p>
            </div>
          </section>
        ) : (
          <section className="sa-ballot-selector">
            <header>
              <div>
                <p className="sa-positions-eyebrow">Select an election</p>
                <h2>Choose the ballot to structure.</h2>
              </div>
              <p>Positions remain scoped to one election. Select a record to review its office sequence.</p>
            </header>
            <div className="sa-ballot-selector-list">
              {elections.map((election, index) => (
                <button
                  key={election.id}
                  type="button"
                  className="sa-ballot-selector-record"
                  onClick={() => setSelectedElectionId(String(election.id))}
                >
                  <span className="sa-ballot-selector-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="sa-ballot-selector-identity">
                    <small>{election.organizations?.name || "Organization not assigned"}</small>
                    <strong>{election.title}</strong>
                  </span>
                  <span className="sa-ballot-selector-phase">{formatElectionPhase(election, now)}</span>
                  <span className="sa-ballot-selector-count">
                    <strong>{positionCountsByElection[election.id] || 0}</strong>
                    position{positionCountsByElection[election.id] === 1 ? "" : "s"}
                  </span>
                  <span className="sa-ballot-selector-command">Structure ballot</span>
                </button>
              ))}
            </div>
          </section>
        )
      ) : !selectedElection ? (
        <section className="sa-positions-error" role="alert">
          <p className="sa-positions-eyebrow">Election unavailable</p>
          <h2>The selected election could not be found.</h2>
          <button type="button" onClick={() => setSelectedElectionId("")}>Return to election selection</button>
        </section>
      ) : (
        <main className="sa-ballot-workspace">
          <button type="button" onClick={() => setSelectedElectionId("")} className="sa-ballot-back">
            <ArrowLeft size={15} />
            Choose another election
          </button>

          <section className="sa-ballot-context">
            <div className="sa-ballot-context-label">
              <span>Election</span>
              <strong>{formatElectionPhase(selectedElection, now)}</strong>
            </div>
            <div className="sa-ballot-context-title">
              <p>{selectedElection.organizations?.name || "Organization not assigned"}</p>
              <h2>{selectedElection.title}</h2>
              <span>Ballot office sequence and selection limits</span>
            </div>
            {selectedElectionClosed ? (
              <p className="sa-ballot-closed">Closed election</p>
            ) : (
              <button type="button" onClick={() => openCreateForm(selectedElection.id)} className="sa-positions-add">
                <Plus size={16} />
                Add Position
              </button>
            )}
          </section>

          <section className="sa-positions-summary" aria-label="Ballot structure summary">
            {[
              [positions.length, "Total positions"],
              [activePositionCount, "Active"],
              [retiredPositionCount, "Retired"],
              [multipleSelectionCount, "Multiple selection"],
            ].map(([value, label], index) => (
              <div className="sa-positions-summary-item" key={label}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{value}</strong>
                <p>{label}</p>
              </div>
            ))}
          </section>

          <section className="sa-position-register">
            <header className="sa-position-register-head">
              <div>
                <p className="sa-positions-eyebrow">Office sequence</p>
                <h2>Ballot order</h2>
              </div>
              <div className="sa-position-filters" aria-label="Filter positions">
                {[
                  ["active", `Active ${activePositionCount}`],
                  ["retired", `Retired ${retiredPositionCount}`],
                  ["all", `All ${positions.length}`],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={!positionLifecycleReady && value === "retired"}
                    onClick={() => setPositionFilter(value)}
                    className={positionFilter === value ? "is-active" : ""}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </header>

            {visiblePositions.length === 0 ? (
              <div className="sa-positions-empty">
                <span>00</span>
                <div>
                  <h3>{positions.length === 0 ? "No positions yet" : `No ${positionFilter} positions`}</h3>
                  <p>
                    {positions.length === 0
                      ? "This election does not have a ballot structure yet. Add the first position to begin."
                      : "Choose another lifecycle filter to review this ballot structure."}
                  </p>
                </div>
                {positions.length === 0 && !selectedElectionClosed ? (
                  <button type="button" onClick={() => openCreateForm(selectedElection.id)}>
                    <Plus size={15} /> Add Position
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="sa-position-list">
                {visiblePositions.map((position) => (
                  <article
                    key={position.id}
                    className={`sa-position-record ${Number(draggedPositionId) === Number(position.id) ? "is-dragging" : ""}`}
                    draggable={(position.status || "active") !== "retired"}
                    onDragStart={() => setDraggedPositionId(position.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDragEnd={() => setDraggedPositionId(null)}
                    onDrop={() => dropPosition(position)}
                    onDoubleClick={() => movePosition(position, 1)}
                    title={(position.status || "active") === "retired" ? "Retired position" : "Drag to reorder, or double-click to move down."}
                  >
                    <div className="sa-position-order">
                      <span>Order</span>
                      <strong>{String(position.display_order || 1).padStart(2, "0")}</strong>
                    </div>
                    <button type="button" onClick={() => openCandidates(position)} className="sa-position-identity">
                      <small>{position.status === "retired" ? "Retired office" : "Ballot office"}</small>
                      <h3>{position.name}</h3>
                      <span>Manage candidates</span>
                    </button>
                    <div className="sa-position-limit">
                      <span>Selection limit</span>
                      <strong>{position.max_votes} candidate{Number(position.max_votes) === 1 ? "" : "s"}</strong>
                      <p>{selectionLimitLabel(position.max_votes)}</p>
                    </div>
                    <div className="sa-position-actions">
                      <div className="sa-position-reorder" aria-label={`Reorder ${position.name}`}>
                        <button type="button" onClick={() => movePosition(position, -1)} title="Move up" aria-label={`Move ${position.name} up`}>
                          <ArrowUp size={16} />
                        </button>
                        <button type="button" onClick={() => movePosition(position, 1)} title="Move down" aria-label={`Move ${position.name} down`}>
                          <ArrowDown size={16} />
                        </button>
                      </div>
                      <button type="button" onClick={() => openEditForm(position)} title="Edit position">
                        <Pencil size={15} /> Edit
                      </button>
                      <button type="button" onClick={() => openDeleteConfiguration(position)} className="is-danger" title="Delete position">
                        <Trash2 size={15} /> Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      {/* POSITION FORM */}
      {formOpen && (
        <PopupOverlay>
          <div className="modal-card position-form-dialog">
            <header className="position-form-header">
              <div>
                <p>Ballot Structure</p>
                <h2>
                  {editingPosition ? "Edit Position" : "Add Position"}
                </h2>
                <span>
                  {editingPosition
                    ? "Update this office without changing its linked candidates."
                    : "Add an office and its voting limit to an election ballot."}
                </span>
              </div>

              <button
                type="button"
                onClick={closePositionForm}
                className="position-form-close"
                aria-label="Close position form"
              >
                <X size={20} />
              </button>
            </header>

            <form onSubmit={handleSubmit} className="position-form-workspace">
              <label>
                <span className="field-label">Election</span>
                <select
                  required
                  disabled={Boolean(editingPosition) || savingPosition}
                  value={form.election_id}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      election_id: e.target.value,
                      display_order: editingPosition
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
                      {election.organizations?.name
                        ? ` — ${election.organizations.name}`
                        : ""}
                    </option>
                  ))}
                </select>
                <small>The position will appear only on this election ballot.</small>
              </label>

              <label>
                <span className="field-label">Position Name</span>
                <input
                  required
                  value={form.name}
                  id="sa-position-name"
                  maxLength={100}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      name: e.target.value,
                    })
                  }
                  placeholder="e.g. President"
                  className="field-shell w-full"
                />
              </label>

              <div className="position-form-numeric-fields">
                <label>
                <span className="field-label">Selection Limit</span>
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={form.max_votes}
                  id="sa-position-max-votes"
                  onChange={(e) =>
                    setForm({
                      ...form,
                      max_votes: e.target.value,
                    })
                  }
                  className="field-shell w-full"
                />
                <small>Maximum candidates a voter may select for this position.</small>
                </label>

                <label>
                <span className="field-label">Ballot Order</span>
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={form.display_order}
                  id="sa-position-order"
                  onChange={(e) =>
                    setForm({
                      ...form,
                      display_order: e.target.value,
                    })
                  }
                  className="field-shell w-full"
                />
                <small>Controls where this office appears in the ballot sequence.</small>
                </label>
              </div>

              <footer className="position-form-actions">
                <button type="button" onClick={closePositionForm} className="secondary-btn">Cancel</button>
                <button type="submit" className="primary-btn" disabled={savingPosition}>
                  {editingPosition ? "Save Changes" : "Add Position"}
                </button>
              </footer>
            </form>
          </div>
        </PopupOverlay>
      )}

      {/* CANDIDATE MANAGEMENT */}
      {candidateOpen && selectedPosition && (
        <PopupOverlay>
          <div className="modal-card max-w-4xl">
            <div className="flex items-start justify-between mb-6">
              <div>
                <p className="field-label">Candidate Management</p>

                <h2 className="mt-1 text-2xl font-black">
                  {selectedPosition.name}
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  {selectedElection?.title || "Unknown election"}
                </p>

                <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-[#ff7a35]">
                  Organization: {selectedOrganizationName}
                </p>
              </div>

              <button
                type="button"
                onClick={closeCandidates}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black">
                    {editingCandidate ? "Edit Candidate" : "Add Candidate"}
                  </h3>

                  <p className="text-sm text-gray-500">
                    Students are listed by the trusted organization eligibility check.
                  </p>
                </div>

                {editingCandidate && (
                  <button
                    type="button"
                    onClick={startAddCandidate}
                    className="secondary-btn"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>

              <form
                id="sa-position-candidate-form"
                onSubmit={handleCandidateSubmit}
                className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto]"
              >
                <div>
                  <label className="field-label">Eligible Student</label>

                  <select
                    required
                    id="sa-position-candidate-student"
                    disabled={!!editingCandidate || savingCandidate}
                    value={candidateForm.student_id}
                    onChange={(e) =>
                      setCandidateForm({
                        ...candidateForm,
                        student_id: e.target.value,
                      })
                    }
                    className="field-shell w-full"
                  >
                    <option value="">
                      {students.length
                        ? "Select Eligible Student"
                        : "No Eligible Students"}
                    </option>

                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.student_number} — {student.last_name},{" "}
                        {student.first_name}
                        {student.program ? ` (${student.program})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="field-label">Partylist</label>

                  <select
                    id="sa-position-candidate-partylist"
                    disabled={savingCandidate}
                    value={candidateForm.partylist_id}
                    onChange={(e) =>
                      setCandidateForm({
                        ...candidateForm,
                        partylist_id: e.target.value,
                      })
                    }
                    className="field-shell w-full"
                  >
                    <option value="">
                      Independent / No Partylist
                    </option>

                    {partylists.filter(p => (p.election_id == null || Number(p.election_id) === Number(selectedPosition?.election_id)) && Number(p.organization_id) === Number(selectedPositionElection?.organization_id)).map((party) => (
                      <option key={party.id} value={party.id}>
                        {party.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    type="submit"
                    className="primary-btn w-full"
                    disabled={!students.length || savingCandidate}
                  >
                    {editingCandidate ? "Save Changes" : "Add Candidate"}
                  </button>
                </div>
              </form>
            </div>

            <div className="mt-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black">Candidates</h3>
                  <p className="text-sm text-gray-500">
                    {candidates.length} candidate
                    {candidates.length !== 1 ? "s" : ""} assigned.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={startAddCandidate}
                  className="secondary-btn"
                >
                  <Plus size={16} />
                  Add Candidate
                </button>
              </div>

              {candidateLoading ? (
                <div className="empty-state">Loading candidates...</div>
              ) : candidates.length === 0 ? (
                <div className="empty-state">
                  No candidates configured for this position.
                </div>
              ) : (
                <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                  {candidates.map((candidate) => {
                    const student = candidate.students;
                    const name = [
                      student?.first_name,
                      student?.last_name,
                    ]
                      .filter(Boolean)
                      .join(" ");

                    const eligibilityVerified =
                      typeof candidateEligibility[candidate.id] === "boolean";
                    const eligible = candidateEligibility[candidate.id] === true;

                    return (
                      <div
                        key={candidate.id}
                        className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <p className="text-lg font-black">
                            {name || "Unknown Student"}
                          </p>

                          <p className="mt-1 text-sm text-gray-500">
                            Student ID:{" "}
                            {student?.student_number ||
                              candidate.student_id ||
                              "-"}
                          </p>

                          {eligibilityVerified && !eligible && (
                            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                              <p className="text-xs font-black uppercase tracking-[0.12em] text-red-700">
                                Invalid Organization Eligibility
                              </p>

                              <p className="mt-1 text-xs text-red-600">
                                This student is not eligible for this election's organization.
                                Disconnect or delete this candidate.
                              </p>
                            </div>
                          )}

                          <div className="mt-2 flex flex-wrap gap-2">
                            {student?.program && (
                              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
                                {student.program}
                              </span>
                            )}

                            {student?.year_level && (
                              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
                                Year {student.year_level}
                              </span>
                            )}

                            <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-700">
                              {candidate.partylists?.name || "Independent"}
                            </span>

                            {eligibilityVerified && !eligible && (
                              <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
                                Invalid Candidate
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => startEditCandidate(candidate)}
                            disabled={!eligible}
                            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
                            title={
                              eligible
                                ? "Edit candidate"
                                : eligibilityVerified
                                  ? "Invalid candidate: disconnect or delete first"
                                  : "Current eligibility could not be verified"
                            }
                          >
                            <Pencil size={16} />
                          </button>

                          <button
                            type="button"
                            onClick={() => disconnectCandidate(candidate)}
                            className="secondary-btn"
                          >
                            <Unlink size={15} />
                            Disconnect
                          </button>

                          <button
                            type="button"
                            onClick={() => deleteCandidate(candidate)}
                            className="p-2 rounded-lg bg-red-100 text-red-600 hover:bg-red-200"
                            title="Delete candidate"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={closeCandidates}
                className="secondary-btn"
              >
                Close
              </button>
            </div>
          </div>
        </PopupOverlay>
      )}

      {/* POSITION DELETE CONFIGURATION */}
      {deleteOpen && deletePosition && (
        <PopupOverlay>
          <div className="modal-card max-w-3xl position-delete-dialog">
            <div className="config-modal-header mb-6">
              <div className="min-w-0 flex-1">
                <p className="config-eyebrow">Position Configuration</p>

                <h2 className="config-title">
                  {deleteView === "related" ? "Related Records" : "Delete"} {deletePosition.name}
                </h2>

                <p className="config-description">
                  {deletePosition.status === "retired"
                    ? "This position is retired and preserved for historical election records."
                    : "Review dependencies and choose a safe lifecycle action."}
                </p>
              </div>

              <button
                type="button"
                onClick={closeDeleteConfiguration}
                className="config-close-btn"
                aria-label="Close position configuration"
              >
                <X size={20} />
              </button>
            </div>

            {deleteLoading ? (
              <div className="config-panel">
                <div className="flex items-center gap-3">
                  <InlineKandidLoader />
                  <p className="font-bold text-[#1d262f]">Checking related records...</p>
                </div>
                <div className="mt-5 grid gap-3">
                  <div className="config-skeleton-row" />
                  <div className="config-skeleton-row" />
                  <div className="config-skeleton-row" />
                </div>
              </div>
            ) : deleteView === "related" ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="config-panel">
                    <p className="config-section-label">Active Configuration</p>
                    <div className="dependency-list mt-3">
                      <DependencyRow
                        label="Candidates"
                        count={deleteCandidates.length}
                        badge={deleteCandidates.length > 0 ? "Requires Action" : ""}
                      />
                    </div>
                  </div>

                  <div className="config-panel">
                    <p className="config-section-label">Historical Records</p>
                    <div className="dependency-list mt-3">
                    {[
                      ["Votes", deleteVoteCount],
                      ["Results", deleteVoteCount > 0 ? 1 : 0],
                      ["Receipts", deleteVoteCount],
                      ["Verification", deleteVoteCount],
                    ].map(([label, count]) => (
                      <DependencyRow
                        key={label}
                        label={label}
                        count={count}
                        badge={count > 0 ? "Protected" : ""}
                      />
                    ))}
                    </div>
                  </div>
                </div>

                <p className="config-alert mt-4 text-sm font-semibold leading-6">
                  Historical vote choices, receipt hashes, and verification records are protected.
                  This view only shows counts and does not expose private ballot selections.
                </p>

                <div className="config-footer">
                  <button
                    type="button"
                    onClick={() => setDeleteView("summary")}
                    className="secondary-btn"
                  >
                    <ArrowLeft size={16} />
                    Return to {deletePosition.name} Configuration
                  </button>

                  {deleteVoteCount > 0 && deletePosition.status !== "retired" ? (
                    <button
                      type="button"
                      onClick={retirePosition}
                      disabled={retiringPosition}
                      className="primary-btn disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {retiringPosition ? (
                        <InlineKandidLoader bars={3} />
                      ) : (
                        <Archive size={16} />
                      )}
                      {retiringPosition ? "Retiring..." : "Retire Position"}
                    </button>
                  ) : null}
                </div>
              </>
            ) : deleteCandidates.length === 0 && deleteVoteCount === 0 ? (
              <>
                <div className="config-panel border-green-200 bg-green-50">
                  <p className="font-black text-green-800">
                    No candidates are linked to this position.
                  </p>

                  <p className="mt-1 text-sm text-green-700">
                    The position can now be deleted.
                  </p>
                </div>

                <div className="config-footer">
                  <button
                    type="button"
                    onClick={closeDeleteConfiguration}
                    className="secondary-btn"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={confirmPositionDeletion}
                    className="primary-btn"
                  >
                    <Trash2 size={16} />
                    Permanently Delete
                  </button>
                </div>
              </>
            ) : deleteCandidates.length === 0 && deleteVoteCount > 0 ? (
              <>
                <div className="config-recommended-panel">
                  <p className="config-section-label">Recommended</p>
                  <p className="font-black text-orange-800">
                    Retire Position
                  </p>

                  <div className="dependency-list mt-4">
                    {[
                      ["Candidates", deleteCandidates.length, ""],
                      ["Votes", deleteVoteCount, "Protected"],
                      ["Receipts", deleteVoteCount, "Protected"],
                      ["Verification", deleteVoteCount, "Protected"],
                    ].map(([label, count, badge]) => (
                      <DependencyRow key={label} label={label} count={count} badge={badge} />
                    ))}
                  </div>

                  <p className="mt-4 text-sm text-orange-700">
                    Retire this position to remove it from active configuration while preserving
                    votes, results, receipts, verification records, and audit history.
                  </p>
                </div>

                <div className="config-footer">
                  <button
                    type="button"
                    onClick={openRelatedPositionRecords}
                    className="secondary-btn"
                  >
                    <Eye size={16} />
                    View Related Records
                  </button>

                  <button
                    type="button"
                    onClick={closeDeleteConfiguration}
                    className="secondary-btn"
                  >
                    Cancel
                  </button>

                  {deletePosition.status !== "retired" ? (
                    <button
                      type="button"
                      onClick={retirePosition}
                      disabled={retiringPosition}
                      className="primary-btn disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {retiringPosition ? (
                        <InlineKandidLoader bars={3} />
                      ) : (
                        <Archive size={16} />
                      )}
                      {retiringPosition ? "Retiring..." : "Retire Position"}
                    </button>
                  ) : null}
                </div>
              </>
            ) : deleteVoteCount > 0 ? (
              <>
                <div className="config-alert mb-5">
                  <p className="config-section-label">Protected History</p>
                  <p className="font-black text-orange-800">
                    Votes exist for this position, so permanent deletion is disabled.
                  </p>
                  <p className="mt-1 text-sm text-orange-700">
                    Manage the active candidate links if needed, then retire the position to
                    preserve historical election data.
                  </p>
                </div>

                <div className="config-footer">
                  <button
                    type="button"
                    onClick={manageBlockingCandidates}
                    className="secondary-btn"
                  >
                    Manage {deleteCandidates.length} Candidate
                    {deleteCandidates.length !== 1 ? "s" : ""}
                  </button>
                  <button
                    type="button"
                    onClick={openRelatedPositionRecords}
                    className="secondary-btn"
                  >
                    <Eye size={16} />
                    View Related Records
                  </button>
                  <button
                    type="button"
                    onClick={closeDeleteConfiguration}
                    className="secondary-btn"
                  >
                    Cancel
                  </button>
                  {deletePosition.status !== "retired" ? (
                    <button
                      type="button"
                      onClick={retirePosition}
                      disabled={retiringPosition}
                      className="primary-btn disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {retiringPosition ? (
                        <InlineKandidLoader bars={3} />
                      ) : (
                        <Archive size={16} />
                      )}
                      {retiringPosition ? "Retiring..." : "Retire Position"}
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div className="config-alert mb-5">
                  <p className="font-black text-orange-800">
                    {deleteCandidates.length} candidate
                    {deleteCandidates.length !== 1 ? "s" : ""} linked
                  </p>

                  <p className="mt-1 text-sm text-orange-700">
                    Disconnect or delete all linked candidates first.
                  </p>
                </div>

                <div className="max-h-[420px] space-y-3 overflow-y-auto">
                  {deleteCandidates.map((candidate) => {
                    const student = candidate.students;
                    const name = [
                      student?.first_name,
                      student?.last_name,
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <div
                        key={candidate.id}
                        className="position-delete-candidate-row flex flex-col gap-4 border border-gray-200 bg-white p-4 md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <p className="font-black">
                            {name || "Unknown Candidate"}
                          </p>

                          <p className="mt-1 text-sm text-gray-500">
                            Student ID:{" "}
                            {student?.student_number ||
                              candidate.student_id ||
                              "-"}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              disconnectLinkedCandidate(candidate)
                            }
                            className="secondary-btn"
                          >
                            <Unlink size={15} />
                            Disconnect
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              deleteLinkedCandidate(candidate)
                            }
                            className="icon-action icon-action-danger"
                            title="Delete candidate"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="config-footer">
                  <button
                    type="button"
                    onClick={manageBlockingCandidates}
                    className="secondary-btn"
                  >
                    Manage {deleteCandidates.length} Candidate
                    {deleteCandidates.length !== 1 ? "s" : ""}
                  </button>

                  <button
                    type="button"
                    onClick={closeDeleteConfiguration}
                    className="secondary-btn"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default Positions;
