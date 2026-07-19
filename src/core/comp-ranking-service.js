import {
  normalizeCompsPageDataResponse,
  normalizeCompsStatsResponse
} from "../data/comp-response-adapter.js";
import { inspectOfficialCompTrendGate } from "./official-comp-trend-gate.js";

const SPECIAL_NAME_PATTERN = /(?:^|_)Augment_|UniqueCarry|HeroAugment/i;
export const METATFT_DEFAULT_MIN_PLAYRATE = 0.01;
export const CONTESTED_COMP_SELECTION_RATE = 0.60;

function baseTrait(filterId) {
  return String(filterId).replace(/_\d+$/, "");
}

function traitTier(filterId) {
  const match = String(filterId ?? "").match(/_(\d+)$/);
  return match ? Number(match[1]) : null;
}

function readableToken(apiName, catalog, entityType) {
  if (entityType === "unit") {
    return catalog?.unitByApiName?.get(apiName)?.zhName
      ?? catalog?.unitByApiName?.get(apiName)?.displayName
      ?? apiName.replace(/^TFT\d+_/, "");
  }
  const base = baseTrait(apiName);
  const record = catalog?.traitByFilterId?.get(apiName)
    ?? catalog?.traitByApiName?.get(base);
  return record?.zhName ?? record?.displayName ?? base.replace(/^TFT\d+_/, "");
}

function compName(definition, catalog) {
  const readable = definition.nameTokens
    .filter((token) => !SPECIAL_NAME_PATTERN.test(token))
    .map((token) => {
      const base = baseTrait(token);
      if (token.includes("Trait")
        || catalog?.traitByFilterId?.has(token)
        || catalog?.traitByApiName?.has(base)) {
        return readableToken(token, catalog, "trait");
      }
      return readableToken(token, catalog, "unit");
    })
    .filter(Boolean);
  if (readable.length > 0) return readable.slice(0, 2).join(" · ");
  const trait = definition.traits.find((value) => !/UniqueTrait|SummonTrait/.test(value));
  const units = definition.units.slice(0, 2).map((value) => readableToken(value, catalog, "unit"));
  return [trait ? readableToken(trait, catalog, "trait") : null, ...units]
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
}

function summarizeBuilds(definition, limit = 4) {
  const rows = [...definition.builds]
    .filter((row) => row.items.length === 3)
    .sort((a, b) => b.games - a.games || a.unitApiName.localeCompare(b.unitApiName));
  const byUnit = new Map();
  for (const row of rows) {
    if (!byUnit.has(row.unitApiName)) byUnit.set(row.unitApiName, row);
  }
  return [...byUnit.values()].slice(0, limit);
}

function metricComparator(metric) {
  if (metric === "avg_placement") {
    return (left, right) => left.stats.avgPlacement - right.stats.avgPlacement
      || left.pageOrder - right.pageOrder;
  }
  const field = metric === "win_rate"
    ? "winRate"
    : metric === "win_share"
      ? "winShare"
      : metric === "popularity"
        ? "pickRate"
        : "top4Rate";
  return (left, right) => right.stats[field] - left.stats[field]
    || left.pageOrder - right.pageOrder;
}

function emergingStrength(stats, avgPlacementChange) {
  if (!Number.isFinite(avgPlacementChange) || avgPlacementChange >= 0) return null;
  const appearanceRate = Number.isFinite(stats?.pickRate)
    ? Math.max(0, stats.pickRate * 8)
    : 0;
  return Math.abs(avgPlacementChange) * Math.sqrt(appearanceRate);
}

function selectionRate(stats) {
  return Number.isFinite(stats?.pickRate)
    ? Math.max(0, stats.pickRate * 8)
    : null;
}

function responseParts(response, options) {
  return {
    compsData: response?.compsData ?? response?.data ?? options.compsDataResponse,
    compsStats: response?.compsStats ?? response?.stats ?? options.compsStatsResponse ?? options.compsStats
  };
}

function pageVisible(definition, stats, query, minPlayrate) {
  if (definition.centroidMax !== null && definition.centroidMax < 1) return false;
  if (!query.specialMode && definition.situational) return false;
  if (Number.isFinite(stats.pickRate) && stats.pickRate * 8 < minPlayrate) return false;
  return true;
}

