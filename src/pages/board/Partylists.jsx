import { useCallback, useEffect, useRef, useState } from "react";
import "./BoardRemainingPages.css";
/* The Add Student form system. OfficerFormDialog.jsx imports the same file for
   the same reason: sa-students-modal.is-registration plus the sa-registration-*
   primitives are the established Kandid guided-form language, and reusing them
   is what makes Add Partylist read as the same product as Add Student and Add
   Officer rather than a lookalike. */
import "../superadmin/Students.css";
import "./Partylists.css";
import { Plus, Ellipsis, X, ArrowLeft, ArrowRight, Upload } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { KandidButtonLoader } from "../../components/KandidLoader";
import { supabase } from "../../lib/supabaseClient";
import { readFileAsDataUrl } from "../../utils/files";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../../utils/deleteGuards";
import {
  createPartylistSubmission, deletePartylist, loadPartylistBoardContext,
  partylistErrorMessage, savePartylistEdit,
} from "../../utils/partylistManagement";

/* Best-effort display name for an already-stored logo. A data URL carries no
   file name, so it is reported as the current logo rather than guessed at; a
   real URL is reduced to its last path segment. Presentation only. */
function logoLabel(value) {
  if (!value) return "";
  if (value.startsWith("data:")) return "Current logo";
  try {
    const path = new URL(value, "https://kandid.local").pathname;
    const name = path.split("/").filter(Boolean).pop();
    return name || "Current logo";
  } catch {
    return "Current logo";
  }
}

/* Overflow menu for a partylist's management actions.

   Edit and Delete were permanently exposed as two square controls on every
   partylist, so each partylist read as a database row with its inline controls
   showing. They are secondary and destructive actions, so they now sit behind one
   quiet trigger and the partylist itself carries the row.

   This is presentation only. The item callbacks are the page's existing
   openEdit and handleDelete, and the delete flow - dependency analysis, the
   blocked audit event, the danger confirm, the recheck and the audit log - is
   untouched. The menu closes on an outside pointer press and on Escape, and the
   trigger reports its state, matching the treatment the Officer record uses. */
