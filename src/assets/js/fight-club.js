import { safeStorage, showToast } from "./site.js";

const DEMOS = {
  recursion: {
    prompt: "Explain recursion in one sentence.",
    left: "Recursion is a problem-solving technique in which a function calls itself on smaller versions of the same problem until a defined stopping case is reached.",
    right: "Recursion solves a task by repeatedly applying the same rule to a smaller input, then unwinding once it reaches a base case."
  },
  launch: {
    prompt: "Create a five-step launch checklist.",
    left: "1. Define the target user and one measurable launch outcome.\n2. Verify the smallest complete product path end to end.\n3. Prepare messaging, support, monitoring, and rollback ownership.\n4. Release to a limited cohort and watch leading signals.\n5. Compare results with the threshold, fix failures, then expand deliberately.",
    right: "1. Lock the audience, promise, owner, and success metric.\n2. Test onboarding, analytics, accessibility, security, and recovery.\n3. Stage copy, documentation, support responses, and launch channels.\n4. Ship a reversible first release with active monitoring.\n5. Review evidence after the launch window and decide to scale, patch, or roll back."
  },
  security: {
    prompt: "Review an API gateway for its top three risks.",
    left: "1. Authorization drift: routes may authenticate a token but fail to enforce resource-level permission. Test every object and action boundary.\n2. Input and upstream abuse: validate schema, size, method, destination, redirects, and timeouts before proxying.\n3. Secret and log exposure: keep credentials server-side, redact errors, minimize retention, and audit access to operational logs.",
    right: "1. Broken access control—verify identity and authorization independently on every route.\n2. Unbounded forwarding—restrict destinations, payloads, redirects, retries, and response size to contain SSRF and denial-of-service paths.\n3. Observability leakage—prevent headers, tokens, prompts, and personal data from entering client errors or long-lived logs."
  }
};

const picker = document.querySelector("[data-fighter-picker]");
const fighterButtons = [...document.querySelectorAll("[data-fighter-id]")];
const countNode = document.querySelector("[data-selection-count]");
const form = document.querySelector("#fight-form");
const promptInput = document.querySelector("#fight-prompt");
const errorNode = document.querySelector("#fight-error");
const stage = document.querySelector("[data-fight-stage]");
const judgeDeck = document.querySelector("[data-judge-deck]");
const fallback = document.querySelector("[data-fight-fallback]");
const fallbackMessage = document.querySelector("[data-fallback-message]");
const demoButton = document.querySelector("[data-run-demo]");
const storage = safeStorage();
let selected = fighterButtons.filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.dataset.fighterId).slice(0, 2);
let activeRound = null;
let activeDemoKey = null;

function timeoutSignal(milliseconds) {
  if (AbortSignal.timeout) return AbortSignal.timeout(milliseconds);
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

function syncSelection() {
  fighterButtons.forEach((button) => button.setAttribute("aria-pressed", String(selected.includes(button.dataset.fighterId))));
  countNode.textContent = `${selected.length} / 2`;
}

const requestedFighter = new URLSearchParams(window.location.search).get("fighter");
if (requestedFighter && fighterButtons.some((button) => button.dataset.fighterId === requestedFighter) && !selected.includes(requestedFighter)) {
  selected = [requestedFighter, selected[0]].filter(Boolean).slice(0, 2);
  syncSelection();
}

picker?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-fighter-id]");
  if (!button) return;
  const id = button.dataset.fighterId;
  if (selected.includes(id)) {
    if (selected.length === 2) selected = selected.filter((value) => value !== id);
  } else if (selected.length < 2) selected.push(id);
  else selected = [selected[1], id];
  syncSelection();
  errorNode.textContent = "";
});

document.querySelectorAll("[data-demo-key]").forEach((button) => {
  button.addEventListener("click", () => {
    activeDemoKey = button.dataset.demoKey;
    promptInput.value = DEMOS[activeDemoKey].prompt;
    promptInput.focus();
    errorNode.textContent = "";
  });
});

function setProgress(step) {
  document.querySelector(".fight-progress")?.setAttribute("aria-valuenow", String(step));
  document.querySelectorAll("[data-step]").forEach((node) => {
    node.dataset.active = String(Number(node.dataset.step) <= step);
  });
}

function fighterMeta(id) {
  const button = fighterButtons.find((candidate) => candidate.dataset.fighterId === id);
  return { id, name: button?.dataset.fighterName || id, provider: button?.dataset.fighterProvider || "unknown" };
}

function setStageNames(left, right) {
  document.querySelector("[data-left-name]").textContent = left.name;
  document.querySelector("[data-right-name]").textContent = right.name;
  document.querySelector("[data-left-provider]").textContent = `${left.provider} · left corner`;
  document.querySelector("[data-right-provider]").textContent = `${right.provider} · right corner`;
}

