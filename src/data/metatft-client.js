import { buildUrl } from "../core/query-planner.js";
import { BoundedSemaphore, raceWithAbort } from "../core/concurrency.js";
import { get as httpsGet } from "node:https";

function createRequestError(message, details = {}) {
  const error = new Error(message, details.cause ? { cause: details.cause } : undefined);
  if (details.code !== undefined) error.code = details.code;
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
          code: "metatft_http_error",
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
        { code: "metatft_non_json_response", retryable: false }
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw createRequestError(`MetaTFT returned invalid JSON from ${url}`, {
        cause: error,
        code: "metatft_invalid_json",
        retryable: false
      });
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createRequestError(`MetaTFT request timed out after ${timeoutMs}ms: ${url}`, {
        cause: error,
        code: "metatft_timeout",
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
      if (Number(error?.status) === 429) {
        options.onStatus429?.();
      }
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

function initClientConcurrency(client, options = {}) {
  const envMaxConcurrent = Number(process.env.TFT_AGENT_METATFT_MAX_CONCURRENT ?? 16);
  const envQueueTimeoutMs = Number(process.env.TFT_AGENT_METATFT_QUEUE_TIMEOUT_MS ?? 5000);
  client.enableSingleflight = options.enableSingleflight !== false;
  client.inFlight = options.inFlight ?? new Map();
  client.semaphore = options.semaphore ?? new BoundedSemaphore({
    maxConcurrent: options.maxConcurrent ?? (Number.isInteger(envMaxConcurrent) && envMaxConcurrent > 0 ? envMaxConcurrent : 16),
    maxQueue: options.maxQueue ?? 256,
    queueTimeoutMs: options.queueTimeoutMs ?? (Number.isFinite(envQueueTimeoutMs) && envQueueTimeoutMs > 0 ? envQueueTimeoutMs : 5000),
    errorCode: "metatft_busy",
    errorStatusCode: 503,
    errorMessage: "统计服务并发繁忙，请稍后重试"
  });
  client.concurrencyMetrics = options.concurrencyMetrics ?? {
    requestsTotal: 0,
    singleflightCoalesced: 0,
    upstream429Count: 0
  };
}

function fetchUrlWithConcurrency(client, url, options = {}) {
  const key = String(url);
  const signal = options.signal ?? null;
  if (signal?.aborted) {
    return raceWithAbort(Promise.resolve(), signal);
  }
  client.concurrencyMetrics.requestsTotal += 1;

  if (client.enableSingleflight && client.inFlight.has(key)) {
    client.concurrencyMetrics.singleflightCoalesced += 1;
    return raceWithAbort(client.inFlight.get(key), signal);
  }

  // Shared upstream request runs without binding to the first caller's AbortSignal
  // so one client disconnect cannot cancel other coalesced callers.
  const shared = client.semaphore.run(
    () => fetchJsonWithRetry(client.fetchImpl, url, {
      ...requestOptions(client),
      timeoutMs: options.timeoutMs ?? client.timeoutMs,
      onStatus429: () => {
        client.concurrencyMetrics.upstream429Count += 1;
      }
    }),
    null
  ).finally(() => {
    if (client.inFlight.get(key) === shared) {
      client.inFlight.delete(key);
    }
  });

  if (client.enableSingleflight) {
    client.inFlight.set(key, shared);
  }
  return raceWithAbort(shared, signal);
}

export class MetaTFTClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? "https://api-hc.metatft.com";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
    assignRetryOptions(this, options);
    initClientConcurrency(this, options);
  }

  getConcurrencyStats() {
    return {
      ...this.semaphore.stats(),
      inFlightUrls: this.inFlight.size,
      requestsTotal: this.concurrencyMetrics.requestsTotal,
      singleflightCoalesced: this.concurrencyMetrics.singleflightCoalesced,
      upstream429Count: this.concurrencyMetrics.upstream429Count
    };
  }

  async getUnitBuilds(plan, options = {}) {
    if (!this.fetchImpl) throw new Error("fetch is not available in this runtime");
    const url = buildUrl(this.baseUrl, plan);
    return fetchUrlWithConcurrency(this, url, {
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      signal: options.signal
    });
  }

  async getCompCandidates(plan, options = {}) {
    if (!this.fetchImpl) throw new Error("fetch is not available in this runtime");
    const url = buildUrl(this.baseUrl, plan);
    return fetchUrlWithConcurrency(this, url, {
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      signal: options.signal
    });
  }

  async getItemCarrierBuilds(plan, options = {}) {
    return this.getUnitBuilds(plan, options);
  }

  async getItems(params = {}, options = {}) {
    return this.#get("/tft-explorer-api/items", params, options.timeoutMs, options.signal);
  }

  async getTotal(params = {}, options = {}) {
    return this.#get("/tft-explorer-api/total", params, options.timeoutMs, options.signal);
  }

  async getUnitsUnique(params = {}, options = {}) {
    return this.#get("/tft-explorer-api/units_unique", params, options.timeoutMs, options.signal);
  }

  async getTraits(params = {}, options = {}) {
    return this.#get("/tft-explorer-api/traits", params, options.timeoutMs, options.signal);
  }

  async getExactUnitsTraits2(params = {}, options = {}) {
    return this.#get("/tft-explorer-api/exact_units_traits2", params, options.timeoutMs, options.signal);
  }

  async #get(path, params, timeoutMs = this.timeoutMs, signal = null) {
    if (!this.fetchImpl) throw new Error("fetch is not available in this runtime");
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    return fetchUrlWithConcurrency(this, url, { timeoutMs, signal });
  }
}

