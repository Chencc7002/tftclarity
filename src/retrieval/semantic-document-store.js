import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const SQLITE_SEMANTIC_INDEX_SCHEMA_VERSION = "semantic_index.v3";

export const SQLITE_SEMANTIC_INDEX_SCHEMA = `
CREATE TABLE IF NOT EXISTS semantic_documents (
  season_context_id TEXT NOT NULL DEFAULT 'set17-live',
  id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  api_name TEXT,
  intent TEXT,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  embedding BLOB,
  embedding_dimensions INTEGER,
  embedding_model TEXT,
  patch TEXT,
  locale TEXT,
  source TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (season_context_id, id)
);

CREATE INDEX IF NOT EXISTS idx_semantic_documents_scope
ON semantic_documents(season_context_id, document_type, patch, locale);

CREATE INDEX IF NOT EXISTS idx_semantic_documents_entity
ON semantic_documents(season_context_id, api_name, patch, locale);

CREATE INDEX IF NOT EXISTS idx_semantic_documents_hash
ON semantic_documents(content_hash, embedding_model);

CREATE TABLE IF NOT EXISTS semantic_index_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

function contentHash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalValue(value[key])])
  );
}

function defaultRecordHash(value) {
  const metadata = { ...(value.metadata ?? {}) };
  // generatedAt is a write timestamp, not a semantic record field. Pipelines
  // that need freshness-sensitive updates (for example current_stats) provide
  // their own recordHash. Other provenance such as ingestionRunId,
  // reviewStatus and disclosure remains hash-sensitive.
  delete metadata.generatedAt;
  return contentHash(JSON.stringify(canonicalValue({
    id: value.id,
    documentType: value.documentType,
    contentHash: value.contentHash,
    apiName: value.apiName,
    intent: value.intent,
    patch: value.patch,
    locale: value.locale,
    source: value.source,
    metadata
  })));
}

const CURRENT_STATS_DOCUMENT_TYPES = new Set([
  "meta_snapshot",
  "unit_stats",
  "comp_stats",
  "item_stats",
  "trend_snapshot"
]);

function normalizeDocument(value = {}, options = {}) {
  const content = String(value.content ?? value.text ?? "").trim();
  if (!value.id || !value.documentType || !content) throw new TypeError("Semantic document requires id, documentType and content");
  if (value.realtime === true || value.metadata?.realtime === true || /metatft.*(?:daily|realtime|statistics)/iu.test(String(value.source ?? ""))) {
    throw new RangeError("Realtime MetaTFT statistics cannot be stored in the static semantic index");
  }
  if (CURRENT_STATS_DOCUMENT_TYPES.has(String(value.documentType))) {
    if (options.allowCurrentStats !== true) {
      throw new RangeError("Current stats documents require the dedicated current-stats index manager");
    }
    if (
      value.source !== "metatft"
      || value.metadata?.namespace !== "current_stats"
      || value.metadata?.currentStatsSchemaVersion !== "current_stats.v2"
    ) {
      throw new RangeError("Current stats documents must pass the dedicated current_stats schema");
    }
  }
  const normalized = {
    seasonContextId: String(value.seasonContextId ?? value.season_context_id ?? "set17-live"),
    id: String(value.id),
    documentType: String(value.documentType),
    content,
    contentHash: value.contentHash ?? contentHash(content),
    embeddingModel: value.embeddingModel ?? null,
    embedding: Array.isArray(value.embedding) ? value.embedding.map(Number) : null,
    apiName: value.apiName ? String(value.apiName) : null,
    intent: value.intent ? String(value.intent) : null,
    patch: value.patch ?? null,
    locale: value.locale ?? null,
    source: String(value.source ?? "local_static_index"),
    updatedAt: value.updatedAt ?? new Date().toISOString(),
    metadata: value.metadata && typeof value.metadata === "object" ? { ...value.metadata } : {}
  };
  normalized.recordHash = (
    value.recordHash
    ?? value.record_hash
    ?? defaultRecordHash(normalized)
  );
  return normalized;
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

function semanticTableColumns(database, table) {
  try {
    return bindAll(database.prepare(`PRAGMA table_info(${table})`)).map((row) => String(row.name));
  } catch {
    return [];
  }
}

export function migrateSQLiteSemanticSeasonContext(database) {
  const columns = semanticTableColumns(database, "semantic_documents");
  if (!columns.length || columns.includes("season_context_id")) return false;
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE semantic_documents_season_migration (
        season_context_id TEXT NOT NULL DEFAULT 'set17-live',
        id TEXT NOT NULL,
        document_type TEXT NOT NULL,
        api_name TEXT,
        intent TEXT,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding BLOB,
        embedding_dimensions INTEGER,
        embedding_model TEXT,
        patch TEXT,
        locale TEXT,
        source TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (season_context_id, id)
      );
      INSERT INTO semantic_documents_season_migration (
        season_context_id, id, document_type, api_name, intent, content, content_hash,
        embedding, embedding_dimensions, embedding_model, patch, locale, source, metadata_json, updated_at
      )
      SELECT 'set17-live', id, document_type, api_name, intent, content, content_hash,
        embedding, embedding_dimensions, embedding_model, patch, locale, source, metadata_json, updated_at
      FROM semantic_documents;
      DROP TABLE semantic_documents;
      ALTER TABLE semantic_documents_season_migration RENAME TO semantic_documents;
      DROP INDEX IF EXISTS idx_semantic_documents_scope;
      DROP INDEX IF EXISTS idx_semantic_documents_entity;
      DROP INDEX IF EXISTS idx_semantic_documents_hash;
      COMMIT;
    `);
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the original migration error.
    }
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
  return true;
}

