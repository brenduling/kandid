import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Plus, RefreshCw, Save } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import {
  ACADEMIC_TERM_WRITE_BLOCKED_REASON,
  ACADEMIC_TERM_WRITE_ENABLED,
  SEMESTERS,
  activateAcademicTerm,
  createAcademicTerm,
  formatAcademicTerm,
  listAcademicTerms,
  validateAcademicYear,
} from "../../utils/academicTerms";
import { isSupabaseAdminAuthMode, requireAdminRole } from "../../utils/auth";

function statusClass(status) {
  if (status === "active") return "status-pill !bg-emerald-100 !text-emerald-700";
  if (status === "closed") return "status-pill !bg-gray-100 !text-gray-600";
  return "status-pill";
}

function SystemSettings() {
  const prompt = usePrompt();
  const [settings, setSettings] = useState(null);
  const [terms, setTerms] = useState([]);
  const [termUnavailable, setTermUnavailable] = useState(false);
  const [termLoading, setTermLoading] = useState(true);
  const [termActionLoading, setTermActionLoading] = useState(false);
  const [termWriteAuthorized, setTermWriteAuthorized] = useState(false);
  const [termWriteAuthLoading, setTermWriteAuthLoading] = useState(true);
  const [termForm, setTermForm] = useState({
    semester: "1st Semester",
    startYear: new Date().getFullYear(),
  });

  const activeTerm = useMemo(
    () => terms.find((term) => term.status === "active") || null,
    [terms],
  );

  const draftTerms = useMemo(
    () => terms.filter((term) => term.status === "draft"),
    [terms],
  );

  const closedTerms = useMemo(
    () => terms.filter((term) => term.status === "closed"),
    [terms],
  );

  const yearPreview = validateAcademicYear(termForm.startYear);
  const termWritesAvailable = ACADEMIC_TERM_WRITE_ENABLED && termWriteAuthorized;

  useEffect(() => {
    let active = true;

    async function loadSettings() {
      const { data } = await supabase
        .from("system_settings")
        .select("*")
        .eq("id", 1)
        .single();

      if (active) {
        setSettings(data);
      }
    }

    loadSettings();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadTerms() {
      setTermLoading(true);
      const { data, error, unavailable } = await listAcademicTerms({ force: true });

      if (!active) return;

      if (error) {
        prompt.error(error.message || "Failed to load academic terms.");
      }

      setTerms(data || []);
      setTermUnavailable(Boolean(unavailable));
      setTermLoading(false);
    }

    loadTerms();

    return () => {
      active = false;
    };
  }, [prompt]);

  useEffect(() => {
    let active = true;

    async function resolveTermWriteAccess() {
      if (!isSupabaseAdminAuthMode()) {
        setTermWriteAuthorized(false);
        setTermWriteAuthLoading(false);
        return;
      }

      setTermWriteAuthLoading(true);
      const { data } = await requireAdminRole("super_admin");
      if (!active) return;
      setTermWriteAuthorized(Boolean(data));
      setTermWriteAuthLoading(false);
    }

    resolveTermWriteAccess();

    return () => {
      active = false;
    };
  }, []);

  async function refreshTerms() {
    setTermLoading(true);
    const { data, error, unavailable } = await listAcademicTerms({ force: true });

    if (error) {
      prompt.error(error.message || "Failed to load academic terms.");
    }

    setTerms(data || []);
    setTermUnavailable(Boolean(unavailable));
    setTermLoading(false);
  }

  async function handleSave() {
    const { error } = await supabase
      .from("system_settings")
      .update(settings)
      .eq("id", 1);

    if (error) {
      prompt.error(error.message || "Failed to save settings.");
      return;
    }

    prompt.success("Settings saved.");
    await logAuditEvent({
      action: "system_setting_updated",
      entityType: "system_settings",
      entityId: 1,
      entityLabel: settings.system_name || "System Settings",
      status: "completed",
      metadata: {
        default_election_duration: settings.default_election_duration,
        allow_multiple_votes: settings.allow_multiple_votes,
        allow_abstain: settings.allow_abstain,
        maintenance_mode: settings.maintenance_mode,
      },
    });
  }

  async function handleCreateTerm(event) {
    event.preventDefault();
    if (termActionLoading) return;

    const { academicYear, error } = validateAcademicYear(termForm.startYear);
    if (error) {
      prompt.error(error);
      return;
    }

    if (!termWritesAvailable) {
      prompt.warning(ACADEMIC_TERM_WRITE_BLOCKED_REASON, "Administrative setup required");
      return;
    }

    setTermActionLoading(true);
    const result = await createAcademicTerm({
      semester: termForm.semester,
      startYear: termForm.startYear,
    });

    if (result.error) {
      prompt.error(
        result.error.message ||
          "Academic term could not be created. Confirm the Phase 1 migration and write policy are applied.",
      );
      setTermActionLoading(false);
      return;
    }

    prompt.success(`${termForm.semester} AY ${academicYear} created as draft.`);
    await logAuditEvent({
      action: "academic_term_created",
      entityType: "academic_term",
      entityId: result.data?.id,
      entityLabel: `${termForm.semester} AY ${academicYear}`,
      status: "completed",
    });
    await refreshTerms();
    setTermActionLoading(false);
  }

  async function handleActivateTerm(term) {
    if (!term?.id || term.status !== "draft" || termActionLoading) return;

    if (!termWritesAvailable) {
      prompt.warning(ACADEMIC_TERM_WRITE_BLOCKED_REASON, "Administrative setup required");
      return;
    }

    const confirmed = await prompt.confirm({
      title: "Activate Academic Term?",
      message: `${formatAcademicTerm(term)} will become the current academic term. The current active term, if any, will be closed. This action does not register students for the new semester.`,
      type: "warning",
      confirmText: "Activate Term",
    });

    if (!confirmed) return;

    setTermActionLoading(true);
    const { error } = await activateAcademicTerm(term.id);

    if (error) {
      prompt.error(
        error.message ||
          "Academic term could not be activated. Confirm the activation function is securely available.",
      );
      setTermActionLoading(false);
      return;
    }

    prompt.success(`${formatAcademicTerm(term)} is now active.`);
    await logAuditEvent({
      action: "academic_term_activated",
      entityType: "academic_term",
      entityId: term.id,
      entityLabel: formatAcademicTerm(term),
      status: "completed",
    });
    await refreshTerms();
    setTermActionLoading(false);
  }

  if (!settings) {
    return (
      <div className="glass-panel rounded-[28px] p-8 surface-subcopy">
        Loading settings...
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">System Settings</h1>
      <p className="page-subtitle mt-1">
        Configure system-wide behavior and defaults.
      </p>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,480px)]">
      <div className="glass-panel max-w-xl rounded-[28px] p-6 shadow-sm space-y-6">
        <div>
          <label className="field-label !mb-2 !tracking-[0.12em] !normal-case">System Name</label>
          <input
            value={settings.system_name}
            onChange={(e) =>
              setSettings({ ...settings, system_name: e.target.value })
            }
            className="field-shell w-full"
          />
        </div>

        <div>
          <label className="field-label !mb-2 !tracking-[0.12em] !normal-case">
            Default Election Duration (days)
          </label>
          <input
            type="number"
            value={settings.default_election_duration}
            onChange={(e) =>
              setSettings({
                ...settings,
                default_election_duration: Number(e.target.value),
              })
            }
            className="field-shell w-full"
          />
        </div>

        <label className="toggle-surface">
          <input
            type="checkbox"
            checked={settings.allow_multiple_votes}
            onChange={(e) =>
              setSettings({
                ...settings,
                allow_multiple_votes: e.target.checked,
              })
            }
          />
          Allow multiple votes per position
        </label>

        <label className="toggle-surface">
          <input
            type="checkbox"
            checked={settings.allow_abstain}
            onChange={(e) =>
              setSettings({
                ...settings,
                allow_abstain: e.target.checked,
              })
            }
          />
          Allow abstain option
        </label>

        <label className="toggle-surface !text-red-700">
          <input
            type="checkbox"
            checked={settings.maintenance_mode}
            onChange={(e) =>
              setSettings({
                ...settings,
                maintenance_mode: e.target.checked,
              })
            }
          />
          Enable maintenance mode
        </label>

        <button
          onClick={handleSave}
          className="primary-btn w-full justify-center"
        >
          <Save size={18} />
          Save Settings
        </button>
      </div>

      <section className="glass-panel rounded-[28px] p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="field-label">Academic Term</p>
            <h2 className="mt-2 text-2xl font-black text-[#111827]">
              Current Academic Term
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Phase 1 only records the operating term. Enrollment and voting
              eligibility are unchanged.
            </p>
          </div>

          <button
            type="button"
            onClick={refreshTerms}
            disabled={termLoading}
            className="secondary-btn self-start"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>

        {termUnavailable ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Academic term schema is not available yet. Apply the Phase 1
            migration before managing terms here.
          </div>
        ) : termLoading ? (
          <div className="mt-6 rounded-2xl border border-gray-200 bg-white/70 p-4 text-sm text-gray-500">
            Loading academic terms...
          </div>
        ) : (
          <>
            <div className="mt-6 rounded-2xl border border-gray-200 bg-white/75 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-[#f4511e]">
                  <CalendarDays size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-gray-500">
                    Current
                  </p>
                  <h3 className="mt-1 text-xl font-black text-[#111827]">
                    {activeTerm ? formatAcademicTerm(activeTerm) : "No academic term configured"}
                  </h3>
                  <span className={statusClass(activeTerm?.status || "draft")}>
                    {activeTerm?.status || "not configured"}
                  </span>
                </div>
              </div>
            </div>

            <form onSubmit={handleCreateTerm} className="mt-6 space-y-4">
              {!termWritesAvailable ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  Academic term management requires a linked Supabase Auth Super
                  Admin session and the secure admin academic-terms Edge Function.
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-[1fr_0.8fr]">
                <div>
                  <label className="field-label">Semester</label>
                  <select
                    disabled={!termWritesAvailable || termWriteAuthLoading}
                    value={termForm.semester}
                    onChange={(event) =>
                      setTermForm((current) => ({
                        ...current,
                        semester: event.target.value,
                      }))
                    }
                    className="field-shell w-full"
                  >
                    {SEMESTERS.map((semester) => (
                      <option key={semester} value={semester}>
                        {semester}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="field-label">Academic Year</label>
                  <input
                    type="number"
                    min="2000"
                    max="2200"
                    disabled={!termWritesAvailable || termWriteAuthLoading}
                    value={termForm.startYear}
                    onChange={(event) =>
                      setTermForm((current) => ({
                        ...current,
                        startYear: event.target.value,
                      }))
                    }
                    className="field-shell w-full"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-2xl bg-gray-50 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="font-bold text-gray-700">
                  {yearPreview.error ? yearPreview.error : `Will create AY ${yearPreview.academicYear}`}
                </span>
                <button
                  type="submit"
                  disabled={
                    !termWritesAvailable ||
                    termWriteAuthLoading ||
                    termActionLoading ||
                    Boolean(yearPreview.error)
                  }
                  className="primary-btn justify-center disabled:opacity-60"
                >
                  <Plus size={16} />
                  Create Draft Term
                </button>
              </div>
            </form>

            <div className="mt-6 space-y-4">
              <div>
                <h3 className="text-sm font-black uppercase tracking-[0.14em] text-gray-500">
                  Draft Terms
                </h3>
                <div className="mt-3 space-y-2">
                  {draftTerms.length === 0 ? (
                    <p className="text-sm text-gray-500">No draft terms.</p>
                  ) : (
                    draftTerms.map((term) => (
                      <div
                        key={term.id}
                        className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white/75 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="font-black text-[#111827]">
                            {formatAcademicTerm(term)}
                          </p>
                          <span className={statusClass(term.status)}>
                            {term.status}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleActivateTerm(term)}
                          disabled={!termWritesAvailable || termWriteAuthLoading || termActionLoading}
                          className="secondary-btn justify-center"
                        >
                          <CheckCircle2 size={16} />
                          Activate
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-black uppercase tracking-[0.14em] text-gray-500">
                  Closed Terms
                </h3>
                <div className="mt-3 space-y-2">
                  {closedTerms.length === 0 ? (
                    <p className="text-sm text-gray-500">No closed terms.</p>
                  ) : (
                    closedTerms.map((term) => (
                      <div
                        key={term.id}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white/60 p-4"
                      >
                        <p className="font-bold text-gray-700">
                          {formatAcademicTerm(term)}
                        </p>
                        <span className={statusClass(term.status)}>
                          {term.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </section>
      </div>
    </div>
  );
}

export default SystemSettings;
