import { createPlayerMatchMcpClient } from "./mcp-client.mjs";
import { buildMatchReview, buildPlayerReview } from "../opgg/review.mjs";
import { localizeMatch } from "../opgg/localization.mjs";
import {
  buildTeachingEvidence,
  generateTeaching,
  TEACHING_SYSTEM_PROMPT
} from "../opgg/teaching.mjs";
import {
  resolveCoachProviderConfig,
  createOpenAICompatibleCoachProvider
} from "../../src/coach/coach-provider.js";

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
}

function parsePlayerId(value) {
  const raw = decodeURIComponent(String(value ?? ""));
  const hash = raw.lastIndexOf("#");
  if (hash <= 0 || hash === raw.length - 1) return null;
  return { gameName: raw.slice(0, hash), tagLine: raw.slice(hash + 1) };
}

function environmentForTag(tagLine) {
  return /^PBE[0-9]+$/i.test(tagLine) ? "pbe" : "live";
}

function environmentForRequest(tagLine, query) {
  const explicit = String(query.get("environment") ?? "").trim().toLowerCase();
  if (!explicit) return { environment: environmentForTag(tagLine), explicit: false };
  if (!["pbe", "live"].includes(explicit)) return null;
  return { environment: explicit, explicit: true };
}

function playerInput(player, query, scope) {
  const route = environmentForRequest(player.tagLine, query);
  if (!route) return null;
  return {
    ...player,
    environment: route.environment,
    season: seasonFor(route.environment, query),
    callerKey: scope ?? "anonymous",
    ...(route.explicit ? { verificationMode: "provider" } : {})
  };
}

function seasonFor(environment, query) {
  if (environment === "pbe") return "set18-pbe";
  return query.get("season") ?? process.env.METATFT_NA_DEFAULT_SEASON ?? "set17-live";
}

function statusForError(error) {
  if (["INVALID_PLAYER_ID", "INVALID_TAG_FORMAT", "UNSUPPORTED_TAG_PREFIX", "ENVIRONMENT_MISMATCH", "INVALID_LIMIT"].includes(error?.code)) return 400;
  if (error?.code === "PLAYER_OR_MATCH_NOT_FOUND") return 404;
  if (error?.code === "RATE_LIMITED") return 429;
  if (error?.code === "PROVIDER_DISABLED") return 503;
  return 502;
}

