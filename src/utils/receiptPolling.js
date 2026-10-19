export const RECEIPT_AUTO_POLL_MAX_MS = 5 * 60 * 1000;

const RECEIPT_POLL_DELAYS_MS = [5_000, 10_000, 20_000, 30_000];

export function getReceiptPollDelayMs(attempt) {
  const safeAttempt = Math.max(0, Math.floor(Number(attempt) || 0));
  return RECEIPT_POLL_DELAYS_MS[Math.min(safeAttempt, RECEIPT_POLL_DELAYS_MS.length - 1)];
}

export function shouldContinueReceiptAutoPolling(startedAt, now = Date.now()) {
  return Number.isFinite(startedAt) && now - startedAt < RECEIPT_AUTO_POLL_MAX_MS;
}
