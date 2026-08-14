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

function reviewUnitItemCount(unit) {
  if (Array.isArray(unit?.items)) return unit.items.filter(Boolean).length;
  return Array.isArray(unit?.itemNames) ? unit.itemNames.filter(Boolean).length : 0;
}

function reviewCompProfile(entry) {
  const facts = entry?.facts ?? {};
  const units = Array.isArray(facts.units) ? facts.units : [];
  const carry = [...units]
    .filter((unit) => unit?.characterId || unit?.displayName)
    .sort((left, right) =>
      reviewUnitItemCount(right) - reviewUnitItemCount(left)
      || Number(right?.tier ?? 0) - Number(left?.tier ?? 0)
      || Number(right?.cost ?? 0) - Number(left?.cost ?? 0)
    )[0] ?? null;
  const traits = (facts.traits ?? [])
    .filter((trait) => {
      const rawName = String(trait?.name ?? "");
      const activated = Number(trait?.style ?? 0) > 0 || /_[0-9]+$/u.test(rawName);
      const nonUnique = !/UniqueTrait|Greenfather|ApexPredator|Emerald18/u.test(rawName);
      return activated && nonUnique;
    })
    .sort((left, right) =>
      Number(right?.numUnits ?? 0) - Number(left?.numUnits ?? 0)
      || Number(right?.style ?? 0) - Number(left?.style ?? 0)
    )
    .slice(0, 2);
  const carryName = carry?.displayName ?? carry?.characterId ?? "未识别核心";
  const traitNames = traits.map((trait) => trait.displayName ?? trait.name).filter(Boolean);
  const name = !carry
    ? "未识别阵容"
    : traitNames.length
      ? `${traitNames.join(" · ")} / ${carryName}`
      : `${carryName}核心`;
  const key = `${traits.map((trait) => String(trait.name ?? trait.displayName).replace(/_[0-9]+$/u, "")).sort().join("+")}|${carry?.characterId ?? carryName}`;
  const conclusions = (entry?.conclusions ?? []).map((item) => item?.conclusion).filter(Boolean);
  const keyPoint = conclusions.find((line) => /装备|高人口|早期淘汰|不完整/u.test(line))
    ?? conclusions.find((line) => !/近期平均名次/u.test(line))
    ?? conclusions[0]
    ?? `该局最终第${facts.placement ?? "?"}名。`;
  return { key, name, carryName, keyPoint };
}

function buildReviewDashboard(review) {
  const matches = (review?.matches ?? []).map((entry) => {
    const facts = entry?.facts ?? {};
    const profile = reviewCompProfile(entry);
    return {
      matchId: facts.matchId ?? null,
      playedAt: facts.gameDatetime ?? null,
      placement: facts.placement ?? null,
      level: facts.level ?? null,
      lastRound: facts.lastRound ?? null,
      compKey: profile.key,
      compName: profile.name,
      carryName: profile.carryName,
      keyPoint: profile.keyPoint,
      units: facts.units ?? [],
      traits: facts.traits ?? []
    };
  });
  const placements = matches.map((match) => Number(match.placement)).filter(Number.isFinite);
  const groups = new Map();
  for (const match of matches) {
    const group = groups.get(match.compKey) ?? { key: match.compKey, name: match.compName, placements: [] };
    if (Number.isFinite(Number(match.placement))) group.placements.push(Number(match.placement));
    groups.set(match.compKey, group);
  }
  const comps = [...groups.values()].map((group) => ({
    key: group.key,
    name: group.name,
    games: group.placements.length,
    share: matches.length ? group.placements.length / matches.length : 0,
    avgPlacement: group.placements.length
      ? Math.round((group.placements.reduce((sum, value) => sum + value, 0) / group.placements.length) * 100) / 100
      : null,
    top4Rate: group.placements.length
      ? group.placements.filter((value) => value <= 4).length / group.placements.length
      : null,
    winRate: group.placements.length
      ? group.placements.filter((value) => value === 1).length / group.placements.length
      : null
  })).sort((left, right) => right.games - left.games || (left.avgPlacement ?? 9) - (right.avgPlacement ?? 9));
  return {
    sample: {
      accumulatedMatches: review?.accumulatedMatches ?? matches.length,
      windowSize: review?.windowSize ?? matches.length,
      sampleTier: review?.sampleTier ?? null
    },
    stats: {
      ...(review?.stats ?? {}),
      winRate: placements.length ? placements.filter((value) => value === 1).length / placements.length : null
    },
    comps,
    matches
  };
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
          traits: entry.traits.map((trait) => ({
            name: trait.id,
            displayName: trait.displayName,
            numUnits: trait.units,
            style: trait.style
          })),
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
          dashboard: buildReviewDashboard(review),
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

export { buildReviewDashboard, createPlayerMatchApiRouter, parsePlayerId, environmentForRequest };
