import { showToast } from "./site.js";

const DEMOS = {
  launch: {
    mission: "Create a reversible launch plan for a new developer tool, including success metrics, risks, and rollback triggers.",
    roles: {
      strategist: "Define one narrow user segment, one painful job, and one measurable activation event. Launch to a limited cohort first. The decision gate is evidence: expand only when activation and error thresholds both hold.",
      builder: "1. Instrument activation, failure, and support signals.\n2. Prepare onboarding, documentation, status messaging, and rollback ownership.\n3. Release to a small cohort.\n4. Review signals at fixed checkpoints.\n5. Patch, roll back, or expand against the written thresholds.",
      critic: "Main risks: a vague activation metric, hidden setup friction, and a rollback that exists only on paper. Rehearse rollback, test the first-run path with unfamiliar users, and assign one decision owner before release.",
      closer: "Launch with a limited cohort and a written decision sheet: target user, activation event, maximum acceptable error rate, support owner, checkpoint time, and rollback trigger. Instrument first, rehearse recovery, then release. Scale only after both user value and reliability clear their thresholds."
    }
  },
  workflow: {
    mission: "Audit a small business workflow for automation opportunities and rank the safest high-value changes.",
    roles: {
      strategist: "Map the workflow from trigger to completed outcome. Measure frequency, wait time, rework, error impact, and data sensitivity before choosing tools.",
      builder: "Create a queue of candidates: repetitive data transfer, scheduled reminders, document generation, and status reporting. Pilot the highest-frequency low-risk handoff with human approval at the final action.",
      critic: "Avoid automating exceptions, ambiguous approvals, or access to sensitive systems first. Watch for duplicate actions, stale source data, missing ownership, and silent failures.",
      closer: "Start with one reversible automation that removes frequent copying while preserving human approval. Record baseline time and errors, add idempotency and alerts, run a limited pilot, and expand only after the measured result beats the baseline without increasing risk."
    }
  },
  content: {
    mission: "Design an evidence-first content system that turns one weekly research brief into useful multi-channel material.",
    roles: {
      strategist: "Choose one audience question per week and define the source threshold before drafting. One primary source plus a credible independent check is the minimum for material claims.",
      builder: "Produce a source note, long-form explanation, short summary, and two channel-specific excerpts from the same verified claim map. Keep quotations limited and attach the source to every factual claim.",
      critic: "Reject unsupported certainty, recycled statistics, headline-only citations, and channel edits that change the meaning. Check dates, definitions, incentives, and whether the source actually supports the sentence.",
      closer: "Use a weekly pipeline: question → source map → claim review → core draft → channel adaptations → final citation check. Publish fewer claims with stronger evidence, preserve uncertainty, and record corrections in the next source note."
    }
  }
};

const form = document.querySelector("#swarm-form");
const missionInput = document.querySelector("#mission-text");
const errorNode = document.querySelector("#mission-error");
const room = document.querySelector("[data-swarm-room]");
const fallback = document.querySelector("[data-swarm-fallback]");
const fallbackMessage = document.querySelector("[data-swarm-fallback-message]");
const demoButton = document.querySelector("[data-run-swarm-demo]");
let activeDemoKey = null;

function timeoutSignal(milliseconds) {
  if (AbortSignal.timeout) return AbortSignal.timeout(milliseconds);
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

document.querySelectorAll("[data-mission-demo]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-mission-demo]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
    activeDemoKey = button.dataset.missionDemo;
    missionInput.value = DEMOS[activeDemoKey].mission;
    missionInput.focus();
    errorNode.textContent = "";
  });
});