function encodeEmbedding(vector) {
  if (!Array.isArray(vector)) return null;
  const buffer = Buffer.allocUnsafe(vector.length * Float32Array.BYTES_PER_ELEMENT);
  vector.forEach((value, index) => buffer.writeFloatLE(Number(value), index * Float32Array.BYTES_PER_ELEMENT));
  return buffer;
}

function decodeEmbedding(value, dimensions) {
  if (value === null || value === undefined) return null;
  const buffer = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : value instanceof ArrayBuffer
        ? Buffer.from(value)
        : null;
  if (!buffer || buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return null;
  const count = buffer.byteLength / Float32Array.BYTES_PER_ELEMENT;
  if (dimensions !== null && dimensions !== undefined && Number(dimensions) !== count) return null;
  return Array.from({ length: count }, (_, index) => buffer.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT));
}

function parseMetadata(value) {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function rowToDocument(row) {
  return {
    seasonContextId: row.season_context_id ?? "set17-live",
    id: row.id,
    documentType: row.document_type,
    apiName: row.api_name ?? null,
    intent: row.intent ?? null,
    content: row.content,
    contentHash: row.content_hash,
    recordHash: row.record_hash ?? row.content_hash,
    embedding: decodeEmbedding(row.embedding, row.embedding_dimensions),
    embeddingModel: row.embedding_model ?? null,
    patch: row.patch ?? null,
    locale: row.locale ?? null,
    source: row.source,
    metadata: parseMetadata(row.metadata_json),
    updatedAt: row.updated_at
  };
}

async function openSQLiteDatabase(filePath) {
  if (filePath && filePath !== ":memory:") await mkdir(dirname(filePath), { recursive: true });
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
        "SQLiteSemanticDocumentStore requires node:sqlite or better-sqlite3.",
        `node:sqlite: ${nodeSqliteError.message}`,
        `better-sqlite3: ${betterSqliteError.message}`
      ].join(" "));
    }
  }
}

function filterSql(filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.allSeasons !== true) {
    clauses.push("season_context_id = ?");
    params.push(String(filters.seasonContextId ?? filters.season_context_id ?? "set17-live"));
  }
  const types = Array.isArray(filters.documentTypes)
    ? filters.documentTypes.filter(Boolean).map(String)
    : filters.documentType
      ? [String(filters.documentType)]
      : [];
  if (types.length) {
    clauses.push(`document_type IN (${types.map(() => "?").join(", ")})`);
    params.push(...types);
  }
  if (filters.patch) {
    clauses.push(filters.includeGlobalPatch === false ? "patch = ?" : "(patch = ? OR patch IS NULL)");
    params.push(String(filters.patch));
  }
  if (filters.locale) {
    clauses.push(filters.includeGlobalLocale === false ? "locale = ?" : "(locale = ? OR locale IS NULL)");
    params.push(String(filters.locale));
  }
  if (filters.embeddingModel) {
    clauses.push("embedding_model = ?");
    params.push(String(filters.embeddingModel));
  }
  if (filters.hasEmbedding === true) clauses.push("embedding IS NOT NULL");
  if (filters.hasEmbedding === false) clauses.push("embedding IS NULL");
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export class SemanticDocumentStore {
  async upsert() {
    throw new Error("SemanticDocumentStore.upsert must be implemented");
  }

  async list() {
    throw new Error("SemanticDocumentStore.list must be implemented");
  }

  async remove() {
    throw new Error("SemanticDocumentStore.remove must be implemented");
  }
}

