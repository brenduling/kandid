export const KANDID_WEB_ORIGIN = "https://witkandid.vercel.app";
export const KANDID_WEB_ORIGINS = Object.freeze([
  KANDID_WEB_ORIGIN,
  "http://localhost:5173",
  "http://localhost:5174",
]);
export const ADMIN_INVITE_REDIRECT_URL = `${KANDID_WEB_ORIGIN}/admin-auth/setup`;

const BASE_CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Vary": "Origin",
});

export const corsHeaders = Object.freeze({
  ...BASE_CORS_HEADERS,
  "Access-Control-Allow-Origin": KANDID_WEB_ORIGIN,
});

export function corsHeadersForOrigin(origin) {
  if (!KANDID_WEB_ORIGINS.includes(origin)) return null;
  return {
    ...BASE_CORS_HEADERS,
    "Access-Control-Allow-Origin": origin,
  };
}

export function withKandidCors(request, response) {
  const origin = request.headers.get("origin");
  const allowedHeaders = corsHeadersForOrigin(origin);
  if (!allowedHeaders) return response;

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(allowedHeaders)) {
    if (name.toLowerCase() === "vary" && headers.has(name)) {
      const vary = new Set([
        ...headers.get(name).split(",").map((item) => item.trim()),
        ...value.split(",").map((item) => item.trim()),
      ].filter(Boolean));
      headers.set(name, [...vary].join(", "));
    } else {
      headers.set(name, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function serveWithKandidCors(handler) {
  return Deno.serve(async (request) => {
    const response = await handler(request);
    return withKandidCors(request, response);
  });
}

const ALLOWED_PREFLIGHT_HEADERS = new Set([
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-retry-count",
]);
const PREFLIGHT_VARY = "Origin, Access-Control-Request-Method, Access-Control-Request-Headers";

function rejectedOriginResponse() {
  return new Response(JSON.stringify({ error: "Origin not allowed." }), {
    status: 403,
    headers: {
      "Content-Type": "application/json",
      "Vary": "Origin",
    },
  });
}

export function rejectDisallowedOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin === null || KANDID_WEB_ORIGINS.includes(origin)) return null;
  return rejectedOriginResponse();
}

export function handleCorsPreflight(request) {
  if (request.method !== "OPTIONS") return null;

  const origin = request.headers.get("origin");
  if (origin === null) {
    const requestedMethod = request.headers.get("access-control-request-method")?.toUpperCase();
    if (requestedMethod && requestedMethod !== "POST") {
      return new Response(null, {
        status: 403,
        headers: { "Allow": "POST, OPTIONS" },
      });
    }
    return new Response(null, {
      status: 204,
      headers: { "Allow": "POST, OPTIONS" },
    });
  }

  const responseHeaders = corsHeadersForOrigin(origin);
  if (!responseHeaders) {
    return rejectedOriginResponse();
  }

  const requestedMethod = request.headers.get("access-control-request-method")?.toUpperCase();
  if (requestedMethod !== "POST") {
    return new Response(null, {
      status: 403,
        headers: { ...responseHeaders, "Vary": PREFLIGHT_VARY },
    });
  }

  const requestedHeaders = (request.headers.get("access-control-request-headers") || "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((header) => !ALLOWED_PREFLIGHT_HEADERS.has(header))) {
    return new Response(null, {
      status: 403,
        headers: { ...responseHeaders, "Vary": PREFLIGHT_VARY },
    });
  }

  return new Response(null, {
    status: 204,
    headers: { ...responseHeaders, "Vary": PREFLIGHT_VARY },
  });
}

export function resolveAdminInviteRedirect(configuredValue) {
  const target = String(configuredValue || ADMIN_INVITE_REDIRECT_URL).trim();
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new Error("Administrator invite redirect is invalid.");
  }

  if (
    url.protocol !== "https:" ||
    url.origin !== KANDID_WEB_ORIGIN ||
    url.pathname !== "/admin-auth/setup" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Administrator invite redirect must use the official setup route.");
  }

  return url.toString();
}
