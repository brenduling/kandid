const IMPLEMENTATION_DETAIL = /(?:PostgREST|Postgres|PostgreSQL|SQLSTATE|\bPGRST\d+\b|violates (?:the )?.*constraint|row-level security|schema cache|permission denied for|relation .* does not exist|column .* does not exist|invalid input syntax|duplicate key value|JWT expired|stack trace|\bat\s+[\w./:-]+\s*\(|TypeError:\s*Failed to fetch|NetworkError|fetch failed)/i;

export function toBoardFacingError(message, fallback = "That action could not be completed. Please try again.") {
  const text = String(message || "");
  if (!text) return fallback;
  return IMPLEMENTATION_DETAIL.test(text)
    ? "That action could not be completed. Please try again. If the issue continues, contact a system administrator."
    : text;
}
