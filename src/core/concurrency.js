export function createConcurrencyError(message, details = {}) {
  const error = new Error(message);
  error.code = details.code ?? "server_busy";
  error.statusCode = details.statusCode ?? 503;
  error.recoverable = true;
  return error;
}

function abortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === "string" && reason ? reason : "The operation was aborted");
  error.name = "AbortError";
  return error;
}

export function raceWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

export class BoundedSemaphore {
  constructor(options = {}) {
    const maxConcurrent = Number(options.maxConcurrent ?? 16);
    const maxQueue = Number(options.maxQueue ?? 200);
    const queueTimeoutMs = Number(options.queueTimeoutMs ?? 5000);
    this.maxConcurrent = Number.isInteger(maxConcurrent) && maxConcurrent > 0 ? maxConcurrent : 16;
    this.maxQueue = Number.isInteger(maxQueue) && maxQueue >= 0 ? maxQueue : 200;
    this.queueTimeoutMs = Number.isFinite(queueTimeoutMs) && queueTimeoutMs > 0 ? queueTimeoutMs : 5000;
    this.errorCode = String(options.errorCode ?? "server_busy");
    this.errorStatusCode = Number(options.errorStatusCode ?? 503);
    this.errorMessage = String(options.errorMessage ?? "当前并发请求较多，请稍后重试");
    this.inFlight = 0;
    this.queue = [];
    this.totalAcquired = 0;
    this.totalRejected = 0;
    this.totalTimedOut = 0;
    this.peakInFlight = 0;
  }

  acquire(signal = null) {
    if (signal?.aborted) {
      return Promise.reject(abortError(signal));
    }
    if (this.inFlight < this.maxConcurrent) {
      return Promise.resolve(this.#grant());
    }
    if (this.queue.length >= this.maxQueue) {
      this.totalRejected += 1;
      return Promise.reject(createConcurrencyError(this.errorMessage, {
        code: this.errorCode,
        statusCode: this.errorStatusCode
      }));
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        settled: false,
        resolve,
        reject,
        timer: null,
        onAbort: null,
        signal
      };
      const cleanup = () => {
        if (waiter.timer) clearTimeout(waiter.timer);
        if (waiter.signal && waiter.onAbort) {
          waiter.signal.removeEventListener("abort", waiter.onAbort);
        }
      };
      waiter.cleanup = cleanup;
      waiter.timer = setTimeout(() => {
        if (waiter.settled) return;
        waiter.settled = true;
        cleanup();
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        this.totalTimedOut += 1;
        this.totalRejected += 1;
        reject(createConcurrencyError(this.errorMessage, {
          code: this.errorCode,
          statusCode: this.errorStatusCode
        }));
      }, this.queueTimeoutMs);
      waiter.timer.unref?.();

      if (signal) {
        waiter.onAbort = () => {
          if (waiter.settled) return;
          waiter.settled = true;
          cleanup();
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(abortError(signal));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
    });
  }

  async run(fn, signal = null) {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  #grant() {
    this.inFlight += 1;
    this.totalAcquired += 1;
    if (this.inFlight > this.peakInFlight) this.peakInFlight = this.inFlight;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight = Math.max(0, this.inFlight - 1);
      this.#drain();
    };
  }

  #drain() {
    while (this.inFlight < this.maxConcurrent && this.queue.length > 0) {
      const waiter = this.queue.shift();
      if (!waiter || waiter.settled) continue;
      waiter.settled = true;
      waiter.cleanup();
      waiter.resolve(this.#grant());
    }
  }

  stats() {
    return {
      inFlight: this.inFlight,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      peakInFlight: this.peakInFlight,
      totalAcquired: this.totalAcquired,
      totalRejected: this.totalRejected,
      totalTimedOut: this.totalTimedOut
    };
  }
}

