function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasPlacementCount(row) {
  return Array.isArray(row?.placement_count) || Array.isArray(row?.placementCount);
}

function hasAnyKey(row, keys) {
  return keys.some((key) => row?.[key] !== undefined);
}

export function normalizeExplorerRows(response, keys = []) {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== "object") return [];

  const candidateArrays = [
    response.data,
    response.results,
    response.result,
    response.rows,
    response.items,
    response.unit_builds
  ];

  for (const candidate of candidateArrays) {
    if (Array.isArray(candidate)) {
      return candidate.filter((row) => hasPlacementCount(row) || hasAnyKey(row, keys));
    }
  }

  for (const key of keys) {
    if (Array.isArray(response[key])) return response[key];
  }

  return [];
}

export function normalizeUnitBuildRows(response) {
  return normalizeExplorerRows(response, ["unit_builds", "unit_build"]);
}

export function normalizeItemRows(response) {
  return normalizeExplorerRows(response, ["items", "itemName"]);
}

export function normalizeLatestClusterInfoResponse(response) {
  if (Array.isArray(response)) return response;
  const clusters = response?.cluster_info?.cluster_details?.clusters
    ?? response?.cluster_details?.clusters
    ?? response?.clusters
    ?? response?.data?.clusters
    ?? response?.data;
  return asArray(clusters);
}

export function normalizeCompOptionsResponse(response) {
  if (Array.isArray(response)) return response;

  const options = response?.results?.options ?? response?.options ?? response?.data?.options;
  if (!options || typeof options !== "object") return [];

  const rows = [];
  for (const [clusterId, levels] of Object.entries(options)) {
    if (Array.isArray(levels)) {
      for (const row of levels) rows.push({ cluster: row.cluster ?? clusterId, ...row });
      continue;
    }

    if (!levels || typeof levels !== "object") continue;
    for (const [level, levelRows] of Object.entries(levels)) {
      for (const row of asArray(levelRows)) {
        rows.push({
          cluster: row.cluster ?? clusterId,
          level: Number.isFinite(Number(level)) ? Number(level) : level,
          ...row
        });
      }
    }
  }

  return rows;
}

export function normalizeCompBuildsResponse(response) {
  if (Array.isArray(response)) return response;

  const builds = response?.results?.builds
    ?? response?.builds
    ?? response?.data?.builds;
  if (Array.isArray(builds)) return builds;

  const clusters = response?.results ?? response?.data?.results ?? response?.data;
  if (!clusters || typeof clusters !== "object") return [];

  const rows = [];
  for (const [clusterId, value] of Object.entries(clusters)) {
    const clusterBuilds = Array.isArray(value)
      ? value
      : value?.builds;
    for (const row of asArray(clusterBuilds)) {
      rows.push({
        cluster: row.cluster ?? clusterId,
        ...row
      });
    }
  }

  return rows;
}

export function normalizeCompsData(data = {}) {
  return {
    clusterInfo: normalizeLatestClusterInfoResponse(data.clusterInfo ?? data.latestClusterInfo),
    compOptions: normalizeCompOptionsResponse(data.compOptions),
    compBuilds: normalizeCompBuildsResponse(data.compBuilds)
  };
}
