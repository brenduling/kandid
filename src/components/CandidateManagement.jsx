import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import PopupOverlay from "./PopupOverlay";
import StudentSearchPicker from "./StudentSearchPicker";
import ElectionManagementCard from "./ElectionManagementCard";
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
      const [positionResult, partyResult] = await Promise.all([
        supabase
          .from("positions")
          .select("id, name, election_id, max_votes")
          .in("election_id", electionIds)
          .order("id", { ascending: true }),
        supabase
          .from("partylists")
          .select("id, name, election_id")
          .in("election_id", electionIds)
          .order("name", { ascending: true }),
      ]);

      if (positionResult.error) {
        setLandingError(positionResult.error.message || "Unable to load election positions.");
        setLandingLoading(false);
        return;
      }

      positionRows = (positionResult.data || []).map((position, index) => ({
        ...position,
        display_order: index + 1,
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
  }, [boardScoped, fetchCandidateCounts, orgId]);

  useEffect(() => {
    let active = true;
    loadLandingData().finally(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
  }, [loadLandingData]);

  useEffect(() => {
    if (!preselectedPositionId) return;
    if (handledPreselectRef.current === preselectedPositionId) return;
    const selectedPosition = positions.find(
      (position) => String(position.id) === preselectedPositionId,
    );
    if (!selectedPosition) return;

    handledPreselectRef.current = preselectedPositionId;
    openCreateForm(preselectedPositionId, selectedPosition.election_id);
    setSearchParams({}, { replace: true });
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

    const { data, error } = await supabase
      .from("student_organizations")
      .select(`
        students (
          id,
          student_number,
          first_name,
          last_name,
          program,
          year_level,
          photo_url
        )
      `)
      .eq("organization_id", organizationId);

    if (error) {
      setStudents([]);
      prompt.error(error.message || "Unable to load eligible students.");
      return;
    }

    setStudents((data || []).map((item) => item.students).filter(Boolean));
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

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Candidate Lineup</div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>

        <button
          type="button"
          onClick={() => openCreateForm()}
          className="primary-btn self-start lg:self-auto"
          disabled={landingLoading || Boolean(landingError)}
        >
          <Plus size={18} />
          Add Candidate
        </button>
      </div>

      {landingError ? (
        <div className="soft-card mt-8">
          <p className="page-kicker">Candidate Data Error</p>
          <h2 className="mt-2 text-2xl font-black">Unable to load candidate setup</h2>
          <p className="mt-2 text-sm font-semibold text-[#667085]">{landingError}</p>
          <button type="button" onClick={loadLandingData} className="primary-btn mt-5">
            Retry
          </button>
        </div>
      ) : landingLoading ? (
        <div className="soft-card mt-8">
          <p className="page-kicker">Candidate Setup</p>
          <h2 className="mt-2 text-2xl font-black">Loading elections...</h2>
          <p className="mt-2 text-sm font-semibold text-[#667085]">
            Preparing election cards without loading candidate details yet.
          </p>
        </div>
      ) : !selectedElectionId ? (
        <div className="election-management-grid mt-8">
          {candidateElectionOptions().length === 0 ? (
            <div className="empty-state">No elections are available for candidate setup.</div>
          ) : (
            candidateElectionOptions().map((election) => {
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
            })
          )}
        </div>
      ) : (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => {
              candidateRequestRef.current += 1;
              setSelectedElectionId("");
              setCandidates([]);
              setStudents([]);
              setCandidateError("");
            }}
            className="mb-4 text-sm font-black uppercase tracking-[0.12em] text-[#ef4e23]"
          >
            Back to elections
          </button>

          <div className="entity-card mb-4 grid gap-4 lg:grid-cols-[minmax(0,17rem)_1fr_auto] lg:items-center">
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
            <div>
              <p className="page-kicker">Selected Election</p>
              <h2 className="entity-card-title mt-2">{selectedElection?.title || "Election"}</h2>
            </div>
            {!isElectionDone(selectedElection) ? (
              <button
                type="button"
                onClick={() => openCreateForm("", selectedElectionId)}
                className="primary-btn self-start sm:self-auto"
              >
                <Plus size={18} />
                Add Candidate
              </button>
            ) : (
              <span className="status-pill">Closed</span>
            )}
          </div>

          {candidateError ? (
            <div className="soft-card">
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
            <div className="soft-card">
              <p className="page-kicker">Candidate Records</p>
              <h2 className="mt-2 text-2xl font-black">Loading candidates...</h2>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedCandidatesForSelectedElection().map(({ position, candidates: positionCandidates }) => (
                <section key={position.id} className="entity-card">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="page-kicker">Position</p>
                      <h3 className="entity-card-title mt-2">{position.name}</h3>
                    </div>
                    <span className="status-pill">
                      {positionCandidates.length} candidate{positionCandidates.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3">
                    {positionCandidates.length === 0 ? (
                      <div className="empty-copy rounded-[18px] border border-dashed border-[rgba(24,54,49,0.12)] bg-white/60 p-4">
                        No candidates configured for this position.
                      </div>
                    ) : (
                      positionCandidates.map((candidate) => (
                        <div key={candidate.id} className="flex flex-col gap-3 rounded-[18px] border border-[rgba(24,54,49,0.08)] bg-white/80 p-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-black text-[#111827]">{candidateName(candidate)}</p>
                            <p className="text-sm font-bold text-[#6b7280]">
                              {candidate.students?.student_number || "-"} {"-"} {candidate.partylists?.name || "Independent"} {"-"} {parseCampaignMaterials(candidate.campaign_materials, candidate.campaign_media_urls).length} media
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => openEditForm(candidate)} className="icon-action">
                              <Pencil size={16} />
                            </button>
                            <button type="button" onClick={() => handleDelete(candidate)} className="icon-action icon-action-danger">
                              <Trash2 size={16} />
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
          <div className="modal-card max-w-3xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-black">
                {editingCandidate ? "Edit Candidate" : "Add Candidate"}
              </h2>

              <button type="button" onClick={() => setFormOpen(false)} className="icon-action">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="modal-form-stack">
              <div>
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

              <div>
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

              <div>
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

              <div>
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

              <div>
                <label className="field-label">Photo URL</label>
                <input
                  value={form.photo}
                  onChange={(event) => setForm({ ...form, photo: event.target.value })}
                  placeholder="Photo URL optional"
                  className="field-shell w-full"
                />
              </div>

              <div>
                <label className="field-label">Platform</label>
                <textarea
                  value={form.platform}
                  onChange={(event) => setForm({ ...form, platform: event.target.value })}
                  placeholder="Candidate platform"
                  className="field-shell min-h-[120px] w-full"
                  rows="3"
                />
              </div>

              <div>
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

              <div>
                <label className="field-label">Bio</label>
                <textarea
                  value={form.bio}
                  onChange={(event) => setForm({ ...form, bio: event.target.value })}
                  placeholder="Candidate bio"
                  className="field-shell min-h-[120px] w-full"
                  rows="3"
                />
              </div>

              <div className="upload-shell">
                <p className="text-sm font-bold text-[#1d262f]">Campaign Materials</p>
                <p className="mt-1 text-xs text-[#5a5548]">
                  Add up to 3 downloadable or viewable materials per candidate.
                </p>

                <div className="mt-3 space-y-3">
                  {form.campaign_materials.map((material, index) => (
                    <div key={index} className="modal-form-grid rounded-xl border border-[rgba(255,115,22,0.12)] bg-white/45 p-4">
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
                      <label className="md:col-span-2 flex items-center gap-3 rounded-xl bg-white/60 px-4 py-3 text-sm font-semibold text-[#1d262f]">
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

              <button type="submit" className="primary-btn w-full">
                {editingCandidate ? "Save Changes" : "Add Candidate"}
              </button>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default CandidateManagement;
