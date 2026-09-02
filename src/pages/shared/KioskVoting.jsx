import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  MapPin,
  MonitorSmartphone,
  QrCode,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  fetchAuthoritativeNow,
  formatLocalDateTime,
  getElectionPhase,
  isMissingElectionCoverColumn,
} from "../../utils/elections";
import { getStudentElectionOrganizationIds } from "../../utils/organizationAccess";
import { fetchOrderedPositions } from "../../utils/positionOrder";
import { hasStudentVotedInElection, submitBallot } from "../../utils/voting";
import {
  distanceBetweenMeters,
  doesTokenMatchStudent,
  getVotingAccessModeLabel,
  isTokenExpired,
} from "../../utils/votingAccess";
import { usePrompt } from "../../context/PromptContext";
import KandidImage, { OrganizationLogo } from "../../components/KandidImage";
import ElectionCover from "../../components/ElectionCover";

function studentName(student) {
  return `${student?.first_name || ""} ${student?.last_name || ""}`.trim();
}

function candidateName(candidate) {
  return studentName(candidate?.students) || "Candidate";
}

function KioskVoting() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const navigate = useNavigate();
  const prompt = usePrompt();
  const sessionRequestRef = useRef(0);
  const ballotRequestRef = useRef(0);

  const [authoritativeNow, setAuthoritativeNow] = useState(null);
  const [nowTick, setNowTick] = useState(0);
  const [elections, setElections] = useState([]);
  const [selectedElectionId, setSelectedElectionId] = useState("");
  const [positions, setPositions] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selectedVotes, setSelectedVotes] = useState({});
  const [studentNumber, setStudentNumber] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [verifiedStudent, setVerifiedStudent] = useState(null);
  const [stage, setStage] = useState("login");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState("neutral");
  const [discoveryError, setDiscoveryError] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ballotLoading, setBallotLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [accessGranted, setAccessGranted] = useState(false);
  const [accessMessage, setAccessMessage] = useState("");
  const [verifyingAccess, setVerifyingAccess] = useState(false);

  const selectedElection = useMemo(
    () => elections.find((election) => String(election.id) === String(selectedElectionId)) || null,
    [elections, selectedElectionId],
  );

  const displayNow = authoritativeNow
    ? new Date(authoritativeNow.getTime() + nowTick * 30000)
    : new Date();
  const kioskPhase = selectedElection ? getElectionPhase(selectedElection, displayNow) : null;
  const completedSelections = Object.keys(selectedVotes).length;
  const hasMultipleSessions = elections.length > 1;
  const accessMode = selectedElection?.voting_access_mode || "anywhere";

  function setFeedback(message, tone = "neutral") {
    setStatusMessage(message);
    setStatusTone(tone);
  }

  function clearVoterState(clearMessage = true) {
    ballotRequestRef.current += 1;
    setVerifiedStudent(null);
    setSelectedVotes({});
    setStudentNumber("");
    setPassword("");
    setShowPassword(false);
    setStage("login");
    setReceipt(null);
    setShowReceipt(false);
    setAccessCode("");
    setAccessGranted(false);
    setAccessMessage("");
    setPositions([]);
    setCandidates([]);
    setBallotLoading(false);
    setVerifying(false);
    setVerifyingAccess(false);
    if (clearMessage) setFeedback("");
  }

  const loadKioskElections = useCallback(async () => {
    const requestId = sessionRequestRef.current + 1;
    sessionRequestRef.current = requestId;
    setLoading(true);
    setDiscoveryError("");

    const buildQuery = (includeCoverColumn = true) => {
      const selectColumns = `
        id,
        title,
        ${includeCoverColumn ? "cover_url," : ""}
        organization_id,
        campaign_start,
        campaign_end,
        start_date,
        end_date,
        status,
        voting_access_mode,
        geo_lat,
        geo_lng,
        geo_radius_meters,
        location_label,
        organizations(name, logo_url)
      `;
      let nextQuery = supabase
        .from("elections")
        .select(selectColumns)
        .neq("status", "archived")
        .order("start_date", { ascending: true });

      if (user?.role === "electoral_board" && user?.organization_id) {
        nextQuery = nextQuery.eq("organization_id", user.organization_id);
      }

      return nextQuery;
    };

    let [{ data, error }, serverNow] = await Promise.all([
      buildQuery(true),
      fetchAuthoritativeNow(),
    ]);

    if (isMissingElectionCoverColumn(error)) {
      const fallback = await buildQuery(false);
      data = fallback.data;
      error = fallback.error;
    }

    if (sessionRequestRef.current !== requestId) return;

    if (error) {
      setDiscoveryError(error.message || "Unable to load kiosk voting sessions.");
      setElections([]);
      setSelectedElectionId("");
      setLoading(false);
      return;
    }

    const activeRows = (data || []).filter(
      (election) => getElectionPhase(election, serverNow) === "voting",
    );

    setAuthoritativeNow(serverNow);
    setNowTick(0);
    setElections(activeRows);
    setSelectedElectionId((current) => {
      const currentIsActive = activeRows.some(
        (election) => String(election.id) === String(current),
      );
      if (activeRows.length === 1) return String(activeRows[0].id);
      if (activeRows.length > 1 && currentIsActive) return current;
      return "";
    });
    setLoading(false);
  }, [user?.organization_id, user?.role]);

  useEffect(() => {
    let active = true;

    async function syncClock() {
      const serverNow = await fetchAuthoritativeNow();
      if (!active) return;
      setAuthoritativeNow(serverNow);
      setNowTick(0);
    }

    syncClock();
    const timer = window.setInterval(() => {
      setNowTick((value) => value + 1);
      syncClock();
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    loadKioskElections();
  }, [loadKioskElections]);

  function exitKiosk() {
    navigate(user?.role === "electoral_board" ? "/board/dashboard" : "/super-admin/dashboard");
  }

  function selectKioskSession(electionId) {
    clearVoterState(false);
    setSelectedElectionId(String(electionId));
    setFeedback("");
  }

  function changeKioskSession() {
    clearVoterState(false);
    setSelectedElectionId("");
    setFeedback("");
  }

  const finishKiosk = useCallback(
    async (message = "") => {
      clearVoterState(false);
      setFeedback(message, "neutral");
      if (elections.length !== 1) {
        setSelectedElectionId("");
      }
      await loadKioskElections();
    },
    [elections.length, loadKioskElections],
  );

  useEffect(() => {
    if (stage === "login" || stage === "success" || submitting) return undefined;

    let timer = window.setTimeout(
      () => finishKiosk("Session timed out. Ready for next student."),
      300000,
    );

    function bump() {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => finishKiosk("Session timed out. Ready for next student."),
        300000,
      );
    }

    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, [finishKiosk, stage, submitting]);

  async function revalidateSelectedElection() {
    if (!selectedElectionId) {
      return { election: null, error: new Error("Choose a kiosk session first.") };
    }

    const buildQuery = (includeCoverColumn = true) =>
      supabase
        .from("elections")
        .select(`
          id,
          title,
          ${includeCoverColumn ? "cover_url," : ""}
          organization_id,
          campaign_start,
          campaign_end,
          start_date,
          end_date,
          status,
          voting_access_mode,
          geo_lat,
          geo_lng,
          geo_radius_meters,
          location_label,
          organizations(name, logo_url)
        `)
        .eq("id", Number(selectedElectionId))
        .single();

    let { data, error } = await buildQuery(true);

    if (isMissingElectionCoverColumn(error)) {
      const fallback = await buildQuery(false);
      data = fallback.data;
      error = fallback.error;
    }

    if (error) return { election: null, error };

    const serverNow = await fetchAuthoritativeNow();
    setAuthoritativeNow(serverNow);
    setNowTick(0);

    if (getElectionPhase(data, serverNow) !== "voting") {
      setElections((current) =>
        current.filter((election) => String(election.id) !== String(selectedElectionId)),
      );
      setSelectedElectionId("");
      return {
        election: null,
        error: new Error("This kiosk voting session is no longer open."),
      };
    }

    setElections((current) =>
      current.map((election) => (String(election.id) === String(data.id) ? data : election)),
    );
    return { election: data, error: null };
  }

  async function loadBallotMetadata(electionId) {
    const requestId = ballotRequestRef.current + 1;
    ballotRequestRef.current = requestId;
    setBallotLoading(true);
    setPositions([]);
    setCandidates([]);

    const { data: positionData, error: positionError } = await fetchOrderedPositions(
      supabase,
      Number(electionId),
    );

    if (ballotRequestRef.current !== requestId) return false;

    if (positionError) {
      setFeedback(positionError.message || "Unable to load ballot positions.", "error");
      setBallotLoading(false);
      return false;
    }

    const positionIds = (positionData || []).map((position) => position.id);
    let candidateData = [];
    let candidateError = null;

    if (positionIds.length > 0) {
      const result = await supabase
        .from("candidates")
        .select(`
          id,
          position_id,
          student_id,
          partylist_id,
          photo,
          students(first_name, last_name, student_number, photo_url),
          partylists(name, logo_url)
        `)
        .in("position_id", positionIds);

      candidateData = result.data || [];
      candidateError = result.error;
    }

    if (ballotRequestRef.current !== requestId) return false;

    if (candidateError) {
      setFeedback(candidateError.message || "Unable to load ballot candidates.", "error");
      setBallotLoading(false);
      return false;
    }

    setPositions(positionData || []);
    setCandidates(candidateData);
    setBallotLoading(false);
    return true;
  }

  function handleSelect(position, candidateId) {
    const maxVotes = Math.max(Number(position.max_votes || 1), 1);

    setSelectedVotes((current) => {
      const previous = current[position.id];

      if (maxVotes === 1) {
        return {
          ...current,
          [position.id]: {
            position_id: position.id,
            candidate_id: candidateId,
            candidate_ids: [candidateId],
            is_abstain: false,
          },
        };
      }

      const existing = previous?.is_abstain ? [] : previous?.candidate_ids || [];
      const alreadySelected = existing.includes(candidateId);
      const nextCandidateIds = alreadySelected
        ? existing.filter((id) => id !== candidateId)
        : existing.length < maxVotes
          ? [...existing, candidateId]
          : existing;

      if (nextCandidateIds.length === 0) {
        const next = { ...current };
        delete next[position.id];
        return next;
      }

      return {
        ...current,
        [position.id]: {
          position_id: position.id,
          candidate_id: nextCandidateIds[0],
          candidate_ids: nextCandidateIds,
          is_abstain: false,
        },
      };
    });
  }

  function handleAbstain(position) {
    setSelectedVotes((current) => ({
      ...current,
      [position.id]: {
        position_id: position.id,
        candidate_id: null,
        candidate_ids: [],
        is_abstain: true,
      },
    }));
  }

  async function handleVerifyStudent(event) {
    event.preventDefault();

    if (!selectedElection) {
      setFeedback("Choose a voting kiosk first.", "error");
      return;
    }

    setVerifying(true);
    setFeedback("");
    setAccessMessage("");

    const currentElection = await revalidateSelectedElection();
    if (currentElection.error || !currentElection.election) {
      setPassword("");
      setFeedback(currentElection.error?.message || "This kiosk is no longer available.", "error");
      setVerifying(false);
      return;
    }

    const { data: studentData, error } = await supabase
      .from("students")
      .select(
        "id, first_name, last_name, student_number, password, status, program, year_level, precinct_code, batch_code",
      )
      .eq("student_number", studentNumber.trim())
      .maybeSingle();

    const submittedPassword = password;
    setPassword("");

    if (error || !studentData) {
      setFeedback("Student record not found.", "error");
      setVerifying(false);
      return;
    }

    if (studentData.status === "pending") {
      setFeedback("This student still needs to complete account setup.", "error");
      setVerifying(false);
      return;
    }

    if (studentData.status === "disabled") {
      setFeedback("This student account is disabled.", "error");
      setVerifying(false);
      return;
    }

    if (studentData.password !== submittedPassword) {
      setFeedback("Incorrect student password.", "error");
      setVerifying(false);
      return;
    }

    const eligibleOrganizationIds = await getStudentElectionOrganizationIds(studentData);

    if (!eligibleOrganizationIds.includes(Number(currentElection.election.organization_id))) {
      setVerifiedStudent(studentData);
      setStage("denied");
      setFeedback("This student is not eligible for this election.", "error");
      setVerifying(false);
      return;
    }

    const voteCheck = await hasStudentVotedInElection(studentData.id, currentElection.election.id);

    if (voteCheck.error) {
      setFeedback(voteCheck.error.message, "error");
      setVerifying(false);
      return;
    }

    if (voteCheck.hasVoted) {
      setVerifiedStudent(studentData);
      setStage("already_voted");
      setFeedback("");
      setVerifying(false);
      return;
    }

    setVerifiedStudent(studentData);
    setSelectedVotes({});

    if ((currentElection.election.voting_access_mode || "anywhere") !== "anywhere") {
      setStage("access");
      setAccessGranted(false);
      setAccessCode("");
      setAccessMessage("");
      setVerifying(false);
      return;
    }

    const loaded = await loadBallotMetadata(currentElection.election.id);
    if (loaded) {
      setStage("ballot");
      setFeedback("");
    }
    setVerifying(false);
  }

  async function handleVerifyAccessCode() {
    const normalizedCode = accessCode.trim().toUpperCase();
    if (!normalizedCode) {
      setAccessMessage("Enter the QR access code provided by your election officer.");
      return;
    }

    if (!selectedElection || !verifiedStudent) return;

    const currentElection = await revalidateSelectedElection();
    if (currentElection.error || !currentElection.election) {
      setAccessMessage(currentElection.error?.message || "This kiosk is no longer available.");
      return;
    }

    setVerifyingAccess(true);
    setAccessMessage("");

    const { data, error } = await supabase
      .from("election_access_tokens")
      .select("id, election_id, token, is_active, scope_type, scope_value, expires_at")
      .eq("election_id", Number(currentElection.election.id))
      .eq("token", normalizedCode)
      .maybeSingle();

    if (error) {
      setAccessMessage(error.message || "Failed to validate access code.");
      setVerifyingAccess(false);
      return;
    }

    if (!data || !data.is_active) {
      setAccessMessage("This access code is invalid or inactive.");
      setVerifyingAccess(false);
      return;
    }

    if (isTokenExpired(data, displayNow)) {
      setAccessMessage("This access code has already expired.");
      setVerifyingAccess(false);
      return;
    }

    if (!doesTokenMatchStudent(data, verifiedStudent)) {
      setAccessMessage("This QR access code is not assigned to your precinct or batch.");
      setVerifyingAccess(false);
      return;
    }

    setAccessGranted(true);
    setAccessMessage("Access granted. Opening the ballot.");
    const loaded = await loadBallotMetadata(currentElection.election.id);
    if (loaded) {
      setStage("ballot");
      setFeedback("");
    }
    setVerifyingAccess(false);
  }

  async function handleVerifyLocation() {
    if (!navigator.geolocation) {
      setAccessMessage("This device does not support location verification.");
      return;
    }

    if (!selectedElection || !verifiedStudent) return;

    const currentElection = await revalidateSelectedElection();
    if (currentElection.error || !currentElection.election) {
      setAccessMessage(currentElection.error?.message || "This kiosk is no longer available.");
      return;
    }

    if (
      currentElection.election.geo_lat == null ||
      currentElection.election.geo_lng == null ||
      currentElection.election.geo_radius_meters == null
    ) {
      setAccessMessage("This election does not have a valid location range yet.");
      return;
    }

    setVerifyingAccess(true);
    setAccessMessage("Checking your location...");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const distance = distanceBetweenMeters(
          Number(position.coords.latitude),
          Number(position.coords.longitude),
          Number(currentElection.election.geo_lat),
          Number(currentElection.election.geo_lng),
        );

        if (distance > Number(currentElection.election.geo_radius_meters)) {
          setAccessMessage(
            `You are outside the allowed voting range. Current distance: ${Math.round(distance)} meters.`,
          );
          setVerifyingAccess(false);
          return;
        }

        setAccessGranted(true);
        setAccessMessage(`Access granted. You are within ${Math.round(distance)} meters of the voting area.`);
        const loaded = await loadBallotMetadata(currentElection.election.id);
        if (loaded) {
          setStage("ballot");
          setFeedback("");
        }
        setVerifyingAccess(false);
      },
      (error) => {
        setAccessMessage(error.message || "Unable to get your current location.");
        setVerifyingAccess(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  }

  function openReview() {
    const missingPosition = positions.find((position) => !selectedVotes[position.id]);

    if (missingPosition) {
      setFeedback(`Choose a candidate or abstain for ${missingPosition.name}.`, "error");
      return;
    }

    setFeedback("");
    setStage("review");
  }

  function selectedCandidateNames(position) {
    const vote = selectedVotes[position.id];
    if (!vote) return "No selection";
    if (vote.is_abstain) return "Abstain";

    return (vote.candidate_ids || [])
      .map((candidateId) =>
        candidateName(candidates.find((candidate) => candidate.id === candidateId)),
      )
      .join(", ");
  }

  async function handleSubmitBallot() {
    if (!verifiedStudent || !selectedElection || submitting) return;

    const ok = await prompt.confirm({
      title: "Submit Kiosk Ballot?",
      message: `Submit the official kiosk ballot for ${studentName(verifiedStudent)}? This action cannot be reversed.`,
      type: "primary",
      confirmText: "Submit Ballot",
    });

    if (!ok) return;

    const currentElection = await revalidateSelectedElection();
    if (currentElection.error || !currentElection.election) {
      setFeedback(currentElection.error?.message || "This voting window has already closed.", "error");
      setStage("login");
      return;
    }

    setSubmitting(true);

    const { error, alreadyVoted, submittedAt } = await submitBallot({
      studentId: verifiedStudent.id,
      electionId: currentElection.election.id,
      selectedVotes,
    });

    if (error) {
      setFeedback(
        alreadyVoted
          ? "This student already has a recorded ballot in this election."
          : error.message,
        "error",
      );
      if (alreadyVoted) setStage("already_voted");
      setSubmitting(false);
      return;
    }

    setReceipt({
      studentName: studentName(verifiedStudent),
      studentNumber: verifiedStudent.student_number,
      submittedAt,
      selections: positions.map((position) => ({
        position: position.name,
        selection: selectedCandidateNames(position),
      })),
    });
    setStage("success");
    setShowReceipt(false);
    setSubmitting(false);
  }

  function renderSessionCard(election) {
    return (
      <button
        key={election.id}
        type="button"
        onClick={() => selectKioskSession(election.id)}
        className="kiosk-session-card"
      >
        <ElectionCover election={election} compact className="kiosk-session-cover" />
        <div className="kiosk-session-meta">
          <OrganizationLogo organization={election.organizations} className="kiosk-session-logo" />
          <div>
            <span>Open for Voting</span>
            <strong>{election.title}</strong>
            <em>{election.organizations?.name || "Organization"}</em>
          </div>
        </div>
        <div className="kiosk-session-window">
          <CalendarDays size={16} />
          <span>Ends {formatLocalDateTime(election.end_date)}</span>
        </div>
      </button>
    );
  }

  function renderEntryState() {
    if (loading) {
      return (
        <section className="kiosk-entry-state">
          <ShieldCheck size={38} />
          <h1>Preparing Kiosk</h1>
          <p>Checking active voting sessions for this terminal.</p>
        </section>
      );
    }

    if (discoveryError) {
      return (
        <section className="kiosk-entry-state">
          <ShieldCheck size={38} />
          <h1>Kiosk Unavailable</h1>
          <p>{discoveryError}</p>
          <button type="button" onClick={loadKioskElections} className="primary-btn">
            <RefreshCw size={18} />
            Retry
          </button>
        </section>
      );
    }

    if (elections.length === 0) {
      return (
        <section className="kiosk-entry-state">
          <MonitorSmartphone size={40} />
          <h1>No Active Kiosk</h1>
          <p>There are currently no active voting sessions available.</p>
          <button type="button" onClick={loadKioskElections} className="secondary-btn">
            <RefreshCw size={18} />
            Refresh
          </button>
        </section>
      );
    }

    if (hasMultipleSessions && !selectedElection) {
      return (
        <section className="kiosk-selection">
          <div className="kiosk-selection-head">
            <div>
              <span className="kiosk-brand">KANDID</span>
              <h1>Choose Your Voting Kiosk</h1>
              <p>Multiple voting sessions are open. Select the election you want to participate in.</p>
            </div>
            <button type="button" onClick={loadKioskElections} className="secondary-btn">
              <RefreshCw size={18} />
              Refresh
            </button>
          </div>
          <div className="kiosk-session-grid">{elections.map(renderSessionCard)}</div>
        </section>
      );
    }

    return null;
  }

  function renderAccessGate() {
    const isLocationMode = accessMode === "location_range";

    return (
      <div className="kiosk-access">
        <div className="kiosk-access-head">
          <div className="secure-badge">
            <LockKeyhole size={14} />
            Ballot Access Control
          </div>
          <h2>{getVotingAccessModeLabel(accessMode)}</h2>
          <p>
            {isLocationMode
              ? "Verify this device is inside the approved voting area before the ballot opens."
              : "Enter the access code provided by your election officer before the ballot opens."}
          </p>
        </div>

        {isLocationMode ? (
          <button
            type="button"
            onClick={handleVerifyLocation}
            disabled={verifyingAccess || ballotLoading}
            className="primary-btn"
          >
            <MapPin size={18} />
            {verifyingAccess || ballotLoading ? "Verifying..." : "Verify Location"}
          </button>
        ) : (
          <div className="kiosk-access-code">
            <QrCode size={20} />
            <input
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value.toUpperCase())}
              placeholder="Enter access code"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={handleVerifyAccessCode}
              disabled={verifyingAccess || ballotLoading}
              className="primary-btn"
            >
              {verifyingAccess || ballotLoading ? "Checking..." : "Unlock Ballot"}
            </button>
          </div>
        )}

        {accessGranted || accessMessage ? (
          <p className={`kiosk-feedback ${accessGranted ? "success" : "neutral"}`}>
            {accessMessage}
          </p>
        ) : null}
        <button type="button" onClick={() => finishKiosk("Kiosk session cleared.")} className="secondary-btn">
          Finish
        </button>
      </div>
    );
  }

  const entryState = renderEntryState();

  return (
    <main className="kiosk-terminal">
      <header className="kiosk-terminal-header">
        <div>
          <span className="kiosk-brand">KANDID</span>
          <strong>Kiosk Voting</strong>
        </div>
        <button type="button" onClick={exitKiosk} className="kiosk-exit">
          <ArrowLeft size={18} />
          Exit Kiosk
        </button>
      </header>

      {entryState || (
        <section className="kiosk-shell">
          <aside className="kiosk-election-panel">
            {selectedElection ? (
              <div className="kiosk-panel-cover">
                <ElectionCover election={selectedElection} />
                <OrganizationLogo organization={selectedElection.organizations} className="kiosk-panel-logo" />
              </div>
            ) : null}
            <div className="secure-badge">
              <MonitorSmartphone size={14} />
              Voting Terminal
            </div>
            <h1>{selectedElection?.title || "Kiosk Voting"}</h1>
            <p>{selectedElection?.organizations?.name || "Select an election to begin."}</p>

            {hasMultipleSessions ? (
              <button type="button" onClick={changeKioskSession} className="kiosk-change-session">
                Change Kiosk
              </button>
            ) : null}

            {selectedElection ? (
              <div className="kiosk-window">
                <span>Voting Window</span>
                <strong>
                  {formatLocalDateTime(selectedElection.start_date)} to{" "}
                  {formatLocalDateTime(selectedElection.end_date)}
                </strong>
                <em>{kioskPhase || "checking"}</em>
              </div>
            ) : null}

            <div className="kiosk-progress">
              <span>Ballot Progress</span>
              <strong>{completedSelections}/{positions.length || 0}</strong>
            </div>
          </aside>

          <section className="kiosk-workspace">
            {ballotLoading ? (
              <div className="kiosk-state">
                <ShieldCheck size={34} />
                <h2>Preparing ballot...</h2>
                <p>Loading the selected election ballot.</p>
              </div>
            ) : stage === "access" && verifiedStudent ? (
              renderAccessGate()
            ) : stage === "already_voted" ? (
              <div className="kiosk-state">
                <CheckCircle2 size={38} />
                <h2>Vote Already Recorded</h2>
                <p>Your vote for this election has already been submitted.</p>
                <button type="button" onClick={() => finishKiosk()} className="primary-btn">
                  Finish
                </button>
              </div>
            ) : stage === "denied" ? (
              <div className="kiosk-state">
                <ShieldCheck size={38} />
                <h2>Not Eligible</h2>
                <p>{statusMessage || "This student is not eligible for this election."}</p>
                <button type="button" onClick={() => finishKiosk()} className="primary-btn">
                  Finish
                </button>
              </div>
            ) : stage === "success" ? (
              <div className="kiosk-state">
                <CheckCircle2 size={44} />
                <h2>Vote Submitted</h2>
                <p>Your ballot has been successfully recorded.</p>
                <div className="kiosk-success-actions">
                  <button
                    type="button"
                    onClick={() => setShowReceipt((current) => !current)}
                    className="secondary-btn"
                  >
                    <ReceiptText size={18} />
                    {showReceipt ? "Hide Receipt" : "View Receipt"}
                  </button>
                  <button type="button" onClick={() => finishKiosk()} className="primary-btn">
                    <RotateCcw size={18} />
                    Finish
                  </button>
                </div>
                {showReceipt && receipt ? (
                  <div className="kiosk-receipt">
                    <div>
                      <span>Voter</span>
                      <strong>{receipt.studentName}</strong>
                    </div>
                    <div>
                      <span>Submitted</span>
                      <strong>{formatLocalDateTime(receipt.submittedAt)}</strong>
                    </div>
                    {receipt.selections.map((row) => (
                      <div key={row.position}>
                        <span>{row.position}</span>
                        <strong>{row.selection}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : stage === "review" ? (
              <div className="kiosk-review">
                <p className="chart-eyebrow">Review Ballot</p>
                <h2>Confirm selections</h2>
                <div className="kiosk-review-list">
                  {positions.map((position) => (
                    <div key={position.id}>
                      <span>{position.name}</span>
                      <strong>{selectedCandidateNames(position)}</strong>
                    </div>
                  ))}
                </div>
                {statusMessage ? <p className={`kiosk-feedback ${statusTone}`}>{statusMessage}</p> : null}
                <div className="kiosk-actions">
                  <button type="button" onClick={() => setStage("ballot")} className="secondary-btn">
                    Back to Ballot
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleSubmitBallot}
                    className="primary-btn disabled:opacity-60"
                  >
                    {submitting ? "Submitting..." : "Submit Vote"}
                  </button>
                </div>
              </div>
            ) : stage === "ballot" && verifiedStudent ? (
              <div className="kiosk-ballot">
                <div className="kiosk-ballot-head">
                  <div>
                    <p className="chart-eyebrow">Official Ballot</p>
                    <h2>{selectedElection.title}</h2>
                  </div>
                  <span>{studentName(verifiedStudent)}</span>
                </div>

                {positions.length === 0 ? (
                  <div className="empty-state">No ballot positions found for this election.</div>
                ) : (
                  <div className="kiosk-position-list">
                    {positions.map((position) => {
                      const positionCandidates = candidates.filter(
                        (candidate) => candidate.position_id === position.id,
                      );

                      return (
                        <section key={position.id} className="kiosk-position">
                          <div>
                            <h3>{position.name}</h3>
                            <p>
                              {Number(position.max_votes || 1) > 1
                                ? `Choose up to ${position.max_votes} candidates or abstain.`
                                : "Vote for one candidate or abstain."}
                            </p>
                          </div>

                          <div className="kiosk-choice-list">
                            {positionCandidates.map((candidate) => {
                              const currentVote = selectedVotes[position.id];
                              const maxVotes = Math.max(Number(position.max_votes || 1), 1);
                              const selectedIds = currentVote?.candidate_ids || (
                                currentVote?.candidate_id ? [currentVote.candidate_id] : []
                              );
                              const selected = selectedIds.includes(candidate.id);
                              const limitReached = selectedIds.length >= maxVotes;
                              const deEmphasized =
                                !selected &&
                                Boolean(currentVote) &&
                                ((maxVotes === 1 && selectedIds.length > 0) ||
                                  (maxVotes > 1 && limitReached) ||
                                  currentVote?.is_abstain);

                              return (
                                <button
                                  key={candidate.id}
                                  type="button"
                                  onClick={() => handleSelect(position, candidate.id)}
                                  className={`ballot-choice ${selected ? "ballot-choice-active" : ""} ${
                                    deEmphasized ? "ballot-choice-muted" : ""
                                  }`}
                                  aria-pressed={selected}
                                >
                                  <div className="ballot-oval" aria-hidden="true">
                                    <span />
                                  </div>
                                  <KandidImage
                                    src={candidate.photo || candidate.students?.photo_url}
                                    alt={candidateName(candidate)}
                                    label={candidateName(candidate)}
                                    className="h-11 w-11 shrink-0 rounded-full object-cover"
                                    fit="cover"
                                  />
                                  <span>
                                    <strong>{candidateName(candidate)}</strong>
                                    <small>{candidate.partylists?.name || "Independent"}</small>
                                  </span>
                                </button>
                              );
                            })}

                            <button
                              type="button"
                              onClick={() => handleAbstain(position)}
                              className={`ballot-choice ${
                                selectedVotes[position.id]?.is_abstain
                                  ? "ballot-choice-active"
                                  : selectedVotes[position.id]
                                    ? "ballot-choice-muted"
                                    : ""
                              }`}
                              aria-pressed={Boolean(selectedVotes[position.id]?.is_abstain)}
                            >
                              <div className="ballot-oval" aria-hidden="true">
                                <span />
                              </div>
                              <span>
                                <strong>Abstain</strong>
                                <small>No candidate selected for this position</small>
                              </span>
                            </button>
                          </div>
                        </section>
                      );
                    })}
                  </div>
                )}

                {statusMessage ? <p className={`kiosk-feedback ${statusTone}`}>{statusMessage}</p> : null}
                <div className="kiosk-actions">
                  <button type="button" onClick={() => finishKiosk("Kiosk session cleared.")} className="secondary-btn">
                    Clear Session
                  </button>
                  <button type="button" onClick={openReview} className="primary-btn">
                    Review Ballot
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleVerifyStudent} className="kiosk-login">
                <div className="kiosk-login-title">
                  <OrganizationLogo organization={selectedElection.organizations} className="kiosk-login-logo" />
                  <p>KANDID KIOSK</p>
                  <h2>Student Verification</h2>
                  <span>
                    {selectedElection.title} - {selectedElection.organizations?.name || "Organization"}
                  </span>
                </div>

                <label>
                  <span>Student ID</span>
                  <input
                    value={studentNumber}
                    onChange={(event) => setStudentNumber(event.target.value)}
                    placeholder="Enter student ID"
                    autoComplete="off"
                    required
                  />
                </label>

                <label>
                  <span>Password</span>
                  <div className="kiosk-password">
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </label>

                {statusMessage ? <p className={`kiosk-feedback ${statusTone}`}>{statusMessage}</p> : null}

                <button type="submit" disabled={verifying} className="primary-btn">
                  {verifying ? "Authenticating..." : "Continue to Ballot"}
                </button>
                {hasMultipleSessions ? (
                  <button type="button" onClick={changeKioskSession} className="kiosk-subtle-action">
                    Back to voting sessions
                  </button>
                ) : null}
              </form>
            )}
          </section>
        </section>
      )}
    </main>
  );
}

export default KioskVoting;
