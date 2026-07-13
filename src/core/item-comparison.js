import { calculatePlacementStats } from "./stats-calculator.js";
import { rankBuilds, stableSampleThreshold } from "./ranker.js";

const DEFAULT_MATERIAL_THRESHOLDS = Object.freeze({
  top4Rate: 0.01,
  winRate: 0.005,
  avgPlacement: 0.1,
  games: 0.1
});

function placementCountForBuild(build) {
  const values = build.raw?.placement_count ?? build.raw?.placementCount ?? [];
  return Array.from({ length: 8 }, (_, index) => Number(values[index]) || 0);
}

function aggregatePlacementCounts(builds) {
  const totals = Array(8).fill(0);
  for (const build of builds) {
    const counts = placementCountForBuild(build);
    for (let index = 0; index < totals.length; index += 1) totals[index] += counts[index];
  }
  return totals;
}

function itemRecord(apiName, catalog) {
  const item = catalog?.itemByApiName?.get(apiName);
  return {
    apiName,
    name: item?.shortName ?? item?.zhName ?? apiName,
    canonicalName: item?.zhName ?? item?.displayName ?? null,
    category: item?.category ?? null,
    iconUrl: item?.iconUrl ?? item?.icon ?? null,
    current: item?.current ?? null,
    obtainable: item?.obtainable ?? null,
    nameSource: item?.nameSource ?? item?.source ?? null,
    availabilitySource: item?.availabilitySource ?? item?.source ?? null,
    statSource: "MetaTFT unit_builds placement_count"
  };
}

function distinctCandidateCount(build, candidates) {
  const present = new Set(build.items.filter((apiName) => candidates.has(apiName)));
  return present.size;
}

function exclusiveBuilds(builds, option, comparisonOptions) {
  const candidates = new Set(comparisonOptions);
  return builds.filter((build) => (
    build.items.includes(option) && distinctCandidateCount(build, candidates) === 1
  ));
}

