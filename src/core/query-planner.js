import { DEFAULT_QUERY_OPTIONS } from "../data/static-data.js";
import { compStructuredFilterParams } from "./comp-filter.js";

export function createUnitTierNumItemsParam(unitApiName, starLevels, itemCount) {
  return starLevels
    .map((star) => `${unitApiName}-1_${star}_${itemCount}`)
    .join(",");
}

export function planMetaTFTUnitBuilds(query) {
  if (String(query.queue ?? DEFAULT_QUERY_OPTIONS.queue).toUpperCase() === "PBE") {
    const [patch, buildPatch = ""] = String(query.patch ?? DEFAULT_QUERY_OPTIONS.patch).split("_", 2);
    return {
      endpoint: "unit_builds",
      method: "GET",
      pathUnit: query.unit,
      path: "/tft-stat-api/unit_detail_items",
      params: {
        queue: "PBE",
        patch,
        b_patch: buildPatch,
        days: String(query.days ?? DEFAULT_QUERY_OPTIONS.days),
        permit_filter_adjustment: "true",
        unit: query.unit,
        num_items: String(query.itemCount ?? DEFAULT_QUERY_OPTIONS.itemCount ?? 3)
      }
    };
  }

  const params = {
    formatnoarray: "true",
    compact: "true",
    queue: query.queue ?? DEFAULT_QUERY_OPTIONS.queue,
    patch: query.patch ?? DEFAULT_QUERY_OPTIONS.patch,
    days: String(query.days ?? DEFAULT_QUERY_OPTIONS.days),
    rank: (query.rankFilter ?? DEFAULT_QUERY_OPTIONS.rankFilter).join(","),
    permit_filter_adjustment: "true",
    unit_tier_numitems_unique: createUnitTierNumItemsParam(query.unit, query.starLevel, query.itemCount)
  };

  if (query.traitFilters?.length) {
    params.trait = query.traitFilters;
  }

  Object.assign(params, compStructuredFilterParams(query.comp));

  return {
    endpoint: "unit_builds",
    method: "GET",
    pathUnit: query.unit,
    path: `/tft-explorer-api/unit_builds/${encodeURIComponent(query.unit)}`,
    params
  };
}

export function planMetaTFTCompCandidates(query) {
  return {
    endpoint: "exact_units_traits2",
    method: "GET",
    path: "/tft-explorer-api/exact_units_traits2",
    params: {
      formatnoarray: "true",
      compact: "true",
      queue: query.queue ?? DEFAULT_QUERY_OPTIONS.queue,
      patch: query.patch ?? DEFAULT_QUERY_OPTIONS.patch,
      days: String(query.days ?? DEFAULT_QUERY_OPTIONS.days),
      rank: (query.rankFilter ?? DEFAULT_QUERY_OPTIONS.rankFilter).join(","),
      permit_filter_adjustment: "true",
      unit_unique: `${query.unit}-1`
    }
  };
}

export function planMetaTFTItemCarrierBuilds(query) {
  const item = String(query.item ?? "").trim();
  if (!item) throw new TypeError("planMetaTFTItemCarrierBuilds requires item");
  if (String(query.queue ?? DEFAULT_QUERY_OPTIONS.queue).toUpperCase() === "PBE") {
    const [patch, buildPatch = ""] = String(query.patch ?? DEFAULT_QUERY_OPTIONS.patch).split("_", 2);
    return {
      endpoint: "item_detail",
      method: "GET",
      path: "/tft-stat-api/item_detail",
      params: {
        queue: "PBE",
        patch,
        b_patch: buildPatch,
        days: String(query.days ?? DEFAULT_QUERY_OPTIONS.days),
        permit_filter_adjustment: "true",
        itemName: item
      }
    };
  }
  return {
    endpoint: "unit_builds",
    method: "GET",
    path: "/tft-explorer-api/unit_builds",
    params: {
      formatnoarray: "true",
      compact: "true",
      queue: query.queue ?? DEFAULT_QUERY_OPTIONS.queue,
      patch: query.patch ?? DEFAULT_QUERY_OPTIONS.patch,
      days: String(query.days ?? DEFAULT_QUERY_OPTIONS.days),
      rank: (query.rankFilter ?? DEFAULT_QUERY_OPTIONS.rankFilter).join(","),
      permit_filter_adjustment: "true",
      item_unique: `${item}-1`
    }
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
