import { calculatePlacementStats } from "./stats-calculator.js";
import { compareRankedBuilds } from "./ranker.js";

const AVG_PLACEMENT_ONLY_CATEGORIES = new Set(["radiant", "artifact"]);
export const SPECIAL_ITEM_RELATIVE_SAMPLE_RATIO = 0.02;

function usesSpecialAveragePlacementRanking(requestedCategories) {
  return requestedCategories.size > 0
    && [...requestedCategories].every((category) => AVG_PLACEMENT_ONLY_CATEGORIES.has(category));
}

function compareAveragePlacementOnly(left, right) {
  const leftPlacement = Number.isFinite(Number(left?.stats?.avgPlacement))
    ? Number(left.stats.avgPlacement)
    : Number.POSITIVE_INFINITY;
  const rightPlacement = Number.isFinite(Number(right?.stats?.avgPlacement))
    ? Number(right.stats.avgPlacement)
    : Number.POSITIVE_INFINITY;
  if (leftPlacement !== rightPlacement) return leftPlacement - rightPlacement;
  return String(left.apiName).localeCompare(String(right.apiName));
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
  const averagePlacementOnly = usesSpecialAveragePlacementRanking(requestedCategories);
  const rankings = [...buckets.values()]
    .filter((bucket) => requestedCategories.size === 0
      || requestedCategories.has(options.catalog?.itemByApiName?.get(bucket.apiName)?.category))
    .map((bucket) => {
      const stats = calculatePlacementStats(bucket.placementCount);
      return {
        apiName: bucket.apiName,
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

  const sampleFloor = averagePlacementOnly
    ? specialItemSampleFloor(rankings, minSamples)
    : { referenceGames: null, relativeRatio: null, outlierFloor: 0, effectiveFloor: minSamples, applied: false };
  for (const entry of rankings) {
    entry.qualified = entry.stats.games >= sampleFloor.effectiveFloor;
    if (!entry.qualified) {
      entry.excludedReason = averagePlacementOnly
        && entry.stats.games < sampleFloor.outlierFloor
        ? "special_item_outlier_sample"
        : "below_min_samples";
    }
  }

  rankings.sort((left, right) => {
    if (left.qualified !== right.qualified) return left.qualified ? -1 : 1;
    if (averagePlacementOnly) return compareAveragePlacementOnly(left, right);
    return compareRankedBuilds({ stats: left.stats }, { stats: right.stats }, query);
  });

  return {
    rankings: rankings.filter((entry) => entry.qualified),
    references: rankings.filter((entry) => !entry.qualified),
    totalGames,
    completeBuildCount: completeBuilds.length,
    coverageReliable: totalGames > 0,
    sampleFloor,
    methodology: averagePlacementOnly
      ? "special_item_outlier_cleaned_avg_placement_only"
      : "presence_once_per_complete_build"
  };
}
