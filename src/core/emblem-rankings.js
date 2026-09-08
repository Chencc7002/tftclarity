import { normalizeItemRows } from "../data/metatft-response-adapter.js";
import { calculatePlacementStats, isPlausiblePlacementStats } from "./stats-calculator.js";
import { aggregateItemCarrierRankings } from "./item-carrier-ranking.js";
import { planMetaTFTItemCarrierBuilds } from "./query-planner.js";

export const EMBLEM_RECIPE_BASES = ["craftable", "spatula", "pan", "all"];

// Shared by Quick Task and ReAct. Retrieval scope is supplied by the server,
// never copied from model arguments or historical evidence.
export function scopedEmblemQuery(input = {}, preferences = {}) {
  return { ...input, queue: String(preferences.queue ?? "1100"),
    patch: String(preferences.unitBuildPatch ?? preferences.patch ?? "current"),
    days: input.days ?? preferences.days ?? 3,
    rank: [...(input.rank ?? preferences.rankFilter ?? [])],
    minSamples: input.minSamples ?? preferences.minSamples ?? 100 };
}

export function selectEmblemRankings(rows, query = {}) {
  const base = query.recipeBase ?? "all";
  const metric = query.primaryMetric ?? "avgPlacement";
  const selectedIds = query.apiNames?.length ? new Set(query.apiNames) : null;
  return rows.filter(row => (!selectedIds || selectedIds.has(row.item.apiName))
    && (base === "all" || (base === "craftable" ? Boolean(row.recipeBase) : row.recipeBase === base)))
    .sort((a, b) => Number(a.lowSample) - Number(b.lowSample)
      || (metric === "avgPlacement" ? a.stats[metric] - b.stats[metric] : b.stats[metric] - a.stats[metric])
      || b.stats.games - a.stats.games || a.item.apiName.localeCompare(b.item.apiName))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function emblemAnalysis(rows) {
  const qualified = rows.filter(row => !row.lowSample);
  const leaders = Object.fromEntries(["avgPlacement", "top4Rate", "winRate", "games"].map(primaryMetric =>
    [primaryMetric, selectEmblemRankings(qualified, { primaryMetric })[0]?.item ?? null]));
  const comparisons = rows.length <= 4 ? rows.flatMap((left, index) => rows.slice(index + 1).map(right => ({
    left: left.item.apiName, right: right.item.apiName,
    avgPlacementDifference: Number((left.stats.avgPlacement - right.stats.avgPlacement).toFixed(4)),
    top4PercentagePointDifference: Number(((left.stats.top4Rate - right.stats.top4Rate) * 100).toFixed(4)),
    winPercentagePointDifference: Number(((left.stats.winRate - right.stats.winRate) * 100).toFixed(4)),
    gamesDifference: left.stats.games - right.stats.games,
    avgPlacementGap: Number(Math.abs(left.stats.avgPlacement - right.stats.avgPlacement).toFixed(4)),
    top4PercentagePointGap: Number((Math.abs(left.stats.top4Rate - right.stats.top4Rate) * 100).toFixed(4)),
    winPercentagePointGap: Number((Math.abs(left.stats.winRate - right.stats.winRate) * 100).toFixed(4)),
    lowSample: left.lowSample || right.lowSample
  }))) : [];
  return { leaders, comparisons, comparisonDirection: "left_minus_right", qualifiedCount: qualified.length,
    population: "global_item_presence_in_games_with_at_least_one_emblem",
    statementPolicy: "Descriptive observations only. Emblem groups may overlap and compositions differ. Do not claim causal improvement, statistical significance, or the best emblem for a particular champion. Low samples are reference only; obtain unit_builds for champion-specific equipment and item_details for official effects." };
}

export function emblemRecipeBase(recipe = []) {
  if (recipe.length !== 2 || recipe.some(component => !component.apiName)) return null;
  if (recipe.some(component => /(?:_|^)Spatula$/.test(component.apiName))) return "spatula";
  if (recipe.some(component => /(?:_|^)FryingPan$/.test(component.apiName))) return "pan";
  return null;
}

export function rankEmblems(response, { catalog, itemDetails, minSamples = 100 } = {}) {
  const rows = [];
  const seen = new Set();
  for (const row of normalizeItemRows(response)) {
    const apiName = row.items ?? row.itemName;
    const item = catalog.itemByApiName.get(apiName);
    if (!item || item.category !== "emblem" || item.current === false || item.obtainable === false || seen.has(apiName)) continue;
    const counts = row.placement_count;
    if (!Array.isArray(counts) || counts.length !== 8 || counts.some(n => !Number.isSafeInteger(n) || n < 0)) continue;
    const stats = calculatePlacementStats(counts);
    if (!Number.isSafeInteger(stats.games) || !stats.games || !isPlausiblePlacementStats(stats)) continue;
    seen.add(apiName);
    const detail = itemDetails?.get(apiName);
    rows.push({
      item: { apiName, name: item.preferredDisplayName ?? detail?.name ?? item.zhName ?? apiName,
        enName: item.enName, iconUrl: detail?.iconUrl ?? item.iconUrl ?? null },
      recipe: detail?.recipe ?? [], recipeStatus: detail ? "known" : "unknown",
      recipeBase: emblemRecipeBase(detail?.recipe), placementCount: [...counts], stats,
      lowSample: stats.games < minSamples
    });
  }
  return selectEmblemRankings(rows);
}

export async function queryEmblemRankings({ client, catalog, itemDetails, query, signal }) {
  signal?.throwIfAborted();
  for (const apiName of query.apiNames ?? []) {
    const item = catalog.itemByApiName.get(apiName);
    if (!item || item.category !== "emblem" || item.current === false || item.obtainable === false) {
      throw new TypeError("Only current obtainable emblems can be compared");
    }
  }
  const response = await client.getItems({
    queue: query.queue, patch: query.patch, days: String(query.days),
    rank: (query.rank ?? []).join(","), emblem_count: "1-any",
    formatnoarray: "true", compact: "true", permit_filter_adjustment: "false"
  });
  signal?.throwIfAborted();
  const ranked = rankEmblems(response, { catalog, itemDetails, minSamples: query.minSamples });
  const selected = selectEmblemRankings(ranked, query);
  const rows = selected.slice(0, query.limit ?? 50);
  return { ok: true, type: "emblem_rankings", rows, analysis: emblemAnalysis(selected),
    resultCount: rows.length, matchedCount: selected.length, totalCount: ranked.length,
    missingApiNames: (query.apiNames ?? []).filter(id => !selected.some(row => row.item.apiName === id)),
    status: rows.length ? "found" : "not_found",
    query: { ...query, emblemCount: "1-any" }, updatedAt: new Date().toISOString(),
    methodology: { sort: query.primaryMetric ?? "avgPlacement", lowSampleLast: true, carrierSort: "games_first" },
    source: { provider: "MetaTFT", endpoint: "tft-explorer-api/items", patch: query.patch,
      url: "https://www.metatft.com/explorer?tab=items&emblem_count=1-any" }, warnings: [] };
}

// The same item-to-carrier aggregation as the existing item shortcut, without
// its positive-uplift filter: popularity includes negative-uplift carriers too.
export async function queryEmblemCarriers({ client, compsClient, catalog, query, signal }) {
  const item = catalog.itemByApiName.get(query.item);
  if (!item || item.category !== "emblem" || item.current === false || item.obtainable === false) {
    throw new TypeError("A current emblem is required");
  }
  const carrierQuery = { ...query, rankFilter: query.rank, minSamples: query.minSamples ?? 0, limit: 3,
    buildLimit: 1, positiveOnly: false, sort: "games_first" };
  signal?.throwIfAborted();
  const [builds, baseline] = await Promise.all([
    client.getItemCarrierBuilds(planMetaTFTItemCarrierBuilds(carrierQuery)),
    compsClient.getUnitItemsProcessed({ queue: query.queue, patch: query.patch,
      days: query.days, rank: (query.rank ?? []).join(","), permit_filter_adjustment: "false" })
  ]);
  signal?.throwIfAborted();
  const result = aggregateItemCarrierRankings(builds, baseline, carrierQuery, { catalog });
  return { ok: true, type: "emblem_carriers", item: query.item, query: { ...query, positiveOnly: false, sort: "games_first" },
    carriers: result.carriers.map(carrier => ({ ...carrier,
      unit: { apiName: carrier.unitApiName, name: catalog.unitByApiName.get(carrier.unitApiName)?.zhName ?? carrier.unitApiName,
        enName: catalog.unitByApiName.get(carrier.unitApiName)?.enName } })),
    updatedAt: new Date().toISOString(), source: { provider: "MetaTFT", endpoint: "tft-explorer-api/unit_builds + tft-comps-api/unit_items_processed" } };
}

export function emblemExecutionPlan(tool, args) {
  const evidenceContract = { type: "emblem_statistics", source: "metatft",
    requiredFields: [tool === "emblem_rankings" ? "rows" : "carriers", "updatedAt"],
    required: true, allowModelGeneratedStatistics: false };
  return { schemaVersion: "execution-plan.v1", route: "deterministic_fast_path",
    steps: [{ id: "emblems", tool, arguments: args, dependsOn: [], onFailure: "stop", evidenceContract }],
    resultPolicy: { type: "identity" }, finalEvidenceContract: evidenceContract };
}
