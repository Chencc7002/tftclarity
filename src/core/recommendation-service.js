import {
  DEFAULT_QUERY_OPTIONS,
  createCatalog
} from "../data/static-data.js";
import {
  makeDefaultContextCacheKey,
  makeQueryCacheKey
} from "../data/cache-store.js";
import {
  normalizeCompsData,
  normalizeCompBuildsResponse,
  normalizeCompOptionsResponse,
  normalizeLatestClusterInfoResponse,
  normalizeUnitBuildRows
} from "../data/metatft-response-adapter.js";
import {
  buildTraitCatalogFromCompsData,
  buildUnitCatalogFromCompsData
} from "../data/domain-catalog.js";
import { buildQueryContext } from "./context-builder.js";
import { evaluateClarification } from "./clarification-policy.js";
import {
  normalizeDefaultContextStrategy,
  normalizeSpecialContextMode,
  selectDefaultContextForUnit,
  validateDefaultContextCache
} from "./default-context-builder.js";
import { filterBuildRows } from "./item-policy-filter.js";
import { parseQuery } from "./query-parser.js";
import { planMetaTFTUnitBuilds } from "./query-planner.js";
import { validateQueryContext } from "./query-validator.js";
import { rankBuilds } from "./ranker.js";
import { compareItemOptions, comparisonRankedBuilds } from "./item-comparison.js";
import { formatRecommendation } from "./response-formatter.js";
import { normalizeAlias } from "./normalizer.js";
import {
  buildStructuredParserExpansion,
  shouldUseStructuredParser,
  validateStructuredParserOutput
} from "../llm/structured-parser.js";
import { retrieveEntityCandidates } from "../llm/entity-candidate-retriever.js";

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

function specialContextModeFor(parsed, defaultContextOptions = {}) {
  if (defaultContextOptions.specialContextMode !== undefined) {
    return normalizeSpecialContextMode(defaultContextOptions.specialContextMode);
  }
  if (defaultContextOptions.allowSpecialContexts === true) return "include";

  const input = String(parsed?.rawInput ?? "").toLowerCase();
  return /(?:\u4e13\u5c5e(?:\u5f3a\u5316|\u73a9\u6cd5|\u9635\u5bb9)?|\u82f1\u96c4\u5f3a\u5316|\u8d4c\u72d7|\bd\s*(?:\u724c|\u5361)\b|\u8ffd\u4e09|reroll)/i.test(input)
    ? "prefer"
    : "exclude";
}

function sessionStoreFor(options) {
  return options.sessionStore ?? options.cacheStore ?? null;
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

  return next;
}

