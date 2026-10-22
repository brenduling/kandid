import { useState } from "react";
import { electionEditLocks } from "../../utils/electionEditContract";
import { ArrowLeft, ArrowRight, ImagePlus, Power, QrCode, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import ElectionCover from "../../components/ElectionCover";
import AcademicTermSelect from "../../components/AcademicTermSelect";
import ScheduleDateTimePicker from "../../components/ScheduleDateTimePicker";
import { KandidButtonLoader } from "../../components/KandidLoader";
import { formatLocalDateTime } from "../../utils/elections";
import {
  getAccessQrImageUrl,
  getVotingAccessModeLabel,
  TOKEN_SCOPE_TYPES,
  VOTING_ACCESS_MODES,
} from "../../utils/votingAccess";
import { resultVisibilityLabel } from "../../utils/results";
import { formatElectionSchedule } from "./electionDisplay";
import ElectionElectoratePanel from "./ElectionElectoratePanel";
import { isAutomaticVoterEligibilityEnabled } from "../../utils/automaticVoterEligibility";

/* Guided election setup for the Board.
 *
 * Presentation only. Every field, the schedule min/max chain, the conditional
 * required rules and the access-token actions are carried over unchanged from
 * the previous single-sheet form, and the submit handler is the page's existing
 * handleSubmit, so validation, payload shape, audit logging and CRUD are
 * untouched. Only the grouping and the order in which the operator meets the
 * fields have changed.
 *
 * The four groups are numbered rather than paginated into a wizard: each group is
 * a labelled section of one sheet, and the Review group is read-only, so the
 * operator can see the whole brief and still jump back to any group to adjust it. */

const STEPS = [
  { key: "election", label: "Election" },
  { key: "schedule", label: "Schedule" },
  { key: "access", label: "Access & Results" },
  { key: "review", label: "Review" },
];

const RESULT_VISIBILITY_OPTIONS = [
  { value: "realtime", label: "Real-time results" },
  { value: "after_close", label: "Show after voting ends" },
  { value: "manual", label: "Manual admin release" },
];

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
];

