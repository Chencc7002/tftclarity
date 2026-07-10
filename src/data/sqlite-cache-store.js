import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CACHE_TTL_MS } from "./cache-store.js";

export const SQLITE_CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS user_preferences (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS query_cache (
  cache_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  request_json TEXT,
  response_json TEXT,
  computed_json TEXT,
  source TEXT NOT NULL DEFAULT 'metatft',
  patch TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS default_context_cache (
  cache_key TEXT PRIMARY KEY,
  unit TEXT,
  cluster_id TEXT,
  comp_name TEXT,
  units_json TEXT,
  traits_json TEXT,
  value_json TEXT NOT NULL,
  source_endpoint TEXT,
  rank TEXT,
  days INTEGER,
  patch TEXT,
  queue TEXT,
  score REAL,
  count INTEGER,
  avg REAL,
  expires_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  api_name TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  patch TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_aliases_lookup
ON entity_aliases(normalized_alias, entity_type, enabled);

CREATE INDEX IF NOT EXISTS idx_query_cache_expiry
ON query_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_default_context_unit
ON default_context_cache(unit, patch, queue, expires_at);

CREATE TABLE IF NOT EXISTS item_catalog (
  api_name TEXT PRIMARY KEY,
  zh_name TEXT,
  category TEXT NOT NULL,
  current INTEGER NOT NULL,
  obtainable INTEGER NOT NULL,
  patch TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  raw_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_item_catalog_policy
ON item_catalog(category, current, obtainable, patch);

CREATE TABLE IF NOT EXISTS units (
  api_name TEXT PRIMARY KEY,
  zh_name TEXT,
  aliases_json TEXT NOT NULL,
  current INTEGER NOT NULL,
  patch TEXT NOT NULL,
  raw_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_units_patch
ON units(patch, current);

CREATE TABLE IF NOT EXISTS traits (
  filter_id TEXT PRIMARY KEY,
  api_name TEXT NOT NULL,
  zh_name TEXT,
  display_name TEXT,
  aliases_json TEXT NOT NULL,
  current INTEGER NOT NULL,
  patch TEXT NOT NULL,
  raw_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_traits_patch
ON traits(patch, current);

CREATE TABLE IF NOT EXISTS feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
`;

const STORE_TABLES = {
  query: {
    table: "query_cache",
    keyColumn: "cache_key",
    ttlKey: "query"
  },
  defaultContext: {
    table: "default_context_cache",
    keyColumn: "cache_key",
    ttlKey: "defaultContext"
  },
  session: {
    table: "session_state",
    keyColumn: "key",
    ttlKey: "session"
  },
  preference: {
    table: "user_preferences",
    keyColumn: "key",
    ttlKey: null
  }
};

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
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

function bindRun(statement, params = []) {
  return statement.run(...params);
}

function bindGet(statement, params = []) {
  return statement.get(...params);
}

function bindAll(statement, params = []) {
  return statement.all(...params);
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

function extractQueryColumns(value = {}) {
  return {
    request_json: value.request ? JSON.stringify(value.request) : null,
    response_json: value.response ? JSON.stringify(value.response) : null,
    computed_json: value.computed ? JSON.stringify(value.computed) : null,
    source: value.source ?? "metatft",
    patch: value.query?.patch ?? value.request?.params?.patch ?? null
  };
}

function extractDefaultContextColumns(value = {}) {
  return {
    unit: value.unit ?? null,
    cluster_id: value.clusterId ?? value.cluster_id ?? null,
    comp_name: value.compName ?? value.comp_name ?? null,
    units_json: value.units ? JSON.stringify(value.units) : null,
    traits_json: value.traits ? JSON.stringify(value.traits) : null,
    source_endpoint: value.sourceEndpoint ?? value.source_endpoint ?? null,
    rank: Array.isArray(value.rankFilter) ? value.rankFilter.join(",") : value.rank ?? null,
    days: value.days ?? null,
    patch: value.patch ?? null,
    queue: value.queue ?? null,
    score: value.score ?? null,
    count: value.count ?? null,
    avg: value.avg ?? null
  };
}

function rowToEntityAlias(row) {
  return {
    id: row.id,
    alias: row.alias,
    normalizedAlias: row.normalized_alias,
    entityType: row.entity_type,
    apiName: row.api_name,
    confidence: row.confidence,
    source: row.source,
    patch: row.patch,
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at
  };
}

function rowToFeedbackEvent(row) {
  return {
    id: row.id,
    feedbackType: row.feedback_type,
    payload: JSON.parse(row.payload_json),
    status: row.status,
    createdAt: row.created_at
  };
}

async function openBundledSQLiteDatabase(filePath) {
  if (filePath && filePath !== ":memory:") {
    await mkdir(dirname(filePath), { recursive: true });
  }

  try {
    const sqlite = await import("node:sqlite");
    return new sqlite.DatabaseSync(filePath);
  } catch (nodeSqliteError) {
    try {
      const betterSqlite = await import("better-sqlite3");
      const Database = betterSqlite.default ?? betterSqlite;
      return new Database(filePath);
    } catch (betterSqliteError) {
      throw new Error([
        "SQLiteCacheStore requires an injected database, node:sqlite, or better-sqlite3.",
        `node:sqlite: ${nodeSqliteError.message}`,
        `better-sqlite3: ${betterSqliteError.message}`
      ].join(" "));
    }
  }
}

export class SQLiteCacheStore {
  static async open(options = {}) {
    if (!options.filePath && !options.database) {
      throw new Error("SQLiteCacheStore.open requires filePath or database");
    }

    const database = options.database ?? await openBundledSQLiteDatabase(options.filePath);
    return new SQLiteCacheStore({
      ...options,
      database
    });
  }

  constructor(options = {}) {
    if (!options.database) {
      throw new Error("SQLiteCacheStore requires a database; use SQLiteCacheStore.open for file paths");
    }

    this.database = options.database;
    this.ttlMs = {
      ...DEFAULT_CACHE_TTL_MS,
      ...(options.ttlMs ?? {})
    };
    this.now = options.now ?? (() => Date.now());
    this.database.exec(SQLITE_CACHE_SCHEMA);
  }

  _get(store, key, options = {}) {
    const config = STORE_TABLES[store];
    if (store === "preference") {
      const row = bindGet(
        this.database.prepare("SELECT value_json, updated_at FROM user_preferences WHERE key = ?"),
        [key]
      );
      if (!row) return null;
      return {
        value: cloneValue(JSON.parse(row.value_json)),
        updatedAt: row.updated_at,
        expiresAt: null,
        expired: false
      };
    }

    const statement = this.database.prepare(
      `SELECT value_json, updated_at, expires_at FROM ${config.table} WHERE ${config.keyColumn} = ?`
    );
    const row = bindGet(statement, [key]);
    if (!row) return null;

    const nowMs = this.now();
    const entry = {
      value: JSON.parse(row.value_json),
      updatedAt: row.updated_at,
      expiresAt: row.expires_at
    };
    if (isExpired(entry, nowMs) && !options.allowExpired) return null;
    return entryValue(entry, nowMs);
  }

  _set(store, key, value, options = {}) {
    const config = STORE_TABLES[store];
    const nowMs = this.now();
    const updatedAt = new Date(nowMs).toISOString();
    const entryExpiresAt = expiresAt(nowMs, options.ttlMs ?? this.ttlMs[config.ttlKey]);
    const valueJson = JSON.stringify(cloneValue(value));

    if (store === "query") {
      const extra = extractQueryColumns(value);
      bindRun(this.database.prepare(`
        INSERT INTO query_cache (
          cache_key, value_json, request_json, response_json, computed_json, source, patch, expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          value_json = excluded.value_json,
          request_json = excluded.request_json,
          response_json = excluded.response_json,
          computed_json = excluded.computed_json,
          source = excluded.source,
          patch = excluded.patch,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `), [
        key,
        valueJson,
        extra.request_json,
        extra.response_json,
        extra.computed_json,
        extra.source,
        extra.patch,
        entryExpiresAt,
        updatedAt
      ]);
    } else if (store === "defaultContext") {
      const extra = extractDefaultContextColumns(value);
      bindRun(this.database.prepare(`
        INSERT INTO default_context_cache (
          cache_key, unit, cluster_id, comp_name, units_json, traits_json, value_json,
          source_endpoint, rank, days, patch, queue, score, count, avg, expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          unit = excluded.unit,
          cluster_id = excluded.cluster_id,
          comp_name = excluded.comp_name,
          units_json = excluded.units_json,
          traits_json = excluded.traits_json,
          value_json = excluded.value_json,
          source_endpoint = excluded.source_endpoint,
          rank = excluded.rank,
          days = excluded.days,
          patch = excluded.patch,
          queue = excluded.queue,
          score = excluded.score,
          count = excluded.count,
          avg = excluded.avg,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `), [
        key,
        extra.unit,
        extra.cluster_id,
        extra.comp_name,
        extra.units_json,
        extra.traits_json,
        valueJson,
        extra.source_endpoint,
        extra.rank,
        extra.days,
        extra.patch,
        extra.queue,
        extra.score,
        extra.count,
        extra.avg,
        entryExpiresAt,
        updatedAt
      ]);
    } else if (store === "preference") {
      bindRun(this.database.prepare(`
        INSERT INTO user_preferences (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `), [key, valueJson, updatedAt]);
    } else {
      bindRun(this.database.prepare(`
        INSERT INTO ${config.table} (${config.keyColumn}, value_json, expires_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(${config.keyColumn}) DO UPDATE SET
          value_json = excluded.value_json,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `), [key, valueJson, entryExpiresAt, updatedAt]);
    }

    return entryValue({
      value,
      updatedAt,
      expiresAt: entryExpiresAt
    }, nowMs);
  }

  _delete(store, key) {
    const config = STORE_TABLES[store];
    const result = bindRun(
      this.database.prepare(`DELETE FROM ${config.table} WHERE ${config.keyColumn} = ?`),
      [key]
    );
    return Boolean(result?.changes ?? result?.changes === undefined);
  }

  _clearStore(store) {
    const config = STORE_TABLES[store];
    const result = bindRun(this.database.prepare(`DELETE FROM ${config.table}`));
    return result?.changes ?? 0;
  }

  getQuery(key, options = {}) {
    return this._get("query", key, options);
  }

  setQuery(key, value, options = {}) {
    return this._set("query", key, value, options);
  }

  getDefaultContext(key, options = {}) {
    return this._get("defaultContext", key, options);
  }

  setDefaultContext(key, value, options = {}) {
    return this._set("defaultContext", key, value, options);
  }

  getSessionState(key, options = {}) {
    return this._get("session", key, options);
  }

  setSessionState(key, value, options = {}) {
    return this._set("session", key, value, options);
  }

  deleteSessionState(key) {
    return this._delete("session", key);
  }

  getUserPreference(key, options = {}) {
    return this._get("preference", key, options);
  }

  setUserPreference(key, value) {
    return this._set("preference", key, value, {
      ttlMs: null
    });
  }

  deleteUserPreference(key) {
    return this._delete("preference", key);
  }

  getItemCatalog(patch = "current") {
    const normalizedPatch = String(patch || "current");
    const rows = bindAll(this.database.prepare(`
      SELECT api_name, zh_name, category, current, obtainable, patch, aliases_json, raw_json, updated_at
      FROM item_catalog
      WHERE patch = ?
      ORDER BY api_name ASC
    `), [normalizedPatch]);
    if (rows.length === 0) return null;

    const items = rows.map((row) => {
      let raw = null;
      try {
        raw = row.raw_json ? JSON.parse(row.raw_json) : null;
      } catch {
        raw = null;
      }
      let aliases = [];
      try {
        aliases = JSON.parse(row.aliases_json ?? "[]");
      } catch {
        aliases = [];
      }
      return {
        ...(raw && typeof raw === "object" ? raw : {}),
        apiName: row.api_name,
        zhName: row.zh_name ?? raw?.zhName ?? null,
        category: row.category,
        current: Boolean(row.current),
        obtainable: Boolean(row.obtainable),
        patch: row.patch,
        aliases: Array.isArray(aliases) ? aliases : []
      };
    });
    const updatedAt = rows.reduce((latest, row) => (
      !latest || row.updated_at > latest ? row.updated_at : latest
    ), null);
    return {
      value: {
        patch: normalizedPatch,
        items
      },
      updatedAt,
      expiresAt: null,
      expired: false
    };
  }

  setItemCatalog(patch = "current", items = []) {
    const normalizedPatch = String(patch || "current");
    const updatedAt = new Date(this.now()).toISOString();
    bindRun(this.database.prepare("DELETE FROM item_catalog WHERE patch = ?"), [normalizedPatch]);
    const statement = this.database.prepare(`
      INSERT INTO item_catalog (
        api_name, zh_name, category, current, obtainable, patch, aliases_json, raw_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(api_name) DO UPDATE SET
        zh_name = excluded.zh_name,
        category = excluded.category,
        current = excluded.current,
        obtainable = excluded.obtainable,
        patch = excluded.patch,
        aliases_json = excluded.aliases_json,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `);
    const normalizedItems = [];

    for (const item of Array.isArray(items) ? items : []) {
      const apiName = String(item?.apiName ?? item?.api_name ?? "").trim();
      if (!apiName) continue;
      const normalized = {
        ...cloneValue(item),
        apiName,
        patch: normalizedPatch
      };
      normalizedItems.push(normalized);
      bindRun(statement, [
        apiName,
        normalized.zhName ?? normalized.zh_name ?? null,
        String(normalized.category ?? "unknown"),
        normalized.current === false ? 0 : 1,
        normalized.obtainable === false ? 0 : 1,
        normalizedPatch,
        JSON.stringify(Array.isArray(normalized.aliases) ? normalized.aliases : []),
        JSON.stringify(normalized),
        updatedAt
      ]);
    }

    return {
      value: {
        patch: normalizedPatch,
        items: normalizedItems
      },
      updatedAt,
      expiresAt: null,
      expired: false
    };
  }

  clearItemCatalog(patch) {
    const statement = patch === undefined || patch === null
      ? this.database.prepare("DELETE FROM item_catalog")
      : this.database.prepare("DELETE FROM item_catalog WHERE patch = ?");
    const params = patch === undefined || patch === null ? [] : [String(patch)];
    return Number(bindRun(statement, params)?.changes ?? 0);
  }

  getDomainCatalog(patch = "current") {
    const normalizedPatch = String(patch || "current");
    const unitRows = bindAll(this.database.prepare(`
      SELECT api_name, zh_name, aliases_json, current, patch, raw_json, updated_at
      FROM units
      WHERE patch = ?
      ORDER BY api_name ASC
    `), [normalizedPatch]);
    const traitRows = bindAll(this.database.prepare(`
      SELECT filter_id, api_name, zh_name, display_name, aliases_json, current, patch, raw_json, updated_at
      FROM traits
      WHERE patch = ?
      ORDER BY filter_id ASC
    `), [normalizedPatch]);
    if (unitRows.length === 0 && traitRows.length === 0) return null;

    const parseAliases = (value) => {
      try {
        const aliases = JSON.parse(value ?? "[]");
        return Array.isArray(aliases) ? aliases : [];
      } catch {
        return [];
      }
    };
    const parseRaw = (value) => {
      try {
        const raw = value ? JSON.parse(value) : null;
        return raw && typeof raw === "object" ? raw : {};
      } catch {
        return {};
      }
    };
    const units = unitRows.map((row) => ({
      ...parseRaw(row.raw_json),
      apiName: row.api_name,
      zhName: row.zh_name ?? null,
      aliases: parseAliases(row.aliases_json),
      current: Boolean(row.current),
      patch: row.patch
    }));
    const traits = traitRows.map((row) => ({
      ...parseRaw(row.raw_json),
      filterId: row.filter_id,
      apiName: row.api_name,
      zhName: row.zh_name ?? null,
      displayName: row.display_name ?? row.zh_name ?? row.api_name,
      aliases: parseAliases(row.aliases_json),
      current: Boolean(row.current),
      patch: row.patch
    }));
    const updatedAt = [...unitRows, ...traitRows].reduce((latest, row) => (
      !latest || row.updated_at > latest ? row.updated_at : latest
    ), null);
    return {
      value: {
        patch: normalizedPatch,
        units,
        traits
      },
      updatedAt,
      expiresAt: null,
      expired: false
    };
  }

  setDomainCatalog(patch = "current", value = {}) {
    const normalizedPatch = String(patch || "current");
    const updatedAt = new Date(this.now()).toISOString();
    bindRun(this.database.prepare("DELETE FROM units WHERE patch = ?"), [normalizedPatch]);
    bindRun(this.database.prepare("DELETE FROM traits WHERE patch = ?"), [normalizedPatch]);
    const unitStatement = this.database.prepare(`
      INSERT INTO units (api_name, zh_name, aliases_json, current, patch, raw_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(api_name) DO UPDATE SET
        zh_name = excluded.zh_name,
        aliases_json = excluded.aliases_json,
        current = excluded.current,
        patch = excluded.patch,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `);
    const traitStatement = this.database.prepare(`
      INSERT INTO traits (filter_id, api_name, zh_name, display_name, aliases_json, current, patch, raw_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(filter_id) DO UPDATE SET
        api_name = excluded.api_name,
        zh_name = excluded.zh_name,
        display_name = excluded.display_name,
        aliases_json = excluded.aliases_json,
        current = excluded.current,
        patch = excluded.patch,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `);
    const units = [];
    const traits = [];

    for (const unit of Array.isArray(value.units) ? value.units : []) {
      const apiName = String(unit?.apiName ?? unit?.api_name ?? "").trim();
      if (!apiName) continue;
      const normalized = { ...cloneValue(unit), apiName, patch: normalizedPatch };
      units.push(normalized);
      bindRun(unitStatement, [
        apiName,
        normalized.zhName ?? normalized.zh_name ?? null,
        JSON.stringify(Array.isArray(normalized.aliases) ? normalized.aliases : []),
        normalized.current === false ? 0 : 1,
        normalizedPatch,
        JSON.stringify(normalized),
        updatedAt
      ]);
    }

    for (const trait of Array.isArray(value.traits) ? value.traits : []) {
      const filterId = String(trait?.filterId ?? trait?.filter_id ?? "").trim();
      const apiName = String(trait?.apiName ?? trait?.api_name ?? "").trim();
      if (!filterId || !apiName) continue;
      const normalized = { ...cloneValue(trait), filterId, apiName, patch: normalizedPatch };
      traits.push(normalized);
      bindRun(traitStatement, [
        filterId,
        apiName,
        normalized.zhName ?? normalized.zh_name ?? null,
        normalized.displayName ?? normalized.display_name ?? null,
        JSON.stringify(Array.isArray(normalized.aliases) ? normalized.aliases : []),
        normalized.current === false ? 0 : 1,
        normalizedPatch,
        JSON.stringify(normalized),
        updatedAt
      ]);
    }

    return {
      value: {
        patch: normalizedPatch,
        units,
        traits
      },
      updatedAt,
      expiresAt: null,
      expired: false
    };
  }

  clearDomainCatalog(patch) {
    const params = patch === undefined || patch === null ? [] : [String(patch)];
    const where = params.length ? " WHERE patch = ?" : "";
    const units = Number(bindRun(this.database.prepare(`DELETE FROM units${where}`), params)?.changes ?? 0);
    const traits = Number(bindRun(this.database.prepare(`DELETE FROM traits${where}`), params)?.changes ?? 0);
    return { units, traits };
  }

  addEntityAlias(record = {}) {
    const nowMs = this.now();
    const alias = String(record.alias ?? "").trim();
    const entityType = String(record.entityType ?? record.entity_type ?? "").trim();
    const apiName = String(record.apiName ?? record.api_name ?? "").trim();
    if (!alias || !entityType || !apiName) {
      throw new Error("addEntityAlias requires alias, entityType, and apiName");
    }

    const updatedAt = record.updatedAt ?? record.updated_at ?? new Date(nowMs).toISOString();
    const value = {
      alias,
      normalizedAlias: record.normalizedAlias ?? record.normalized_alias ?? normalizeAliasValue(alias),
      entityType,
      apiName,
      confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : 0.5,
      source: String(record.source ?? "candidate"),
      patch: record.patch ?? null,
      enabled: record.enabled ?? true,
      updatedAt
    };
    const result = bindRun(this.database.prepare(`
      INSERT INTO entity_aliases (
        alias, normalized_alias, entity_type, api_name, confidence, source, patch, enabled, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `), [
      value.alias,
      value.normalizedAlias,
      value.entityType,
      value.apiName,
      value.confidence,
      value.source,
      value.patch,
      value.enabled ? 1 : 0,
      value.updatedAt
    ]);

    return {
      id: Number(result?.lastInsertRowid ?? result?.lastID ?? 0) || null,
      ...value
    };
  }

  getEntityAlias(id) {
    const row = bindGet(this.database.prepare(`
      SELECT id, alias, normalized_alias, entity_type, api_name, confidence, source, patch, enabled, updated_at
      FROM entity_aliases
      WHERE id = ?
    `), [Number(id)]);
    return row ? rowToEntityAlias(row) : null;
  }

  setEntityAliasEnabled(id, enabled) {
    const updatedAt = new Date(this.now()).toISOString();
    bindRun(this.database.prepare(`
      UPDATE entity_aliases
      SET enabled = ?, updated_at = ?
      WHERE id = ?
    `), [
      enabled ? 1 : 0,
      updatedAt,
      Number(id)
    ]);
    return this.getEntityAlias(id);
  }

  listEntityAliases(options = {}) {
    const limit = positiveInteger(options.limit, 100);
    const offset = nonNegativeInteger(options.offset, 0);
    const clauses = [];
    const params = [];

    if (options.entityType) {
      clauses.push("entity_type = ?");
      params.push(options.entityType);
    }
    if (options.apiName) {
      clauses.push("api_name = ?");
      params.push(options.apiName);
    }
    if (options.patch) {
      clauses.push("patch = ?");
      params.push(options.patch);
    }
    if (options.enabled !== undefined) {
      clauses.push("enabled = ?");
      params.push(options.enabled ? 1 : 0);
    }
    if (options.minConfidence !== undefined) {
      clauses.push("confidence >= ?");
      params.push(Number(options.minConfidence));
    }
    if (options.normalizedAlias) {
      clauses.push("normalized_alias = ?");
      params.push(options.normalizedAlias);
    }
    if (options.query) {
      clauses.push(`(
        lower(alias) LIKE ? OR
        lower(normalized_alias) LIKE ? OR
        lower(entity_type) LIKE ? OR
        lower(api_name) LIKE ? OR
        lower(source) LIKE ?
      )`);
      const pattern = `%${String(options.query).trim().toLowerCase()}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }

    params.push(limit, offset);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = bindAll(this.database.prepare(`
      SELECT id, alias, normalized_alias, entity_type, api_name, confidence, source, patch, enabled, updated_at
      FROM entity_aliases
      ${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `), params);
    return rows.map(rowToEntityAlias);
  }

  findEntityAliases(alias, options = {}) {
    const normalizedAlias = normalizeAliasValue(alias);
    const limit = positiveInteger(options.limit, 20);
    const entityTypeClause = options.entityType ? "AND entity_type = ?" : "";
    const params = [normalizedAlias, options.enabled === undefined ? 1 : (options.enabled ? 1 : 0)];
    if (options.entityType) params.push(options.entityType);
    params.push(limit);
    const rows = bindAll(this.database.prepare(`
      SELECT id, alias, normalized_alias, entity_type, api_name, confidence, source, patch, enabled, updated_at
      FROM entity_aliases
      WHERE normalized_alias = ? AND enabled = ? ${entityTypeClause}
      ORDER BY confidence DESC, id DESC
      LIMIT ?
    `), params);
    return rows.map(rowToEntityAlias);
  }

  clearEntityAliases(options = {}) {
    if (options.enabled === undefined) {
      return Number(bindRun(this.database.prepare("DELETE FROM entity_aliases"))?.changes ?? 0);
    }
    return Number(bindRun(this.database.prepare("DELETE FROM entity_aliases WHERE enabled = ?"), [
      options.enabled ? 1 : 0
    ])?.changes ?? 0);
  }

  addFeedbackEvent(feedbackType, payload = {}, options = {}) {
    const type = String(feedbackType ?? "").trim();
    if (!type) throw new Error("addFeedbackEvent requires feedbackType");

    const createdAt = options.createdAt ?? new Date(this.now()).toISOString();
    const status = String(options.status ?? "pending");
    const result = bindRun(this.database.prepare(`
      INSERT INTO feedback_events (feedback_type, payload_json, status, created_at)
      VALUES (?, ?, ?, ?)
    `), [
      type,
      JSON.stringify(cloneValue(payload)),
      status,
      createdAt
    ]);

    return {
      id: Number(result?.lastInsertRowid ?? result?.lastID ?? 0) || null,
      feedbackType: type,
      payload: cloneValue(payload),
      status,
      createdAt
    };
  }

  listFeedbackEvents(options = {}) {
    const limit = positiveInteger(options.limit, 100);
    const rows = bindAll(this.database.prepare(`
      SELECT id, feedback_type, payload_json, status, created_at
      FROM feedback_events
      ORDER BY id DESC
      LIMIT ?
    `), [limit]);
    return rows
      .map(rowToFeedbackEvent)
      .filter((entry) => {
        if (options.feedbackType && entry.feedbackType !== options.feedbackType) return false;
        if (options.status && entry.status !== options.status) return false;
        return true;
      });
  }

  findFeedbackEventByFeedbackId(feedbackId) {
    const id = String(feedbackId ?? "");
    if (!id) return null;
    const rows = bindAll(this.database.prepare(`
      SELECT id, feedback_type, payload_json, status, created_at
      FROM feedback_events
      ORDER BY id DESC
    `));
    for (const row of rows) {
      const entry = rowToFeedbackEvent(row);
      if (entry?.payload?.feedbackId === id) return entry;
    }
    return null;
  }

  clearFeedbackEvents(options = {}) {
    const clauses = [];
    const params = [];
    if (options.feedbackType) {
      clauses.push("feedback_type = ?");
      params.push(String(options.feedbackType));
    }
    if (options.status) {
      clauses.push("status = ?");
      params.push(String(options.status));
    }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    return Number(bindRun(this.database.prepare(`DELETE FROM feedback_events${where}`), params)?.changes ?? 0);
  }

  clearQueryCache() {
    return this._clearStore("query");
  }

  clearDefaultContextCache() {
    return this._clearStore("defaultContext");
  }

  clearSessionState() {
    return this._clearStore("session");
  }

  clearQueryHistory() {
    return {
      queryCache: this.clearQueryCache(),
      defaultContextCache: this.clearDefaultContextCache(),
      sessionState: this.clearSessionState()
    };
  }

  clearTransient() {
    return this.clearQueryHistory();
  }

  clearExpired() {
    const now = new Date(this.now()).toISOString();
    for (const store of ["query", "defaultContext", "session"]) {
      const config = STORE_TABLES[store];
      bindRun(
        this.database.prepare(`DELETE FROM ${config.table} WHERE expires_at IS NOT NULL AND expires_at <= ?`),
        [now]
      );
    }
  }

  clear() {
    for (const config of Object.values(STORE_TABLES)) {
      bindRun(this.database.prepare(`DELETE FROM ${config.table}`));
    }
    bindRun(this.database.prepare("DELETE FROM entity_aliases"));
    bindRun(this.database.prepare("DELETE FROM item_catalog"));
    bindRun(this.database.prepare("DELETE FROM units"));
    bindRun(this.database.prepare("DELETE FROM traits"));
    bindRun(this.database.prepare("DELETE FROM feedback_events"));
  }
}
