/* Read-only presentation helpers for the Board election surfaces.
 *
 * Shared by the Elections register, the guided Create/Edit setup and the Manage
 * Setup workspace so all three render a schedule identically.
 *
 * Lifecycle classification uses Manila wall-clock schedules against the shared
 * Kandid clock. This helper only changes display copy for that derived phase. */

import { parseScheduleWallClock } from "../../utils/time";
import { getElectionPhase } from "../../utils/elections";

/* Display copy for the phase the lifecycle logic actually returned. The stored
   value from getElectionPhase() is unchanged, so no status is introduced, renamed
   or reinterpreted here. */
export function electionPhaseLabel(election, now) {
  return getElectionPhase(election, now).replace(/_/g, " ");
}


const SCHEDULE_DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const SCHEDULE_DAY_YEAR_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const SCHEDULE_CLOCK_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const SCHEDULE_ARROW = "\u2192";
const SCHEDULE_ABSENT = { date: "-", time: "" };

function isSameScheduleDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/* Returns the date line and the time line for one schedule window.
 *
 * - A single timestamp yields one date and one time. No end is inferred.
 * - A same-day start/end states the date once and keeps both times.
 * - A cross-day start/end states both dates.
 * - The year rides on the first date and is repeated on the last date only when
 *   that date falls in a different year, so a normal row never repeats the year
 *   while a cross-year election stays unambiguous. */
export function formatElectionSchedule(startValue, endValue) {
  const start = parseScheduleWallClock(startValue);
  const end = parseScheduleWallClock(endValue);

  if (!start && !end) return SCHEDULE_ABSENT;

  if (!start || !end) {
    const only = start || end;
    return {
      date: SCHEDULE_DAY_YEAR_FORMAT.format(only),
      time: SCHEDULE_CLOCK_FORMAT.format(only),
    };
  }

  const startDay = SCHEDULE_DAY_YEAR_FORMAT.format(start);
  const startTime = SCHEDULE_CLOCK_FORMAT.format(start);
  const endTime = SCHEDULE_CLOCK_FORMAT.format(end);

  if (isSameScheduleDay(start, end)) {
    return {
      date: startDay,
      time: `${startTime} ${SCHEDULE_ARROW} ${endTime}`,
    };
  }

  const crossesYear = end.getFullYear() !== start.getFullYear();
  const endDay = crossesYear
    ? SCHEDULE_DAY_YEAR_FORMAT.format(end)
    : SCHEDULE_DAY_FORMAT.format(end);

  return {
    date: `${startDay} ${SCHEDULE_ARROW} ${endDay}`,
    time: `${startTime} ${SCHEDULE_ARROW} ${endTime}`,
  };
}
