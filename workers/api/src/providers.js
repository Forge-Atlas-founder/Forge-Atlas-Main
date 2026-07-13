import { ApiError, ProviderError } from "./errors.js";

export const PROVIDERS = new Set(["workers-ai", "openai", "anthropic", "gemini"]);
export const DEFAULT_WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash";

export function providerStates(env) {
  return {
    "workers-ai": env.AI && typeof env.AI.run === "function" ? "configured" : "not_configured",
    openai: env.OPENAI_API_KEY && env.OPENAI_MODEL ? "configured" : "not_configured",
    anthropic: env.ANTHROPIC_API_KEY && env.ANTHROPIC_MODEL ? "configured" : "not_configured",
    gemini: env.GEMINI_API_KEY && env.GEMINI_MODEL ? "configured" : "not_configured"
  };
}

export function isProviderConfigured(provider, env) {
  return providerStates(env)[provider] === "configured";
}

function extractText(payload) {
  if (typeof payload === "string") return payload.trim();
  if (typeof payload?.response === "string") return payload.response.trim();
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  if (typeof payload?.choices?.[0]?.message?.content === "string") return payload.choices[0].message.content.trim();
  const openAiText = payload?.output?.flatMap((item) => item?.content || []).map((item) => item?.text).filter((value) => typeof value === "string").join("\n").trim();
  if (openAiText) return openAiText;
  const anthropicText = payload?.content?.map((item) => item?.text).filter((value) => typeof value === "string").join("\n").trim();
  if (anthropicText) return anthropicText;
  const geminiText = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text).filter((value) => typeof value === "string").join("\n").trim();
  return geminiText || "";
}

async function fetchProviderJson(provider, url, init, timeoutMs = 45_000) {
  const signal = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  let response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (error) {
    throw new ProviderError(provider, error?.name === "TimeoutError" ? `${provider} timed out.` : `${provider} could not be reached.`);
  }
  if (!response.ok) throw new ProviderError(provider, `${provider} returned HTTP ${response.status}.`);
  const maxBytes = 2_000_000;
  const declared = Number(response.headers.get("Content-Length") || 0);
  if (declared > maxBytes) throw new ProviderError(provider, `${provider} returned an oversized response.`);
  let text;
  if (!response.body?.getReader) {
    text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new ProviderError(provider, `${provider} returned an oversized response.`);
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let received = 0;
    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new ProviderError(provider, `${provider} returned an oversized response.`);
      }
      output += decoder.decode(value, { stream: true });
    }
    text = output + decoder.decode();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(provider, `${provider} returned invalid JSON.`);
  }
}

async function runWorkersAi(messages, env, options) {
  const model = env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL;
  let payload;
  try {
    payload = await env.AI.run(model, {
      messages,
      max_completion_tokens: options.maxTokens,
      temperature: options.temperature,
      store: false
    });
  } catch {
    throw new ProviderError("workers-ai", "Workers AI did not complete the request.");
  }
  const text = extractText(payload);
  if (!text) throw new ProviderError("workers-ai");
  return { text, model };
}

async function runOpenAi(messages, env, options) {
  const input = messages.map((message) => ({ role: message.role === "system" ? "developer" : message.role, content: message.content }));
  const payload = await fetchProviderJson("openai", "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.OPENAI_MODEL, input, max_output_tokens: options.maxTokens, store: false })
  });
  const text = extractText(payload);
  if (!text) throw new ProviderError("openai");
  return { text, model: payload.model || env.OPENAI_MODEL };
}

async function runAnthropic(messages, env, options) {
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const conversational = messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role, content: message.content }));
  const payload = await fetchProviderJson("anthropic", "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL, max_tokens: options.maxTokens, system, messages: conversational })
  });
  const text = extractText(payload);
  if (!text) throw new ProviderError("anthropic");
  return { text, model: payload.model || env.ANTHROPIC_MODEL };
}

async function runGemini(messages, env, options) {
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const contents = messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }]
  }));
  const model = encodeURIComponent(env.GEMINI_MODEL);
  const payload = await fetchProviderJson("gemini", `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: options.maxTokens, temperature: options.temperature },
      store: false
    })
  });
  const text = extractText(payload);
  if (!text) throw new ProviderError("gemini");
  return { text, model: env.GEMINI_MODEL };
}

export async function runProvider(requestedProvider, messages, env, options = {}) {
  if (!PROVIDERS.has(requestedProvider)) throw new ApiError(400, "UNKNOWN_PROVIDER", "Requested provider is not registered.");
  const actualProvider = isProviderConfigured(requestedProvider, env)
    ? requestedProvider
    : requestedProvider !== "workers-ai" && isProviderConfigured("workers-ai", env)
      ? "workers-ai"
      : null;
  if (!actualProvider) throw new ApiError(503, "PROVIDER_UNAVAILABLE", `${requestedProvider} is not configured and no labeled fallback is available.`);

  const started = Date.now();
  const requestedMaxTokens = Number(options.maxTokens);
  const requestedTemperature = Number(options.temperature);
  const normalizedOptions = {
    maxTokens: Math.max(64, Math.min(Number.isFinite(requestedMaxTokens) ? requestedMaxTokens : 512, 2_048)),
    temperature: Math.max(0, Math.min(Number.isFinite(requestedTemperature) ? requestedTemperature : 0.4, 1.5))
  };
  let result;
  if (actualProvider === "workers-ai") result = await runWorkersAi(messages, env, normalizedOptions);
  else if (actualProvider === "openai") result = await runOpenAi(messages, env, normalizedOptions);
  else if (actualProvider === "anthropic") result = await runAnthropic(messages, env, normalizedOptions);
  else result = await runGemini(messages, env, normalizedOptions);

  return {
    text: result.text.slice(0, 20_000),
    provider: actualProvider,
    model: result.model,
    latencyMs: Date.now() - started,
    fallback: actualProvider !== requestedProvider,
    requestedProvider
  };
}
