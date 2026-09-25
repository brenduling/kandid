import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import PopupOverlay from "./PopupOverlay";
import StudentSearchPicker from "./StudentSearchPicker";
import ElectionManagementCard from "./ElectionManagementCard";
import { OrganizationLogo } from "./KandidImage";
import { supabase } from "../lib/supabaseClient";
import {
  createCampaignMaterialsDraft,
  normalizeCampaignMaterialsInput,
  parseCampaignMaterials,
} from "../utils/candidates";
import { usePrompt } from "../context/PromptContext";
import { logAuditEvent } from "../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../utils/deleteGuards";
import { getElectionPhase, isMissingElectionCoverColumn } from "../utils/elections";
import { fetchEligibleStudentsForOrganization } from "../utils/organizationAccess";
import { isMissingPositionOrderError } from "../utils/positionOrder";

const ELECTION_PHASE_LABELS = {
  draft: "Draft",
  archived: "Archived",
  closed: "Concluded",
  campaign_upcoming: "Campaign upcoming",
  campaign: "Campaigning",
  waiting: "Awaiting voting",
  voting: "Voting now",
  scheduled: "Scheduled",
  active: "Active",
};

const electionPhaseLabel = (election) => {
  const phase = getElectionPhase(election);
  return ELECTION_PHASE_LABELS[phase] || String(phase || "Status unavailable").replaceAll("_", " ");
};

function createInitialForm() {
  return {
    election_id: "",
    position_id: "",
    student_id: "",
    partylist_id: "",
    photo: "",
    bio: "",
    platform: "",
    credentials: "",
    campaign_materials: createCampaignMaterialsDraft(),
  };
}

function candidateName(candidate) {
  return `${candidate?.students?.first_name || ""} ${candidate?.students?.last_name || ""}`.trim();
}

function candidateInitials(candidate) {
  const first = candidate?.students?.first_name?.trim()?.[0] || "";
  const last = candidate?.students?.last_name?.trim()?.[0] || "";
  return `${first}${last}`.toUpperCase() || "C";
}

function attachCandidateContext(candidate, positionsById, electionsById) {
  const position = positionsById.get(Number(candidate.position_id));
  const election = electionsById.get(Number(position?.election_id));

  return {
    ...candidate,
    positions: position
      ? {
          ...position,
          elections: election || position.elections || null,
        }
      : candidate.positions,
  };
}

