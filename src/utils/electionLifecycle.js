import { parseAbsoluteTimestamp } from "./time.js";

const SCHEDULE_WALL_CLOCK =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/;
const MANILA_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parseManilaSchedule(value) {
  if (!value) return null;
  const text = String(value).trim();

  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(text)) {
    return parseAbsoluteTimestamp(text);
  }

  const match = text.match(SCHEDULE_WALL_CLOCK);
  if (!match) return parseAbsoluteTimestamp(text);

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const wallClockAsUtc = Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second),
  );
  const parts = Object.fromEntries(
    MANILA_PARTS.formatToParts(new Date(wallClockAsUtc)).map(({ type, value: part }) => [type, part]),
  );
  const manilaWallClockAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  const offset = manilaWallClockAsUtc - wallClockAsUtc;
  const instant = new Date(wallClockAsUtc - offset);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * Derive the campaign window from the election's existing schedule fields.
 * This is presentation only; trusted server-side campaign visibility remains
 * authoritative. Missing, malformed, or reversed dates never imply a valid
 * campaign window.
 */
export function getCampaignWindowPhase(election, now = new Date()) {
  const status = String(election?.status || "draft").trim().toLowerCase();
  if (status === "draft") return "not_available";
  if (status === "archived") return "archived";
  if (status === "closed" || status === "done") return "ended";
  if (status !== "active") return "not_available";

  const campaignStart = parseManilaSchedule(election?.campaign_start);
  const campaignEnd = parseManilaSchedule(election?.campaign_end);
  const currentTime = now instanceof Date ? now : new Date(now);
  if (!campaignStart || !campaignEnd || campaignStart >= campaignEnd || Number.isNaN(currentTime.getTime())) {
    return "not_scheduled";
  }
  if (currentTime < campaignStart) return "upcoming";
  if (currentTime < campaignEnd) return "ongoing";
  return "ended";
}

/**
 * Return the canonical client-side election phase for a shared `now` instant.
 * Schedule values without offsets are Manila wall-clock values, matching the
 * trusted database lifecycle checks. The browser clock is supplied centrally
 * by useElectionClock(); this helper remains pure for deterministic callers/tests.
 */
export function getElectionPhase(election, now = new Date()) {
  const campaignStart = parseManilaSchedule(election?.campaign_start);
  const campaignEnd = parseManilaSchedule(election?.campaign_end);
  const votingStart = parseManilaSchedule(election?.start_date);
  const votingEnd = parseManilaSchedule(election?.end_date);
  const status = String(election?.status || "draft").trim().toLowerCase();
  const currentTime = now instanceof Date ? now : new Date(now);

  if (status === "draft") return "draft";
  if (status === "archived") return "archived";
  if (status === "closed") return "closed";
  // Legacy `done` is terminal for mutation/reopen guards, but trusted result
  // release logic does not equate it with `closed`; preserve it as a distinct,
  // non-operational phase instead of inventing that equivalence.
  if (status === "done") return "done";

  if (campaignStart && campaignEnd && currentTime < campaignStart) {
    return "campaign_upcoming";
  }

  if (campaignStart && campaignEnd && currentTime >= campaignStart && currentTime < campaignEnd) {
    return "campaign";
  }

  if (campaignEnd && votingStart && currentTime >= campaignEnd && currentTime < votingStart) {
    return "waiting";
  }

  if (votingStart && votingEnd && currentTime >= votingStart && currentTime < votingEnd) {
    return "voting";
  }

  if (votingEnd && currentTime >= votingEnd) return "closed";
  if (status === "active" && votingStart && currentTime < votingStart) return "scheduled";

  // An incomplete/unknown persisted status is not promoted into an operational
  // phase. Callers may present it as an unclassified status without counting it
  // as Campaigning or Voting.
  return status;
}

export function countOperationalElections(elections = [], now = new Date()) {
  return elections.reduce((total, election) => {
    const phase = getElectionPhase(election, now);
    return total + (phase === "campaign" || phase === "voting" ? 1 : 0);
  }, 0);
}
