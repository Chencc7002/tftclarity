import test from "node:test";
import assert from "node:assert/strict";
import {
  MemoryCacheStore,
  buildItemCatalogFromItemsResponse,
  createCatalog,
  makeQueryCacheKey,
  planQuery,
  recommendForInput,
  recommendFromRows,
  validateStructuredParserOutput
} from "../src/index.js";

const NAVORI = "TFT_Item_Artifact_NavoriFlickerblades";
const HYDRA = "TFT_Item_Artifact_TitanicHydra";
const DEFIANCE = "TFT4_Item_OrnnDeathsDefiance";
const STARGAZER_EMBLEM = "TFT17_Item_StargazerEmblemItem";
const RAGEBLADE = "TFT_Item_GuinsoosRageblade";
const INFINITY_EDGE = "TFT_Item_InfinityEdge";
const GIANT_SLAYER = "TFT_Item_GiantSlayer";
const RUNAANS = "TFT_Item_RunaansHurricane";
const SHOJIN = "TFT_Item_SpearOfShojin";

const itemApiNames = [
  NAVORI,
  HYDRA,
  DEFIANCE,
  STARGAZER_EMBLEM,
  RAGEBLADE,
  INFINITY_EDGE,
  GIANT_SLAYER,
  RUNAANS,
  SHOJIN,
  "TFT_Item_Deathblade",
  "TFT_Item_LastWhisper"
];

const catalog = createCatalog({
  items: buildItemCatalogFromItemsResponse({
    data: itemApiNames.map((items) => ({ items }))
  })
});

function row(items, placementCount, extra = {}) {
  return {
    unit_builds: `TFT17_Xayah&${items.join("|")}`,
    placement_count: placementCount,
    ...extra
  };
}

const strong = [90, 80, 70, 60, 30, 25, 20, 15];
const medium = [50, 50, 50, 50, 50, 50, 50, 50];
const weak = [20, 25, 30, 35, 60, 60, 55, 55];
const baseRows = [
  row([NAVORI, INFINITY_EDGE, GIANT_SLAYER], strong),
  row([HYDRA, INFINITY_EDGE, GIANT_SLAYER], weak),
  row([DEFIANCE, INFINITY_EDGE, GIANT_SLAYER], medium)
];

test("explicit alternatives become comparisonItems and never lockedItems", () => {
  const result = planQuery("霞用烁刃好还是巨九好？", { catalog });

  assert.equal(result.parsed.intent, "unit_item_comparison");
  assert.deepEqual(result.parsed.lockedItems, []);
  assert.deepEqual(result.parsed.comparisonItems, [NAVORI, HYDRA]);
  assert.deepEqual(result.query.lockedItems, []);
  assert.deepEqual(result.query.ownedItems, []);
  assert.equal(result.query.comparisonMode, "exclusive_presence");
  assert.equal(result.query.primaryMetric, "top4Rate");
  assert.equal(catalog.itemByApiName.get(NAVORI).shortName, "烁刃");
  assert.equal(catalog.itemByApiName.get(HYDRA).shortName, "巨型九头蛇");
});

test("artifact anvil wording treats named drops as alternatives, not joint filters", () => {
  const result = planQuery("神器铁砧中开到了烁刃和巨九，霞用哪个好？", { catalog });

  assert.deepEqual(result.query.comparisonItems, [NAVORI, HYDRA]);
  assert.deepEqual(result.query.lockedItems, []);
  assert.equal(result.query.itemPolicy, "include_artifact");
});

test("owned equipment stays locked while alternatives remain separate", () => {
  const result = planQuery("霞已有羊刀，烁刃还是巨九更强？", { catalog });

  assert.deepEqual(result.query.lockedItems, [RAGEBLADE]);
  assert.deepEqual(result.query.comparisonItems, [NAVORI, HYDRA]);
  assert.equal(result.query.comparisonItems.includes(RAGEBLADE), false);
});

