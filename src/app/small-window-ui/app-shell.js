const COLUMN_STORAGE_KEY = "tftagent.conversationRatio";
const SETTINGS_STORAGE_KEY = "tftagent.settingsOpen";

export class TitleBar {
  constructor({ root, onLocaleChange, getLocale }) {
    this.root = root;
    this.root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-locale]");
      if (button && button.dataset.locale !== getLocale()) onLocaleChange(button.dataset.locale);
    });
  }
}

export class SettingsPanel {
  constructor({ shell, panel, backdrop, button, onOpen }) {
    this.shell = shell; this.panel = panel; this.backdrop = backdrop; this.button = button; this.onOpen = onOpen;
    this.open = false;
  }
  setOpen(open, { persist = true } = {}) {
    this.open = Boolean(open);
    this.shell.classList.toggle("settings-open", this.open);
    this.panel.setAttribute("aria-hidden", String(!this.open));
    this.button.setAttribute("aria-expanded", String(this.open));
    this.backdrop.hidden = !this.open;
    if (persist) localStorage.setItem(SETTINGS_STORAGE_KEY, String(this.open));
    this.shell.dispatchEvent(new Event("settings-layout-change"));
    if (this.open) this.onOpen?.();
  }
  toggle() { this.setOpen(!this.open); }
}

export class ColumnResizer {
  constructor({ shell, workspace, handle }) {
    this.shell = shell; this.workspace = workspace; this.handle = handle;
    this.ratio = Number(localStorage.getItem(COLUMN_STORAGE_KEY)) || .38;
    this.apply();
    handle.addEventListener("pointerdown", (event) => this.start(event));
    handle.addEventListener("keydown", (event) => this.keydown(event));
    shell.addEventListener("settings-layout-change", () => this.apply());
    new ResizeObserver(() => this.apply()).observe(workspace);
  }
  bounds() {
    const width = this.workspace.clientWidth;
    const settingsWidth = this.shell.classList.contains("settings-open") && width >= 1100 ? 280 : 0;
    const mainWidth = width - settingsWidth;
    return { width, min: 320, max: Math.min(520, Math.max(320, mainWidth - 369)) };
  }
  apply() {
    if (this.workspace.clientWidth < 760) return;
    const { width, min, max } = this.bounds();
    const pixels = Math.max(min, Math.min(max, width * this.ratio));
    this.shell.style.setProperty("--conversation-width", `${pixels}px`);
    this.handle.setAttribute("aria-valuenow", String(Math.round(pixels)));
  }
  setPixels(pixels, persist = true) {
    const { width, min, max } = this.bounds();
    const safe = Math.max(min, Math.min(max, pixels));
    this.ratio = safe / Math.max(width, 1);
    this.apply();
    if (persist) localStorage.setItem(COLUMN_STORAGE_KEY, String(this.ratio));
  }
  start(event) {
    if (this.workspace.clientWidth < 760) return;
    event.preventDefault();
    this.handle.setPointerCapture(event.pointerId);
    this.handle.classList.add("dragging");
    document.body.classList.add("resizing-columns");
    const rect = this.workspace.getBoundingClientRect();
    const move = (moveEvent) => this.setPixels(moveEvent.clientX - rect.left, false);
    const end = () => {
      this.handle.classList.remove("dragging");
      document.body.classList.remove("resizing-columns");
      localStorage.setItem(COLUMN_STORAGE_KEY, String(this.ratio));
      this.handle.removeEventListener("pointermove", move);
      this.handle.removeEventListener("pointerup", end);
      this.handle.removeEventListener("pointercancel", end);
    };
    this.handle.addEventListener("pointermove", move);
    this.handle.addEventListener("pointerup", end);
    this.handle.addEventListener("pointercancel", end);
  }
  keydown(event) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || this.workspace.clientWidth < 760) return;
    event.preventDefault();
    const current = Number(this.handle.getAttribute("aria-valuenow")) || this.workspace.clientWidth * this.ratio;
    this.setPixels(current + (event.key === "ArrowRight" ? 16 : -16));
  }
}

export class AppShell {
  constructor({ shell, workspace, resizer, panel, backdrop, settingsButton, settingsClose, settingsDone, onSettingsOpen, titleBar }) {
    this.settings = new SettingsPanel({ shell, panel, backdrop, button: settingsButton, onOpen: onSettingsOpen });
    this.resizer = new ColumnResizer({ shell, workspace, handle: resizer });
    this.titleBar = titleBar;
    settingsButton.addEventListener("click", () => this.settings.toggle());
    settingsClose.addEventListener("click", () => this.settings.setOpen(false));
    settingsDone.addEventListener("click", () => this.settings.setOpen(false));
    backdrop.addEventListener("click", () => this.settings.setOpen(false));
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && this.settings.open) this.settings.setOpen(false); });
    const preferred = localStorage.getItem(SETTINGS_STORAGE_KEY);
    this.settings.setOpen(preferred === null ? window.innerWidth >= 1100 : preferred === "true", { persist: false });
    this.wasWide = window.innerWidth >= 1100;
    window.addEventListener("resize", () => {
      const wide = window.innerWidth >= 1100;
      if (this.wasWide && !wide && this.settings.open) this.settings.setOpen(false, { persist: false });
      if (!this.wasWide && wide && localStorage.getItem(SETTINGS_STORAGE_KEY) === "true") this.settings.setOpen(true, { persist: false });
      this.wasWide = wide;
    });
  }
}
