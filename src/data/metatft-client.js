import { buildUrl } from "../core/query-planner.js";

function createRequestError(message, details = {}) {
  const error = new Error(message, details.cause ? { cause: details.cause } : undefined);
  if (details.status !== undefined) error.status = details.status;
  if (details.retryable !== undefined) error.retryable = details.retryable;
  if (details.retryAfterMs !== undefined) error.retryAfterMs = details.retryAfterMs;
  return error;
}

function parseRetryAfterMs(response) {
  const value = response?.headers?.get?.("retry-after");
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function fetchJsonWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      const status = Number(response.status);
      throw createRequestError(
        `MetaTFT request failed: ${response.status} ${response.statusText}`,
        {
          status,
          retryable: status === 429 || status >= 500,
          retryAfterMs: parseRetryAfterMs(response) ?? undefined
        }
      );
    }
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const body = await response.text();
      throw createRequestError(
        `MetaTFT returned non-JSON response from ${url}: ${contentType}; ${body.slice(0, 120)}`,
        { retryable: false }
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw createRequestError(`MetaTFT returned invalid JSON from ${url}`, {
        cause: error,
        retryable: false
      });
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createRequestError(`MetaTFT request timed out after ${timeoutMs}ms: ${url}`, {
        cause: error,
        retryable: false
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRetryCount(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function normalizeDelay(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function sleep(milliseconds) {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

async function fetchJsonWithRetry(fetchImpl, url, options) {
  const maxRetries = normalizeRetryCount(options.maxRetries, 1);
  const retryDelayMs = normalizeDelay(options.retryDelayMs, 120);
  const maxRetryDelayMs = normalizeDelay(options.maxRetryDelayMs, 1000);
  const sleepImpl = options.sleepImpl ?? sleep;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetchJsonWithTimeout(fetchImpl, url, options.timeoutMs);
    } catch (error) {
      const retryable = error?.retryable ?? true;
      if (!retryable || attempt >= maxRetries) {
        const finalError = error instanceof Error
          ? error
          : createRequestError(`MetaTFT request failed: ${String(error)}`, { retryable });
        finalError.attempts = attempt + 1;
        throw finalError;
      }

      const backoff = retryDelayMs * (2 ** attempt);
      const requestedDelay = error.retryAfterMs ?? backoff;
      await sleepImpl(Math.min(requestedDelay, maxRetryDelayMs));
    }
  }

  throw new Error("MetaTFT retry loop ended unexpectedly");
}

function assignRetryOptions(client, options) {
  client.maxRetries = normalizeRetryCount(options.maxRetries, 1);
  client.retryDelayMs = normalizeDelay(options.retryDelayMs, 120);
  client.maxRetryDelayMs = normalizeDelay(options.maxRetryDelayMs, 1000);
  client.sleepImpl = options.sleepImpl ?? sleep;
}

function requestOptions(client) {
  return {
    timeoutMs: client.timeoutMs,
    maxRetries: client.maxRetries,
    retryDelayMs: client.retryDelayMs,
    maxRetryDelayMs: client.maxRetryDelayMs,
    sleepImpl: client.sleepImpl
  };
}

export class MetaTFTClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? "https://api-hc.metatft.com";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
    assignRetryOptions(this, options);
  }

  async getUnitBuilds(plan) {
    if (!this.fetchImpl) throw new Error("fetch is not available in this runtime");
    const url = buildUrl(this.baseUrl, plan);
    return fetchJsonWithRetry(this.fetchImpl, url, requestOptions(this));
  }

  async getCompCandidates(plan) {
    if (!this.fetchImpl) throw new Error("fetch is not available in this runtime");
    const url = buildUrl(this.baseUrl, plan);
    return fetchJsonWithRetry(this.fetchImpl, url, requestOptions(this));
  }

  async getItems(params = {}) {
    return this.#get("/tft-explorer-api/items", params);
  }

  async getTotal(params = {}) {
    return this.#get("/tft-explorer-api/total", params);
  }

  async getUnitsUnique(params = {}) {
    return this.#get("/tft-explorer-api/units_unique", params);
  }

  async getTraits(params = {}) {
    return this.#get("/tft-explorer-api/traits", params);
  }

  async getExactUnitsTraits2(params = {}) {
    return this.#get("/tft-explorer-api/exact_units_traits2", params);
  }

  async #get(path, params) {
    if (!this.fetchImpl) throw new Error("fetch is not available in this runtime");
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    return fetchJsonWithRetry(this.fetchImpl, url, requestOptions(this));
  }
}

export class CompsContextClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? "https://api-hc.metatft.com";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 2200;
    this.rankingsTimeoutMs = options.rankingsTimeoutMs ?? 8000;
    assignRetryOptions(this, options);
  }

  async getLatestClusterInfo(params = {}) {
    return this.#get("/tft-comps-api/latest_cluster_info", params);
  }

  async getCompOptions(params = {}) {
    return this.#get("/tft-comps-api/comp_options", params);
  }

  async getCompBuilds(params = {}) {
    return this.#get("/tft-comps-api/comp_builds", params);
  }

  async getCompsData(params = {}) {
    return this.#get("/tft-comps-api/comps_data", params, this.rankingsTimeoutMs);
  }

  async getCompsStats(params = {}) {
    return this.#get("/tft-comps-api/comps_stats", params, this.rankingsTimeoutMs);
  }

  async #get(path, params, timeoutMs = this.timeoutMs) {
    if (!this.fetchImpl) throw new Error("fetch is not available in this runtime");
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return fetchJsonWithRetry(this.fetchImpl, url, {
      ...requestOptions(this),
      timeoutMs
    });
  }
}