function prepareStage() {
  const [left, right] = selected.map(fighterMeta);
  setStageNames(left, right);
  stage.hidden = false;
  fallback.dataset.visible = "false";
  judgeDeck.dataset.open = "false";
  document.querySelector("[data-fight-result]").textContent = "";
  document.querySelector("[data-round-id]").textContent = "ROUND · CONNECTING";
  document.querySelector("[data-round-status]").textContent = "Awaiting providers";
  for (const side of ["left", "right"]) {
    const output = document.querySelector(`[data-${side}-output]`);
    output.textContent = "Provider call in progress";
    output.dataset.state = "loading";
    document.querySelector(`[data-${side}-model]`).textContent = "Model pending";
    document.querySelector(`[data-${side}-latency]`).textContent = "Latency pending";
  }
  setProgress(1);
  stage.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function renderResponse(side, response) {
  const output = document.querySelector(`[data-${side}-output]`);
  output.dataset.state = "complete";
  output.textContent = response.text;
  document.querySelector(`[data-${side}-provider]`).textContent = `${response.provider}${response.fallback ? " · fallback" : ""} · ${side} corner`;
  document.querySelector(`[data-${side}-model]`).textContent = response.model;
  document.querySelector(`[data-${side}-latency]`).textContent = response.latencyMs == null ? "Latency not reported" : `${response.latencyMs} ms`;
  document.querySelector(`[data-${side}-name]`).textContent = response.name;
}

function completeRound(round) {
  if (!Array.isArray(round.responses) || round.responses.length !== 2) throw new Error("The Worker did not return two valid contender responses.");
  activeRound = round;
  renderResponse("left", round.responses[0]);
  renderResponse("right", round.responses[1]);
  document.querySelector("[data-round-id]").textContent = `ROUND · ${round.id}`;
  document.querySelector("[data-round-status]").textContent = round.mode === "demo" ? "Curated demo" : "Responses verified";
  setProgress(3);
  judgeDeck.dataset.open = "true";
}

function detectDemoKey(prompt) {
  const normalized = prompt.trim().replace(/\s+/g, " ").toLowerCase();
  return Object.entries(DEMOS).find(([, demo]) => demo.prompt.toLowerCase() === normalized)?.[0] || null;
}

function showFallback(error, prompt) {
  activeDemoKey = detectDemoKey(prompt);
  fallback.dataset.visible = "true";
  demoButton.disabled = !activeDemoKey;
  fallbackMessage.textContent = activeDemoKey
    ? `${error} A curated response exists for this exact demo prompt.`
    : `${error} Choose one of the curated demo prompts before using the fallback.`;
  document.querySelector("[data-round-status]").textContent = "Live round unavailable";
  for (const side of ["left", "right"]) {
    const output = document.querySelector(`[data-${side}-output]`);
    output.dataset.state = "error";
    output.textContent = "No verified response returned.";
  }
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (selected.length !== 2) {
    errorNode.textContent = "Select exactly two contenders.";
    return;
  }
  if (prompt.length < 5 || prompt.length > 2000) {
    errorNode.textContent = "Task must be between 5 and 2,000 characters.";
    promptInput.focus();
    return;
  }

  errorNode.textContent = "";
  prepareStage();
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  submit.textContent = "Round running…";

  try {
    const response = await fetch("/api/arena", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        fighters: selected,
        prompt,
        mode: form.elements.mode.value,
        maxWords: Number(form.elements.maxWords.value)
      }),
      signal: timeoutSignal(60_000)
    });
    setProgress(2);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message || `Worker returned HTTP ${response.status}.`);
    completeRound(payload.round);
    showToast("Two verified responses returned.", "success");
  } catch (error) {
    const message = error.name === "TimeoutError" || error.name === "AbortError" ? "The round timed out." : error.message;
    showFallback(message, prompt);
  } finally {
    submit.disabled = false;
    submit.textContent = "Start round ↗";
  }
});

demoButton?.addEventListener("click", () => {
  const demo = DEMOS[activeDemoKey];
  if (!demo) return;
  const [left, right] = selected.map(fighterMeta);
  completeRound({
    id: `DEMO-${activeDemoKey.toUpperCase()}`,
    mode: "demo",
    responses: [
      { ...left, provider: "Editorial demo", model: "No API call", latencyMs: null, fallback: false, text: demo.left },
      { ...right, provider: "Editorial demo", model: "No API call", latencyMs: null, fallback: false, text: demo.right }
    ]
  });
  fallback.dataset.visible = "false";
  showToast("Curated demo loaded and labeled.", "success");
});

judgeDeck?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-judge]");
  if (!button || !activeRound) return;
  const choice = button.dataset.judge;
  const winner = choice === "tie" ? "Tie recorded" : `${activeRound.responses[choice === "left" ? 0 : 1].name} selected`;
  document.querySelector("[data-fight-result]").textContent = `${winner} · stored only in this browser`;

  if (storage) {
    try {
      const previous = JSON.parse(storage.getItem("forgeAtlas.judgments.v1") || "[]");
      const judgments = Array.isArray(previous) ? previous.slice(-99) : [];
      judgments.push({ roundId: activeRound.id, choice, at: new Date().toISOString() });
      storage.setItem("forgeAtlas.judgments.v1", JSON.stringify(judgments));
    } catch {
      storage.removeItem("forgeAtlas.judgments.v1");
    }
  }
  showToast("Judgment saved locally.", "success");
});
