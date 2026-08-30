/**
 * Phase 1 collector: OP.GG TFT match incremental collection.
 *
 * Data model follows docs/tftclarity-na-pro-player-review-trend-mvp.md:
 *   tracked_player        - manually maintained roster
 *   match_record          - one row per unique match
 *   player_match_fact     - one row per (player, match), sanitized facts
 *   collection_run        - per-player poll audit trail
 *
 * Privacy: only the tracked player's own match fields are persisted.
 * `metadata.participants` (other players' PUUIDs / Riot IDs) is never
 * stored, and the target player's PUUID is stripped from per-match JSON.
 * PUUIDs never appear in CLI output, logs, or Git.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import {
  parsePayload,
  extractPuuidFromObject,
  extractPuuidFromText
} from "./mcp-client.mjs";
import {
  buildCompFamilySignature,
  buildExactBoardSignature
} from "./signature.mjs";
import { patchLabelFromVersion } from "./patch.mjs";

const DEFAULT_DB_PATH = resolve(
  process.cwd(),
  ".cache",
  "opgg-pro-pool.sqlite"
);

const DEFAULT_ROSTER_PATH = resolve(
  process.cwd(),
  "data",
  "na-pro-player-roster.json"
);

const DEFAULT_POOL_ID = "default-na-pro";
const DEFAULT_POOL_NAME = "NA 职业选手默认池";
const PUUID_CIPHERTEXT_PREFIX = "v1";

// If every returned match is new AND the previous successful poll is older
// than this threshold, matches may have slid out of the 3-game window.
const GAP_THRESHOLD_MS =
  (Number(process.env.OPGG_GAP_THRESHOLD_MINUTES ?? "120") || 120) * 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minimal rate-limit resilience: one retry after 5s when the server reports
 * a rate limit (HTTP 429 / MCP -32029 style message).
 */
async function callWithRetry(fn) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const rateLimited =
        error?.mcpCode === 429 ||
        /rate\s*limit|too many|429/i.test(String(error?.message ?? ""));
      if (!rateLimited || attempt === 2) {
        throw error;
      }
      await sleep(5000);
    }
  }
  throw new Error("unreachable");
}

