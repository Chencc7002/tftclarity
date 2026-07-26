function definedEntries(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function uniqueValues(value) {
  if (!Array.isArray(value)) return value;
  const seen = new Set();
  return value.filter((entry) => {
    const key = typeof entry === "string" ? entry : JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function compileTftToolArguments(tool, query = {}) {
  if (tool === "unit_builds") {
    return definedEntries({
      unit: query.unit,
      days: query.days,
      patch: query.patch,
      queue: query.queue,
      rank: uniqueValues(query.rankFilter),
      starLevel: uniqueValues(query.starLevel),
      itemCount: query.itemCount,
      traitFilters: uniqueValues(query.traitFilters),
      comp: query.comp,
      itemPolicy: query.itemPolicy,
      itemCategories: uniqueValues(query.itemCategories),
      lockedItems: uniqueValues(query.lockedItems ?? query.ownedItems),
      excludedItems: uniqueValues(query.excludedItems),
      comparisonItems: uniqueValues(query.comparisonItems),
      minSamples: query.minSamples
    });
  }
  if (["comps_rankings", "comps_trends", "comps_analysis"].includes(tool)) {
    return definedEntries({
      days: query.days,
      patch: query.patch,
      queue: query.queue,
      rank: uniqueValues(query.rankFilter),
      minSamples: query.minSamples,
      metrics: query.metrics,
      limit: query.limit,
      strategy: query.preferenceConditions?.strategy
    });
  }
  return {};
}
