import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_QUERY_OPTIONS,
  ITEM_AVAILABILITY_OVERRIDES,
  MemoryCacheStore,
  buildCompsContextRankings,
  buildItemCatalogAudit,
  buildItemCatalogFromItemsResponse,
  buildTraitCatalogFromCompsData,
  createCatalog,
  filterItemCatalogAudit,
  itemCatalogAuditToCsv,
  parseQuery,
  planQuery,
  recommendForInput
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleItemCatalogAuditRequest,
  handleRecommendRequest,
  loadRuntimeCatalog
} from "../src/app/small-window-server.js";

const compOptions = [
  {
    cluster: "stargazer-xayah",
    comp_name: "观星霞",
    units_list: "TFT17_Xayah&TFT17_Aatrox",
    traits_list: "TFT17_Stargazer_Mountain_1",
    count: 420,
    score: 71,
    avg: 3.8,
    top4_rate: 0.61
  },
  {
    cluster: "ranged-xayah",
    comp_name: "狙神霞",
    units_list: "TFT17_Xayah&TFT17_Aatrox",
    traits_list: "TFT17_RangedTrait_1",
    count: 310,
    score: 65,
    avg: 4.0,
    top4_rate: 0.57
  }
];

const buildRows = [{
  unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
  placement_count: [120, 100, 90, 80, 60, 40, 30, 20]
}];

function exactCompResponse(options = compOptions) {
  return {
    data: options.map((option, index) => ({
      units_traits: `${option.units_list}|${option.traits_list}`,
      comp_name: option.comp_name,
      placement_count: index === 0
        ? [90, 80, 70, 60, 50, 40, 20, 10]
        : [70, 60, 55, 45, 35, 25, 15, 5]
    }))
  };
}

function exactCompClient(options = compOptions) {
  return {
    async getExactUnitsTraits2() {
      return exactCompResponse(options);
    }
  };
}

test("comp ranking follow-up keeps the intent and only replaces the rank constraint", async () => {
  const cacheStore = new MemoryCacheStore();
  const catalog = createCatalog({
    traits: buildTraitCatalogFromCompsData({ compOptions })
  });
  const runtime = createSmallWindowRuntime({
    catalog,
    compsData: { compOptions },
    cacheStore,
    metaTFTClient: exactCompClient(),
    fetchItems: false
  });

  const first = await handleRecommendRequest({
    input: "推荐当前版本热门阵容",
    preferences: {
      ...DEFAULT_QUERY_OPTIONS,
      defaultContextStrategy: "popular",
      structuredParserMode: "inherit"
    }
  }, runtime);
  const second = await handleRecommendRequest({ input: "大师以上呢？" }, runtime);

  assert.equal(first.payload.type, "comp_rankings");
  assert.equal(first.payload.query.constraintSources.days, "system_default");
  assert.equal(first.payload.query.constraintSources.rankFilter, "system_default");
  assert.equal(second.payload.type, "comp_rankings");
  assert.equal(second.payload.query.intent, "comp_rankings");
  assert.deepEqual(second.payload.query.rankFilter, ["CHALLENGER", "GRANDMASTER", "MASTER"]);
  assert.equal(second.payload.query.constraintSources.rankFilter, "current_input");
  assert.equal(second.payload.query.sessionContext.inherited, true);
  assert.equal(second.payload.query.sessionContext.inheritedKeys.includes("days"), true);
  assert.equal(second.payload.clarification, undefined);
});

test("global comp rankings clarify unsupported unit, item, and trait constraints", async () => {
  const cacheStore = new MemoryCacheStore();
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    compsData: { compOptions },
    cacheStore,
    fetchItems: false
  });

  const result = await handleRecommendRequest({ input: "推荐霞的热门阵容" }, runtime);
  const genericEmblem = await handleRecommendRequest({ input: "推荐加入纹章的热门阵容" }, runtime);
  const unresolvedTrait = await handleRecommendRequest({ input: "推荐3神秘羁绊的热门阵容" }, runtime);

  assert.equal(result.payload.type, "clarification");
  assert.equal(result.payload.clarification.reason, "unsupported_comp_entity_filter");
  assert.equal(result.payload.query.unit, "TFT17_Xayah");
  assert.equal(genericEmblem.payload.clarification.reason, "missing_specific_emblem");
  assert.equal(unresolvedTrait.payload.clarification.reason, "unsupported_comp_entity_filter");
  assert.equal(cacheStore.getSessionState("last_query"), null);
});

