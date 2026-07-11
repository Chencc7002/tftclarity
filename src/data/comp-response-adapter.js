function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function splitTokens(value, pattern = /[&,]/) {
  return String(value ?? "").split(pattern).map((item) => item.trim()).filter(Boolean);
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
