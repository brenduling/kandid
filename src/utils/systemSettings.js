export function getSystemSettingsLoadStatus({ data, error } = {}) {
  if (error) return "error";
  if (data == null) return "empty";
  return "ready";
}

export function validateSystemSettings(settings) {
  if (!settings || typeof settings.system_name !== "string" || !settings.system_name.trim()) {
    return "Enter a system name before saving.";
  }

  if (!Number.isSafeInteger(settings.default_election_duration) || settings.default_election_duration < 1) {
    return "Default election duration must be a whole number greater than zero.";
  }

  for (const key of ["allow_multiple_votes", "allow_abstain", "maintenance_mode"]) {
    if (typeof settings[key] !== "boolean") {
      return "The saved settings record is incomplete. No default values were substituted.";
    }
  }

  return null;
}

export function getSystemSettingsUpdate(settings) {
  return {
    system_name: settings.system_name.trim(),
    default_election_duration: settings.default_election_duration,
    allow_multiple_votes: settings.allow_multiple_votes,
    allow_abstain: settings.allow_abstain,
    maintenance_mode: settings.maintenance_mode,
  };
}
