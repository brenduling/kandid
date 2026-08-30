export function parseDatabaseTimestamp(value) {
  if (!value) return null;
  const text = String(value);
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLocalDateTime(value, fallback = "Time unavailable") {
  const date = parseDatabaseTimestamp(value);
  return date ? date.toLocaleString() : fallback;
}

export function formatLocalDate(value, fallback = "Time unavailable") {
  const date = parseDatabaseTimestamp(value);
  return date ? date.toLocaleDateString() : fallback;
}

export function formatRelativeTime(value, now = new Date()) {
  const date = parseDatabaseTimestamp(value);
  if (!date) return "Time unavailable";

  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "Just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 45) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  return formatLocalDateTime(value);
}
