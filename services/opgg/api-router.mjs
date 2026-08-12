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
  getPoolStats,
  listPlayerMatches,
  createPool,
  poolExists,
  registerPlayer,
  removePlayerFromPool,
  getPoolPlayers,
  slugify,
  collectPlayer
} from "./collector.mjs";
import { createOpggClient } from "./mcp-client.mjs";
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

function canAccessPlayer(database, playerId, scope) {
  return Boolean(
    database
      .prepare(
        `SELECT 1
         FROM pool_player
         WHERE player_id = ?
           AND (pool_id = ? OR (pool_id != ? AND pool_id NOT LIKE ?))
         LIMIT 1`
      )
      .get(
        playerId,
        personalPoolId(scope),
        MY_REVIEW_POOL,
        `${PERSONAL_POOL_PREFIX}%`
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

function createOpggApiRouter() {
  let databasePromise = null;
  let honorsPromise = null;

  function getDatabase() {
    if (!databasePromise) {
      databasePromise = (async () => {
        const database = await openDatabase(DEFAULT_DB_PATH);
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
          listPools(database).filter((pool) => !isPersonalPool(pool.id))
        );
      }

      if (pathname === "/api/opgg/honors") {
        const honors = await getHonors();
        return sendJson(response, 200, [...honors.values()]);
      }

      if (pathname === "/api/opgg/my-review") {
        const database = await getDatabase();
        if (!poolExists(database, myReviewPoolId)) {
          return sendJson(response, 200, { poolId: myReviewPoolId, players: [] });
        }
        const players = getPoolPlayers(database, myReviewPoolId, {
          activeOnly: true
        }).map((player) => ({
          id: player.id,
          displayName: player.displayName,
          gameName: player.gameName,
          tagLine: player.tagLine,
          region: player.region,
          summary: playerSummary(database, player.id)
        }));
        return sendJson(response, 200, { poolId: myReviewPoolId, players });
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
        if (region !== "na") {
          return sendError(response, 400, "The MVP currently supports NA accounts only.");
        }
        if (!poolExists(database, myReviewPoolId)) {
          createPool(database, {
            id: myReviewPoolId,
            name: "个人复盘",
            region
          });
        }
        const entry = {
          id: slugify(gameName, tagLine, region),
          displayName: `${gameName}#${tagLine}`,
          gameName,
          tagLine,
          region,
          active: true
        };
        registerPlayer(database, entry, myReviewPoolId, new Date().toISOString());

        const client = createOpggClient({
          clientName: "tftclarity-opgg-register",
          clientVersion: "0.1.0"
        });
        let collect;
        try {
          await client.initialize();
          collect = await collectPlayer(client, database, entry, {
            forceResolve: true
          });
        } finally {
          await client.terminate();
        }
        if (collect.status === "error") {
          return sendJson(response, 502, {
            ok: false,
            error: collect.errorMessage ?? "collection failed",
            collect
          });
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
        const matches = listPlayerMatches(database, playerId, { limit: 50 })
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
        const poolId = authorizedPoolId(query.get("pool"), scope);
        if (!poolId) {
          return sendError(response, 404, "Pool not found.");
        }
        const result = aggregatePool(database, {
          poolId,
          region: query.get("region") ?? "na",
          perPlayerLimit: Number(query.get("per-player") ?? "10")
        });
        return sendJson(response, 200, localizeAggregate(result));
      }

      if (pathname === "/api/opgg/players") {
        const database = await getDatabase();
        const honors = await getHonors();
        const poolId = authorizedPoolId(query.get("pool"), scope);
        if (!poolId) {
          return sendError(response, 404, "Pool not found.");
        }
        const stats = getPoolStats(database, {
          poolId,
          region: query.get("region") ?? "na"
        });
        const players = stats.players.map((player) => ({
          ...player,
          summary: playerSummary(database, player.id)
        }));
        return sendJson(response, 200, {
          ...stats,
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
        const allMatches = listPlayerMatches(database, playerId, { limit: 50 })
          .map(localizeMatch);
        const target = allMatches.find((match) => match.matchId === matchId);
        if (!target) {
          return sendError(response, 404, `Match ${matchId} not found.`);
        }
        const others = allMatches.filter((match) => match.matchId !== matchId);
        const review = buildMatchReview(target, {
          recentPlacements: others.map((match) => match.placement),
          recentLevels: others.map((match) => match.level)
        });
        review.facts.displaySignature = localizeSignature(
          review.facts.compFamilySignature
        );
        return sendJson(response, 200, {
          player: withHonors(honors, playerMeta(database, playerId)),
          review
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
        const matches = listPlayerMatches(database, playerId, { limit: 50 })
          .map(localizeMatch);
        if (playerRoute[2] === "matches") {
          return sendJson(response, 200, {
            player: withHonors(honors, meta),
            matches
          });
        }
        const review = localizeReview(buildPlayerReview(matches, {
          windowSize: Number(query.get("limit") ?? "10")
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
        const poolId = authorizedPoolId(query.get("pool"), scope);
        if (!poolId) {
          return sendError(response, 404, "Pool not found.");
        }
        const window = getPoolWindow(database, {
          poolId,
          region: query.get("region") ?? "na",
          perPlayerLimit: Number(query.get("per-player") ?? "10")
        });
        const cards = window.rows
          .filter((row) => row.compFamilySignature === signature)
          .map(localizeMatch)
          .map(matchCard);
        return sendJson(response, 200, {
          poolId,
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
  authorizedPoolId,
  canAccessPlayer,
  createOpggApiRouter,
  isPersonalPool,
  personalPoolId
};