test("excluded equipment is separated from a three-candidate comparison", () => {
  const result = planQuery("霞不要海妖，烁刃、巨九和死亡之蔑哪个好？", { catalog });

  assert.deepEqual(result.query.excludedItems, [RUNAANS]);
  assert.deepEqual(result.query.comparisonItems, [NAVORI, HYDRA, DEFIANCE]);
  assert.equal(result.query.lockedItems.includes(RUNAANS), false);
});

test("plain multi-item loadout language keeps both items locked", () => {
  const result = planQuery("霞带烁刃和巨九", { catalog });

  assert.equal(result.parsed.intent, "unit_build_rankings");
  assert.deepEqual(result.query.lockedItems, [NAVORI, HYDRA]);
  assert.deepEqual(result.query.comparisonItems, []);
});

test("unbound multiple item names require relation clarification", async () => {
  let calls = 0;
  const result = await recommendForInput("霞，烁刃，巨九", {
    catalog,
    useSession: false,
    metaTFTClient: { async getUnitBuilds() { calls += 1; return { data: baseRows }; } }
  });

  assert.equal(result.clarification.reason, "ambiguous_multiple_item_relation");
  assert.equal(calls, 0);
});

test("three candidates are aggregated into three exclusive groups", () => {
  const result = recommendFromRows("霞比较烁刃、巨九和死亡之蔑哪个好？", baseRows, { catalog });

  assert.equal(result.comparison.entries.length, 3);
  assert.deepEqual(new Set(result.comparison.entries.map((entry) => entry.apiName)), new Set([NAVORI, HYDRA, DEFIANCE]));
  assert.ok(result.comparison.entries.every((entry) => entry.isolation === "exclusive"));
});

test("results preserve input order while rankedEntries drive the decision", () => {
  const result = recommendFromRows("霞比较巨九、死亡之蔑和烁刃哪个好？", baseRows, { catalog });

  assert.deepEqual(result.comparison.results.map((entry) => entry.apiName), [HYDRA, DEFIANCE, NAVORI]);
  assert.equal(result.comparison.rankedEntries[0].apiName, NAVORI);
  assert.equal(result.comparison.winner, NAVORI);
});

test("overlap rows are isolated and never added to candidate games", () => {
  const overlap = row([NAVORI, HYDRA, INFINITY_EDGE], [100, 100, 100, 100, 100, 100, 100, 100]);
  const result = recommendFromRows("霞烁刃还是巨九哪个好？", [...baseRows.slice(0, 2), overlap], { catalog });
  const navori = result.comparison.entries.find((entry) => entry.apiName === NAVORI);
  const hydra = result.comparison.entries.find((entry) => entry.apiName === HYDRA);

  assert.equal(navori.games, strong.reduce((sum, value) => sum + value, 0));
  assert.equal(hydra.games, weak.reduce((sum, value) => sum + value, 0));
  assert.equal(result.comparison.overlap.games, 800);
  assert.equal(result.comparison.overlap.buildCount, 1);
});

test("an overlap-only option never falls back to inclusive evidence", () => {
  const result = recommendFromRows("霞烁刃还是巨九哪个好？", [
    row([NAVORI, HYDRA, INFINITY_EDGE], strong)
  ], { catalog });

  assert.ok(result.comparison.entries.every((entry) => entry.games === 0));
  assert.equal(result.comparison.winner, null);
  assert.equal(result.comparison.decision.reason, "metric_unavailable");
});

test("a repeated candidate in one build does not multiply placement samples", () => {
  const counts = [40, 40, 40, 40, 40, 40, 40, 40];
  const result = recommendFromRows("霞烁刃还是巨九哪个好？", [
    row([NAVORI, NAVORI, INFINITY_EDGE], counts),
    row([HYDRA, INFINITY_EDGE, GIANT_SLAYER], medium)
  ], { catalog });
  const navori = result.comparison.entries.find((entry) => entry.apiName === NAVORI);

  assert.equal(navori.games, 320);
  assert.deepEqual(navori.placementCount, counts);
});