export class CompsContextClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? "https://api-hc.metatft.com";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 2200;
    this.rankingsTimeoutMs = options.rankingsTimeoutMs ?? 8000;
    assignRetryOptions(this, options);
    initClientConcurrency(this, options);
  }

  getConcurrencyStats() {
    return {
      ...this.semaphore.stats(),
      inFlightUrls: this.inFlight.size,
      requestsTotal: this.concurrencyMetrics.requestsTotal,
      singleflightCoalesced: this.concurrencyMetrics.singleflightCoalesced,
      upstream429Count: this.concurrencyMetrics.upstream429Count
    };
  }

  async getLatestClusterInfo(params = {}, options = {}) {
    return this.#get("/tft-comps-api/latest_cluster_info", params, options.timeoutMs, options.signal);
  }

  async getCompOptions(params = {}, options = {}) {
    return this.#get("/tft-comps-api/comp_options", params, options.timeoutMs, options.signal);
  }

  async getCompBuilds(params = {}, options = {}) {
    return this.#get("/tft-comps-api/comp_builds", params, options.timeoutMs, options.signal);
  }

  async getCompDetails(params = {}, options = {}) {
    return this.#get("/tft-comps-api/comp_details", params, this.rankingsTimeoutMs, options.signal);
  }

  async getCompAugmentTiers(params = {}, options = {}) {
    return this.#get("/tft-comps-api/comp_augment_tiers", params, this.rankingsTimeoutMs, options.signal);
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
    return fetchUrlWithConcurrency(this, url, { timeoutMs: this.rankingsTimeoutMs });
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
    return fetchUrlWithConcurrency(this, url, {
      timeoutMs: options.timeoutMs ?? this.rankingsTimeoutMs,
      signal: options.signal
    });
  }

  async getCompsData(params = {}, options = {}) {
    return this.#get("/tft-comps-api/comps_data", params, this.rankingsTimeoutMs, options.signal);
  }

  async getCompsStats(params = {}, options = {}) {
    return this.#get("/tft-comps-api/comps_stats", params, this.rankingsTimeoutMs, options.signal);
  }

  async getUnitItemsProcessed(params = {}, options = {}) {
    return this.#get("/tft-comps-api/unit_items_processed", params, this.rankingsTimeoutMs, options.signal);
  }

  async #get(path, params, timeoutMs = this.timeoutMs, signal = null) {
    if (!this.fetchImpl) throw new Error("fetch is not available in this runtime");
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return fetchUrlWithConcurrency(this, url, { timeoutMs, signal });
  }
}
