import { t } from "./i18n.js";
import { DEFAULT_WALLPAPER_ID, WALLPAPERS, wallpaperById } from "./wallpaper-catalog.js";

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
    const count = Math.max(48, Math.min(130, Math.round((width * height) / 9000)));
    this.particles = Array.from({ length: count }, () => this.createParticle(width, height));
  }

  createParticle(width, height, fromBottom = false) {
    return {
      x: Math.random() * width,
      y: fromBottom ? height + Math.random() * 24 : Math.random() * height,
      radius: .8 + Math.random() * 1.7,
      speed: 9 + Math.random() * 16,
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
    this.idleMs = idleMs;
    this.idleTimer = null;
    this.particles = new ParticleField(canvas);
    this.enabled = localStorage.getItem(WALLPAPER_ENABLED_STORAGE_KEY) !== "false";
    this.wallpaperId = wallpaperById(localStorage.getItem(WALLPAPER_ID_STORAGE_KEY) || DEFAULT_WALLPAPER_ID).id;

    this.populateSelect();
    this.select.value = this.wallpaperId;
    this.toggle.addEventListener("click", () => this.setEnabled(!this.enabled));
    this.select.addEventListener("change", () => this.setWallpaper(this.select.value));
    this.handleActivity = () => this.registerActivity();
    document.addEventListener("keydown", this.handleActivity, { capture: true });
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
    this.select.replaceChildren(...WALLPAPERS.map((wallpaper) => {
      const option = document.createElement("option");
      option.value = wallpaper.id;
      option.dataset.labelKey = wallpaper.labelKey;
      option.textContent = t(wallpaper.labelKey);
      return option;
    }));
  }

  setWallpaper(id) {
    this.wallpaperId = wallpaperById(id).id;
    this.select.value = this.wallpaperId;
    localStorage.setItem(WALLPAPER_ID_STORAGE_KEY, this.wallpaperId);
    this.applyWallpaper();
    if (this.enabled) this.enterIdleMode();
  }

  applyWallpaper() {
    const wallpaper = wallpaperById(this.wallpaperId);
    this.shell.style.setProperty("--wallpaper-image", `url("${wallpaper.url}")`);
    this.shell.style.setProperty("--wallpaper-position", wallpaper.position);
    this.shell.style.setProperty("--wallpaper-focus-size", wallpaper.focusSize ?? "cover");
    this.shell.style.setProperty("--wallpaper-accent", wallpaper.accent ?? "#3eaeeb");
    this.shell.style.setProperty("--wallpaper-accent-secondary", wallpaper.accentSecondary ?? "#5678e8");
  }

  setEnabled(enabled, { persist = true } = {}) {
    this.enabled = Boolean(enabled);
    this.shell.classList.toggle("wallpaper-enabled", this.enabled);
    this.control.classList.toggle("active", this.enabled);
    this.toggle.setAttribute("aria-checked", String(this.enabled));
    this.select.disabled = !this.enabled;
    if (persist) localStorage.setItem(WALLPAPER_ENABLED_STORAGE_KEY, String(this.enabled));
    this.refreshLocale();
    if (this.enabled) this.enterIdleMode();
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
  }
}
