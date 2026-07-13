import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

const limiter = { async limit() { return { success: true }; } };

function aiBinding() {
  return {
    async run(_model, payload) {
      const system = payload.messages?.find((message) => message.role === "system")?.content || "";
      if (system.includes("four-role AI operations swarm")) {
        return { response: "<strategist>Frame the objective.</strategist><builder>Build the artifact.</builder><critic>Check assumptions.</critic><closer>Deliver and verify.</closer>" };
      }
      if (system.includes("Act as Strategist")) return { response: "Strategy draft" };
      if (system.includes("Act as Critic")) return { response: "Critique draft" };
      if (system.includes("Act as Builder")) return { response: "Builder draft" };
      if (system.includes("Act as Closer")) return { response: "Closer result" };
      return { response: "A bounded contender response." };
    }
  };
}

function longAiBinding() {
  return {
    async run() {
      return { response: Array.from({ length: 80 }, (_, index) => `word${index + 1}`).join(" ") };
    }
  };
}

async function json(response) {
  return { status: response.status, body: await response.json(), headers: response.headers };
}

function post(path, body, headers = {}) {
  return new Request(`https://forge-atlas.io${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://forge-atlas.io", ...headers },
    body: JSON.stringify(body)
  });
}

test("health exposes real provider and protection state", async () => {
  const result = await json(await worker.fetch(new Request("https://forge-atlas.io/api/health"), { AI: aiBinding(), RATE_LIMITER: limiter }));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.providers["workers-ai"], "configured");
  assert.equal(result.body.providers.openai, "not_configured");
  assert.equal(result.body.protections.rateLimit, "configured");
  assert.equal(result.headers.get("Cache-Control"), "no-store");
});

test("wrong methods and cross-site origins are rejected", async () => {
  const wrongMethod = await json(await worker.fetch(post("/api/health", {}), { RATE_LIMITER: limiter }));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.error.code, "METHOD_NOT_ALLOWED");

  const crossSite = post("/api/arena", { prompt: "Compare these options", fighters: ["atlas-strategist", "forge-critic"] }, { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" });
  const denied = await json(await worker.fetch(crossSite, { AI: aiBinding(), RATE_LIMITER: limiter }));
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "ORIGIN_DENIED");
});

test("cost-bearing operations fail closed without rate limiting", async () => {
  const result = await json(await worker.fetch(post("/api/arena", { prompt: "Compare two answers", fighters: ["atlas-strategist", "forge-critic"] }), { AI: aiBinding() }));
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, "PROTECTION_UNAVAILABLE");
});

test("oversized streamed JSON bodies are rejected before provider work", async () => {
  const result = await json(await worker.fetch(post("/api/arena", {
    prompt: "x".repeat(20_000),
    fighters: ["atlas-strategist", "forge-critic"]
  }), { AI: aiBinding(), RATE_LIMITER: limiter }));
  assert.equal(result.status, 413);
  assert.equal(result.body.error.code, "BODY_TOO_LARGE");
});

test("Fight Club uses registered contenders and labels provider fallback", async () => {
  const env = { AI: aiBinding(), RATE_LIMITER: limiter };
  const result = await json(await worker.fetch(post("/api/arena", {
    prompt: "Create a concise launch checklist.",
    fighters: ["atlas-strategist", "openai-operator"],
    mode: "precision",
    maxWords: 150
  }), env));
  assert.equal(result.status, 200);
  assert.equal(result.body.round.responses.length, 2);
  assert.equal(result.body.round.responses[0].provider, "workers-ai");
  assert.equal(result.body.round.responses[0].fallback, false);
  assert.equal(result.body.round.responses[1].provider, "workers-ai");
  assert.equal(result.body.round.responses[1].requestedProvider, "openai");
  assert.equal(result.body.round.responses[1].fallback, true);
});

test("Fight Club enforces the selected response limit after provider output", async () => {
  const result = await json(await worker.fetch(post("/api/arena", {
    prompt: "Return a deliberately long response for this boundary test.",
    fighters: ["atlas-strategist", "forge-critic"],
    maxWords: 50
  }), { AI: longAiBinding(), RATE_LIMITER: limiter }));
  assert.equal(result.status, 200);
  for (const response of result.body.round.responses) {
    assert.equal(response.text.trim().split(/\s+/).length, 50);
    assert.match(response.text, /…$/);
  }
});

test("Swarm supports rapid and full orchestration contracts", async () => {
  const env = { AI: aiBinding(), RATE_LIMITER: limiter };
  const rapid = await json(await worker.fetch(post("/api/swarm", { mission: "Create a launch plan with validation.", mode: "rapid", provider: "workers-ai" }), env));
  assert.equal(rapid.status, 200);
  assert.deepEqual(Object.keys(rapid.body.mission.roles), ["strategist", "builder", "critic", "closer"]);
  assert.equal(rapid.body.mission.roles.closer.text, "Deliver and verify.");

  const full = await json(await worker.fetch(post("/api/swarm", { mission: "Create a launch plan with validation.", mode: "full", provider: "workers-ai" }), env));
  assert.equal(full.status, 200);
  assert.equal(full.body.mission.roles.strategist.text, "Strategy draft");
  assert.equal(full.body.mission.roles.closer.text, "Closer result");
});

test("disabled community mutation is explicit", async () => {
  const result = await json(await worker.fetch(new Request("https://forge-atlas.io/api/forum-bridge"), {}));
  assert.equal(result.status, 501);
  assert.equal(result.body.error.code, "FEATURE_DISABLED");
});
