/**
 * OP.GG pro-pool collection CLI (Phase 1, pool-extensible).
 *
 * Pools are user-managed analysis sets. The default pool "default-na-pro"
 * is seeded once from data/na-pro-player-roster.json; afterwards the SQLite
 * DB is the source of truth and players can add/remove their own favorites.
 *
 * Examples:
 *   node scripts/opgg-collect.mjs                                   # collect default pool
 *   node scripts/opgg-collect.mjs --pool my-favorites               # collect another pool
 *   node scripts/opgg-collect.mjs --pool-list
 *   node scripts/opgg-collect.mjs --pool-create "我的关注" --pool-id my-favorites
 *   node scripts/opgg-collect.mjs --roster-add --id streamer-x --game-name "X" --tag-line NA1 --pool my-favorites
 *   node scripts/opgg-collect.mjs --roster-remove --id streamer-x --pool my-favorites
 *   node scripts/opgg-collect.mjs --roster-delete --id streamer-x
 *   node scripts/opgg-collect.mjs --roster-list
 *   node scripts/opgg-collect.mjs --seed-roster                     # import JSON manifest into a pool
 *   node scripts/opgg-collect.mjs --stats --list --players broseph-lab
 *   node scripts/opgg-collect.mjs --watch-interval-min 60
 *
 * Never prints PUUIDs. Raw OP.GG responses are parsed in memory; only
 * sanitized facts are persisted to SQLite (gitignored *.sqlite).
 */

import process from "node:process";
import { createOpggClient } from "../services/opgg/mcp-client.mjs";
import {
  DEFAULT_DB_PATH,
  DEFAULT_POOL_ID,
  DEFAULT_ROSTER_PATH,
  openDatabase,
  initSchema,
  loadRoster,
  slugify,
  collectPlayer,
  createPool,
  listPools,
  registerPlayer,
  removePlayerFromPool,
  deletePlayer,
  importRosterToPool,
  seedDefaultPool,
  getPoolPlayers,
  getPoolStats,
  listRoster,
  listPlayerMatches,
  listRecentRuns,
  pruneUnlistedPlayers,
  backfillPatchLabels
} from "../services/opgg/collector.mjs";

