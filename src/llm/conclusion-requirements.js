export const CONCLUSION_REQUIREMENT_CONTEXT_VERSION = "conclusion-requirement-context.v1";

const BUILD_INTENTS = new Set([
  "unit_build_rankings",
  "unit_build_completion",
  "unit_best_3_items"
]);

const ITEM_RANKING_INTENTS = new Set([
  "unit_item_rankings",
  "unit_emblem_rankings"
]);

const ITEM_RANKING_CANDIDATE_LIMIT = 10;
const MIXED_ITEM_RANKING_CANDIDATE_LIMIT = 30;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function itemRankingIsMixed(result) {
  return array(result?.query?.itemCategories).length > 1
    || result?.itemRankingMethodology?.methodology === "category_relative_sample_tier_then_performance_v1"
    || result?.itemRankingMethodology === "category_relative_sample_tier_then_performance_v1";
}

export function isLowSampleStats(stats, query = {}) {
  const configured = Number(query.minSamples ?? 100);
  const minSamples = Number.isFinite(configured) && configured > 0 ? configured : 100;
  return Number(stats?.games ?? 0) < Math.max(200, minSamples * 2);
}

function comparisonEntries(result) {
  const requested = new Set(array(result?.query?.comparisonItems).map(String));
  return array(result?.comparison?.rankedEntries ?? result?.comparison?.entries)
    .filter((entry) => requested.size === 0 || requested.has(String(entry?.apiName ?? "")))
    .slice(0, 5);
}

function candidatesFor(result, intent) {
  if (BUILD_INTENTS.has(intent)) return array(result?.rankedBuilds).slice(0, 3);
  if (ITEM_RANKING_INTENTS.has(intent)) {
    const limit = itemRankingIsMixed(result)
      ? MIXED_ITEM_RANKING_CANDIDATE_LIMIT
      : ITEM_RANKING_CANDIDATE_LIMIT;
    return array(result?.itemRankings).slice(0, limit);
  }
  if (intent === "unit_item_comparison") return comparisonEntries(result);
  return [];
}

function candidateIsLowSample(candidate, intent, query) {
  if (intent === "unit_item_comparison") {
    return Boolean(candidate?.lowSample || candidate?.stable === false);
  }
  if (BUILD_INTENTS.has(intent)) {
    return Boolean(candidate?.lowSample || candidate?.comparisonStable === false || isLowSampleStats(candidate?.stats, query));
  }
  return Boolean(candidate?.lowSample || isLowSampleStats(candidate?.stats, query));
}

export function deriveConclusionRequirementContext(result = {}) {
  const intent = String(result?.type ?? result?.query?.intent ?? "");
  const candidates = candidatesFor(result, intent);
  const comparisonRequested = intent === "unit_item_comparison"
    || array(result?.query?.comparisonItems).length > 0;
  return Object.freeze({
    schemaVersion: CONCLUSION_REQUIREMENT_CONTEXT_VERSION,
    intent,
    candidateCount: candidates.length,
    hasMultipleCandidates: candidates.length >= 2,
    hasLowSample: candidates.some((candidate) => candidateIsLowSample(candidate, intent, result?.query)),
    comparisonRequested,
    comparisonOptionCount: intent === "unit_item_comparison" ? candidates.length : 0
  });
}

const CONDITION_MATCHERS = Object.freeze({
  when_low_sample: (context) => context.hasLowSample,
  when_multiple_candidates: (context) => context.hasMultipleCandidates,
  when_comparison_requested: (context) => context.comparisonRequested
});

export const CONCLUSION_DIMENSION_CONDITIONS = Object.freeze(Object.keys(CONDITION_MATCHERS));

export function resolveConclusionRequirements(spec, result = {}) {
  const context = deriveConclusionRequirementContext(result);
  const allowedAnswerDimensions = [...(spec?.requiredAnswerDimensions ?? [])];
  const conditions = spec?.conditionalAnswerDimensions ?? {};
  const requiredAnswerDimensions = allowedAnswerDimensions.filter((dimension) => {
    const condition = conditions[dimension];
    if (!condition) return true;
    return CONDITION_MATCHERS[condition]?.(context) === true;
  });
  return {
    requiredAnswerDimensions,
    allowedAnswerDimensions,
    requiredEvidence: structuredClone(spec?.requiredEvidence ?? {}),
    context
  };
}
