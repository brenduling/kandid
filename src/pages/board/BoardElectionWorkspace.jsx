import { useNavigate } from "react-router-dom";
import { ArrowRight, Pencil, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import ElectionCover from "../../components/ElectionCover";
import { getVotingAccessModeLabel } from "../../utils/votingAccess";
import { resultVisibilityLabel } from "../../utils/results";
import { electionPhaseLabel, formatElectionSchedule } from "./electionDisplay";

/* Manage Setup: an operational workspace for one election.
 *
 * Deliberately not another form. It shows the election as it currently stands and
 * lists the management areas that already exist for this Board account, each with
 * the action that actually reaches it. There is no readiness score, no
 * completion percentage and no analytics anywhere in this file.
 *
 * Every area below is a page or sheet that already exists. Nothing here queries,
 * writes or derives anything: the workspace reads the election record the register
 * already loaded, and each action is the same navigation or handler the register
 * already performs.
 *
 * The Danger Zone adds no confirmation of its own and performs no re-entry. It
 * identifies the election, states only what the existing delete flow guarantees,
 * and hands off to the page's existing handleDelete, which still runs the
 * dependency check, still asks for confirmation with the authoritative message
 * and still re-checks immediately before deleting. */

const CHECKED_BEFORE_DELETE = [
  "Positions",
  "Candidates",
  "Partylists",
  "Eligibility rules",
  "Votes",
  "Access tokens",
];

export default function BoardElectionWorkspace({
  election,
  orgName,
  onClose,
  onEdit,
  onDelete,
}) {
  const navigate = useNavigate();

  const campaign = formatElectionSchedule(
    election.campaign_start,
    election.campaign_end,
  );
  const voting = formatElectionSchedule(election.start_date, election.end_date);

  /* Only areas that are currently supported are listed. "Records itself" areas
     open the Edit sheet because the schedule, access and results settings are
     fields of the election record. Pages that keep their own election selector
     say so, because they are not scoped by a URL parameter. */
  const areas = [
    {
      title: "Positions",
      description: "The ballot structure: positions, seat counts and order.",
      action: "Open",
      run: () => navigate(`/board/positions?election=${election.id}`),
    },
    {
      title: "Candidates",
      description: "Candidates per position, with campaign content.",
      action: "Open",
      note: "Select this election on the page.",
      run: () => navigate("/board/candidates"),
    },
    {
      title: "Partylists",
      description: "Partylists and their groupings for this election.",
      action: "Open",
      note: "Select this election on the page.",
      run: () => navigate("/board/partylists"),
    },
    {
      title: "Eligibility rules",
      description: "Who is eligible to vote in this election.",
      action: "Open",
      note: "Select this election on the page.",
      run: () => navigate("/board/eligibility-rules"),
    },
    {
      title: "Schedule",
      description: "Campaign and voting windows stored on the election record.",
      action: "Edit record",
      run: onEdit,
    },
    {
      title: "Access & results",
      description: "Voting access rule and when students see results.",
      action: "Edit record",
      run: onEdit,
    },
    {
      title: "Results",
      description: "Tally and result release for this election.",
      action: "Open",
      note: "Select this election on the page.",
      run: () => navigate("/board/results"),
    },
    {
      title: "Voting monitor",
      description: "Live participation while voting is open.",
      action: "Open",
      note: "Select this election on the page.",
      run: () => navigate("/board/voting-monitor"),
    },
  ];

  return (
    <PopupOverlay>
      <div
        className="popup-sheet board-election-sheet is-workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-election-workspace-title"
      >
        <div className="popup-header">
          <div className="popup-header-copy">
            <p className="board-election-sheet-kicker">{orgName}</p>
            <h2 id="board-election-workspace-title" className="surface-title">
              Manage setup
            </h2>
            <p className="surface-copy">
              The areas below already exist for this election. Select one to work in it.
            </p>
          </div>
          <button
            type="button"
            className="popup-close"
            onClick={onClose}
            aria-label="Close manage setup"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="popup-content board-election-workspace-body">
          <section className="board-election-identity-panel" aria-labelledby="board-election-identity">
            <div className="board-election-identity-cover">
              <ElectionCover election={election} compact />
            </div>
            <div className="board-election-identity-copy">
              <p className="board-election-sheet-kicker">Selected election</p>
              <h3 id="board-election-identity">{election.title || "Untitled Election"}</h3>
              <p className="board-election-identity-org">
                {orgName} &middot; {electionPhaseLabel(election)}
              </p>
            </div>
            <button type="button" className="board-election-setup-quiet" onClick={onEdit}>
              <Pencil size={15} aria-hidden="true" />
              Edit record
            </button>
          </section>

          <dl className="board-election-workspace-context">
            <div>
              <dt>Current phase</dt>
              <dd>{electionPhaseLabel(election)}</dd>
            </div>
            <div>
              <dt>Campaign</dt>
              <dd>
                {campaign.date}
                {campaign.time ? <span>{campaign.time}</span> : null}
              </dd>
            </div>
            <div>
              <dt>Voting</dt>
              <dd>
                {voting.date}
                {voting.time ? <span>{voting.time}</span> : null}
              </dd>
            </div>
            <div>
              <dt>Voting access</dt>
              <dd>{getVotingAccessModeLabel(election.voting_access_mode)}</dd>
            </div>
            <div>
              <dt>Student results</dt>
              <dd>{resultVisibilityLabel(election.student_result_visibility)}</dd>
            </div>
          </dl>

          <section className="board-election-workspace-register" aria-labelledby="board-election-areas">
            <div className="board-election-workspace-heading">
              <p className="board-election-sheet-kicker">Management areas</p>
              <h3 id="board-election-areas">Setup and operations</h3>
            </div>

            <ol>
              {areas.map((area, index) => (
                <li key={area.title}>
                  <span className="board-election-area-index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="board-election-area-copy">
                    <strong>{area.title}</strong>
                    <p>{area.description}</p>
                    {area.note ? <small>{area.note}</small> : null}
                  </div>
                  <button
                    type="button"
                    className="board-election-area-action"
                    onClick={area.run}
                  >
                    {area.action}
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section className="board-election-danger" aria-labelledby="board-election-danger">
            <p className="board-election-danger-label">Danger zone</p>
            <h3 id="board-election-danger">Delete this election</h3>
            <p className="board-election-danger-copy">
              This removes <strong>{election.title || "Untitled Election"}</strong> from{" "}
              {orgName}. Before anything is deleted, Kandid checks the records listed below.
              If any are found, the delete is stopped and you will be asked to resolve them
              first.
            </p>

            <div className="board-election-danger-check">
              <p>Checked before deletion</p>
              <ul>
                {CHECKED_BEFORE_DELETE.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </div>

            <p className="board-election-danger-copy is-quiet">
              You will be asked to confirm before Kandid deletes anything, and the check
              runs again immediately before the delete is carried out.
            </p>

            <div className="board-election-danger-actions">
              <button
                type="button"
                className="board-election-danger-button"
                onClick={onDelete}
              >
                <Trash2 size={15} aria-hidden="true" />
                Delete election
              </button>
            </div>
          </section>
        </div>
      </div>
    </PopupOverlay>
  );
}