test("common complete builds merge duplicate rows and item ordering", () => {
  const counts = [40, 40, 40, 40, 40, 40, 40, 40];
  const result = recommendFromRows("霞烁刃还是巨九哪个好？", [
    row([NAVORI, INFINITY_EDGE, GIANT_SLAYER], counts),
    row([GIANT_SLAYER, NAVORI, INFINITY_EDGE], counts),
    row([HYDRA, INFINITY_EDGE, GIANT_SLAYER], medium)
  ], { catalog });
  const navori = result.comparison.entries.find((entry) => entry.apiName === NAVORI);

  assert.equal(navori.commonBuilds.length, 1);
  assert.equal(navori.commonBuilds[0].stats.games, 640);
});

test("winner follows placement metrics even when raw Score ordering is opposite", () => {
  const result = recommendFromRows("霞烁刃还是巨九哪个强？", [
    row([NAVORI, INFINITY_EDGE, GIANT_SLAYER], strong, { score: -99 }),
    row([HYDRA, INFINITY_EDGE, GIANT_SLAYER], weak, { score: 999 })
  ], { catalog });

  assert.equal(result.comparison.winner, NAVORI);
  assert.equal(result.comparison.decision.primaryMetric, "top4Rate");
});

test("win language uses true first-place rate rather than Score or top4", () => {
  const highWin = [80, 20, 20, 20, 70, 70, 60, 60];
  const highTop4 = [30, 60, 60, 60, 45, 45, 45, 45];
  const result = recommendFromRows("霞烁刃还是巨九上限更高、吃鸡更强？", [
    row([NAVORI, INFINITY_EDGE, GIANT_SLAYER], highWin, { score: 1 }),
    row([HYDRA, INFINITY_EDGE, GIANT_SLAYER], highTop4, { score: 999 })
  ], { catalog });

  assert.equal(result.query.primaryMetric, "winRate");
  assert.equal(result.comparison.winner, NAVORI);
});

test("average and popularity language select their explicit primary metrics", () => {
  const average = planQuery("霞烁刃还是巨九平均表现更好？", { catalog });
  const popular = planQuery("霞烁刃还是巨九哪个更常用？", { catalog });

  assert.equal(average.query.primaryMetric, "avgPlacement");
  assert.equal(average.query.sort, "avg_first");
  assert.equal(popular.query.primaryMetric, "games");
  assert.equal(popular.query.sort, "games_first");
});

test("missing placement evidence never substitutes Score for win rate", () => {
  const result = recommendFromRows("霞烁刃还是巨九谁更容易吃鸡？", [
    { unit_builds: `TFT17_Xayah&${NAVORI}|${INFINITY_EDGE}|${GIANT_SLAYER}`, score: 999 },
    { unit_builds: `TFT17_Xayah&${HYDRA}|${INFINITY_EDGE}|${GIANT_SLAYER}`, score: 1 }
  ], { catalog });

  assert.equal(result.comparison.winner, null);
  assert.equal(result.comparison.decision.reason, "metric_unavailable");
  assert.ok(result.comparison.entries.every((entry) => entry.winRate === null));
});

test("low sample candidates never produce a winner", () => {
  const result = recommendFromRows("霞烁刃还是巨九哪个好？", [
    row([NAVORI, INFINITY_EDGE, GIANT_SLAYER], [5, 4, 3, 2, 1, 1, 1, 1]),
    row([HYDRA, INFINITY_EDGE, GIANT_SLAYER], [4, 4, 3, 2, 2, 1, 1, 1])
  ], { catalog, preferences: { minSamples: 10 } });

  assert.equal(result.comparison.winner, null);
  assert.equal(result.comparison.decision.reason, "low_sample");
});

