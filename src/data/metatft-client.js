import { buildUrl } from "../core/query-planner.js";
import { get as httpsGet } from "node:https";

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
    let response;
    try {
      response = await fetchImpl(url, { signal: controller.signal });
    } catch (error) {
      if (fetchImpl === globalThis.fetch && error?.name === "TypeError") {
        return await fetchJsonWithNativeHttps(url, timeoutMs);
      }
      throw error;
    }
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

function fetchJsonWithNativeHttps(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, {
      headers: {
        accept: "application/json",
        "user-agent": "TFTClarity/1.0"
      }
    }, (response) => {
      const status = Number(response.statusCode ?? 0);
      const contentType = String(response.headers["content-type"] ?? "");
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (status < 200 || status >= 300) {
          reject(createRequestError(`MetaTFT request failed: ${status}`, {
            status,
            retryable: status === 429 || status >= 500
          }));
          return;
        }
        if (!contentType.includes("application/json")) {
          reject(createRequestError(
            `MetaTFT returned non-JSON response from ${url}: ${contentType}; ${body.slice(0, 120)}`,
            { retryable: false }
          ));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(createRequestError(`MetaTFT returned invalid JSON from ${url}`, {
            cause: error,
            retryable: false
          }));
        }
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(createRequestError(`MetaTFT request timed out after ${timeoutMs}ms: ${url}`, {
        retryable: false
      }));
    });
    request.on("error", reject);
  });
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

  async getUnitBuilds(plan, options = {}) {
    if (!this.fetchImpl) throw new Error("fetch is not available in this runtime");
    const url = buildUrl(this.baseUrl, plan);
    return fetchJsonWithRetry(this.fetchImpl, url, {
      ...requestOptions(this),
      timeoutMs: options.timeoutMs ?? this.timeoutMs
    });
  }

  async getCompCandidates(plan, options = {}) {
    if (!this.fetchImpl) throw new Error("fetch is not available in this runtime");
    const url = buildUrl(this.baseUrl, plan);
    return fetchJsonWithRetry(this.fetchImpl, url, {
      ...requestOptions(this),
      timeoutMs: options.timeoutMs ?? this.timeoutMs
    });
  }

  async getItemCarrierBuilds(plan, options = {}) {
    return this.getUnitBuilds(plan, options);
  }

  async getItems(params = {}, options = {}) {
    return this.#get("/tft-explorer-api/items", params, options.timeoutMs);
  }

  async getTotal(params = {}) {
    return this.#get("/tft-explorer-api/total", params);
  }

  async getUnitsUnique(params = {}, options = {}) {
    return this.#get("/tft-explorer-api/units_unique", params, options.timeoutMs);
  }

  async getTraits(params = {}, options = {}) {
    return this.#get("/tft-explorer-api/traits", params, options.timeoutMs);
  }

  async getExactUnitsTraits2(params = {}) {
    return this.#get("/tft-explorer-api/exact_units_traits2", params);
  }

  async #get(path, params, timeoutMs = this.timeoutMs) {
    if (!this.fetchImpl) throw new Error("fetch is not available in this runtime");
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    return fetchJsonWithRetry(this.fetchImpl, url, {
      ...requestOptions(this),
      timeoutMs
    });
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

  async getLatestClusterInfo(params = {}, options = {}) {
    return this.#get("/tft-comps-api/latest_cluster_info", params, options.timeoutMs);
  }

  async getCompOptions(params = {}) {
    return this.#get("/tft-comps-api/comp_options", params);
  }

  async getCompBuilds(params = {}) {
    return this.#get("/tft-comps-api/comp_builds", params);
  }

  async getCompDetails(params = {}) {
    return this.#get("/tft-comps-api/comp_details", params, this.rankingsTimeoutMs);
  }

  async getCompAugmentTiers(params = {}) {
    return this.#get("/tft-comps-api/comp_augment_tiers", params, this.rankingsTimeoutMs);
  }

  async getAugmentLookup(tftSet, locale = "zh_cn") {
    if (!this.fetchImpl) throw new Error("fetch is not available in this runtime");
    const setName = String(tftSet ?? "").trim();
    const language = String(locale ?? "").trim().toLowerCase();
    if (!/^TFTSet\d+(?:[A-Za-z0-9_-]+)?$/u.test(setName)) {
      throw new TypeError("MetaTFT augment lookup requires a valid TFT set name");
    }
    if (!/^[a-z]{2}_[a-z]{2}$/u.test(language)) {
      throw new TypeError("MetaTFT augment lookup requires a valid locale");
    }
    const url = new URL(`/lookups/${encodeURIComponent(setName)}_latest_${encodeURIComponent(language)}.json`, "https://data.metatft.com");
    return fetchJsonWithRetry(this.fetchImpl, url, {
      ...requestOptions(this),
      timeoutMs: this.rankingsTimeoutMs
    });
  }

  async getSetLookup(tftSet, options = {}) {
    if (!this.fetchImpl) throw new Error("fetch is not available in this runtime");
    const setName = String(tftSet ?? "").trim();
    const channel = String(options.channel ?? "latest").trim().toLowerCase();
    const locale = String(options.locale ?? "zh_cn").trim().toLowerCase();
    if (!/^TFTSet\d+(?:[A-Za-z0-9_-]+)?$/u.test(setName)) {
      throw new TypeError("MetaTFT set lookup requires a valid TFT set name");
    }
    if (!/^[a-z0-9_-]+$/u.test(channel)) {
      throw new TypeError("MetaTFT set lookup requires a valid channel");
    }
    if (!/^[a-z]{2}_[a-z]{2}$/u.test(locale)) {
      throw new TypeError("MetaTFT set lookup requires a valid locale");
    }
    const fileName = `${setName}_${channel}_${locale}.json`;
    const url = new URL(`/lookups/${encodeURIComponent(fileName)}`, "https://data.metatft.com");
    return fetchJsonWithRetry(this.fetchImpl, url, {
      ...requestOptions(this),
      timeoutMs: options.timeoutMs ?? this.rankingsTimeoutMs
    });
  }

  async getCompsData(params = {}) {
    return this.#get("/tft-comps-api/comps_data", params, this.rankingsTimeoutMs);
  }

  async getCompsStats(params = {}) {
    return this.#get("/tft-comps-api/comps_stats", params, this.rankingsTimeoutMs);
  }

  async getUnitItemsProcessed(params = {}) {
    return this.#get("/tft-comps-api/unit_items_processed", params, this.rankingsTimeoutMs);
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
