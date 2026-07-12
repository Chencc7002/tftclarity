import test from "node:test";
import assert from "node:assert/strict";
import {
  MemoryCacheStore,
  aggregateUnitItemRankings,
  parseQuery,
  recommendForInput,
  selectDefaultContextForUnit
} from "../src/index.js";

const rows = [
  {
    unit_builds: "TFT17_Xayah&TFT_Item_RapidFireCannon|TFT_Item_RunaansHurricane|TFT_Item_RunaansHurricane",
    placement_count: [30, 20, 10, 8, 5, 3, 2, 2]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_RapidFireCannon|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [8, 7, 6, 5, 4, 4, 3, 3]
  }
];

test("deterministic parser covers unified intents, rank ranges, days, and sort", () => {
  const build = parseQuery("大师以上霞什么三件装备最强？");
  assert.equal(build.intent, "unit_build_rankings");
  assert.deepEqual(build.rankFilter, ["CHALLENGER", "GRANDMASTER", "MASTER"]);

  assert.equal(parseQuery("霞哪个单件装备表现最好？").intent, "unit_item_rankings");
  assert.equal(parseQuery("霞在携带红霸符的前提下什么出装最强？").intent, "unit_build_completion");
  assert.equal(parseQuery("霞羊刀和无尽哪个好？").intent, "unit_item_comparison");
  assert.equal(parseQuery("当前版本阵容排行").intent, "comp_rankings");

  const range = parseQuery("钻石到宗师霞，近7天，按均名看三件套");
  assert.deepEqual(range.rankFilter, ["GRANDMASTER", "MASTER", "DIAMOND"]);
  assert.equal(range.days, 7);
  assert.equal(range.sort, "avg_first");
});

test("single-item aggregation counts a double item build once and keeps copy-count evidence", () => {
  const result = aggregateUnitItemRankings([
    {
      items: ["TFT_Item_RapidFireCannon", "TFT_Item_RunaansHurricane", "TFT_Item_RunaansHurricane"],
      raw: rows[0]
    },
    {
      items: ["TFT_Item_RapidFireCannon", "TFT_Item_InfinityEdge", "TFT_Item_GiantSlayer"],
      raw: rows[1]
    }
  ], { minSamples: 1, sort: "top4_first" });
  const kraken = result.rankings.find((entry) => entry.apiName === "TFT_Item_RunaansHurricane");
  const firstRowGames = rows[0].placement_count.reduce((sum, value) => sum + value, 0);

  assert.equal(kraken.stats.games, firstRowGames);
  assert.equal(kraken.copyCounts.length, 1);
  assert.equal(kraken.copyCounts[0].copyCount, 2);
  assert.equal(kraken.copyCounts[0].stats.games, firstRowGames);
  assert.equal(result.methodology, "presence_once_per_complete_build");
});

test("single-item ranking requires a unit and returns structured results when supplied", async () => {
  const clarification = await recommendForInput("哪个装备最厉害？", {
    response: rows,
    useSession: false
  });
  assert.equal(clarification.type, "clarification");
  assert.equal(clarification.clarification.reason, "missing_unit_for_item_rankings");

  const result = await recommendForInput("霞哪个单件装备表现最好？", {
    response: rows,
    preferences: { minSamples: 1 },
    useSession: false
  });
  assert.equal(result.type, "unit_item_rankings");
  assert.ok(result.itemRankings.length > 0);
  assert.equal(result.itemRankings.some((entry) => entry.apiName === "TFT_Item_RunaansHurricane"), true);
});

test("conversation merge only overrides explicit fields and records source confidence", async () => {
  const cacheStore = new MemoryCacheStore();
  const options = {
    response: rows,
    cacheStore,
    preferences: { minSamples: 1, days: 3 },
    defaultContext: { found: false, traitFilters: [], warning: "测试未补羁绊" }
  };
  await recommendForInput("大师以上霞什么三件装备最强？", options);
  const followUp = await recommendForInput("近一天呢？", options);

  assert.equal(followUp.query.days, 1);
  assert.deepEqual(followUp.query.rankFilter, ["CHALLENGER", "GRANDMASTER", "MASTER"]);
  assert.equal(followUp.query.constraints.days.source, "current_input");
  assert.equal(followUp.query.constraints.unit.source, "conversation");
  assert.equal(followUp.query.constraints.rank_filter.source, "conversation");
  assert.equal(followUp.query.constraints.star_level.source, "conversation");
  assert.ok(followUp.query.constraints.unit.confidence > 0.9);

  const excluded = await recommendForInput("不要海妖，换一套。", options);
  assert.equal(excluded.query.unit, "TFT17_Xayah");
  assert.deepEqual(excluded.query.excludedItems, ["TFT_Item_RunaansHurricane"]);
  assert.equal(excluded.query.constraints.excluded_items.source, "current_input");
});

test("default context falls back to the highest-sample valid comp below the shared threshold", () => {
  const context = selectDefaultContextForUnit("TFT17_Xayah", {
    compOptions: [{
      cluster_id: "low-mainstream",
      comp_name: "低样本霞",
      units_list: ["TFT17_Xayah", "TFT17_Aatrox"],
      traits_list: ["TFT17_SpaceGroove_3", "TFT17_RangedTrait_1", "TFT17_UniqueTrait_X"],
      count: 71,
      score: 40,
      avg: 4.1
    }]
  }, { minClusterSamples: 100 });

  assert.equal(context.found, true);
  assert.equal(context.clusterId, "low-mainstream");
  assert.equal(context.lowConfidence, true);
  assert.equal(context.count, 71);
  assert.ok(context.traitFilters.length < context.traits.length);
  assert.equal(context.sourceScope.supportsDays, false);
  assert.equal(context.sourceScope.supportsRank, false);
  assert.match(context.warning, /低置信默认阵容/);
});
