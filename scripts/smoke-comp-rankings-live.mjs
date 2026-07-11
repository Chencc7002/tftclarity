import {
  CompsContextClient,
  MetaTFTClient,
  buildCompRankings,
  createCatalog
} from "../src/index.js";

const rankFilter = ["CHALLENGER", "DIAMOND", "EMERALD", "GRANDMASTER", "MASTER", "PLATINUM"];
const params = {
  formatnoarray: "true",
  compact: "true",
  queue: "1100",
  patch: "current",
  days: 3,
  rank: rankFilter.join(",")
};
const [response, clusterResponse] = await Promise.all([
  new MetaTFTClient({ timeoutMs: 15000 }).getExactUnitsTraits2(params),
  new CompsContextClient({ timeoutMs: 15000 }).getLatestClusterInfo({ queue: "1100", patch: "current" })
]);
const adjustment = response?.filter_adjustment ?? response?.filterAdjustment ?? {};
const result = buildCompRankings(response, {
  query: {
    metrics: ["top4_rate", "win_rate", "avg_placement", "popularity"],
    limit: 3,
    minSamples: 500,
    patch: "current",
    rankFilter,
    days: 3,
    queue: "1100"
  },
  catalog: createCatalog(),
  clusterResponse,
  sampleSize: adjustment.sample_size
});

if (result.diagnostics.inputRows === 0) throw new Error("exact_units_traits2 returned no rows");
if (result.rankings.popularity.length === 0) throw new Error("no eligible normal comp rows after local filtering");

console.log(JSON.stringify({
  ok: true,
  endpoint: "/tft-explorer-api/exact_units_traits2",
  params,
  inputRows: result.diagnostics.inputRows,
  acceptedGroups: result.diagnostics.acceptedGroups,
  rejectedRows: result.diagnostics.rejected.length,
  matchedLeaders: {
    top4Rate: result.rankings.top4Rate[0]?.source?.matched ?? false,
    winRate: result.rankings.winRate[0]?.source?.matched ?? false,
    popularity: result.rankings.popularity[0]?.source?.matched ?? false
  },
  sampleSize: adjustment.sample_size ?? null,
  leaders: {
    top4Rate: result.rankings.top4Rate[0]?.compId ?? null,
    winRate: result.rankings.winRate[0]?.compId ?? null,
    popularity: result.rankings.popularity[0]?.compId ?? null
  }
}, null, 2));
