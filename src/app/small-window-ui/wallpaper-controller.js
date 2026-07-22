import { t } from "./i18n.js";
import { DEFAULT_WALLPAPER_ID, wallpaperById, wallpapersForSeason } from "./wallpaper-catalog.js";

export const WALLPAPER_ENABLED_STORAGE_KEY = "tftagent.wallpaperEnabled";
export const WALLPAPER_ID_STORAGE_KEY = "tftagent.wallpaperId";
export const WALLPAPER_IDLE_MS = 7000;

class ParticleField {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.particles = [];
    this.active = false;
    this.frame = null;
    this.lastTime = 0;
    this.density = 1;
    this.speed = 1;
    this.reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.max(24, Math.min(130, Math.round(((width * height) / 9000) * this.density)));
    this.particles = Array.from({ length: count }, () => this.createParticle(width, height));
  }

  createParticle(width, height, fromBottom = false) {
    return {
      x: Math.random() * width,
      y: fromBottom ? height + Math.random() * 24 : Math.random() * height,
      radius: .8 + Math.random() * 1.7,
      speed: (9 + Math.random() * 16) * this.speed,
      drift: -5 + Math.random() * 10,
      alpha: .42 + Math.random() * .5,
      phase: Math.random() * Math.PI * 2,
      pulse: .9 + Math.random() * 1.4,
      tail: 7 + Math.random() * 15,
      tone: Math.random()
    };
  }

  setActive(active) {
    const next = Boolean(active) && !this.reducedMotion;
    this.canvas.classList.toggle("is-active", next);
    if (this.active === next) return;
    this.active = next;
    if (next) {
      this.lastTime = performance.now();
      this.frame = requestAnimationFrame((time) => this.draw(time));
    } else if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
      this.context.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    }
  }

  setProfile({ density = 1, speed = 1 } = {}) {
    this.density = Math.max(0.25, Number(density) || 1);
    this.speed = Math.max(0.25, Number(speed) || 1);
    this.resize();
  }

  draw(time) {
    if (!this.active) return;
    const elapsed = Math.min(40, Math.max(0, time - this.lastTime)) / 1000;
    this.lastTime = time;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.context.clearRect(0, 0, width, height);
    this.context.save();
    this.context.globalCompositeOperation = "lighter";

    for (const particle of this.particles) {
      particle.y -= particle.speed * elapsed;
      particle.x += particle.drift * elapsed;
      particle.phase += particle.pulse * elapsed;
      if (particle.y < -12 || particle.x < -12 || particle.x > width + 12) {
        Object.assign(particle, this.createParticle(width, height, true));
      }
      const glow = particle.alpha * (.68 + Math.sin(particle.phase) * .3);
      const tone = particle.tone > .72
        ? "255,222,150"
        : particle.tone > .36 ? "183,235,255" : "218,202,255";
      this.context.strokeStyle = `rgba(${tone},${Math.max(0, glow * .38)})`;
      this.context.lineWidth = Math.max(.6, particle.radius * .48);
      this.context.beginPath();
      this.context.moveTo(particle.x, particle.y + particle.radius);
      this.context.lineTo(particle.x - particle.drift * .35, particle.y + particle.tail);
      this.context.stroke();
      const gradient = this.context.createRadialGradient(
        particle.x, particle.y, 0,
        particle.x, particle.y, particle.radius * 5
      );
      gradient.addColorStop(0, `rgba(255,255,255,${Math.max(0, glow)})`);
      gradient.addColorStop(.3, `rgba(${tone},${Math.max(0, glow * .72)})`);
      gradient.addColorStop(1, `rgba(${tone},0)`);
      this.context.fillStyle = gradient;
      this.context.beginPath();
      this.context.arc(particle.x, particle.y, particle.radius * 5, 0, Math.PI * 2);
      this.context.fill();
      if (particle.radius > 1.65) {
        const ray = particle.radius * 3.4;
        this.context.strokeStyle = `rgba(255,255,255,${Math.max(0, glow * .62)})`;
        this.context.lineWidth = .65;
        this.context.beginPath();
        this.context.moveTo(particle.x - ray, particle.y);
        this.context.lineTo(particle.x + ray, particle.y);
        this.context.moveTo(particle.x, particle.y - ray);
        this.context.lineTo(particle.x, particle.y + ray);
        this.context.stroke();
      }
    }
    this.context.restore();
    this.frame = requestAnimationFrame((nextTime) => this.draw(nextTime));
  }
}