test("a sub-threshold metric delta does not produce a winner", () => {
  const almostA = [50, 50, 50, 50, 50, 50, 50, 50];
  const almostB = [51, 50, 50, 50, 50, 50, 50, 49];
  const result = recommendFromRows("霞烁刃还是巨九哪个好？", [
    row([NAVORI, INFINITY_EDGE, GIANT_SLAYER], almostA),
    row([HYDRA, INFINITY_EDGE, GIANT_SLAYER], almostB)
  ], { catalog });

  assert.equal(result.comparison.winner, null);
  assert.equal(result.comparison.decision.reason, "difference_too_small");
});

test("high overlap suppresses an otherwise material lead", () => {
  const result = recommendFromRows("霞烁刃还是巨九哪个好？", [
    ...baseRows.slice(0, 2),
    row([NAVORI, HYDRA, INFINITY_EDGE], [150, 150, 150, 150, 150, 150, 150, 150])
  ], { catalog });

  assert.equal(result.comparison.winner, null);
  assert.equal(result.comparison.decision.reason, "overlap_too_high");
});

test("stale evidence suppresses an otherwise material winner", () => {
  const result = recommendFromRows("霞烁刃还是巨九哪个好？", baseRows.slice(0, 2), {
    catalog,
    evidenceReliable: false
  });

  assert.equal(result.comparison.winner, null);
  assert.equal(result.comparison.decision.reason, "stale_evidence");
});

test("generic artifact comparison blocks before a remote request", async () => {
  let calls = 0;
  let contextCalls = 0;
  const result = await recommendForInput("霞比较神器哪个好？", {
    catalog,
    useSession: false,
    compsClient: {
      async getLatestClusterInfo() { contextCalls += 1; return []; },
      async getCompOptions() { contextCalls += 1; return []; }
    },
    metaTFTClient: { async getUnitBuilds() { calls += 1; return { data: baseRows }; } }
  });

  assert.equal(result.clarification.reason, "missing_specific_comparison_items");
  assert.equal(calls, 0);
  assert.equal(contextCalls, 0);
});

test("an anvil choice without named drops clarifies before remote requests", async () => {
  let calls = 0;
  const result = await recommendForInput("霞在神器铁砧里选一个", {
    catalog,
    useSession: false,
    metaTFTClient: { async getUnitBuilds() { calls += 1; return { data: baseRows }; } }
  });

  assert.equal(result.clarification.reason, "missing_specific_comparison_items");
  assert.equal(calls, 0);
});

test("an unavailable candidate is clarified before a remote request", async () => {
  const unavailableCatalog = createCatalog({
    items: catalog.items.map((item) => item.apiName === HYDRA
      ? { ...item, current: false, obtainable: false }
      : item)
  });
  let calls = 0;
  const result = await recommendForInput("霞烁刃还是巨九哪个好？", {
    catalog: unavailableCatalog,
    useSession: false,
    metaTFTClient: { async getUnitBuilds() { calls += 1; return { data: baseRows }; } }
  });

  assert.equal(result.clarification.reason, "unavailable_comparison_item");
  assert.equal(calls, 0);
});

test("a named emblem stays a concrete catalog candidate under special policy", () => {
  const result = planQuery("霞比较观星者纹章和烁刃哪个好？", { catalog });

  assert.deepEqual(result.query.comparisonItems, [STARGAZER_EMBLEM, NAVORI]);
  assert.equal(result.query.itemPolicy, "include_special");
  assert.equal(result.query.comparisonItems.includes("emblem"), false);
});

test("conflicting primary metrics clarify before remote aggregation", async () => {
  let calls = 0;
  const result = await recommendForInput("霞烁刃还是巨九，既看上分又看吃鸡哪个好？", {
    catalog,
    useSession: false,
    metaTFTClient: { async getUnitBuilds() { calls += 1; return { data: baseRows }; } }
  });

  assert.equal(result.clarification.reason, "conflicting_primary_metric");
  assert.equal(calls, 0);
});

