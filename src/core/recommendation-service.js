import {
  DEFAULT_QUERY_OPTIONS,
  createCatalog
} from "../data/static-data.js";
import {
  makeCompCandidateCacheKey,
  makeQueryCacheKey
} from "../data/cache-store.js";
import {
  normalizeUnitBuildRows
} from "../data/metatft-response-adapter.js";
import { createCompsPageSnapshot } from "../data/comp-response-adapter.js";
import {
  buildTraitCatalogFromCompsData,
  buildUnitCatalogFromCompsData
} from "../data/domain-catalog.js";
import { buildQueryContext } from "./context-builder.js";
import { evaluateClarification } from "./clarification-policy.js";
import { filterBuildRows } from "./item-policy-filter.js";
import { parseQuery } from "./query-parser.js";
import { planMetaTFTCompCandidates, planMetaTFTUnitBuilds } from "./query-planner.js";
import {
  COMP_FILTER_SEMANTICS_VERSION,
  createAppliedCompConstraint,
  createUnavailableCompConstraint,
  resolveExplicitComp
} from "./comp-filter.js";
import { buildDefaultCompContext } from "./default-context-builder.js";
import { validateQueryContext } from "./query-validator.js";
import { rankBuilds } from "./ranker.js";
import { compareItemOptions, comparisonRankedBuilds } from "./item-comparison.js";
import { aggregateUnitItemRankings } from "./item-ranking.js";
import { formatRecommendation } from "./response-formatter.js";
import { normalizeAlias } from "./normalizer.js";
import {
  buildStructuredParserExpansion,
  shouldUseStructuredParser,
  validateStructuredParserOutput
} from "../llm/structured-parser.js";
import { retrieveEntityCandidates } from "../llm/entity-candidate-retriever.js";
import { buildCompRankingQuery, isCompRankingFollowUp } from "./comp-query.js";
import { buildCompRankings } from "./comp-ranking-service.js";
import { enrichCompResponseWithTrendHistory } from "./comp-trend-history.js";
import { decorateCompAssets } from "../data/asset-resolver.js";
import { createIntentEnvelope } from "../retrieval/contracts.js";
import { RetrievalPlanner } from "../retrieval/retrieval-planner.js";
import { StructuredRetriever } from "../retrieval/structured-retriever.js";