test("comp win-first sorting uses a real win-rate field and never substitutes score", () => {
  const parsed = parseQuery("吃鸡优先的热门阵容");
  const withRates = buildCompsContextRankings(parsed, {
    compsData: {
      compOptions: [
        { cluster: "high-score", comp_name: "高分低吃鸡", count: 300, score: 99, win_rate: 0.08 },
        { cluster: "high-win", comp_name: "高吃鸡", count: 200, score: 40, win_rate: 0.16 }
      ]
    }
  });
  assert.equal(withRates.comps[0].clusterId, "high-win");
  assert.equal(withRates.comps[0].winRate, 0.16);
  assert.equal(withRates.source.winRateAvailable, true);

  const withoutRates = buildCompsContextRankings(parsed, {
    compsData: {
      compOptions: [
        { cluster: "high-score", count: 100, score: 99 },
        { cluster: "high-sample", count: 300, score: 10 }
      ]
    }
  });
  assert.equal(withoutRates.comps[0].clusterId, "high-sample");
  assert.equal(withoutRates.source.winRateAvailable, false);
  assert.match(withoutRates.query.warnings.join("\n"), /未提供吃鸡率/);
});

test("explicit equipment wording wins over broad comp-ranking vocabulary", async () => {
  const input = "当前版本霞阵容什么装备最好？";
  assert.equal(parseQuery(input).intent, "unit_build_rankings");
  assert.equal(parseQuery("推荐当前版本哪个阵容更好？").intent, "comp_rankings");

  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    compsData: { compOptions },
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    recommendForInputImpl: (queryInput, options) => recommendForInput(queryInput, {
      ...options,
      response: buildRows
    })
  });
  const result = await handleRecommendRequest({ input }, runtime);

  assert.notEqual(result.payload.type, "comp_rankings");
  assert.equal(result.payload.query.unit, "TFT17_Xayah");
  assert.equal(parseQuery("当前版本什么阵容效果强？").intent, "comp_rankings");
});

test("English rank tokens are mutually exclusive and multi-digit days stay intact", () => {
  assert.deepEqual(parseQuery("grandmaster以上").rankFilter, ["CHALLENGER", "GRANDMASTER"]);
  assert.deepEqual(parseQuery("grandmaster").rankFilter, ["GRANDMASTER"]);
  assert.equal(parseQuery("最近11天呢").days, 11);
  assert.equal(parseQuery("近21天").days, 21);
  assert.equal(parseQuery("过去一天").days, 1);
});

test("runtime catalogs use an unfiltered patch snapshot instead of rank and day statistics", async () => {
  const observed = {};
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    fetchItems: true,
    metaTFTClient: {
      async getItems(params) {
        observed.items = params;
        return { data: [{ items: "TFT_Item_GuinsoosRageblade" }] };
      },
      async getUnitsUnique(params) {
        observed.units = params;
        return { data: [] };
      },
      async getTraits(params) {
        observed.traits = params;
        return { data: [] };
      }
    },
    compsClient: {
      async getLatestClusterInfo() { return []; },
      async getCompOptions() { return []; },
      async getCompBuilds() { return []; }
    }
  });

  await loadRuntimeCatalog(runtime, {
    patch: "current",
    queue: "1100",
    days: 1,
    rankFilter: ["CHALLENGER"]
  });

  for (const params of Object.values(observed)) {
    assert.equal(params.patch, "current");
    assert.equal(params.queue, "1100");
    assert.equal("days" in params, false);
    assert.equal("rank" in params, false);
  }
});

test("switching from comp rankings to a unit query does not leak comp-only session constraints", async () => {
  const cacheStore = new MemoryCacheStore();
  const catalog = createCatalog({
    traits: buildTraitCatalogFromCompsData({ compOptions })
  });
  const runtime = createSmallWindowRuntime({
    catalog,
    compsData: { compOptions },
    cacheStore,
    metaTFTClient: exactCompClient(),
    fetchItems: false,
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      response: buildRows
    })
  });

  await handleRecommendRequest({ input: "大师以上热门阵容" }, runtime);
  const unit = await handleRecommendRequest({ input: "霞什么装备最好？" }, runtime);

  assert.equal(unit.payload.type, "unit_build_rankings");
  assert.equal(unit.payload.query.unit, "TFT17_Xayah");
  assert.notDeepEqual(unit.payload.query.rankFilter, ["CHALLENGER", "GRANDMASTER", "MASTER"]);
  assert.equal(unit.payload.query.sessionContext, null);
});

