/**
 * OP.GG API router mounted inside the tftclarity small-window server
 * (paths under /api/opgg/*). Reuses the collector, aggregator, review and
 * honors modules. All responses are desensitized (no PUUIDs, no
 * other-player identities).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import {
  DEFAULT_DB_PATH,
  DEFAULT_POOL_ID,
  openDatabase,
  initSchema,
  backfillSignatures,
  backfillPatchLabels,
  listPools,
  listOwnedPools,
  getPool,
  getPoolStats,
  listPlayerMatches,
  createPool,
  poolExists,
  registerPlayer,
  removePlayerFromPool,
  getPoolPlayers,
  slugify,
  ingestExternalPlayerMatches
} from "./collector.mjs";
import { createPlayerMatchMcpClient } from "../metatft-player/mcp-client.mjs";
import { poolSeason, poolSetNumber } from "../player-pools/season.mjs";
import { matchNumber, matchUnitCost } from "./match-fields.mjs";
import { buildCompFamilySignature, buildExactBoardSignature } from "./signature.mjs";
import {
  aggregatePool,
  getPoolWindow
} from "./aggregator.mjs";
import {
  buildMatchReview,
  buildPlayerReview
} from "./review.mjs";
import {
  buildTeachingEvidence,
  generateTeaching,
  TEACHING_SYSTEM_PROMPT
} from "./teaching.mjs";
import {
  localizeAggregate,
  localizeMatch,
  localizeReview,
  localizeSignature
} from "./localization.mjs";
import {
  resolveCoachProviderConfig,
  createOpenAICompatibleCoachProvider
} from "../../src/coach/coach-provider.js";

const HONORS_PATH = resolve(process.cwd(), "data", "na-pro-player-honors.json");
const MY_REVIEW_POOL = "my-review";
const PERSONAL_POOL_PREFIX = `${MY_REVIEW_POOL}-`;

function personalPoolId(scope) {
  const normalized = String(scope ?? "").trim();
  return normalized ? `${PERSONAL_POOL_PREFIX}${normalized}` : MY_REVIEW_POOL;
}

function isPersonalPool(poolId) {
  return poolId === MY_REVIEW_POOL || String(poolId ?? "").startsWith(PERSONAL_POOL_PREFIX);
}

function authorizedPoolId(requestedPoolId, scope) {
  const requested = requestedPoolId || DEFAULT_POOL_ID;
  if (requested === MY_REVIEW_POOL) {
    return personalPoolId(scope);
  }
  if (isPersonalPool(requested) && requested !== personalPoolId(scope)) {
    return null;
  }
  return requested;
}

function accessiblePool(database, requestedPoolId, scope) {
  const poolId = authorizedPoolId(requestedPoolId, scope);
  if (!poolId) return null;
  const pool = getPool(database, poolId);
  if (!pool) return null;
  if (pool.ownerType === "user" && pool.ownerId !== String(scope ?? "anonymous")) return null;
  return pool;
}

function refreshableAccounts(database, scope) {
  const ownerId = String(scope ?? "anonymous");
  const personalId = personalPoolId(scope);
  const ownedPools = listOwnedPools(database, ownerId);
  const sources = [
    ...(poolExists(database, personalId) ? [{ id: personalId, kind: "personal" }] : []),
    ...ownedPools.map((pool) => ({ id: pool.id, kind: "player_pool" }))
  ];
  const accounts = new Map();
  const personalAccountIds = new Set();
  const poolAccountIds = new Set();

  for (const source of sources) {
    const pool = getPool(database, source.id);
    for (const player of getPoolPlayers(database, source.id, { activeOnly: true })) {
      const season = poolSeason(pool, player);
      const key = `${player.id}:${season}`;
      const existing = accounts.get(key) ?? { ...player, season, poolIds: [] };
      existing.poolIds.push(source.id);
      accounts.set(key, existing);
      if (source.kind === "personal") personalAccountIds.add(player.id);
      else poolAccountIds.add(player.id);
    }
  }

  return {
    players: [...accounts.values()],
    poolCount: ownedPools.length,
    personalAccountCount: personalAccountIds.size,
    poolAccountCount: poolAccountIds.size
  };
}

async function collectPlayerFromMetaTft(client, database, player, options = {}) {
  const isPbe = player.region === "pbe";
  const forceRefresh = options.source === "manual_refresh";
  const history = await client.callTool("list_matches", {
    gameName: player.gameName,
    tagLine: player.tagLine,
    environment: isPbe ? "pbe" : "live",
    season: options.season ?? poolSeason({}, player),
    verificationMode: "provider",
    limit: 20,
    callerKey: String(options.scope ?? "anonymous"),
    ...(forceRefresh ? { forceRefresh: true } : {})
  });
  if (forceRefresh && (history.provenance?.cacheStatus === "hit" || history.provenance?.refreshStatus !== "completed")) {
    throw new Error("服务未确认上游刷新完成，请更新 Player Match MCP 服务后重试。");
  }
  if (!history.matches?.length) {
    throw new Error("上游未返回所选赛季对局；保留已有样本，本次不标记更新成功。");
  }
  const newMatchCount = history.matches.filter((match) => !database.prepare(
    "SELECT 1 FROM player_match_fact WHERE player_id = ? AND match_id = ?"
  ).get(player.id, match.matchId)).length;
  const ingest = ingestExternalPlayerMatches(database, player, history.matches ?? [], {
    poolId: options.poolId,
    provider: "metatft",
    source: options.source ?? "manual_refresh"
  });
  return {
    status: "ok",
    provider: "metatft",
    returnedCount: Number(history.returnedCount ?? history.matches?.length ?? 0),
    ingestedCount: ingest.ingested,
    newMatchCount,
    sourceFetchedAt: history.provenance?.sourceFetchedAt ?? null,
    cacheStatus: history.provenance?.cacheStatus ?? "unknown",
    refreshStatus: history.provenance?.refreshStatus ?? "not_requested",
    latestMatchAt: history.matches.map((match) => match.playedAt).filter(Boolean).sort().at(-1) ?? null
  };
}

function poolQueryOptions(pool, query) {
  const requestedLimit = Number(query.get("per-player"));
  return {
    poolId: pool.id,
    ...(pool.season ? { setNumber: poolSetNumber(pool) } : {}),
    region: pool.region || (pool.environment === "pbe" ? "pbe" : "na"),
    perPlayerLimit: Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 20)
      : pool.environment === "pbe" ? 20 : 10
  };
}

function canAccessPlayer(database, playerId, scope) {
  return Boolean(
    database
      .prepare(
        `SELECT 1
         FROM pool_player pp
         JOIN pool p ON p.id = pp.pool_id
         WHERE pp.player_id = ?
           AND (
             pp.pool_id = ?
             OR (
               pp.pool_id != ?
               AND pp.pool_id NOT LIKE ?
               AND (p.owner_type = 'system' OR (p.owner_type = 'user' AND p.owner_id = ?))
             )
           )
         LIMIT 1`
      )
      .get(
        playerId,
        personalPoolId(scope),
        MY_REVIEW_POOL,
        `${PERSONAL_POOL_PREFIX}%`,
        String(scope ?? "anonymous")
      )
  );
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) {
    return {};
  }
  return JSON.parse(text);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

function playerMeta(database, playerId) {
  const row = database
    .prepare(
      `SELECT id, display_name, game_name, tag_line, region,
              last_successful_poll_at
       FROM tracked_player WHERE id = ?`
    )
    .get(playerId);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    displayName: row.display_name,
    gameName: row.game_name,
    tagLine: row.tag_line,
    region: row.region,
    lastSuccessfulPollAt: row.last_successful_poll_at
  };
}

function playerSummary(database, playerId) {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS matches,
              SUM(placement IS NOT NULL) AS with_placement,
              AVG(placement) AS avg_placement,
              SUM(placement <= 4) AS top4_count
       FROM player_match_fact WHERE player_id = ?`
    )
    .get(playerId);
  return {
    matchCount: Number(row?.matches ?? 0),
    avgPlacement:
      Number(row?.with_placement ?? 0) > 0
        ? Math.round((Number(row?.avg_placement) ?? 0) * 100) / 100
        : null,
    top4Rate:
      Number(row?.with_placement ?? 0) > 0
        ? Math.round(
            (Number(row?.top4_count ?? 0) / Number(row?.with_placement)) * 100
          ) / 100
        : null
  };
}

function registerPersonalAccount(
  database,
  {
    poolId,
    gameName,
    tagLine,
    region,
    now = new Date().toISOString()
  }
) {
  const normalizedRegion = String(region ?? "na").trim().toLowerCase();
  if (!["na", "pbe"].includes(normalizedRegion)) {
    throw new Error("Only PBE and NA accounts are supported.");
  }
  if (!poolExists(database, poolId)) {
    createPool(database, {
      id: poolId,
      name: "个人复盘",
      region: "na",
      environment: "live"
    });
  }
  const entry = {
    id: slugify(gameName, tagLine, normalizedRegion),
    displayName: `${gameName}#${tagLine}`,
    gameName,
    tagLine,
    region: normalizedRegion,
    active: true
  };
  registerPlayer(database, entry, poolId, now);
  return entry;
}

async function loadHonors() {
  try {
    const parsed = JSON.parse(await readFile(HONORS_PATH, "utf8"));
    return new Map(
      (parsed.honors ?? []).map((honor) => [honor.playerId, honor])
    );
  } catch {
    return new Map();
  }
}

function withHonors(honors, player) {
  return { ...player, honors: honors.get(player.id) ?? null };
}

function matchCard(row) {
  return {
    playerId: row.playerId,
    playerDisplayName: row.playerDisplayName,
    matchId: row.matchId,
    gameDatetime: row.gameDatetime,
    patchLabel: row.patchLabel,
    placement: row.placement,
    level: row.level,
    lastRound: row.lastRound,
    playersEliminated: row.playersEliminated,
    traitsCount: row.traits?.length ?? 0,
    unitsCount: row.units?.length ?? 0,
    traits: row.traits ?? [],
    units: row.units ?? [],
    compFamilySignature: row.compFamilySignature,
    exactBoardSignature: row.exactBoardSignature ?? null,
    displaySignature: row.displaySignature ?? localizeSignature(row.compFamilySignature)
  };
}

function buildSingleMatchReviewObject(target, others) {
  const single = buildMatchReview(target, {
    recentPlacements: others.map((match) => match.placement),
    recentLevels: others.map((match) => match.level)
  });
  return {
    windowSize: 10,
    accumulatedMatches: 1,
    accumulatedLabel: `单场复盘（${target.matchId}）`,
    sampleTier: "recent_only",
    styleNote: "单场教学仅解释该局终局状态，不做长期风格判断。",
    stats: {
      avgPlacement: single.facts.vsRecentAverage.recentAvgPlacement,
      top4Rate: null,
      avgLevel: single.facts.vsRecentAverage.recentAvgLevel,
      bestPlacement: single.facts.placement,
      worstPlacement: single.facts.placement,
      completeMatches: single.facts.dataComplete ? 1 : 0
    },
    compPreferences: single.facts.compFamilySignature
      ? [
          {
            compSignature: single.facts.compFamilySignature,
            count: 1,
            share: 1
          }
        ]
      : [],
    matches: [single],
    dataBoundaryNote: single.dataBoundaryNote
  };
}

function createOpggApiRouter(options = {}) {
  let databasePromise = null;
  let honorsPromise = null;
  const playerMatchClientFactory = options.playerMatchClientFactory
    ?? (() => options.playerMatchClient ?? createPlayerMatchMcpClient(options));
  const refreshJobs = new Map();

  async function expandMatch(target, player, scope) {
    const needsDetails = target.source === "metatft" && (
      !target.units?.length || !target.traits?.length
      || target.units.some((unit) => matchUnitCost(unit) === null)
      || target.traits.some((trait) => matchNumber(trait.numUnits) === null
        || (matchNumber(trait.tierCurrent) === null && matchNumber(trait.style) === null))
    );
    if (!needsDetails) return { match: target, warnings: [] };
    let client;
    try {
      const environment = player.region === "pbe" ? "pbe" : "live";
      if (!Number.isInteger(target.setNumber) || target.setNumber <= 0) throw new Error("Unknown match season");
      const season = `set${target.setNumber}-${environment}`;
      client = playerMatchClientFactory();
      const result = await client.callTool("get_match", {
        gameName: player.gameName, tagLine: player.tagLine, environment, season,
        verificationMode: "provider", matchId: target.matchId,
        callerKey: String(scope ?? "anonymous")
      });
      const detail = result.match;
      if (detail?.matchId !== target.matchId || detail.set !== `TFTSet${target.setNumber}`) {
        throw new Error("Match identity or season mismatch");
      }
      const match = {
        ...target,
        units: detail.units?.length ? detail.units.map((unit) => ({
          characterId: unit.characterId, tier: unit.starLevel ?? unit.tier ?? null,
          rarity: matchNumber(unit.rarity), cost: matchUnitCost(unit),
          itemNames: unit.items ?? unit.itemNames ?? []
        })) : target.units,
        traits: detail.traits?.length ? detail.traits.map((trait) => ({
          name: trait.id ?? trait.name, numUnits: matchNumber(trait.units ?? trait.numUnits),
          style: matchNumber(trait.style), tierCurrent: matchNumber(trait.tierCurrent)
        })) : target.traits,
        playersEliminated: detail.playersEliminated ?? target.playersEliminated,
        lastRound: detail.lastRound ?? target.lastRound
      };
      const signatureInput = { unitsJson: JSON.stringify(match.units), traitsJson: JSON.stringify(match.traits), setNumber: match.setNumber };
      match.compFamilySignature = buildCompFamilySignature(signatureInput);
      match.exactBoardSignature = buildExactBoardSignature(signatureInput);
      return { match: localizeMatch(match), warnings: [] };
    } catch {
      // The MCP owns timeout, URL allowlisting, player identity, season and cache.
      // Never replace known summary facts with an empty or mismatched detail.
      return { match: target, warnings: ["完整单局数据暂不可用，保留已取得的摘要；缺失费用或羁绊人数不作推断。"] };
    } finally {
      try { await client?.close?.(); } catch { /* Closing a transport must not discard available facts. */ }
    }
  }

  async function refreshPlayers(players, scope) {
    const key = JSON.stringify([scope, players.map((player) => `${player.id}:${player.season}`).sort()]);
    if (refreshJobs.has(key)) return refreshJobs.get(key);
    const job = (async () => {
      const results = [];
      let client;
      try {
        for (const player of players) {
          try {
            client ??= playerMatchClientFactory();
            const collect = await collectPlayerFromMetaTft(client, await getDatabase(), player, {
              poolId: player.poolIds[0], season: player.season, scope, source: "manual_refresh"
            });
            results.push({ playerId: player.id, displayName: player.displayName, poolIds: player.poolIds, ...collect });
          } catch (error) {
            results.push({ playerId: player.id, displayName: player.displayName, poolIds: player.poolIds,
              status: "error", provider: "metatft", error: String(error?.message ?? error) });
          }
        }
      } finally {
        await client?.close?.();
      }
      const refreshedCount = results.filter((result) => result.status === "ok").length;
      return { requestedCount: players.length, refreshedCount, failedCount: players.length - refreshedCount,
        newMatchCount: results.reduce((sum, result) => sum + (result.newMatchCount ?? 0), 0), results };
    })();
    refreshJobs.set(key, job);
    try { return await job; } finally { refreshJobs.delete(key); }
  }

  function getDatabase() {
    if (!databasePromise) {
      databasePromise = (async () => {
        const database = options.database ?? await openDatabase(options.databasePath ?? DEFAULT_DB_PATH);
        initSchema(database);
        backfillSignatures(database);
        backfillPatchLabels(database);
        return database;
      })();
    }
    return databasePromise;
  }

  function getHonors() {
    honorsPromise ??= loadHonors();
    return honorsPromise;
  }

  return async function opggRouter(request, response, url, context = {}) {
    const pathname = url.pathname;
    const query = url.searchParams;
    const scope = context.scope ?? null;
    const myReviewPoolId = personalPoolId(scope);

    try {
      if (pathname === "/api/opgg/pools") {
        const database = await getDatabase();
        return sendJson(
          response,
          200,
          listPools(database).filter((pool) =>
            !isPersonalPool(pool.id) &&
            (pool.ownerType !== "user" || pool.ownerId === String(scope ?? "anonymous"))
          )
        );
      }

      if (pathname === "/api/opgg/honors") {
        const honors = await getHonors();
        return sendJson(response, 200, [...honors.values()]);
      }

      const poolRefreshRoute = pathname.match(/^\/api\/opgg\/pools\/([^/]+)\/refresh$/u);
      if (poolRefreshRoute && request.method === "POST") {
        const database = await getDatabase();
        const pool = accessiblePool(database, decodeURIComponent(poolRefreshRoute[1]), scope);
        if (!pool) return sendError(response, 404, "Pool not found.");
        const players = getPoolPlayers(database, pool.id, { activeOnly: true })
          .map((player) => ({ ...player, season: poolSeason(pool, player), poolIds: [pool.id] }));
        return sendJson(response, 200, { poolId: pool.id, ...await refreshPlayers(players, scope) });
      }

      if (pathname === "/api/opgg/my-review") {
        const database = await getDatabase();
        if (!poolExists(database, myReviewPoolId)) {
          const refreshScope = refreshableAccounts(database, scope);
          return sendJson(response, 200, {
            poolId: myReviewPoolId,
            players: [],
            refreshableAccountCount: refreshScope.players.length,
            poolAccountCount: refreshScope.poolAccountCount
          });
        }
        const players = getPoolPlayers(database, myReviewPoolId, {
          activeOnly: true
        }).map((player) => ({
          id: player.id,
          displayName: player.displayName,
          gameName: player.gameName,
          tagLine: player.tagLine,
          region: player.region,
          lastSuccessfulPollAt: player.lastSuccessfulPollAt,
          summary: playerSummary(database, player.id)
        }));
        const refreshScope = refreshableAccounts(database, scope);
        return sendJson(response, 200, {
          poolId: myReviewPoolId,
          players,
          refreshableAccountCount: refreshScope.players.length,
          poolAccountCount: refreshScope.poolAccountCount
        });
      }

      if (request.method === "POST" && pathname === "/api/opgg/my-review/refresh") {
        const database = await getDatabase();
        const refreshScope = refreshableAccounts(database, scope);
        if (!refreshScope.players.length) {
          return sendJson(response, 200, {
            requestedCount: 0,
            refreshedCount: 0,
            failedCount: 0,
            poolCount: refreshScope.poolCount,
            personalAccountCount: refreshScope.personalAccountCount,
            poolAccountCount: refreshScope.poolAccountCount,
            results: []
          });
        }
        const refreshed = await refreshPlayers(refreshScope.players, scope);
        return sendJson(response, 200, {
          ...refreshed,
          poolCount: refreshScope.poolCount,
          personalAccountCount: refreshScope.personalAccountCount,
          poolAccountCount: refreshScope.poolAccountCount
        });
      }

      if (request.method === "POST" && pathname === "/api/opgg/players/register") {
        const database = await getDatabase();
        const body = await readJsonBody(request);
        const gameName = String(body.gameName ?? "").trim();
        const tagLine = String(body.tagLine ?? "").trim();
        const region = String(body.region ?? "na").trim().toLowerCase();
        if (!gameName || !tagLine) {
          return sendError(response, 400, "gameName and tagLine are required.");
        }
        if (!["na", "pbe"].includes(region)) {
          return sendError(response, 400, "Only PBE and NA accounts are supported.");
        }
        const entry = registerPersonalAccount(database, {
          poolId: myReviewPoolId,
          gameName,
          tagLine,
          region
        });

        const client = playerMatchClientFactory();
        let collect;
        try {
          collect = await collectPlayerFromMetaTft(client, database, entry, {
            poolId: myReviewPoolId,
            scope,
            source: "account_registration"
          });
        } catch (error) {
          return sendJson(response, 502, {
            ok: false,
            error: String(error?.message ?? error),
            collect: { status: "error", provider: "metatft" }
          });
        } finally {
          await client.close?.();
        }
        return sendJson(response, 200, {
          player: playerMeta(database, entry.id),
          collect
        });
      }

      const personalPlayerMatch = pathname.match(/^\/api\/opgg\/players\/([^/]+)$/u);
      if (request.method === "DELETE" && personalPlayerMatch) {
        const database = await getDatabase();
        const playerId = decodeURIComponent(personalPlayerMatch[1]);
        const exists = database.prepare(
          `SELECT 1 FROM pool_player WHERE pool_id = ? AND player_id = ?`
        ).get(myReviewPoolId, playerId);
        if (!exists) return sendError(response, 404, "Player not found in your account list.");
        removePlayerFromPool(database, myReviewPoolId, playerId, new Date().toISOString());
        return sendJson(response, 200, { ok: true, playerId });
      }

      if (pathname === "/api/opgg/teaching") {
        const database = await getDatabase();
        const playerId = query.get("player");
        const matchId = query.get("match");
        if (!playerId) {
          return sendError(response, 400, "Missing player query parameter.");
        }
        if (!canAccessPlayer(database, playerId, scope)) {
          return sendError(response, 404, `Player ${playerId} not found.`);
        }
        const meta = playerMeta(database, playerId);
        if (!meta) {
          return sendError(response, 404, `Player ${playerId} not found.`);
        }
        const matches = listPlayerMatches(database, playerId, { limit: 50, region: meta.region })
          .map(localizeMatch);
        let review;
        if (matchId) {
          const target = matches.find((match) => match.matchId === matchId);
          if (!target) {
            return sendError(response, 404, `Match ${matchId} not found.`);
          }
          review = buildSingleMatchReviewObject(
            target,
            matches.filter((match) => match.matchId !== matchId)
          );
        } else {
          review = buildPlayerReview(matches, {
            windowSize: Number(query.get("limit") ?? "10")
          });
        }
        const evidence = buildTeachingEvidence(review, {
          playerId,
          displayName: meta.displayName,
          poolId: DEFAULT_POOL_ID,
          region: meta.region,
          playStyleComments: []
        });
        const config = resolveCoachProviderConfig(
          {
            timeoutMs: Number(
              process.env.TFT_AGENT_OPGG_TEACHING_TIMEOUT_MS ?? 60000
            ),
            maxOutputTokens: 1600
          },
          process.env
        );
        const provider = config.enabled
          ? createOpenAICompatibleCoachProvider({
              ...config,
              systemPrompt: TEACHING_SYSTEM_PROMPT
            })
          : null;
        const result = await generateTeaching({
          evidence,
          provider,
          question: "请点评这名选手最近的战绩并给出教学建议。",
          strict: true,
          maxRetries: 0
        });
        return sendJson(response, 200, result);
      }

      if (pathname === "/api/opgg/trends") {
        const database = await getDatabase();
        const pool = accessiblePool(database, query.get("pool"), scope);
        if (!pool) {
          return sendError(response, 404, "Pool not found.");
        }
        const result = localizeAggregate(aggregatePool(database, poolQueryOptions(pool, query)));
        return sendJson(response, 200, { ...result, pool });
      }

      if (pathname === "/api/opgg/players") {
        const database = await getDatabase();
        const honors = await getHonors();
        const pool = accessiblePool(database, query.get("pool"), scope);
        if (!pool) {
          return sendError(response, 404, "Pool not found.");
        }
        const stats = getPoolStats(database, { poolId: pool.id, region: pool.region });
        const players = stats.players.map((player) => ({
          ...player,
          summary: playerSummary(database, player.id)
        }));
        return sendJson(response, 200, {
          ...stats,
          pool,
          players: players.map((player) => withHonors(honors, player))
        });
      }

      const playerMatch = pathname.match(
        /^\/api\/opgg\/players\/([^/]+)\/matches\/([^/]+)$/u
      );
      if (playerMatch) {
        const database = await getDatabase();
        const honors = await getHonors();
        const playerId = playerMatch[1];
        const matchId = playerMatch[2];
        if (!canAccessPlayer(database, playerId, scope)) {
          return sendError(response, 404, `Player ${playerId} not found.`);
        }
        const meta = playerMeta(database, playerId);
        if (!meta) return sendError(response, 404, `Player ${playerId} not found.`);
        const allMatches = listPlayerMatches(database, playerId, { limit: 50, region: meta.region })
          .map(localizeMatch);
        const target = allMatches.find((match) => match.matchId === matchId);
        if (!target) {
          return sendError(response, 404, `Match ${matchId} not found.`);
        }
        const others = allMatches.filter((match) => match.matchId !== matchId);
        const expanded = await expandMatch(target, meta, scope);
        const review = buildMatchReview(expanded.match, {
          recentPlacements: others.map((match) => match.placement),
          recentLevels: others.map((match) => match.level)
        });
        review.facts.displaySignature = localizeSignature(
          review.facts.compFamilySignature
        );
        return sendJson(response, 200, {
          player: withHonors(honors, meta),
          review,
          warnings: expanded.warnings
        });
      }

      const playerRoute = pathname.match(
        /^\/api\/opgg\/players\/([^/]+)\/(review|matches)$/u
      );
      if (playerRoute) {
        const database = await getDatabase();
        const honors = await getHonors();
        const playerId = playerRoute[1];
        if (!canAccessPlayer(database, playerId, scope)) {
          return sendError(response, 404, `Player ${playerId} not found.`);
        }
        const meta = playerMeta(database, playerId);
        if (!meta) {
          return sendError(response, 404, `Player ${playerId} not found.`);
        }
        const matches = listPlayerMatches(database, playerId, { limit: 50, region: meta.region })
          .map(localizeMatch);
        if (playerRoute[2] === "matches") {
          return sendJson(response, 200, {
            player: withHonors(honors, meta),
            matches
          });
        }
        const review = localizeReview(buildPlayerReview(matches, {
          windowSize: Number(query.get("limit") ?? (meta.region === "pbe" ? "20" : "10"))
        }));
        return sendJson(response, 200, {
          player: withHonors(honors, meta),
          review,
          playStyleComments: []
        });
      }

      if (pathname === "/api/opgg/comp") {
        const database = await getDatabase();
        const signature = query.get("sig");
        if (!signature) {
          return sendError(response, 400, "Missing sig query parameter.");
        }
        const pool = accessiblePool(database, query.get("pool"), scope);
        if (!pool) {
          return sendError(response, 404, "Pool not found.");
        }
        const window = getPoolWindow(database, poolQueryOptions(pool, query));
        const cards = window.rows
          .filter((row) => row.compFamilySignature === signature)
          .map(localizeMatch)
          .map(matchCard);
        return sendJson(response, 200, {
          poolId: pool.id,
          pool,
          signature,
          displaySignature: localizeSignature(signature),
          patch: window.patch,
          cards
        });
      }

      return sendError(response, 404, `Unknown OP.GG route: ${pathname}`);
    } catch (error) {
      return sendError(response, 500, String(error?.message ?? error));
    }
  };
}

export {
  accessiblePool,
  authorizedPoolId,
  canAccessPlayer,
  createOpggApiRouter,
  isPersonalPool,
  personalPoolId,
  registerPersonalAccount,
  poolQueryOptions
};
