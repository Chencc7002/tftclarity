import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnvironment } from "../config/load-env.js";
import {
  CompsContextClient,
  CURRENT_ITEM_LOCALIZATION,
  DEFAULT_QUERY_OPTIONS,
  JsonFileCacheStore,
  MetaTFTClient,
  SESSION_LAST_QUERY_KEY,
  SQLiteCacheStore,
  applyEnabledEntityAliasesFromStore,
  buildEntityAliasOverrideDraft,
  buildItemCatalogAudit,
  buildItemCatalogFromItemsResponse,
  buildTraitCatalogFromCompsData,
  buildTraitCatalogFromExplorerRows,
  buildUnitCatalogFromCompsData,
  buildUnitCatalogFromExplorerRows,
  createCatalog,
  createAssetResolver,
  createStructuredParserFromConfig,
  fetchOfficialTftItemDetails,
  filterItemCatalogAudit,
  hasUnsupportedCompRankingEntities,
  mergeCatalogTraits,
  mergeCatalogUnits,
  isLowSampleBuild,
  itemCatalogAuditToCsv,
  parseQuery,
  recommendForInput,
  resolveStructuredParserConfig
} from "../index.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17317;
export const DEFAULT_SMALL_WINDOW_REQUEST_TIMEOUT_MS = 2200;
export const DEFAULT_COMP_RANKINGS_TIMEOUT_MS = 8000;
const DEFAULT_JSON_CACHE_PATH = resolve(process.cwd(), ".cache", "small-window-cache.json");
const DEFAULT_SQLITE_CACHE_PATH = resolve(process.cwd(), ".cache", "small-window-cache.sqlite");
const PUBLIC_DIR = fileURLToPath(new URL("./small-window-ui/", import.meta.url));
const ASSET_RESOLVER = createAssetResolver();
const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"]
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
const VALID_STRUCTURED_PARSER_MODES = new Set([
  "inherit",
  "auto",
  "never",
  "always"
]);
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
  "missing_result",
  "general"
]);
export const SMALL_WINDOW_PREFERENCES_KEY = "small_window";
export const DEFAULT_SMALL_WINDOW_PREFERENCES = {
  minSamples: DEFAULT_QUERY_OPTIONS.minSamples,
  itemPolicy: DEFAULT_QUERY_OPTIONS.itemPolicy,
  sort: DEFAULT_QUERY_OPTIONS.sort,
  days: DEFAULT_QUERY_OPTIONS.days,
  rankFilter: DEFAULT_QUERY_OPTIONS.rankFilter,
  structuredParserMode: "inherit"
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
    requests: {
      explorerTimeoutMs: runtime.requestTimeouts?.explorerTimeoutMs ?? null,
      catalogTimeoutMs: runtime.requestTimeouts?.catalogTimeoutMs ?? null,
      compsTimeoutMs: runtime.requestTimeouts?.compsTimeoutMs ?? null,
      compRankingsTimeoutMs: runtime.requestTimeouts?.compRankingsTimeoutMs ?? null
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

async function readJsonRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

function safeStaticPath(pathname) {
  const name = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
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
  if (parsed?.intent !== "comp_rankings" || !hasUnsupportedCompRankingEntities(parsed)) return null;
  if (parsed.parser?.genericEmblemRequested) {
    const question = "请指定要加入的具体纹章或羁绊，例如“观星者纹章”。";
    return {
      ok: true,
      type: "clarification",
      text: question,
      answer: { summary: question },
      query: { intent: "clarification", requestedIntent: "comp_rankings", warnings: [] },
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
      requestedIntent: "comp_rankings",
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
      : result.plan?.path ?? (result.type === "comp_rankings"
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

export async function loadSmallWindowPreferences(runtime) {
  return completeSmallWindowPreferences(await loadStoredSmallWindowPreferences(runtime));
}

async function loadStoredSmallWindowPreferences(runtime) {
  const entry = await runtime.cacheStore?.getUserPreference?.(SMALL_WINDOW_PREFERENCES_KEY);
  return preferenceOverrides(entry?.value);
}

export async function saveSmallWindowPreferences(runtime, value = {}) {
  const current = await loadStoredSmallWindowPreferences(runtime);
  const nextOverrides = preferenceOverrides({
    ...current,
    ...normalizeSmallWindowPreferences(value)
  });
  await runtime.cacheStore?.setUserPreference?.(SMALL_WINDOW_PREFERENCES_KEY, nextOverrides);
  return completeSmallWindowPreferences(nextOverrides);
}

export async function resetSmallWindowPreferences(runtime) {
  await runtime.cacheStore?.deleteUserPreference?.(SMALL_WINDOW_PREFERENCES_KEY);
  return completeSmallWindowPreferences();
}

function serializeRecommendation(result, catalog, meta = {}) {
  const { itemDetails, ...publicMeta } = meta;
  if (result.type === "comp_rankings") {
    return serializeCompRankings(result, publicMeta);
  }
  const query = result.query ?? {};
  if (result.type === "unit_item_rankings") {
    const itemRankings = (result.itemRankings ?? []).map((entry) => serializeItemRanking(entry, catalog));
    const references = (result.itemRankingReferences ?? []).slice(0, 5).map((entry) => serializeItemRanking(entry, catalog));
    const best = itemRankings[0] ?? null;
    return {
      ok: true,
      type: "unit_item_rankings",
      text: result.text,
      unit: query.unit ? {
        apiName: query.unit,
        name: unitName(query.unit, catalog),
        iconUrl: ASSET_RESOLVER.resolveUnit(query.unit).iconUrl
      } : null,
      answer: {
        summary: best
          ? `${compAnswerPrefix(query.comp)}${best.name}在当前条件的单装备聚合中排名第一。`
          : `${compAnswerPrefix(query.comp)}${result.text}`,
        evidence: best?.stats ?? null,
        warnings: query.warnings ?? [],
        methodology: "按合法完整三件套是否包含该装备聚合；重复件只计一次组合样本"
      },
      itemRankings,
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
          ? (hasLockedItems ? "推荐补齐" : "推荐")
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
  const commonItemApiNames = cards.length > 1
    ? [...new Set(cards[0].items.map((item) => item.apiName))].filter((apiName) => (
      cards.every((card) => card.items.some((item) => item.apiName === apiName))
    ))
    : [];
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
      warnings: query.warnings ?? []
    },
    unit: query.unit ? {
      apiName: query.unit,
      name: unitName(query.unit, catalog),
      iconUrl: ASSET_RESOLVER.resolveUnit(query.unit).iconUrl
    } : null,
    cards,
    commonCore: commonItemApiNames.map((apiName) => ({
      apiName,
      name: itemName(apiName, catalog),
      iconUrl: ASSET_RESOLVER.resolveItem(apiName).iconUrl
    })),
    comparison: serializedComparison,
    results: serializedComparison?.entries ?? [],
    overlap: serializedComparison?.overlap ?? null,
    lockedItems: lockedItemApiNames.map((apiName) => ({
      apiName,
      name: itemName(apiName, catalog)
    })),
    decision: serializedComparison?.decision ?? result.localDecision ?? null,
    clarification: result.clarification ?? null,
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
      units: (comp.units ?? []).map((unit) => ({
        apiName: unit.apiName,
        name: unit.name,
        iconUrl: unit.iconUrl ?? null,
        assetFallback: Boolean(unit.assetFallback),
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
        avgPlacement: Number.isFinite(comp.stats?.avgPlacement) ? comp.stats.avgPlacement : null,
        pickRate: Number.isFinite(comp.stats?.pickRate) ? comp.stats.pickRate : null
      },
      source: comp.source
    });
  const rankings = {};
  for (const [metric, comps] of Object.entries(result.rankings ?? {})) {
    rankings[metric] = (comps ?? []).map(serializeComp);
  }
  return {
    ok: true,
    type: "comp_rankings",
    rankings,
    references: (result.references ?? []).map(serializeComp),
    query: result.query,
    source: result.source,
    warnings: result.warnings ?? [],
    cache: result.cache ?? null,
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

  return {
    metaTFTClient,
    catalogMetaTFTClient,
    compsClient,
    cacheStore,
    cacheStoreInfo,
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
    fetchItems: options.fetchItems ?? true,
    compsData: options.compsData ?? null,
    defaultContextOptions: options.defaultContextOptions ?? {},
    structuredParser: options.structuredParser ?? null,
    useStructuredParser: options.useStructuredParser ?? "auto",
    structuredParserConfig: options.structuredParserConfig ?? null,
    recommendForInputImpl: options.recommendForInputImpl ?? recommendForInput
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
  const requestTimeouts = resolveSmallWindowRequestTimeouts(options, env);
  const runtimeOptions = {
    ...options,
    ...requestTimeouts,
    ...structuredParserRuntime
  };

  if (options.cacheStore) return createSmallWindowRuntime(runtimeOptions);

  const { type, cachePath } = resolveSmallWindowCacheOptions(options, env);
  if (type !== "sqlite") {
    return createSmallWindowRuntime({
      ...runtimeOptions,
      cachePath,
      cacheStoreInfo: {
        type,
        cachePath,
        persistent: true
      }
    });
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

  return createSmallWindowRuntime({
    ...runtimeOptions,
    cacheStore,
    cacheStoreInfo: {
      type,
      cachePath,
      persistent: true
    }
  });
}

function runtimeCatalogKey(preferences = {}) {
  return `${preferences.patch ?? "current"}:${preferences.queue ?? "1100"}`;
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
  const applyAliasMemory = async (catalog, entry = {}) => {
    const aliasMemory = await applyEnabledEntityAliasesFromStore(catalog, runtime.cacheStore);
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
        runtime.cacheStore?.getItemCatalog?.(patch) ?? null,
        runtime.cacheStore?.getDomainCatalog?.(patch) ?? null
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
            const saved = await runtime.cacheStore?.setItemCatalog?.(patch, generatedItems);
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
          });
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

export async function handleRecommendRequest(body, runtime) {
  const startedAt = Date.now();
  const input = String(body?.input ?? "").trim();
  const conversationId = String(body?.conversationId ?? body?.conversation_id ?? "").trim() || "default";
  if (!input) {
    return {
      statusCode: 400,
      payload: {
        ok: false,
        error: "请输入查询内容"
      }
    };
  }

  const storedPreferences = await loadStoredSmallWindowPreferences(runtime);
  const explicitPreferences = preferenceOverrides({
    ...storedPreferences,
    ...normalizeSmallWindowPreferences(body.preferences)
  });
  const preferences = completeSmallWindowPreferences(explicitPreferences);
  if (body.refresh) {
    invalidateRuntimeCatalog(runtime, runtimeCatalogKey(preferences));
  }
  const { catalog, warning, compsData, aliasMemory } = await loadRuntimeCatalog(runtime, preferences);
  const itemDetailsPayload = await serializeItemDetailsQuery(input, catalog, runtime);
  if (itemDetailsPayload) {
    return { statusCode: 200, payload: itemDetailsPayload };
  }
  const parsedForIntent = parseQuery(input, { catalog });
  const compEntityClarification = serializeCompRankingEntityClarification(parsedForIntent, catalog);
  if (compEntityClarification) {
    compEntityClarification.meta = {
      durationMs: Date.now() - startedAt,
      catalogWarning: warning,
      aliasMemory,
      preferences
    };
    return { statusCode: 200, payload: compEntityClarification };
  }
  const structuredParserMode = preferences.structuredParserMode === "inherit"
    ? runtime.useStructuredParser
    : preferences.structuredParserMode;
  const result = await runtime.recommendForInputImpl(input, {
    catalog,
    metaTFTClient: runtime.metaTFTClient,
    compsClient: runtime.compsClient,
    compsData,
    cacheStore: runtime.cacheStore,
    preferences,
    explicitPreferences,
    bypassQueryCache: Boolean(body.refresh),
    bypassDefaultContextCache: Boolean(body.refresh),
    structuredParser: runtime.structuredParser,
    useStructuredParser: structuredParserMode,
    sessionKey: conversationId === "default" ? SESSION_LAST_QUERY_KEY : `last_query:${conversationId}`
  });
  const warnings = warning ? [...(result.query?.warnings ?? []), warning] : result.query?.warnings;
  if (warnings) result.query.warnings = warnings;
  let comparisonItemDetails = runtime.officialItemDetails;
  if (result.comparison && !comparisonItemDetails) {
    try {
      comparisonItemDetails = await loadOfficialItemDetails(runtime);
    } catch (error) {
      const detailWarning = `官方装备图标加载失败：${error.message}`;
      result.query.warnings = [...new Set([...(result.query?.warnings ?? []), detailWarning])];
      result.comparison.warnings = [...new Set([...(result.comparison.warnings ?? []), detailWarning])];
    }
  }

  const payload = serializeRecommendation(result, catalog, {
    durationMs: Date.now() - startedAt,
    catalogWarning: warning,
    aliasMemory,
    preferences,
    conversationId,
    itemDetails: comparisonItemDetails
  });
  Object.assign(payload, conversationMeta({ conversationId }));
  return {
    statusCode: 200,
    payload
  };
}

export async function handlePreferencesRequest(body, runtime) {
  return {
    ok: true,
    preferences: await saveSmallWindowPreferences(runtime, body?.preferences ?? body ?? {})
  };
}

export async function handlePreferencesResetRequest(runtime) {
  return {
    ok: true,
    preferences: await resetSmallWindowPreferences(runtime)
  };
}

export async function handleCacheClearRequest(runtime) {
  const storeCleared = await runtime.cacheStore?.clearQueryHistory?.() ?? {
    queryCache: 0,
    defaultContextCache: 0,
    sessionState: 0
  };
  const catalogCache = invalidateRuntimeCatalog(runtime);

  return {
    ok: true,
    cleared: {
      queryCache: storeCleared.queryCache ?? 0,
      defaultContextCache: storeCleared.defaultContextCache ?? 0,
      sessionState: storeCleared.sessionState ?? 0,
      catalogCache
    }
  };
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

export async function handleFeedbackRequest(body, runtime) {
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

export async function handleEntityMemoryClearRequest(runtime) {
  const candidateAliases = await runtime.cacheStore?.clearEntityAliases?.({
    enabled: false
  }) ?? 0;
  const feedbackEvents = await runtime.cacheStore?.clearFeedbackEvents?.() ?? 0;
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
  const alias = await runtime.cacheStore?.setEntityAliasEnabled?.(id, enabled);
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
    const alias = await runtime.cacheStore?.setEntityAliasEnabled?.(id, enabled);
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

async function handleSessionClear(runtime, body = {}) {
  const conversationId = String(body?.conversationId ?? body?.conversation_id ?? "").trim();
  await runtime.cacheStore?.deleteSessionState?.(conversationId ? `last_query:${conversationId}` : SESSION_LAST_QUERY_KEY);
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
  const preferences = completeSmallWindowPreferences(await loadSmallWindowPreferences(runtime));
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

export function createSmallWindowHandler(options = {}) {
  const runtime = options.runtime ?? createSmallWindowRuntime(options);

  return async function smallWindowHandler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    try {
      if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, {
          ok: true
        });
      }

      if (req.method === "GET" && url.pathname === "/api/runtime") {
        return sendJson(res, 200, await handleRuntimeStatusRequest(runtime));
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

      if (req.method === "POST" && url.pathname === "/api/recommend") {
        const body = await readJsonRequest(req);
        const { statusCode, payload } = await handleRecommendRequest(body, runtime);
        return sendJson(res, statusCode, payload);
      }

      if (req.method === "GET" && url.pathname === "/api/preferences") {
        return sendJson(res, 200, {
          ok: true,
          preferences: await loadSmallWindowPreferences(runtime)
        });
      }

      if (req.method === "POST" && url.pathname === "/api/preferences") {
        const body = await readJsonRequest(req);
        return sendJson(res, 200, await handlePreferencesRequest(body, runtime));
      }

      if (req.method === "DELETE" && url.pathname === "/api/preferences") {
        return sendJson(res, 200, await handlePreferencesResetRequest(runtime));
      }

      if (req.method === "POST" && url.pathname === "/api/cache/clear") {
        return sendJson(res, 200, await handleCacheClearRequest(runtime));
      }

      if (req.method === "POST" && url.pathname === "/api/feedback") {
        const body = await readJsonRequest(req);
        return sendJson(res, 200, await handleFeedbackRequest(body, runtime));
      }

      if (req.method === "POST" && url.pathname === "/api/entity-memory/clear") {
        return sendJson(res, 200, await handleEntityMemoryClearRequest(runtime));
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
        return sendJson(res, 200, await handleEntityAliasReviewRequest(body, runtime));
      }

      if (req.method === "POST" && url.pathname === "/api/entity-aliases/review-batch") {
        const body = await readJsonRequest(req);
        return sendJson(res, 200, await handleEntityAliasBatchReviewRequest(body, runtime));
      }

      if (req.method === "POST" && url.pathname === "/api/session/clear") {
        const body = await readJsonRequest(req);
        return sendJson(res, 200, await handleSessionClear(runtime, body));
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

      return sendJson(res, 500, {
        ok: false,
        error: error.message
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
  startSmallWindowServer(parseCliOptions(process.argv.slice(2)))
    .then(({ url }) => {
      console.log(`TFTAgent small window: ${url}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
