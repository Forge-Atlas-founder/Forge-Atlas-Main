import assert from "node:assert/strict";
import test from "node:test";
import { runProvider } from "../src/providers.js";

const messages = [{ role: "system", content: "Be concise." }, { role: "user", content: "Return one sentence." }];

async function withFetch(fake, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await callback();
  } finally {
    globalThis.fetch = original;
  }
}

test("OpenAI adapter uses Responses API and disables storage", async () => {
  let request;
  const output = await withFetch(async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ model: "configured-openai", output_text: "OpenAI result" }), { status: 200 });
  }, () => runProvider("openai", messages, { OPENAI_API_KEY: "test-value", OPENAI_MODEL: "configured-openai" }, { maxTokens: 128, temperature: 0 }));
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.body.store, false);
  assert.equal(request.body.input[0].role, "developer");
  assert.equal(output.text, "OpenAI result");
});

test("Anthropic adapter uses Messages API with the required version header", async () => {
  let request;
  const output = await withFetch(async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ model: "configured-claude", content: [{ type: "text", text: "Anthropic result" }] }), { status: 200 });
  }, () => runProvider("anthropic", messages, { ANTHROPIC_API_KEY: "test-value", ANTHROPIC_MODEL: "configured-claude" }, { maxTokens: 128 }));
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.body.system, "Be concise.");
  assert.equal(output.text, "Anthropic result");
});

test("Gemini adapter uses generateContent, a header key, and request-level no-store", async () => {
  let request;
  const output = await withFetch(async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Gemini result" }] } }] }), { status: 200 });
  }, () => runProvider("gemini", messages, { GEMINI_API_KEY: "test-value", GEMINI_MODEL: "configured-gemini" }, { maxTokens: 128 }));
  assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/models/configured-gemini:generateContent");
  assert.equal(request.init.headers["x-goog-api-key"], "test-value");
  assert.equal(request.body.store, false);
  assert.equal(request.body.systemInstruction.parts[0].text, "Be concise.");
  assert.equal(output.text, "Gemini result");
});

test("provider adapters reject declared oversized responses before buffering", async () => {
  await withFetch(async () => new Response("{}", {
    status: 200,
    headers: { "Content-Length": "2000001" }
  }), async () => {
    await assert.rejects(
      runProvider("openai", messages, { OPENAI_API_KEY: "test-value", OPENAI_MODEL: "configured-openai" }, { maxTokens: 128 }),
      (error) => error.code === "PROVIDER_ERROR" && /oversized/.test(error.message)
    );
  });
});