function resetRoom() {
  room.dataset.open = "true";
  fallback.dataset.visible = "false";
  document.querySelector("[data-mission-id]").textContent = "MISSION · CONNECTING";
  document.querySelector("[data-mission-engine]").textContent = "Engine pending";
  document.querySelector("[data-mission-status]").textContent = "Awaiting Worker";
  document.querySelector("[data-swarm-log]").replaceChildren(Object.assign(document.createElement("span"), { textContent: "Connecting to same-origin Worker" }));
  document.querySelectorAll("[data-role-node]").forEach((node) => node.dataset.state = "waiting");
  document.querySelectorAll("[data-role-output]").forEach((output) => output.dataset.visible = "false");
  room.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function detectDemoKey(mission) {
  const normalized = mission.trim().replace(/\s+/g, " ").toLowerCase();
  return Object.entries(DEMOS).find(([, demo]) => demo.mission.toLowerCase() === normalized)?.[0] || null;
}

async function renderMission(mission) {
  const roles = ["strategist", "builder", "critic", "closer"];
  document.querySelector("[data-mission-id]").textContent = `MISSION · ${mission.id}`;
  document.querySelector("[data-mission-engine]").textContent = `${mission.provider} · ${mission.model}`;
  document.querySelector("[data-mission-status]").textContent = mission.mode === "demo" ? "Curated demo" : "Verified response";

  const log = document.querySelector("[data-swarm-log]");
  log.replaceChildren();
  for (const role of roles) {
    const result = mission.roles?.[role];
    if (!result?.text) throw new Error(`The Worker response is missing the ${role} output.`);
    const node = document.querySelector(`[data-role-node="${role}"]`);
    node.dataset.state = "active";
    const logLine = document.createElement("span");
    const pip = document.createElement("i");
    logLine.append(pip, `${role} received`);
    log.append(logLine);
    await delay(120);
    document.querySelector(`[data-role-text="${role}"]`).textContent = result.text;
    document.querySelector(`[data-role-engine="${role}"]`).textContent = `${result.provider} · ${result.model}`;
    document.querySelector(`[data-role-output="${role}"]`).dataset.visible = "true";
    node.dataset.state = "complete";
  }
}

function showFallback(error, mission) {
  activeDemoKey = detectDemoKey(mission);
  fallback.dataset.visible = "true";
  demoButton.disabled = !activeDemoKey;
  fallbackMessage.textContent = activeDemoKey
    ? `${error} A curated mission exists for this exact preset.`
    : `${error} Choose one of the mission cards before using the fallback.`;
  document.querySelector("[data-mission-status]").textContent = "Live mission unavailable";
  document.querySelectorAll("[data-role-node]").forEach((node) => node.dataset.state = "error");
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const mission = missionInput.value.trim();
  if (mission.length < 10 || mission.length > 3000) {
    errorNode.textContent = "Mission must be between 10 and 3,000 characters.";
    missionInput.focus();
    return;
  }

  errorNode.textContent = "";
  resetRoom();
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  submit.textContent = "Swarm running…";

  try {
    const response = await fetch("/api/swarm", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ mission, mode: form.elements.mode.value, provider: form.elements.provider.value }),
      signal: timeoutSignal(form.elements.mode.value === "full" ? 90_000 : 55_000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message || `Worker returned HTTP ${response.status}.`);
    await renderMission(payload.mission);
    showToast("Verified swarm mission returned.", "success");
  } catch (error) {
    const message = error.name === "TimeoutError" || error.name === "AbortError" ? "The mission timed out." : error.message;
    showFallback(message, mission);
  } finally {
    submit.disabled = false;
    submit.textContent = "Deploy swarm ↗";
  }
});

demoButton?.addEventListener("click", async () => {
  const demo = DEMOS[activeDemoKey];
  if (!demo) return;
  await renderMission({
    id: `DEMO-${activeDemoKey.toUpperCase()}`,
    mode: "demo",
    provider: "Editorial demo",
    model: "No API call",
    roles: Object.fromEntries(Object.entries(demo.roles).map(([role, text]) => [role, { text, provider: "Editorial demo", model: "No API call" }]))
  });
  fallback.dataset.visible = "false";
  showToast("Curated mission loaded and labeled.", "success");
});