export class MemorySemanticDocumentStore extends SemanticDocumentStore {
  constructor(documents = []) {
    super();
    this.documents = new Map();
    for (const document of documents) {
      const normalized = normalizeDocument(document);
      this.documents.set(`${normalized.seasonContextId}\u0000${normalized.id}`, normalized);
    }
  }

  async upsert(documents, options = {}) {
    const result = { inserted: 0, updated: 0, unchanged: 0 };
    for (const value of Array.isArray(documents) ? documents : [documents]) {
      const document = normalizeDocument(value, options);
      const key = `${document.seasonContextId}\u0000${document.id}`;
      const existing = this.documents.get(key);
      if (
        existing?.contentHash === document.contentHash
        && !document.embedding
        && existing.embedding
      ) {
        document.embedding = [...existing.embedding];
        document.embeddingModel = existing.embeddingModel;
      }
      if (existing?.recordHash === document.recordHash && existing?.embeddingModel === document.embeddingModel) {
        result.unchanged += 1;
        continue;
      }
      result[existing ? "updated" : "inserted"] += 1;
      this.documents.set(key, document);
    }
    return result;
  }

  async list(filters = {}) {
    const types = new Set(Array.isArray(filters.documentTypes) ? filters.documentTypes : filters.documentType ? [filters.documentType] : []);
    return [...this.documents.values()].filter((document) => {
      if (filters.allSeasons !== true
        && document.seasonContextId !== String(filters.seasonContextId ?? filters.season_context_id ?? "set17-live")) return false;
      if (types.size && !types.has(document.documentType)) return false;
      if (filters.patch && document.patch && document.patch !== filters.patch) return false;
      if (filters.locale && document.locale && document.locale !== filters.locale) return false;
      return true;
    }).map((document) => ({ ...document, metadata: { ...document.metadata } }));
  }

  async remove(ids, options = {}) {
    let removed = 0;
    const seasonContextId = String(options.seasonContextId ?? options.season_context_id ?? "set17-live");
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      removed += Number(this.documents.delete(`${seasonContextId}\u0000${String(id)}`));
    }
    return removed;
  }
}

export class SQLiteSemanticDocumentStore extends SemanticDocumentStore {
  static async open(options = {}) {
    if (!options.filePath && !options.database) {
      throw new Error("SQLiteSemanticDocumentStore.open requires filePath or database");
    }
    const database = options.database ?? await openSQLiteDatabase(options.filePath);
    return new SQLiteSemanticDocumentStore({ ...options, database, ownsDatabase: !options.database });
  }

  constructor(options = {}) {
    super();
    if (!options.database) {
      throw new Error("SQLiteSemanticDocumentStore requires a database; use SQLiteSemanticDocumentStore.open for file paths");
    }
    this.database = options.database;
    this.ownsDatabase = Boolean(options.ownsDatabase);
    migrateSQLiteSemanticSeasonContext(this.database);
    this.database.exec(SQLITE_SEMANTIC_INDEX_SCHEMA);
    const columns = semanticTableColumns(this.database, "semantic_documents");
    if (!columns.includes("record_hash")) {
      this.database.exec("ALTER TABLE semantic_documents ADD COLUMN record_hash TEXT");
      this.database.exec("UPDATE semantic_documents SET record_hash = content_hash WHERE record_hash IS NULL");
    }
    this.setMeta("schemaVersion", SQLITE_SEMANTIC_INDEX_SCHEMA_VERSION);
  }

  setMeta(key, value) {
    const updatedAt = new Date().toISOString();
    bindRun(this.database.prepare(`
      INSERT INTO semantic_index_meta (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `), [String(key), String(value), updatedAt]);
  }

  getMeta(key) {
    const row = bindGet(this.database.prepare("SELECT value, updated_at FROM semantic_index_meta WHERE key = ?"), [String(key)]);
    return row ? { value: row.value, updatedAt: row.updated_at } : null;
  }

