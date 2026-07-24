import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_SEASON_CONTEXT_ID,
  normalizeSeasonContextId
} from "../season/season-context.js";

export const DEFAULT_CACHE_TTL_MS = {
  query: 5 * 60 * 1000,
  defaultContext: 6 * 60 * 60 * 1000,
  session: 30 * 60 * 1000
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function sortStrings(values) {
  return asArray(values).map(String).sort();
}

function sortNumbers(values) {
  return asArray(values).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function expiresAt(nowMs, ttlMs) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return null;
  return new Date(nowMs + ttlMs).toISOString();
}

function isExpired(entry, nowMs) {
  return Boolean(entry?.expiresAt) && Date.parse(entry.expiresAt) <= nowMs;
}

function entryValue(entry, nowMs) {
  return {
    value: cloneValue(entry.value),
    updatedAt: entry.updatedAt,
    expiresAt: entry.expiresAt,
    expired: isExpired(entry, nowMs)
  };
}

function serializeMap(map) {
  return Object.fromEntries(map.entries());
}

function hydrateMap(value) {
  return new Map(Object.entries(value ?? {}));
}

const SEASON_KEY_PREFIX = "season:";

function seasonStorageKey(key, seasonContextId = DEFAULT_SEASON_CONTEXT_ID) {
  return `${SEASON_KEY_PREFIX}${normalizeSeasonContextId(seasonContextId)}|${String(key)}`;
}

function seasonFromOptions(options = {}) {
  return normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
}

function hydrateSeasonMap(value) {
  return new Map(Object.entries(value ?? {}).map(([key, entry]) => [
    key.startsWith(SEASON_KEY_PREFIX) ? key : seasonStorageKey(key),
    entry
  ]));
}

function normalizeAliasValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function aliasMatchesQuery(entry, query) {
  const text = String(query ?? "").trim().toLowerCase();
  if (!text) return true;
  return [
    entry.alias,
    entry.normalizedAlias,
    entry.entityType,
    entry.apiName,
    entry.source
  ].some((value) => String(value ?? "").toLowerCase().includes(text));
}

export function makeQueryCacheKey(query) {
  const payload = {
    season_context_id: normalizeSeasonContextId(query.seasonContextId ?? query.season_context_id),
    provider_version: query.providerVersion ?? query.provider_version ?? "metatft-live.v1",
    effective_patch: query.effectivePatch ?? query.effective_patch ?? query.patch ?? "current",
    intent: query.intent ?? null,
    unit: query.unit ?? null,
    star_level: sortNumbers(query.starLevel ?? query.star_level),
    item_count: query.itemCount ?? query.item_count ?? null,
    trait_filters: sortStrings(query.traitFilters ?? query.trait_filters),
    locked_items: sortStrings(query.lockedItems ?? query.ownedItems ?? query.locked_items ?? query.owned_items),
    comparison_items: sortStrings(query.comparisonItems ?? query.comparison_items ?? query.comparison?.itemApiNames),
    comparison_mode: query.comparisonMode ?? query.comparison_mode ?? null,
    performance_item: query.performanceItem ?? query.performance_item ?? null,
    primary_metric: query.primaryMetric ?? query.primary_metric ?? null,
    comp: query.comp?.status === "applied" ? query.comp.value?.id ?? "invalid" : "none",
    comp_semantics: query.comp?.semanticsVersion ?? query.comp?.value?.semanticsVersion ?? "none",
    owned_items: sortStrings(query.ownedItems ?? query.owned_items),
    excluded_items: sortStrings(query.excludedItems ?? query.excluded_items),
    item_policy: query.itemPolicy ?? query.item_policy ?? null,
    item_categories: sortStrings(query.itemCategories ?? query.item_categories),
    rank: sortStrings(query.rankFilter ?? query.rank),
    days: query.days ?? null,
    patch: query.patch ?? null,
    queue: query.queue ?? null,
    min_samples: query.minSamples ?? query.min_samples ?? null,
    sort: query.sort ?? null,
    catalog_version: query.catalogVersion ?? query.catalog_version ?? null,
    metrics: sortStrings(query.metrics),
    limit: query.limit ?? null,
    special_mode: query.specialMode ?? null,
    data_version: query.dataVersion ?? null
  };

  return `query:${stableJson(payload)}`;
}

export function makeCompCandidateCacheKey(input) {
  const payload = {
    season_context_id: normalizeSeasonContextId(input.seasonContextId ?? input.season_context_id),
    provider_version: input.providerVersion ?? input.provider_version ?? "metatft-live.v1",
    effective_patch: input.effectivePatch ?? input.effective_patch ?? input.patch ?? "current",
    unit: input.unit ?? null,
    rank: sortStrings(input.rankFilter ?? input.rank),
    days: input.days ?? null,
    patch: input.patch ?? null,
    queue: input.queue ?? null,
    min_samples: input.minSamples ?? null,
    semantics_version: input.semanticsVersion ?? null
  };
  return `comp_candidates:${stableJson(payload)}`;
}

export function makeDefaultContextCacheKey(input) {
  const payload = {
    season_context_id: normalizeSeasonContextId(input.seasonContextId ?? input.season_context_id),
    provider_version: input.providerVersion ?? input.provider_version ?? "metatft-live.v1",
    effective_patch: input.effectivePatch ?? input.effective_patch ?? input.patch ?? "current",
    unit: input.unit ?? null,
    rank: sortStrings(input.rankFilter ?? input.rank),
    days: input.days ?? null,
    patch: input.patch ?? null,
    queue: input.queue ?? null,
    min_cluster_samples: input.minClusterSamples ?? null,
    strategy: input.strategy ?? null,
    special_context_mode: input.specialContextMode ?? null,
    ambiguity_policy: "significant-v1"
  };

  return `default_context:${stableJson(payload)}`;
}

export class MemoryCacheStore {
  constructor(options = {}) {
    this.ttlMs = {
      ...DEFAULT_CACHE_TTL_MS,
      ...(options.ttlMs ?? {})
    };
    this.now = options.now ?? (() => Date.now());
    this.queryCache = new Map();
    this.defaultContextCache = new Map();
    this.sessionState = new Map();
    this.userPreferences = new Map();
    this.itemCatalogs = new Map();
    this.domainCatalogs = new Map();
    this.compTrendHistories = new Map();
    this.entityAliases = [];
    this.queryEvents = new Map();
    this.feedbackEvents = [];
    this.adminAuditEvents = [];
    this.compProfiles = new Map();
    this.compProfileBindings = new Map();
    this.nextEntityAliasId = 1;
    this.nextFeedbackEventId = 1;
  }

  _get(map, key, options = {}) {
    const entry = map.get(key);
    if (!entry) return null;

    const nowMs = this.now();
    if (isExpired(entry, nowMs) && !options.allowExpired) return null;
    return entryValue(entry, nowMs);
  }

  _set(map, key, value, ttlMs) {
    const nowMs = this.now();
    const entry = {
      value: cloneValue(value),
      updatedAt: new Date(nowMs).toISOString(),
      expiresAt: expiresAt(nowMs, ttlMs)
    };
    map.set(key, entry);
    return entryValue(entry, nowMs);
  }

  getQuery(key, options = {}) {
    return this._get(this.queryCache, seasonStorageKey(key, seasonFromOptions(options)), options);
  }

  setQuery(key, value, options = {}) {
    return this._set(this.queryCache, seasonStorageKey(key, seasonFromOptions(options)), value, options.ttlMs ?? this.ttlMs.query);
  }

  getDefaultContext(key, options = {}) {
    return this._get(this.defaultContextCache, seasonStorageKey(key, seasonFromOptions(options)), options);
  }

  setDefaultContext(key, value, options = {}) {
    return this._set(this.defaultContextCache, seasonStorageKey(key, seasonFromOptions(options)), value, options.ttlMs ?? this.ttlMs.defaultContext);
  }

  getSessionState(key, options = {}) {
    return this._get(this.sessionState, seasonStorageKey(key, seasonFromOptions(options)), options);
  }

  setSessionState(key, value, options = {}) {
    return this._set(this.sessionState, seasonStorageKey(key, seasonFromOptions(options)), value, options.ttlMs ?? this.ttlMs.session);
  }

  deleteSessionState(key, options = {}) {
    return this.sessionState.delete(seasonStorageKey(key, seasonFromOptions(options)));
  }

  getUserPreference(key, options = {}) {
    return this._get(this.userPreferences, key, options);
  }

  setUserPreference(key, value) {
    return this._set(this.userPreferences, key, value, null);
  }

  getCompTrendHistory(key, options = {}) {
    return this._get(this.compTrendHistories, seasonStorageKey(key, seasonFromOptions(options)), options);
  }

  setCompTrendHistory(key, value, options = {}) {
    return this._set(this.compTrendHistories, seasonStorageKey(key, seasonFromOptions(options)), value, null);
  }

  deleteUserPreference(key) {
    return this.userPreferences.delete(key);
  }

  getItemCatalog(patch = "current", options = {}) {
    return this._get(this.itemCatalogs, seasonStorageKey(String(patch), seasonFromOptions(options)), options);
  }

  setItemCatalog(patch = "current", items = [], options = {}) {
    const normalizedPatch = String(patch || "current");
    const seasonContextId = seasonFromOptions(options);
    return this._set(this.itemCatalogs, seasonStorageKey(normalizedPatch, seasonContextId), {
      seasonContextId,
      patch: normalizedPatch,
      items: cloneValue(Array.isArray(items) ? items : [])
    }, null);
  }

  clearItemCatalog(patch, options = {}) {
    const seasonContextId = seasonFromOptions(options);
    if (patch !== undefined && patch !== null) {
      return this.itemCatalogs.delete(seasonStorageKey(String(patch), seasonContextId)) ? 1 : 0;
    }
    return this._clearMapForSeason(this.itemCatalogs, { seasonContextId });
  }

  getDomainCatalog(patch = "current", options = {}) {
    return this._get(this.domainCatalogs, seasonStorageKey(String(patch), seasonFromOptions(options)), options);
  }

  setDomainCatalog(patch = "current", value = {}, options = {}) {
    const normalizedPatch = String(patch || "current");
    const seasonContextId = seasonFromOptions(options);
    return this._set(this.domainCatalogs, seasonStorageKey(normalizedPatch, seasonContextId), {
      seasonContextId,
      patch: normalizedPatch,
      units: cloneValue(Array.isArray(value.units) ? value.units : []),
      traits: cloneValue(Array.isArray(value.traits) ? value.traits : [])
    }, null);
  }

  clearDomainCatalog(patch, options = {}) {
    const seasonContextId = seasonFromOptions(options);
    if (patch !== undefined && patch !== null) {
      const key = seasonStorageKey(String(patch), seasonContextId);
      const entry = this.domainCatalogs.get(key);
      if (!entry) return { units: 0, traits: 0 };
      this.domainCatalogs.delete(key);
      return {
        units: Array.isArray(entry.value?.units) ? entry.value.units.length : 0,
        traits: Array.isArray(entry.value?.traits) ? entry.value.traits.length : 0
      };
    }

    const counts = { units: 0, traits: 0 };
    const prefix = seasonStorageKey("", seasonContextId);
    for (const [key, entry] of this.domainCatalogs.entries()) {
      if (!key.startsWith(prefix)) continue;
      counts.units += Array.isArray(entry.value?.units) ? entry.value.units.length : 0;
      counts.traits += Array.isArray(entry.value?.traits) ? entry.value.traits.length : 0;
      this.domainCatalogs.delete(key);
    }
    return counts;
  }

  addEntityAlias(record = {}) {
    const nowMs = this.now();
    const alias = String(record.alias ?? "").trim();
    const entityType = String(record.entityType ?? record.entity_type ?? "").trim();
    const apiName = String(record.apiName ?? record.api_name ?? "").trim();
    if (!alias || !entityType || !apiName) {
      throw new Error("addEntityAlias requires alias, entityType, and apiName");
    }

    const entry = {
      id: record.id ?? this.nextEntityAliasId++,
      alias,
      normalizedAlias: record.normalizedAlias ?? record.normalized_alias ?? normalizeAliasValue(alias),
      entityType,
      apiName,
      seasonContextId: normalizeSeasonContextId(record.seasonContextId ?? record.season_context_id),
      confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : 0.5,
      source: String(record.source ?? "candidate"),
      patch: record.patch ?? null,
      enabled: record.enabled ?? true,
      createdAt: record.createdAt ?? record.created_at ?? new Date(nowMs).toISOString(),
      updatedAt: record.updatedAt ?? record.updated_at ?? new Date(nowMs).toISOString(),
      updatedBy: String(record.updatedBy ?? record.updated_by ?? "system")
    };
    this.nextEntityAliasId = Math.max(this.nextEntityAliasId, Number(entry.id) + 1);
    this.entityAliases.push(entry);
    return cloneValue(entry);
  }

  getEntityAlias(id, options = {}) {
    const aliasId = Number(id);
    const entry = this.entityAliases.find((item) => Number(item.id) === aliasId);
    return entry && entry.seasonContextId === seasonFromOptions(options) ? cloneValue(entry) : null;
  }

  setEntityAliasEnabled(id, enabled, options = {}) {
    const aliasId = Number(id);
    const entry = this.entityAliases.find((item) => Number(item.id) === aliasId);
    if (!entry || entry.seasonContextId !== seasonFromOptions(options)) return null;
    entry.enabled = Boolean(enabled);
    entry.updatedAt = new Date(this.now()).toISOString();
    entry.updatedBy = String(options.updatedBy ?? options.updated_by ?? "admin");
    return cloneValue(entry);
  }

  updateEntityAlias(id, changes = {}, options = {}) {
    const aliasId = Number(id);
    const entry = this.entityAliases.find((item) => Number(item.id) === aliasId);
    if (!entry || entry.seasonContextId !== seasonFromOptions(options)) return null;
    const alias = changes.alias === undefined ? entry.alias : String(changes.alias).trim();
    const entityType = changes.entityType === undefined ? entry.entityType : String(changes.entityType).trim();
    const apiName = changes.apiName === undefined ? entry.apiName : String(changes.apiName).trim();
    if (!alias || !entityType || !apiName) throw new Error("Entity alias requires alias, entityType, and apiName");
    Object.assign(entry, {
      alias,
      normalizedAlias: normalizeAliasValue(alias),
      entityType,
      apiName,
      confidence: changes.confidence === undefined ? entry.confidence : Number(changes.confidence),
      source: changes.source === undefined ? entry.source : String(changes.source),
      patch: changes.patch === undefined ? entry.patch : changes.patch,
      enabled: changes.enabled === undefined ? entry.enabled : Boolean(changes.enabled),
      updatedAt: new Date(this.now()).toISOString(),
      updatedBy: String(changes.updatedBy ?? changes.updated_by ?? options.updatedBy ?? "admin")
    });
    return cloneValue(entry);
  }

  deleteEntityAlias(id, options = {}) {
    const aliasId = Number(id);
    const index = this.entityAliases.findIndex((item) => Number(item.id) === aliasId
      && item.seasonContextId === seasonFromOptions(options));
    if (index < 0) return null;
    return cloneValue(this.entityAliases.splice(index, 1)[0]);
  }

  listEntityAliases(options = {}) {
    const limit = positiveInteger(options.limit, this.entityAliases.length || 100);
    const offset = nonNegativeInteger(options.offset, 0);
    return this.entityAliases
      .filter((entry) => {
        if (entry.seasonContextId !== seasonFromOptions(options)) return false;
        if (options.entityType && entry.entityType !== options.entityType) return false;
        if (options.apiName && entry.apiName !== options.apiName) return false;
        if (options.source && entry.source !== options.source) return false;
        if (options.patch && entry.patch !== options.patch) return false;
        if (options.enabled !== undefined && Boolean(entry.enabled) !== Boolean(options.enabled)) return false;
        if (options.minConfidence !== undefined && entry.confidence < Number(options.minConfidence)) return false;
        if (options.normalizedAlias && entry.normalizedAlias !== options.normalizedAlias) return false;
        if (!aliasMatchesQuery(entry, options.query)) return false;
        return true;
      })
      .sort((a, b) => b.id - a.id)
      .slice(offset, offset + limit)
      .map(cloneValue);
  }

  findEntityAliases(alias, options = {}) {
    return this.listEntityAliases({
      ...options,
      normalizedAlias: normalizeAliasValue(alias),
      enabled: options.enabled ?? true
    }).sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.id - a.id;
    });
  }

  clearEntityAliases(options = {}) {
    const before = this.entityAliases.length;
    this.entityAliases = this.entityAliases.filter((entry) => {
      if (entry.seasonContextId !== seasonFromOptions(options)) return true;
      if (options.enabled === undefined) return false;
      return Boolean(entry.enabled) !== Boolean(options.enabled);
    });
    return before - this.entityAliases.length;
  }

  addQueryEvent(record = {}) {
    const queryId = String(record.queryId ?? record.query_id ?? "").trim();
    const visitorScope = String(record.visitorScope ?? record.visitor_scope ?? "").trim();
    const input = String(record.input ?? "").trim();
    if (!queryId || !visitorScope || !input) {
      throw new Error("addQueryEvent requires queryId, visitorScope, and input");
    }
    const entry = {
      queryId,
      runId: record.runId ?? record.run_id ?? null,
      seasonContextId: normalizeSeasonContextId(record.seasonContextId ?? record.season_context_id),
      visitorScope,
      conversationId: record.conversationId ?? record.conversation_id ?? null,
      input,
      resultType: record.resultType ?? record.result_type ?? null,
      query: cloneValue(record.query ?? null),
      response: cloneValue(record.response ?? null),
      patch: record.patch ?? null,
      cacheHit: Boolean(record.cacheHit ?? record.cache_hit),
      cacheStale: Boolean(record.cacheStale ?? record.cache_stale),
      llmUsed: Boolean(record.llmUsed ?? record.llm_used),
      llmModel: record.llmModel ?? record.llm_model ?? null,
      durationMs: Number.isFinite(Number(record.durationMs ?? record.duration_ms))
        ? Number(record.durationMs ?? record.duration_ms)
        : null,
      createdAt: record.createdAt ?? record.created_at ?? new Date(this.now()).toISOString()
    };
    this.queryEvents.set(queryId, entry);
    return cloneValue(entry);
  }

  getQueryEvent(queryId) {
    const entry = this.queryEvents.get(String(queryId ?? ""));
    return entry ? cloneValue(entry) : null;
  }

  updateQueryEventConclusion(queryId, conclusion) {
    const key = String(queryId ?? "");
    const entry = this.queryEvents.get(key);
    if (!entry) return null;
    const response = cloneValue(entry.response ?? {});
    response.answer = {
      ...(response.answer ?? {}),
      generatedConclusion: cloneValue(conclusion ?? null)
    };
    const updated = {
      ...entry,
      response,
      llmUsed: conclusion?.status === "generated",
      llmModel: conclusion?.model ?? entry.llmModel ?? null
    };
    this.queryEvents.set(key, updated);
    return cloneValue(updated);
  }

  pruneQueryEventsBefore(createdBefore) {
    const cutoff = String(createdBefore ?? "");
    let count = 0;
    for (const [queryId, entry] of this.queryEvents.entries()) {
      if (entry.createdAt >= cutoff) continue;
      this.queryEvents.delete(queryId);
      count += 1;
    }
    return count;
  }

  addFeedbackEvent(feedbackType, payload = {}, options = {}) {
    const type = String(feedbackType ?? "").trim();
    if (!type) throw new Error("addFeedbackEvent requires feedbackType");

    const feedbackId = String(options.feedbackId ?? payload.feedbackId ?? "").trim() || null;
    if (feedbackId) {
      const existing = this.feedbackEvents.find((entry) => entry.feedbackId === feedbackId);
      if (existing) return { ...cloneValue(existing), duplicate: true };
    }

    const nowMs = this.now();
    const createdAt = options.createdAt ?? new Date(nowMs).toISOString();
    const entry = {
      id: options.id ?? this.nextFeedbackEventId++,
      seasonContextId: normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id ?? payload.seasonContextId),
      feedbackId,
      queryId: options.queryId ?? null,
      visitorScope: options.visitorScope ?? null,
      feedbackTarget: options.feedbackTarget ?? null,
      feedbackType: type,
      rating: options.rating ?? null,
      cardIndex: Number.isInteger(options.cardIndex) ? options.cardIndex : null,
      reason: options.reason ?? null,
      payload: cloneValue(payload),
      status: String(options.status ?? "pending"),
      createdAt,
      updatedAt: options.updatedAt ?? createdAt
    };
    this.nextFeedbackEventId = Math.max(this.nextFeedbackEventId, Number(entry.id) + 1);
    this.feedbackEvents.push(entry);
    return cloneValue(entry);
  }

  listFeedbackEvents(options = {}) {
    const limit = positiveInteger(options.limit, this.feedbackEvents.length || 100);
    return this.feedbackEvents
      .filter((entry) => {
        if (options.seasonContextId && entry.seasonContextId !== seasonFromOptions(options)) return false;
        if (options.feedbackType && entry.feedbackType !== options.feedbackType) return false;
        if (options.status && entry.status !== options.status) return false;
        return true;
      })
      .sort((a, b) => b.id - a.id)
      .slice(0, limit)
      .map(cloneValue);
  }

  findFeedbackEventByFeedbackId(feedbackId) {
    const id = String(feedbackId ?? "");
    if (!id) return null;
    const entry = this.feedbackEvents
      .slice()
      .reverse()
      .find((event) => event.feedbackId === id || event.payload?.feedbackId === id);
    return entry ? cloneValue(entry) : null;
  }

  clearFeedbackEvents(options = {}) {
    const before = this.feedbackEvents.length;
    this.feedbackEvents = this.feedbackEvents.filter((entry) => {
      if (options.seasonContextId && entry.seasonContextId !== seasonFromOptions(options)) return true;
      if (options.feedbackType && entry.feedbackType !== options.feedbackType) return true;
      if (options.status && entry.status !== options.status) return true;
      return false;
    });
    return before - this.feedbackEvents.length;
  }

  _clearMap(map) {
    const count = map.size;
    map.clear();
    return count;
  }

  addAdminAudit(record = {}) {
    const entry = {
      id: record.id ?? this.adminAuditEvents.length + 1,
      seasonContextId: normalizeSeasonContextId(record.seasonContextId ?? record.season_context_id),
      action: String(record.action ?? "").trim(),
      entityType: String(record.entityType ?? record.entity_type ?? "").trim(),
      entityId: record.entityId ?? record.entity_id ?? null,
      before: cloneValue(record.before ?? null),
      after: cloneValue(record.after ?? null),
      actor: String(record.actor ?? "admin"),
      createdAt: record.createdAt ?? record.created_at ?? new Date(this.now()).toISOString()
    };
    if (!entry.action || !entry.entityType) throw new Error("Admin audit requires action and entityType");
    this.adminAuditEvents.push(entry);
    return cloneValue(entry);
  }

  listAdminAudits(options = {}) {
    const limit = positiveInteger(options.limit, 100);
    return this.adminAuditEvents
      .filter((entry) => entry.seasonContextId === seasonFromOptions(options))
      .sort((left, right) => Number(right.id) - Number(left.id))
      .slice(0, limit)
      .map(cloneValue);
  }

  upsertCompProfile(record = {}) {
    const seasonContextId = normalizeSeasonContextId(record.seasonContextId ?? record.season_context_id);
    const profileKey = String(record.profileKey ?? record.profile_key ?? "").trim();
    if (!profileKey) throw new Error("Comp profile requires profileKey");
    const key = seasonStorageKey(profileKey, seasonContextId);
    const existing = this.compProfiles.get(key);
    const now = new Date(this.now()).toISOString();
    const entry = {
      seasonContextId,
      profileKey,
      difficulty: record.difficulty ?? null,
      beginnerFriendly: record.beginnerFriendly ?? record.beginner_friendly ?? null,
      pivotDifficulty: record.pivotDifficulty ?? record.pivot_difficulty ?? null,
      positionDifficulty: record.positionDifficulty ?? record.position_difficulty ?? null,
      contestTolerance: record.contestTolerance ?? record.contest_tolerance ?? null,
      econDifficulty: record.econDifficulty ?? record.econ_difficulty ?? null,
      notes: asArray(record.notes).map(String),
      enabled: record.enabled ?? true,
      source: String(record.source ?? "admin"),
      createdAt: existing?.createdAt ?? record.createdAt ?? record.created_at ?? now,
      updatedAt: record.updatedAt ?? record.updated_at ?? now
    };
    this.compProfiles.set(key, entry);
    return cloneValue(entry);
  }

  getCompProfile(profileKey, options = {}) {
    const entry = this.compProfiles.get(seasonStorageKey(profileKey, seasonFromOptions(options)));
    return entry ? cloneValue(entry) : null;
  }

  listCompProfiles(options = {}) {
    const seasonContextId = seasonFromOptions(options);
    return [...this.compProfiles.values()]
      .filter((entry) => entry.seasonContextId === seasonContextId
        && (options.enabled === undefined || Boolean(entry.enabled) === Boolean(options.enabled)))
      .sort((left, right) => left.profileKey.localeCompare(right.profileKey))
      .map(cloneValue);
  }

  deleteCompProfile(profileKey, options = {}) {
    const seasonContextId = seasonFromOptions(options);
    const key = seasonStorageKey(profileKey, seasonContextId);
    const entry = this.compProfiles.get(key);
    if (!entry) return null;
    this.compProfiles.delete(key);
    for (const [bindingKey, binding] of this.compProfileBindings.entries()) {
      if (binding.seasonContextId === seasonContextId && binding.profileKey === String(profileKey)) {
        this.compProfileBindings.delete(bindingKey);
      }
    }
    return cloneValue(entry);
  }

  upsertCompProfileBinding(record = {}) {
    const seasonContextId = normalizeSeasonContextId(record.seasonContextId ?? record.season_context_id);
    const profileKey = String(record.profileKey ?? record.profile_key ?? "").trim();
    const provider = String(record.provider ?? "").trim();
    const clusterId = String(record.clusterId ?? record.cluster_id ?? "").trim();
    const lineupSignature = String(record.lineupSignature ?? record.lineup_signature ?? "").trim();
    if (!profileKey || !provider || !clusterId || !lineupSignature) {
      throw new Error("Comp profile binding requires profileKey, provider, clusterId, and lineupSignature");
    }
    const key = seasonStorageKey(`${profileKey}\u0000${provider}`, seasonContextId);
    const existing = this.compProfileBindings.get(key);
    const now = new Date(this.now()).toISOString();
    const entry = {
      seasonContextId,
      profileKey,
      provider,
      clusterId,
      lineupSignature,
      signatureVersion: String(record.signatureVersion ?? record.signature_version ?? "lineup-signature-v1"),
      strategyOverride: record.strategyOverride ?? record.strategy_override ?? null,
      matchConfidence: Number(record.matchConfidence ?? record.match_confidence ?? 1),
      matchStatus: String(record.matchStatus ?? record.match_status ?? "verified"),
      lastVerifiedAt: record.lastVerifiedAt ?? record.last_verified_at ?? now,
      createdAt: existing?.createdAt ?? record.createdAt ?? record.created_at ?? now,
      updatedAt: record.updatedAt ?? record.updated_at ?? now
    };
    this.compProfileBindings.set(key, entry);
    return cloneValue(entry);
  }

  listCompProfileBindings(options = {}) {
    const seasonContextId = seasonFromOptions(options);
    return [...this.compProfileBindings.values()]
      .filter((entry) => entry.seasonContextId === seasonContextId
        && (!options.profileKey || entry.profileKey === options.profileKey)
        && (!options.provider || entry.provider === options.provider)
        && (!options.clusterId || entry.clusterId === options.clusterId)
        && (!options.matchStatus || entry.matchStatus === options.matchStatus))
      .sort((left, right) => left.profileKey.localeCompare(right.profileKey))
      .map(cloneValue);
  }

  deleteCompProfileBinding(profileKey, provider, options = {}) {
    const key = seasonStorageKey(`${String(profileKey)}\u0000${String(provider)}`, seasonFromOptions(options));
    const entry = this.compProfileBindings.get(key);
    if (!entry) return null;
    this.compProfileBindings.delete(key);
    return cloneValue(entry);
  }

  _clearMapForSeason(map, options = {}) {
    if (options.all === true) return this._clearMap(map);
    const prefix = seasonStorageKey("", seasonFromOptions(options));
    let count = 0;
    for (const key of map.keys()) {
      if (!key.startsWith(prefix)) continue;
      map.delete(key);
      count += 1;
    }
    return count;
  }

  _clearTransientState(options = {}) {
    return {
      queryCache: this._clearMapForSeason(this.queryCache, options),
      defaultContextCache: this._clearMapForSeason(this.defaultContextCache, options),
      sessionState: this._clearMapForSeason(this.sessionState, options)
    };
  }

  clearQueryCache(options = {}) {
    return this._clearMapForSeason(this.queryCache, options);
  }

  clearDefaultContextCache(options = {}) {
    return this._clearMapForSeason(this.defaultContextCache, options);
  }

  clearSessionState(options = {}) {
    return this._clearMapForSeason(this.sessionState, options);
  }

  clearQueryHistory(options = {}) {
    return this._clearTransientState(options);
  }

  clearTransient(options = {}) {
    return this._clearTransientState(options);
  }

  clearExpired() {
    const nowMs = this.now();
    for (const map of [this.queryCache, this.defaultContextCache, this.sessionState]) {
      for (const [key, entry] of map.entries()) {
        if (isExpired(entry, nowMs)) map.delete(key);
      }
    }
  }

  clear() {
    this.queryCache.clear();
    this.defaultContextCache.clear();
    this.sessionState.clear();
    this.userPreferences.clear();
    this.itemCatalogs.clear();
    this.domainCatalogs.clear();
    this.compTrendHistories.clear();
    this.entityAliases = [];
    this.queryEvents.clear();
    this.feedbackEvents = [];
    this.adminAuditEvents = [];
    this.compProfiles.clear();
    this.compProfileBindings.clear();
    this.nextEntityAliasId = 1;
    this.nextFeedbackEventId = 1;
  }
}

