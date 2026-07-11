import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MemoryCacheStore,
  buildCompRankings,
  createAssetResolver,
  createCatalog,
  normalizeAssetUrl,
  parseQuery,
  recommendForInput,
  validateStructuredParserOutput
} from "../src/index.js";
import { ITEM_ALIAS_OVERRIDES } from "../src/data/item-alias-overrides.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/comp-rankings/exact-units-traits2-minimal.json", import.meta.url), "utf8"));

test("rule parser recognizes common comp ranking questions without a unit or LLM", () => {
  const strongest = parseQuery("当前版本最强阵容有哪些？");
  assert.equal(strongest.intent, "comp_rankings");
  assert.deepEqual(strongest.metrics, ["top4_rate", "win_rate"]);
  assert.equal(strongest.unit, undefined);

  assert.deepEqual(parseQuery("前四率最高的三套阵容").metrics, ["top4_rate"]);
  assert.equal(parseQuery("前四率最高的三套阵容").limit, 3);
  assert.deepEqual(parseQuery("登顶率最高的阵容").metrics, ["win_rate"]);
  assert.deepEqual(parseQuery("最热门的阵容").metrics, ["popularity"]);
  assert.deepEqual(parseQuery("平均名次最好的阵容").metrics, ["avg_placement"]);
  assert.deepEqual(parseQuery("这版本玩什么容易上分").metrics, ["top4_rate"]);
  assert.deepEqual(parseQuery("有没有比较稳、同时也有吃鸡能力的阵容").metrics, ["top4_rate", "win_rate"]);
  assert.equal(parseQuery("当前版本特殊玩法阵容").specialMode, true);
});

test("explicit comp sample thresholds override saved small-window preferences", async () => {
  const result = await recommendForInput("最热门的阵容，样本>=999999", {
    catalog: createCatalog(),
    compResponse: fixture,
    preferences: { minSamples: 100 }
  });
  assert.equal(result.query.minSamples, 999999);
  assert.equal(result.rankings.popularity.length, 0);
  assert.ok(result.references.length > 0);
});

test("captured exact comp rows compute rates locally and exclude abnormal boards", () => {
  const result = buildCompRankings(fixture, {
    query: {
      metrics: ["top4_rate", "win_rate", "avg_placement", "popularity"],
      limit: 10,
      minSamples: 500,
      patch: "current",
      specialMode: false
    },
    clusterResponse: fixture.clusters,
    sampleSize: fixture.capture.filterAdjustment.sample_size,
    updatedAt: fixture.capture.capturedAt,
    catalog: createCatalog()
  });

  assert.equal(result.diagnostics.inputRows, 6);
  assert.equal(result.diagnostics.acceptedGroups, 3);
  assert.equal(result.diagnostics.rejected.filter((entry) => entry.reason === "special_or_abnormal_board").length, 3);
  assert.equal(result.rankings.popularity[0].compId, "cluster:409002");
  assert.equal(result.rankings.top4Rate[0].compId, "cluster:409019");
  assert.equal(result.rankings.winRate[0].stats.winRate, 10347 / 81907);
  assert.notEqual(result.rankings.top4Rate[0].compId, result.rankings.winRate[0].compId);
  assert.ok(result.rankings.avgPlacement.every((comp) => Number.isFinite(comp.stats.avgPlacement)));
  assert.ok(result.rankings.top4Rate.flatMap((comp) => comp.traits).some((trait) => Number.isInteger(trait.tier)));
});

test("special mode may include nonstandard population but never PvE or duplicate boards", () => {
  const result = buildCompRankings(fixture, {
    query: {
      metrics: ["popularity"],
      limit: 10,
      minSamples: 1,
      specialMode: true
    },
    clusterResponse: fixture.clusters
  });
  assert.ok(result.rankings.popularity.some((comp) => comp.units.length === 1 && comp.units[0].apiName === "TFT17_Fiora"));
  assert.equal(result.diagnostics.rejected.filter((entry) => entry.reason === "special_or_abnormal_board").length, 2);
  assert.ok(result.rankings.popularity.every((comp) => new Set(comp.units.map((unit) => unit.apiName)).size === comp.units.length));
  assert.ok(result.rankings.popularity.every((comp) => comp.units.every((unit) => !unit.apiName.includes("PVE_"))));
});

