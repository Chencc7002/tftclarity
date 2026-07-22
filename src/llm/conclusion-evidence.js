import { requiredCoreItemAppearances } from "../core/core-item-frequency.js";

export const CONCLUSION_EVIDENCE_SCHEMA_VERSION = "llm_conclusion_evidence.v1";
export const MAX_CONCLUSION_EVIDENCE_BYTES = 32 * 1024;

const SUPPORTED_INTENTS = new Set([
  "unit_build_rankings",
  "unit_build_completion",
  "unit_best_3_items",
  "unit_item_comparison",
  "unit_item_rankings",
  "unit_emblem_rankings",
  "comp_rankings",
  "comp_trends",
  "comp_analysis"
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function clipped(value, limit) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\b(?:https?|wss?):\/\/\S+/giu, "[redacted-url]")
    .replace(/\b(?:bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|(?:api[_ -]?key|authorization)\s*[:=]\s*\S+)/giu, "[redacted-secret]")
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/gu, "[redacted-path]")
    .trim()
    .slice(0, limit);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function itemRecord(apiName, catalog) {
  const item = catalog?.itemByApiName?.get?.(apiName);
  return {
    apiName: String(apiName),
    name: item?.preferredDisplayName ?? item?.shortName ?? item?.zhName ?? String(apiName)
  };
}

function unitRecord(apiName, catalog) {
  if (!apiName) return null;
  const unit = catalog?.unitByApiName?.get?.(apiName);
  return {
    apiName: String(apiName),
    name: unit?.zhName ?? unit?.shortName ?? String(apiName)
  };
}

function traitRecord(filterId, catalog) {
  const trait = catalog?.traitByFilterId?.get?.(filterId) ?? catalog?.traitByApiName?.get?.(filterId);
  return {
    apiName: trait?.apiName ?? String(filterId),
    filterId: String(filterId),
    name: trait?.zhName ?? trait?.shortName ?? String(filterId)
  };
}

function statsRecord(stats = {}) {
  return {
    games: finite(stats.games) ?? 0,
    top4Rate: finite(stats.top4Rate),
    winRate: finite(stats.winRate),
    avgPlacement: finite(stats.avgPlacement),
    ...(finite(stats.pickRate) !== null ? { pickRate: finite(stats.pickRate) } : {})
  };
}

function lowSampleFor(stats, query = {}) {
  const configured = Number(query.minSamples ?? 100);
  const minSamples = Number.isFinite(configured) && configured > 0 ? configured : 100;
  return Number(stats?.games ?? 0) < Math.max(200, minSamples * 2);
}

function sourceState(result) {
  const queryCache = result?.cache?.query ?? {};
  const cache = queryCache.stale
    ? "stale"
    : queryCache.hit
      ? "cache"
      : result?.source?.cache ?? "live";
  return {
    provider: clipped(result?.source?.provider ?? "MetaTFT", 40),
    cache,
    updatedAt: result?.source?.updatedAt ?? queryCache.updatedAt ?? null,
    patch: result?.source?.patch ?? result?.query?.patch ?? null
  };
}

function buildWarnings(result) {
  return unique([
    ...asArray(result?.warnings),
    ...asArray(result?.query?.warnings),
    ...asArray(result?.comparison?.warnings)
  ].map((warning) => clipped(warning, 240))).slice(0, 8);
}

function assumptionText(value) {
  if (typeof value === "string") return clipped(value, 160);
  if (!value || typeof value !== "object") return "";
  if (value.text) return clipped(value.text, 160);
  const key = value.key ?? value.name;
  const entry = value.value ?? value.values;
  if (!key) return "";
  return clipped(`${key}: ${Array.isArray(entry) ? entry.join("/") : entry ?? value.source ?? "default"}`, 160);
}

