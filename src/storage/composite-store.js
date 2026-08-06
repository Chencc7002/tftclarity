import { ALL_EPHEMERAL_METHODS, ALL_PERSISTENT_METHODS } from "./contracts.js";

export class CompositeStore {
  constructor({ persistent, ephemeral }) {
    if (!persistent || !ephemeral) throw new Error("CompositeStore requires persistent and ephemeral stores");
    this.persistent = persistent;
    this.ephemeral = ephemeral;
    this.now = typeof persistent.now === "function" ? persistent.now.bind(persistent) : () => Date.now();
    for (const method of ALL_PERSISTENT_METHODS) {
      if (typeof persistent[method] === "function") this[method] = (...args) => persistent[method](...args);
    }
    for (const method of ALL_EPHEMERAL_METHODS) {
      if (typeof ephemeral[method] === "function") this[method] = (...args) => ephemeral[method](...args);
    }
  }

  async clearTransient(options = {}) {
    const [queryCache, defaultContextCache, sessionState] = await Promise.all([
      this.ephemeral.clearQueryCache?.(options) ?? 0,
      this.ephemeral.clearDefaultContextCache?.(options) ?? 0,
      this.ephemeral.clearSessionState?.(options) ?? 0
    ]);
    return { queryCache, defaultContextCache, sessionState };
  }

  async clearQueryHistory(options = {}) {
    return this.clearTransient(options);
  }

  async healthCheck() {
    const [persistent, ephemeral] = await Promise.all([
      this.persistent.healthCheck?.() ?? { ok: true },
      this.ephemeral.healthCheck?.() ?? { ok: true }
    ]);
    return { ok: Boolean(persistent.ok && ephemeral.ok), persistent, ephemeral };
  }

  async close() {
    await Promise.allSettled([
      this.persistent.close?.(),
      this.ephemeral === this.persistent ? null : this.ephemeral.close?.()
    ]);
  }
}