function PartylistActionsMenu({ label, items, disabled }) {
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
    <div className="board-partylist-menu" ref={ref}>
      <button
        type="button"
        className="board-partylist-menu-trigger"
        aria-expanded={open}
        aria-label={`Actions for ${label}`}
        title={`Actions for ${label}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="board-partylist-menu-list">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={disabled}
              className={`board-partylist-menu-item${item.danger ? " is-danger" : ""}`}
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

function BoardPartylists() {
  const prompt = usePrompt();
  const hasLoadedPartylists = useRef(false);
  const submission = useRef(null);
  const mutationPending = useRef(false);
  const [user, setUser] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [partylists, setPartylists] = useState([]);
  const [candidateCounts, setCandidateCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  /* Guided-form state, mirroring Add Student and Add Officer: one question per
     step, and nothing is submitted before Review. */
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [logoFileName, setLogoFileName] = useState("");

const [form, setForm] = useState({
    name: "",
    description: "",
    logo_url: "",
  });

  const orgId = user?.organization_id;
  const orgName = user?.organizations?.name || "your organization";

  const fetchPartylists = useCallback(async () => {
    const firstLoad = !hasLoadedPartylists.current;
    setLoading(firstLoad);
    setRefreshing(!firstLoad);
    setLoadError("");

    try {
      const board = await loadPartylistBoardContext(supabase);
      setUser(board);
      /* Partylists are organization-level. The list is scoped by organization_id
         directly, so a partylist is visible and creatable whether or not any
         election has ever referenced it. */
      const { data, error } = await supabase
        .from("partylists")
        .select("id, organization_id, name, description, logo_url")
        .eq("organization_id", board.organization_id)
        .order("name", { ascending: true });

      if (error) throw error;
      const rows = data || [];
      setPartylists(rows);
      hasLoadedPartylists.current = true;

      if (!rows.length) {
        setCandidateCounts({});
        return;
      }

      const { data: candidateRows, error: candidateCountError } = await supabase
        .from("candidates")
        .select("partylist_id")
        .in("partylist_id", rows.map((partylist) => partylist.id));

      if (candidateCountError) {
        console.error("Failed to load partylist candidate counts:", candidateCountError);
        setCandidateCounts(null);
        setLoadError("Partylists loaded, but candidate counts are unavailable.");
      } else {
        setCandidateCounts(
          (candidateRows || []).reduce((counts, candidate) => {
            if (!candidate.partylist_id) return counts;
            counts[candidate.partylist_id] = (counts[candidate.partylist_id] || 0) + 1;
            return counts;
          }, {}),
        );
      }
    } catch (error) {
      console.error("Failed to load Board partylists:", error);
      if (error?.code === "PARTYLIST_AUTH") setUser(null);
      setLoadError(error?.code === "PARTYLIST_AUTH" ? partylistErrorMessage(error) : "The partylist register could not be loaded. Refresh and try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load the register after verifying the Board's current organization.
  useEffect(() => {
    fetchPartylists();
  }, [fetchPartylists]);

function openCreate() {
    submission.current = createPartylistSubmission(supabase);
    setEditing(null);
    setForm({
      name: "",
      description: "",
      logo_url: "",
    });
    setLogoFileName("");
    setStep(1);
    setFormOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      name: item.name,
      description: item.description || "",
      logo_url: item.logo_url || "",
    });
    /* Edit opens on the same three steps as Add, prefilled, with the file name
       recovered from the stored value so an existing logo is named rather than
       just previewed. */
    setLogoFileName(item.logo_url ? logoLabel(item.logo_url) : "");
    setStep(1);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setStep(1);
  }

  /* Storage behaviour is unchanged: the file is still read to a data URL and
     stored in logo_url exactly as before. Only the control that chooses it is
     new. The file name is kept in separate state purely so the control can show
     it, and is never written to the record. */
  async function handleLogoUpload(file) {
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setForm((current) => ({ ...current, logo_url: dataUrl }));
      setLogoFileName(file.name || "Selected image");
    } catch {
      prompt.error("The logo could not be read. Choose the image again.");
    }
  }

  function removeLogo() {
    setForm({ ...form, logo_url: "" });
    setLogoFileName("");
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (mutationPending.current || !user) return;
    // Enter on Identity/Details advances the wizard; only Review may write.
    if (step < 3) {
      if (form.name.trim()) setStep((current) => Math.min(current + 1, 3));
      return;
    }

    mutationPending.current = true;
    setBusy(true);
    try {
      const { error } = editing
        ? await savePartylistEdit(supabase, editing, form, orgId)
        : await submission.current(form, orgId);
      if (error) {
        prompt.error(partylistErrorMessage(error));
        return;
      }
      prompt.success(editing ? "Partylist updated." : "Partylist created.");
      closeForm();
      await fetchPartylists();
    } catch {
      prompt.error("The partylist could not be saved. No success was confirmed. Try again.");
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  }

  /* --- guided form --------------------------------------------------------
     Step navigation and the derived progress rail, matching Add Student's and
     Add Officer's. Nothing here writes: it only moves between steps. */

  const steps = ["Identity", "Details", "Review"];

  const progress = (
    <ol
      className="sa-registration-progress"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      aria-label={editing ? "Edit partylist progress" : "Add partylist progress"}
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

  /* Identity is the only gate: a partylist must be named. Details and Review are
     always reachable, and the name keeps the same `required` semantics it had in
     the old form. */
  const canContinue = step === 1 ? Boolean(form.name.trim()) && form.name.trim().length <= 100 : true;

  function goNext() {
    setStep((current) => Math.min(current + 1, steps.length));
  }

  function goBack() {
    setStep((current) => Math.max(current - 1, 1));
  }

  const logoPreview = form.logo_url ? (
    <img src={form.logo_url} alt="Partylist logo preview" className="board-partylist-logo-preview" />
  ) : (
    /* Same initials fallback as the directory, so the form, the review step and
       the list all agree on what an unmarked partylist looks like. */
    <span aria-hidden="true">{(form.name || "").slice(0, 2).toUpperCase() || "PL"}</span>
  );

  const formTitle = editing ? "Edit Partylist" : "Add Partylist";
  const formSubtitle = editing
    ? `Update ${form.name || "this partylist"}'s information.`
    : `Create a partylist for ${orgName}.`;

  async function handleDelete(partylist) {
    if (mutationPending.current || !user) return;
    mutationPending.current = true;
    setDeletingId(partylist.id);
    try {
      const id = partylist.id;
      const analysis = await analyzeDeleteDependencies("partylist", partylist);

      if (analysis.blocked) {
        await logAuditEvent({
          action: "partylist_delete_blocked",
          entityType: "partylist",
          entityId: id,
          entityLabel: partylist.name,
          organizationId: orgId,
          organizationName: user?.organizations?.name,
          status: "requires_action",
          metadata: { dependencies: analysis.dependencies },
        });
        await prompt.alert({
          title: analysis.severity === "archive" ? "Partylist Is Historical" : "Partylist Cannot Be Deleted Yet",
          message: dependencyMessage(partylist.name || "This partylist", analysis),
          type: "warning",
          confirmText: "Review Candidates",
        });
        return;
      }

      const ok = await prompt.confirm({
        title: "Delete Partylist?",
        message: dependencyMessage(partylist.name || "This partylist", analysis),
        type: "danger",
        confirmText: "Delete",
      });
      if (!ok) return;

      const recheck = await analyzeDeleteDependencies("partylist", partylist);
      if (recheck.blocked) {
        prompt.error(dependencyMessage(partylist.name || "This partylist", recheck));
        return;
      }

      const { error } = await deletePartylist(supabase, partylist, orgId);
      if (error) {
        prompt.error(partylistErrorMessage(error));
        return;
      }
      prompt.success("Partylist deleted.");
      await logAuditEvent({
        action: "partylist_deleted",
        entityType: "partylist",
        entityId: id,
        entityLabel: partylist.name,
        organizationId: orgId,
        organizationName: user?.organizations?.name,
        status: "completed",
      });
      await fetchPartylists();
    } catch {
      prompt.error("Partylist deletion could not be confirmed. Refresh the register before trying again.");
    } finally {
      mutationPending.current = false;
      setDeletingId(null);
    }
  }

  return (
    <div className="board-remaining-page board-partylists">
      {/* The Elections masthead, element for element: the orange context eyebrow
          with its hairline, the title and the one orange action on the baseline,
          then the standfirst, closed by the single 2px ink rule. The former
          "Kandid / Electoral Board" breadcrumb and "Organization Groups" kicker are
          gone because "Electoral Board / [organization]" already carries the
          Board context, which also makes "Board partylists" redundant as a title.
          Same composition, same dynamic organization name as Elections. */}
      <header className="board-partylists-masthead">
        <div className="board-partylists-context">
          <span className="board-partylists-eyebrow">Electoral Board / {orgName}</span>
          <span className="board-partylists-context-rule" aria-hidden="true" />
        </div>

        <div className="board-partylists-baseline">
          <h1 className="page-title board-partylists-title">Partylists</h1>
          <button type="button" onClick={openCreate} className="board-partylists-create" disabled={!user || busy || deletingId !== null}>
            <Plus size={15} aria-hidden="true" />
            Add Partylist
          </button>
        </div>

        <p className="board-partylists-standfirst">
          Create and manage partylists for {orgName}.
        </p>
      </header>

      {loadError ? (
        <div className="board-partylist-load-error" role={partylists.length ? "status" : "alert"}>
          <p>{loadError}</p>
          <button type="button" onClick={fetchPartylists} disabled={refreshing}>Retry</button>
        </div>
      ) : null}
      {refreshing ? <p className="board-partylist-refreshing" role="status">Refreshing the partylist register…</p> : null}
      {deletingId !== null ? <p className="board-partylist-refreshing" role="status">Checking partylist deletion…</p> : null}

      {loading && partylists.length === 0 ? (
        <div className="board-partylist-skeleton" role="status" aria-label="Loading partylists" aria-busy="true">
          {[0, 1, 2, 3].map((row) => <div className="board-partylist-skeleton-row" key={row}><span /><span /><span /></div>)}
        </div>
      ) : partylists.length === 0 && loadError ? null : partylists.length === 0 ? (
        <div className="board-partylist-empty">
          <p className="board-partylist-empty-kicker">No partylists yet</p>
          <h2>Create a partylist to group candidates under a shared identity.</h2>
          <button type="button" onClick={openCreate} className="primary-btn board-partylist-empty-action" disabled={!user || busy || deletingId !== null}>
            <Plus size={16} aria-hidden="true" /> Add partylist
          </button>
        </div>
      ) : (
        /* A ruled directory, not a card grid, and with no section heading of its
           own: the masthead already names the page, so a second "Partylists" label
           above the rows repeated it. The index numbering carries the size of the
           directory, so no count is stated a second time either.

           The partylist is the whole identity here. No election, term or status is
           shown, because a partylist is an organization-managed group identity
           rather than something that belongs to one election, and the form no
           longer asks for one. The count is read from the same candidateCounts
           already loaded. */
        <ol className="board-partylist-directory">
          {partylists.map((p, index) => {
            const candidateCount = candidateCounts === null ? null : candidateCounts[p.id] || 0;

            return (
              <li key={p.id} className="board-partylist-row">
                <span className="board-partylist-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>

                <div className="board-partylist-body">
                  {/* Mark and text share one row at every width, so the partylist
                      name keeps a single left alignment down the whole directory
                      and the mark never claims a line of its own on mobile. The
                      tagline and the count sit in the same text column as the name,
                      under it, so nothing drifts left of the identity. */}
                  <div className="board-partylist-identity">
                    <div className="board-partylist-mark">
                      {p.logo_url ? (
                        <img src={p.logo_url} alt={`${p.name} logo`} />
                      ) : (
                        /* No logo is a normal state, not an error, so the fallback
                           is the partylist's own initials in the same square rule
                           as a real mark rather than a placeholder tile. */
                        <span aria-hidden="true">{p.name?.slice(0, 2).toUpperCase() || "PL"}</span>
                      )}
                    </div>

                    <div className="board-partylist-context">
                      <h2 className="board-partylist-name">{p.name}</h2>
                      {p.description && <p className="board-partylist-tagline">{p.description}</p>}
                      <p className="board-partylist-members">
                        {candidateCount === undefined || candidateCount === null
                          ? "Candidate count unavailable"
                          : `${candidateCount} candidate${candidateCount === 1 ? "" : "s"}`}
                      </p>
                    </div>
                  </div>
                </div>

                {/* The same two actions, presented for the space available. Desktop
                    has room to show them, so it shows EDIT and DELETE as tracked
                    text at the far right. Mobile keeps the overflow menu. Both call
                    the page's existing openEdit and handleDelete, so the delete
                    confirmation, dependency analysis and audit trail are the same
                    either way, and only one of the two is rendered visibly at any
                    width. */}
                <div className="board-partylist-actions">
                  <button type="button" className="board-partylist-action" onClick={() => openEdit(p)} disabled={busy || deletingId !== null}>
                    Edit
                  </button>
                  <button type="button" className="board-partylist-action is-danger" onClick={() => handleDelete(p)} disabled={busy || deletingId !== null}>
                    Delete
                  </button>
                </div>

                <PartylistActionsMenu
                  label={p.name}
                  disabled={busy || deletingId !== null}
                  items={[
                    { label: "Edit partylist", onSelect: () => openEdit(p) },
                    { label: "Delete partylist", danger: true, onSelect: () => handleDelete(p) },
                  ]}
                />
              </li>
            );
          })}
        </ol>
      )}

{formOpen && (
        <PopupOverlay>
          <div
            className="popup-sheet popup-sheet-wide sa-students-modal is-registration board-partylist-registration"
            role="dialog"
            aria-modal="true"
            aria-labelledby="partylist-form-title"
          >
            <div className="popup-header">
              <div className="popup-header-copy">
                <h2 id="partylist-form-title" className="surface-title">{formTitle}</h2>
                <p className="surface-copy">{formSubtitle}</p>
              </div>
              <button
                type="button"
                className="popup-close"
                onClick={closeForm}
                aria-label="Close partylist form"
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
                    <h3>What is the partylist?</h3>
                    <p>Give the partylist a name and visual identity.</p>
                  </div>

                  <div className="sa-registration-field board-partylist-name-field">
                    <label htmlFor="partylist-name">Partylist name</label>
                    <input
                      id="partylist-name"
                      maxLength={100}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Partylist name"
                      autoComplete="off"
                      required
                    />
                  </div>

                  <div className="sa-registration-field">
                    <label htmlFor="partylist-logo">Partylist logo</label>
                    {form.logo_url ? (
                      <div className="board-partylist-logo-selected">
                        {logoPreview}
                        <div className="board-partylist-logo-copy">
                          <strong>{logoFileName || logoLabel(form.logo_url)}</strong>
                          <div className="board-partylist-logo-actions">
                            <label className="board-partylist-logo-button">
                              <Upload size={14} aria-hidden="true" />
                              Change
                              <input
                                id="partylist-logo"
                                type="file"
                                accept="image/*"
                                onChange={(e) => handleLogoUpload(e.target.files?.[0])}
                                className="board-partylist-logo-input"
                              />
                            </label>
                            <button
                              type="button"
                              className="board-partylist-logo-remove"
                              onClick={removeLogo}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <label className="board-partylist-logo-button">
                          <Plus size={14} aria-hidden="true" />
                          Choose logo
                          <input
                            id="partylist-logo"
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleLogoUpload(e.target.files?.[0])}
                            className="board-partylist-logo-input"
                          />
                        </label>
                        <small>Optional. PNG, JPG or any other image format.</small>
                      </>
                    )}
                  </div>
                </>
              ) : step === 2 ? (
                <>
                  <div className="sa-registration-focus">
                    <h3>How should students recognize it?</h3>
                    <p>Add a short description that identifies the partylist.</p>
                  </div>

                  <div className="sa-registration-field">
                    <label htmlFor="partylist-description">Description</label>
                    <textarea
                      id="partylist-description"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="A short description of the partylist."
                      rows={3}
                      className="board-partylist-description"
                    />
                    <small>Shown beside the partylist wherever it is listed.</small>
                  </div>
                </>
              ) : (
                <>
                  <div className="sa-registration-focus">
                    <h3>{editing ? "Ready to save this partylist?" : "Ready to add this partylist?"}</h3>
                    <p>Confirm the details below before {editing ? "saving" : "adding"} it.</p>
                  </div>

                  <div className="sa-registration-review board-partylist-review">
                    <section>
                      <span>Partylist</span>
                      <div className="board-partylist-review-identity">
                        <span className="board-partylist-review-mark">{logoPreview}</span>
                        <div>
                          <strong>{form.name || "Unnamed partylist"}</strong>
                          <p>{form.description || "No description provided."}</p>
                        </div>
                      </div>
                    </section>
                    <section>
                      <span>Organization</span>
                      <strong>{orgName}</strong>
                      <p>Partylists belong to {orgName}, not to a single election.</p>
                    </section>
                  </div>
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
                  <button type="button" className="primary-btn" onClick={goNext} disabled={busy || !canContinue}>
                    Continue<ArrowRight size={16} aria-hidden="true" />
                  </button>
                ) : (
                  <button type="submit" className="primary-btn" disabled={busy}>
                    {busy ? (
                      <KandidButtonLoader label={editing ? "Saving..." : "Adding..."} />
                    ) : (
                      <>
                        {editing ? "Save changes" : "Create partylist"}
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

export default BoardPartylists;
