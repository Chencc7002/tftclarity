import { calculatePlacementStats } from "./stats-calculator.js";
import {
  normalizeClusterDefinitions,
  normalizeCompBuildEvidence,
  normalizeExactUnitsTraitsResponse,
  parseExactCompRow
} from "../data/comp-response-adapter.js";

const NON_PLAYABLE_PATTERNS = [/(?:^|_)PVE_/i, /IvernMinion/i, /(?:^|_)Summon$/i];
const SPECIAL_NAME_PATTERN = /(?:^|_)Augment_|UniqueCarry|HeroAugment/i;

function unique(values) {
  return [...new Set(values)];
}

function isPlayableUnit(apiName) {
  return !NON_PLAYABLE_PATTERNS.some((pattern) => pattern.test(apiName));
}

function playableUnits(units) {
  return units.filter(isPlayableUnit);
}

function playableBoard(row) {
  const units = [];
  const starLevels = [];
  row.units.forEach((apiName, index) => {
    if (!isPlayableUnit(apiName)) return;
    units.push(apiName);
    starLevels.push(row.starLevels[index] ?? null);
  });
  return { units, starLevels };
}

function baseTrait(filterId) {
  return String(filterId).replace(/_\d+$/, "");
}

function traitTier(filterId) {
  const match = String(filterId ?? "").match(/_(\d+)$/);
  return match ? Number(match[1]) : null;
}

function jaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((value) => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}

function stableFingerprint(units, traits) {
  const unitKey = unique(units).sort().join("+");
  const traitKey = unique(traits.map(baseTrait)).sort().join("+");
  return `fingerprint:${unitKey}|${traitKey}`;
}

function placementCountIsUsable(value) {
  return Array.isArray(value)
    && value.length === 8
    && value.every((entry) => Number.isFinite(entry) && entry >= 0)
    && value.some((entry) => entry > 0);
}

function matchCluster(row, clusters, threshold = 0.55) {
  const units = playableUnits(row.units);
  const rowTraits = row.traits.map(baseTrait);
  const matches = clusters.map((cluster) => {
    const unitScore = jaccard(units, playableUnits(cluster.units));
    const traitScore = jaccard(rowTraits, cluster.traits.map(baseTrait));
    return { cluster, unitScore, traitScore, score: unitScore * 0.8 + traitScore * 0.2 };
  }).sort((a, b) => b.score - a.score || b.unitScore - a.unitScore || a.cluster.clusterId.localeCompare(b.cluster.clusterId));
  const best = matches[0];
  return best && best.unitScore >= threshold ? best : null;
}

function readableToken(apiName, catalog, entityType) {
  if (entityType === "unit") {
    return catalog?.unitByApiName?.get(apiName)?.zhName
      ?? catalog?.unitByApiName?.get(apiName)?.displayName
      ?? apiName.replace(/^TFT\d+_/, "");
  }
  const base = baseTrait(apiName);
  const record = catalog?.traitByFilterId?.get(apiName)
    ?? [...(catalog?.traits ?? [])].find((item) => item.apiName === base);
  return record?.zhName ?? record?.displayName ?? base.replace(/^TFT\d+_/, "");
}

function compName(group, catalog) {
  const tokens = group.cluster?.nameTokens?.filter((token) => !SPECIAL_NAME_PATTERN.test(token)) ?? [];
  const readable = tokens.map((token) => {
    const traitToken = baseTrait(token);
    if (token.includes("Trait")
      || catalog?.traitByFilterId?.has(token)
      || catalog?.traitByApiName?.has(traitToken)) {
      return readableToken(token, catalog, "trait");
    }
    return readableToken(token, catalog, "unit");
  }).filter(Boolean);
  if (readable.length > 0) return readable.slice(0, 2).join(" · ");
  const trait = group.representative.traits.find((value) => !/UniqueTrait|SummonTrait/.test(value));
  const core = group.representative.units.slice(0, 2).map((value) => readableToken(value, catalog, "unit"));
  return [trait ? readableToken(trait, catalog, "trait") : null, ...core].filter(Boolean).slice(0, 2).join(" · ");
}

function summarizeBuilds(clusterId, response, limit = 4) {
  const rows = normalizeCompBuildEvidence(response)
    .filter((row) => row.clusterId === clusterId && row.items.length === 3)
    .sort((a, b) => b.games - a.games || String(a.unitApiName).localeCompare(String(b.unitApiName)));
  const byUnit = new Map();
  for (const row of rows) {
    if (!byUnit.has(row.unitApiName)) byUnit.set(row.unitApiName, row);
  }
  return [...byUnit.values()].slice(0, limit);
}

function aggregateRows(rows) {
  const placementCount = Array(8).fill(0);
  for (const row of rows) {
    if (!placementCountIsUsable(row.placementCount)) continue;
    row.placementCount.forEach((value, index) => { placementCount[index] += value; });
  }
  return { placementCount, stats: calculatePlacementStats(placementCount) };
}

function compareMetric(metric, a, b) {
  if (metric === "avg_placement") {
    return (a.stats.avgPlacement ?? Infinity) - (b.stats.avgPlacement ?? Infinity)
      || b.stats.games - a.stats.games
      || a.compId.localeCompare(b.compId);
  }
  if (metric === "popularity") {
    return b.stats.games - a.stats.games
      || (b.stats.top4Rate ?? -1) - (a.stats.top4Rate ?? -1)
      || a.compId.localeCompare(b.compId);
  }
  const field = metric === "win_rate" ? "winRate" : "top4Rate";
  return (b.stats[field] ?? -1) - (a.stats[field] ?? -1)
    || b.stats.games - a.stats.games
    || a.compId.localeCompare(b.compId);
}

