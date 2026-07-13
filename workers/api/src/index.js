import platform from "../../../config/platform.json" with { type: "json" };
import { ApiError } from "./errors.js";
import { analyzeHtml, fetchPublicHtml } from "./audit.js";
import { assertMethod, enforceRateLimit, failure, readJson, success, verifyRequestOrigin } from "./http.js";
import { runArena, runSwarm } from "./orchestration.js";
import { providerStates } from "./providers.js";

async function handle(request, env, requestId) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  verifyRequestOrigin(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS", "Cache-Control": "no-store", "X-Request-ID": requestId } });
  }

  if (path === "/api/health") {
    assertMethod(request, ["GET"]);
    return success({
      status: "ready",
      service: "forge-atlas-api",
      release: platform.release,
      version: platform.version,
      providers: providerStates(env),
      protections: { rateLimit: env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function" ? "configured" : "not_configured" },
      capabilities: {
        audit: env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function" ? "ready" : "protection_required",
        arena: "provider_bound",
        swarm: "provider_bound",
        mutations: "disabled"
      }
    }, requestId);
  }

  if (path === "/api/seo-audit") {
    assertMethod(request, ["POST"]);
    await enforceRateLimit(request, env, "seo-audit");
    const body = await readJson(request, 4_096);
    const { html, finalUrl } = await fetchPublicHtml(body?.url);
    return success({ audit: analyzeHtml(html, finalUrl) }, requestId);
  }

  if (path === "/api/arena") {
    assertMethod(request, ["POST"]);
    await enforceRateLimit(request, env, "arena");
    const body = await readJson(request, 16_384);
    return success({ round: await runArena(body, env) }, requestId);
  }

  if (path === "/api/swarm") {
    assertMethod(request, ["POST"]);
    await enforceRateLimit(request, env, "swarm");
    const body = await readJson(request, 16_384);
    return success({ mission: await runSwarm(body, env) }, requestId);
  }

  if (path === "/api/forum-bridge") {
    throw new ApiError(501, "FEATURE_DISABLED", "Community posting is disabled until authenticated persistence and moderation are configured.");
  }

  throw new ApiError(404, "ROUTE_NOT_FOUND", "API route not found.");
}

export default {
  async fetch(request, env = {}) {
    const requestId = crypto.randomUUID();
    try {
      return await handle(request, env, requestId);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) {
        console.error(JSON.stringify({ requestId, path: new URL(request.url).pathname, code: error?.code || "INTERNAL_ERROR", status: error?.status || 500 }));
      }
      return failure(error, requestId);
    }
  }
};
