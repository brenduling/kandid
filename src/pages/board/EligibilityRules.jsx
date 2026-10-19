import { useCallback, useEffect, useRef, useState } from "react";
import "./BoardRemainingPages.css";
/* The Add Student form system. The same import OfficerFormDialog.jsx and
   Partylists.jsx use, for the same reason: the sa-students-modal.is-registration
   shell plus the sa-registration-* primitives are the established Kandid guided
   form, and reusing them is what makes Add Rule read as the same product as Add
   Student rather than a lookalike. */
import "../superadmin/Students.css";
import "./EligibilityRules.css";
import { Plus, Ellipsis, X, ArrowLeft, ArrowRight } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { KandidButtonLoader } from "../../components/KandidLoader";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../../utils/deleteGuards";
import {
  createEligibilityRuleSubmission, deleteEligibilityRule, eligibilityRuleErrorMessage,
  loadEligibilityBoardContext, loadEligibilityPrograms, saveEligibilityRuleEdit, validateEligibilityRuleValues,
} from "../../utils/eligibilityRuleManagement";

/* --- rule readers -------------------------------------------------------------
   Presentation only. Every function below restates exactly what a stored row
   contains and never fills in a value the row does not have.

   This matters because min_year_level and max_year_level are independently
   nullable. A missing bound is a real, common state, and the only other reader
   of these columns agrees it carries no implied limit:
   src/utils/resultDimensions.js:33-45 (addYearRange) emits no year levels at all
   when either bound is null rather than assuming a floor or a ceiling.

   So a rule with only a lower bound does not mean "Years 2 and above" as an
   enforced range - it means Year 2 is the recorded floor and no ceiling was
   recorded. That is what these readers say, and the missing-bound clarification
   is rendered alongside the lead phrase rather than folded into it. */

function indexLabel(index) {
  return String(index + 1).padStart(2, "0");
}

function programCoverage(rule) {
  const program = String(rule.program || "").trim();

  if (program) {
    return { lead: `${program} students`, gap: "" };
  }
  return { lead: "All programs", gap: "no program specified" };
}

function yearCoverage(rule) {
  const min = rule.min_year_level;
  const max = rule.max_year_level;
  const hasMin = min !== null && min !== undefined && min !== "";
  const hasMax = max !== null && max !== undefined && max !== "";

  if (hasMin && hasMax) return { lead: `Years ${min}–${max}`, gap: "" };
  if (hasMin) return { lead: `Year ${min} and above`, gap: "no upper bound set" };
  if (hasMax) return { lead: `Up to Year ${max}`, gap: "no lower bound set" };
  return { lead: "No year-level bounds set", gap: "" };
}

/* allow_shs is a two-state column, so unlike the year bounds it always states
   something definite: "Not included" is a recorded fact about this rule, not an
   inference. Rendered inline as two spans so the condition and its value can sit
   on one line either side of a separator. */

function hasGap(coverage) {
  return Boolean(coverage.gap);
}

/* --- overflow menu ------------------------------------------------------------
   The mobile overflow treatment already established by the Officer record and
   Partylists: closes on an outside pointer press and on Escape, and the trigger
   reports its state. Desktop does not use this - it has room for the inline
   EDIT / DELETE pair. Items call the page's existing openEdit and handleDelete,
   so the delete confirmation, dependency analysis, blocked audit event and
   recheck are the same whichever control is used. */