export class JsonFileCacheStore extends MemoryCacheStore {
  constructor(options = {}) {
    super(options);
    if (!options.filePath) {
      throw new Error("JsonFileCacheStore requires a filePath");
    }
    this.filePath = options.filePath;
    this.loaded = false;
    this.writeQueue = Promise.resolve();
  }

  async _ensureLoaded() {
    if (this.loaded) return;

    try {
      const data = JSON.parse(await readFile(this.filePath, "utf8"));
      this.queryCache = hydrateSeasonMap(data.queryCache);
      this.defaultContextCache = hydrateSeasonMap(data.defaultContextCache);
      this.sessionState = hydrateSeasonMap(data.sessionState);
      this.userPreferences = hydrateMap(data.userPreferences);
      this.itemCatalogs = hydrateSeasonMap(data.itemCatalogs);
      this.domainCatalogs = hydrateSeasonMap(data.domainCatalogs);
      this.compTrendHistories = hydrateSeasonMap(data.compTrendHistories);
      this.compProfiles = hydrateSeasonMap(data.compProfiles);
      this.compProfileBindings = hydrateSeasonMap(data.compProfileBindings);
      this.entityAliases = (Array.isArray(data.entityAliases) ? data.entityAliases : []).map((entry) => ({
        ...entry,
        seasonContextId: normalizeSeasonContextId(entry.seasonContextId ?? entry.season_context_id)
      }));
      this.queryEvents = new Map([...hydrateMap(data.queryEvents)].map(([key, entry]) => [key, {
        ...entry,
        seasonContextId: normalizeSeasonContextId(entry?.seasonContextId ?? entry?.season_context_id)
      }]));
      this.feedbackEvents = (Array.isArray(data.feedbackEvents) ? data.feedbackEvents : []).map((entry) => ({
        ...entry,
        seasonContextId: normalizeSeasonContextId(entry?.seasonContextId ?? entry?.season_context_id ?? entry?.payload?.seasonContextId)
      }));
      this.adminAuditEvents = (Array.isArray(data.adminAuditEvents) ? data.adminAuditEvents : []).map((entry) => ({
        ...entry,
        seasonContextId: normalizeSeasonContextId(entry?.seasonContextId ?? entry?.season_context_id)
      }));
      this.nextEntityAliasId = positiveInteger(data.nextEntityAliasId, this.entityAliases.length + 1);
      this.nextFeedbackEventId = positiveInteger(data.nextFeedbackEventId, this.feedbackEvents.length + 1);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    this.loaded = true;
  }

  async _persist() {
    const payload = {
      version: 7,
      queryCache: serializeMap(this.queryCache),
      defaultContextCache: serializeMap(this.defaultContextCache),
      sessionState: serializeMap(this.sessionState),
      userPreferences: serializeMap(this.userPreferences),
      itemCatalogs: serializeMap(this.itemCatalogs),
      domainCatalogs: serializeMap(this.domainCatalogs),
      compTrendHistories: serializeMap(this.compTrendHistories),
      compProfiles: serializeMap(this.compProfiles),
      compProfileBindings: serializeMap(this.compProfileBindings),
      entityAliases: this.entityAliases,
      queryEvents: serializeMap(this.queryEvents),
      feedbackEvents: this.feedbackEvents,
      adminAuditEvents: this.adminAuditEvents,
      nextEntityAliasId: this.nextEntityAliasId,
      nextFeedbackEventId: this.nextFeedbackEventId
    };

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  async _persistQueued() {
    this.writeQueue = this.writeQueue.then(() => this._persist());
    return this.writeQueue;
  }

  async getQuery(key, options = {}) {
    await this._ensureLoaded();
    return super.getQuery(key, options);
  }

  async setQuery(key, value, options = {}) {
    await this._ensureLoaded();
    const entry = super.setQuery(key, value, options);
    await this._persistQueued();
    return entry;
  }

  async getDefaultContext(key, options = {}) {
    await this._ensureLoaded();
    return super.getDefaultContext(key, options);
  }

  async setDefaultContext(key, value, options = {}) {
    await this._ensureLoaded();
    const entry = super.setDefaultContext(key, value, options);
    await this._persistQueued();
    return entry;
  }

  async getSessionState(key, options = {}) {
    await this._ensureLoaded();
    return super.getSessionState(key, options);
  }

  async setSessionState(key, value, options = {}) {
    await this._ensureLoaded();
    const entry = super.setSessionState(key, value, options);
    await this._persistQueued();
    return entry;
  }

  async deleteSessionState(key, options = {}) {
    await this._ensureLoaded();
    const deleted = super.deleteSessionState(key, options);
    await this._persistQueued();
    return deleted;
  }

  async getUserPreference(key, options = {}) {
    await this._ensureLoaded();
    return super.getUserPreference(key, options);
  }

  async setUserPreference(key, value) {
    await this._ensureLoaded();
    const entry = super.setUserPreference(key, value);
    await this._persistQueued();
    return entry;
  }

  async deleteUserPreference(key) {
    await this._ensureLoaded();
    const deleted = super.deleteUserPreference(key);
    await this._persistQueued();
    return deleted;
  }

  async getCompTrendHistory(key, options = {}) {
    await this._ensureLoaded();
    return super.getCompTrendHistory(key, options);
  }

  async setCompTrendHistory(key, value, options = {}) {
    await this._ensureLoaded();
    const entry = super.setCompTrendHistory(key, value, options);
    await this._persistQueued();
    return entry;
  }

  async getItemCatalog(patch = "current", options = {}) {
    await this._ensureLoaded();
    return super.getItemCatalog(patch, options);
  }

  async setItemCatalog(patch = "current", items = [], options = {}) {
    await this._ensureLoaded();
    const entry = super.setItemCatalog(patch, items, options);
    await this._persistQueued();
    return entry;
  }

  async clearItemCatalog(patch, options = {}) {
    await this._ensureLoaded();
    const count = super.clearItemCatalog(patch, options);
    await this._persistQueued();
    return count;
  }

  async getDomainCatalog(patch = "current", options = {}) {
    await this._ensureLoaded();
    return super.getDomainCatalog(patch, options);
  }

  async setDomainCatalog(patch = "current", value = {}, options = {}) {
    await this._ensureLoaded();
    const entry = super.setDomainCatalog(patch, value, options);
    await this._persistQueued();
    return entry;
  }

  async clearDomainCatalog(patch, options = {}) {
    await this._ensureLoaded();
    const count = super.clearDomainCatalog(patch, options);
    await this._persistQueued();
    return count;
  }

  async addEntityAlias(record = {}) {
    await this._ensureLoaded();
    const entry = super.addEntityAlias(record);
    await this._persistQueued();
    return entry;
  }

  async getEntityAlias(id, options = {}) {
    await this._ensureLoaded();
    return super.getEntityAlias(id, options);
  }

  async setEntityAliasEnabled(id, enabled, options = {}) {
    await this._ensureLoaded();
    const entry = super.setEntityAliasEnabled(id, enabled, options);
    await this._persistQueued();
    return entry;
  }

  async updateEntityAlias(id, changes = {}, options = {}) {
    await this._ensureLoaded();
    const entry = super.updateEntityAlias(id, changes, options);
    if (entry) await this._persistQueued();
    return entry;
  }

  async deleteEntityAlias(id, options = {}) {
    await this._ensureLoaded();
    const entry = super.deleteEntityAlias(id, options);
    if (entry) await this._persistQueued();
    return entry;
  }

  async listEntityAliases(options = {}) {
    await this._ensureLoaded();
    return super.listEntityAliases(options);
  }

  async findEntityAliases(alias, options = {}) {
    await this._ensureLoaded();
    return super.findEntityAliases(alias, options);
  }

  async clearEntityAliases(options = {}) {
    await this._ensureLoaded();
    const count = super.clearEntityAliases(options);
    await this._persistQueued();
    return count;
  }

  async addQueryEvent(record = {}) {
    await this._ensureLoaded();
    const entry = super.addQueryEvent(record);
    await this._persistQueued();
    return entry;
  }

  async getQueryEvent(queryId) {
    await this._ensureLoaded();
    return super.getQueryEvent(queryId);
  }

  async updateQueryEventConclusion(queryId, conclusion) {
    await this._ensureLoaded();
    const entry = super.updateQueryEventConclusion(queryId, conclusion);
    if (entry) await this._persistQueued();
    return entry;
  }

  async pruneQueryEventsBefore(createdBefore) {
    await this._ensureLoaded();
    const count = super.pruneQueryEventsBefore(createdBefore);
    if (count > 0) await this._persistQueued();
    return count;
  }

  async addFeedbackEvent(feedbackType, payload = {}, options = {}) {
    await this._ensureLoaded();
    const entry = super.addFeedbackEvent(feedbackType, payload, options);
    await this._persistQueued();
    return entry;
  }

  async listFeedbackEvents(options = {}) {
    await this._ensureLoaded();
    return super.listFeedbackEvents(options);
  }

  async findFeedbackEventByFeedbackId(feedbackId) {
    await this._ensureLoaded();
    return super.findFeedbackEventByFeedbackId(feedbackId);
  }

  async clearFeedbackEvents(options = {}) {
    await this._ensureLoaded();
    const count = super.clearFeedbackEvents(options);
    await this._persistQueued();
    return count;
  }

  async addAdminAudit(record = {}) {
    await this._ensureLoaded();
    const entry = super.addAdminAudit(record);
    await this._persistQueued();
    return entry;
  }

  async listAdminAudits(options = {}) {
    await this._ensureLoaded();
    return super.listAdminAudits(options);
  }

  async upsertCompProfile(record = {}) {
    await this._ensureLoaded();
    const entry = super.upsertCompProfile(record);
    await this._persistQueued();
    return entry;
  }

  async getCompProfile(profileKey, options = {}) {
    await this._ensureLoaded();
    return super.getCompProfile(profileKey, options);
  }

  async listCompProfiles(options = {}) {
    await this._ensureLoaded();
    return super.listCompProfiles(options);
  }

  async deleteCompProfile(profileKey, options = {}) {
    await this._ensureLoaded();
    const entry = super.deleteCompProfile(profileKey, options);
    if (entry) await this._persistQueued();
    return entry;
  }

  async upsertCompProfileBinding(record = {}) {
    await this._ensureLoaded();
    const entry = super.upsertCompProfileBinding(record);
    await this._persistQueued();
    return entry;
  }

  async listCompProfileBindings(options = {}) {
    await this._ensureLoaded();
    return super.listCompProfileBindings(options);
  }

  async deleteCompProfileBinding(profileKey, provider, options = {}) {
    await this._ensureLoaded();
    const entry = super.deleteCompProfileBinding(profileKey, provider, options);
    if (entry) await this._persistQueued();
    return entry;
  }

  async clearQueryCache(options = {}) {
    await this._ensureLoaded();
    const count = super.clearQueryCache(options);
    await this._persistQueued();
    return count;
  }

  async clearDefaultContextCache(options = {}) {
    await this._ensureLoaded();
    const count = super.clearDefaultContextCache(options);
    await this._persistQueued();
    return count;
  }

  async clearSessionState(options = {}) {
    await this._ensureLoaded();
    const count = super.clearSessionState(options);
    await this._persistQueued();
    return count;
  }

  async clearQueryHistory(options = {}) {
    await this._ensureLoaded();
    const result = super.clearQueryHistory(options);
    await this._persistQueued();
    return result;
  }

  async clearTransient(options = {}) {
    await this._ensureLoaded();
    const result = super.clearTransient(options);
    await this._persistQueued();
    return result;
  }

  async clearExpired() {
    await this._ensureLoaded();
    super.clearExpired();
    await this._persistQueued();
  }

  async clear() {
    await this._ensureLoaded();
    super.clear();
    await this._persistQueued();
  }
}