export function buildCompRankings(response = {}, options = {}) {
  const query = options.query ?? {};
  const catalog = options.catalog;
  const parts = responseParts(response, options);
  const pageData = normalizeCompsPageDataResponse(parts.compsData);
  const pageStats = normalizeCompsStatsResponse(parts.compsStats);
  const officialGate = response?.officialTrendGate
    ?? response?.trend?.officialGate
    ?? inspectOfficialCompTrendGate(parts.compsData);
  const definitions = new Map(pageData.definitions.map((definition) => [definition.clusterId, definition]));
  const minPlayrate = Number.isFinite(Number(options.minPlayrate))
    ? Number(options.minPlayrate)
    : METATFT_DEFAULT_MIN_PLAYRATE;
  const rejected = [...pageStats.rejected];
  const comps = [];

  for (const row of pageStats.rows) {
    const definition = definitions.get(row.clusterId);
    if (!definition) {
      rejected.push({ clusterId: row.clusterId, reason: "missing_comp_definition" });
      continue;
    }
    if (!pageVisible(definition, row.stats, query, minPlayrate)) {
      rejected.push({
        clusterId: row.clusterId,
        reason: definition.centroidMax !== null && definition.centroidMax < 1
          ? "hidden_centroid"
          : definition.situational && !query.specialMode
            ? "hidden_situational"
            : "below_metatft_playrate"
      });
      continue;
    }

    const trendAllowed = Number.isFinite(definition.avgPlacementChange)
      && Boolean(definition.trendSource);
    const visiblePlacementChange = trendAllowed ? definition.avgPlacementChange : null;
    const compSelectionRate = selectionRate(row.stats);
    const unitApiNames = [...new Set(definition.units)];
    const traitFilterIds = [...new Set(definition.traits)];

    comps.push({
      compId: `cluster:${row.clusterId}`,
      name: compName(definition, catalog),
      patch: query.patch ?? "current",
      units: unitApiNames.map((apiName) => ({
        apiName,
        name: readableToken(apiName, catalog, "unit"),
        targetStarLevel: definition.fourStarUnits.includes(apiName)
          ? 4
          : definition.threeStarUnits.includes(apiName)
            ? 3
            : null,
        starLevel: null,
        avgStarLevel: null,
        core: false,
        items: []
      })),
      traits: traitFilterIds.map((filterId) => ({
        apiName: baseTrait(filterId),
        filterId,
        name: readableToken(filterId, catalog, "trait"),
        tier: traitTier(filterId)
      })),
      coreBuilds: summarizeBuilds(definition),
      stats: {
        ...row.stats,
        selectionRate: compSelectionRate
      },
      contested: Number.isFinite(compSelectionRate)
        && compSelectionRate >= CONTESTED_COMP_SELECTION_RATE,
      trend: {
        avgPlacementChange: visiblePlacementChange,
        emergenceScore: emergingStrength(row.stats, visiblePlacementChange),
        source: trendAllowed ? definition.trendSource : null,
        comparedAt: trendAllowed ? definition.trendComparedAt : null,
        direction: Number.isFinite(visiblePlacementChange)
          ? visiblePlacementChange < 0
            ? "rising"
            : visiblePlacementChange > 0
              ? "falling"
              : "flat"
          : null,
        improving: Number.isFinite(visiblePlacementChange) && visiblePlacementChange < 0
      },
      pageOrder: row.sourceIndex,
      source: {
        endpoint: "/tft-comps-api/comps_stats",
        definitionEndpoint: "/tft-comps-api/comps_data",
        updatedAt: pageStats.updatedAt ?? pageData.updatedAt ?? null,
        clusterId: row.clusterId,
        dataClusterId: pageData.clusterId || null,
        statsClusterId: pageStats.clusterId || null
      }
    });
  }

  const minSamples = Math.max(0, Number(query.minSamples ?? 0));
  const eligible = comps.filter((comp) => comp.stats.games >= minSamples);
  const rising = eligible
    .filter((comp) => comp.trend.direction === "rising")
    .sort((left, right) => left.trend.avgPlacementChange - right.trend.avgPlacementChange
      || right.stats.games - left.stats.games
      || left.pageOrder - right.pageOrder)
    .slice(0, 5);
  const falling = eligible
    .filter((comp) => comp.trend.direction === "falling")
    .sort((left, right) => right.trend.avgPlacementChange - left.trend.avgPlacementChange
      || right.stats.games - left.stats.games
      || left.pageOrder - right.pageOrder)
    .slice(0, 5);
  const references = comps
    .filter((comp) => comp.stats.games < minSamples)
    .sort((a, b) => b.stats.games - a.stats.games || a.pageOrder - b.pageOrder)
    .slice(0, query.limit ?? 3)
    .map((comp) => ({ ...comp, lowSample: true }));
  const metricMap = {
    top4_rate: "top4Rate",
    win_rate: "winRate",
    win_share: "winShare",
    avg_placement: "avgPlacement",
    popularity: "popularity"
  };
  const rankings = { top4Rate: [], winRate: [], winShare: [], avgPlacement: [], popularity: [] };
  const rankingMetrics = query.intent === "comp_trends"
    ? ["popularity"]
    : query.popularRequested
      ? ["avg_placement", "top4_rate", "win_rate", "popularity"]
      : query.metrics ?? ["top4_rate", "win_share"];
  for (const metric of rankingMetrics) {
    const key = metricMap[metric];
    if (!key) continue;
    const limit = query.intent === "comp_trends"
      ? 10
      : query.popularRequested
        ? 21
        : query.limit ?? 5;
    rankings[key] = [...eligible]
      .sort(metricComparator(metric))
      .slice(0, limit);
  }

  return {
    type: query.intent === "comp_trends" ? "comp_trends" : "comp_rankings",
    rankings,
    rising,
    falling,
    // Keep the old key for downstream evidence and cached-result compatibility.
    improving: rising,
    references,
    trend: response?.trend ?? {
      status: pageData.definitions.some((definition) => Number.isFinite(definition.avgPlacementChange))
        ? "upstream"
        : "unavailable",
      source: pageData.definitions.some((definition) => Number.isFinite(definition.avgPlacementChange))
        ? "metatft"
        : null,
      windowHours: 72,
      threshold: 0.1,
      officialGate
    },
    query,
    source: {
      endpoint: "/tft-comps-api/comps_stats",
      definitionEndpoint: "/tft-comps-api/comps_data",
      updatedAt: pageStats.updatedAt ?? pageData.updatedAt ?? null,
      sampleSize: pageStats.totalGames,
      clusterId: pageStats.clusterId || pageData.clusterId || null,
      minPlayrate,
      risk: "MetaTFT 为第三方数据源；榜单按其 /comps 页面当前 cluster、筛选和排序规则转换，仅供决策参考。"
    },
    warnings: options.warnings ?? [],
    diagnostics: {
      inputRows: pageStats.rows.length,
      definitions: pageData.definitions.length,
      acceptedGroups: comps.length,
      rejected
    }
  };
}
