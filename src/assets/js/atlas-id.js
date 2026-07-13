import { safeStorage, showToast } from "./site.js";

const STORAGE_KEY = "forgeAtlas.profile.v1";
const MAX_IMPORT_BYTES = 50_000;
const allowedRoles = new Set([
  "Systems Architect",
  "Automation Builder",
  "AI Strategist",
  "Security Reviewer",
  "Creative Operator",
  "Research Lead"
]);
const allowedAccents = new Set(["gold", "cyan", "violet", "ember", "green"]);

const form = document.querySelector("#atlas-id-form");
const callsignInput = document.querySelector("#callsign");
const roleInput = document.querySelector("#role");
const accentInput = document.querySelector("#accent");
const bioInput = document.querySelector("#bio");
const importInput = document.querySelector("#profile-import");
const card = document.querySelector("[data-profile-card]");
const errorRegion = document.querySelector("[data-form-error]");
const callsignError = document.querySelector("#callsign-error");
const storage = safeStorage();

function normalizeText(value, maxLength) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function profileFromForm() {
  return {
    schema: 1,
    callsign: normalizeText(callsignInput.value, 24),
    role: allowedRoles.has(roleInput.value) ? roleInput.value : "Systems Architect",
    accent: allowedAccents.has(accentInput.value) ? accentInput.value : "gold",
    bio: normalizeText(bioInput.value, 240)
  };
}

function validateProfile(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("The profile file must contain one JSON object.");
  const profile = {
    schema: 1,
    callsign: normalizeText(candidate.callsign, 24),
    role: normalizeText(candidate.role, 40),
    accent: normalizeText(candidate.accent, 16),
    bio: normalizeText(candidate.bio, 240)
  };
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{1,23}$/.test(profile.callsign)) throw new Error("Callsign must be 2–24 characters using letters, numbers, spaces, dots, underscores, or hyphens.");
  if (!allowedRoles.has(profile.role)) throw new Error("The profile uses an unsupported operator role.");
  if (!allowedAccents.has(profile.accent)) throw new Error("The profile uses an unsupported accent.");
  return profile;
}

function profileCode(profile) {
  const input = `${profile.callsign}|${profile.role}`;
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `ATLAS-${(hash >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function render(profile) {
  const initials = profile.callsign ? profile.callsign.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() : "FA";
  card.dataset.accent = profile.accent;
  document.querySelector("[data-profile-sigil]").textContent = initials || "FA";
  document.querySelector("[data-profile-callsign]").textContent = profile.callsign || "UNCLAIMED";
  document.querySelector("[data-profile-role]").textContent = profile.role;
  document.querySelector("[data-profile-bio]").textContent = profile.bio || "Your operator brief will appear here.";
  document.querySelector("[data-profile-code]").textContent = profileCode(profile);
  document.querySelector("[data-bio-count]").textContent = String(profile.bio.length);
}

function populate(profile) {
  callsignInput.value = profile.callsign;
  roleInput.value = profile.role;
  accentInput.value = profile.accent;
  bioInput.value = profile.bio;
  render(profile);
}

function setError(message = "") {
  errorRegion.textContent = message;
}

form?.addEventListener("input", () => {
  setError();
  callsignError.textContent = "";
  render(profileFromForm());
});

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const profile = validateProfile(profileFromForm());
    if (!storage) throw new Error("Browser storage is unavailable. Export the profile instead.");
    storage.setItem(STORAGE_KEY, JSON.stringify(profile));
    populate(profile);
    showToast("Atlas ID saved in this browser.", "success");
  } catch (error) {
    setError(error.message);
    callsignError.textContent = error.message.startsWith("Callsign") ? error.message : "";
  }
});

document.querySelector("[data-export-profile]")?.addEventListener("click", () => {
  try {
    const profile = validateProfile(profileFromForm());
    const blob = new Blob([`${JSON.stringify(profile, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `forge-atlas-${profile.callsign.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Atlas ID exported.", "success");
  } catch (error) {
    setError(error.message);
  }
});

importInput?.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error("Profile file is too large.");
    const profile = validateProfile(JSON.parse(await file.text()));
    populate(profile);
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(profile));
    showToast("Atlas ID imported and saved locally.", "success");
  } catch (error) {
    setError(error instanceof SyntaxError ? "The selected file is not valid JSON." : error.message);
  } finally {
    importInput.value = "";
  }
});

document.querySelector("[data-reset-profile]")?.addEventListener("click", () => {
  if (!window.confirm("Reset the local Atlas ID on this device?")) return;
  storage?.removeItem(STORAGE_KEY);
  populate({ schema: 1, callsign: "", role: "Systems Architect", accent: "gold", bio: "" });
  setError();
  showToast("Local Atlas ID reset.", "success");
});

try {
  const saved = storage?.getItem(STORAGE_KEY);
  if (saved) populate(validateProfile(JSON.parse(saved)));
  else render(profileFromForm());
} catch {
  storage?.removeItem(STORAGE_KEY);
  render(profileFromForm());
}
