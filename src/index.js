import { createCatalog } from "./data/static-data.js";
import { parseQuery } from "./core/query-parser.js";
import { buildQueryContext } from "./core/context-builder.js";
import { validateQueryContext } from "./core/query-validator.js";
import { planMetaTFTUnitBuilds } from "./core/query-planner.js";
import { createRecommendationFromRows } from "./core/recommendation-service.js";

export {
  createCatalog,
  DEFAULT_QUERY_OPTIONS,
  DEFAULT_RANK_FILTER
} from "./data/static-data.js";
export { parseQuery } from "./core/query-parser.js";
export {
  DEFAULT_HIGH_CONFIDENCE_FUZZY_OPTIONS,
  resolveHighConfidenceEntityCandidates
} from "./core/high-confidence-entity-resolver.js";
export {
  createDefaultContextCacheFingerprint,
  normalizeDefaultContextStrategy,
  normalizeSpecialContextMode,
  selectDefaultContextForUnit,
  validateDefaultContextCache
} from "./core/default-context-builder.js";
export { evaluateClarification } from "./core/clarification-policy.js";
export { buildQueryContext } from "./core/context-builder.js";
export { validateQueryContext } from "./core/query-validator.js";
export { planMetaTFTUnitBuilds, buildUrl } from "./core/query-planner.js";
export { calculatePlacementStats } from "./core/stats-calculator.js";
export {
  COMP_METRICS,
  buildCompRankingQuery,
  isCompRankingInput,
  parseCompMetrics,
  parseCompRankingQuery
} from "./core/comp-query.js";
export { buildCompRankings } from "./core/comp-ranking-service.js";
export { filterBuildRows } from "./core/item-policy-filter.js";
export {
  compareRankedBuilds,
  DEFAULT_STABLE_SAMPLE_FLOOR,
  isLowSampleBuild,
  rankBuilds,
  stableSampleThreshold
} from "./core/ranker.js";
export { compareItemOptions, comparisonRankedBuilds } from "./core/item-comparison.js";
export { formatRecommendation } from "./core/response-formatter.js";
export {
  normalizeCompBuildsResponse,
  normalizeCompOptionsResponse,
  normalizeCompsData,
  normalizeExplorerRows,
  normalizeItemRows,
  normalizeLatestClusterInfoResponse,
  normalizeUnitBuildRows
} from "./data/metatft-response-adapter.js";
export {
  normalizeClusterDefinitions,
  normalizeCompBuildEvidence,
  normalizeExactUnitsTraitsResponse,
  parseExactCompRow
} from "./data/comp-response-adapter.js";
export {
  createAssetResolver,
  decorateCompAssets,
  normalizeAssetUrl
} from "./data/asset-resolver.js";
export {
  buildItemCatalogFromItemsResponse,
  classifyItemApiName,
  mergeCatalogItems
} from "./data/item-catalog.js";
export {
  applyOfficialItemLocalization,
  buildOfficialItemLocalizationCatalog,
  createItemLocalizationMap,
  CURRENT_ITEM_LOCALIZATION,
  currentItemLocalizationByApiName,
  isVerifiedLocalizationName,
  mergeOfficialItemLocalization
} from "./data/item-localization.js";
export { CURRENT_ITEM_LOCALIZATION_SOURCE } from "./data/item-localization-sources.js";
export { auditItemPatchChanges } from "./data/item-patch-audit.js";
export {
  applyItemAvailabilityOverride,
  findItemAvailabilityOverride,
  ITEM_AVAILABILITY_OVERRIDES,
  removedOrLegacyItemApiNamesForPatch
} from "./data/item-availability-overrides.js";
export {
  buildTraitCatalogFromCompsData,
  buildTraitCatalogFromExplorerRows,
  buildUnitCatalogFromCompsData,
  buildUnitCatalogFromExplorerRows,
  mergeCatalogTraits,
  mergeCatalogUnits
} from "./data/domain-catalog.js";
export {
  buildEntityAliasOverrideDraft
} from "./data/entity-alias-export.js";
export {
  applyEnabledEntityAliasesFromStore,
  applyEntityAliasesToCatalog
} from "./data/entity-alias-memory.js";
export {
  DEFAULT_CACHE_TTL_MS,
  JsonFileCacheStore,
  MemoryCacheStore,
  makeDefaultContextCacheKey,
  makeQueryCacheKey
} from "./data/cache-store.js";
export {
  SQLITE_CACHE_SCHEMA,
  SQLiteCacheStore
} from "./data/sqlite-cache-store.js";
export { MetaTFTClient, CompsContextClient } from "./data/metatft-client.js";
export {
  createChatStructuredParser,
  createStructuredParserFromConfig,
  DEFAULT_STRUCTURED_PARSER_MODE,
  DEFAULT_STRUCTURED_PARSER_TIMEOUT_MS,
  resolveStructuredParserConfig
} from "./llm/chat-structured-parser.js";
export {
  buildStructuredParserExpansion,
  shouldUseStructuredParser,
  validateStructuredParserOutput
} from "./llm/structured-parser.js";
export {
  clearEntityCandidateIndex,
  createEntityCandidateIndex,
  getOrCreateEntityCandidateIndex,
  retrieveEntityCandidates
} from "./llm/entity-candidate-retriever.js";
export {
  createRecommendationFromRows,
  recommendForInput,
  SESSION_LAST_QUERY_KEY
} from "./core/recommendation-service.js";

export function planQuery(input, options = {}) {
  const catalog = options.catalog ?? createCatalog();
  const parsed = parseQuery(input, {
    catalog,
    highConfidenceFuzzy: options.highConfidenceFuzzy
  });
  const query = buildQueryContext(parsed, {
    catalog,
    preferences: options.preferences,
    defaultContext: options.defaultContext
  });
  const validation = validateQueryContext(query, { catalog });
  const validatedQuery = {
    ...query,
    validation,
    warnings: [...query.warnings, ...validation.warnings]
  };
  const plan = validation.valid ? planMetaTFTUnitBuilds(validatedQuery) : null;

  return {
    parsed,
    query: validatedQuery,
    validation,
    plan
  };
}

export function recommendFromRows(input, rows, options = {}) {
  return createRecommendationFromRows(input, rows, options);
}
