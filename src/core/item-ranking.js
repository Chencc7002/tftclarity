import { calculatePlacementStats } from "./stats-calculator.js";
import { compareRankedBuilds } from "./ranker.js";

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
  const rankings = [...buckets.values()].map((bucket) => {
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
      qualified: stats.games >= minSamples
    };
  });

  rankings.sort((left, right) => {
    if (left.qualified !== right.qualified) return left.qualified ? -1 : 1;
    return compareRankedBuilds({ stats: left.stats }, { stats: right.stats }, query);
  });

  return {
    rankings: rankings.filter((entry) => entry.qualified),
    references: rankings.filter((entry) => !entry.qualified),
    totalGames,
    completeBuildCount: completeBuilds.length,
    coverageReliable: totalGames > 0,
    methodology: "presence_once_per_complete_build"
  };
}