async function openDatabase(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return new DatabaseSync(filePath);
  } catch (nodeSqliteError) {
    try {
      const { default: BetterSQLite3 } = await import("better-sqlite3");
      return new BetterSQLite3(filePath);
    } catch (betterSqliteError) {
      throw new Error(
        "OP.GG collector requires Node 22+ node:sqlite or better-sqlite3. " +
          `node:sqlite: ${nodeSqliteError.message}; ` +
          `better-sqlite3: ${betterSqliteError.message}`
      );
    }
  }
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tracked_player (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      game_name TEXT NOT NULL,
      tag_line TEXT NOT NULL,
      region TEXT NOT NULL,
      puuid_encrypted TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      verified_at TEXT,
      last_successful_poll_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS match_record (
      match_id TEXT PRIMARY KEY,
      game_datetime TEXT,
      game_version TEXT,
      set_number INTEGER,
      queue_id TEXT,
      source TEXT NOT NULL DEFAULT 'opgg',
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_match_fact (
      player_id TEXT NOT NULL,
      match_id TEXT NOT NULL,
      placement INTEGER,
      level INTEGER,
      gold_left INTEGER,
      last_round INTEGER,
      players_eliminated INTEGER,
      traits_json TEXT NOT NULL,
      units_json TEXT NOT NULL,
      augments_json TEXT,
      comp_family_signature TEXT,
      exact_board_signature TEXT,
      source TEXT NOT NULL DEFAULT 'opgg',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (player_id, match_id)
    );

    CREATE TABLE IF NOT EXISTS collection_run (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      returned_count INTEGER,
      detected_match_count INTEGER,
      new_match_count INTEGER,
      possible_gap INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER,
      error_code TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS player_play_style (
      player_id TEXT PRIMARY KEY,
      comments_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pool (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT 'na',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pool_player (
      pool_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (pool_id, player_id)
    );

    CREATE INDEX IF NOT EXISTS idx_fact_player_time
      ON player_match_fact(player_id, match_id);
    CREATE INDEX IF NOT EXISTS idx_run_player_time
      ON collection_run(player_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pool_player_player
      ON pool_player(player_id);
  `);

  ensureColumn(database, "match_record", "patch_label", "TEXT");
  ensureColumn(database, "pool", "owner_type", "TEXT NOT NULL DEFAULT 'system'");
  ensureColumn(database, "pool", "owner_id", "TEXT");
  ensureColumn(database, "pool", "environment", "TEXT NOT NULL DEFAULT 'live'");
  ensureColumn(database, "pool", "season", "TEXT");
  ensureColumn(database, "pool", "provider", "TEXT");
  ensureColumn(database, "pool", "visibility", "TEXT NOT NULL DEFAULT 'system'");
  ensureColumn(database, "pool", "pool_type", "TEXT NOT NULL DEFAULT 'managed'");
  ensureColumn(database, "pool", "patch_scope", "TEXT");
  ensureColumn(database, "pool", "share_code", "TEXT");
  ensureColumn(database, "pool_player", "source", "TEXT NOT NULL DEFAULT 'manual'");
  database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_share_code
     ON pool(share_code)
     WHERE share_code IS NOT NULL`
  );
  database.prepare(
    `UPDATE tracked_player
     SET puuid_encrypted = NULL
     WHERE puuid_encrypted IS NOT NULL
       AND puuid_encrypted NOT LIKE 'v1:%'`
  ).run();
}

function ensureColumn(database, table, column, definition) {
  const columns = database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((info) => info.name);
  if (!columns.includes(column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function getMatchId(match) {
  const value = firstDefined(
    match?.metadata?.matchId,
    match?.matchId,
    match?.info?.matchId,
    match?.match_id,
    match?.info?.gameId,
    match?.gameId,
    match?.game_id
  );
  return value === undefined || value === null ? null : String(value);
}

function getGameDatetime(match) {
  const value = firstDefined(
    match?.info?.gameDatetime,
    match?.info?.gameCreation,
    match?.gameDatetime,
    match?.gameCreation
  );
  if (typeof value !== "number") {
    return null;
  }
  const ms = value < 1_000_000_000_000 ? value * 1000 : value;
  return new Date(ms).toISOString();
}

function getUnits(match) {
  return firstDefined(match?.summary?.units, match?.units);
}

function getTraits(match) {
  return firstDefined(match?.summary?.traits, match?.traits);
}

function hasUnitItems(match) {
  const units = getUnits(match);
  if (!Array.isArray(units) || units.length === 0) {
    return false;
  }
  return units.every(
    (unit) =>
      Array.isArray(unit?.itemNames) ||
      Array.isArray(unit?.items) ||
      unit?.itemIds !== undefined ||
      unit?.items !== undefined
  );
}

function cleanTraits(traits) {
  if (!Array.isArray(traits)) {
    return [];
  }
  return traits.map((trait) => ({
    name: trait?.name ?? null,
    numUnits: trait?.numUnits ?? null,
    style: trait?.style ?? null,
    tierCurrent: trait?.tierCurrent ?? null,
    tierTotal: trait?.tierTotal ?? null
  }));
}

function cleanUnits(units) {
  if (!Array.isArray(units)) {
    return [];
  }
  return units.map((unit) => {
    const rarity = Number.isFinite(Number(unit?.rarity))
      ? Number(unit.rarity)
      : null;
    return {
      characterId: unit?.characterId ?? null,
      name: unit?.name ?? null,
      rarity,
      cost: rarity === null ? null : rarity + 1,
      tier: unit?.tier ?? null,
      itemNames: Array.isArray(unit?.itemNames) ? unit.itemNames : []
    };
  });
}

/**
 * Desensitized per-match facts. Never includes metadata.participants and
 * never includes any puuid value.
 */
function buildFact(match) {
  const summary = match?.summary ?? {};
  const units = getUnits(match);
  const traits = getTraits(match);
  const setNumber = match?.info?.tftSetNumber ?? null;

  const fact = {
    matchId: getMatchId(match),
    gameDatetime: getGameDatetime(match),
    gameVersion: match?.info?.gameVersion ?? null,
    patchLabel: patchLabelFromVersion(match?.info?.gameVersion ?? null, {
      setNumber
    }),
    setNumber,
    queueId: firstDefined(match?.info?.queueId, match?.info?.tftGameType),
    placement: summary.placement ?? null,
    level: summary.level ?? null,
    goldLeft: summary.goldLeft ?? null,
    lastRound: summary.lastRound ?? null,
    playersEliminated: summary.playersEliminated ?? null,
    traitsJson: JSON.stringify(cleanTraits(traits)),
    unitsJson: JSON.stringify(cleanUnits(units)),
    augmentsJson: summary.augments ?? null,
    complete:
      summary.placement !== undefined &&
      summary.level !== undefined &&
      Array.isArray(traits) &&
      traits.length > 0 &&
      Array.isArray(units) &&
      units.length > 0 &&
      hasUnitItems(match)
  };

  fact.compFamilySignature = buildCompFamilySignature({
    traitsJson: fact.traitsJson,
    unitsJson: fact.unitsJson,
    setNumber: fact.setNumber
  });
  fact.exactBoardSignature = buildExactBoardSignature({
    traitsJson: fact.traitsJson,
    unitsJson: fact.unitsJson,
    setNumber: fact.setNumber
  });

  return fact;
}

async function resolvePlayer(client, gameName, tagLine, region) {
  const baseArgs = { game_name: gameName, tag_line: tagLine, region };
  const attempts = [
    { label: "without desired_output_fields", args: { ...baseArgs } },
    {
      label: "with desired_output_fields",
      args: {
        ...baseArgs,
        desired_output_fields: ["data.summoner.{game_name,tagline,puuid}"]
      }
    }
  ];

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const response = await callWithRetry(() =>
        client.callTool("lol_get_summoner_profile", attempt.args)
      );
      const { candidates } = parsePayload(response.result);
      const parsed =
        candidates.find((candidate) => candidate !== undefined) ??
        response.result;
      const textContents = Array.isArray(response.result?.content)
        ? response.result.content
            .filter((item) => typeof item?.text === "string")
            .map((item) => item.text)
        : [];

      const puuid =
        extractPuuidFromObject(parsed) ??
        textContents.map(extractPuuidFromText).find(Boolean) ??
        null;

      if (puuid) {
        return { puuid, usedAttempt: attempt.label };
      }
      lastError = new Error("profile response did not contain a PUUID");
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to resolve PUUID for ${gameName}#${tagLine}: ` +
      String(lastError?.message ?? "unknown")
  );
}

function puuidEncryptionSecret(env = process.env) {
  return String(env.OPGG_PUUID_ENCRYPTION_KEY ?? "").trim();
}

function isEncryptedPuuid(value) {
  return typeof value === "string" && value.startsWith(`${PUUID_CIPHERTEXT_PREFIX}:`);
}

function puuidEncryptionKey(secret) {
  return createHash("sha256").update(secret).digest();
}

function encryptPuuid(puuid, env = process.env) {
  const secret = puuidEncryptionSecret(env);
  if (!secret || !puuid) {
    return null;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", puuidEncryptionKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(puuid), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return [
    PUUID_CIPHERTEXT_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(":");
}

function decryptStoredPuuid(value, env = process.env) {
  const secret = puuidEncryptionSecret(env);
  if (!secret || !isEncryptedPuuid(value)) {
    return null;
  }
  try {
    const [, ivText, tagText, ciphertextText] = value.split(":");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      puuidEncryptionKey(secret),
      Buffer.from(ivText, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function upsertTrackedPlayer(
  database,
  entry,
  { puuid = null, verifiedAt = null, now }
) {
  const existing = database
    .prepare(`SELECT * FROM tracked_player WHERE id = ?`)
    .get(entry.id);

  const createdAt = existing?.created_at ?? now;
  const finalPuuid = puuid
    ? encryptPuuid(puuid)
    : isEncryptedPuuid(existing?.puuid_encrypted)
      ? existing.puuid_encrypted
      : null;
  const finalVerifiedAt = verifiedAt ?? existing?.verified_at ?? null;
  const active = entry.active === false ? 0 : 1;

  database
    .prepare(
      `INSERT INTO tracked_player (
         id, display_name, game_name, tag_line, region, puuid_encrypted,
         active, verified_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         game_name = excluded.game_name,
         tag_line = excluded.tag_line,
         region = excluded.region,
         puuid_encrypted = excluded.puuid_encrypted,
         active = excluded.active,
         verified_at = excluded.verified_at,
         updated_at = excluded.updated_at`
    )
    .run(
      entry.id,
      entry.displayName ?? entry.gameName,
      entry.gameName,
      entry.tagLine,
      entry.region,
      finalPuuid,
      active,
      finalVerifiedAt,
      createdAt,
      now
    );

  return database
    .prepare(`SELECT * FROM tracked_player WHERE id = ?`)
    .get(entry.id);
}

function parsePlayStyleResponse(response) {
  const { candidates, warnings } = parsePayload(response.result);
  const parsed =
    candidates.find((candidate) => candidate !== undefined) ?? {};

  const arrays = [];
  const collect = (value, path) => {
    if (Array.isArray(value)) {
      arrays.push({ path, value });
      value.forEach((item, index) =>
        collect(item, `${path}[${index}]`)
      );
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        collect(child, path ? `${path}.${key}` : key);
      }
    }
  };
  collect(parsed, "");

  let best = null;
  let bestScore = -1;
  for (const candidate of arrays) {
    if (candidate.value.length === 0) {
      continue;
    }
    const matchElements = candidate.value.filter(
      (element) =>
        element &&
        typeof element === "object" &&
        (getMatchId(element) !== null ||
          (element.summary &&
            typeof element.summary === "object" &&
            element.summary.placement !== undefined))
    );
    if (matchElements.length === 0) {
      continue;
    }
    if (matchElements.length > bestScore) {
      best = { path: candidate.path, matches: matchElements };
      bestScore = matchElements.length;
    }
  }

  // OP.GG returns play_style_comments as a catalogue of generation
  // templates, not player-specific observations. Never persist or expose
  // them as evidence about the tracked player.
  const rawComments = Array.isArray(parsed?.play_style_comments)
    ? parsed.play_style_comments
    : [];
  const playStyleComments = [];
  if (rawComments.length > 0) {
    warnings.push("Ignored OP.GG play_style_comments template catalogue.");
  }

  return { matchArray: best, playStyleComments, warnings };
}

function upsertPlayerPlayStyle(database, playerId, comments, fetchedAt) {
  database
    .prepare(
      `INSERT INTO player_play_style (player_id, comments_json, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET
         comments_json = excluded.comments_json,
         fetched_at = excluded.fetched_at`
    )
    .run(playerId, JSON.stringify(comments), fetchedAt);
}

function getPlayerPlayStyle(database, playerId) {
  const row = database
    .prepare(
      `SELECT comments_json, fetched_at
       FROM player_play_style WHERE player_id = ?`
    )
    .get(playerId);
  if (!row) {
    return null;
  }
  try {
    return {
      comments: JSON.parse(row.comments_json),
      fetchedAt: row.fetched_at
    };
  } catch {
    return null;
  }
}

function upsertMatchRecord(database, fact, fetchedAt) {
  database
    .prepare(
      `INSERT INTO match_record (
         match_id, game_datetime, game_version, patch_label, set_number, queue_id,
         source, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(match_id) DO UPDATE SET
         game_datetime = excluded.game_datetime,
         game_version = excluded.game_version,
         patch_label = excluded.patch_label,
         set_number = excluded.set_number,
         queue_id = excluded.queue_id,
         source = excluded.source,
         fetched_at = excluded.fetched_at`
    )
    .run(
      fact.matchId,
      fact.gameDatetime,
      fact.gameVersion,
      fact.patchLabel,
      fact.setNumber,
      fact.queueId === null || fact.queueId === undefined
        ? null
        : String(fact.queueId),
      fact.source ?? "opgg",
      fetchedAt
    );
}

function upsertPlayerMatchFact(database, playerId, fact, seenAt) {
  const existing = database
    .prepare(
      `SELECT match_id FROM player_match_fact
       WHERE player_id = ? AND match_id = ?`
    )
    .get(playerId, fact.matchId);

  const firstSeenAt = existing?.match_id ? undefined : seenAt;

  database
    .prepare(
      `INSERT INTO player_match_fact (
         player_id, match_id, placement, level, gold_left, last_round,
         players_eliminated, traits_json, units_json, augments_json,
         comp_family_signature, exact_board_signature, source,
         first_seen_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id, match_id) DO UPDATE SET
         placement = excluded.placement,
         level = excluded.level,
         gold_left = excluded.gold_left,
         last_round = excluded.last_round,
         players_eliminated = excluded.players_eliminated,
         traits_json = excluded.traits_json,
         units_json = excluded.units_json,
         augments_json = excluded.augments_json,
         comp_family_signature = excluded.comp_family_signature,
         exact_board_signature = excluded.exact_board_signature,
         source = excluded.source,
         last_seen_at = excluded.last_seen_at`
    )
    .run(
      playerId,
      fact.matchId,
      fact.placement,
      fact.level,
      fact.goldLeft,
      fact.lastRound,
      fact.playersEliminated,
      fact.traitsJson,
      fact.unitsJson,
      fact.augmentsJson === null || fact.augmentsJson === undefined
        ? null
        : JSON.stringify(fact.augmentsJson),
      fact.compFamilySignature,
      fact.exactBoardSignature,
      fact.source ?? "opgg",
      firstSeenAt ?? seenAt,
      seenAt
    );

  return !existing?.match_id;
}

/**
 * Refresh comp signatures for all facts so rule changes (e.g. trait
 * normalization filters) apply to already-collected rows. Small tables make
 * a full refresh trivial; null signatures stay null deterministically.
 */
function backfillSignatures(database) {
  const rows = database
    .prepare(
      `SELECT f.player_id, f.match_id, f.traits_json, f.units_json,
              m.set_number
       FROM player_match_fact f
       JOIN match_record m ON m.match_id = f.match_id`
    )
    .all();

  const statement = database.prepare(
    `UPDATE player_match_fact
     SET comp_family_signature = ?, exact_board_signature = ?
     WHERE player_id = ? AND match_id = ?`
  );

  let updated = 0;
  for (const row of rows) {
    const signatureInput = {
      traitsJson: row.traits_json,
      unitsJson: row.units_json,
      setNumber: row.set_number
    };
    statement.run(
      buildCompFamilySignature(signatureInput),
      buildExactBoardSignature(signatureInput),
      row.player_id,
      row.match_id
    );
    updated += 1;
  }
  return updated;
}

/**
 * Backfill patch labels for rows created before normalization existed.
 */
function backfillPatchLabels(database) {
  const rows = database
    .prepare(
      `SELECT match_id, game_version, set_number, patch_label
       FROM match_record
       WHERE game_version IS NOT NULL`
    )
    .all();
  const statement = database.prepare(
    `UPDATE match_record SET patch_label = ? WHERE match_id = ?`
  );
  let updated = 0;
  for (const row of rows) {
    const label = patchLabelFromVersion(row.game_version, {
      setNumber: row.set_number
    });
    if (label && label !== row.patch_label) {
      statement.run(label, row.match_id);
      updated += 1;
    }
  }
  return updated;
}

function insertCollectionRun(database, run) {
  database
    .prepare(
      `INSERT INTO collection_run (
         player_id, started_at, finished_at, status, returned_count,
         detected_match_count, new_match_count, possible_gap, latency_ms,
         error_code, error_message
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      run.playerId,
      run.startedAt,
      run.finishedAt,
      run.status,
      run.returnedCount,
      run.detectedMatchCount,
      run.newMatchCount,
      run.possibleGap ? 1 : 0,
      run.latencyMs,
      run.errorCode,
      run.errorMessage
    );
}

function sanitizeErrorMessage(value) {
  return String(value ?? "").replace(/[A-Za-z0-9_-]{30,}/g, "<redacted>");
}

/**
 * Collect one tracked player. Never throws: failures are recorded in
 * collection_run and returned as status "error".
 */
async function collectPlayer(
  client,
  database,
  entry,
  { forceResolve = false } = {}
) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const run = {
    playerId: entry.id,
    startedAt,
    finishedAt: null,
    status: "ok",
    returnedCount: 0,
    detectedMatchCount: 0,
    newMatchCount: 0,
    possibleGap: 0,
    latencyMs: null,
    errorCode: null,
    errorMessage: null
  };

  try {
    let row = database
      .prepare(`SELECT * FROM tracked_player WHERE id = ?`)
      .get(entry.id);

    let puuid = forceResolve
      ? null
      : decryptStoredPuuid(row?.puuid_encrypted ?? null);
    let verifiedAt = row?.verified_at ?? null;

    if (!puuid) {
      const resolved = await resolvePlayer(
        client,
        entry.gameName,
        entry.tagLine,
        entry.region
      );
      puuid = resolved.puuid;
      verifiedAt = startedAt;
    }

    row = upsertTrackedPlayer(database, entry, {
      puuid,
      verifiedAt,
      now: startedAt
    });

    const response = await callWithRetry(() =>
      client.callTool("tft_get_play_style", {
        region: entry.region,
        puuid
      })
    );
    run.latencyMs = Date.now() - startedMs;

    const { matchArray, warnings } =
      parsePlayStyleResponse(response);
    const matches = matchArray?.matches ?? [];
    run.returnedCount = matches.length;
    run.detectedMatchCount = matches.length;

    for (const match of matches) {
      const fact = buildFact(match);
      if (!fact.matchId) {
        continue;
      }
      upsertMatchRecord(database, fact, startedAt);
      const isNew = upsertPlayerMatchFact(database, entry.id, fact, startedAt);
      if (isNew) {
        run.newMatchCount += 1;
      }
    }

    if (
      run.returnedCount > 0 &&
      run.newMatchCount === run.returnedCount &&
      row.last_successful_poll_at
    ) {
      const gapMs = Date.now() - Date.parse(row.last_successful_poll_at);
      if (Number.isFinite(gapMs) && gapMs > GAP_THRESHOLD_MS) {
        run.possibleGap = 1;
      }
    }

    database
      .prepare(
        `UPDATE tracked_player
         SET last_successful_poll_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(startedAt, startedAt, entry.id);

    if (warnings.length > 0) {
      run.errorCode = "PARSE_WARNING";
      run.errorMessage = sanitizeErrorMessage(warnings.join("; "));
    }
  } catch (error) {
    run.status = "error";
    run.errorCode =
      String(error?.mcpCode ?? "") || error?.name || "UPSTREAM_ERROR";
    run.errorMessage = sanitizeErrorMessage(error?.message ?? error).slice(
      0,
      500
    );
  } finally {
    run.finishedAt = new Date().toISOString();
    insertCollectionRun(database, run);
  }

  return {
    playerId: run.playerId,
    status: run.status,
    returnedCount: run.returnedCount,
    detectedMatchCount: run.detectedMatchCount,
    newMatchCount: run.newMatchCount,
    possibleGap: run.possibleGap,
    latencyMs: run.latencyMs,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage
  };
}

function loadRoster(rosterPath = DEFAULT_ROSTER_PATH) {
  const raw = readFileSync(rosterPath, "utf8");
  const parsed = JSON.parse(raw);
  const players = Array.isArray(parsed.players) ? parsed.players : [];
  return players
    .filter((player) => player?.gameName && player?.tagLine)
    .map((player) => ({
      id: player.id ?? slugify(player.gameName, player.tagLine, player.region),
      displayName: player.displayName ?? player.gameName,
      gameName: player.gameName,
      tagLine: player.tagLine,
      region: player.region ?? parsed.region ?? "na",
      active: player.active !== false
    }));
}

function slugify(gameName, tagLine, region) {
  return `${gameName.toLowerCase()}-${tagLine.toLowerCase()}-${(
    region ?? "na"
  ).toLowerCase()}`;
}

function createPool(
  database,
  {
    id,
    name,
    region = "na",
    environment = region === "pbe" ? "pbe" : "live",
    season = null,
    provider = null,
    ownerType = "system",
    ownerId = null,
    visibility = ownerType === "system" ? "system" : "private",
    poolType = "managed",
    patchScope = null,
    createdAt = new Date().toISOString()
  }
) {
  database
    .prepare(
      `INSERT OR IGNORE INTO pool (
         id, name, region, created_at, owner_type, owner_id, environment,
         season, provider, visibility, pool_type, patch_scope
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      name,
      region,
      createdAt,
      ownerType,
      ownerId,
      environment,
      season,
      provider,
      visibility,
      poolType,
      patchScope
    );
  return database.prepare(`SELECT * FROM pool WHERE id = ?`).get(id);
}

function poolExists(database, poolId) {
  return Boolean(
    database.prepare(`SELECT id FROM pool WHERE id = ?`).get(poolId)
  );
}

function listPools(database) {
  return database
    .prepare(
      `SELECT p.id, p.name, p.region, p.created_at, p.owner_type, p.owner_id,
              p.environment, p.season, p.provider, p.visibility,
              p.pool_type, p.patch_scope, p.share_code,
              COUNT(pm.player_id) AS member_count,
              SUM(CASE WHEN t.active = 1 THEN 1 ELSE 0 END) AS active_member_count
       FROM pool p
       LEFT JOIN pool_player pm ON pm.pool_id = p.id
       LEFT JOIN tracked_player t ON t.id = pm.player_id
       GROUP BY p.id
       ORDER BY p.created_at`
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      region: row.region,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      environment: row.environment,
      season: row.season,
      provider: row.provider,
      visibility: row.visibility,
      poolType: row.pool_type,
      patchScope: row.patch_scope,
      shareCode: row.share_code,
      createdAt: row.created_at,
      memberCount: Number(row.member_count),
      activeMemberCount: Number(row.active_member_count ?? 0)
    }));
}

function addPlayerToPool(database, poolId, playerId, addedAt, source = "manual") {
  database
    .prepare(
      `INSERT OR IGNORE INTO pool_player (pool_id, player_id, added_at, source)
       VALUES (?, ?, ?, ?)`
    )
    .run(poolId, playerId, addedAt, source);
  database
    .prepare(`UPDATE tracked_player SET active = 1, updated_at = ? WHERE id = ?`)
    .run(addedAt, playerId);
}

function removePlayerFromPool(database, poolId, playerId, now) {
  database
    .prepare(`DELETE FROM pool_player WHERE pool_id = ? AND player_id = ?`)
    .run(poolId, playerId);
  const remaining = database
    .prepare(`SELECT COUNT(*) AS n FROM pool_player WHERE player_id = ?`)
    .get(playerId).n;
  if (Number(remaining) === 0) {
    database
      .prepare(
        `UPDATE tracked_player SET active = 0, updated_at = ? WHERE id = ?`
      )
      .run(now, playerId);
  }
}

/**
 * Upsert a player into the global registry and attach them to a pool.
 * Pools are user-managed analysis sets; the registry is shared so match
 * data collected for one pool is reused by others.
 */
function registerPlayer(
  database,
  entry,
  poolId,
  now = new Date().toISOString(),
  source = "manual"
) {
  if (!poolExists(database, poolId)) {
    throw new Error(`Pool not found: ${poolId}`);
  }
  upsertTrackedPlayer(database, entry, { now });
  addPlayerToPool(database, poolId, entry.id, now, source);
  return database
    .prepare(`SELECT * FROM tracked_player WHERE id = ?`)
    .get(entry.id);
}

function getPool(database, poolId) {
  const row = database.prepare(`SELECT * FROM pool WHERE id = ?`).get(poolId);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    environment: row.environment,
    season: row.season,
    provider: row.provider,
    visibility: row.visibility,
    poolType: row.pool_type,
    patchScope: row.patch_scope,
    shareCode: row.share_code,
    createdAt: row.created_at
  };
}

function renamePool(database, poolId, name) {
  const normalized = String(name ?? "").trim();
  if (!normalized) throw new Error("Pool name is required.");
  const result = database.prepare(`UPDATE pool SET name = ? WHERE id = ?`).run(normalized, poolId);
  return Number(result.changes) > 0 ? getPool(database, poolId) : null;
}

function setPoolShareCode(database, poolId, shareCode) {
  const normalized = String(shareCode ?? "").trim().toUpperCase();
  if (!normalized) throw new Error("Pool share code is required.");
  const result = database.prepare(`UPDATE pool SET share_code = ? WHERE id = ?`).run(normalized, poolId);
  return Number(result.changes) > 0 ? getPool(database, poolId) : null;
}

function getPoolByShareCode(database, shareCode) {
  const normalized = String(shareCode ?? "").trim().toUpperCase();
  if (!normalized) return null;
  const row = database.prepare(`SELECT id FROM pool WHERE share_code = ?`).get(normalized);
  return row ? getPool(database, row.id) : null;
}

function deletePool(database, poolId) {
  database.prepare(`DELETE FROM pool_player WHERE pool_id = ?`).run(poolId);
  const result = database.prepare(`DELETE FROM pool WHERE id = ?`).run(poolId);
  return Number(result.changes) > 0;
}

function listOwnedPools(database, ownerId) {
  return listPools(database).filter(
    (pool) => pool.ownerType === "user" && pool.ownerId === ownerId
  );
}

function countPoolPlayers(database, poolId) {
  return Number(
    database.prepare(`SELECT COUNT(*) AS n FROM pool_player WHERE pool_id = ?`).get(poolId)?.n ?? 0
  );
}

/**
 * Persist normalized match summaries from a non-OP.GG player provider so the
 * existing pool trend aggregator can operate on the same sanitized facts.
 */
function ingestExternalPlayerMatches(
  database,
  entry,
  matches,
  { poolId, provider = "metatft", source = "manual", now = new Date().toISOString() } = {}
) {
  registerPlayer(database, entry, poolId, now, source);
  let ingested = 0;
  for (const match of matches ?? []) {
    const setNumber = Number(String(match.set ?? "").match(/(\d+)/u)?.[1] ?? NaN);
    const fact = {
      matchId: String(match.matchId),
      gameDatetime: match.playedAt ?? null,
      gameVersion: match.patch ?? null,
      patchLabel: patchLabelFromVersion(match.patch, { setNumber }),
      setNumber: Number.isFinite(setNumber) ? setNumber : null,
      queueId: match.queue?.id ?? null,
      placement: match.placement ?? null,
      level: match.level ?? null,
      goldLeft: null,
      lastRound: match.lastRound ?? null,
      playersEliminated: null,
      traits: (match.traits ?? []).map((trait) => ({
        name: trait.id ?? trait.name ?? null,
        numUnits: trait.units ?? trait.numUnits ?? null,
        style: trait.style ?? 0,
        tierCurrent: trait.tierCurrent ?? trait.tier_current ?? 0
      })),
      units: (match.units ?? []).map((unit) => ({
        characterId: unit.characterId ?? null,
        tier: unit.starLevel ?? unit.tier ?? 1,
        itemNames: unit.items ?? unit.itemNames ?? []
      })),
      augments: match.augments ?? null,
      source: provider
    };
    // Profile summaries can omit a board already collected in full. Match facts
    // are immutable; an incomplete refresh must not erase that same match's evidence.
    const existing = database.prepare(
      `SELECT traits_json, units_json, augments_json FROM player_match_fact
       WHERE player_id = ? AND match_id = ?`
    ).get(entry.id, fact.matchId);
    if (existing) {
      if (!fact.units.length) fact.units = JSON.parse(existing.units_json || "[]");
      if (!fact.traits.length) fact.traits = JSON.parse(existing.traits_json || "[]");
      if (fact.augments === null && existing.augments_json) fact.augments = JSON.parse(existing.augments_json);
    }
    fact.traitsJson = JSON.stringify(fact.traits);
    fact.unitsJson = JSON.stringify(fact.units);
    fact.augmentsJson = fact.augments;
    fact.compFamilySignature = buildCompFamilySignature({
      traitsJson: JSON.stringify(fact.traits),
      unitsJson: JSON.stringify(fact.units),
      setNumber: fact.setNumber
    });
    fact.exactBoardSignature = buildExactBoardSignature({
      traitsJson: JSON.stringify(fact.traits),
      unitsJson: JSON.stringify(fact.units),
      setNumber: fact.setNumber
    });
    upsertMatchRecord(database, fact, now);
    upsertPlayerMatchFact(database, entry.id, fact, now);
    ingested += 1;
  }
  database.prepare(
    `UPDATE tracked_player
     SET verified_at = ?, last_successful_poll_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(now, now, now, entry.id);
  return { playerId: entry.id, ingested };
}

function importRosterToPool(database, roster, poolId) {
  const now = new Date().toISOString();
  let imported = 0;
  for (const entry of roster) {
    const before = database
      .prepare(
        `SELECT 1 FROM pool_player WHERE pool_id = ? AND player_id = ?`
      )
      .get(poolId, entry.id);
    registerPlayer(database, entry, poolId, now);
    if (!before) {
      imported += 1;
    }
  }
  return imported;
}

/**
 * Seed the default pool from the roster JSON only when no pool exists yet.
 * After the first seed the DB is the source of truth; the JSON is only a
 * starter manifest and edits to it will not resurrect deleted players.
 */
function seedDefaultPool(
  database,
  {
    rosterPath = DEFAULT_ROSTER_PATH,
    poolId = DEFAULT_POOL_ID,
    poolName = DEFAULT_POOL_NAME,
    region = "na"
  } = {}
) {
  const poolCount = Number(
    database.prepare(`SELECT COUNT(*) AS n FROM pool`).get().n
  );
  if (poolCount > 0) {
    return { seeded: false, reason: "pools already exist" };
  }
  createPool(database, { id: poolId, name: poolName, region });
  const playersImported = importRosterToPool(
    database,
    loadRoster(rosterPath),
    poolId
  );
  return { seeded: true, poolId, playersImported };
}

function getPoolPlayers(database, poolId, { activeOnly = true } = {}) {
  const rows = database
    .prepare(
      `SELECT t.*
       FROM tracked_player t
       JOIN pool_player pm ON pm.player_id = t.id
       WHERE pm.pool_id = ?
         ${activeOnly ? "AND t.active = 1" : ""}
       ORDER BY t.game_name`
    )
    .all(poolId);

  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    gameName: row.game_name,
    tagLine: row.tag_line,
    region: row.region,
    active: Boolean(row.active),
    verifiedAt: row.verified_at,
    lastSuccessfulPollAt: row.last_successful_poll_at
  }));
}

function listRoster(database) {
  return database
    .prepare(
      `SELECT t.id, t.display_name, t.game_name, t.tag_line, t.region,
              t.active, t.verified_at, t.last_successful_poll_at,
              t.created_at, t.updated_at,
              GROUP_CONCAT(pm.pool_id) AS pools
       FROM tracked_player t
       LEFT JOIN pool_player pm ON pm.player_id = t.id
       GROUP BY t.id
       ORDER BY t.game_name`
    )
    .all()
    .map((row) => ({
      id: row.id,
      displayName: row.display_name,
      gameName: row.game_name,
      tagLine: row.tag_line,
      region: row.region,
      active: Boolean(row.active),
      verifiedAt: row.verified_at,
      lastSuccessfulPollAt: row.last_successful_poll_at,
      pools: row.pools ? row.pools.split(",") : []
    }));
}

function deletePlayer(database, playerId) {
  database
    .prepare(`DELETE FROM player_match_fact WHERE player_id = ?`)
    .run(playerId);
  database
    .prepare(`DELETE FROM collection_run WHERE player_id = ?`)
    .run(playerId);
  database
    .prepare(`DELETE FROM pool_player WHERE player_id = ?`)
    .run(playerId);
  database
    .prepare(
      `DELETE FROM match_record
       WHERE match_id NOT IN (SELECT match_id FROM player_match_fact)`
    )
    .run();
  const result = database
    .prepare(`DELETE FROM tracked_player WHERE id = ?`)
    .run(playerId);
  return Number(result.changes) > 0;
}

function getPoolStats(database, { poolId, region = "na" } = {}) {
  if (poolId && !poolExists(database, poolId)) {
    return {
      poolId,
      region,
      exists: false,
      trackedPlayers: 0,
      activePlayers: 0,
      playersWithData: 0,
      playerMatchCount: 0,
      uniqueMatchCount: 0,
      completePlayerMatchCount: 0,
      players: []
    };
  }

  let players;
  let matchStats;

  if (poolId) {
    players = database
      .prepare(
        `SELECT t.id, t.display_name, t.game_name, t.tag_line, t.region,
                t.active, t.last_successful_poll_at
         FROM tracked_player t
         JOIN pool_player pp ON pp.player_id = t.id AND pp.pool_id = ?
         WHERE t.region = ?
         GROUP BY t.id
         ORDER BY t.game_name`
      )
      .all(poolId, region);

    matchStats = database
      .prepare(
        `SELECT
           COUNT(*) AS fact_count,
           COUNT(DISTINCT f.match_id) AS unique_match_count,
           COUNT(DISTINCT f.player_id) AS players_with_data,
           SUM(
             f.placement IS NOT NULL AND f.level IS NOT NULL
             AND f.traits_json != '[]' AND f.units_json != '[]'
           ) AS complete_count
         FROM player_match_fact f
         JOIN tracked_player t ON t.id = f.player_id
         JOIN pool_player pp ON pp.player_id = t.id AND pp.pool_id = ?
         WHERE t.region = ?`
      )
      .get(poolId, region);
  } else {
    players = database
      .prepare(
        `SELECT id, display_name, game_name, tag_line, region, active,
                last_successful_poll_at
         FROM tracked_player
         WHERE region = ?
         ORDER BY game_name`
      )
      .all(region);

    matchStats = database
      .prepare(
        `SELECT
           COUNT(*) AS fact_count,
           COUNT(DISTINCT match_id) AS unique_match_count,
           COUNT(DISTINCT player_id) AS players_with_data,
           SUM(
             placement IS NOT NULL AND level IS NOT NULL
             AND traits_json != '[]' AND units_json != '[]'
           ) AS complete_count
         FROM player_match_fact f
         JOIN tracked_player t ON t.id = f.player_id
         WHERE t.region = ?`
      )
      .get(region);
  }

  return {
    poolId: poolId ?? null,
    exists: true,
    region,
    trackedPlayers: players.length,
    activePlayers: players.filter((player) => player.active).length,
    playersWithData: Number(matchStats?.players_with_data ?? 0),
    playerMatchCount: Number(matchStats?.fact_count ?? 0),
    uniqueMatchCount: Number(matchStats?.unique_match_count ?? 0),
    completePlayerMatchCount: Number(matchStats?.complete_count ?? 0),
    players: players.map((player) => ({
      id: player.id,
      displayName: player.display_name,
      gameName: player.game_name,
      tagLine: player.tag_line,
      region: player.region,
      active: Boolean(player.active),
      lastSuccessfulPollAt: player.last_successful_poll_at
    }))
  };
}

function listPlayerMatches(
  database,
  playerId,
  { limit = 10, region = "na" } = {}
) {
  return database
    .prepare(
      `SELECT pm.match_id, pm.placement, pm.level, pm.gold_left,
              pm.last_round, pm.players_eliminated, pm.traits_json,
              pm.units_json, pm.augments_json, pm.comp_family_signature,
              pm.exact_board_signature, pm.first_seen_at, pm.last_seen_at,
              m.game_datetime, m.game_version, m.patch_label, m.set_number,
              m.queue_id
       FROM player_match_fact pm
       JOIN match_record m ON m.match_id = pm.match_id
       JOIN tracked_player p ON p.id = pm.player_id
       WHERE pm.player_id = ? AND p.region = ?
       ORDER BY m.game_datetime DESC
       LIMIT ?`
    )
    .all(playerId, region, Number(limit) || 10)
    .map((row) => ({
      matchId: row.match_id,
      gameDatetime: row.game_datetime,
      gameVersion: row.game_version,
      patchLabel: row.patch_label,
      setNumber: row.set_number,
      queueId: row.queue_id,
      placement: row.placement,
      level: row.level,
      goldLeft: row.gold_left,
      lastRound: row.last_round,
      playersEliminated: row.players_eliminated,
      traits: JSON.parse(row.traits_json),
      units: JSON.parse(row.units_json),
      augments: row.augments_json ? JSON.parse(row.augments_json) : null,
      compFamilySignature: row.comp_family_signature ?? null,
      exactBoardSignature: row.exact_board_signature ?? null,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at
    }));
}

function listRecentRuns(database, playerId, { limit = 10 } = {}) {
  return database
    .prepare(
      `SELECT id, player_id, started_at, finished_at, status,
              returned_count, detected_match_count, new_match_count,
              possible_gap, latency_ms, error_code, error_message
       FROM collection_run
       WHERE player_id = ?
       ORDER BY started_at DESC
       LIMIT ?`
    )
    .all(playerId, Number(limit) || 10);
}

/**
 * Remove tracked players that are no longer in the roster, together with
 * their facts, collection runs, and now-orphaned match records.
 */
/**
 * Remove tracked players that do not belong to any analysis pool, together
 * with their facts, collection runs, and now-orphaned match records.
 */
function pruneUnlistedPlayers(database) {
  const rows = database.prepare(`SELECT id FROM tracked_player`).all();
  const removed = [];

  for (const row of rows) {
    const inAnyPool = Number(
      database
        .prepare(`SELECT COUNT(*) AS n FROM pool_player WHERE player_id = ?`)
        .get(row.id).n
    );
    if (inAnyPool === 0) {
      if (deletePlayer(database, row.id)) {
        removed.push(row.id);
      }
    }
  }

  return removed;
}

export {
  DEFAULT_DB_PATH,
  DEFAULT_ROSTER_PATH,
  DEFAULT_POOL_ID,
  DEFAULT_POOL_NAME,
  GAP_THRESHOLD_MS,
  openDatabase,
  initSchema,
  loadRoster,
  slugify,
  collectPlayer,
  resolvePlayer,
  encryptPuuid,
  decryptStoredPuuid,
  isEncryptedPuuid,
  createPool,
  getPool,
  renamePool,
  setPoolShareCode,
  getPoolByShareCode,
  deletePool,
  poolExists,
  listPools,
  listOwnedPools,
  countPoolPlayers,
  addPlayerToPool,
  removePlayerFromPool,
  registerPlayer,
  ingestExternalPlayerMatches,
  importRosterToPool,
  seedDefaultPool,
  getPoolPlayers,
  listRoster,
  deletePlayer,
  backfillSignatures,
  backfillPatchLabels,
  getPlayerPlayStyle,
  getPoolStats,
  listPlayerMatches,
  listRecentRuns,
  pruneUnlistedPlayers
};
