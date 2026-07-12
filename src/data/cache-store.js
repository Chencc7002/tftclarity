import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
    intent: query.intent ?? null,
    unit: query.unit ?? null,
    star_level: sortNumbers(query.starLevel ?? query.star_level),
    item_count: query.itemCount ?? query.item_count ?? null,
    trait_filters: sortStrings(query.traitFilters ?? query.trait_filters),
    comp: query.comp?.status === "applied" ? query.comp.value?.id ?? "invalid" : "none",
    comp_semantics: query.comp?.semanticsVersion ?? query.comp?.value?.semanticsVersion ?? "none",
    owned_items: sortStrings(query.ownedItems ?? query.owned_items),
    excluded_items: sortStrings(query.excludedItems ?? query.excluded_items),
    item_policy: query.itemPolicy ?? query.item_policy ?? null,
    rank: sortStrings(query.rankFilter ?? query.rank),
    days: query.days ?? null,
    patch: query.patch ?? null,
    queue: query.queue ?? null,
    min_samples: query.minSamples ?? query.min_samples ?? null,
    sort: query.sort ?? null,
    metrics: sortStrings(query.metrics),
    limit: query.limit ?? null,
    special_mode: query.specialMode ?? null,
    data_version: query.dataVersion ?? null
  };

  return `query:${stableJson(payload)}`;
}

