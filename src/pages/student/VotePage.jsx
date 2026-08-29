import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CheckCircle2,
  LockKeyhole,
  MapPin,
  QrCode,
  ShieldCheck,
  Vote,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { formatLocalDateTime, getElectionPhase } from "../../utils/elections";
import {
  distanceBetweenMeters,
  doesTokenMatchStudent,
  getVotingAccessModeLabel,
  isTokenExpired,
} from "../../utils/votingAccess";
import { hasStudentVotedInElection, submitBallot } from "../../utils/voting";
import { getStudentElectionOrganizationIds } from "../../utils/organizationAccess";
import { usePrompt } from "../../context/PromptContext";

function StudentVotePage() {
  const { electionId } = useParams();
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user"));
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
  const [accessMessage, setAccessMessage] = useState("");
  const [verifyingAccess, setVerifyingAccess] = useState(false);
  const [alreadyVoted, setAlreadyVoted] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadBallot() {
      setLoading(true);
      setAccessDenied(false);

      const [
        { data: electionData },
        { data: studentData },
        { data: positionData },
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
              voting_access_mode,
              geo_lat,
              geo_lng,
              geo_radius_meters,
              location_label,
              organizations(name)
            `)
            .eq("id", electionId)
            .single(),
          supabase
            .from("students")
            .select("id, student_number, first_name, last_name, program, precinct_code, batch_code")
            .eq("id", user.id)
            .single(),
          supabase
            .from("positions")
            .select("id, name, election_id, max_votes")
            .eq("election_id", electionId)
            .order("id", { ascending: true }),
          hasStudentVotedInElection(user.id, electionId),
        ]);

      if (!active) return;

      const eligibleOrganizationIds = await getStudentElectionOrganizationIds(
        studentData || user,
      );

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

      if (positionData?.length) {
        setPositions(positionData);
        const { data: candData } = await supabase
          .from("candidates")
          .select(`
            id,
            election_id,
            position_id,
            student_id,
            partylist_id,
            photo,
            credentials,
            bio,
            platform,
            students(first_name, last_name),
            partylists(name, logo_url)
          `)
          .eq("election_id", electionId);

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

    loadBallot();

    return () => {
      active = false;
    };
  }, [electionId, user.id]);

  function handleSelect(position, candidateId) {
    setSelectedVotes({
      ...selectedVotes,
      [position.id]: {
        position_id: position.id,
        candidate_id: candidateId,
        is_abstain: false,
      },
    });
  }

  function handleAbstain(position) {
    setSelectedVotes({
      ...selectedVotes,
      [position.id]: {
        position_id: position.id,
        candidate_id: null,
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

    const { data, error } = await supabase
      .from("election_access_tokens")
      .select("id, election_id, token, is_active, scope_type, scope_value, expires_at")
      .eq("election_id", Number(electionId))
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

    if (isTokenExpired(data)) {
      setAccessMessage("This access code has already expired.");
      setVerifyingAccess(false);
      return;
    }

    if (!doesTokenMatchStudent(data, studentProfile)) {
      setAccessMessage(
        "This QR access code is not assigned to your precinct or batch.",
      );
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

    if (
      election.geo_lat == null ||
      election.geo_lng == null ||
      election.geo_radius_meters == null
    ) {
      setAccessMessage("This election does not have a valid location range yet.");
      return;
    }

    setVerifyingAccess(true);
    setAccessMessage("Checking your location...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const distance = distanceBetweenMeters(
          Number(position.coords.latitude),
          Number(position.coords.longitude),
          Number(election.geo_lat),
          Number(election.geo_lng),
        );

        if (distance <= Number(election.geo_radius_meters)) {
          setAccessGranted(true);
          setAccessMessage(
            `Access granted. You are within ${Math.round(distance)} meters of the voting area.`,
          );
        } else {
          setAccessMessage(
            `You are outside the allowed voting range. Current distance: ${Math.round(distance)} meters.`,
          );
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

    const ok = await prompt.confirm({
      title: "Submit Ballot?",
      message: "Are you ready to submit your official ballot? Once submitted, your vote is cryptographically secured and cannot be altered or re-cast.",
      type: "primary",
      confirmText: "Submit Official Vote",
    });

    if (!ok) return;

    setSubmitting(true);
    const { error, alreadyVoted: voteLocked } = await submitBallot({
      studentId: user.id,
      electionId,
      selectedVotes,
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

    prompt.success("Vote submitted and verified successfully!");
    navigate("/student/receipt");
  }

  const completedSelections = Object.keys(selectedVotes).length;
  const accessMode = election?.voting_access_mode || "anywhere";

  if (loading) {
    return <div className="glass-panel rounded-[28px] p-8 text-gray-500">Loading ballot...</div>;
  }

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

  const phase = getElectionPhase(election);

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
                    Maximum range: {election.geo_radius_meters || 0} meters.
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
    <div>
      <div className="section-grid mt-0 grid-cols-1 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="soft-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="secure-badge">
                <ShieldCheck size={14} />
                Secure Ballot
              </div>
              <p className="mt-4 text-sm font-bold uppercase tracking-[0.18em] text-[#d35a25]">
                {election.organizations?.name}
              </p>
              <h1 className="mt-2 text-3xl font-black">{election.title}</h1>
            </div>
            <div className="hidden h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(232,108,47,0.12)] text-[#d35a25] sm:flex">
              <Vote size={24} />
            </div>
          </div>

          <p className="mt-4 text-gray-500">
            Select your preferred candidate for each position. Every submitted
            ballot generates a receipt with a verification hash.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="info-row !block">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                Positions
              </p>
              <p className="mt-2 text-2xl font-black text-[#1d262f]">{positions.length}</p>
            </div>
            <div className="info-row !block">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                Selected
              </p>
              <p className="mt-2 text-2xl font-black text-[#1d262f]">{completedSelections}</p>
            </div>
            <div className="info-row !block">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                Voting Ends
              </p>
              <p className="mt-2 text-sm font-bold text-[#1d262f]">
                {formatLocalDateTime(election.end_date)}
              </p>
            </div>
          </div>
        </div>

        <div className="trust-card">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-white/10 p-3 text-[#9ce7dd]">
              <LockKeyhole size={22} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                Voting Safety
              </p>
              <h2 className="mt-1 text-2xl font-black">Protected ballot flow</h2>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {[
              "One complete selection is required for every position before submission.",
              "Submitted votes cannot be edited after confirmation.",
              "A receipt page stores your verification hash after a successful ballot.",
            ].map((item) => (
              <div key={item} className="flex gap-3 rounded-2xl bg-white/7 px-4 py-3">
                <CheckCircle2 size={18} className="mt-0.5 text-[#9ce7dd]" />
                <p className="text-sm leading-6 text-white/72">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 space-y-6">
        {positions.length === 0 ? (
          <div className="empty-state">
            No positions found for this election.
          </div>
        ) : (
          positions.map((position) => {
            const positionCandidates = candidates.filter(
              (candidate) => candidate.position_id === position.id
            );

            return (
              <div key={position.id} className="soft-card">
                <h2 className="text-xl font-black">{position.name}</h2>
                <p className="mb-4 text-sm text-gray-500">
                  Choose one candidate or abstain.
                </p>

                <div className="grid gap-4 xl:grid-cols-2">
                  {positionCandidates.map((candidate) => {
                    const selected =
                      selectedVotes[position.id]?.candidate_id === candidate.id;

                    return (
                      <button
                        key={candidate.id}
                        onClick={() => handleSelect(position, candidate.id)}
                        className={`ballot-choice ${
                          selected
                            ? "ballot-choice-active"
                            : "hover:bg-white"
                        }`}
                      >
                        <p className="font-black">
                          {candidate.students?.first_name} {candidate.students?.last_name}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                          {candidate.partylists?.logo_url ? (
                            <img
                              src={candidate.partylists.logo_url}
                              alt={`${candidate.partylists.name} logo`}
                              className="h-6 w-6 rounded-lg object-cover"
                            />
                          ) : null}
                          <span>{candidate.partylists?.name || "Independent"}</span>
                        </div>
                        {candidate.credentials || candidate.bio ? (
                          <p className="mt-2 text-sm text-gray-600">
                            {candidate.credentials || candidate.bio}
                          </p>
                        ) : null}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => handleAbstain(position)}
                    className={`ballot-choice ${
                      selectedVotes[position.id]?.is_abstain
                        ? "border-[#1d262f] bg-[rgba(29,38,47,0.08)]"
                        : "hover:bg-white"
                    }`}
                  >
                    <p className="font-black">Abstain</p>
                    <p className="text-xs text-gray-500">
                      I choose not to vote for this position.
                    </p>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {positions.length > 0 && (
        <div className="mt-8 flex justify-end">
          <button
            disabled={submitting}
            onClick={handleSubmitVotes}
            className="primary-btn px-8 py-4 disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit Ballot"}
          </button>
        </div>
      )}
    </div>
  );
}

export default StudentVotePage;
