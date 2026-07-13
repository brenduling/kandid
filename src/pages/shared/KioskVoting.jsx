import { useEffect, useState } from "react";
import {
  CheckCircle2,
  MonitorSmartphone,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { formatLocalDateTime, getElectionPhase } from "../../utils/elections";
import { hasStudentVotedInElection, submitBallot } from "../../utils/voting";

function KioskVoting() {
  const user = JSON.parse(localStorage.getItem("user"));
  const [nowTick, setNowTick] = useState(0);
  const [elections, setElections] = useState([]);
  const [selectedElectionId, setSelectedElectionId] = useState("");
  const [selectedElection, setSelectedElection] = useState(null);
  const [positions, setPositions] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selectedVotes, setSelectedVotes] = useState({});
  const [studentNumber, setStudentNumber] = useState("");
  const [password, setPassword] = useState("");
  const [verifiedStudent, setVerifiedStudent] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState("neutral");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTick((value) => value + 1);
    }, 30000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadKioskElections() {
      setLoading(true);

      let query = supabase
        .from("elections")
        .select("*, organizations(name)")
        .neq("status", "archived")
        .order("start_date", { ascending: true });

      if (user?.role === "electoral_board" && user?.organization_id) {
        query = query.eq("organization_id", user.organization_id);
      }

      const { data, error } = await query;

      if (!active) return;

      if (error) {
        setStatusTone("error");
        setStatusMessage(error.message);
        setElections([]);
        setLoading(false);
        return;
      }

      const activeElections = (data || []).filter(
        (election) => getElectionPhase(election, new Date()) === "voting",
      );

      setElections(activeElections);

      if (activeElections.length === 1) {
        setSelectedElectionId(String(activeElections[0].id));
      }

      setLoading(false);
    }

    loadKioskElections();

    return () => {
      active = false;
    };
  }, [user?.organization_id, user?.role]);

  useEffect(() => {
    let active = true;

    async function loadSelectedElectionBallot() {
      if (!selectedElectionId) {
        setSelectedElection(null);
        setPositions([]);
        setCandidates([]);
        return;
      }

      const [{ data: electionData }, { data: positionData }] = await Promise.all([
        supabase
          .from("elections")
          .select("*, organizations(name)")
          .eq("id", Number(selectedElectionId))
          .single(),
        supabase
          .from("positions")
          .select("*")
          .eq("election_id", Number(selectedElectionId))
          .order("id", { ascending: true }),
      ]);

      const positionIds = positionData?.map((position) => position.id) || [];
      let candidateData = [];

      if (positionIds.length > 0) {
        const { data } = await supabase
          .from("candidates")
          .select(`
            *,
            students(first_name, last_name, student_number),
            partylists(name, logo_url)
          `)
          .in("position_id", positionIds);

        candidateData = data || [];
      }

      if (!active) return;

      setSelectedElection(electionData);
      setPositions(positionData || []);
      setCandidates(candidateData);
      setSelectedVotes({});
      setVerifiedStudent(null);
      setStudentNumber("");
      setPassword("");
      setStatusMessage("");
      setStatusTone("neutral");
    }

    loadSelectedElectionBallot();

    return () => {
      active = false;
    };
  }, [selectedElectionId]);

  function setFeedback(message, tone = "neutral") {
    setStatusMessage(message);
    setStatusTone(tone);
  }

  function handleSelect(position, candidateId) {
    setSelectedVotes((current) => ({
      ...current,
      [position.id]: {
        position_id: position.id,
        candidate_id: candidateId,
        is_abstain: false,
      },
    }));
  }

  function handleAbstain(position) {
    setSelectedVotes((current) => ({
      ...current,
      [position.id]: {
        position_id: position.id,
        candidate_id: null,
        is_abstain: true,
      },
    }));
  }

  async function handleVerifyStudent(event) {
    event.preventDefault();

    if (!selectedElection) {
      setFeedback("Choose an election first.", "error");
      return;
    }

    if (getElectionPhase(selectedElection, new Date(nowTick)) !== "voting") {
      setFeedback("Kiosk voting is only available during the live voting period.", "error");
      return;
    }

    setVerifying(true);
    setFeedback("");

    const { data: studentData, error } = await supabase
      .from("students")
      .select("id, first_name, last_name, student_number, password, status")
      .eq("student_number", studentNumber.trim())
      .maybeSingle();

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

    if (studentData.password !== password) {
      setFeedback("Incorrect student password.", "error");
      setVerifying(false);
      return;
    }

    const { data: orgLinks, error: membershipError } = await supabase
      .from("student_organizations")
      .select("organization_id")
      .eq("student_id", studentData.id);

    if (membershipError) {
      setFeedback(membershipError.message, "error");
      setVerifying(false);
      return;
    }

    const electionOrgId = Number(selectedElection.organization_id);
    const belongsToElection = (orgLinks || []).some(
      (item) => Number(item.organization_id) === electionOrgId,
    );

    if (!belongsToElection) {
      setFeedback("This student is not linked to the election organization.", "error");
      setVerifying(false);
      return;
    }

    const voteCheck = await hasStudentVotedInElection(studentData.id, selectedElection.id);

    if (voteCheck.error) {
      setFeedback(voteCheck.error.message, "error");
      setVerifying(false);
      return;
    }

    if (voteCheck.hasVoted) {
      setFeedback(
        "A ballot already exists for this student in this election. Mobile and kiosk submissions share the same lock.",
        "error",
      );
      setVerifying(false);
      return;
    }

    setVerifiedStudent(studentData);
    setSelectedVotes({});
    setFeedback(
      `${studentData.first_name} ${studentData.last_name} verified. The kiosk ballot is now unlocked.`,
      "success",
    );
    setVerifying(false);
  }

  async function handleSubmitBallot() {
    if (!verifiedStudent || !selectedElection) return;

    const missingPosition = positions.find((position) => !selectedVotes[position.id]);

    if (missingPosition) {
      setFeedback(`Choose a candidate or abstain for ${missingPosition.name}.`, "error");
      return;
    }

    if (getElectionPhase(selectedElection, new Date(nowTick)) !== "voting") {
      setFeedback("This voting window has already closed.", "error");
      return;
    }

    if (!window.confirm(`Submit the kiosk ballot for ${verifiedStudent.first_name} ${verifiedStudent.last_name}?`)) {
      return;
    }

    setSubmitting(true);

    const { error, alreadyVoted } = await submitBallot({
      studentId: verifiedStudent.id,
      electionId: selectedElection.id,
      selectedVotes,
    });

    if (error) {
      setFeedback(
        alreadyVoted
          ? "This student already has a recorded ballot in this election."
          : error.message,
        "error",
      );
      setSubmitting(false);
      return;
    }

    setFeedback(
      `Ballot submitted successfully for ${verifiedStudent.first_name} ${verifiedStudent.last_name}.`,
      "success",
    );
    setVerifiedStudent(null);
    setSelectedVotes({});
    setStudentNumber("");
    setPassword("");
    setSubmitting(false);
  }

  const kioskPhase = selectedElection ? getElectionPhase(selectedElection, new Date(nowTick)) : null;
  const completedSelections = Object.keys(selectedVotes).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">
            <MonitorSmartphone size={14} />
            Precinct Kiosk
          </div>
          <h1 className="page-title">
            Managed
            <span className="page-title-accent"> kiosk voting</span>
          </h1>
          <p className="page-subtitle">
            Use this supervised precinct kiosk for students who cannot vote on
            their own devices. Access is limited to live voting windows and uses
            the same vote lock as mobile submissions.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="glass-panel mt-8 rounded-[28px] p-8 text-gray-500">
          Loading kiosk elections...
        </div>
      ) : (
        <>
          <div className="section-grid mt-8 grid-cols-1 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="soft-card">
              <div className="secure-badge">
                <ShieldCheck size={14} />
                Kiosk Control
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="info-row !block">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                    Live Elections
                  </p>
                  <p className="mt-2 text-2xl font-black text-[#1d262f]">{elections.length}</p>
                </div>
                <div className="info-row !block">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                    Verified Student
                  </p>
                  <p className="mt-2 text-sm font-black text-[#1d262f]">
                    {verifiedStudent ? `${verifiedStudent.first_name} ${verifiedStudent.last_name}` : "Waiting"}
                  </p>
                </div>
                <div className="info-row !block">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                    Ballot Progress
                  </p>
                  <p className="mt-2 text-sm font-black text-[#1d262f]">
                    {completedSelections}/{positions.length || 0}
                  </p>
                </div>
              </div>

              <div className="mt-6">
                <label className="field-label">Election</label>
                <select
                  value={selectedElectionId}
                  onChange={(event) => setSelectedElectionId(event.target.value)}
                  className="field-shell w-full"
                >
                  <option value="">Select a live election</option>
                  {elections.map((election) => (
                    <option key={election.id} value={election.id}>
                      {election.organizations?.name} - {election.title}
                    </option>
                  ))}
                </select>
              </div>

              {selectedElection ? (
                <div className="mt-5 rounded-[24px] bg-white/40 p-4">
                  <p className="field-label !mb-1">Voting Window</p>
                  <p className="text-sm font-semibold text-[#1d262f]">
                    {formatLocalDateTime(selectedElection.start_date)} to{" "}
                    {formatLocalDateTime(selectedElection.end_date)}
                  </p>
                  <p className="mt-3 text-sm text-gray-600">
                    Current phase: <span className="font-bold text-[#1d262f]">{kioskPhase}</span>
                  </p>
                </div>
              ) : null}

              {statusMessage ? (
                <div
                  className={`mt-5 rounded-2xl px-4 py-3 text-sm ${
                    statusTone === "success"
                      ? "bg-[rgba(17,128,106,0.12)] text-[#0f6a57]"
                      : statusTone === "error"
                        ? "bg-[rgba(211,90,37,0.12)] text-[#b54d1f]"
                        : "bg-[rgba(29,38,47,0.08)] text-[#374151]"
                  }`}
                >
                  {statusMessage}
                </div>
              ) : null}
            </div>

            <div className="trust-card">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-white/10 p-3 text-[#9ce7dd]">
                  <UserRoundCheck size={20} />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                    Kiosk Rules
                  </p>
                  <h2 className="mt-1 text-2xl font-black">Credential-verified voting</h2>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {[
                  "Students must verify their student number and password before the kiosk ballot opens.",
                  "The kiosk only shows elections currently inside the active voting period.",
                  "Mobile and kiosk ballots share the same vote record, so second submissions are blocked instantly.",
                ].map((item) => (
                  <div key={item} className="flex gap-3 rounded-2xl bg-white/7 px-4 py-3">
                    <CheckCircle2 size={18} className="mt-0.5 text-[#9ce7dd]" />
                    <p className="text-sm leading-6 text-white/72">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {selectedElection ? (
            <div className="soft-card mt-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#d35a25]">
                    {selectedElection.organizations?.name}
                  </p>
                  <h2 className="mt-2 text-2xl font-black">{selectedElection.title}</h2>
                </div>
                <span className="status-pill">{kioskPhase}</span>
              </div>

              {!verifiedStudent ? (
                <form onSubmit={handleVerifyStudent} className="mt-6 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="field-label">Student Number</label>
                    <input
                      value={studentNumber}
                      onChange={(event) => setStudentNumber(event.target.value)}
                      className="field-shell w-full"
                      placeholder="Enter student number"
                    />
                  </div>
                  <div>
                    <label className="field-label">Password</label>
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="field-shell w-full"
                      placeholder="Enter student password"
                      type="password"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <button
                      type="submit"
                      disabled={verifying || kioskPhase !== "voting"}
                      className="primary-btn"
                    >
                      {verifying ? "Verifying..." : "Verify Student and Open Ballot"}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="mt-6 rounded-[24px] bg-white/40 p-4">
                    <p className="field-label !mb-1">Kiosk Session</p>
                    <p className="text-base font-black text-[#1d262f]">
                      {verifiedStudent.first_name} {verifiedStudent.last_name}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">{verifiedStudent.student_number}</p>
                  </div>

                  <div className="mt-6 space-y-6">
                    {positions.length === 0 ? (
                      <div className="empty-state">No ballot positions found for this election.</div>
                    ) : (
                      positions.map((position) => {
                        const positionCandidates = candidates.filter(
                          (candidate) => candidate.position_id === position.id,
                        );

                        return (
                          <div key={position.id} className="rounded-[28px] bg-white/38 p-5">
                            <h3 className="text-xl font-black">{position.name}</h3>
                            <p className="mt-2 text-sm text-gray-600">
                              Choose one candidate or abstain.
                            </p>

                            <div className="mt-4 grid gap-4 xl:grid-cols-2">
                              {positionCandidates.map((candidate) => {
                                const selected =
                                  selectedVotes[position.id]?.candidate_id === candidate.id;

                                return (
                                  <button
                                    key={candidate.id}
                                    type="button"
                                    onClick={() => handleSelect(position, candidate.id)}
                                    className={`ballot-choice ${selected ? "ballot-choice-active" : "hover:bg-white"}`}
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
                                type="button"
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

                  <div className="mt-8 flex flex-wrap justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setVerifiedStudent(null);
                        setSelectedVotes({});
                        setStudentNumber("");
                        setPassword("");
                        setFeedback("Kiosk session cleared.", "neutral");
                      }}
                      className="secondary-btn"
                    >
                      Clear Session
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleSubmitBallot}
                      className="primary-btn disabled:opacity-60"
                    >
                      {submitting ? "Submitting..." : "Submit Kiosk Ballot"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="empty-state mt-8">
              {elections.length === 0
                ? "No live elections are currently available for kiosk voting."
                : "Choose a live election to start the kiosk session."}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default KioskVoting;
