export const DEFAULT_STABLE_SAMPLE_FLOOR = 200;
export const ROBUST_RANKING_VERSION = "performance_role_v4";
export const ROBUST_PRIOR_SAMPLE_FLOOR = 1000;
// Kept as a compatibility export for downstream consumers. Sample coverage no
// longer contributes points to the performance score in v4.
export const ROBUST_COVERAGE_WEIGHT = 0;
// Compatibility export only. Mainstream eligibility now comes from relative
// sample tiers instead of an absolute sample-count floor.
export const ROBUST_GENERAL_SAMPLE_FLOOR = 0;
export const ROBUST_GENERAL_TOP4_FLOOR = 0.5;
export const ROBUST_GENERAL_AVG_PLACEMENT_CEILING = 4.5;
export const SAMPLE_TIER_HIGH_RATIO = 0.5;
export const SAMPLE_TIER_MEDIUM_RATIO = 0.1;

const TIER_ORDER = Object.freeze({ unclassified: 0, low: 1, medium: 2, high: 3 });

export function stableSampleThreshold(query = {}) {
  const minSamples = Number(query.minSamples ?? query.min_samples ?? 100);
  const normalizedMinSamples = Number.isFinite(minSamples) && minSamples > 0 ? minSamples : 100;
  return Math.max(DEFAULT_STABLE_SAMPLE_FLOOR, normalizedMinSamples * 2);
}

export function isLowSampleBuild(build, query = {}) {
  return Number(build?.stats?.games ?? 0) < stableSampleThreshold(query);
}

function clampRate(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function placementQuality(value) {
  const placement = Number(value);
  if (!Number.isFinite(placement)) return 0;
  return clampRate((8 - placement) / 7);
}

function weightedBaseline(builds, field, fallback) {
  let weightedTotal = 0;
  let gamesTotal = 0;
  for (const build of builds) {
    const games = Math.max(0, Number(build?.stats?.games ?? 0));
    const value = Number(build?.stats?.[field]);
    if (!games || !Number.isFinite(value)) continue;
    weightedTotal += value * games;
    gamesTotal += games;
  }
  return gamesTotal > 0 ? weightedTotal / gamesTotal : fallback;
}

function shrinkMetric(value, games, baseline, priorSamples) {
  const observed = Number.isFinite(Number(value)) ? Number(value) : baseline;
  return (observed * games + baseline * priorSamples) / (games + priorSamples);
}

function performanceFromMetrics(metrics = {}) {
  return (
    clampRate(metrics.top4Rate) * 0.5
    + clampRate(metrics.winRate) * 0.2
    + placementQuality(metrics.avgPlacement) * 0.3
  );
}

function dynamicClusterTiers(values, transform = (value) => value) {
  const numeric = values.map((value) => Number(value));
  const finite = numeric.filter(Number.isFinite);
  const unique = [...new Set(finite)];
  if (finite.length < 3 || unique.length < 3) return numeric.map(() => "unclassified");

  const sorted = [...finite].sort((left, right) => left - right);
  let centers = [sorted[0], sorted[Math.floor((sorted.length - 1) / 2)], sorted.at(-1)]
    .map(transform);

  for (let iteration = 0; iteration < 64; iteration += 1) {
    const groups = [[], [], []];
    for (const rawValue of numeric) {
      if (!Number.isFinite(rawValue)) continue;
      const value = transform(rawValue);
      let selected = 0;
      for (let index = 1; index < centers.length; index += 1) {
        if (Math.abs(value - centers[index]) < Math.abs(value - centers[selected])) selected = index;
      }
      groups[selected].push(value);
    }
    const next = groups.map((group, index) => group.length
      ? group.reduce((sum, value) => sum + value, 0) / group.length
      : centers[index]);
    if (next.every((value, index) => Math.abs(value - centers[index]) < 1e-10)) break;
    centers = next;
  }

  const orderedCenters = centers
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const tierByCenter = new Map(orderedCenters.map((entry, index) => (
    [entry.index, ["low", "medium", "high"][index]]
  )));

  return numeric.map((rawValue) => {
    if (!Number.isFinite(rawValue)) return "unclassified";
    const value = transform(rawValue);
    let selected = 0;
    for (let index = 1; index < centers.length; index += 1) {
      if (Math.abs(value - centers[index]) < Math.abs(value - centers[selected])) selected = index;
    }
    return tierByCenter.get(selected) ?? "unclassified";
  });
}

function percentileRanks(values) {
  const numeric = values.map((value) => Number(value));
  const sorted = numeric.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length < 2) return numeric.map(() => null);
  return numeric.map((value) => {
    if (!Number.isFinite(value)) return null;
    const lower = sorted.findIndex((candidate) => candidate >= value);
    const upper = sorted.length - 1 - [...sorted].reverse().findIndex((candidate) => candidate <= value);
    return ((lower + upper) / 2) / (sorted.length - 1);
  });
}

