import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function SystemSettings() {
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    const { data } = await supabase
      .from("system_settings")
      .select("*")
      .eq("id", 1)
      .single();

    setSettings(data);
  }

  async function handleSave() {
    const { error } = await supabase
      .from("system_settings")
      .update(settings)
      .eq("id", 1);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Settings saved!");
  }

  if (!settings) return <div>Loading...</div>;

  return (
    <div>
      <h1 className="text-3xl font-black">System Settings</h1>
      <p className="text-gray-500 mt-1">
        Configure system-wide behavior and defaults.
      </p>

      <div className="mt-8 bg-white p-6 rounded-2xl shadow-sm space-y-6 max-w-xl">
        
        <div>
          <label className="text-sm font-bold">System Name</label>
          <input
            value={settings.system_name}
            onChange={(e) =>
              setSettings({ ...settings, system_name: e.target.value })
            }
            className="w-full mt-2 px-4 py-3 border rounded-xl"
          />
        </div>

        <div>
          <label className="text-sm font-bold">
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
            className="w-full mt-2 px-4 py-3 border rounded-xl"
          />
        </div>

        <div className="flex items-center gap-3">
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
          <label className="font-semibold">
            Allow multiple votes per position
          </label>
        </div>

        <div className="flex items-center gap-3">
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
          <label className="font-semibold">
            Allow abstain option
          </label>
        </div>

        <div className="flex items-center gap-3">
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
          <label className="font-semibold text-red-600">
            Enable Maintenance Mode
          </label>
        </div>

        <button
          onClick={handleSave}
          className="w-full bg-[#ff5a1f] text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2"
        >
          <Save size={18} />
          Save Settings
        </button>
      </div>
    </div>
  );
}

export default SystemSettings;