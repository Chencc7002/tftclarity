import { normalizeUnitBuildRows } from "../data/metatft-response-adapter.js";
import { calculatePlacementStats } from "./stats-calculator.js";

export const ITEM_CARRIER_MAX_LIMIT = 8;
export const ITEM_CARRIER_DEFAULT_BUILD_LIMIT = 2;
export const ITEM_CARRIER_MAX_BUILD_LIMIT = 3;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function placementCount(value) {
  const counts = asArray(value).slice(0, 8).map(Number);
  if (counts.length !== 8 || counts.some((count) => !Number.isFinite(count) || count < 0)) return null;
  return counts;
}

function addPlacementCounts(target, source) {
  for (let index = 0; index < 8; index += 1) {
    target[index] += source[index];
  }
}

function parseBuild(row = {}) {
  const raw = String(row.unit_builds ?? row.unit_build ?? row.build ?? "");
  const separator = raw.indexOf("&");
  if (separator <= 0 || separator === raw.length - 1) return null;
  const unitApiName = raw.slice(0, separator).trim();
  const items = raw.slice(separator + 1).split("|").map((item) => item.trim()).filter(Boolean);
  const counts = placementCount(row.placement_count ?? row.placementCount);
  if (!unitApiName || items.length === 0 || !counts) return null;
  return {
    unitApiName,
    items,
    placementCount: counts,
    raw: row
  };
}

function buildKey(build) {
  return `${build.unitApiName}&${[...build.items].sort().join("|")}`;
}

function normalizeTargetBuilds(response, itemApiName) {
  const rows = normalizeUnitBuildRows(response);
  const builds = new Map();
  const seenRows = new Set();
  for (const row of rows) {
    const build = parseBuild(row);
    if (!build || !build.items.includes(itemApiName)) continue;
    const key = buildKey(build);
    const fingerprint = `${key}:${build.placementCount.join(",")}`;
    if (seenRows.has(fingerprint)) continue;
    seenRows.add(fingerprint);
    const current = builds.get(key) ?? {
      unitApiName: build.unitApiName,
      items: [...build.items],
      placementCount: Array(8).fill(0),
      rawRows: 0
    };
    addPlacementCounts(current.placementCount, build.placementCount);
    current.rawRows += 1;
    builds.set(key, current);
  }
  return [...builds.values()];
}

function unitBaselines(response = {}) {
  const source = response?.units
    ?? response?.data?.units
    ?? response?.results?.units
    ?? response?.results?.data?.units
    ?? {};
  const baselines = new Map();
  if (Array.isArray(source)) {
    for (const row of source) {
      const apiName = String(row?.unit ?? row?.unitApiName ?? row?.apiName ?? "");
      const avg = finiteNumber(row?.avg ?? row?.avgPlacement);
      if (apiName && avg !== null) baselines.set(apiName, avg);
    }
    return baselines;
  }
  for (const [key, row] of Object.entries(source ?? {})) {
    const apiName = String(row?.unit ?? row?.unitApiName ?? row?.apiName ?? key);
    const avg = finiteNumber(row?.avg ?? row?.avgPlacement);
    if (apiName && avg !== null) baselines.set(apiName, avg);
  }
  return baselines;
}

function normalizedLimit(value, fallback, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0
    ? Math.min(maximum, number)
    : fallback;
}

function compareCarriers(left, right, sort) {
  if (sort === "uplift_first") {
    return right.placementUplift - left.placementUplift
      || right.stats.games - left.stats.games
      || left.unitApiName.localeCompare(right.unitApiName);
  }
  return right.stats.games - left.stats.games
    || right.placementUplift - left.placementUplift
    || left.unitApiName.localeCompare(right.unitApiName);
}

export function aggregateItemCarrierRankings(buildResponse, baselineResponse, query = {}) {
  const itemApiName = String(query.item ?? "").trim();
  if (!itemApiName) throw new TypeError("aggregateItemCarrierRankings requires query.item");

  const targetBuilds = normalizeTargetBuilds(buildResponse, itemApiName);
  const baselines = unitBaselines(baselineResponse);
  const groups = new Map();
  for (const build of targetBuilds) {
    const group = groups.get(build.unitApiName) ?? {
      unitApiName: build.unitApiName,
      placementCount: Array(8).fill(0),
      builds: []
    };
    addPlacementCounts(group.placementCount, build.placementCount);
    group.builds.push({
      items: [...build.items],
      placementCount: [...build.placementCount],
      stats: calculatePlacementStats(build.placementCount),
      rawRows: build.rawRows
    });
    groups.set(build.unitApiName, group);
  }

  const minSamples = Math.max(0, Number(query.minSamples ?? 100));
  const positiveOnly = query.positiveOnly !== false;
  const buildLimit = normalizedLimit(
    query.buildLimit,
    ITEM_CARRIER_DEFAULT_BUILD_LIMIT,
    ITEM_CARRIER_MAX_BUILD_LIMIT
  );
  const rejected = [];
  const carriers = [];

  for (const group of groups.values()) {
    const stats = calculatePlacementStats(group.placementCount);
    const baselineAvgPlacement = baselines.get(group.unitApiName);
    if (!Number.isFinite(baselineAvgPlacement)) {
      rejected.push({ unitApiName: group.unitApiName, reason: "missing_unit_baseline", games: stats.games });
      continue;
    }
    const unitDelta = stats.avgPlacement - baselineAvgPlacement;
    const placementUplift = -unitDelta;
    if (stats.games < minSamples) {
      rejected.push({ unitApiName: group.unitApiName, reason: "below_min_samples", games: stats.games });
      continue;
    }
    if (positiveOnly && !(unitDelta < 0)) {
      rejected.push({ unitApiName: group.unitApiName, reason: "non_positive_uplift", games: stats.games, unitDelta });
      continue;
    }
    carriers.push({
      unitApiName: group.unitApiName,
      stats,
      placementCount: [...group.placementCount],
      baselineAvgPlacement,
      unitDelta,
      placementUplift,
      builds: group.builds
        .sort((left, right) => right.stats.games - left.stats.games
          || left.stats.avgPlacement - right.stats.avgPlacement
          || left.items.join("|").localeCompare(right.items.join("|")))
        .slice(0, buildLimit)
    });
  }

  const limit = normalizedLimit(query.limit, ITEM_CARRIER_MAX_LIMIT, ITEM_CARRIER_MAX_LIMIT);
  carriers.sort((left, right) => compareCarriers(left, right, query.sort));
  return {
    type: "item_carrier_rankings",
    item: itemApiName,
    carriers: carriers.slice(0, limit),
    query: {
      ...query,
      item: itemApiName,
      minSamples,
      limit,
      buildLimit,
      positiveOnly
    },
    methodology: {
      id: "item_carrier_unit_placement_aggregation_v1",
      positiveDefinition: "carrier_avg_placement_minus_unit_baseline_lt_zero",
      defaultSort: query.sort === "uplift_first" ? "uplift_first" : "games_first"
    },
    diagnostics: {
      inputRows: normalizeUnitBuildRows(buildResponse).length,
      targetBuilds: targetBuilds.length,
      groupedUnits: groups.size,
      returnedUnits: Math.min(carriers.length, limit),
      rejected
    }
  };
}
