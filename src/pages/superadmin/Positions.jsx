import { useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Unlink,
  Archive,
  Eye,
  ArrowLeft,
} from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { DependencyRow, InlineKandidLoader } from "../../components/ConfigurationUI";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import {
  attachProgramCoverage,
  fetchEligibleStudentsForOrganization,
  isOrganizationEligibleForStudent,
} from "../../utils/organizationAccess";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../../utils/deleteGuards";

const emptyPositionForm = {
  election_id: "",
  name: "",
  max_votes: 1,
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

function Positions() {
  const prompt = usePrompt();

  const [positions, setPositions] = useState([]);
  const [elections, setElections] = useState([]);
  const [students, setStudents] = useState([]);
  const [partylists, setPartylists] = useState([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingPosition, setEditingPosition] = useState(null);
  const [form, setForm] = useState(emptyPositionForm);

  const [candidateOpen, setCandidateOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateEligibility, setCandidateEligibility] = useState({});
  const [candidateForm, setCandidateForm] = useState(emptyCandidateForm);
  const [editingCandidate, setEditingCandidate] = useState(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePosition, setDeletePosition] = useState(null);
  const [deleteCandidates, setDeleteCandidates] = useState([]);
  const [deleteVoteCount, setDeleteVoteCount] = useState(0);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteView, setDeleteView] = useState("summary");
  const [positionFilter, setPositionFilter] = useState("active");
  const [retiringPosition, setRetiringPosition] = useState(false);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [positionsError, setPositionsError] = useState("");
  const [positionLifecycleReady, setPositionLifecycleReady] = useState(true);

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    await Promise.all([
      fetchElections(),
      fetchPositions(),
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
        organization_id,
        organizations (
          id,
          name,
          organization_type
        )
      `)
      .order("id", { ascending: true });

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

    setElections(
      (data || []).map((election) => ({
        ...election,
        organizations:
          organizationById.get(Number(election.organization_id)) ||
          election.organizations,
      }))
    );
  }

  async function fetchPositions() {
    setPositionsLoading(true);
    setPositionsError("");

    const lifecycleSelect = `
        id,
        election_id,
        name,
        max_votes,
        status,
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
    const baseSelect = `
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
      `;

    let { data, error } = await supabase
      .from("positions")
      .select(lifecycleSelect)
      .order("id", { ascending: true });

    if (isMissingPositionStatusError(error)) {
      console.warn("Position lifecycle migration is not applied yet:", error);
      setPositionLifecycleReady(false);
      const fallback = await supabase
        .from("positions")
        .select(baseSelect)
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
      console.error("Failed to load positions:", error);
      setPositionsError(
        "Unable to load positions because the configuration could not be retrieved."
      );
      setPositionsLoading(false);
      return;
    }

    setPositions(data || []);
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

  function openCreateForm() {
    setEditingPosition(null);
    setForm({ ...emptyPositionForm });
    setFormOpen(true);
  }

  function openEditForm(position) {
    setEditingPosition(position);
    setForm({
      election_id: position.election_id || "",
      name: position.name || "",
      max_votes: position.max_votes ?? 1,
    });
    setFormOpen(true);
  }

  function closePositionForm() {
    setFormOpen(false);
    setEditingPosition(null);
    setForm({ ...emptyPositionForm });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const electionId = Number(form.election_id);
    const name = form.name.trim();
    const maxVotes = Number(form.max_votes);

    if (!electionId) {
      prompt.error("Please select an election.");
      return;
    }

    if (!name) {
      prompt.error("Position name is required.");
      return;
    }

    if (!Number.isInteger(maxVotes) || maxVotes < 1) {
      prompt.error("Max votes must be at least 1.");
      return;
    }

    const payload = {
      election_id: electionId,
      name,
      max_votes: maxVotes,
    };

    if (editingPosition) {
      const { error } = await supabase
        .from("positions")
        .update({
          name: payload.name,
          max_votes: payload.max_votes,
        })
        .eq("id", editingPosition.id);

      if (error) {
        prompt.error(error.message || "Failed to update position.");
        return;
      }

      prompt.success("Position updated.");
    } else {
      const { error } = await supabase
        .from("positions")
        .insert([payload]);

      if (error) {
        prompt.error(error.message || "Failed to create position.");
        return;
      }

      prompt.success("Position created.");
    }

    closePositionForm();
    await fetchPositions();
  }

  // ------------------------------------------------------------
  // ELIGIBLE STUDENTS
  // ------------------------------------------------------------

  async function fetchEligibleStudents(election) {
    setStudents([]);

    if (!election?.organization_id) {
      prompt.error(
        "This election has no organization assigned. No candidates can be added."
      );
      return [];
    }

    try {
      const eligible = await fetchEligibleStudentsForOrganization(
        election.organization_id
      );
      setStudents(eligible);
      return eligible;
    } catch (error) {
      prompt.error(
        error.message ||
        "Failed to load organization-eligible students."
      );
      return [];
    }
  }

  function getElectionForPosition(position) {
    return elections.find(
      (election) =>
        String(election.id) === String(position?.election_id)
    );
  }

  function isCandidateEligible(candidate, election) {
    const student = candidate?.students;

    if (!student) return false;

    return isOrganizationEligibleForStudent(
      election?.organizations,
      student
    );
  }

  async function verifyOtherOrganizationCandidate(candidate, election) {
    if (!election?.organization_id || !candidate?.student_id) return false;

    const directEligibility = isCandidateEligible(candidate, election);
    if (directEligibility) return true;

    const { data, error } = await supabase
      .from("student_organizations")
      .select("student_id")
      .eq("organization_id", election.organization_id)
      .eq("student_id", candidate.student_id)
      .maybeSingle();

    if (error) {
      console.error(
        "Failed to verify organization membership:",
        error
      );

      return false;
    }

    return Boolean(data);
  }

  async function getCandidateEligibility(candidate, election) {
    const basicEligibility = isCandidateEligible(
      candidate,
      election
    );

    if (basicEligibility) {
      return basicEligibility;
    }

    return verifyOtherOrganizationCandidate(
      candidate,
      election
    );
  }

  // ------------------------------------------------------------
  // CANDIDATES
  // ------------------------------------------------------------

  async function fetchCandidates(positionId) {
    setCandidateLoading(true);

    const { data, error } = await supabase
      .from("candidates")
      .select(`
        id,
        student_id,
        position_id,
        partylist_id,
        students (
          id,
          student_number,
          first_name,
          last_name,
          program,
          year_level
        ),
        partylists (
          id,
          name
        )
      `)
      .eq("position_id", positionId)
      .order("id", { ascending: true });

    if (error) {
      prompt.error(error.message || "Failed to load candidates.");
      setCandidateLoading(false);
      return [];
    }

    setCandidates(data || []);
    setCandidateLoading(false);
    return data || [];
  }

  async function openCandidates(position) {
    setSelectedPosition(position);
    setCandidateForm({ ...emptyCandidateForm });
    setEditingCandidate(null);
    setCandidateOpen(true);
    setCandidateEligibility({});

    const election = getElectionForPosition(position);

    const [loadedCandidates] = await Promise.all([
      fetchCandidates(position.id),
      fetchEligibleStudents(election),
    ]);

    const eligibility = {};

    for (const candidate of loadedCandidates || []) {
      eligibility[candidate.id] =
        await getCandidateEligibility(
          candidate,
          election
        );
    }

    setCandidateEligibility(eligibility);
  }

  async function refreshCandidateEligibility(candidateList = candidates) {
    const election = selectedPosition
      ? getElectionForPosition(selectedPosition)
      : null;

    const eligibility = {};

    for (const candidate of candidateList || []) {
      eligibility[candidate.id] =
        await getCandidateEligibility(
          candidate,
          election
        );
    }

    setCandidateEligibility(eligibility);
  }

  function closeCandidates() {
    setCandidateOpen(false);
    setSelectedPosition(null);
    setCandidates([]);
    setStudents([]);
    setCandidateEligibility({});
    setCandidateForm({ ...emptyCandidateForm });
    setEditingCandidate(null);
  }

  function startAddCandidate() {
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

    if (!selectedPosition) {
      prompt.error("No position selected.");
      return;
    }

    if (!candidateForm.student_id) {
      prompt.error("Please select a student.");
      return;
    }

    const election = getElectionForPosition(selectedPosition);

    if (!election?.organization_id) {
      prompt.error(
        "This election has no organization. Candidate creation is blocked."
      );
      return;
    }

    // IMPORTANT:
    // The student MUST exist in the eligible pool calculated
    // specifically for this election's organization.
    const eligibleStudent = students.find(
      (student) =>
        String(student.id) === String(candidateForm.student_id)
    );

    if (!eligibleStudent) {
      prompt.error(
        "This student is not eligible for this election's organization."
      );
      return;
    }

    if (!isOrganizationEligibleForStudent(election.organizations, eligibleStudent)) {
      prompt.error(
        "This student is not eligible for this election's organization."
      );
      return;
    }

    if (editingCandidate && candidateEligibility[editingCandidate.id] === false) {
      prompt.error(
        "This invalid candidate must be disconnected or deleted before editing."
      );
      return;
    }

    // Prevent duplicate student assignment to the same position.
    const duplicate = candidates.find(
      (candidate) =>
        String(candidate.student_id) ===
        String(candidateForm.student_id) &&
        String(candidate.id) !==
        String(editingCandidate?.id || "")
    );

    if (duplicate) {
      prompt.error(
        "This student is already a candidate for this position."
      );
      return;
    }

    const payload = {
      student_id: candidateForm.student_id,
      position_id: selectedPosition.id,
      partylist_id: candidateForm.partylist_id || null,
    };

    if (editingCandidate) {
      const { error } = await supabase
        .from("candidates")
        .update({
          student_id: payload.student_id,
          partylist_id: payload.partylist_id,
        })
        .eq("id", editingCandidate.id);

      if (error) {
        prompt.error(error.message || "Failed to update candidate.");
        return;
      }

      prompt.success("Candidate updated.");
    } else {
      const { error } = await supabase
        .from("candidates")
        .insert([payload]);

      if (error) {
        prompt.error(error.message || "Failed to add candidate.");
        return;
      }

      prompt.success("Candidate added.");
    }

    setEditingCandidate(null);
    setCandidateForm({ ...emptyCandidateForm });
    const refreshed = await fetchCandidates(selectedPosition.id);
    await refreshCandidateEligibility(refreshed);
  }

  async function deleteCandidate(candidate) {
    const studentName = [
      candidate.students?.first_name,
      candidate.students?.last_name,
    ]
      .filter(Boolean)
      .join(" ");
    const analysis = await analyzeDeleteDependencies("candidate", candidate);

    if (analysis.blocked) {
      await prompt.alert({
        title: "Candidate Cannot Be Deleted",
        message: dependencyMessage(studentName || "This candidate", analysis),
        type: "warning",
        confirmText: "Keep Candidate",
      });
      return;
    }

    const confirmed = await prompt.confirm({
      title: "Delete Candidate?",
      message:
        `Delete ${studentName || "this candidate"}? The student record will not be deleted.`,
      type: "danger",
      confirmText: "Delete Candidate",
    });

    if (!confirmed) return;

    const recheck = await analyzeDeleteDependencies("candidate", candidate);
    if (recheck.blocked) {
      prompt.error(dependencyMessage(studentName || "This candidate", recheck));
      return;
    }

    const { error } = await supabase
      .from("candidates")
      .delete()
      .eq("id", candidate.id);

    if (error) {
      prompt.error(error.message || "Failed to delete candidate.");
      return;
    }

    prompt.success("Candidate deleted.");
    const election = getElectionForPosition(selectedPosition);
    await logAuditEvent({
      action: "candidate_deleted",
      entityType: "candidate",
      entityId: candidate.id,
      entityLabel: studentName || "Candidate",
      organizationId: election?.organization_id,
      organizationName: election?.organizations?.name,
      status: "completed",
    });
    const refreshed = await fetchCandidates(selectedPosition.id);
    await refreshCandidateEligibility(refreshed);
  }

  async function disconnectCandidate(candidate) {
    const studentName = [
      candidate.students?.first_name,
      candidate.students?.last_name,
    ]
      .filter(Boolean)
      .join(" ");
    const analysis = await analyzeDeleteDependencies("candidate", candidate);

    if (analysis.blocked) {
      await prompt.alert({
        title: "Candidate Has Protected History",
        message:
          `${dependencyMessage(studentName || "This candidate", analysis)}\n\nKeep the candidate linked so receipts and results remain verifiable.`,
        type: "warning",
        confirmText: "Keep Linked",
      });
      return;
    }

    const confirmed = await prompt.confirm({
      title: "Disconnect Candidate?",
      message:
        `Disconnect ${studentName || "this candidate"} from this position?`,
      type: "danger",
      confirmText: "Disconnect",
    });

    if (!confirmed) return;

    const recheck = await analyzeDeleteDependencies("candidate", candidate);
    if (recheck.blocked) {
      prompt.error(dependencyMessage(studentName || "This candidate", recheck));
      return;
    }

    const { error } = await supabase
      .from("candidates")
      .update({ position_id: null })
      .eq("id", candidate.id);

    if (error) {
      prompt.error(
        error.message ||
        "Failed to disconnect candidate."
      );
      return;
    }

    prompt.success("Candidate disconnected.");
    const election = getElectionForPosition(selectedPosition);
    await logAuditEvent({
      action: "candidate_updated",
      entityType: "candidate",
      entityId: candidate.id,
      entityLabel: studentName || "Candidate",
      organizationId: election?.organization_id,
      organizationName: election?.organizations?.name,
      status: "completed",
      metadata: { position_id: null, previous_position_id: selectedPosition?.id },
    });
    const refreshed = await fetchCandidates(selectedPosition.id);
    await refreshCandidateEligibility(refreshed);
  }

  // ------------------------------------------------------------
  // DELETE POSITION
  // ------------------------------------------------------------

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
      supabase
        .from("candidates")
        .select(`
          id,
          student_id,
          position_id,
          partylist_id,
          students (
            id,
            student_number,
            first_name,
            last_name,
            program,
            year_level
          ),
          partylists (
            id,
            name
          )
        `)
        .eq("position_id", position.id)
        .order("id", { ascending: true }),
      supabase
        .from("votes")
        .select("id", { count: "exact", head: true })
        .eq("position_id", position.id),
    ]);

    if (error) {
      prompt.error(
        error.message ||
        "Failed to load candidates linked to this position."
      );
      closeDeleteConfiguration();
      return;
    }

    setDeleteCandidates(data || []);
    setDeleteVoteCount(voteResult?.count || 0);
    setDeleteLoading(false);
  }

  async function refreshDeleteCandidates() {
    if (!deletePosition) return;

    setDeleteLoading(true);

    const [{ data, error }, voteResult] = await Promise.all([
      supabase
        .from("candidates")
        .select(`
        id,
        student_id,
        position_id,
        partylist_id,
        students (
          id,
          student_number,
          first_name,
          last_name,
          program,
          year_level
        ),
        partylists (
          id,
          name
        )
      `)
        .eq("position_id", deletePosition.id)
        .order("id", { ascending: true }),
      supabase
        .from("votes")
        .select("id", { count: "exact", head: true })
        .eq("position_id", deletePosition.id),
    ]);

    if (error) {
      prompt.error(error.message || "Failed to refresh candidates.");
      setDeleteLoading(false);
      return;
    }

    setDeleteCandidates(data || []);
    setDeleteVoteCount(voteResult?.count || 0);
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

    const { error } = await supabase
      .from("positions")
      .update({ status: "retired" })
      .eq("id", deletePosition.id);

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
    const studentName = [
      candidate.students?.first_name,
      candidate.students?.last_name,
    ]
      .filter(Boolean)
      .join(" ");
    const analysis = await analyzeDeleteDependencies("candidate", candidate);

    if (analysis.blocked) {
      await prompt.alert({
        title: "Candidate Cannot Be Deleted",
        message: dependencyMessage(studentName || "This candidate", analysis),
        type: "warning",
        confirmText: "Keep Candidate",
      });
      return;
    }

    const confirmed = await prompt.confirm({
      title: "Delete Candidate?",
      message:
        "Delete the candidate record? The student will remain in the student directory.",
      type: "danger",
      confirmText: "Delete Candidate",
    });

    if (!confirmed) return;

    const recheck = await analyzeDeleteDependencies("candidate", candidate);
    if (recheck.blocked) {
      prompt.error(dependencyMessage(studentName || "This candidate", recheck));
      return;
    }

    const { error } = await supabase
      .from("candidates")
      .delete()
      .eq("id", candidate.id);

    if (error) {
      prompt.error(error.message || "Failed to delete candidate.");
      return;
    }

    prompt.success("Candidate deleted.");
    const election = getElectionForPosition(deletePosition);
    await logAuditEvent({
      action: "candidate_deleted",
      entityType: "candidate",
      entityId: candidate.id,
      entityLabel: studentName || "Candidate",
      organizationId: election?.organization_id,
      organizationName: election?.organizations?.name,
      status: "completed",
    });
    await refreshDeleteCandidates();
  }

  async function disconnectLinkedCandidate(candidate) {
    const studentName = [
      candidate.students?.first_name,
      candidate.students?.last_name,
    ]
      .filter(Boolean)
      .join(" ");
    const analysis = await analyzeDeleteDependencies("candidate", candidate);

    if (analysis.blocked) {
      await prompt.alert({
        title: "Candidate Has Protected History",
        message:
          `${dependencyMessage(studentName || "This candidate", analysis)}\n\nKeep the candidate linked so receipts and results remain verifiable.`,
        type: "warning",
        confirmText: "Keep Linked",
      });
      return;
    }

    const confirmed = await prompt.confirm({
      title: "Disconnect Candidate?",
      message:
        "Disconnect the candidate from this position without deleting the student.",
      type: "danger",
      confirmText: "Disconnect",
    });

    if (!confirmed) return;

    const recheck = await analyzeDeleteDependencies("candidate", candidate);
    if (recheck.blocked) {
      prompt.error(dependencyMessage(studentName || "This candidate", recheck));
      return;
    }

    const { error } = await supabase
      .from("candidates")
      .update({ position_id: null })
      .eq("id", candidate.id);

    if (error) {
      prompt.error(
        error.message ||
        "Failed to disconnect candidate."
      );
      return;
    }

    prompt.success("Candidate disconnected.");
    const election = getElectionForPosition(deletePosition);
    await logAuditEvent({
      action: "candidate_updated",
      entityType: "candidate",
      entityId: candidate.id,
      entityLabel: studentName || "Candidate",
      organizationId: election?.organization_id,
      organizationName: election?.organizations?.name,
      status: "completed",
      metadata: { position_id: null, previous_position_id: deletePosition?.id },
    });
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

    const { count: voteCount, error: voteCountError } = await supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("position_id", deletePosition.id);

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

    const { error } = await supabase
      .from("positions")
      .delete()
      .eq("id", deletePosition.id);

    if (error) {
      prompt.error(error.message || "Failed to delete position.");
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

  const selectedElection = selectedPosition
    ? getElectionForPosition(selectedPosition)
    : null;

  const selectedOrganizationName =
    selectedElection?.organizations?.name || "Unknown organization";

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
          <h1 className="page-title">Positions</h1>
          <p className="page-subtitle">
            Define positions for each election and manage eligible candidates.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateForm}
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

      {positionsLoading ? (
        <div className="empty-state mt-8">
          Loading positions...
        </div>
      ) : positionsError ? (
        <div className="empty-state mt-8">
          <p>{positionsError}</p>
          <button
            type="button"
            onClick={fetchPositions}
            className="primary-btn mt-4"
          >
            Try Again
          </button>
        </div>
      ) : visiblePositions.length === 0 ? (
        <div className="empty-state mt-8">
          No {positionFilter === "all" ? "" : positionFilter} positions found.
        </div>
      ) : (
        <div className="entity-grid">
          {visiblePositions.map((position) => (
            <div
              key={position.id}
              className="entity-card lift-card"
            >
              <button
                type="button"
                onClick={() => openCandidates(position)}
                className="block w-full text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff7a35]">
                      {position.elections?.title || "Unknown election"}
                    </p>

                    <h2 className="entity-card-title mt-2">
                      {position.name}
                    </h2>

                    <p className="mt-1 text-xs font-semibold text-gray-400">
                      Click to manage candidates
                    </p>
                  </div>

                  <span className="status-pill">
                    {position.status === "retired"
                      ? "Retired"
                      : `${position.max_votes} vote${position.max_votes > 1 ? "s" : ""}`}
                  </span>
                </div>

                <p className="entity-meta">
                  Voters can select up to {position.max_votes} candidate
                  {position.max_votes > 1 ? "s" : ""}.
                </p>
              </button>

              <div className="entity-actions">
                <button
                  type="button"
                  onClick={() => openEditForm(position)}
                  className="icon-action"
                  title="Edit position"
                >
                  <Pencil size={16} />
                </button>

                <button
                  type="button"
                  onClick={() => openDeleteConfiguration(position)}
                  className="icon-action icon-action-danger"
                  title="Delete position"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* POSITION FORM */}
      {formOpen && (
        <PopupOverlay>
          <div className="modal-card max-w-lg">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="field-label">Ballot Structure</p>
                <h2 className="mt-1 text-2xl font-black">
                  {editingPosition ? "Edit Position" : "Add Position"}
                </h2>
              </div>

              <button
                type="button"
                onClick={closePositionForm}
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
              </div>

              <div>
                <label className="field-label">Position Name</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) =>
                    setForm({
                      ...form,
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
                  value={form.max_votes}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      max_votes: e.target.value,
                    })
                  }
                  className="field-shell w-full"
                />
              </div>

              <button type="submit" className="primary-btn w-full">
                {editingPosition ? "Save Changes" : "Create Position"}
              </button>
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
                    {selectedElection?.organizations?.organization_type ===
                    "non_departmental"
                      ? "All students are eligible for this organization type."
                      : "Eligible students come from this organization's covered programs and explicit memberships."}
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
                onSubmit={handleCandidateSubmit}
                className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto]"
              >
                <div>
                  <label className="field-label">Eligible Student</label>

                  <select
                    required
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

                    {partylists.map((party) => (
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
                    disabled={!students.length}
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

                    const eligible =
                      candidateEligibility[candidate.id] === true;

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

                          {!eligible && (
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

                            {!eligible && (
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
                                : "Invalid candidate: disconnect or delete first"
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
          <div className="modal-card max-w-3xl">
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
                        className="flex flex-col gap-4 rounded-[0.85rem] border border-gray-200 bg-white p-4 md:flex-row md:items-center md:justify-between"
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