export class WallpaperController {
  constructor({ shell, canvas, control, toggle, select, idleMs = WALLPAPER_IDLE_MS }) {
    this.shell = shell;
    this.control = control;
    this.toggle = toggle;
    this.select = select;
    this.mobileButton = control.querySelector("#wallpaper-mobile-button");
    this.mobileMenu = control.querySelector("#wallpaper-mobile-menu");
    this.mobileClose = control.querySelector("#wallpaper-mobile-close");
    this.mobileToggle = control.querySelector("#wallpaper-mobile-toggle");
    this.mobileOptions = control.querySelector("#wallpaper-mobile-options");
    this.idleMs = idleMs;
    this.idleTimer = null;
    this.particles = new ParticleField(canvas);
    this.enabled = localStorage.getItem(WALLPAPER_ENABLED_STORAGE_KEY) !== "false";
    this.seasonId = "set-17";
    this.defaultWallpaperId = DEFAULT_WALLPAPER_ID;
    this.wallpapers = wallpapersForSeason(this.seasonId);
    this.fallbackColors = { primary: "#3eaeeb", secondary: "#5678e8" };
    this.wallpaperId = wallpaperById(
      localStorage.getItem(`${WALLPAPER_ID_STORAGE_KEY}.${this.seasonId}`)
        || localStorage.getItem(WALLPAPER_ID_STORAGE_KEY)
        || this.defaultWallpaperId,
      this.seasonId,
      this.defaultWallpaperId
    )?.id ?? null;

    this.populateSelect();
    this.populateMobileOptions();
    this.select.value = this.wallpaperId;
    this.toggle.addEventListener("click", () => this.setEnabled(!this.enabled));
    this.select.addEventListener("change", () => this.setWallpaper(this.select.value));
    this.mobileButton.addEventListener("click", () => this.setMobileMenuOpen(this.mobileMenu.hidden));
    this.mobileClose.addEventListener("click", () => this.setMobileMenuOpen(false));
    this.mobileToggle.addEventListener("click", () => this.setEnabled(!this.enabled));
    this.mobileOptions.addEventListener("click", (event) => {
      const option = event.target.closest("[data-wallpaper-id]");
      if (!option) return;
      this.setWallpaper(option.dataset.wallpaperId);
      if (!this.enabled) this.setEnabled(true);
      this.setMobileMenuOpen(false);
    });
    document.addEventListener("click", (event) => {
      if (!this.mobileMenu.hidden && !this.control.contains(event.target)) this.setMobileMenuOpen(false);
    });
    this.handleActivity = () => this.registerActivity();
    document.addEventListener("keydown", (event) => {
      this.handleActivity();
      if (event.key === "Escape") this.setMobileMenuOpen(false);
    }, { capture: true });
    document.addEventListener("mousemove", this.handleActivity, { capture: true, passive: true });
    document.addEventListener("click", this.handleActivity, { capture: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.particles.setActive(false);
      else if (this.enabled) this.enterIdleMode();
    });

    this.applyWallpaper();
    this.setEnabled(this.enabled, { persist: false });
  }

  populateSelect() {
    this.select.replaceChildren(...this.wallpapers.map((wallpaper) => {
      const option = document.createElement("option");
      option.value = wallpaper.id;
      option.dataset.labelKey = wallpaper.labelKey;
      option.textContent = t(wallpaper.labelKey);
      return option;
    }));
  }

