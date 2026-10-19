import { useEffect, useState } from "react";
import { fetchAuthoritativeNow } from "./elections";

const CLOCK_REFRESH_MS = 30_000;
let clockBaseMs = Date.now();
let clockUpdatedAt = Date.now();
let listeners = new Set();
let refreshRequest = null;
let refreshTimer = null;

function readClock() {
  return new Date(clockBaseMs + (Date.now() - clockUpdatedAt));
}

function publishClock(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    clockBaseMs = value.getTime();
    clockUpdatedAt = Date.now();
  }
  const current = readClock();
  listeners.forEach((listener) => listener(current));
}

function refreshClock() {
  if (!refreshRequest) {
    refreshRequest = fetchAuthoritativeNow()
      .then(publishClock)
      .finally(() => {
        refreshRequest = null;
      });
  }
  return refreshRequest;
}

function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) {
    refreshClock();
    refreshTimer = globalThis.setInterval(() => {
      publishClock();
      refreshClock();
    }, CLOCK_REFRESH_MS);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && refreshTimer !== null) {
      globalThis.clearInterval(refreshTimer);
      refreshTimer = null;
    }
  };
}

/** Shared UI clock: authoritative Kandid server time when configured, otherwise
 * one centralized browser-time fallback. The timer only refreshes displayed
 * lifecycle phases; trusted server rules remain authoritative for mutations. */
export function useElectionClock() {
  const [now, setNow] = useState(readClock);

  useEffect(() => subscribe(setNow), []);

  return now;
}