test("an impossible locked-plus-candidate set clarifies before remote aggregation", async () => {
  let calls = 0;
  const result = await recommendForInput("霞已有羊刀无尽巨杀，烁刃还是巨九哪个好？", {
    catalog,
    useSession: false,
    metaTFTClient: { async getUnitBuilds() { calls += 1; return { data: baseRows }; } }
  });

  assert.equal(result.clarification.reason, "comparison_set_conflict");
  assert.equal(calls, 0);
});

test("comparison cache keys include sorted candidates, mode, and primary metric", () => {
  const base = {
    unit: "TFT17_Xayah",
    comparisonMode: "exclusive_presence",
    comparisonItems: [NAVORI, HYDRA],
    primaryMetric: "top4Rate"
  };
  const reversed = makeQueryCacheKey({ ...base, comparisonItems: [HYDRA, NAVORI] });
  const changedMetric = makeQueryCacheKey({ ...base, primaryMetric: "winRate" });
  const changedCatalog = makeQueryCacheKey({ ...base, catalogVersion: "next-patch" });

  assert.equal(makeQueryCacheKey(base), reversed);
  assert.notEqual(makeQueryCacheKey(base), changedMetric);
  assert.notEqual(makeQueryCacheKey(base), changedCatalog);
});

test("comparison assumptions retain current, preference, and default origins", () => {
  const result = recommendFromRows("霞烁刃还是巨九哪个好？", baseRows, {
    catalog,
    preferences: { minSamples: 150 }
  });

  assert.equal(result.query.assumptions.find((entry) => entry.key === "comparison_items").origin, "current_input");
  assert.equal(result.query.assumptions.find((entry) => entry.key === "min_samples").origin, "preference");
  assert.equal(result.query.assumptions.find((entry) => entry.key === "days").origin, "system_default");
});

test("structured parser schema separates locked, comparison, and excluded mentions", () => {
  const validation = validateStructuredParserOutput({
    intent: "unit_item_comparison",
    entities: { unit_mentions: ["霞"], item_mentions: ["羊刀", "烁刃", "巨九"] },
    constraints: {
      locked_items: ["羊刀"],
      comparison_items: ["烁刃", "巨九"],
      excluded_items: ["无尽"],
      comparison_mode: "exclusive_presence",
      primary_metric: "top4Rate"
    },
    needs_clarification: false,
    clarification_question: null
  });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.value.constraints.lockedItemMentions, ["羊刀"]);
  assert.deepEqual(validation.value.constraints.comparisonItemMentions, ["烁刃", "巨九"]);
});

test("structured parser rejects model-generated item API IDs", () => {
  const validation = validateStructuredParserOutput({
    intent: "unit_item_comparison",
    entities: { item_mentions: [NAVORI, HYDRA] },
    constraints: {
      comparison_items: [NAVORI, HYDRA],
      comparison_mode: "exclusive_presence",
      primary_metric: "top4Rate"
    },
    needs_clarification: false,
    clarification_question: null
  });

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /not API IDs/);
});

test("fake LLM unknown candidates and statistics cannot drive a query", async () => {
  let calls = 0;
  const result = await recommendForInput("霞比较一下装备", {
    catalog,
    useSession: false,
    structuredParser: async () => ({
      intent: "unit_item_comparison",
      entities: { item_mentions: ["不存在神器甲", "不存在神器乙"] },
      constraints: {
        comparison_items: ["不存在神器甲", "不存在神器乙"],
        comparison_mode: "exclusive_presence",
        primary_metric: "top4Rate",
        winner: NAVORI,
        score: 999
      },
      needs_clarification: false,
      clarification_question: null
    }),
    useStructuredParser: "always",
    metaTFTClient: { async getUnitBuilds() { calls += 1; return { data: baseRows }; } }
  });

  assert.equal(result.parsed.parser.structuredParser.valid, false);
  assert.equal(result.clarification.reason, "missing_comparison_option");
  assert.equal(calls, 0);
});