function buildQuery(result, catalog) {
  const query = result?.query ?? {};
  const starLevels = asArray(query.starLevel ?? query.starLevels).map(Number).filter(Number.isInteger);
  return {
    unit: unitRecord(query.unit, catalog),
    starLevels,
    itemPolicy: query.itemPolicy ?? null,
    lockedItems: asArray(query.lockedItems ?? query.ownedItems).slice(0, 3).map((apiName) => itemRecord(apiName, catalog)),
    excludedItems: asArray(query.excludedItems).slice(0, 8).map((apiName) => itemRecord(apiName, catalog)),
    comparisonItems: asArray(query.comparisonItems).slice(0, 5).map((apiName) => itemRecord(apiName, catalog)),
    traits: asArray(query.traitFilters).slice(0, 10).map((filterId) => traitRecord(filterId, catalog)),
    days: finite(query.days),
    patch: query.patch ?? null,
    rankFilter: asArray(query.rankFilter).slice(0, 10).map(String),
    minSamples: finite(query.minSamples),
    sort: query.sort ?? null,
    metrics: asArray(query.metrics).map(String).slice(0, 4),
    limit: finite(query.limit),
    assumptions: asArray(query.assumptions).map(assumptionText).filter(Boolean).slice(0, 12)
  };
}

function preferenceValue(key, value, catalog) {
  if (key === "unit") return unitRecord(value, catalog);
  if (["lockedItems", "ownedItems", "excludedItems", "comparisonItems"].includes(key)) {
    return asArray(value).slice(0, 8).map((apiName) => itemRecord(apiName, catalog));
  }
  if (key === "traitFilters") return asArray(value).slice(0, 10).map((filterId) => traitRecord(filterId, catalog));
  if (Array.isArray(value)) return value.slice(0, 12);
  return value ?? null;
}

function buildPreferenceChanges(previousQuery, currentQuery, catalog) {
  if (!previousQuery || typeof previousQuery !== "object") return [];
  const fields = [
    "unit", "starLevel", "itemPolicy", "lockedItems", "ownedItems", "excludedItems", "comparisonItems",
    "traitFilters", "days", "rankFilter", "minSamples", "sort", "primaryMetric", "metrics"
  ];
  const changes = [];
  for (const field of fields) {
    const before = preferenceValue(field, previousQuery[field], catalog);
    const after = preferenceValue(field, currentQuery?.[field], catalog);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changes.push({ field, before, after });
    if (changes.length >= 10) break;
  }
  return changes;
}

function buildRecommendations(result, catalog) {
  return asArray(result?.rankedBuilds).slice(0, 3).map((build, index) => {
    const lowSample = Boolean(build.lowSample || build.comparisonStable === false || lowSampleFor(build.stats, result?.query));
    return {
      evidenceId: `build:${index + 1}`,
      rank: index + 1,
      items: asArray(build.items).slice(0, 3).map((apiName) => itemRecord(apiName, catalog)),
      stats: statsRecord(build.stats),
      stable: !lowSample,
      lowSample
    };
  });
}

function buildItemSignals(recommendations) {
  const builds = asArray(recommendations).filter((entry) => String(entry?.evidenceId ?? "").startsWith("build:"));
  if (builds.length < 2) return [];
  const requiredAppearances = requiredCoreItemAppearances(builds.length);
  const signals = new Map();
  for (const build of builds) {
    const seenInBuild = new Set();
    for (const item of asArray(build.items)) {
      if (!item?.apiName || seenInBuild.has(item.apiName)) continue;
      seenInBuild.add(item.apiName);
      const signal = signals.get(item.apiName) ?? {
        item,
        appearances: 0,
        firstRank: build.rank,
        buildEvidenceIds: [],
        stable: true
      };
      signal.appearances += 1;
      signal.firstRank = Math.min(signal.firstRank, build.rank);
      signal.buildEvidenceIds.push(build.evidenceId);
      signal.stable = signal.stable && build.stable === true;
      signals.set(item.apiName, signal);
    }
  }
  return [...signals.values()]
    .map((signal) => ({
      ...signal,
      recommendationCount: builds.length,
      requiredAppearances,
      appearanceRate: Number((signal.appearances / builds.length).toFixed(3)),
      core: signal.appearances >= requiredAppearances,
      lowSample: !signal.stable
    }))
    .sort((left, right) => Number(right.core) - Number(left.core)
      || right.appearances - left.appearances
      || left.firstRank - right.firstRank
      || left.item.apiName.localeCompare(right.item.apiName))
    .map(({ firstRank, ...signal }, index) => ({
      evidenceId: `item-signal:${index + 1}`,
      kind: "item_core_signal",
      ...signal
    }));
}

