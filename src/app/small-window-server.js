import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnvironment } from "../config/load-env.js";
import {
  normalizeCompAugmentTiers,
  normalizeCompDetailsPositioning
} from "../data/comp-detail-adapter.js";
import {
  AgentRuntime,
  DEFAULT_AGENT_RUN_BUDGET,
  ExecutionPlanExecutor,
  ToolExecutor,
  ToolRegistry,
  createAgentStatus,
  createStructuredToolDefinitions
} from "../agent/index.js";
import { createTftControlledPlannerProvider } from "../agent/controlled-planner-provider.js";
import { summarizeCoreItemFrequency } from "../core/core-item-frequency.js";
import {
  buildEntityCatalog,
  normalizeEntityCatalogType
} from "../core/entity-catalog.js";
import { normalizeAlias } from "../core/normalizer.js";
import { compileExecutionPlan } from "../agent/execution-plan.js";
import { createTftResultPolicyExecutor } from "../domain/tft/result-policy.js";
import { queryEntityCatalog } from "../domain/tft/entity-catalog-query.js";
import { aggregateExternalUnits } from "../domain/tft/external-unit-analysis.js";
import { matchTaskCapabilities } from "../understanding/capability-matcher.js";
import { taskFrameFromIntentEnvelope } from "../understanding/task-frame.js";
import {
  anonymousScopeKey,
  createAnonymousAccessService
} from "../access/anonymous-access.js";
import {
  CompsContextClient,
  CURRENT_ITEM_LOCALIZATION,
  DEFAULT_SEASON_CONTEXT_ID,
  DEFAULT_QUERY_OPTIONS,
  JsonFileCacheStore,
  MetaTFTClient,
  SESSION_LAST_QUERY_KEY,
  SQLiteCacheStore,
  SQLiteSemanticDocumentStore,
  applyEnabledEntityAliasesFromStore,
  analyzeItemDifferentiation,
  buildEntityAliasOverrideDraft,
  buildCompRankings,
  buildItemCatalogAudit,
  buildItemCatalogFromItemsResponse,
  buildTraitCatalogFromCompsData,
  buildTraitCatalogFromExplorerRows,
  buildUnitCatalogFromCompsData,
  buildUnitCatalogFromExplorerRows,
  createCatalog,
  createAnswerModeRouter,
  createSystemInteractionRouter,
  createCoachProviderFromConfig,
  createCompsPageSnapshot,
  createConclusionProviderFromConfig,
  createCompEnrichmentService,
  createEmbeddingProviderFromConfig,
  createHybridAnswerService,
  createSeasonContextService,
  createLineupSignature,
  createIntentEnvelope,
  createConversationState,
  createTaskFrame,
  createPersistentSemanticRetriever,
  createAssetResolver,
  createChatExecutionPlannerProvider,
  createChatSemanticTaskProvider,
  createStructuredParserFromConfig,
  fetchOfficialTftEntityDetails,
  fetchOfficialTftItemDetails,
  filterItemCatalogAudit,
  hasUnsupportedCompRankingEntities,
  mergeCatalogTraits,
  mergeCatalogUnits,
  normalizeCompProfileRecord,
  isLowSampleBuild,
  itemCatalogAuditToCsv,
  KnowledgeRetriever,
  parseQuery,
  recommendForInput,
  generateEvidenceBackedConclusion,
  RetrievalPlanner,
  resolveConclusionProviderConfig,
  resolveCoachProviderConfig,
  resolveEmbeddingProviderConfig,
  retrieveSemanticPlan,
  resolveStructuredParserConfig
} from "../index.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17317;
export const DEFAULT_SMALL_WINDOW_REQUEST_TIMEOUT_MS = 2200;
export const DEFAULT_COMP_RANKINGS_TIMEOUT_MS = 8000;
export const DEFAULT_COMP_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_AUGMENT_LOOKUP_CACHE_TTL_MS = 30 * 60 * 1000;
export const MAX_COMP_DETAIL_UNITS = 12;
export const MAX_COMP_DETAIL_AUGMENTS = 6;
const DISPLAYED_COMP_AUGMENT_RARITIES = new Set(["gold", "prismatic"]);
export const DEFAULT_CONCLUSION_JOB_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_CONCLUSION_STREAM_INTERVAL_MS = 18;
export const DEFAULT_CONCLUSION_JOB_LIMIT = 128;
export const DEFAULT_TURN_INTERPRETER_BUDGET = Object.freeze({
  maxInputTokens: 1600,
  maxOutputTokens: 900,
  maxLatencyMs: 45000
});
const DEFAULT_JSON_CACHE_PATH = resolve(process.cwd(), ".cache", "small-window-cache.json");
const DEFAULT_SQLITE_CACHE_PATH = resolve(process.cwd(), ".cache", "small-window-cache.sqlite");
const DEFAULT_SEMANTIC_INDEX_PATH = resolve(process.cwd(), ".cache", "semantic-index.sqlite");
const PUBLIC_DIR = fileURLToPath(new URL("./small-window-ui/", import.meta.url));
const STATIC_PAGE_ROUTES = new Map([
  ["/admin", "admin.html"],
  ["/admin/", "admin.html"],
  ["/privacy", "privacy.html"],
  ["/privacy/", "privacy.html"],
  ["/terms", "terms.html"],
  ["/terms/", "terms.html"]
]);
const ASSET_RESOLVER = createAssetResolver();
const DETAIL_RETRIEVAL_PLANNER = new RetrievalPlanner();
const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"]
]);
const VALID_ITEM_POLICIES = new Set([
  "ordinary_only",
  "include_radiant",
  "include_artifact",
  "include_special"
]);
const VALID_SORTS = new Set([
  "top4_first",
  "win_first",
  "robust_first",
  "avg_first",
  "games_first"
]);

function defaultAgentStatusForPayload(payload = {}) {
  const clarification = payload.type === "clarification"
    || payload.clarification?.needsClarification;
  const refused = payload.type === "out_of_domain";
  return createAgentStatus({
    understandingStatus: refused
      ? "out_of_domain"
      : clarification
        ? "missing_context"
        : "understood",
    capabilityStatus: refused ? "unsupported" : clarification ? "pending" : "supported",
    planningStatus: clarification || refused ? "not_planned" : "planned",
    executionStatus: clarification || refused ? "pending" : "completed",
    evidenceStatus: clarification || refused ? "insufficient" : "sufficient",
    finalOutcome: refused ? "refused" : clarification ? "clarified" : "answered"
  });
}
const VALID_STRUCTURED_PARSER_MODES = new Set([
  "inherit",
  "auto",
  "never",
  "always"
]);
const VALID_CONCLUSION_MODES = new Set(["inherit", "on", "off"]);
const VALID_RANKS = new Set([
  "CHALLENGER",
  "GRANDMASTER",
  "MASTER",
  "DIAMOND",
  "EMERALD",
  "PLATINUM",
  "GOLD",
  "SILVER",
  "BRONZE",
  "IRON"
]);
const VALID_FEEDBACK_TYPES = new Set([
  "entity_correction",
  "alias_candidate",
  "good_recommendation",
  "bad_recommendation",
  "good_explanation",
  "bad_explanation",
  "missing_result",
  "general"
]);
export const SMALL_WINDOW_PREFERENCES_KEY = "small_window";
export const DEFAULT_SMALL_WINDOW_PREFERENCES = {
  minSamples: DEFAULT_QUERY_OPTIONS.minSamples,
  itemPolicy: DEFAULT_QUERY_OPTIONS.itemPolicy,
  sort: "robust_first",
  days: DEFAULT_QUERY_OPTIONS.days,
  rankFilter: DEFAULT_QUERY_OPTIONS.rankFilter,
  structuredParserMode: "inherit",
  conclusionMode: "inherit"
};

export function normalizeSmallWindowCacheStoreType(value = "json") {
  const type = String(value ?? "json").trim().toLowerCase();
  if (type === "json" || type === "file" || type === "json_file") return "json";
  if (type === "sqlite" || type === "sqlite3") return "sqlite";
  throw new Error(`Unsupported small-window cache store: ${value}`);
}

export function resolveSmallWindowCacheOptions(options = {}, env = process.env) {
  const type = normalizeSmallWindowCacheStoreType(
    options.cacheStoreType
      ?? env.TFT_AGENT_CACHE_STORE
      ?? "json"
  );
  const cachePath = options.cachePath
    ?? env.TFT_AGENT_CACHE_PATH
    ?? (type === "sqlite" ? DEFAULT_SQLITE_CACHE_PATH : DEFAULT_JSON_CACHE_PATH);

  return {
    type,
    cachePath
  };
}

function positiveTimeout(value, fallback = DEFAULT_SMALL_WINDOW_REQUEST_TIMEOUT_MS) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

export function resolveSmallWindowRequestTimeouts(options = {}, env = process.env) {
  return {
    explorerTimeoutMs: positiveTimeout(
      options.explorerTimeoutMs ?? env.TFT_AGENT_EXPLORER_TIMEOUT_MS
    ),
    catalogTimeoutMs: positiveTimeout(
      options.catalogTimeoutMs ?? env.TFT_AGENT_CATALOG_TIMEOUT_MS
    ),
    compsTimeoutMs: positiveTimeout(
      options.compsTimeoutMs ?? env.TFT_AGENT_COMPS_TIMEOUT_MS
    ),
    compRankingsTimeoutMs: positiveTimeout(
      options.compRankingsTimeoutMs ?? env.TFT_AGENT_COMP_RANKINGS_TIMEOUT_MS,
      DEFAULT_COMP_RANKINGS_TIMEOUT_MS
    )
  };
}

export function resolveSmallWindowAgentRunBudget(options = {}, env = process.env) {
  const configured = options.agentRunBudget ?? {};
  return {
    ...configured,
    deadlineMs: positiveTimeout(
      configured.deadlineMs
        ?? options.agentRunDeadlineMs
        ?? env.TFT_AGENT_RUN_DEADLINE_MS,
      DEFAULT_AGENT_RUN_BUDGET.deadlineMs
    )
  };
}

export function resolveSmallWindowStructuredParserConfig(options = {}, env = process.env) {
  return resolveStructuredParserConfig({
    ...(options.structuredParserConfig ?? {}),
    provider: options.structuredParserProvider ?? options.llmProvider ?? options.structuredParserConfig?.provider,
    endpoint: options.structuredParserEndpoint ?? options.llmEndpoint ?? options.structuredParserConfig?.endpoint,
    model: options.structuredParserModel ?? options.llmModel ?? options.structuredParserConfig?.model,
    apiKey: options.structuredParserApiKey ?? options.llmApiKey ?? options.structuredParserConfig?.apiKey,
    timeoutMs: options.structuredParserTimeoutMs ?? options.llmTimeoutMs ?? options.structuredParserConfig?.timeoutMs,
    mode: options.useStructuredParser ?? options.llmMode ?? options.structuredParserConfig?.mode
  }, env);
}

function createSmallWindowStructuredParser(options = {}, env = process.env) {
  if (options.structuredParser) {
    return {
      structuredParser: options.structuredParser,
      useStructuredParser: options.useStructuredParser ?? "auto",
      structuredParserConfig: {
        enabled: true,
        provider: "injected",
        mode: options.useStructuredParser ?? "auto"
      }
    };
  }

  const config = resolveSmallWindowStructuredParserConfig(options, env);
  return {
    structuredParser: createStructuredParserFromConfig(config, {
      fetchImpl: options.structuredParserFetch ?? options.llmFetch,
      promptText: options.structuredParserPromptText ?? options.llmPromptText,
      onRequestLog: options.structuredParserRequestLog ?? options.llmRequestLog
    }),
    useStructuredParser: options.useStructuredParser ?? config.mode,
    structuredParserConfig: config
  };
}

export function resolveSmallWindowConclusionConfig(options = {}, env = process.env) {
  return resolveConclusionProviderConfig({
    ...(options.conclusionGeneratorConfig ?? {}),
    provider: options.conclusionProviderName ?? options.conclusionGeneratorConfig?.provider,
    endpoint: options.conclusionEndpoint ?? options.conclusionGeneratorConfig?.endpoint,
    model: options.conclusionModel ?? options.conclusionGeneratorConfig?.model,
    apiKey: options.conclusionApiKey ?? options.conclusionGeneratorConfig?.apiKey,
    timeoutMs: options.conclusionTimeoutMs ?? options.conclusionGeneratorConfig?.timeoutMs,
    maxOutputTokens: options.conclusionMaxOutputTokens ?? options.conclusionGeneratorConfig?.maxOutputTokens,
    thinkingMode: options.conclusionThinkingMode ?? options.conclusionGeneratorConfig?.thinkingMode,
    mode: options.conclusionMode ?? options.conclusionGeneratorConfig?.mode,
    allowUnauthenticated: options.conclusionAllowUnauthenticated ?? options.conclusionGeneratorConfig?.allowUnauthenticated,
    onEvent: options.conclusionEvent ?? options.conclusionGeneratorConfig?.onEvent
  }, env);
}

function createSmallWindowConclusionGenerator(options = {}, env = process.env) {
  if (options.conclusionProvider) {
    return {
      conclusionProvider: options.conclusionProvider,
      conclusionGeneratorConfig: {
        enabled: true,
        mode: "on",
        provider: "injected",
        model: options.conclusionModel ?? options.conclusionProvider.model ?? "injected-model",
        promptVersion: "generate-conclusion.v1",
        cacheTtlMs: 30 * 60 * 1000,
        ...(options.conclusionGeneratorConfig ?? {})
      }
    };
  }
  const config = resolveSmallWindowConclusionConfig(options, env);
  return {
    conclusionProvider: createConclusionProviderFromConfig(config, {
      fetchImpl: options.conclusionFetch,
      promptText: options.conclusionPromptText,
      onRequestLog: options.conclusionRequestLog
    }),
    conclusionGeneratorConfig: config
  };
}

export function resolveSmallWindowCoachConfig(options = {}, env = process.env) {
  return resolveCoachProviderConfig({
    ...(options.coachConfig ?? {}),
    mode: options.coachMode ?? options.coachConfig?.mode,
    endpoint: options.coachEndpoint ?? options.coachConfig?.endpoint,
    model: options.coachModel ?? options.coachConfig?.model,
    apiKey: options.coachApiKey ?? options.coachConfig?.apiKey,
    timeoutMs: options.coachTimeoutMs ?? options.coachConfig?.timeoutMs,
    maxOutputTokens: options.coachMaxOutputTokens ?? options.coachConfig?.maxOutputTokens,
    allowUnauthenticated: options.coachAllowUnauthenticated ?? options.coachConfig?.allowUnauthenticated
  }, env);
}

function createSmallWindowCoachRuntime(options = {}, env = process.env) {
  if (options.coachProvider) {
    return {
      coachProvider: options.coachProvider,
      coachConfig: {
        enabled: true,
        mode: "on",
        provider: "injected",
        model: options.coachModel ?? options.coachProvider.model ?? "injected-model",
        ...(options.coachConfig ?? {})
      }
    };
  }
  const config = resolveSmallWindowCoachConfig(options, env);
  return {
    coachProvider: createCoachProviderFromConfig(config, {
      fetchImpl: options.coachFetch ?? options.conclusionFetch ?? options.llmFetch
    }),
    coachConfig: config
  };
}

export function resolveSmallWindowSemanticConfig(options = {}, env = process.env) {
  const config = resolveEmbeddingProviderConfig({
    ...(options.embeddingConfig ?? {}),
    mode: options.embeddingMode ?? options.embeddingConfig?.mode,
    provider: options.embeddingProviderName ?? options.embeddingConfig?.provider,
    endpoint: options.embeddingEndpoint ?? options.embeddingConfig?.endpoint,
    model: options.embeddingModel ?? options.embeddingConfig?.model,
    apiKey: options.embeddingApiKey ?? options.embeddingConfig?.apiKey,
    dimensions: options.embeddingDimensions ?? options.embeddingConfig?.dimensions,
    timeoutMs: options.embeddingTimeoutMs ?? options.embeddingConfig?.timeoutMs,
    batchSize: options.embeddingBatchSize ?? options.embeddingConfig?.batchSize,
    allowUnauthenticated: options.embeddingAllowUnauthenticated ?? options.embeddingConfig?.allowUnauthenticated
  }, env);
  const knowledgeMode = String(
    options.knowledgeMode
      ?? env.TFT_AGENT_KNOWLEDGE_MODE
      ?? "off"
  ).trim().toLowerCase();
  return {
    ...config,
    knowledgeEnabled: ["1", "true", "on", "enabled", "auto"].includes(knowledgeMode),
    knowledgeMode,
    indexPath: resolve(String(options.semanticIndexPath ?? env.TFT_AGENT_SEMANTIC_INDEX_PATH ?? DEFAULT_SEMANTIC_INDEX_PATH)),
    locale: String(options.semanticLocale ?? env.TFT_AGENT_SEMANTIC_LOCALE ?? "zh-CN")
  };
}

async function createSmallWindowSemanticRuntime(options = {}, env = process.env) {
  if (options.semanticRetriever) {
    return {
      semanticRetriever: options.semanticRetriever,
      semanticDocumentStore: options.semanticDocumentStore ?? null,
      semanticConfig: { enabled: true, provider: "injected", model: options.embeddingModel ?? "injected-model" }
    };
  }
  const config = resolveSmallWindowSemanticConfig(options, env);
  if (!config.enabled && !config.knowledgeEnabled) {
    return { semanticRetriever: null, semanticDocumentStore: null, semanticConfig: config };
  }
  if (config.enabled && !config.configured && !options.embeddingProvider) {
    throw new Error("Embedding mode is enabled but endpoint, model or API key is missing");
  }
  const store = options.semanticDocumentStore ?? await SQLiteSemanticDocumentStore.open({ filePath: config.indexPath });
  const provider = config.enabled
    ? options.embeddingProvider ?? createEmbeddingProviderFromConfig(config, {
        fetchImpl: options.embeddingFetch
      })
    : null;
  return {
    semanticRetriever: createPersistentSemanticRetriever({ store, provider }),
    semanticDocumentStore: store,
    semanticConfig: config
  };
}

function summarizeCacheStore(options = {}, cacheStore) {
  if (options.cacheStoreInfo) {
    const type = String(options.cacheStoreInfo.type ?? "unknown");
    const cachePath = options.cacheStoreInfo.cachePath ?? options.cacheStoreInfo.path ?? null;
    return {
      type,
      cachePath,
      persistent: Boolean(options.cacheStoreInfo.persistent ?? (type === "json" || type === "sqlite"))
    };
  }

  const configuredType = options.cacheStoreType ?? options.cacheType;
  const type = configuredType
    ? normalizeSmallWindowCacheStoreType(configuredType)
    : cacheStore instanceof SQLiteCacheStore
      ? "sqlite"
      : cacheStore instanceof JsonFileCacheStore
        ? "json"
        : "memory";

  return {
    type,
    cachePath: options.cachePath ?? cacheStore?.filePath ?? null,
    persistent: type === "json" || type === "sqlite"
  };
}

function summarizeStructuredParserConfig(config = {}) {
  const provider = String(config.provider ?? "off");
  const mode = String(config.mode ?? "auto");
  const summary = {
    enabled: Boolean(config.enabled),
    provider,
    mode,
    endpointConfigured: Boolean(config.endpoint),
    apiKeyConfigured: Boolean(config.apiKey)
  };

  if (config.model) summary.model = String(config.model);
  const timeoutMs = Number(config.timeoutMs);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) summary.timeoutMs = timeoutMs;
  return summary;
}

function summarizeConclusionConfig(config = {}) {
  const summary = {
    enabled: Boolean(config.enabled),
    provider: String(config.provider ?? "off"),
    mode: String(config.mode ?? "off"),
    endpointConfigured: Boolean(config.endpoint),
    apiKeyConfigured: Boolean(config.apiKey)
  };
  if (config.model) summary.model = String(config.model);
  if (Number.isFinite(Number(config.timeoutMs))) summary.timeoutMs = Number(config.timeoutMs);
  if (config.thinkingMode) summary.thinkingMode = String(config.thinkingMode);
  return summary;
}

function summarizeSemanticConfig(config = {}, store = null) {
  return {
    enabled: Boolean(config.enabled),
    persistent: Boolean(store instanceof SQLiteSemanticDocumentStore),
    provider: String(config.provider ?? "off"),
    model: config.model ? String(config.model) : null,
    indexConfigured: Boolean(config.indexPath),
    endpointConfigured: Boolean(config.endpoint),
    apiKeyConfigured: Boolean(config.apiKey)
  };
}

