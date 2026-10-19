import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import PopupOverlay from "./PopupOverlay";
import SuperAdminPageHeader from "./SuperAdminPageHeader";
import StudentSearchPicker from "./StudentSearchPicker";
import ElectionCampaignPublication from "./ElectionCampaignPublication";
import ElectionManagementCard from "./ElectionManagementCard";
import ElectionCover from "./ElectionCover";
import { OrganizationLogo } from "./KandidImage";
import { supabase } from "../lib/supabaseClient";
import {
  createCampaignMaterialsDraft,
  parseCampaignMaterials,
} from "../utils/candidates";
import { usePrompt } from "../context/PromptContext";
import { toBoardFacingError } from "../utils/boardFeedback";
import { logAuditEvent } from "../utils/auditLog";
import { getElectionPhase, isMissingElectionCoverColumn } from "../utils/elections";
import { useElectionClock } from "../utils/useElectionClock";
import { createCandidateSubmission, saveCandidateEdit, deleteCandidateSafely, loadCandidateManagementContext, mergeCandidatePartylists, candidateSaveError } from "../utils/candidateManagementContract";
import { isMissingPositionOrderError } from "../utils/positionOrder";
import { loadAdminCandidates } from "../utils/adminCandidates";
import { inferCampaignMaterialInputType, uploadCampaignMaterial, removeUnreferencedCampaignMaterial } from "../utils/campaignMaterials";

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

const electionPhaseLabel = (election, now) => {
  const phase = getElectionPhase(election, now);
  return ELECTION_PHASE_LABELS[phase] || String(phase || "Status unavailable").replaceAll("_", " ");
};

/* The election year, taken from the election's own start_date. Present only when
 * the stored date yields a real year; no date is invented and no election field
 * is derived beyond this. */
const electionYearLabel = (startDate) => {
  if (!startDate) return "";
  const parsed = new Date(startDate);
  if (Number.isNaN(parsed.getTime())) return "";
  return String(parsed.getFullYear());
};

