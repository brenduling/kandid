export const KANDID_WEB_ORIGINS = Object.freeze([
  "https://witkandid.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174",
]);

const CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Vary": "Origin",
});
const PREFLIGHT_VARY = "Origin, Access-Control-Request-Method, Access-Control-Request-Headers";
const REQUEST_HEADERS = new Set(["authorization", "x-client-info", "apikey", "content-type", "x-retry-count"]);

export function corsHeadersForOrigin(origin) {
  if (!KANDID_WEB_ORIGINS.includes(origin)) return null;
  return { ...CORS_HEADERS, "Access-Control-Allow-Origin": origin };
}

export function withKandidCors(request, response) {
  const origin = request.headers.get("origin");
  const cors = origin === null ? null : corsHeadersForOrigin(origin);
  if (!cors) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(cors)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function serveWithKandidCors(handler) {
  return Deno.serve(async (request) => withKandidCors(request, await handler(request)));
}

function rejectOrigin() {
  return new Response(JSON.stringify({ error: "Origin not allowed." }), {
    status: 403,
    headers: { "Content-Type": "application/json", "Vary": "Origin" },
  });
}

export function rejectDisallowedOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin === null || KANDID_WEB_ORIGINS.includes(origin)) return null;
  return rejectOrigin();
}

export function handleCorsPreflight(request) {
  if (request.method !== "OPTIONS") return null;
  const origin = request.headers.get("origin");
  const requestedMethod = request.headers.get("access-control-request-method")?.toUpperCase();
  if (origin === null) {
    return new Response(null, {
      status: requestedMethod && requestedMethod !== "POST" ? 403 : 204,
      headers: { "Allow": "POST, OPTIONS" },
    });
  }
  const cors = corsHeadersForOrigin(origin);
  if (!cors) return rejectOrigin();
  const requestedHeaders = (request.headers.get("access-control-request-headers") || "")
    .split(",").map((header) => header.trim().toLowerCase()).filter(Boolean);
  if (requestedMethod !== "POST" || requestedHeaders.some((header) => !REQUEST_HEADERS.has(header))) {
    return new Response(null, { status: 403, headers: { ...cors, "Vary": PREFLIGHT_VARY } });
  }
  return new Response(null, { status: 204, headers: { ...cors, "Vary": PREFLIGHT_VARY } });
}
