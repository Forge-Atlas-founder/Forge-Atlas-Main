import { ApiError } from "./errors.js";

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Content-Type": "application/json; charset=utf-8",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

export function jsonResponse(body, status = 200, requestId = crypto.randomUUID(), extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, "X-Request-ID": requestId, ...extraHeaders }
  });
}

export function success(body, requestId, status = 200) {
  return jsonResponse({ ok: true, ...body }, status, requestId);
}

export function failure(error, requestId) {
  const apiError = error instanceof ApiError ? error : new ApiError(500, "INTERNAL_ERROR", "The request could not be completed.");
  const payload = { ok: false, error: { code: apiError.code, message: apiError.message }, requestId };
  if (apiError.details !== undefined) payload.error.details = apiError.details;
  return jsonResponse(payload, apiError.status, requestId);
}

export function assertMethod(request, allowed) {
  if (!allowed.includes(request.method)) {
    throw new ApiError(405, "METHOD_NOT_ALLOWED", `Use ${allowed.join(" or ")} for this route.`);
  }
}

export function verifyRequestOrigin(request, env) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  const configured = String(env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowed = new Set([requestUrl.origin, ...configured]);

  if (origin && !allowed.has(origin)) throw new ApiError(403, "ORIGIN_DENIED", "This origin is not allowed to call the API.");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) throw new ApiError(403, "ORIGIN_DENIED", "Cross-site browser requests are not allowed.");
}

export async function readJson(request, maxBytes = 16_384) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw new ApiError(415, "JSON_REQUIRED", "Use an application/json request body.");
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maxBytes) throw new ApiError(413, "BODY_TOO_LARGE", `Request body must be ${maxBytes} bytes or smaller.`);
  let text;
  if (!request.body?.getReader) {
    text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new ApiError(413, "BODY_TOO_LARGE", `Request body must be ${maxBytes} bytes or smaller.`);
  } else {
    const reader = request.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let received = 0;
    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "BODY_TOO_LARGE", `Request body must be ${maxBytes} bytes or smaller.`);
      }
      output += decoder.decode(value, { stream: true });
    }
    text = output + decoder.decode();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
}

export function cleanText(value, { min = 0, max = 1_000, label = "Text" } = {}) {
  if (typeof value !== "string") throw new ApiError(400, "INVALID_INPUT", `${label} must be text.`);
  const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim();
  if (normalized.length < min || normalized.length > max) throw new ApiError(400, "INVALID_INPUT", `${label} must be between ${min} and ${max} characters.`);
  return normalized;
}

export async function enforceRateLimit(request, env, route) {
  if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") {
    if (String(env.REQUIRE_RATE_LIMITER ?? "true").toLowerCase() !== "false") {
      throw new ApiError(503, "PROTECTION_UNAVAILABLE", "This operation is unavailable until server-side rate limiting is configured.");
    }
    return;
  }
  const client = request.headers.get("CF-Connecting-IP") || "unknown";
  const result = await env.RATE_LIMITER.limit({ key: `${route}:${client}` });
  if (!result?.success) throw new ApiError(429, "RATE_LIMITED", "Too many requests. Wait before trying again.");
}
