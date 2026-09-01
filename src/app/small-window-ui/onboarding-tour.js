export const ONBOARDING_STORAGE_KEY = "tftagent.onboarding.v1";
export const ONBOARDING_VERSION = 1;

const TERMINAL_STATUSES = new Set(["completed", "dismissed"]);

export function normalizeOnboardingState(value) {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.version !== ONBOARDING_VERSION || !TERMINAL_STATUSES.has(parsed.status)) return null;
  return { version: ONBOARDING_VERSION, status: parsed.status };
}

export function readOnboardingState(storage) {
  try { return normalizeOnboardingState(storage?.getItem?.(ONBOARDING_STORAGE_KEY)); }
  catch { return null; }
}

export function writeOnboardingState(storage, status) {
  if (!TERMINAL_STATUSES.has(status)) return false;
  try {
    storage?.setItem?.(ONBOARDING_STORAGE_KEY, JSON.stringify({ version: ONBOARDING_VERSION, status }));
    return true;
  } catch {
    return false;
  }
}

const STEPS = [
  { target: "#tool-menu-toggle", titleKey: "onboardingToolsTitle", bodyKey: "onboardingToolsBody", menu: "closed" },
  { target: '[data-open-tools="all"]', titleKey: "onboardingAllToolsTitle", bodyKey: "onboardingAllToolsBody", menu: "open" },
  { target: '[data-open-tools="favorites"]', titleKey: "onboardingFavoritesTitle", bodyKey: "onboardingFavoritesBody", menu: "open" },
  { target: "#query-input", titleKey: "onboardingAskTitle", bodyKey: "onboardingAskBody", menu: "closed" }
];

export function createOnboardingTour({ root, t, storage = () => window.localStorage, beforeStart } = {}) {
  if (!root) return { start() {}, startIfNeeded() {}, dismiss() {}, refreshLocale() {}, get active() { return false; } };
  const title = root.querySelector("[data-onboarding-title]");
  const body = root.querySelector("[data-onboarding-body]");
  const progress = root.querySelector("[data-onboarding-progress]");
  const previous = root.querySelector('[data-onboarding-action="previous"]');
  const next = root.querySelector('[data-onboarding-action="next"]');
  const menuToggle = document.querySelector("#tool-menu-toggle");
  const menu = document.querySelector("#tool-menu");
  const menuAnchor = document.querySelector("#composer-tool-anchor");
  let currentTarget = null;
  let index = 0;
  let running = false;
  let startTimer = null;

  function resolvedStorage() {
    try { return storage(); } catch { return null; }
  }

  function ensureMenu(mode) {
    if (!menuToggle || !menu) return;
    const open = !menu.hidden && menuToggle.getAttribute("aria-expanded") === "true";
    if (mode === "open" && !open) menuToggle.click();
    if (mode === "closed" && open) menuToggle.click();
  }

  function clearTarget() {
    currentTarget?.classList.remove("onboarding-highlight");
    currentTarget = null;
    menuAnchor?.classList.remove("onboarding-context");
  }

  function render() {
    if (!running) return;
    clearTarget();
    const step = STEPS[index];
    ensureMenu(step.menu);
    currentTarget = document.querySelector(step.target);
    currentTarget?.classList.add("onboarding-highlight");
    if (index < 3) menuAnchor?.classList.add("onboarding-context");
    title.textContent = t(step.titleKey);
    body.textContent = t(step.bodyKey);
    progress.textContent = t("onboardingProgress", { current: index + 1, total: STEPS.length });
    previous.hidden = index === 0;
    next.textContent = t(index === STEPS.length - 1 ? "onboardingFinish" : "onboardingNext");
    root.dataset.step = String(index + 1);
  }

  function stop(status) {
    if (!running) return;
    running = false;
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    clearTarget();
    ensureMenu("closed");
    document.body.classList.remove("onboarding-active");
    writeOnboardingState(resolvedStorage(), status);
  }

  function start({ force = false } = {}) {
    if (running) return;
    if (!force && readOnboardingState(resolvedStorage())) return;
    beforeStart?.();
    index = 0;
    running = true;
    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("onboarding-active");
    render();
  }

  root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-onboarding-action]")?.dataset.onboardingAction;
    if (!action) return;
    if (action === "dismiss") return stop("dismissed");
    if (action === "previous" && index > 0) {
      index -= 1;
      render();
      return;
    }
    if (action === "next") {
      if (index === STEPS.length - 1) stop("completed");
      else {
        index += 1;
        render();
      }
    }
  });
  document.addEventListener("keydown", (event) => {
    if (running && event.key === "Escape") {
      event.preventDefault();
      stop("dismissed");
    }
  });

  return {
    start,
    startIfNeeded({ delay = 700 } = {}) {
      if (readOnboardingState(resolvedStorage())) return;
      clearTimeout(startTimer);
      startTimer = setTimeout(() => start(), delay);
    },
    dismiss() { stop("dismissed"); },
    refreshLocale() { render(); },
    get active() { return running; }
  };
}
