import { createMetaTftAdapter } from "./adapter.mjs";
import { PlayerMatchError } from "./errors.mjs";
import { resolveRoutingContext } from "./routing.mjs";

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 10;
const MAX_LIMIT = 20;

function boundedLimit(value) {
  const limit = value === undefined ? DEFAULT_LIMIT : Number(value);
  if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
    throw new PlayerMatchError(
      "INVALID_LIMIT",
      `limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}.`
    );
  }
  return limit;
}

function createMemoryCache() {
  const values = new Map();
  return {
    get(key, now = Date.now()) {
      const entry = values.get(key);
      if (!entry || entry.expiresAt <= now) {
        if (entry) values.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key, value, ttlMs, now = Date.now()) {
      values.set(key, { value, expiresAt: now + ttlMs });
    },
    clear() {
      values.clear();
    }
  };
}

function createSlidingWindowLimiter(options = {}) {
  const globalLimit = Number(options.globalLimit ?? 120);
  const callerLimit = Number(options.callerLimit ?? 30);
  const windowMs = Number(options.windowMs ?? 60_000);
  const buckets = new Map();

  function take(key, limit, now) {
    const current = (buckets.get(key) ?? []).filter((time) => now - time < windowMs);
    if (current.length >= limit) return false;
    current.push(now);
    buckets.set(key, current);
    return true;
  }

  return {
    consume(callerKey = "anonymous", namespace = "unknown", now = Date.now()) {
      if (
        !take(`global:${namespace}`, globalLimit, now) ||
        !take(`caller:${namespace}:${callerKey}`, callerLimit, now)
      ) {
        throw new PlayerMatchError(
          "RATE_LIMITED",
          "Player match MCP request limit was reached.",
          { retryable: true }
        );
      }
    }
  };
}

function provenance(context, sourceFetchedAt, extra = {}) {
  return {
    provider: "metatft",
    providerMode: "public_profile",
    environment: context.environment,
    season: context.season,
    sourceFetchedAt,
    ...extra
  };
}

function createPlayerMatchService(options = {}) {
  const adapter = options.adapter ?? createMetaTftAdapter(options);
  const cache = options.cache ?? createMemoryCache();
  const limiter = options.limiter ?? createSlidingWindowLimiter(options);
  const profileTtlMs = Number(options.profileTtlMs ?? 120_000);
  const detailTtlMs = Number(options.detailTtlMs ?? 600_000);
  const inFlight = new Map();
  const latestProfileRequest = new Map();

  function route(input) {
    return resolveRoutingContext(input, options);
  }

  function cacheKey(context, kind, suffix = "") {
    return [
      "metatft",
      context.environment,
      context.season,
      context.playerIdentity,
      kind,
      suffix
    ].join(":");
  }

  async function coalesced(key, work) {
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = Promise.resolve().then(work).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }

  async function profileFor(context, { forceRefresh = false } = {}) {
    const key = cacheKey(context, "profile");
    if (inFlight.has(`${key}:refresh`)) return inFlight.get(`${key}:refresh`);
    const cached = cache.get(key);
    if (cached && !forceRefresh) return { ...cached, cacheStatus: "hit" };
    // An explicit refresh must not join an older ordinary lookup. Keep each
    // mode coalesced and prevent an older response from replacing fresh cache.
    return coalesced(forceRefresh ? `${key}:refresh` : key, async () => {
      const request = {};
      latestProfileRequest.set(key, request);
      try {
        const profile = await adapter.fetchProfile(context, { forceRefresh });
        const normalized = adapter.normalizeProfile(profile, context);
        const rawUrls = new Map(
          profile.matches
            .filter((match) => match?.tft_set === context.expectedSet)
            .map((match) => [String(match.riot_match_id), match.match_data_url])
        );
        const value = {
          ...normalized,
          rawUrls,
          sourceFetchedAt: new Date().toISOString(),
          refreshStatus: forceRefresh ? "completed" : "not_requested"
        };
        if (latestProfileRequest.get(key) === request) cache.set(key, value, profileTtlMs);
        return { ...value, cacheStatus: "miss" };
      } finally {
        if (latestProfileRequest.get(key) === request) latestProfileRequest.delete(key);
      }
    });
  }

  function checkLimit(input, context) {
    limiter.consume(
      String(input?.callerKey ?? input?.caller_key ?? "anonymous"),
      `${context.environment}:${context.season}`
    );
  }

  async function resolvePlayer(input) {
    const context = route(input);
    checkLimit(input, context);
    const profile = await profileFor(context);
    return {
      player: {
        gameName: context.gameName,
        tagLine: context.tagLine,
        environment: context.environment,
        season: context.season,
        platform: context.platform
      },
      availableCount: profile.summaries.length,
      observedUpstreamCount: profile.observedUpstreamCount,
      missingFields: [],
      warnings: profile.warnings,
      provenance: provenance(context, profile.sourceFetchedAt, {
        cacheStatus: profile.cacheStatus
      })
    };
  }

  async function listMatches(input) {
    const context = route(input);
    checkLimit(input, context);
    const limit = boundedLimit(input?.limit);
    const profile = await profileFor(context, { forceRefresh: input?.forceRefresh === true });
    const matches = profile.summaries.slice(0, limit);
    return {
      player: {
        gameName: context.gameName,
        tagLine: context.tagLine
      },
      requestedLimit: limit,
      returnedCount: matches.length,
      availableCount: profile.summaries.length,
      observedUpstreamCount: profile.observedUpstreamCount,
      matches,
      missingFields: [],
      warnings: profile.warnings,
      provenance: provenance(context, profile.sourceFetchedAt, {
        cacheStatus: profile.cacheStatus,
        refreshStatus: profile.refreshStatus
      })
    };
  }

  async function getMatch(input) {
    const context = route(input);
    checkLimit(input, context);
    const matchId = String(input?.matchId ?? input?.match_id ?? "").trim();
    if (!matchId) {
      throw new PlayerMatchError("INVALID_MATCH_ID", "matchId is required.");
    }
    if (!matchId.startsWith(`${context.platform}_`)) {
      throw new PlayerMatchError(
        "ENVIRONMENT_MISMATCH",
        `Match ${matchId} does not belong to ${context.platform}.`
      );
    }
    const key = cacheKey(context, "detail", matchId);
    const cached = cache.get(key);
    if (cached) return { ...cached, provenance: { ...cached.provenance, cacheStatus: "hit" } };

    return coalesced(key, async () => {
      const profile = await profileFor(context);
      const rawUrl = profile.rawUrls.get(matchId);
      if (!rawUrl) {
        throw new PlayerMatchError(
          "PLAYER_OR_MATCH_NOT_FOUND",
          `Match ${matchId} is not present in this player's ${context.season} history.`
        );
      }
      const match = await adapter.fetchMatchDetail(context, matchId, rawUrl);
      const value = {
        match,
        missingFields: match.missingFields ?? [],
        warnings: profile.warnings,
        provenance: provenance(context, new Date().toISOString(), {
          sourceMatchId: matchId,
          cacheStatus: "miss"
        })
      };
      cache.set(key, value, detailTtlMs);
      return value;
    });
  }

  async function getPlayerMatchHistory(input) {
    return listMatches(input);
  }

  return {
    resolvePlayer,
    listMatches,
    getMatch,
    getPlayerMatchHistory,
    clearCache: () => cache.clear()
  };
}

export {
  DEFAULT_LIMIT,
  MIN_LIMIT,
  MAX_LIMIT,
  boundedLimit,
  createMemoryCache,
  createPlayerMatchService,
  createSlidingWindowLimiter
};
