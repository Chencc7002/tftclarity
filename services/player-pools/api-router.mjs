import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  DEFAULT_DB_PATH,
  openDatabase,
  initSchema,
  createPool,
  renamePool,
  setPoolShareCode,
  getPoolByShareCode,
  deletePool,
  poolExists,
  listOwnedPools,
  getPoolPlayers,
  countPoolPlayers,
  removePlayerFromPool,
  ingestExternalPlayerMatches,
  registerPlayer,
  collectPlayer,
  slugify
} from "../opgg/collector.mjs";
import { aggregatePool, getPoolWindow } from "../opgg/aggregator.mjs";
import { localizeAggregate } from "../opgg/localization.mjs";
import { createOpggClient } from "../opgg/mcp-client.mjs";
import { createPlayerMatchMcpClient } from "../metatft-player/mcp-client.mjs";

const MAX_POOLS_PER_OWNER = 2;
const MAX_PLAYERS_PER_POOL = 15;
const MIN_PLAYERS_PER_POOL = 1;
const SEED_PATH = resolve(process.cwd(), "data", "pbe-player-pool-seed.json");
const SHARE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const SHARE_CODE_LENGTH = 8;

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function publicPool(pool, players = []) {
  return {
    id: pool.id,
    name: pool.name,
    environment: pool.environment,
    region: pool.region,
    season: pool.season,
    provider: pool.provider,
    shareCode: pool.shareCode ?? null,
    memberCount: pool.memberCount ?? players.length,
    maxMembers: MAX_PLAYERS_PER_POOL,
    createdAt: pool.createdAt,
    players
  };
}

function createUniqueShareCode(database) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
    let code = "";
    for (let index = 0; index < SHARE_CODE_LENGTH; index += 1) {
      code += SHARE_CODE_ALPHABET[bytes[index] % SHARE_CODE_ALPHABET.length];
    }
    if (!getPoolByShareCode(database, code)) return code;
  }
  throw new Error("POOL_SHARE_CODE_GENERATION_FAILED");
}

function ensurePoolShareCode(database, pool) {
  if (pool.shareCode) return pool;
  return setPoolShareCode(database, pool.id, createUniqueShareCode(database));
}

function ownedPool(database, poolId, ownerId) {
  return listOwnedPools(database, ownerId).find((pool) => pool.id === poolId) ?? null;
}

function sampleTier(count) {
  if (count < 10) return "insufficient";
  if (count < 30) return "low_sample";
  return "normal";
}

function poolStats(database, pool) {
  const result = localizeAggregate(aggregatePool(database, {
    poolId: pool.id,
    region: pool.region,
    perPlayerLimit: 20
  }));
  const rows = getPoolWindow(database, {
    poolId: pool.id,
    region: pool.region,
    patch: result.overview.currentPatch,
    perPlayerLimit: 20
  }).rows;
  const placements = rows.map((row) => row.placement).filter(Number.isFinite);
  const timeValues = rows.map((row) => Date.parse(row.gameDatetime)).filter(Number.isFinite);
  const compPlayerUsage = new Map();
  for (const row of rows) {
    if (!row.compFamilySignature) continue;
    const player = compPlayerUsage.get(row.playerId) ?? { total: 0, comps: new Map() };
    player.total += 1;
    player.comps.set(row.compFamilySignature, (player.comps.get(row.compFamilySignature) ?? 0) + 1);
    compPlayerUsage.set(row.playerId, player);
  }
  const playerBalancedByComp = new Map();
  for (const player of compPlayerUsage.values()) {
    for (const [signature, count] of player.comps) {
      const values = playerBalancedByComp.get(signature) ?? [];
      values.push(count / player.total);
      playerBalancedByComp.set(signature, values);
    }
  }
  const compTrends = result.compTrends.map((comp) => {
    const values = playerBalancedByComp.get(comp.compSignature) ?? [];
    return {
      ...comp,
      playerBalancedUsageRate: values.length
        ? Math.round((values.reduce((sum, value) => sum + value, 0) / compPlayerUsage.size) * 1000) / 1000
        : 0
    };
  });
  return {
    pool: publicPool(pool),
    scope: {
      environment: pool.environment,
      region: pool.region,
      season: pool.season,
      provider: pool.provider,
      patch: result.overview.currentPatch
    },
    coverage: {
      playerCount: pool.memberCount,
      activePlayerCount: result.overview.playersWithData,
      matchCount: rows.length,
      uniqueMatchCount: result.overview.uniqueMatches,
      timeFrom: timeValues.length ? new Date(Math.min(...timeValues)).toISOString() : null,
      timeTo: timeValues.length ? new Date(Math.max(...timeValues)).toISOString() : null,
      patchDistribution: result.patchDistribution,
      sampleTier: sampleTier(rows.length)
    },
    performance: {
      avgPlacement: placements.length
        ? Math.round((placements.reduce((sum, value) => sum + value, 0) / placements.length) * 100) / 100
        : null,
      top4Rate: placements.length ? placements.filter((value) => value <= 4).length / placements.length : null,
      winRate: placements.length ? placements.filter((value) => value === 1).length / placements.length : null
    },
    compTrends,
    unitTrends: result.unitTrends,
    warnings: rows.length < 10 ? ["样本不足 10 场，仅展示事实数量，不生成趋势结论。"] : rows.length < 30 ? ["当前为 10–29 场小样本，请谨慎解读差异。"] : []
  };
}

