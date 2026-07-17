import {
  CompsContextClient,
  buildCompRankings,
  createCatalog,
  inspectOfficialCompTrendGate,
  normalizeCompsPageDataResponse,
  normalizeCompsStatsResponse
} from "../src/index.js";

const rankFilter = ["CHALLENGER", "DIAMOND", "EMERALD", "GRANDMASTER", "MASTER", "PLATINUM"];
const client = new CompsContextClient({ timeoutMs: 15000, rankingsTimeoutMs: 15000 });
const dataParams = { queue: "1100" };
const compsData = await client.getCompsData(dataParams);
const officialGate = inspectOfficialCompTrendGate(compsData);
if (!officialGate.ready) {
  throw new Error(`official trend gate is closed: status=${officialGate.status} eligible=${officialGate.eligibleCount}/${officialGate.minimum}`);
}
const clusterId = compsData?.results?.data?.cluster_id;
const statsParams = {
  queue: "1100",
  patch: "current",
  days: 3,
  rank: [...rankFilter].sort().join(","),
  permit_filter_adjustment: "true",
  cluster_id: clusterId
};
const compsStats = await client.getCompsStats(statsParams);
const query = {
  metrics: ["top4_rate", "win_rate", "avg_placement", "popularity"],
  limit: 10,
  minSamples: 1,
  patch: "current",
  queue: "1100",
  rankFilter,
  specialMode: false
};
const result = buildCompRankings({ compsData, compsStats }, { query, catalog: createCatalog() });

const definitions = new Map(normalizeCompsPageDataResponse(compsData).definitions.map((row) => [row.clusterId, row]));
const stats = normalizeCompsStatsResponse(compsStats);
const visible = stats.rows.filter((row) => {
  const definition = definitions.get(row.clusterId);
  return definition
    && !(definition.centroidMax !== null && definition.centroidMax < 1)
    && !definition.situational
    && !(Number.isFinite(row.stats.pickRate) && row.stats.pickRate * 8 < 0.01);
});
const expected = {
  top4Rate: [...visible].sort((a, b) => b.stats.top4Rate - a.stats.top4Rate || a.sourceIndex - b.sourceIndex),
  winRate: [...visible].sort((a, b) => b.stats.winRate - a.stats.winRate || a.sourceIndex - b.sourceIndex),
  avgPlacement: [...visible].sort((a, b) => a.stats.avgPlacement - b.stats.avgPlacement || a.sourceIndex - b.sourceIndex),
  popularity: [...visible].sort((a, b) => b.stats.pickRate - a.stats.pickRate || a.sourceIndex - b.sourceIndex)
};

for (const [metric, rows] of Object.entries(expected)) {
  const expectedIds = rows.slice(0, query.limit).map((row) => row.clusterId);
  const actualIds = result.rankings[metric].map((row) => row.source.clusterId);
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error(`${metric} diverged from MetaTFT /comps order: expected=${expectedIds.join(",")} actual=${actualIds.join(",")}`);
  }
}
if (String(result.source.clusterId) !== String(clusterId)) {
  throw new Error(`cluster mismatch: data=${clusterId} result=${result.source.clusterId}`);
}
if (result.diagnostics.acceptedGroups !== visible.length) {
  throw new Error(`visible comp mismatch: page=${visible.length} result=${result.diagnostics.acceptedGroups}`);
}
if (!definitions.size || result.trend.status !== "upstream" || !result.trend.officialGate?.ready) {
  throw new Error(`official comp trends did not pass the raw cold-start gate: status=${result.trend.status}`);
}
if (result.improving.length !== 3) {
  throw new Error(`live query did not return three visible improving comps: count=${result.improving.length}`);
}
const rawTrends = compsData.results.data.comps;
for (const comp of result.improving) {
  const rawChange = Number(rawTrends?.[comp.source.clusterId]?.["Average Placement Change"]);
  const gateEntry = officialGate.sourceType === "raw_field"
    ? { avgPlacementChange: rawChange }
    : normalizeCompsPageDataResponse(compsData).definitions
      .find((definition) => definition.clusterId === comp.source.clusterId);
  if (!Number.isFinite(gateEntry?.avgPlacementChange)
    || gateEntry.avgPlacementChange >= -0.1
    || Math.abs(gateEntry.avgPlacementChange - comp.trend.avgPlacementChange) > 1e-9) {
    throw new Error(`trend card is not backed by the selected official source: cluster=${comp.source.clusterId}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  dataEndpoint: "/tft-comps-api/comps_data",
  statsEndpoint: "/tft-comps-api/comps_stats",
  dataParams,
  statsParams,
  clusterId,
  updated: result.source.updatedAt,
  officialGate,
  sampleSize: result.source.sampleSize,
  definitions: definitions.size,
  visibleRows: visible.length,
  improving: result.improving.map((comp) => ({
    clusterId: comp.source.clusterId,
    name: comp.name,
    avgPlacementChange: Number(comp.trend.avgPlacementChange.toFixed(2)),
    comparedAt: comp.trend.comparedAt
  })),
  leaders: Object.fromEntries(Object.entries(result.rankings).map(([metric, rows]) => [metric, rows[0]?.source.clusterId ?? null]))
}, null, 2));
