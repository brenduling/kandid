import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Check,
  CheckCircle2,
  LockKeyhole,
  MapPin,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { formatLocalDateTime, getElectionPhase } from "../../utils/elections";
import {
  getVotingAccessModeLabel,
} from "../../utils/votingAccess";
import { callVoteAccess, verifyStudentElectionAccessCode } from "../../utils/voteAccess";
import { hasStudentVotedInElection, submitBallot } from "../../utils/voting";
import { getStudentElectionOrganizationIds } from "../../utils/organizationAccess";
import { usePrompt } from "../../context/PromptContext";
import KandidImage from "../../components/KandidImage";
import { fetchOrderedPositions } from "../../utils/positionOrder";
import { getCurrentStudentProfile } from "../../utils/auth";
import { studentElectionFailure } from "../../utils/studentElectionAccess";
import { loadStudentBallotCandidates } from "../../utils/studentBallotReadiness";
import { useElectionClock } from "../../utils/useElectionClock";
import "./VotePage.css";

function StudentVotePage() {
  const { electionId } = useParams();
  const navigate = useNavigate();
  const userId = JSON.parse(localStorage.getItem("user"))?.id;
  const prompt = usePrompt();

  const [election, setElection] = useState(null);
  const [studentProfile, setStudentProfile] = useState(null);
  const [positions, setPositions] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selectedVotes, setSelectedVotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [accessGranted, setAccessGranted] = useState(false);
  const [verifiedLocation, setVerifiedLocation] = useState(null);
  const [accessMessage, setAccessMessage] = useState("");
  const [candidateError, setCandidateError] = useState("");
  const [verifyingAccess, setVerifyingAccess] = useState(false);
  const [alreadyVoted, setAlreadyVoted] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const now = useElectionClock();

  useEffect(() => {
    let active = true;

    async function loadBallot() {
      setLoading(true);
      setAccessDenied(false);
      setCandidateError("");
      setLoadError("");
      setCandidates([]);
      setPositions([]);
      setSelectedVotes({});
      setAlreadyVoted(false);

      const [
        { data: electionData, error: electionError },
        { data: studentData, error: studentError },
        { data: positionData, error: positionError },
        voteCheck,
      ] =
        await Promise.all([
          supabase
            .from("elections")
            .select(`
              id,
              title,
              organization_id,
              campaign_start,
              campaign_end,
              start_date,
              end_date,
              status,
              electorate_policy_version,
              electorate_frozen_at,
              voting_access_mode,
              location_label,
              organizations(name)
            `)
            .eq("id", electionId)
            .single(),
          getCurrentStudentProfile(),
          fetchOrderedPositions(supabase, electionId, { activeOnly: true }),
          hasStudentVotedInElection(userId, electionId),
        ]);

      if (!active) return;
      if (electionError || studentError || positionError || voteCheck?.error) {
        throw electionError || studentError || positionError || voteCheck.error;
      }

      const eligibleOrganizationIds = await getStudentElectionOrganizationIds(
        studentData || { id: userId },
      );
      if (!active) return;

      if (!eligibleOrganizationIds.includes(electionData?.organization_id)) {
        setElection(null);
        setStudentProfile(studentData);
        setPositions([]);
        setCandidates([]);
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      setElection(electionData);
      setStudentProfile(studentData);
      setAlreadyVoted(Boolean(voteCheck?.hasVoted));

      if (positionData?.length && !voteCheck?.hasVoted) {
        setPositions(positionData);
        const { data: candData, error: candidateLoadError } = await loadStudentBallotCandidates(supabase, electionData);

        if (candidateLoadError) {
          if (active) {
            setCandidateError(
              candidateLoadError.message || "Unable to load ballot candidates."
            );
          }
        }

        if (active) {
          setCandidates(candData || []);
        }
      }

      if (electionData?.voting_access_mode === "anywhere") {
        setAccessGranted(true);
        setAccessMessage("Voting access is open anywhere for this election.");
      } else {
        setAccessGranted(false);
        setAccessMessage("");
      }
      setLoading(false);
    }

    loadBallot().catch(error => {
      if (active) {
        setLoadError(studentElectionFailure(error).message);
        setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [electionId, userId, reloadKey]);

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
    setSelectedVotes({
      ...selectedVotes,
      [position.id]: {
        position_id: position.id,
        candidate_id: null,
        candidate_ids: [],
        is_abstain: true,
      },
    });
  }

  async function handleVerifyAccessCode() {
    const normalizedCode = accessCode.trim().toUpperCase();
    if (!normalizedCode) {
      setAccessMessage("Enter the QR access code provided by your election officer.");
      return;
    }

    setVerifyingAccess(true);
    setAccessMessage("");

    const { data, error } = await verifyStudentElectionAccessCode({
      electionId,
      token: normalizedCode,
    });

    if (error) {
      setAccessMessage(error.message || "Failed to validate access code.");
      setVerifyingAccess(false);
      return;
    }

    if (!data?.granted) {
      if (data?.reason === "expired") {
        setAccessMessage("This access code has already expired.");
        setVerifyingAccess(false);
        return;
      }
      if (data?.reason === "scope_mismatch") {
        setAccessMessage("This QR access code is not assigned to your precinct or batch.");
        setVerifyingAccess(false);
        return;
      }
      setAccessMessage("This access code is invalid or inactive.");
      setVerifyingAccess(false);
      return;
    }

    setAccessGranted(true);
    setAccessMessage("Access granted. You can now continue to the ballot.");
    setVerifyingAccess(false);
  }

  function handleVerifyLocation() {
    if (!navigator.geolocation) {
      setAccessMessage("This device does not support location verification.");
      return;
    }

    setVerifyingAccess(true);
    setAccessMessage("Checking your location...");

    navigator.geolocation.getCurrentPosition(async (position) => {
      const coordinates = {
        latitude: Number(position.coords.latitude),
        longitude: Number(position.coords.longitude),
      };
      const { data, error } = await callVoteAccess("student_verify_geofence", {
        election_id: Number(electionId),
        coordinates,
      });
      if (error) {
        setAccessGranted(false);
        setVerifiedLocation(null);
        setAccessMessage("Location could not be verified. Please try again.");
      } else if (data?.granted) {
        setAccessGranted(true);
        setVerifiedLocation(coordinates);
        setAccessMessage("Location verified for this election.");
      } else {
        setAccessGranted(false);
        setVerifiedLocation(null);
        setAccessMessage("You are outside the approved voting area or are not eligible for this election.");
      }
      setVerifyingAccess(false);
      },
      (error) => {
        setAccessMessage(
          error.message || "Unable to get your current location.",
        );
        setVerifyingAccess(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  }

  async function handleSubmitVotes() {
    if (candidateError) {
      await prompt.alert({
        title: "Candidates Not Loaded",
        message: "The ballot candidate list could not be loaded. Please retry before submitting.",
        type: "error",
      });
      return;
    }

    const missingPosition = positions.find(
      (position) => !selectedVotes[position.id]
    );

    if (missingPosition) {
      await prompt.alert({
        title: "Incomplete Ballot",
        message: `Please select a vote or abstain for ${missingPosition.name}.`,
        type: "warning",
      });
      return;
    }

    const reviewLines = positions.map((position) => {
      const vote = selectedVotes[position.id];
      const candidateIds = vote?.candidate_ids || (vote?.candidate_id ? [vote.candidate_id] : []);
      const candidateName = vote?.is_abstain
        ? "Abstain"
        : candidateIds
            .map((candidateId) => {
              const candidate = candidates.find((item) => item.id === candidateId);
              return candidate
                ? `${candidate.students?.first_name || ""} ${candidate.students?.last_name || ""}`.trim()
                : "";
            })
            .filter(Boolean)
            .join(", ");

      return (
        <span className="student-ballot-review-row" role="listitem" key={position.id}>
          <span className="student-ballot-review-position">{position.name}</span>
          <span className="student-ballot-review-choice">{candidateName || "Abstain"}</span>
        </span>
      );
    });

    const ok = await prompt.confirm({
      title: "Review Your Ballot",
      eyebrow: "Official ballot / Final review",
      variant: "editorial",
      message: (
        <span className="student-ballot-review">
          <span>Check your selections carefully before submitting your vote.</span>
          <span className="student-ballot-review-list" role="list" aria-label="Your selections">
            {reviewLines}
          </span>
          <span className="student-ballot-review-notice">
            <LockKeyhole size={18} aria-hidden="true" />
            <span>Once submitted, your ballot cannot be changed. You can vote only once in this election.</span>
          </span>
          <span className="student-ballot-review-receipt">
            You will receive a receipt after your vote is recorded. Blockchain verification may still be pending.
          </span>
        </span>
      ),
      type: "primary",
      cancelText: "Change Selection",
      confirmText: "Submit My Vote",
    });

    if (!ok) return;

    setSubmitting(true);
    const { error, alreadyVoted: voteLocked } = await submitBallot({
      electionId,
      selectedVotes,
      accessCode,
      location: verifiedLocation,
    });

    if (error) {
      if (voteLocked) {
        setAlreadyVoted(true);
      }
      await prompt.alert({
        title: "Submission Error",
        message: error.message || "Failed to submit vote. Please try again.",
        type: "error",
      });
      setSubmitting(false);
      return;
    }

    prompt.success("Your vote is recorded. Blockchain verification may still be processing.");
    navigate("/student/receipt");
  }

  const completedSelections = Object.keys(selectedVotes).length;
  const accessMode = election?.voting_access_mode || "anywhere";

  if (loading) {
    return <div className="glass-panel rounded-[28px] p-8 text-gray-500">Loading ballot...</div>;
  }

  if (loadError) return (
    <div className="soft-card" role="alert">
      <h1>Unable to load ballot</h1>
      <p>{loadError}</p>
      <button type="button" className="student-outline-btn" onClick={() => setReloadKey(value => value + 1)}>Retry</button>
      <button type="button" className="student-outline-btn" onClick={() => navigate("/student/elections")}>Back to Elections</button>
    </div>
  );

  if (accessDenied) {
    return (
      <div className="empty-state font-bold text-red-600">
        This ballot is not available for your organization.
      </div>
    );
  }

  if (!election) {
    return <div className="empty-state font-bold text-red-600">Election not found.</div>;
  }

  const phase = getElectionPhase(election, now);

  if (phase !== "voting") {
    return (
      <div className="soft-card">
        <h1 className="text-2xl font-black">Voting not available</h1>
        <p className="mt-2 text-gray-500">
          This election is currently in the <span className="font-bold">{phase}</span>{" "}
          phase.
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Voting starts: {formatLocalDateTime(election.start_date)}
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => navigate("/student/elections")}
            className="secondary-btn"
          >
            Back to Elections
          </button>
          {phase === "campaign" ? (
            <button
              onClick={() =>
                navigate(`/student/elections/${election.id}/campaign`)
              }
              className="primary-btn"
            >
              Open Campaign Module
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (alreadyVoted) {
    return (
      <div className="soft-card">
        <h1 className="text-2xl font-black">Vote already recorded</h1>
        <p className="mt-2 text-gray-500">
          This election already has a submitted ballot linked to your student account.
          Mobile and kiosk voting use the same verification record, so a second ballot is blocked automatically.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => navigate("/student/elections")}
            className="secondary-btn"
          >
            Back to Elections
          </button>
          <button
            onClick={() => navigate("/student/receipt")}
            className="primary-btn"
          >
            Open Receipts
          </button>
        </div>
      </div>
    );
  }

  if (candidateError) return (
    <div className="soft-card" role="alert">
      <h1 className="text-2xl font-black">Ballot unavailable</h1>
      <p className="mt-2 text-gray-500">{candidateError}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className="student-outline-btn" onClick={() => setReloadKey(value => value + 1)}>Retry</button>
        <button type="button" className="student-outline-btn" onClick={() => navigate("/student/elections")}>Back to Elections</button>
      </div>
    </div>
  );

  if (!accessGranted) {
    return (
      <div className="section-grid mt-0 grid-cols-1 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="soft-card">
          <div className="secure-badge">
            <ShieldCheck size={14} />
            Ballot Access Control
          </div>
          <p className="mt-4 text-sm font-bold uppercase tracking-[0.18em] text-[#d35a25]">
            {election.organizations?.name}
          </p>
          <h1 className="mt-2 text-3xl font-black">{election.title}</h1>
          <p className="mt-4 text-gray-500">
            This ballot uses a controlled voting access rule. Verify your access
            before the ballot opens on this device.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="info-row !block">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                Access Mode
              </p>
              <p className="mt-2 text-sm font-black text-[#1d262f]">
                {getVotingAccessModeLabel(accessMode)}
              </p>
            </div>
            <div className="info-row !block">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                Precinct
              </p>
              <p className="mt-2 text-sm font-black text-[#1d262f]">
                {studentProfile?.precinct_code || "Not assigned"}
              </p>
            </div>
            <div className="info-row !block">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                Batch
              </p>
              <p className="mt-2 text-sm font-black text-[#1d262f]">
                {studentProfile?.batch_code || "Not assigned"}
              </p>
            </div>
          </div>

          {accessMode === "location_range" ? (
            <div className="mt-6 rounded-3xl border border-[rgba(24,54,49,0.08)] bg-[rgba(255,255,255,0.78)] p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-[rgba(17,128,106,0.12)] p-3 text-[#11806a]">
                  <MapPin size={20} />
                </div>
                <div>
                  <p className="text-sm font-black text-[#102220]">
                    Location-based voting
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    {election.location_label
                      ? `Allowed area: ${election.location_label}.`
                      : "This election only allows voting inside the approved area."}{" "}
                    Your location is checked securely by the voting service.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleVerifyLocation}
                disabled={verifyingAccess}
                className="primary-btn mt-5"
              >
                {verifyingAccess ? "Verifying location..." : "Verify My Location"}
              </button>
            </div>
          ) : (
            <div className="mt-6 rounded-3xl border border-[rgba(24,54,49,0.08)] bg-[rgba(255,255,255,0.78)] p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-[rgba(17,128,106,0.12)] p-3 text-[#11806a]">
                  <QrCode size={20} />
                </div>
                <div>
                  <p className="text-sm font-black text-[#102220]">
                    QR or access code required
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    Enter the code from your election officer or precinct QR
                    gate. The system will match it against your assigned
                    student record.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <input
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value.toUpperCase())}
                  placeholder="Enter access code"
                  className="field-shell w-full"
                />
                <button
                  type="button"
                  onClick={handleVerifyAccessCode}
                  disabled={verifyingAccess}
                  className="primary-btn min-w-[180px] justify-center"
                >
                  {verifyingAccess ? "Checking..." : "Unlock Ballot"}
                </button>
              </div>
            </div>
          )}

          {accessMessage ? (
            <div
              className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                accessGranted
                  ? "bg-[rgba(17,128,106,0.12)] text-[#0f6a57]"
                  : "bg-[rgba(211,90,37,0.12)] text-[#b54d1f]"
              }`}
            >
              {accessMessage}
            </div>
          ) : null}

          <button
            onClick={() => navigate("/student/elections")}
            className="secondary-btn mt-5"
          >
            Back to Elections
          </button>
        </div>

        <div className="trust-card">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-white/10 p-3 text-[#9ce7dd]">
              <LockKeyhole size={22} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                Controlled Entry
              </p>
              <h2 className="mt-1 text-2xl font-black">Election access rules</h2>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {[
              "Anywhere mode opens the ballot immediately without extra checks.",
              "QR modes can be scoped to a general code, a precinct, or a batch token.",
              "Location mode uses your device position and the approved voting radius.",
            ].map((item) => (
              <div key={item} className="flex gap-3 rounded-2xl bg-white/7 px-4 py-3">
                <CheckCircle2 size={18} className="mt-0.5 text-[#9ce7dd]" />
                <p className="text-sm leading-6 text-white/72">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="student-ballot">
      <header className="student-ballot-header">
        <p className="student-ballot-eyebrow">KANDID / STUDENT / OFFICIAL BALLOT</p>
        <h1>Cast Your Vote</h1>
        <p className="student-ballot-intro">
          Choose your candidate for each position. Review your selections before submitting.
        </p>
        <div className="student-ballot-election">
          <span>{election.organizations?.name}</span>
          <strong>{election.title}</strong>
        </div>
        <dl className="student-ballot-meta">
          <div>
            <dt>Your progress</dt>
            <dd aria-live="polite">{completedSelections} of {positions.length} positions selected</dd>
          </div>
          <div>
            <dt>Voting closes</dt>
            <dd>{formatLocalDateTime(election.end_date)}</dd>
          </div>
        </dl>
      </header>

      {positions.length === 0 ? (
        <div className="empty-state mt-8">
          No positions found for this election.
        </div>
      ) : (
        <div className="student-ballot-paper">
          <div className="student-ballot-paper-heading">
            <p className="student-ballot-eyebrow">Your ballot</p>
            <p>Select a candidate or choose to abstain for every position.</p>
          </div>
          <div className="student-ballot-positions">
            {positions.map((position, positionIndex) => {
            const positionCandidates = candidates.filter(
              (candidate) => candidate.position_id === position.id
            );

            return (
              <section key={position.id} className="student-ballot-position" aria-labelledby={`ballot-position-${position.id}`}>
                <div className="student-ballot-position-heading">
                  <span className="student-ballot-position-number" aria-hidden="true">{String(positionIndex + 1).padStart(2, "0")}</span>
                  <div>
                    <h2 id={`ballot-position-${position.id}`}>{position.name}</h2>
                    <p>
                  {Number(position.max_votes || 1) > 1
                    ? `Choose up to ${position.max_votes} candidates or abstain.`
                    : "Choose one candidate or abstain."}
                    </p>
                  </div>
                </div>

                <div className="student-ballot-choices" role="group" aria-labelledby={`ballot-position-${position.id}`}>
                  {candidateError ? (
                    <div className="student-ballot-empty" role="alert">
                      Candidate records could not be loaded for this position.
                    </div>
                  ) : positionCandidates.length === 0 ? (
                    <div className="student-ballot-empty">
                      No candidates have been added for this position.
                    </div>
                  ) : (
                    positionCandidates.map((candidate) => {
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
                        type="button"
                        key={candidate.id}
                        onClick={() => handleSelect(position, candidate.id)}
                        className={`ballot-choice ${selected ? "ballot-choice-active" : ""} ${
                          deEmphasized ? "ballot-choice-muted" : ""
                        }`}
                        aria-pressed={selected}
                      >
                        <span className="student-ballot-mark" aria-hidden="true">
                          {selected ? <Check size={16} strokeWidth={3} /> : null}
                        </span>
                        <span className="student-ballot-candidate">
                          <KandidImage
                            src={candidate.photo || candidate.students?.photo_url}
                            alt={`${candidate.students?.first_name || ""} ${candidate.students?.last_name || ""}`.trim() || "Candidate"}
                            label={`${candidate.students?.first_name || ""} ${candidate.students?.last_name || ""}`.trim() || "Candidate"}
                            className="student-ballot-portrait"
                            fit="cover"
                          />
                          <span className="student-ballot-candidate-copy">
                            <span className="student-ballot-candidate-name">
                              {candidate.students?.first_name} {candidate.students?.last_name}
                            </span>
                            <span className="student-ballot-party">
                              <span>{candidate.partylists?.name || "Independent"}</span>
                            </span>
                            <span className="student-ballot-choice-state">{selected ? "Selected" : "Select candidate"}</span>
                          </span>
                        </span>
                      </button>
                    );
                    })
                  )}

                  {!candidateError ? (
                    <button
                      type="button"
                      onClick={() => handleAbstain(position)}
                      className={`ballot-choice student-ballot-abstain ${
                        selectedVotes[position.id]?.is_abstain
                          ? "ballot-choice-active"
                          : selectedVotes[position.id]
                          ? "ballot-choice-muted"
                          : ""
                      }`}
                      aria-pressed={Boolean(selectedVotes[position.id]?.is_abstain)}
                    >
                      <span className="student-ballot-mark" aria-hidden="true">
                        {selectedVotes[position.id]?.is_abstain ? <Check size={16} strokeWidth={3} /> : null}
                      </span>
                      <span className="student-ballot-candidate-copy">
                        <span className="student-ballot-candidate-name">Abstain</span>
                        <span className="student-ballot-party">Do not cast a vote for this position.</span>
                        <span className="student-ballot-choice-state">{selectedVotes[position.id]?.is_abstain ? "Selected" : "Choose to abstain"}</span>
                      </span>
                    </button>
                  ) : null}
                </div>
              </section>
            );
            })}
          </div>
        </div>
      )}

      {positions.length > 0 && (
        <div className="student-ballot-actions">
          <p>You can change your selections before submitting.</p>
          <button
            disabled={submitting || Boolean(candidateError)}
            onClick={handleSubmitVotes}
            className="student-ballot-review-button"
          >
            {submitting ? "Submitting..." : "Review Ballot"}
          </button>
        </div>
      )}
    </div>
  );
}

export default StudentVotePage;
