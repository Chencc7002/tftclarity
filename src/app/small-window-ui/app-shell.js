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

export class AppShell {
  constructor({ shell, panel, backdrop, settingsButton, settingsClose, settingsDone, onSettingsOpen, titleBar }) {
    this.settings = new SettingsPanel({ shell, panel, backdrop, button: settingsButton, onOpen: onSettingsOpen });
    this.titleBar = titleBar;
    settingsButton.addEventListener("click", () => this.settings.toggle());
    settingsClose.addEventListener("click", () => this.settings.setOpen(false));
    settingsDone.addEventListener("click", () => this.settings.setOpen(false));
    backdrop.addEventListener("click", () => this.settings.setOpen(false));
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && this.settings.open) this.settings.setOpen(false); });
    const preferred = localStorage.getItem(SETTINGS_STORAGE_KEY);
    const initiallyWide = window.innerWidth >= 1100;
    this.settings.setOpen(initiallyWide && (preferred === null || preferred === "true"), { persist: false });
    this.wasWide = initiallyWide;
    window.addEventListener("resize", () => {
      const wide = window.innerWidth >= 1100;
      if (this.wasWide && !wide && this.settings.open) this.settings.setOpen(false, { persist: false });
      if (!this.wasWide && wide && localStorage.getItem(SETTINGS_STORAGE_KEY) === "true") this.settings.setOpen(true, { persist: false });
      this.wasWide = wide;
    });
  }
}
