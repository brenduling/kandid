const PROFILE_LIMIT = 500;

function safeRequestPath(input) {
  const rawUrl = typeof input === "string" ? input : input?.url || "";

  try {
    const url = new URL(rawUrl);
    return `${url.pathname}${url.search ? "?..." : ""}`;
  } catch {
    return rawUrl.split("?")[0] || "";
  }
}

function canUseDevProfiler() {
  return typeof window !== "undefined" && import.meta.env.DEV;
}

function summarizeByPath(entries, filter = () => true) {
  return Object.values(
    entries.filter(filter).reduce((groups, entry) => {
      const key = entry.path || "(unknown)";
      groups[key] ||= {
        path: key,
        count: 0,
        totalDurationMs: 0,
        failedCount: 0,
      };
      groups[key].count += 1;
      groups[key].totalDurationMs += Number(entry.durationMs || 0);
      if (entry.status >= 400) groups[key].failedCount += 1;
      return groups;
    }, {}),
  )
    .map((group) => ({
      ...group,
      totalDurationMs: Math.round(group.totalDurationMs * 10) / 10,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.failedCount - a.failedCount ||
        b.totalDurationMs - a.totalDurationMs,
    );
}

export function shouldProfileSupabase() {
  return canUseDevProfiler();
}

export function installSupabaseProfileHelpers() {
  if (!canUseDevProfiler()) return;

  window.__KANDID_SUPABASE_PROFILE__ ||= [];

  window.__KANDID_RESET_PROFILE__ = () => {
    window.__KANDID_SUPABASE_PROFILE__ = [];
    return "Kandid Supabase profile cleared.";
  };

  window.__KANDID_PROFILE_SUMMARY__ = () => {
    const entries = window.__KANDID_SUPABASE_PROFILE__ || [];
    const successful = entries.filter(
      (entry) => entry.status >= 200 && entry.status < 400
    );
    const failed = entries.filter((entry) => entry.status >= 400);
    const totalDurationMs = entries.reduce(
      (sum, entry) => sum + Number(entry.durationMs || 0),
      0
    );
    const slowest = [...entries].sort(
      (a, b) => Number(b.durationMs || 0) - Number(a.durationMs || 0)
    )[0] || null;
    const largestKnown = [...entries]
      .filter((entry) => entry.contentLength !== null)
      .sort(
        (a, b) => Number(b.contentLength || 0) - Number(a.contentLength || 0)
      )[0] || null;
    const duplicateGroups = entries.reduce((groups, entry) => {
      const key = `${entry.method} ${entry.path}`;
      groups[key] ||= [];
      groups[key].push(entry);
      return groups;
    }, {});
    const duplicates = Object.entries(duplicateGroups)
      .filter(([, group]) => group.length > 1)
      .map(([request, group]) => ({
        request,
        count: group.length,
        totalDurationMs:
          Math.round(
            group.reduce((sum, entry) => sum + Number(entry.durationMs || 0), 0) *
              10
          ) / 10,
      }))
      .sort((a, b) => b.count - a.count || b.totalDurationMs - a.totalDurationMs);

    return {
      requestCount: entries.length,
      successfulRequestCount: successful.length,
      failedRequestCount: failed.length,
      totalRecordedRequestDurationMs:
        Math.round(totalDurationMs * 10) / 10,
      slowestRequest: slowest,
      largestKnownResponse: largestKnown,
      repeatedRequests: duplicates,
      requestsByPath: summarizeByPath(entries),
      failuresByPath: summarizeByPath(entries, (entry) => entry.status >= 400),
      durationByPath: summarizeByPath(entries).sort(
        (a, b) => b.totalDurationMs - a.totalDurationMs,
      ),
    };
  };
}

export function recordSupabaseRequest(input, init, response, durationMs) {
  if (!shouldProfileSupabase()) return;

  const entry = {
    method: init?.method || "GET",
    path: safeRequestPath(input),
    status: response.status,
    durationMs: Math.round(durationMs * 10) / 10,
    contentLength: response.headers.get("content-length"),
    startedAt: new Date().toISOString(),
  };

  if (response.status >= 400) {
    response
      .clone()
      .json()
      .then((body) => {
        if (!body || typeof body !== "object") return;
        entry.error = {
          code: body.code,
          details: body.details,
          hint: body.hint,
          message: body.message,
        };
      })
      .catch(() => {});
  }

  window.__KANDID_SUPABASE_PROFILE__ ||= [];
  window.__KANDID_SUPABASE_PROFILE__.push(entry);
  if (window.__KANDID_SUPABASE_PROFILE__.length > PROFILE_LIMIT) {
    window.__KANDID_SUPABASE_PROFILE__.shift();
  }

  console.debug("[Kandid Supabase]", entry);
}

installSupabaseProfileHelpers();