function relativeSampleTiers(values) {
  const numeric = values.map((value) => Number(value));
  const maximum = Math.max(0, ...numeric.filter(Number.isFinite));
  if (maximum <= 0) return numeric.map(() => "unclassified");
  return numeric.map((value) => {
    if (!Number.isFinite(value) || value <= 0) return "unclassified";
    const ratio = value / maximum;
    if (ratio >= SAMPLE_TIER_HIGH_RATIO) return "high";
    if (ratio >= SAMPLE_TIER_MEDIUM_RATIO) return "medium";
    return "low";
  });
}

export function rankingInsightCode(sampleTier, performanceTier) {
  if (sampleTier === "high" && performanceTier === "high") return "mainstream_best";
  if (sampleTier === "high" && performanceTier === "medium") return "mainstream_standard";
  if (sampleTier === "high" && performanceTier === "low") return "popular_underperformer";
  if (sampleTier === "medium" && performanceTier === "high") return "potential";
  if (sampleTier === "medium" && performanceTier === "medium") return "situational";
  if (sampleTier === "medium" && performanceTier === "low") return "inefficient_alternative";
  if (sampleTier === "low" && performanceTier === "high") return "small_sample_highlight";
  if (sampleTier === "low") return "sparse_sample";
  return "unclassified";
}

export function applyDynamicRankingTiers(records, options = {}) {
  const candidates = [...(records ?? [])];
  const groups = new Map();
  candidates.forEach((record, index) => {
    const key = options.sampleGroupKey?.(record) ?? "all";
    const group = groups.get(key) ?? [];
    group.push({ record, index });
    groups.set(key, group);
  });

  const sampleMetadata = Array(candidates.length).fill(null);
  for (const [groupKey, group] of groups) {
    const games = group.map(({ record }) => Math.max(0, Number(record?.stats?.games ?? 0)));
    const maximumGames = Math.max(0, ...games);
    const tiers = relativeSampleTiers(games);
    const percentiles = percentileRanks(games);
    group.forEach(({ index }, groupIndex) => {
      sampleMetadata[index] = {
        sampleGroup: groupKey,
        sampleTier: tiers[groupIndex],
        sampleRatio: maximumGames > 0 ? games[groupIndex] / maximumGames : null,
        samplePercentile: percentiles[groupIndex]
      };
    });
  }

  const performanceTiers = dynamicClusterTiers(candidates.map((record) => (
    Number(record?.ranking?.performanceScore)
  )));

  return candidates.map((record, index) => {
    const metadata = sampleMetadata[index] ?? {
      sampleGroup: "all",
      sampleTier: "unclassified",
      samplePercentile: null
    };
    const performanceTier = performanceTiers[index];
    return {
      ...record,
      ranking: {
        ...record.ranking,
        ...metadata,
        performanceTier,
        insightCode: rankingInsightCode(metadata.sampleTier, performanceTier)
      }
    };
  });
}

export function scoreRobustBuilds(builds, query = {}) {
  const candidates = [...(builds ?? [])];
  if (candidates.length === 0) return [];

  const baseline = {
    top4Rate: weightedBaseline(candidates, "top4Rate", 0.5),
    winRate: weightedBaseline(candidates, "winRate", 0.125),
    avgPlacement: weightedBaseline(candidates, "avgPlacement", 4.5)
  };
  const priorSamples = Math.max(
    ROBUST_PRIOR_SAMPLE_FLOOR,
    stableSampleThreshold(query) * 2
  );
  const maxGames = Math.max(1, ...candidates.map((build) => Number(build?.stats?.games ?? 0)));

  const scored = candidates.map((build, index) => {
    const games = Math.max(0, Number(build?.stats?.games ?? 0));
    const adjusted = {
      top4Rate: shrinkMetric(build?.stats?.top4Rate, games, baseline.top4Rate, priorSamples),
      winRate: shrinkMetric(build?.stats?.winRate, games, baseline.winRate, priorSamples),
      avgPlacement: shrinkMetric(build?.stats?.avgPlacement, games, baseline.avgPlacement, priorSamples)
    };
    const performanceScore = performanceFromMetrics(adjusted);
    // Retained for diagnostics only; coverage no longer contributes points.
    const coverageScore = Math.sqrt(games / maxGames);
    const coverageEligible = (
      Number(build?.stats?.top4Rate) >= ROBUST_GENERAL_TOP4_FLOOR
      && Number(build?.stats?.avgPlacement) <= ROBUST_GENERAL_AVG_PLACEMENT_CEILING
    );
    const performanceContribution = performanceScore;
    const coverageContribution = 0;
    const baseScore = performanceScore;

    return {
      ...build,
      ranking: {
        candidateIndex: index,
        method: ROBUST_RANKING_VERSION,
        score: baseScore,
        baseScore,
        performanceScore,
        coverageScore,
        coverageEligible,
        performanceContribution,
        coverageContribution,
        priorSamples,
        adjusted,
        baseline
      }
    };
  });

  return applyDynamicRankingTiers(scored).map((build) => {
    const { candidateIndex, ...publicRanking } = build.ranking;
    return {
      ...build,
      ranking: {
        ...publicRanking,
        generalRecommendation: false,
        sampleLeadRatio: null,
        applicabilityBasis: "performance_score"
      }
    };
  });
}