export function makeCompCandidateCacheKey(input) {
  const payload = {
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
    this.entityAliases = [];
    this.feedbackEvents = [];
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
    return this._get(this.queryCache, key, options);
  }

  setQuery(key, value, options = {}) {
    return this._set(this.queryCache, key, value, options.ttlMs ?? this.ttlMs.query);
  }

  getDefaultContext(key, options = {}) {
    return this._get(this.defaultContextCache, key, options);
  }

  setDefaultContext(key, value, options = {}) {
    return this._set(this.defaultContextCache, key, value, options.ttlMs ?? this.ttlMs.defaultContext);
  }

  getSessionState(key, options = {}) {
    return this._get(this.sessionState, key, options);
  }

  setSessionState(key, value, options = {}) {
    return this._set(this.sessionState, key, value, options.ttlMs ?? this.ttlMs.session);
  }

  deleteSessionState(key) {
    return this.sessionState.delete(key);
  }

  getUserPreference(key, options = {}) {
    return this._get(this.userPreferences, key, options);
  }

  setUserPreference(key, value) {
    return this._set(this.userPreferences, key, value, null);
  }

  deleteUserPreference(key) {
    return this.userPreferences.delete(key);
  }

  getItemCatalog(patch = "current", options = {}) {
    return this._get(this.itemCatalogs, String(patch), options);
  }

  setItemCatalog(patch = "current", items = []) {
    const normalizedPatch = String(patch || "current");
    return this._set(this.itemCatalogs, normalizedPatch, {
      patch: normalizedPatch,
      items: cloneValue(Array.isArray(items) ? items : [])
    }, null);
  }

  clearItemCatalog(patch) {
    if (patch !== undefined && patch !== null) {
      return this.itemCatalogs.delete(String(patch)) ? 1 : 0;
    }
    return this._clearMap(this.itemCatalogs);
  }

  getDomainCatalog(patch = "current", options = {}) {
    return this._get(this.domainCatalogs, String(patch), options);
  }

  setDomainCatalog(patch = "current", value = {}) {
    const normalizedPatch = String(patch || "current");
    return this._set(this.domainCatalogs, normalizedPatch, {
      patch: normalizedPatch,
      units: cloneValue(Array.isArray(value.units) ? value.units : []),
      traits: cloneValue(Array.isArray(value.traits) ? value.traits : [])
    }, null);
  }

  clearDomainCatalog(patch) {
    if (patch !== undefined && patch !== null) {
      const key = String(patch);
      const entry = this.domainCatalogs.get(key);
      if (!entry) return { units: 0, traits: 0 };
      this.domainCatalogs.delete(key);
      return {
        units: Array.isArray(entry.value?.units) ? entry.value.units.length : 0,
        traits: Array.isArray(entry.value?.traits) ? entry.value.traits.length : 0
      };
    }

    const counts = { units: 0, traits: 0 };
    for (const entry of this.domainCatalogs.values()) {
      counts.units += Array.isArray(entry.value?.units) ? entry.value.units.length : 0;
      counts.traits += Array.isArray(entry.value?.traits) ? entry.value.traits.length : 0;
    }
    this.domainCatalogs.clear();
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
      confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : 0.5,
      source: String(record.source ?? "candidate"),
      patch: record.patch ?? null,
      enabled: record.enabled ?? true,
      updatedAt: record.updatedAt ?? record.updated_at ?? new Date(nowMs).toISOString()
    };
    this.nextEntityAliasId = Math.max(this.nextEntityAliasId, Number(entry.id) + 1);
    this.entityAliases.push(entry);
    return cloneValue(entry);
  }

  getEntityAlias(id) {
    const aliasId = Number(id);
    const entry = this.entityAliases.find((item) => Number(item.id) === aliasId);
    return entry ? cloneValue(entry) : null;
  }

  setEntityAliasEnabled(id, enabled) {
    const aliasId = Number(id);
    const entry = this.entityAliases.find((item) => Number(item.id) === aliasId);
    if (!entry) return null;
    entry.enabled = Boolean(enabled);
    entry.updatedAt = new Date(this.now()).toISOString();
    return cloneValue(entry);
  }

  listEntityAliases(options = {}) {
    const limit = positiveInteger(options.limit, this.entityAliases.length || 100);
    const offset = nonNegativeInteger(options.offset, 0);
    return this.entityAliases
      .filter((entry) => {
        if (options.entityType && entry.entityType !== options.entityType) return false;
        if (options.apiName && entry.apiName !== options.apiName) return false;
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
      if (options.enabled === undefined) return false;
      return Boolean(entry.enabled) !== Boolean(options.enabled);
    });
    return before - this.entityAliases.length;
  }

  addFeedbackEvent(feedbackType, payload = {}, options = {}) {
    const type = String(feedbackType ?? "").trim();
    if (!type) throw new Error("addFeedbackEvent requires feedbackType");

    const nowMs = this.now();
    const entry = {
      id: options.id ?? this.nextFeedbackEventId++,
      feedbackType: type,
      payload: cloneValue(payload),
      status: String(options.status ?? "pending"),
      createdAt: options.createdAt ?? new Date(nowMs).toISOString()
    };
    this.nextFeedbackEventId = Math.max(this.nextFeedbackEventId, Number(entry.id) + 1);
    this.feedbackEvents.push(entry);
    return cloneValue(entry);
  }

  listFeedbackEvents(options = {}) {
    const limit = positiveInteger(options.limit, this.feedbackEvents.length || 100);
    return this.feedbackEvents
      .filter((entry) => {
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
      .find((event) => event.payload?.feedbackId === id);
    return entry ? cloneValue(entry) : null;
  }

  clearFeedbackEvents(options = {}) {
    const before = this.feedbackEvents.length;
    this.feedbackEvents = this.feedbackEvents.filter((entry) => {
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

  _clearTransientState() {
    return {
      queryCache: this._clearMap(this.queryCache),
      defaultContextCache: this._clearMap(this.defaultContextCache),
      sessionState: this._clearMap(this.sessionState)
    };
  }

  clearQueryCache() {
    return this._clearMap(this.queryCache);
  }

  clearDefaultContextCache() {
    return this._clearMap(this.defaultContextCache);
  }

  clearSessionState() {
    return this._clearMap(this.sessionState);
  }

  clearQueryHistory() {
    return this._clearTransientState();
  }

  clearTransient() {
    return this._clearTransientState();
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
    this.entityAliases = [];
    this.feedbackEvents = [];
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
      this.queryCache = hydrateMap(data.queryCache);
      this.defaultContextCache = hydrateMap(data.defaultContextCache);
      this.sessionState = hydrateMap(data.sessionState);
      this.userPreferences = hydrateMap(data.userPreferences);
      this.itemCatalogs = hydrateMap(data.itemCatalogs);
      this.domainCatalogs = hydrateMap(data.domainCatalogs);
      this.entityAliases = Array.isArray(data.entityAliases) ? data.entityAliases : [];
      this.feedbackEvents = Array.isArray(data.feedbackEvents) ? data.feedbackEvents : [];
      this.nextEntityAliasId = positiveInteger(data.nextEntityAliasId, this.entityAliases.length + 1);
      this.nextFeedbackEventId = positiveInteger(data.nextFeedbackEventId, this.feedbackEvents.length + 1);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    this.loaded = true;
  }

  async _persist() {
    const payload = {
      version: 2,
      queryCache: serializeMap(this.queryCache),
      defaultContextCache: serializeMap(this.defaultContextCache),
      sessionState: serializeMap(this.sessionState),
      userPreferences: serializeMap(this.userPreferences),
      itemCatalogs: serializeMap(this.itemCatalogs),
      domainCatalogs: serializeMap(this.domainCatalogs),
      entityAliases: this.entityAliases,
      feedbackEvents: this.feedbackEvents,
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

  async deleteSessionState(key) {
    await this._ensureLoaded();
    const deleted = super.deleteSessionState(key);
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

  async getItemCatalog(patch = "current", options = {}) {
    await this._ensureLoaded();
    return super.getItemCatalog(patch, options);
  }

  async setItemCatalog(patch = "current", items = []) {
    await this._ensureLoaded();
    const entry = super.setItemCatalog(patch, items);
    await this._persistQueued();
    return entry;
  }

  async clearItemCatalog(patch) {
    await this._ensureLoaded();
    const count = super.clearItemCatalog(patch);
    await this._persistQueued();
    return count;
  }

  async getDomainCatalog(patch = "current", options = {}) {
    await this._ensureLoaded();
    return super.getDomainCatalog(patch, options);
  }

  async setDomainCatalog(patch = "current", value = {}) {
    await this._ensureLoaded();
    const entry = super.setDomainCatalog(patch, value);
    await this._persistQueued();
    return entry;
  }

  async clearDomainCatalog(patch) {
    await this._ensureLoaded();
    const count = super.clearDomainCatalog(patch);
    await this._persistQueued();
    return count;
  }

  async addEntityAlias(record = {}) {
    await this._ensureLoaded();
    const entry = super.addEntityAlias(record);
    await this._persistQueued();
    return entry;
  }

  async getEntityAlias(id) {
    await this._ensureLoaded();
    return super.getEntityAlias(id);
  }

  async setEntityAliasEnabled(id, enabled) {
    await this._ensureLoaded();
    const entry = super.setEntityAliasEnabled(id, enabled);
    await this._persistQueued();
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

  async clearQueryCache() {
    await this._ensureLoaded();
    const count = super.clearQueryCache();
    await this._persistQueued();
    return count;
  }

  async clearDefaultContextCache() {
    await this._ensureLoaded();
    const count = super.clearDefaultContextCache();
    await this._persistQueued();
    return count;
  }

  async clearSessionState() {
    await this._ensureLoaded();
    const count = super.clearSessionState();
    await this._persistQueued();
    return count;
  }

  async clearQueryHistory() {
    await this._ensureLoaded();
    const result = super.clearQueryHistory();
    await this._persistQueued();
    return result;
  }

  async clearTransient() {
    await this._ensureLoaded();
    const result = super.clearTransient();
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