test("schema-valid unknown LLM mentions still fail catalog resolution", async () => {
  let calls = 0;
  const result = await recommendForInput("霞比较一下装备", {
    catalog,
    useSession: false,
    structuredParser: async () => ({
      intent: "unit_item_comparison",
      entities: { item_mentions: ["不存在神器甲", "不存在神器乙"] },
      constraints: {
        comparison_items: ["不存在神器甲", "不存在神器乙"],
        comparison_mode: "exclusive_presence",
        primary_metric: "top4Rate"
      },
      needs_clarification: false,
      clarification_question: null
    }),
    useStructuredParser: "always",
    metaTFTClient: { async getUnitBuilds() { calls += 1; return { data: baseRows }; } }
  });

  assert.equal(result.parsed.parser.structuredParser.valid, true);
  assert.deepEqual(result.query.comparisonItems, []);
  assert.equal(result.clarification.reason, "missing_comparison_option");
  assert.equal(calls, 0);
});

test("structured parser can reclassify a complex anvil choice without inventing entities", async () => {
  const input = "霞在铁砧开出烁刃、巨九，想选收益更高的";
  const result = await recommendForInput(input, {
    catalog,
    useSession: false,
    response: baseRows,
    structuredParser: async ({ parsed }) => {
      assert.equal(parsed.parser.multipleItemRelationAmbiguous, true);
      return {
        intent: "unit_item_comparison",
        entities: { item_mentions: ["烁刃", "巨九"] },
        constraints: {
          locked_items: [],
          comparison_items: ["烁刃", "巨九"],
          excluded_items: [],
          comparison_mode: "exclusive_presence",
          primary_metric: "top4Rate"
        },
        needs_clarification: false,
        clarification_question: null
      };
    },
    useStructuredParser: "always"
  });

  assert.deepEqual(result.query.lockedItems, []);
  assert.deepEqual(result.query.comparisonItems, [NAVORI, HYDRA]);
  assert.equal(result.clarification.needsClarification, false);
});

test("conversation inherits the unit for an item-only comparison", async () => {
  const cacheStore = new MemoryCacheStore();
  await recommendForInput("霞带什么装备？", { catalog, cacheStore, response: baseRows });
  const result = await recommendForInput("烁刃还是巨九呢？", { catalog, cacheStore, response: baseRows });

  assert.equal(result.query.unit, "TFT17_Xayah");
  assert.deepEqual(result.query.comparisonItems, [NAVORI, HYDRA]);
  assert.equal(result.query.assumptions.find((entry) => entry.key === "unit").origin, "conversation");
});

test("comparison constraint follow-ups retain candidates and update only the requested field", async () => {
  const cacheStore = new MemoryCacheStore();
  await recommendForInput("霞烁刃还是巨九哪个好？", { catalog, cacheStore, response: baseRows });
  const ranked = await recommendForInput("大师以上呢？", { catalog, cacheStore, response: baseRows });
  const winFirst = await recommendForInput("吃鸡优先呢？", { catalog, cacheStore, response: baseRows });

  assert.equal(ranked.query.intent, "unit_item_comparison");
  assert.deepEqual(ranked.query.comparisonItems, [NAVORI, HYDRA]);
  assert.deepEqual(ranked.query.rankFilter, ["CHALLENGER", "GRANDMASTER", "MASTER"]);
  assert.deepEqual(winFirst.query.comparisonItems, [NAVORI, HYDRA]);
  assert.equal(winFirst.query.primaryMetric, "winRate");
  assert.equal(winFirst.query.sort, "win_first");
});