  async upsert(documents, options = {}) {
    const result = { inserted: 0, updated: 0, unchanged: 0 };
    const select = this.database.prepare(`
      SELECT content_hash, record_hash, embedding_model, embedding IS NOT NULL AS has_embedding
      FROM semantic_documents WHERE season_context_id = ? AND id = ?
    `);
    const upsert = this.database.prepare(`
      INSERT INTO semantic_documents (
        season_context_id, id, document_type, api_name, intent, content, content_hash, record_hash, embedding,
        embedding_dimensions, embedding_model, patch, locale, source, metadata_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(season_context_id, id) DO UPDATE SET
        document_type = excluded.document_type,
        api_name = excluded.api_name,
        intent = excluded.intent,
        content = excluded.content,
        content_hash = excluded.content_hash,
        record_hash = excluded.record_hash,
        embedding = CASE
          WHEN semantic_documents.content_hash = excluded.content_hash
            AND excluded.embedding IS NULL
          THEN semantic_documents.embedding
          ELSE excluded.embedding
        END,
        embedding_dimensions = CASE
          WHEN semantic_documents.content_hash = excluded.content_hash
            AND excluded.embedding IS NULL
          THEN semantic_documents.embedding_dimensions
          ELSE excluded.embedding_dimensions
        END,
        embedding_model = CASE
          WHEN semantic_documents.content_hash = excluded.content_hash
            AND excluded.embedding IS NULL
          THEN semantic_documents.embedding_model
          ELSE excluded.embedding_model
        END,
        patch = excluded.patch,
        locale = excluded.locale,
        source = excluded.source,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);

    for (const value of Array.isArray(documents) ? documents : [documents]) {
      const document = normalizeDocument(value, options);
      const existing = bindGet(select, [document.seasonContextId, document.id]);
      const sameContent = existing?.content_hash === document.contentHash;
      const sameRecord = existing?.record_hash === document.recordHash;
      const preservesExistingEmbedding = sameContent && !document.embedding && Boolean(existing?.has_embedding);
      const sameVectorState = existing?.embedding_model === document.embeddingModel
        && Boolean(existing?.has_embedding) === Boolean(document.embedding);
      if (existing && sameRecord && (preservesExistingEmbedding || sameVectorState)) {
        result.unchanged += 1;
        continue;
      }
      bindRun(upsert, [
        document.seasonContextId,
        document.id,
        document.documentType,
        document.apiName,
        document.intent,
        document.content,
        document.contentHash,
        document.recordHash,
        encodeEmbedding(document.embedding),
        document.embedding?.length ?? null,
        document.embeddingModel,
        document.patch,
        document.locale,
        document.source,
        JSON.stringify(document.metadata),
        document.updatedAt
      ]);
      result[existing ? "updated" : "inserted"] += 1;
    }
    return result;
  }

  async list(filters = {}) {
    const { where, params } = filterSql(filters);
    const limit = Number.isInteger(Number(filters.limit)) && Number(filters.limit) > 0
      ? Math.min(Number(filters.limit), 100000)
      : null;
    const rows = bindAll(this.database.prepare(`
      SELECT season_context_id, id, document_type, api_name, intent, content, content_hash, record_hash, embedding,
             embedding_dimensions, embedding_model, patch, locale, source, metadata_json, updated_at
      FROM semantic_documents
      ${where}
      ORDER BY document_type ASC, id ASC
      ${limit ? "LIMIT ?" : ""}
    `), limit ? [...params, limit] : params);
    return rows.map(rowToDocument);
  }

  async remove(ids, options = {}) {
    const values = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String))];
    if (!values.length) return 0;
    const seasonContextId = String(options.seasonContextId ?? options.season_context_id ?? "set17-live");
    const statement = this.database.prepare("DELETE FROM semantic_documents WHERE season_context_id = ? AND id = ?");
    let removed = 0;
    for (const id of values) removed += Number(bindRun(statement, [seasonContextId, id])?.changes ?? 0);
    return removed;
  }

  async count(filters = {}) {
    const { where, params } = filterSql(filters);
    const row = bindGet(this.database.prepare(`SELECT COUNT(*) AS count FROM semantic_documents ${where}`), params);
    return Number(row?.count ?? 0);
  }

  close() {
    if (this.ownsDatabase) this.database.close?.();
  }
}

export {
  contentHash as semanticContentHash,
  decodeEmbedding as decodeSemanticEmbedding,
  encodeEmbedding as encodeSemanticEmbedding,
  normalizeDocument as normalizeSemanticDocument,
  openSQLiteDatabase as openSemanticSQLiteDatabase
};
