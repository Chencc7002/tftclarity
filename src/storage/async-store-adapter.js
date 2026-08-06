import { ALL_EPHEMERAL_METHODS, ALL_PERSISTENT_METHODS } from "./contracts.js";

const TRANSIENT_CLEAR_METHODS = new Set([
  "clear", "clearTransient", "clearExpired", "clearQueryHistory"
]);

export class AsyncStoreAdapter {
  constructor(store, methods = [...ALL_PERSISTENT_METHODS, ...ALL_EPHEMERAL_METHODS]) {
    if (!store) throw new Error("AsyncStoreAdapter requires a store");
    this.store = store;
    this.now = typeof store.now === "function" ? store.now.bind(store) : () => Date.now();
    for (const method of new Set([...methods, ...TRANSIENT_CLEAR_METHODS])) {
      if (typeof store[method] !== "function") continue;
      this[method] = async (...args) => store[method](...args);
    }
  }

  async healthCheck() {
    if (typeof this.store.healthCheck === "function") return this.store.healthCheck();
    return { ok: true, type: this.store.constructor?.name ?? "unknown" };
  }

  async close() {
    if (typeof this.store.close === "function") return this.store.close();
  }
}

export function asAsyncStore(store) {
  return store instanceof AsyncStoreAdapter ? store : new AsyncStoreAdapter(store);
}