function compareStats(left, right) {
  const sameSeason = left.scope.season === right.scope.season;
  const samePatch = Boolean(left.scope.patch && left.scope.patch === right.scope.patch);
  const compatibility = !sameSeason
    ? "DESCRIPTIVE_ONLY"
    : samePatch
      ? "FULL"
      : "DESCRIPTIVE_ONLY";
  const comparable = compatibility === "FULL"
    && left.coverage.matchCount >= 30
    && right.coverage.matchCount >= 30
    && left.coverage.activePlayerCount >= 3
    && right.coverage.activePlayerCount >= 3;
  const roundDelta = (a, b, scale = 100) => (
    Number.isFinite(a) && Number.isFinite(b)
      ? Math.round((a - b) * scale) / scale
      : null
  );
  const percentagePointDelta = (a, b) => (
    Number.isFinite(a) && Number.isFinite(b)
      ? Math.round((a - b) * 1000) / 10
      : null
  );
  const observed = (comp, metric) => comp?.[metric] ?? comp?.[`observed${metric[0].toUpperCase()}${metric.slice(1)}`] ?? null;
  const leftComps = new Map(left.compTrends.map((comp) => [comp.compSignature, comp]));
  const rightComps = new Map(right.compTrends.map((comp) => [comp.compSignature, comp]));
  const signatures = [...new Set([...leftComps.keys(), ...rightComps.keys()])]
    .sort((a, b) => {
      const aShare = Math.max(leftComps.get(a)?.playerMatchShare ?? 0, rightComps.get(a)?.playerMatchShare ?? 0);
      const bShare = Math.max(leftComps.get(b)?.playerMatchShare ?? 0, rightComps.get(b)?.playerMatchShare ?? 0);
      return bShare - aShare || a.localeCompare(b);
    })
    .slice(0, 20);
  const compDifferences = signatures.map((signature) => {
    const entry = leftComps.get(signature) ?? null;
    const other = rightComps.get(signature) ?? null;
    return {
      compSignature: signature,
      left: entry,
      right: other,
      usageDeltaPp: entry && other ? percentagePointDelta(entry.playerMatchShare, other.playerMatchShare) : null,
      playerBalancedDeltaPp: entry && other ? percentagePointDelta(entry.playerBalancedUsageRate, other.playerBalancedUsageRate) : null,
      avgPlacementDelta: entry && other ? roundDelta(observed(entry, "avgPlacement"), observed(other, "avgPlacement")) : null,
      top4DeltaPp: entry && other ? percentagePointDelta(observed(entry, "top4Rate"), observed(other, "top4Rate")) : null,
      winDeltaPp: entry && other ? percentagePointDelta(observed(entry, "winRate"), observed(other, "winRate")) : null,
      performanceComparable: Boolean(comparable && entry?.performanceComparable && other?.performanceComparable)
    };
  });
  const summaryDifferences = {
    avgPlacementDelta: roundDelta(left.performance?.avgPlacement, right.performance?.avgPlacement),
    top4DeltaPp: percentagePointDelta(left.performance?.top4Rate, right.performance?.top4Rate),
    winDeltaPp: percentagePointDelta(left.performance?.winRate, right.performance?.winRate),
    matchCountDelta: left.coverage.matchCount - right.coverage.matchCount,
    activePlayerCountDelta: left.coverage.activePlayerCount - right.coverage.activePlayerCount
  };
  return {
    compatibility,
    comparable,
    reasons: [
      ...(!sameSeason ? ["DIFFERENT_SEASON"] : []),
      ...(sameSeason && !samePatch ? ["NON_ALIGNED_PATCH"] : []),
      ...(!comparable ? ["SAMPLE_GATE_NOT_MET"] : [])
    ],
    statementPolicy: comparable
      ? "仅描述所选玩家池在共同统计口径下的分布差异，不代表服务器总体实力或因果关系。"
      : "仅并列展示；当前口径或样本不足，禁止生成优劣和标准化差异结论。",
    pools: [left, right],
    summaryDifferences,
    compDifferences
  };
}

