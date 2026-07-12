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
import { buildCompRankingQuery } from "./comp-query.js";
import { buildCompRankings } from "./comp-ranking-service.js";
import { decorateCompAssets } from "../data/asset-resolver.js";

export const SESSION_LAST_QUERY_KEY = "last_query";

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
    ...(query?.ownedItems ?? []),
    ...(query?.comparison?.itemApiNames ?? []),
    ...(query?.parser?.comparison?.itemApiNames ?? [])
  ]);
}

function unavailableItemDecision(query, catalog) {
  const items = unavailableItemRecords(referencedItemApiNames(query), catalog);
  if (items.length === 0) return null;

  const names = items.map((item) => item.shortName ?? item.zhName ?? item.apiName);
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

function itemLabel(apiName, catalog) {
  const item = catalog.itemByApiName.get(apiName);
  return item?.zhName ?? item?.shortName ?? apiName;
}

function formatItemRankingText(aggregation, query, catalog) {
  const best = aggregation.rankings[0];
  if (!best) return `没有单件装备达到样本阈值 ${query.minSamples}。`;
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

function structuredParserFor(options) {
  const parser = options.structuredParser;
  if (!parser) return null;
  if (typeof parser === "function") return parser;
  if (typeof parser.parse === "function") return parser.parse.bind(parser);
  if (typeof parser.parseQuery === "function") return parser.parseQuery.bind(parser);
  return null;
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

  if (structured.intent === "comp_rankings" && !parsed.unit) {
    next.intent = "comp_rankings";
    applied.push("intent");
  }

  if (!next.unit && reparsed.unit) {
    next.unit = reparsed.unit;
    next.unitAlias = reparsed.unitAlias;
    applied.push("unit");
  }
  applyArray("traitFilters", uniqueArray([...(parsed.traitFilters ?? []), ...(reparsed.traitFilters ?? [])]));
  applyArray("ownedItems", uniqueArray([...(parsed.ownedItems ?? []), ...(reparsed.ownedItems ?? [])]));
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
    next.ownedItems = asArray(next.ownedItems).filter((item) => !excludedItems.includes(item));
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
  applyArray("metrics", structured.constraints.metrics);
  applyScalar("limit", structured.constraints.limit);

  return next;
}

async function parseQueryWithOptionalStructuredParser(input, options, catalog) {
  const parsed = parseQuery(input, {
    catalog,
    highConfidenceFuzzy: options.highConfidenceFuzzy,
    compQuery: options.preferences
  });
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
  if (options.useEntityCandidateRetriever === false) return [];

  const retriever = options.entityCandidateRetriever ?? retrieveEntityCandidates;
  if (typeof retriever !== "function") return [];

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

function inheritParsedFromSession(parsed, sessionValue) {
  if (parsed.unit) {
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

  const lastQuery = lastQueryFromSession(sessionValue);
  if (!lastQuery?.unit) {
    return {
      parsed,
      inherited: false,
      inheritedKeys: []
    };
  }

  const inheritedKeys = [];
  const explicitlyOwnedItems = asArray(parsed.ownedItems);
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

  next.unit = lastQuery.unit;
  inheritedKeys.push("unit");
  if (!parsed.parser?.intentExplicit && lastQuery.intent) {
    next.intent = lastQuery.intent;
    inheritedKeys.push("intent");
  }
  inheritArray("starLevel", "starLevel", "star_level");
  inheritScalar("itemCount", "itemCount", "item_count");
  if (!lastQuery.defaultContext) {
    inheritArray("traitFilters", "traitFilters", "trait_filters");
  }
  if (!next.compMention && lastQuery.comp?.status === "applied" && lastQuery.comp?.value?.selection === "explicit") {
    next.comp = lastQuery.comp;
    inheritedKeys.push("comp");
  }
  inheritArray("ownedItems", "ownedItems", "owned_items");
  inheritArray("excludedItems", "excludedItems", "excluded_items");
  if (explicitlyExcludedItems.length > 0) {
    next.ownedItems = asArray(next.ownedItems)
      .filter((item) => !explicitlyExcludedItems.includes(item));
  }
  if (explicitlyOwnedItems.length > 0) {
    next.excludedItems = asArray(next.excludedItems)
      .filter((item) => !explicitlyOwnedItems.includes(item));
  }
  inheritScalar("itemPolicy", "itemPolicy", "item_policy");
  inheritArray("rankFilter", "rankFilter", "rank");
  inheritScalar("days");
  inheritScalar("patch");
  inheritScalar("queue");
  inheritScalar("minSamples", "minSamples", "min_samples");
  inheritScalar("sort");

  next.sessionContext = {
    inherited: true,
    sourceKey: SESSION_LAST_QUERY_KEY,
    inheritedKeys
  };

  return {
    parsed: next,
    inherited: true,
    inheritedKeys
  };
}

function serializeQueryForSession(query) {
  return {
    intent: query.intent,
    unit: query.unit,
    starLevel: query.starLevel,
    itemCount: query.itemCount,
    traitFilters: query.traitFilters,
    comp: query.comp?.status === "applied" && query.comp?.value?.selection === "explicit"
      ? query.comp
      : null,
    ownedItems: query.ownedItems,
    excludedItems: query.excludedItems,
    itemPolicy: query.itemPolicy,
    rankFilter: query.rankFilter,
    days: query.days,
    patch: query.patch,
    queue: query.queue,
    minSamples: query.minSamples,
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
      response = typeof options.metaTFTClient.getCompCandidates === "function"
        ? await options.metaTFTClient.getCompCandidates(plan)
        : await options.metaTFTClient.getExactUnitsTraits2(plan.params);
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
  if (!result.validation?.valid) return null;

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
    return {
      type: responseTypeForQuery(validatedQuery, clarification),
      parsed,
      query: validatedQuery,
      validation,
      plan,
      clarification,
      filteredBuilds: [],
      rankedBuilds: [],
      text: clarification.needsClarification
        ? clarification.question
        : `无法查询：${validation.errors.join("；")}`
    };
  }

  const localDecision = unavailableItemDecision(validatedQuery, catalog);
  if (localDecision) {
    return {
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
      text: localDecision.text
    };
  }

  const rows = normalizeUnitBuildRows(responseOrRows);
  const filtered = filterBuildRows(rows, validatedQuery, { catalog });
  const itemRanking = validatedQuery.intent === "unit_item_rankings"
    ? aggregateUnitItemRankings(filtered.builds, validatedQuery)
    : null;
  const comparison = compareItemOptions(filtered.builds, validatedQuery, { catalog });
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

  return {
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
    text
  };
}

export async function recommendForInput(input, options = {}) {
  const catalog = catalogFor(options);
  const cacheStore = options.cacheStore ?? null;
  const parsedInput = await parseQueryWithOptionalStructuredParser(input, options, catalog);

  if (parsedInput.intent === "comp_rankings") {
    const query = buildCompRankingQuery(parsedInput, {
      preferences: options.preferences,
      dataVersion: options.compDataVersion
    });
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
      const params = {
        formatnoarray: "true",
        compact: "true",
        queue: query.queue,
        patch: query.patch,
        days: query.days,
        rank: query.rankFilter.join(",")
      };
      try {
        response = await options.metaTFTClient?.getExactUnitsTraits2(params);
        if (response !== undefined) {
          const stored = await setStoreEntry(cacheStore, "setQuery", queryCacheKey, {
            request: { endpoint: "/tft-explorer-api/exact_units_traits2", params },
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

    if (!response) throw new Error("comp rankings require exact_units_traits2 response or a MetaTFT client");
    const sourceUpdatedAt = response.capture?.capturedAt
      ?? queryCache.updatedAt
      ?? options.compsData?.updatedAt
      ?? options.compsData?.updated
      ?? options.sourceUpdatedAt
      ?? null;
    const result = buildCompRankings(response, {
      query,
      catalog,
      clusterResponse: options.compsData?.clusterInfo ?? options.clusterResponse,
      compBuildsResponse: options.compsData?.compBuilds ?? options.compBuildsResponse,
      sampleSize: Number(response.filter_adjustment?.sample_size ?? response.capture?.filterAdjustment?.sample_size),
      updatedAt: sourceUpdatedAt,
      warnings
    });
    const decorated = decorateCompAssets(result, {
      resolver: options.assetResolver,
      catalog
    });
    decorated.parsed = parsedInput;
    decorated.cache = { query: queryCache };
    decorated.text = "";
    return decorated;
  }

  const sessionEntry = options.useSession === false
    ? null
    : await getStoreEntry(sessionStoreFor(options), "getSessionState", sessionKeyFor(options));
  const sessionMerge = inheritParsedFromSession(parsedInput, sessionEntry?.value);
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
    return {
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
    return result;
  }

  const compResult = parsedUnavailableItems.length > 0 || hasUnresolvedEntityHints
    ? { value: null, cache: null, warnings: [] }
    : await resolveCompConstraint(preflightValidatedQuery, parsed, options, catalog);
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
    return {
      type: responseTypeForQuery(validatedQuery, clarification),
      parsed,
      query: validatedQuery,
      validation,
      plan,
      clarification,
      filteredBuilds: [],
      rankedBuilds: [],
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
      response = await options.metaTFTClient?.getUnitBuilds(plan);
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

  const sessionWrite = await writeLastQuerySession(result, options);
  if (sessionWrite) {
    result.cache.session.writtenAt = sessionWrite.updatedAt;
  }

  return result;
}