function buildItemRankings(result, catalog) {
  return asArray(result?.itemRankings).slice(0, 5).map((entry, index) => {
    const lowSample = Boolean(entry.lowSample || lowSampleFor(entry.stats, result?.query));
    return {
      evidenceId: `item:${index + 1}`,
      rank: index + 1,
      item: itemRecord(entry.apiName, catalog),
      stats: statsRecord(entry.stats),
      stable: !lowSample,
      lowSample,
      coverage: finite(entry.coverage),
      commonPairings: asArray(entry.commonPairings).slice(0, 3).map((pairing) => ({
        items: asArray(pairing.items).slice(0, 3).map((apiName) => itemRecord(apiName?.apiName ?? apiName, catalog)),
        games: finite(pairing.games)
      })),
      copyCounts: asArray(entry.copyCounts).slice(0, 3).map((copy) => ({
        copyCount: finite(copy.copyCount),
        buildCount: finite(copy.buildCount),
        games: finite(copy.stats?.games)
      }))
    };
  });
}

function buildComparison(result, catalog) {
  const comparison = result?.comparison;
  if (!comparison) return null;
  const allowed = new Set(asArray(result?.query?.comparisonItems));
  const input = asArray(comparison.rankedEntries ?? comparison.entries)
    .filter((entry) => allowed.size === 0 || allowed.has(entry.apiName))
    .slice(0, 5);
  const options = input.map((entry, index) => ({
    evidenceId: `comparison:${index + 1}`,
    rank: index + 1,
    item: itemRecord(entry.apiName, catalog),
    stats: statsRecord(entry.stats),
    stable: Boolean(entry.stable),
    qualified: Boolean(entry.qualified),
    lowSample: Boolean(entry.lowSample || !entry.stable),
    representativeItems: asArray(entry.representativeBuild?.items).slice(0, 3).map((apiName) => itemRecord(apiName, catalog))
  }));
  return {
    winner: comparison.winner ?? null,
    winnerEvidenceId: options.find((entry) => entry.item.apiName === comparison.winner)?.evidenceId ?? null,
    primaryMetric: comparison.primaryMetric ?? result?.query?.primaryMetric ?? null,
    mode: comparison.mode ?? null,
    decision: comparison.decision ? {
      winner: comparison.decision.winner ?? comparison.winner ?? null,
      reason: comparison.decision.reason ?? null
    } : null,
    overlap: comparison.overlap ? {
      games: finite(comparison.overlap.games),
      rate: finite(comparison.overlap.rate)
    } : null,
    options
  };
}

function buildCompRankings(result, options = {}) {
  const records = [];
  const byCompId = new Map();
  const add = (comp, metric, rank, section = "ranking") => {
    const key = String(comp?.compId ?? comp?.name ?? `${metric}:${rank}`);
    let record = byCompId.get(key);
    if (!record) {
      record = {
        evidenceId: `comp:${records.length + 1}`,
        rank: records.length + 1,
        rankingMetric: metric,
        compId: clipped(comp?.compId ?? key, 120),
        name: clipped(comp?.name ?? comp?.compId ?? key, 120),
        stats: statsRecord(comp?.stats),
        trend: Number.isFinite(comp?.trend?.avgPlacementChange) ? {
          avgPlacementChange: comp.trend.avgPlacementChange,
          placementImprovement: Number((-comp.trend.avgPlacementChange).toFixed(4)),
          emergenceScore: finite(comp.trend.emergenceScore),
          improving: Boolean(comp.trend.improving),
          source: comp.trend.source ?? null,
          comparedAt: comp.trend.comparedAt ?? null
        } : null,
        stable: !comp?.lowSample,
        lowSample: Boolean(comp?.lowSample),
        displayRanks: [],
        units: asArray(comp?.units).slice(0, 9).map((unit) => ({
          name: clipped(unit?.name ?? unit?.apiName, 80),
          starLevel: finite(unit?.starLevel),
          avgStarLevel: finite(unit?.avgStarLevel),
          core: Boolean(unit?.core)
        })),
        traits: asArray(comp?.traits).slice(0, 8).map((trait) => ({
          name: clipped(trait?.name ?? trait?.apiName ?? trait?.filterId, 80),
          tier: finite(trait?.tier)
        })),
        enrichment: {
          strategy: comp?.strategyDerivation ? {
            value: comp.strategyDerivation.strategy,
            reason: asArray(comp.strategyDerivation.reason).map((reason) => clipped(reason, 120)),
            algorithmVersion: comp.strategyDerivation.algorithmVersion,
            confidence: finite(comp.strategyDerivation.confidence),
            source: "tftclarity_automatic_derivation"
          } : null,
          profile: comp?.profile ? {
            ...comp.profile,
            profileKey: comp.profileKey,
            source: "tftclarity_profile"
          } : null,
          binding: comp?.profileBinding ?? null,
          sources: {
            facts: "metatft",
            strategy: "tftclarity_automatic_derivation",
            profile: comp?.profile ? "tftclarity_profile" : null
          }
        },
        preferenceMatch: comp?.preferenceMatch ?? null
      };
      byCompId.set(key, record);
      records.push(record);
    }
    record.stable = record.stable && !comp?.lowSample;
    record.lowSample = record.lowSample || Boolean(comp?.lowSample);
    if (Number.isFinite(comp?.trend?.avgPlacementChange)) {
      record.trend = {
        avgPlacementChange: comp.trend.avgPlacementChange,
        placementImprovement: Number((-comp.trend.avgPlacementChange).toFixed(4)),
        emergenceScore: finite(comp.trend.emergenceScore),
        improving: Boolean(comp.trend.improving),
        source: comp.trend.source ?? null,
        comparedAt: comp.trend.comparedAt ?? null
      };
    }
    record.displayRanks.push({ metric, rank, section });
  };

  if (!options.trendOnly) {
    for (const [metric, comps] of Object.entries(result?.rankings ?? {})) {
      asArray(comps).forEach((comp, index) => add(comp, metric, index + 1));
    }
    asArray(result?.references).forEach((comp, index) => add({ ...comp, lowSample: true }, "reference", index + 1, "reference"));
  }
  asArray(result?.improving).forEach((comp, index) => add(comp, "avgPlacementChange", index + 1, "improving"));
  return records;
}