export class SingleflightCache {
  constructor(options = {}) {
    const maxEntries = Number(options.maxEntries ?? 256);
    const softTtlMs = Number(options.softTtlMs ?? 120_000);
    const hardTtlMs = Number(options.hardTtlMs ?? 600_000);
    this.maxEntries = Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : 256;
    this.softTtlMs = Number.isFinite(softTtlMs) && softTtlMs > 0 ? softTtlMs : 120_000;
    this.hardTtlMs = Number.isFinite(hardTtlMs) && hardTtlMs >= this.softTtlMs
      ? hardTtlMs
      : Math.max(this.softTtlMs * 3, 600_000);
    this.now = options.now ?? (() => Date.now());
    this.entries = new Map();
    this.inFlight = new Map();
    this.l1Hits = 0;
    this.l1StaleHits = 0;
    this.l2Hits = 0;
    this.misses = 0;
    this.coalesced = 0;
    this.backgroundRefreshes = 0;
    this.errors = 0;
  }

  #setL1(key, value, updatedAtMs = this.now()) {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, {
      value,
      updatedAtMs,
      softExpiresAt: updatedAtMs + this.softTtlMs,
      hardExpiresAt: updatedAtMs + this.hardTtlMs
    });
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
    }
  }

  #startSharedLoad(key, loader, { forceRefresh = false, l2Get = null, l2Set = null, background = false } = {}) {
    const existing = this.inFlight.get(key);
    if (existing) {
      if (!background) this.coalesced += 1;
      return existing;
    }
    if (background) this.backgroundRefreshes += 1;

    const shared = (async () => {
      if (!forceRefresh && typeof l2Get === "function") {
        try {
          const l2Entry = await l2Get();
          if (l2Entry && l2Entry.value !== undefined && !l2Entry.expired) {
            const updatedAtMs = Number.isFinite(Date.parse(l2Entry.updatedAt))
              ? Date.parse(l2Entry.updatedAt)
              : this.now();
            this.#setL1(key, l2Entry.value, updatedAtMs);
            this.l2Hits += 1;
            return { value: l2Entry.value, hit: "l2", stale: false };
          }
        } catch {
          // L2 cache read errors must not fail the request; fall through to upstream loader.
        }
      }

      this.misses += 1;
      try {
        const value = await loader();
        const loadedAt = this.now();
        this.#setL1(key, value, loadedAt);
        if (typeof l2Set === "function") {
          Promise.resolve(l2Set(value)).catch(() => {});
        }
        return { value, hit: "miss", stale: false };
      } catch (error) {
        this.errors += 1;
        throw error;
      }
    })().finally(() => {
      if (this.inFlight.get(key) === shared) {
        this.inFlight.delete(key);
      }
    });

    this.inFlight.set(key, shared);
    return shared;
  }

  async getOrLoad(key, loader, options = {}) {
    const { signal = null, forceRefresh = false, l2Get = null, l2Set = null } = options;
    if (signal?.aborted) throw abortError(signal);

    const nowMs = this.now();
    const cached = this.entries.get(key);
    if (!forceRefresh && cached) {
      if (nowMs < cached.softExpiresAt) {
        this.l1Hits += 1;
        // Refresh LRU position.
        this.entries.delete(key);
        this.entries.set(key, cached);
        return { value: cached.value, hit: "l1", stale: false };
      }
      if (nowMs < cached.hardExpiresAt) {
        this.l1StaleHits += 1;
        // Trigger detached background refresh (does not depend on caller's signal).
        this.#startSharedLoad(key, loader, { forceRefresh: true, l2Get: null, l2Set, background: true })
          .catch(() => {});
        return { value: cached.value, hit: "l1", stale: true };
      }
    }

    const shared = this.#startSharedLoad(key, loader, { forceRefresh, l2Get, l2Set, background: false });
    return raceWithAbort(shared, signal);
  }

  delete(key) {
    this.entries.delete(key);
  }

  clear() {
    const size = this.entries.size;
    this.entries.clear();
    return size;
  }

  stats() {
    return {
      size: this.entries.size,
      maxEntries: this.maxEntries,
      inFlight: this.inFlight.size,
      l1Hits: this.l1Hits,
      l1StaleHits: this.l1StaleHits,
      l2Hits: this.l2Hits,
      misses: this.misses,
      coalesced: this.coalesced,
      backgroundRefreshes: this.backgroundRefreshes,
      errors: this.errors
    };
  }
}
