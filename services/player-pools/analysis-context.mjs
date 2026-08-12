const ANALYSIS_CONTEXT_SCHEMA_VERSION = "player-pool-analysis-evidence.v1";

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function observed(comp, metric) {
  if (!comp) return null;
  const observedName = `observed${metric[0].toUpperCase()}${metric.slice(1)}`;
  return finite(comp[metric] ?? comp[observedName]);
}

function compLabel(comp, signature = "") {
  const display = comp?.displaySignature;
  const traits = (display?.traits ?? []).map((trait) => trait?.name ?? trait?.id).filter(Boolean);
  if (traits.length) return traits.slice(0, 2).join(" · ");
  if (display?.carry?.name || display?.tank?.name) {
    return [display?.carry?.name, display?.tank?.name].filter(Boolean).join(" · ");
  }
  return String(signature)
    .split("|").slice(1).join(" · ")
    .replace(/(?:trait|carry|tank):/gu, "")
    .replace(/^TFT\d+_/u, "").replace(/^DA_\d+_/u, "")
    .replaceAll("_", " ") || "未命名阵容";
}

function compactComposition(comp, signature = comp?.compSignature) {
  if (!comp) return null;
  return {
    signature: String(signature ?? ""),
    label: compLabel(comp, signature),
    matchWeightedUsageRate: finite(comp.playerMatchShare),
    playerBalancedUsageRate: finite(comp.playerBalancedUsageRate),
    avgPlacement: observed(comp, "avgPlacement"),
    top4Rate: observed(comp, "top4Rate"),
    winRate: observed(comp, "winRate"),
    matchCount: finite(comp.playerMatchCount),
    playerCoverage: finite(comp.playerCoverage),
    performanceComparable: comp.performanceComparable === true,
    representativeUnits: (comp.representativeUnits ?? []).slice(0, 10).map((unit) => ({
      name: unit.displayName ?? unit.characterId ?? unit.name ?? "未知棋子",
      starLevel: finite(unit.tier ?? unit.starLevel),
      items: (unit.items ?? []).slice(0, 3).map((item) => item?.displayName ?? item?.apiName ?? item).filter(Boolean)
    }))
  };
}

function compactPool(stats, options = {}) {
  return {
    id: stats.pool.id,
    name: stats.pool.name,
    scope: {
      environment: stats.scope.environment,
      region: stats.scope.region,
      season: stats.scope.season,
      patch: stats.scope.patch,
      provider: stats.scope.provider
    },
    coverage: {
      playerCount: finite(stats.coverage.playerCount),
      activePlayerCount: finite(stats.coverage.activePlayerCount),
      matchCount: finite(stats.coverage.matchCount),
      uniqueMatchCount: finite(stats.coverage.uniqueMatchCount),
      timeFrom: stats.coverage.timeFrom,
      timeTo: stats.coverage.timeTo,
      sampleTier: stats.coverage.sampleTier
    },
    performance: {
      avgPlacement: finite(stats.performance.avgPlacement),
      top4Rate: finite(stats.performance.top4Rate),
      winRate: finite(stats.performance.winRate)
    },
    warnings: [...(stats.warnings ?? [])],
    ...(options.includeCompositions === false ? {} : {
      compositions: (stats.compTrends ?? []).slice(0, 15).map((comp) => compactComposition(comp))
    })
  };
}

export function buildSinglePoolAnalysisEvidence(stats, options = {}) {
  return {
    schemaVersion: ANALYSIS_CONTEXT_SCHEMA_VERSION,
    mode: "single_pool",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    interpretationGoal: "Explain the selected player pool to a beginner using only the supplied metrics.",
    statementPolicy: stats.coverage.matchCount >= 30
      ? "可以描述该玩家池的选择偏好和观测表现；不得外推服务器总体强度或因果关系。"
      : "样本不足 30 场，只能描述观测事实和探索性信号，不得给出稳定强弱结论。",
    pool: compactPool(stats)
  };
}

export function buildPoolComparisonAnalysisEvidence(comparison, options = {}) {
  const [left, right] = comparison.pools;
  return {
    schemaVersion: ANALYSIS_CONTEXT_SCHEMA_VERSION,
    mode: "pool_comparison",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    interpretationGoal: "Explain similarities and differences between the two selected player pools to a beginner.",
    compatibility: comparison.compatibility,
    comparable: comparison.comparable,
    reasons: [...(comparison.reasons ?? [])],
    statementPolicy: comparison.statementPolicy,
    summaryDifferences: comparison.summaryDifferences,
    pools: [
      compactPool(left, { includeCompositions: false }),
      compactPool(right, { includeCompositions: false })
    ],
    compositionDifferences: (comparison.compDifferences ?? []).slice(0, 20).map((row) => ({
      signature: row.compSignature,
      label: compLabel(row.left ?? row.right, row.compSignature),
      left: compactComposition(row.left, row.compSignature),
      right: compactComposition(row.right, row.compSignature),
      usageDeltaPercentagePoints: finite(row.usageDeltaPp),
      playerBalancedDeltaPercentagePoints: finite(row.playerBalancedDeltaPp),
      avgPlacementDelta: finite(row.avgPlacementDelta),
      top4DeltaPercentagePoints: finite(row.top4DeltaPp),
      winDeltaPercentagePoints: finite(row.winDeltaPp),
      performanceComparable: row.performanceComparable === true
    }))
  };
}

export { ANALYSIS_CONTEXT_SCHEMA_VERSION };
