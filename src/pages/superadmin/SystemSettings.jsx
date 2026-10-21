import { useEffect, useState } from "react";
import "./RemainingPages.css";
import { RefreshCw, Save } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import SuperAdminPageHeader from "../../components/SuperAdminPageHeader";
import AcademicTermDangerZone from "./AcademicTermDangerZone";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { listAcademicTerms } from "../../utils/academicTerms";
import { isSupabaseAdminAuthMode, requireAdminRole } from "../../utils/auth";
import {
  getSystemSettingsLoadStatus,
  getSystemSettingsUpdate,
  validateSystemSettings,
} from "../../utils/systemSettings";

function SystemSettings() {
  const prompt = usePrompt();
  const [settings, setSettings] = useState(null);
  const [settingsStatus, setSettingsStatus] = useState("loading");
  const [settingsRetry, setSettingsRetry] = useState(0);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [terms, setTerms] = useState([]);
  const [termUnavailable, setTermUnavailable] = useState(false);
  const [termError, setTermError] = useState(false);
  const [termLoading, setTermLoading] = useState(true);
  const [termWriteAuthorized, setTermWriteAuthorized] = useState(false);
  const [termActorKey, setTermActorKey] = useState(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);

    async function loadSettings() {
      setSettingsStatus("loading");
      setSettings(null);

      try {
        const { data, error } = await supabase
          .from("system_settings")
          .select("id, system_name, default_election_duration, allow_multiple_votes, allow_abstain, maintenance_mode")
          .eq("id", 1)
          .abortSignal(controller.signal)
          .maybeSingle();

        if (!active) return;
        if (controller.signal.aborted) {
          setSettingsStatus("timeout");
          return;
        }

        const status = getSystemSettingsLoadStatus({ data, error });
        if (status === "ready" && validateSystemSettings(data)) {
          setSettingsStatus("invalid");
          return;
        }

        setSettings(data || null);
        setSettingsStatus(status);
      } catch {
        if (!active) return;
        setSettings(null);
        setSettingsStatus(controller.signal.aborted ? "timeout" : "error");
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    loadSettings();

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [settingsRetry]);

  useEffect(() => {
    let active = true;

    async function loadTerms() {
      setTermLoading(true);
      setTermError(false);
      try {
        const { data, error, unavailable } = await listAcademicTerms({ force: true });
        if (!active) return;
        if (error) prompt.error(error.message || "Failed to load academic terms.");
        setTerms(error || unavailable ? [] : data || []);
        setTermError(Boolean(error));
        setTermUnavailable(Boolean(unavailable));
      } catch {
        if (!active) return;
        setTerms([]);
        setTermError(true);
      } finally {
        if (active) setTermLoading(false);
      }
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
        return;
      }

      try {
        const { data } = await requireAdminRole("super_admin");
        if (!active) return;
        setTermWriteAuthorized(Boolean(data));
        setTermActorKey(data?.auth_user_id || null);
      } catch {
        if (active) setTermWriteAuthorized(false);
      }
    }

    resolveTermWriteAccess();

    return () => {
      active = false;
    };
  }, []);

  async function refreshTerms() {
    setTermLoading(true);
    setTermError(false);
    setTermUnavailable(false);
    try {
      const { data, error, unavailable } = await listAcademicTerms({ force: true });
      if (error) prompt.error(error.message || "Failed to load academic terms.");
      setTerms(error || unavailable ? [] : data || []);
      setTermError(Boolean(error));
      setTermUnavailable(Boolean(unavailable));
    } catch {
      setTerms([]);
      setTermError(true);
    } finally {
      setTermLoading(false);
    }
  }

  async function handleSave() {
    if (settingsStatus !== "ready" || settingsSaving) return;

    const validationError = validateSystemSettings(settings);
    if (validationError) {
      prompt.error(validationError);
      return;
    }

    setSettingsSaving(true);
    let savedRow;
    try {
      const { data, error } = await supabase
        .from("system_settings")
        .update(getSystemSettingsUpdate(settings))
        .eq("id", 1)
        .select("id")
        .maybeSingle();

      if (error) {
        prompt.error(error.message || "Failed to save settings.");
        return;
      }

      if (!data) {
        prompt.error("No settings record was updated. Reload and confirm your Super Admin access.");
        return;
      }
      savedRow = data;
    } catch {
      prompt.error("Settings could not be saved because the request was interrupted. Retry after checking the saved values.");
      return;
    } finally {
      setSettingsSaving(false);
    }

    if (!savedRow) return;
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

  return (
    <div className="sa-remaining-page sa-system-settings">
      <SuperAdminPageHeader section="System structure" title="System Settings" description="Manage academic terms and system-wide defaults used across Kandid." />

      <div className="mt-8 grid gap-6">
      <div className="glass-panel max-w-xl rounded-[28px] p-6 shadow-sm space-y-6">
        {settingsStatus !== "ready" ? (
          <div
            className="border-t-2 border-[var(--sa-ink)] border-b border-[var(--sa-rule-strong)] py-5"
            role={settingsStatus === "loading" ? "status" : "alert"}
            aria-live="polite"
          >
            <h2 className="text-lg font-black text-[var(--sa-ink)]">
              {settingsStatus === "loading"
                ? "Loading persisted settings…"
                : settingsStatus === "empty"
                  ? "System settings are not initialized"
                  : settingsStatus === "invalid"
                    ? "Saved settings need attention"
                  : settingsStatus === "timeout"
                    ? "Settings request timed out"
                    : "Settings could not be loaded"}
            </h2>
            <p className="mt-2 text-sm text-[var(--sa-muted)]">
              {settingsStatus === "loading"
                ? "Retrieving the saved configuration from Kandid."
                : settingsStatus === "empty"
                  ? "No persisted settings record with id 1 is visible to this session. No defaults were created. Confirm the record and Super Admin read policy before applying the approved initialization SQL. Academic terms are managed independently below."
                  : settingsStatus === "invalid"
                    ? "The saved record has incomplete or invalid values. No defaults were substituted. Correct the record through an approved administrative process."
                    : settingsStatus === "timeout"
                      ? "The database request did not finish within 15 seconds. Retry the read-only request; no settings were changed."
                    : "Check your connection and Super Admin access, then retry. Existing settings have not been changed."}
            </p>
            {settingsStatus !== "loading" ? (
              <button
                type="button"
                onClick={() => setSettingsRetry((current) => current + 1)}
                className="secondary-btn mt-5"
              >
                <RefreshCw size={16} />
                Retry settings load
              </button>
            ) : null}
          </div>
        ) : (
          <>
        <div>
          <label htmlFor="system-name" className="field-label !mb-2 !tracking-[0.12em] !normal-case">System Name</label>
          <input
            id="system-name"
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
            aria-label="Default Election Duration (days)"
            type="number"
            min="1"
            step="1"
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
          type="button"
          onClick={handleSave}
          disabled={settingsSaving}
          className="primary-btn w-full justify-center"
        >
          {settingsSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
          {settingsSaving ? "Saving Settings…" : "Save Settings"}
        </button>
          </>
        )}
      </div>

      <AcademicTermDangerZone
        key={termActorKey || "unverified"}
        terms={terms}
        loading={termLoading}
        unavailable={termUnavailable}
        error={termError}
        onRefresh={refreshTerms}
        authorized={termWriteAuthorized}
        actorKey={termActorKey}
      />
      </div>
    </div>
  );
}

export default SystemSettings;