  populateMobileOptions() {
    this.mobileOptions.replaceChildren(...this.wallpapers.map((wallpaper) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wallpaper-mobile-option";
      button.dataset.wallpaperId = wallpaper.id;
      button.style.setProperty("--wallpaper-thumb", `url("${wallpaper.url}")`);
      button.setAttribute("aria-pressed", "false");

      const preview = document.createElement("span");
      preview.className = "wallpaper-mobile-preview";
      preview.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "wallpaper-mobile-label";
      label.dataset.labelKey = wallpaper.labelKey;
      label.textContent = t(wallpaper.labelKey);

      button.append(preview, label);
      return button;
    }));
    this.refreshMobileOptions();
  }

  setMobileMenuOpen(open) {
    const next = Boolean(open);
    this.mobileMenu.hidden = !next;
    this.mobileButton.setAttribute("aria-expanded", String(next));
    this.control.classList.toggle("mobile-menu-open", next);
    if (next) this.mobileClose.focus({ preventScroll: true });
  }

  refreshMobileOptions() {
    for (const option of this.mobileOptions.querySelectorAll("[data-wallpaper-id]")) {
      const active = option.dataset.wallpaperId === this.wallpaperId;
      option.classList.toggle("active", active);
      option.setAttribute("aria-pressed", String(active));
    }
  }

  setWallpaper(id) {
    const wallpaper = wallpaperById(id, this.seasonId, this.defaultWallpaperId);
    if (!wallpaper) return;
    this.wallpaperId = wallpaper.id;
    this.select.value = this.wallpaperId;
    localStorage.setItem(WALLPAPER_ID_STORAGE_KEY, this.wallpaperId);
    localStorage.setItem(`${WALLPAPER_ID_STORAGE_KEY}.${this.seasonId}`, this.wallpaperId);
    this.applyWallpaper();
    this.refreshMobileOptions();
    if (this.enabled) this.enterIdleMode();
  }

  applyWallpaper() {
    const wallpaper = wallpaperById(this.wallpaperId, this.seasonId, this.defaultWallpaperId);
    if (!wallpaper) {
      this.shell.style.removeProperty("--wallpaper-image");
      this.shell.style.removeProperty("--wallpaper-position");
      this.shell.style.removeProperty("--wallpaper-focus-size");
      this.shell.style.setProperty("--wallpaper-accent", this.fallbackColors.primary);
      this.shell.style.setProperty("--wallpaper-accent-secondary", this.fallbackColors.secondary);
      return;
    }
    this.shell.style.setProperty("--wallpaper-image", `url("${wallpaper.url}")`);
    this.shell.style.setProperty("--wallpaper-position", wallpaper.position);
    this.shell.style.setProperty("--wallpaper-focus-size", wallpaper.focusSize ?? "cover");
    this.shell.style.setProperty("--wallpaper-accent", wallpaper.accent ?? this.fallbackColors.primary);
    this.shell.style.setProperty("--wallpaper-accent-secondary", wallpaper.accentSecondary ?? this.fallbackColors.secondary);
  }

  setSeason(seasonId, defaultWallpaperId = null, theme = {}) {
    this.seasonId = seasonId || "set-17";
    this.defaultWallpaperId = defaultWallpaperId;
    this.wallpapers = wallpapersForSeason(this.seasonId);
    this.fallbackColors = {
      primary: theme.primary ?? "#3eaeeb",
      secondary: theme.secondary ?? "#5678e8"
    };
    this.particles.setProfile(theme.particles);
    const storedId = localStorage.getItem(`${WALLPAPER_ID_STORAGE_KEY}.${this.seasonId}`);
    this.wallpaperId = wallpaperById(
      storedId || defaultWallpaperId,
      this.seasonId,
      defaultWallpaperId
    )?.id ?? null;
    this.populateSelect();
    this.populateMobileOptions();
    this.select.value = this.wallpaperId ?? "";
    const available = this.wallpapers.length > 0;
    this.control.classList.toggle("wallpaper-unavailable", !available);
    this.toggle.disabled = !available;
    this.mobileButton.disabled = !available;
    this.select.disabled = !available || !this.enabled;
    this.shell.classList.toggle("wallpaper-enabled", available && this.enabled);
    if (!available) this.particles.setActive(false);
    this.applyWallpaper();
    this.refreshLocale();
  }

  setEnabled(enabled, { persist = true } = {}) {
    const available = this.wallpapers.length > 0;
    this.enabled = Boolean(enabled);
    this.shell.classList.toggle("wallpaper-enabled", available && this.enabled);
    this.control.classList.toggle("active", this.enabled);
    this.toggle.setAttribute("aria-checked", String(this.enabled));
    this.mobileToggle.setAttribute("aria-checked", String(this.enabled));
    this.mobileButton.classList.toggle("wallpaper-off", !this.enabled);
    this.select.disabled = !available || !this.enabled;
    if (persist) localStorage.setItem(WALLPAPER_ENABLED_STORAGE_KEY, String(this.enabled));
    this.refreshLocale();
    if (available && this.enabled) this.enterIdleMode();
    else {
      clearTimeout(this.idleTimer);
      this.particles.setActive(false);
    }
  }

  registerActivity() {
    if (!this.enabled) return;
    this.particles.setActive(false);
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.enterIdleMode(), this.idleMs);
  }

  enterIdleMode() {
    if (!this.enabled || document.hidden) return;
    clearTimeout(this.idleTimer);
    this.particles.setActive(true);
  }

  refreshLocale() {
    const state = this.toggle.querySelector("[data-wallpaper-state]");
    if (state) state.textContent = t(this.enabled ? "wallpaperOn" : "wallpaperOff");
    this.toggle.title = t(this.enabled ? "wallpaperDisableTitle" : "wallpaperEnableTitle");
    this.toggle.setAttribute("aria-label", this.toggle.title);
    this.select.setAttribute("aria-label", t("wallpaperChoice"));
    for (const option of this.select.options) option.textContent = t(option.dataset.labelKey);
    this.mobileButton.title = t("wallpaperChoice");
    this.mobileButton.setAttribute("aria-label", t("wallpaperChoice"));
    this.mobileMenu.setAttribute("aria-label", t("wallpaperChoice"));
    this.mobileClose.title = t("closeWallpaperMenu");
    this.mobileClose.setAttribute("aria-label", t("closeWallpaperMenu"));
    for (const option of this.mobileOptions.querySelectorAll("[data-label-key]")) {
      option.textContent = t(option.dataset.labelKey);
    }
  }
}
