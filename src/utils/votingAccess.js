export const VOTING_ACCESS_MODES = [
  { value: "anywhere", label: "Anywhere" },
  { value: "onsite_qr", label: "QR Access Only" },
  { value: "precinct_qr", label: "Precinct QR" },
  { value: "batch_qr", label: "Batch QR" },
  { value: "location_range", label: "Location Range" },
];

export const TOKEN_SCOPE_TYPES = [
  { value: "general", label: "General" },
  { value: "precinct", label: "Precinct" },
  { value: "batch", label: "Batch" },
];

export function getVotingAccessModeLabel(mode) {
  return (
    VOTING_ACCESS_MODES.find((item) => item.value === mode)?.label || "Anywhere"
  );
}

export function generateAccessToken() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
}

export function getAccessQrImageUrl(token) {
  if (!token) return "";
  return `https://quickchart.io/qr?text=${encodeURIComponent(token)}&size=220`;
}

function normalizeText(value) {
  return (value || "").trim().toUpperCase();
}

export function isTokenExpired(tokenRow, now = new Date()) {
  if (!tokenRow?.expires_at) return false;
  return new Date(tokenRow.expires_at).getTime() < now.getTime();
}

export function doesTokenMatchStudent(tokenRow, student) {
  if (!tokenRow) return false;

  if (tokenRow.scope_type === "general") return true;

  if (tokenRow.scope_type === "precinct") {
    return normalizeText(tokenRow.scope_value) === normalizeText(student?.precinct_code);
  }

  if (tokenRow.scope_type === "batch") {
    return normalizeText(tokenRow.scope_value) === normalizeText(student?.batch_code);
  }

  return false;
}

export function distanceBetweenMeters(fromLat, fromLng, toLat, toLng) {
  const earthRadius = 6371000;
  const toRadians = (value) => (value * Math.PI) / 180;

  const deltaLat = toRadians(toLat - fromLat);
  const deltaLng = toRadians(toLng - fromLng);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) *
      Math.cos(toRadians(toLat)) *
      Math.sin(deltaLng / 2) ** 2;

  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