function buildCompRankingContext(result, recommendations) {
  if (!["comp_rankings", "comp_trends", "comp_analysis"].includes(result?.type ?? result?.query?.intent)) return null;
  const metricLeaders = [];
  for (const [metric, comps] of Object.entries(result?.rankings ?? {})) {
    const first = asArray(comps)[0];
    const record = recommendations.find((entry) => entry.compId === first?.compId);
    if (record) metricLeaders.push({ metric, evidenceId: record.evidenceId });
  }
  const displayedCardCount = Object.values(result?.rankings ?? {})
    .reduce((count, comps) => count + asArray(comps).length, 0)
    + asArray(result?.references).length
    + asArray(result?.improving).length;
  return {
    displayedCardCount,
    displayedCandidateCount: recommendations.length,
    requestedMetrics: asArray(result?.query?.metrics).map(String).slice(0, 4),
    trendStatus: result?.trend ?? null,
    metricLeaders,
    stableEvidenceIds: recommendations.filter((entry) => entry.stable).map((entry) => entry.evidenceId),
    lowSampleEvidenceIds: recommendations.filter((entry) => entry.lowSample).map((entry) => entry.evidenceId),
    directAnalysisEvidenceIds: recommendations.length <= 12
      ? recommendations.map((entry) => entry.evidenceId)
      : [...new Set(metricLeaders.map((entry) => entry.evidenceId))],
    enrichment: result?.enrichment ?? null,
    preferenceSearch: result?.preferenceSearch ?? null,
    analysis: result?.analysis ?? null
  };
}

