export const NOTIFICATION_STALE_AFTER_MS = 5 * 60 * 1000;

export function shouldRefreshNotifications(lastSuccessfulFetchAt, now = Date.now()) {
  return !lastSuccessfulFetchAt || now - lastSuccessfulFetchAt >= NOTIFICATION_STALE_AFTER_MS;
}