function createPlayerMatchApiRouter(options = {}) {
  const client = options.client ?? createPlayerMatchMcpClient(options);

  return async function playerMatchRouter(request, response, url, context = {}) {
    if (request.method !== "GET") {
      return sendJson(response, 405, { error: "method_not_allowed" });
    }
    const pathname = url.pathname;
    const teachingMatch = pathname.match(/^\/api\/player-matches\/players\/([^/]+)\/teaching$/u);
    if (teachingMatch) {
      const player = parsePlayerId(teachingMatch[1]);
      if (!player) return sendJson(response, 400, { error: "Riot ID must use gameName#tagLine." });
      const input = playerInput(player, url.searchParams, context.scope);
      if (!input) return sendJson(response, 400, { error: "environment must be pbe or live." });
      const environment = input.environment;
      try {
        const history = await client.callTool("list_matches", { ...input, limit: 20 });
        const localizedMatches = history.matches.map(localizeMatch);
        const normalized = localizedMatches.map((entry) => ({
          playerId: `${player.gameName}#${player.tagLine}`,
          matchId: entry.matchId,
          gameDatetime: entry.playedAt,
          patchLabel: entry.patch,
          placement: entry.placement,
          level: entry.level,
          lastRound: entry.lastRound,
          playersEliminated: null,
          traits: entry.traits.map((trait) => ({ name: trait.id, displayName: trait.displayName })),
          units: entry.units.map((unit) => ({
            characterId: unit.characterId,
            displayName: unit.displayName,
            iconUrl: unit.iconUrl,
            fallbackIconUrl: unit.fallbackIconUrl,
            tier: unit.starLevel,
            items: unit.items,
            itemNames: unit.items.map((item) => item.apiName),
            itemDisplayNames: unit.items.map((item) => item.displayName)
          }))
        }));
        const requestedMatchId = url.searchParams.get("match");
        let review;
        if (requestedMatchId) {
          const selected = normalized.find((entry) => entry.matchId === requestedMatchId);
          if (!selected) return sendJson(response, 404, { error: "Match not found." });
          review = {
            windowSize: 1,
            accumulatedMatches: 1,
            accumulatedLabel: "单局终局复盘",
            sampleTier: "recent_only",
            styleNote: "单局终局状态不能代表长期稳定风格。",
            stats: {
              avgPlacement: selected.placement,
              top4Rate: selected.placement <= 4 ? 1 : 0,
              avgLevel: selected.level,
              bestPlacement: selected.placement,
              worstPlacement: selected.placement,
              completeMatches: 1
            },
            compPreferences: [],
            matches: [buildMatchReview(selected)],
            dataBoundaryNote: "MetaTFT 仅提供终局状态，不含逐回合经济、搜牌、过渡和站位记录。"
          };
        } else {
          review = buildPlayerReview(normalized, { windowSize: 20 });
        }
        const evidence = buildTeachingEvidence(review, {
          playerId: `${player.gameName}#${player.tagLine}`,
          displayName: `${player.gameName}#${player.tagLine}`,
          poolId: "metatft-pbe",
          region: environment
        });
        evidence.source = "metatft";
        evidence.provider = history.provenance;
        evidence.missingFields = [...new Set(history.matches.flatMap((entry) => entry.missingFields ?? []))];
        evidence.warnings = history.warnings;
        const config = resolveCoachProviderConfig({ timeoutMs: 60_000, maxOutputTokens: 1600 }, process.env);
        const provider = config.enabled
          ? createOpenAICompatibleCoachProvider({ ...config, systemPrompt: TEACHING_SYSTEM_PROMPT })
          : null;
        const result = await generateTeaching({
          evidence,
          provider,
          question: "请基于 MetaTFT 的 S18 PBE 终局证据复盘，不得补写缺失字段或逐回合过程。",
          strict: true,
          maxRetries: 0
        });
        return sendJson(response, 200, {
          ...result,
          provenance: history.provenance,
          missingFields: evidence.missingFields
        });
      } catch (error) {
        return sendJson(response, statusForError(error), {
          error: error?.message ?? "Player review failed.",
          code: error?.code ?? "PLAYER_MATCH_MCP_ERROR"
        });
      }
    }
    const match = pathname.match(/^\/api\/player-matches\/players\/([^/]+)(?:\/matches\/([^/]+))?$/u);
    if (!match) return sendJson(response, 404, { error: "not_found" });
    const player = parsePlayerId(match[1]);
    if (!player) return sendJson(response, 400, { error: "Riot ID must use gameName#tagLine." });

    const input = playerInput(player, url.searchParams, context.scope);
    if (!input) return sendJson(response, 400, { error: "environment must be pbe or live." });
    try {
      if (match[2]) {
        const result = await client.callTool("get_match", {
          ...input,
          matchId: decodeURIComponent(match[2])
        });
        return sendJson(response, 200, {
          ...result,
          match: localizeMatch(result.match)
        });
      }
      const requested = Number(url.searchParams.get("limit") ?? "20");
      const limit = [10, 15, 20].includes(requested) ? requested : 20;
      const result = await client.callTool("list_matches", { ...input, limit });
      return sendJson(response, 200, {
        ...result,
        matches: (result.matches ?? []).map(localizeMatch)
      });
    } catch (error) {
      return sendJson(response, statusForError(error), {
        error: error?.message ?? "Player match provider failed.",
        code: error?.code ?? "PLAYER_MATCH_MCP_ERROR"
      });
    }
  };
}

export { createPlayerMatchApiRouter, parsePlayerId, environmentForRequest };