export function buildConclusionEvidence({ result, catalog, input = "", locale = "zh-CN", previousQuery = null } = {}) {
  const resultIntent = result?.type ?? result?.query?.intent;
  if (!SUPPORTED_INTENTS.has(resultIntent)) {
    throw new Error(`Unsupported conclusion evidence intent: ${resultIntent ?? "(missing)"}`);
  }
  const intent = resultIntent === "unit_build_completion" || resultIntent === "unit_best_3_items"
    ? "unit_build_rankings"
    : resultIntent;

  const comparison = intent === "unit_item_comparison" ? buildComparison(result, catalog) : null;
  const recommendations = intent === "unit_item_rankings" || intent === "unit_emblem_rankings"
    ? buildItemRankings(result, catalog)
    : intent === "comp_rankings" || intent === "comp_trends" || intent === "comp_analysis"
      ? buildCompRankings(result, { trendOnly: intent === "comp_trends" })
      : comparison?.options ?? buildRecommendations(result, catalog);
  const itemSignals = ["unit_build_rankings", "unit_build_completion", "unit_best_3_items"].includes(intent)
    ? buildItemSignals(recommendations)
    : [];
  const compRankingContext = ["comp_rankings", "comp_trends", "comp_analysis"].includes(intent)
    ? buildCompRankingContext(result, recommendations)
    : null;
  const dataStatus = sourceState(result);
  const warnings = buildWarnings(result);
  const hasLowSample = recommendations.some((entry) => entry.lowSample);
  const unresolvedComparison = intent === "unit_item_comparison" && !comparison?.winner;
  const evidence = {
    schemaVersion: CONCLUSION_EVIDENCE_SCHEMA_VERSION,
    locale: locale === "en-US" ? "en-US" : "zh-CN",
    request: {
      intent,
      requestedIntent: resultIntent,
      userGoal: asArray(result?.query?.metrics).length > 0
        ? asArray(result?.query?.metrics).map(String).slice(0, 4)
        : result?.query?.sort ?? result?.query?.primaryMetric ?? null,
      inputSummary: clipped(input, 240),
      preferenceChanges: buildPreferenceChanges(previousQuery, result?.query, catalog)
    },
    query: buildQuery(result, catalog),
    recommendations,
    itemSignals,
    itemRankingContext: intent === "unit_item_rankings" || intent === "unit_emblem_rankings" ? {
      displayedCount: recommendations.length,
      methodology: clipped(
        result?.itemRankingMethodology?.methodology
          ?? result?.itemRankingMethodology
          ?? "presence_once_per_complete_build",
        160
      ),
      specialAveragePlacementOnly: result?.itemRankingMethodology?.methodology === "special_item_outlier_cleaned_avg_placement_only"
        || result?.itemRankingMethodology === "special_item_outlier_cleaned_avg_placement_only",
      outlierSampleFloor: Number(result?.itemRankingMethodology?.sampleFloor?.outlierFloor ?? 0),
      outlierSampleRatio: Number(result?.itemRankingMethodology?.sampleFloor?.relativeRatio ?? 0),
      stableEvidenceIds: recommendations.filter((entry) => entry.stable).map((entry) => entry.evidenceId),
      lowSampleEvidenceIds: recommendations.filter((entry) => entry.lowSample).map((entry) => entry.evidenceId),
      stableTopHalfEvidenceIds: recommendations
        .filter((entry) => entry.stable && entry.stats.avgPlacement !== null && entry.stats.avgPlacement < 4)
        .map((entry) => entry.evidenceId),
      stableBottomHalfEvidenceIds: recommendations
        .filter((entry) => entry.stable && entry.stats.avgPlacement !== null && entry.stats.avgPlacement >= 4)
        .map((entry) => entry.evidenceId)
    } : null,
    compRankingContext,
    comparison,
    warnings,
    dataStatus,
    generationRules: {
      factsMustComeFromEvidence: true,
      forbidCausalClaims: true,
      coreClaimsRequireItemSignal: true,
      mustQualifyUnstableCore: itemSignals.some((entry) => entry.core && !entry.stable),
      mustAnalyzeAllDisplayedItemRankings: intent === "unit_item_rankings" || intent === "unit_emblem_rankings",
      mustDistinguishMetricRankFromReliability: intent === "unit_item_rankings" || intent === "unit_emblem_rankings",
      mustAnalyzeDisplayedCompRankings: intent === "comp_rankings" || intent === "comp_trends" || intent === "comp_analysis",
      mustAlignCompRecommendationWithRequestedMetrics: intent === "comp_rankings",
      mustUseStandardizedTrendImprovement: intent === "comp_trends",
      mustPreserveCompAnalysisEvidenceStatus: intent === "comp_analysis",
      causalClaimsMustUseOfficialOrHistoricalEvidence: intent === "comp_analysis",
      mustMentionLowSample: hasLowSample,
      mustMentionStaleData: dataStatus.cache === "stale",
      mustAvoidWinnerClaim: unresolvedComparison
    }
  };
  serializeConclusionEvidence(evidence);
  return evidence;
}

export function serializeConclusionEvidence(evidence) {
  const serialized = JSON.stringify(evidence);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAX_CONCLUSION_EVIDENCE_BYTES) {
    throw new Error(`Conclusion evidence exceeds ${MAX_CONCLUSION_EVIDENCE_BYTES} bytes`);
  }
  return serialized;
}
