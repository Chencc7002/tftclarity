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
export {
  planMetaTFTCompCandidates,
  planMetaTFTItemCarrierBuilds,
  planMetaTFTUnitBuilds,
  buildUrl
} from "./core/query-planner.js";
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
  entityContentHash,
  extractStatAtoms,
  extractTextNumericAtoms,
  sha256 as sha256MechanismValue,
  stableStringify
} from "./knowledge/mechanic-atom-extractor.js";
export {
  classifySampleEvidence,
  createMechanismCase,
  createQueryFingerprint,
  createSingleItemReplacementComparisons,
  MECHANISM_CASE_SCHEMA_VERSION,
  REPLACEMENT_COMPARISON_SCHEMA_VERSION,
  selectStandardCases,
  validateMechanismCase
} from "./knowledge/mechanism-case-builder.js";
export {
  FACTOR_CANDIDATE_SCHEMA_VERSION,
  FACTOR_DISCOVERY_PACK_SCHEMA_VERSION,
  FACTOR_SCHEMA_VERSION,
  assignUnitsToDiscoverySplits,
  buildFactorDiscoveryPack,
  normalizeFactorCandidate,
  selectStratifiedDiscoveryCases,
  validateFactorCandidate
} from "./knowledge/mechanism-discovery.js";
export {
  createMechanismExtractionProvider,
  resolveMechanismExtractionConfig
} from "./knowledge/mechanism-extraction-provider.js";
export {
  MECHANISM_CLASSIFICATION_SCHEMA_VERSION,
  answerMechanismClassificationQuery,
  buildMechanismClassificationEvidence,
  normalizeMechanismClassifications,
  parseMechanismClassificationQuery
} from "./knowledge/mechanism-classification.js";
export {
  createMechanismClassificationProvider,
  createMechanismClassificationProviderFromConfig,
  resolveMechanismClassificationConfig
} from "./knowledge/mechanism-classification-provider.js";
export {
  buildFactorSchemaEnvelope,
  collectFactorObservations,
  validateNormalizedFactorSchema
} from "./knowledge/mechanism-factor-normalizer.js";
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
export {
  COMP_PREFERENCE_PROTOCOL_VERSION,
  COMP_PREFERENCE_SEARCH_VERSION,
  applyCompPreferenceSearch,
  isCompPreferenceInput,
  parseCompPreferenceConditions,
  validateCompPreferenceConditions
} from "./core/comp-preference-search.js";
export {
  COMP_ANALYSIS_PROTOCOL_VERSION,
  METATFT_HISTORY_CAPABILITY,
  analyzeCompRankingResult,
  isCompAnalysisInput,
  parseCompAnalysisRequest,
  resolveCompAnalysisTarget
} from "./core/comp-analysis.js";
export {
  OFFICIAL_PATCH_EVIDENCE_VERSION,
  associateOfficialPatchChanges,
  getOfficialPatchEvidence,
  listOfficialPatchEvidence
} from "./data/official-patch-evidence.js";
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
export {
  ITEM_CARRIER_DEFAULT_BUILD_LIMIT,
  ITEM_CARRIER_MAX_BUILD_LIMIT,
  ITEM_CARRIER_MAX_LIMIT,
  aggregateItemCarrierRankings
} from "./core/item-carrier-ranking.js";
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
  buildEntityCatalog,
  normalizeEntityCatalogType
} from "./core/entity-catalog.js";
export { queryEntityCatalog } from "./domain/tft/entity-catalog-query.js";
export { aggregateExternalUnits } from "./domain/tft/external-unit-analysis.js";
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
  inspectOfficialTftTokens,
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
  migrateSQLiteSeasonContextSchema,
  SQLITE_CACHE_SCHEMA,
  SQLiteCacheStore
} from "./data/sqlite-cache-store.js";
export { MetaTFTClient, CompsContextClient } from "./data/metatft-client.js";
export {
  COMP_PROFILE_DEFAULTS,
  COMP_PROFILE_FIELDS,
  COMP_STRATEGY_ALGORITHM_VERSION,
  COMP_STRATEGY_OVERRIDE_VERSION,
  LINEUP_SIGNATURE_VERSION,
  MIN_PROFILE_MATCH_CONFIDENCE,
  CompEnrichmentService,
  createCompEnrichmentService,
  createLineupSignature,
  deriveCompStrategy,
  normalizeCompProfileRecord,
  validateCompProfile
} from "./core/comp-enrichment.js";
export {
  DEFAULT_SEASON_CONTEXT_ID,
  SEASON_CONTEXTS,
  SeasonContextError,
  SeasonContextService,
  createSeasonContextService,
  normalizeSeasonContextId
} from "./season/season-context.js";
export {
  SEASON_PROVIDER_OPERATIONS,
  SeasonDataProvider,
  SeasonProviderError,
  UnavailableSeasonProvider,
  createPbeProviderPlaceholder
} from "./season/data-provider.js";
export {
  PROMOTABLE_SEASON_CONTENT_TYPES,
  SeasonContentPromotionError,
  buildSeasonContentPromotionPlan
} from "./season/content-promotion.js";
export {
  createChatStructuredParser,
  createStructuredParserFromConfig,
  DEFAULT_STRUCTURED_PARSER_MODE,
  DEFAULT_STRUCTURED_PARSER_TIMEOUT_MS,
  resolveStructuredParserConfig
} from "./llm/chat-structured-parser.js";
export {
  LIVE_SEMANTIC_TASK_PROMPT_VERSION,
  createChatSemanticTaskProvider
} from "./llm/chat-semantic-task-provider.js";
export {
  LIVE_EXECUTION_PLANNER_PROMPT_VERSION,
  createChatExecutionPlannerProvider
} from "./llm/chat-execution-planner-provider.js";
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
  CONCLUSION_DIMENSION_CONDITIONS,
  CONCLUSION_REQUIREMENT_CONTEXT_VERSION,
  deriveConclusionRequirementContext,
  isLowSampleStats,
  resolveConclusionRequirements
} from "./llm/conclusion-requirements.js";
export {
  CONCLUSION_ERROR_CATEGORIES,
  CONCLUSION_SCHEMA_VERSION,
  CONCLUSION_VALIDATION_FEEDBACK_SCHEMA_VERSION,
  classifyConclusionValidationErrors,
  createConclusionValidationFeedback,
  findConclusionCitationCandidates,
  repairConclusionCitations,
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
  CONCLUSION_SPEC_REGISTRY,
  CONCLUSION_SPEC_REGISTRY_VERSION,
  CONCLUSION_SPEC_SCHEMA_VERSION,
  CONCLUSION_SPECS,
  CONCLUSION_VALIDATOR_VERSION,
  ConclusionSpecRegistry,
  ConclusionSpecRegistryError,
  createConclusionSpecRegistry,
  deriveConclusionQuestionType
} from "./llm/conclusion-spec-registry.js";
export {
  QUESTION_CONTRACT_FINGERPRINT_VERSION,
  QUESTION_CONTRACT_SCHEMA_VERSION,
  createQuestionContract,
  questionContractFingerprint,
  validateQuestionContract
} from "./llm/question-contract.js";
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
  migrateSQLiteSemanticSeasonContext,
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
  EVALUATION_CANDIDATE_SET_SCHEMA_VERSION,
  FAILURE_CANDIDATE_PRIVACY_POLICY,
  FAILURE_CANDIDATE_SCHEMA_VERSION,
  FAILURE_CANDIDATE_STATUSES,
  FAILURE_CATEGORIES,
  FAILURE_LOOP_SCHEMA_VERSION,
  FailureCandidateStore,
  classifyFailure,
  createFailureCandidate,
  exportEvaluationCandidates,
  sanitizeFailureRecord
} from "./evaluation/failure-loop.js";
export {
  CONTEXT_RESOLUTION_VERSION,
  resolveTaskFrameContext
} from "./understanding/context-resolver.js";
export { parseSemanticTask } from "./understanding/semantic-task-parser.js";
export {
  FAST_PATH_POLICY_VERSION,
  capabilityCoversExpectedOutput,
  evaluateFastPathEligibility,
  fastPathDefinition,
  isPureEntityCatalogRequest
} from "./routing/fast-path-policy.js";
export {
  TASK_FRAME_ACTIONS,
  TASK_FRAME_ENTITY_TYPES,
  TASK_FRAME_SCHEMA_VERSION,
  TASK_FRAME_UNDERSTANDING_STATUSES,
  createTaskFrame,
  migrateTaskFrame,
  taskFrameFromIntentEnvelope,
  validateTaskFrame
} from "./understanding/task-frame.js";
export {
  CONVERSATION_STATE_SCHEMA_VERSION,
  MAX_CONVERSATION_SHOWN_IDS,
  MAX_CONVERSATION_TASK_HISTORY,
  conversationStateSessionKey,
  createConversationState,
  migrateLegacySessionToConversationState,
  validateConversationState
} from "./understanding/conversation-state.js";
export {
  TURN_DELTA_SCHEMA_VERSION,
  TURN_DELTA_CONSTRAINT_FIELDS,
  TURN_DELTA_DIALOGUE_ACTS,
  TURN_DELTA_ENTITY_FIELDS,
  TURN_DELTA_OPERATIONS,
  TURN_DELTA_TASK_RELATIONS,
  createTurnDelta,
  unknownTurnDelta,
  validateTurnDelta
} from "./understanding/turn-delta.js";
export {
  TURN_INTERPRETER_VERSION,
  buildTurnInterpreterMessages,
  compactConversationStateForInterpreter,
  interpretTurn
} from "./understanding/turn-interpreter.js";
export {
  CONTEXT_REDUCER_VERSION,
  normalizeContextualTurnDelta,
  reduceConversationState
} from "./understanding/context-reducer.js";
export {
  CONVERSATION_RESULT_STATE_VERSION,
  conversationResultStateFromResponse,
  updateConversationStateFromResult
} from "./understanding/conversation-result-state.js";
export {
  CONVERSATION_PRESENTATION_VERSION,
  applyConversationResultPresentation
} from "./understanding/conversation-presentation.js";
export {
  CONVERSATION_STATE_V2_SHADOW_VERSION,
  compareConversationStateV2Shadow
} from "./understanding/conversation-shadow.js";
export {
  TFT_CONVERSATION_POLICY_VERSION,
  tftConversationPolicy
} from "./domain/tft/conversation-policy.js";
export {
  ANSWER_MODE_ROUTER_SCHEMA_VERSION,
  ANSWER_MODES,
  AnswerModeRouter,
  createAnswerModeRouter,
  routeAnswerMode
} from "./routing/answer-mode-router.js";
export {
  SYSTEM_INTERACTION_ROUTE_SCHEMA_VERSION,
  SYSTEM_INTERACTION_ANSWER_MODE,
  SYSTEM_INTERACTION_TYPES,
  compactSystemInteractionInput,
  createSystemInteractionResult,
  normalizeSystemInteractionInput,
  unhandledSystemInteraction,
  validateSystemInteractionResult
} from "./system-interaction/system-interaction-contracts.js";
export {
  TFT_CAPABILITY_REGISTRY,
  getTftCapabilityRegistry
} from "./system-interaction/capability-registry.js";
export {
  DEFAULT_SYSTEM_INTERACTION_HANDLERS,
  SystemInteractionRouter,
  createSystemInteractionRouter,
  routeSystemInteraction
} from "./system-interaction/system-interaction-router.js";
export {
  CURRENT_STATS_DOCUMENT_TYPES,
  CURRENT_STATS_SCHEMA_VERSION,
  KNOWLEDGE_CLAIM_TYPES,
  KNOWLEDGE_DOCUMENT_JSON_SCHEMA,
  KNOWLEDGE_DOCUMENT_SCHEMA_VERSION,
  KNOWLEDGE_DOCUMENT_TYPES,
  KNOWLEDGE_NAMESPACES,
  assertCurrentStatsKnowledgeDocument,
  assertKnowledgeDocument,
  createKnowledgeDocument,
  knowledgeDocumentToSemanticDocument,
  validateKnowledgeDocument
} from "./knowledge/knowledge-document-schema.js";
export {
  OFFICIAL_PATCH_KNOWLEDGE_VERSION,
  buildOfficialPatchKnowledgeDocuments,
  buildOfficialPatchSemanticDocuments,
  extractPatchVersionFromQuestion
} from "./knowledge/official-patch-knowledge.js";
export {
  buildCompStatsDocuments,
  buildMetaSnapshotDocument,
  buildTrendSnapshotDocument,
  buildUnitStatsDocuments,
  createCurrentStatsScope,
  currentStatsScopeKey,
  generateCurrentStatsDocuments
} from "./knowledge/metatft-document-generator.js";
export {
  CURRENT_STATS_SEMANTIC_PROJECTION_VERSION,
  DEFAULT_CURRENT_STATS_SEMANTIC_CONFIG,
  renderCurrentStatsSemanticProjection,
  resolveCurrentStatsSemanticConfig,
  semanticAveragePlacement,
  semanticPercentage,
  stabilizeCurrentStatsSemanticProjection
} from "./knowledge/current-stats-semantic-projection.js";
export {
  CurrentStatsIndexManager,
  createCurrentStatsIndexManager
} from "./knowledge/current-stats-index-manager.js";
export {
  fetchMetaTftCurrentStats,
  runMetaTftCurrentStatsPipeline
} from "./knowledge/metatft-current-stats-pipeline.js";
export {
  millisecondsUntilDailyRun,
  runCurrentStatsJob
} from "./knowledge/current-stats-job-runner.js";
export {
  KnowledgeIndexer,
  createKnowledgeIndexer
} from "./knowledge/knowledge-indexer.js";
export {
  YouTubeKnowledgeIndexManager,
  createYouTubeKnowledgeIndexManager
} from "./knowledge/youtube-index-manager.js";
export {
  KnowledgeRetriever,
  createKnowledgeRetriever,
  semanticHitToKnowledgeEvidence
} from "./knowledge/knowledge-retriever.js";
export {
  EVIDENCE_BUNDLE_SCHEMA_VERSION,
  buildEvidenceBundle,
  createEvidenceBundle,
  validateEvidenceBundle
} from "./knowledge/evidence-bundle-builder.js";
export {
  COACH_ANSWER_SCHEMA_VERSION,
  COACH_RESPONSE_SCHEMA,
  createCoachProviderFromConfig,
  createOpenAICompatibleCoachProvider,
  resolveCoachProviderConfig
} from "./coach/coach-provider.js";
export {
  HybridAnswerService,
  createHybridAnswerService,
  validateCoachAnswer
} from "./coach/hybrid-answer-service.js";
export {
  TFT_RESOLVED_TASK_FRAME_ADAPTER_VERSION,
  resolvedTaskFrameToParsed
} from "./domain/tft/resolved-task-frame-adapter.js";
export {
  CLARIFICATION_POLICY_VERSION,
  applyClarificationPolicy
} from "./understanding/ambiguity-policy.js";
export {
  CAPABILITY_MATCH_VERSION,
  matchTaskCapabilities
} from "./understanding/capability-matcher.js";
export {
  createRecommendationFromRows,
  conversationStateV2ModeFor,
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
export {
  ITEM_DIFFERENTIATION_ALGORITHM_VERSION,
  ITEM_DIFFERENTIATION_MINIMUMS,
  analyzeItemDifferentiation,
  subtractLockedItems
} from "./core/item-differentiation.js";
export {
  AGENT_EVENT_SCHEMA_VERSION,
  AGENT_RUN_PUBLIC_SCHEMA_VERSION,
  AGENT_RUN_SCHEMA_VERSION,
  AGENT_TOOL_RESULT_SCHEMA_VERSION,
  AGENT_TOOL_SCHEMA_VERSION,
  DEFAULT_AGENT_RUN_BUDGET,
  AgentRun,
  AgentRuntime,
  RuntimeError,
  ToolError,
  ToolExecutor,
  ToolRegistry,
  ExecutionPlanExecutor,
  ResultPolicyExecutor,
  EXECUTION_PLAN_SCHEMA_VERSION,
  EXECUTION_PLAN_VALIDATION_VERSION,
  EXECUTION_TRACE_SCHEMA_VERSION,
  EVIDENCE_VALIDATION_SCHEMA_VERSION,
  AGENT_STATUS_PROTOCOL_VERSION,
  AGENT_STATUS_ENUMS,
  compileExecutionPlan,
  finalizeExecutionPlanArguments,
  planExecution,
  validateExecutionPlan,
  validateExecutionEvidence,
  validateResultPolicy,
  createAgentStatus,
  statusAfterExecution,
  statusAfterPlanning,
  statusAfterUnderstanding,
  validateAgentStatus,
  comparePublicBusinessResults,
  createTftControlledPlannerProvider,
  createStructuredToolDefinitions,
  normalizeRunBudget,
  TASK_PLAN_SCHEMA_VERSION,
  AGENT_TRACE_VERSION,
  DEFAULT_PHASE6_ROLLOUT_POLICY,
  TAKEOVER_ACTION_ORDER,
  TAKEOVER_DECISION_VERSION,
  createTakeoverDecision,
  finalizeTakeoverTrace,
  validateTakeoverPolicy,
  planTask,
  validateTaskPlan
} from "./agent/index.js";

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