function compareTier(left, right, field) {
  return (TIER_ORDER[right?.ranking?.[field]] ?? 0) - (TIER_ORDER[left?.ranking?.[field]] ?? 0);
}

export function orderBuildRecommendations(builds) {
  const candidates = [...(builds ?? [])];
  if (candidates.length === 0) return [];
  const viable = candidates.filter((build) => build.ranking?.coverageEligible !== false);
  const source = viable.length ? viable : candidates;
  const nonLowPerformance = source.filter((build) => build.ranking?.performanceTier !== "low");
  const mainPool = nonLowPerformance.length ? nonLowPerformance : source;
  const main = [...mainPool].sort((left, right) => (
    compareTier(left, right, "sampleTier")
    || Number(right?.stats?.games ?? 0) - Number(left?.stats?.games ?? 0)
    || Number(right?.ranking?.performanceScore ?? 0) - Number(left?.ranking?.performanceScore ?? 0)
  ))[0];
  const remaining = candidates
    .filter((build) => build !== main)
    .sort((left, right) => (
      Number(right?.ranking?.performanceScore ?? 0) - Number(left?.ranking?.performanceScore ?? 0)
      || compareTier(left, right, "sampleTier")
      || Number(right?.stats?.games ?? 0) - Number(left?.stats?.games ?? 0)
    ));
  const ordered = [main, ...remaining];
  const strongestAlternative = remaining[0] ?? null;
  const sampleLeadRatio = strongestAlternative
    ? Number(main?.stats?.games ?? 0) / Math.max(1, Number(strongestAlternative?.stats?.games ?? 0))
    : null;
  return ordered.map((build, index) => ({
    ...build,
    ranking: {
      ...build.ranking,
      generalRecommendation: index === 0,
      recommendationRole: index === 0
        ? "mainstream"
        : index === 1
          ? "best_performance_alternative"
          : "alternative",
      sampleLeadRatio: index === 0 && Number.isFinite(sampleLeadRatio) ? sampleLeadRatio : null,
      applicabilityBasis: index === 0 ? "sample_role_and_performance" : "performance_score"
    }
  }));
}

export function compareRankedBuilds(a, b, query = {}) {
  const sort = query.sort ?? "top4_first";
  if (sort === "robust_first") {
    const leftScore = Number(a?.ranking?.score);
    const rightScore = Number(b?.ranking?.score);
    if (Number.isFinite(leftScore) && Number.isFinite(rightScore) && rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    if (b.stats.games !== a.stats.games) return b.stats.games - a.stats.games;
  }
  if (sort === "win_first" && b.stats.winRate !== a.stats.winRate) {
    return b.stats.winRate - a.stats.winRate;
  }
  if (sort === "games_first" && b.stats.games !== a.stats.games) {
    return b.stats.games - a.stats.games;
  }
  if (sort === "avg_first" && a.stats.avgPlacement !== b.stats.avgPlacement) {
    return a.stats.avgPlacement - b.stats.avgPlacement;
  }
  if (b.stats.top4Rate !== a.stats.top4Rate) return b.stats.top4Rate - a.stats.top4Rate;
  if (b.stats.winRate !== a.stats.winRate) return b.stats.winRate - a.stats.winRate;
  if (a.stats.avgPlacement !== b.stats.avgPlacement) return a.stats.avgPlacement - b.stats.avgPlacement;
  return b.stats.games - a.stats.games;
}

export function rankBuilds(builds, query) {
  const minSamples = query.minSamples ?? 100;
  const eligible = builds.filter((build) => build.stats.games >= minSamples);
  const rankedCandidates = query.sort === "robust_first"
    ? scoreRobustBuilds(eligible, query)
    : eligible;
  if (query.sort === "robust_first") return orderBuildRecommendations(rankedCandidates);
  return rankedCandidates.sort((a, b) => compareRankedBuilds(a, b, query));
}
