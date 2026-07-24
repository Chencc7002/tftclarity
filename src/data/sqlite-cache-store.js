import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CACHE_TTL_MS } from "./cache-store.js";
import {
  DEFAULT_SEASON_CONTEXT_ID,
  normalizeSeasonContextId
} from "../season/season-context.js";

export const SQLITE_CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS user_preferences (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_state (
  season_context_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (season_context_id, key)
);

CREATE TABLE IF NOT EXISTS query_cache (
  season_context_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  request_json TEXT,
  response_json TEXT,
  computed_json TEXT,
  source TEXT NOT NULL DEFAULT 'metatft',
  patch TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (season_context_id, cache_key)
);

CREATE TABLE IF NOT EXISTS default_context_cache (
  season_context_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
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
  updated_at TEXT NOT NULL,
  PRIMARY KEY (season_context_id, cache_key)
);

CREATE TABLE IF NOT EXISTS comp_trend_history (
  season_context_id TEXT NOT NULL,
  history_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (season_context_id, history_key)
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_context_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  api_name TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  patch TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_entity_aliases_lookup
ON entity_aliases(season_context_id, normalized_alias, entity_type, enabled);

CREATE INDEX IF NOT EXISTS idx_query_cache_expiry
ON query_cache(season_context_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_default_context_unit
ON default_context_cache(season_context_id, unit, patch, queue, expires_at);

CREATE TABLE IF NOT EXISTS item_catalog (
  season_context_id TEXT NOT NULL,
  api_name TEXT NOT NULL,
  zh_name TEXT,
  category TEXT NOT NULL,
  current INTEGER NOT NULL,
  obtainable INTEGER NOT NULL,
  patch TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  raw_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (season_context_id, api_name)
);

CREATE INDEX IF NOT EXISTS idx_item_catalog_policy
ON item_catalog(season_context_id, category, current, obtainable, patch);

CREATE TABLE IF NOT EXISTS units (
  season_context_id TEXT NOT NULL,
  api_name TEXT NOT NULL,
  zh_name TEXT,
  aliases_json TEXT NOT NULL,
  current INTEGER NOT NULL,
  patch TEXT NOT NULL,
  raw_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (season_context_id, api_name)
);

CREATE INDEX IF NOT EXISTS idx_units_patch
ON units(season_context_id, patch, current);

CREATE TABLE IF NOT EXISTS traits (
  season_context_id TEXT NOT NULL,
  filter_id TEXT NOT NULL,
  api_name TEXT NOT NULL,
  zh_name TEXT,
  display_name TEXT,
  aliases_json TEXT NOT NULL,
  current INTEGER NOT NULL,
  patch TEXT NOT NULL,
  raw_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (season_context_id, filter_id)
);

CREATE INDEX IF NOT EXISTS idx_traits_patch
ON traits(season_context_id, patch, current);

CREATE TABLE IF NOT EXISTS query_events (
  query_id TEXT PRIMARY KEY,
  run_id TEXT,
  season_context_id TEXT NOT NULL,
  visitor_scope TEXT NOT NULL,
  conversation_id TEXT,
  input TEXT NOT NULL,
  result_type TEXT,
  query_json TEXT,
  response_json TEXT,
  patch TEXT,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  cache_stale INTEGER NOT NULL DEFAULT 0,
  llm_used INTEGER NOT NULL DEFAULT 0,
  llm_model TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_query_events_visitor
ON query_events(season_context_id, visitor_scope, created_at);

CREATE INDEX IF NOT EXISTS idx_query_events_created
ON query_events(created_at);

CREATE TABLE IF NOT EXISTS feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_context_id TEXT NOT NULL,
  feedback_id TEXT NOT NULL UNIQUE,
  query_id TEXT,
  visitor_scope TEXT,
  feedback_target TEXT,
  feedback_type TEXT NOT NULL,
  rating TEXT,
  card_index INTEGER,
  reason TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (query_id) REFERENCES query_events(query_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_context_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  actor TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_scope
ON admin_audit_events(season_context_id, created_at);

CREATE TABLE IF NOT EXISTS comp_profiles (
  season_context_id TEXT NOT NULL,
  profile_key TEXT NOT NULL,
  difficulty INTEGER,
  beginner_friendly INTEGER,
  pivot_difficulty INTEGER,
  position_difficulty INTEGER,
  contest_tolerance INTEGER,
  econ_difficulty INTEGER,
  notes_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (season_context_id, profile_key)
);

CREATE TABLE IF NOT EXISTS comp_profile_bindings (
  season_context_id TEXT NOT NULL,
  profile_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  lineup_signature TEXT NOT NULL,
  signature_version TEXT NOT NULL,
  strategy_override TEXT,
  match_confidence REAL NOT NULL,
  match_status TEXT NOT NULL,
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (season_context_id, profile_key, provider),
  FOREIGN KEY (season_context_id, profile_key)
    REFERENCES comp_profiles(season_context_id, profile_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comp_profile_bindings_lookup
ON comp_profile_bindings(season_context_id, provider, cluster_id, lineup_signature, match_status);

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

function tableColumns(database, table) {
  try {
    return bindAll(database.prepare(`PRAGMA table_info(${table})`));
  } catch {
    return [];
  }
}

function rebuildSeasonScopedTable(database, table, createSql, columns) {
  if (!tableColumns(database, table).length) return;
  if (tableColumns(database, table).some((column) => column.name === "season_context_id")) return;
  const migrated = `${table}__season_migration`;
  database.exec(`
    BEGIN IMMEDIATE;
    DROP TABLE IF EXISTS ${migrated};
    ${createSql.replaceAll(table, migrated)}
    INSERT INTO ${migrated} (season_context_id, ${columns.join(", ")})
    SELECT '${DEFAULT_SEASON_CONTEXT_ID}', ${columns.join(", ")} FROM ${table};
    DROP TABLE ${table};
    ALTER TABLE ${migrated} RENAME TO ${table};
    COMMIT;
  `);
}

function addSeasonColumn(database, table) {
  const columns = tableColumns(database, table);
  if (!columns.length || columns.some((column) => column.name === "season_context_id")) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN season_context_id TEXT NOT NULL DEFAULT '${DEFAULT_SEASON_CONTEXT_ID}'`);
}

export function migrateSQLiteSeasonContextSchema(database) {
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    rebuildSeasonScopedTable(database, "session_state", `
      CREATE TABLE session_state (
        season_context_id TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL,
        expires_at TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (season_context_id, key)
      );
    `, ["key", "value_json", "expires_at", "updated_at"]);
    rebuildSeasonScopedTable(database, "query_cache", `
      CREATE TABLE query_cache (
        season_context_id TEXT NOT NULL, cache_key TEXT NOT NULL, value_json TEXT NOT NULL,
        request_json TEXT, response_json TEXT, computed_json TEXT,
        source TEXT NOT NULL DEFAULT 'metatft', patch TEXT, expires_at TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (season_context_id, cache_key)
      );
    `, ["cache_key", "value_json", "request_json", "response_json", "computed_json", "source", "patch", "expires_at", "updated_at"]);
    rebuildSeasonScopedTable(database, "default_context_cache", `
      CREATE TABLE default_context_cache (
        season_context_id TEXT NOT NULL, cache_key TEXT NOT NULL, unit TEXT, cluster_id TEXT,
        comp_name TEXT, units_json TEXT, traits_json TEXT, value_json TEXT NOT NULL,
        source_endpoint TEXT, rank TEXT, days INTEGER, patch TEXT, queue TEXT,
        score REAL, count INTEGER, avg REAL, expires_at TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (season_context_id, cache_key)
      );
    `, ["cache_key", "unit", "cluster_id", "comp_name", "units_json", "traits_json", "value_json", "source_endpoint", "rank", "days", "patch", "queue", "score", "count", "avg", "expires_at", "updated_at"]);
    rebuildSeasonScopedTable(database, "comp_trend_history", `
      CREATE TABLE comp_trend_history (
        season_context_id TEXT NOT NULL, history_key TEXT NOT NULL, value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY (season_context_id, history_key)
      );
    `, ["history_key", "value_json", "updated_at"]);
    rebuildSeasonScopedTable(database, "item_catalog", `
      CREATE TABLE item_catalog (
        season_context_id TEXT NOT NULL, api_name TEXT NOT NULL, zh_name TEXT, category TEXT NOT NULL,
        current INTEGER NOT NULL, obtainable INTEGER NOT NULL, patch TEXT NOT NULL,
        aliases_json TEXT NOT NULL, raw_json TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (season_context_id, api_name)
      );
    `, ["api_name", "zh_name", "category", "current", "obtainable", "patch", "aliases_json", "raw_json", "updated_at"]);
    rebuildSeasonScopedTable(database, "units", `
      CREATE TABLE units (
        season_context_id TEXT NOT NULL, api_name TEXT NOT NULL, zh_name TEXT,
        aliases_json TEXT NOT NULL, current INTEGER NOT NULL, patch TEXT NOT NULL,
        raw_json TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (season_context_id, api_name)
      );
    `, ["api_name", "zh_name", "aliases_json", "current", "patch", "raw_json", "updated_at"]);
    rebuildSeasonScopedTable(database, "traits", `
      CREATE TABLE traits (
        season_context_id TEXT NOT NULL, filter_id TEXT NOT NULL, api_name TEXT NOT NULL,
        zh_name TEXT, display_name TEXT, aliases_json TEXT NOT NULL, current INTEGER NOT NULL,
        patch TEXT NOT NULL, raw_json TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (season_context_id, filter_id)
      );
    `, ["filter_id", "api_name", "zh_name", "display_name", "aliases_json", "current", "patch", "raw_json", "updated_at"]);
    addSeasonColumn(database, "entity_aliases");
    addSeasonColumn(database, "query_events");
    addSeasonColumn(database, "feedback_events");
    database.exec(`
      DROP INDEX IF EXISTS idx_entity_aliases_lookup;
      DROP INDEX IF EXISTS idx_query_events_visitor;
    `);
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // No transaction is active when a non-rebuild ALTER failed.
    }
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

function ensureFeedbackSchema(database) {
  const columns = [
    ["feedback_id", "TEXT"],
    ["query_id", "TEXT"],
    ["visitor_scope", "TEXT"],
    ["feedback_target", "TEXT"],
    ["rating", "TEXT"],
    ["card_index", "INTEGER"],
    ["reason", "TEXT"],
    ["updated_at", "TEXT"]
  ];
  for (const [name, type] of columns) {
    try {
      database.exec(`ALTER TABLE feedback_events ADD COLUMN ${name} ${type}`);
    } catch (error) {
      if (!/duplicate column|already exists/iu.test(String(error?.message ?? error))) throw error;
    }
  }
  database.exec(`
    UPDATE feedback_events
    SET feedback_id = json_extract(payload_json, '$.feedbackId')
    WHERE feedback_id IS NULL AND json_valid(payload_json);
    UPDATE feedback_events
    SET feedback_id = 'legacy:' || id
    WHERE feedback_id IS NOT NULL
      AND id NOT IN (
        SELECT MIN(id) FROM feedback_events
        WHERE feedback_id IS NOT NULL
        GROUP BY feedback_id
      );
    UPDATE feedback_events
    SET feedback_id = 'legacy:' || id
    WHERE feedback_id IS NULL OR TRIM(feedback_id) = '';
    UPDATE feedback_events SET updated_at = created_at WHERE updated_at IS NULL;
    DROP INDEX IF EXISTS idx_feedback_id_unique;
    CREATE UNIQUE INDEX idx_feedback_id_unique
    ON feedback_events(feedback_id);
    CREATE TRIGGER IF NOT EXISTS feedback_id_required_insert
    BEFORE INSERT ON feedback_events
    WHEN NEW.feedback_id IS NULL OR TRIM(NEW.feedback_id) = ''
    BEGIN
      SELECT RAISE(ABORT, 'feedback_id is required');
    END;
    CREATE TRIGGER IF NOT EXISTS feedback_id_required_update
    BEFORE UPDATE OF feedback_id ON feedback_events
    WHEN NEW.feedback_id IS NULL OR TRIM(NEW.feedback_id) = ''
    BEGIN
      SELECT RAISE(ABORT, 'feedback_id is required');
    END;
    CREATE INDEX IF NOT EXISTS idx_feedback_query
    ON feedback_events(query_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_visitor
    ON feedback_events(visitor_scope, created_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_type
    ON feedback_events(feedback_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_created
    ON feedback_events(created_at);
  `);
}

function ensureQueryEventSchema(database) {
  try {
    database.exec("ALTER TABLE query_events ADD COLUMN run_id TEXT");
  } catch (error) {
    if (!/duplicate column|already exists/iu.test(String(error?.message ?? error))) throw error;
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_query_events_run
    ON query_events(run_id);
  `);
}

function ensureEntityAliasAuditSchema(database) {
  for (const [name, type] of [["created_at", "TEXT"], ["updated_by", "TEXT"]]) {
    try {
      database.exec(`ALTER TABLE entity_aliases ADD COLUMN ${name} ${type}`);
    } catch (error) {
      if (!/duplicate column|already exists/iu.test(String(error?.message ?? error))) throw error;
    }
  }
  database.exec(`
    UPDATE entity_aliases SET created_at = updated_at WHERE created_at IS NULL;
    UPDATE entity_aliases SET updated_by = 'legacy_migration' WHERE updated_by IS NULL OR TRIM(updated_by) = '';
  `);
}

function ensureCompProfileSchema(database) {
  try {
    database.exec("ALTER TABLE comp_profile_bindings ADD COLUMN signature_version TEXT");
  } catch (error) {
    if (!/duplicate column|already exists/iu.test(String(error?.message ?? error))) throw error;
  }
  try {
    database.exec("ALTER TABLE comp_profile_bindings ADD COLUMN strategy_override TEXT");
  } catch (error) {
    if (!/duplicate column|already exists/iu.test(String(error?.message ?? error))) throw error;
  }
  database.exec(`
    UPDATE comp_profile_bindings
    SET signature_version = 'lineup-signature-v1'
    WHERE signature_version IS NULL OR TRIM(signature_version) = '';
  `);
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
    seasonContextId: normalizeSeasonContextId(row.season_context_id),
    alias: row.alias,
    normalizedAlias: row.normalized_alias,
    entityType: row.entity_type,
    apiName: row.api_name,
    confidence: row.confidence,
    source: row.source,
    patch: row.patch,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at ?? row.updated_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? "system"
  };
}

function rowToFeedbackEvent(row) {
  return {
    id: row.id,
    seasonContextId: normalizeSeasonContextId(row.season_context_id),
    feedbackId: row.feedback_id ?? null,
    queryId: row.query_id ?? null,
    visitorScope: row.visitor_scope ?? null,
    feedbackTarget: row.feedback_target ?? null,
    feedbackType: row.feedback_type,
    rating: row.rating ?? null,
    cardIndex: Number.isInteger(row.card_index) ? row.card_index : null,
    reason: row.reason ?? null,
    payload: JSON.parse(row.payload_json ?? "{}"),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at
  };
}

function rowToQueryEvent(row) {
  return {
    queryId: row.query_id,
    runId: row.run_id ?? null,
    seasonContextId: normalizeSeasonContextId(row.season_context_id),
    visitorScope: row.visitor_scope,
    conversationId: row.conversation_id ?? null,
    input: row.input,
    resultType: row.result_type ?? null,
    query: row.query_json ? JSON.parse(row.query_json) : null,
    response: row.response_json ? JSON.parse(row.response_json) : null,
    patch: row.patch ?? null,
    cacheHit: Boolean(row.cache_hit),
    cacheStale: Boolean(row.cache_stale),
    llmUsed: Boolean(row.llm_used),
    llmModel: row.llm_model ?? null,
    durationMs: Number.isFinite(row.duration_ms) ? row.duration_ms : null,
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
    migrateSQLiteSeasonContextSchema(this.database);
    this.database.exec(SQLITE_CACHE_SCHEMA);
    ensureQueryEventSchema(this.database);
    ensureEntityAliasAuditSchema(this.database);
    ensureCompProfileSchema(this.database);
    ensureFeedbackSchema(this.database);
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
      `SELECT value_json, updated_at, expires_at FROM ${config.table} WHERE season_context_id = ? AND ${config.keyColumn} = ?`
    );
    const row = bindGet(statement, [normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id), key]);
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
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);

    if (store === "query") {
      const extra = extractQueryColumns(value);
      bindRun(this.database.prepare(`
        INSERT INTO query_cache (
          season_context_id, cache_key, value_json, request_json, response_json, computed_json, source, patch, expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(season_context_id, cache_key) DO UPDATE SET
          value_json = excluded.value_json,
          request_json = excluded.request_json,
          response_json = excluded.response_json,
          computed_json = excluded.computed_json,
          source = excluded.source,
          patch = excluded.patch,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `), [
        seasonContextId,
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
          season_context_id, cache_key, unit, cluster_id, comp_name, units_json, traits_json, value_json,
          source_endpoint, rank, days, patch, queue, score, count, avg, expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(season_context_id, cache_key) DO UPDATE SET
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
        seasonContextId,
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
        INSERT INTO ${config.table} (season_context_id, ${config.keyColumn}, value_json, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(season_context_id, ${config.keyColumn}) DO UPDATE SET
          value_json = excluded.value_json,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `), [seasonContextId, key, valueJson, entryExpiresAt, updatedAt]);
    }

    return entryValue({
      value,
      updatedAt,
      expiresAt: entryExpiresAt
    }, nowMs);
  }

  _delete(store, key, options = {}) {
    const config = STORE_TABLES[store];
    const result = bindRun(
      this.database.prepare(store === "preference"
        ? `DELETE FROM ${config.table} WHERE ${config.keyColumn} = ?`
        : `DELETE FROM ${config.table} WHERE season_context_id = ? AND ${config.keyColumn} = ?`),
      store === "preference" ? [key] : [normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id), key]
    );
    return Boolean(result?.changes ?? result?.changes === undefined);
  }

  _clearStore(store, options = {}) {
    const config = STORE_TABLES[store];
    const result = options.all === true
      ? bindRun(this.database.prepare(`DELETE FROM ${config.table}`))
      : bindRun(
        this.database.prepare(`DELETE FROM ${config.table} WHERE season_context_id = ?`),
        [normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id)]
      );
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

  deleteSessionState(key, options = {}) {
    return this._delete("session", key, options);
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

  getItemCatalog(patch = "current", options = {}) {
    const normalizedPatch = String(patch || "current");
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    const rows = bindAll(this.database.prepare(`
      SELECT api_name, zh_name, category, current, obtainable, patch, aliases_json, raw_json, updated_at
      FROM item_catalog
      WHERE season_context_id = ? AND patch = ?
      ORDER BY api_name ASC
    `), [seasonContextId, normalizedPatch]);
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
        seasonContextId,
        patch: normalizedPatch,
        items
      },
      updatedAt,
      expiresAt: null,
      expired: false
    };
  }

  setItemCatalog(patch = "current", items = [], options = {}) {
    const normalizedPatch = String(patch || "current");
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    const updatedAt = new Date(this.now()).toISOString();
    bindRun(this.database.prepare("DELETE FROM item_catalog WHERE season_context_id = ? AND patch = ?"), [seasonContextId, normalizedPatch]);
    const statement = this.database.prepare(`
      INSERT INTO item_catalog (
        season_context_id, api_name, zh_name, category, current, obtainable, patch, aliases_json, raw_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(season_context_id, api_name) DO UPDATE SET
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
        seasonContextId,
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
        seasonContextId,
        patch: normalizedPatch,
        items: normalizedItems
      },
      updatedAt,
      expiresAt: null,
      expired: false
    };
  }

  clearItemCatalog(patch, options = {}) {
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    const statement = patch === undefined || patch === null
      ? this.database.prepare("DELETE FROM item_catalog WHERE season_context_id = ?")
      : this.database.prepare("DELETE FROM item_catalog WHERE season_context_id = ? AND patch = ?");
    const params = patch === undefined || patch === null ? [seasonContextId] : [seasonContextId, String(patch)];
    return Number(bindRun(statement, params)?.changes ?? 0);
  }

  getDomainCatalog(patch = "current", options = {}) {
    const normalizedPatch = String(patch || "current");
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    const unitRows = bindAll(this.database.prepare(`
      SELECT api_name, zh_name, aliases_json, current, patch, raw_json, updated_at
      FROM units
      WHERE season_context_id = ? AND patch = ?
      ORDER BY api_name ASC
    `), [seasonContextId, normalizedPatch]);
    const traitRows = bindAll(this.database.prepare(`
      SELECT filter_id, api_name, zh_name, display_name, aliases_json, current, patch, raw_json, updated_at
      FROM traits
      WHERE season_context_id = ? AND patch = ?
      ORDER BY filter_id ASC
    `), [seasonContextId, normalizedPatch]);
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
        seasonContextId,
        patch: normalizedPatch,
        units,
        traits
      },
      updatedAt,
      expiresAt: null,
      expired: false
    };
  }

  setDomainCatalog(patch = "current", value = {}, options = {}) {
    const normalizedPatch = String(patch || "current");
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    const updatedAt = new Date(this.now()).toISOString();
    bindRun(this.database.prepare("DELETE FROM units WHERE season_context_id = ? AND patch = ?"), [seasonContextId, normalizedPatch]);
    bindRun(this.database.prepare("DELETE FROM traits WHERE season_context_id = ? AND patch = ?"), [seasonContextId, normalizedPatch]);
    const unitStatement = this.database.prepare(`
      INSERT INTO units (season_context_id, api_name, zh_name, aliases_json, current, patch, raw_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(season_context_id, api_name) DO UPDATE SET
        zh_name = excluded.zh_name,
        aliases_json = excluded.aliases_json,
        current = excluded.current,
        patch = excluded.patch,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `);
    const traitStatement = this.database.prepare(`
      INSERT INTO traits (season_context_id, filter_id, api_name, zh_name, display_name, aliases_json, current, patch, raw_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(season_context_id, filter_id) DO UPDATE SET
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
        seasonContextId,
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
        seasonContextId,
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
        seasonContextId,
        patch: normalizedPatch,
        units,
        traits
      },
      updatedAt,
      expiresAt: null,
      expired: false
    };
  }

  clearDomainCatalog(patch, options = {}) {
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    const params = patch === undefined || patch === null ? [seasonContextId] : [seasonContextId, String(patch)];
    const where = patch === undefined || patch === null
      ? " WHERE season_context_id = ?"
      : " WHERE season_context_id = ? AND patch = ?";
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
    const createdAt = record.createdAt ?? record.created_at ?? updatedAt;
    const updatedBy = String(record.updatedBy ?? record.updated_by ?? "system");
    const seasonContextId = normalizeSeasonContextId(record.seasonContextId ?? record.season_context_id);
    const value = {
      seasonContextId,
      alias,
      normalizedAlias: record.normalizedAlias ?? record.normalized_alias ?? normalizeAliasValue(alias),
      entityType,
      apiName,
      confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : 0.5,
      source: String(record.source ?? "candidate"),
      patch: record.patch ?? null,
      enabled: record.enabled ?? true,
      createdAt,
      updatedAt,
      updatedBy
    };
    const result = bindRun(this.database.prepare(`
      INSERT INTO entity_aliases (
        season_context_id, alias, normalized_alias, entity_type, api_name, confidence, source, patch,
        enabled, created_at, updated_at, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `), [
      seasonContextId,
      value.alias,
      value.normalizedAlias,
      value.entityType,
      value.apiName,
      value.confidence,
      value.source,
      value.patch,
      value.enabled ? 1 : 0,
      value.createdAt,
      value.updatedAt,
      value.updatedBy
    ]);

    return {
      id: Number(result?.lastInsertRowid ?? result?.lastID ?? 0) || null,
      ...value
    };
  }

  getEntityAlias(id, options = {}) {
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    const row = bindGet(this.database.prepare(`
      SELECT id, season_context_id, alias, normalized_alias, entity_type, api_name, confidence, source, patch, enabled, created_at, updated_at, updated_by
      FROM entity_aliases
      WHERE season_context_id = ? AND id = ?
    `), [seasonContextId, Number(id)]);
    return row ? rowToEntityAlias(row) : null;
  }

  setEntityAliasEnabled(id, enabled, options = {}) {
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    const updatedAt = new Date(this.now()).toISOString();
    bindRun(this.database.prepare(`
      UPDATE entity_aliases
      SET enabled = ?, updated_at = ?, updated_by = ?
      WHERE season_context_id = ? AND id = ?
    `), [
      enabled ? 1 : 0,
      updatedAt,
      String(options.updatedBy ?? options.updated_by ?? "admin"),
      seasonContextId,
      Number(id)
    ]);
    return this.getEntityAlias(id, { seasonContextId });
  }

  updateEntityAlias(id, changes = {}, options = {}) {
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    const current = this.getEntityAlias(id, { seasonContextId });
    if (!current) return null;
    const alias = changes.alias === undefined ? current.alias : String(changes.alias).trim();
    const entityType = changes.entityType === undefined ? current.entityType : String(changes.entityType).trim();
    const apiName = changes.apiName === undefined ? current.apiName : String(changes.apiName).trim();
    if (!alias || !entityType || !apiName) throw new Error("Entity alias requires alias, entityType, and apiName");
    bindRun(this.database.prepare(`
      UPDATE entity_aliases SET
        alias = ?, normalized_alias = ?, entity_type = ?, api_name = ?, confidence = ?,
        source = ?, patch = ?, enabled = ?, updated_at = ?, updated_by = ?
      WHERE season_context_id = ? AND id = ?
    `), [
      alias,
      normalizeAliasValue(alias),
      entityType,
      apiName,
      changes.confidence === undefined ? current.confidence : Number(changes.confidence),
      changes.source === undefined ? current.source : String(changes.source),
      changes.patch === undefined ? current.patch : changes.patch,
      changes.enabled === undefined ? (current.enabled ? 1 : 0) : (changes.enabled ? 1 : 0),
      new Date(this.now()).toISOString(),
      String(changes.updatedBy ?? changes.updated_by ?? options.updatedBy ?? "admin"),
      seasonContextId,
      Number(id)
    ]);
    return this.getEntityAlias(id, { seasonContextId });
  }

  deleteEntityAlias(id, options = {}) {
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    const current = this.getEntityAlias(id, { seasonContextId });
    if (!current) return null;
    bindRun(this.database.prepare("DELETE FROM entity_aliases WHERE season_context_id = ? AND id = ?"), [
      seasonContextId,
      Number(id)
    ]);
    return current;
  }

  listEntityAliases(options = {}) {
    const limit = positiveInteger(options.limit, 100);
    const offset = nonNegativeInteger(options.offset, 0);
    const clauses = [];
    const params = [];
    clauses.push("season_context_id = ?");
    params.push(normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id));

    if (options.entityType) {
      clauses.push("entity_type = ?");
      params.push(options.entityType);
    }
    if (options.apiName) {
      clauses.push("api_name = ?");
      params.push(options.apiName);
    }
    if (options.source) {
      clauses.push("source = ?");
      params.push(options.source);
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
      SELECT id, season_context_id, alias, normalized_alias, entity_type, api_name, confidence, source, patch, enabled, created_at, updated_at, updated_by
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
    const params = [
      normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id),
      normalizedAlias,
      options.enabled === undefined ? 1 : (options.enabled ? 1 : 0)
    ];
    if (options.entityType) params.push(options.entityType);
    params.push(limit);
    const rows = bindAll(this.database.prepare(`
      SELECT id, season_context_id, alias, normalized_alias, entity_type, api_name, confidence, source, patch, enabled, created_at, updated_at, updated_by
      FROM entity_aliases
      WHERE season_context_id = ? AND normalized_alias = ? AND enabled = ? ${entityTypeClause}
      ORDER BY confidence DESC, id DESC
      LIMIT ?
    `), params);
    return rows.map(rowToEntityAlias);
  }

  clearEntityAliases(options = {}) {
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    if (options.enabled === undefined) {
      return Number(bindRun(this.database.prepare("DELETE FROM entity_aliases WHERE season_context_id = ?"), [seasonContextId])?.changes ?? 0);
    }
    return Number(bindRun(this.database.prepare("DELETE FROM entity_aliases WHERE season_context_id = ? AND enabled = ?"), [
      seasonContextId,
      options.enabled ? 1 : 0
    ])?.changes ?? 0);
  }

  addQueryEvent(record = {}) {
    const queryId = String(record.queryId ?? record.query_id ?? "").trim();
    const visitorScope = String(record.visitorScope ?? record.visitor_scope ?? "").trim();
    const input = String(record.input ?? "").trim();
    if (!queryId || !visitorScope || !input) {
      throw new Error("addQueryEvent requires queryId, visitorScope, and input");
    }
    const createdAt = record.createdAt ?? record.created_at ?? new Date(this.now()).toISOString();
    const seasonContextId = normalizeSeasonContextId(record.seasonContextId ?? record.season_context_id);
    bindRun(this.database.prepare(`
      INSERT INTO query_events (
        query_id, run_id, season_context_id, visitor_scope, conversation_id, input, result_type,
        query_json, response_json, patch, cache_hit, cache_stale,
        llm_used, llm_model, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `), [
      queryId,
      record.runId ?? record.run_id ?? null,
      seasonContextId,
      visitorScope,
      record.conversationId ?? record.conversation_id ?? null,
      input,
      record.resultType ?? record.result_type ?? null,
      record.query == null ? null : JSON.stringify(cloneValue(record.query)),
      record.response == null ? null : JSON.stringify(cloneValue(record.response)),
      record.patch ?? null,
      (record.cacheHit ?? record.cache_hit) ? 1 : 0,
      (record.cacheStale ?? record.cache_stale) ? 1 : 0,
      (record.llmUsed ?? record.llm_used) ? 1 : 0,
      record.llmModel ?? record.llm_model ?? null,
      Number.isFinite(Number(record.durationMs ?? record.duration_ms))
        ? Number(record.durationMs ?? record.duration_ms)
        : null,
      createdAt
    ]);
    return this.getQueryEvent(queryId);
  }

  getQueryEvent(queryId) {
    const row = bindGet(this.database.prepare(`
      SELECT query_id, run_id, season_context_id, visitor_scope, conversation_id, input, result_type,
             query_json, response_json, patch, cache_hit, cache_stale,
             llm_used, llm_model, duration_ms, created_at
      FROM query_events
      WHERE query_id = ?
    `), [String(queryId ?? "")]);
    return row ? rowToQueryEvent(row) : null;
  }

  updateQueryEventConclusion(queryId, conclusion) {
    const current = this.getQueryEvent(queryId);
    if (!current) return null;
    const response = cloneValue(current.response ?? {});
    response.answer = {
      ...(response.answer ?? {}),
      generatedConclusion: cloneValue(conclusion ?? null)
    };
    bindRun(this.database.prepare(`
      UPDATE query_events
      SET response_json = ?, llm_used = ?, llm_model = ?
      WHERE query_id = ?
    `), [
      JSON.stringify(response),
      conclusion?.status === "generated" ? 1 : 0,
      conclusion?.model ?? current.llmModel ?? null,
      String(queryId ?? "")
    ]);
    return this.getQueryEvent(queryId);
  }

  pruneQueryEventsBefore(createdBefore) {
    return Number(bindRun(this.database.prepare(
      "DELETE FROM query_events WHERE created_at < ?"
    ), [String(createdBefore ?? "")])?.changes ?? 0);
  }

  addFeedbackEvent(feedbackType, payload = {}, options = {}) {
    const type = String(feedbackType ?? "").trim();
    if (!type) throw new Error("addFeedbackEvent requires feedbackType");

    const createdAt = options.createdAt ?? new Date(this.now()).toISOString();
    const updatedAt = options.updatedAt ?? createdAt;
    const feedbackId = String(options.feedbackId ?? payload.feedbackId ?? "").trim();
    if (!feedbackId) throw new Error("addFeedbackEvent requires feedbackId");
    const status = String(options.status ?? "pending");
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id ?? payload.seasonContextId);
    const result = bindRun(this.database.prepare(`
      INSERT INTO feedback_events (
        season_context_id, feedback_id, query_id, visitor_scope, feedback_target, feedback_type,
        rating, card_index, reason, payload_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(feedback_id) DO NOTHING
    `), [
      seasonContextId,
      feedbackId,
      options.queryId ?? null,
      options.visitorScope ?? null,
      options.feedbackTarget ?? null,
      type,
      options.rating ?? null,
      Number.isInteger(options.cardIndex) ? options.cardIndex : null,
      options.reason ?? null,
      JSON.stringify(cloneValue(payload)),
      status,
      createdAt,
      updatedAt
    ]);

    if (Number(result?.changes ?? result?.changesCount ?? 0) < 1) {
      const existing = this.findFeedbackEventByFeedbackId(feedbackId);
      return existing ? { ...existing, duplicate: true } : null;
    }

    return {
      id: Number(result?.lastInsertRowid ?? result?.lastID ?? 0) || null,
      seasonContextId,
      feedbackId,
      queryId: options.queryId ?? null,
      visitorScope: options.visitorScope ?? null,
      feedbackTarget: options.feedbackTarget ?? null,
      feedbackType: type,
      rating: options.rating ?? null,
      cardIndex: Number.isInteger(options.cardIndex) ? options.cardIndex : null,
      reason: options.reason ?? null,
      payload: cloneValue(payload),
      status,
      createdAt,
      updatedAt
    };
  }

  listFeedbackEvents(options = {}) {
    const limit = positiveInteger(options.limit, 100);
    const rows = bindAll(this.database.prepare(`
      SELECT id, season_context_id, feedback_id, query_id, visitor_scope, feedback_target,
             feedback_type, rating, card_index, reason, payload_json,
             status, created_at, updated_at
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
    const row = bindGet(this.database.prepare(`
      SELECT id, season_context_id, feedback_id, query_id, visitor_scope, feedback_target,
             feedback_type, rating, card_index, reason, payload_json,
             status, created_at, updated_at
      FROM feedback_events
      WHERE feedback_id = ?
    `), [id]);
    return row ? rowToFeedbackEvent(row) : null;
  }

  clearFeedbackEvents(options = {}) {
    const clauses = [];
    const params = [];
    if (options.seasonContextId ?? options.season_context_id) {
      clauses.push("season_context_id = ?");
      params.push(normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id));
    }
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

  addAdminAudit(record = {}) {
    const seasonContextId = normalizeSeasonContextId(record.seasonContextId ?? record.season_context_id);
    const action = String(record.action ?? "").trim();
    const entityType = String(record.entityType ?? record.entity_type ?? "").trim();
    if (!action || !entityType) throw new Error("Admin audit requires action and entityType");
    const createdAt = record.createdAt ?? record.created_at ?? new Date(this.now()).toISOString();
    const result = bindRun(this.database.prepare(`
      INSERT INTO admin_audit_events (
        season_context_id, action, entity_type, entity_id, before_json, after_json, actor, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `), [
      seasonContextId,
      action,
      entityType,
      record.entityId ?? record.entity_id ?? null,
      record.before == null ? null : JSON.stringify(cloneValue(record.before)),
      record.after == null ? null : JSON.stringify(cloneValue(record.after)),
      String(record.actor ?? "admin"),
      createdAt
    ]);
    return {
      id: Number(result?.lastInsertRowid ?? result?.lastID ?? 0) || null,
      seasonContextId,
      action,
      entityType,
      entityId: record.entityId ?? record.entity_id ?? null,
      before: cloneValue(record.before ?? null),
      after: cloneValue(record.after ?? null),
      actor: String(record.actor ?? "admin"),
      createdAt
    };
  }

  listAdminAudits(options = {}) {
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    const limit = positiveInteger(options.limit, 100);
    return bindAll(this.database.prepare(`
      SELECT id, season_context_id, action, entity_type, entity_id,
             before_json, after_json, actor, created_at
      FROM admin_audit_events
      WHERE season_context_id = ?
      ORDER BY id DESC
      LIMIT ?
    `), [seasonContextId, limit]).map((row) => ({
      id: row.id,
      seasonContextId: row.season_context_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id ?? null,
      before: row.before_json ? JSON.parse(row.before_json) : null,
      after: row.after_json ? JSON.parse(row.after_json) : null,
      actor: row.actor,
      createdAt: row.created_at
    }));
  }

  upsertCompProfile(record = {}) {
    const seasonContextId = normalizeSeasonContextId(record.seasonContextId ?? record.season_context_id);
    const profileKey = String(record.profileKey ?? record.profile_key ?? "").trim();
    if (!profileKey) throw new Error("Comp profile requires profileKey");
    const existing = this.getCompProfile(profileKey, { seasonContextId });
    const now = new Date(this.now()).toISOString();
    const createdAt = existing?.createdAt ?? record.createdAt ?? record.created_at ?? now;
    const updatedAt = record.updatedAt ?? record.updated_at ?? now;
    bindRun(this.database.prepare(`
      INSERT INTO comp_profiles (
        season_context_id, profile_key, difficulty, beginner_friendly, pivot_difficulty,
        position_difficulty, contest_tolerance, econ_difficulty, notes_json,
        enabled, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(season_context_id, profile_key) DO UPDATE SET
        difficulty = excluded.difficulty,
        beginner_friendly = excluded.beginner_friendly,
        pivot_difficulty = excluded.pivot_difficulty,
        position_difficulty = excluded.position_difficulty,
        contest_tolerance = excluded.contest_tolerance,
        econ_difficulty = excluded.econ_difficulty,
        notes_json = excluded.notes_json,
        enabled = excluded.enabled,
        source = excluded.source,
        updated_at = excluded.updated_at
    `), [
      seasonContextId,
      profileKey,
      record.difficulty ?? null,
      record.beginnerFriendly === null || record.beginnerFriendly === undefined
        ? null
        : record.beginnerFriendly ? 1 : 0,
      record.pivotDifficulty ?? record.pivot_difficulty ?? null,
      record.positionDifficulty ?? record.position_difficulty ?? null,
      record.contestTolerance ?? record.contest_tolerance ?? null,
      record.econDifficulty ?? record.econ_difficulty ?? null,
      JSON.stringify(Array.isArray(record.notes) ? record.notes.map(String) : []),
      record.enabled === false ? 0 : 1,
      String(record.source ?? "admin"),
      createdAt,
      updatedAt
    ]);
    return this.getCompProfile(profileKey, { seasonContextId });
  }

  getCompProfile(profileKey, options = {}) {
    const row = bindGet(this.database.prepare(`
      SELECT season_context_id, profile_key, difficulty, beginner_friendly, pivot_difficulty,
             position_difficulty, contest_tolerance, econ_difficulty, notes_json,
             enabled, source, created_at, updated_at
      FROM comp_profiles
      WHERE season_context_id = ? AND profile_key = ?
    `), [
      normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id),
      String(profileKey)
    ]);
    return row ? {
      seasonContextId: row.season_context_id,
      profileKey: row.profile_key,
      difficulty: row.difficulty ?? null,
      beginnerFriendly: row.beginner_friendly === null || row.beginner_friendly === undefined
        ? null
        : Boolean(row.beginner_friendly),
      pivotDifficulty: row.pivot_difficulty ?? null,
      positionDifficulty: row.position_difficulty ?? null,
      contestTolerance: row.contest_tolerance ?? null,
      econDifficulty: row.econ_difficulty ?? null,
      notes: JSON.parse(row.notes_json ?? "[]"),
      enabled: Boolean(row.enabled),
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    } : null;
  }

  listCompProfiles(options = {}) {
    const clauses = ["season_context_id = ?"];
    const params = [normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id)];
    if (options.enabled !== undefined) {
      clauses.push("enabled = ?");
      params.push(options.enabled ? 1 : 0);
    }
    return bindAll(this.database.prepare(`
      SELECT profile_key FROM comp_profiles
      WHERE ${clauses.join(" AND ")}
      ORDER BY profile_key ASC
    `), params).map((row) => this.getCompProfile(row.profile_key, {
      seasonContextId: params[0]
    }));
  }

  deleteCompProfile(profileKey, options = {}) {
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    const current = this.getCompProfile(profileKey, { seasonContextId });
    if (!current) return null;
    bindRun(this.database.prepare("DELETE FROM comp_profile_bindings WHERE season_context_id = ? AND profile_key = ?"), [
      seasonContextId,
      String(profileKey)
    ]);
    bindRun(this.database.prepare("DELETE FROM comp_profiles WHERE season_context_id = ? AND profile_key = ?"), [
      seasonContextId,
      String(profileKey)
    ]);
    return current;
  }

  upsertCompProfileBinding(record = {}) {
    const seasonContextId = normalizeSeasonContextId(record.seasonContextId ?? record.season_context_id);
    const profileKey = String(record.profileKey ?? record.profile_key ?? "").trim();
    const provider = String(record.provider ?? "").trim();
    const clusterId = String(record.clusterId ?? record.cluster_id ?? "").trim();
    const lineupSignature = String(record.lineupSignature ?? record.lineup_signature ?? "").trim();
    const signatureVersion = String(record.signatureVersion ?? record.signature_version ?? "lineup-signature-v1").trim();
    if (!profileKey || !provider || !clusterId || !lineupSignature || !signatureVersion) {
      throw new Error("Comp profile binding requires profileKey, provider, clusterId, lineupSignature, and signatureVersion");
    }
    const existing = this.listCompProfileBindings({ seasonContextId, profileKey, provider })[0];
    const now = new Date(this.now()).toISOString();
    bindRun(this.database.prepare(`
      INSERT INTO comp_profile_bindings (
        season_context_id, profile_key, provider, cluster_id, lineup_signature, signature_version,
        strategy_override, match_confidence, match_status, last_verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(season_context_id, profile_key, provider) DO UPDATE SET
        cluster_id = excluded.cluster_id,
        lineup_signature = excluded.lineup_signature,
        signature_version = excluded.signature_version,
        strategy_override = excluded.strategy_override,
        match_confidence = excluded.match_confidence,
        match_status = excluded.match_status,
        last_verified_at = excluded.last_verified_at,
        updated_at = excluded.updated_at
    `), [
      seasonContextId,
      profileKey,
      provider,
      clusterId,
      lineupSignature,
      signatureVersion,
      record.strategyOverride ?? record.strategy_override ?? null,
      Number(record.matchConfidence ?? record.match_confidence ?? 1),
      String(record.matchStatus ?? record.match_status ?? "verified"),
      record.lastVerifiedAt ?? record.last_verified_at ?? now,
      existing?.createdAt ?? record.createdAt ?? record.created_at ?? now,
      record.updatedAt ?? record.updated_at ?? now
    ]);
    return this.listCompProfileBindings({ seasonContextId, profileKey, provider })[0] ?? null;
  }

  listCompProfileBindings(options = {}) {
    const clauses = ["season_context_id = ?"];
    const params = [normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id)];
    for (const [optionKey, column] of [["profileKey", "profile_key"], ["provider", "provider"], ["clusterId", "cluster_id"], ["matchStatus", "match_status"]]) {
      if (!options[optionKey]) continue;
      clauses.push(`${column} = ?`);
      params.push(String(options[optionKey]));
    }
    return bindAll(this.database.prepare(`
      SELECT season_context_id, profile_key, provider, cluster_id, lineup_signature, signature_version,
             strategy_override, match_confidence, match_status, last_verified_at, created_at, updated_at
      FROM comp_profile_bindings
      WHERE ${clauses.join(" AND ")}
      ORDER BY profile_key ASC
    `), params).map((row) => ({
      seasonContextId: row.season_context_id,
      profileKey: row.profile_key,
      provider: row.provider,
      clusterId: row.cluster_id,
      lineupSignature: row.lineup_signature,
      signatureVersion: row.signature_version,
      strategyOverride: row.strategy_override ?? null,
      matchConfidence: row.match_confidence,
      matchStatus: row.match_status,
      lastVerifiedAt: row.last_verified_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  deleteCompProfileBinding(profileKey, provider, options = {}) {
    const bindings = this.listCompProfileBindings({
      seasonContextId: options.seasonContextId ?? options.season_context_id,
      profileKey,
      provider
    });
    const current = bindings[0] ?? null;
    if (!current) return null;
    bindRun(this.database.prepare(`
      DELETE FROM comp_profile_bindings
      WHERE season_context_id = ? AND profile_key = ? AND provider = ?
    `), [current.seasonContextId, String(profileKey), String(provider)]);
    return current;
  }

  clearQueryCache(options = {}) {
    return this._clearStore("query", options);
  }

  clearDefaultContextCache(options = {}) {
    return this._clearStore("defaultContext", options);
  }

  clearSessionState(options = {}) {
    return this._clearStore("session", options);
  }

  getCompTrendHistory(key, options = {}) {
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    const row = bindGet(this.database.prepare(`
      SELECT value_json, updated_at
      FROM comp_trend_history
      WHERE season_context_id = ? AND history_key = ?
    `), [seasonContextId, String(key)]);
    if (!row) return null;
    return {
      value: JSON.parse(row.value_json),
      updatedAt: row.updated_at,
      expiresAt: null,
      expired: false
    };
  }

  setCompTrendHistory(key, value, options = {}) {
    const seasonContextId = normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
    const updatedAt = new Date(this.now()).toISOString();
    bindRun(this.database.prepare(`
      INSERT INTO comp_trend_history (season_context_id, history_key, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(season_context_id, history_key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `), [seasonContextId, String(key), JSON.stringify(cloneValue(value)), updatedAt]);
    return {
      value: cloneValue(value),
      updatedAt,
      expiresAt: null,
      expired: false
    };
  }

  clearQueryHistory(options = {}) {
    return {
      queryCache: this.clearQueryCache(options),
      defaultContextCache: this.clearDefaultContextCache(options),
      sessionState: this.clearSessionState(options)
    };
  }

  clearTransient(options = {}) {
    return this.clearQueryHistory(options);
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
    bindRun(this.database.prepare("DELETE FROM query_events"));
    bindRun(this.database.prepare("DELETE FROM comp_trend_history"));
  }
}
