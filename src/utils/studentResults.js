import {
  RESULT_VISIBILITY_MODES,
  normalizeResultVisibilityMode,
  resultVisibilityLabel,
} from "./results.js";
import { getElectionPhase } from "./electionLifecycle.js";
import { formatScheduleDate } from "./time.js";

export const STUDENT_RESULTS_ERROR_KINDS = {
  FORBIDDEN: "forbidden",
  NETWORK: "network",
  BACKEND: "backend",
};

export const STUDENT_RESULTS_ERROR_COPY = {
  forbidden: {
    kicker: "Results status",
    title: "Access could not be verified",
    body: "The results service did not confirm that this account can view this election. No results were loaded. If you think this is an error, contact your election team.",
    action: "Try again",
  },
  network: {
    kicker: "Connection problem",
    title: "We could not reach the results service",
    body: "Check your internet connection, then try again.",
    action: "Retry",
  },
  backend: {
    kicker: "Results unavailable",
    title: "Results are temporarily unavailable",
    body: "The results service did not respond properly. Try again in a moment.",
    action: "Retry",
  },
};

const NETWORK_ERROR_PATTERN =
  /failed to send a request|failed to fetch|networkerror|network request failed|load failed|err_internet_disconnected|err_network|error sending request to relay|timed out|timeout|aborterror/i;
const BACKEND_ERROR_PATTERN =
  /could not find the function|container is not running|permission denied for (table|relation|function|rpc)|schema cache|does not exist|no matches found/i;
const FORBIDDEN_ERROR_PATTERN =
  /election is unavailable|election results are unavailable|eligible student authentication is required|authentication required|not authorized|insufficient privilege/i;

const PHASE_LABELS = {
  voting: "Voting is open",
  closed: "Voting has closed",
  done: "Election completed",
  archived: "Election archived",
  campaign: "Campaign period",
  campaign_upcoming: "Campaign has not started",
  waiting: "Waiting for voting to open",
  scheduled: "Voting has not started",
};

async function readFunctionErrorContext(error) {
  const context = error?.context;
  if (!context) return { status: null, body: null };

  let body = null;
  try {
    const response = typeof context.clone === "function" ? context.clone() : context;
    if (response && typeof response.json === "function") {
      const parsed = await response.json();
      if (parsed && typeof parsed === "object") body = parsed;
    }
  } catch {
    body = null;
  }

  const status = Number(context.status);
  return { status: Number.isFinite(status) ? status : null, body };
}

export async function classifyStudentResultsError(error) {
  if (!error) return STUDENT_RESULTS_ERROR_KINDS.BACKEND;

  const { status: contextStatus, body } = await readFunctionErrorContext(error);
  const message = [
    error.message,
    error.details,
    error.hint,
    body?.error,
    body?.message,
    body?.msg,
    body?.error_description,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" | ");
  const normalized = message.toLowerCase();
  const code = String(error.code || body?.code || "");
  const status = Number(error.status) || contextStatus || null;

  if (
    NETWORK_ERROR_PATTERN.test(normalized) ||
    ["TypeError", "AbortError", "FunctionsFetchError"].includes(error.name)
  ) {
    return STUDENT_RESULTS_ERROR_KINDS.NETWORK;
  }
  if (BACKEND_ERROR_PATTERN.test(normalized)) return STUDENT_RESULTS_ERROR_KINDS.BACKEND;
  if (FORBIDDEN_ERROR_PATTERN.test(normalized)) return STUDENT_RESULTS_ERROR_KINDS.FORBIDDEN;
  if (code === "PGRST202" || status === 404 || (status !== null && status >= 500)) {
    return STUDENT_RESULTS_ERROR_KINDS.BACKEND;
  }
  if (["401", "403", "42501"].includes(code) || status === 401 || status === 403) {
    return STUDENT_RESULTS_ERROR_KINDS.FORBIDDEN;
  }
  return STUDENT_RESULTS_ERROR_KINDS.BACKEND;
}

export function studentResultsPhaseLabel(election, now = new Date()) {
  const phase = getElectionPhase(election, now);
  return PHASE_LABELS[phase] || "Election status unavailable";
}

export function studentResultsStatusMeta(election, now = new Date()) {
  if (!election) return "";

  const parts = [];
  if (election.organizations?.name) parts.push(election.organizations.name);
  parts.push(
    resultVisibilityLabel(
      election.student_result_visibility,
      election.results_released_at,
    ),
  );
  parts.push(studentResultsPhaseLabel(election, now));

  const start = formatScheduleDate(election.start_date, "");
  const end = formatScheduleDate(election.end_date, "");
  if (start && end) parts.push(`Voting ${start} – ${end}`);
  else if (end) parts.push(`Voting ends ${end}`);
  else if (start) parts.push(`Voting opens ${start}`);

  return parts.filter(Boolean).join(" · ");
}

export function studentAwaitingResultsCopy(election, now = new Date()) {
  const mode = normalizeResultVisibilityMode(election?.student_result_visibility);
  const phase = getElectionPhase(election, now);
  let body;

  if (phase === "archived") {
    body = "This election is archived, so its results are not shown here.";
  } else if (mode === RESULT_VISIBILITY_MODES.MANUAL) {
    body =
      phase === "closed"
        ? "Voting has closed. The election team has not released the official results yet, so check again after the official release."
        : "Official results are released by the election team after voting closes.";
  } else if (mode === RESULT_VISIBILITY_MODES.AFTER_CLOSE) {
    body = "Official results become available once voting closes.";
  } else {
    body =
      phase === "voting" || phase === "closed"
        ? "Real-time results are not available yet. Check again shortly."
        : "Real-time results appear here once voting opens.";
  }

  return { kicker: "Results status", title: "Awaiting Official Results", body };
}

export function studentZeroVoteCopy(election) {
  if (election?.results_released_at) {
    return {
      kicker: "Official tally",
      title: "No votes recorded",
      body: "The election team released these results, and no ballots were recorded for this election.",
    };
  }

  return {
    kicker: "Official tally",
    title: "No votes yet",
    body: "No ballots have been recorded for this election yet. Tallies update as votes are submitted.",
  };
}
