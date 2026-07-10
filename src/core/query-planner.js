import { DEFAULT_QUERY_OPTIONS } from "../data/static-data.js";

export function createUnitTierNumItemsParam(unitApiName, starLevels, itemCount) {
  return starLevels
    .map((star) => `${unitApiName}-1_${star}_${itemCount}`)
    .join(",");
}

export function planMetaTFTUnitBuilds(query) {
  const params = {
    formatnoarray: "true",
    compact: "true",
    queue: query.queue ?? DEFAULT_QUERY_OPTIONS.queue,
    patch: query.patch ?? DEFAULT_QUERY_OPTIONS.patch,
    days: String(query.days ?? DEFAULT_QUERY_OPTIONS.days),
    rank: (query.rankFilter ?? DEFAULT_QUERY_OPTIONS.rankFilter).join(","),
    unit_tier_numitems_unique: createUnitTierNumItemsParam(query.unit, query.starLevel, query.itemCount)
  };

  if (query.traitFilters?.length) {
    params.trait = query.traitFilters;
  }

  return {
    endpoint: "unit_builds",
    method: "GET",
    pathUnit: query.unit,
    path: `/tft-explorer-api/unit_builds/${encodeURIComponent(query.unit)}`,
    params
  };
}

export function buildUrl(baseUrl, plan) {
  const url = new URL(plan.path, baseUrl);
  for (const [key, value] of Object.entries(plan.params ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, value);
    }
  }
  return url;
}
