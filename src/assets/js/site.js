const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-nav]");
const toastRegion = document.querySelector("[data-toast]");
let toastTimer;

export function showToast(message, tone = "info") {
  if (!toastRegion) return;
  window.clearTimeout(toastTimer);
  toastRegion.textContent = message;
  toastRegion.dataset.tone = tone;
  toastRegion.dataset.visible = "true";
  toastTimer = window.setTimeout(() => {
    toastRegion.dataset.visible = "false";
  }, 3600);
}

export function safeStorage() {
  try {
    const key = "__forge_atlas_storage_test__";
    window.localStorage.setItem(key, key);
    window.localStorage.removeItem(key);
    return window.localStorage;
  } catch {
    return null;
  }
}

function closeNav() {
  if (!nav || !navToggle) return;
  nav.dataset.open = "false";
  navToggle.setAttribute("aria-expanded", "false");
}

if (navToggle && nav) {
  navToggle.addEventListener("click", () => {
    const willOpen = nav.dataset.open !== "true";
    nav.dataset.open = String(willOpen);
    navToggle.setAttribute("aria-expanded", String(willOpen));
  });

  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeNav();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.dataset.open === "true") {
      closeNav();
      navToggle.focus();
    }
  });

  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 981px)").matches) closeNav();
  });
}

document.querySelectorAll("[data-filter-group]").forEach((group) => {
  const targetSelector = group.dataset.filterTarget;
  const target = targetSelector ? document.querySelector(targetSelector) : group.parentElement;
  if (!target) return;

  group.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    const filter = button.dataset.filter;

    group.querySelectorAll("[data-filter]").forEach((candidate) => {
      candidate.setAttribute("aria-pressed", String(candidate === button));
    });

    target.querySelectorAll("[data-filter-item]").forEach((item) => {
      const categories = (item.dataset.filterItem || "").split(/\s+/);
      item.hidden = filter !== "all" && !categories.includes(filter);
    });
  });
});

document.addEventListener("click", async (event) => {
  const copyButton = event.target.closest("[data-copy]");
  if (!copyButton) return;
  const selector = copyButton.dataset.copy;
  const source = selector ? document.querySelector(selector) : null;
  const value = source?.value ?? source?.textContent ?? "";
  if (!value.trim()) return;

  try {
    await navigator.clipboard.writeText(value.trim());
    showToast("Copied to clipboard.", "success");
  } catch {
    showToast("Clipboard access is unavailable in this browser.", "error");
  }
});
