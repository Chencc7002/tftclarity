import { calculatePlacementStats } from "./stats-calculator.js";
import { applyDynamicRankingTiers, scoreRobustBuilds } from "./ranker.js";

const AVG_PLACEMENT_ONLY_CATEGORIES = new Set(["radiant", "artifact"]);
export const SPECIAL_ITEM_RELATIVE_SAMPLE_RATIO = 0.02;

function usesSpecialRelativeSampleFloor(requestedCategories) {
  return requestedCategories.size > 0
    && [...requestedCategories].every((category) => AVG_PLACEMENT_ONLY_CATEGORIES.has(category));
}

function specialItemSampleFloor(rankings, configuredMinSamples) {
  const observedGames = rankings
    .map((entry) => Number(entry?.stats?.games ?? 0))
    .filter((games) => Number.isFinite(games) && games > 0);
  const referenceGames = Math.max(0, ...observedGames);
  const outlierFloor = referenceGames > 0
    ? Math.ceil(referenceGames * SPECIAL_ITEM_RELATIVE_SAMPLE_RATIO)
    : 0;
  const effectiveFloor = Math.max(configuredMinSamples, outlierFloor);
  const hasCleanCandidate = rankings.some((entry) => Number(entry?.stats?.games ?? 0) >= effectiveFloor);
  const hasRelativeOutlier = rankings.some((entry) => Number(entry?.stats?.games ?? 0) < outlierFloor);
  return {
    referenceGames,
    relativeRatio: SPECIAL_ITEM_RELATIVE_SAMPLE_RATIO,
    outlierFloor: hasCleanCandidate ? outlierFloor : 0,
    effectiveFloor: hasCleanCandidate ? effectiveFloor : configuredMinSamples,
    applied: hasCleanCandidate && hasRelativeOutlier
  };
}

function placementCountForBuild(build) {
  const values = build.raw?.placement_count ?? build.raw?.placementCount ?? [];
  return Array.from({ length: 8 }, (_, index) => Number(values[index]) || 0);
}

function addPlacementCounts(target, source) {
  for (let index = 0; index < 8; index += 1) target[index] += Number(source[index]) || 0;
}

function canonicalBuildKey(build) {
  return [...(build.items ?? [])].sort().join("|");
}

