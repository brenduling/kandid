import { useEffect, useState } from "react";
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
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
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
              const downloadable = material?.downloadable === true;

              return (
                <li key={`${material?.url || "material"}-${index}`}>
                  <span>
                    <FileText size={16} aria-hidden="true" />
                    <span>
                      <strong>{label}</strong>
                      <small>{cleanText(material?.type) || "link"}</small>
                    </span>
                  </span>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      download={downloadable || undefined}
                    >
                      <ExternalLink size={15} />
                      Open material
                    </a>
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
      ) : null}

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

  useEffect(() => {
    let active = true;

    async function loadCampaign() {
      setView(INITIAL_VIEW);
      setExpandedCandidateId(null);

      const { data, error } = await supabase.rpc("get_student_campaign", {
        p_election_id: electionId,
      });

      if (!active) return;

      if (error) {
        console.error("Failed to load Student Campaign:", error);
        setView({ kind: "ERROR", reason: null, data: null });
        return;
      }

      const status = data?.status;
      if (!["AVAILABLE", "EMPTY", "UNAVAILABLE", "UNAUTHORIZED"].includes(status)) {
        console.error("Student Campaign returned an unexpected response status.");
        setView({ kind: "ERROR", reason: null, data: null });
        return;
      }

      setView({
        kind: status,
        reason: data?.reason || null,
        data: data?.data || null,
      });
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
          copy="Please try again in a moment."
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
        />
      </div>
    );
  }

  if (view.kind === "UNAVAILABLE") {
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
        copy: "Use the Elections page to view campaigns available to you.",
      },
    }[view.reason] || {
      title: "This campaign isn't available.",
      copy: "Use the Elections page to continue.",
    };

    return (
      <div className="student-campaign-page-v2">
        {backButton}
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
        <CampaignState
          eyebrow={view.data?.election?.title || "Campaign"}
          title="Nothing to introduce just yet."
          copy="Candidates will appear here when campaign information is available."
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