const campaignStatusLabel = (status) => ({
  draft: "Draft",
  published: "Published",
  hidden: "Hidden",
})[status] || "Status unavailable";

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
  const readonlyBoardInspection = boardScoped && import.meta.env.MODE === "localhost-production-readonly";
  const prompt = usePrompt();
  const now = useElectionClock();
  const [searchParams, setSearchParams] = useSearchParams();
  const handledPreselectRef = useRef("");
  const candidateRequestRef = useRef(0);
  const eligibilityRequestRef = useRef(0);
  const saveInFlight = useRef(false);
  const pendingCampaignUploads = useRef([]);
  const createSubmission = useRef(null);
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
  const [savingCandidate, setSavingCandidate] = useState(false);
  const [uploadingMaterialIndex, setUploadingMaterialIndex] = useState(null);
  const [materialUploadErrors, setMaterialUploadErrors] = useState({});

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
        academic_term_id,
        removed_at,
        electorate_frozen_at,
        results_released_at,
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
        .is("removed_at", null)
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
      setLandingError(boardScoped
        ? toBoardFacingError(electionError.message, "Unable to load candidate elections.")
        : electionError.message || "Unable to load candidate elections.");
      setLandingLoading(false);
      return;
    }

    const electionIds = (electionRows || []).map((election) => election.id).filter(Boolean);
    let positionRows = [];
    let partyRows = [];

    if (electionIds.length > 0) {
      let positionResult = await supabase
        .from("positions")
        .select("id, name, election_id, max_votes, display_order, status")
        .in("election_id", electionIds)
        .order("display_order", { ascending: true })
        .order("id", { ascending: true });

      if (isMissingPositionOrderError(positionResult.error)) {
        positionResult = await supabase
          .from("positions")
          .select("id, name, election_id, max_votes")
          .in("election_id", electionIds)
          .order("id", { ascending: true });
      }

      if (positionResult.error) {
        setLandingError(boardScoped
          ? toBoardFacingError(positionResult.error.message, "Unable to load election positions.")
          : positionResult.error.message || "Unable to load election positions.");
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
    }

    /* Partylists are organization-level, so they are fetched independently of
       the election list: an organization with no elections still has partylists,
       and a partylist created for the organization must be attachable to any of
       its elections' candidates.

       A board member's list is scoped server-side to its own organization. The
       Super Admin editorial view spans organizations by design, so it receives
       organization_id on each row and narrows the list to the organization of
       the election currently being managed. */
    if (!readonlyBoardInspection) {
      let partyRequest = supabase
        .from("partylists")
        .select("id, name, organization_id, election_id")
        .order("name", { ascending: true });

      if (boardScoped && orgId) partyRequest = partyRequest.eq("organization_id", orgId);

      const { data: partyData, error: partyError } = await partyRequest;

      if (partyError) {
        console.error("Failed to load partylists:", partyError);
      } else {
        partyRows = partyData || [];
      }
    }

    setElections(electionRows || []);
    setPositions(positionRows);
    setPartylists(partyRows);
    setLandingLoading(false);
    fetchCandidateCounts(positionRows);
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  }, [boardScoped, fetchCandidateCounts, orgId, readonlyBoardInspection]);

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

    if (!positions.some((position) => Number(position.election_id) === Number(normalizedElectionId))) {
      setCandidates([]);
      setCandidateCounts((current) => ({ ...current, [normalizedElectionId]: 0 }));
      return [];
    }

    const requestId = candidateRequestRef.current + 1;
    candidateRequestRef.current = requestId;
    setCandidateLoading(true);
    setCandidateError("");

    const { data, error } = await loadAdminCandidates({ electionIds: [normalizedElectionId] });

    if (candidateRequestRef.current !== requestId) return [];

    if (error) {
      setCandidateError(boardScoped
        ? toBoardFacingError(error.message, "Unable to load candidates.")
        : error.message || "Unable to load candidates.");
      setCandidateLoading(false);
      return [];
    }

    const scopedCandidates = (data || [])
      .filter((candidate) => positionsById.has(Number(candidate.position_id)))
      .sort((left, right) => Number(left.id) - Number(right.id))
      .map((candidate) =>
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
    const requestId = ++eligibilityRequestRef.current;
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
      const context = await loadCandidateManagementContext(supabase, selectedPosition.election_id);
      if (requestId !== eligibilityRequestRef.current) return;
      setStudents(context.eligible_students);
      setPartylists((current) => mergeCandidatePartylists(current, context));
    } catch (error) {
      if (requestId !== eligibilityRequestRef.current) return;
      setStudents([]);
      prompt.error(candidateSaveError(error));
    }
  }

  async function openCreateForm(positionId = "", electionId = "") {
    if (readonlyBoardInspection) return;
    createSubmission.current = createCandidateSubmission(supabase);
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
    if (readonlyBoardInspection) return;
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
      (position) => Number(position.election_id) === Number(form.election_id) && (position.status !== "retired" || position.id === editingCandidate?.position_id),
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
    if (election.removed_at || election.electorate_frozen_at || election.results_released_at) return true;
    const phase = getElectionPhase(election, now);
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

  // Reusable organization-level partylists remain supported. Election-bound
  // rows must also match the selected election, as the server rechecks.
  function partylistsForSelectedElection() {
    const electionId = formOpen ? form.election_id : selectedElectionId;
    const selectedElection = elections.find(
      (election) => Number(election.id) === Number(electionId),
    );
    const scopedOrganizationId = boardScoped
      ? orgId
      : selectedElection?.organization_id;

    if (!scopedOrganizationId) return [];

    return partylists.filter(
      (partylist) => Number(partylist.organization_id) === Number(scopedOrganizationId) && (partylist.election_id == null || Number(partylist.election_id) === Number(electionId)),
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

  function changeMaterialInputType(index, inputType) {
    const current = form.campaign_materials[index];
    const currentKind = inferCampaignMaterialInputType(current);
    const next = [...form.campaign_materials];
    next[index] = {
      ...current,
      inputType,
      type: inputType === "image" || inputType === "video" ? "media" : inputType,
      url: inputType === currentKind ? current.url : "",
    };
    setForm({ ...form, campaign_materials: next });
    setMaterialUploadErrors((errors) => ({ ...errors, [index]: "" }));
  }

  async function handleCampaignMaterialFile(index, file) {
    if (!file || uploadingMaterialIndex !== null) return;
    const material = form.campaign_materials[index];
    const kind = inferCampaignMaterialInputType(material);
    const electionId = Number(form.election_id || selectedElectionId);
    if (!["image", "video", "document"].includes(kind) || !electionId) return;
    setUploadingMaterialIndex(index);
    setMaterialUploadErrors((errors) => ({ ...errors, [index]: "" }));
    try {
      const uploaded = await uploadCampaignMaterial(supabase, file, kind, electionId);
      pendingCampaignUploads.current.push(uploaded.path);
      setForm((current) => {
        const next = [...current.campaign_materials];
        next[index] = { ...next[index], type: uploaded.type, inputType: uploaded.inputType, url: uploaded.reference };
        return { ...current, campaign_materials: next };
      });
    } catch (error) {
      setMaterialUploadErrors((errors) => ({ ...errors, [index]: error.message || "Campaign file upload failed. Retry the upload." }));
    } finally {
      setUploadingMaterialIndex(null);
    }
  }

  async function cleanupPendingCampaignUploads(keepReferences = []) {
    const keep = new Set(keepReferences);
    const pending = pendingCampaignUploads.current.splice(0);
    const unused = pending.filter((path) => !keep.has(path));
    const outcomes = await Promise.allSettled(unused.map((path) => removeUnreferencedCampaignMaterial(supabase, path)));
    if (outcomes.some((outcome) => outcome.status === "rejected")) {
      prompt.error("A temporary campaign upload could not be cleaned up. Retry after Storage is available.");
    }
  }

  function closeCandidateForm() {
    if (saveInFlight.current || uploadingMaterialIndex !== null) return;
    void cleanupPendingCampaignUploads();
    setFormOpen(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (readonlyBoardInspection || saveInFlight.current) return;
    if (uploadingMaterialIndex !== null) {
      prompt.error("Wait for the campaign file upload to finish before saving.");
      return;
    }
    saveInFlight.current = true;
    setSavingCandidate(true);
    try {
      const position = positionsById.get(Number(form.position_id));
      if (!position || Number(position.election_id) !== Number(form.election_id)) {
        prompt.error("Select a valid position in this election."); return;
      }
      const result = editingCandidate
        ? await saveCandidateEdit(supabase, editingCandidate, form, position.election_id)
        : await (createSubmission.current ||= createCandidateSubmission(supabase))(form, position.election_id);
      if (result.error) { prompt.error(candidateSaveError(result.error)); return; }
      if (!Number.isInteger(result.data?.id) || result.data.id <= 0) { prompt.error("Candidate save was not confirmed. Refresh before retrying."); return; }
      if (result.unchanged) { prompt.info("No changes to save."); return; }
      const savedReferences = form.campaign_materials.map((material) => material.url || "");
      const uploadedPaths = pendingCampaignUploads.current;
      const keepReferences = uploadedPaths.filter((path) => savedReferences.includes(`storage://campaign-materials/${path}`));
      await cleanupPendingCampaignUploads(keepReferences);
      await refreshCandidates(position.election_id);
      if (editingCandidate) { prompt.success("Candidate updated."); setFormOpen(false); return; }
      const addAnother = await prompt.confirm({
        title: "Candidate Created",
        message: "Add another candidate to " + position.name + " for " + (electionsById.get(Number(position.election_id))?.title || "this election") + "?",
        type: "success", confirmText: "Add Another", cancelText: "Done",
      });
      if (addAnother) {
        createSubmission.current = createCandidateSubmission(supabase);
        setForm({ ...form, student_id: "", photo: "", bio: "", platform: "", credentials: "", campaign_materials: createCampaignMaterialsDraft() });
        setMaterialUploadErrors({});
        setStudentQuery(""); return;
      }
      setSelectedElectionId(String(position.election_id)); setFormOpen(false);
    } catch (error) { prompt.error(candidateSaveError(error)); }
    finally { saveInFlight.current = false; setSavingCandidate(false); }
  }

  async function handleDelete(candidate) {
    if (readonlyBoardInspection) return;
    const electionId = candidate.positions?.election_id || candidate.positions?.elections?.id;
    try { await loadCandidateManagementContext(supabase, electionId); }
    catch (error) { prompt.error(candidateSaveError(error)); return; }
    const ok = await prompt.confirm({
      title: boardScoped ? "Review candidate deletion" : "Delete Candidate?",
      message: "Remove this unprotected candidate record? The student identity remains. Frozen, voting, released and officer history cannot be deleted.",
      type: "danger",
      ...(boardScoped ? {variant:"editorial",eyebrow:"Danger Zone",confirmText:"Delete Candidate",cancelText:"Keep Candidate"} : {confirmText:"Delete"}),
    });
    if (!ok) return;
    const { error } = await deleteCandidateSafely(supabase, candidate, electionId);
    if (error) { prompt.error(candidateSaveError(error)); return; }
    prompt.success("Candidate deleted.");
    await logAuditEvent({action:"candidate_deleted",entityType:"candidate",entityId:candidate.id,entityLabel:candidateName(candidate),organizationId:candidate.positions?.elections?.organization_id || orgId,status:"completed"});
    await refreshCandidates(electionId);
  }

  const selectedElection = selectedElectionOption();
  const selectedElectionPositionGroups = groupedCandidatesForSelectedElection();
  const selectedElectionPositionCount = selectedElectionPositionGroups.length;

  /* Candidate mutation availability. This reads isElectionDone, the same
     lifecycle determination the openCreate and openEditForm guards below already
     use, and the one Positions.jsx calls isClosedPhase: a phase from
     getElectionPhase in closed / archived / done. getElectionPhase already
     returns "closed" once votingEnd has passed, so the end-date boundary is
     covered by the same call and is not re-implemented here.

     Nothing new is defined. The UI only stops advertising controls that the
     backend would refuse anyway, so the deployed candidate hardening remains the
     authoritative enforcement and is untouched. One flag drives the Add
     candidate control, the per-row Edit/Delete pair and the Actions column, so
     the workspace cannot end up offering some of them and withholding others. */
  const selectedElectionReadOnly = isElectionDone(selectedElection);

  /* Leaving the selected election is one state reset, shared by the Board's
     "Switch election" control and the non-Board "Back to elections" control. The
     body is the handler that was inline on the button before, unchanged. */
  function clearSelectedElection() {
    candidateRequestRef.current += 1;
    setSelectedElectionId("");
    setCandidates([]);
    setStudents([]);
    setCandidateError("");
  }

  return (
    <div
      className={
        boardScoped
          ? `board-candidates-page${selectedElectionId ? "" : " is-selecting"}`
          : superAdminEditorial
            ? "sa-candidates"
            : undefined
      }
    >
      {boardScoped ? (
        <header className="board-candidate-masthead">
          <p className="board-candidate-context-line">
            <span>Electoral Board</span>
            <span aria-hidden="true">/</span>
            <span>{user?.organizations?.name || "Organization"}</span>
          </p>
          <h1 className="page-title board-candidate-page-title">Candidates</h1>
          <p className="board-candidate-standfirst">
            Manage candidates and campaign information for {user?.organizations?.name || "your organization"}.
          </p>
          <div className="board-candidate-masthead-actions">
            <button
              type="button"
              className="board-candidate-add"
              disabled={landingLoading || Boolean(landingError) || readonlyBoardInspection || !candidateElectionOptions().some((election) => !isElectionDone(election)) || Boolean(selectedElectionId && selectedElectionReadOnly)}
              title={readonlyBoardInspection ? "Unavailable during read-only production inspection" : selectedElectionId && selectedElectionReadOnly ? "Candidate creation is unavailable for this election" : undefined}
              onClick={() => openCreateForm("", selectedElectionId)}
            >
              <Plus size={16} /> Add Candidate
            </button>
          </div>
          {readonlyBoardInspection && (
            <p className="mt-3 rounded-lg border border-amber-700/20 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950" role="note">
              Read-only production inspection. Candidate creation, editing, deletion, and campaign changes are disabled.
            </p>
          )}
        </header>
      ) : superAdminEditorial ? (
        <SuperAdminPageHeader
          section="Election operations"
          title="Candidates"
          description="Manage candidate rosters, ballot positions, and campaign records across elections."
          actions={(
            <>
              <span>Election field</span>
              <strong>{candidateElectionOptions().length} election{candidateElectionOptions().length === 1 ? "" : "s"}</strong>
              <button
                type="button"
                onClick={() => openCreateForm("", selectedElectionId)}
                className="primary-btn sa-candidates-add"
                disabled={landingLoading || Boolean(landingError) || !candidateElectionOptions().some((election) => !isElectionDone(election)) || Boolean(selectedElectionId && selectedElectionReadOnly)}
                title={selectedElectionId && selectedElectionReadOnly ? "Candidate creation is unavailable for this election" : undefined}
              >
                <Plus size={18} /> Add Candidate
              </button>
            </>
          )}
        />
      ) : (
        <div className="page-head">
          <div>
            <div className="page-kicker">Candidate Field</div>
            <h1 className="page-title">{title}</h1>
            <p className="page-subtitle">{subtitle}</p>
          </div>
        </div>
      )}

      {landingError ? (
        <div className={`soft-card ${boardScoped ? "board-candidate-page-state" : superAdminEditorial ? "sa-candidates-state" : "mt-8"}`}>
          <p className="page-kicker">Candidate Data Error</p>
          <h2 className="mt-2 text-2xl font-black">Unable to load candidate setup</h2>
          <p className="mt-2 text-sm font-semibold text-[#667085]">{landingError}</p>
          <button type="button" onClick={loadLandingData} className="primary-btn mt-5">
            Retry
          </button>
        </div>
      ) : landingLoading ? (
        boardScoped ? (
          <div className="board-candidate-context-skeleton" role="status" aria-label="Loading election context" aria-busy="true">
            {[0, 1, 2].map((row) => <div key={row}><span /><span /><span /></div>)}
          </div>
        ) : (
          <div className={`soft-card ${superAdminEditorial ? "sa-candidates-state" : "mt-8"}`}>
            <p className="page-kicker">Candidate Setup</p>
            <h2 className="mt-2 text-2xl font-black">Loading elections...</h2>
            <p className="mt-2 text-sm font-semibold text-[#667085]">
              Preparing the election register.
            </p>
          </div>
        )
      ) : !selectedElectionId ? (
        <section className={boardScoped ? "board-candidate-election-picker" : superAdminEditorial ? "sa-candidates-election-picker" : "election-management-grid mt-8"}>
          {candidateElectionOptions().length === 0 ? (
            <div className={`empty-state ${boardScoped ? "board-candidate-page-state" : superAdminEditorial ? "sa-candidates-state" : ""}`}>
              No elections are available for candidate setup.
            </div>
          ) : (
            <>
              {boardScoped || superAdminEditorial ? (
                <div className={boardScoped ? "board-candidate-section-head" : "sa-candidates-section-head"}>
                  <div>
                    <p className={boardScoped ? "board-candidate-eyebrow" : "sa-candidates-eyebrow"}>Election context</p>
                    <h2>{boardScoped ? "Select an election" : "Select the field to manage."}</h2>
                  </div>
                  <span>
                    {boardScoped
                      ? `${String(candidateElectionOptions().length).padStart(2, "0")} election${
                          candidateElectionOptions().length === 1 ? "" : "s"
                        }`
                      : `${candidateElectionOptions().length} election${candidateElectionOptions().length === 1 ? "" : "s"}`}
                  </span>
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
                            {electionPhaseLabel(election, now)}
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
              ) : boardScoped ? (
                <div className="board-candidate-election-list">
                  {candidateElectionOptions().map((election, index) => {
                    const electionCandidateCount = candidateCounts[election.id] || 0;
                    const electionYear = electionYearLabel(election.start_date);
                    const organizationName =
                      election.organizations?.name || user?.organizations?.name || "Organization";

                    return (
                      <button
                        key={election.id}
                        type="button"
                        className="board-candidate-election-row"
                        data-phase={getElectionPhase(election, now)}
                        onClick={() => openElectionPanel(election.id)}
                        aria-label={`View candidates for ${election.title || "Untitled Election"}`}
                      >
                        <span className="board-candidate-election-index">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="board-candidate-election-identity">
                          <strong className="board-candidate-election-name">
                            {election.title || "Untitled Election"}
                          </strong>
                          <span className="board-candidate-election-context">
                            {[
                              organizationName,
                              electionYear,
                              `${electionCandidateCount} candidate${electionCandidateCount === 1 ? "" : "s"}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="board-candidate-election-state">
                          <span className="board-candidate-election-phase">
                            {electionPhaseLabel(election, now)}
                          </span>
                          <span className="board-candidate-election-arrow" aria-hidden="true">
                            &rarr;
                          </span>
                        </span>
                      </button>
                    );
                  })}
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
                        now={now}
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
        <div className={boardScoped ? "board-candidate-workspace" : superAdminEditorial ? "sa-candidates-workspace" : "mt-8"}>
          {boardScoped ? (
            <section className="board-candidate-context" aria-label="Selected election">
              <ElectionCover election={selectedElection} compact className="board-candidate-context-cover" />
              <div className="board-candidate-context-copy">
                <p className="board-candidate-eyebrow">
                  Election context <span aria-hidden="true">/</span> {user?.organizations?.name || "Organization"}
                </p>
                <h2>{selectedElection?.title || "Election"}</h2>
                <div className="board-candidate-context-meta">
                  <span>{selectedElectionCandidates.length} candidate{selectedElectionCandidates.length === 1 ? "" : "s"}</span>
                  {selectedElectionReadOnly ? (
                    <span className="board-candidate-context-lock">Closed · Read only</span>
                  ) : (
                    <span className="board-candidate-context-phase">{electionPhaseLabel(selectedElection, now)}</span>
                  )}
                </div>
              </div>

              {/* Switch election belongs to the context it switches away from, so it
                  sits in the context's own control row beneath the election identity
                  rather than above it as a standalone heading. Same row, same order and
                  same quiet outlined treatment as the approved Positions workspace:
                  [ Switch election ] then the create control, in that order. */}
              <div className="board-candidate-context-actions">
                <button type="button" onClick={clearSelectedElection} className="board-candidate-switch">
                  Switch election
                </button>
              </div>
            </section>
          ) : (
            <>
              <button
                type="button"
                onClick={clearSelectedElection}
                className={superAdminEditorial ? "sa-candidates-back" : "mb-4 text-sm font-black uppercase tracking-[0.12em] text-[#ef4e23]"}
              >
                Back to elections
              </button>
          <div className={`entity-card ${superAdminEditorial ? "sa-candidates-context" : "mb-4 grid gap-4 lg:grid-cols-[minmax(0,17rem)_1fr_auto] lg:items-center"}`}>
            <ElectionManagementCard
              election={selectedElection}
              organization={undefined}
              now={now}
              eyebrow="Selected Election"
              counts={[
                {
                  label: `candidate${selectedElectionCandidates.length === 1 ? "" : "s"}`,
                  value: selectedElectionCandidates.length,
                },
              ]}
            />
            <div className={superAdminEditorial ? "sa-candidates-context-copy" : undefined}>
              <p className={superAdminEditorial ? "sa-candidates-eyebrow" : "page-kicker"}>Selected Election</p>
              <h2 className={superAdminEditorial ? "" : "entity-card-title mt-2"}>{selectedElection?.title || "Election"}</h2>
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
          </div>
            </>
          )}

          <ElectionCampaignPublication
            electionId={Number(selectedElectionId)}
            revision={candidates}
            readonly={readonlyBoardInspection}
            onPublished={() => refreshCandidates(selectedElectionId)}
          />

          {candidateError ? (
            <div className={`soft-card ${boardScoped ? "board-candidate-page-state" : superAdminEditorial ? "sa-candidates-state" : ""}`}>
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
            boardScoped ? (
              <div className="board-candidate-register-skeleton" role="status" aria-label="Loading candidate register" aria-busy="true">
                {[0, 1, 2, 3].map((row) => <div key={row}><span /><span /><span /><span /></div>)}
              </div>
            ) : (
              <div className={`soft-card ${superAdminEditorial ? "sa-candidates-state" : ""}`}>
                <p className="page-kicker">Candidate Records</p>
                <h2 className="mt-2 text-2xl font-black">Loading candidates...</h2>
              </div>
            )
          ) : boardScoped ? (
            <section
              className={`board-candidate-register${
                selectedElectionReadOnly ? " is-read-only" : ""
              }`}
            >
              <div className="board-candidate-register-head">
                <div>
                  <p className="board-candidate-eyebrow">Candidate register</p>
                  <h2>Candidates appearing on this ballot.</h2>
                </div>
                <span>{selectedElectionCandidates.length} candidate{selectedElectionCandidates.length === 1 ? "" : "s"}</span>
              </div>
              <div className="board-candidate-columns" aria-hidden="true">
                <span>Candidate</span>
                <span>Position</span>
                <span>Partylist / campaign</span>
                {selectedElectionReadOnly ? null : <span>Actions</span>}
              </div>
              {selectedElectionPositionCount === 0 ? (
                <div className="board-candidate-empty-register">
                  <strong>No ballot positions</strong>
                  <p>Add positions to this election before assigning candidates.</p>
                </div>
              ) : null}
              {selectedElectionPositionGroups.map(({ position, candidates: positionCandidates }, positionIndex) => (
                <section key={position.id} className="board-candidate-position-group">
                  <header className="board-candidate-position-head">
                    <span>{String(position.display_order || positionIndex + 1).padStart(2, "0")}</span>
                    <h3>{position.name}</h3>
                    <small>{positionCandidates.length} candidate{positionCandidates.length === 1 ? "" : "s"}</small>
                  </header>
                  {positionCandidates.length === 0 ? (
                    <p className="board-candidate-empty-position">No candidates configured for this position.</p>
                  ) : (
                    <div className="board-candidate-list">
                      {positionCandidates.map((candidate) => {
                        const materialsCount = parseCampaignMaterials(candidate.campaign_materials, candidate.campaign_media_urls).length;
                        return (
                          <article key={candidate.id} className="board-candidate-record">
                            <div className="board-candidate-identity">
                              <div className="board-candidate-avatar">
                                {candidate.photo ? <img src={candidate.photo} alt="" /> : <span>{candidateInitials(candidate)}</span>}
                              </div>
                              <div className="board-candidate-name-block">
                                <p className="board-candidate-name">{candidateName(candidate)}</p>
                              </div>
                            </div>
                            <span className="board-candidate-position-value">{position.name}</span>
                            <div className="board-candidate-affiliation">
                              <strong>{candidate.partylists?.name || "Independent"}</strong>
                              <small>{materialsCount} campaign material{materialsCount === 1 ? "" : "s"}</small>
                              <small className={`candidate-campaign-status-text is-${candidate.campaign_status || "unavailable"}`}>
                                Campaign: {campaignStatusLabel(candidate.campaign_status)}
                              </small>
                            </div>
                            {selectedElectionReadOnly ? null : (
                              <div className="board-candidate-actions">
                                <button
                                  type="button"
                                  disabled={readonlyBoardInspection}
                                  title={readonlyBoardInspection ? "Unavailable during read-only production inspection" : undefined}
                                  onClick={() => openEditForm(candidate)}
                                  className="board-candidate-action"
                                  aria-label={`Edit ${candidateName(candidate) || "candidate"}`}
                                >
                                  <Pencil size={14} /><span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={readonlyBoardInspection}
                                  title={readonlyBoardInspection ? "Unavailable during read-only production inspection" : undefined}
                                  onClick={() => handleDelete(candidate)}
                                  className="board-candidate-action is-danger"
                                  aria-label={`Delete ${candidateName(candidate) || "candidate"}`}
                                >
                                  <Trash2 size={14} /><span>Delete</span>
                                </button>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </section>
          ) : (
            <div className="sa-candidates-field">
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
                <section key={position.id} className="entity-card sa-candidate-position-group">
                  <div className="sa-candidate-position-head">
                    <span className="sa-candidate-position-index">{String(position.display_order || positionIndex + 1).padStart(2, "0")}</span>
                    <div>
                      <p className="sa-candidates-eyebrow">Ballot Position</p>
                      <h3>{position.name}</h3>
                    </div>
                    <span className="sa-candidate-position-count">
                      {positionCandidates.length} candidate{positionCandidates.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="sa-candidate-list">
                    {positionCandidates.length === 0 ? (
                      <div className="sa-candidate-empty-position">No candidates configured for this position.</div>
                    ) : (
                      positionCandidates.map((candidate, candidateIndex) => (
                        <div key={candidate.id} className="sa-candidate-record">
                          <span className="sa-candidate-index">{String(candidateIndex + 1).padStart(2, "0")}</span>
                          <div className="sa-candidate-identity">
                            <div className="sa-candidate-avatar">
                              {candidate.photo ? <img src={candidate.photo} alt="" /> : <span>{candidateInitials(candidate)}</span>}
                            </div>
                            <div>
                              <p className="sa-candidate-name">{candidateName(candidate)}</p>
                              <p className="sa-candidate-meta">
                                <span>{candidate.partylists?.name || "Independent"}</span>
                                <span>{parseCampaignMaterials(candidate.campaign_materials, candidate.campaign_media_urls).length} media</span>
                                <span className={`candidate-campaign-status-text is-${candidate.campaign_status || "unavailable"}`}>
                                  Campaign: {campaignStatusLabel(candidate.campaign_status)}
                                </span>
                              </p>
                            </div>
                          </div>
                          <div className="sa-candidate-actions">
                            <button type="button" onClick={() => openEditForm(candidate)} className="icon-action" aria-label={`Edit ${candidateName(candidate) || "candidate"}`}>
                              <Pencil size={16} /><span>Edit</span>
                            </button>
                            <button type="button" onClick={() => handleDelete(candidate)} className="icon-action icon-action-danger" aria-label={`Delete ${candidateName(candidate) || "candidate"}`}>
                              <Trash2 size={16} /><span>Delete</span>
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
          {boardScoped ? (
            <div className="modal-card board-candidate-form-dialog">
              <header className="board-candidate-form-header">
                <div>
                  <p>Candidate workspace</p>
                  <h2>{editingCandidate ? "Edit candidate" : "Add candidate"}</h2>
                  <span>
                    {editingCandidate
                      ? "Update the candidate identity and campaign information."
                      : "Assign an eligible student to this ballot position."}
                  </span>
                </div>
                <button type="button" onClick={closeCandidateForm} className="board-candidate-form-close" aria-label="Close candidate form">
                  <X size={20} />
                </button>
              </header>

              <div className="board-candidate-form-context">
                <span>Election · read only</span>
                <strong>{selectedElection?.title || "Election"}</strong>
                <small>{user?.organizations?.name || "Organization"} · {electionPhaseLabel(selectedElection, now)}</small>
              </div>

              <form onSubmit={handleSubmit} className="board-candidate-form">
                <section className="board-candidate-form-section">
                  <div className="board-candidate-form-section-head">
                    <span>01</span>
                    <div><h3>Ballot assignment</h3><p>{editingCandidate ? "The original student and ballot position are read only. Campaign details remain editable when permitted." : "Choose the position for this candidate."}</p></div>
                  </div>
                  <div className="board-candidate-form-field">
                    <label className="field-label">Position</label>
                    <select
                      required
                      value={form.position_id} id="board-candidate-position"
                      disabled={!form.election_id || Boolean(editingCandidate) || savingCandidate}
                      onChange={(event) => {
                        const selectedPositionId = event.target.value;
                        setForm({ ...form, position_id: selectedPositionId, student_id: "" });
                        setStudentQuery("");
                        fetchStudentsByPosition(selectedPositionId);
                      }}
                      className="field-shell w-full"
                    >
                      <option value="">Select Position</option>
                      {positionsForSelectedElection().map((position) => (
                        <option key={position.id} value={position.id}>{position.name}</option>
                      ))}
                    </select>
                  </div>
                </section>

                <section className="board-candidate-form-section">
                  <div className="board-candidate-form-section-head">
                    <span>02</span>
                    <div><h3>Candidate identity</h3><p>{editingCandidate ? "Student identity is preserved. Update only permitted ballot affiliation and campaign details." : "Select an eligible student and ballot affiliation."}</p></div>
                  </div>
                  <div className="board-candidate-form-field board-candidate-form-student">
                    <StudentSearchPicker
                      label="Eligible Student"
                      students={studentsAvailableForCandidate()}
                      value={form.student_id}
                      onChange={(studentId) => setForm({ ...form, student_id: studentId })}
                      query={studentQuery}
                      onQueryChange={setStudentQuery}
                      disabled={!form.position_id || Boolean(editingCandidate) || savingCandidate}
                      emptyText="No remaining eligible students for this election."
                    />
                  </div>
                  <div className="board-candidate-form-field">
                    <label className="field-label">Partylist</label>
                    <select
                      value={form.partylist_id} id="board-candidate-partylist"
                      onChange={(event) => setForm({ ...form, partylist_id: event.target.value })}
                      className="field-shell w-full"
                    >
                      <option value="">Independent / No Partylist</option>
                      {partylistsForSelectedElection().map((partylist) => (
                        <option key={partylist.id} value={partylist.id}>{partylist.name}</option>
                      ))}
                    </select>
                  </div>
                </section>

                <section className="board-candidate-form-section board-candidate-form-campaign">
                  <div className="board-candidate-form-section-head">
                    <span>03</span>
                    <div><h3>Campaign information</h3><p>Prepare the candidate profile and materials shown to students.</p></div>
                  </div>
                  <div className="board-candidate-form-field">
                    <label className="field-label">Photo URL</label>
                    <input
                      value={form.photo} id="board-candidate-photo"
                      onChange={(event) => setForm({ ...form, photo: event.target.value })}
                      placeholder="Photo URL optional"
                      className="field-shell w-full"
                    />
                  </div>
                  <div className="board-candidate-form-field">
                    <label className="field-label">Platform</label>
                    <textarea value={form.platform} id="board-candidate-platform" onChange={(event) => setForm({ ...form, platform: event.target.value })} placeholder="Candidate platform" className="field-shell min-h-[120px] w-full" rows="3" />
                  </div>
                  <div className="board-candidate-form-field">
                    <label className="field-label">Credentials</label>
                    <textarea value={form.credentials} id="board-candidate-credentials" onChange={(event) => setForm({ ...form, credentials: event.target.value })} placeholder="Credentials and achievements" className="field-shell min-h-[120px] w-full" rows="3" />
                  </div>
                  <div className="board-candidate-form-field">
                    <label className="field-label">Bio</label>
                    <textarea value={form.bio} id="board-candidate-bio" onChange={(event) => setForm({ ...form, bio: event.target.value })} placeholder="Candidate bio" className="field-shell min-h-[120px] w-full" rows="3" />
                  </div>
                  <div className="upload-shell board-candidate-form-materials">
                    <p className="board-candidate-material-title">Campaign materials</p>
                    <p className="board-candidate-material-copy">Add up to 3 downloadable or viewable materials per candidate.</p>
                    <div className="board-candidate-material-list">
                      {form.campaign_materials.map((material, index) => (
                        <div key={index} className="board-candidate-material-record">
                          <input value={material.label} onChange={(event) => updateMaterial(index, "label", event.target.value)} placeholder={`Material title ${index + 1}`} className="field-shell" />
                          <select value={inferCampaignMaterialInputType(material)} onChange={(event) => changeMaterialInputType(index, event.target.value)} className="field-shell" aria-label={`Material type ${index + 1}`}>
                            <option value="link">Link</option>
                            <option value="image">Image</option>
                            <option value="video">Video</option>
                            <option value="document">Document</option>
                          </select>
                          {inferCampaignMaterialInputType(material) === "link" ? (
                            <input type="url" inputMode="url" value={material.url} onChange={(event) => updateMaterial(index, "url", event.target.value)} placeholder="https://..." pattern="https://.+" aria-label={`HTTPS campaign link ${index + 1}`} className="field-shell board-candidate-material-url" />
                          ) : (
                            <div className="board-candidate-material-file">
                              <input type="file" accept={inferCampaignMaterialInputType(material) === "image" ? "image/jpeg,image/png,image/webp" : inferCampaignMaterialInputType(material) === "video" ? "video/mp4,video/webm" : "application/pdf"} disabled={uploadingMaterialIndex !== null} onChange={(event) => { void handleCampaignMaterialFile(index, event.target.files?.[0]); event.target.value = ""; }} aria-label={`Upload campaign ${inferCampaignMaterialInputType(material)} ${index + 1}`} className="field-shell" />
                              <small>{material.url ? "Private file attached; replacing it will preserve the previous file." : "Choose a supported file for this campaign material."}</small>
                              {materialUploadErrors[index] ? <small role="alert">{materialUploadErrors[index]}</small> : null}
                            </div>
                          )}
                          <label className="board-candidate-material-download">
                            <input type="checkbox" checked={material.downloadable} onChange={(event) => updateMaterial(index, "downloadable", event.target.checked)} />
                            Allow student download
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <footer className="board-candidate-form-actions">
                  <button type="button" onClick={closeCandidateForm} className="board-candidate-form-cancel">Cancel</button>
                  <button type="submit" className="board-candidate-form-submit" disabled={savingCandidate || uploadingMaterialIndex !== null}>
                    {savingCandidate ? "Saving..." : editingCandidate ? "Save changes" : "Add candidate"}
                  </button>
                </footer>
              </form>
            </div>
          ) : (
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
                      ? "Student and ballot position are read only. Update permitted affiliation and campaign details."
                      : "Assign an eligible student to one ballot position."}
                  </span>
                ) : null}
              </div>
              ) : (
                <h2 className="text-2xl font-black">
                  {editingCandidate ? "Edit Candidate" : "Add Candidate"}
                </h2>
              )}

              <button type="button" onClick={closeCandidateForm} className={superAdminEditorial ? "candidate-form-close" : "icon-action"} aria-label="Close candidate form">
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
                  disabled={Boolean(editingCandidate) || savingCandidate}
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
                  value={form.position_id} id="sa-candidate-position"
                  disabled={!form.election_id || Boolean(editingCandidate) || savingCandidate}
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
                  disabled={!form.position_id || Boolean(editingCandidate) || savingCandidate}
                  emptyText="No remaining eligible students for this election."
                />
              </div>

              <div className={superAdminEditorial ? "candidate-form-field" : undefined}>
                <label className="field-label">Partylist</label>
                <select
                  value={form.partylist_id} id="sa-candidate-partylist"
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
                  value={form.photo} id="sa-candidate-photo"
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
                  value={form.platform} id="sa-candidate-platform"
                  onChange={(event) => setForm({ ...form, platform: event.target.value })}
                  placeholder="Candidate platform"
                  className="field-shell min-h-[120px] w-full"
                  rows="3"
                />
              </div>

              <div className={superAdminEditorial ? "candidate-form-field candidate-form-copy" : undefined}>
                <label className="field-label">Credentials</label>
                <textarea
                  value={form.credentials} id="sa-candidate-credentials"
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
                  value={form.bio} id="sa-candidate-bio"
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
                        value={inferCampaignMaterialInputType(material)}
                        onChange={(event) => changeMaterialInputType(index, event.target.value)}
                        className="field-shell"
                        aria-label={`Material type ${index + 1}`}
                      >
                        <option value="link">Link</option>
                        <option value="image">Image</option>
                        <option value="video">Video</option>
                        <option value="document">Document</option>
                      </select>
                      {inferCampaignMaterialInputType(material) === "link" ? (
                        <input type="url" inputMode="url" value={material.url}
                          onChange={(event) => updateMaterial(index, "url", event.target.value)}
                          placeholder="https://..." pattern="https://.+"
                          aria-label={`HTTPS campaign link ${index + 1}`}
                          className="field-shell md:col-span-2" />
                      ) : (
                        <div className="candidate-material-file md:col-span-2">
                          <input type="file"
                            accept={inferCampaignMaterialInputType(material) === "image" ? "image/jpeg,image/png,image/webp" : inferCampaignMaterialInputType(material) === "video" ? "video/mp4,video/webm" : "application/pdf"}
                            disabled={uploadingMaterialIndex !== null}
                            onChange={(event) => { void handleCampaignMaterialFile(index, event.target.files?.[0]); event.target.value = ""; }}
                            aria-label={`Upload campaign ${inferCampaignMaterialInputType(material)} ${index + 1}`}
                            className="field-shell" />
                          <small>{material.url ? "Private file attached; replacing it will preserve the previous file." : "Choose a supported file for this campaign material."}</small>
                          {materialUploadErrors[index] ? <small role="alert">{materialUploadErrors[index]}</small> : null}
                        </div>
                      )}
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
                  <button type="button" className="secondary-btn" onClick={closeCandidateForm}>Cancel</button>
                  <button type="submit" className="primary-btn" disabled={savingCandidate || uploadingMaterialIndex !== null}>
                    {savingCandidate ? "Saving..." : editingCandidate ? "Save Changes" : "Add Candidate"}
                  </button>
                </footer>
              ) : (
                <button type="submit" className="primary-btn w-full" disabled={savingCandidate || uploadingMaterialIndex !== null}>
                  {savingCandidate ? "Saving..." : editingCandidate ? "Save Changes" : "Add Candidate"}
                </button>
              )}
            </form>
          </div>
          )}
        </PopupOverlay>
      )}
    </div>
  );
}

export default CandidateManagement;