test("all seven verified Stargazer names map to their exact API suffix", () => {
  const mapping = new Map([
    ["勋章", "Medallion"],
    ["圣坛", "Shield"],
    ["女猎手", "Huntress"],
    ["泉水", "Fountain"],
    ["秀山", "Mountain"],
    ["蟒蛇", "Serpent"],
    ["野猪", "Wolf"]
  ]);
  const compData = {
    compOptions: [...mapping.values()].map((suffix) => ({
      cluster: suffix,
      units_list: "TFT17_Xayah",
      traits_list: `TFT17_Stargazer_${suffix}_1`,
      count: 200
    }))
  };
  const catalog = createCatalog({ traits: buildTraitCatalogFromCompsData(compData) });

  for (const [name, suffix] of mapping) {
    const parsed = parseQuery(`霞 ${name}观星 装备`, { catalog });
    assert.deepEqual(parsed.traitFilters, [`TFT17_Stargazer_${suffix}_1`], name);
    const trait = catalog.traitByFilterId.get(parsed.traitFilters[0]);
    assert.equal(trait.displayName, `${name}观星`);
    assert.equal(trait.aliasSource, "set17_verified_stargazer_mapping");
  }
});

test("a specified Stargazer effect remains user-sourced instead of using default comp completion", async () => {
  const traits = buildTraitCatalogFromCompsData({
    compOptions: [{
      cluster: "mountain",
      units_list: "TFT17_Xayah",
      traits_list: "TFT17_Stargazer_Mountain_1",
      count: 200
    }]
  });
  const catalog = createCatalog({ traits });
  const result = await recommendForInput("霞 秀山观星 装备", {
    catalog,
    compsData: { compOptions },
    response: buildRows,
    useSession: false
  });

  assert.deepEqual(result.query.traitFilters, ["TFT17_Stargazer_Mountain_1"]);
  assert.equal(result.query.defaultContext, null);
  assert.equal(result.query.assumptions.find((entry) => entry.key === "trait_filters").source, "current_input");
});

test("an unspecified Stargazer effect shows the adopted effect as a system default", async () => {
  const compsData = {
    compOptions: [{
      cluster: "mountain-default",
      comp_name: "秀山霞",
      units_list: "TFT17_Xayah",
      traits_list: "TFT17_Stargazer_Mountain_1",
      count: 260,
      score: 70,
      avg: 3.9
    }]
  };
  const catalog = createCatalog({ traits: buildTraitCatalogFromCompsData(compsData) });
  const runtime = createSmallWindowRuntime({
    catalog,
    compsData,
    cacheStore: new MemoryCacheStore(),
    metaTFTClient: exactCompClient(compsData.compOptions),
    fetchItems: false,
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      response: buildRows
    })
  });
  const response = await handleRecommendRequest({ input: "霞什么装备最好？" }, runtime);

  assert.deepEqual(response.payload.query.traitNames, ["秀山观星"]);
  assert.equal(response.payload.query.traitSource, "system_default");
  assert.equal(response.payload.query.defaultContextSummary.compName, "秀山霞");
});

test("emblems use the shared item catalog for details, locking, policy, and generic clarification", async () => {
  const emblemApiName = "TFT17_Item_StargazerEmblemItem";
  const items = buildItemCatalogFromItemsResponse({
    data: [{ items: emblemApiName, placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }]
  });
  const catalog = createCatalog({ items });
  const runtime = createSmallWindowRuntime({
    catalog,
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    officialItemDetails: new Map([[emblemApiName, {
      apiName: emblemApiName,
      name: "观星者纹章",
      effect: "携带者获得观星者羁绊。",
      recipe: [],
      craftable: false,
      iconUrl: "https://example.test/stargazer.png",
      sourceUrl: "https://example.test/equip.js"
    }]])
  });

  const details = await handleRecommendRequest({ input: "观星者纹章有什么效果？" }, runtime);
  const locked = planQuery("霞加入观星者纹章", { catalog });
  const generic = await recommendForInput("霞加入纹章", {
    catalog,
    response: buildRows,
    useSession: false
  });

  assert.equal(catalog.itemByApiName.get(emblemApiName).category, "emblem");
  assert.equal(details.payload.type, "item_details");
  assert.equal(details.payload.item.apiName, emblemApiName);
  assert.equal(details.payload.item.effect, "携带者获得观星者羁绊。");
  assert.deepEqual(locked.query.ownedItems, [emblemApiName]);
  assert.equal(locked.query.itemPolicy, "include_special");
  assert.equal(generic.clarification.reason, "missing_specific_emblem");
  assert.equal(generic.clarification.blocking, true);
});

