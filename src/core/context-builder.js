import { DEFAULT_QUERY_OPTIONS, createCatalog } from "../data/static-data.js";

function sourceLabel(isUserProvided, preferenceProvided = false) {
  if (isUserProvided) return "current_input";
  return preferenceProvided ? "preference" : "system_default";
}

function fieldSource(parsedQuery, key, isUserProvided, preferenceProvided = false) {
  if (parsedQuery.sessionContext?.inheritedKeys?.includes(key)) return "conversation";
  return sourceLabel(isUserProvided, preferenceProvided);
}

function confidenceForSource(source) {
  return {
    current_input: 1,
    conversation: 0.96,
    preference: 0.9,
    default_context: 0.78,
    system_default: 1
  }[source] ?? 0.8;
}

function sourcedConstraint(key, value, source) {
  return { key, value, source, confidence: confidenceForSource(source) };
}

function originLabel(source) {
  if (source === "session") return "conversation";
  if (source === "user") return "current_input";
  if (source === "preference") return "preference";
  return "system_default";
}

export function buildQueryContext(parsedQuery, options = {}) {
  const catalog = options.catalog ?? createCatalog();
  const preferences = {
    ...DEFAULT_QUERY_OPTIONS,
    ...(options.preferences ?? {})
  };
  const preferenceKeys = new Set(Object.keys(options.preferences ?? {}));
  const defaultContext = options.defaultContext ?? null;
  const comp = options.comp ?? parsedQuery.comp ?? null;
  const warnings = (parsedQuery.parser?.highConfidenceEntityResolutions ?? []).map((resolution) => (
    `已按高置信模糊匹配识别“${resolution.inputFragment}”为“${resolution.label ?? resolution.matchedAlias ?? resolution.apiName}”`
  ));

  const explicitTraitFilters = parsedQuery.traitFilters ?? [];
  const automaticCompTraits = comp?.status === "applied"
    && comp.value?.selection === "automatic"
    && explicitTraitFilters.length === 0
    ? comp.value.traits ?? []
    : [];
  const traitFilters = explicitTraitFilters;
  if (comp?.status === "not_available") {
    warnings.push("当前条件下未找到达到稳定门槛的 Comp；以下结果未限制 Comp。");
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

  const traitSource = parsedQuery.sessionContext?.inheritedKeys?.includes("traitFilters")
    ? "conversation"
      : explicitTraitFilters.length
        ? "current_input"
        : "system_default";
  const assumptions = [
    sourcedConstraint("unit", parsedQuery.unit, fieldSource(parsedQuery, "unit", Boolean(parsedQuery.unitAlias))),
    sourcedConstraint("star_level", starLevel, fieldSource(parsedQuery, "starLevel", Boolean(parsedQuery.starLevel?.length))),
    sourcedConstraint("item_count", itemCount, fieldSource(parsedQuery, "itemCount", parsedQuery.itemCount !== undefined)),
    sourcedConstraint("item_policy", itemPolicy, fieldSource(parsedQuery, "itemPolicy", Boolean(parsedQuery.itemPolicy), preferenceKeys.has("itemPolicy"))),
    sourcedConstraint("trait_filters", traitFilters, traitSource),
    sourcedConstraint("owned_items", parsedQuery.lockedItems ?? parsedQuery.ownedItems ?? [], fieldSource(parsedQuery, "lockedItems", Boolean((parsedQuery.lockedItems ?? parsedQuery.ownedItems)?.length))),
    sourcedConstraint("locked_items", parsedQuery.lockedItems ?? parsedQuery.ownedItems ?? [], fieldSource(parsedQuery, "lockedItems", Boolean((parsedQuery.lockedItems ?? parsedQuery.ownedItems)?.length))),
    sourcedConstraint("comparison_items", parsedQuery.comparisonItems ?? [], fieldSource(parsedQuery, "comparisonItems", Boolean(parsedQuery.comparisonItems?.length))),
    sourcedConstraint("excluded_items", parsedQuery.excludedItems ?? [], fieldSource(parsedQuery, "excludedItems", Boolean(parsedQuery.excludedItems?.length))),
    sourcedConstraint("primary_metric", parsedQuery.primaryMetric, fieldSource(parsedQuery, "primaryMetric", Boolean(parsedQuery.primaryMetric))),
    sourcedConstraint("patch", patch, fieldSource(parsedQuery, "patch", Boolean(parsedQuery.patch))),
    sourcedConstraint("days", days, fieldSource(parsedQuery, "days", parsedQuery.days !== undefined, preferenceKeys.has("days"))),
    sourcedConstraint("rank_filter", rankFilter, fieldSource(parsedQuery, "rankFilter", Boolean(parsedQuery.rankFilter?.length), preferenceKeys.has("rankFilter"))),
    sourcedConstraint("min_samples", minSamples, fieldSource(parsedQuery, "minSamples", parsedQuery.minSamples !== undefined, preferenceKeys.has("minSamples"))),
    sourcedConstraint("sort", sort, fieldSource(parsedQuery, "sort", Boolean(parsedQuery.sort), preferenceKeys.has("sort")))
  ].map((entry) => {
    const parsedKey = {
      star_level: "starLevel",
      item_count: "itemCount",
      item_policy: "itemPolicy",
      trait_filters: "traitFilters",
      rank_filter: "rankFilter",
      min_samples: "minSamples",
      locked_items: "lockedItems",
      comparison_items: "comparisonItems",
      excluded_items: "excludedItems",
      primary_metric: "primaryMetric"
    }[entry.key] ?? entry.key;
    const origins = parsedQuery.sessionContext?.fieldOrigins?.[parsedKey] ?? [entry.source];
    return { ...entry, origin: origins[0], origins };
  });
  const lockedItems = parsedQuery.lockedItems ?? parsedQuery.ownedItems ?? [];
  const comparisonItems = parsedQuery.comparisonItems
    ?? parsedQuery.parser?.comparison?.itemApiNames
    ?? [];
  const comparisonMode = parsedQuery.comparisonMode
    ?? (parsedQuery.parser?.comparison?.requested ? "exclusive_presence" : undefined);
  const constraints = Object.fromEntries(assumptions.map(({ key, value, source, confidence }) => [
    key,
    { value, source, confidence }
  ]));
  if (comp) constraints.comp = { ...comp };

  return {
    rawInput: parsedQuery.rawInput,
    intent: parsedQuery.intent,
    unit: parsedQuery.unit,
    unitAlias: parsedQuery.unitAlias,
    starLevel,
    itemCount,
    traitFilters,
    comp,
    itemPolicy,
    lockedItems,
    comparisonItems,
    comparisonMode,
    primaryMetric: parsedQuery.primaryMetric,
    pendingComparison: Boolean(parsedQuery.pendingComparison),
    ownedItems: lockedItems,
    excludedItems: parsedQuery.excludedItems ?? [],
    comparison: parsedQuery.parser?.comparison ?? {
      requested: comparisonItems.length > 0,
      itemApiNames: comparisonItems,
      ownedItemApiNames: lockedItems
    },
    rankFilter,
    days,
    patch,
    queue,
    minSamples,
    sort,
    assumptions,
    constraints,
    constraintSources: {
      ...Object.fromEntries(assumptions.map(({ key, source, confidence }) => [
        key,
        { source, confidence }
      ])),
      locked_items: assumptions.find((entry) => entry.key === "locked_items")?.origins ?? [],
      comparison_items: assumptions.find((entry) => entry.key === "comparison_items")?.origins ?? [],
      excluded_items: assumptions.find((entry) => entry.key === "excluded_items")?.origins ?? [],
      primary_metric: assumptions.find((entry) => entry.key === "primary_metric")?.origins ?? [],
      ...(comp ? { comp: { source: comp.source, confidence: comp.confidence, status: comp.status } } : {})
    },
    warnings,
    defaultContext: defaultContext ?? (automaticCompTraits.length > 0
      ? {
        found: true,
        clusterId: comp.value.id,
        compName: comp.value.name,
        units: comp.value.units,
        traitFilters: automaticCompTraits,
        sourceEndpoint: comp.value.sourceEndpoint,
        source: "system_default"
      }
      : null),
    catalogVersion: catalog.version ?? "seed"
  };
}
