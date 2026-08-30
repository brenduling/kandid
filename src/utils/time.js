const DATE_TIME_PARTS =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/;

function hasExplicitTimezone(value) {
  return /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(String(value || ""));
}

export function parseAbsoluteTimestamp(value) {
  if (!value) return null;
  const text = String(value);
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseScheduleWallClock(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(DATE_TIME_PARTS);

  if (!match) {
    const fallback = new Date(text);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseDatabaseTimestamp(value) {
  return hasExplicitTimezone(value)
    ? parseAbsoluteTimestamp(value)
    : parseScheduleWallClock(value);
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

export function scheduleWallClockToFormValue(value) {
  if (!value) return "";
  const text = String(value).trim();
  const match = text.match(DATE_TIME_PARTS);

  if (match) {
    const [, year, month, day, hour = "00", minute = "00"] = match;
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }

  const date = parseScheduleWallClock(value);
  if (!date) return "";

  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join("-") + `T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

export function formValueToScheduleWallClock(value) {
  const formValue = scheduleWallClockToFormValue(value);
  return formValue || null;
}

export function formatLocalDateTime(value, fallback = "Time unavailable") {
  const date = parseAbsoluteTimestamp(value);
  return date ? date.toLocaleString() : fallback;
}

export function formatLocalDate(value, fallback = "Time unavailable") {
  const date = parseAbsoluteTimestamp(value);
  return date ? date.toLocaleDateString() : fallback;
}

export function formatScheduleDateTime(value, fallback = "Time unavailable") {
  const date = parseScheduleWallClock(value);
  return date ? date.toLocaleString() : fallback;
}

export function formatScheduleDate(value, fallback = "Time unavailable") {
  const date = parseScheduleWallClock(value);
  return date ? date.toLocaleDateString() : fallback;
}

export function formatRelativeTime(value, now = new Date()) {
  const date = parseAbsoluteTimestamp(value);
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