test("variants matched to one published cluster are merged by summed placement distribution", () => {
  const rows = {
    data: [
      { units_traits: "TFT17_Aatrox&TFT17_Belveth&TFT17_Maokai&TFT17_MissFortune&TFT17_Ornn&TFT17_Rhaast&TFT17_Urgot|TFT17_ASTrait_1&TFT17_DRX_1", placement_count: [10, 20, 30, 40, 50, 60, 70, 80] },
      { units_traits: "TFT17_Aatrox&TFT17_Belveth&TFT17_Kindred&TFT17_Maokai&TFT17_MissFortune&TFT17_Ornn&TFT17_Rhaast&TFT17_Urgot|TFT17_ASTrait_2&TFT17_DRX_1", placement_count: [20, 30, 40, 50, 60, 70, 80, 90] }
    ]
  };
  const result = buildCompRankings(rows, {
    query: { metrics: ["popularity"], limit: 3, minSamples: 1 },
    clusterResponse: fixture.clusters
  });
  assert.equal(result.rankings.popularity.length, 1);
  assert.equal(result.rankings.popularity[0].source.variantCount, 2);
  assert.equal(result.rankings.popularity[0].stats.games, 800);
});

test("removing summon tokens keeps sourced average star levels aligned to their heroes", () => {
  const result = buildCompRankings({
    data: [{
      units_traits: "TFT17_A&TFT17_IvernMinion&TFT17_B&TFT17_C&TFT17_D&TFT17_E&TFT17_F|TFT17_Trait_1",
      avg_unit_1_tier: 1,
      avg_unit_2_tier: 3,
      avg_unit_3_tier: 2,
      avg_unit_4_tier: 2.1,
      avg_unit_5_tier: 1.8,
      avg_unit_6_tier: 1.7,
      avg_unit_7_tier: 1.6,
      placement_count: [10, 10, 10, 10, 10, 10, 10, 10]
    }]
  }, {
    query: { metrics: ["popularity"], limit: 1, minSamples: 1 }
  });
  const comp = result.rankings.popularity[0];
  assert.deepEqual(comp.units.map((unit) => unit.apiName), ["TFT17_A", "TFT17_B", "TFT17_C", "TFT17_D", "TFT17_E", "TFT17_F"]);
  assert.deepEqual(comp.units.map((unit) => unit.avgStarLevel), [1, 2, 2.1, 1.8, 1.7, 1.6]);
});

test("rows without a real eight-place distribution never receive generated rates", () => {
  const result = buildCompRankings({ data: [{ units_traits: "TFT17_A&TFT17_B&TFT17_C&TFT17_D&TFT17_E&TFT17_F|TFT17_Trait_1", avg: 3.5 }] }, {
    query: { metrics: ["top4_rate", "win_rate"], limit: 3, minSamples: 1 }
  });
  assert.equal(result.rankings.top4Rate.length, 0);
  assert.equal(result.rankings.winRate.length, 0);
  assert.equal(result.diagnostics.rejected[0].reason, "missing_placement_count");
});

test("below-threshold comps are exposed only as low-sample references", () => {
  const result = buildCompRankings(fixture, {
    query: { metrics: ["top4_rate"], limit: 2, minSamples: 100000 },
    clusterResponse: fixture.clusters
  });
  assert.equal(result.rankings.top4Rate.length, 0);
  assert.equal(result.references.length, 2);
  assert.ok(result.references.every((comp) => comp.lowSample));
  assert.ok(result.references[0].stats.games >= result.references[1].stats.games);
});