export function buildCompRankings(exactResponse, options = {}) {
  const query = options.query ?? {};
  const catalog = options.catalog;
  const clusters = normalizeClusterDefinitions(options.clusterResponse ?? options.clusters ?? []);
  const rejected = [];
  const groups = new Map();

  for (const raw of normalizeExactUnitsTraitsResponse(exactResponse)) {
    const row = parseExactCompRow(raw);
    const board = playableBoard(row);
    const filteredUnits = board.units;
    const duplicates = filteredUnits.length !== unique(filteredUnits).length;
    const hasPve = row.units.some((unit) => /(?:^|_)PVE_/i.test(unit));
    const nonstandardPopulation = filteredUnits.length < 6 || filteredUnits.length > 10;
    if (!placementCountIsUsable(row.placementCount)) {
      rejected.push({ reason: "missing_placement_count", units: filteredUnits });
      continue;
    }
    if (filteredUnits.length === 0 || duplicates || hasPve || (!query.specialMode && nonstandardPopulation)) {
      rejected.push({ reason: "special_or_abnormal_board", units: filteredUnits });
      continue;
    }

    const match = matchCluster(row, clusters, options.clusterMatchThreshold ?? 0.55);
    const clusterSpecial = match?.cluster?.nameTokens?.some((token) => SPECIAL_NAME_PATTERN.test(token));
    if (!query.specialMode && clusterSpecial) {
      rejected.push({ reason: "special_cluster", units: filteredUnits, clusterId: match.cluster.clusterId });
      continue;
    }
    const compId = match ? `cluster:${match.cluster.clusterId}` : stableFingerprint(filteredUnits, row.traits);
    const current = groups.get(compId) ?? {
      compId,
      cluster: match?.cluster ?? null,
      rows: [],
      representative: { ...row, units: filteredUnits, starLevels: board.starLevels },
      matchScore: match?.score ?? null
    };
    current.rows.push({ ...row, units: filteredUnits, starLevels: board.starLevels });
    const currentGames = current.representative.placementCount.reduce((sum, value) => sum + value, 0);
    const rowGames = row.placementCount.reduce((sum, value) => sum + value, 0);
    if (rowGames > currentGames) {
      current.representative = { ...row, units: filteredUnits, starLevels: board.starLevels };
    }
    groups.set(compId, current);
  }

  const comps = [...groups.values()].map((group) => {
    const aggregate = aggregateRows(group.rows);
    const games = aggregate.stats?.games ?? 0;
    return {
      compId: group.compId,
      name: compName(group, catalog),
      patch: query.patch ?? "current",
      units: group.representative.units.map((apiName, index) => ({
        apiName,
        name: readableToken(apiName, catalog, "unit"),
        starLevel: null,
        avgStarLevel: group.representative.starLevels[index] ?? null,
        core: false,
        items: []
      })),
      traits: group.representative.traits.map((filterId) => ({
        apiName: baseTrait(filterId),
        filterId,
        name: readableToken(filterId, catalog, "trait"),
        tier: traitTier(filterId)
      })),
      coreBuilds: group.cluster ? summarizeBuilds(group.cluster.clusterId, options.compBuildsResponse) : [],
      stats: {
        games,
        top4Rate: aggregate.stats?.top4Rate ?? null,
        winRate: aggregate.stats?.winRate ?? null,
        avgPlacement: aggregate.stats?.avgPlacement ?? null,
        pickRate: Number.isFinite(options.sampleSize) && options.sampleSize > 0 ? games / options.sampleSize : null
      },
      source: {
        endpoint: "/tft-explorer-api/exact_units_traits2",
        updatedAt: options.updatedAt ?? null,
        clusterId: group.cluster?.clusterId ?? null,
        matched: Boolean(group.cluster),
        variantCount: group.rows.length
      }
    };
  });

  const eligible = comps.filter((comp) => comp.stats.games >= Number(query.minSamples ?? 500));
  const references = comps
    .filter((comp) => comp.stats.games < Number(query.minSamples ?? 500))
    .sort((a, b) => b.stats.games - a.stats.games || a.compId.localeCompare(b.compId))
    .slice(0, query.limit ?? 3)
    .map((comp) => ({ ...comp, lowSample: true }));
  const metricMap = {
    top4_rate: "top4Rate",
    win_rate: "winRate",
    avg_placement: "avgPlacement",
    popularity: "popularity"
  };
  const rankings = { top4Rate: [], winRate: [], avgPlacement: [], popularity: [] };
  for (const metric of query.metrics ?? ["top4_rate", "win_rate"]) {
    const key = metricMap[metric];
    if (!key) continue;
    rankings[key] = [...eligible].sort((a, b) => compareMetric(metric, a, b)).slice(0, query.limit ?? 3);
  }

  return {
    type: "comp_rankings",
    rankings,
    references,
    query,
    source: {
      endpoint: "/tft-explorer-api/exact_units_traits2",
      clusterEndpoint: clusters.length > 0 ? "/tft-comps-api/latest_cluster_info" : null,
      updatedAt: options.updatedAt ?? null,
      sampleSize: options.sampleSize ?? null,
      risk: "MetaTFT 为非官方接口；终局分布由本地规则过滤并匹配公开 cluster，结果仅供决策参考。"
    },
    warnings: options.warnings ?? [],
    diagnostics: {
      inputRows: normalizeExactUnitsTraitsResponse(exactResponse).length,
      acceptedGroups: comps.length,
      rejected
    }
  };
}
