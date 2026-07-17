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
export { parseRankFilter } from "./core/query-parser.js";
export {
  buildCompRankings as buildCompsContextRankings,
  hasUnsupportedCompRankingEntities
} from "./core/comp-rankings.js";
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
export { planMetaTFTCompCandidates, planMetaTFTUnitBuilds, buildUrl } from "./core/query-planner.js";
export {
  COMP_CANDIDATE_ENDPOINT,
  COMP_FILTER_SEMANTICS_VERSION,
  COMP_FINAL_ENDPOINT,
  compStructuredFilterParams,
  createAppliedCompConstraint,
  createUnavailableCompConstraint,
  normalizeCompCandidateRows,
  parseCompSignature,
  resolveExplicitComp,
  selectStableCompCandidate
} from "./core/comp-filter.js";
export { calculatePlacementStats } from "./core/stats-calculator.js";
export {
  COMP_METRICS,
  buildCompRankingQuery,
  isCompRankingInput,
  isCompRankingFollowUp,
  parseCompMetrics,
  parseCompRankingQuery
} from "./core/comp-query.js";
export {
  METATFT_DEFAULT_MIN_PLAYRATE,
  buildCompRankings
} from "./core/comp-ranking-service.js";
export { filterBuildRows } from "./core/item-policy-filter.js";
export {
  compareRankedBuilds,
  DEFAULT_STABLE_SAMPLE_FLOOR,
  isLowSampleBuild,
  rankBuilds,
  stableSampleThreshold
} from "./core/ranker.js";
export { compareItemOptions, comparisonRankedBuilds } from "./core/item-comparison.js";
export { aggregateUnitItemRankings } from "./core/item-ranking.js";
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
  createCompsPageSnapshot,
  normalizeClusterDefinitions,
  normalizeCompBuildEvidence,
  normalizeCompsPageDataResponse,
  normalizeCompsStatsResponse,
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
export {
  OFFICIAL_COMP_TREND_FIELD_PATH,
  OFFICIAL_COMP_TREND_MINIMUM,
  OFFICIAL_COMP_TREND_PAGE_PATH,
  OFFICIAL_COMP_TREND_THRESHOLD,
  inspectOfficialCompTrendGate
} from "./core/official-comp-trend-gate.js";
export {
  calculateMetaTftPagePlacementChange,
  normalizeMetaTftDailyTrends
} from "./core/metatft-page-trend.js";
export {
  OFFICIAL_TFT_EQUIPMENT_URL,
  buildOfficialTftItemDetailsCatalog,
  fetchOfficialTftItemDetails,
  parseOfficialTftEquipmentPayload
} from "./data/official-item-details.js";
export {
  OFFICIAL_TFT_CHESS_URL,
  OFFICIAL_TFT_RACE_URL,
  OFFICIAL_TFT_JOB_URL,
  buildOfficialTftEntityDetails,
  decodeOfficialTftHtml,
  fetchOfficialTftEntityDetails,
  parseOfficialTftEntityPayload
} from "./data/official-entity-details.js";
export { auditItemPatchChanges } from "./data/item-patch-audit.js";
export {
  buildItemCatalogAudit,
  filterItemCatalogAudit,
  itemCatalogAuditToCsv
} from "./data/item-catalog-audit.js";
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
  makeCompCandidateCacheKey,
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
  CONCLUSION_EVIDENCE_SCHEMA_VERSION,
  MAX_CONCLUSION_EVIDENCE_BYTES,
  buildConclusionEvidence,
  serializeConclusionEvidence
} from "./llm/conclusion-evidence.js";
export {
  CONCLUSION_ERROR_CATEGORIES,
  CONCLUSION_SCHEMA_VERSION,
  CONCLUSION_VALIDATION_FEEDBACK_SCHEMA_VERSION,
  classifyConclusionValidationErrors,
  createConclusionValidationFeedback,
  validateConclusionOutput
} from "./llm/conclusion-validator.js";
export {
  ConclusionProviderError,
  DEFAULT_CONCLUSION_MAX_OUTPUT_TOKENS,
  DEFAULT_CONCLUSION_TIMEOUT_MS,
  createConclusionProviderFromConfig,
  createOpenAICompatibleConclusionProvider,
  resolveConclusionProviderConfig
} from "./llm/conclusion-provider.js";
export {
  BASE_CONCLUSION_PROMPT_VERSION,
  CONCLUSION_PROMPT_ROUTES,
  CORRECTION_PROMPT_VERSION,
  ConclusionPromptRegistry,
  createConclusionPromptRegistry,
  getConclusionPromptRoute
} from "./llm/conclusion-prompt-registry.js";
export {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_EMBEDDING_TIMEOUT_MS,
  EmbeddingProvider,
  EmbeddingProviderUnavailableError,
  FunctionEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
  createEmbeddingProvider,
  createEmbeddingProviderFromConfig,
  resolveEmbeddingProviderConfig
} from "./llm/embedding-provider.js";
export {
  clearEntityCandidateIndex,
  createEntityCandidateIndex,
  getOrCreateEntityCandidateIndex,
  retrieveEntityCandidates
} from "./llm/entity-candidate-retriever.js";
export {
  EVIDENCE_PACK_SCHEMA_VERSION,
  INTENT_ENVELOPE_SCHEMA_VERSION,
  RETRIEVAL_PLAN_SCHEMA_VERSION,
  SEMANTIC_HIT_SCHEMA_VERSION,
  createEvidencePack,
  createIntentEnvelope,
  createRetrievalPlan,
  createSemanticHit,
  validateIntentEnvelope
} from "./retrieval/contracts.js";
export {
  DEFAULT_EVIDENCE_BUDGET,
  PROMPT_KEYS,
  REQUIRED_EVIDENCE,
  RetrievalPlanner,
  createRetrievalPlanner,
  planRetrieval
} from "./retrieval/retrieval-planner.js";
export {
  DEFAULT_EVIDENCE_MAX_CHARACTERS,
  DEFAULT_EVIDENCE_MAX_ITEMS,
  EvidenceAssembler,
  EvidenceAssemblyError,
  assembleEvidencePack,
  createEvidenceAssembler
} from "./retrieval/evidence-assembler.js";
export {
  MemorySemanticDocumentStore,
  SQLITE_SEMANTIC_INDEX_SCHEMA,
  SQLITE_SEMANTIC_INDEX_SCHEMA_VERSION,
  SQLiteSemanticDocumentStore,
  SemanticDocumentStore,
  decodeSemanticEmbedding,
  encodeSemanticEmbedding,
  normalizeSemanticDocument,
  semanticContentHash
} from "./retrieval/semantic-document-store.js";
export {
  EmbeddingSemanticRetriever,
  EntityCandidateSemanticRetriever,
  FallbackSemanticRetriever,
  HybridSemanticRetriever,
  SemanticRetriever,
  TfidfSemanticRetriever,
  createEntityCandidateSemanticRetriever,
  createFallbackSemanticRetriever,
  createPersistentSemanticRetriever,
  retrieveSemanticPlan,
  createTfidfSemanticRetriever
} from "./retrieval/semantic-retriever.js";
export {
  INTENT_SEMANTIC_SAMPLES,
  buildSemanticCorpus
} from "./retrieval/semantic-corpus.js";
export {
  attachOfficialSemanticDescriptions,
  catalogFromRuntimeCacheSnapshot,
  createStaticCompCatalog,
  loadCompleteSemanticCatalog,
  loadRuntimeCatalogSnapshot
} from "./retrieval/semantic-catalog-loader.js";
export {
  auditSemanticIndex,
  buildSemanticIndex
} from "./retrieval/semantic-index-builder.js";
export {
  HYBRID_MATCH_PRIORITY,
  HybridReranker,
  rerankSemanticHits
} from "./retrieval/hybrid-reranker.js";
export {
  STRUCTURED_OPERATION_REGISTRY,
  StructuredRetrievalError,
  StructuredRetriever,
  createStructuredRetriever
} from "./retrieval/structured-retriever.js";
export { runLlmRetrievalPipeline } from "./retrieval/llm-pipeline.js";
export {
  createRecommendationFromRows,
  recommendForInput,
  SESSION_LAST_QUERY_KEY
} from "./core/recommendation-service.js";
export {
  DEFAULT_CONCLUSION_MAX_CORRECTIONS,
  DEFAULT_CONCLUSION_MAX_TRANSPORT_RETRIES,
  DEFAULT_CONCLUSION_MAX_VALIDATION_ERRORS,
  generateEvidenceBackedConclusion,
  makeConclusionCacheKey
} from "./core/conclusion-service.js";

export function planQuery(input, options = {}) {
  const catalog = options.catalog ?? createCatalog();
  const parsed = parseQuery(input, {
    catalog,
    highConfidenceFuzzy: options.highConfidenceFuzzy
  });
  const query = buildQueryContext(parsed, {
    catalog,
    preferences: options.preferences,
    comp: options.comp
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
