import { inspectOfficialCompTrendGate } from "../core/official-comp-trend-gate.js";
import { calculateMetaTftPagePlacementChange } from "../core/metatft-page-trend.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function splitTokens(value, pattern = /[&,]/) {
  return String(value ?? "").split(pattern).map((item) => item.trim()).filter(Boolean);
}

function normalizeStarUnits(value) {
  return Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean)
    : splitTokens(value);
}

export function normalizeExactUnitsTraitsResponse(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

export function parseExactCompRow(row = {}) {
  const [unitPart = "", traitPart = ""] = String(row.units_traits ?? row.unitsTraits ?? "").split("|");
  const units = splitTokens(unitPart);
  const traits = splitTokens(traitPart);
  const placementCount = asArray(row.placement_count ?? row.placementCount).map(Number);
  const starLevels = units.map((_, index) => {
    const value = Number(row[`avg_unit_${index + 1}_tier`]);
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  return { units, traits, placementCount, starLevels, raw: row };
}

export function normalizeClusterDefinitions(response) {
  const source = response?.cluster_info?.cluster_details?.clusters
    ?? response?.clusterInfo?.clusterDetails?.clusters
    ?? response?.clusters
    ?? response?.clusterInfo
    ?? response;
  return asArray(source).map((row) => ({
    clusterId: String(row.Cluster ?? row.cluster ?? row.cluster_id ?? row.clusterId ?? ""),
    units: splitTokens(row.units_string ?? row.units ?? row.units_list),
    traits: splitTokens(row.traits_string ?? row.traits ?? row.traits_list),
    nameTokens: splitTokens(row.name_string ?? row.comp_name ?? row.name),
    raw: row
  })).filter((row) => row.clusterId);
}

export function normalizeCompBuildEvidence(response) {
  if (Array.isArray(response)) {
    return response.map((row) => ({
      clusterId: String(row.clusterId ?? row.cluster ?? ""),
      unitApiName: String(row.unitApiName ?? row.unit ?? ""),
      items: asArray(row.items ?? row.buildName),
      games: Number(row.games ?? row.count ?? 0),
      avgPlacement: Number.isFinite(Number(row.avgPlacement ?? row.avg))
        ? Number(row.avgPlacement ?? row.avg)
        : null
    })).filter((row) => row.clusterId && row.unitApiName && row.items.length > 0);
  }
  const results = response?.results ?? response ?? {};
  const rows = [];
  for (const [clusterId, value] of Object.entries(results)) {
    for (const row of asArray(value?.builds ?? value)) {
      const items = asArray(row.buildName).length > 0
        ? row.buildName.map(String)
        : splitTokens(String(row.unit_buildNames ?? "").split("&")[1], /\|/);
      const unitApiName = String(row.unit ?? String(row.unit_buildNames ?? "").split("&")[0] ?? "");
      if (!unitApiName || items.length === 0) continue;
      rows.push({
        clusterId: String(row.cluster ?? clusterId),
        unitApiName,
        items,
        games: Number(row.count ?? 0),
        avgPlacement: Number.isFinite(Number(row.avg)) ? Number(row.avg) : null
      });
    }
  }
  return rows;
}

function finiteNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePageBuilds(value) {
  return asArray(value).map((row) => ({
    clusterId: String(row.cluster ?? row.cluster_id ?? row.clusterId ?? ""),
    unitApiName: String(row.unit ?? row.unit_api_name ?? row.unitApiName ?? ""),
    items: asArray(row.buildName ?? row.items).map(String),
    games: finiteNumber(row.count ?? row.games, 0),
    avgPlacement: finiteNumber(row.avg ?? row.avgPlacement),
    score: finiteNumber(row.score),
    placeChange: finiteNumber(row.place_change ?? row.placeChange)
  })).filter((row) => row.unitApiName && row.items.length > 0);
}

export function normalizeCompsPageDataResponse(response = {}) {
  const root = response?.results?.data ?? response?.data?.results?.data ?? response?.data ?? response;
  const details = root?.cluster_details ?? root?.clusterDetails ?? response?.cluster_details ?? {};
  // Only results.data.comps is authoritative for the official trend gate.
  // Daily cluster trends remain available for diagnostics, but are explicitly
  // labelled as derived and must never be presented as an official top three.
  const trendRows = root?.comps ?? root?.comp_data?.comps ?? response?.comps ?? {};
  const trendByCluster = new Map(Object.entries(trendRows ?? {}).map(([clusterId, row]) => [
    String(clusterId),
    {
      avgPlacementChange: finiteNumber(row?.["Average Placement Change"] ?? row?.average_placement_change ?? row?.placement_change),
      source: row?.["Trend Source"] ?? row?.trend_source ?? row?.trendSource ?? "metatft",
      comparedAt: row?.["Compared At"] ?? row?.compared_at ?? row?.comparedAt ?? null
    }
  ]));
  const entries = Array.isArray(details)
    ? details.map((row) => [String(row.Cluster ?? row.cluster ?? row.cluster_id ?? row.clusterId ?? ""), row])
    : Object.entries(details ?? {});
  const definitions = entries.map(([key, row = {}], sourceIndex) => {
    const clusterId = String(row.Cluster ?? row.cluster ?? row.cluster_id ?? row.clusterId ?? key);
    const explicitTrend = trendByCluster.get(clusterId);
    const hasExplicitTrend = Number.isFinite(explicitTrend?.avgPlacementChange);
    // Keep the page-compatible calculation for diagnostics and regression
    // comparisons. The strict gate in the ranking service suppresses it.
    const dailyTrend = hasExplicitTrend ? null : calculateMetaTftPagePlacementChange(row.trends);
    const nameEntries = asArray(row.name);
    const nameTokens = nameEntries.length > 0
      ? nameEntries.map((entry) => typeof entry === "string" ? entry : entry?.name).filter(Boolean)
      : splitTokens(row.name_string ?? row.comp_name ?? row.name);
    const centroid = asArray(row.centroid).map(Number).filter(Number.isFinite);
    return {
      clusterId,
      units: splitTokens(row.units_string ?? row.units ?? row.units_list),
      traits: splitTokens(row.traits_string ?? row.traits ?? row.traits_list),
      threeStarUnits: normalizeStarUnits(row.stars ?? row.three_star_units ?? row.threeStarUnits),
      fourStarUnits: normalizeStarUnits(row.stars_4 ?? row.four_star_units ?? row.fourStarUnits),
      nameTokens,
      nameString: String(row.name_string ?? row.comp_name ?? ""),
      situational: String(row.name_string ?? row.comp_name ?? "").includes("Augment"),
      centroidMax: centroid.length > 0 ? Math.max(...centroid) : null,
      avgPlacementChange: hasExplicitTrend
        ? explicitTrend.avgPlacementChange
        : dailyTrend?.avgPlacementChange ?? null,
      trendSource: hasExplicitTrend ? explicitTrend.source : dailyTrend ? "metatft_page_calculated" : null,
      trendComparedAt: hasExplicitTrend ? explicitTrend.comparedAt : dailyTrend?.comparedAt ?? null,
      builds: normalizePageBuilds(row.builds).map((build) => ({
        ...build,
        clusterId: build.clusterId || clusterId
      })),
      sourceIndex,
      raw: row
    };
  }).filter((row) => row.clusterId);

  return {
    clusterId: String(root?.cluster_id ?? root?.clusterId ?? response?.cluster_id ?? ""),
    updatedAt: response?.updated ?? root?.updated ?? null,
    tftSet: root?.tft_set ?? root?.tftSet ?? response?.tft_set ?? null,
    queue: String(response?.queue_id ?? root?.queue_id ?? root?.queue ?? ""),
    definitions
  };
}

function placementStats(places, totalGames) {
  const placementCount = (Array.isArray(places)
    ? places
    : String(places ?? "").trim().split(/[\s,]+/).filter(Boolean))
    .slice(0, 8)
    .map(Number);
  if (placementCount.length !== 8
    || placementCount.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const games = placementCount.reduce((sum, value) => sum + value, 0);
  if (!(games > 0)) return null;
  const top4 = placementCount.slice(0, 4).reduce((sum, value) => sum + value, 0);
  const placementSum = placementCount.reduce((sum, value, index) => sum + value * (index + 1), 0);
  return {
    games,
    top4Rate: top4 / games,
    winRate: placementCount[0] / games,
    // MetaTFT's "Win Share": this comp's wins divided by all lobby wins.
    // totalGames counts player placements, so there is one winner per 8 rows.
    winShare: Number.isFinite(totalGames) && totalGames > 0
      ? placementCount[0] / (totalGames / 8)
      : null,
    avgPlacement: placementSum / games,
    pickRate: Number.isFinite(totalGames) && totalGames > 0 ? games / totalGames : null,
    placementCount
  };
}

export function normalizeCompsStatsResponse(response = {}) {
  const results = asArray(response?.results ?? response?.data?.results);
  const totalRow = results.find((row) => String(row?.cluster ?? row?.DB_Cluster ?? "") === "");
  const totalPlaces = Array.isArray(totalRow?.places)
    ? totalRow.places
    : String(totalRow?.places ?? "").trim().split(/[\s,]+/).filter(Boolean);
  const totalGames = finiteNumber(totalPlaces[0]);
  const rejected = [];
  const rows = [];

  results.forEach((row = {}, sourceIndex) => {
    const clusterId = String(row.cluster ?? row.DB_Cluster ?? "");
    if (!clusterId || clusterId === "-1") return;
    const stats = placementStats(row.places ?? row.placement_count, totalGames);
    if (!stats) {
      rejected.push({ clusterId, reason: "invalid_placement_distribution", sourceIndex });
      return;
    }
    rows.push({ clusterId, sourceIndex, stats, raw: row });
  });

  return {
    clusterId: String(response?.cluster_id ?? response?.clusterId ?? response?.data?.cluster_id ?? ""),
    updatedAt: response?.updated ?? response?.data?.updated ?? null,
    totalGames,
    rows,
    rejected
  };
}

export function createCompsPageSnapshot(compsDataResponse = {}, compsStatsResponse = {}) {
  const data = normalizeCompsPageDataResponse(compsDataResponse);
  const stats = normalizeCompsStatsResponse(compsStatsResponse);
  const officialTrendGate = inspectOfficialCompTrendGate(compsDataResponse);
  const clusterDetails = Object.fromEntries(data.definitions.map((definition) => [
    definition.clusterId,
    {
      Cluster: definition.clusterId,
      centroid: definition.centroidMax === null ? [] : [definition.centroidMax],
      units_string: definition.units.join(", "),
      traits_string: definition.traits.join(", "),
      stars: [...definition.threeStarUnits],
      stars_4: [...definition.fourStarUnits],
      name: definition.nameTokens,
      name_string: definition.nameString,
      builds: definition.builds.map((build) => ({
        cluster: build.clusterId,
        unit: build.unitApiName,
        buildName: build.items,
        count: build.games,
        avg: build.avgPlacement,
        score: build.score,
        place_change: build.placeChange
      }))
    }
  ]));

  return {
    officialTrendGate,
    compsData: {
      updated: data.updatedAt,
      queue_id: data.queue || undefined,
      results: {
        data: {
          cluster_id: data.clusterId,
          tft_set: data.tftSet,
          cluster_details: clusterDetails,
          comps: Object.fromEntries(data.definitions
            .filter((definition) => officialTrendGate.ready
              && Number.isFinite(definition.avgPlacementChange))
            .map((definition) => [definition.clusterId, {
              "Average Placement Change": definition.avgPlacementChange,
              "Trend Source": definition.trendSource ?? "metatft",
              ...(definition.trendComparedAt ? { "Compared At": definition.trendComparedAt } : {})
            }]))
        }
      }
    },
    compsStats: {
      cluster_id: stats.clusterId,
      updated: stats.updatedAt,
      results: [
        { cluster: "", places: [stats.totalGames] },
        ...stats.rows.map((row) => ({
          cluster: row.clusterId,
          places: [...row.stats.placementCount, row.stats.games]
        }))
      ]
    }
  };
}