function argument(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((item) => item.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const flagIndex = process.argv.indexOf(`--${name}`);
  if (flagIndex !== -1 && process.argv[flagIndex + 1] !== undefined) {
    return process.argv[flagIndex + 1];
  }
  return null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePoolEntries(database, poolId, playersFilter) {
  let entries = getPoolPlayers(database, poolId, { activeOnly: true });
  if (playersFilter) {
    const allowed = new Set(
      playersFilter
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    );
    entries = entries.filter((entry) => allowed.has(entry.id.toLowerCase()));
  }
  if (entries.length === 0) {
    throw new Error(
      `No active players in pool "${poolId}"` +
        (playersFilter ? ` matching --players ${playersFilter}` : "") +
        ". Use --roster-add to add players."
    );
  }
  return entries;
}

function formatMatchRows(rows) {
  if (rows.length === 0) {
    return "  (no accumulated matches)";
  }
  return rows
    .map(
      (row) =>
        `  ${row.matchId} | ${row.gameDatetime ?? "?"} | ` +
        `placement=${row.placement ?? "?"} level=${row.level ?? "?"} ` +
        `traits=${row.traits.length} units=${row.units.length} ` +
        `round=${row.lastRound ?? "?"}`
    )
    .join("\n");
}

async function collectBatch(client, database, entries, delayMs = 1500) {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const result = await collectPlayer(client, database, entry, {
      forceResolve: hasFlag("force-resolve")
    });
    const label = `${entry.display_name ?? entry.gameName} (${entry.region})`;

    if (result.status === "error") {
      console.log(
        `[${result.playerId}] ${label}: FAILED ` +
          `(${result.errorCode ?? "?"}: ${result.errorMessage ?? "unknown"})`
      );
      continue;
    }

    const total = database
      .prepare(
        `SELECT COUNT(*) AS count FROM player_match_fact WHERE player_id = ?`
      )
      .get(entry.id).count;
    const gapFlag = result.possibleGap ? " POSSIBLE_GAP" : "";
    console.log(
      `[${result.playerId}] ${label}: returned=${result.returnedCount} ` +
        `new=${result.newMatchCount} total=${total} ` +
        `latency=${result.latencyMs}ms${gapFlag}`
    );

    if (index < entries.length - 1) {
      await sleep(delayMs);
    }
  }
}

function printRuns(database, entries, limit) {
  for (const entry of entries) {
    console.log(`Runs for ${entry.id}:`);
    for (const run of listRecentRuns(database, entry.id, { limit })) {
      console.log(
        `  #${run.id} ${run.started_at} ${run.status} ` +
          `returned=${run.returned_count} new=${run.new_match_count} ` +
          `gap=${run.possible_gap} latency=${run.latency_ms}ms`
      );
    }
  }
}

function printMatches(database, entries, limit) {
  for (const entry of entries) {
    console.log(`Matches for ${entry.id}:`);
    console.log(formatMatchRows(listPlayerMatches(database, entry.id, { limit })));
  }
}

async function main() {
  const dbPath = argument("db") ?? DEFAULT_DB_PATH;
  const rosterPath = argument("roster") ?? DEFAULT_ROSTER_PATH;
  const poolId = argument("pool") ?? DEFAULT_POOL_ID;
  const region = argument("region");
  const playersFilter = argument("players");
  const limit = Number(argument("limit") ?? "10");
  const watchMinutes = Number(argument("watch-interval-min") ?? "0");
  const delayMs = Number(argument("delay-ms") ?? "1500");
  const now = new Date().toISOString();

  const database = await openDatabase(dbPath);
  initSchema(database);
  const patchBackfilled = backfillPatchLabels(database);
  if (patchBackfilled > 0) {
    console.log(`Backfilled patch labels for ${patchBackfilled} match(es).`);
  }

  if (hasFlag("pool-list")) {
    console.log(JSON.stringify(listPools(database), null, 2));
    return;
  }

  if (hasFlag("pool-create")) {
    const name = argument("pool-create");
    if (!name) {
      throw new Error("--pool-create requires a pool name, e.g. --pool-create \"我的关注\"");
    }
    const id = argument("pool-id") ?? slugify(name, "pool", region ?? "na");
    const pool = createPool(database, {
      id,
      name,
      region: region ?? "na",
      createdAt: now
    });
    console.log(`Created pool: ${pool.id} (${pool.name})`);
    return;
  }

  if (hasFlag("seed-roster")) {
    const imported = importRosterToPool(database, loadRoster(rosterPath), poolId);
    console.log(`Imported ${imported} player(s) from roster into pool "${poolId}".`);
    return;
  }

  if (hasFlag("roster-list")) {
    console.log(JSON.stringify(listRoster(database), null, 2));
    return;
  }

  if (hasFlag("roster-add")) {
    const gameName = argument("game-name");
    const tagLine = argument("tag-line");
    if (!gameName || !tagLine) {
      throw new Error("--roster-add requires --game-name and --tag-line");
    }
    const id =
      argument("id") ?? slugify(gameName, tagLine, region ?? "na");
    const entry = {
      id,
      displayName: argument("display-name") ?? gameName,
      gameName,
      tagLine,
      region: region ?? "na",
      active: true
    };
    registerPlayer(database, entry, poolId, now);
    console.log(`Added ${id} (${gameName}#${tagLine}) to pool "${poolId}".`);
    return;
  }

  if (hasFlag("roster-remove")) {
    const id = argument("id");
    if (!id) {
      throw new Error("--roster-remove requires --id");
    }
    removePlayerFromPool(database, poolId, id, now);
    console.log(`Removed ${id} from pool "${poolId}".`);
    return;
  }

  if (hasFlag("roster-delete")) {
    const id = argument("id");
    if (!id) {
      throw new Error("--roster-delete requires --id");
    }
    const removed = deletePlayer(database, id);
    console.log(
      removed
        ? `Deleted player ${id} and its collected data.`
        : `Player ${id} not found.`
    );
    return;
  }

  if (hasFlag("prune-unlisted")) {
    const poolCount = Number(
      database.prepare(`SELECT COUNT(*) AS n FROM pool`).get().n
    );
    if (poolCount === 0) {
      console.log(
        "Prune skipped: no pools exist yet; run collection once to seed " +
          "the default pool before pruning."
      );
    } else {
      const removed = pruneUnlistedPlayers(database);
      console.log(
        `Pruned ${removed.length} player(s) not belonging to any pool: ` +
          removed.join(", ")
      );
    }
  }

  const displayOnly =
    (hasFlag("list") || hasFlag("runs")) && !hasFlag("sync");

  if (hasFlag("stats") && !hasFlag("sync")) {
    console.log(JSON.stringify(getPoolStats(database, { poolId, region: region ?? "na" }), null, 2));
    return;
  }

  if (displayOnly) {
    const entries = resolvePoolEntries(database, poolId, playersFilter);
    if (hasFlag("runs")) {
      printRuns(database, entries, limit);
    }
    if (hasFlag("list")) {
      printMatches(database, entries, limit);
    }
    return;
  }

  // Collection path: seed the default pool on first run, then collect.
  const poolCount = Number(
    database.prepare(`SELECT COUNT(*) AS n FROM pool`).get().n
  );
  if (poolCount === 0) {
    const seeded = seedDefaultPool(database, { rosterPath });
    console.log(
      seeded.seeded
        ? `Seeded default pool "${seeded.poolId}" with ${seeded.playersImported} player(s).`
        : `Seed skipped: ${seeded.reason}`
    );
  }
  if (!database.prepare(`SELECT id FROM pool WHERE id = ?`).get(poolId)) {
    throw new Error(
      `Pool "${poolId}" not found. Create it with --pool-create or use --pool ${DEFAULT_POOL_ID}.`
    );
  }

  const entries = resolvePoolEntries(database, poolId, playersFilter);
  const client = createOpggClient({
    clientName: "tftclarity-opgg-collector",
    clientVersion: "0.1.0"
  });

  try {
    await client.initialize();

    if (watchMinutes > 0) {
      console.log(
        `Watch mode: collecting ${entries.length} player(s) from pool ` +
          `"${poolId}" every ${watchMinutes} minute(s). Ctrl+C to stop.`
      );
      while (true) {
        await collectBatch(client, database, entries, delayMs);
        console.log(
          `[${new Date().toISOString()}] next poll in ${watchMinutes} min ...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, watchMinutes * 60_000)
        );
      }
    }

    await collectBatch(client, database, entries, delayMs);

    if (hasFlag("stats")) {
      console.log(JSON.stringify(getPoolStats(database, { poolId, region: region ?? "na" }), null, 2));
    }
    if (hasFlag("runs")) {
      printRuns(database, entries, limit);
    }
    if (hasFlag("list")) {
      printMatches(database, entries, limit);
    }
    if (!hasFlag("stats") && !hasFlag("list") && !hasFlag("runs")) {
      const stats = getPoolStats(database, { poolId, region: region ?? "na" });
      console.log(
        `Pool "${poolId}" stats: ` +
          `players=${stats.trackedPlayers} withData=${stats.playersWithData} ` +
          `playerMatches=${stats.playerMatchCount} ` +
          `uniqueMatches=${stats.uniqueMatchCount} ` +
          `complete=${stats.completePlayerMatchCount}`
      );
    }
  } finally {
    await client.terminate();
    database.close();
  }
}

main().catch((error) => {
  console.error(`OP.GG collect failed: ${error?.message ?? error}`);
  process.exitCode = 1;
});
