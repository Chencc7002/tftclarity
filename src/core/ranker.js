export const DEFAULT_STABLE_SAMPLE_FLOOR = 200;
export const ROBUST_RANKING_VERSION = "robust_applicability_v3";
export const ROBUST_PRIOR_SAMPLE_FLOOR = 1000;
export const ROBUST_COVERAGE_WEIGHT = 0.1;
export const ROBUST_GENERAL_SAMPLE_FLOOR = 1000;
export const ROBUST_GENERAL_TOP4_FLOOR = 0.5;
export const ROBUST_GENERAL_AVG_PLACEMENT_CEILING = 4.5;

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
    const performanceScore = (
      adjusted.top4Rate * 0.5
      + adjusted.winRate * 0.2
      + placementQuality(adjusted.avgPlacement) * 0.3
    );
    // Sampling precision grows with sqrt(n). Normalizing it to the largest
    // candidate keeps sample coverage continuous without a ratio cliff.
    const coverageScore = Math.sqrt(games / maxGames);
    const coverageEligible = (
      games >= Math.max(ROBUST_GENERAL_SAMPLE_FLOOR, stableSampleThreshold(query))
      && Number(build?.stats?.top4Rate) >= ROBUST_GENERAL_TOP4_FLOOR
      && Number(build?.stats?.avgPlacement) <= ROBUST_GENERAL_AVG_PLACEMENT_CEILING
    );
    const performanceContribution = performanceScore * (1 - ROBUST_COVERAGE_WEIGHT);
    const coverageContribution = coverageEligible
      ? coverageScore * ROBUST_COVERAGE_WEIGHT
      : 0;
    const baseScore = (
      performanceContribution
      + coverageContribution
    );

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

  const performanceLeader = scored.reduce((best, build) => (
    !best || build.ranking.performanceScore > best.ranking.performanceScore ? build : best
  ), null);
  const scoreLeader = scored.reduce((best, build) => (
    !best || build.ranking.score > best.ranking.score ? build : best
  ), null);
  const coverageAdjustedWinner = Boolean(
    scoreLeader
    && performanceLeader
    && scoreLeader.ranking.candidateIndex !== performanceLeader.ranking.candidateIndex
    && scoreLeader.ranking.coverageEligible
    && Number(scoreLeader.stats?.games ?? 0) > Number(performanceLeader.stats?.games ?? 0)
  );
  const sampleLeadRatio = coverageAdjustedWinner
    ? Number(scoreLeader.stats?.games ?? 0) / Math.max(1, Number(performanceLeader.stats?.games ?? 0))
    : null;

  return scored.map((build) => {
    const generalRecommendation = (
      coverageAdjustedWinner
      && build.ranking.candidateIndex === scoreLeader.ranking.candidateIndex
    );
    const { candidateIndex, ...publicRanking } = build.ranking;
    return {
      ...build,
      ranking: {
        ...publicRanking,
        generalRecommendation,
        sampleLeadRatio: generalRecommendation ? sampleLeadRatio : null,
        applicabilityBasis: generalRecommendation ? "coverage_adjusted_score" : "robust_score"
      }
    };
  });
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
  return rankedCandidates
    .sort((a, b) => compareRankedBuilds(a, b, query));
}
