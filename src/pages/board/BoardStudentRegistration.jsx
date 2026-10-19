import { useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { KandidButtonLoader } from "../../components/KandidLoader";
import { formatAcademicTerm } from "../../utils/academicTerms";
import { isSupabaseAdminAuthMode } from "../../utils/auth";
import { readImageFileAsCompressedDataUrl } from "../../utils/files";
import {
  boardStudentRegistrationFailureOutcome,
  boardStudentRegistrationOutcomeMessage,
  boardStudentRegistrationOutcomePresentation,
} from "../../utils/boardStudentRegistrationMessages";
import {
  resolveBoardStudentForTerm,
  registerNewBoardStudentForTerm,
  registerExistingBoardStudentForTerm,
} from "../../utils/boardManualEnrollment";
import "../superadmin/Students.css";

const EMPTY_DETAILS = {
  first_name: "", last_name: "", email: "", program: "", year_level: "",
  precinct_code: "", batch_code: "", photo_url: "",
};
const SUCCESS_OUTCOMES = new Set([
  "NEW_STUDENT_CREATED", "EXISTING_STUDENT_ENROLLED",
  "EXISTING_STUDENT_TERM_RESTORED", "EXISTING_STUDENT_ORGANIZATION_REGISTERED",
]);

function friendlyOutcome(outcome, fallback) {
  const specificMessage = boardStudentRegistrationOutcomeMessage(outcome, null);
  if (specificMessage) return specificMessage;
  switch (outcome) {
    case "INVALID_FORMAT": return "Enter a valid five-digit Student ID.";
    case "INVALID_INPUT": return "Check the student details and try again.";
    case "INVALID_TERM": return "There is no active academic term. Ask a Super Admin to activate one.";
    case "INELIGIBLE": return "This student is not eligible for your assigned organization.";
    case "NOT_CURRENTLY_ENROLLED": return "This student must be enrolled for the current academic term before joining this organization.";
    case "TERM_NOT_ACTIVE": return "The active academic term changed while this request was being checked. Refresh and review again.";
    case "ACTIVE_TERM_UNAVAILABLE": return "Current-term registration is unavailable because the active academic term could not be verified. Ask a Super Admin to review term setup.";
    case "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION": return "This student's official program is not eligible for your assigned organization.";
    case "UNSUPPORTED_ORGANIZATION_TYPE": return "This organization's membership setup needs administrator review.";
    case "NON_DEPARTMENTAL_NEW_STUDENT": return "An existing enrolled student record is required before joining this organization.";
    case "IDENTITY_RECHECK_REQUIRED": return "The student record changed. Check the Student ID again before continuing.";
    case "IDENTITY_RECONCILIATION_REQUIRED": return "This student record needs review by a Super Admin before registration.";
    default: return fallback;
  }
}

function outcomePresentation(outcome, orgName) {
  const specificPresentation = boardStudentRegistrationOutcomePresentation(outcome, orgName);
  if (specificPresentation) return specificPresentation;
  switch (outcome) {
    case "NOT_CURRENTLY_ENROLLED":
      return {
        heading: "Not currently enrolled",
        message: `This student must be officially enrolled for the current academic term before joining ${orgName}.`,
      };
    case "TERM_NOT_ACTIVE":
      return {
        heading: "Academic term needs attention",
        message: "The active academic term changed while this request was being checked. Refresh and review again.",
        configuration: true,
      };
    case "ACTIVE_TERM_UNAVAILABLE":
    case "INVALID_TERM":
      return {
        heading: "Academic term needs attention",
        message: "Current-term registration is unavailable because the active academic term could not be verified. Ask a Super Admin to review term setup.",
        configuration: true,
      };
    case "UNSUPPORTED_ORGANIZATION_TYPE":
      return {
        heading: "Organization setup needs attention",
        message: "This organization's membership setup needs administrator review.",
        configuration: true,
      };
    case "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION":
    case "INELIGIBLE":
      return {
        heading: "Program not eligible",
        message: "This student's official program is not eligible for your assigned organization.",
      };
    case "NON_DEPARTMENTAL_NEW_STUDENT":
      return {
        heading: "Existing student record required",
        message: `A student must be officially enrolled for the current academic term before joining ${orgName}.`,
        supporting: "This Board cannot create the student's institutional or departmental record.",
      };
    default:
      return null;
  }
}

function StudentField({ id, label, value, onChange, type = "text", required = false, optional = false, ...props }) {
  return (
    <div className="sa-registration-field">
      <label htmlFor={id}>{label} {optional ? <span>Optional</span> : null}</label>
      <input id={id} type={type} value={value} onChange={onChange} required={required} {...props} />
    </div>
  );
}

export default function BoardStudentRegistration({
  orgId, orgName, organizationType, activeTerm, activeTermLoading, activeTermError,
  onClose, onRegistered, onShowRemoved,
}) {
  const [step, setStep] = useState(1);
  const [studentNumber, setStudentNumber] = useState("");
  const [resolution, setResolution] = useState(null);
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [verificationMethod, setVerificationMethod] = useState("school_id");
  const [evidenceReviewed, setEvidenceReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [resolvedState, setResolvedState] = useState("");
  const isNew = resolution?.outcome === "NEW_STUDENT";
  const student = resolution?.student;
  const termContext = resolution?.academic_term || activeTerm;
  const termLabel = termContext ? formatAcademicTerm(termContext) : "current term";
  const isNonDepartmental = organizationType === "non_departmental";
  const hasSupportedOrganizationType = organizationType === "departmental" || isNonDepartmental;
  const studentName = isNew
    ? [details.first_name, details.last_name].filter(Boolean).join(" ")
    : [student?.first_name, student?.last_name].filter(Boolean).join(" ");

  function returnToId() {
    setStep(1);
    setResolution(null);
    setResolvedState("");
    setError("");
    setErrorCode("");
  }

  function showOutcomeError(outcome, fallback) {
    setErrorCode(outcome || "");
    setError(friendlyOutcome(outcome, fallback));
  }

  const feedback = error ? (() => {
    const presentation = outcomePresentation(errorCode, orgName);
    if (!presentation) return <p className="sa-registration-error" role="alert">{error}</p>;
    return (
      <div className={`sa-registration-error board-registration-feedback${presentation.configuration ? " is-configuration" : ""}`} role="alert">
        <strong>{presentation.heading}</strong>
        <p>{presentation.message}</p>
        {presentation.supporting ? <small>{presentation.supporting}</small> : null}
      </div>
    );
  })() : null;

  function applyOutcome(data) {
    if (data?.organization_outcome === "ALREADY_MEMBER") {
      setResolvedState("already");
      return true;
    }
    if (data?.organization_outcome === "RESTORATION_REQUIRED" || data?.outcome === "RESTORATION_REQUIRED") {
      setResolvedState("removed");
      return true;
    }
    return false;
  }

  async function checkStudentId(event) {
    event.preventDefault();
    if (busy) return;
    const number = studentNumber.trim();
    setError("");
    setErrorCode("");
    if (!number) { setError("Enter the student's ID number."); return; }
    if (!orgId) { setError("No organization is assigned to this Board account."); return; }
    if (!hasSupportedOrganizationType) {
      showOutcomeError("UNSUPPORTED_ORGANIZATION_TYPE", "This organization's membership setup needs administrator review.");
      return;
    }
    if (!isSupabaseAdminAuthMode()) { setError("Use the secure Electoral Board sign-in to register students."); return; }
    if (activeTermLoading) { setError("Checking the active academic term. Try again in a moment."); return; }
    if (!activeTerm) { setError(activeTermError || "An active academic term is required."); return; }

    setBusy(true);
    try {
      const { data, error: requestError, code, status } = await resolveBoardStudentForTerm(number);
      if (applyOutcome(data)) return;
      if (requestError || !data) {
        const outcome = boardStudentRegistrationFailureOutcome(data, code, status);
        showOutcomeError(outcome, "We couldn't check this Student ID right now. Try again.");
        return;
      }
      if (data.outcome === "STUDENT_IDENTITY_NOT_FOUND") {
        setDetails(EMPTY_DETAILS);
        setResolution({ ...data, outcome: "NEW_STUDENT", student: null });
        setStep(2);
        return;
      }
      if (data.outcome === "NEW_STUDENT" || (data.student && [
        "AVAILABLE_FOR_ORGANIZATION", "ACTIVATION_SYNC_REQUIRED", "NOT_CURRENTLY_ENROLLED", "ALREADY_MEMBER",
      ].includes(data.organization_outcome))) {
        setStudentNumber(number);
        setDetails({
          ...EMPTY_DETAILS,
          first_name: data.student?.first_name || "",
          last_name: data.student?.last_name || "",
          email: data.student?.email || "",
          program: data.student?.program || "",
          year_level: data.student?.year_level ? String(data.student.year_level) : "",
        });
        setEvidenceReviewed(false);
        setResolution(data);
        setStep(2);
        return;
      }
      if (data.organization_outcome === "PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION") {
        setStudentNumber(number);
        setDetails(EMPTY_DETAILS);
        setEvidenceReviewed(false);
        setResolution({ ...data, outcome: "EXISTING_STUDENT_NEW_TERM", student: null });
        setStep(2);
        return;
      }
      const outcome = data.outcome === "INELIGIBLE" ? data.outcome : data.organization_outcome;
      showOutcomeError(outcome, "This student cannot be registered here. Ask a Super Admin to review the record.");
    } catch {
      setError("We couldn't check this Student ID right now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function continueToReview(event) {
    event.preventDefault();
    if (isNew) {
      const year = Number(details.year_level);
      if (!details.first_name.trim() || !details.last_name.trim() || !details.program.trim() ||
          !Number.isInteger(year) || year < 1 || year > 6) {
        setError("Complete the student's name, program, and year level (1–6).");
        return;
      }
    } else if (!Number.isInteger(Number(details.year_level)) || Number(details.year_level) < 1 || Number(details.year_level) > 6) {
      setError("Enter this student's current year level (1–6) to complete term registration.");
      return;
    }
    if (!evidenceReviewed || !["school_id", "registration_form", "department_masterlist"].includes(verificationMethod)) {
      setError("Confirm that valid enrollment evidence has been reviewed for the active semester.");
      return;
    }
    setError("");
    setErrorCode("");
    setStep(3);
  }

  async function uploadPhoto(file) {
    if (!file) return;
    try {
      const photo = await readImageFileAsCompressedDataUrl(file);
      setDetails((current) => ({ ...current, photo_url: photo }));
      setError("");
    } catch {
      setError("We couldn't read that photo. Choose another image or continue without one.");
    }
  }

  async function submitRegistration(event) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setErrorCode("");
    setBusy(true);
    try {
      const response = isNew
        ? await registerNewBoardStudentForTerm({
            student_number: studentNumber,
            first_name: details.first_name.trim(),
            last_name: details.last_name.trim(),
            email: details.email.trim(),
            program: details.program.trim(),
            year_level: Number(details.year_level),
            precinct_code: details.precinct_code.trim() || null,
            batch_code: details.batch_code.trim() || null,
            photo_url: details.photo_url || null,
          }, { method: verificationMethod, evidenceReviewed })
        : await registerExistingBoardStudentForTerm({
            student_number: studentNumber,
            first_name: details.first_name.trim(),
            last_name: details.last_name.trim(),
            email: details.email.trim(),
            program: details.program.trim(),
            year_level: Number(details.year_level),
          }, { method: verificationMethod, evidenceReviewed });
      if (applyOutcome(response.data)) return;
      if (response.error || !SUCCESS_OUTCOMES.has(response.data?.outcome) ||
          response.data?.organization_outcome !== "REGISTERED") {
        showOutcomeError(response.data?.outcome,
          "Registration couldn't be completed. Check the student record and try again.");
        return;
      }
      await onRegistered();
    } catch {
      setError("Registration couldn't be completed right now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const progress = (
    <ol className="sa-registration-progress" aria-label="Registration progress">
      {(isNonDepartmental
        ? ["Find student", "Verify eligibility", "Review and add"]
        : ["Student ID", "Student details", "Review"]
      ).map((label, index) => (
        <li key={label} className={step === index + 1 ? "is-current" : step > index + 1 ? "is-complete" : ""}
          aria-current={step === index + 1 ? "step" : undefined}>
          <span>{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong>
        </li>
      ))}
    </ol>
  );
  const backButton = (target, label = "Back") => (
    <button type="button" className="secondary-btn" onClick={target} disabled={busy}>
      <ArrowLeft size={16} aria-hidden="true" />{label}
    </button>
  );
  const primaryButton = (label, loadingLabel) => (
    <button type="submit" className="primary-btn" disabled={busy || activeTermLoading}>
      {busy || activeTermLoading ? <KandidButtonLoader label={activeTermLoading ? "Checking term..." : loadingLabel} /> : <>{label}<ArrowRight size={16} aria-hidden="true" /></>}
    </button>
  );

  return (
    <PopupOverlay>
      <div className="popup-sheet popup-sheet-wide sa-students-modal is-registration board-student-registration"
        role="dialog" aria-modal="true" aria-labelledby="board-registration-title">
        <div className="popup-header">
          <div className="popup-header-copy">
            <h2 id="board-registration-title" className="surface-title">Add Student</h2>
            <p className="surface-copy">
              {activeTermLoading ? "Checking the current academic term..." : activeTerm
                ? `Registration for ${orgName} · ${termLabel}`
                : activeTermError || "An active academic term is required."}
            </p>
          </div>
          <button type="button" className="popup-close" onClick={onClose} aria-label="Close add student" disabled={busy}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        {resolvedState ? (
          <div className="popup-content sa-registration-workspace">
            {progress}
            <div className="sa-registration-focus">
              <p className="sa-registration-kicker">{resolvedState === "already" ? "Already registered" : "Previously removed"}</p>
              <h3>{resolvedState === "already" ? "Already a member." : "Use Restore for this student."}</h3>
              <p>{resolvedState === "already"
                ? `This student is already an active ${orgName} member for ${termLabel}.`
                : `This student already has a ${orgName} record for ${termLabel}, but the membership was removed.`}</p>
            </div>
            <div className="sa-registration-actions">
              {backButton(returnToId, "Check another ID")}
              <button type="button" className="primary-btn" onClick={resolvedState === "already" ? onClose : onShowRemoved}>
                {resolvedState === "already" ? "Close" : "View removed students"}<ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : step === 1 ? (
          <form className="popup-content sa-registration-workspace" onSubmit={checkStudentId}>
            {progress}
            <div className="sa-registration-focus">
              <h3>Who is the student?</h3>
              <p>Enter the Student ID to find or create the identity, then verify enrollment evidence for the active term.</p>
            </div>
            <div className="sa-registration-field board-registration-id-field">
              <label htmlFor="registration-student-id">Student ID</label>
              <input id="registration-student-id" value={studentNumber} onChange={(event) => { setStudentNumber(event.target.value); setError(""); setErrorCode(""); }}
                inputMode="numeric" autoComplete="off" required aria-invalid={Boolean(error)} />
            </div>
            {feedback}
            <div className="sa-registration-actions">
              <button type="button" className="secondary-btn" onClick={onClose} disabled={busy}>Cancel</button>
              {primaryButton("Check Student ID", "Checking...")}
            </div>
          </form>
        ) : step === 2 ? (
          <form className="popup-content sa-registration-workspace" onSubmit={continueToReview}>
            {progress}
            <div className="sa-registration-heading">
              <div><h3>{isNew ? "Student details" : isNonDepartmental ? "Eligibility verified" : "Student found"}</h3></div>
              <div><span>{studentNumber}</span><strong>Student ID · Read only</strong></div>
            </div>
            {isNew ? (
              <>
                <p className="sa-registration-kicker">Student information</p>
                <div className="sa-registration-fields">
                  <StudentField id="board-registration-first" label="First name" value={details.first_name} required
                    onChange={(event) => setDetails((current) => ({ ...current, first_name: event.target.value }))} />
                  <StudentField id="board-registration-last" label="Last name" value={details.last_name} required
                    onChange={(event) => setDetails((current) => ({ ...current, last_name: event.target.value }))} />
                  <StudentField id="board-registration-email" label="Email" value={details.email} type="email" optional
                    onChange={(event) => setDetails((current) => ({ ...current, email: event.target.value }))} />
                </div>
                <p className="sa-registration-kicker">Academic information</p>
                <div className="sa-registration-fields">
                  <StudentField id="board-registration-program" label="Program" value={details.program} required
                    onChange={(event) => setDetails((current) => ({ ...current, program: event.target.value }))} />
                  <StudentField id="board-registration-year" label="Year level" value={details.year_level} type="number" min="1" max="6" required
                    onChange={(event) => setDetails((current) => ({ ...current, year_level: event.target.value }))} />
                </div>
                <details className="board-registration-optional">
                  <summary>Optional details</summary>
                  <div className="sa-registration-fields">
                    <StudentField id="board-registration-precinct" label="Precinct code" value={details.precinct_code}
                      onChange={(event) => setDetails((current) => ({ ...current, precinct_code: event.target.value }))} />
                    <StudentField id="board-registration-batch" label="Batch code" value={details.batch_code}
                      onChange={(event) => setDetails((current) => ({ ...current, batch_code: event.target.value }))} />
                    <StudentField id="board-registration-photo-url" label="Photo URL" value={details.photo_url.startsWith("data:") ? "" : details.photo_url}
                      onChange={(event) => setDetails((current) => ({ ...current, photo_url: event.target.value }))} />
                    <div className="sa-registration-field">
                      <label htmlFor="board-registration-photo">Student photo</label>
                      <input id="board-registration-photo" type="file" accept="image/*" onChange={(event) => uploadPhoto(event.target.files?.[0])} />
                      {details.photo_url.startsWith("data:") ? <small>Photo selected</small> : null}
                    </div>
                  </div>
                </details>
              </>
            ) : (
              <>
                <div className="sa-registration-identity">
                  <p>{studentName ? "Existing student record" : "Student ID found"}</p><h3>{studentName || "Enter reviewed details"}</h3>
                  <strong>Student ID {studentNumber}</strong>
                  <span>{studentName ? "Changes apply to the active-term registration. Earlier terms remain unchanged." : "The current program is outside this Board's scope. Continue only if reviewed evidence confirms a program covered by this Board."}</span>
                </div>
                {resolution?.organization_outcome === "NOT_CURRENTLY_ENROLLED" ? (
                  <div className="sa-registration-note" role="status">
                    <strong>Existing identity, new term enrollment</strong>
                    <p>No active-term enrollment record was found. Continue only if the reviewed school ID, Registration Form, or official masterlist confirms current enrollment. Earlier term history is preserved.</p>
                  </div>
                ) : null}
                <p className="sa-registration-kicker">Correct student details if the reviewed evidence shows an update</p>
                <div className="sa-registration-fields">
                  <StudentField id="board-registration-existing-first" label="First name" value={details.first_name} required
                    onChange={(event) => setDetails((current) => ({ ...current, first_name: event.target.value }))} />
                  <StudentField id="board-registration-existing-last" label="Last name" value={details.last_name} required
                    onChange={(event) => setDetails((current) => ({ ...current, last_name: event.target.value }))} />
                  <StudentField id="board-registration-existing-email" label="Email" value={details.email} type="email" optional
                    onChange={(event) => setDetails((current) => ({ ...current, email: event.target.value }))} />
                  <StudentField id="board-registration-existing-program" label="Current program" value={details.program} required
                    onChange={(event) => setDetails((current) => ({ ...current, program: event.target.value }))} />
                  <StudentField id="board-registration-existing-year" label="Current year level" value={details.year_level} type="number" min="1" max="6" required
                    onChange={(event) => setDetails((current) => ({ ...current, year_level: event.target.value }))} />
                </div>
                <div className="sa-registration-note">
                  <strong>Registering for {orgName}</strong>
                  <p>{termLabel}. Program eligibility is checked against trusted organization coverage when registration is submitted.</p>
                </div>
              </>
            )}
            <div className="sa-registration-field">
              <label htmlFor="board-registration-verification-method">Enrollment evidence reviewed</label>
              <select id="board-registration-verification-method" value={verificationMethod}
                onChange={(event) => { setVerificationMethod(event.target.value); setEvidenceReviewed(false); }}>
                <option value="school_id">Valid school ID for the active semester</option>
                <option value="registration_form">Official Registration Form (RF)</option>
                <option value="department_masterlist">Official department masterlist</option>
              </select>
              <label className="board-registration-evidence-confirm">
                <input type="checkbox" checked={evidenceReviewed}
                  onChange={(event) => setEvidenceReviewed(event.target.checked)} />
                I reviewed this evidence and confirm the student is enrolled for {termLabel}.
              </label>
            </div>
            {feedback}
            <div className="sa-registration-actions">
              {backButton(returnToId, "Student ID")}
              {primaryButton("Continue to review", "Continuing...")}
            </div>
          </form>
        ) : (
          <form className="popup-content sa-registration-workspace" onSubmit={submitRegistration}>
            {progress}
            <div className="sa-registration-heading"><div><h3>Review registration</h3></div></div>
            <div className="sa-registration-review">
              <section><span>Student</span><strong>{studentName || studentNumber}</strong><p>Student ID {studentNumber}</p>
                {isNew && details.email ? <small>{details.email}</small> : null}</section>
              <section><span>Active-term academic record</span><strong>{details.program}</strong>
                <p>Year {details.year_level} · {termLabel}</p></section>
              <section><span>Registering to</span><strong>{orgName}</strong><p>{termLabel}</p>
                {isNew ? <small>Account: Pending setup</small> : <small>Historical term enrollments are preserved.</small>}</section>
              <section><span>Enrollment evidence</span><strong>{verificationMethod.replaceAll("_", " ")}</strong>
                <p>Reviewed and confirmed for {termLabel}</p></section>
            </div>
            {feedback}
            <div className="sa-registration-actions">
              {backButton(() => { setStep(2); setError(""); })}
              {primaryButton("Register student", "Registering...")}
            </div>
          </form>
        )}
      </div>
    </PopupOverlay>
  );
}