function commonBuilds(builds, _query, limit = 3) {
  const grouped = new Map();
  for (const build of builds) {
    const items = [...new Set(build.items)].sort();
    const key = items.join("|");
    const current = grouped.get(key) ?? { items, builds: [] };
    current.builds.push(build);
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .map((group) => {
      const placementCount = aggregatePlacementCounts(group.builds);
      return {
        items: group.items,
        placementCount,
        stats: calculatePlacementStats(placementCount)
      };
    })
    .sort((left, right) => right.stats.games - left.stats.games)
    .slice(0, limit);
}

function metricValue(entry, primaryMetric) {
  if (!entry || entry.stats.games <= 0) return null;
  const value = primaryMetric === "games" ? entry.stats.games : entry.stats[primaryMetric];
  return Number.isFinite(value) ? value : null;
}

function compareEntries(left, right, primaryMetric) {
  if (left.qualified !== right.qualified) return left.qualified ? -1 : 1;
  const leftValue = metricValue(left, primaryMetric);
  const rightValue = metricValue(right, primaryMetric);
  if (leftValue === null && rightValue !== null) return 1;
  if (rightValue === null && leftValue !== null) return -1;
  if (leftValue !== rightValue) {
    if (primaryMetric === "avgPlacement") return leftValue - rightValue;
    return rightValue - leftValue;
  }
  if (right.stats.top4Rate !== left.stats.top4Rate) return right.stats.top4Rate - left.stats.top4Rate;
  if (right.stats.winRate !== left.stats.winRate) return right.stats.winRate - left.stats.winRate;
  return right.stats.games - left.stats.games;
}

function metricDelta(first, second, primaryMetric) {
  const firstValue = metricValue(first, primaryMetric);
  const secondValue = metricValue(second, primaryMetric);
  if (firstValue === null || secondValue === null) return null;
  if (primaryMetric === "avgPlacement") return secondValue - firstValue;
  if (primaryMetric === "games") {
    return firstValue <= 0 ? null : (firstValue - secondValue) / firstValue;
  }
  return firstValue - secondValue;
}

function decisionFor(entries, details, config) {
  const { primaryMetric, minSamples, stabilityMinSamples, overlap } = details;
  const warnings = [];
  const unavailable = entries.filter((entry) => metricValue(entry, primaryMetric) === null);
  if (unavailable.length > 0) {
    warnings.push(`主指标 ${primaryMetric} 缺失，不能判断胜者`);
    return { winner: null, delta: null, confidence: "insufficient", reason: "metric_unavailable", warnings };
  }

  const belowMinimum = entries.filter((entry) => entry.stats.games < minSamples);
  if (belowMinimum.length > 0) {
    warnings.push(`部分候选未达到最低样本门槛 ${minSamples}`);
    return { winner: null, delta: null, confidence: "insufficient", reason: "insufficient_sample", warnings };
  }

  const unstable = entries.filter((entry) => entry.stats.games < stabilityMinSamples);
  if (unstable.length > 0) {
    warnings.push(`部分候选未达到稳定展示门槛 ${stabilityMinSamples}`);
    return { winner: null, delta: null, confidence: "low", reason: "low_sample", warnings };
  }

  if (config.evidenceReliable === false) {
    warnings.push("数据来自过期缓存，暂不判断胜者");
    return { winner: null, delta: null, confidence: "low", reason: "stale_evidence", warnings };
  }

  const maxOverlapRate = Number(config.maxOverlapRate ?? 0.25);
  if (overlap.rate > maxOverlapRate) {
    warnings.push(`候选共同出现样本占比 ${(overlap.rate * 100).toFixed(1)}%，高于 ${(maxOverlapRate * 100).toFixed(1)}%`);
    return { winner: null, delta: null, confidence: "low", reason: "overlap_too_high", warnings };
  }

  const delta = metricDelta(entries[0], entries[1], primaryMetric);
  const threshold = Number(config.materialThresholds?.[primaryMetric]
    ?? DEFAULT_MATERIAL_THRESHOLDS[primaryMetric]);
  if (!Number.isFinite(delta) || delta < threshold) {
    warnings.push(`主指标差距未达到实质阈值 ${threshold}`);
    return { winner: null, delta, confidence: "close", reason: "difference_too_small", warnings };
  }

  return {
    winner: entries[0].apiName,
    delta,
    confidence: "stable",
    reason: "material_lead",
    warnings
  };
}

export function compareItemOptions(builds, query, config = {}) {
  const comparisonOptions = [...new Set(
    query.comparisonItems ?? query.comparison?.itemApiNames ?? []
  )];
  const requested = query.intent === "unit_item_comparison"
    || query.comparison?.requested
    || comparisonOptions.length > 0;
  if (!requested || comparisonOptions.length < 2) return null;

  const minSamples = query.minSamples ?? 100;
  const stabilityMinSamples = stableSampleThreshold(query);
  const primaryMetric = query.primaryMetric ?? "top4Rate";
  const candidateSet = new Set(comparisonOptions);
  const overlapBuilds = builds.filter((build) => distinctCandidateCount(build, candidateSet) >= 2);
  const overlapPlacementCount = aggregatePlacementCounts(overlapBuilds);
  const overlapGames = calculatePlacementStats(overlapPlacementCount).games;

  const entries = comparisonOptions.map((apiName) => {
    const selected = exclusiveBuilds(builds, apiName, comparisonOptions);
    const placementCount = aggregatePlacementCounts(selected);
    const stats = calculatePlacementStats(placementCount);
    const representativeBuild = rankBuilds([...selected], { ...query, minSamples: 0 })[0] ?? null;
    return {
      ...itemRecord(apiName, config.catalog),
      stats,
      games: stats.games,
      top4Rate: stats.games > 0 ? stats.top4Rate : null,
      winRate: stats.games > 0 ? stats.winRate : null,
      avgPlacement: stats.games > 0 ? stats.avgPlacement : null,
      placementCount,
      buildCount: selected.length,
      commonBuilds: commonBuilds(selected, query),
      overlapGames,
      isolation: "exclusive",
      qualified: stats.games >= minSamples,
      stable: stats.games >= stabilityMinSamples,
      lowSample: stats.games < stabilityMinSamples,
      representativeBuild
    };
  });

  const rankedEntries = [...entries].sort((left, right) => compareEntries(left, right, primaryMetric));
  const exclusiveGames = entries.reduce((sum, entry) => sum + entry.stats.games, 0);
  const overlap = {
    games: overlapGames,
    rate: overlapGames + exclusiveGames > 0 ? overlapGames / (overlapGames + exclusiveGames) : 0,
    buildCount: overlapBuilds.length,
    placementCount: overlapPlacementCount,
    commonBuilds: commonBuilds(overlapBuilds, query)
  };
  const decision = decisionFor(rankedEntries, {
    primaryMetric,
    minSamples,
    stabilityMinSamples,
    overlap
  }, config);
  const allQualified = entries.every((entry) => entry.qualified);
  const allStable = entries.every((entry) => entry.stable);

  return {
    requested: true,
    mode: "exclusive_presence",
    options: comparisonOptions,
    entries,
    rankedEntries,
    results: entries,
    overlap,
    decision: {
      ...decision,
      primaryMetric,
      threshold: Number(config.materialThresholds?.[primaryMetric]
        ?? DEFAULT_MATERIAL_THRESHOLDS[primaryMetric])
    },
    winner: decision.winner,
    allQualified,
    allStable,
    sort: query.sort,
    primaryMetric,
    minSamples,
    stabilityMinSamples,
    warnings: decision.warnings
  };
}

export function comparisonRankedBuilds(comparison) {
  if (!comparison) return [];
  return (comparison.rankedEntries ?? comparison.entries)
    .filter((entry) => entry.representativeBuild)
    .map((entry) => ({
      ...entry.representativeBuild,
      stats: entry.stats,
      comparisonOption: entry.apiName,
      comparisonQualified: entry.qualified,
      comparisonStable: entry.stable,
      comparisonIsolation: entry.isolation
    }));
}
