export const DEFAULT_STABLE_SAMPLE_FLOOR = 200;

export function stableSampleThreshold(query = {}) {
  const minSamples = Number(query.minSamples ?? query.min_samples ?? 100);
  const normalizedMinSamples = Number.isFinite(minSamples) && minSamples > 0 ? minSamples : 100;
  return Math.max(DEFAULT_STABLE_SAMPLE_FLOOR, normalizedMinSamples * 2);
}

export function isLowSampleBuild(build, query = {}) {
  return Number(build?.stats?.games ?? 0) < stableSampleThreshold(query);
}

export function compareRankedBuilds(a, b, query = {}) {
  const sort = query.sort ?? "top4_first";
  if (sort === "win_first" && b.stats.winRate !== a.stats.winRate) {
    return b.stats.winRate - a.stats.winRate;
  }
  if (sort === "robust_first" && b.stats.games !== a.stats.games) {
    return b.stats.games - a.stats.games;
  }
  if (b.stats.top4Rate !== a.stats.top4Rate) return b.stats.top4Rate - a.stats.top4Rate;
  if (b.stats.winRate !== a.stats.winRate) return b.stats.winRate - a.stats.winRate;
  if (a.stats.avgPlacement !== b.stats.avgPlacement) return a.stats.avgPlacement - b.stats.avgPlacement;
  return b.stats.games - a.stats.games;
}

export function rankBuilds(builds, query) {
  const minSamples = query.minSamples ?? 100;
  return builds
    .filter((build) => build.stats.games >= minSamples)
    .sort((a, b) => compareRankedBuilds(a, b, query));
}