function RuleActionsMenu({ label, items, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="board-eligibility-menu" ref={ref}>
      <button
        type="button"
        className="board-eligibility-menu-trigger"
        aria-expanded={open}
        aria-label={`Actions for ${label}`}
        title={`Actions for ${label}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="board-eligibility-menu-list">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={disabled}
              className={`board-eligibility-menu-item${item.danger ? " is-danger" : ""}`}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BoardEligibilityRules() {
  const prompt = usePrompt();
  const loaded = useRef(false);
  const submission = useRef(null);
  const mutationPending = useRef(false);
  const [user, setUser] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [rules, setRules] = useState([]);
  const [elections, setElections] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [rulesRefreshing, setRulesRefreshing] = useState(false);
  const [rulesError, setRulesError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  /* Guided-form state. Step navigation and the busy flag are the only additions
     to the old single-screen modal; the payload below is unchanged. */
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    election_id: "",
    program: "",
    min_year_level: "",
    max_year_level: "",
    allow_shs: false,
  });

  const orgId = user?.organization_id;
  const orgName = user?.organizations?.name || "your organization";

  const fetchRules = useCallback(async () => {
    if (!loaded.current) setRulesLoading(true);
    else setRulesRefreshing(true);
    setRulesError("");

    try {
      const board = await loadEligibilityBoardContext(supabase);
      setUser(board);
      setPrograms(await loadEligibilityPrograms(supabase));

      const { data: orgElections, error: electionError } = await supabase
        .from("elections")
        .select("id, title, academic_term_id, removed_at")
        .eq("organization_id", board.organization_id)
        .order("created_at", { ascending: false });
      if (electionError) throw electionError;
      const electionRows = orgElections || [];
      setElections(electionRows);
      const electionIds = electionRows.map((election) => election.id);

      if (electionIds.length === 0) {
        setRules([]);
        loaded.current = true;
        setRulesLoaded(true);
        return;
      }

      const { data, error } = await supabase
        .from("eligibility_rules")
        .select(`
          *,
          elections (
            title
          )
        `)
        .in("election_id", electionIds)
        .order("id", { ascending: true });
      if (error) throw error;
      setRules(data || []);
      loaded.current = true;
      setRulesLoaded(true);
    } catch (error) {
      console.error("Failed to load Board eligibility rules:", error);
      if (error?.code === "RULE_AUTH") setUser(null);
      setRulesError(error?.code?.startsWith("RULE_") ? eligibilityRuleErrorMessage(error) : "Eligibility rules could not be loaded. Refresh and try again.");
    } finally {
      setRulesLoading(false);
      setRulesRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) fetchRules(); });
    return () => { active = false; };
  }, [fetchRules]);

  function openCreate() {
    submission.current = createEligibilityRuleSubmission(supabase);
    setEditing(null);
    setForm({
      election_id: "",
      program: "",
      min_year_level: "",
      max_year_level: "",
      allow_shs: false,
    });
    setStep(1);
    setFormOpen(true);
  }

  function openEdit(rule) {
    setEditing(rule);
    setForm({
      election_id: rule.election_id || "",
      program: rule.program || "",
      min_year_level: rule.min_year_level || "",
      max_year_level: rule.max_year_level || "",
      allow_shs: rule.allow_shs || false,
    });
    setStep(1);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setStep(1);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (mutationPending.current || !user) return;
    if (step < 3) { goNext(); return; }

    mutationPending.current = true;
    setBusy(true);
    try {
      const { error } = editing
        ? await saveEligibilityRuleEdit(supabase, editing, form, orgId)
        : await submission.current(form, orgId);
      if (error) {
        prompt.error(eligibilityRuleErrorMessage(error));
        return;
      }
      prompt.success(editing ? "Eligibility rule updated." : "Eligibility rule created.");
      closeForm();
      await fetchRules();
    } catch {
      prompt.error("The eligibility rule could not be saved. No success was confirmed. Try again.");
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  }

  async function handleDelete(rule) {
    if (mutationPending.current || !user) return;
    mutationPending.current = true;
    setDeletingId(rule.id);
    try {
      const id = rule.id;
      const label = `${rule.elections?.title || "Election"} eligibility rule`;
      const analysis = await analyzeDeleteDependencies("eligibility_rule", rule);

      if (analysis.blocked) {
        await logAuditEvent({
          action: "eligibility_rule_delete_blocked",
          entityType: "eligibility_rule",
          entityId: id,
          entityLabel: label,
          organizationId: orgId,
          organizationName: user?.organizations?.name,
          status: "requires_action",
          metadata: { dependencies: analysis.dependencies },
        });
        await prompt.alert({
          title: "Eligibility Rule Is Historical",
          message: dependencyMessage(label, analysis),
          type: "warning",
          confirmText: "Review Rule",
        });
        return;
      }

      const ok = await prompt.confirm({
        title: "Delete Eligibility Rule?",
        message: dependencyMessage(label, analysis),
        type: "danger",
        confirmText: "Delete Rule",
      });
      if (!ok) return;

      const recheck = await analyzeDeleteDependencies("eligibility_rule", rule);
      if (recheck.blocked) {
        prompt.error(dependencyMessage(label, recheck));
        return;
      }

      const { error } = await deleteEligibilityRule(supabase, rule, orgId);
      if (error) {
        prompt.error(eligibilityRuleErrorMessage(error));
        return;
      }
      prompt.success("Eligibility rule deleted.");
      await logAuditEvent({
        action: "eligibility_rule_deleted",
        entityType: "eligibility_rule",
        entityId: id,
        entityLabel: label,
        organizationId: orgId,
        organizationName: user?.organizations?.name,
        status: "completed",
      });
      await fetchRules();
    } catch {
      prompt.error("Rule deletion could not be confirmed. Refresh before trying again.");
    } finally {
      mutationPending.current = false;
      setDeletingId(null);
    }
  }

  /* --- guided form --------------------------------------------------------
     Step navigation and the progress rail, matching Add Student and Add
     Officer. Nothing here writes: it only moves between steps. */

  const steps = ["Election", "Eligibility", "Review"];

  const progress = (
    <ol
      className="sa-registration-progress"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      aria-label={editing ? "Edit eligibility rule progress" : "Add eligibility rule progress"}
    >
      {steps.map((label, index) => (
        <li
          key={label}
          className={step === index + 1 ? "is-current" : step > index + 1 ? "is-complete" : ""}
          aria-current={step === index + 1 ? "step" : undefined}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{label}</strong>
        </li>
      ))}
    </ol>
  );

  let validationError = "";
  if (form.election_id) {
    try { validateEligibilityRuleValues(form); } catch (error) { validationError = eligibilityRuleErrorMessage(error); }
  }
  const canContinue = Boolean(form.election_id) && (step === 1 || !validationError);

  function goNext() {
    if (!canContinue) return;
    setStep((current) => Math.min(current + 1, steps.length));
  }

  function goBack() {
    setStep((current) => Math.max(current - 1, 1));
  }

  /* The review reads the live form state through the same readers the directory
     uses, so a rule cannot look one way while being confirmed and another way
     once saved. */
  const draft = {
    program: form.program,
    min_year_level: form.min_year_level === "" ? null : Number(form.min_year_level),
    max_year_level: form.max_year_level === "" ? null : Number(form.max_year_level),
    allow_shs: form.allow_shs,
  };
  const draftElection = elections.find((election) => String(election.id) === String(form.election_id));
  const draftProgram = programCoverage(draft);
  const draftYears = yearCoverage(draft);

  const formTitle = editing ? "Edit Eligibility Rule" : "Add Eligibility Rule";
  const formSubtitle = editing
    ? `Update the recorded audience for ${editing.elections?.title || "this election"}.`
    : `Record the intended audience for an election under ${orgName}.`;

  return (
    <div className="board-remaining-page board-eligibility">
      <header className="board-eligibility-masthead">
        <div className="board-eligibility-context">
          <span className="board-eligibility-eyebrow">Electoral Board / {orgName}</span>
          <span className="board-eligibility-context-rule" aria-hidden="true" />
        </div>

        <div className="board-eligibility-baseline">
          <h1 className="page-title board-eligibility-title">Eligibility rules</h1>
          <div className="board-eligibility-header-actions">
            <button type="button" className="board-eligibility-action" onClick={fetchRules} disabled={rulesLoading || rulesRefreshing || busy || deletingId !== null}>Refresh</button>
            <button
              type="button"
              onClick={openCreate}
              className="board-eligibility-create"
              disabled={!user || rulesLoading || busy || deletingId !== null}
            >
              <Plus size={15} aria-hidden="true" />
              Add Rule
            </button>
          </div>
        </div>

        <p className="board-eligibility-standfirst">
          Define the intended audience for elections under {orgName}.
        </p>
        <p className="board-eligibility-note">
          Declared audience only. These rules do not grant or restrict voting access,
          change organization membership, or replace the locked electorate.
        </p>
      </header>

      {rulesError && rulesLoaded ? (
        <div className="board-eligibility-load-error" role="status">
          <span>{rulesError}</span>
          <button type="button" onClick={fetchRules}>Retry</button>
        </div>
      ) : null}
      {rulesRefreshing ? <p className="board-eligibility-refreshing" role="status">Refreshing eligibility rules…</p> : null}
      {deletingId !== null ? <p className="board-eligibility-refreshing" role="status">Checking rule deletion...</p> : null}

      {rulesLoading && !rulesLoaded ? (
        <div className="board-eligibility-skeleton" role="status" aria-label="Loading election eligibility" aria-busy="true">
          {[0, 1, 2].map((row) => <div className="board-eligibility-skeleton-row" key={row}><span /><span /><span /></div>)}
        </div>
      ) : rulesError && !rulesLoaded ? (
        <div className="board-eligibility-empty is-error" role="alert">
          <p className="board-eligibility-empty-kicker">Rules unavailable</p>
          <h2>{rulesError}</h2>
          <button type="button" onClick={fetchRules} className="board-eligibility-empty-action">Retry</button>
        </div>
      ) : rules.length === 0 ? (
        <div className="board-eligibility-empty">
          <p className="board-eligibility-empty-kicker">No eligibility rules yet</p>
          <h2>Define the intended audience for this organization&apos;s elections.</h2>
          <button type="button" onClick={openCreate} className="board-eligibility-empty-action" disabled={!user || busy || deletingId !== null}>
            <Plus size={15} aria-hidden="true" />
            Add Rule
          </button>
        </div>
      ) : (
        <>
          <section className="board-eligibility-register" aria-label="Declared eligibility">
          {/*
            Section head, structured like the Ballot Positions register head: an
            orange eyebrow, a serif Level 2 heading and the record count on the
            outer edge, above a 2px rule that opens the section.

            The note is truthful because these rows are not read when a vote is
            authorized: submit-vote/index.ts:296-311 resolves access through
            resolve_student_organization_participation, which reads term
            enrollment and organization membership and never reads
            eligibility_rules. The only other reader of this table is
            resultDimensions.js, which uses the rows to seed expected result
            labels. It stays small supporting copy under the heading.
          */}
          <div className="board-eligibility-register-head">
            <div>
              <p className="board-eligibility-section-kicker">Election audience</p>
              <h2>Declared eligibility</h2>
            </div>

            {/* The count reads the real rule total. It was indexLabel(0), which
                is the row numbering helper and so rendered "01" on every screen
                regardless of how many rules existed. */}
            <span className="board-eligibility-register-count">
              <strong>{String(rules.length).padStart(2, "0")}</strong>
              <span className="board-eligibility-register-count-word">
                {rules.length === 1 ? "rule" : "rules"}
              </span>
            </span>
          </div>

          <p className="board-eligibility-note">
            These rules describe the intended election audience. Vote access is resolved
            separately from enrollment and organization membership.
          </p>

{/* A div of articles, not an ordered list: the visible index
                  already states each rule's position, and an ol would announce
                  the same fact twice. This matches the Positions and Officers
                  registers. */}
              <div className="board-eligibility-list">
                {rules.map((rule, index) => {
                  const electionTitle = rule.elections?.title || "Unknown election";
                  const program = programCoverage(rule);
                  const years = yearCoverage(rule);

                  return (
                    <article key={rule.id} className="board-eligibility-item">
                  <span className="board-eligibility-index" aria-hidden="true">
                      {indexLabel(index)}
                    </span>

                  {/* One record on the Ballot Positions rhythm: order number, then the
                      position name, then the declared audience beneath it, then
                      the controls at the right edge. The election is the rule's
                      primary line and the audience is directly under it. */}
                  <div className="board-eligibility-context">
                    <h3 className="board-eligibility-election">{electionTitle}</h3>

                    {/* Program coverage and year coverage share one line; the SHS
                        condition follows on its own line, the way Positions
                        carries Max selections and Status as separate tracks. */}
                    <p className="board-eligibility-audience">
                      {program.lead}
                      {hasGap(program) && (
                        <span className="board-eligibility-gap"> — {program.gap}</span>
                      )}
                      <span aria-hidden="true"> · </span>
                      {years.lead}
                      {hasGap(years) && (
                        <span className="board-eligibility-gap"> — {years.gap}</span>
                      )}
                    </p>

                    <p className="board-eligibility-shs">
                      Senior High School {rule.allow_shs ? "included" : "not included"}
                    </p>
                  </div>

                  {/* Desktop has room, so the two actions are shown rather than
                      hidden. Both call the existing handlers, so the delete
                      confirmation, dependency analysis, blocked audit event,
                      recheck and audit log are identical either way. Mobile
                      renders the overflow menu below and hides this pair. */}
                  <div className="board-eligibility-actions">
                    <button
                      type="button"
                      className="board-eligibility-action"
                      onClick={() => openEdit(rule)}
                      disabled={busy || deletingId !== null || !!elections.find((election) => election.id === rule.election_id)?.removed_at}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="board-eligibility-action is-danger"
                      onClick={() => handleDelete(rule)}
                      disabled={busy || deletingId !== null || !!elections.find((election) => election.id === rule.election_id)?.removed_at}
                    >
                      Delete
                    </button>
                  </div>

                  <RuleActionsMenu
                    label={electionTitle}
                    disabled={busy || deletingId !== null || !!elections.find((election) => election.id === rule.election_id)?.removed_at}
                    items={[
                      { label: "Edit rule", onSelect: () => openEdit(rule) },
                      { label: "Delete rule", danger: true, onSelect: () => handleDelete(rule) },
                    ]}
                  />
                </article>
              );
            })}
          </div>
          </section>
        </>
      )}

      {formOpen && (
        <PopupOverlay>
          <div
            className="popup-sheet popup-sheet-wide sa-students-modal is-registration board-eligibility-registration"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rule-form-title"
          >
            <div className="popup-header">
              <div className="popup-header-copy">
                <h2 id="rule-form-title" className="surface-title">{formTitle}</h2>
                <p className="surface-copy">{formSubtitle}</p>
              </div>
              <button
                type="button"
                className="popup-close"
                onClick={closeForm}
                aria-label="Close eligibility rule form"
                disabled={busy}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <form className="popup-content sa-registration-workspace" onSubmit={handleSubmit}>
              {progress}

              {step === 1 ? (
                <>
                  <div className="sa-registration-focus">
                    <h3>Which election is this rule for?</h3>
                    <p>Each rule belongs to exactly one election.</p>
                  </div>

                  <div className="sa-registration-field board-eligibility-election-field">
                    <label htmlFor="rule-election">Election</label>
                    <select
                      id="rule-election"
                      disabled={Boolean(editing)}
                      required
                      value={form.election_id}
                      onChange={(e) => setForm({ ...form, election_id: e.target.value })}
                    >
                      <option value="">Select election</option>
                      {elections.map((election) => (
                        <option key={election.id} value={election.id} disabled={!!election.removed_at}>
                          {election.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : step === 2 ? (
                <>
                  <div className="sa-registration-focus">
                    <h3>Who is this election intended for?</h3>
                    <p>Record the audience this election is declared for.</p>
                  </div>

                  <div className="sa-registration-field board-eligibility-program-field">
                    <label htmlFor="rule-program">Program</label>
                    <input
                      id="rule-program"
                      list="rule-program-catalog"
                      maxLength={100}
                      value={form.program}
                      onChange={(e) => setForm({ ...form, program: e.target.value })}
                      placeholder="e.g. BSIT"
                      autoComplete="off"
                    />
                    <datalist id="rule-program-catalog">{programs.map((program) => <option key={program.code} value={program.code}>{program.name}</option>)}</datalist>
                    <small>Use a program code from the catalog. Leave unset to declare all programs.</small>
                  </div>

                  {/* The two bounds read as one range, so they share the shared
                      two-column field primitive and collapse together at the
                      shared 767px breakpoint. */}
                  <div className="sa-registration-fields">
                    <div className="sa-registration-field">
                      <label htmlFor="rule-year-from">Year level — from</label>
                      <input
                        id="rule-year-from"
                        type="number"
                        min="1"
                        max="6"
                        value={form.min_year_level}
                        onChange={(e) => setForm({ ...form, min_year_level: e.target.value })}
                        placeholder="Earliest year"
                      />
                    </div>

                    <div className="sa-registration-field">
                      <label htmlFor="rule-year-to">Year level — to</label>
                      <input
                        id="rule-year-to"
                        type="number"
                        min="1"
                        max="6"
                        value={form.max_year_level}
                        onChange={(e) => setForm({ ...form, max_year_level: e.target.value })}
                        placeholder="Latest year"
                      />
                      {/* Copy, not validation: the old form allowed both bounds to
                          be empty, and it still does. This only tells the reader
                          that leaving one out records no limit in that direction,
                          so an incomplete rule is a deliberate choice rather than
                          an accident. */}
                      <small>
                        College years are 1–6. Leave a bound unset for no declared limit.
                        Senior High School is recorded separately below.
                      </small>
                    </div>
                  </div>

                  {/* allow_shs is a two-state column, so this is a real radio
                      group in Yes / No form rather than a bare checkbox labelled
                      with the column name. Same value in, same value out. */}
                  <fieldset className="board-eligibility-shs-field">
                    <legend>Include Senior High School students?</legend>
                    <div className="board-eligibility-choice">
                      <label className={form.allow_shs ? "" : "is-selected"}>
                        <input
                          type="radio"
                          name="rule-allow-shs"
                          checked={!form.allow_shs}
                          onChange={() => setForm({ ...form, allow_shs: false })}
                        />
                        <span>No</span>
                      </label>
                      <label className={form.allow_shs ? "is-selected" : ""}>
                        <input
                          type="radio"
                          name="rule-allow-shs"
                          checked={form.allow_shs}
                          onChange={() => setForm({ ...form, allow_shs: true })}
                        />
                        <span>Yes</span>
                      </label>
                    </div>
                    <small>Recorded on the rule as the Senior High School audience.</small>
                  </fieldset>
                  {validationError ? <p className="board-eligibility-note" role="alert">{validationError}</p> : null}
                </>
              ) : (
                <>
                  <div className="sa-registration-focus">
                    <h3>Review this eligibility rule.</h3>
                    <p>Confirm the recorded audience before {editing ? "saving" : "adding"} it.</p>
                  </div>

                  <div className="sa-registration-review">
                    <section>
                      <span>Election</span>
                      <strong>{draftElection ? draftElection.title : "Not selected"}</strong>
                      <p>The election this declared audience belongs to.</p>
                    </section>
                    <section>
                      <span>Declared audience</span>
                      <strong>
                        {draftProgram.lead}
                        {hasGap(draftProgram) && (
                          <span className="board-eligibility-gap"> — {draftProgram.gap}</span>
                        )}
                      </strong>
                      <p>
                        {draftYears.lead}
                        {hasGap(draftYears) && (
                          <span className="board-eligibility-gap"> — {draftYears.gap}</span>
                        )}
                      </p>
                    </section>
                    <section>
                      <span>Senior High School</span>
                      <strong>{draft.allow_shs ? "Included" : "Not included"}</strong>
                    </section>
                  </div>
                  <p className="board-eligibility-note">
                    This saves a declared audience. A {draft.program || "program"} rule does not
                    remove other {orgName} members from voting; enrollment, term participation,
                    and the locked electorate continue to decide access.
                  </p>
                </>
              )}

              <div className="sa-registration-actions">
                {step === 1 ? (
                  <button type="button" className="secondary-btn" onClick={closeForm} disabled={busy}>
                    Cancel
                  </button>
                ) : (
                  <button type="button" className="secondary-btn" onClick={goBack} disabled={busy}>
                    <ArrowLeft size={16} aria-hidden="true" />Back
                  </button>
                )}

                {step < steps.length ? (
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={goNext}
                    disabled={busy || !canContinue}
                  >
                    Continue<ArrowRight size={16} aria-hidden="true" />
                  </button>
                ) : (
                  <button type="submit" className="primary-btn" disabled={busy}>
                    {busy ? (
                      <KandidButtonLoader label={editing ? "Saving..." : "Adding..."} />
                    ) : (
                      <>
                        {editing ? "Save changes" : "Create rule"}
                        <ArrowRight size={16} aria-hidden="true" />
                      </>
                    )}
                  </button>
                )}
              </div>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default BoardEligibilityRules;
