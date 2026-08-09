import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  MAX_CONVERSATION_BRIDGE_RECORDS,
  QUICK_TOOL_BRIDGE_STATE_SCHEMA_VERSION,
  createQuickToolBridgeArtifacts,
  createQuickToolTerminalRecord,
  quickTaskFingerprint
} from "./conversation-bridge.js";

export const SQLITE_CONVERSATION_BRIDGE_SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS quick_tool_bridge_states (
  scope_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  context_epoch INTEGER NOT NULL DEFAULT 0,
  next_turn_ordinal INTEGER NOT NULL DEFAULT 1,
  active_turn_ordinal INTEGER,
  active_record_id TEXT,
  state_version INTEGER NOT NULL DEFAULT 0,
  season_context_id TEXT,
  pending_clarification_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_key, conversation_id)
);
CREATE TABLE IF NOT EXISTS quick_tool_request_reservations (
  scope_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  turn_ordinal INTEGER NOT NULL,
  context_epoch INTEGER NOT NULL,
  season_context_id TEXT NOT NULL,
  status TEXT NOT NULL,
  deadline_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  terminal_reason TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_key, conversation_id, request_id),
  UNIQUE (scope_key, conversation_id, turn_ordinal)
);
CREATE TABLE IF NOT EXISTS quick_tool_evidence_snapshots (
  scope_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  snapshot_id TEXT,
  record_id TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (scope_key, conversation_id, snapshot_id),
  UNIQUE (scope_key, conversation_id, record_id)
);
CREATE TABLE IF NOT EXISTS quick_tool_turn_records (
  scope_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  turn_ordinal INTEGER NOT NULL,
  context_epoch INTEGER NOT NULL,
  season_context_id TEXT NOT NULL,
  status TEXT NOT NULL,
  operation TEXT NOT NULL,
  record_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (scope_key, conversation_id, record_id),
  UNIQUE (scope_key, conversation_id, request_id),
  UNIQUE (scope_key, conversation_id, turn_ordinal),
  FOREIGN KEY (scope_key, conversation_id, snapshot_id)
    REFERENCES quick_tool_evidence_snapshots(scope_key, conversation_id, snapshot_id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_quick_tool_records_recent
ON quick_tool_turn_records(scope_key, conversation_id, turn_ordinal DESC);
CREATE INDEX IF NOT EXISTS idx_quick_tool_snapshots_expiry
ON quick_tool_evidence_snapshots(expires_at);
`;

function run(statement, values = []) {
  return statement.run(...values);
}

function get(statement, values = []) {
  return statement.get(...values);
}

function all(statement, values = []) {
  return statement.all(...values);
}

function bridgeError(code, message, statusCode = 500) {
  return Object.assign(new Error(message), { code, statusCode });
}

async function openDatabase(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
  let nodeSqliteError;
  try {
    const sqlite = await import("node:sqlite");
    return new sqlite.DatabaseSync(filePath);
  } catch (error) {
    nodeSqliteError = error;
  }
  try {
    const module = await import("better-sqlite3");
    const Database = module.default ?? module;
    return new Database(filePath);
  } catch (error) {
    throw new Error(`Conversation bridge SQLite unavailable: node:sqlite=${nodeSqliteError.message}; better-sqlite3=${error.message}`);
  }
}

function parseJson(value, fallback = null) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stateFromRow(row) {
  if (!row) return null;
  return {
    schemaVersion: row.schema_version,
    scopeKey: row.scope_key,
    conversationId: row.conversation_id,
    contextEpoch: Number(row.context_epoch),
    nextTurnOrdinal: Number(row.next_turn_ordinal),
    activeTurnOrdinal: row.active_turn_ordinal == null ? null : Number(row.active_turn_ordinal),
    activeRecordId: row.active_record_id ?? null,
    stateVersion: Number(row.state_version),
    seasonContextId: row.season_context_id ?? null,
    pendingClarification: parseJson(row.pending_clarification_json),
    updatedAt: row.updated_at
  };
}

export class SQLiteConversationBridgeStore {
  static async open(options = {}) {
    if (!options.filePath && !options.database) {
      throw new TypeError("SQLiteConversationBridgeStore.open requires filePath or database");
    }
    const database = options.database ?? await openDatabase(options.filePath);
    return new SQLiteConversationBridgeStore({
      ...options,
      database,
      ownsDatabase: !options.database
    });
  }

  constructor(options = {}) {
    if (!options.database) throw new TypeError("SQLiteConversationBridgeStore requires database");
    this.database = options.database;
    this.ownsDatabase = Boolean(options.ownsDatabase);
    this.now = options.now ?? Date.now;
    this.quickTaskDeadlineMs = Math.max(1, Number(options.quickTaskDeadlineMs ?? 30_000));
    this.staleGraceMs = Math.max(0, Number(options.staleGraceMs ?? 30_000));
    this.failpoint = options.failpoint ?? null;
    this.database.exec(SQLITE_CONVERSATION_BRIDGE_SCHEMA);
    this._migrateSchema();
  }

  _migrateSchema() {
    const reservationColumns = new Set(all(this.database.prepare(
      "PRAGMA table_info(quick_tool_request_reservations)"
    )).map((column) => column.name));
    for (const [name, type] of [
      ["deadline_at", "TEXT"],
      ["started_at", "TEXT"],
      ["completed_at", "TEXT"],
      ["terminal_reason", "TEXT"],
      ["response_json", "TEXT"]
    ]) {
      if (!reservationColumns.has(name)) {
        this.database.exec(`ALTER TABLE quick_tool_request_reservations ADD COLUMN ${name} ${type}`);
      }
    }
    const turnColumns = all(this.database.prepare("PRAGMA table_info(quick_tool_turn_records)"));
    const snapshotColumn = turnColumns.find((column) => column.name === "snapshot_id");
    if (!snapshotColumn?.notnull) return;
    this.database.exec("PRAGMA foreign_keys = OFF");
    try {
      this.database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE quick_tool_turn_records RENAME TO quick_tool_turn_records_legacy;
        CREATE TABLE quick_tool_turn_records (
          scope_key TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          record_id TEXT NOT NULL,
          snapshot_id TEXT,
          request_id TEXT NOT NULL,
          request_fingerprint TEXT NOT NULL,
          turn_ordinal INTEGER NOT NULL,
          context_epoch INTEGER NOT NULL,
          season_context_id TEXT NOT NULL,
          status TEXT NOT NULL,
          operation TEXT NOT NULL,
          record_json TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          PRIMARY KEY (scope_key, conversation_id, record_id),
          UNIQUE (scope_key, conversation_id, request_id),
          UNIQUE (scope_key, conversation_id, turn_ordinal),
          FOREIGN KEY (scope_key, conversation_id, snapshot_id)
            REFERENCES quick_tool_evidence_snapshots(scope_key, conversation_id, snapshot_id)
            ON DELETE CASCADE
        );
        INSERT INTO quick_tool_turn_records
        SELECT * FROM quick_tool_turn_records_legacy;
        DROP TABLE quick_tool_turn_records_legacy;
        CREATE INDEX IF NOT EXISTS idx_quick_tool_records_recent
        ON quick_tool_turn_records(scope_key, conversation_id, turn_ordinal DESC);
        COMMIT;
      `);
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* original error wins */ }
      throw error;
    } finally {
      this.database.exec("PRAGMA foreign_keys = ON");
    }
  }

  _time() {
    return new Date(this.now()).toISOString();
  }

  _state(scopeKey, conversationId) {
    return stateFromRow(get(this.database.prepare(`
      SELECT * FROM quick_tool_bridge_states WHERE scope_key = ? AND conversation_id = ?
    `), [scopeKey, conversationId]));
  }

  _ensureState(scopeKey, conversationId, seasonContextId) {
    const now = this._time();
    run(this.database.prepare(`
      INSERT INTO quick_tool_bridge_states (
        scope_key, conversation_id, schema_version, context_epoch, next_turn_ordinal,
        active_turn_ordinal, active_record_id, state_version, season_context_id,
        pending_clarification_json, updated_at
      ) VALUES (?, ?, ?, 0, 1, NULL, NULL, 0, ?, NULL, ?)
      ON CONFLICT(scope_key, conversation_id) DO NOTHING
    `), [scopeKey, conversationId, QUICK_TOOL_BRIDGE_STATE_SCHEMA_VERSION, seasonContextId, now]);
    return this._state(scopeKey, conversationId);
  }

  _transaction(callback) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const value = callback();
      this.database.exec("COMMIT");
      return value;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* original error wins */ }
      throw error;
    }
  }

  _hit(name, details) {
    if (typeof this.failpoint === "function") this.failpoint(name, details);
  }

  async reserveQuickTask(input = {}) {
    const scopeKey = String(input.scopeKey);
    const conversationId = String(input.conversationId);
    const requestId = String(input.requestId);
    const seasonContextId = String(input.seasonContextId ?? "unknown");
    if (!scopeKey || !conversationId || !requestId) {
      throw bridgeError("invalid_conversation_bridge_request", "scopeKey, conversationId and requestId are required", 400);
    }
    const fingerprint = quickTaskFingerprint(input.quickTask);
    return this._transaction(() => {
      this._ensureState(scopeKey, conversationId, seasonContextId);
      this._recoverStaleQuickTasks(scopeKey, conversationId);
      const existing = get(this.database.prepare(`
        SELECT * FROM quick_tool_request_reservations
        WHERE scope_key = ? AND conversation_id = ? AND request_id = ?
      `), [scopeKey, conversationId, requestId]);
      if (existing) {
        if (existing.request_fingerprint !== fingerprint) {
          throw bridgeError(
            "conversation_bridge_idempotency_conflict",
            "requestId was already used for a different quickTask",
            409
          );
        }
        const recordRow = get(this.database.prepare(`
          SELECT record_json FROM quick_tool_turn_records
          WHERE scope_key = ? AND conversation_id = ? AND request_id = ?
        `), [scopeKey, conversationId, requestId]);
        const record = parseJson(recordRow?.record_json);
        const snapshotRow = record?.snapshotId ? get(this.database.prepare(`
          SELECT snapshot_json FROM quick_tool_evidence_snapshots
          WHERE scope_key = ? AND conversation_id = ? AND snapshot_id = ?
        `), [scopeKey, conversationId, record.snapshotId]) : null;
        return {
          requestId,
          requestFingerprint: fingerprint,
          turnOrdinal: Number(existing.turn_ordinal),
          contextEpoch: Number(existing.context_epoch),
          seasonContextId: existing.season_context_id,
          status: existing.status,
          record,
          snapshot: parseJson(snapshotRow?.snapshot_json),
          response: parseJson(existing.response_json),
          replay: true
        };
      }
      const inFlight = get(this.database.prepare(`
        SELECT request_id, status FROM quick_tool_request_reservations
        WHERE scope_key = ? AND conversation_id = ? AND status IN ('reserved', 'running')
        ORDER BY created_at LIMIT 1
      `), [scopeKey, conversationId]);
      if (inFlight) {
        throw bridgeError(
          "conversation_bridge_quick_task_in_progress",
          "another quickTask is already running for this conversation",
          409
        );
      }
      const state = this._state(scopeKey, conversationId);
      const seasonChanged = Boolean(state.seasonContextId && state.seasonContextId !== seasonContextId);
      const turnOrdinal = state.nextTurnOrdinal;
      const advanceEpoch = input.startNewTask === true || seasonChanged;
      const contextEpoch = state.contextEpoch + (advanceEpoch ? 1 : 0);
      const createdAt = this._time();
      const deadlineMs = Math.max(1, Number(input.deadlineMs ?? this.quickTaskDeadlineMs));
      const deadlineAt = new Date(this.now() + deadlineMs).toISOString();
      run(this.database.prepare(`
        INSERT INTO quick_tool_request_reservations (
          scope_key, conversation_id, request_id, request_fingerprint, turn_ordinal,
          context_epoch, season_context_id, status, deadline_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)
      `), [
        scopeKey, conversationId, requestId, fingerprint, turnOrdinal,
        contextEpoch, seasonContextId, deadlineAt, createdAt, createdAt
      ]);
      return {
        requestId,
        requestFingerprint: fingerprint,
        turnOrdinal,
        contextEpoch,
        seasonContextId,
        stateVersion: state.stateVersion,
        deadlineAt,
        status: "reserved",
        replay: false
      };
    });
  }

  async startQuickTask(input = {}) {
    const scopeKey = String(input.scopeKey);
    const conversationId = String(input.conversationId);
    const requestId = String(input.requestId);
    return this._transaction(() => {
      const reservation = get(this.database.prepare(`
        SELECT * FROM quick_tool_request_reservations
        WHERE scope_key = ? AND conversation_id = ? AND request_id = ?
      `), [scopeKey, conversationId, requestId]);
      if (!reservation) throw bridgeError("conversation_bridge_reservation_missing", "quickTask reservation is missing");
      if (reservation.status === "reserved") {
        const now = this._time();
        run(this.database.prepare(`
          UPDATE quick_tool_request_reservations
          SET status = 'running', started_at = ?, updated_at = ?
          WHERE scope_key = ? AND conversation_id = ? AND request_id = ? AND status = 'reserved'
        `), [now, now, scopeKey, conversationId, requestId]);
        reservation.status = "running";
        reservation.started_at = now;
      }
      return {
        requestId,
        status: reservation.status,
        turnOrdinal: Number(reservation.turn_ordinal),
        contextEpoch: Number(reservation.context_epoch),
        deadlineAt: reservation.deadline_at,
        replay: reservation.status !== "running"
      };
    });
  }

  async commitQuickTask(input = {}) {
    const scopeKey = String(input.scopeKey);
    const conversationId = String(input.conversationId);
    const requestId = String(input.requestId);
    return this._transaction(() => {
      const reservation = get(this.database.prepare(`
        SELECT * FROM quick_tool_request_reservations
        WHERE scope_key = ? AND conversation_id = ? AND request_id = ?
      `), [scopeKey, conversationId, requestId]);
      if (!reservation) throw bridgeError("conversation_bridge_reservation_missing", "quickTask reservation is missing");
      const fingerprint = quickTaskFingerprint(input.quickTask);
      if (reservation.request_fingerprint !== fingerprint) {
        throw bridgeError("conversation_bridge_idempotency_conflict", "quickTask does not match reserved requestId", 409);
      }
      const existing = get(this.database.prepare(`
        SELECT record_json FROM quick_tool_turn_records
        WHERE scope_key = ? AND conversation_id = ? AND request_id = ?
      `), [scopeKey, conversationId, requestId]);
      if (existing) {
        const record = parseJson(existing.record_json);
        const snapshotRow = get(this.database.prepare(`
          SELECT snapshot_json FROM quick_tool_evidence_snapshots
          WHERE scope_key = ? AND conversation_id = ? AND snapshot_id = ?
        `), [scopeKey, conversationId, record.snapshotId]);
        return {
          record,
          snapshot: parseJson(snapshotRow?.snapshot_json),
          response: parseJson(reservation.response_json),
          replay: true
        };
      }
      if (!["reserved", "running"].includes(reservation.status)) {
        throw bridgeError(
          "conversation_bridge_request_terminal",
          `quickTask request is already ${reservation.status}`,
          409
        );
      }
      const artifacts = createQuickToolBridgeArtifacts({
        ...input,
        turnOrdinal: Number(reservation.turn_ordinal),
        contextEpoch: Number(reservation.context_epoch),
        seasonContextId: reservation.season_context_id,
        recordedAt: input.recordedAt ?? this._time()
      });
      run(this.database.prepare(`
        INSERT INTO quick_tool_evidence_snapshots (
          scope_key, conversation_id, snapshot_id, record_id, integrity_hash,
          snapshot_json, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `), [
        scopeKey, conversationId, artifacts.snapshot.snapshotId, artifacts.record.recordId,
        artifacts.snapshot.integrityHash, JSON.stringify(artifacts.snapshot),
        artifacts.snapshot.createdAt, artifacts.snapshot.expiresAt
      ]);
      this._hit("after_snapshot_insert", artifacts);
      run(this.database.prepare(`
        INSERT INTO quick_tool_turn_records (
          scope_key, conversation_id, record_id, snapshot_id, request_id,
          request_fingerprint, turn_ordinal, context_epoch, season_context_id,
          status, operation, record_json, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `), [
        scopeKey, conversationId, artifacts.record.recordId, artifacts.record.snapshotId,
        requestId, artifacts.record.requestFingerprint, artifacts.record.turnOrdinal,
        artifacts.record.contextEpoch, artifacts.record.seasonContextId,
        artifacts.record.status, artifacts.record.operation, JSON.stringify(artifacts.record),
        artifacts.record.recordedAt
      ]);
      this._hit("after_record_insert", artifacts);
      run(this.database.prepare(`
        UPDATE quick_tool_request_reservations SET
          status = 'completed', completed_at = ?, response_json = ?, updated_at = ?
        WHERE scope_key = ? AND conversation_id = ? AND request_id = ?
      `), [this._time(), JSON.stringify(input.payload ?? null), this._time(), scopeKey, conversationId, requestId]);
      run(this.database.prepare(`
        UPDATE quick_tool_bridge_states SET
          context_epoch = ?,
          next_turn_ordinal = MAX(next_turn_ordinal, ?),
          active_record_id = ?,
          active_turn_ordinal = ?,
          state_version = state_version + 1,
          season_context_id = ?,
          pending_clarification_json = NULL,
          updated_at = ?
        WHERE scope_key = ? AND conversation_id = ?
      `), [
        artifacts.record.contextEpoch,
        artifacts.record.turnOrdinal + 1,
        artifacts.record.recordId,
        artifacts.record.turnOrdinal,
        artifacts.record.seasonContextId,
        this._time(), scopeKey, conversationId
      ]);
      this._hit("after_state_update", artifacts);
      this._prune(scopeKey, conversationId);
      return { ...artifacts, replay: false };
    });
  }

  async finalizeQuickTask(input = {}) {
    const scopeKey = String(input.scopeKey);
    const conversationId = String(input.conversationId);
    const requestId = String(input.requestId);
    const status = String(input.status ?? "failed");
    if (!["failed", "cancelled", "abandoned"].includes(status)) {
      throw bridgeError("invalid_conversation_bridge_status", `unsupported terminal status: ${status}`, 400);
    }
    return this._transaction(() => {
      const reservation = get(this.database.prepare(`
        SELECT * FROM quick_tool_request_reservations
        WHERE scope_key = ? AND conversation_id = ? AND request_id = ?
      `), [scopeKey, conversationId, requestId]);
      if (!reservation) throw bridgeError("conversation_bridge_reservation_missing", "quickTask reservation is missing");
      const existing = get(this.database.prepare(`
        SELECT record_json FROM quick_tool_turn_records
        WHERE scope_key = ? AND conversation_id = ? AND request_id = ?
      `), [scopeKey, conversationId, requestId]);
      if (existing) return { record: parseJson(existing.record_json), snapshot: null, replay: true };
      if (!["reserved", "running"].includes(reservation.status)) {
        return { record: null, snapshot: null, status: reservation.status, replay: true };
      }
      const state = this._state(scopeKey, conversationId);
      const quickTask = input.quickTask ?? {
        id: input.quickTaskId,
        operation: input.operation,
        arguments: input.arguments ?? {}
      };
      const record = createQuickToolTerminalRecord({
        ...input,
        scopeKey,
        conversationId,
        requestId,
        quickTask,
        status,
        turnOrdinal: Number(reservation.turn_ordinal),
        contextEpoch: Number(state?.contextEpoch ?? 0),
        seasonContextId: reservation.season_context_id,
        recordedAt: input.recordedAt ?? this._time()
      });
      run(this.database.prepare(`
        INSERT INTO quick_tool_turn_records (
          scope_key, conversation_id, record_id, snapshot_id, request_id,
          request_fingerprint, turn_ordinal, context_epoch, season_context_id,
          status, operation, record_json, recorded_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `), [
        scopeKey, conversationId, record.recordId, requestId,
        reservation.request_fingerprint, record.turnOrdinal, record.contextEpoch,
        record.seasonContextId, record.status, record.operation,
        JSON.stringify(record), record.recordedAt
      ]);
      const now = this._time();
      run(this.database.prepare(`
        UPDATE quick_tool_request_reservations SET
          status = ?, completed_at = ?, terminal_reason = ?, updated_at = ?
        WHERE scope_key = ? AND conversation_id = ? AND request_id = ?
      `), [status, now, String(input.failureCode ?? input.warning ?? status), now, scopeKey, conversationId, requestId]);
      run(this.database.prepare(`
        UPDATE quick_tool_bridge_states SET
          next_turn_ordinal = MAX(next_turn_ordinal, ?),
          state_version = state_version + 1,
          updated_at = ?
        WHERE scope_key = ? AND conversation_id = ?
      `), [record.turnOrdinal + 1, now, scopeKey, conversationId]);
      this._prune(scopeKey, conversationId);
      return { record, snapshot: null, replay: false };
    });
  }

  _recoverStaleQuickTasks(scopeKey, conversationId) {
    const nowMs = this.now();
    const candidates = all(this.database.prepare(`
      SELECT * FROM quick_tool_request_reservations
      WHERE scope_key = ? AND conversation_id = ?
        AND status IN ('reserved', 'running')
      ORDER BY turn_ordinal
    `), [scopeKey, conversationId]);
    const staleReservations = candidates.filter((reservation) => {
      const deadlineMs = Date.parse(reservation.deadline_at)
        || (Date.parse(reservation.updated_at) + this.quickTaskDeadlineMs);
      return Number.isFinite(deadlineMs) && deadlineMs + this.staleGraceMs <= nowMs;
    });
    for (const reservation of staleReservations) {
      const existing = get(this.database.prepare(`
        SELECT 1 FROM quick_tool_turn_records
        WHERE scope_key = ? AND conversation_id = ? AND request_id = ?
      `), [scopeKey, conversationId, reservation.request_id]);
      if (existing) continue;
      const state = this._state(scopeKey, conversationId);
      const record = createQuickToolTerminalRecord({
        scopeKey,
        conversationId,
        requestId: reservation.request_id,
        quickTask: {
          id: "unknown",
          operation: "unknown",
          arguments: {}
        },
        status: "abandoned",
        turnOrdinal: Number(reservation.turn_ordinal),
        contextEpoch: Number(state?.contextEpoch ?? 0),
        seasonContextId: reservation.season_context_id,
        warning: "quick_task_abandoned",
        failureCode: "quick_task_stale_deadline",
        recordedAt: this._time()
      });
      run(this.database.prepare(`
        INSERT INTO quick_tool_turn_records (
          scope_key, conversation_id, record_id, snapshot_id, request_id,
          request_fingerprint, turn_ordinal, context_epoch, season_context_id,
          status, operation, record_json, recorded_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'abandoned', ?, ?, ?)
      `), [
        scopeKey, conversationId, record.recordId, reservation.request_id,
        reservation.request_fingerprint, record.turnOrdinal, record.contextEpoch,
        record.seasonContextId, record.operation, JSON.stringify(record), record.recordedAt
      ]);
      run(this.database.prepare(`
        UPDATE quick_tool_request_reservations SET
          status = 'abandoned', completed_at = ?, terminal_reason = 'quick_task_stale_deadline', updated_at = ?
        WHERE scope_key = ? AND conversation_id = ? AND request_id = ?
      `), [this._time(), this._time(), scopeKey, conversationId, reservation.request_id]);
      run(this.database.prepare(`
        UPDATE quick_tool_bridge_states SET
          next_turn_ordinal = MAX(next_turn_ordinal, ?),
          state_version = state_version + 1,
          updated_at = ?
        WHERE scope_key = ? AND conversation_id = ?
      `), [record.turnOrdinal + 1, this._time(), scopeKey, conversationId]);
    }
    return staleReservations.length;
  }

  async recoverStaleQuickTasks(input = {}) {
    const scopeKey = String(input.scopeKey);
    const conversationId = String(input.conversationId);
    return this._transaction(() => this._recoverStaleQuickTasks(scopeKey, conversationId));
  }

  _prune(scopeKey, conversationId) {
    const now = new Date(this.now()).toISOString();
    const stale = all(this.database.prepare(`
      SELECT record_id FROM quick_tool_turn_records
      WHERE scope_key = ? AND conversation_id = ?
      ORDER BY turn_ordinal DESC
    `), [scopeKey, conversationId]).map((row) => row.record_id).slice(MAX_CONVERSATION_BRIDGE_RECORDS);
    const expired = all(this.database.prepare(`
      SELECT record_id FROM quick_tool_evidence_snapshots
      WHERE scope_key = ? AND conversation_id = ? AND expires_at <= ?
    `), [scopeKey, conversationId, now]).map((row) => row.record_id);
    const oldTerminal = all(this.database.prepare(`
      SELECT record_id FROM quick_tool_turn_records
      WHERE scope_key = ? AND conversation_id = ? AND snapshot_id IS NULL
        AND recorded_at <= ?
    `), [scopeKey, conversationId, new Date(this.now() - 7 * 24 * 60 * 60 * 1000).toISOString()])
      .map((row) => row.record_id);
    for (const recordId of new Set([...stale, ...expired, ...oldTerminal])) {
      run(this.database.prepare(`
        DELETE FROM quick_tool_turn_records
        WHERE scope_key = ? AND conversation_id = ? AND record_id = ?
      `), [scopeKey, conversationId, recordId]);
      run(this.database.prepare(`
        DELETE FROM quick_tool_evidence_snapshots
        WHERE scope_key = ? AND conversation_id = ? AND record_id = ?
      `), [scopeKey, conversationId, recordId]);
    }
    run(this.database.prepare(`
      UPDATE quick_tool_bridge_states SET active_record_id = NULL
      WHERE scope_key = ? AND conversation_id = ?
        AND active_record_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM quick_tool_turn_records record
          WHERE record.scope_key = quick_tool_bridge_states.scope_key
            AND record.conversation_id = quick_tool_bridge_states.conversation_id
            AND record.record_id = quick_tool_bridge_states.active_record_id
        )
    `), [scopeKey, conversationId]);
  }

  async load(input = {}) {
    const scopeKey = String(input.scopeKey);
    const conversationId = String(input.conversationId);
    this._transaction(() => this._prune(scopeKey, conversationId));
    const state = this._state(scopeKey, conversationId);
    if (!state) return {
      schemaVersion: QUICK_TOOL_BRIDGE_STATE_SCHEMA_VERSION,
      scopeKey,
      conversationId,
      contextEpoch: 0,
      nextTurnOrdinal: 1,
      activeTurnOrdinal: null,
      activeRecordId: null,
      stateVersion: 0,
      seasonContextId: input.seasonContextId ?? null,
      pendingClarification: null,
      records: [],
      snapshots: []
    };
    const rows = all(this.database.prepare(`
      SELECT record_json FROM quick_tool_turn_records
      WHERE scope_key = ? AND conversation_id = ?
      ORDER BY turn_ordinal DESC LIMIT ?
    `), [scopeKey, conversationId, MAX_CONVERSATION_BRIDGE_RECORDS]);
    const records = rows.map((row) => parseJson(row.record_json)).filter(Boolean);
    const snapshots = records.map((record) => get(this.database.prepare(`
      SELECT snapshot_json FROM quick_tool_evidence_snapshots
      WHERE scope_key = ? AND conversation_id = ? AND snapshot_id = ?
    `), [scopeKey, conversationId, record.snapshotId]))
      .map((row) => parseJson(row?.snapshot_json)).filter(Boolean);
    return { ...state, records, snapshots };
  }

  async advanceContextEpoch(input = {}) {
    const scopeKey = String(input.scopeKey);
    const conversationId = String(input.conversationId);
    const seasonContextId = String(input.seasonContextId ?? "unknown");
    return this._transaction(() => {
      const state = this._ensureState(scopeKey, conversationId, seasonContextId);
      const seasonChanged = Boolean(state.seasonContextId && state.seasonContextId !== seasonContextId);
      if (input.startNewTask !== true && !seasonChanged) return state;
      run(this.database.prepare(`
        UPDATE quick_tool_bridge_states SET
          context_epoch = context_epoch + 1,
          active_record_id = NULL,
          active_turn_ordinal = next_turn_ordinal - 1,
          state_version = state_version + 1,
          season_context_id = ?,
          pending_clarification_json = NULL,
          updated_at = ?
        WHERE scope_key = ? AND conversation_id = ?
      `), [seasonContextId, this._time(), scopeKey, conversationId]);
      return this._state(scopeKey, conversationId);
    });
  }

  async saveClarification(input = {}) {
    const scopeKey = String(input.scopeKey);
    const conversationId = String(input.conversationId);
    const seasonContextId = String(input.seasonContextId ?? "unknown");
    return this._transaction(() => {
      this._ensureState(scopeKey, conversationId, seasonContextId);
      run(this.database.prepare(`
        UPDATE quick_tool_bridge_states SET
          pending_clarification_json = ?,
          state_version = state_version + 1,
          updated_at = ?
        WHERE scope_key = ? AND conversation_id = ?
      `), [JSON.stringify(input.clarification ?? null), this._time(), scopeKey, conversationId]);
      return this._state(scopeKey, conversationId);
    });
  }

  close() {
    if (this.ownsDatabase) this.database.close?.();
  }
}
