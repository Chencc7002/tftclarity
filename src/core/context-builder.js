import { DEFAULT_QUERY_OPTIONS, createCatalog } from "../data/static-data.js";

function sourceLabel(isUserProvided) {
  return isUserProvided ? "user" : "default";
}

function fieldSource(parsedQuery, key, isUserProvided) {
  if (parsedQuery.sessionContext?.inheritedKeys?.includes(key)) return "session";
  return sourceLabel(isUserProvided);
}

export function buildQueryContext(parsedQuery, options = {}) {
  const catalog = options.catalog ?? createCatalog();
  const preferences = {
    ...DEFAULT_QUERY_OPTIONS,
    ...(options.preferences ?? {})
  };
  const defaultContext = options.defaultContext ?? null;
  const warnings = (parsedQuery.parser?.highConfidenceEntityResolutions ?? []).map((resolution) => (
    `已按高置信模糊匹配识别“${resolution.inputFragment}”为“${resolution.label ?? resolution.matchedAlias ?? resolution.apiName}”`
  ));

  let traitFilters = parsedQuery.traitFilters ?? [];
  let defaultContextInfo = null;
  if (traitFilters.length === 0 && defaultContext?.found) {
    traitFilters = defaultContext.traitFilters ?? [];
    defaultContextInfo = defaultContext;
    if (defaultContext.warning) warnings.push(defaultContext.warning);
  } else if (traitFilters.length === 0 && defaultContext?.warning) {
    warnings.push(defaultContext.warning);
  }

  const starLevel = parsedQuery.starLevel?.length ? parsedQuery.starLevel : [2];
  const itemCount = parsedQuery.itemCount ?? 3;
  const itemPolicy = parsedQuery.itemPolicy ?? preferences.itemPolicy;
  const rankFilter = parsedQuery.rankFilter ?? preferences.rankFilter;
  const days = parsedQuery.days ?? preferences.days;
  const patch = parsedQuery.patch ?? preferences.patch;
  const queue = parsedQuery.queue ?? preferences.queue;
  const minSamples = parsedQuery.minSamples ?? preferences.minSamples;
  const sort = parsedQuery.sort ?? preferences.sort;

  const assumptions = [
    { key: "unit", value: parsedQuery.unit, source: fieldSource(parsedQuery, "unit", Boolean(parsedQuery.unitAlias)) },
    { key: "star_level", value: starLevel, source: fieldSource(parsedQuery, "starLevel", Boolean(parsedQuery.starLevel?.length)) },
    { key: "item_count", value: itemCount, source: fieldSource(parsedQuery, "itemCount", parsedQuery.itemCount !== undefined) },
    { key: "item_policy", value: itemPolicy, source: fieldSource(parsedQuery, "itemPolicy", Boolean(parsedQuery.itemPolicy)) },
    { key: "trait_filters", value: traitFilters, source: fieldSource(parsedQuery, "traitFilters", Boolean(parsedQuery.traitFilters?.length)) },
    { key: "patch", value: patch, source: fieldSource(parsedQuery, "patch", Boolean(parsedQuery.patch)) },
    { key: "days", value: days, source: fieldSource(parsedQuery, "days", Boolean(parsedQuery.days)) },
    { key: "rank_filter", value: rankFilter, source: fieldSource(parsedQuery, "rankFilter", Boolean(parsedQuery.rankFilter)) },
    { key: "min_samples", value: minSamples, source: fieldSource(parsedQuery, "minSamples", Boolean(parsedQuery.minSamples)) },
    { key: "sort", value: sort, source: fieldSource(parsedQuery, "sort", Boolean(parsedQuery.sort)) }
  ];

  return {
    rawInput: parsedQuery.rawInput,
    intent: parsedQuery.intent,
    unit: parsedQuery.unit,
    unitAlias: parsedQuery.unitAlias,
    starLevel,
    itemCount,
    traitFilters,
    itemPolicy,
    ownedItems: parsedQuery.ownedItems ?? [],
    excludedItems: parsedQuery.excludedItems ?? [],
    comparison: parsedQuery.parser?.comparison ?? {
      requested: false,
      itemApiNames: [],
      ownedItemApiNames: []
    },
    rankFilter,
    days,
    patch,
    queue,
    minSamples,
    sort,
    assumptions,
    warnings,
    defaultContext: defaultContextInfo,
    catalogVersion: catalog.version ?? "seed"
  };
}