export function getSmallWindowRuntimeStatus(runtime = {}) {
  const cacheStoreInfo = runtime.cacheStoreInfo ?? summarizeCacheStore({}, runtime.cacheStore);
  const cachePath = cacheStoreInfo.cachePath ?? cacheStoreInfo.path ?? null;
  const cache = {
    type: String(cacheStoreInfo.type ?? "unknown"),
    persistent: Boolean(cacheStoreInfo.persistent),
    pathConfigured: Boolean(cachePath)
  };
  if (cachePath) cache.cachePath = String(cachePath);

  return {
    cache,
    structuredParser: summarizeStructuredParserConfig(runtime.structuredParserConfig ?? {}),
    conversationState: {
      schemaVersion: "conversation-state.v2",
      mode: runtime.conversationStateV2Mode ?? "off",
      turnDeltaProviderConfigured: typeof runtime.turnDeltaProvider === "function"
    },
    conclusionGenerator: summarizeConclusionConfig(runtime.conclusionGeneratorConfig ?? {}),
    semanticIndex: summarizeSemanticConfig(runtime.semanticConfig ?? {}, runtime.semanticDocumentStore),
    requests: {
      explorerTimeoutMs: runtime.requestTimeouts?.explorerTimeoutMs ?? null,
      catalogTimeoutMs: runtime.requestTimeouts?.catalogTimeoutMs ?? null,
      compsTimeoutMs: runtime.requestTimeouts?.compsTimeoutMs ?? null,
      compRankingsTimeoutMs: runtime.requestTimeouts?.compRankingsTimeoutMs ?? null
    },
    agent: {
      schemaVersion: "agent_run.v1",
      budget: runtime.agentRuntime?.budget ?? null,
      registeredTools: runtime.toolRegistry?.list?.().map((tool) => tool.name) ?? []
    }
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function beginNdjson(res, statusCode = 200) {
  res.writeHead(statusCode, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store, no-transform",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff"
  });
}

function writeNdjson(res, payload) {
  if (res.destroyed || res.writableEnded) return false;
  return res.write(`${JSON.stringify(payload)}\n`);
}

async function readJsonRequest(req, maxBytes = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw Object.assign(new Error("Request body is too large"), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

export function safeStaticPath(pathname) {
  const name = STATIC_PAGE_ROUTES.get(pathname)
    ?? (pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
  if (name.includes("..") || name.includes("\\") || name.startsWith("/")) return null;
  const root = resolve(PUBLIC_DIR);
  const target = resolve(root, name);
  return target === root || target.startsWith(`${root}${sep}`) ? target : null;
}

function itemName(apiName, catalog) {
  const item = catalog.itemByApiName.get(apiName);
  return item?.shortName ?? item?.zhName ?? apiName;
}

function itemDetailsName(apiName, catalog) {
  const item = catalog.itemByApiName.get(apiName);
  return item?.preferredDisplayName ?? item?.zhName ?? item?.shortName ?? apiName;
}

function attachDetailRetrievalMetadata(payload, input, catalog) {
  const intent = payload?.type;
  const entityType = intent === "unit_details"
    ? "unit"
    : intent === "item_details"
      ? "item"
      : intent === "trait_details"
        ? "trait"
        : null;
  if (!entityType) return payload;
  const apiName = entityType === "unit"
    ? payload?.unit?.apiName
    : entityType === "item"
      ? payload?.item?.apiName
      : payload?.trait?.apiName;
  if (!apiName) return payload;
  const entityMatch = {
    entityType,
    apiName,
    alias: payload?.[entityType]?.name ?? apiName,
    matchType: "exact_catalog",
    confidence: 1
  };
  const parsed = {
    rawInput: String(input ?? ""),
    intent,
    confidence: 1,
    parser: { entityMatches: [entityMatch] },
    ...(entityType === "unit" ? { unit: apiName } : {}),
    ...(entityType === "item" ? { ownedItems: [apiName] } : {}),
    ...(entityType === "trait" ? { traitFilters: [apiName] } : {})
  };
  const query = {
    intent,
    warnings: [],
    ...(entityType === "unit" ? { unit: apiName } : {}),
    ...(entityType === "item" ? { lockedItems: [apiName] } : {}),
    ...(entityType === "trait" ? { traitFilters: [apiName] } : {})
  };
  const intentEnvelope = createIntentEnvelope({
    input,
    parsed,
    query,
    validation: { valid: true, errors: [], warnings: [] },
    catalog
  });
  const retrievalPlan = DETAIL_RETRIEVAL_PLANNER.plan(intentEnvelope);
  const taskFrame = taskFrameFromIntentEnvelope(intentEnvelope);
  return {
    ...payload,
    taskFrame,
    intentEnvelope,
    retrievalPlan
  };
}

async function executeRegisteredDetailPayload(payload, runtime, context = {}) {
  const query = payload?.retrievalPlan?.structuredQueries?.[0];
  if (!query || !runtime.toolExecutor || !context.agentRun) return payload;
  const taskFrame = await context.agentRun.stage("resolving", async () => payload.taskFrame);
  const { capabilityMatch, executionPlanning } = await context.agentRun.stage("planning", async () => {
    const matched = matchTaskCapabilities(taskFrame, runtime.toolRegistry);
    return {
      capabilityMatch: matched,
      executionPlanning: compileExecutionPlan(taskFrame, matched, {
        registry: runtime.toolRegistry
      })
    };
  });
  if (executionPlanning.plan && runtime.executionPlanExecutor) {
    const execution = await runtime.executionPlanExecutor.execute(executionPlanning.plan, {
      handlers: {
        [query.operation]: async () => ({
          ...payload,
          updatedAt: payload.updatedAt
            ?? payload.source?.updatedAt
            ?? context.agentRun.startedAt
            ?? new Date().toISOString()
        })
      },
      run: context.agentRun,
      signal: context.signal,
      intent: payload.intentEnvelope?.intent
    });
    if (execution.status !== "completed") {
      throw Object.assign(new Error("Detail ExecutionPlan failed"), {
        code: "execution_plan_failed",
        execution
      });
    }
    const value = execution.results[0].toolResult.value;
    value.capabilityMatch = capabilityMatch;
    value.executionPlan = executionPlanning.plan;
    value.executionTrace = execution.trace;
    return value;
  }
  const result = await runtime.toolExecutor.execute(query.operation, query.params ?? {}, {
    source: query.source,
    handler: async () => payload,
    run: context.agentRun,
    signal: context.signal,
    intent: payload.intentEnvelope?.intent
  });
  return result.value;
}

function isItemDetailsQuestion(input) {
  const text = String(input ?? "");
  return /(是什么(?:装备|道具)?|装备(?:效果|属性|说明|介绍)|(?:有什么)?(?:效果|属性)|合成路线|怎么合成|配方)/u.test(text);
}

function isUnknownItemDetailsQuestion(input) {
  const text = String(input ?? "");
  return /(有什么(?:效果|属性)|是什么(?:装备|道具)?|怎么合成|合成路线|配方(?:是什么|呢|吗|？|\?|$))/u.test(text)
    && !/(哪个|哪件|最好|最强|排行|排名|推荐|阵容)/u.test(text);
}

function itemDetailsNameHint(input) {
  return String(input ?? "")
    .replace(/(?:是什么(?:装备|道具)?|装备(?:效果|属性|说明|介绍)|有什么(?:效果|属性)|效果|属性|合成路线|怎么合成|配方)/gu, "")
    .replace(/[，。！？?；;：:\s]/gu, "")
    .trim();
}

async function loadOfficialItemDetails(runtime) {
  if (runtime.officialItemDetails) return runtime.officialItemDetails;
  if (!runtime.officialItemDetailsPromise) {
    runtime.officialItemDetailsPromise = runtime.fetchOfficialItemDetails({
      fetchImpl: runtime.officialItemDetailsFetch,
      url: runtime.officialItemDetailsUrl,
      timeoutMs: runtime.officialItemDetailsTimeoutMs
    }).then((details) => {
      runtime.officialItemDetails = details;
      runtime.officialItemDetailsLoadedAt = new Date().toISOString();
      return details;
    }).finally(() => {
      runtime.officialItemDetailsPromise = null;
    });
  }
  return runtime.officialItemDetailsPromise;
}

async function serializeItemDetailsQuery(input, catalog, runtime) {
  const parsed = parseQuery(input, { catalog });
  if (!isItemDetailsQuestion(input) || parsed.unit) return null;
  const itemApiNames = parsed.ownedItems ?? [];
  if (itemApiNames.length === 0 && !isUnknownItemDetailsQuestion(input)) return null;
  if (itemApiNames.length !== 1) {
    const hint = itemDetailsNameHint(input);
    const unknown = itemApiNames.length === 0;
    const question = unknown
      ? `没有在当前版本装备目录中识别到“${hint || "该名称"}”。请确认装备名称。`
      : "识别到了多件装备，请指定要查看详情的其中一件。";
    return {
      ok: true,
      type: "clarification",
      text: question,
      answer: { summary: question },
      query: { intent: "clarification", requestedIntent: "item_details", warnings: [] },
      clarification: {
        needsClarification: true,
        blocking: true,
        reason: unknown ? "unknown_item_details" : "multiple_item_details",
        question,
        suggestions: []
      }
    };
  }
  const apiName = itemApiNames[0];
  const catalogItem = catalog.itemByApiName.get(apiName);
  const details = await loadOfficialItemDetails(runtime);
  const item = details.get(apiName);
  if (!item) {
    return {
      ok: true,
      type: "item_details",
      text: `${itemDetailsName(apiName, catalog)}暂无官方装备说明。`,
      answer: { summary: `${itemDetailsName(apiName, catalog)}暂无官方装备说明。` },
      item: {
        apiName,
        name: itemDetailsName(apiName, catalog),
        iconUrl: null,
        category: catalogItem?.category ?? "unknown",
        current: Boolean(catalogItem?.current),
        obtainable: Boolean(catalogItem?.obtainable),
        effect: null,
        recipe: [],
        provenance: {
          catalog: catalogItem?.source ?? null,
          details: null
        }
      }
    };
  }
  const name = itemDetailsName(apiName, catalog);
  const officialName = item.name ?? name;
  return {
    ok: true,
    type: "item_details",
    text: `${name}：${item.effect || "暂无效果说明"}`,
    answer: {
      summary: `${name}的装备说明`,
      methodology: "官方当前版本装备目录"
    },
    item: {
      ...item,
      name,
      officialName,
      category: catalogItem?.category ?? "unknown",
      current: Boolean(catalogItem?.current),
      obtainable: Boolean(catalogItem?.obtainable),
      iconUrl: item.iconUrl ?? catalogItem?.iconUrl ?? null,
      recipe: (item.recipe ?? []).map((component) => ({
        ...component,
        iconUrl: component.iconUrl ?? null
      })),
      provenance: {
        catalog: catalogItem?.source ?? null,
        name: catalogItem?.nameSource ?? catalogItem?.source ?? null,
        details: item.sourceUrl ?? null
      }
    }
  };
}

function serializeCompRankingEntityClarification(parsed, catalog) {
  if (!["comp_rankings", "comp_trends"].includes(parsed?.intent) || !hasUnsupportedCompRankingEntities(parsed)) return null;
  if (parsed.parser?.genericEmblemRequested) {
    const question = "请指定要加入的具体纹章或羁绊，例如“观星者纹章”。";
    return {
      ok: true,
      type: "clarification",
      text: question,
      answer: { summary: question },
      query: { intent: "clarification", requestedIntent: parsed.intent, warnings: [] },
      clarification: {
        needsClarification: true,
        blocking: true,
        reason: "missing_specific_emblem",
        question,
        suggestions: []
      }
    };
  }
  const constraints = [
    parsed.unit ? unitName(parsed.unit, catalog) : null,
    ...(parsed.ownedItems ?? []).map((apiName) => itemName(apiName, catalog)),
    ...(parsed.excludedItems ?? []).map((apiName) => `排除 ${itemName(apiName, catalog)}`),
    ...(parsed.traitFilters ?? []).map((filterId) => traitName(filterId, catalog)),
    ...(parsed.parser?.unresolvedEntityHints ?? []).map((hint) => hint.inputFragment),
    ...(parsed.parser?.entityAmbiguities ?? []).map((ambiguity) => ambiguity.inputFragment)
  ].filter(Boolean);
  const question = `当前阵容榜只支持全局排行，不能静默套用“${constraints.join("、")}”筛选。你想查看全局热门阵容，还是改查指定英雄的装备？`;
  return {
    ok: true,
    type: "clarification",
    text: question,
    answer: { summary: question },
    query: {
      intent: "clarification",
      requestedIntent: parsed.intent,
      unit: parsed.unit ?? null,
      ownedItems: parsed.ownedItems ?? [],
      excludedItems: parsed.excludedItems ?? [],
      traitFilters: parsed.traitFilters ?? [],
      warnings: []
    },
    clarification: {
      needsClarification: true,
      blocking: true,
      reason: "unsupported_comp_entity_filter",
      question,
      suggestions: ["查看全局热门阵容"]
    }
  };
}

function traitName(filterId, catalog) {
  const trait = catalog.traitByFilterId.get(filterId);
  return trait?.displayName ?? trait?.zhName ?? filterId;
}

function unitName(apiName, catalog) {
  const unit = catalog.unitByApiName.get(apiName);
  return unit?.zhName ?? apiName;
}

function serializeDefaultContextCandidate(candidate, catalog) {
  const traitFilters = candidate?.traitFilters ?? candidate?.traits ?? [];
  const units = candidate?.units ?? [];
  const label = candidate?.compName
    ?? (candidate?.clusterId ? `cluster ${candidate.clusterId}` : "主流阵容");

  return {
    label,
    clusterId: candidate?.clusterId ?? null,
    compName: candidate?.compName ?? null,
    sourceEndpoint: candidate?.sourceEndpoint ?? null,
    count: Number.isFinite(Number(candidate?.count)) ? Number(candidate.count) : null,
    score: Number.isFinite(Number(candidate?.score)) ? Number(candidate.score) : null,
    avg: Number.isFinite(Number(candidate?.avg)) ? Number(candidate.avg) : null,
    top4: Number.isFinite(Number(candidate?.top4Rate)) ? percent(Number(candidate.top4Rate)) : null,
    top4Rate: Number.isFinite(Number(candidate?.top4Rate)) ? Number(candidate.top4Rate) : null,
    units,
    unitNames: units.map((apiName) => unitName(apiName, catalog)),
    traitFilters,
    traitNames: traitFilters.map((filterId) => traitName(filterId, catalog)),
    specialContext: Boolean(candidate?.specialContext),
    specialTraits: candidate?.specialTraits ?? [],
    compBuilds: (candidate?.compBuilds ?? []).map((build) => serializeCompBuildEvidence(build, catalog))
  };
}

function serializeCompBuildEvidence(build, catalog) {
  const items = build?.items ?? [];
  return {
    unit: build?.unit ?? null,
    unitName: build?.unit ? unitName(build.unit, catalog) : null,
    items: items.map((apiName) => ({
      apiName,
      name: itemName(apiName, catalog)
    })),
    count: Number.isFinite(Number(build?.count)) ? Number(build.count) : null,
    score: Number.isFinite(Number(build?.score)) ? Number(build.score) : null,
    avg: Number.isFinite(Number(build?.avg)) ? Number(build.avg) : null,
    placeChange: Number.isFinite(Number(build?.placeChange)) ? Number(build.placeChange) : null,
    unitNumItemsCount: Number.isFinite(Number(build?.unitNumItemsCount)) ? Number(build.unitNumItemsCount) : null,
    sourceEndpoint: build?.sourceEndpoint ?? null
  };
}

function serializeDefaultContext(context, catalog) {
  if (!context?.found) return null;
  return {
    ...serializeDefaultContextCandidate(context, catalog),
    found: true,
    sourceDescription: context.sourceDescription ?? null,
    strategy: context.strategy ?? null,
    specialContextMode: context.specialContextMode ?? "exclude",
    specialCandidateCount: context.specialCandidateCount ?? 0,
    excludedSpecialCandidateCount: context.excludedSpecialCandidateCount ?? 0,
    specialContextFallback: Boolean(context.specialContextFallback),
    stable: context.stable !== false,
    lowConfidence: Boolean(context.lowConfidence),
    confidence: Number.isFinite(Number(context.confidence)) ? Number(context.confidence) : null,
    stabilityThreshold: Number.isFinite(Number(context.stabilityThreshold)) ? Number(context.stabilityThreshold) : null,
    sourceScope: context.sourceScope ?? null,
    warning: context.warning ?? null,
    ambiguity: context.ambiguity ?? null,
    candidates: (context.candidates ?? []).map((candidate) => serializeDefaultContextCandidate(candidate, catalog)),
    alternatives: (context.alternatives ?? []).map((candidate) => serializeDefaultContextCandidate(candidate, catalog))
  };
}

function serializeCompConstraint(comp, catalog) {
  if (!comp) return null;
  const value = comp.value
    ? {
      id: comp.value.id,
      name: comp.value.name,
      sampleCount: Number(comp.value.sampleCount ?? 0),
      selection: comp.value.selection,
      units: (comp.value.units ?? []).map((apiName) => ({
        apiName,
        name: unitName(apiName, catalog)
      })),
      traits: (comp.value.traits ?? []).map((apiName) => ({
        apiName,
        name: traitName(apiName, catalog)
      })),
      sourceEndpoint: comp.value.sourceEndpoint ?? null,
      semanticsVersion: comp.value.semanticsVersion ?? null
    }
    : null;
  return {
    status: comp.status,
    source: comp.source,
    confidence: comp.confidence,
    reason: comp.reason ?? null,
    stabilityThreshold: comp.stabilityThreshold ?? null,
    sourceEndpoint: comp.sourceEndpoint ?? value?.sourceEndpoint ?? null,
    semanticsVersion: comp.semanticsVersion ?? value?.semanticsVersion ?? null,
    value
  };
}

function percent(value) {
  return Number((value * 100).toFixed(1));
}

function serializeItemRanking(entry, catalog) {
  return {
    apiName: entry.apiName,
    name: itemName(entry.apiName, catalog),
    iconUrl: ASSET_RESOLVER.resolveItem(entry.apiName).iconUrl,
    stats: {
      top4: percent(entry.stats.top4Rate),
      win: percent(entry.stats.winRate),
      avg: Number(entry.stats.avgPlacement.toFixed(2)),
      games: entry.stats.games
    },
    coverage: Number.isFinite(entry.coverage) ? percent(entry.coverage) : null,
    coverageDenominatorGames: entry.coverageDenominatorGames,
    buildCount: entry.buildCount,
    excludedReason: entry.excludedReason ?? null,
    commonPairings: (entry.commonPairings ?? []).map((pairing) => ({
      games: pairing.games,
      items: pairing.items.map((apiName) => ({
        apiName,
        name: itemName(apiName, catalog),
        iconUrl: ASSET_RESOLVER.resolveItem(apiName).iconUrl
      }))
    })),
    copyCounts: (entry.copyCounts ?? []).map((copy) => ({
      copyCount: copy.copyCount,
      buildCount: copy.buildCount,
      stats: {
        top4: percent(copy.stats.top4Rate),
        win: percent(copy.stats.winRate),
        avg: Number(copy.stats.avgPlacement.toFixed(2)),
        games: copy.stats.games
      }
    }))
  };
}

function sourcePayload(result, meta = {}) {
  const cache = result.cache?.query ?? {};
  const compCandidates = result.cache?.compCandidates ?? {};
  return {
    provider: "MetaTFT",
    endpoint: result.type === "unit_item_comparison"
      ? result.source?.endpoint ?? "tft-explorer-api/unit_builds"
      : result.plan?.path ?? (["comp_rankings", "comp_trends"].includes(result.type)
        ? "/tft-explorer-api/exact_units_traits2"
        : `/tft-explorer-api/unit_builds/${result.query?.unit ?? ""}`),
    patch: result.query?.patch ?? null,
    updatedAt: cache.updatedAt ?? result.sourceUpdatedAt ?? meta.sourceUpdatedAt ?? null,
    cache: cache.stale ? "stale" : cache.hit ? "cache" : "live",
    stale: Boolean(cache.stale),
    cacheDetail: result.cache?.query ?? null,
    requestParams: result.plan?.params ?? null,
    compCandidates: result.compCandidatePlan ? {
      endpoint: result.compCandidatePlan.path,
      params: result.compCandidatePlan.params,
      cache: compCandidates.stale ? "stale" : compCandidates.hit ? "cache" : "live",
      stale: Boolean(compCandidates.stale),
      updatedAt: compCandidates.updatedAt ?? null
    } : null,
    risks: [
      ...(result.query?.warnings ?? []),
      ...(cache.stale ? ["实时数据失败，当前回答使用过期缓存"] : []),
      ...(compCandidates.stale ? ["Comp 候选使用同口径过期缓存，阵容选择可能滞后"] : [])
    ]
  };
}

function compAnswerPrefix(comp) {
  if (comp?.status === "not_available") {
    return "当前条件下未找到稳定 Comp，以下结果未限制 Comp。";
  }
  if (comp?.status !== "applied" || !comp.value) return "";
  return comp.value.selection === "explicit"
    ? `${comp.value.name}（用户指定）条件下，`
    : `${comp.value.name}（系统补全，样本 ${comp.value.sampleCount}）条件下，`;
}

function conversationMeta(meta = {}) {
  return {
    conversationId: String(meta.conversationId ?? randomUUID()),
    messageId: String(meta.messageId ?? randomUUID())
  };
}

function itemDifferences(reference, candidate, catalog) {
  const remaining = (reference?.items ?? []).map((item) => item.apiName ?? item);
  const added = [];
  for (const item of candidate?.items ?? []) {
    const index = remaining.indexOf(item.apiName ?? item);
    if (index >= 0) remaining.splice(index, 1);
    else added.push(item.apiName ?? item);
  }
  return {
    removed: remaining.map((apiName) => itemName(apiName, catalog)),
    added: added.map((apiName) => itemName(apiName, catalog)),
    top4Delta: candidate && reference ? Number((candidate.stats.top4 - reference.stats.top4).toFixed(1)) : 0,
    winDelta: candidate && reference ? Number((candidate.stats.win - reference.stats.win).toFixed(1)) : 0,
    avgDelta: candidate && reference ? Number((candidate.stats.avg - reference.stats.avg).toFixed(2)) : 0,
    gamesDelta: candidate && reference ? candidate.stats.games - reference.stats.games : 0
  };
}

export function normalizeSmallWindowPreferences(value = {}) {
  const preferences = {};
  const minSamples = Number(value.minSamples);
  if (Number.isInteger(minSamples) && minSamples >= 0) preferences.minSamples = minSamples;
  if (VALID_ITEM_POLICIES.has(value.itemPolicy)) preferences.itemPolicy = value.itemPolicy;
  if (VALID_SORTS.has(value.sort)) preferences.sort = value.sort;
  if (VALID_STRUCTURED_PARSER_MODES.has(value.structuredParserMode)) {
    preferences.structuredParserMode = value.structuredParserMode;
  }
  if (VALID_CONCLUSION_MODES.has(value.conclusionMode)) preferences.conclusionMode = value.conclusionMode;
  const days = Number(value.days);
  if (Number.isInteger(days) && days > 0 && days <= 30) preferences.days = days;
  if (Array.isArray(value.rankFilter) && value.rankFilter.length > 0) {
    const rankFilter = value.rankFilter
      .map((rank) => String(rank).toUpperCase())
      .filter((rank) => VALID_RANKS.has(rank));
    if (rankFilter.length > 0) preferences.rankFilter = rankFilter;
  }
  return preferences;
}

export function completeSmallWindowPreferences(value = {}) {
  return {
    ...DEFAULT_SMALL_WINDOW_PREFERENCES,
    ...normalizeSmallWindowPreferences(value)
  };
}

function preferenceOverrides(value = {}) {
  const normalized = normalizeSmallWindowPreferences(value);
  return Object.fromEntries(Object.entries(normalized).filter(([key, entry]) => {
    const defaultValue = DEFAULT_SMALL_WINDOW_PREFERENCES[key];
    if (Array.isArray(entry) || Array.isArray(defaultValue)) {
      return JSON.stringify(entry ?? null) !== JSON.stringify(defaultValue ?? null);
    }
    return entry !== defaultValue;
  }));
}

function preferenceKey(scope) {
  return scope ? anonymousScopeKey(scope, SMALL_WINDOW_PREFERENCES_KEY) : SMALL_WINDOW_PREFERENCES_KEY;
}

async function loadOfficialEntityDetails(runtime) {
  if (runtime.officialEntityDetails) return runtime.officialEntityDetails;
  if (!runtime.officialEntityDetailsPromise) {
    runtime.officialEntityDetailsPromise = runtime.fetchOfficialEntityDetails({
      fetchImpl: runtime.officialEntityDetailsFetch,
      chessUrl: runtime.officialChessUrl,
      raceUrl: runtime.officialRaceUrl,
      jobUrl: runtime.officialJobUrl,
      timeoutMs: runtime.officialEntityDetailsTimeoutMs
    }).then((details) => {
      runtime.officialEntityDetails = details;
      runtime.officialEntityDetailsLoadedAt = new Date().toISOString();
      return details;
    }).finally(() => {
      runtime.officialEntityDetailsPromise = null;
    });
  }
  return runtime.officialEntityDetailsPromise;
}

function baseTraitApiName(value) {
  return String(value ?? "").replace(/_[0-9]+$/, "");
}

function explicitUnitDetailsQuestion(input) {
  const text = String(input ?? "");
  return /(?:属性|技能|详情|介绍|棋子信息|是什么棋子)/u.test(text)
    && !/(装备|出装|转职|纹章|阵容|排行|排名|推荐)/u.test(text);
}

function explicitTraitDetailsQuestion(input) {
  const text = String(input ?? "");
  return /(?:羁绊|效果|属性|详情|介绍|档位|几人)/u.test(text)
    && !/(装备|出装|转职|纹章|阵容|排行|排名|推荐)/u.test(text);
}

function requestsSoftCompItemDemand(input, parsed = {}) {
  const text = String(input ?? "");
  const softPreference = /(?:最好|尽量|优先).{0,8}(?:少用|不用|避免|减少).{0,8}(?:装备|散件|大剑|反曲弓|大棒|眼泪|腰带|锁子甲|斗篷|拳套)/u.test(text)
    || /(?:少用|减少).{0,8}(?:装备|散件|大剑|反曲弓|大棒|眼泪|腰带|锁子甲|斗篷|拳套)/u.test(text);
  return softPreference && (
    /阵容|体系/u.test(text)
    || ["comp_rankings", "comp_trends", "comp_analysis"].includes(parsed?.intent)
  );
}

function requestedEntityCatalogType(input) {
  const text = String(input ?? "").replace(/\s+/gu, "");
  const lower = text.toLowerCase();
  const listWording = /(?:全部|所有|完整|大全|一览|列表|图鉴)/u;
  if (
    /(?:全部|所有|完整)(?:的)?(?:棋子|英雄)/u.test(text)
    || /(?:棋子|英雄)(?:大全|一览|列表|图鉴)/u.test(text)
    || (listWording.test(text) && /(?:棋子|英雄)/u.test(text))
    || /(?:all|every)(?:champion|champions|unit|units)|(?:champion|unit)(?:list|catalog)/u.test(lower)
  ) {
    return "unit";
  }
  if (
    /(?:全部|所有|完整)(?:的)?羁绊/u.test(text)
    || /羁绊(?:大全|一览|列表|图鉴)/u.test(text)
    || (listWording.test(text) && /羁绊/u.test(text))
    || /(?:all|every)(?:trait|traits)|trait(?:list|catalog)/u.test(lower)
  ) {
    return "trait";
  }
  return null;
}

function entityCatalogText(entityType, count) {
  return entityType === "unit"
    ? `当前赛季共找到 ${count} 个棋子，点击棋子可以查看属性、技能和羁绊详情。`
    : `当前赛季共找到 ${count} 个羁绊，点击羁绊可以查看效果和激活档位。`;
}

function requestSessionKey(scope, conversationId) {
  const localKey = conversationId === "default" ? SESSION_LAST_QUERY_KEY : `last_query:${conversationId}`;
  return scope ? anonymousScopeKey(scope, localKey) : localKey;
}

async function conversationStateEntry(runtime, scope, conversationId, seasonContextId) {
  const entry = await runtime.cacheStore?.getSessionState?.(
    requestSessionKey(scope, conversationId),
    { seasonContextId }
  );
  return entry?.value ?? entry ?? null;
}

async function persistDetailTaskFrame(payload, runtime, options = {}) {
  if (!payload?.taskFrame || !runtime.cacheStore?.setSessionState) return;
  const current = createConversationState(
    await conversationStateEntry(runtime, options.scope, options.conversationId, options.seasonContextId) ?? {}
  );
  const updatedAt = new Date().toISOString();
  const next = createConversationState({
    ...current,
    activeTask: {
      taskFrame: payload.taskFrame,
      legacyIntent: payload.type,
      updatedAt
    },
    pendingClarification: null,
    updatedAt,
    query: payload.query ?? null
  });
  await runtime.cacheStore.setSessionState(
    requestSessionKey(options.scope, options.conversationId),
    next,
    { seasonContextId: options.seasonContextId }
  );
}

async function queryCompositionMemberStatistics(toolInput, catalog, runtime, options = {}) {
  const traitId = baseTraitApiName(toolInput.trait);
  const traitRecord = catalog.traitByApiName.get(traitId);
  const name = traitRecord?.zhName ?? traitRecord?.displayName ?? traitId;
  const compsData = options.compsData ?? await runtime.compsClient.getCompsData({
    queue: options.preferences?.queue
  });
  const compsStats = await runtime.compsClient.getCompsStats({
    queue: options.preferences?.queue,
    patch: options.preferences?.patch,
    days: toolInput.days ?? options.preferences?.days
  });
  const rankings = buildCompRankings({ compsData, compsStats }, {
    catalog,
    query: {
      intent: "comp_rankings",
      patch: options.preferences?.patch ?? "current",
      minSamples: 0,
      limit: 100,
      popularRequested: true
    }
  });
  const details = await loadOfficialEntityDetails(runtime);
  const traitNames = new Set([name, traitRecord?.displayName, ...(traitRecord?.aliases ?? [])].filter(Boolean));
  const traitMembers = [...(details.units ?? new Map()).values()]
    .filter((unit) => (unit.traitNames ?? []).some((traitNameValue) => traitNames.has(traitNameValue)))
    .map((unit) => unit.apiName);
  const results = aggregateExternalUnits(rankings.candidates, {
    trait: traitId,
    traitMembers,
    minSamples: toolInput.minSamples,
    limit: toolInput.limit
  });
  return {
    type: "trait_external_unit_statistics",
    source: "metatft",
    updatedAt: rankings.source?.updatedAt ?? new Date().toISOString(),
    trait: traitId,
    results,
    text: results.length
      ? `${name}阵容常见的非羁绊外援：${results.map((entry) => entry.name).join("、")}。`
      : `${name}在当前样本门槛下没有可验证的非羁绊外援。`
  };
}

async function tryExternalSupportRequest(input, catalog, runtime, options = {}) {
  if (!/外援|单挂|單掛|外挂/u.test(input)) return null;
  const explicitNonTrait = /(?:阵容|陣容).{0,10}(?:非|不属于|不屬於).{0,8}(?:羁绊|羈絆)|(?:非|不属于|不屬於)(?:本)?羁绊外援/u.test(input);
  if (!explicitNonTrait) {
    const state = await conversationStateEntry(
      runtime,
      options.scope,
      options.conversationId,
      options.seasonContextId
    );
    const previousTool = state?.lastResult?.toolName
      ?? state?.activeTask?.legacyIntent
      ?? state?.query?.intent;
    if (previousTool === "item_carrier_rankings") return null;
    const parsed = parseQuery(input, { catalog });
    const traitId = baseTraitApiName(parsed.traitFilters?.[0]);
    const trait = catalog.traitByApiName.get(traitId);
    const name = trait?.zhName ?? trait?.displayName ?? "目标羁绊";
    const question = `你说的“${name}外援”是指阵容中常见的非${name}单挂棋子，还是适合携带${name}转职的棋子？`;
    return {
      ok: true,
      type: "clarification",
      text: question,
      query: { intent: "unknown", traitFilters: traitId ? [traitId] : [], warnings: [] },
      clarification: {
        blocking: true,
        needsClarification: true,
        reason: "ambiguous_game_concept",
        question,
        suggestions: [`${name}阵容里的非羁绊单挂`, `${name}转职适合谁带`]
      },
      taskFrame: createTaskFrame({
        domain: "tft",
        action: "search",
        concepts: [
          ...(traitId ? [{ rawText: name, expectedType: "trait", resolvedId: traitId, confidence: 1 }] : []),
          { rawText: "外援", expectedType: "game_concept", resolvedId: "concept.unit.external_support", confidence: 1 }
        ],
        goal: "resolve_external_support_meaning",
        ambiguities: [{
          code: "ambiguous_game_concept",
          inputFragment: "外援",
          affectsResult: true,
          affectsToolSelection: true,
          candidates: [
            { id: "non_trait_splash_unit", label: "阵容中常见的非本羁绊单挂棋子" },
            { id: "emblem_carrier", label: "适合携带目标羁绊转职的棋子" }
          ]
        }],
        confidence: 0.9,
        understandingStatus: "ambiguous"
      })
    };
  }
  if (options.clarificationOnly) return null;

  const parsed = parseQuery(input, { catalog });
  const traitId = baseTraitApiName(parsed.traitFilters?.[0]);
  if (!traitId) return null;
  const traitRecord = catalog.traitByApiName.get(traitId);
  const name = traitRecord?.zhName ?? traitRecord?.displayName ?? traitId;
  const taskFrame = createTaskFrame({
    domain: "tft",
    action: "search",
    concepts: [
      { rawText: name, expectedType: "trait", resolvedId: traitId, confidence: 1 },
      { rawText: "外援", expectedType: "game_concept", resolvedId: "concept.unit.external_support", confidence: 1 }
    ],
    constraints: {
      externalSupportInterpretation: "non_trait_splash_unit",
      days: options.preferences?.days ?? 2,
      rank: options.preferences?.rankFilter,
      minSamples: 300,
      limit: 10
    },
    goal: "find_external_support_units",
    expectedOutput: ["results", "ranking", "evidence"],
    capabilityRequirements: ["composition_external_unit_statistics"],
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const capabilityMatch = matchTaskCapabilities(taskFrame, runtime.toolRegistry);
  const executionPlanning = compileExecutionPlan(taskFrame, capabilityMatch, { registry: runtime.toolRegistry });
  if (!executionPlanning.plan) return null;
  const execution = await runtime.executionPlanExecutor.execute(executionPlanning.plan, {
    handlers: {
      composition_member_statistics: (toolInput) => queryCompositionMemberStatistics(
        toolInput,
        catalog,
        runtime,
        options
      )
    },
    run: options.agentRun,
    signal: options.signal,
    intent: "composition_member_statistics"
  });
  if (execution.status !== "completed") throw Object.assign(new Error("external unit statistics failed"), { execution });
  const result = execution.result;
  const text = result.results.length
    ? `${name}阵容常见的非羁绊外援：${result.results.map((entry) => entry.name).join("、")}。`
    : `${name}在当前样本门槛下没有可验证的非羁绊外援。`;
  return {
    ok: true,
    ...result,
    text,
    answer: { summary: text, methodology: "按包含目标羁绊的真实阵容聚合，并排除目标羁绊原生成员。" },
    query: { intent: "composition_member_statistics", trait: traitId, warnings: [] },
    taskFrame,
    capabilityMatch,
    executionPlan: executionPlanning.plan,
    executionTrace: execution.trace
  };
}

async function serializeEntityCatalog(catalog, runtime, options = {}) {
  const entityType = normalizeEntityCatalogType(options.entityType ?? options.type);
  if (!entityType) {
    throw Object.assign(new TypeError("entityType must be unit or trait"), {
      statusCode: 400,
      code: "invalid_entity_catalog_type"
    });
  }
  const details = await loadOfficialEntityDetails(runtime);
  const view = buildEntityCatalog(catalog, details, {
    ...options,
    entityType,
    assetResolver: ASSET_RESOLVER
  });
  const text = entityCatalogText(entityType, view.pagination.total);
  return {
    ok: true,
    ...view,
    text,
    answer: {
      summary: text,
      methodology: "当前赛季动态实体目录限定可见范围，官方目录补充详情；羁绊按基础 API 名称合并档位。"
    },
    source: details.meta ?? null
  };
}

function rankStableItemRecommendationsBySamples(entries, catalog) {
  const candidates = (entries ?? []).filter((entry) => {
    const item = catalog.itemByApiName.get(entry.apiName);
    return item?.category === "ordinary_completed"
      && item.current !== false
      && item.obtainable !== false
      && Number(entry.stats?.games) > 0
      && Number.isFinite(Number(entry.stats?.avgPlacement));
  });
  return candidates
    .sort((a, b) => (
      Number(b.stats.games) - Number(a.stats.games)
      || Number(a.stats.avgPlacement) - Number(b.stats.avgPlacement)
      || Number(b.stats.top4Rate ?? 0) - Number(a.stats.top4Rate ?? 0)
      || String(a.apiName).localeCompare(String(b.apiName))
    ))
    .slice(0, 3);
}

async function stableUnitItems(apiName, catalog, runtime, context = {}) {
  const name = unitName(apiName, catalog);
  const result = await runtime.recommendForInputImpl(`${name}普通单件装备排行，样本>=0`, {
    catalog,
    metaTFTClient: runtime.metaTFTClient,
    compsClient: runtime.compsClient,
    compsData: context.compsData,
    cacheStore: runtime.cacheStore,
    preferences: { ...(context.preferences ?? {}), minSamples: 0, itemPolicy: "ordinary_only" },
    explicitPreferences: { minSamples: 0, itemPolicy: "ordinary_only" },
    bypassQueryCache: Boolean(context.refresh),
    bypassDefaultContextCache: Boolean(context.refresh),
    structuredParser: null,
    useStructuredParser: "never",
    useSession: false
  });
  return rankStableItemRecommendationsBySamples(result.itemRankings, catalog)
    .map((entry) => serializeItemRanking(entry, catalog));
}

async function serializeEntityDetailsQuery(input, catalog, runtime, context = {}) {
  const unitWording = explicitUnitDetailsQuestion(input);
  const traitWording = explicitTraitDetailsQuestion(input);
  if (!unitWording && !traitWording) return null;

  let details = null;
  let entityCatalog = catalog;
  let parsed = parseQuery(input, { catalog: entityCatalog });
  if (!parsed.unit && !(parsed.traitFilters ?? []).length) {
    details = await loadOfficialEntityDetails(runtime);
    const officialUnits = buildUnitCatalogFromCompsData({
      compOptions: [{ units_list: [...details.units.keys()].join("&") }]
    });
    const officialTraitFilters = [...details.traits.values()].flatMap((trait) => {
      const tiers = (trait.levels ?? []).map((level) => `${trait.apiName}_${level.units}`);
      return tiers.length ? tiers : [`${trait.apiName}_1`];
    });
    const officialTraits = buildTraitCatalogFromCompsData({
      compOptions: [{ traits_list: officialTraitFilters.join("&") }]
    });
    entityCatalog = createCatalog({
      units: mergeCatalogUnits(catalog.units, officialUnits),
      traits: mergeCatalogTraits(catalog.traits, officialTraits),
      items: catalog.items
    });
    parsed = parseQuery(input, { catalog: entityCatalog });
  }

  const unitApiName = parsed.unit ?? null;
  const traitApiNames = [...new Set((parsed.traitFilters ?? []).map(baseTraitApiName))];
  const wantsUnit = Boolean(unitApiName && unitWording);
  const wantsTrait = Boolean(!unitApiName && traitApiNames.length === 1 && traitWording);
  if (!wantsUnit && !wantsTrait) return null;

  details ??= await loadOfficialEntityDetails(runtime);
  if (wantsUnit) {
    const official = details.units.get(unitApiName);
    const catalogUnit = entityCatalog.unitByApiName.get(unitApiName);
    let recommendations = [];
    let recommendationWarning = null;
    try {
      recommendations = await stableUnitItems(unitApiName, entityCatalog, runtime, context);
    } catch (error) {
      recommendationWarning = error?.message ?? String(error);
    }
    const name = catalogUnit?.zhName ?? official?.name ?? unitApiName;
    return {
      ok: true,
      type: "unit_details",
      text: official ? `${name}：${official.ability?.name ?? "技能信息"}` : `${name}暂无官方棋子详情。`,
      answer: {
        summary: `${name}的属性、技能与稳定装备推荐`,
        methodology: "仅统计当前可获取的普通成装，并按样本数从高到低排序；平均名次与前四率仅用于展示，不参与排序。"
      },
      unit: {
        ...(official ?? { stats: {}, ability: {}, traitNames: [] }),
        apiName: unitApiName,
        name,
        iconUrl: ASSET_RESOLVER.resolveUnit(unitApiName).iconUrl
      },
      recommendedItems: recommendations,
      recommendationWarning,
      source: official?.source ?? details.meta ?? null
    };
  }

  const traitApiName = traitApiNames[0];
  const official = details.traits.get(traitApiName);
  const catalogTrait = entityCatalog.traitByApiName.get(traitApiName)
    ?? entityCatalog.traitByFilterId.get(parsed.traitFilters[0]);
  const name = official?.name ?? catalogTrait?.displayName ?? catalogTrait?.zhName ?? traitApiName;
  return {
    ok: true,
    type: "trait_details",
    text: official ? `${name}：${official.description}` : `${name}暂无官方羁绊详情。`,
    answer: { summary: `${name}的羁绊效果与档位属性` },
    trait: {
      ...(official ?? { description: null, levels: [], type: null, iconUrl: null }),
      apiName: traitApiName,
      name
    },
    source: official?.source ?? details.meta ?? null
  };
}

function entityCatalogPreferences(runtime, seasonContext) {
  return {
    ...DEFAULT_SMALL_WINDOW_PREFERENCES,
    seasonContextId: seasonContext.id,
    providerVersion: seasonContext.source.providerVersion,
    effectivePatch: seasonContext.effectivePatch,
    currentPatch: seasonContext.currentPatch,
    previousPatch: seasonContext.previousPatch,
    patch: seasonContext.providerPatch ?? "current",
    queue: seasonContext.source.queue
  };
}

export async function handleEntityCatalogRequest(runtime, options = {}) {
  const seasonContext = runtime.seasonContextService.resolveForQuery(options.seasonContextId);
  const preferences = entityCatalogPreferences(runtime, seasonContext);
  if (options.refresh) invalidateRuntimeCatalog(runtime, runtimeCatalogKey(preferences));
  const { catalog, warning, aliasMemory } = await loadRuntimeCatalog(runtime, preferences);
  const payload = await serializeEntityCatalog(catalog, runtime, options);
  payload.seasonContext = runtime.seasonContextService.publicRecord(seasonContext);
  payload.meta = {
    catalogWarning: warning,
    aliasMemory,
    preferences
  };
  return payload;
}

export async function handleEntityDetailRequest(runtime, options = {}) {
  const entityType = normalizeEntityCatalogType(options.entityType ?? options.type);
  if (!entityType) {
    throw Object.assign(new TypeError("entityType must be unit or trait"), {
      statusCode: 400,
      code: "invalid_entity_catalog_type"
    });
  }
  const apiName = String(options.apiName ?? options.id ?? "").trim();
  if (!/^[A-Za-z0-9_:.-]{1,128}$/u.test(apiName)) {
    throw Object.assign(new TypeError("A valid entity id is required"), {
      statusCode: 400,
      code: "invalid_entity_id"
    });
  }

  const seasonContext = runtime.seasonContextService.resolveForQuery(options.seasonContextId);
  const preferences = entityCatalogPreferences(runtime, seasonContext);
  if (options.refresh) invalidateRuntimeCatalog(runtime, runtimeCatalogKey(preferences));
  const { catalog, warning, compsData, aliasMemory } = await loadRuntimeCatalog(runtime, preferences);
  const input = entityType === "unit"
    ? `${apiName} 棋子技能属性详情`
    : `${apiName} 羁绊效果详情`;
  const payload = await serializeEntityDetailsQuery(input, catalog, runtime, {
    preferences,
    compsData,
    refresh: Boolean(options.refresh)
  });
  const returnedApiName = entityType === "unit"
    ? payload?.unit?.apiName
    : payload?.trait?.apiName;
  if (!payload || returnedApiName !== apiName) {
    throw Object.assign(new Error("Entity was not found in the current season catalog"), {
      statusCode: 404,
      code: "entity_not_found"
    });
  }

  payload.seasonContext = runtime.seasonContextService.publicRecord(seasonContext);
  payload.meta = {
    ...(payload.meta ?? {}),
    catalogWarning: warning,
    aliasMemory,
    preferences
  };
  return attachDetailRetrievalMetadata(payload, input, catalog);
}

export async function loadSmallWindowPreferences(runtime, scope = null) {
  return completeSmallWindowPreferences(await loadStoredSmallWindowPreferences(runtime, scope));
}

async function loadStoredSmallWindowPreferences(runtime, scope = null) {
  const entry = await runtime.cacheStore?.getUserPreference?.(preferenceKey(scope));
  return preferenceOverrides(entry?.value);
}

export async function saveSmallWindowPreferences(runtime, value = {}, scope = null) {
  const current = await loadStoredSmallWindowPreferences(runtime, scope);
  const nextOverrides = preferenceOverrides({
    ...current,
    ...normalizeSmallWindowPreferences(value)
  });
  await runtime.cacheStore?.setUserPreference?.(preferenceKey(scope), nextOverrides);
  return completeSmallWindowPreferences(nextOverrides);
}

export async function resetSmallWindowPreferences(runtime, scope = null) {
  await runtime.cacheStore?.deleteUserPreference?.(preferenceKey(scope));
  return completeSmallWindowPreferences();
}

const SEMANTIC_NATIVE_RESULT_TYPES = new Set([
  "entity_catalog_results",
  "unit_builds_batch_results",
  "trait_external_unit_statistics"
]);

function serializeSemanticNativeResult(result, catalog, meta = {}) {
  const { itemDetails: _itemDetails, ...publicMeta } = meta;
  const query = result.query ?? {};
  const source = result.source && typeof result.source === "object"
    ? result.source
    : {
      provider: result.sourceId === "official_tft_catalog" ? "Official TFT Catalog" : "MetaTFT",
      endpoint: result.sourceId ?? "registered_tool",
      updatedAt: result.sourceUpdatedAt ?? null,
      cache: "live"
    };
  const results = (result.results ?? []).map((entry) => {
    if (result.type === "entity_catalog_results") {
      return {
        ...entry,
        iconUrl: entry.iconUrl ?? (result.result?.entityType === "unit"
          ? ASSET_RESOLVER.resolveUnit(entry.apiName).iconUrl
          : null)
      };
    }
    if (result.type === "unit_builds_batch_results") {
      return {
        ...entry,
        iconUrl: entry.iconUrl ?? ASSET_RESOLVER.resolveUnit(entry.apiName).iconUrl,
        bestBuild: (entry.bestBuild ?? []).map((apiName) => ({
          apiName,
          name: itemName(apiName, catalog),
          iconUrl: ASSET_RESOLVER.resolveItem(apiName).iconUrl
        }))
      };
    }
    return entry;
  });
  return {
    ...result,
    ok: true,
    answer: {
      summary: result.answer?.summary ?? result.text,
      warnings: query.warnings ?? [],
      methodology: result.answer?.methodology ?? null
    },
    results,
    query: {
      ...query,
      traitNames: (query.traitFilters ?? []).map((filterId) => traitName(filterId, catalog))
    },
    source: {
      ...source,
      risks: [...new Set([...(source.risks ?? []), ...(query.warnings ?? [])])]
    },
    meta: {
      returnedResults: results.length,
      ...publicMeta
    }
  };
}

function serializeRecommendation(result, catalog, meta = {}) {
  if (SEMANTIC_NATIVE_RESULT_TYPES.has(result.type)) {
    return serializeSemanticNativeResult(result, catalog, meta);
  }
  const { itemDetails, ...publicMeta } = meta;
  if (["comp_rankings", "comp_trends", "comp_analysis"].includes(result.type)) {
    return serializeCompRankings(result, publicMeta);
  }
  const query = result.query ?? {};
  if (result.type === "item_carrier_rankings") {
    const itemApiName = result.item ?? query.item;
    const carriers = (result.carriers ?? []).slice(0, 8).map((carrier) => ({
      unit: {
        apiName: carrier.unitApiName,
        name: unitName(carrier.unitApiName, catalog),
        iconUrl: ASSET_RESOLVER.resolveUnit(carrier.unitApiName).iconUrl
      },
      stats: {
        top4: percent(carrier.stats.top4Rate),
        win: percent(carrier.stats.winRate),
        avg: Number(carrier.stats.avgPlacement.toFixed(2)),
        games: carrier.stats.games
      },
      baselineAvgPlacement: Number(carrier.baselineAvgPlacement.toFixed(2)),
      unitDelta: Number(carrier.unitDelta.toFixed(3)),
      placementUplift: Number(carrier.placementUplift.toFixed(3)),
      builds: (carrier.builds ?? []).map((build) => ({
        items: build.items.map((apiName) => ({
          apiName,
          name: itemName(apiName, catalog),
          iconUrl: ASSET_RESOLVER.resolveItem(apiName).iconUrl,
          target: apiName === itemApiName
        })),
        stats: {
          top4: percent(build.stats.top4Rate),
          win: percent(build.stats.winRate),
          avg: Number(build.stats.avgPlacement.toFixed(2)),
          games: build.stats.games
        }
      }))
    }));
    return {
      ok: true,
      type: "item_carrier_rankings",
      text: result.text,
      answer: {
        summary: result.text,
        warnings: result.warnings ?? [],
        methodology: "仅保留携带该装备后平均名次优于该棋子自身基线的棋子；默认按样本量排序。"
      },
      item: {
        apiName: itemApiName,
        name: itemName(itemApiName, catalog),
        iconUrl: ASSET_RESOLVER.resolveItem(itemApiName).iconUrl
      },
      carriers,
      query: {
        ...query,
        itemName: itemName(itemApiName, catalog)
      },
      methodology: result.methodology,
      diagnostics: result.diagnostics,
      source: sourcePayload(result, meta),
      cache: result.cache ?? null,
      meta: {
        returnedCarriers: carriers.length,
        ...publicMeta
      }
    };
  }
  if (result.type === "unit_item_rankings" || result.type === "unit_emblem_rankings") {
    const itemRankings = (result.itemRankings ?? []).map((entry) => serializeItemRanking(entry, catalog));
    const references = (result.itemRankingReferences ?? []).slice(0, 5).map((entry) => serializeItemRanking(entry, catalog));
    const itemPerformance = result.itemPerformance
      ? {
        item: result.itemPerformance.target ? serializeItemRanking(result.itemPerformance.target, catalog) : null,
        rank: result.itemPerformance.targetRank,
        topRankings: (result.itemPerformance.topRankings ?? []).map((entry) => serializeItemRanking(entry, catalog)),
        conclusion: result.itemPerformance.conclusion
      }
      : null;
    const best = itemRankings[0] ?? null;
    const specialAveragePlacementOnly = result.itemRankingMethodology?.methodology === "special_item_outlier_cleaned_avg_placement_only";
    return {
      ok: true,
      type: result.type,
      text: result.text,
      unit: query.unit ? {
        apiName: query.unit,
        name: unitName(query.unit, catalog),
        iconUrl: ASSET_RESOLVER.resolveUnit(query.unit).iconUrl
      } : null,
      answer: {
        summary: itemPerformance?.conclusion ?? (best
          ? `${compAnswerPrefix(query.comp)}${best.name}在当前条件的单装备聚合中排名第一。`
          : `${compAnswerPrefix(query.comp)}${result.text}`),
        evidence: itemPerformance?.item?.stats ?? best?.stats ?? null,
        warnings: query.warnings ?? [],
        methodology: specialAveragePlacementOnly
          ? `先剔除样本低于同类最高样本 2%（本次为 ${result.itemRankingMethodology?.sampleFloor?.outlierFloor ?? 0}）的极低样本离群项；其余神器与光明装备仅按平均名次升序排列，样本数只作可信度参考，不参与排序`
          : "按合法完整三件套是否包含该装备聚合；重复件只计一次组合样本"
      },
      itemRankings,
      itemPerformance,
      itemRankingReferences: references,
      methodology: result.itemRankingMethodology,
      cards: [],
      clarification: result.clarification ?? null,
      query: {
        ...query,
        unitName: unitName(query.unit, catalog),
        unitIconUrl: ASSET_RESOLVER.resolveUnit(query.unit).iconUrl,
        traitNames: (query.traitFilters ?? []).map((filterId) => traitName(filterId, catalog)),
        ownedItemNames: (query.ownedItems ?? []).map((apiName) => itemName(apiName, catalog)),
        performanceItemName: query.performanceItem ? itemName(query.performanceItem, catalog) : null,
        excludedItemNames: (query.excludedItems ?? []).map((apiName) => itemName(apiName, catalog)),
        comp: serializeCompConstraint(query.comp, catalog),
        defaultContextSummary: serializeDefaultContext(query.defaultContext, catalog)
      },
      source: sourcePayload(result, meta),
      cache: result.cache ?? null,
      meta: {
        rows: result.rows?.length ?? 0,
        filteredBuilds: result.filteredBuilds?.length ?? 0,
        rankedItems: itemRankings.length,
        ...publicMeta
      }
    };
  }
  const lockedItemApiNames = query.lockedItems ?? query.ownedItems ?? [];
  const hasLockedItems = lockedItemApiNames.length > 0;
  const comparison = result.comparison ?? null;
  const isItemComparison = query.intent === "unit_item_comparison" || Boolean(comparison);
  const cards = (result.rankedBuilds ?? []).slice(0, 3).map((build, index) => {
    const lowSample = comparison
      ? build.comparisonStable === false
      : isLowSampleBuild(build, query);
    const comparedItemName = comparison ? itemName(build.comparisonOption, catalog) : null;
    const title = comparison
      ? comparison.winner === build.comparisonOption
        ? `样本领先：${comparedItemName}`
        : `${lowSample ? "低样本" : "对比"}：${comparedItemName}`
      : lowSample
        ? (index === 0
          ? (hasLockedItems ? "低样本补齐参考" : "低样本参考")
          : `低样本参考 ${index}`)
        : index === 0
          ? query.sort === "robust_first"
            ? (hasLockedItems ? "普适补齐" : "普适推荐")
            : (hasLockedItems ? "推荐补齐" : "推荐")
          : `备选 ${index}`;
    return {
      title,
      winner: comparison
        ? comparison.winner === build.comparisonOption
        : index === 0 && !lowSample,
      items: build.items.map((apiName) => ({
        apiName,
        name: itemName(apiName, catalog),
        locked: lockedItemApiNames.includes(apiName),
        iconUrl: ASSET_RESOLVER.resolveItem(apiName).iconUrl,
        compared: build.comparisonOption === apiName
      })),
      stats: {
        top4: percent(build.stats.top4Rate),
        win: percent(build.stats.winRate),
        avg: Number(build.stats.avgPlacement.toFixed(2)),
        games: build.stats.games
      },
      ranking: build.ranking?.method === "robust_applicability_v3"
        ? {
          method: build.ranking.method,
          score: Number((build.ranking.score * 100).toFixed(1)),
          baseScore: Number((build.ranking.baseScore * 100).toFixed(1)),
          performanceScore: Number((build.ranking.performanceScore * 100).toFixed(1)),
          coverageScore: Number((build.ranking.coverageScore * 100).toFixed(1)),
          priorSamples: build.ranking.priorSamples,
          generalRecommendation: build.ranking.generalRecommendation === true,
          sampleLeadRatio: Number.isFinite(build.ranking.sampleLeadRatio)
            ? Number(build.ranking.sampleLeadRatio.toFixed(1))
            : null,
          applicabilityBasis: build.ranking.applicabilityBasis
        }
        : null,
      lowSample
    };
  });

  const serializeComparisonEntry = (entry) => ({
    apiName: entry.apiName,
    name: itemName(entry.apiName, catalog),
    canonicalName: entry.canonicalName,
    category: entry.category,
    iconUrl: itemDetails?.get?.(entry.apiName)?.iconUrl ?? entry.iconUrl,
    current: entry.current,
    obtainable: entry.obtainable,
    nameSource: entry.nameSource,
    availabilitySource: entry.availabilitySource,
    statSource: entry.statSource,
    qualified: entry.qualified,
    stable: entry.stable,
    isolation: entry.isolation,
    buildCount: entry.buildCount,
    placementCount: entry.placementCount,
    overlapGames: entry.overlapGames,
    lowSample: entry.lowSample,
    stats: {
      top4: percent(entry.stats.top4Rate),
      win: percent(entry.stats.winRate),
      avg: Number(entry.stats.avgPlacement.toFixed(2)),
      games: entry.stats.games
    },
    representativeItems: (entry.representativeBuild?.items ?? []).map((apiName) => ({
      apiName,
      name: itemName(apiName, catalog)
    })),
    commonBuilds: (entry.commonBuilds ?? []).map((build) => ({
      items: build.items.map((apiName) => ({ apiName, name: itemName(apiName, catalog) })),
      placementCount: build.placementCount,
      stats: build.stats
    }))
  });
  const coreFrequency = summarizeCoreItemFrequency(cards);
  const lockedItemSet = new Set(lockedItemApiNames);
  coreFrequency.items = coreFrequency.items.filter((entry) => !lockedItemSet.has(entry.apiName));
  coreFrequency.coreItems = coreFrequency.coreItems.filter((entry) => !lockedItemSet.has(entry.apiName));
  const coreItems = coreFrequency.coreItems.map((entry) => ({
    apiName: entry.apiName,
    name: itemName(entry.apiName, catalog),
    iconUrl: ASSET_RESOLVER.resolveItem(entry.apiName).iconUrl,
    appearances: entry.appearances,
    recommendationCount: entry.recommendationCount,
    appearanceRate: Number(entry.appearanceRate.toFixed(3))
  }));
  const coreItemSummary = {
    rule: "visible_build_frequency_2_of_3",
    numerator: coreFrequency.numerator,
    denominator: coreFrequency.denominator,
    recommendationCount: coreFrequency.recommendationCount,
    requiredAppearances: coreFrequency.requiredAppearances,
    items: coreItems
  };
  const itemDifferentiation = hasLockedItems
    ? analyzeItemDifferentiation({
      recommendations: (result.rankedBuilds ?? []).slice(0, 3).map((build, index) => ({
        evidenceId: `build:${index + 1}`,
        items: build.items.map((apiName) => ({ apiName, name: itemName(apiName, catalog) })),
        stats: build.stats,
        stable: !isLowSampleBuild(build, query),
        lowSample: isLowSampleBuild(build, query)
      })),
      lockedItems: lockedItemApiNames.map((apiName) => ({ apiName, name: itemName(apiName, catalog) })),
      primaryMetric: query.primaryMetric ?? query.sort ?? "avgPlacement"
    })
    : null;
  const referenceCard = cards[0] ?? null;
  cards.forEach((card, index) => {
    card.difference = index === 0 ? null : itemDifferences(referenceCard, card, catalog);
  });

  const serializedComparison = comparison
    ? {
      winner: comparison.winner,
      winnerName: comparison.winner ? itemName(comparison.winner, catalog) : null,
      allQualified: comparison.allQualified,
      allStable: comparison.allStable,
      sort: comparison.sort,
      mode: comparison.mode,
      primaryMetric: comparison.primaryMetric,
      minSamples: comparison.minSamples,
      stabilityMinSamples: comparison.stabilityMinSamples,
      warnings: comparison.warnings,
      decision: comparison.decision,
      overlap: comparison.overlap
        ? {
          games: comparison.overlap.games,
          rate: comparison.overlap.rate,
          buildCount: comparison.overlap.buildCount,
          placementCount: comparison.overlap.placementCount,
          commonBuilds: comparison.overlap.commonBuilds
        }
        : null,
      entries: comparison.entries.map(serializeComparisonEntry),
      rankedEntries: (comparison.rankedEntries ?? comparison.entries).map(serializeComparisonEntry)
    }
    : null;
  const displayTraitFilters = query.traitFilters?.length
    ? query.traitFilters
    : query.comp?.status === "applied" && query.comp.value?.selection === "automatic"
      ? query.comp.value.traits ?? []
      : [];

  return {
    ok: true,
    type: result.type ?? query.intent ?? "unit_build_rankings",
    text: result.text,
    answer: {
      summary: cards[0]
        ? `${compAnswerPrefix(query.comp)}${cards[0].title}：${cards[0].items.map((item) => item.name).join(" + ")}。`
        : `${compAnswerPrefix(query.comp)}${result.clarification?.question ?? result.text}`,
      evidence: cards[0]?.stats ?? null,
      warnings: query.warnings ?? [],
      methodology: cards[0]?.ranking?.method === "robust_applicability_v3"
        ? "稳健普适评分：前四率、吃鸡率和平均名次先做同查询样本的贝叶斯收缩校正，组成 90% 表现分；样本置信度按相对最大样本量的平方根连续计算，占 10%。前四率低于 50%或平均名次高于 4.5 的方案不获得样本加分。"
        : null,
      coreConclusion: coreItemSummary
    },
    unit: query.unit ? {
      apiName: query.unit,
      name: unitName(query.unit, catalog),
      iconUrl: ASSET_RESOLVER.resolveUnit(query.unit).iconUrl
    } : null,
    cards,
    coreItemSummary,
    commonCore: coreItems,
    itemDifferentiation,
    comparison: serializedComparison,
    results: serializedComparison?.entries ?? [],
    overlap: serializedComparison?.overlap ?? null,
    lockedItems: lockedItemApiNames.map((apiName) => ({
      apiName,
      name: itemName(apiName, catalog)
    })),
    decision: serializedComparison?.decision ?? result.localDecision ?? null,
    clarification: result.clarification ?? null,
    conversation: result.conversation ?? null,
    query: {
      intent: query.intent,
      unit: query.unit,
      unitName: unitName(query.unit, catalog),
      unitIconUrl: ASSET_RESOLVER.resolveUnit(query.unit).iconUrl,
      starLevel: query.starLevel,
      itemCount: query.itemCount,
      traitFilters: displayTraitFilters,
      traitNames: displayTraitFilters.map((filterId) => traitName(filterId, catalog)),
      traitSource: query.traitFilters?.length
        ? (query.assumptions ?? []).find((entry) => entry.key === "trait_filters")?.source ?? null
        : displayTraitFilters.length
          ? "system_default"
          : null,
      itemPolicy: query.itemPolicy,
      lockedItems: lockedItemApiNames,
      lockedItemNames: lockedItemApiNames.map((apiName) => itemName(apiName, catalog)),
      comparisonItems: query.comparisonItems ?? [],
      comparisonItemNames: (query.comparisonItems ?? []).map((apiName) => itemName(apiName, catalog)),
      comparisonMode: query.comparisonMode ?? null,
      primaryMetric: query.primaryMetric ?? null,
      pendingComparison: Boolean(query.pendingComparison),
      ownedItems: query.ownedItems ?? [],
      ownedItemNames: (query.ownedItems ?? []).map((apiName) => itemName(apiName, catalog)),
      excludedItems: query.excludedItems ?? [],
      excludedItemNames: (query.excludedItems ?? []).map((apiName) => itemName(apiName, catalog)),
      minSamples: query.minSamples,
      days: query.days,
      patch: query.patch,
      queue: query.queue,
      rankFilter: query.rankFilter,
      sort: query.sort,
      comparison: query.comparison ?? null,
      warnings: query.warnings ?? [],
      assumptions: query.assumptions ?? [],
      constraints: query.constraints ?? {},
      constraintSources: query.constraintSources ?? Object.fromEntries((query.assumptions ?? []).map((entry) => [
        entry.key,
        entry.origins ?? [entry.origin ?? entry.source]
      ])),
      comp: serializeCompConstraint(query.comp, catalog),
      defaultContext: query.defaultContext ?? null,
      defaultContextSummary: serializeDefaultContext(query.defaultContext, catalog),
      sessionContext: query.sessionContext ?? null,
      catalogVersion: query.catalogVersion ?? null
    },
    cache: result.cache ?? null,
    source: sourcePayload(result, meta),
    meta: {
      rows: result.rows?.length ?? 0,
      filteredBuilds: result.filteredBuilds?.length ?? 0,
      rankedBuilds: result.rankedBuilds?.length ?? 0,
      ...publicMeta
    }
  };
}

function serializeCompRankings(result, meta = {}) {
  const serializeComp = (comp) => ({
      compId: comp.compId,
      name: comp.name,
      patch: comp.patch,
      lowSample: Boolean(comp.lowSample),
      contested: Boolean(comp.contested),
      units: (comp.units ?? []).map((unit) => ({
        apiName: unit.apiName,
        name: unit.name,
        iconUrl: unit.iconUrl ?? null,
        fallbackIconUrl: unit.fallbackIconUrl ?? null,
        assetFallback: Boolean(unit.assetFallback),
        targetStarLevel: Number.isInteger(unit.targetStarLevel) ? unit.targetStarLevel : null,
        starLevel: Number.isFinite(unit.starLevel) ? unit.starLevel : null,
        avgStarLevel: Number.isFinite(unit.avgStarLevel) ? unit.avgStarLevel : null,
        core: Boolean(unit.core),
        items: (unit.items ?? []).map((item) => ({
          apiName: item.apiName,
          name: item.name ?? item.apiName,
          iconUrl: item.iconUrl ?? null,
          assetFallback: Boolean(item.fallback ?? item.assetFallback)
        }))
      })),
      traits: (comp.traits ?? []).map((trait) => ({
        apiName: trait.apiName,
        filterId: trait.filterId,
        name: trait.name,
        tier: Number.isInteger(trait.tier) ? trait.tier : null,
        iconUrl: trait.iconUrl ?? null,
        assetFallback: Boolean(trait.assetFallback)
      })),
      stats: {
        games: comp.stats?.games ?? 0,
        top4Rate: Number.isFinite(comp.stats?.top4Rate) ? comp.stats.top4Rate : null,
        winRate: Number.isFinite(comp.stats?.winRate) ? comp.stats.winRate : null,
        winShare: Number.isFinite(comp.stats?.winShare) ? comp.stats.winShare : null,
        avgPlacement: Number.isFinite(comp.stats?.avgPlacement) ? comp.stats.avgPlacement : null,
        pickRate: Number.isFinite(comp.stats?.pickRate) ? comp.stats.pickRate : null,
        selectionRate: Number.isFinite(comp.stats?.selectionRate) ? comp.stats.selectionRate : null
      },
      trend: {
        avgPlacementChange: Number.isFinite(comp.trend?.avgPlacementChange)
          ? comp.trend.avgPlacementChange
          : null,
        emergenceScore: Number.isFinite(comp.trend?.emergenceScore)
          ? comp.trend.emergenceScore
          : null,
        improving: Boolean(comp.trend?.improving),
        direction: comp.trend?.direction ?? null,
        source: comp.trend?.source ?? null,
        comparedAt: comp.trend?.comparedAt ?? null
      },
      strategy: comp.strategy ?? null,
      strategyDerivation: comp.strategyDerivation ?? null,
      lineupSignature: comp.lineupSignature ?? null,
      profileKey: comp.profileKey ?? null,
      profile: comp.profile ?? null,
      profileSource: comp.profileSource ?? null,
      profileBinding: comp.profileBinding ?? null,
      enrichmentSources: comp.enrichmentSources ?? null,
      preferenceMatch: comp.preferenceMatch ?? null,
      source: comp.source
    });
  const rankings = {};
  for (const [metric, comps] of Object.entries(result.rankings ?? {})) {
    rankings[metric] = (comps ?? []).map(serializeComp);
  }
  return {
    ok: true,
    type: result.type === "comp_trends"
      ? "comp_trends"
      : result.type === "comp_analysis"
        ? "comp_analysis"
        : "comp_rankings",
    rankings,
    rising: (result.rising ?? result.improving ?? []).map(serializeComp),
    falling: (result.falling ?? []).map(serializeComp),
    improving: (result.improving ?? []).map(serializeComp),
    references: (result.references ?? []).map(serializeComp),
    trend: result.trend ?? null,
    query: result.query,
    conversation: result.conversation ?? null,
    text: result.text ?? "",
    answer: result.analysis ? {
      summary: result.analysis.answer?.conclusion ?? result.text ?? "",
      reasons: result.analysis.answer?.reasons ?? [],
      evidence: result.analysis.answer?.evidence ?? [],
      risks: result.analysis.answer?.risks ?? [],
      evidenceStatus: result.analysis.evidenceStatus ?? result.analysis.status
    } : result.preferenceSearch ? {
      summary: result.text ?? "",
      warnings: result.warnings ?? [],
      methodology: result.preferenceSearch.methodology,
      evidenceStatus: result.preferenceSearch.status
    } : null,
    analysis: result.analysis ?? null,
    preferenceSearch: result.preferenceSearch ?? null,
    source: result.source,
    warnings: result.warnings ?? [],
    cache: result.cache ?? null,
    enrichment: result.enrichment ?? null,
    meta: {
      inputRows: result.diagnostics?.inputRows ?? 0,
      acceptedGroups: result.diagnostics?.acceptedGroups ?? 0,
      ...meta
    }
  };
}

export function createSmallWindowRuntime(options = {}) {
  const requestTimeouts = resolveSmallWindowRequestTimeouts(options);
  const metaTFTOptions = options.metaTFTOptions ?? {};
  const compsOptions = options.compsOptions ?? {};
  const metaTFTClient = options.metaTFTClient ?? new MetaTFTClient({
    ...metaTFTOptions,
    timeoutMs: metaTFTOptions.timeoutMs ?? requestTimeouts.explorerTimeoutMs
  });
  const catalogMetaTFTClient = options.catalogMetaTFTClient
    ?? options.metaTFTClient
    ?? new MetaTFTClient({
      ...metaTFTOptions,
      timeoutMs: metaTFTOptions.timeoutMs ?? requestTimeouts.catalogTimeoutMs
    });
  const compsClient = options.compsClient ?? new CompsContextClient({
    ...compsOptions,
    timeoutMs: compsOptions.timeoutMs ?? requestTimeouts.compsTimeoutMs,
    rankingsTimeoutMs: compsOptions.rankingsTimeoutMs ?? requestTimeouts.compRankingsTimeoutMs
  });
  const cacheStore = options.cacheStore ?? createSmallWindowCacheStore(options);
  const cacheStoreInfo = summarizeCacheStore(options, cacheStore);
  const conclusionGeneratorConfig = options.conclusionGeneratorConfig ?? (options.conclusionProvider
    ? {
      enabled: true,
      mode: "on",
      provider: "injected",
      model: options.conclusionModel ?? options.conclusionProvider.model ?? "injected-model",
      promptVersion: "generate-conclusion.v1",
      cacheTtlMs: 30 * 60 * 1000
    }
    : { enabled: false, mode: "off", provider: "off" });
  const toolRegistry = options.toolRegistry ?? new ToolRegistry(createStructuredToolDefinitions({
    defaultTimeoutMs: requestTimeouts.compRankingsTimeoutMs,
    timeoutByTool: {
      unit_builds: requestTimeouts.explorerTimeoutMs,
      unit_comp_candidates: requestTimeouts.explorerTimeoutMs,
      comps_rankings: requestTimeouts.compRankingsTimeoutMs,
      comps_trends: requestTimeouts.compRankingsTimeoutMs,
      comps_analysis: requestTimeouts.compRankingsTimeoutMs,
      unit_details: requestTimeouts.catalogTimeoutMs,
      item_details: requestTimeouts.catalogTimeoutMs,
      trait_details: requestTimeouts.catalogTimeoutMs
    }
  }));
  const toolExecutor = options.toolExecutor ?? new ToolExecutor({ registry: toolRegistry });
  const executionPlanExecutor = options.executionPlanExecutor
    ?? new ExecutionPlanExecutor({
      registry: toolRegistry,
      toolExecutor,
      resultPolicyExecutor: createTftResultPolicyExecutor()
    });
  const agentRuntime = options.agentRuntime ?? new AgentRuntime({
    budget: options.agentRunBudget,
    onEvent: options.agentRunEvent
  });

  return {
    seasonContextService: options.seasonContextService ?? createSeasonContextService(),
    compEnrichmentService: options.compEnrichmentService ?? createCompEnrichmentService({ cacheStore }),
    metaTFTClient,
    catalogMetaTFTClient,
    compsClient,
    cacheStore,
    cacheStoreInfo,
    compDetailCache: options.compDetailCache ?? new Map(),
    compDetailLoadPromises: options.compDetailLoadPromises ?? new Map(),
    compDetailCacheTtlMs: Math.max(
      1000,
      Number(options.compDetailCacheTtlMs ?? DEFAULT_COMP_DETAIL_CACHE_TTL_MS)
    ),
    augmentLookupCache: options.augmentLookupCache ?? new Map(),
    augmentLookupLoadPromises: options.augmentLookupLoadPromises ?? new Map(),
    augmentLookupCacheTtlMs: Math.max(
      1000,
      Number(options.augmentLookupCacheTtlMs ?? DEFAULT_AUGMENT_LOOKUP_CACHE_TTL_MS)
    ),
    requestTimeouts: {
      explorerTimeoutMs: metaTFTClient.timeoutMs ?? requestTimeouts.explorerTimeoutMs,
      catalogTimeoutMs: catalogMetaTFTClient.timeoutMs ?? requestTimeouts.catalogTimeoutMs,
      compsTimeoutMs: compsClient.timeoutMs ?? requestTimeouts.compsTimeoutMs,
      compRankingsTimeoutMs: compsClient.rankingsTimeoutMs ?? requestTimeouts.compRankingsTimeoutMs
    },
    catalog: options.catalog ?? null,
    catalogCache: new Map(),
    catalogLoadPromises: new Map(),
    catalogGeneration: 0,
    catalogKeyGenerations: new Map(),
    officialItemDetails: options.officialItemDetails ?? null,
    officialItemDetailsPromise: null,
    officialItemDetailsLoadedAt: options.officialItemDetailsLoadedAt ?? null,
    officialItemDetailsFetch: options.officialItemDetailsFetch ?? options.fetchImpl,
    officialItemDetailsUrl: options.officialItemDetailsUrl,
    officialItemDetailsTimeoutMs: options.officialItemDetailsTimeoutMs ?? 10000,
    fetchOfficialItemDetails: options.fetchOfficialItemDetails ?? fetchOfficialTftItemDetails,
    officialEntityDetails: options.officialEntityDetails ?? null,
    officialEntityDetailsPromise: null,
    officialEntityDetailsLoadedAt: options.officialEntityDetailsLoadedAt ?? null,
    officialEntityDetailsFetch: options.officialEntityDetailsFetch ?? options.fetchImpl,
    officialChessUrl: options.officialChessUrl,
    officialRaceUrl: options.officialRaceUrl,
    officialJobUrl: options.officialJobUrl,
    officialEntityDetailsTimeoutMs: options.officialEntityDetailsTimeoutMs ?? 10000,
    fetchOfficialEntityDetails: options.fetchOfficialEntityDetails ?? fetchOfficialTftEntityDetails,
    fetchItems: options.fetchItems ?? true,
    compsData: options.compsData ?? null,
    defaultContextOptions: options.defaultContextOptions ?? {},
    structuredParser: options.structuredParser ?? null,
    useStructuredParser: options.useStructuredParser ?? "auto",
    structuredParserConfig: options.structuredParserConfig ?? null,
    turnDeltaProvider: options.turnDeltaProvider ?? options.semanticTaskProvider ?? null,
    controlledPlanner: options.controlledPlanner ?? createTftControlledPlannerProvider(),
    controlledPlannerFallback: options.controlledPlannerFallback ?? null,
    conversationStateV2Mode: options.conversationStateV2Mode ?? "off",
    turnInterpreterBudget: options.turnInterpreterBudget ?? DEFAULT_TURN_INTERPRETER_BUDGET,
    conclusionProvider: options.conclusionProvider ?? null,
    conclusionGeneratorConfig,
    coachProvider: options.coachProvider ?? null,
    coachConfig: options.coachConfig ?? { enabled: false, mode: "off", provider: "off" },
    systemInteractionRouter: options.systemInteractionRouter ?? createSystemInteractionRouter(),
    answerModeRouter: options.answerModeRouter ?? createAnswerModeRouter(),
    conclusionJobs: new Map(),
    conclusionJobTtlMs: Math.max(1000, Number(options.conclusionJobTtlMs ?? DEFAULT_CONCLUSION_JOB_TTL_MS)),
    conclusionJobLimit: Math.max(8, Number(options.conclusionJobLimit ?? DEFAULT_CONCLUSION_JOB_LIMIT)),
    conclusionStreamIntervalMs: Math.max(0, Number(options.conclusionStreamIntervalMs ?? DEFAULT_CONCLUSION_STREAM_INTERVAL_MS)),
    semanticRetriever: options.semanticRetriever ?? null,
    semanticDocumentStore: options.semanticDocumentStore ?? null,
    semanticConfig: options.semanticConfig ?? { enabled: false, provider: "off" },
    accessService: options.accessService ?? null,
    adminToken: String(options.adminToken ?? "").trim() || null,
    queryEventRetentionDays: Number.isInteger(Number(options.queryEventRetentionDays))
      ? Math.max(0, Number(options.queryEventRetentionDays))
      : 30,
    recommendForInputImpl: options.recommendForInputImpl ?? recommendForInput,
    agentRuntime,
    toolRegistry,
    toolExecutor,
    executionPlanExecutor
  };
}

export function createSmallWindowCacheStore(options = {}) {
  const { type, cachePath } = resolveSmallWindowCacheOptions(options, {});

  if (type === "sqlite") {
    if (!options.sqliteDatabase) {
      throw new Error("Synchronous SQLite cache store requires sqliteDatabase; use createSmallWindowRuntimeAsync for file paths");
    }
    return new SQLiteCacheStore({
      database: options.sqliteDatabase,
      ttlMs: options.cacheTtlMs
    });
  }

  return new JsonFileCacheStore({
    filePath: cachePath
  });
}

export async function createSmallWindowRuntimeAsync(options = {}, env = process.env) {
  const structuredParserRuntime = createSmallWindowStructuredParser(options, env);
  const conversationStateV2Mode = String(
    options.conversationStateV2Mode
    ?? env.TFT_AGENT_CONVERSATION_STATE_V2_MODE
    ?? "off"
  ).trim().toLowerCase();
  const turnDeltaProvider = options.turnDeltaProvider
    ?? options.semanticTaskProvider
    ?? (structuredParserRuntime.structuredParserConfig?.enabled
      ? createChatSemanticTaskProvider({
        ...structuredParserRuntime.structuredParserConfig,
        thinkingMode: options.turnDeltaThinkingMode ?? "disabled",
        fetchImpl: options.structuredParserFetch ?? options.llmFetch,
        onRequestLog: options.turnDeltaRequestLog
          ?? options.semanticTaskRequestLog
          ?? options.structuredParserRequestLog
          ?? options.llmRequestLog
      })
      : null);
  const deterministicControlledPlanner = options.controlledPlannerFallback
    ?? createTftControlledPlannerProvider();
  const llmControlledPlanner = structuredParserRuntime.structuredParserConfig?.enabled
    ? createChatExecutionPlannerProvider({
      ...structuredParserRuntime.structuredParserConfig,
      thinkingMode: options.plannerThinkingMode ?? "disabled",
      maxTokens: options.plannerMaxTokens ?? 900,
      fetchImpl: options.structuredParserFetch ?? options.llmFetch,
      onRequestLog: options.plannerRequestLog
        ?? options.structuredParserRequestLog
        ?? options.llmRequestLog
    })
    : null;
  const controlledPlanner = options.controlledPlanner
    ?? llmControlledPlanner
    ?? deterministicControlledPlanner;
  const controlledPlannerFallback = options.controlledPlannerFallback
    ?? (controlledPlanner?.plannerKind === "llm" ? deterministicControlledPlanner : null);
  const conclusionRuntime = createSmallWindowConclusionGenerator(options, env);
  const coachRuntime = createSmallWindowCoachRuntime(options, env);
  const semanticRuntime = await createSmallWindowSemanticRuntime(options, env);
  const requestTimeouts = resolveSmallWindowRequestTimeouts(options, env);
  const runtimeOptions = {
    ...options,
    ...requestTimeouts,
    agentRunBudget: resolveSmallWindowAgentRunBudget(options, env),
    ...structuredParserRuntime,
    conversationStateV2Mode,
    turnDeltaProvider,
    controlledPlanner,
    controlledPlannerFallback,
    ...conclusionRuntime,
    ...coachRuntime,
    ...semanticRuntime,
    adminToken: options.adminToken ?? env.TFT_AGENT_ADMIN_TOKEN,
    queryEventRetentionDays: options.queryEventRetentionDays
      ?? env.TFT_AGENT_QUERY_EVENT_RETENTION_DAYS
  };

  const finalizeRuntime = (runtime) => {
    runtime.accessService = options.accessService
      ?? createAnonymousAccessService(runtime, options.publicAccess ?? {}, env);
    return runtime;
  };

  if (options.cacheStore) return finalizeRuntime(createSmallWindowRuntime(runtimeOptions));

  const { type, cachePath } = resolveSmallWindowCacheOptions(options, env);
  if (type !== "sqlite") {
    return finalizeRuntime(createSmallWindowRuntime({
      ...runtimeOptions,
      cachePath,
      cacheStoreInfo: {
        type,
        cachePath,
        persistent: true
      }
    }));
  }

  const cacheStore = options.sqliteDatabase
    ? new SQLiteCacheStore({
      database: options.sqliteDatabase,
      ttlMs: options.cacheTtlMs
    })
    : await SQLiteCacheStore.open({
      filePath: cachePath,
      ttlMs: options.cacheTtlMs
    });

  return finalizeRuntime(createSmallWindowRuntime({
    ...runtimeOptions,
    cacheStore,
    cacheStoreInfo: {
      type,
      cachePath,
      persistent: true
    }
  }));
}

function runtimeCatalogKey(preferences = {}) {
  return [
    preferences.seasonContextId ?? DEFAULT_SEASON_CONTEXT_ID,
    preferences.providerVersion ?? "metatft-live.v1",
    preferences.effectivePatch ?? preferences.patch ?? "current",
    preferences.queue ?? "1100"
  ].join(":");
}

function hasDynamicCatalogRecords(records = []) {
  return records.some((record) => /metatft_(?:explorer|comps)/.test(String(record?.source ?? "")));
}

function runtimeCatalogGeneration(runtime, key) {
  return {
    global: runtime.catalogGeneration ?? 0,
    key: runtime.catalogKeyGenerations?.get?.(key) ?? 0
  };
}

function isRuntimeCatalogGenerationCurrent(runtime, key, generation) {
  const current = runtimeCatalogGeneration(runtime, key);
  return current.global === generation.global && current.key === generation.key;
}

export function invalidateRuntimeCatalog(runtime, key = null) {
  runtime.catalogCache ??= new Map();
  runtime.catalogLoadPromises ??= new Map();
  runtime.catalogKeyGenerations ??= new Map();

  if (key !== null && key !== undefined) {
    const normalizedKey = String(key);
    const existed = runtime.catalogCache.delete(normalizedKey);
    runtime.catalogLoadPromises.delete(normalizedKey);
    runtime.catalogKeyGenerations.set(
      normalizedKey,
      (runtime.catalogKeyGenerations.get(normalizedKey) ?? 0) + 1
    );
    return existed ? 1 : 0;
  }

  const cached = runtime.catalogCache.size;
  runtime.catalogGeneration = (runtime.catalogGeneration ?? 0) + 1;
  runtime.catalogCache.clear();
  runtime.catalogLoadPromises.clear();
  runtime.catalogKeyGenerations.clear();
  return cached;
}

export async function loadRuntimeCatalog(runtime, preferences = {}) {
  const seasonContextId = preferences.seasonContextId ?? DEFAULT_SEASON_CONTEXT_ID;
  const storeOptions = { seasonContextId };
  const applyAliasMemory = async (catalog, entry = {}) => {
    const aliasMemory = await applyEnabledEntityAliasesFromStore(catalog, runtime.cacheStore, storeOptions);
    return {
      ...entry,
      catalog: aliasMemory.catalog,
      aliasMemory: {
        applied: aliasMemory.applied.length,
        ignored: aliasMemory.ignored.length
      }
    };
  };

  if (runtime.catalog) return applyAliasMemory(runtime.catalog, {
    warning: null,
    compsData: runtime.compsData
  });

  const key = runtimeCatalogKey(preferences);
  if (runtime.catalogCache.has(key)) return runtime.catalogCache.get(key);
  runtime.catalogLoadPromises ??= new Map();
  if (runtime.catalogLoadPromises.has(key)) return runtime.catalogLoadPromises.get(key);
  const generation = runtimeCatalogGeneration(runtime, key);

  const loadPromise = (async () => {
    const entry = {
      catalog: createCatalog(),
      warning: null,
      compsData: null,
      itemCatalogMemory: null,
      domainCatalogMemory: null
    };

    if (runtime.fetchItems) {
      const catalogOverrides = {};
      const warnings = [];
      const patch = preferences.patch ?? "current";
      let persistedItemCatalog = null;
      let persistedDomainCatalog = null;
      const [persistedItemsResult, persistedDomainResult] = await Promise.allSettled([
        runtime.cacheStore?.getItemCatalog?.(patch, storeOptions) ?? null,
        runtime.cacheStore?.getDomainCatalog?.(patch, storeOptions) ?? null
      ]);
      if (persistedItemsResult.status === "fulfilled") {
        persistedItemCatalog = persistedItemsResult.value;
      } else {
        warnings.push(`持久化装备目录读取失败：${persistedItemsResult.reason.message}`);
      }
      if (persistedDomainResult.status === "fulfilled") {
        persistedDomainCatalog = persistedDomainResult.value;
      } else {
        warnings.push(`持久化英雄/羁绊目录读取失败：${persistedDomainResult.reason.message}`);
      }
      const explorerParams = {
        formatnoarray: "true",
        compact: "true",
        patch,
        queue: preferences.queue ?? "1100"
      };
      const compsParams = {
        queue: preferences.queue ?? "1100",
        patch: preferences.patch ?? "current"
      };
      const requests = [
        runtime.catalogMetaTFTClient.getItems(explorerParams),
        runtime.catalogMetaTFTClient.getUnitsUnique(explorerParams),
        runtime.catalogMetaTFTClient.getTraits(explorerParams),
        runtime.compsClient.getLatestClusterInfo(compsParams),
        runtime.compsClient.getCompOptions(compsParams),
        typeof runtime.compsClient.getCompBuilds === "function"
          ? runtime.compsClient.getCompBuilds(compsParams)
          : Promise.resolve([])
      ];
      const [items, unitsUnique, traits, latestClusterInfo, compOptions, compBuilds] = await Promise.allSettled(requests);

      if (items.status === "fulfilled") {
        const generatedItems = buildItemCatalogFromItemsResponse(items.value, {
          patch
        });
        if (generatedItems.length > 0) {
          catalogOverrides.items = generatedItems;
          entry.itemCatalogMemory = {
            source: "remote",
            items: generatedItems.length,
            updatedAt: new Date().toISOString()
          };
          try {
            const saved = await runtime.cacheStore?.setItemCatalog?.(patch, generatedItems, storeOptions);
            if (saved?.updatedAt) entry.itemCatalogMemory.updatedAt = saved.updatedAt;
          } catch (error) {
            warnings.push(`装备目录已刷新，但持久化失败：${error.message}`);
          }
        } else {
          warnings.push("装备目录刷新返回空结果，未覆盖本地目录");
        }
      } else {
        warnings.push(`装备目录刷新失败：${items.reason.message}`);
      }

      if (!catalogOverrides.items) {
        const cachedItems = persistedItemCatalog?.value?.items;
        if (Array.isArray(cachedItems) && cachedItems.length > 0) {
          catalogOverrides.items = cachedItems;
          entry.itemCatalogMemory = {
            source: "persistent",
            items: cachedItems.length,
            updatedAt: persistedItemCatalog.updatedAt ?? null
          };
          warnings.push(`已使用 ${persistedItemCatalog.updatedAt ?? "未知时间"} 的持久化装备目录`);
        } else {
          const snapshotItems = buildItemCatalogFromItemsResponse({
            data: (CURRENT_ITEM_LOCALIZATION.items ?? []).map((item) => ({ items: item.apiName }))
          }, { patch });
          catalogOverrides.items = snapshotItems;
          entry.itemCatalogMemory = {
            source: "official_snapshot",
            items: snapshotItems.length,
            updatedAt: CURRENT_ITEM_LOCALIZATION.metadata?.generatedAt ?? null
          };
          warnings.push(
            `未找到持久化装备目录，已使用本地官方目录快照（${CURRENT_ITEM_LOCALIZATION.metadata?.sourcePatch ?? "版本未知"}）`
          );
        }
      }

      if (unitsUnique.status === "fulfilled") {
        catalogOverrides.units = buildUnitCatalogFromExplorerRows(unitsUnique.value, {
          patch
        });
      }
      if (traits.status === "fulfilled") {
        catalogOverrides.traits = buildTraitCatalogFromExplorerRows(traits.value, {
          patch
        });
      }
      if (unitsUnique.status !== "fulfilled" || traits.status !== "fulfilled") {
        const reasons = [unitsUnique, traits]
          .filter((result) => result.status !== "fulfilled")
          .map((result) => result.reason.message);
        warnings.push(`基础英雄/羁绊目录刷新失败，已继续尝试阵容端点或本地种子字典：${reasons.join("；")}`);
      }

      const compsData = {
        latestClusterInfo: latestClusterInfo.status === "fulfilled" ? latestClusterInfo.value : [],
        compOptions: compOptions.status === "fulfilled" ? compOptions.value : [],
        compBuilds: compBuilds.status === "fulfilled" ? compBuilds.value : []
      };
      entry.compsData = compsData;

      if (compOptions.status === "fulfilled" || latestClusterInfo.status === "fulfilled") {
        const unitsFromComps = buildUnitCatalogFromCompsData(compsData, {
          patch
        });
        const traitsFromComps = buildTraitCatalogFromCompsData(compsData, {
          patch
        });
        catalogOverrides.units = catalogOverrides.units
          ? mergeCatalogUnits(catalogOverrides.units, unitsFromComps)
          : unitsFromComps;
        catalogOverrides.traits = catalogOverrides.traits
          ? mergeCatalogTraits(catalogOverrides.traits, traitsFromComps)
          : traitsFromComps;
      }
      if (compOptions.status !== "fulfilled") {
        warnings.push(`阵容目录辅助端点刷新失败，动态英雄/羁绊目录将继续使用 Explorer、latest cluster 或持久化字典：${compOptions.reason.message}`);
      }

      const remoteUnitsAvailable = hasDynamicCatalogRecords(catalogOverrides.units);
      const remoteTraitsAvailable = hasDynamicCatalogRecords(catalogOverrides.traits);
      const persistedUnits = persistedDomainCatalog?.value?.units;
      const persistedTraits = persistedDomainCatalog?.value?.traits;
      const persistedUnitsAvailable = hasDynamicCatalogRecords(persistedUnits);
      const persistedTraitsAvailable = hasDynamicCatalogRecords(persistedTraits);
      let unitSource = remoteUnitsAvailable ? "remote" : "seed";
      let traitSource = remoteTraitsAvailable ? "remote" : "seed";

      if (persistedUnitsAvailable) {
        const refreshedPersistedUnits = mergeCatalogUnits(
          buildUnitCatalogFromExplorerRows({
            data: persistedUnits.map((unit) => ({ units_unique: `${unit.apiName}-1` }))
          }, { patch }),
          persistedUnits
        );
        catalogOverrides.units = remoteUnitsAvailable
          ? mergeCatalogUnits(refreshedPersistedUnits, catalogOverrides.units)
          : refreshedPersistedUnits;
        if (!remoteUnitsAvailable) {
          unitSource = "persistent";
          warnings.push(`已使用 ${persistedDomainCatalog.updatedAt ?? "未知时间"} 的持久化英雄目录`);
        }
      }
      if (persistedTraitsAvailable) {
        const refreshedPersistedTraits = mergeCatalogTraits(
          buildTraitCatalogFromExplorerRows({
            data: persistedTraits.map((trait) => ({ traits: trait.filterId }))
          }, { patch }),
          persistedTraits
        );
        catalogOverrides.traits = remoteTraitsAvailable
          ? mergeCatalogTraits(refreshedPersistedTraits, catalogOverrides.traits)
          : refreshedPersistedTraits;
        if (!remoteTraitsAvailable) {
          traitSource = "persistent";
          warnings.push(`已使用 ${persistedDomainCatalog.updatedAt ?? "未知时间"} 的持久化羁绊目录`);
        }
      }

      const finalUnits = catalogOverrides.units ?? createCatalog().units;
      const finalTraits = catalogOverrides.traits ?? createCatalog().traits;
      entry.domainCatalogMemory = {
        unitSource,
        traitSource,
        units: finalUnits.length,
        traits: finalTraits.length,
        updatedAt: persistedDomainCatalog?.updatedAt ?? null
      };
      if (remoteUnitsAvailable || remoteTraitsAvailable) {
        try {
          const saved = await runtime.cacheStore?.setDomainCatalog?.(patch, {
            units: remoteUnitsAvailable || persistedUnitsAvailable ? finalUnits : [],
            traits: remoteTraitsAvailable || persistedTraitsAvailable ? finalTraits : []
          }, storeOptions);
          if (saved?.updatedAt) entry.domainCatalogMemory.updatedAt = saved.updatedAt;
        } catch (error) {
          warnings.push(`英雄/羁绊目录已刷新，但持久化失败：${error.message}`);
        }
      }

      entry.catalog = createCatalog(catalogOverrides);
      entry.warning = warnings.length ? warnings.join("；") : null;
    }

    const withAliases = await applyAliasMemory(entry.catalog, entry);
    if (isRuntimeCatalogGenerationCurrent(runtime, key, generation)) {
      runtime.catalogCache.set(key, withAliases);
    }
    return withAliases;
  })();

  runtime.catalogLoadPromises.set(key, loadPromise);
  try {
    return await loadPromise;
  } finally {
    if (runtime.catalogLoadPromises.get(key) === loadPromise) {
      runtime.catalogLoadPromises.delete(key);
    }
  }
}

export async function prewarmSmallWindowCatalog(runtime) {
  if (runtime.catalog || !runtime.fetchItems) {
    return {
      ok: true,
      skipped: true
    };
  }

  const preferences = completeSmallWindowPreferences(await loadSmallWindowPreferences(runtime));
  const entry = await loadRuntimeCatalog(runtime, preferences);
  return {
    ok: true,
    skipped: false,
    key: runtimeCatalogKey(preferences),
    warning: entry.warning ?? null
  };
}

function quotaWrappedCallable(callable, accessService, visitor, reserveForRequest = null) {
  if (!callable || !accessService?.config?.enabled) return callable;
  const wrapped = async (...args) => {
    (reserveForRequest ?? (() => accessService.reserveLlmUse(visitor)))();
    return callable(...args);
  };
  Object.assign(wrapped, callable);
  return wrapped;
}

function conclusionJobScope(scope) {
  return String(scope ?? "local");
}

function pruneConclusionJobs(runtime, now = Date.now(), reserveSlot = false) {
  const jobs = runtime.conclusionJobs ?? (runtime.conclusionJobs = new Map());
  const ttlMs = Math.max(1000, Number(runtime.conclusionJobTtlMs ?? DEFAULT_CONCLUSION_JOB_TTL_MS));
  for (const [id, job] of jobs) {
    if (now - Number(job.updatedAt ?? job.createdAt ?? now) > ttlMs) jobs.delete(id);
  }
  const limit = Math.max(8, Number(runtime.conclusionJobLimit ?? DEFAULT_CONCLUSION_JOB_LIMIT));
  while (reserveSlot ? jobs.size >= limit : jobs.size > limit) {
    const oldest = jobs.keys().next().value;
    if (!oldest) break;
    jobs.delete(oldest);
  }
  return jobs;
}

function conclusionFallback(error, model = null) {
  return {
    status: "fallback",
    content: null,
    reason: "provider_unavailable",
    model,
    latencyMs: 0,
    attempts: 0,
    corrections: 0,
    transportRetries: 0,
    error: error?.code ?? "conclusion_job_failed"
  };
}

function createConclusionJob(runtime, options, scope = null) {
  const jobs = pruneConclusionJobs(runtime, Date.now(), true);
  const id = randomUUID();
  const job = {
    id,
    token: randomUUID(),
    scope: conclusionJobScope(scope),
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    conclusion: null,
    promise: null,
    start() {
      if (this.promise) return this.promise;
      this.startedAt = Date.now();
      this.promise = Promise.resolve()
        .then(() => generateEvidenceBackedConclusion(options))
        .catch((error) => conclusionFallback(error, options.config?.model ?? options.provider?.model ?? null))
        .then(async (conclusion) => {
          this.conclusion = conclusion;
          this.status = "complete";
          this.updatedAt = Date.now();
          if (this.queryId) {
            try {
              await runtime.cacheStore?.updateQueryEventConclusion?.(this.queryId, conclusion);
            } catch (error) {
              this.persistenceError = error?.code ?? error?.message ?? "query_event_update_failed";
            }
          }
          return conclusion;
        });
      return this.promise;
    }
  };
  jobs.set(id, job);
  return job;
}

function conclusionJobTokenMatches(job, token) {
  const expected = Buffer.from(String(job?.token ?? ""));
  const received = Buffer.from(String(token ?? ""));
  return expected.length > 0
    && expected.length === received.length
    && timingSafeEqual(expected, received);
}

function getOwnedConclusionJob(runtime, jobId, scope = null, token = null) {
  const jobs = pruneConclusionJobs(runtime);
  const job = jobs.get(String(jobId ?? ""));
  if (!job || (job.scope !== conclusionJobScope(scope) && !conclusionJobTokenMatches(job, token))) return null;
  return job;
}

function pendingConclusion(job, model = null) {
  const encodedId = encodeURIComponent(job.id);
  const encodedToken = encodeURIComponent(job.token);
  return {
    status: "pending",
    content: null,
    model,
    jobId: job.id,
    streamUrl: `/api/conclusion/stream?jobId=${encodedId}&token=${encodedToken}`,
    statusUrl: `/api/conclusion/status?jobId=${encodedId}&token=${encodedToken}`
  };
}

function conclusionStreamText(conclusion) {
  const content = conclusion?.content;
  if (!content) return "";
  return [
    content.headline,
    content.summary,
    ...(content.reasons ?? []).map((reason) => reason?.text),
    ...(content.alternatives ?? []).map((alternative) => alternative?.text),
    content.nextAction,
    content.riskNotice
  ].filter(Boolean).join("\n\n");
}

export function handleConclusionStatusRequest(runtime, jobId, scope = null, token = null) {
  const job = getOwnedConclusionJob(runtime, jobId, scope, token);
  if (!job) return { statusCode: 404, payload: { ok: false, error: "结论任务不存在或已过期" } };
  job.start();
  return {
    statusCode: 200,
    payload: {
      ok: true,
      jobId: job.id,
      status: job.status,
      ...(job.status === "complete" ? { conclusion: job.conclusion } : {})
    }
  };
}

export async function streamConclusionResponse(req, res, runtime, jobId, scope = null, token = null) {
  const job = getOwnedConclusionJob(runtime, jobId, scope, token);
  if (!job) {
    beginNdjson(res, 404);
    writeNdjson(res, { type: "error", error: "结论任务不存在或已过期" });
    res.end();
    return;
  }

  beginNdjson(res);
  writeNdjson(res, { type: "start", jobId: job.id, status: job.status });
  const conclusion = await job.start();
  if (res.destroyed || res.writableEnded) return;

  const text = conclusion?.status === "generated" ? conclusionStreamText(conclusion) : "";
  const intervalMs = Math.max(0, Number(runtime.conclusionStreamIntervalMs ?? DEFAULT_CONCLUSION_STREAM_INTERVAL_MS));
  for (const character of text) {
    if (res.destroyed || res.writableEnded) return;
    writeNdjson(res, { type: "delta", text: character });
    if (intervalMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
  writeNdjson(res, { type: "complete", conclusion });
  res.end();
}

function llmActivityForPayload(payload, runtime) {
  const interpretation = payload?.conversation?.providerInvocation ?? null;
  const planner = payload?.plannerInvocation ?? null;
  const conclusion = payload?.answer?.generatedConclusion ?? null;
  const assistant = payload?.assistantResponse ?? null;
  const stages = [];
  if (interpretation?.attempted === true) stages.push("turn_interpreter");
  if (planner?.attempted === true && planner?.llm === true) stages.push("planner");
  if (conclusion?.status === "generated") stages.push("conclusion");
  if (assistant?.status === "generated" || assistant?.model) stages.push("coach_answer");
  const calls = [
    ...(interpretation?.attempted === true ? [{
      stage: "turn_interpreter",
      model: runtime.structuredParserConfig?.model ?? null,
      succeeded: interpretation.succeeded === true,
      accepted: interpretation.accepted === true,
      corrected: interpretation.corrected === true,
      correctionReason: interpretation.correctionReason ?? null,
      usage: interpretation.usage ?? null,
      validationErrors: interpretation.validationErrors ?? []
    }] : []),
    ...(planner?.attempted === true && planner?.llm === true ? [{
      stage: "planner",
      model: planner.model ?? runtime.structuredParserConfig?.model ?? null,
      succeeded: planner.succeeded === true,
      accepted: planner.accepted === true,
      corrected: planner.corrected === true,
      correctionReason: planner.correctionReason ?? null,
      durationMs: planner.durationMs ?? null,
      usage: planner.usage ?? null,
      validationErrors: planner.validationErrors ?? []
    }] : [])
  ];
  return {
    used: stages.length > 0,
    model: conclusion?.model
      ?? assistant?.model
      ?? planner?.model
      ?? runtime.structuredParserConfig?.model
      ?? null,
    stages,
    calls,
    turnInterpreter: interpretation,
    planner
  };
}

async function persistQueryResponse(payload, runtime, details = {}) {
  const queryId = randomUUID();
  const visitorScope = String(details.scope ?? "local");
  const conclusion = payload.answer?.generatedConclusion ?? null;
  const llmActivity = llmActivityForPayload(payload, runtime);
  const responseSnapshot = structuredClone(payload);
  delete responseSnapshot.access;
  if (responseSnapshot.answer?.generatedConclusion?.status === "pending") {
    responseSnapshot.answer.generatedConclusion = {
      status: "pending",
      content: null,
      model: responseSnapshot.answer.generatedConclusion.model ?? null
    };
  }
  payload.queryId = queryId;
  await runtime.cacheStore?.addQueryEvent?.({
    queryId,
    runId: details.runId ?? null,
    seasonContextId: payload.seasonContext?.id ?? payload.query?.seasonContextId ?? DEFAULT_SEASON_CONTEXT_ID,
    visitorScope,
    conversationId: details.conversationId,
    input: details.input,
    resultType: payload.type ?? null,
    query: payload.query ?? null,
    response: responseSnapshot,
    patch: payload.query?.patch ?? payload.source?.patch ?? null,
    cacheHit: Boolean(payload.cache?.query?.hit),
    cacheStale: Boolean(payload.cache?.query?.stale),
    llmUsed: llmActivity.used,
    llmModel: llmActivity.model,
    durationMs: Date.now() - details.startedAt
  });
  if (conclusion?.status === "pending" && conclusion.jobId) {
    const job = runtime.conclusionJobs?.get(conclusion.jobId);
    if (job) job.queryId = queryId;
  }

  const retentionDays = Number(runtime.queryEventRetentionDays ?? 30);
  const now = Date.now();
  if (retentionDays > 0 && now - Number(runtime.queryEventsPrunedAt ?? 0) >= 24 * 60 * 60 * 1000) {
    runtime.queryEventsPrunedAt = now;
    const cutoff = new Date(now - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    await runtime.cacheStore?.pruneQueryEventsBefore?.(cutoff);
  }
  return payload;
}

async function retrieveCoachKnowledge(input, route, runtime, options = {}) {
  if (!runtime.semanticRetriever || !route?.retrievalScopes?.length) {
    return {
      evidence: [],
      warnings: ["knowledge_index_unavailable"],
      currentStats: null
    };
  }
  try {
    const retriever = new KnowledgeRetriever({ retriever: runtime.semanticRetriever });
    return retriever.searchWithStatus(input, {
      scopes: route.retrievalScopes,
      seasonContextId: options.seasonContextId ?? DEFAULT_SEASON_CONTEXT_ID,
      season: options.season ?? null,
      patch: options.patch ?? null,
      rank: options.rank ?? null,
      timeWindow: options.timeWindow ?? null,
      region: options.region ?? null,
      locale: options.locale ?? "zh-CN",
      topK: options.topK ?? 8,
      minimumScore: options.minimumScore ?? 0.08
    });
  } catch (error) {
    return {
      evidence: [],
      warnings: [`knowledge_retrieval_failed:${error?.code ?? error?.name ?? "error"}`],
      currentStats: null
    };
  }
}

function assistantResponseFromCoach(result) {
  return {
    status: result.status,
    text: result.text,
    citations: result.citations ?? [],
    warnings: result.warnings ?? [],
    model: result.model ?? null,
    latencyMs: result.latencyMs ?? 0,
    content: result.content
  };
}

function localizeCoachStructuredResult(result, catalog) {
  return {
    ...result,
    rankedBuilds: (result?.rankedBuilds ?? []).map((record) => ({
      ...record,
      items: (record.items ?? []).map((value) => ({
        apiName: value?.apiName ?? value,
        name: itemName(value?.apiName ?? value, catalog)
      }))
    })),
    itemRankings: (result?.itemRankings ?? []).map((record) => ({
      ...record,
      name: itemName(record?.apiName ?? record?.item ?? record, catalog)
    }))
  };
}

function serializeSystemInteraction(result, options = {}) {
  const outOfDomain = result.interactionType === "out_of_domain";
  return {
    ok: true,
    type: "system_interaction",
    handled: true,
    interactionType: result.interactionType,
    answerMode: result.answerMode,
    mode: result.answerMode,
    text: result.answer,
    answer: {
      summary: result.answer,
      generatedConclusion: {
        status: "skipped",
        reason: "deterministic_system_interaction",
        model: null
      }
    },
    systemInteraction: result,
    showEvidencePanel: false,
    conversation: {
      mode: options.conversationStateV2Mode ?? "off",
      stateVersion: "conversation-state.v2",
      delta: null,
      resolution: null,
      stateMutation: "none"
    },
    agent: {
      status: outOfDomain
        ? createAgentStatus({
          understandingStatus: "out_of_domain",
          capabilityStatus: "unsupported",
          planningStatus: "not_planned",
          executionStatus: "pending",
          evidenceStatus: "insufficient",
          finalOutcome: "refused"
        })
        : createAgentStatus({
          understandingStatus: "understood",
          capabilityStatus: "supported",
          planningStatus: "planned",
          executionStatus: "completed",
          evidenceStatus: "sufficient",
          finalOutcome: "answered"
        }),
      route: {
        schemaVersion: result.schemaVersion,
        selectedPath: "system_interaction",
        route: result.interactionType,
        fallbackReason: null
      },
      executionPlan: null,
      executionTrace: null,
      shadowComparison: null,
      failureStage: null,
      metrics: null
    },
    meta: {
      deterministic: true,
      llmUsed: false,
      metatftUsed: false,
      retrievalUsed: false
    },
    ...(options.seasonContext ? { seasonContext: options.seasonContext } : {}),
    ...conversationMeta({ conversationId: options.conversationId })
  };
}

function serializeKnowledgeAnswer({
  input,
  route,
  coach,
  knowledge,
  parsed,
  preferences
}) {
  const aiGeneratedKnowledgeEvidenceCount = (knowledge.evidence ?? []).filter(
    (record) => record?.aiGenerated === true
      || record?.contentOrigin === "ai_generated_transcript_summary"
  ).length;
  const query = {
    intent: "knowledge_question",
    requestedIntent: parsed?.intent ?? null,
    entities: {
      unit: parsed?.unit ?? null,
      items: parsed?.ownedItems ?? []
    },
    constraints: {
      patch: preferences?.effectivePatch ?? preferences?.patch ?? null,
      locale: "zh-CN"
    },
    warnings: [...new Set([...(knowledge.warnings ?? []), ...(coach.warnings ?? [])])]
  };
  return {
    ok: true,
    type: "coach_answer",
    mode: route.mode,
    text: coach.text,
    answer: {
      summary: coach.text,
      generatedConclusion: {
        status: "skipped",
        reason: "coach_answer_service",
        model: coach.model ?? null
      }
    },
    assistantResponse: assistantResponseFromCoach(coach),
    answerModeRoute: route,
    query,
    queryResult: coach.evidenceBundle?.queryResult ?? {
      resultType: null,
      source: null,
      candidates: []
    },
    knowledgeEvidence: knowledge.evidence,
    currentStatsScope: knowledge.currentStats ?? null,
    evidenceBundle: coach.evidenceBundle,
    source: {
      provider: "knowledge_index",
      patch: query.constraints.patch,
      updatedAt: null,
      risk: knowledge.evidence.length
        ? aiGeneratedKnowledgeEvidenceCount
          ? "攻略摘要由 AI 从视频字幕生成，未经人工复核；需核对原视频，并结合版本和适用条件。"
          : "攻略属于创作者观点，需结合版本和适用条件。"
        : "未检索到足够相关的攻略知识。"
    },
    meta: {
      input,
      knowledgeEvidenceCount: knowledge.evidence.length,
      aiGeneratedContent: aiGeneratedKnowledgeEvidenceCount > 0,
      aiGeneratedKnowledgeEvidenceCount,
      aiContentDisclosure: aiGeneratedKnowledgeEvidenceCount
        ? "YouTube 攻略摘要由 AI 从字幕提取和概括，未经人工复核。"
        : null
    }
  };
}

async function handleRecommendRequestInternal(body, runtime, context = {}) {
  const startedAt = Date.now();
  const input = String(body?.input ?? "").trim();
  const conversationId = String(body?.conversationId ?? body?.conversation_id ?? "").trim() || "default";
  const scope = context.visitor?.scope ?? null;
  const reportProgress = (type, data = {}) => {
    if (typeof context.onProgress !== "function") return;
    try {
      context.onProgress({
        schemaVersion: "recommendation-progress.v1",
        type,
        data
      });
    } catch {
      // Streaming progress is observational and cannot change the request result.
    }
  };
  let llmUseReserved = false;
  const reserveLlmUseForRequest = () => {
    if (llmUseReserved) return;
    context.accessService.reserveLlmUse(context.visitor);
    llmUseReserved = true;
  };
  const requestRuntime = context.accessService?.config?.enabled
    ? {
      ...runtime,
      structuredParser: quotaWrappedCallable(
        runtime.structuredParser,
        context.accessService,
        context.visitor,
        reserveLlmUseForRequest
      ),
      turnDeltaProvider: quotaWrappedCallable(
        runtime.turnDeltaProvider,
        context.accessService,
        context.visitor,
        reserveLlmUseForRequest
      ),
      conclusionProvider: quotaWrappedCallable(
        runtime.conclusionProvider,
        context.accessService,
        context.visitor,
        reserveLlmUseForRequest
      ),
      coachProvider: quotaWrappedCallable(
        runtime.coachProvider,
        context.accessService,
        context.visitor,
        reserveLlmUseForRequest
      )
    }
    : runtime;
  if (!input) {
    return {
      statusCode: 400,
      payload: {
        ok: false,
        error: "请输入查询内容"
      }
    };
  }
  reportProgress("understanding.started");

  const systemInteraction = requestRuntime.systemInteractionRouter.route({ input });
  if (systemInteraction.handled) {
    const respond = async () => {
      const interactionSeasonContext = runtime.seasonContextService.resolveForQuery(
        body?.seasonContextId
      );
      const payload = serializeSystemInteraction(systemInteraction, {
        conversationId,
        conversationStateV2Mode: requestRuntime.conversationStateV2Mode,
        seasonContext: runtime.seasonContextService.publicRecord(interactionSeasonContext)
      });
      await persistQueryResponse(payload, runtime, {
        scope,
        conversationId,
        input,
        startedAt,
        runId: context.agentRun?.runId ?? null
      });
      if (context.accessService && context.visitor) {
        payload.access = context.accessService.publicStatus(context.visitor);
      }
      return { statusCode: 200, payload };
    };
    return context.agentRun?.stage
      ? context.agentRun.stage("responding", respond)
      : respond();
  }

  let seasonContext;
  try {
    seasonContext = runtime.seasonContextService.resolveForQuery(body?.seasonContextId);
  } catch (error) {
    return {
      statusCode: error.statusCode ?? 400,
      payload: {
        ok: false,
        error: error.message,
        code: error.code ?? "invalid_season_context",
        seasonContextId: error.seasonContextId ?? (String(body?.seasonContextId ?? "") || null),
        status: error.contextStatus ?? "unavailable"
      }
    };
  }
  const publicSeasonContext = runtime.seasonContextService.publicRecord(seasonContext);

  const completeResponse = async (payload) => {
    const respond = async () => {
      payload.agent ??= {
        status: defaultAgentStatusForPayload(payload),
        route: null,
        executionPlan: payload.executionPlan ?? null,
        executionTrace: payload.executionTrace ?? null,
        shadowComparison: null,
        failureStage: null,
        metrics: null
      };
      payload.seasonContext = publicSeasonContext;
      const llmActivity = llmActivityForPayload(payload, runtime);
      payload.meta ??= {};
      payload.meta.llmUsed = llmActivity.used;
      payload.meta.llmModel = llmActivity.model;
      payload.meta.llmStages = llmActivity.stages;
      payload.meta.llmCalls = llmActivity.calls;
      if (llmActivity.turnInterpreter) {
        payload.meta.turnInterpreter = llmActivity.turnInterpreter;
      }
      if (llmActivity.planner) {
        payload.meta.planner = llmActivity.planner;
      }
      await persistQueryResponse(payload, runtime, {
        scope,
        conversationId,
        input,
        startedAt,
        runId: context.agentRun?.runId ?? null
      });
      if (context.accessService && context.visitor) {
        payload.access = context.accessService.publicStatus(context.visitor);
      }
      return { statusCode: 200, payload };
    };
    return context.agentRun?.stage
      ? context.agentRun.stage("responding", respond)
      : respond();
  };

  const storedPreferences = await loadStoredSmallWindowPreferences(runtime, scope);
  const explicitPreferences = preferenceOverrides({
    ...storedPreferences,
    ...normalizeSmallWindowPreferences(body.preferences)
  });
  const preferences = {
    ...completeSmallWindowPreferences(explicitPreferences),
    seasonContextId: seasonContext.id,
    providerVersion: seasonContext.source.providerVersion,
    effectivePatch: seasonContext.effectivePatch,
    currentPatch: seasonContext.currentPatch,
    previousPatch: seasonContext.previousPatch,
    patch: seasonContext.providerPatch ?? "current",
    queue: seasonContext.source.queue
  };
  if (body.refresh) {
    invalidateRuntimeCatalog(runtime, runtimeCatalogKey(preferences));
  }
  const { catalog, warning, compsData, aliasMemory } = await loadRuntimeCatalog(runtime, preferences);
  const externalSupportPayload = await tryExternalSupportRequest(input, catalog, requestRuntime, {
    scope,
    conversationId,
    seasonContextId: seasonContext.id,
    preferences,
    compsData,
    clarificationOnly: true,
    agentRun: context.agentRun,
    signal: context.signal
  });
  if (externalSupportPayload) {
    externalSupportPayload.meta = {
      durationMs: Date.now() - startedAt,
      catalogWarning: warning,
      aliasMemory,
      preferences
    };
    return completeResponse(externalSupportPayload);
  }
  const requestedCatalogType = requestedEntityCatalogType(input);
  if (requestedCatalogType) {
    const payload = await serializeEntityCatalog(catalog, requestRuntime, {
      entityType: requestedCatalogType
    });
    payload.meta = {
      durationMs: Date.now() - startedAt,
      catalogWarning: warning,
      aliasMemory,
      preferences
    };
    return completeResponse(payload);
  }
  const entityDetailsPayload = await serializeEntityDetailsQuery(input, catalog, requestRuntime, {
    preferences,
    compsData,
    refresh: Boolean(body.refresh)
  });
  if (entityDetailsPayload) {
    entityDetailsPayload.meta = {
      durationMs: Date.now() - startedAt,
      catalogWarning: warning,
      aliasMemory,
      preferences
    };
    const payload = attachDetailRetrievalMetadata(entityDetailsPayload, input, catalog);
    const executed = await executeRegisteredDetailPayload(payload, requestRuntime, context);
    await persistDetailTaskFrame(executed, requestRuntime, {
      scope,
      conversationId,
      seasonContextId: seasonContext.id
    });
    return completeResponse(executed);
  }
  const itemDetailsPayload = await serializeItemDetailsQuery(input, catalog, runtime);
  if (itemDetailsPayload) {
    const payload = attachDetailRetrievalMetadata(itemDetailsPayload, input, catalog);
    return completeResponse(await executeRegisteredDetailPayload(payload, requestRuntime, context));
  }
  const parsedForIntent = parseQuery(input, { catalog });
  const shouldLoadCompItemDetails = requestsSoftCompItemDemand(input, parsedForIntent);
  const answerModeRoute = requestRuntime.answerModeRouter.route({
    input,
    parsed: parsedForIntent
  });
  const currentStatsRank = [
    ...(parsedForIntent.rankFilter ?? preferences.rankFilter ?? DEFAULT_QUERY_OPTIONS.rankFilter)
  ].map((rank) => String(rank).toUpperCase()).sort().join(",");
  const currentStatsDays = Number(
    parsedForIntent.days ?? preferences.days ?? DEFAULT_QUERY_OPTIONS.days
  );
  const coachKnowledgeOptions = {
    seasonContextId: seasonContext.id,
    season: seasonContext.id,
    patch: seasonContext.currentPatch ?? seasonContext.effectivePatch,
    rank: currentStatsRank,
    timeWindow: `${currentStatsDays}d`,
    region: String(body.region ?? "global").toLowerCase(),
    locale: requestRuntime.semanticConfig?.locale ?? "zh-CN"
  };
  let coachKnowledgePromise = null;
  const getCoachKnowledge = () => {
    if (!coachKnowledgePromise) {
      coachKnowledgePromise = answerModeRoute.mode === "structured"
        ? Promise.resolve({ evidence: [], warnings: [], currentStats: null })
        : retrieveCoachKnowledge(input, answerModeRoute, requestRuntime, coachKnowledgeOptions);
    }
    return coachKnowledgePromise;
  };
  if (answerModeRoute.mode === "rag") {
    reportProgress("understanding.resolved", {
      answerModeRoute,
      intent: parsedForIntent.intent ?? "knowledge_question"
    });
    reportProgress("plan.ready", { answerModeRoute });
    reportProgress("retrieval.started", { source: "knowledge_index" });
    const knowledge = await getCoachKnowledge();
    reportProgress("retrieval.completed", {
      source: "knowledge_index",
      evidenceCount: knowledge.evidence.length
    });
    reportProgress("answer.started");
    const coach = await createHybridAnswerService({
      provider: requestRuntime.coachProvider
    }).answer({
      question: input,
      mode: "rag",
      query: {
        intent: "knowledge_question",
        requestedIntent: parsedForIntent.intent ?? null,
        constraints: {
          patch: seasonContext.effectivePatch,
          locale: requestRuntime.semanticConfig?.locale ?? "zh-CN"
        }
      },
      knowledgeEvidence: knowledge.evidence,
      warnings: knowledge.warnings
    });
    const payload = serializeKnowledgeAnswer({
      input,
      route: answerModeRoute,
      coach,
      knowledge,
      parsed: parsedForIntent,
      preferences
    });
    payload.meta = {
      ...payload.meta,
      durationMs: Date.now() - startedAt,
      catalogWarning: warning,
      aliasMemory,
      preferences
    };
    return completeResponse(payload);
  }
  const compEntityClarification = requestsSoftCompItemDemand(input, parsedForIntent)
    ? null
    : serializeCompRankingEntityClarification(parsedForIntent, catalog);
  if (compEntityClarification) {
    compEntityClarification.meta = {
      durationMs: Date.now() - startedAt,
      catalogWarning: warning,
      aliasMemory,
      preferences
    };
    return completeResponse(compEntityClarification);
  }
  const structuredParserMode = preferences.structuredParserMode === "inherit"
    ? runtime.useStructuredParser
    : preferences.structuredParserMode;
  const localSessionKey = conversationId === "default" ? SESSION_LAST_QUERY_KEY : `last_query:${conversationId}`;
  const sessionKey = scope ? anonymousScopeKey(scope, localSessionKey) : localSessionKey;
  const previousSessionEntry = requestRuntime.conclusionGeneratorConfig?.enabled && preferences.conclusionMode !== "off"
    ? await runtime.cacheStore?.getSessionState?.(sessionKey, { seasonContextId: seasonContext.id })
    : null;
  const agentToolHandlers = {
    entity_catalog_query: async (toolInput) => {
      const details = await loadOfficialEntityDetails(requestRuntime);
      return queryEntityCatalog({
        catalog,
        details,
        input: toolInput,
        updatedAt: details?.meta?.updatedAt
      });
    },
    composition_member_statistics: (toolInput) => queryCompositionMemberStatistics(
      toolInput,
      catalog,
      requestRuntime,
      { preferences, compsData }
    ),
    unit_builds_batch: async (toolInput) => {
      const entities = (toolInput.entities ?? []).slice(0, 5);
      const results = [];
      const sourceStates = [];
      const sourceClient = runtime.metaTFTClient;
      const batchClient = sourceClient instanceof MetaTFTClient
        && Number(sourceClient.timeoutMs) < 5000
        ? new MetaTFTClient({
          baseUrl: sourceClient.baseUrl,
          fetchImpl: sourceClient.fetchImpl,
          timeoutMs: 5000,
          maxRetries: sourceClient.maxRetries,
          retryDelayMs: sourceClient.retryDelayMs,
          maxRetryDelayMs: sourceClient.maxRetryDelayMs,
          sleepImpl: sourceClient.sleepImpl
        })
        : sourceClient;
      const loadBuild = async (entity) => {
        const apiName = String(entity.apiName ?? "");
        const name = entity.name ?? unitName(apiName, catalog);
        if (!apiName) return null;
        const parsedUnitQuery = {
          intent: "unit_best_3_items",
          unit: apiName,
          unitAlias: apiName,
          traitFilters: [],
          ownedItems: [],
          lockedItems: [],
          excludedItems: [],
          comparisonItems: [],
          parser: { intentExplicit: true }
        };
        const batchPreferences = {
          ...preferences,
          ...(toolInput.days !== undefined ? { days: toolInput.days } : {}),
          ...(toolInput.patch !== undefined ? { patch: toolInput.patch } : {}),
          ...(toolInput.rank !== undefined ? { rankFilter: toolInput.rank } : {}),
          ...(toolInput.minSamples !== undefined ? { minSamples: toolInput.minSamples } : {})
        };
        const recommendation = await requestRuntime.recommendForInputImpl(`${name}带哪三件装备最好`, {
          catalog,
          metaTFTClient: batchClient,
          compsClient: runtime.compsClient,
          compsData,
          cacheStore: runtime.cacheStore,
          preferences: batchPreferences,
          resolvedParsedInput: parsedUnitQuery,
          useSession: false,
          semanticShadow: false,
          conversationStateV2Mode: "off"
        });
        const best = recommendation.rankedBuilds?.[0] ?? null;
        return {
          sourceState: {
            cache: recommendation.cache?.query ?? null,
            updatedAt: recommendation.cache?.query?.updatedAt
              ?? recommendation.sourceUpdatedAt
              ?? recommendation.source?.updatedAt
              ?? null,
            warnings: recommendation.query?.warnings ?? []
          },
          result: {
            apiName,
            name,
            bestBuild: best?.items ?? [],
            stats: best?.stats ?? null,
            games: Number(best?.stats?.games ?? 0),
            top4Rate: best?.stats?.top4Rate ?? null,
            winRate: best?.stats?.winRate ?? null,
            avgPlacement: best?.stats?.avgPlacement ?? null,
            available: Boolean(best)
          }
        };
      };
      const settled = await Promise.allSettled(entities.map(loadBuild));
      settled.forEach((entry, index) => {
        const entity = entities[index] ?? {};
        const apiName = String(entity.apiName ?? "");
        const name = entity.name ?? unitName(apiName, catalog);
        if (entry.status === "fulfilled" && entry.value) {
          sourceStates.push(entry.value.sourceState);
          results.push(entry.value.result);
          return;
        }
        const warning = `${name}的出装统计暂时不可用：${entry.reason?.message ?? String(entry.reason ?? "unknown error")}`;
        sourceStates.push({ cache: null, updatedAt: null, warnings: [warning] });
        if (apiName) {
          results.push({
            apiName,
            name,
            bestBuild: [],
            stats: null,
            games: 0,
            top4Rate: null,
            winRate: null,
            avgPlacement: null,
            available: false,
            warning
          });
        }
      });
      results.sort((left, right) => (
        Number(right.available) - Number(left.available)
        || Number(right.top4Rate ?? -1) - Number(left.top4Rate ?? -1)
        || Number(left.avgPlacement ?? 99) - Number(right.avgPlacement ?? 99)
        || right.games - left.games
      ));
      const availableResults = results.filter((entry) => entry.available);
      const unavailableResults = results.filter((entry) => !entry.available);
      const text = availableResults.length
        ? `${availableResults[0].name}的主流出装在候选中表现最好。${unavailableResults.length ? ` ${unavailableResults.map((entry) => entry.name).join("、")}的统计暂时不可用。` : ""}`
        : "候选棋子的出装统计暂时不可用，请稍后刷新。";
      const stale = sourceStates.some((entry) => entry.cache?.stale === true);
      const cached = stale || sourceStates.some((entry) => entry.cache?.hit === true);
      const updatedAt = sourceStates.map((entry) => entry.updatedAt).filter(Boolean).sort().at(-1)
        ?? new Date().toISOString();
      return {
        type: "unit_builds_batch_results",
        source: {
          provider: "MetaTFT",
          endpoint: "tft-explorer-api/unit_builds (batch)",
          updatedAt,
          cache: stale ? "stale" : cached ? "cache" : "live",
          risks: [...new Set(sourceStates.flatMap((entry) => entry.warnings))]
        },
        updatedAt,
        results,
        text
      };
    }
  };
  const result = await requestRuntime.recommendForInputImpl(input, {
    catalog,
    metaTFTClient: runtime.metaTFTClient,
    compsClient: runtime.compsClient,
    compEnrichmentService: runtime.compEnrichmentService,
    officialItemDetails: runtime.officialItemDetails,
    loadOfficialItemDetails: shouldLoadCompItemDetails
      ? () => loadOfficialItemDetails(runtime)
      : null,
    compsData,
    cacheStore: runtime.cacheStore,
    preferences,
    explicitPreferences,
    bypassQueryCache: Boolean(body.refresh)
      || requestRuntime.conversationStateV2Mode === "on",
    bypassDefaultContextCache: Boolean(body.refresh),
    structuredParser: requestRuntime.structuredParser,
    useStructuredParser: structuredParserMode,
    turnDeltaProvider: requestRuntime.turnDeltaProvider,
    conversationStateV2Mode: requestRuntime.conversationStateV2Mode,
    turnInterpreterBudget: requestRuntime.turnInterpreterBudget,
    controlledPlanner: requestRuntime.controlledPlanner,
    controlledPlannerFallback: requestRuntime.controlledPlannerFallback,
    agentToolHandlers,
    onProgress(event) {
      reportProgress(event?.type ?? "unknown", {
        ...(event?.data ?? {}),
        answerModeRoute
      });
    },
    semanticRetriever: requestRuntime.semanticRetriever,
    semanticLocale: requestRuntime.semanticConfig?.locale ?? "zh-CN",
    seasonContextId: seasonContext.id,
    providerVersion: seasonContext.source.providerVersion,
    effectivePatch: seasonContext.effectivePatch,
    sessionKey,
    toolExecutor: requestRuntime.toolExecutor,
    toolRegistry: requestRuntime.toolRegistry,
    executionPlanExecutor: requestRuntime.executionPlanExecutor,
    executionPlanSovereignty: true,
    agentRun: context.agentRun,
    abortSignal: context.signal
  });
  if (result.taskFrame && result.executionTrace?.status === "completed") {
    await persistDetailTaskFrame(result, requestRuntime, {
      scope,
      conversationId,
      seasonContextId: seasonContext.id
    });
  }
  const warnings = warning ? [...(result.query?.warnings ?? []), warning] : result.query?.warnings;
  if (warnings && result.query && typeof result.query === "object") {
    result.query.warnings = warnings;
  }
  let coachKnowledge = answerModeRoute.mode === "hybrid"
    ? await getCoachKnowledge()
    : { evidence: [], warnings: [], currentStats: null };
  if (
    answerModeRoute.mode === "hybrid"
    && answerModeRoute.retrievalScopes.includes("current_stats")
  ) {
    const finalRank = [
      ...(result.query?.rankFilter ?? preferences.rankFilter ?? DEFAULT_QUERY_OPTIONS.rankFilter)
    ].map((rank) => String(rank).toUpperCase()).sort().join(",");
    const finalDays = Number(
      result.query?.days ?? preferences.days ?? DEFAULT_QUERY_OPTIONS.days
    );
    if (finalRank !== currentStatsRank || finalDays !== currentStatsDays) {
      coachKnowledge = await retrieveCoachKnowledge(
        input,
        answerModeRoute,
        requestRuntime,
        {
          ...coachKnowledgeOptions,
          rank: finalRank,
          timeWindow: `${finalDays}d`
        }
      );
    }
  }
  let conclusionItemDetails = runtime.officialItemDetails;
  let conclusionEntityDetails = runtime.officialEntityDetails;
  const equipmentConclusion = [
    "unit_build_rankings",
    "unit_build_completion",
    "unit_best_3_items"
  ].includes(result.type ?? result.query?.intent);
  const needsConclusionMechanics = equipmentConclusion
    && preferences.conclusionMode !== "off"
    && requestRuntime.conclusionGeneratorConfig?.enabled
    && requestRuntime.conclusionProvider;
  if ((result.comparison || needsConclusionMechanics) && !conclusionItemDetails) {
    try {
      conclusionItemDetails = await loadOfficialItemDetails(runtime);
    } catch (error) {
      const detailWarning = `官方装备详情加载失败：${error.message}`;
      result.query.warnings = [...new Set([...(result.query?.warnings ?? []), detailWarning])];
      if (result.comparison) {
        result.comparison.warnings = [...new Set([...(result.comparison.warnings ?? []), detailWarning])];
      }
    }
  }
  if (needsConclusionMechanics && !conclusionEntityDetails) {
    try {
      conclusionEntityDetails = await loadOfficialEntityDetails(runtime);
    } catch (error) {
      const detailWarning = `官方棋子定位加载失败：${error.message}`;
      result.query.warnings = [...new Set([...(result.query?.warnings ?? []), detailWarning])];
    }
  }

  let semanticEvidence = [];
  const usesExecutionPlanResult = String(result.executionTrace?.source ?? "").startsWith("execution_plan");
  if (
    !usesExecutionPlanResult
    && requestRuntime.semanticRetriever
    && result.retrievalPlan?.semanticQueries?.length
  ) {
    try {
      const retrieve = () => retrieveSemanticPlan(result.retrievalPlan, requestRuntime.semanticRetriever, {
          seasonContextId: seasonContext.id,
          onFallback: requestRuntime.semanticConfig?.onFallback
        });
      const semanticQuery = result.retrievalPlan.semanticQueries[0];
      const executeSemantic = context.agentRun && requestRuntime.toolExecutor
        ? async () => (await requestRuntime.toolExecutor.execute("semantic_search", {
          query: semanticQuery.query,
          documentTypes: semanticQuery.types,
          ...(semanticQuery.patch ? { patch: semanticQuery.patch } : {}),
          ...(semanticQuery.locale ? { locale: semanticQuery.locale } : {}),
          ...(semanticQuery.topK ? { topK: semanticQuery.topK } : {})
        }, {
          source: "semantic_index",
          handler: retrieve,
          run: context.agentRun,
          signal: context.signal,
          intent: result.intentEnvelope?.intent ?? result.type
        })).value
        : retrieve;
      semanticEvidence = context.agentRun
        ? await context.agentRun.stage("assembling_evidence", executeSemantic)
        : await executeSemantic();
    } catch (error) {
      if (["run_cancelled", "run_timed_out", "budget_exhausted"].includes(error?.code)) throw error;
      result.query.warnings = [...new Set([...(result.query?.warnings ?? []), `语义索引检索失败：${error.message}`])];
    }
  }
  const conclusionOptions = {
    result,
    catalog,
    input,
    previousQuery: previousSessionEntry?.value?.query ?? previousSessionEntry?.value ?? null,
    config: requestRuntime.conclusionGeneratorConfig,
    provider: requestRuntime.conclusionProvider,
    cacheStore: runtime.cacheStore,
    compEnrichmentService: runtime.compEnrichmentService,
    requestEnabled: preferences.conclusionMode !== "off",
    bypassCache: Boolean(body.refresh),
    seasonContextId: seasonContext.id,
    principalId: scope ?? "anonymous",
    conversationId,
    semanticEvidence,
    officialItemDetails: conclusionItemDetails,
    officialEntityDetails: conclusionEntityDetails
  };
  const canDeferConclusion = answerModeRoute.mode !== "hybrid"
    && body?.deferConclusion === true
    && conclusionOptions.requestEnabled
    && requestRuntime.conclusionGeneratorConfig?.enabled
    && requestRuntime.conclusionProvider;
  let coachAnswer = null;
  let generatedConclusion;
  if (
    result.type !== "clarification"
    && !result.clarification?.blocking
    && result.validation?.valid !== false
  ) {
    reportProgress("retrieval.completed", {
      source: result.source?.provider ?? "structured_data",
      resultType: result.type ?? null,
      evidenceCount: coachKnowledge.evidence.length + semanticEvidence.length
    });
  }
  reportProgress("answer.started", {
    resultType: result.type ?? null,
    answerMode: answerModeRoute.mode
  });
  if (answerModeRoute.mode === "hybrid") {
    const generateCoachAnswer = () => createHybridAnswerService({
      provider: requestRuntime.coachProvider
    }).answer({
      question: input,
      mode: "hybrid",
      query: result.query,
      structuredResult: localizeCoachStructuredResult(result, catalog),
      knowledgeEvidence: coachKnowledge.evidence,
      warnings: [
        ...(result.query?.warnings ?? []),
        ...coachKnowledge.warnings
      ]
    });
    coachAnswer = context.agentRun
      ? await context.agentRun.stage("generating_conclusion", generateCoachAnswer)
      : await generateCoachAnswer();
    generatedConclusion = {
      status: "skipped",
      reason: "coach_answer_service",
      model: coachAnswer.model ?? null,
      latencyMs: coachAnswer.latencyMs ?? 0
    };
  } else {
    generatedConclusion = canDeferConclusion
      ? pendingConclusion(
        createConclusionJob(runtime, conclusionOptions, scope),
        requestRuntime.conclusionGeneratorConfig?.model ?? requestRuntime.conclusionProvider?.model ?? null
      )
      : context.agentRun
        ? await context.agentRun.stage(
          "generating_conclusion",
          () => generateEvidenceBackedConclusion(conclusionOptions)
        )
        : await generateEvidenceBackedConclusion(conclusionOptions);
  }
  const responseEvidenceValidation = context.agentRun && !context.agentRun.terminal
    ? await context.agentRun.stage("validating", async () => {
      const conclusionUsesEvidence = generatedConclusion?.status !== "generated"
        || Boolean(result.source || result.executionTrace?.status === "completed");
      return {
        schemaVersion: "response-evidence-validation.v1",
        sufficient: conclusionUsesEvidence,
        executionSource: result.executionTrace?.source
          ?? (result.retrievalPlan ? "legacy_fallback" : "structured_response"),
        errors: conclusionUsesEvidence ? [] : ["generated_conclusion_without_structured_evidence"]
      };
    })
    : null;

  const payload = serializeRecommendation(result, catalog, {
    durationMs: Date.now() - startedAt,
    catalogWarning: warning,
    aliasMemory,
    preferences,
    conversationId,
    itemDetails: conclusionItemDetails
  });
  payload.answer = {
    ...(payload.answer ?? {}),
    generatedConclusion,
    evidenceValidation: responseEvidenceValidation
  };
  payload.mode = answerModeRoute.mode;
  payload.answerModeRoute = answerModeRoute;
  if (coachAnswer) {
    payload.assistantResponse = assistantResponseFromCoach(coachAnswer);
    payload.knowledgeEvidence = coachKnowledge.evidence;
    payload.currentStatsScope = coachKnowledge.currentStats ?? null;
    payload.evidenceBundle = coachAnswer.evidenceBundle;
    payload.queryResult = coachAnswer.evidenceBundle?.queryResult ?? null;
  }
  payload.agent = {
    status: result.agentStatus ?? null,
    route: result.agentRouting ? {
      schemaVersion: result.agentRouting.schemaVersion,
      selectedPath: result.agentRouting.route === "legacy_fallback"
        ? "legacy"
        : "execution_plan",
      route: result.agentRouting.route,
      fallbackReason: result.agentRouting.route === "legacy_fallback"
        ? result.agentRouting.reason
        : null
    } : null,
    executionPlan: result.executionPlan ?? null,
    executionTrace: result.executionTrace ?? null,
    shadowComparison: result.agentRouting?.shadowComparison ?? null,
    failureStage: result.agentTrace?.failureLayer ?? null,
    metrics: result.agentTrace?.metrics ?? null
  };
  if (result.intentEnvelope) payload.intentEnvelope = result.intentEnvelope;
  if (result.retrievalPlan) payload.retrievalPlan = result.retrievalPlan;
  Object.assign(payload, conversationMeta({ conversationId }));
  return completeResponse(payload);
}

function classifyAgentHttpResult(value) {
  const payload = value?.payload;
  if (payload?.type === "clarification" || payload?.clarification?.needsClarification) {
    return "clarification_required";
  }
  if (payload?.answer?.generatedConclusion?.status === "fallback") return "fallback";
  return "completed";
}

export async function handleRecommendRequest(body, runtime, context = {}) {
  if (context.agentRun || !runtime.agentRuntime) {
    return handleRecommendRequestInternal(body, runtime, context);
  }
  const conversationId = String(body?.conversationId ?? body?.conversation_id ?? "").trim() || "default";
  const execution = await runtime.agentRuntime.run({
    conversationId,
    principalId: context.visitor?.scope ?? "anonymous",
    seasonContextId: body?.seasonContextId ?? DEFAULT_SEASON_CONTEXT_ID
  }, async (agentRun) => {
    return handleRecommendRequestInternal(body, runtime, {
      ...context,
      agentRun,
      signal: context.signal
    });
  }, {
    signal: context.signal,
    classifyResult: classifyAgentHttpResult
  });
  if (execution.value?.payload) execution.value.payload.run = execution.publicRun;
  return execution.value;
}

export async function streamRecommendResponse(req, res, body, runtime, context = {}) {
  let sequence = 0;
  beginNdjson(res);
  const writeProgress = (event) => {
    sequence += 1;
    writeNdjson(res, {
      type: "progress",
      event: {
        schemaVersion: "recommendation-progress.v1",
        sequence,
        phase: String(event?.type ?? "unknown"),
        data: event?.data ?? {}
      }
    });
  };
  writeProgress({ type: "request.accepted" });
  try {
    const { statusCode, payload } = await handleRecommendRequest(body, runtime, {
      ...context,
      onProgress: writeProgress
    });
    if (res.destroyed || res.writableEnded) return;
    writeNdjson(res, {
      type: "complete",
      statusCode,
      payload
    });
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
    writeNdjson(res, {
      type: "error",
      statusCode: Number(error?.statusCode ?? 500),
      error: String(error?.message ?? "recommendation stream failed").slice(0, 500)
    });
  }
  res.end();
}

export async function handlePreferencesRequest(body, runtime, scope = null) {
  return {
    ok: true,
    preferences: await saveSmallWindowPreferences(runtime, body?.preferences ?? body ?? {}, scope)
  };
}

export async function handlePreferencesResetRequest(runtime, scope = null) {
  return {
    ok: true,
    preferences: await resetSmallWindowPreferences(runtime, scope)
  };
}

export async function handleCacheClearRequest(runtime) {
  const storeCleared = await runtime.cacheStore?.clearQueryHistory?.() ?? {
    queryCache: 0,
    defaultContextCache: 0,
    sessionState: 0
  };
  const catalogCache = invalidateRuntimeCatalog(runtime);
  const compDetailCache = runtime.compDetailCache?.size ?? 0;
  const augmentLookupCache = runtime.augmentLookupCache?.size ?? 0;
  runtime.compDetailCache?.clear?.();
  runtime.compDetailLoadPromises?.clear?.();
  runtime.augmentLookupCache?.clear?.();
  runtime.augmentLookupLoadPromises?.clear?.();

  return {
    ok: true,
    cleared: {
      queryCache: storeCleared.queryCache ?? 0,
      defaultContextCache: storeCleared.defaultContextCache ?? 0,
      sessionState: storeCleared.sessionState ?? 0,
      catalogCache,
      compDetailCache,
      augmentLookupCache
    }
  };
}

function normalizeCompDetailIdentifier(value, field) {
  const normalized = String(value ?? "").trim();
  if (!/^\d{1,12}$/u.test(normalized)) {
    throw Object.assign(new TypeError(`${field} must be a MetaTFT numeric identifier`), {
      statusCode: 400,
      code: "invalid_comp_detail_identifier",
      field
    });
  }
  return normalized;
}

function normalizeCompDetailUnitApiNames(value) {
  const candidates = Array.isArray(value)
    ? value
    : String(value ?? "").split(",");
  const seen = new Set();
  const units = [];
  for (const candidate of candidates) {
    const apiName = String(candidate ?? "").trim();
    if (!apiName || seen.has(apiName)) continue;
    if (!/^TFT[A-Za-z0-9_]+$/u.test(apiName)) {
      throw Object.assign(new TypeError("units must contain TFT unit API identifiers"), {
        statusCode: 400,
        code: "invalid_comp_detail_unit",
        field: "units"
      });
    }
    seen.add(apiName);
    units.push(apiName);
  }
  if (units.length === 0 || units.length > MAX_COMP_DETAIL_UNITS) {
    throw Object.assign(new RangeError(`units must contain 1 to ${MAX_COMP_DETAIL_UNITS} unique champions`), {
      statusCode: 400,
      code: "invalid_comp_detail_units",
      field: "units"
    });
  }
  return units;
}

function metaTftDetailTimestamp(...responses) {
  const value = responses
    .map((response) => response?.updated)
    .find((candidate) => candidate !== undefined && candidate !== null);
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : null;
}

function catalogForCompDetail(runtime, seasonContext) {
  if (runtime.catalog) return runtime.catalog;
  const key = runtimeCatalogKey({
    seasonContextId: seasonContext.id,
    providerVersion: seasonContext.source.providerVersion,
    effectivePatch: seasonContext.effectivePatch,
    patch: seasonContext.providerPatch,
    queue: seasonContext.source.queue
  });
  return runtime.catalogCache?.get(key)?.catalog ?? createCatalog();
}

function compDetailUnitLabel(apiName, catalog) {
  const record = catalog?.unitByApiName?.get(apiName);
  return record?.zhName ?? record?.displayName ?? record?.name ?? apiName;
}

function metaTftAugmentIconUrl(texture) {
  const normalized = String(texture ?? "").trim();
  if (!/^[A-Za-z0-9_-]+$/u.test(normalized)) return null;
  return `https://cdn.metatft.com/file/metatft/augments/${normalized.toLowerCase()}.png`;
}

function normalizeCompDetailAugmentRarity(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "3" || /prismatic|orange|彩色|棱彩/u.test(normalized)) return "prismatic";
  if (normalized === "2" || /gold|金色/u.test(normalized)) return "gold";
  if (normalized === "1" || /silver|银色/u.test(normalized)) return "silver";
  return "unknown";
}

function augmentLookupRecords(response) {
  const content = response?.content?.content ?? response?.content ?? response ?? {};
  const records = Array.isArray(content?.augments) ? content.augments : [];
  return new Map(records
    .map((record) => [String(record?.apiName ?? "").trim(), record])
    .filter(([apiName]) => apiName));
}

function augmentLookupCacheKey(tftSet, locale) {
  return `${String(tftSet ?? "").trim()}|${String(locale ?? "").trim().toLowerCase()}`;
}

async function loadCachedAugmentLookup(runtime, tftSet, locale = "zh_cn") {
  if (!tftSet || typeof runtime.compsClient?.getAugmentLookup !== "function") return null;
  runtime.augmentLookupCache ??= new Map();
  runtime.augmentLookupLoadPromises ??= new Map();
  const key = augmentLookupCacheKey(tftSet, locale);
  const now = Date.now();
  const cached = runtime.augmentLookupCache.get(key);
  if (cached && cached.expiresAt > now) return cached.response;
  if (cached) runtime.augmentLookupCache.delete(key);

  const existing = runtime.augmentLookupLoadPromises.get(key);
  if (existing) return existing;

  const load = Promise.resolve().then(() => runtime.compsClient.getAugmentLookup(tftSet, locale));
  runtime.augmentLookupLoadPromises.set(key, load);
  try {
    const response = await load;
    if (response) {
      const ttlMs = Math.max(1000, Number(
        runtime.augmentLookupCacheTtlMs ?? DEFAULT_AUGMENT_LOOKUP_CACHE_TTL_MS
      ));
      runtime.augmentLookupCache.set(key, {
        response,
        expiresAt: Date.now() + ttlMs
      });
    }
    return response;
  } finally {
    if (runtime.augmentLookupLoadPromises.get(key) === load) {
      runtime.augmentLookupLoadPromises.delete(key);
    }
  }
}

function decorateCompDetailFormation(positioning, catalog, updatedAt) {
  return {
    ...positioning,
    units: positioning.units.map((unit) => {
      const asset = ASSET_RESOLVER.resolveUnit(unit.apiName);
      return {
        ...unit,
        name: compDetailUnitLabel(unit.apiName, catalog),
        iconUrl: asset.iconUrl,
        fallbackIconUrl: asset.fallbackIconUrl ?? null,
        assetFallback: Boolean(asset.fallback),
        items: []
      };
    }),
    source: {
      ...positioning.source,
      updatedAt
    }
  };
}

function decorateCompDetailAugments(augments, lookupResponse, updatedAt) {
  const lookup = augmentLookupRecords(lookupResponse);
  const eligibleEntries = augments.augments.map((augment) => {
    const record = lookup.get(augment.apiName);
    const rarity = normalizeCompDetailAugmentRarity(record?.rarity);
    return {
      apiName: augment.apiName,
      name: String(record?.name ?? augment.apiName),
      iconUrl: metaTftAugmentIconUrl(record?.texture),
      tier: augment.tier,
      rarity,
      tags: Array.isArray(record?.tags) ? record.tags.map(String).slice(0, 4) : []
    };
  }).filter((entry) => DISPLAYED_COMP_AUGMENT_RARITIES.has(entry.rarity));
  const entries = eligibleEntries.slice(0, MAX_COMP_DETAIL_AUGMENTS);
  const status = augments.status === "available" && entries.length === 0
    ? "unavailable"
    : augments.status;
  const reasons = [...augments.reasons];
  if (augments.status === "available" && entries.length === 0) {
    reasons.push({
      code: lookupResponse
        ? "no_gold_or_prismatic_augments"
        : "augment_rarity_lookup_unavailable"
    });
  }
  return {
    status,
    semantics: "comp_compatibility_tier",
    entries,
    totalEntries: eligibleEntries.length,
    totalCandidates: augments.totalAugments,
    truncated: entries.length < eligibleEntries.length,
    reasons,
    filter: {
      rarities: [...DISPLAYED_COMP_AUGMENT_RARITIES],
      limit: MAX_COMP_DETAIL_AUGMENTS
    },
    source: {
      ...augments.source,
      updatedAt,
      lookupEndpoint: lookupResponse ? "https://data.metatft.com/lookups/{set}_latest_zh_cn.json" : null,
      lookupStatus: lookupResponse ? "available" : "unavailable"
    }
  };
}

async function createCompDetailPayload(input, runtime, seasonContext) {
  const catalog = catalogForCompDetail(runtime, seasonContext);
  const detailRequest = typeof runtime.compsClient?.getCompDetails === "function"
    ? runtime.compsClient.getCompDetails({ comp: input.compId, cluster_id: input.clusterId })
    : Promise.reject(new Error("MetaTFT comp-details client is unavailable"));
  const augmentRequest = typeof runtime.compsClient?.getCompAugmentTiers === "function"
    ? runtime.compsClient.getCompAugmentTiers({ cluster_id: input.clusterId })
    : Promise.reject(new Error("MetaTFT comp-augment-tiers client is unavailable"));
  const [detailResult, augmentResult] = await Promise.allSettled([detailRequest, augmentRequest]);
  const detailResponse = detailResult.status === "fulfilled" ? detailResult.value : null;
  const augmentResponse = augmentResult.status === "fulfilled" ? augmentResult.value : null;
  const updatedAt = metaTftDetailTimestamp(detailResponse, augmentResponse);
  const positioning = normalizeCompDetailsPositioning(detailResponse ?? {}, input.units, {
    compId: input.compId,
    clusterId: input.clusterId
  });
  const normalizedAugments = normalizeCompAugmentTiers(augmentResponse ?? {}, input.compId, {
    clusterId: input.clusterId
  });
  const tftSet = String(detailResponse?.tft_set ?? augmentResponse?.tft_set ?? "").trim();
  let lookupResponse = null;
  let lookupWarning = null;
  if (normalizedAugments.status === "available" && tftSet) {
    try {
      lookupResponse = await loadCachedAugmentLookup(runtime, tftSet, "zh_cn");
    } catch {
      lookupWarning = "MetaTFT augment lookup is temporarily unavailable; gold and prismatic recommendations are hidden because rarity cannot be verified.";
    }
  }

  const warnings = [
    ...(detailResult.status === "rejected" ? ["MetaTFT positioning detail is temporarily unavailable."] : []),
    ...(augmentResult.status === "rejected" ? ["MetaTFT comp augment tiers are temporarily unavailable."] : []),
    ...(lookupWarning ? [lookupWarning] : [])
  ];
  const formation = decorateCompDetailFormation(positioning, catalog, updatedAt);
  const augmentRecommendations = decorateCompDetailAugments(normalizedAugments, lookupResponse, updatedAt);

  return {
    ok: true,
    compId: input.compId,
    clusterId: input.clusterId,
    seasonContextId: seasonContext.id,
    formation,
    augmentRecommendations,
    source: {
      provider: "MetaTFT",
      detailsEndpoint: formation.source.endpoint,
      augmentEndpoint: augmentRecommendations.source.endpoint,
      updatedAt,
      risk: "MetaTFT is an unofficial third-party data source. Positioning and augment compatibility are refreshed on demand and may change."
    },
    warnings
  };
}

function compDetailCacheKey(input, seasonContext) {
  return [
    seasonContext.id,
    input.clusterId,
    input.compId,
    input.units.join(",")
  ].join("|");
}

function withCompDetailCacheMetadata(payload, cache) {
  return {
    ...payload,
    cache
  };
}

export async function handleCompDetailRequest(options = {}, runtime) {
  const input = {
    compId: normalizeCompDetailIdentifier(options.compId ?? options.comp, "comp"),
    clusterId: normalizeCompDetailIdentifier(options.clusterId ?? options.cluster_id, "clusterId"),
    units: normalizeCompDetailUnitApiNames(options.units)
  };
  const seasonContext = runtime.seasonContextService.resolveForQuery(options.seasonContextId);
  const key = compDetailCacheKey(input, seasonContext);
  runtime.compDetailCache ??= new Map();
  runtime.compDetailLoadPromises ??= new Map();
  const now = Date.now();
  const cached = runtime.compDetailCache.get(key);
  if (cached && cached.expiresAt > now) {
    return withCompDetailCacheMetadata(cached.payload, {
      hit: true,
      updatedAt: cached.updatedAt,
      expiresAt: new Date(cached.expiresAt).toISOString()
    });
  }
  if (cached) runtime.compDetailCache.delete(key);

  const existing = runtime.compDetailLoadPromises.get(key);
  if (existing) {
    const payload = await existing;
    return withCompDetailCacheMetadata(payload, { hit: true, coalesced: true });
  }

  const load = createCompDetailPayload(input, runtime, seasonContext);
  runtime.compDetailLoadPromises.set(key, load);
  try {
    const payload = await load;
    const updatedAt = new Date().toISOString();
    const ttlMs = Math.max(1000, Number(runtime.compDetailCacheTtlMs ?? DEFAULT_COMP_DETAIL_CACHE_TTL_MS));
    const expiresAt = Date.now() + ttlMs;
    runtime.compDetailCache.set(key, { payload, updatedAt, expiresAt });
    return withCompDetailCacheMetadata(payload, {
      hit: false,
      updatedAt,
      expiresAt: new Date(expiresAt).toISOString()
    });
  } finally {
    if (runtime.compDetailLoadPromises.get(key) === load) {
      runtime.compDetailLoadPromises.delete(key);
    }
  }
}

function normalizeFeedbackType(value) {
  const type = String(value ?? "").trim();
  if (!VALID_FEEDBACK_TYPES.has(type)) {
    throw new Error(`Unsupported feedback type: ${type || "(empty)"}`);
  }
  return type;
}

function normalizeAliasCandidate(value = {}) {
  if (!value || typeof value !== "object") return null;
  const alias = String(value.alias ?? "").trim();
  const entityType = String(value.entityType ?? value.entity_type ?? "").trim();
  const apiName = String(value.apiName ?? value.api_name ?? "").trim();
  if (!alias || !entityType || !apiName) return null;
  return {
    alias,
    entityType,
    apiName,
    confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : 0.5,
    source: value.source ?? "feedback_candidate",
    patch: value.patch ?? null,
    enabled: false
  };
}

function finiteMetric(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRecommendationFeedbackPayload(value = {}, feedbackType) {
  const feedbackId = String(value.feedbackId ?? value.feedback_id ?? "").trim().slice(0, 160);
  const input = String(value.input ?? "").trim().slice(0, 500);
  if (!feedbackId || !input) {
    throw new Error("Recommendation feedback requires feedbackId and input");
  }

  const query = value.query && typeof value.query === "object" ? value.query : {};
  const recommendation = value.recommendation && typeof value.recommendation === "object"
    ? value.recommendation
    : {};
  const cache = value.cache && typeof value.cache === "object" ? value.cache : {};
  return {
    feedbackId,
    input,
    sentiment: feedbackType === "good_recommendation" ? "good" : "bad",
    cardIndex: Number.isInteger(Number(value.cardIndex)) ? Number(value.cardIndex) : 0,
    query: {
      unit: query.unit ?? null,
      starLevel: Array.isArray(query.starLevel) ? query.starLevel.slice(0, 3) : [],
      traitFilters: Array.isArray(query.traitFilters) ? query.traitFilters.slice(0, 12) : [],
      itemPolicy: query.itemPolicy ?? null,
      ownedItems: Array.isArray(query.ownedItems) ? query.ownedItems.slice(0, 3) : [],
      excludedItems: Array.isArray(query.excludedItems) ? query.excludedItems.slice(0, 6) : [],
      comparisonOptions: Array.isArray(query.comparisonOptions) ? query.comparisonOptions.slice(0, 6) : [],
      minSamples: finiteMetric(query.minSamples),
      sort: query.sort ?? null,
      patch: query.patch ?? null,
      days: finiteMetric(query.days),
      rankFilter: Array.isArray(query.rankFilter) ? query.rankFilter.slice(0, 12) : []
    },
    recommendation: {
      title: String(recommendation.title ?? "").slice(0, 80),
      items: Array.isArray(recommendation.items) ? recommendation.items.slice(0, 3).map(String) : [],
      top4: finiteMetric(recommendation.top4),
      win: finiteMetric(recommendation.win),
      avg: finiteMetric(recommendation.avg),
      games: finiteMetric(recommendation.games),
      lowSample: Boolean(recommendation.lowSample),
      winner: Boolean(recommendation.winner)
    },
    cache: {
      hit: Boolean(cache.hit),
      stale: Boolean(cache.stale)
    }
  };
}

async function handleLegacyFeedbackRequest(body, runtime) {
  const feedbackType = normalizeFeedbackType(body?.feedbackType ?? body?.feedback_type);
  const rawPayload = body?.payload && typeof body.payload === "object"
    ? body.payload
    : {};
  const payload = feedbackType === "good_recommendation" || feedbackType === "bad_recommendation"
    ? normalizeRecommendationFeedbackPayload(rawPayload, feedbackType)
    : rawPayload;
  const aliasCandidate = normalizeAliasCandidate(body?.aliasCandidate ?? body?.alias_candidate);
  const writeFeedback = async () => {
    if (payload.feedbackId) {
      const existing = runtime.cacheStore?.findFeedbackEventByFeedbackId
        ? await runtime.cacheStore.findFeedbackEventByFeedbackId(payload.feedbackId)
        : (await runtime.cacheStore?.listFeedbackEvents?.({ limit: Number.MAX_SAFE_INTEGER }) ?? [])
          .find((event) => event.payload?.feedbackId === payload.feedbackId);
      if (existing) {
        return {
          ok: true,
          feedback: existing,
          aliasCandidate: null,
          duplicate: true
        };
      }
    }

    const feedback = await runtime.cacheStore?.addFeedbackEvent?.(feedbackType, payload, {
      feedbackId: payload.feedbackId ?? `legacy:${randomUUID()}`,
      feedbackTarget: feedbackType === "good_explanation" || feedbackType === "bad_explanation"
        ? "explanation"
        : feedbackType === "good_recommendation" || feedbackType === "bad_recommendation"
          ? "recommendation"
          : "legacy",
      rating: feedbackType.startsWith("good_") ? "helpful" : feedbackType.startsWith("bad_") ? "unhelpful" : null,
      cardIndex: Number.isInteger(payload.cardIndex) ? payload.cardIndex : null,
      status: body?.status ?? "pending"
    });
    const alias = aliasCandidate
      ? await runtime.cacheStore?.addEntityAlias?.(aliasCandidate)
      : null;
    return {
      ok: true,
      feedback,
      aliasCandidate: alias
    };
  };

  if (!payload.feedbackId) return writeFeedback();

  const lockKey = String(payload.feedbackId);
  runtime.feedbackWriteLocks ??= new Map();
  const previous = runtime.feedbackWriteLocks.get(lockKey) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(writeFeedback);
  runtime.feedbackWriteLocks.set(lockKey, current);
  try {
    return await current;
  } finally {
    if (runtime.feedbackWriteLocks.get(lockKey) === current) {
      runtime.feedbackWriteLocks.delete(lockKey);
    }
  }
}

const FEEDBACK_TARGETS = new Set(["recommendation", "explanation"]);
const FEEDBACK_RATINGS = new Set(["helpful", "unhelpful"]);
const FEEDBACK_REASONS = new Set([
  "entity_parse_error",
  "wrong_comp_context",
  "wrong_items",
  "outdated_data",
  "low_sample",
  "answer_unclear",
  "explanation_incorrect",
  "missing_information",
  "other"
]);

function feedbackHttpError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function normalizeTrustedFeedback(body = {}) {
  const queryId = String(body.queryId ?? body.query_id ?? "").trim();
  const target = String(body.target ?? "").trim();
  const rating = String(body.rating ?? "").trim();
  const cardIndex = body.cardIndex === undefined || body.cardIndex === null
    ? null
    : Number(body.cardIndex);
  const reason = String(body.reason ?? "").trim() || null;
  if (!queryId || !FEEDBACK_TARGETS.has(target) || !FEEDBACK_RATINGS.has(rating)) {
    throw feedbackHttpError("Feedback requires a valid queryId, target, and rating", 400);
  }
  if (target === "recommendation" && (!Number.isInteger(cardIndex) || cardIndex < 0)) {
    throw feedbackHttpError("Recommendation feedback requires a valid cardIndex", 400);
  }
  if (reason && (rating !== "unhelpful" || !FEEDBACK_REASONS.has(reason))) {
    throw feedbackHttpError("Unsupported feedback reason", 400);
  }
  return { queryId, target, rating, cardIndex, reason };
}

async function handleTrustedFeedbackRequest(body, runtime, context = {}) {
  const normalized = normalizeTrustedFeedback(body);
  const queryEvent = await runtime.cacheStore?.getQueryEvent?.(normalized.queryId);
  if (!queryEvent) throw feedbackHttpError("Query not found", 404);
  const currentScope = String(context.visitor?.scope ?? "local");
  if (queryEvent.visitorScope !== currentScope) {
    throw feedbackHttpError("Query not found", 404);
  }

  const response = queryEvent.response ?? {};
  let selected = null;
  if (normalized.target === "recommendation") {
    selected = response.cards?.[normalized.cardIndex] ?? null;
    if (!selected) throw feedbackHttpError("Recommendation card not found", 400);
  } else {
    selected = response.answer?.generatedConclusion ?? null;
    if (!selected?.content) throw feedbackHttpError("Explanation not found", 400);
  }

  const feedbackType = `${normalized.rating === "helpful" ? "good" : "bad"}_${normalized.target}`;
  const feedbackId = normalized.target === "recommendation"
    ? `${normalized.queryId}:recommendation:${normalized.cardIndex}`
    : `${normalized.queryId}:explanation`;
  const payload = {
    queryId: normalized.queryId,
    input: queryEvent.input,
    resultType: queryEvent.resultType,
    query: queryEvent.query,
    recommendation: normalized.target === "recommendation" ? selected : null,
    explanation: normalized.target === "explanation" ? selected.content : null,
    cache: {
      hit: queryEvent.cacheHit,
      stale: queryEvent.cacheStale
    },
    llm: {
      used: queryEvent.llmUsed,
      model: queryEvent.llmModel
    },
    durationMs: queryEvent.durationMs,
    reason: normalized.reason
  };
  const feedback = await runtime.cacheStore?.addFeedbackEvent?.(feedbackType, payload, {
    feedbackId,
    queryId: normalized.queryId,
    visitorScope: currentScope,
    feedbackTarget: normalized.target,
    rating: normalized.rating,
    cardIndex: normalized.cardIndex,
    reason: normalized.reason,
    status: "pending"
  });
  return {
    ok: true,
    feedback,
    aliasCandidate: null,
    duplicate: Boolean(feedback?.duplicate)
  };
}

async function handleTrustedAliasCandidateRequest(body, runtime, context = {}) {
  const queryId = String(body.queryId ?? body.query_id ?? "").trim();
  const queryEvent = await runtime.cacheStore?.getQueryEvent?.(queryId);
  if (!queryEvent) throw feedbackHttpError("Query not found", 404);
  const currentScope = String(context.visitor?.scope ?? "local");
  if (queryEvent.visitorScope !== currentScope) throw feedbackHttpError("Query not found", 404);
  const aliasCandidate = normalizeAliasCandidate(body.aliasCandidate ?? body.alias_candidate);
  if (!aliasCandidate) throw feedbackHttpError("Invalid alias candidate", 400);
  const feedbackId = `${queryId}:alias:${aliasCandidate.entityType}:${aliasCandidate.apiName}`.slice(0, 160);
  const payload = {
    queryId,
    input: queryEvent.input,
    candidate: {
      alias: aliasCandidate.alias,
      entityType: aliasCandidate.entityType,
      apiName: aliasCandidate.apiName,
      confidence: aliasCandidate.confidence,
      source: aliasCandidate.source
    }
  };
  const feedback = await runtime.cacheStore?.addFeedbackEvent?.("alias_candidate", payload, {
    feedbackId,
    queryId,
    visitorScope: currentScope,
    feedbackTarget: "alias_candidate",
    rating: "candidate",
    status: "pending"
  });
  const alias = feedback?.duplicate
    ? null
    : await runtime.cacheStore?.addEntityAlias?.(aliasCandidate);
  return {
    ok: true,
    feedback,
    aliasCandidate: alias,
    duplicate: Boolean(feedback?.duplicate)
  };
}

export async function handleFeedbackRequest(body, runtime, context = {}) {
  if (body?.queryId || body?.query_id) {
    if ((body.feedbackType ?? body.feedback_type) === "alias_candidate") {
      return handleTrustedAliasCandidateRequest(body, runtime, context);
    }
    return handleTrustedFeedbackRequest(body, runtime, context);
  }
  if (context.accessService?.config?.enabled) {
    throw feedbackHttpError("Query-linked feedback is required", 400);
  }
  return handleLegacyFeedbackRequest(body, runtime);
}

function incrementFeedbackStat(target, key) {
  const normalized = String(key ?? "").trim() || "unknown";
  target[normalized] = Number(target[normalized] ?? 0) + 1;
}

export async function handleFeedbackStatsRequest(runtime, options = {}) {
  const days = Number.isInteger(Number(options.days))
    ? Math.min(365, Math.max(1, Number(options.days)))
    : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const events = await runtime.cacheStore?.listFeedbackEvents?.({
    limit: Number.MAX_SAFE_INTEGER
  }) ?? [];
  const stats = {
    total: 0,
    rated: 0,
    helpfulRate: null,
    ratings: {},
    targets: {},
    reasons: {},
    resultTypes: {},
    units: {},
    patches: {},
    models: {},
    llm: {
      used: 0,
      notUsed: 0
    },
    cache: {
      hit: 0,
      miss: 0,
      stale: 0
    }
  };

  for (const event of events) {
    if (String(event.createdAt ?? "") < since) continue;
    stats.total += 1;
    incrementFeedbackStat(stats.ratings, event.rating);
    incrementFeedbackStat(stats.targets, event.feedbackTarget);
    incrementFeedbackStat(stats.resultTypes, event.payload?.resultType);
    incrementFeedbackStat(stats.units, event.payload?.query?.unit);
    incrementFeedbackStat(stats.patches, event.payload?.query?.patch);
    if (event.reason) incrementFeedbackStat(stats.reasons, event.reason);
    if (event.payload?.llm?.model) incrementFeedbackStat(stats.models, event.payload.llm.model);
    if (event.payload?.llm?.used) stats.llm.used += 1;
    else stats.llm.notUsed += 1;
    if (event.payload?.cache?.stale) stats.cache.stale += 1;
    if (event.payload?.cache?.hit) stats.cache.hit += 1;
    else stats.cache.miss += 1;
  }

  stats.rated = Number(stats.ratings.helpful ?? 0) + Number(stats.ratings.unhelpful ?? 0);
  if (stats.rated > 0) {
    stats.helpfulRate = Number((Number(stats.ratings.helpful ?? 0) / stats.rated).toFixed(4));
  }
  return {
    ok: true,
    range: {
      days,
      since,
      generatedAt: new Date().toISOString()
    },
    stats
  };
}

export async function handleEntityMemoryClearRequest(runtime, options = {}) {
  const seasonContext = resolveAdminSeasonContext(runtime, options.seasonContextId);
  const candidateAliases = await runtime.cacheStore?.clearEntityAliases?.({
    seasonContextId: seasonContext.id,
    enabled: false
  }) ?? 0;
  const feedbackEvents = await runtime.cacheStore?.clearFeedbackEvents?.({
    seasonContextId: seasonContext.id
  }) ?? 0;
  await recordAdminAudit(runtime, seasonContext.id, "clear", "entity_memory", null, null, {
    candidateAliases,
    feedbackEvents
  });
  return {
    ok: true,
    cleared: {
      candidateAliases,
      feedbackEvents
    }
  };
}

export async function handleEntityAliasesRequest(runtime, options = {}) {
  const limit = Number.isInteger(Number(options.limit)) && Number(options.limit) > 0
    ? Number(options.limit)
    : 100;
  const offset = Number.isInteger(Number(options.offset)) && Number(options.offset) >= 0
    ? Number(options.offset)
    : 0;
  const aliases = await runtime.cacheStore?.listEntityAliases?.({
    enabled: options.enabled,
    entityType: options.entityType,
    apiName: options.apiName,
    query: options.query,
    source: options.source,
    seasonContextId: options.seasonContextId,
    offset,
    limit: limit + 1
  }) ?? [];
  const pageAliases = aliases.slice(0, limit);

  return {
    ok: true,
    aliases: pageAliases,
    pagination: {
      limit,
      offset,
      returned: pageAliases.length,
      hasMore: aliases.length > limit,
      nextOffset: aliases.length > limit ? offset + pageAliases.length : null
    }
  };
}

export async function handleEntityAliasExportRequest(runtime, options = {}) {
  const aliases = await runtime.cacheStore?.listEntityAliases?.({
    enabled: options.enabled,
    entityType: options.entityType,
    apiName: options.apiName,
    seasonContextId: options.seasonContextId,
    limit: options.limit ?? 1000
  }) ?? [];
  return {
    ok: true,
    draft: buildEntityAliasOverrideDraft(aliases, {
      includeDisabled: options.includeDisabled ?? true
    })
  };
}

export async function handleEntityAliasReviewRequest(body, runtime) {
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Entity alias review requires a positive id");
  }
  const enabled = Boolean(body?.enabled);
  const alias = await runtime.cacheStore?.setEntityAliasEnabled?.(id, enabled, {
    seasonContextId: body?.seasonContextId
  });
  if (!alias) throw new Error(`Entity alias not found: ${id}`);
  invalidateRuntimeCatalog(runtime);
  return {
    ok: true,
    alias
  };
}

export async function handleEntityAliasBatchReviewRequest(body, runtime) {
  const ids = Array.isArray(body?.ids)
    ? [...new Set(body.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
    : [];
  if (ids.length === 0) {
    throw new Error("Entity alias batch review requires at least one positive id");
  }

  const enabled = Boolean(body?.enabled);
  const aliases = [];
  const missingIds = [];
  for (const id of ids) {
    const alias = await runtime.cacheStore?.setEntityAliasEnabled?.(id, enabled, {
      seasonContextId: body?.seasonContextId
    });
    if (alias) aliases.push(alias);
    else missingIds.push(id);
  }

  if (aliases.length > 0) invalidateRuntimeCatalog(runtime);
  return {
    ok: true,
    aliases,
    updated: aliases.length,
    missingIds
  };
}

function resolveAdminSeasonContext(runtime, seasonContextId) {
  return runtime.seasonContextService.resolve(seasonContextId, {
    requireVisible: false,
    requireSelectable: false,
    requireAvailable: false
  });
}

function normalizedAdminAliasInput(value = {}, fallback = {}) {
  const alias = String(value.alias ?? fallback.alias ?? "").trim();
  const entityType = String(value.entityType ?? value.entity_type ?? fallback.entityType ?? "").trim().toLowerCase();
  const apiName = String(value.apiName ?? value.api_name ?? fallback.apiName ?? "").trim();
  if (!alias || !["unit", "item", "trait"].includes(entityType) || !apiName) {
    throw Object.assign(new Error("别名必须包含 alias、有效 entityType 和 apiName"), { statusCode: 400 });
  }
  const confidence = Number(value.confidence ?? fallback.confidence ?? 1);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw Object.assign(new Error("confidence 必须在 0 到 1 之间"), { statusCode: 400 });
  }
  return {
    alias,
    entityType,
    apiName,
    confidence,
    source: String(value.source ?? fallback.source ?? "admin").trim() || "admin",
    patch: value.patch === undefined ? (fallback.patch ?? null) : value.patch,
    enabled: value.enabled === undefined ? (fallback.enabled ?? true) : Boolean(value.enabled)
  };
}

async function adminCatalogFor(runtime, seasonContext, refresh = false) {
  if (!seasonContext.availability?.available) {
    throw Object.assign(new Error("该赛季目录尚不可用，不能校验别名目标"), {
      statusCode: 409,
      code: "season_catalog_unavailable"
    });
  }
  const preferences = {
    ...completeSmallWindowPreferences(),
    seasonContextId: seasonContext.id,
    providerVersion: seasonContext.source.providerVersion,
    effectivePatch: seasonContext.effectivePatch,
    patch: seasonContext.effectivePatch,
    queue: seasonContext.source.queue
  };
  if (refresh) invalidateRuntimeCatalog(runtime, runtimeCatalogKey(preferences));
  return (await loadRuntimeCatalog(runtime, preferences)).catalog;
}

function assertAliasTargetExists(catalog, alias) {
  const exists = alias.entityType === "unit"
    ? catalog.unitByApiName.has(alias.apiName)
    : alias.entityType === "item"
      ? catalog.itemByApiName.has(alias.apiName)
      : catalog.traitByFilterId.has(alias.apiName) || catalog.traitByApiName.has(alias.apiName);
  if (!exists) {
    throw Object.assign(new Error(`当前赛季目录中不存在目标实体：${alias.apiName}`), {
      statusCode: 400,
      code: "alias_target_not_found"
    });
  }
}

async function recordAdminAudit(runtime, seasonContextId, action, entityType, entityId, before, after) {
  return runtime.cacheStore?.addAdminAudit?.({
    seasonContextId,
    action,
    entityType,
    entityId,
    before,
    after,
    actor: "admin"
  });
}

export async function handleAdminAliasCreate(body, runtime) {
  const seasonContext = resolveAdminSeasonContext(runtime, body?.seasonContextId);
  const aliasInput = normalizedAdminAliasInput(body);
  assertAliasTargetExists(await adminCatalogFor(runtime, seasonContext), aliasInput);
  const alias = await runtime.cacheStore.addEntityAlias({
    ...aliasInput,
    seasonContextId: seasonContext.id,
    updatedBy: "admin"
  });
  await recordAdminAudit(runtime, seasonContext.id, "create", "entity_alias", alias.id, null, alias);
  invalidateRuntimeCatalog(runtime);
  return { ok: true, alias };
}

export async function handleAdminAliasUpdate(id, body, runtime) {
  const seasonContext = resolveAdminSeasonContext(runtime, body?.seasonContextId);
  const before = await runtime.cacheStore?.getEntityAlias?.(id, { seasonContextId: seasonContext.id });
  if (!before) throw Object.assign(new Error(`Entity alias not found: ${id}`), { statusCode: 404 });
  const aliasInput = normalizedAdminAliasInput(body, before);
  assertAliasTargetExists(await adminCatalogFor(runtime, seasonContext), aliasInput);
  const alias = await runtime.cacheStore.updateEntityAlias(id, { ...aliasInput, updatedBy: "admin" }, {
    seasonContextId: seasonContext.id,
    updatedBy: "admin"
  });
  await recordAdminAudit(runtime, seasonContext.id, "update", "entity_alias", id, before, alias);
  invalidateRuntimeCatalog(runtime);
  return { ok: true, alias };
}

export async function handleAdminAliasDelete(id, seasonContextId, runtime) {
  const seasonContext = resolveAdminSeasonContext(runtime, seasonContextId);
  const alias = await runtime.cacheStore?.deleteEntityAlias?.(id, { seasonContextId: seasonContext.id });
  if (!alias) throw Object.assign(new Error(`Entity alias not found: ${id}`), { statusCode: 404 });
  await recordAdminAudit(runtime, seasonContext.id, "delete", "entity_alias", id, alias, null);
  invalidateRuntimeCatalog(runtime);
  return { ok: true, alias };
}

export async function handleAdminAliasMatch(body, runtime) {
  const seasonContext = resolveAdminSeasonContext(runtime, body?.seasonContextId);
  const input = String(body?.input ?? body?.alias ?? "").trim();
  if (!input) throw Object.assign(new Error("请输入要测试的俗称"), { statusCode: 400 });
  const aliases = await runtime.cacheStore?.findEntityAliases?.(input, {
    seasonContextId: seasonContext.id,
    enabled: true,
    limit: 20
  }) ?? [];
  return {
    ok: true,
    seasonContext: runtime.seasonContextService.publicRecord(seasonContext),
    input,
    matched: aliases.length > 0,
    matches: aliases
  };
}

export async function handleAdminAliasImport(body, runtime) {
  const seasonContext = resolveAdminSeasonContext(runtime, body?.seasonContextId);
  const records = Array.isArray(body?.aliases) ? body.aliases : [];
  if (!records.length || records.length > 2000) {
    throw Object.assign(new Error("aliases 必须是 1 到 2000 条记录的数组"), { statusCode: 400 });
  }
  const catalog = await adminCatalogFor(runtime, seasonContext);
  const normalized = records.map((record) => normalizedAdminAliasInput(record));
  normalized.forEach((record) => assertAliasTargetExists(catalog, record));
  const aliases = [];
  for (const record of normalized) {
    aliases.push(await runtime.cacheStore.addEntityAlias({
      ...record,
      seasonContextId: seasonContext.id,
      source: record.source || "admin_import",
      updatedBy: "admin"
    }));
  }
  await recordAdminAudit(runtime, seasonContext.id, "import", "entity_alias", null, null, {
    count: aliases.length,
    ids: aliases.map((alias) => alias.id)
  });
  invalidateRuntimeCatalog(runtime);
  return { ok: true, imported: aliases.length, aliases };
}

export async function handleAdminAliasBatchReview(body, runtime) {
  const seasonContext = resolveAdminSeasonContext(runtime, body?.seasonContextId);
  const ids = [...new Set((Array.isArray(body?.ids) ? body.ids : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw Object.assign(new Error("请选择至少一条候选别名"), { statusCode: 400 });
  const enabled = Boolean(body?.enabled);
  const aliases = [];
  const missingIds = [];
  for (const id of ids) {
    const before = await runtime.cacheStore?.getEntityAlias?.(id, { seasonContextId: seasonContext.id });
    const alias = await runtime.cacheStore?.setEntityAliasEnabled?.(id, enabled, {
      seasonContextId: seasonContext.id,
      updatedBy: "admin"
    });
    if (!alias) {
      missingIds.push(id);
      continue;
    }
    aliases.push(alias);
    await recordAdminAudit(runtime, seasonContext.id, enabled ? "approve" : "disable", "entity_alias", id, before, alias);
  }
  if (aliases.length) invalidateRuntimeCatalog(runtime);
  return { ok: true, updated: aliases.length, aliases, missingIds };
}

export async function handleAdminAliasBackup(runtime, options = {}) {
  const seasonContext = resolveAdminSeasonContext(runtime, options.seasonContextId);
  const aliases = await runtime.cacheStore?.listEntityAliases?.({
    seasonContextId: seasonContext.id,
    limit: 100000
  }) ?? [];
  return {
    ok: true,
    schemaVersion: "entity_alias_backup.v1",
    seasonContext: runtime.seasonContextService.publicRecord(seasonContext),
    exportedAt: new Date().toISOString(),
    aliases
  };
}

export async function handleAdminAliasExport(runtime, options = {}) {
  const seasonContext = resolveAdminSeasonContext(runtime, options.seasonContextId);
  const catalog = await adminCatalogFor(runtime, seasonContext);
  const aliases = [];
  const append = (entityType, records, identity) => {
    for (const record of records ?? []) {
      const apiName = identity(record);
      const seen = new Set();
      for (const alias of record.aliases ?? []) {
        const normalizedAlias = normalizeAlias(alias);
        if (!apiName || !normalizedAlias || seen.has(normalizedAlias)) continue;
        seen.add(normalizedAlias);
        aliases.push({
          seasonContextId: seasonContext.id,
          entityType,
          apiName,
          alias: String(alias),
          normalizedAlias,
          enabled: true,
          source: "effective"
        });
      }
    }
  };
  append("unit", catalog.units, (record) => record.apiName);
  append("item", catalog.items, (record) => record.apiName);
  append("trait", catalog.traits, (record) => record.filterId ?? record.apiName);
  aliases.sort((left, right) => left.entityType.localeCompare(right.entityType)
    || left.apiName.localeCompare(right.apiName)
    || left.normalizedAlias.localeCompare(right.normalizedAlias));
  return {
    ok: true,
    schemaVersion: "entity_alias_effective_export.v1",
    seasonContext: runtime.seasonContextService.publicRecord(seasonContext),
    exportedAt: new Date().toISOString(),
    aliases
  };
}

export async function handleAdminAuditRequest(runtime, options = {}) {
  const seasonContext = resolveAdminSeasonContext(runtime, options.seasonContextId);
  return {
    ok: true,
    audits: await runtime.cacheStore?.listAdminAudits?.({
      seasonContextId: seasonContext.id,
      limit: options.limit ?? 100
    }) ?? []
  };
}

export function handleAdminSeasonContexts(runtime) {
  const seasonContexts = [...runtime.seasonContextService.contexts.values()].map((context) => {
    const resolved = runtime.seasonContextService.resolve(context.id, {
      requireVisible: false,
      requireSelectable: false,
      requireAvailable: false
    });
    return {
      ...runtime.seasonContextService.publicRecord(resolved),
      catalogNamespace: resolved.catalogNamespace,
      source: {
        provider: resolved.source.provider,
        providerVersion: resolved.source.providerVersion,
        queue: resolved.source.queue,
        patchPolicy: resolved.source.patchPolicy,
        effectivePatch: resolved.effectivePatch
      }
    };
  });
  return {
    ok: true,
    defaultSeasonContextId: runtime.seasonContextService.defaultContextId,
    seasonContexts
  };
}

export async function handleAdminCompProfiles(runtime, options = {}) {
  const seasonContext = resolveAdminSeasonContext(runtime, options.seasonContextId);
  const [effectiveProfiles, overrides, bindings] = await Promise.all([
    runtime.compEnrichmentService.effectiveProfiles(seasonContext.id),
    runtime.cacheStore?.listCompProfiles?.({ seasonContextId: seasonContext.id }) ?? [],
    runtime.compEnrichmentService.effectiveBindings(seasonContext.id, seasonContext.source.provider)
  ]);
  return {
    ok: true,
    seasonContext: runtime.seasonContextService.publicRecord(seasonContext),
    profiles: [...effectiveProfiles.values()],
    overrides,
    bindings
  };
}

export async function handleAdminCompProfileSave(body, runtime, options = {}) {
  const allowedFields = new Set(["seasonContextId", "profileKey", "profile", "enabled"]);
  const unknownFields = Object.keys(body ?? {}).filter((field) => !allowedFields.has(field));
  if (unknownFields.length) {
    throw Object.assign(new TypeError(`Comp Profile 写请求包含未定义字段：${unknownFields.join(", ")}`), {
      code: "invalid_comp_profile",
      statusCode: 400,
      field: unknownFields[0]
    });
  }
  const seasonContext = resolveAdminSeasonContext(runtime, body?.seasonContextId);
  const profileKey = String(options.profileKey ?? body?.profileKey ?? "").trim();
  const before = await runtime.cacheStore?.getCompProfile?.(profileKey, { seasonContextId: seasonContext.id }) ?? null;
  const profile = await runtime.compEnrichmentService.saveProfile({
    seasonContextId: seasonContext.id,
    profileKey,
    profile: body?.profile ?? {},
    enabled: body?.enabled,
    source: "admin"
  });
  await recordAdminAudit(runtime, seasonContext.id, before ? "update" : "create", "comp_profile", profileKey, before, profile);
  return { ok: true, profile };
}

export async function handleAdminCompProfileDelete(profileKey, seasonContextId, runtime) {
  const seasonContext = resolveAdminSeasonContext(runtime, seasonContextId);
  const deleted = await runtime.compEnrichmentService.deleteProfile(profileKey, {
    seasonContextId: seasonContext.id
  });
  if (!deleted) throw Object.assign(new Error(`Comp profile not found: ${profileKey}`), { statusCode: 404 });
  await recordAdminAudit(runtime, seasonContext.id, "delete", "comp_profile", profileKey, deleted, null);
  return { ok: true, profile: deleted };
}

async function loadAdminCurrentComps(runtime, seasonContext, options = {}) {
  if (!seasonContext.availability?.available) {
    throw Object.assign(new Error("该赛季阵容数据当前不可用"), { statusCode: 409, code: "season_provider_unavailable" });
  }
  const queue = seasonContext.source.queue;
  const patch = seasonContext.effectivePatch;
  const catalog = await adminCatalogFor(runtime, seasonContext, Boolean(options.refresh));
  let compsData = await runtime.compsClient.getCompsData({ queue });
  const dataClusterId = compsData?.results?.data?.cluster_id ?? compsData?.cluster_id;
  const compsStats = await runtime.compsClient.getCompsStats({
    queue,
    patch,
    days: 3,
    permit_filter_adjustment: "true",
    ...(dataClusterId !== undefined && dataClusterId !== null ? { cluster_id: dataClusterId } : {})
  });
  const statsClusterId = compsStats?.cluster_id ?? compsStats?.data?.cluster_id;
  if (dataClusterId !== undefined && statsClusterId !== undefined && String(dataClusterId) !== String(statsClusterId)) {
    compsData = await runtime.compsClient.getCompsData({ queue });
    throw Object.assign(new Error("MetaTFT 阵容定义和统计 cluster 不一致，请稍后重试"), {
      statusCode: 503,
      code: "comp_cluster_mismatch"
    });
  }
  const query = {
    intent: "comp_rankings",
    seasonContextId: seasonContext.id,
    providerVersion: seasonContext.source.providerVersion,
    effectivePatch: patch,
    patch,
    queue,
    days: 3,
    minSamples: 0,
    metrics: ["top4_rate"],
    limit: 200
  };
  const facts = buildCompRankings(createCompsPageSnapshot(compsData, compsStats), { query, catalog });
  const enriched = await runtime.compEnrichmentService.enrichRankingResult(facts, {
    seasonContextId: seasonContext.id,
    provider: seasonContext.source.provider
  });
  return {
    result: enriched,
    comps: enriched.rankings.top4Rate ?? []
  };
}

export async function handleAdminCurrentComps(runtime, options = {}) {
  const seasonContext = runtime.seasonContextService.resolve(options.seasonContextId, {
    requireVisible: false,
    requireSelectable: false,
    requireAvailable: true
  });
  const current = await loadAdminCurrentComps(runtime, seasonContext, options);
  const status = String(options.matchStatus ?? "");
  return {
    ok: true,
    seasonContext: runtime.seasonContextService.publicRecord(seasonContext),
    enrichment: current.result.enrichment,
    comps: status ? current.comps.filter((comp) => comp.profileBinding?.status === status) : current.comps
  };
}

export async function handleAdminCompProfileBind(body, runtime) {
  const seasonContext = runtime.seasonContextService.resolve(body?.seasonContextId, {
    requireVisible: false,
    requireSelectable: false,
    requireAvailable: true
  });
  const profileKey = String(body?.profileKey ?? "").trim();
  const profile = (await runtime.compEnrichmentService.effectiveProfiles(seasonContext.id)).get(profileKey);
  if (!profile) throw Object.assign(new Error(`Comp profile not found: ${profileKey}`), { statusCode: 404 });
  const current = await loadAdminCurrentComps(runtime, seasonContext);
  const clusterId = String(body?.clusterId ?? "").trim();
  const comp = current.comps.find((record) => String(record.source?.clusterId) === clusterId);
  if (!comp) throw Object.assign(new Error(`当前 MetaTFT 阵容中不存在 cluster：${clusterId}`), { statusCode: 400 });
  const signature = createLineupSignature(comp);
  const before = (await runtime.cacheStore?.listCompProfileBindings?.({
    seasonContextId: seasonContext.id,
    profileKey,
    provider: seasonContext.source.provider
  }) ?? [])[0] ?? null;
  const binding = await runtime.compEnrichmentService.bindProfile({
    seasonContextId: seasonContext.id,
    profileKey,
    provider: seasonContext.source.provider,
    clusterId,
    lineupSignature: signature,
    strategyOverride: body?.strategyOverride,
    matchConfidence: 1,
    matchStatus: "verified"
  });
  await recordAdminAudit(runtime, seasonContext.id, before ? "rebind" : "bind", "comp_profile_binding", profileKey, before, binding);
  return {
    ok: true,
    binding,
    preview: await runtime.compEnrichmentService.enrichComp(comp, {
      seasonContextId: seasonContext.id,
      provider: seasonContext.source.provider
    })
  };
}

export async function handleAdminCompProfileImport(body, runtime) {
  const seasonContext = resolveAdminSeasonContext(runtime, body?.seasonContextId);
  const values = Array.isArray(body?.profiles) ? body.profiles : [];
  if (!values.length || values.length > 500) {
    throw Object.assign(new Error("profiles 必须是 1 到 500 条记录的数组"), { statusCode: 400 });
  }
  const normalized = values.map((value) => normalizeCompProfileRecord({
    ...value,
    seasonContextId: seasonContext.id,
    source: "admin_import"
  }));
  const profiles = [];
  for (const profile of normalized) profiles.push(await runtime.compEnrichmentService.saveProfile(profile));
  await recordAdminAudit(runtime, seasonContext.id, "import", "comp_profile", null, null, {
    count: profiles.length,
    profileKeys: profiles.map((profile) => profile.profileKey)
  });
  return { ok: true, imported: profiles.length, profiles };
}

export async function handleAdminCompProfileExport(runtime, options = {}) {
  const seasonContext = resolveAdminSeasonContext(runtime, options.seasonContextId);
  const effective = await runtime.compEnrichmentService.effectiveProfiles(seasonContext.id);
  const overrides = await runtime.cacheStore?.listCompProfiles?.({ seasonContextId: seasonContext.id }) ?? [];
  const bindings = await runtime.cacheStore?.listCompProfileBindings?.({ seasonContextId: seasonContext.id }) ?? [];
  return {
    ok: true,
    schemaVersion: options.backup ? "comp-profile-backup.v1" : "comp-profile-export.v1",
    seasonContextId: seasonContext.id,
    exportedAt: new Date().toISOString(),
    profiles: options.backup ? overrides : [...effective.values()],
    ...(options.backup ? { bindings } : {})
  };
}

async function handleSessionClear(runtime, body = {}, scope = null) {
  const conversationId = String(body?.conversationId ?? body?.conversation_id ?? "").trim();
  const key = conversationId ? `last_query:${conversationId}` : SESSION_LAST_QUERY_KEY;
  await runtime.cacheStore?.deleteSessionState?.(scope ? anonymousScopeKey(scope, key) : key, {
    seasonContextId: body?.seasonContextId
  });
  return {
    ok: true
  };
}

export async function handleRuntimeStatusRequest(runtime) {
  return {
    ok: true,
    runtime: getSmallWindowRuntimeStatus(runtime)
  };
}

export async function handleItemCatalogAuditRequest(runtime, options = {}) {
  const seasonContext = runtime.seasonContextService.resolve(options.seasonContextId, {
    requireVisible: false,
    requireSelectable: false,
    requireAvailable: true
  });
  const preferences = {
    ...completeSmallWindowPreferences(await loadSmallWindowPreferences(runtime)),
    seasonContextId: seasonContext.id,
    providerVersion: seasonContext.source.providerVersion,
    effectivePatch: seasonContext.effectivePatch,
    patch: seasonContext.effectivePatch,
    queue: seasonContext.source.queue
  };
  if (options.refresh) {
    invalidateRuntimeCatalog(runtime, runtimeCatalogKey(preferences));
    if (runtime.officialItemDetailsPromise) {
      try {
        await runtime.officialItemDetailsPromise;
      } catch {
        // A failed in-flight load must not prevent an explicit refresh attempt.
      }
    }
    runtime.officialItemDetails = null;
    runtime.officialItemDetailsLoadedAt = null;
  }
  const entry = await loadRuntimeCatalog(runtime, preferences);
  const detailsWereCached = Boolean(runtime.officialItemDetails);
  let details = new Map();
  let detailsState = {
    status: "fresh",
    cache: detailsWereCached ? "memory" : "loaded",
    source: runtime.officialItemDetailsUrl ?? "tencent_official_tft_catalog",
    updatedAt: runtime.officialItemDetailsLoadedAt ?? null
  };
  try {
    details = await loadOfficialItemDetails(runtime);
    detailsState.updatedAt = runtime.officialItemDetailsLoadedAt ?? null;
  } catch (error) {
    detailsState = {
      status: "error",
      cache: "unavailable",
      source: runtime.officialItemDetailsUrl ?? "tencent_official_tft_catalog",
      error: error.message
    };
  }
  const itemMemory = entry.itemCatalogMemory ?? {};
  const catalogSource = itemMemory.source ?? (runtime.catalog ? "injected" : "seed");
  const catalogStatus = catalogSource === "remote" || catalogSource === "injected"
    ? "fresh"
    : catalogSource === "persistent"
      ? "fallback"
      : "fallback";
  const report = buildItemCatalogAudit(entry.catalog, details, {
    patch: preferences.patch ?? "current",
    catalogState: {
      status: catalogStatus,
      source: catalogSource,
      updatedAt: itemMemory.updatedAt ?? null,
      warning: entry.warning ?? null
    },
    detailsState
  });
  const records = filterItemCatalogAudit(report.records, options);
  const payload = {
    ok: true,
    seasonContext: runtime.seasonContextService.publicRecord(seasonContext),
    report: {
      ...report,
      records
    },
    filters: options,
    summary: {
      total: report.records.length,
      returned: records.length,
      withIssues: records.filter((record) => record.issues.length > 0).length
    }
  };
  if (options.format === "csv") {
    payload.export = {
      format: "csv",
      filename: `tft-item-catalog-audit-${report.patch}.csv`,
      content: itemCatalogAuditToCsv(records)
    };
  } else if (options.format === "json") {
    payload.export = {
      format: "json",
      filename: `tft-item-catalog-audit-${report.patch}.json`,
      content: JSON.stringify({ ...report, records }, null, 2)
    };
  }
  return payload;
}

function applySecurityHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "content-security-policy",
    "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
}

function enforceSameOrigin(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
  const origin = String(req.headers.origin ?? "").trim();
  if (!origin) return;
  const expected = `http://${req.headers.host ?? "localhost"}`;
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const publicExpected = forwardedProto ? `${forwardedProto}://${req.headers.host ?? "localhost"}` : expected;
  if (origin !== expected && origin !== publicExpected) {
    throw Object.assign(new Error("Cross-origin request rejected"), { statusCode: 403 });
  }
}

function isPublicMaintenanceRoute(pathname) {
  return pathname === "/api/entity-memory/clear"
    || pathname.startsWith("/api/entity-aliases")
    || pathname === "/api/item-catalog-audit";
}

function isLegacyAdminWriteRoute(method, pathname) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method)
    && new Set([
      "/api/entity-memory/clear",
      "/api/entity-aliases/review",
      "/api/entity-aliases/review-batch"
    ]).has(pathname);
}

function hasValidAdminToken(req, runtime) {
  const configured = String(runtime.adminToken ?? "");
  const authorization = String(req.headers.authorization ?? "");
  let provided = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!provided && authorization.startsWith("Basic ")) {
    try {
      const credentials = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
      provided = credentials.slice(credentials.indexOf(":") + 1);
    } catch {
      provided = "";
    }
  }
  const configuredBuffer = Buffer.from(configured);
  const providedBuffer = Buffer.from(provided);
  return configuredBuffer.length > 0
    && configuredBuffer.length === providedBuffer.length
    && timingSafeEqual(configuredBuffer, providedBuffer);
}

export function createSmallWindowHandler(options = {}) {
  const runtime = options.runtime ?? createSmallWindowRuntime(options);
  const accessService = options.accessService
    ?? runtime.accessService
    ?? createAnonymousAccessService(runtime, { enabled: false }, {});

  return async function smallWindowHandler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    applySecurityHeaders(res);

    try {
      if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, {
          ok: true
        });
      }

      enforceSameOrigin(req);
      const visitor = accessService.identify(req, res);
      if (url.pathname.startsWith("/api/") && url.pathname !== "/api/access") {
        accessService.enforceRequestRate(visitor);
      }

      if (req.method === "GET" && url.pathname === "/api/access") {
        return sendJson(res, 200, {
          ok: true,
          access: accessService.publicStatus(visitor)
        });
      }

      if (url.pathname.startsWith("/api/admin/") && !hasValidAdminToken(req, runtime)) {
        if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
          return sendJson(res, 403, { ok: false, error: "Administrator authorization required" });
        }
        return sendJson(res, 404, { ok: false, error: "Not found" });
      }

      if ((url.pathname === "/admin" || url.pathname === "/admin/") && !hasValidAdminToken(req, runtime)) {
        res.setHeader("www-authenticate", 'Basic realm="TFTClarity Admin", charset="UTF-8"');
        return sendJson(res, 401, { ok: false, error: "Administrator authentication required" });
      }

      if (accessService.config.enabled && isPublicMaintenanceRoute(url.pathname)) {
        return sendJson(res, 404, { ok: false, error: "Not found" });
      }

      if (isLegacyAdminWriteRoute(req.method, url.pathname) && !hasValidAdminToken(req, runtime)) {
        return sendJson(res, 403, { ok: false, error: "Administrator authorization required" });
      }

      if (req.method === "GET" && url.pathname === "/api/runtime") {
        const payload = await handleRuntimeStatusRequest(runtime);
        payload.runtime.publicMode = accessService.config.enabled;
        payload.access = accessService.publicStatus(visitor);
        return sendJson(res, 200, payload);
      }

      if (req.method === "GET" && url.pathname === "/api/item-catalog-audit") {
        return sendJson(res, 200, await handleItemCatalogAuditRequest(runtime, {
          query: url.searchParams.get("query") ?? undefined,
          patch: url.searchParams.get("patch") ?? undefined,
          category: url.searchParams.get("category") ?? undefined,
          source: url.searchParams.get("source") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          availability: url.searchParams.get("availability") ?? undefined,
          issues: url.searchParams.get("issues") ?? undefined,
          format: url.searchParams.get("format") ?? undefined,
          refresh: url.searchParams.get("refresh") === "1"
        }));
      }

      if (req.method === "GET" && url.pathname === "/api/entity-catalog") {
        return sendJson(res, 200, await handleEntityCatalogRequest(runtime, {
          entityType: url.searchParams.get("type"),
          query: url.searchParams.get("query") ?? undefined,
          cost: url.searchParams.get("cost") ?? undefined,
          role: url.searchParams.get("role") ?? undefined,
          trait: url.searchParams.get("trait") ?? undefined,
          traitType: url.searchParams.get("traitType") ?? undefined,
          page: url.searchParams.get("page") ?? undefined,
          limit: url.searchParams.get("limit") ?? undefined,
          seasonContextId: url.searchParams.get("seasonContextId") ?? undefined,
          refresh: url.searchParams.get("refresh") === "1"
        }));
      }

      if (req.method === "GET" && url.pathname === "/api/entity-details") {
        return sendJson(res, 200, await handleEntityDetailRequest(runtime, {
          entityType: url.searchParams.get("type"),
          apiName: url.searchParams.get("id"),
          seasonContextId: url.searchParams.get("seasonContextId") ?? undefined,
          refresh: url.searchParams.get("refresh") === "1"
        }));
      }

      if (req.method === "POST" && url.pathname === "/api/recommend") {
        const body = await readJsonRequest(req);
        const controller = new AbortController();
        const abortRequest = () => controller.abort(new Error("HTTP client disconnected"));
        req.once("aborted", abortRequest);
        res.once("close", () => {
          if (!res.writableEnded) abortRequest();
        });
        const { statusCode, payload } = await handleRecommendRequest(body, runtime, {
          visitor,
          accessService,
          signal: controller.signal
        });
        return sendJson(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/recommend/stream") {
        const body = await readJsonRequest(req);
        const controller = new AbortController();
        const abortRequest = () => controller.abort(new Error("HTTP client disconnected"));
        req.once("aborted", abortRequest);
        res.once("close", () => {
          if (!res.writableEnded) abortRequest();
        });
        return streamRecommendResponse(req, res, body, runtime, {
          visitor,
          accessService,
          signal: controller.signal
        });
      }

      if (req.method === "GET" && url.pathname === "/api/comp-details") {
        return sendJson(res, 200, await handleCompDetailRequest({
          compId: url.searchParams.get("comp"),
          clusterId: url.searchParams.get("clusterId"),
          units: url.searchParams.get("units"),
          seasonContextId: url.searchParams.get("seasonContextId")
        }, runtime));
      }

      if (req.method === "GET" && url.pathname === "/api/season-contexts") {
        return sendJson(res, 200, {
          ok: true,
          defaultSeasonContextId: runtime.seasonContextService.defaultContextId,
          seasonContexts: runtime.seasonContextService.listPublic()
        });
      }

      if (req.method === "POST" && url.pathname === "/api/season-contexts/select") {
        const body = await readJsonRequest(req);
        const selected = runtime.seasonContextService.resolveForQuery(body?.seasonContextId);
        return sendJson(res, 200, {
          ok: true,
          seasonContext: runtime.seasonContextService.publicRecord(selected)
        });
      }

      if (req.method === "GET" && url.pathname === "/api/conclusion/status") {
        const { statusCode, payload } = handleConclusionStatusRequest(
          runtime,
          url.searchParams.get("jobId"),
          visitor.scope,
          url.searchParams.get("token")
        );
        return sendJson(res, statusCode, payload);
      }

      if (req.method === "GET" && url.pathname === "/api/conclusion/stream") {
        return streamConclusionResponse(
          req,
          res,
          runtime,
          url.searchParams.get("jobId"),
          visitor.scope,
          url.searchParams.get("token")
        );
      }

      if (req.method === "GET" && url.pathname === "/api/preferences") {
        return sendJson(res, 200, {
          ok: true,
          preferences: await loadSmallWindowPreferences(runtime, visitor.scope)
        });
      }

      if (req.method === "POST" && url.pathname === "/api/preferences") {
        const body = await readJsonRequest(req);
        return sendJson(res, 200, await handlePreferencesRequest(body, runtime, visitor.scope));
      }

      if (req.method === "DELETE" && url.pathname === "/api/preferences") {
        return sendJson(res, 200, await handlePreferencesResetRequest(runtime, visitor.scope));
      }

      if (req.method === "POST" && url.pathname === "/api/cache/clear") {
        if (accessService.config.enabled) {
          return sendJson(res, 200, {
            ok: true,
            cleared: {
              queryCache: 0,
              defaultContextCache: 0,
              sessionState: 0,
              catalogCache: 0,
              compDetailCache: 0,
              augmentLookupCache: 0
            }
          });
        }
        return sendJson(res, 200, await handleCacheClearRequest(runtime));
      }

      if (req.method === "POST" && url.pathname === "/api/feedback") {
        const body = await readJsonRequest(req);
        accessService.enforceFeedbackRate(visitor);
        return sendJson(res, 200, await handleFeedbackRequest(body, runtime, {
          visitor,
          accessService
        }));
      }

      if (req.method === "GET" && url.pathname === "/api/admin/feedback/stats") {
        return sendJson(res, 200, await handleFeedbackStatsRequest(runtime, {
          days: url.searchParams.get("days")
        }));
      }

      if (req.method === "GET" && url.pathname === "/api/admin/seasons") {
        return sendJson(res, 200, handleAdminSeasonContexts(runtime));
      }

      if (req.method === "GET" && url.pathname === "/api/admin/comp-profiles") {
        return sendJson(res, 200, await handleAdminCompProfiles(runtime, {
          seasonContextId: url.searchParams.get("seasonContextId")
        }));
      }

      if (req.method === "POST" && url.pathname === "/api/admin/comp-profiles") {
        return sendJson(res, 200, await handleAdminCompProfileSave(await readJsonRequest(req), runtime));
      }

      const adminProfileMatch = url.pathname.match(/^\/api\/admin\/comp-profiles\/([a-z0-9][a-z0-9_-]{1,79})$/u);
      if (adminProfileMatch && req.method === "PATCH") {
        return sendJson(res, 200, await handleAdminCompProfileSave(await readJsonRequest(req), runtime, {
          profileKey: adminProfileMatch[1]
        }));
      }
      if (adminProfileMatch && req.method === "DELETE") {
        return sendJson(res, 200, await handleAdminCompProfileDelete(
          adminProfileMatch[1],
          url.searchParams.get("seasonContextId"),
          runtime
        ));
      }

      if (req.method === "GET" && url.pathname === "/api/admin/comp-profiles/current-comps") {
        return sendJson(res, 200, await handleAdminCurrentComps(runtime, {
          seasonContextId: url.searchParams.get("seasonContextId"),
          matchStatus: url.searchParams.get("matchStatus") ?? undefined,
          refresh: url.searchParams.get("refresh") === "1"
        }));
      }

      if (req.method === "POST" && url.pathname === "/api/admin/comp-profiles/bind") {
        return sendJson(res, 200, await handleAdminCompProfileBind(await readJsonRequest(req), runtime));
      }

      if (req.method === "POST" && url.pathname === "/api/admin/comp-profiles/import") {
        return sendJson(res, 200, await handleAdminCompProfileImport(await readJsonRequest(req), runtime));
      }

      if (req.method === "GET" && ["/api/admin/comp-profiles/export", "/api/admin/comp-profiles/backup"].includes(url.pathname)) {
        return sendJson(res, 200, await handleAdminCompProfileExport(runtime, {
          seasonContextId: url.searchParams.get("seasonContextId"),
          backup: url.pathname.endsWith("/backup")
        }));
      }

      if (req.method === "GET" && url.pathname === "/api/admin/aliases") {
        resolveAdminSeasonContext(runtime, url.searchParams.get("seasonContextId"));
        return sendJson(res, 200, await handleEntityAliasesRequest(runtime, {
          seasonContextId: url.searchParams.get("seasonContextId"),
          entityType: url.searchParams.get("entityType") ?? undefined,
          source: url.searchParams.get("source") ?? undefined,
          enabled: url.searchParams.has("enabled") ? url.searchParams.get("enabled") === "true" : undefined,
          query: url.searchParams.get("query") ?? undefined,
          offset: url.searchParams.get("offset"),
          limit: url.searchParams.get("limit")
        }));
      }

      if (req.method === "POST" && url.pathname === "/api/admin/aliases") {
        return sendJson(res, 200, await handleAdminAliasCreate(await readJsonRequest(req), runtime));
      }

      const adminAliasMatch = url.pathname.match(/^\/api\/admin\/aliases\/(\d+)$/u);
      if (adminAliasMatch && req.method === "PATCH") {
        return sendJson(res, 200, await handleAdminAliasUpdate(
          Number(adminAliasMatch[1]),
          await readJsonRequest(req),
          runtime
        ));
      }
      if (adminAliasMatch && req.method === "DELETE") {
        return sendJson(res, 200, await handleAdminAliasDelete(
          Number(adminAliasMatch[1]),
          url.searchParams.get("seasonContextId"),
          runtime
        ));
      }

      if (req.method === "POST" && url.pathname === "/api/admin/aliases/match") {
        return sendJson(res, 200, await handleAdminAliasMatch(await readJsonRequest(req), runtime));
      }

      if (req.method === "POST" && url.pathname === "/api/admin/aliases/import") {
        return sendJson(res, 200, await handleAdminAliasImport(await readJsonRequest(req), runtime));
      }

      if (req.method === "POST" && url.pathname === "/api/admin/aliases/review-batch") {
        return sendJson(res, 200, await handleAdminAliasBatchReview(await readJsonRequest(req), runtime));
      }

      if (req.method === "GET" && url.pathname === "/api/admin/aliases/export") {
        return sendJson(res, 200, await handleAdminAliasExport(runtime, {
          seasonContextId: url.searchParams.get("seasonContextId")
        }));
      }

      if (req.method === "GET" && url.pathname === "/api/admin/aliases/backup") {
        return sendJson(res, 200, await handleAdminAliasBackup(runtime, {
          seasonContextId: url.searchParams.get("seasonContextId")
        }));
      }

      if (req.method === "GET" && url.pathname === "/api/admin/audit") {
        return sendJson(res, 200, await handleAdminAuditRequest(runtime, {
          seasonContextId: url.searchParams.get("seasonContextId"),
          limit: Number(url.searchParams.get("limit") ?? 100)
        }));
      }

      if (req.method === "POST" && url.pathname === "/api/admin/cache/clear") {
        const body = await readJsonRequest(req);
        const seasonContext = resolveAdminSeasonContext(runtime, body?.seasonContextId);
        const cleared = await runtime.cacheStore?.clearQueryHistory?.({ seasonContextId: seasonContext.id }) ?? {};
        const catalogCache = invalidateRuntimeCatalog(runtime);
        await recordAdminAudit(runtime, seasonContext.id, "clear", "cache", null, null, {
          ...cleared,
          catalogCache
        });
        return sendJson(res, 200, { ok: true, cleared: { ...cleared, catalogCache } });
      }

      if (req.method === "GET" && url.pathname === "/api/admin/item-catalog-audit") {
        return sendJson(res, 200, await handleItemCatalogAuditRequest(runtime, {
          seasonContextId: url.searchParams.get("seasonContextId"),
          query: url.searchParams.get("query") ?? undefined,
          category: url.searchParams.get("category") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          refresh: url.searchParams.get("refresh") === "1"
        }));
      }

      if (req.method === "POST" && url.pathname === "/api/entity-memory/clear") {
        const body = await readJsonRequest(req);
        return sendJson(res, 200, await handleEntityMemoryClearRequest(runtime, {
          seasonContextId: body?.seasonContextId
        }));
      }

      if (req.method === "GET" && url.pathname === "/api/entity-aliases") {
        const enabled = url.searchParams.has("enabled")
          ? url.searchParams.get("enabled") === "true"
          : undefined;
        return sendJson(res, 200, await handleEntityAliasesRequest(runtime, {
          enabled,
          entityType: url.searchParams.get("entityType") ?? undefined,
          apiName: url.searchParams.get("apiName") ?? undefined,
          query: url.searchParams.get("query") ?? undefined,
          offset: Number(url.searchParams.get("offset") ?? 0),
          limit: Number(url.searchParams.get("limit") ?? 100)
        }));
      }

      if (req.method === "GET" && url.pathname === "/api/entity-aliases/export") {
        const enabled = url.searchParams.has("enabled")
          ? url.searchParams.get("enabled") === "true"
          : undefined;
        return sendJson(res, 200, await handleEntityAliasExportRequest(runtime, {
          enabled,
          entityType: url.searchParams.get("entityType") ?? undefined,
          apiName: url.searchParams.get("apiName") ?? undefined,
          includeDisabled: url.searchParams.get("includeDisabled") !== "false",
          limit: Number(url.searchParams.get("limit") ?? 1000)
        }));
      }

      if (req.method === "POST" && url.pathname === "/api/entity-aliases/review") {
        const body = await readJsonRequest(req);
        const reviewed = await handleAdminAliasBatchReview({
          seasonContextId: body?.seasonContextId,
          ids: [body?.id],
          enabled: body?.enabled
        }, runtime);
        return sendJson(res, 200, { ...reviewed, alias: reviewed.aliases[0] ?? null });
      }

      if (req.method === "POST" && url.pathname === "/api/entity-aliases/review-batch") {
        const body = await readJsonRequest(req);
        return sendJson(res, 200, await handleAdminAliasBatchReview(body, runtime));
      }

      if (req.method === "POST" && url.pathname === "/api/session/clear") {
        const body = await readJsonRequest(req);
        return sendJson(res, 200, await handleSessionClear(runtime, body, visitor.scope));
      }

      if (req.method !== "GET") {
        return sendJson(res, 405, {
          ok: false,
          error: "Method not allowed"
        });
      }

      const staticPath = safeStaticPath(url.pathname);
      if (!staticPath) {
        return sendJson(res, 404, {
          ok: false,
          error: "Not found"
        });
      }

      const file = await readFile(staticPath);
      const type = CONTENT_TYPES.get(extname(staticPath)) ?? "application/octet-stream";
      res.writeHead(200, {
        "content-type": type,
        "content-length": file.length
      });
      return res.end(file);
    } catch (error) {
      if (error.code === "ENOENT") {
        return sendJson(res, 404, {
          ok: false,
          error: "Not found"
        });
      }

      return sendJson(res, error.statusCode ?? 500, {
        ok: false,
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.publicRun ? { run: error.publicRun } : {}),
        ...(error.seasonContextId ? { seasonContextId: error.seasonContextId } : {}),
        ...(error.contextStatus ? { status: error.contextStatus } : {})
      });
    }
  };
}

export function createSmallWindowServer(options = {}) {
  return createServer(createSmallWindowHandler(options));
}

function parseCliOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--host" && args[index + 1]) {
      options.host = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
    } else if (arg === "--port" && args[index + 1]) {
      options.port = Number(args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--port=")) {
      options.port = Number(arg.slice("--port=".length));
    } else if (arg === "--cache-store" && args[index + 1]) {
      options.cacheStoreType = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--cache-store=")) {
      options.cacheStoreType = arg.slice("--cache-store=".length);
    } else if (arg === "--cache-path" && args[index + 1]) {
      options.cachePath = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--cache-path=")) {
      options.cachePath = arg.slice("--cache-path=".length);
    } else if (arg === "--explorer-timeout-ms" && args[index + 1]) {
      options.explorerTimeoutMs = Number(args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--explorer-timeout-ms=")) {
      options.explorerTimeoutMs = Number(arg.slice("--explorer-timeout-ms=".length));
    } else if (arg === "--catalog-timeout-ms" && args[index + 1]) {
      options.catalogTimeoutMs = Number(args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--catalog-timeout-ms=")) {
      options.catalogTimeoutMs = Number(arg.slice("--catalog-timeout-ms=".length));
    } else if (arg === "--comps-timeout-ms" && args[index + 1]) {
      options.compsTimeoutMs = Number(args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--comps-timeout-ms=")) {
      options.compsTimeoutMs = Number(arg.slice("--comps-timeout-ms=".length));
    } else if (arg === "--comp-rankings-timeout-ms" && args[index + 1]) {
      options.compRankingsTimeoutMs = Number(args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--comp-rankings-timeout-ms=")) {
      options.compRankingsTimeoutMs = Number(arg.slice("--comp-rankings-timeout-ms=".length));
    } else if (arg === "--llm-provider" && args[index + 1]) {
      options.llmProvider = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--llm-provider=")) {
      options.llmProvider = arg.slice("--llm-provider=".length);
    } else if (arg === "--llm-endpoint" && args[index + 1]) {
      options.llmEndpoint = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--llm-endpoint=")) {
      options.llmEndpoint = arg.slice("--llm-endpoint=".length);
    } else if (arg === "--llm-model" && args[index + 1]) {
      options.llmModel = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--llm-model=")) {
      options.llmModel = arg.slice("--llm-model=".length);
    } else if (arg === "--llm-timeout-ms" && args[index + 1]) {
      options.llmTimeoutMs = Number(args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--llm-timeout-ms=")) {
      options.llmTimeoutMs = Number(arg.slice("--llm-timeout-ms=".length));
    } else if (arg === "--llm-mode" && args[index + 1]) {
      options.llmMode = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--llm-mode=")) {
      options.llmMode = arg.slice("--llm-mode=".length);
    }
  }
  return options;
}

function listen(server, host, port) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off("listening", onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen(server.address());
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export async function startSmallWindowServer(options = {}) {
  const host = options.host ?? process.env.HOST ?? DEFAULT_HOST;
  const firstPort = Number(options.port ?? process.env.PORT ?? DEFAULT_PORT);
  const attempts = options.port ? 1 : 10;
  const runtime = options.runtime ?? await createSmallWindowRuntimeAsync(options);

  for (let offset = 0; offset < attempts; offset += 1) {
    const port = firstPort + offset;
    const server = createSmallWindowServer({
      ...options,
      runtime
    });
    try {
      const address = await listen(server, host, port);
      const catalogPrewarm = options.prewarmCatalog === false
        ? Promise.resolve({ ok: true, skipped: true, disabled: true })
        : prewarmSmallWindowCatalog(runtime).catch((error) => ({
          ok: false,
          skipped: false,
          error: error.message
        }));
      runtime.catalogPrewarm = catalogPrewarm;
      return {
        server,
        runtime,
        host,
        port: address.port,
        url: `http://${host}:${address.port}/`,
        catalogPrewarm
      };
    } catch (error) {
      if (error.code !== "EADDRINUSE" || offset === attempts - 1) throw error;
    }
  }

  throw new Error("Unable to start small window server");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadLocalEnvironment();
  const cliOptions = parseCliOptions(process.argv.slice(2));
  startSmallWindowServer({
    conversationStateV2Mode: process.env.TFT_AGENT_CONVERSATION_STATE_V2_MODE ?? "on",
    ...cliOptions
  })
    .then(({ url }) => {
      console.log(`tftclarity small window: ${url}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