async function parseQueryWithOptionalStructuredParser(input, options, catalog) {
  const parsed = parseQuery(input, {
    catalog,
    highConfidenceFuzzy: options.highConfidenceFuzzy
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
      highConfidenceFuzzy: options.highConfidenceFuzzy
    })
    : parseQuery(input, {
      catalog,
      highConfidenceFuzzy: options.highConfidenceFuzzy
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
  inheritArray("starLevel", "starLevel", "star_level");
  inheritScalar("itemCount", "itemCount", "item_count");
  if (!lastQuery.defaultContext) {
    inheritArray("traitFilters", "traitFilters", "trait_filters");
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
    unit: query.unit,
    starLevel: query.starLevel,
    itemCount: query.itemCount,
    traitFilters: query.traitFilters,
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

function serializeResultIds(rankedBuilds) {
  return rankedBuilds
    .slice(0, 3)
    .map((build) => build.raw?.unit_builds ?? build.raw?.unit_build ?? build.items.join("|"));
}

async function writeLastQuerySession(result, options) {
  if (options.useSession === false) return null;
  if (!result.validation?.valid) return null;

  return setStoreEntry(sessionStoreFor(options), "setSessionState", SESSION_LAST_QUERY_KEY, {
    query: serializeQueryForSession(result.query),
    lastResultIds: serializeResultIds(result.rankedBuilds),
    updatedAt: new Date().toISOString()
  }, {
    ttlMs: options.sessionTtlMs
  });
}

async function resolveDefaultContext(parsed, options) {
  if (options.defaultContext !== undefined) {
    return {
      value: options.defaultContext,
      cache: null
    };
  }

  if (!parsed.unit || parsed.traitFilters?.length) {
    return {
      value: null,
      cache: null
    };
  }

  const preferences = preferencesFor(options);
  const cacheStore = options.cacheStore ?? null;
  const minClusterSamples = options.defaultContextOptions?.minClusterSamples ?? 100;
  const defaultContextStrategy = normalizeDefaultContextStrategy(options.defaultContextOptions?.strategy);
  const defaultContextOptions = {
    ...(options.defaultContextOptions ?? {}),
    specialContextMode: specialContextModeFor(parsed, options.defaultContextOptions)
  };
  const cacheKey = makeDefaultContextCacheKey({
    unit: parsed.unit,
    patch: parsed.patch ?? preferences.patch,
    queue: parsed.queue ?? preferences.queue,
    days: parsed.days ?? preferences.days,
    rankFilter: parsed.rankFilter ?? preferences.rankFilter,
    minClusterSamples,
    strategy: defaultContextStrategy,
    specialContextMode: defaultContextOptions.specialContextMode
  });

  const cached = options.bypassDefaultContextCache
    ? null
    : await getStoreEntry(cacheStore, "getDefaultContext", cacheKey);
  if (cached) {
    if (options.compsData) {
      const normalizedCompsData = normalizeCompsData(options.compsData);
      const validation = validateDefaultContextCache(
        cached.value,
        parsed.unit,
        normalizedCompsData,
        {
          ...defaultContextOptions,
          compBuildsProvided: Object.hasOwn(options.compsData, "compBuilds")
        }
      );
      if (!validation.valid) {
        const context = validation.currentContext;
        if (context) {
          await setStoreEntry(cacheStore, "setDefaultContext", cacheKey, context, {
            ttlMs: options.defaultContextTtlMs
          });
        }

        return {
          value: context,
          cache: context
            ? {
              key: cacheKey,
              hit: false,
              invalidated: true,
              invalidationReason: validation.reason,
              previousClusterId: cached.value?.clusterId ?? null,
              clusterId: context.clusterId ?? null
            }
            : null
        };
      }
    }

    return {
      value: cached.value,
      cache: {
        key: cacheKey,
        hit: true,
        validated: Boolean(options.compsData),
        updatedAt: cached.updatedAt,
        expiresAt: cached.expiresAt
      }
    };
  }

  let context = null;
  if (options.compsData) {
    context = selectDefaultContextForUnit(parsed.unit, normalizeCompsData(options.compsData), defaultContextOptions);
  } else if (options.compsClient) {
    const [latestClusterInfo, compOptions] = await Promise.all([
      options.compsClient.getLatestClusterInfo?.({
        queue: preferences.queue,
        patch: preferences.patch
      }) ?? [],
      options.compsClient.getCompOptions?.({
        queue: preferences.queue,
        patch: preferences.patch
      }) ?? []
    ]);
    let compBuilds = [];
    if (defaultContextOptions.useCompBuilds !== false && typeof options.compsClient.getCompBuilds === "function") {
      try {
        compBuilds = normalizeCompBuildsResponse(await options.compsClient.getCompBuilds({
          queue: preferences.queue,
          patch: preferences.patch
        }));
      } catch {
        compBuilds = [];
      }
    }

    context = selectDefaultContextForUnit(parsed.unit, {
      clusterInfo: normalizeLatestClusterInfoResponse(latestClusterInfo),
      compOptions: normalizeCompOptionsResponse(compOptions),
      compBuilds
    }, defaultContextOptions);
  }

  if (context) {
    await setStoreEntry(cacheStore, "setDefaultContext", cacheKey, context, {
      ttlMs: options.defaultContextTtlMs
    });
  }

  return {
    value: context,
    cache: context
      ? {
        key: cacheKey,
        hit: false
      }
      : null
  };
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
    defaultContext: options.defaultContext
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
  const comparison = compareItemOptions(filtered.builds, validatedQuery, { catalog });
  const rankedBuilds = comparison
    ? comparisonRankedBuilds(comparison)
    : rankBuilds(filtered.builds, validatedQuery);
  const text = formatRecommendation(rankedBuilds, validatedQuery, {
    catalog,
    warnings: filtered.warnings,
    comparison
  });

  return {
    parsed,
    query: validatedQuery,
    validation,
    clarification,
    plan,
    rows,
    filteredBuilds: filtered.builds,
    rankedBuilds,
    comparison,
    text
  };
}

export async function recommendForInput(input, options = {}) {
  const catalog = catalogFor(options);
  const cacheStore = options.cacheStore ?? null;
  const sessionEntry = options.useSession === false
    ? null
    : await getStoreEntry(sessionStoreFor(options), "getSessionState", SESSION_LAST_QUERY_KEY);
  const parsedInput = await parseQueryWithOptionalStructuredParser(input, options, catalog);
  const sessionMerge = inheritParsedFromSession(parsedInput, sessionEntry?.value);
  const parsed = sessionMerge.parsed;
  const parsedUnavailableItems = unavailableItemRecords(referencedItemApiNames(parsed), catalog);
  const preflightEntityCandidates = buildClarificationEntityCandidates(input, parsed, {
    unit: parsed.unit
  }, catalog, options);
  const hasUnresolvedEntityHints = (parsed.parser?.unresolvedEntityHints ?? []).length > 0;
  const defaultContextResult = parsedUnavailableItems.length > 0 || hasUnresolvedEntityHints
    ? { value: null, cache: null }
    : await resolveDefaultContext(parsed, options);
  const defaultContext = defaultContextResult.value;
  const query = buildQueryContext(parsed, {
    catalog,
    preferences: options.preferences,
    defaultContext
  });
  const validation = validateQueryContext(query, { catalog });
  const validatedQuery = {
    ...query,
    validation,
    sessionContext: parsed.sessionContext ?? null,
    warnings: [...query.warnings, ...validation.warnings]
  };
  const plan = validation.valid ? planMetaTFTUnitBuilds(validatedQuery) : null;
  const entityCandidates = preflightEntityCandidates;
  const clarification = evaluateClarification(parsed, validatedQuery, validation, {
    catalog,
    entityCandidates
  });

  if (!validation.valid || clarification.blocking) {
    return {
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
        defaultContext: defaultContextResult.cache,
        query: null
      },
      text: clarification.needsClarification
        ? clarification.question
        : `无法查询：${validation.errors.join("；")}`
    };
  }

  const localDecision = unavailableItemDecision(validatedQuery, catalog);
  if (localDecision) {
    const result = {
      parsed,
      query: validatedQuery,
      validation,
      plan: null,
      clarification,
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
        defaultContext: null,
        query: null
      },
      text: localDecision.text
    };
    const sessionWrite = await writeLastQuerySession(result, options);
    if (sessionWrite) result.cache.session.writtenAt = sessionWrite.updatedAt;
    return result;
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
        await setStoreEntry(cacheStore, "setQuery", queryCacheKey, {
          request: plan,
          response,
          source: "metatft",
          patch: validatedQuery.patch
        }, {
          ttlMs: options.queryTtlMs
        });
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
    defaultContext,
    additionalWarnings
  });

  result.cache = {
    session: {
      inherited: sessionMerge.inherited,
      inheritedKeys: sessionMerge.inheritedKeys,
      updatedAt: sessionEntry?.updatedAt
    },
    defaultContext: defaultContextResult.cache,
    query: queryCache
  };

  const sessionWrite = await writeLastQuerySession(result, options);
  if (sessionWrite) {
    result.cache.session.writtenAt = sessionWrite.updatedAt;
  }

  return result;
}