export const SESSION_LAST_QUERY_KEY = "last_query";
const RETRIEVAL_PLANNER = new RetrievalPlanner();
const SEMANTIC_INTENTS = new Set([
  "unit_build_rankings",
  "unit_build_completion",
  "unit_best_3_items",
  "unit_item_rankings",
  "unit_item_comparison",
  "unit_emblem_rankings",
  "comp_rankings",
  "comp_trends"
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueArray(values) {
  return [...new Set(asArray(values).filter((value) => value !== undefined && value !== null))];
}

function unavailableItemRecords(apiNames, catalog) {
  return uniqueArray(apiNames)
    .map((apiName) => catalog.itemByApiName.get(apiName))
    .filter((item) => item && (!item.current || !item.obtainable));
}

function referencedItemApiNames(query) {
  return uniqueArray([
    ...(query?.lockedItems ?? []),
    ...(query?.ownedItems ?? []),
    ...(query?.comparisonItems ?? []),
    ...(query?.comparison?.itemApiNames ?? []),
    ...(query?.parser?.comparison?.itemApiNames ?? [])
  ]);
}

function unavailableItemDecision(query, catalog) {
  const items = unavailableItemRecords(referencedItemApiNames(query), catalog);
  if (items.length === 0) return null;

  const names = items.map((item) => item.shortName ?? item.zhName ?? item.apiName);
  if (query.intent === "unit_item_comparison") {
    return {
      type: "unavailable_comparison_items",
      items: items.map((item) => item.apiName),
      text: `“${names.join(" / ")}”当前版本不属于可用装备，无法参与比较。请更换候选或确认名称。`
    };
  }
  const ordinaryOnly = query.itemPolicy === "ordinary_only";
  return {
    type: "unavailable_items",
    items: items.map((item) => item.apiName),
    text: `“${names.join(" / ")}”当前版本不属于${ordinaryOnly ? "可用普通装备" : "可用装备"}。本次${ordinaryOnly ? "普通装备" : "装备"}查询已自动排除。`
  };
}

function responseTypeForQuery(query, clarification = null) {
  if (clarification?.needsClarification) return "clarification";
  return query?.intent ?? "unit_build_rankings";
}

function isCompIntent(intent) {
  return intent === "comp_rankings" || intent === "comp_trends";
}

function createRetrievalAudit(result, input, catalog, planner = RETRIEVAL_PLANNER) {
  const intentEnvelope = createIntentEnvelope({
    input,
    parsed: result?.parsed,
    query: result?.query,
    validation: result?.validation,
    clarification: result?.clarification,
    catalog
  });
  let retrievalPlan = null;
  try {
    retrievalPlan = planner.plan(intentEnvelope);
  } catch (error) {
    intentEnvelope.warnings = [...new Set([...intentEnvelope.warnings, `retrieval_plan_unavailable:${error.message}`])];
  }
  return { intentEnvelope, retrievalPlan };
}

function attachRetrievalAudit(result, input, catalog, audit = null) {
  const value = audit ?? createRetrievalAudit(result, input, catalog);
  result.intentEnvelope = value.intentEnvelope;
  result.retrievalPlan = value.retrievalPlan;
  return result;
}

function structuredQueryFor(plan, operation) {
  return plan?.structuredQueries?.find((query) => query.operation === operation) ?? null;
}

async function executePlannedStructuredQuery(plan, operation, handler, context = {}) {
  const query = structuredQueryFor(plan, operation);
  if (!query) throw new Error(`RetrievalPlan does not allow structured operation: ${operation}`);
  const retriever = new StructuredRetriever({ handlers: { [operation]: handler } });
  return (await retriever.executeQuery(query, context)).value;
}

function itemLabel(apiName, catalog) {
  const item = catalog.itemByApiName.get(apiName);
  return item?.zhName ?? item?.shortName ?? apiName;
}

function formatItemRankingText(aggregation, query, catalog) {
  const best = aggregation.rankings[0];
  if (!best) {
    if ((aggregation.references ?? []).length === 0) {
      const categoryLabels = {
        radiant: "光明装备",
        artifact: "神器",
        emblem: "纹章",
        support: "辅助装备",
        set_special: "赛季特殊装备"
      };
      const scope = (query.itemCategories ?? [])
        .map((category) => categoryLabels[category] ?? category)
        .join("或");
      return scope
        ? `当前查询条件下没有${scope}的单件携带样本。`
        : "当前查询条件下没有可用的单件装备携带样本。";
    }
    return `没有单件装备达到样本阈值 ${query.minSamples}。`;
  }
  const stats = best.stats;
  return [
    `结论：${itemLabel(best.apiName, catalog)}在当前口径的单装备聚合中排名第一。`,
    `证据：前四率 ${(stats.top4Rate * 100).toFixed(1)}% / 登顶率 ${(stats.winRate * 100).toFixed(1)}% / 均名 ${stats.avgPlacement.toFixed(2)} / 样本 ${stats.games}。`,
    "口径：按合法完整三件套是否包含该装备聚合；同一组合中的重复装备只计一次组合样本。"
  ].join("\n");
}

function preferencesFor(options) {
  return {
    ...DEFAULT_QUERY_OPTIONS,
    ...(options.preferences ?? {})
  };
}

function catalogFor(options = {}) {
  if (options.catalog) return options.catalog;
  if (!options.compsData) return createCatalog();
  return createCatalog({
    units: buildUnitCatalogFromCompsData(options.compsData),
    traits: buildTraitCatalogFromCompsData(options.compsData)
  });
}

function sessionStoreFor(options) {
  return options.sessionStore ?? options.cacheStore ?? null;
}

function sessionKeyFor(options = {}) {
  return String(options.sessionKey ?? SESSION_LAST_QUERY_KEY);
}

async function getStoreEntry(store, method, ...args) {
  if (!store?.[method]) return null;
  return store[method](...args);
}

async function setStoreEntry(store, method, ...args) {
  if (!store?.[method]) return null;
  return store[method](...args);
}

function lastQueryFromSession(value) {
  return value?.query ?? value?.last_query ?? value ?? null;
}

function inheritCompRankingFromSession(parsed, sessionValue, options = {}) {
  const previousQuery = lastQueryFromSession(sessionValue);
  if (!isCompIntent(previousQuery?.intent) || !isCompRankingFollowUp(parsed, previousQuery)) {
    return { parsed, inherited: false, inheritedKeys: [] };
  }

  const next = { ...parsed, intent: isCompIntent(parsed?.intent) ? parsed.intent : previousQuery.intent };
  const inheritedKeys = [];
  for (const key of ["rankFilter", "days", "patch", "queue", "minSamples", "sort", "metrics", "limit", "specialMode"]) {
    const current = next[key];
    const missing = current === undefined || (Array.isArray(current) && current.length === 0);
    if (!missing || previousQuery[key] === undefined || Object.hasOwn(options.explicitPreferences ?? {}, key)) continue;
    next[key] = Array.isArray(previousQuery[key]) ? [...previousQuery[key]] : previousQuery[key];
    inheritedKeys.push(key);
  }
  if (parsed.sort === "win_first") next.metrics = ["win_rate"];
  if (parsed.sort === "top4_first") next.metrics = ["top4_rate"];
  if (parsed.sort === "avg_first") next.metrics = ["avg_placement"];
  if (parsed.sort === "games_first" || parsed.sort === "robust_first") next.metrics = ["popularity"];
  next.sessionContext = {
    inherited: inheritedKeys.length > 0,
    sourceKey: SESSION_LAST_QUERY_KEY,
    inheritedKeys,
    fieldOrigins: Object.fromEntries(inheritedKeys.map((key) => [key, ["conversation"]]))
  };
  return { parsed: next, inherited: inheritedKeys.length > 0, inheritedKeys };
}

function compConstraintSource(parsed, options, key) {
  const origins = parsed.sessionContext?.fieldOrigins?.[key];
  if (origins?.includes("conversation")) return "conversation";
  if (parsed[key] !== undefined && !parsed.sessionContext?.inheritedKeys?.includes(key)) return "current_input";
  return Object.hasOwn(options.explicitPreferences ?? {}, key) ? "preference" : "system_default";
}

function structuredParserFor(options) {
  const parser = options.structuredParser;
  if (!parser) return null;
  if (typeof parser === "function") return parser;
  if (typeof parser.parse === "function") return parser.parse.bind(parser);
  if (typeof parser.parseQuery === "function") return parser.parseQuery.bind(parser);
  return null;
}

async function applySemanticIntentHint(input, parsed, options = {}) {
  const parser = parsed?.parser ?? {};
  const needsSemanticIntent = parser.intentExplicit !== true
    || asArray(parser.unresolvedEntityHints).length > 0
    || asArray(parser.entityAmbiguities).length > 0;
  if (!options.semanticRetriever?.search || !needsSemanticIntent) return parsed;
  try {
    const hits = await options.semanticRetriever.search(input, {
      documentTypes: ["intent_sample"],
      patch: options.preferences?.patch ?? "current",
      locale: options.semanticLocale ?? "zh-CN",
      topK: 3,
      minimumScore: Number(options.semanticIntentMinimumScore ?? 0.72)
    });
    const first = hits.find((hit) => SEMANTIC_INTENTS.has(hit.intent));
    const second = hits.find((hit) => hit !== first && SEMANTIC_INTENTS.has(hit.intent));
    const minimumScore = Number(options.semanticIntentMinimumScore ?? 0.72);
    const minimumMargin = Number(options.semanticIntentMinimumMargin ?? 0.06);
    const accepted = first
      && first.score >= minimumScore
      && (!second || first.intent === second.intent || first.score - second.score >= minimumMargin);
    return {
      ...parsed,
      ...(accepted ? { intent: first.intent } : {}),
      parser: {
        ...(parsed.parser ?? {}),
        semanticIntent: {
          attempted: true,
          accepted: Boolean(accepted),
          intent: accepted ? first.intent : null,
          evidenceId: accepted ? first.id : null,
          score: first?.score ?? null,
          candidates: hits.slice(0, 3).map((hit) => ({ id: hit.id, intent: hit.intent, score: hit.score }))
        }
      }
    };
  } catch (error) {
    return {
      ...parsed,
      parser: {
        ...(parsed.parser ?? {}),
        semanticIntent: { attempted: true, accepted: false, error: error?.code ?? error?.name ?? "error" }
      }
    };
  }
}

function semanticEntityCandidate(hit, catalog) {
  const type = hit.documentType === "unit" || hit.documentType === "unit_description"
    ? "unit"
    : ["item", "item_description", "emblem_description"].includes(hit.documentType)
      ? "item"
      : ["trait", "trait_description"].includes(hit.documentType)
        ? "trait"
        : null;
  if (!type || !hit.apiName) return null;
  const record = type === "unit"
    ? catalog.unitByApiName.get(hit.apiName)
    : type === "item"
      ? catalog.itemByApiName.get(hit.apiName)
      : catalog.traitByFilterId.get(hit.apiName) ?? catalog.traitByApiName.get(hit.apiName);
  if (!record || record.current === false) return null;
  return {
    id: hit.id,
    entityType: type,
    apiName: type === "trait" ? record.apiName : hit.apiName,
    filterId: type === "trait" ? record.filterId : null,
    label: hit.metadata?.canonicalName
      ?? record.preferredDisplayName
      ?? record.displayName
      ?? record.shortName
      ?? record.zhName
      ?? hit.apiName,
    matchedAlias: hit.metadata?.matchedAlias ?? null,
    confidence: Number(hit.score),
    source: "persistent_semantic_index",
    evidenceId: hit.id
  };
}

async function applySemanticEntityHints(input, parsed, options = {}, catalog) {
  const parser = parsed?.parser ?? {};
  const needsEntitySearch = !parsed.unit
    || asArray(parser.unresolvedEntityHints).length > 0
    || asArray(parser.entityAmbiguities).length > 0;
  if (!options.semanticRetriever?.search || !needsEntitySearch) return parsed;
  try {
    const hits = await options.semanticRetriever.search(input, {
      documentTypes: ["unit", "item", "trait", "unit_description", "item_description", "trait_description", "emblem_description"],
      patch: options.preferences?.patch ?? "current",
      locale: options.semanticLocale ?? "zh-CN",
      topK: Number(options.semanticEntityLimit ?? 8),
      minimumScore: Number(options.semanticEntityMinimumScore ?? 0.76)
    });
    const candidates = hits.map((hit) => semanticEntityCandidate(hit, catalog)).filter(Boolean);
    const units = candidates.filter((candidate) => candidate.entityType === "unit");
    const first = units[0];
    const second = units[1];
    const minimumScore = Number(options.semanticEntityMinimumScore ?? 0.76);
    const minimumMargin = Number(options.semanticEntityMinimumMargin ?? 0.06);
    const acceptedUnit = !parsed.unit
      && first
      && first.confidence >= minimumScore
      && (!second || first.confidence - second.confidence >= minimumMargin)
      ? first
      : null;
    return {
      ...parsed,
      ...(acceptedUnit ? { unit: acceptedUnit.apiName, unitAlias: acceptedUnit.label } : {}),
      parser: {
        ...parser,
        entityMatches: acceptedUnit ? [
          ...(parser.entityMatches ?? []),
          {
            entityType: "unit",
            apiName: acceptedUnit.apiName,
            alias: acceptedUnit.label,
            matchType: "semantic_index",
            confidence: acceptedUnit.confidence,
            evidenceId: acceptedUnit.evidenceId
          }
        ] : parser.entityMatches ?? [],
        semanticEntities: {
          attempted: true,
          acceptedUnit: acceptedUnit?.apiName ?? null,
          evidenceId: acceptedUnit?.evidenceId ?? null,
          candidates: candidates.slice(0, Number(options.semanticEntityLimit ?? 8))
        }
      }
    };
  } catch (error) {
    return {
      ...parsed,
      parser: {
        ...parser,
        semanticEntities: { attempted: true, acceptedUnit: null, candidates: [], error: error?.code ?? error?.name ?? "error" }
      }
    };
  }
}

async function callStructuredParser(input, parsed, options, catalog) {
  const parser = structuredParserFor(options);
  if (!parser) {
    return {
      ok: false,
      error: "structuredParser must be a function or expose parse()"
    };
  }

  try {
    const raw = await parser({
      input,
      parsed,
      catalogSummary: {
        units: catalog.units.length,
        items: catalog.items.length,
        traits: catalog.traits.length
      }
    });
    const validation = validateStructuredParserOutput(raw);
    return {
      ok: validation.valid,
      raw,
      value: validation.value,
      errors: validation.errors
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
}

function resolvedItemApiNamesForMentions(mentions, reparsed) {
  const matches = reparsed.parser?.entityMatches ?? [];
  return uniqueArray(asArray(mentions).flatMap((mention) => {
    const normalizedMention = normalizeAlias(mention);
    return matches
      .filter((match) => match.entityType === "item" && normalizeAlias(match.alias) === normalizedMention)
      .map((match) => match.apiName);
  }));
}

function mergeStructuredParserResult(parsed, structured, reparsed) {
  const applied = [];
  const next = {
    ...parsed,
    parser: {
      ...(parsed.parser ?? {}),
      usedLLM: true,
      entityMatches: [
        ...(parsed.parser?.entityMatches ?? []),
        ...(reparsed.parser?.entityMatches ?? [])
      ],
      unresolvedEntityHints: reparsed.parser?.unresolvedEntityHints ?? [],
      comparison: reparsed.parser?.comparison ?? parsed.parser?.comparison,
      structuredParser: {
        attempted: true,
        valid: true,
        entityMentions: structured.entities,
        constraints: structured.constraints,
        needsClarification: structured.needsClarification,
        clarificationQuestion: structured.clarificationQuestion,
        applied
      }
    }
  };

  const applyScalar = (key, value) => {
    if (next[key] !== undefined || value === undefined) return;
    next[key] = value;
    applied.push(key);
  };
  const applyArray = (key, values) => {
    if (asArray(next[key]).length > 0 || asArray(values).length === 0) return;
    next[key] = values;
    applied.push(key);
  };

  if (isCompIntent(structured.intent) && !parsed.unit) {
    next.intent = structured.intent;
    applied.push("intent");
  }

  if (!next.unit && reparsed.unit) {
    next.unit = reparsed.unit;
    next.unitAlias = reparsed.unitAlias;
    applied.push("unit");
  }
  applyArray("traitFilters", uniqueArray([...(parsed.traitFilters ?? []), ...(reparsed.traitFilters ?? [])]));
  const structuredLockedItems = resolvedItemApiNamesForMentions(
    structured.constraints.lockedItemMentions,
    reparsed
  );
  const structuredComparisonItems = resolvedItemApiNamesForMentions(
    structured.constraints.comparisonItemMentions,
    reparsed
  );
  const reclassifyAmbiguousItems = parsed.parser?.multipleItemRelationAmbiguous
    && structured.intent === "unit_item_comparison";
  const lockedItems = uniqueArray([
    ...(reclassifyAmbiguousItems ? [] : (parsed.lockedItems ?? parsed.ownedItems ?? [])),
    ...(reclassifyAmbiguousItems ? [] : (reparsed.lockedItems ?? reparsed.ownedItems ?? [])),
    ...structuredLockedItems
  ]);
  const comparisonItems = uniqueArray([
    ...(parsed.comparisonItems ?? []),
    ...(reparsed.comparisonItems ?? []),
    ...structuredComparisonItems
  ]).filter((item) => !lockedItems.includes(item));
  if (lockedItems.length > 0 || reclassifyAmbiguousItems) {
    next.lockedItems = lockedItems;
    next.ownedItems = lockedItems;
    applied.push("lockedItems");
  }
  if (comparisonItems.length > 0) {
    next.comparisonItems = comparisonItems;
    next.comparisonMode = structured.constraints.comparisonMode ?? "exclusive_presence";
    next.intent = "unit_item_comparison";
    next.parser.comparison = {
      requested: true,
      itemApiNames: comparisonItems,
      ownedItemApiNames: lockedItems
    };
    applied.push("comparisonItems");
  }
  const structuredExcludedItems = resolvedItemApiNamesForMentions(
    structured.constraints.excludedItemMentions,
    reparsed
  );
  const excludedItems = uniqueArray([
    ...(parsed.excludedItems ?? []),
    ...(reparsed.excludedItems ?? []),
    ...structuredExcludedItems
  ]);
  if (excludedItems.length > 0) {
    next.excludedItems = excludedItems;
    next.lockedItems = asArray(next.lockedItems ?? next.ownedItems).filter((item) => !excludedItems.includes(item));
    next.ownedItems = next.lockedItems;
    next.comparisonItems = asArray(next.comparisonItems).filter((item) => !excludedItems.includes(item));
    applied.push("excludedItems");
  }
  applyScalar("intent", structured.intent);
  applyArray("starLevel", structured.constraints.starLevel);
  applyScalar("itemCount", structured.constraints.itemCount);
  applyScalar("itemPolicy", structured.constraints.itemPolicy ?? reparsed.itemPolicy);
  applyArray("rankFilter", structured.constraints.rankFilter);
  applyScalar("days", structured.constraints.days);
  applyScalar("patch", structured.constraints.patch);
  applyScalar("queue", structured.constraints.queue);
  applyScalar("minSamples", structured.constraints.minSamples);
  applyScalar("sort", structured.constraints.sort);
  applyScalar("primaryMetric", structured.constraints.primaryMetric);

  if (
    structured.intent === "unit_best_3_items"
    && lockedItems.length > 0
    && comparisonItems.length === 0
  ) {
    next.parser.multipleItemRelationAmbiguous = false;
  }
  if (structured.intent === "unit_item_comparison" && comparisonItems.length >= 2) {
    next.parser.multipleItemRelationAmbiguous = false;
    next.parser.genericSpecialComparisonRequested = false;
  }
  applyArray("metrics", structured.constraints.metrics);
  applyScalar("limit", structured.constraints.limit);

  return next;
}

function parseQueryDeterministically(input, options, catalog) {
  return parseQuery(input, {
    catalog,
    highConfidenceFuzzy: options.highConfidenceFuzzy,
    compQuery: options.preferences
  });
}

async function parseQueryWithOptionalStructuredParser(input, options, catalog, parsedSeed = null) {
  const parsed = parsedSeed ?? parseQueryDeterministically(input, options, catalog);
  if (!shouldUseStructuredParser(parsed, options)) return parsed;

  const result = await callStructuredParser(input, parsed, options, catalog);
  if (!result.ok) {
    return {
      ...parsed,
      parser: {
        ...(parsed.parser ?? {}),
        structuredParser: {
          attempted: true,
          valid: false,
          errors: result.errors ?? [result.error ?? "structured parser failed"]
        }
      }
    };
  }

  const expansion = buildStructuredParserExpansion(result.value);
  const reparsed = expansion
    ? parseQuery(`${input}。${expansion}`, {
      catalog,
      highConfidenceFuzzy: options.highConfidenceFuzzy,
      compQuery: options.preferences
    })
    : parseQuery(input, {
      catalog,
      highConfidenceFuzzy: options.highConfidenceFuzzy,
      compQuery: options.preferences
    });

  return mergeStructuredParserResult(parsed, result.value, reparsed);
}

function buildClarificationEntityCandidates(input, parsed, query, catalog, options = {}) {
  const semanticCandidates = (parsed.parser?.semanticEntities?.candidates ?? []).map((candidate) => ({
    ...candidate,
    inputFragment: input,
    queryText: `${input} ${candidate.label}`.trim()
  }));
  if (options.useEntityCandidateRetriever === false) return semanticCandidates;

  const retriever = options.entityCandidateRetriever ?? retrieveEntityCandidates;
  if (typeof retriever !== "function") return semanticCandidates;

  const requests = [];
  if (!query.unit) {
    requests.push({ entityType: "unit", inputFragment: input, preserveCandidateFragment: true });
  }
  for (const hint of parsed.parser?.unresolvedEntityHints ?? []) {
    requests.push(hint);
  }

  const candidates = requests.flatMap((request) => retriever(request.inputFragment, {
    catalog,
    entityTypes: [request.entityType],
    limit: options.entityCandidateLimit ?? 5,
    parsed
  }).map((candidate) => {
    const inputFragment = request.preserveCandidateFragment
      ? candidate.inputFragment ?? request.inputFragment
      : request.inputFragment;
    return {
      ...candidate,
      inputFragment,
      queryText: replaceInputFragment(input, inputFragment, candidate.label ?? candidate.matchedAlias)
    };
  }));
  candidates.push(...semanticCandidates);

  const unique = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.entityType}:${candidate.apiName}`;
    const current = unique.get(key);
    if (!current || candidate.confidence > current.confidence) unique.set(key, candidate);
  }
  return [...unique.values()];
}

function replaceInputFragment(input, fragment, replacement) {
  const text = String(input ?? "");
  const needle = String(fragment ?? "");
  if (!needle || !replacement) return text;
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return `${text} ${replacement}`.trim();
  return `${text.slice(0, index)}${replacement}${text.slice(index + needle.length)}`;
}

function fieldValue(query, camelKey, snakeKey) {
  return query?.[camelKey] ?? query?.[snakeKey];
}

function comparisonContinuationPolicy(parsed, lastQuery) {
  if (/(?:只看|仅看|只用|仅用|只要|仅要)/.test(String(parsed.rawInput ?? ""))) {
    return parsed.itemPolicy ?? lastQuery.itemPolicy;
  }
  const candidates = new Set([parsed.itemPolicy, lastQuery.itemPolicy].filter(Boolean));
  if (candidates.has("include_special")) return "include_special";
  if (candidates.has("include_artifact") && candidates.has("include_radiant")) return "include_special";
  if (candidates.has("include_artifact")) return "include_artifact";
  if (candidates.has("include_radiant")) return "include_radiant";
  return parsed.itemPolicy ?? lastQuery.itemPolicy;
}

function primaryMetricForSort(sort) {
  if (sort === "win_first") return "winRate";
  if (sort === "avg_first") return "avgPlacement";
  if (sort === "games_first" || sort === "robust_first") return "games";
  if (sort === "top4_first") return "top4Rate";
  return undefined;
}

function inheritParsedFromSession(parsed, sessionValue) {
  const lastQuery = lastQueryFromSession(sessionValue);
  const priorComparisonItems = uniqueArray([
    ...asArray(fieldValue(lastQuery, "comparisonItems", "comparison_items")),
    ...asArray(lastQuery?.comparison?.itemApiNames)
  ]);
  const unitOnlyComparisonFollowUp = Boolean(
    parsed.unit
    && !parsed.parser?.intentExplicit
    && lastQuery?.intent === "unit_item_comparison"
    && priorComparisonItems.length >= 2
    && asArray(parsed.lockedItems ?? parsed.ownedItems).length === 0
    && asArray(parsed.excludedItems).length === 0
    && asArray(parsed.traitFilters).length === 0
    && asArray(parsed.itemCategories).length === 0
    && !parsed.compMention
  );

  if (parsed.unit && !unitOnlyComparisonFollowUp) {
    return {
      parsed,
      inherited: false,
      inheritedKeys: []
    };
  }

  if ((parsed.parser?.entityAmbiguities ?? []).length > 0) {
    return {
      parsed,
      inherited: false,
      inheritedKeys: []
    };
  }

  if (!lastQuery?.unit || isCompIntent(lastQuery.intent)) {
    return {
      parsed,
      inherited: false,
      inheritedKeys: []
    };
  }

  const inheritedKeys = [];
  const explicitlyLockedItems = asArray(parsed.lockedItems ?? parsed.ownedItems);
  const explicitlyExcludedItems = asArray(parsed.excludedItems);
  const next = {
    ...parsed,
    parser: {
      ...(parsed.parser ?? {}),
      inheritedFromSession: true
    }
  };

  const inheritScalar = (key, camelKey = key, snakeKey = key) => {
    if (next[key] !== undefined) return;
    const value = fieldValue(lastQuery, camelKey, snakeKey);
    if (value === undefined) return;
    next[key] = value;
    inheritedKeys.push(key);
  };

  const inheritArray = (key, camelKey = key, snakeKey = key) => {
    if (asArray(next[key]).length > 0) return;
    const value = asArray(fieldValue(lastQuery, camelKey, snakeKey));
    if (value.length === 0) return;
    next[key] = value;
    inheritedKeys.push(key);
  };

  const lastComparisonItems = uniqueArray([
    ...asArray(fieldValue(lastQuery, "comparisonItems", "comparison_items")),
    ...asArray(lastQuery.comparison?.itemApiNames)
  ]);
  const lastLockedItems = asArray(fieldValue(lastQuery, "lockedItems", "locked_items"));
  const previousLockedItems = lastLockedItems.length > 0
    ? lastLockedItems
    : asArray(fieldValue(lastQuery, "ownedItems", "owned_items"));
  const inputText = normalizeAlias(parsed.rawInput);
  const currentComparisonItems = asArray(parsed.comparisonItems);
  const currentResolvedItems = uniqueArray([
    ...currentComparisonItems,
    ...explicitlyLockedItems
  ]).filter((item) => !explicitlyExcludedItems.includes(item));
  const continuesComparison = lastQuery.intent === "unit_item_comparison"
    && lastComparisonItems.length >= 1;
  let comparisonContinuation = false;
  let comparisonContinuationKind = null;

  if (continuesComparison) {
    const replacement = /(?:换成|替换成|改成)/.test(inputText);
    const ownership = /(?:已经有|已有|我有|有了|带着|拿了|锁定)/.test(inputText);
    const removal = explicitlyExcludedItems.length > 0;
    const append = /^(?:那|再看|再加|加上|加入|还有)/.test(inputText)
      || lastQuery.pendingComparison === true;
    const explicitComparison = currentComparisonItems.length > 0;
    const constraintFollowUp = [
      parsed.rankFilter,
      parsed.days,
      parsed.patch,
      parsed.minSamples,
      parsed.sort
    ].some((value) => value !== undefined);

    if (replacement && currentResolvedItems.length > 0) {
      const replacementTargets = currentResolvedItems.filter((item) => lastComparisonItems.includes(item));
      const replacementCandidates = currentResolvedItems.filter((item) => !lastComparisonItems.includes(item));
      next.lockedItems = [...previousLockedItems];
      next.ownedItems = next.lockedItems;
      if (replacementTargets.length === 1 && replacementCandidates.length === 1) {
        next.comparisonItems = lastComparisonItems.map((item) => (
          item === replacementTargets[0] ? replacementCandidates[0] : item
        ));
        comparisonContinuationKind = "targeted_replacement";
      } else {
        next.comparisonItems = [...lastComparisonItems];
        next.parser.comparisonReplacementAmbiguous = true;
        next.parser.comparisonReplacementCandidates = replacementCandidates.length
          ? replacementCandidates
          : currentResolvedItems;
        comparisonContinuationKind = "replacement";
      }
      comparisonContinuation = true;
    } else if (removal) {
      next.comparisonItems = lastComparisonItems.filter((item) => !explicitlyExcludedItems.includes(item));
      next.lockedItems = previousLockedItems.filter((item) => !explicitlyExcludedItems.includes(item));
      next.ownedItems = next.lockedItems;
      comparisonContinuation = true;
      comparisonContinuationKind = "removal";
    } else if (ownership && currentResolvedItems.length > 0) {
      next.comparisonItems = [...lastComparisonItems];
      next.lockedItems = uniqueArray([...previousLockedItems, ...currentResolvedItems]);
      next.ownedItems = next.lockedItems;
      comparisonContinuation = true;
      comparisonContinuationKind = "ownership";
    } else if (explicitComparison) {
      next.comparisonItems = [...currentComparisonItems];
      next.lockedItems = explicitlyLockedItems.length > 0 ? explicitlyLockedItems : previousLockedItems;
      next.ownedItems = next.lockedItems;
      comparisonContinuation = true;
      comparisonContinuationKind = "explicit";
    } else if (append && currentResolvedItems.length > 0) {
      next.comparisonItems = uniqueArray([...lastComparisonItems, ...currentResolvedItems]);
      next.lockedItems = [...previousLockedItems];
      next.ownedItems = next.lockedItems;
      comparisonContinuation = true;
      comparisonContinuationKind = "append";
    } else if (constraintFollowUp) {
      next.comparisonItems = [...lastComparisonItems];
      next.lockedItems = [...previousLockedItems];
      next.ownedItems = next.lockedItems;
      comparisonContinuation = true;
      comparisonContinuationKind = "constraint";
    } else if (unitOnlyComparisonFollowUp) {
      next.comparisonItems = [...lastComparisonItems];
      next.lockedItems = [...previousLockedItems];
      next.ownedItems = next.lockedItems;
      comparisonContinuation = true;
      comparisonContinuationKind = "unit";
    }

    if (comparisonContinuation) {
      next.intent = "unit_item_comparison";
      next.pendingComparison = false;
      next.comparisonMode = "exclusive_presence";
      next.primaryMetric = parsed.primaryMetric
        ?? primaryMetricForSort(parsed.sort)
        ?? lastQuery.primaryMetric
        ?? "top4Rate";
      next.sort = parsed.sort ?? lastQuery.sort;
      next.itemPolicy = comparisonContinuationPolicy(parsed, lastQuery);
      next.parser.multipleItemRelationAmbiguous = false;
      next.parser.comparison = {
        requested: true,
        itemApiNames: next.comparisonItems,
        ownedItemApiNames: next.lockedItems
      };
      inheritedKeys.push("comparisonItems", "comparisonMode");
      if (next.lockedItems.length > explicitlyLockedItems.length) inheritedKeys.push("lockedItems");
      inheritedKeys.push("primaryMetric");
    }
  }

  if (!next.unit) {
    next.unit = lastQuery.unit;
    inheritedKeys.push("unit");
  }
  if (!parsed.parser?.intentExplicit && lastQuery.intent) {
    next.intent = lastQuery.intent;
    inheritedKeys.push("intent");
  }
  inheritArray("starLevel", "starLevel", "star_level");
  inheritScalar("itemCount", "itemCount", "item_count");
  if (!lastQuery.defaultContext) {
    inheritArray("traitFilters", "traitFilters", "trait_filters");
  }
  inheritArray("lockedItems", "lockedItems", "locked_items");
  if (asArray(next.lockedItems).length === 0) {
    inheritArray("lockedItems", "ownedItems", "owned_items");
  }
  next.ownedItems = asArray(next.lockedItems);
  if (!next.compMention && lastQuery.comp?.status === "applied" && lastQuery.comp?.value?.selection === "explicit") {
    next.comp = lastQuery.comp;
    inheritedKeys.push("comp");
  }
  inheritArray("excludedItems", "excludedItems", "excluded_items");
  if (explicitlyExcludedItems.length > 0) {
    next.lockedItems = asArray(next.lockedItems)
      .filter((item) => !explicitlyExcludedItems.includes(item));
    next.ownedItems = next.lockedItems;
  }
  if (explicitlyLockedItems.length > 0) {
    next.excludedItems = asArray(next.excludedItems)
      .filter((item) => !explicitlyLockedItems.includes(item));
  }
  inheritScalar("itemPolicy", "itemPolicy", "item_policy");
  inheritArray("itemCategories", "itemCategories", "item_categories");
  inheritArray("rankFilter", "rankFilter", "rank");
  inheritScalar("days");
  inheritScalar("patch");
  inheritScalar("queue");
  const currentInputHasSpecialScope = parsed.itemPolicy && parsed.itemPolicy !== "ordinary_only";
  const previousMinSamplesSource = fieldValue(lastQuery, "minSamplesSource", "min_samples_source");
  if (!currentInputHasSpecialScope || ["current_input", "conversation"].includes(previousMinSamplesSource)) {
    inheritScalar("minSamples", "minSamples", "min_samples");
  }
  inheritScalar("sort");

  if (!comparisonContinuation && asArray(next.comparisonItems).length > 0) {
    next.comparisonMode = next.comparisonMode ?? "exclusive_presence";
    next.primaryMetric = next.primaryMetric ?? "top4Rate";
    next.parser.comparison = {
      requested: true,
      itemApiNames: next.comparisonItems,
      ownedItemApiNames: next.lockedItems
    };
  }

  next.sessionContext = {
    inherited: true,
    sourceKey: SESSION_LAST_QUERY_KEY,
    inheritedKeys,
    fieldOrigins: {
      unit: parsed.unit ? ["current_input"] : ["conversation"],
      ...(comparisonContinuation
        ? {
          comparisonItems: comparisonContinuationKind === "explicit"
            ? ["current_input"]
            : ["append", "removal", "targeted_replacement"].includes(comparisonContinuationKind)
              ? ["conversation", "current_input"]
              : ["conversation"],
          lockedItems: comparisonContinuationKind === "ownership"
            ? ["conversation", "current_input"]
            : ["conversation"],
          primaryMetric: parsed.primaryMetric || primaryMetricForSort(parsed.sort)
            ? ["current_input"]
            : ["conversation"]
        }
        : {})
    }
  };

  return {
    parsed: next,
    inherited: true,
    inheritedKeys
  };
}

function canPreinheritUnitFollowUp(parsed) {
  if (parsed?.unit || isCompIntent(parsed?.intent)) return false;
  if ((parsed?.parser?.entityAmbiguities ?? []).length > 0) return false;
  return (parsed?.ownedItems ?? []).length > 0
    || (parsed?.excludedItems ?? []).length > 0
    || (parsed?.itemCategories ?? []).length > 0
    || (parsed?.traitFilters ?? []).length > 0
    || parsed?.minSamples !== undefined
    || parsed?.days !== undefined
    || (parsed?.rankFilter ?? []).length > 0
    || parsed?.sort !== undefined
    || Boolean(parsed?.parser?.comparison?.requested)
    || (parsed?.parser?.unresolvedEntityHints ?? []).some((hint) => (
      hint.entityType === "item" || hint.entityType === "trait"
    ));
}

function serializeQueryForSession(query) {
  return {
    intent: query.intent,
    unit: query.unit,
    starLevel: query.starLevel,
    itemCount: query.itemCount,
    traitFilters: query.traitFilters,
    lockedItems: query.lockedItems ?? query.ownedItems,
    comparisonItems: query.comparisonItems,
    comparisonMode: query.comparisonMode,
    primaryMetric: query.primaryMetric,
    pendingComparison: Boolean(query.pendingComparison),
    comp: query.comp?.status === "applied" && query.comp?.value?.selection === "explicit"
      ? query.comp
      : null,
    ownedItems: query.ownedItems,
    excludedItems: query.excludedItems,
    itemPolicy: query.itemPolicy,
    itemCategories: query.itemCategories,
    rankFilter: query.rankFilter,
    days: query.days,
    patch: query.patch,
    queue: query.queue,
    minSamples: query.minSamples,
    minSamplesSource: query.constraintSources?.min_samples?.source ?? null,
    sort: query.sort,
    defaultContext: query.defaultContext
      ? {
        clusterId: query.defaultContext.clusterId,
        compName: query.defaultContext.compName,
        units: query.defaultContext.units,
        traitFilters: query.defaultContext.traitFilters,
        sourceEndpoint: query.defaultContext.sourceEndpoint
      }
      : null
  };
}

async function resolveCompConstraint(query, parsed, options, catalog) {
  if (options.comp !== undefined) {
    return { value: options.comp, cache: null, plan: null };
  }

  const explicitValue = parsed.comp?.value ?? parsed.compMention;
  if (!explicitValue) {
    return { value: null, cache: null, plan: null, warnings: [] };
  }
  const explicitSource = parsed.sessionContext?.inheritedKeys?.includes("comp")
    ? "conversation"
    : "current_input";
  const directExplicit = explicitValue
    ? resolveExplicitComp(explicitValue, [], { unit: query.unit, catalog })
    : null;
  if (directExplicit) {
    return {
      value: createAppliedCompConstraint(directExplicit, {
        selection: "explicit",
        source: explicitSource
      }),
      cache: null,
      plan: null
    };
  }

  const plan = planMetaTFTCompCandidates(query);
  const cacheStore = options.cacheStore ?? null;
  const cacheKey = makeCompCandidateCacheKey({
    unit: query.unit,
    days: query.days,
    rankFilter: query.rankFilter,
    patch: query.patch,
    queue: query.queue,
    minSamples: query.minSamples,
    semanticsVersion: COMP_FILTER_SEMANTICS_VERSION
  });
  let response = options.compCandidatesResponse;
  let cache = { key: cacheKey, hit: false, stale: false };
  const warnings = [];

  if (response === undefined && !options.bypassDefaultContextCache) {
    const cached = await getStoreEntry(cacheStore, "getDefaultContext", cacheKey);
    if (cached?.value?.response !== undefined) {
      response = cached.value.response;
      cache = {
        key: cacheKey,
        hit: true,
        stale: false,
        updatedAt: cached.updatedAt,
        expiresAt: cached.expiresAt
      };
    }
  }

  if (response === undefined && options.metaTFTClient) {
    try {
      response = await executePlannedStructuredQuery(
        options.retrievalPlan,
        "unit_comp_candidates",
        async (params) => {
          const plannedQuery = {
            ...query,
            unit: params.unit,
            days: params.days,
            patch: params.patch,
            queue: params.queue,
            rankFilter: params.rank,
            minSamples: params.minSamples
          };
          const explorerPlan = planMetaTFTCompCandidates(plannedQuery);
          return typeof options.metaTFTClient.getCompCandidates === "function"
            ? options.metaTFTClient.getCompCandidates(explorerPlan)
            : options.metaTFTClient.getExactUnitsTraits2(explorerPlan.params);
        },
        { intent: query.intent }
      );
      const stored = await setStoreEntry(cacheStore, "setDefaultContext", cacheKey, {
        request: plan,
        response,
        source: "metatft",
        semanticsVersion: COMP_FILTER_SEMANTICS_VERSION
      }, { ttlMs: options.defaultContextTtlMs });
      cache.updatedAt = stored?.updatedAt ?? response?.capture?.capturedAt ?? new Date().toISOString();
      cache.expiresAt = stored?.expiresAt ?? null;
    } catch (error) {
      const stale = await getStoreEntry(cacheStore, "getDefaultContext", cacheKey, { allowExpired: true });
      if (stale?.value?.response !== undefined) {
        response = stale.value.response;
        cache = {
          key: cacheKey,
          hit: true,
          stale: true,
          updatedAt: stale.updatedAt,
          expiresAt: stale.expiresAt
        };
        warnings.push(`Comp 候选实时请求失败，已使用 ${stale.updatedAt} 的同口径过期缓存。`);
      } else {
        warnings.push(`Comp 候选请求失败：${error.message}`);
      }
    }
  }

  if (response === undefined) {
    return {
      value: createUnavailableCompConstraint({
        reason: "candidate_fetch_failed",
        stabilityThreshold: query.minSamples
      }),
      cache,
      plan,
      warnings,
      error: explicitValue ? `未能解析用户指定的 Comp“${explicitValue}”` : null
    };
  }

  const defaultComp = buildDefaultCompContext(response, {
    unit: query.unit,
    minSamples: query.minSamples,
    catalog
  });
  const selection = defaultComp.selection;
  if (explicitValue) {
    const explicit = resolveExplicitComp(explicitValue, selection.candidates, {
      unit: query.unit,
      catalog
    });
    if (!explicit) {
      return {
        value: createUnavailableCompConstraint({
          reason: "explicit_comp_not_found",
          stabilityThreshold: query.minSamples
        }),
        cache,
        plan,
        warnings,
        error: `未找到与“${explicitValue}”匹配且包含当前英雄的 Comp`
      };
    }
    return {
      value: createAppliedCompConstraint(explicit, {
        selection: "explicit",
        source: explicitSource
      }),
      cache,
      plan,
      warnings
    };
  }

  return {
    value: defaultComp.constraint,
    cache,
    plan,
    warnings,
    selection
  };
}

function serializeResultIds(rankedBuilds) {
  return rankedBuilds
    .slice(0, 3)
    .map((build) => build.raw?.unit_builds ?? build.raw?.unit_build ?? build.items.join("|"));
}

async function writeLastQuerySession(result, options) {
  if (options.useSession === false) return null;
  const pendingComparison = options.allowPendingComparison === true
    && result.query?.intent === "unit_item_comparison"
    && Boolean(result.query?.unit);
  if (!result.validation?.valid && !pendingComparison) return null;

  return setStoreEntry(sessionStoreFor(options), "setSessionState", sessionKeyFor(options), {
    query: serializeQueryForSession(result.query),
    lastResultIds: serializeResultIds(result.rankedBuilds),
    updatedAt: new Date().toISOString()
  }, {
    ttlMs: options.sessionTtlMs
  });
}

export function createRecommendationFromRows(input, responseOrRows, options = {}) {
  const catalog = catalogFor(options);
  const parsed = options.parsed ?? parseQuery(input, {
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
    sessionContext: parsed.sessionContext ?? null,
    warnings: [
      ...query.warnings,
      ...validation.warnings,
      ...(options.additionalWarnings ?? [])
    ]
  };
  const plan = validation.valid ? planMetaTFTUnitBuilds(validatedQuery) : null;
  const entityCandidates = buildClarificationEntityCandidates(input, parsed, validatedQuery, catalog, options);
  const clarification = evaluateClarification(parsed, validatedQuery, validation, {
    catalog,
    entityCandidates
  });

  if (!validation.valid || clarification.blocking) {
    return attachRetrievalAudit({
      type: responseTypeForQuery(validatedQuery, clarification),
      parsed,
      query: validatedQuery,
      validation,
      plan,
      clarification,
      filteredBuilds: [],
      rankedBuilds: [],
      results: [],
      overlap: null,
      decision: null,
      text: clarification.needsClarification
        ? clarification.question
        : `无法查询：${validation.errors.join("；")}`
    }, input, catalog);
  }

  const localDecision = unavailableItemDecision(validatedQuery, catalog);
  if (localDecision) {
    return attachRetrievalAudit({
      type: responseTypeForQuery(validatedQuery),
      parsed,
      query: validatedQuery,
      validation,
      plan: null,
      clarification,
      localDecision,
      rows: [],
      filteredBuilds: [],
      rankedBuilds: [],
      results: [],
      overlap: null,
      decision: localDecision,
      text: localDecision.text
    }, input, catalog);
  }

  const rows = normalizeUnitBuildRows(responseOrRows);
  const filtered = filterBuildRows(rows, validatedQuery, { catalog });
  const comparison = compareItemOptions(filtered.builds, validatedQuery, {
    catalog,
    evidenceReliable: options.evidenceReliable !== false,
    maxOverlapRate: options.comparisonOptions?.maxOverlapRate,
    materialThresholds: options.comparisonOptions?.materialThresholds
  });
  const itemRanking = ["unit_item_rankings", "unit_emblem_rankings"].includes(validatedQuery.intent)
    ? aggregateUnitItemRankings(filtered.builds, validatedQuery, { catalog })
    : null;
  const rankedBuilds = itemRanking
    ? []
    : comparison
    ? comparisonRankedBuilds(comparison)
    : rankBuilds(filtered.builds, validatedQuery);
  const text = itemRanking
    ? formatItemRankingText(itemRanking, validatedQuery, catalog)
    : formatRecommendation(rankedBuilds, validatedQuery, {
      catalog,
      warnings: filtered.warnings,
      comparison
    });

  return attachRetrievalAudit({
    type: responseTypeForQuery(validatedQuery),
    parsed,
    query: validatedQuery,
    validation,
    clarification,
    plan,
    rows,
    filteredBuilds: filtered.builds,
    rankedBuilds,
    itemRankings: itemRanking?.rankings ?? [],
    itemRankingReferences: itemRanking?.references ?? [],
    itemRankingMethodology: itemRanking ? {
      methodology: itemRanking.methodology,
      totalGames: itemRanking.totalGames,
      completeBuildCount: itemRanking.completeBuildCount,
      coverageReliable: itemRanking.coverageReliable
    } : null,
    comparison,
    results: comparison?.entries ?? [],
    overlap: comparison?.overlap ?? null,
    decision: comparison?.decision ?? null,
    source: {
      provider: "MetaTFT",
      endpoint: "tft-explorer-api/unit_builds",
      patch: validatedQuery.patch ?? null,
      updatedAt: null,
      cache: "provided"
    },
    text
  }, input, catalog);
}

export async function recommendForInput(input, options = {}) {
  const catalog = catalogFor(options);
  const cacheStore = options.cacheStore ?? null;
  const initialSessionEntry = options.useSession === false
    ? null
    : await getStoreEntry(sessionStoreFor(options), "getSessionState", sessionKeyFor(options));
  let deterministicParsed = parseQueryDeterministically(input, options, catalog);
  deterministicParsed = await applySemanticIntentHint(input, deterministicParsed, options);
  deterministicParsed = await applySemanticEntityHints(input, deterministicParsed, options, catalog);
  const structuredParserNeededBeforeSession = shouldUseStructuredParser(deterministicParsed, options);
  const initialCompSessionMerge = inheritCompRankingFromSession(
    deterministicParsed,
    initialSessionEntry?.value,
    options
  );
  const initialUnitSessionMerge = !isCompIntent(initialCompSessionMerge.parsed.intent)
    && canPreinheritUnitFollowUp(initialCompSessionMerge.parsed)
    ? inheritParsedFromSession(initialCompSessionMerge.parsed, initialSessionEntry?.value)
    : { parsed: initialCompSessionMerge.parsed, inherited: false, inheritedKeys: [] };
  let parsedInput = await parseQueryWithOptionalStructuredParser(
    input,
    {
      ...options,
      forceStructuredParser: Boolean(options.forceStructuredParser || structuredParserNeededBeforeSession)
    },
    catalog,
    initialUnitSessionMerge.parsed
  );
  const compSessionMerge = initialCompSessionMerge.inherited
    ? {
      parsed: parsedInput,
      inherited: true,
      inheritedKeys: initialCompSessionMerge.inheritedKeys
    }
    : inheritCompRankingFromSession(parsedInput, initialSessionEntry?.value, options);
  parsedInput = compSessionMerge.parsed;

  if (isCompIntent(parsedInput.intent)) {
    const query = buildCompRankingQuery(parsedInput, {
      preferences: options.preferences,
      // v3 accepts MetaTFT's reproducible page calculation and distinguishes it
      // from both a raw legacy field and local 72-hour history.
      dataVersion: options.compDataVersion ?? "comp-trend-gate-v3"
    });
    query.sort = parsedInput.sort;
    query.sessionContext = parsedInput.sessionContext ?? null;
    query.constraintSources = Object.fromEntries(
      ["rankFilter", "days", "patch", "queue", "minSamples", "sort", "metrics", "limit"]
        .map((key) => [key, compConstraintSource(parsedInput, options, key)])
    );
    const retrievalAudit = createRetrievalAudit({
      parsed: parsedInput,
      query,
      validation: { valid: true, errors: [], warnings: [] },
      clarification: null
    }, input, catalog, options.retrievalPlanner ?? RETRIEVAL_PLANNER);
    if (!retrievalAudit.retrievalPlan || retrievalAudit.retrievalPlan.needsClarification) {
      throw new Error("A valid RetrievalPlan is required before structured retrieval");
    }
    const queryCacheKey = makeQueryCacheKey(query);
    let response = options.compResponse ?? options.response;
    let queryCache = { key: queryCacheKey, hit: false };
    const warnings = [];

    if (response === undefined && !options.bypassQueryCache) {
      const cached = await getStoreEntry(cacheStore, "getQuery", queryCacheKey);
      if (cached?.value?.response !== undefined) {
        response = cached.value.response;
        queryCache = {
          key: queryCacheKey,
          hit: true,
          updatedAt: cached.updatedAt,
          expiresAt: cached.expiresAt
        };
      }
    }

    if (response === undefined) {
      try {
        const operation = query.intent === "comp_trends" ? "comps_trends" : "comps_rankings";
        const retrieved = await executePlannedStructuredQuery(
          retrievalAudit.retrievalPlan,
          operation,
          async (params) => {
            const dataParams = { queue: params.queue };
            const statsParams = {
              queue: params.queue,
              patch: params.patch,
              days: params.days,
              permit_filter_adjustment: "true"
            };
            if (params.queue === "1100" && params.rank?.length > 0) {
              statsParams.rank = [...params.rank].sort().join(",");
            }
            const client = options.compsClient;
            if (typeof client?.getCompsData !== "function" || typeof client?.getCompsStats !== "function") {
              throw new Error("comp rankings require a comps client with getCompsData() and getCompsStats()");
            }
            let compsData = await client.getCompsData(dataParams);
            let dataClusterId = compsData?.results?.data?.cluster_id ?? compsData?.cluster_id;
            let compsStats = await client.getCompsStats({
              ...statsParams,
              ...(dataClusterId !== undefined && dataClusterId !== null ? { cluster_id: dataClusterId } : {})
            });
            const statsClusterId = compsStats?.cluster_id ?? compsStats?.data?.cluster_id;
            if (dataClusterId !== undefined && statsClusterId !== undefined
              && String(dataClusterId) !== String(statsClusterId)) {
              compsData = await client.getCompsData(dataParams);
              dataClusterId = compsData?.results?.data?.cluster_id ?? compsData?.cluster_id;
              compsStats = await client.getCompsStats({
                ...statsParams,
                ...(dataClusterId !== undefined && dataClusterId !== null ? { cluster_id: dataClusterId } : {})
              });
            }
            const finalStatsClusterId = compsStats?.cluster_id ?? compsStats?.data?.cluster_id;
            if (dataClusterId !== undefined && finalStatsClusterId !== undefined
              && String(dataClusterId) !== String(finalStatsClusterId)) {
              throw new Error(`MetaTFT comps cluster mismatch after retry: data=${dataClusterId}, stats=${finalStatsClusterId}`);
            }
            return {
              response: createCompsPageSnapshot(compsData, compsStats),
              dataParams,
              statsParams,
              dataClusterId
            };
          },
          { intent: query.intent }
        );
        const { dataParams, statsParams, dataClusterId } = retrieved;
        response = retrieved.response;
        try {
          response = await enrichCompResponseWithTrendHistory(response, {
            query,
            cacheStore,
            now: options.now,
            recordSnapshot: true
          });
        } catch (trendError) {
          response.trend = {
            status: "unavailable",
            source: null,
            windowHours: 72,
            threshold: 0.1,
            officialCount: 0,
            localCount: 0,
            officialGate: response.officialTrendGate ?? null
          };
          warnings.push(`阵容趋势历史暂不可用：${trendError.message}`);
        }
        if (response !== undefined) {
          const stored = await setStoreEntry(cacheStore, "setQuery", queryCacheKey, {
            request: {
              endpoint: "/tft-comps-api/comps_stats",
              definitionEndpoint: "/tft-comps-api/comps_data",
              dataParams,
              statsParams: {
                ...statsParams,
                ...(dataClusterId !== undefined && dataClusterId !== null ? { cluster_id: dataClusterId } : {})
              }
            },
            response,
            source: "metatft",
            patch: query.patch
          }, { ttlMs: options.queryTtlMs });
          queryCache = {
            ...queryCache,
            updatedAt: stored?.updatedAt ?? new Date().toISOString(),
            expiresAt: stored?.expiresAt ?? null
          };
        }
      } catch (error) {
        const stale = await getStoreEntry(cacheStore, "getQuery", queryCacheKey, { allowExpired: true });
        if (stale?.value?.response === undefined) throw error;
        response = stale.value.response;
        queryCache = {
          key: queryCacheKey,
          hit: true,
          stale: true,
          updatedAt: stale.updatedAt,
          expiresAt: stale.expiresAt
        };
        warnings.push(`MetaTFT 请求失败，已使用 ${stale.updatedAt} 的过期阵容榜缓存`);
      }
    }

    if (!response) throw new Error("comp rankings require comps_data/comps_stats responses or a MetaTFT comps client");
    const result = buildCompRankings(response, {
      query,
      catalog,
      warnings
    });
    const decorated = decorateCompAssets(result, {
      resolver: options.assetResolver,
      catalog
    });
    decorated.parsed = parsedInput;
    const sessionWrite = options.useSession === false
      ? null
      : await setStoreEntry(sessionStoreFor(options), "setSessionState", sessionKeyFor(options), {
        query: decorated.query,
        lastResultIds: Object.values(decorated.rankings ?? {})
          .flat()
          .slice(0, 10)
          .map((comp) => comp.compId),
        updatedAt: new Date().toISOString()
      }, { ttlMs: options.sessionTtlMs });
    decorated.cache = {
      query: queryCache,
      session: {
        inherited: compSessionMerge.inherited,
        inheritedKeys: compSessionMerge.inheritedKeys,
        updatedAt: initialSessionEntry?.updatedAt ?? null,
        writtenAt: sessionWrite?.updatedAt ?? null
      }
    };
    decorated.text = "";
    attachRetrievalAudit(decorated, input, catalog, retrievalAudit);
    return decorated;
  }

  const sessionEntry = initialSessionEntry;
  const sessionMerge = initialUnitSessionMerge.inherited
    ? {
      parsed: parsedInput,
      inherited: true,
      inheritedKeys: initialUnitSessionMerge.inheritedKeys
    }
    : inheritParsedFromSession(parsedInput, sessionEntry?.value);
  const parsed = sessionMerge.parsed;
  const parsedUnavailableItems = unavailableItemRecords(referencedItemApiNames(parsed), catalog);
  const preflightEntityCandidates = buildClarificationEntityCandidates(input, parsed, {
    unit: parsed.unit
  }, catalog, options);
  const hasUnresolvedEntityHints = (parsed.parser?.unresolvedEntityHints ?? []).length > 0;
  const preflightQuery = buildQueryContext(parsed, {
    catalog,
    preferences: options.preferences
  });
  const preflightValidation = validateQueryContext(preflightQuery, { catalog });
  const preflightValidatedQuery = {
    ...preflightQuery,
    validation: preflightValidation,
    sessionContext: parsed.sessionContext ?? null,
    warnings: [...preflightQuery.warnings, ...preflightValidation.warnings]
  };
  const entityCandidates = preflightEntityCandidates;
  const preflightClarification = evaluateClarification(parsed, preflightValidatedQuery, preflightValidation, {
    catalog,
    entityCandidates
  });

  if (!preflightValidation.valid || preflightClarification.blocking) {
    const pendingComparison = preflightValidatedQuery.intent === "unit_item_comparison"
      && Boolean(preflightValidatedQuery.unit);
    if (pendingComparison) preflightValidatedQuery.pendingComparison = true;
    const result = {
      type: responseTypeForQuery(preflightValidatedQuery, preflightClarification),
      parsed,
      query: preflightValidatedQuery,
      validation: preflightValidation,
      plan: null,
      clarification: preflightClarification,
      filteredBuilds: [],
      rankedBuilds: [],
      cache: {
        session: {
          inherited: sessionMerge.inherited,
          inheritedKeys: sessionMerge.inheritedKeys,
          updatedAt: sessionEntry?.updatedAt
        },
        compCandidates: null,
        query: null
      },
      text: preflightClarification.needsClarification
        ? preflightClarification.question
        : `无法查询：${preflightValidation.errors.join("；")}`
    };
    const sessionWrite = await writeLastQuerySession(result, {
      ...options,
      allowPendingComparison: pendingComparison
    });
    if (sessionWrite) result.cache.session.writtenAt = sessionWrite.updatedAt;
    attachRetrievalAudit(result, input, catalog);
    return result;
  }

  const localDecision = unavailableItemDecision(preflightValidatedQuery, catalog);
  if (localDecision) {
    const result = {
      type: responseTypeForQuery(preflightValidatedQuery),
      parsed,
      query: preflightValidatedQuery,
      validation: preflightValidation,
      plan: null,
      clarification: preflightClarification,
      localDecision,
      rows: [],
      filteredBuilds: [],
      rankedBuilds: [],
      cache: {
        session: {
          inherited: sessionMerge.inherited,
          inheritedKeys: sessionMerge.inheritedKeys,
          updatedAt: sessionEntry?.updatedAt
        },
        compCandidates: null,
        query: null
      },
      text: localDecision.text
    };
    const sessionWrite = await writeLastQuerySession(result, options);
    if (sessionWrite) result.cache.session.writtenAt = sessionWrite.updatedAt;
    attachRetrievalAudit(result, input, catalog);
    return result;
  }

  const preflightRetrievalAudit = createRetrievalAudit({
    parsed,
    query: preflightValidatedQuery,
    validation: preflightValidation,
    clarification: preflightClarification
  }, input, catalog, options.retrievalPlanner ?? RETRIEVAL_PLANNER);
  const compResult = parsedUnavailableItems.length > 0 || hasUnresolvedEntityHints
    ? { value: null, cache: null, warnings: [] }
    : await resolveCompConstraint(preflightValidatedQuery, parsed, {
      ...options,
      retrievalPlan: preflightRetrievalAudit.retrievalPlan
    }, catalog);
  const query = buildQueryContext(parsed, {
    catalog,
    preferences: options.preferences,
    comp: compResult.value
  });
  const validation = validateQueryContext(query, { catalog });
  if (compResult.error) {
    validation.valid = false;
    validation.errors = [...validation.errors, compResult.error];
  }
  const validatedQuery = {
    ...query,
    validation,
    sessionContext: parsed.sessionContext ?? null,
    warnings: [
      ...query.warnings,
      ...validation.warnings,
      ...(compResult.warnings ?? [])
    ]
  };
  const plan = validation.valid ? planMetaTFTUnitBuilds(validatedQuery) : null;
  const clarification = evaluateClarification(parsed, validatedQuery, validation, {
    catalog,
    entityCandidates
  });

  if (!validation.valid || clarification.blocking) {
    const pendingComparison = validatedQuery.intent === "unit_item_comparison"
      && Boolean(validatedQuery.unit);
    if (pendingComparison) validatedQuery.pendingComparison = true;
    const result = {
      type: responseTypeForQuery(validatedQuery, clarification),
      parsed,
      query: validatedQuery,
      validation,
      plan,
      clarification,
      filteredBuilds: [],
      rankedBuilds: [],
      results: [],
      overlap: null,
      decision: null,
      cache: {
        session: {
          inherited: sessionMerge.inherited,
          inheritedKeys: sessionMerge.inheritedKeys,
          updatedAt: sessionEntry?.updatedAt
        },
        compCandidates: compResult.cache,
        query: null
      },
      text: clarification.needsClarification
        ? clarification.question
        : `无法查询：${validation.errors.join("；")}`
    };
    const sessionWrite = await writeLastQuerySession(result, {
      ...options,
      allowPendingComparison: pendingComparison
    });
    if (sessionWrite) result.cache.session.writtenAt = sessionWrite.updatedAt;
    attachRetrievalAudit(result, input, catalog);
    return result;
  }

  const finalRetrievalAudit = createRetrievalAudit({
    parsed,
    query: validatedQuery,
    validation,
    clarification
  }, input, catalog, options.retrievalPlanner ?? RETRIEVAL_PLANNER);
  if (!finalRetrievalAudit.retrievalPlan || finalRetrievalAudit.retrievalPlan.needsClarification) {
    throw new Error("A valid RetrievalPlan is required before structured retrieval");
  }
  const queryCacheKey = makeQueryCacheKey(validatedQuery);
  let queryCache = {
    key: queryCacheKey,
    hit: false
  };
  let response = options.response ?? options.rows;
  const additionalWarnings = [];

  if (response === undefined && !options.bypassQueryCache) {
    const cached = await getStoreEntry(cacheStore, "getQuery", queryCacheKey);
    if (cached?.value?.response !== undefined) {
      response = cached.value.response;
      queryCache = {
        key: queryCacheKey,
        hit: true,
        updatedAt: cached.updatedAt,
        expiresAt: cached.expiresAt
      };
    }
  }

  if (response === undefined) {
    try {
      response = await executePlannedStructuredQuery(
        finalRetrievalAudit.retrievalPlan,
        "unit_builds",
        async (params) => {
          const plannedQuery = {
            ...validatedQuery,
            unit: params.unit,
            days: params.days,
            patch: params.patch,
            queue: params.queue,
            rankFilter: params.rank,
            starLevel: params.starLevel,
            itemCount: params.itemCount,
            traitFilters: params.traitFilters,
            comp: params.comp,
            itemPolicy: params.itemPolicy,
            itemCategories: params.itemCategories,
            lockedItems: params.lockedItems,
            ownedItems: params.lockedItems,
            excludedItems: params.excludedItems,
            comparisonItems: params.comparisonItems,
            minSamples: params.minSamples
          };
          return options.metaTFTClient?.getUnitBuilds(planMetaTFTUnitBuilds(plannedQuery));
        },
        { intent: validatedQuery.intent }
      );
      if (response !== undefined) {
        const stored = await setStoreEntry(cacheStore, "setQuery", queryCacheKey, {
          request: plan,
          response,
          source: "metatft",
          patch: validatedQuery.patch
        }, {
          ttlMs: options.queryTtlMs
        });
        queryCache = {
          ...queryCache,
          updatedAt: stored?.updatedAt
            ?? response.capture?.capturedAt
            ?? response.capture?.captured_at
            ?? new Date().toISOString(),
          expiresAt: stored?.expiresAt ?? null
        };
      }
    } catch (error) {
      const stale = await getStoreEntry(cacheStore, "getQuery", queryCacheKey, {
        allowExpired: true
      });
      if (stale?.value?.response === undefined) throw error;

      response = stale.value.response;
      queryCache = {
        key: queryCacheKey,
        hit: true,
        stale: true,
        updatedAt: stale.updatedAt,
        expiresAt: stale.expiresAt
      };
      additionalWarnings.push(`MetaTFT 请求失败，已使用 ${stale.updatedAt} 的缓存结果`);
    }
  }

  if (!response) {
    throw new Error("recommendForInput requires rows/response or a metaTFTClient");
  }

  const result = createRecommendationFromRows(input, response, {
    catalog,
    parsed,
    preferences: options.preferences,
    evidenceReliable: queryCache.stale !== true,
    comparisonOptions: options.comparisonOptions,
    comp: validatedQuery.comp,
    additionalWarnings: [...(compResult.warnings ?? []), ...additionalWarnings]
  });
  result.sourceUpdatedAt = response.capture?.capturedAt
    ?? response.capture?.captured_at
    ?? queryCache.updatedAt
    ?? options.sourceUpdatedAt
    ?? null;
  result.compCandidatePlan = compResult.plan ?? null;

  result.cache = {
    session: {
      inherited: sessionMerge.inherited,
      inheritedKeys: sessionMerge.inheritedKeys,
      updatedAt: sessionEntry?.updatedAt
    },
    compCandidates: compResult.cache,
    query: queryCache
  };
  result.source = {
    provider: "MetaTFT",
    endpoint: "tft-explorer-api/unit_builds",
    patch: result.query?.patch ?? null,
    updatedAt: queryCache.updatedAt ?? null,
    cache: queryCache.stale ? "stale" : queryCache.hit ? "cache" : "live",
    cacheDetail: queryCache
  };

  const sessionWrite = await writeLastQuerySession(result, options);
  if (sessionWrite) {
    result.cache.session.writtenAt = sessionWrite.updatedAt;
  }

  return attachRetrievalAudit(result, input, catalog, finalRetrievalAudit);
}