function normalizedBuilds(builds) {
  const grouped = new Map();
  for (const build of builds) {
    const key = canonicalBuildKey(build);
    if (!key) continue;
    const current = grouped.get(key) ?? {
      items: [...build.items].sort(),
      placementCount: Array(8).fill(0),
      rawRows: 0
    };
    addPlacementCounts(current.placementCount, placementCountForBuild(build));
    current.rawRows += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

function copyCountMap(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

function createBucket(apiName) {
  return {
    apiName,
    placementCount: Array(8).fill(0),
    buildCount: 0,
    copyCounts: new Map(),
    pairings: new Map()
  };
}

function pairingKey(items) {
  return [...items].sort().join("|");
}

function pairingEntry(bucket, itemApiName, build, games) {
  const remaining = [...build.items];
  remaining.splice(remaining.indexOf(itemApiName), 1);
  const key = pairingKey(remaining);
  const entry = bucket.pairings.get(key) ?? { items: remaining.sort(), games: 0 };
  entry.games += games;
  bucket.pairings.set(key, entry);
}

function copyCountEntry(bucket, count) {
  const entry = bucket.copyCounts.get(count) ?? {
    copyCount: count,
    placementCount: Array(8).fill(0),
    buildCount: 0
  };
  bucket.copyCounts.set(count, entry);
  return entry;
}

export function aggregateUnitItemRankings(builds, query = {}, options = {}) {
  const completeBuilds = normalizedBuilds(builds);
  const totalGames = completeBuilds.reduce((sum, build) => (
    sum + calculatePlacementStats(build.placementCount).games
  ), 0);
  const buckets = new Map();

  for (const build of completeBuilds) {
    const counts = copyCountMap(build.items);
    const games = calculatePlacementStats(build.placementCount).games;
    for (const [apiName, count] of counts) {
      const bucket = buckets.get(apiName) ?? createBucket(apiName);
      // Presence aggregation counts this complete build exactly once, even for double items.
      addPlacementCounts(bucket.placementCount, build.placementCount);
      bucket.buildCount += 1;
      pairingEntry(bucket, apiName, build, games);
      const copies = copyCountEntry(bucket, count);
      addPlacementCounts(copies.placementCount, build.placementCount);
      copies.buildCount += 1;
      buckets.set(apiName, bucket);
    }
  }

  const minSamples = Number(query.minSamples ?? 100);
  const requestedCategories = new Set(query.itemCategories ?? []);
  const usesRelativeSampleFloor = usesSpecialRelativeSampleFloor(requestedCategories);
  const soleRequestedCategory = requestedCategories.size === 1
    ? [...requestedCategories][0]
    : null;
  const rankings = [...buckets.values()]
    .filter((bucket) => requestedCategories.size === 0
      || requestedCategories.has(options.catalog?.itemByApiName?.get(bucket.apiName)?.category))
    .map((bucket) => {
      const stats = calculatePlacementStats(bucket.placementCount);
      return {
        apiName: bucket.apiName,
        category: options.catalog?.itemByApiName?.get(bucket.apiName)?.category
          ?? soleRequestedCategory
          ?? "unknown",
        stats,
        placementCount: bucket.placementCount,
        buildCount: bucket.buildCount,
        coverage: totalGames > 0 ? stats.games / totalGames : null,
        coverageDenominatorGames: totalGames,
        commonPairings: [...bucket.pairings.values()]
          .sort((a, b) => b.games - a.games || pairingKey(a.items).localeCompare(pairingKey(b.items)))
          .slice(0, options.pairingLimit ?? 3),
        copyCounts: [...bucket.copyCounts.values()]
          .map((entry) => ({
            copyCount: entry.copyCount,
            buildCount: entry.buildCount,
            stats: calculatePlacementStats(entry.placementCount),
            placementCount: entry.placementCount
          }))
          .sort((a, b) => a.copyCount - b.copyCount),
        qualified: false,
        excludedReason: null
      };
    });

  const sampleFloor = usesRelativeSampleFloor
    ? specialItemSampleFloor(rankings, minSamples)
    : { referenceGames: null, relativeRatio: null, outlierFloor: 0, effectiveFloor: minSamples, applied: false };
  for (const entry of rankings) {
    entry.qualified = entry.stats.games >= sampleFloor.effectiveFloor;
    if (!entry.qualified) {
      entry.excludedReason = usesRelativeSampleFloor
        && entry.stats.games < sampleFloor.outlierFloor
        ? "special_item_outlier_sample"
        : "below_min_samples";
    }
  }

  const qualified = rankings.filter((entry) => entry.qualified);
  const scored = applyDynamicRankingTiers(
    scoreRobustBuilds(qualified, query),
    { sampleGroupKey: (entry) => entry.category }
  );
  const categories = new Set(scored.map((entry) => entry.category));
  const mixedCategories = categories.size > 1;
  const tierOrder = { high: 3, medium: 2, low: 1, unclassified: 0 };
  scored.sort((left, right) => {
    if (mixedCategories) {
      const tierDelta = (tierOrder[right.ranking?.sampleTier] ?? 0)
        - (tierOrder[left.ranking?.sampleTier] ?? 0);
      if (tierDelta) return tierDelta;
      const performanceDelta = Number(right.ranking?.performanceScore ?? 0)
        - Number(left.ranking?.performanceScore ?? 0);
      if (performanceDelta) return performanceDelta;
      const percentileDelta = Number(right.ranking?.samplePercentile ?? -1)
        - Number(left.ranking?.samplePercentile ?? -1);
      if (percentileDelta) return percentileDelta;
    }
    return Number(right.stats.games) - Number(left.stats.games)
      || Number(right.ranking?.performanceScore ?? 0) - Number(left.ranking?.performanceScore ?? 0)
      || String(left.apiName).localeCompare(String(right.apiName));
  });

  return {
    rankings: scored,
    references: rankings.filter((entry) => !entry.qualified),
    totalGames,
    completeBuildCount: completeBuilds.length,
    coverageReliable: totalGames > 0,
    sampleFloor,
    methodology: mixedCategories
      ? "category_relative_sample_tier_then_performance_v1"
      : "sample_desc_with_shrunk_performance_v1"
  };
}
