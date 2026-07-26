function definedEntries(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

export function compileTftToolArguments(tool, query = {}) {
  if (tool === "unit_builds") {
    return definedEntries({
      unit: query.unit,
      days: query.days,
      patch: query.patch,
      queue: query.queue,
      rank: query.rankFilter,
      starLevel: query.starLevel,
      itemCount: query.itemCount,
      traitFilters: query.traitFilters,
      comp: query.comp,
      itemPolicy: query.itemPolicy,
      itemCategories: query.itemCategories,
      lockedItems: query.lockedItems ?? query.ownedItems,
      excludedItems: query.excludedItems,
      comparisonItems: query.comparisonItems,
      minSamples: query.minSamples
    });
  }
  if (["comps_rankings", "comps_trends", "comps_analysis"].includes(tool)) {
    return definedEntries({
      days: query.days,
      patch: query.patch,
      queue: query.queue,
      rank: query.rankFilter,
      minSamples: query.minSamples,
      metrics: query.metrics,
      limit: query.limit,
      strategy: query.preferenceConditions?.strategy
    });
  }
  return {};
}