test("structured parser schema accepts controlled comp metrics and rejects invented fields", () => {
  const valid = validateStructuredParserOutput({
    intent: "comp_rankings",
    entities: { unit_mentions: [], item_mentions: [], trait_mentions: [] },
    constraints: {
      star_level: [], item_count: null, item_policy: null, owned_items: [], excluded_items: [],
      min_samples: 500, sort: null, rank_filter: [], days: 3, patch: "current", queue: "1100",
      metrics: ["top4_rate", "win_rate"], limit: 3
    },
    needs_clarification: false,
    clarification_question: null
  });
  assert.equal(valid.valid, true, valid.errors.join("; "));
  assert.deepEqual(valid.value.constraints.metrics, ["top4_rate", "win_rate"]);

  const invalid = validateStructuredParserOutput({
    intent: "comp_rankings",
    entities: {},
    constraints: { metrics: ["secret_score"], limit: 3, generated_comp: "A" },
    needs_clarification: false,
    clarification_question: null
  });
  assert.equal(invalid.valid, false);

  const mixedIntent = validateStructuredParserOutput({
    intent: "comp_rankings",
    entities: { unit_mentions: ["霞"], item_mentions: [], trait_mentions: [] },
    constraints: {
      metrics: ["top4_rate"], limit: 3, star_level: [], item_count: null,
      item_policy: null, owned_items: [], excluded_items: [], min_samples: 500,
      sort: null, rank_filter: [], days: 3, patch: "current", queue: "1100"
    },
    needs_clarification: false,
    clarification_question: null
  });
  assert.equal(mixedIntent.valid, false);
  assert.match(mixedIntent.errors.join("; "), /cannot include unit/);

  const itemWithCompMetric = validateStructuredParserOutput({
    intent: "unit_best_3_items",
    entities: { unit_mentions: ["霞"], item_mentions: [], trait_mentions: [] },
    constraints: {
      metrics: ["top4_rate"], limit: 3, star_level: [], item_count: 3,
      item_policy: "ordinary_only", owned_items: [], excluded_items: [], min_samples: 100,
      sort: "top4_first", rank_filter: [], days: 3, patch: "current", queue: "1100"
    },
    needs_clarification: false,
    clarification_question: null
  });
  assert.equal(itemWithCompMetric.valid, false);
  assert.match(itemWithCompMetric.errors.join("; "), /only valid for comp_rankings/);
});

test("comp recommendation uses one cached deterministic service and never calls unit_builds", async () => {
  let exactCalls = 0;
  let unitCalls = 0;
  const metaTFTClient = {
    async getExactUnitsTraits2() { exactCalls += 1; return fixture; },
    async getUnitBuilds() { unitCalls += 1; throw new Error("unit path should not run"); }
  };
  const cacheStore = new MemoryCacheStore();
  const options = {
    metaTFTClient,
    cacheStore,
    compsData: { clusterInfo: fixture.clusters },
    catalog: createCatalog()
  };
  const first = await recommendForInput("当前版本最强阵容有哪些？", options);
  const second = await recommendForInput("当前版本最强阵容有哪些？", options);
  assert.equal(first.type, "comp_rankings");
  assert.equal(second.cache.query.hit, true);
  assert.equal(exactCalls, 1);
  assert.equal(unitCalls, 0);
});

test("standard comp wording stays out of the optional LLM hot path", async () => {
  let parserCalls = 0;
  const result = await recommendForInput("当前版本最强阵容有哪些？", {
    catalog: createCatalog(),
    compResponse: fixture,
    structuredParser: async () => {
      parserCalls += 1;
      throw new Error("standard comp queries must not call the LLM");
    },
    useStructuredParser: "auto"
  });
  assert.equal(result.type, "comp_rankings");
  assert.equal(parserCalls, 0);
});

test("comp recommendation labels an expired-cache fallback after a live failure", async () => {
  let now = 1000;
  let fail = false;
  const liveLikeFixture = { data: fixture.data };
  const cacheStore = new MemoryCacheStore({ now: () => now });
  const options = {
    cacheStore,
    queryTtlMs: 100,
    catalog: createCatalog(),
    compsData: { clusterInfo: fixture.clusters },
    metaTFTClient: {
      async getExactUnitsTraits2() {
        if (fail) throw new Error("offline probe");
        return liveLikeFixture;
      }
    }
  };
  const first = await recommendForInput("当前版本最强阵容有哪些？", options);
  now += 200;
  fail = true;
  const stale = await recommendForInput("当前版本最强阵容有哪些？", options);
  assert.equal(stale.cache.query.hit, true);
  assert.equal(stale.cache.query.stale, true);
  assert.match(stale.warnings[0], /过期阵容榜缓存/);
  assert.equal(stale.source.updatedAt, first.source.updatedAt);
});

test("an empty exact response produces an explicit empty ranking payload", async () => {
  const result = await recommendForInput("最热门的阵容", {
    catalog: createCatalog(),
    compResponse: { data: [] }
  });
  assert.equal(result.type, "comp_rankings");
  assert.deepEqual(result.rankings.popularity, []);
  assert.deepEqual(result.references, []);
});