function Field({ id, label, hint, optional = false, wide = false, children }) {
  return (
    <div className={`board-election-setup-field${wide ? " is-wide" : ""}`}>
      <label htmlFor={id}>
        {label}
        {optional ? <span>Optional</span> : null}
      </label>
      {children}
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function resultVisibilityOptionLabel(value) {
  const match = RESULT_VISIBILITY_OPTIONS.find((option) => option.value === value);
  return match ? match.label : resultVisibilityLabel(value);
}

export default function BoardElectionSetup({
  editing,
  saveBlockedReason = "",
  onElectorateLocked,
  form,
  updateForm,
  onSubmit,
  submitting,
  onClose,
  coverUploading,
  onCoverUpload,
  scheduleMin,
  accessTokens,
  tokenForm,
  updateTokenForm,
  onCreateAccessToken,
  onToggleToken,
}) {
  const isEditing = Boolean(editing);
  const electorateLocked = Boolean(editing?.electorate_frozen_at || editing?.results_released_at);
  const automaticEligibility = isAutomaticVoterEligibilityEnabled(import.meta.env);
  const editLocks = electionEditLocks(editing);
  const [step, setStep] = useState(0);

  const campaign = formatElectionSchedule(form.campaign_start, form.campaign_end);
  const voting = formatElectionSchedule(form.start_date, form.end_date);

  /* Access tokens are only editable on an existing election, and only for the
     access modes the existing form supports. Same gate as before. */
  const tokensSupported =
    isEditing && form.voting_access_mode !== "anywhere" && form.voting_access_mode !== "location_range";

  function goToStep(target) {
    setStep(Math.min(Math.max(target, 0), STEPS.length - 1));
  }

  /* Which group owns a field the validator will reject.

     Only used to decide where to put the operator. The authoritative check, its
     ordering and its message all still come from the page's own handleSubmit,
     which is called on every submit exactly as before, so this cannot accept an
     election the validator would reject or change the text that is shown. The
     conditions mirror the ones validateElectionSchedule() uses only so the
     operator lands on the group holding the problem instead of on a read-only
     Review page. */
  function sectionForInvalidField() {
    if (!form.title?.trim() || !form.academic_term_id) return 0;

    const votingMissing = !form.start_date || !form.end_date;
    const publishable = form.status !== "draft" && form.status !== "archived";
    const campaignIncomplete = publishable && (!form.campaign_start || !form.campaign_end);
    if (votingMissing || campaignIncomplete) return 1;

    const geoIncomplete =
      form.voting_access_mode === "location_range" &&
      (form.geo_lat === "" || form.geo_lng === "" || form.geo_radius_meters === "");
    if (geoIncomplete) return 2;

    return step;
  }

  function handleFormSubmit(event) {
    setStep(sectionForInvalidField());
    onSubmit(event);
  }

  return (
    <PopupOverlay>
      <div
        className="popup-sheet board-election-sheet is-setup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-election-setup-title"
      >
        <div className="popup-header">
          <div className="popup-header-copy">
            <p className="board-election-sheet-kicker">
              {isEditing ? "Election record" : "New election"}
            </p>
            <h2 id="board-election-setup-title" className="surface-title">
              {isEditing ? "Edit election" : "Create election"}
            </h2>
            <p className="surface-copy">
              {isEditing
                ? "Change the election record. The same sections are used when the election is first created."
                : "Four short sections. Election details are saved after review. Uploaded covers are public immediately."}
            </p>
          </div>
          <button
            type="button"
            className="popup-close"
            onClick={onClose}
            disabled={submitting}
            aria-label={isEditing ? "Close edit election" : "Close create election"}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <nav className="board-election-setup-progress" aria-label="Setup sections">
          <ol>
            {STEPS.map((item, index) => (
              <li
                key={item.key}
                className={
                  step === index ? "is-current" : step > index ? "is-complete" : ""
                }
                aria-current={step === index ? "step" : undefined}
              >
                <button type="button" onClick={() => goToStep(index)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{item.label}</strong>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <form className="popup-content board-election-setup-body" onSubmit={handleFormSubmit}>
          {saveBlockedReason ? (
            <p className="board-election-edit-restriction" id="board-election-edit-restriction" role="status">
              {saveBlockedReason}
            </p>
          ) : null}
          {step === 0 ? (
            <section className="board-election-setup-section" aria-labelledby="board-election-setup-01">
              <div className="board-election-setup-heading">
                <p className="board-election-sheet-kicker">01</p>
                <div>
                  <h3 id="board-election-setup-01">Election</h3>
                  <p>The name students will recognise, and the cover shown in the register.</p>
                </div>
              </div>

              <div className="board-election-setup-cover">
                <ElectionCover
                  election={{ title: form.title || "Election", cover_url: form.cover_url }}
                  compact
                />
                <div className="board-election-setup-cover-copy">
                  <Field id="board-election-title" label="Election title" wide>
                    <input
                      id="board-election-title"
                      required
                      placeholder="Election Title"
                      value={form.title}
                      onChange={(event) => updateForm({ title: event.target.value })}
                    />
                  </Field>
                  <Field id="board-election-academic-term" label="Academic term" wide>
                    <AcademicTermSelect
                      id="board-election-academic-term"
                      required
                      disabled={editLocks.term}
                      value={form.academic_term_id}
                      onChange={(academicTermId) => updateForm({ academic_term_id: academicTermId })}
                    />
                    {isEditing ? <small>The academic term is permanent. Frozen elections retain their organization, schedules and voting settings.</small> : null}
                  </Field>
                  <div className="board-election-setup-cover-actions">
                    <label className="board-election-setup-upload">
                      <ImagePlus size={16} aria-hidden="true" />
                      {form.cover_url ? "Change cover" : "Add cover"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        disabled={coverUploading || submitting}
                        onChange={(event) => {
                          onCoverUpload(event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    {form.cover_url ? (
                      <button
                        type="button"
                        className="board-election-setup-quiet"
                        onClick={() => updateForm({ cover_url: "" })}
                        disabled={coverUploading}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <Field
                    id="board-election-cover-url"
                    label="Cover image URL"
                    optional
                    wide
                    hint={
                      coverUploading
                        ? "Uploading cover..."
                        : "JPEG, PNG, WebP or GIF, up to 5 MB. Public immediately; save to attach."
                    }
                  >
                    <input
                      id="board-election-cover-url"
                      value={form.cover_url}
                      disabled={coverUploading || submitting}
                      onChange={(event) => updateForm({ cover_url: event.target.value })}
                      placeholder="Cover image URL optional"
                    />
                  </Field>
                </div>
              </div>
            </section>
          ) : null}

          {step === 1 ? (
            <section className="board-election-setup-section" aria-labelledby="board-election-setup-02">
              <div className="board-election-setup-heading">
                <p className="board-election-sheet-kicker">02</p>
                <div>
                  <h3 id="board-election-setup-02">Schedule</h3>
                  <p>
                    Campaign is the window were candidates are presented. Voting is the window
                    ballots are accepted.
                  </p>
                </div>
              </div>

              <div className="board-election-setup-group">
                <p className="board-election-setup-kicker">Campaign window</p>
                <div className="board-election-setup-fields">
                  <ScheduleDateTimePicker
                    label="Campaign Start Date & Time"
                    disabled={editLocks.settings}
                    validationId="board-election-campaign-start"
                    beforeField="#board-election-campaign-end"
                    beforeLabel="campaign end"
                    beforeMessage="Campaign start must be before campaign end."
                    required={form.status !== "draft"}
                    value={form.campaign_start}
                    min={scheduleMin}
                    max={form.campaign_end || form.start_date}
                    onChange={(value) => updateForm({ campaign_start: value })}
                  />
                  <ScheduleDateTimePicker
                    label="Campaign End Date & Time"
                    disabled={editLocks.settings}
                    validationId="board-election-campaign-end"
                    afterField="#board-election-campaign-start"
                    afterLabel="campaign start"
                    afterMessage="Campaign end must be after campaign start."
                    beforeField="#board-election-voting-start"
                    beforeLabel="voting start"
                    beforeMessage="Campaign end must be before or equal to voting start."
                    beforeInclusive
                    required={form.status !== "draft"}
                    value={form.campaign_end}
                    min={form.campaign_start || scheduleMin}
                    max={form.start_date}
                    onChange={(value) => updateForm({ campaign_end: value })}
                  />
                </div>
              </div>

              <div className="board-election-setup-group">
                <p className="board-election-setup-kicker">Voting window</p>
                <div className="board-election-setup-fields">
                  <ScheduleDateTimePicker
                    label="Voting Start Date & Time"
                    validationId="board-election-voting-start"
                    afterField="#board-election-campaign-end"
                    afterLabel="campaign end"
                    afterMessage="Voting must start at or after campaign end."
                    afterInclusive
                    beforeField="#board-election-voting-end"
                    beforeLabel="voting end"
                    beforeMessage="Voting must end after it starts."
                    required
                    disabled={electorateLocked}
                    value={form.start_date}
                    min={form.campaign_end || scheduleMin}
                    max={form.end_date}
                    onChange={(value) => updateForm({ start_date: value })}
                  />
                  <ScheduleDateTimePicker
                    label="Voting End Date & Time"
                    validationId="board-election-voting-end"
                    afterField="#board-election-voting-start"
                    afterLabel="voting start"
                    afterMessage="Voting must end after it starts."
                    required
                    disabled={electorateLocked}
                    value={form.end_date}
                    min={form.start_date || form.campaign_end || scheduleMin}
                    onChange={(value) => updateForm({ end_date: value })}
                  />
                </div>
              </div>

              <p className="board-election-setup-note" role={electorateLocked ? "note" : undefined}>
                {electorateLocked
                  ? "The electorate is frozen. Voting start and end dates cannot be changed; the database enforces this to keep the frozen voter snapshot aligned with the voting window."
                  : "Schedule times are recorded exactly as entered and are read back in the same wall-clock time."}
              </p>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="board-election-setup-section" aria-labelledby="board-election-setup-03">
              <div className="board-election-setup-heading">
                <p className="board-election-sheet-kicker">03</p>
                <div>
                  <h3 id="board-election-setup-03">Access &amp; Results</h3>
                  <p>Who may vote, and when results become visible to students.</p>
                </div>
              </div>

              <div className="board-election-setup-fields">
                <Field id="board-election-status" label="Election status">
                  <select
                    id="board-election-status"
                      data-validation-dependents="#board-election-campaign-start,#board-election-campaign-end"
                    disabled={editLocks.settings}
                      value={form.status}
                    onChange={(event) => updateForm({ status: event.target.value })}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field id="board-election-visibility" label="Student results visibility">
                  <select
                    id="board-election-visibility"
                    disabled={editLocks.visibility}
                    value={form.student_result_visibility}
                    onChange={(event) =>
                      updateForm({ student_result_visibility: event.target.value })
                    }
                  >
                    {RESULT_VISIBILITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="board-election-setup-group">
                <p className="board-election-setup-kicker">Voting access rule</p>
                <div className="board-election-setup-fields">
                  <Field id="board-election-access-mode" label="Access mode">
                    <select
                      id="board-election-access-mode"
                      data-validation-dependents="#board-election-geo-lat,#board-election-geo-lng,#board-election-geo-radius"
                      disabled={editLocks.settings}
                      value={form.voting_access_mode}
                      onChange={(event) => updateForm({ voting_access_mode: event.target.value })}
                    >
                      {VOTING_ACCESS_MODES.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    id="board-election-location-label"
                    label="Location label"
                    optional
                    hint="Shown to students when the access mode is a location rule."
                  >
                    <input
                      id="board-election-location-label"
                      disabled={editLocks.settings}
                      value={form.location_label}
                      onChange={(event) => updateForm({ location_label: event.target.value })}
                      placeholder="Location label optional"
                    />
                  </Field>
                </div>

                {form.voting_access_mode === "location_range" ? (
                  <div className="board-election-setup-fields">
                    <Field id="board-election-geo-lat" label="Latitude" optional>
                      <input
                        id="board-election-geo-lat"
                        type="number"
                        required={form.voting_access_mode === "location_range"}
                        step="any"
                        disabled={editLocks.settings}
                      value={form.geo_lat}
                        onChange={(event) => updateForm({ geo_lat: event.target.value })}
                        placeholder="Latitude"
                      />
                    </Field>
                    <Field id="board-election-geo-lng" label="Longitude" optional>
                      <input
                        id="board-election-geo-lng"
                        type="number"
                        required={form.voting_access_mode === "location_range"}
                        step="any"
                        disabled={editLocks.settings}
                      value={form.geo_lng}
                        onChange={(event) => updateForm({ geo_lng: event.target.value })}
                        placeholder="Longitude"
                      />
                    </Field>
                    <Field id="board-election-geo-radius" label="Radius in meters" optional>
                      <input
                        id="board-election-geo-radius"
                        type="number"
                        required={form.voting_access_mode === "location_range"}
                        min="1"
                        disabled={editLocks.settings}
                      value={form.geo_radius_meters}
                        onChange={(event) => updateForm({ geo_radius_meters: event.target.value })}
                        placeholder="Radius in meters"
                      />
                    </Field>
                  </div>
                ) : null}
              </div>

              {tokensSupported ? (
                <div className="board-election-setup-group">
                  <div className="board-election-setup-group-heading">
                    <p className="board-election-setup-kicker">Access tokens / QR</p>
                    <QrCode size={17} aria-hidden="true" />
                  </div>
                  <p className="board-election-setup-note">
                    Issued tokens are scoped to this election. Disabling a token keeps the
                    record but stops it being accepted.
                  </p>

                  <div className="board-election-setup-fields">
                    <Field id="board-election-token-scope" label="Scope type">
                      <select
                        id="board-election-token-scope"
                        value={tokenForm.scope_type}
                        onChange={(event) =>
                          updateTokenForm({
                            scope_type: event.target.value,
                            scope_value:
                              event.target.value === "general" ? "" : tokenForm.scope_value,
                          })
                        }
                      >
                        {TOKEN_SCOPE_TYPES.map((scope) => (
                          <option key={scope.value} value={scope.value}>
                            {scope.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id="board-election-token-scope-value" label="Scope value" optional>
                      <input
                        id="board-election-token-scope-value"
                        value={tokenForm.scope_value}
                        onChange={(event) =>
                          updateTokenForm({ scope_value: event.target.value })
                        }
                        placeholder="Scope value"
                        disabled={tokenForm.scope_type === "general"}
                      />
                    </Field>
                    <Field id="board-election-token-expires" label="Expires" optional>
                      <input
                        id="board-election-token-expires"
                        type="datetime-local"
                        value={tokenForm.expires_at}
                        onChange={(event) => updateTokenForm({ expires_at: event.target.value })}
                      />
                    </Field>
                  </div>

                  <div className="board-election-setup-actions">
                    <button
                      type="button"
                      className="board-election-setup-quiet"
                      onClick={onCreateAccessToken}
                    >
                      Generate token
                    </button>
                  </div>

                  {accessTokens.length === 0 ? (
                    <p className="board-election-setup-empty">
                      No tokens yet for this election.
                    </p>
                  ) : (
                    <ul className="board-election-token-list">
                      {accessTokens.map((tokenRow) => (
                        <li key={tokenRow.id}>
                          <div className="board-election-token-copy">
                            <p className="board-election-token-value">{tokenRow.token}</p>
                            <p className="board-election-setup-kicker">
                              {tokenRow.scope_type}
                              {tokenRow.scope_value ? ` • ${tokenRow.scope_value}` : ""}
                            </p>
                            <p className="board-election-token-expiry">
                              Expires: {formatLocalDateTime(tokenRow.expires_at)}
                            </p>
                          </div>
                          <div className="board-election-token-actions">
                            <img
                              src={getAccessQrImageUrl(tokenRow.token)}
                              alt={`QR for ${tokenRow.token}`}
                            />
                            <button
                              type="button"
                              className="board-election-setup-quiet"
                              onClick={() => onToggleToken(tokenRow)}
                            >
                              <Power size={15} aria-hidden="true" />
                              {tokenRow.is_active ? "Disable" : "Enable"}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}

          {step === 3 ? (
            <section className="board-election-setup-section" aria-labelledby="board-election-setup-04">
              <div className="board-election-setup-heading">
                <p className="board-election-sheet-kicker">04</p>
                <div>
                  <h3 id="board-election-setup-04">Review</h3>
                  <p>
                    This is the election as it will be stored. Use the numbered sections
                    above to change anything before saving.
                  </p>
                </div>
              </div>

              <div className="board-election-brief">
                <section>
                  <span>Election</span>
                  <strong>{form.title || "Untitled Election"}</strong>
                  <p>{form.cover_url ? "Cover photo attached" : "No cover photo"}</p>
                </section>
                <section>
                  <span>Status</span>
                  <strong>
                    {STATUS_OPTIONS.find((option) => option.value === form.status)?.label ||
                      form.status}
                  </strong>
                </section>
                <section>
                  <span>Campaign</span>
                  <strong>{campaign.date}</strong>
                  <p>{campaign.time || "No campaign window set"}</p>
                </section>
                <section>
                  <span>Voting</span>
                  <strong>{voting.date}</strong>
                  <p>{voting.time || "No voting window set"}</p>
                </section>
                <section>
                  <span>Voting access</span>
                  <strong>
                    {getVotingAccessModeLabel(form.voting_access_mode)}
                  </strong>
                  <p>
                    {form.voting_access_mode === "location_range"
                      ? [form.location_label, form.geo_radius_meters && `${form.geo_radius_meters} m radius`]
                          .filter(Boolean)
                          .join(" · ") || "No location detail recorded"
                      : form.location_label || "Applies to every eligible voter"}
                  </p>
                </section>
                <section>
                  <span>Student results</span>
                  <strong>
                    {resultVisibilityOptionLabel(form.student_result_visibility)}
                  </strong>
                </section>
              </div>

              <p className="board-election-setup-note">
                {automaticEligibility
                  ? "Eligibility is checked automatically during voting using verified organization membership and term enrollment. Additional eligibility rules are optional. No electorate lock is required."
                  : "Saving stores this election record. Activating schedules electorate finalization automatically for ten minutes before voting starts; additional eligibility rules are optional."}
                {" "}Positions and candidates are configured afterwards in Manage Setup.
              </p>
              {isEditing && !automaticEligibility ? <ElectionElectoratePanel election={editing} form={form} onLocked={onElectorateLocked} /> : null}
            </section>
          ) : null}

          <div className="board-election-setup-actions board-election-setup-footer">
            <div>
              {step > 0 ? (
                <button
                  type="button"
                  className="board-election-setup-back"
                  onClick={() => goToStep(step - 1)}
                  disabled={submitting}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  Back
                </button>
              ) : (
                <button
                  type="button"
                  className="board-election-setup-back"
                  onClick={onClose}
                  disabled={submitting}
                >
                  Cancel
                </button>
              )}
            </div>

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                data-progressive-next="true"
                className="board-election-setup-next"
                onClick={() => goToStep(step + 1)}
                disabled={submitting}
              >
                Continue
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            ) : (
              <button type="submit" className="board-election-setup-next" disabled={submitting || coverUploading || Boolean(saveBlockedReason)} aria-describedby={saveBlockedReason ? "board-election-edit-restriction" : undefined}>
                {submitting ? (
                  <KandidButtonLoader label="Saving..." />
                ) : (
                  <>
                    {isEditing ? "Save changes" : "Create election"}
                    <ArrowRight size={16} aria-hidden="true" />
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </PopupOverlay>
  );
}