test("conversation appends a new candidate and can add a locked item", async () => {
  const cacheStore = new MemoryCacheStore();
  await recommendForInput("霞烁刃还是巨九哪个好？", { catalog, cacheStore, response: baseRows });
  const appended = await recommendForInput("那死亡之蔑呢？", { catalog, cacheStore, response: baseRows });
  const locked = await recommendForInput("我已经有羊刀。", {
    catalog,
    cacheStore,
    response: [
      row([NAVORI, RAGEBLADE, INFINITY_EDGE], strong),
      row([HYDRA, RAGEBLADE, INFINITY_EDGE], weak),
      row([DEFIANCE, RAGEBLADE, INFINITY_EDGE], medium)
    ]
  });

  assert.deepEqual(appended.query.comparisonItems, [NAVORI, HYDRA, DEFIANCE]);
  assert.deepEqual(
    appended.query.assumptions.find((entry) => entry.key === "comparison_items").origins,
    ["conversation", "current_input"]
  );
  assert.deepEqual(locked.query.comparisonItems, [NAVORI, HYDRA, DEFIANCE]);
  assert.deepEqual(locked.query.lockedItems, [RAGEBLADE]);
  assert.equal(locked.query.itemPolicy, "include_artifact");
});

test("conversation clarifies when appending a sixth candidate", async () => {
  const cacheStore = new MemoryCacheStore();
  await recommendForInput("霞比较羊刀、无尽、巨杀、杀人剑和轻语哪个好？", {
    catalog,
    cacheStore,
    response: baseRows
  });
  const result = await recommendForInput("那朔极之矛呢？", {
    catalog,
    cacheStore,
    response: baseRows
  });

  assert.equal(result.query.comparisonItems.length, 6);
  assert.equal(result.clarification.reason, "too_many_comparison_options");
  assert.equal(result.query.pendingComparison, true);
});

test("conversation removal can leave too few candidates and must clarify", async () => {
  const cacheStore = new MemoryCacheStore();
  await recommendForInput("霞烁刃还是巨九哪个好？", { catalog, cacheStore, response: baseRows });
  const result = await recommendForInput("不要巨九了。", { catalog, cacheStore, response: baseRows });
  const completed = await recommendForInput("死亡之蔑", { catalog, cacheStore, response: baseRows });

  assert.deepEqual(result.query.comparisonItems, [NAVORI]);
  assert.equal(result.clarification.reason, "missing_comparison_option");
  assert.equal(result.query.pendingComparison, true);
  assert.deepEqual(completed.query.comparisonItems, [NAVORI, DEFIANCE]);
  assert.deepEqual(completed.query.excludedItems, [HYDRA]);
  assert.equal(completed.clarification.needsClarification, false);
});

test("ambiguous comparison replacement asks which original candidate to replace", async () => {
  const cacheStore = new MemoryCacheStore();
  await recommendForInput("霞烁刃还是巨九哪个好？", { catalog, cacheStore, response: baseRows });
  const result = await recommendForInput("换成死亡之蔑呢？", { catalog, cacheStore, response: baseRows });
  const targeted = await recommendForInput("把巨九换成死亡之蔑", {
    catalog,
    cacheStore,
    response: baseRows
  });

  assert.equal(result.clarification.reason, "ambiguous_comparison_replacement");
  assert.match(result.clarification.question, /替换原来的哪一件/);
  assert.deepEqual(targeted.query.comparisonItems, [NAVORI, DEFIANCE]);
  assert.equal(targeted.clarification.reason, null);
});

test("comp ranking session state never supplies an item comparison unit", async () => {
  const cacheStore = new MemoryCacheStore();
  await cacheStore.setSessionState("last_query", {
    query: { intent: "comp_rankings", rankFilter: ["MASTER"] }
  });
  let calls = 0;
  const result = await recommendForInput("烁刃还是巨九哪个好？", {
    catalog,
    cacheStore,
    metaTFTClient: { async getUnitBuilds() { calls += 1; return { data: baseRows }; } }
  });

  assert.equal(result.query.unit, undefined);
  assert.equal(result.clarification.reason, "missing_unit_with_item");
  assert.equal(calls, 0);
});