test("a validated fake LLM comp intent enters the same deterministic ranking service", async () => {
  let exactCalls = 0;
  const result = await recommendForInput("给我来点当前环境靠谱的构筑", {
    catalog: createCatalog(),
    structuredParser: async () => ({
      intent: "comp_rankings",
      entities: { unit_mentions: [], item_mentions: [], trait_mentions: [] },
      constraints: {
        star_level: [], item_count: null, item_policy: null, owned_items: [], excluded_items: [],
        min_samples: 500, sort: null, rank_filter: [], days: 3, patch: "current", queue: "1100",
        metrics: ["top4_rate", "win_rate"], limit: 2
      },
      needs_clarification: false,
      clarification_question: null
    }),
    useStructuredParser: "always",
    metaTFTClient: {
      async getExactUnitsTraits2() { exactCalls += 1; return fixture; }
    },
    compsData: { clusterInfo: fixture.clusters }
  });
  assert.equal(result.type, "comp_rankings");
  assert.equal(result.query.limit, 2);
  assert.equal(result.rankings.top4Rate.length, 2);
  assert.equal(exactCalls, 1);
});

test("asset resolver uses only allowlisted versioned Riot URLs and fixed fallback state", () => {
  const resolver = createAssetResolver();
  const unit = resolver.resolveUnit("TFT17_Xayah");
  const item = resolver.resolveItem("TFT_Item_GuinsoosRageblade");
  const giantSlayer = resolver.resolveItem("TFT_Item_GiantSlayer");
  const trait = resolver.resolveTrait("TFT17_DarkStar_3");
  assert.match(unit.iconUrl, /^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/16\.13\.1\//);
  assert.ok(item.iconUrl);
  assert.equal(giantSlayer.apiName, "TFT_Item_GiantSlayer");
  assert.match(giantSlayer.iconUrl, /TFT_Item_MadredsBloodrazor\.png$/);
  assert.ok(trait.iconUrl);
  assert.equal(normalizeAssetUrl("https://evil.example/icon.png"), null);
  assert.equal(resolver.resolveUnit("TFT17_Missing").fallback, true);
  const hostileManifest = createAssetResolver({
    manifest: {
      assets: [{ entityType: "unit", apiName: "TFT17_Xayah", iconUrl: "https://evil.example/xayah.png" }]
    }
  });
  assert.equal(hostileManifest.resolveUnit("TFT17_Xayah").iconUrl, null);
  assert.equal(hostileManifest.resolveUnit("TFT17_Xayah").fallback, true);
});

test("equal metric rows use a deterministic comp-id tie break", () => {
  const placement_count = [10, 10, 10, 10, 10, 10, 10, 10];
  const response = { data: [
    { units_traits: "TFT17_G&TFT17_H&TFT17_I&TFT17_J&TFT17_K&TFT17_L|TFT17_ZTrait_1", placement_count },
    { units_traits: "TFT17_A&TFT17_B&TFT17_C&TFT17_D&TFT17_E&TFT17_F|TFT17_ATrait_1", placement_count }
  ] };
  const first = buildCompRankings(response, {
    query: { metrics: ["top4_rate", "popularity"], limit: 2, minSamples: 1 }
  });
  const second = buildCompRankings(response, {
    query: { metrics: ["top4_rate", "popularity"], limit: 2, minSamples: 1 }
  });
  assert.deepEqual(first.rankings.top4Rate.map((comp) => comp.compId), second.rankings.top4Rate.map((comp) => comp.compId));
  assert.deepEqual(first.rankings.top4Rate.map((comp) => comp.compId), [...first.rankings.top4Rate.map((comp) => comp.compId)].sort());
});

test("core build decoration preserves hero ownership and localized item labels", async () => {
  const result = await recommendForInput("最热门的阵容", {
    catalog: createCatalog({ items: ITEM_ALIAS_OVERRIDES }),
    compResponse: fixture,
    compsData: {
      clusterInfo: fixture.clusters,
      compBuilds: [{
        clusterId: "409002",
        unitApiName: "TFT17_Nunu",
        items: ["TFT_Item_WarmogsArmor", "TFT_Item_GargoyleStoneplate", "TFT_Item_DragonsClaw"],
        games: 900
      }]
    }
  });
  const nunuComp = result.rankings.popularity.find((comp) => comp.compId === "cluster:409002");
  const nunu = nunuComp.units.find((unit) => unit.apiName === "TFT17_Nunu");
  assert.equal(nunu.core, true);
  assert.equal(nunu.items.length, 3);
  assert.ok(nunu.items.every((item) => item.name && item.iconUrl));
  assert.deepEqual(nunu.items.map((item) => item.name), ["狂徒铠甲", "石像鬼石板甲", "巨龙之爪"]);
  assert.equal(nunu.items[0].apiName, "TFT_Item_WarmogsArmor");
});
