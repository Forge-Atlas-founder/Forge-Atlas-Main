import { showToast } from "./site.js";

const healthButton = document.querySelector("[data-check-health]");
const healthError = document.querySelector("[data-health-error]");
const auditForm = document.querySelector("#audit-form");
const auditUrl = document.querySelector("#audit-url");
const auditError = document.querySelector("#audit-error");
const resultSection = document.querySelector("[data-audit-results]");
const scoreNode = document.querySelector("[data-audit-score]");
const titleNode = document.querySelector("[data-audit-title]");
const summaryNode = document.querySelector("[data-audit-summary]");
const itemsNode = document.querySelector("[data-audit-items]");

function timeoutSignal(milliseconds) {
  if (AbortSignal.timeout) return AbortSignal.timeout(milliseconds);
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

function setSystem(name, state, label) {
  const node = document.querySelector(`[data-system="${name}"]`);
  if (!node) return;
  node.className = `status-chip status-chip--${state}`;
  node.textContent = label;
}

function normalizeHealthState(value) {
  if (value === "ready") return ["live", "Ready"];
  if (value === "configured") return ["optional", "Configured"];
  if (value === "degraded") return ["demo", "Degraded"];
  return ["offline", "Not configured"];
}

async function checkHealth() {
  healthButton.disabled = true;
  healthError.textContent = "";
  setSystem("worker", "optional", "Checking");
  try {
    const response = await fetch("/api/health", { headers: { Accept: "application/json" }, cache: "no-store", signal: timeoutSignal(8_000) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message || `Worker returned HTTP ${response.status}.`);
    setSystem("worker", "live", `Ready · ${payload.version}`);
    setSystem("rate-limit", payload.protections?.rateLimit === "configured" ? "live" : "offline", payload.protections?.rateLimit === "configured" ? "Configured" : "Required");
    for (const provider of ["workers-ai", "openai", "anthropic", "gemini"]) {
      const [state, label] = normalizeHealthState(payload.providers?.[provider]);
      setSystem(provider, state, label);
    }
    showToast("Current Worker health verified.", "success");
  } catch (error) {
    setSystem("worker", "offline", "Unavailable");
    for (const provider of ["rate-limit", "workers-ai", "openai", "anthropic", "gemini"]) setSystem(provider, "offline", "Unknown");
    healthError.textContent = error.name === "TimeoutError" || error.name === "AbortError" ? "Health check timed out." : error.message;
  } finally {
    healthButton.disabled = false;
  }
}

healthButton?.addEventListener("click", checkHealth);

document.querySelector("[data-audit-self]")?.addEventListener("click", () => {
  auditUrl.value = "https://forge-atlas.io/";
  auditUrl.focus();
});

function renderAudit(payload) {
  scoreNode.textContent = String(payload.score);
  scoreNode.setAttribute("aria-label", `Audit score ${payload.score} out of 100`);
  titleNode.textContent = payload.title || "Audit complete";
  summaryNode.textContent = `${payload.passed} checks passed · ${payload.failed} need attention · ${payload.finalUrl}`;
  itemsNode.replaceChildren();

  for (const check of payload.checks || []) {
    const item = document.createElement("div");
    item.className = "audit-item";
    const state = document.createElement("span");
    state.className = `status-chip status-chip--${check.passed ? "live" : "offline"}`;
    state.textContent = check.passed ? "Pass" : "Fix";
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = check.label;
    const detail = document.createElement("p");
    detail.textContent = check.detail;
    copy.append(heading, detail);
    item.append(state, copy);
    itemsNode.append(item);
  }
  resultSection.hidden = false;
  resultSection.focus?.();
}

auditForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  auditError.textContent = "";
  resultSection.hidden = true;

  let target;
  try {
    target = new URL(auditUrl.value.trim());
    if (target.protocol !== "https:") throw new Error("Use a public HTTPS URL.");
  } catch (error) {
    auditError.textContent = error.message || "Enter a valid public HTTPS URL.";
    auditUrl.focus();
    return;
  }

  const submit = auditForm.querySelector("button[type='submit']");
  submit.disabled = true;
  submit.textContent = "Auditing…";
  try {
    const response = await fetch("/api/seo-audit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ url: target.href }),
      signal: timeoutSignal(25_000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message || `Audit returned HTTP ${response.status}.`);
    renderAudit(payload.audit);
    showToast("Deterministic audit complete.", "success");
  } catch (error) {
    auditError.textContent = error.name === "TimeoutError" || error.name === "AbortError" ? "Audit timed out before a safe response was returned." : error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = "Run audit";
  }
});
