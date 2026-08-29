import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";

function SystemSettings() {
  const prompt = usePrompt();
  const [settings, setSettings] = useState(null);

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

      <div className="glass-panel mt-8 max-w-xl rounded-[28px] p-6 shadow-sm space-y-6">
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
    </div>
  );
}

export default SystemSettings;