test("catalog audit transformation exposes completeness, version binding, issues, filters, and export", async () => {
  const items = buildItemCatalogFromItemsResponse({
    data: [
      { items: "TFT_Item_GuinsoosRageblade", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] },
      { items: "TFT17_Item_StargazerEmblemItem", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }
    ]
  });
  const catalog = createCatalog({ items });
  const details = new Map([["TFT17_Item_StargazerEmblemItem", {
    apiName: "TFT17_Item_StargazerEmblemItem",
    effect: "携带者获得观星者羁绊。",
    recipe: [],
    craftable: false,
    iconUrl: "https://example.test/stargazer.png",
    sourceUrl: "https://example.test/equip.js"
  }]]);
  const report = buildItemCatalogAudit(catalog, details, {
    patch: "17.6",
    generatedAt: "2026-07-12T00:00:00.000Z",
    catalogState: { status: "fresh", source: "metatft_items", updatedAt: "2026-07-12" },
    detailsState: { status: "fresh", source: "tencent_official" }
  });
  const emblem = report.records.find((record) => record.apiName === "TFT17_Item_StargazerEmblemItem");
  const filtered = filterItemCatalogAudit(report.records, { query: "观星", category: "emblem" });
  const overrideSourceFiltered = filterItemCatalogAudit(report.records, { source: "manual_historical_aliases" });
  const csv = itemCatalogAuditToCsv(filtered);

  assert.equal(emblem.canonicalName, "观星者纹章");
  assert.equal(emblem.category, "emblem");
  assert.equal(emblem.completeness.hasEffect, true);
  assert.equal(emblem.completeness.recipeStatus, "not_craftable");
  assert.equal(filtered.length, 1);
  assert.equal(overrideSourceFiltered.some((record) => record.apiName === "TFT_Item_RapidFireCannon"), true);
  assert.match(csv, /TFT17_Item_StargazerEmblemItem/);
  assert.match(csv, /观星者纹章/);

  const runtime = createSmallWindowRuntime({
    catalog,
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    officialItemDetails: details
  });
  const endpoint = await handleItemCatalogAuditRequest(runtime, { category: "emblem", format: "json" });
  assert.equal(endpoint.report.records.length, 1);
  assert.equal(endpoint.export.format, "json");
  assert.match(endpoint.export.content, /TFT17_Item_StargazerEmblemItem/);
});

test("catalog audit refresh invalidates official detail memory before reloading", async () => {
  let detailFetches = 0;
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    fetchOfficialItemDetails: async () => {
      detailFetches += 1;
      return new Map();
    }
  });

  const first = await handleItemCatalogAuditRequest(runtime);
  const cached = await handleItemCatalogAuditRequest(runtime);
  const refreshed = await handleItemCatalogAuditRequest(runtime, { refresh: true });

  assert.equal(detailFetches, 2);
  assert.equal(first.report.officialDetails.cache, "loaded");
  assert.equal(cached.report.officialDetails.cache, "memory");
  assert.equal(refreshed.report.officialDetails.cache, "loaded");
});

test("availability overrides never use permanent current or wildcard bindings", () => {
  assert.equal(ITEM_AVAILABILITY_OVERRIDES.some((override) => ["current", "*"].includes(String(override.patch).toLowerCase())), false);
});

test("current MetaTFT item observations win over an unobserved historical seed with the same official name", () => {
  const items = buildItemCatalogFromItemsResponse({
    data: [{ items: "TFT_Item_MadredsBloodrazor", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }]
  });
  const catalog = createCatalog({ items });
  const current = catalog.itemByApiName.get("TFT_Item_MadredsBloodrazor");
  const historicalSeed = catalog.itemByApiName.get("TFT_Item_GiantSlayer");
  const parsed = parseQuery("霞已经有巨人杀手，剩下两件怎么带？", { catalog });

  assert.equal(current.current, true);
  assert.equal(historicalSeed.current, false);
  assert.equal(historicalSeed.availabilitySource, "metatft_items_snapshot_absence");
  assert.deepEqual(parsed.ownedItems, ["TFT_Item_MadredsBloodrazor"]);
  assert.equal(parsed.parser.entityAmbiguities.length, 0);
});