function CandidateManagement({
  boardScoped = false,
  superAdminEditorial = false,
  title = "Candidate management",
  subtitle = "Assign students as candidates and prepare campaign details.",
}) {
  const prompt = usePrompt();
  const [searchParams, setSearchParams] = useSearchParams();
  const handledPreselectRef = useRef("");
  const candidateRequestRef = useRef(0);
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const orgId = boardScoped ? user?.organization_id : null;

  const [elections, setElections] = useState([]);
  const [positions, setPositions] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [students, setStudents] = useState([]);
  const [partylists, setPartylists] = useState([]);
  const [candidateCounts, setCandidateCounts] = useState({});
  const [studentQuery, setStudentQuery] = useState("");
  const [selectedElectionId, setSelectedElectionId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState(null);
  const [form, setForm] = useState(createInitialForm);
  const [landingLoading, setLandingLoading] = useState(true);
  const [landingError, setLandingError] = useState("");
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState("");

  const preselectedPositionId = searchParams.get("position") || "";

  const electionsById = useMemo(
    () => new Map(elections.map((election) => [Number(election.id), election])),
    [elections],
  );

  const positionsById = useMemo(
    () => new Map(positions.map((position) => [Number(position.id), position])),
    [positions],
  );

  const selectedElectionCandidates = candidatesForElection(selectedElectionId);

  const fetchCandidateCounts = useCallback(async (positionRows) => {
    const positionIds = positionRows.map((position) => position.id).filter(Boolean);
    if (positionIds.length === 0) {
      setCandidateCounts({});
      return;
    }

    const { data, error } = await supabase
      .from("candidates")
      .select("id, position_id")
      .in("position_id", positionIds);

    if (error) {
      console.error("Failed to load candidate counts:", error);
      return;
    }

    const electionByPosition = new Map(
      positionRows.map((position) => [Number(position.id), position.election_id]),
    );
    const counts = Object.fromEntries(
      [...new Set(positionRows.map((position) => String(position.election_id)))].map((id) => [
        id,
        0,
      ]),
    );

    (data || []).forEach((candidate) => {
      const electionId = electionByPosition.get(Number(candidate.position_id));
      if (electionId) counts[electionId] = (counts[electionId] || 0) + 1;
    });

    setCandidateCounts(counts);
  }, []);

  // Existing async load pattern intentionally preserved for this presentation-only pass.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const loadLandingData = useCallback(async () => {
    if (boardScoped && !orgId) {
      setElections([]);
      setPositions([]);
      setPartylists([]);
      setCandidateCounts({});
      setLandingLoading(false);
      return;
    }

    setLandingLoading(true);
    setLandingError("");

    const buildElectionQuery = (includeCoverColumn = true) => {
      const selectColumns = `
        id,
        title,
        ${includeCoverColumn ? "cover_url," : ""}
        organization_id,
        status,
        campaign_start,
        campaign_end,
        start_date,
        end_date,
        organizations(name, logo_url)
      `;
      let query = supabase
        .from("elections")
        .select(selectColumns)
        .neq("status", "archived")
        .order("id", { ascending: false });

      if (boardScoped && orgId) query = query.eq("organization_id", orgId);
      return query;
    };

    let { data: electionRows, error: electionError } = await buildElectionQuery(true);

    if (isMissingElectionCoverColumn(electionError)) {
      const fallback = await buildElectionQuery(false);
      electionRows = fallback.data;
      electionError = fallback.error;
    }

    if (electionError) {
      setLandingError(electionError.message || "Unable to load candidate elections.");
      setLandingLoading(false);
      return;
    }

    const electionIds = (electionRows || []).map((election) => election.id).filter(Boolean);
    let positionRows = [];
    let partyRows = [];

    if (electionIds.length > 0) {
      let [positionResult, partyResult] = await Promise.all([
        supabase
          .from("positions")
          .select("id, name, election_id, max_votes, display_order")
          .in("election_id", electionIds)
          .order("display_order", { ascending: true })
          .order("id", { ascending: true }),
        supabase
          .from("partylists")
          .select("id, name, election_id")
          .in("election_id", electionIds)
          .order("name", { ascending: true }),
      ]);

      if (isMissingPositionOrderError(positionResult.error)) {
        positionResult = await supabase
          .from("positions")
          .select("id, name, election_id, max_votes")
          .in("election_id", electionIds)
          .order("id", { ascending: true });
      }

      if (positionResult.error) {
        setLandingError(positionResult.error.message || "Unable to load election positions.");
        setLandingLoading(false);
        return;
      }

      positionRows = (positionResult.data || []).map((position, index) => ({
        ...position,
        display_order: position.display_order || index + 1,
        elections:
          (electionRows || []).find(
            (election) => Number(election.id) === Number(position.election_id),
          ) || null,
      }));

      if (partyResult.error) {
        console.error("Failed to load partylists:", partyResult.error);
      } else {
        partyRows = partyResult.data || [];
      }
    }

    setElections(electionRows || []);
    setPositions(positionRows);
    setPartylists(partyRows);
    setLandingLoading(false);
    fetchCandidateCounts(positionRows);
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  }, [boardScoped, fetchCandidateCounts, orgId]);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLandingData().finally(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
  }, [loadLandingData]);

  useEffect(() => {
    if (!superAdminEditorial) return undefined;
    document.body.classList.add("sa-candidates-page-active");
    return () => document.body.classList.remove("sa-candidates-page-active");
  }, [superAdminEditorial]);

  useEffect(() => {
    if (!preselectedPositionId) return;
    if (handledPreselectRef.current === preselectedPositionId) return;
    const selectedPosition = positions.find(
      (position) => String(position.id) === preselectedPositionId,
    );
    if (!selectedPosition) return;

    handledPreselectRef.current = preselectedPositionId;
    // eslint-disable-next-line react-hooks/immutability
    openCreateForm(preselectedPositionId, selectedPosition.election_id);
    setSearchParams({}, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedPositionId, positions, setSearchParams]);

  async function refreshCandidates(electionId = selectedElectionId || form.election_id) {
    const normalizedElectionId = String(electionId || "");
    if (!normalizedElectionId) {
      setCandidates([]);
      return [];
    }

    const positionIds = positions
      .filter((position) => Number(position.election_id) === Number(normalizedElectionId))
      .map((position) => position.id);

    if (positionIds.length === 0) {
      setCandidates([]);
      setCandidateCounts((current) => ({ ...current, [normalizedElectionId]: 0 }));
      return [];
    }

    const requestId = candidateRequestRef.current + 1;
    candidateRequestRef.current = requestId;
    setCandidateLoading(true);
    setCandidateError("");

    const { data, error } = await supabase
      .from("candidates")
      .select(`
        id,
        position_id,
        student_id,
        partylist_id,
        photo,
        bio,
        platform,
        credentials,
        campaign_materials,
        campaign_media_urls,
        students(first_name, last_name, student_number),
        partylists(name)
      `)
      .in("position_id", positionIds)
      .order("id", { ascending: true });

    if (candidateRequestRef.current !== requestId) return [];

    if (error) {
      setCandidateError(error.message || "Unable to load candidates.");
      setCandidateLoading(false);
      return [];
    }

    const scopedCandidates = (data || []).map((candidate) =>
      attachCandidateContext(candidate, positionsById, electionsById),
    );

    setCandidates(scopedCandidates);
    setCandidateCounts((current) => ({
      ...current,
      [normalizedElectionId]: scopedCandidates.length,
    }));
    setCandidateLoading(false);
    return scopedCandidates;
  }

  async function fetchStudentsByPosition(positionId) {
    if (!positionId) {
      setStudents([]);
      return;
    }

    const selectedPosition = positionsById.get(Number(positionId));
    const organizationId = boardScoped ? orgId : selectedPosition?.elections?.organization_id;

    if (!organizationId) {
      setStudents([]);
      return;
    }

    try {
      const data = await fetchEligibleStudentsForOrganization(organizationId);
      setStudents(data || []);
    } catch (error) {
      setStudents([]);
      prompt.error(error.message || "Unable to load eligible students.");
    }
  }

  async function openCreateForm(positionId = "", electionId = "") {
    setEditingCandidate(null);
    const selectedPosition = positionsById.get(Number(positionId));
    const nextElectionId = String(
      selectedPosition?.election_id || electionId || selectedElectionId || "",
    );
    const election = candidateElectionOptions().find(
      (item) => String(item.id) === String(nextElectionId),
    );

    if (nextElectionId && isElectionDone(election)) {
      prompt.error("This election is closed. Candidate forms are no longer available.");
      return;
    }

    if (nextElectionId) {
      setSelectedElectionId(nextElectionId);
      if (candidatesForElection(nextElectionId).length === 0) {
        await refreshCandidates(nextElectionId);
      }
    }

    if (positionId) {
      await fetchStudentsByPosition(positionId);
    } else {
      setStudents([]);
    }

    setForm({
      ...createInitialForm(),
      election_id: nextElectionId,
      position_id: positionId,
    });
    setStudentQuery("");
    setFormOpen(true);
  }

  async function openEditForm(candidate) {
    setEditingCandidate(candidate);
    const selectedPosition = positionsById.get(Number(candidate.position_id));
    const election = candidateElectionOptions().find(
      (item) => String(item.id) === String(selectedPosition?.election_id),
    );

    if (isElectionDone(election)) {
      prompt.error("This election is closed. Candidate forms are no longer available.");
      return;
    }

    setForm({
      election_id: selectedPosition?.election_id || "",
      position_id: candidate.position_id || "",
      student_id: candidate.student_id || "",
      partylist_id: candidate.partylist_id || "",
      photo: candidate.photo || "",
      bio: candidate.bio || "",
      platform: candidate.platform || "",
      credentials: candidate.credentials || "",
      campaign_materials: createCampaignMaterialsDraft(
        candidate.campaign_materials,
        candidate.campaign_media_urls,
      ),
    });

    await fetchStudentsByPosition(candidate.position_id);
    setStudentQuery(candidateName(candidate));
    setFormOpen(true);
  }

  function candidateElectionOptions() {
    return elections;
  }

  function positionsForSelectedElection() {
    return positions.filter(
      (position) => Number(position.election_id) === Number(form.election_id),
    );
  }

  function candidatesForElection(electionId) {
    if (!electionId) return candidates;
    const electionPositionIds = positions
      .filter((position) => Number(position.election_id) === Number(electionId))
      .map((position) => Number(position.id));

    return candidates.filter((candidate) =>
      electionPositionIds.includes(Number(candidate.position_id)),
    );
  }

  function selectedElectionOption() {
    return electionsById.get(Number(selectedElectionId)) || null;
  }

  function isElectionDone(election) {
    if (!election) return false;
    const phase = getElectionPhase(election);
    return ["closed", "archived", "done"].includes(String(phase).toLowerCase());
  }

  function groupedCandidatesForSelectedElection() {
    return positions
      .filter((position) => Number(position.election_id) === Number(selectedElectionId))
      .sort((a, b) => Number(a.display_order || a.id) - Number(b.display_order || b.id))
      .map((position) => ({
        position,
        candidates: selectedElectionCandidates.filter(
          (candidate) => Number(candidate.position_id) === Number(position.id),
        ),
      }));
  }

  async function openElectionPanel(electionId) {
    setSelectedElectionId(String(electionId));
    setStudents([]);
    setFormOpen(false);
    await refreshCandidates(electionId);
  }

  function partylistsForSelectedElection() {
    if (!form.election_id) return [];
    return partylists.filter(
      (partylist) => Number(partylist.election_id) === Number(form.election_id),
    );
  }

  function studentsAvailableForCandidate() {
    const selectedPosition = positionsById.get(Number(form.position_id));
    const electionPositionIds = positions
      .filter((position) => Number(position.election_id) === Number(selectedPosition?.election_id))
      .map((position) => Number(position.id));
    const usedStudentIds = new Set(
      candidates
        .filter(
          (candidate) =>
            electionPositionIds.includes(Number(candidate.position_id)) &&
            String(candidate.id) !== String(editingCandidate?.id || ""),
        )
        .map((candidate) => String(candidate.student_id)),
    );

    return students.filter((student) => !usedStudentIds.has(String(student.id)));
  }

  function updateMaterial(index, key, value) {
    const nextMaterials = [...form.campaign_materials];
    nextMaterials[index] = {
      ...nextMaterials[index],
      [key]: value,
    };
    setForm({ ...form, campaign_materials: nextMaterials });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const materials = normalizeCampaignMaterialsInput(form.campaign_materials);
    const selectedPosition = positionsById.get(Number(form.position_id));

    if (materials.length > 3) {
      await prompt.alert({
        title: "Campaign Limit",
        message: "Only 1 to 3 campaign materials are allowed per candidate.",
        type: "warning",
      });
      return;
    }

    if (!selectedPosition) {
      prompt.error("Please select a valid position.");
      return;
    }

    const selectedElection = electionsById.get(Number(selectedPosition.election_id));
    if (isElectionDone(selectedElection)) {
      prompt.error("This election is closed. Candidate forms are no longer available.");
      return;
    }

    if (!form.student_id) {
      prompt.error("Please select an eligible student.");
      return;
    }

    const electionPositionIds = positions
      .filter((position) => Number(position.election_id) === Number(selectedPosition.election_id))
      .map((position) => position.id);

    const duplicateElectionCandidate = candidates.find(
      (candidate) =>
        String(candidate.student_id) === String(form.student_id) &&
        electionPositionIds.map(Number).includes(Number(candidate.position_id)) &&
        String(candidate.id) !== String(editingCandidate?.id || ""),
    );

    if (duplicateElectionCandidate) {
      prompt.error(
        `This student is already a candidate for ${duplicateElectionCandidate.positions?.name || "another position"} in this election.`,
      );
      return;
    }

    const payload = {
      position_id: Number(form.position_id),
      student_id: Number(form.student_id),
      partylist_id: form.partylist_id ? Number(form.partylist_id) : null,
      photo: form.photo || null,
      bio: form.bio || null,
      platform: form.platform || null,
      credentials: form.credentials || null,
      campaign_materials: materials,
      campaign_media_urls: materials.map((item) => item.url),
    };

    const query = editingCandidate
      ? supabase.from("candidates").update(payload).eq("id", editingCandidate.id)
      : supabase.from("candidates").insert([payload]);

    const { error } = await query;

    if (error) {
      console.error("Candidate save failed:", error);
      prompt.error(error.message || "Failed to save candidate.");
      return;
    }

    await refreshCandidates(form.election_id);

    if (editingCandidate) {
      prompt.success("Candidate updated.");
      setFormOpen(false);
      return;
    }

    const addAnother = await prompt.confirm({
      title: "Candidate Created",
      message: `Add another candidate to ${selectedPosition.name} for ${selectedElection?.title || "this election"}?`,
      type: "success",
      confirmText: "Add Another",
      cancelText: "Done",
    });

    if (addAnother) {
      setForm({
        ...form,
        student_id: "",
        photo: "",
        bio: "",
        platform: "",
        credentials: "",
        campaign_materials: createCampaignMaterialsDraft(),
      });
      setStudentQuery("");
      return;
    }

    setSelectedElectionId(String(selectedPosition.election_id || form.election_id || ""));
    setFormOpen(false);
  }

  async function handleDelete(candidate) {
    const id = candidate.id;
    const label = candidateName(candidate) || "Candidate";
    const orgIdForAudit = candidate.positions?.elections?.organization_id || orgId;
    const analysis = await analyzeDeleteDependencies("candidate", candidate);

    if (analysis.blocked) {
      await logAuditEvent({
        action: "candidate_delete_blocked",
        entityType: "candidate",
        entityId: id,
        entityLabel: label,
        organizationId: orgIdForAudit,
        organizationName: user?.organizations?.name,
        status: "requires_action",
        metadata: { dependencies: analysis.dependencies },
      });
      await prompt.alert({
        title: "Candidate Cannot Be Deleted",
        message: dependencyMessage(label, analysis),
        type: "warning",
        confirmText: "Review Candidate",
      });
      return;
    }

    const ok = await prompt.confirm({
      title: "Delete Candidate?",
      message: dependencyMessage(label, analysis),
      type: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;

    const recheck = await analyzeDeleteDependencies("candidate", candidate);
    if (recheck.blocked) {
      prompt.error(dependencyMessage(label, recheck));
      return;
    }

    const { error } = await supabase.from("candidates").delete().eq("id", id);
    if (error) {
      console.error("Candidate delete failed:", error);
      prompt.error(error.message || "Failed to delete candidate.");
      return;
    }

    prompt.success("Candidate deleted.");
    await logAuditEvent({
      action: "candidate_deleted",
      entityType: "candidate",
      entityId: id,
      entityLabel: label,
      organizationId: orgIdForAudit,
      organizationName: user?.organizations?.name,
      status: "completed",
    });
    refreshCandidates(selectedElectionId || candidate.positions?.election_id);
  }

  const selectedElection = selectedElectionOption();
  const selectedElectionPositionGroups = groupedCandidatesForSelectedElection();
  const selectedElectionPositionCount = selectedElectionPositionGroups.length;

  return (
    <div className={boardScoped ? "board-candidates-desktop" : superAdminEditorial ? "sa-candidates" : undefined}>
      <div className={`page-head ${boardScoped ? "board-candidates-opening" : superAdminEditorial ? "sa-candidates-masthead" : ""}`}>
        <div className={boardScoped ? "board-candidates-opening-copy" : undefined}>
          {superAdminEditorial ? <p className="sa-candidates-breadcrumb">Kandid / Super Admin</p> : null}
          <div className={`page-kicker ${boardScoped ? "board-candidates-kicker" : superAdminEditorial ? "sa-candidates-eyebrow" : ""}`}>
            Candidate Field
          </div>
          <h1 className={`page-title ${boardScoped ? "board-candidates-title" : ""}`}>
            {superAdminEditorial ? "Candidates" : title}
          </h1>
          <p className="page-subtitle">
            {superAdminEditorial
              ? "Shape each election field by ballot position, student identity, and campaign record."
              : subtitle}
          </p>
        </div>

        {superAdminEditorial ? (
          <aside className="sa-candidates-masthead-aside">
            <span>Election field</span>
            <strong>{candidateElectionOptions().length} election{candidateElectionOptions().length === 1 ? "" : "s"}</strong>
            {!selectedElectionId ? (
              <button
                type="button"
                onClick={() => openCreateForm()}
                className="primary-btn self-start lg:self-auto sa-candidates-add"
                disabled={landingLoading || Boolean(landingError)}
              >
                <Plus size={18} />
                Add Candidate
              </button>
            ) : null}
          </aside>
        ) : (
            <button
              type="button"
              onClick={() => openCreateForm()}
              className={`primary-btn self-start lg:self-auto ${boardScoped ? "board-candidates-create" : ""}`}
              disabled={landingLoading || Boolean(landingError)}
            >
              <Plus size={18} />
              Add Candidate
            </button>
        )}
      </div>

      {landingError ? (
        <div className={`soft-card ${boardScoped ? "board-candidates-state" : superAdminEditorial ? "sa-candidates-state" : "mt-8"}`}>
          <p className="page-kicker">Candidate Data Error</p>
          <h2 className="mt-2 text-2xl font-black">Unable to load candidate setup</h2>
          <p className="mt-2 text-sm font-semibold text-[#667085]">{landingError}</p>
          <button type="button" onClick={loadLandingData} className="primary-btn mt-5">
            Retry
          </button>
        </div>
      ) : landingLoading ? (
        <div className={`soft-card ${boardScoped ? "board-candidates-state" : superAdminEditorial ? "sa-candidates-state" : "mt-8"}`}>
          <p className="page-kicker">Candidate Setup</p>
          <h2 className="mt-2 text-2xl font-black">Loading elections...</h2>
          <p className="mt-2 text-sm font-semibold text-[#667085]">
            Preparing election cards without loading candidate details yet.
          </p>
        </div>
      ) : !selectedElectionId ? (
        <section className={boardScoped ? "board-candidates-election-picker" : superAdminEditorial ? "sa-candidates-election-picker" : "election-management-grid mt-8"}>
          {candidateElectionOptions().length === 0 ? (
            <div className={`empty-state ${boardScoped ? "board-candidates-state" : superAdminEditorial ? "sa-candidates-state" : ""}`}>
              No elections are available for candidate setup.
            </div>
          ) : (
            <>
              {boardScoped || superAdminEditorial ? (
                <div className={boardScoped ? "board-candidates-section-head" : "sa-candidates-section-head"}>
                  <div>
                    <p className={boardScoped ? "board-candidates-section-kicker" : "sa-candidates-eyebrow"}>Election context</p>
                    <h2>Select the field to manage.</h2>
                  </div>
                  <span>{candidateElectionOptions().length} election{candidateElectionOptions().length === 1 ? "" : "s"}</span>
                </div>
              ) : null}
              {superAdminEditorial ? (
                <div className="sa-candidates-election-register">
                  <div className="sa-candidates-election-columns" aria-hidden="true">
                    <span>No.</span>
                    <span>Election</span>
                    <span>Organization</span>
                    <span>Phase</span>
                    <span>Positions</span>
                    <span>Candidates</span>
                    <span>Action</span>
                  </div>
                  <div className="sa-candidates-election-list">
                    {candidateElectionOptions().map((election, index) => {
                      const electionPositions = positions.filter(
                        (position) => Number(position.election_id) === Number(election.id),
                      );
                      const electionCandidateCount = candidateCounts[election.id] || 0;

                      return (
                        <button
                          key={election.id}
                          type="button"
                          className="sa-candidates-election-record"
                          onClick={() => openElectionPanel(election.id)}
                        >
                          <span className="sa-candidates-election-index">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="sa-candidates-election-identity">
                            <small>Candidate field</small>
                            <strong>{election.title || "Untitled Election"}</strong>
                          </span>
                          <span className="sa-candidates-election-organization">
                            <OrganizationLogo
                              organization={election.organizations}
                              className="sa-candidates-election-logo"
                            />
                            <span>{election.organizations?.name || "Organization not assigned"}</span>
                          </span>
                          <span className="sa-candidates-election-phase">
                            {electionPhaseLabel(election)}
                          </span>
                          <span className="sa-candidates-election-count">
                            <strong>{electionPositions.length}</strong>
                            <small>Position{electionPositions.length === 1 ? "" : "s"}</small>
                          </span>
                          <span className="sa-candidates-election-count">
                            <strong>{electionCandidateCount}</strong>
                            <small>Candidate{electionCandidateCount === 1 ? "" : "s"}</small>
                          </span>
                          <span className="sa-candidates-election-command">Manage Candidates</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className={boardScoped ? "election-management-grid board-candidates-election-grid" : "election-management-grid"}>
                  {candidateElectionOptions().map((election) => {
                    const electionPositions = positions.filter(
                      (position) => Number(position.election_id) === Number(election.id),
                    );
                    const electionCandidateCount = candidateCounts[election.id] || 0;

                    return (
                      <ElectionManagementCard
                        key={election.id}
                        election={election}
                        organization={boardScoped ? user?.organizations : undefined}
                        eyebrow="Candidate Setup"
                        counts={[
                          {
                            label: `position${electionPositions.length === 1 ? "" : "s"}`,
                            value: electionPositions.length,
                          },
                          {
                            label: `candidate${electionCandidateCount === 1 ? "" : "s"}`,
                            value: electionCandidateCount,
                          },
                        ]}
                        onClick={() => openElectionPanel(election.id)}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      ) : (
        <div className={boardScoped ? "board-candidates-workspace" : superAdminEditorial ? "sa-candidates-workspace" : "mt-8"}>
          <button
            type="button"
            onClick={() => {
              candidateRequestRef.current += 1;
              setSelectedElectionId("");
              setCandidates([]);
              setStudents([]);
              setCandidateError("");
            }}
            className={boardScoped ? "board-candidates-back" : superAdminEditorial ? "sa-candidates-back" : "mb-4 text-sm font-black uppercase tracking-[0.12em] text-[#ef4e23]"}
          >
            Back to elections
          </button>

          <div className={`entity-card ${boardScoped ? "board-candidates-context" : superAdminEditorial ? "sa-candidates-context" : "mb-4 grid gap-4 lg:grid-cols-[minmax(0,17rem)_1fr_auto] lg:items-center"}`}>
            <ElectionManagementCard
              election={selectedElection}
              organization={boardScoped ? user?.organizations : undefined}
              eyebrow="Selected Election"
              counts={[
                {
                  label: `candidate${selectedElectionCandidates.length === 1 ? "" : "s"}`,
                  value: selectedElectionCandidates.length,
                },
              ]}
            />
            <div className={boardScoped ? "board-candidates-context-copy" : superAdminEditorial ? "sa-candidates-context-copy" : undefined}>
              <p className={boardScoped ? "board-candidates-section-kicker" : superAdminEditorial ? "sa-candidates-eyebrow" : "page-kicker"}>Selected Election</p>
              <h2 className={boardScoped || superAdminEditorial ? "" : "entity-card-title mt-2"}>{selectedElection?.title || "Election"}</h2>
              {boardScoped ? (
                <>
                  <p>
                    Candidate records are organized by the ballot office they are running for.
                  </p>
                  <div className="board-candidates-context-ledger">
                    <span>{selectedElectionPositionCount} position{selectedElectionPositionCount === 1 ? "" : "s"}</span>
                    <span>{selectedElectionCandidates.length} candidate{selectedElectionCandidates.length === 1 ? "" : "s"}</span>
                    <span>{partylistsForSelectedElection().length} partylist{partylistsForSelectedElection().length === 1 ? "" : "s"}</span>
                  </div>
                </>
              ) : null}
              {superAdminEditorial ? (
                <>
                  <p>{selectedElection?.organizations?.name || "Organization not assigned"}</p>
                  <div className="sa-candidates-context-ledger">
                    <span>{selectedElectionPositionCount} position{selectedElectionPositionCount === 1 ? "" : "s"}</span>
                    <span>{selectedElectionCandidates.length} candidate{selectedElectionCandidates.length === 1 ? "" : "s"}</span>
                    <span>{partylistsForSelectedElection().length} partylist{partylistsForSelectedElection().length === 1 ? "" : "s"}</span>
                  </div>
                </>
              ) : null}
            </div>
            {!isElectionDone(selectedElection) ? (
              <button
                type="button"
                onClick={() => openCreateForm("", selectedElectionId)}
                className={`primary-btn self-start sm:self-auto ${boardScoped ? "board-candidates-context-action" : superAdminEditorial ? "sa-candidates-add" : ""}`}
              >
                <Plus size={18} />
                Add Candidate
              </button>
            ) : (
              <span className="status-pill">Closed</span>
            )}
          </div>

          {candidateError ? (
            <div className={`soft-card ${boardScoped ? "board-candidates-state" : superAdminEditorial ? "sa-candidates-state" : ""}`}>
              <p className="page-kicker">Candidate Data Error</p>
              <h2 className="mt-2 text-2xl font-black">Unable to load candidates</h2>
              <p className="mt-2 text-sm font-semibold text-[#667085]">{candidateError}</p>
              <button
                type="button"
                onClick={() => refreshCandidates(selectedElectionId)}
                className="primary-btn mt-5"
              >
                Retry
              </button>
            </div>
          ) : candidateLoading ? (
            <div className={`soft-card ${boardScoped ? "board-candidates-state" : superAdminEditorial ? "sa-candidates-state" : ""}`}>
              <p className="page-kicker">Candidate Records</p>
              <h2 className="mt-2 text-2xl font-black">Loading candidates...</h2>
            </div>
            ) : (
              <div className={boardScoped ? "board-candidates-field" : superAdminEditorial ? "sa-candidates-field" : "space-y-4"}>
              {superAdminEditorial && selectedElectionPositionGroups.length === 0 ? (
                <div className="sa-candidates-no-positions">
                  <span>00</span>
                  <div>
                    <h3>No ballot positions</h3>
                    <p>Add positions to this election before assigning candidates.</p>
                  </div>
                </div>
              ) : null}
              {selectedElectionPositionGroups.map(({ position, candidates: positionCandidates }, positionIndex) => (
                <section key={position.id} className={`entity-card ${boardScoped ? "board-candidate-position-group" : superAdminEditorial ? "sa-candidate-position-group" : ""}`}>
                  <div className={boardScoped ? "board-candidate-position-head" : superAdminEditorial ? "sa-candidate-position-head" : "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"}>
                    {superAdminEditorial ? <span className="sa-candidate-position-index">{String(position.display_order || positionIndex + 1).padStart(2, "0")}</span> : null}
                    <div>
                      <p className={boardScoped ? "board-candidates-section-kicker" : superAdminEditorial ? "sa-candidates-eyebrow" : "page-kicker"}>Ballot Position</p>
                      <h3 className={boardScoped || superAdminEditorial ? "" : "entity-card-title mt-2"}>{position.name}</h3>
                    </div>
                    <span className={superAdminEditorial ? "sa-candidate-position-count" : "status-pill"}>
                      {positionCandidates.length} candidate{positionCandidates.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className={boardScoped ? "board-candidate-list" : superAdminEditorial ? "sa-candidate-list" : "mt-4 grid gap-3"}>
                    {positionCandidates.length === 0 ? (
                      <div className={boardScoped ? "board-candidate-empty-position" : superAdminEditorial ? "sa-candidate-empty-position" : "empty-copy rounded-[18px] border border-dashed border-[rgba(24,54,49,0.12)] bg-white/60 p-4"}>
                        No candidates configured for this position.
                      </div>
                    ) : (
                      positionCandidates.map((candidate, candidateIndex) => (
                        <div key={candidate.id} className={boardScoped ? "board-candidate-record" : superAdminEditorial ? "sa-candidate-record" : "flex flex-col gap-3 rounded-[18px] border border-[rgba(24,54,49,0.08)] bg-white/80 p-4 sm:flex-row sm:items-center sm:justify-between"}>
                          {superAdminEditorial ? <span className="sa-candidate-index">{String(candidateIndex + 1).padStart(2, "0")}</span> : null}
                          <div className={boardScoped ? "board-candidate-identity" : superAdminEditorial ? "sa-candidate-identity" : undefined}>
                            {boardScoped || superAdminEditorial ? (
                              <div className={boardScoped ? "board-candidate-avatar" : "sa-candidate-avatar"}>
                                {candidate.photo ? (
                                  <img src={candidate.photo} alt="" />
                                ) : (
                                  <span>{candidateInitials(candidate)}</span>
                                )}
                              </div>
                            ) : null}
                            <div>
                              <p className={boardScoped ? "board-candidate-name" : superAdminEditorial ? "sa-candidate-name" : "font-black text-[#111827]"}>
                                {candidateName(candidate)}
                              </p>
                              <p className={boardScoped ? "board-candidate-meta" : superAdminEditorial ? "sa-candidate-meta" : "text-sm font-bold text-[#6b7280]"}>
                                <span>{candidate.students?.student_number || "-"}</span>
                                <span>{candidate.partylists?.name || "Independent"}</span>
                                <span>{parseCampaignMaterials(candidate.campaign_materials, candidate.campaign_media_urls).length} media</span>
                              </p>
                            </div>
                          </div>
                          <div className={boardScoped ? "board-candidate-actions" : superAdminEditorial ? "sa-candidate-actions" : "flex gap-2"}>
                            <button
                              type="button"
                              onClick={() => openEditForm(candidate)}
                              className="icon-action"
                              aria-label={`Edit ${candidateName(candidate) || "candidate"}`}
                            >
                              <Pencil size={16} />
                              {superAdminEditorial ? <span>Edit</span> : null}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(candidate)}
                              className="icon-action icon-action-danger"
                              aria-label={`Delete ${candidateName(candidate) || "candidate"}`}
                            >
                              <Trash2 size={16} />
                              {superAdminEditorial ? <span>Delete</span> : null}
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {formOpen && (
        <PopupOverlay>
          <div className={superAdminEditorial ? "modal-card candidate-form-dialog" : "modal-card max-w-3xl"}>
            <div className={superAdminEditorial ? "candidate-form-header" : "mb-6 flex items-center justify-between"}>
              {superAdminEditorial ? (
              <div>
                {superAdminEditorial ? <p>Candidate Field</p> : null}
                <h2 className={superAdminEditorial ? "" : "text-2xl font-black"}>
                  {editingCandidate ? "Edit Candidate" : "Add Candidate"}
                </h2>
                {superAdminEditorial ? (
                  <span>
                    {editingCandidate
                      ? "Update this candidate's ballot identity and campaign record."
                      : "Assign an eligible student to one ballot position."}
                  </span>
                ) : null}
              </div>
              ) : (
                <h2 className="text-2xl font-black">
                  {editingCandidate ? "Edit Candidate" : "Add Candidate"}
                </h2>
              )}

              <button type="button" onClick={() => setFormOpen(false)} className={superAdminEditorial ? "candidate-form-close" : "icon-action"} aria-label="Close candidate form">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className={superAdminEditorial ? "candidate-form-workspace" : "modal-form-stack"}>
              {superAdminEditorial ? (
                <div className="candidate-form-section-head">
                  <span>01</span><div><h3>Ballot assignment</h3><p>Choose the election and office this candidate will appear under.</p></div>
                </div>
              ) : null}
              <div className={superAdminEditorial ? "candidate-form-field" : undefined}>
                <label className="field-label">Election</label>
                <select
                  required
                  value={form.election_id}
                  onChange={(event) => {
                    setForm({
                      ...form,
                      election_id: event.target.value,
                      position_id: "",
                      student_id: "",
                      partylist_id: "",
                    });
                    setSelectedElectionId(event.target.value);
                    setStudents([]);
                    setStudentQuery("");
                    refreshCandidates(event.target.value);
                  }}
                  className="field-shell w-full"
                >
                  <option value="">Select Election</option>
                  {candidateElectionOptions().map((election) => (
                    <option key={election.id} value={election.id}>
                      {election.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className={superAdminEditorial ? "candidate-form-field" : undefined}>
                <label className="field-label">Position</label>
                <select
                  required
                  value={form.position_id}
                  disabled={!form.election_id}
                  onChange={(event) => {
                    const selectedPositionId = event.target.value;
                    setForm({
                      ...form,
                      position_id: selectedPositionId,
                      student_id: "",
                    });
                    setStudentQuery("");
                    fetchStudentsByPosition(selectedPositionId);
                  }}
                  className="field-shell w-full"
                >
                  <option value="">Select Position</option>
                  {positionsForSelectedElection().map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.name} - {position.elections?.title}
                    </option>
                  ))}
                </select>
              </div>

              {superAdminEditorial ? (
                <div className="candidate-form-section-head">
                  <span>02</span><div><h3>Candidate identity</h3><p>Select the eligible student and record their ballot affiliation.</p></div>
                </div>
              ) : null}
              <div className={superAdminEditorial ? "candidate-form-field candidate-form-student" : undefined}>
                <StudentSearchPicker
                  label="Eligible Student"
                  students={studentsAvailableForCandidate()}
                  value={form.student_id}
                  onChange={(studentId) => setForm({ ...form, student_id: studentId })}
                  query={studentQuery}
                  onQueryChange={setStudentQuery}
                  disabled={!form.position_id}
                  emptyText="No remaining eligible students for this election."
                />
              </div>

              <div className={superAdminEditorial ? "candidate-form-field" : undefined}>
                <label className="field-label">Partylist</label>
                <select
                  value={form.partylist_id}
                  onChange={(event) =>
                    setForm({ ...form, partylist_id: event.target.value })
                  }
                  className="field-shell w-full"
                >
                  <option value="">Independent / No Partylist</option>
                  {partylistsForSelectedElection().map((partylist) => (
                    <option key={partylist.id} value={partylist.id}>
                      {partylist.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={superAdminEditorial ? "candidate-form-field" : undefined}>
                <label className="field-label">Photo URL</label>
                <input
                  value={form.photo}
                  onChange={(event) => setForm({ ...form, photo: event.target.value })}
                  placeholder="Photo URL optional"
                  className="field-shell w-full"
                />
              </div>

              {superAdminEditorial ? (
                <div className="candidate-form-section-head">
                  <span>03</span><div><h3>Campaign profile</h3><p>Prepare the student-facing information for this candidate.</p></div>
                </div>
              ) : null}
              <div className={superAdminEditorial ? "candidate-form-field candidate-form-copy" : undefined}>
                <label className="field-label">Platform</label>
                <textarea
                  value={form.platform}
                  onChange={(event) => setForm({ ...form, platform: event.target.value })}
                  placeholder="Candidate platform"
                  className="field-shell min-h-[120px] w-full"
                  rows="3"
                />
              </div>

              <div className={superAdminEditorial ? "candidate-form-field candidate-form-copy" : undefined}>
                <label className="field-label">Credentials</label>
                <textarea
                  value={form.credentials}
                  onChange={(event) =>
                    setForm({ ...form, credentials: event.target.value })
                  }
                  placeholder="Credentials and achievements"
                  className="field-shell min-h-[120px] w-full"
                  rows="3"
                />
              </div>

              <div className={superAdminEditorial ? "candidate-form-field candidate-form-copy" : undefined}>
                <label className="field-label">Bio</label>
                <textarea
                  value={form.bio}
                  onChange={(event) => setForm({ ...form, bio: event.target.value })}
                  placeholder="Candidate bio"
                  className="field-shell min-h-[120px] w-full"
                  rows="3"
                />
              </div>

              <div className={superAdminEditorial ? "upload-shell candidate-form-materials" : "upload-shell"}>
                <p className="text-sm font-bold text-[#1d262f]">Campaign Materials</p>
                <p className="mt-1 text-xs text-[#5a5548]">
                  Add up to 3 downloadable or viewable materials per candidate.
                </p>

                <div className="mt-3 space-y-3">
                  {form.campaign_materials.map((material, index) => (
                    <div key={index} className={superAdminEditorial ? "modal-form-grid candidate-material-record" : "modal-form-grid rounded-xl border border-[rgba(255,115,22,0.12)] bg-white/45 p-4"}>
                      <input
                        value={material.label}
                        onChange={(event) =>
                          updateMaterial(index, "label", event.target.value)
                        }
                        placeholder={`Material title ${index + 1}`}
                        className="field-shell"
                      />
                      <select
                        value={material.type}
                        onChange={(event) =>
                          updateMaterial(index, "type", event.target.value)
                        }
                        className="field-shell"
                      >
                        <option value="link">Link</option>
                        <option value="document">Document</option>
                        <option value="media">Media</option>
                      </select>
                      <input
                        value={material.url}
                        onChange={(event) =>
                          updateMaterial(index, "url", event.target.value)
                        }
                        placeholder="https://..."
                        className="field-shell md:col-span-2"
                      />
                      <label className={superAdminEditorial ? "candidate-material-download md:col-span-2 flex items-center gap-3 px-4 py-3 text-sm font-semibold text-[#1d262f]" : "md:col-span-2 flex items-center gap-3 rounded-xl bg-white/60 px-4 py-3 text-sm font-semibold text-[#1d262f]"}>
                        <input
                          type="checkbox"
                          checked={material.downloadable}
                          onChange={(event) =>
                            updateMaterial(index, "downloadable", event.target.checked)
                          }
                        />
                        Allow student download
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {superAdminEditorial ? (
                <footer className="candidate-form-actions">
                  <button type="button" className="secondary-btn" onClick={() => setFormOpen(false)}>Cancel</button>
                  <button type="submit" className="primary-btn">
                    {editingCandidate ? "Save Changes" : "Add Candidate"}
                  </button>
                </footer>
              ) : (
                <button type="submit" className="primary-btn w-full">
                  {editingCandidate ? "Save Changes" : "Add Candidate"}
                </button>
              )}
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default CandidateManagement;