function createPlayerPoolApiRouter(options = {}) {
  let databasePromise;
  const matchClient = options.matchClient ?? createPlayerMatchMcpClient(options);
  const getDatabase = async () => {
    databasePromise ??= (async () => {
      const database = await openDatabase(options.databasePath ?? DEFAULT_DB_PATH);
      initSchema(database);
      return database;
    })();
    return databasePromise;
  };

  async function addPbePlayer(database, pool, player, ownerId, source = "manual") {
    const history = await matchClient.callTool("list_matches", {
      gameName: player.gameName,
      tagLine: player.tagLine,
      environment: "pbe",
      season: "set18-pbe",
      verificationMode: "provider",
      limit: 20,
      callerKey: ownerId
    });
    if (!history.returnedCount) throw new Error("NO_S18_PBE_MATCH_EVIDENCE");
    const entry = {
      id: slugify(player.gameName, player.tagLine, "pbe"),
      displayName: `${player.gameName}#${player.tagLine}`,
      gameName: player.gameName,
      tagLine: player.tagLine,
      region: "pbe",
      active: true
    };
    const ingest = ingestExternalPlayerMatches(database, entry, history.matches, {
      poolId: pool.id,
      provider: "metatft",
      source
    });
    return { player: entry, ingest, availableCount: history.availableCount };
  }

  return async function playerPoolRouter(request, response, url, context = {}) {
    const ownerId = String(context.scope ?? "anonymous");
    const pathname = url.pathname;
    const database = await getDatabase();
    try {
      if (pathname === "/api/player-pools" && request.method === "GET") {
        const pools = listOwnedPools(database, ownerId).map((pool) => publicPool(
          pool,
          getPoolPlayers(database, pool.id, { activeOnly: false })
        ));
        return sendJson(response, 200, { pools, maxPools: MAX_POOLS_PER_OWNER, maxPlayersPerPool: MAX_PLAYERS_PER_POOL });
      }
      if (pathname === "/api/player-pools" && request.method === "POST") {
        const body = await readJsonBody(request);
        const name = String(body.name ?? "").trim();
        const environment = body.environment === "live" ? "live" : "pbe";
        const initialPlayer = {
          gameName: String(body.gameName ?? "").trim(),
          tagLine: String(body.tagLine ?? "").trim()
        };
        const pools = listOwnedPools(database, ownerId);
        if (!name) return sendJson(response, 400, { error: "POOL_NAME_REQUIRED" });
        if (!initialPlayer.gameName || !initialPlayer.tagLine) return sendJson(response, 400, { error: "INITIAL_PLAYER_REQUIRED" });
        if (pools.length >= MAX_POOLS_PER_OWNER) return sendJson(response, 409, { error: "POOL_LIMIT_REACHED" });
        if (pools.some((pool) => pool.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
          return sendJson(response, 409, { error: "POOL_NAME_EXISTS" });
        }
        const pool = createPool(database, {
          id: `player-pool-${randomUUID()}`,
          name,
          region: environment === "pbe" ? "pbe" : "na",
          environment,
          season: environment === "pbe" ? "set18-pbe" : "set17-live",
          provider: environment === "pbe" ? "metatft" : "opgg",
          ownerType: "user",
          ownerId,
          visibility: "private"
        });
        try {
          if (environment === "pbe") {
            await addPbePlayer(database, pool, initialPlayer, ownerId);
          } else {
            if (!/^NA[0-9]+$/iu.test(initialPlayer.tagLine)) throw new Error("LIVE_POOL_REQUIRES_NA_TAG");
            const entry = {
              id: slugify(initialPlayer.gameName, initialPlayer.tagLine, "na"),
              displayName: `${initialPlayer.gameName}#${initialPlayer.tagLine}`,
              ...initialPlayer,
              region: "na",
              active: true
            };
            registerPlayer(database, entry, pool.id);
            const client = createOpggClient({ clientName: "tftclarity-player-pool-create", clientVersion: "0.1.0" });
            let collect;
            try {
              await client.initialize();
              collect = await collectPlayer(client, database, entry, { forceResolve: true });
            } finally {
              await client.terminate();
            }
            if (collect.status === "error") throw new Error(collect.errorMessage ?? "COLLECTION_FAILED");
          }
        } catch (error) {
          deletePool(database, pool.id);
          return sendJson(response, 422, { error: error.code ?? error.message ?? "INITIAL_PLAYER_VERIFICATION_FAILED" });
        }
        const created = ensurePoolShareCode(database, ownedPool(database, pool.id, ownerId));
        return sendJson(response, 201, { pool: publicPool(created, getPoolPlayers(database, pool.id)) });
      }
      if (pathname === "/api/player-pools/import-code" && request.method === "POST") {
        const body = await readJsonBody(request);
        const shareCode = String(body.shareCode ?? "").trim().toUpperCase();
        if (!shareCode) return sendJson(response, 400, { error: "POOL_SHARE_CODE_REQUIRED" });
        const sourcePool = getPoolByShareCode(database, shareCode);
        if (!sourcePool || sourcePool.ownerType !== "user") return sendJson(response, 404, { error: "POOL_SHARE_CODE_NOT_FOUND" });
        const pools = listOwnedPools(database, ownerId);
        if (pools.length >= MAX_POOLS_PER_OWNER) return sendJson(response, 409, { error: "POOL_LIMIT_REACHED" });
        const sourcePlayers = getPoolPlayers(database, sourcePool.id, { activeOnly: false }).slice(0, MAX_PLAYERS_PER_POOL);
        if (!sourcePlayers.length) return sendJson(response, 409, { error: "SOURCE_POOL_EMPTY" });
        const requestedName = String(body.name ?? "").trim();
        let name = requestedName || sourcePool.name;
        if (pools.some((pool) => pool.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
          name = `${sourcePool.name} 副本`;
        }
        if (name.length > 30) name = name.slice(0, 30);
        if (pools.some((pool) => pool.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
          return sendJson(response, 409, { error: "POOL_NAME_EXISTS" });
        }
        const importedPool = createPool(database, {
          id: `player-pool-${randomUUID()}`,
          name,
          region: sourcePool.region,
          environment: sourcePool.environment,
          season: sourcePool.season,
          provider: sourcePool.provider,
          ownerType: "user",
          ownerId,
          visibility: "private"
        });
        for (const player of sourcePlayers) {
          registerPlayer(database, { ...player, active: true }, importedPool.id, new Date().toISOString(), "share_code_import");
        }
        const created = ensurePoolShareCode(database, ownedPool(database, importedPool.id, ownerId));
        return sendJson(response, 201, {
          pool: publicPool(created, getPoolPlayers(database, importedPool.id, { activeOnly: false })),
          importedFrom: shareCode
        });
      }
      if (pathname === "/api/player-pools/compare" && request.method === "GET") {
        const ids = url.searchParams.getAll("pool");
        if (ids.length !== 2) return sendJson(response, 400, { error: "SELECT_EXACTLY_TWO_POOLS" });
        const pools = ids.map((id) => ownedPool(database, id, ownerId));
        if (pools.some((pool) => !pool)) return sendJson(response, 404, { error: "POOL_NOT_FOUND" });
        return sendJson(response, 200, compareStats(poolStats(database, pools[0]), poolStats(database, pools[1])));
      }
      const importMatch = pathname.match(/^\/api\/player-pools\/([^/]+)\/import-seed$/u);
      if (importMatch && request.method === "POST") {
        const pool = ownedPool(database, importMatch[1], ownerId);
        if (!pool) return sendJson(response, 404, { error: "POOL_NOT_FOUND" });
        const seed = JSON.parse(await readFile(options.seedPath ?? SEED_PATH, "utf8"));
        const results = [];
        for (const player of seed.players ?? []) {
          if (countPoolPlayers(database, pool.id) >= MAX_PLAYERS_PER_POOL) {
            results.push({ riotId: `${player.gameName}#${player.tagLine}`, status: "skipped", reason: "POOL_PLAYER_LIMIT_REACHED" });
            continue;
          }
          try {
            const added = await addPbePlayer(database, pool, player, ownerId, "seed_import");
            results.push({ riotId: `${player.gameName}#${player.tagLine}`, status: "verified", ...added });
          } catch (error) {
            results.push({ riotId: `${player.gameName}#${player.tagLine}`, status: "unresolved", reason: error.code ?? error.message });
          }
        }
        return sendJson(response, 200, {
          supplied: results.length,
          imported: results.filter((item) => item.status === "verified").length,
          unresolved: results.filter((item) => item.status === "unresolved").length,
          results
        });
      }
      const playerMatch = pathname.match(/^\/api\/player-pools\/([^/]+)\/players(?:\/([^/]+))?$/u);
      if (playerMatch) {
        const pool = ownedPool(database, playerMatch[1], ownerId);
        if (!pool) return sendJson(response, 404, { error: "POOL_NOT_FOUND" });
        if (request.method === "DELETE" && playerMatch[2]) {
          if (countPoolPlayers(database, pool.id) <= MIN_PLAYERS_PER_POOL) {
            return sendJson(response, 409, { error: "POOL_MIN_PLAYERS_REACHED" });
          }
          removePlayerFromPool(database, pool.id, decodeURIComponent(playerMatch[2]), new Date().toISOString());
          return sendJson(response, 200, { ok: true });
        }
        if (request.method === "POST" && !playerMatch[2]) {
          if (countPoolPlayers(database, pool.id) >= MAX_PLAYERS_PER_POOL) return sendJson(response, 409, { error: "POOL_PLAYER_LIMIT_REACHED" });
          const body = await readJsonBody(request);
          const player = { gameName: String(body.gameName ?? "").trim(), tagLine: String(body.tagLine ?? "").trim() };
          if (!player.gameName || !player.tagLine) return sendJson(response, 400, { error: "PLAYER_ID_REQUIRED" });
          if (pool.environment === "pbe") {
            return sendJson(response, 201, await addPbePlayer(database, pool, player, ownerId));
          }
          if (!/^NA[0-9]+$/iu.test(player.tagLine)) return sendJson(response, 400, { error: "LIVE_POOL_REQUIRES_NA_TAG" });
          const entry = {
            id: slugify(player.gameName, player.tagLine, "na"),
            displayName: `${player.gameName}#${player.tagLine}`,
            gameName: player.gameName,
            tagLine: player.tagLine,
            region: "na",
            active: true
          };
          registerPlayer(database, entry, pool.id);
          const client = createOpggClient({ clientName: "tftclarity-player-pool", clientVersion: "0.1.0" });
          let collect;
          try {
            await client.initialize();
            collect = await collectPlayer(client, database, entry, { forceResolve: true });
          } finally {
            await client.terminate();
          }
          if (collect.status === "error") {
            removePlayerFromPool(database, pool.id, entry.id, new Date().toISOString());
            return sendJson(response, 502, { error: collect.errorMessage ?? "COLLECTION_FAILED" });
          }
          return sendJson(response, 201, { player: entry, collect });
        }
      }
      const statsMatch = pathname.match(/^\/api\/player-pools\/([^/]+)\/stats$/u);
      if (statsMatch && request.method === "GET") {
        const pool = ownedPool(database, statsMatch[1], ownerId);
        if (!pool) return sendJson(response, 404, { error: "POOL_NOT_FOUND" });
        return sendJson(response, 200, poolStats(database, pool));
      }
      const shareCodeMatch = pathname.match(/^\/api\/player-pools\/([^/]+)\/share-code$/u);
      if (shareCodeMatch && request.method === "POST") {
        const pool = ownedPool(database, shareCodeMatch[1], ownerId);
        if (!pool) return sendJson(response, 404, { error: "POOL_NOT_FOUND" });
        const shared = ensurePoolShareCode(database, pool);
        return sendJson(response, 200, { shareCode: shared.shareCode });
      }
      const poolMatch = pathname.match(/^\/api\/player-pools\/([^/]+)$/u);
      if (poolMatch && request.method === "PATCH") {
        const pool = ownedPool(database, poolMatch[1], ownerId);
        if (!pool) return sendJson(response, 404, { error: "POOL_NOT_FOUND" });
        const body = await readJsonBody(request);
        const name = String(body.name ?? "").trim();
        if (!name) return sendJson(response, 400, { error: "POOL_NAME_REQUIRED" });
        if (name.length > 30) return sendJson(response, 400, { error: "POOL_NAME_TOO_LONG" });
        const renamed = renamePool(database, pool.id, name);
        return sendJson(response, 200, { pool: publicPool(renamed, getPoolPlayers(database, pool.id, { activeOnly: false })) });
      }
      if (poolMatch && request.method === "DELETE") {
        const pool = ownedPool(database, poolMatch[1], ownerId);
        if (!pool) return sendJson(response, 404, { error: "POOL_NOT_FOUND" });
        deletePool(database, pool.id);
        return sendJson(response, 200, { ok: true });
      }
      return sendJson(response, 404, { error: "NOT_FOUND" });
    } catch (error) {
      return sendJson(response, 500, { error: error.code ?? error.message ?? "PLAYER_POOL_ERROR" });
    }
  };
}

export {
  MAX_POOLS_PER_OWNER,
  MAX_PLAYERS_PER_POOL,
  MIN_PLAYERS_PER_POOL,
  createPlayerPoolApiRouter,
  poolStats,
  compareStats,
  createUniqueShareCode
};
