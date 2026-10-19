import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ExternalLink,
  FileText,
  RefreshCw,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import ElectionCover from "../../components/ElectionCover";
import KandidImage from "../../components/KandidImage";
import { supabase } from "../../lib/supabaseClient";
import { formatLocalDateTime } from "../../utils/elections";
import { getElectionPhase, getCampaignWindowPhase } from "../../utils/electionLifecycle";
import { useElectionClock } from "../../utils/useElectionClock";
import { studentElectionFailure } from "../../utils/studentElectionAccess";
import StudentBallotAction from "../../components/student/StudentBallotAction";
import { resolveCampaignMaterialUrl, inferCampaignMaterialInputType, parseCampaignMaterialReference } from "../../utils/campaignMaterials";

const INITIAL_VIEW = {
  kind: "LOADING",
  reason: null,
  data: null,
};

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function previewText(candidate) {
  const text =
    cleanText(candidate?.platform) ||
    cleanText(candidate?.bio) ||
    cleanText(candidate?.credentials);

  if (!text) return "Open their profile to see the information they shared.";
  return text;
}

function safeMaterialUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function CampaignMaterialLink({ material, label }) {
  const source = material?.url;
  const kind = material?.type === "media"
    ? inferCampaignMaterialInputType(material)
    : material?.type || "link";
  const [resolution, setResolution] = useState({ source: null, url: "", failed: false });
  useEffect(() => {
    let active = true;
    resolveCampaignMaterialUrl(supabase, source)
      .then((url) => { if (active) setResolution({ source, url, failed: false }); })
      .catch(() => { if (active) setResolution({ source, url: "", failed: true }); });
    return () => { active = false; };
  }, [source]);

  const matchesSource = resolution.source === source;
  const url = matchesSource ? resolution.url : "";
  const failed = matchesSource && resolution.failed;

  if (!url) return (
    <span className="student-campaign-material-unavailable">
      {failed ? "Unavailable" : "Preparing secure link…"}
    </span>
  );
  if (kind === "image") {
    return (
      <a className="student-campaign-material-image" href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt={label} loading="lazy" />
        <span>Open full-size image</span>
      </a>
    );
  }
  if (kind === "video") {
    const extension = parseCampaignMaterialReference(source)?.extension || source.split(/[?#]/, 1)[0].split(".").pop()?.toLowerCase();
    const videoType = extension === "webm" ? "video/webm" : "video/mp4";
    return (
      <video className="student-campaign-material-video" controls preload="metadata" aria-label={label}>
        <source src={url} type={videoType} />
        Your browser cannot play this campaign video. <a href={url}>Open the video</a>.
      </video>
    );
  }
  if (kind === "document") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" download>
        <FileText size={15} /> View or download PDF
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <ExternalLink size={15} /> Open campaign link
    </a>
  );
}

function CampaignState({ eyebrow, title, copy, action, loading = false }) {
  return (
    <section
      className={`student-campaign-state ${loading ? "is-loading" : ""}`}
      aria-live="polite"
      aria-busy={loading}
    >
      <span className="student-campaign-state-mark" aria-hidden="true">
        {loading ? <span /> : <FileText size={21} />}
      </span>
      <div>
        <p className="student-campaign-kicker">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="student-campaign-state-copy">{copy}</p>
        {action}
      </div>
    </section>
  );
}

function PartylistIdentity({ partylist }) {
  const name = cleanText(partylist?.name) || "Independent";

  return (
    <div className="student-campaign-partylist">
      {partylist?.logo_url ? (
        <KandidImage
          src={partylist.logo_url}
          alt={`${name} logo`}
          label={name}
          className="student-campaign-partylist-logo"
          fit="contain"
        />
      ) : null}
      <span>{name}</span>
    </div>
  );
}

function CandidateDetails({ candidate, positionName }) {
  const bio = cleanText(candidate.bio);
  const platform = cleanText(candidate.platform);
  const credentials = cleanText(candidate.credentials);
  const materials = Array.isArray(candidate.campaign_materials)
    ? candidate.campaign_materials
    : [];

  return (
    <div
      id={`candidate-details-${candidate.id}`}
      className="student-campaign-candidate-details"
    >
      <section className="student-campaign-platform">
        <p className="student-campaign-detail-label">Platform</p>
        <h4>What they are proposing</h4>
        <p>{platform || "No platform statement has been shared yet."}</p>
      </section>

      <div className="student-campaign-detail-columns">
        <section>
          <p className="student-campaign-detail-label">Biography</p>
          <p>{bio || "Biography details have not been shared."}</p>
        </section>
        <section>
          <p className="student-campaign-detail-label">Credentials</p>
          <p>{credentials || "Credentials have not been shared."}</p>
        </section>
      </div>

      {materials.length > 0 ? (
        <section className="student-campaign-materials">
          <div>
            <p className="student-campaign-detail-label">Campaign materials</p>
            <p>Documents and links shared by {candidate.display_name}.</p>
          </div>
          <ul>
            {materials.map((material, index) => {
              const url = safeMaterialUrl(material?.url);
              const label = cleanText(material?.label) || `Campaign material ${index + 1}`;
              const kind = material?.type === "media" ? inferCampaignMaterialInputType(material) : material?.type || "link";

              return (
                <li key={`${material?.url || "material"}-${index}`}>
                  <span>
                    <FileText size={16} aria-hidden="true" />
                    <span>
                      <strong>{label}</strong>
                      <small>{kind}</small>
                    </span>
                  </span>
                  {url || material?.url?.startsWith("storage://campaign-materials/") ? (
                    <CampaignMaterialLink material={material} label={label} />
                  ) : (
                    <span className="student-campaign-material-unavailable">
                      Unavailable
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section className="student-campaign-materials is-empty">
          <div>
            <p className="student-campaign-detail-label">Campaign materials</p>
            <p>No campaign materials have been shared yet.</p>
          </div>
        </section>
      )}

      <p className="student-campaign-detail-context">
        Running for {positionName} as {cleanText(candidate.partylist?.name) || "Independent"}.
      </p>
    </div>
  );
}

function CandidateCard({ candidate, positionName, expanded, onToggle }) {
  return (
    <article className={`student-campaign-candidate ${expanded ? "is-expanded" : ""}`}>
      <div className="student-campaign-candidate-preview">
        <KandidImage
          src={candidate.photo_url}
          alt={`${candidate.display_name} candidate photo`}
          label={candidate.display_name}
          className="student-campaign-candidate-photo"
          loading="lazy"
        />

        <div className="student-campaign-candidate-copy">
          <p className="student-campaign-candidate-position">{positionName}</p>
          <h3>{candidate.display_name}</h3>
          <PartylistIdentity partylist={candidate.partylist} />
          <p className="student-campaign-candidate-summary">{previewText(candidate)}</p>
        </div>

        <button
          type="button"
          className="student-campaign-candidate-toggle"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={`candidate-details-${candidate.id}`}
        >
          {expanded ? "Close profile" : "View profile"}
          <ChevronDown size={17} className={expanded ? "is-open" : ""} />
        </button>
      </div>

      {expanded ? (
        <CandidateDetails candidate={candidate} positionName={positionName} />
      ) : null}
    </article>
  );
}

function StudentCampaign() {
  const { electionId } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState(INITIAL_VIEW);
  const [expandedCandidateId, setExpandedCandidateId] = useState(null);
  const [requestKey, setRequestKey] = useState(0);
  const now = useElectionClock();
  const observedWindow = useRef(null);
  const windowPhase = view.schedule ? getCampaignWindowPhase(view.schedule, now) : null;
  useEffect(() => {
    if (!windowPhase) return;
    const previous = observedWindow.current;
    observedWindow.current = { electionId, windowPhase };
    if (previous?.electionId === electionId && previous.windowPhase !== windowPhase) {
      // Reauthorize at the schedule boundary instead of retaining a stale roster.
      Promise.resolve().then(() => setRequestKey(value => value + 1));
    }
  }, [windowPhase, electionId]);

  // Returning to the campaign page rechecks the published-only contract so a
  // newly confirmed election roster is not left behind an old empty view.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setRequestKey(key => key + 1); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadCampaign() {
      setView(INITIAL_VIEW);
      setExpandedCandidateId(null);

      try {
      const id = Number(electionId);
      if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
        if (active) setView({ kind: "UNAVAILABLE", reason: "ELECTION_NOT_AVAILABLE", data: null });
        return;
      }
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth?.user) {
        if (active) setView({ ...studentElectionFailure(authError, authError ? undefined : 401), data: null });
        return;
      }
      const { data, error, status: httpStatus } = await supabase.rpc("kandid_get_student_published_campaign", {
        p_election_id: id,
      }).retry(false);

      if (!active) return;

      if (error) {
        setView({ ...studentElectionFailure(error, httpStatus), data: null });
        return;
      }

      const status = data?.status;
      if (!["AVAILABLE", "EMPTY", "UNAVAILABLE", "UNAUTHORIZED"].includes(status)) {
        console.error("Student Campaign returned an unexpected response status.");
        setView({ kind: "ERROR", reason: null, data: null });
        return;
      }
      if (["AVAILABLE", "EMPTY"].includes(status) &&
          (Number(data.data?.election?.id) !== id || !Array.isArray(data.data?.positions) ||
            !Array.isArray(data.data?.candidates) ||
            (status === "AVAILABLE" && data.data.candidates.length === 0) ||
            (status === "EMPTY" && data.data.candidates.length !== 0))) {
        setView({ kind: "ERROR", reason: "INVALID_RESPONSE", data: null });
        return;
      }

      // The published-only RPC remains the sole source of candidate data. Read
      // public schedule metadata only after it confirms this student's access.
      let schedule = null;
      let scheduleError = false;
      if (["AVAILABLE", "EMPTY"].includes(status) ||
          ["CAMPAIGN_NOT_STARTED", "CAMPAIGN_ENDED", "CAMPAIGN_SCHEDULE_MISSING"].includes(data?.reason)) {
        const response = await supabase.from("elections")
          .select("id,title,status,campaign_start,campaign_end,start_date,end_date")
          .eq("id", id).single().retry(false);
        schedule = !response.error && Number(response.data?.id) === id ? response.data : null;
        scheduleError = !schedule;
      }
      if (!active) return;
      setView({
        kind: status,
        reason: data?.reason || null,
        data: data?.data || null,
        schedule,
        scheduleError,
      });
      } catch (error) {
        if (active) setView({ ...studentElectionFailure(error), data: null });
      }
    }

    loadCampaign();

    return () => {
      active = false;
    };
  }, [electionId, requestKey]);

  const backButton = (
    <button
      type="button"
      onClick={() => navigate("/student/elections")}
      className="student-back-link student-campaign-back"
    >
      <ArrowLeft size={15} />
      Back to elections
    </button>
  );

  const phase = view.schedule ? getElectionPhase(view.schedule, now) : null;
  const schedulePanel = view.schedule ? (
    <section className="student-campaign-reading-note student-campaign-voting" aria-label="Election schedule">
      <div>
        <strong>{phase === "campaign" ? "Campaign Ongoing" : phase === "waiting" ? "Waiting for Voting" : phase === "voting" ? "Voting Open" : phase === "closed" ? "Voting Closed" : "Upcoming Election"}</strong>
        <p>{view.schedule.title} · Voting: {formatLocalDateTime(view.schedule.start_date)} to {formatLocalDateTime(view.schedule.end_date)} (Asia/Manila)</p>
        <p>Campaign: {formatLocalDateTime(view.schedule.campaign_start)} to {formatLocalDateTime(view.schedule.campaign_end)}</p>
      </div>
      {phase === "voting" ? <StudentBallotAction electionId={Number(electionId)} /> : null}
    </section>
  ) : view.scheduleError ? (
    <div className="student-campaign-reading-note" role="alert">
      Voting schedule unavailable.
      <button type="button" className="student-outline-btn" onClick={() => setRequestKey(value => value + 1)}>Retry</button>
    </div>
  ) : null;

  if (view.kind === "LOADING") {
    return (
      <div className="student-campaign-page-v2">
        {backButton}
        <CampaignState
          eyebrow="Campaign"
          title="Preparing the candidate guide"
          copy="Gathering the campaign information available for this election."
          loading
        />
      </div>
    );
  }

  if (view.kind === "ERROR") {
    return (
      <div className="student-campaign-page-v2">
        {backButton}
        <CampaignState
          eyebrow="Campaign unavailable"
          title="We couldn't load the campaign right now."
          copy={view.message || "Please try again in a moment."}
          action={(
            <button
              type="button"
              className="student-campaign-state-action"
              onClick={() => setRequestKey((current) => current + 1)}
            >
              <RefreshCw size={16} />
              Retry
            </button>
          )}
        />
      </div>
    );
  }

  if (view.kind === "UNAUTHORIZED") {
    const unauthorizedCopy = {
      AUTHENTICATION_REQUIRED: {
        title: "Your session needs attention.",
        copy: "Return to the Student portal and sign in again to continue.",
      },
      STUDENT_ACCESS_DENIED: {
        title: "This campaign isn't available to this account.",
        copy: "Use the Elections page to view campaign information available to you.",
      },
    }[view.reason] || {
      title: "This campaign isn't available to this account.",
      copy: "Use the Elections page to continue.",
    };

    return (
      <div className="student-campaign-page-v2">
        {backButton}
        <CampaignState
          eyebrow="Student access"
          title={unauthorizedCopy.title}
          copy={unauthorizedCopy.copy}
          action={view.reason === "AUTHENTICATION_REQUIRED" ? (
            <button type="button" className="student-campaign-state-action" onClick={() => navigate("/student-login")}>Sign in</button>
          ) : null}
        />
      </div>
    );
  }

  if (view.kind === "UNAVAILABLE" || (view.kind === "AVAILABLE" && windowPhase && windowPhase !== "ongoing")) {
    const unavailableCopy = {
      CAMPAIGN_NOT_STARTED: {
        title: "Campaign isn't open yet.",
        copy: "Candidate information will appear here when the campaign period begins.",
      },
      CAMPAIGN_ENDED: {
        title: "Campaign has ended.",
        copy: "Return to Elections for the next available step.",
      },
      CAMPAIGN_SCHEDULE_MISSING: {
        title: "Campaign information isn't available right now.",
        copy: "Return to Elections and check again later.",
      },
      ELECTION_NOT_AVAILABLE: {
        title: "This campaign isn't available.",
        copy: "This election may be unavailable or you may not be eligible. Use Elections to view the campaigns available to your account.",
      },
    }[view.reason || (windowPhase === "upcoming" ? "CAMPAIGN_NOT_STARTED" : "CAMPAIGN_ENDED")] || {
      title: "This campaign isn't available.",
      copy: "Use the Elections page to continue.",
    };

    return (
      <div className="student-campaign-page-v2">
        {backButton}
        {schedulePanel}
        <CampaignState
          eyebrow="Campaign"
          title={unavailableCopy.title}
          copy={unavailableCopy.copy}
        />
      </div>
    );
  }

  if (view.kind === "EMPTY") {
    return (
      <div className="student-campaign-page-v2">
        {backButton}
        {schedulePanel}
        <CampaignState
          eyebrow={view.data?.election?.title || "Campaign"}
          title="No published campaigns yet."
          copy="Candidates will appear here after the Board publishes their campaigns."
        />
      </div>
    );
  }

  const election = view.data?.election || {};
  const organization = view.data?.organization || {};
  const positions = Array.isArray(view.data?.positions) ? view.data.positions : [];
  const candidates = Array.isArray(view.data?.candidates) ? view.data.candidates : [];
  const campaignPeriod = [
    formatLocalDateTime(election.campaign_start),
    formatLocalDateTime(election.campaign_end),
  ].join(" to ");

  return (
    <div className="student-campaign-page-v2">
      {backButton}

      <header className="student-campaign-mast">
        <div className="student-campaign-mast-copy">
          <p className="student-campaign-kicker">Campaign</p>
          <h1>{election.title || "Election Campaign"}</h1>
          <p className="student-campaign-intro">
            Meet the candidates and see what they're bringing to the ballot.
          </p>
          <div className="student-campaign-context">
            <span>{organization.name || "Student organization"}</span>
            <span>
              <CalendarDays size={15} aria-hidden="true" />
              {campaignPeriod}
            </span>
          </div>
        </div>
        <ElectionCover election={election} compact className="student-campaign-mast-cover" />
      </header>

      {schedulePanel}

      <div className="student-campaign-reading-note">
        <span aria-hidden="true" />
        <p>Here are the people asking for your vote. Take your time and see what they stand for.</p>
      </div>

      <main className="student-campaign-position-list">
        {positions.map((position, positionIndex) => {
          const positionCandidates = candidates.filter(
            (candidate) => candidate.position_id === position.id,
          );

          return (
            <section className="student-campaign-position" key={position.id}>
              <div className="student-campaign-position-heading">
                <span>{String(positionIndex + 1).padStart(2, "0")}</span>
                <div>
                  <p>Position</p>
                  <h2>{position.name}</h2>
                </div>
                <p>
                  {positionCandidates.length} candidate{positionCandidates.length === 1 ? "" : "s"}
                </p>
              </div>

              {positionCandidates.length > 0 ? (
                <div className="student-campaign-candidate-grid">
                  {positionCandidates.map((candidate) => (
                    <CandidateCard
                      key={candidate.id}
                      candidate={candidate}
                      positionName={position.name}
                      expanded={expandedCandidateId === candidate.id}
                      onToggle={() => setExpandedCandidateId((current) => (
                        current === candidate.id ? null : candidate.id
                      ))}
                    />
                  ))}
                </div>
              ) : (
                <p className="student-campaign-position-empty">
                  No candidate information is available for this position yet.
                </p>
              )}
            </section>
          );
        })}
      </main>
    </div>
  );
}

export default StudentCampaign;
