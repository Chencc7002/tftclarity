import assert from "node:assert/strict";
import test from "node:test";
import { createCatalog, MemoryCacheStore, buildOfficialTftItemDetailsCatalog } from "../src/index.js";
import { rankEmblems, queryEmblemCarriers, queryEmblemRankings } from "../src/core/emblem-rankings.js";
import { filteredEmblems } from "../src/app/small-window-ui/emblem-rankings.js";
import { createSmallWindowRuntime, handleRecommendRequest } from "../src/app/small-window-server.js";

const A = "DA_18_EmblemBrawler", B = "DA_18_EmblemFae", C = "DA_18_EmblemCoven";
const UNIT = "DA_18_Ahri";
const catalog = createCatalog({ units: [{ apiName: UNIT, zhName: "阿狸", aliases: ["阿狸"] }],
  items: [A, B, C].map(apiName => ({ apiName, zhName: apiName, aliases: [apiName], category: "emblem", current: true, obtainable: true })) });
const details = buildOfficialTftItemDetailsCatalog([
  { equipId: "1", englishName: "DA_Component_FryingPan", name: "金锅锅" },
  { equipId: "2", englishName: "DA_Component_GiantsBelt", name: "腰带" },
  { equipId: "3", englishName: A, name: "斗士纹章", formula: "DA_Component_FryingPan,DA_Component_GiantsBelt" },
  { equipId: "4", englishName: "DA_Component_Spatula", name: "金铲铲" },
  { equipId: "5", englishName: B, name: "花仙子纹章", formula: "4,2" },
  { equipId: "6", englishName: C, name: "魔女纹章", formula: "" }
]);
const response = { data: [
  { items: A, placement_count: [100, 200, 300, 400, 300, 200, 100, 100] },
  { items: B, placement_count: [10, 0, 0, 0, 0, 0, 0, 0] },
  { items: C, placement_count: [100, 200, 300, 400, 0, 0, 0, 0] },
  { items: "old_emblem", placement_count: [99999, 0, 0, 0, 0, 0, 0, 0] }
] };

test("recipes support S18 API names and legacy numeric component IDs", () => {
  assert.equal(details.get(A).craftable, true);
  assert.deepEqual(details.get(A).recipe.map(x => x.apiName), ["DA_Component_FryingPan", "DA_Component_GiantsBelt"]);
  assert.equal(details.get(B).recipe.length, 2);
});

test("emblem ranking excludes unknown and malformed rows, sorts low samples last, and filters actual recipes", () => {
  const rows = rankEmblems(response, { catalog, itemDetails: details });
  assert.deepEqual(rows.map(row => row.item.apiName), [C, A, B]);
  assert.equal(rows.find(row => row.item.apiName === A).stats.games, 1700);
  assert.deepEqual(filteredEmblems(rows, "pan").map(row => row.item.apiName), [A]);
  assert.deepEqual(filteredEmblems(rows, "craftable").map(row => row.item.apiName), [A, B]);
  assert.deepEqual(rankEmblems({ data: [{ items: A, placement_count: [1, -1, 0, 0, 0, 0, 0, 0] }] }, { catalog }), []);
  assert.equal(filteredEmblems(rankEmblems(response, { catalog }), "craftable").length, 0);
});

test("live ranking scopes queue patch rank days and at least one emblem", async () => {
  const query = { queue: "1100", patch: "18.1", days: 1, rank: ["MASTER"], minSamples: 100 };
  let params;
  await queryEmblemRankings({ client: { getItems: async input => { params = input; return response; } }, catalog, itemDetails: details, query });
  assert.deepEqual(params, { queue: "1100", patch: "18.1", days: "1", rank: "MASTER", emblem_count: "1-any", formatnoarray: "true", compact: "true", permit_filter_adjustment: "false" });
});

test("common carriers reuse item aggregation and include popular negative-uplift heroes", async () => {
  const result = await queryEmblemCarriers({ catalog,
    query: { item: A, queue: "1100", patch: "current", days: 3, rank: ["MASTER"] },
    client: { getItemCarrierBuilds: async () => ({ data: [{ unit_builds: `${UNIT}&${A}`, placement_count: [0, 0, 0, 0, 200, 100, 0, 0] }] }) },
    compsClient: { getUnitItemsProcessed: async () => ({ units: { [UNIT]: { avg: 4 } } }) } });
  assert.equal(result.carriers.length, 1);
  assert.equal(result.carriers[0].stats.games, 300);
  assert.ok(result.carriers[0].placementUplift < 0);
});

test("quick query executes through registered ExecutionPlan and validates evidence without an LLM", async () => {
  const runtime = createSmallWindowRuntime({ catalog, cacheStore: new MemoryCacheStore(), fetchItems: false,
    officialItemDetails: details, metaTFTClient: { getItems: async () => response }, compsClient: {},
    fetchOfficialItemDetails: async () => details });
  const result = await handleRecommendRequest({ input: "查询可合成转职强度排行", preferences: { conclusionMode: "off" },
    quickTask: { schemaVersion: "quick-task.v1", requestId: "emblem-test", id: "emblem-rankings", operation: "emblem_rankings", arguments: {} } }, runtime);
  assert.equal(result.statusCode, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.type, "emblem_rankings");
  assert.equal(result.payload.executionPlan.steps[0].tool, "emblem_rankings");
  assert.equal(result.payload.rows.length, 3);
  assert.equal(result.payload.meta.llmUsed, false);
});

test("emblem statistics reject impossible large samples and unsafe totals", () => {
  for (const placement_count of [[500, 0, 0, 0, 0, 0, 0, 0], Array(8).fill(Number.MAX_SAFE_INTEGER)]) {
    assert.deepEqual(rankEmblems({ data: [{ items: A, placement_count }] }, { catalog, itemDetails: details }), []);
  }
});

test("sorting retains low-sample demotion without mutating the source ranking", () => {
  const rows = rankEmblems(response, { catalog, itemDetails: details });
  const original = rows.map(row => row.item.apiName);
  assert.deepEqual(filteredEmblems(rows, "all", "games").map(row => row.item.apiName), [A, C, B]);
  assert.deepEqual(filteredEmblems(rows, "all", "top4").map(row => row.item.apiName), [C, A, B]);
  assert.deepEqual(rows.map(row => row.item.apiName), original);
});

test("cancelled emblem requests do not retrieve facts", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(queryEmblemRankings({ client: { getItems: async () => { calls++; } }, catalog,
    query: {}, signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("carrier shortcut rejects regular equipment and unexpected arguments before retrieval", async () => {
  const regular = "DA_Item_Test";
  const mixedCatalog = createCatalog({ units: [...catalog.unitByApiName.values()],
    items: [...catalog.itemByApiName.values(), { apiName: regular, zhName: "普通装备", category: "completed", current: true, obtainable: true }] });
  let calls = 0;
  const runtime = createSmallWindowRuntime({ catalog: mixedCatalog, cacheStore: new MemoryCacheStore(), fetchItems: false,
    metaTFTClient: { getItemCarrierBuilds: async () => { calls++; } }, compsClient: {} });
  const request = arguments_ => handleRecommendRequest({ input: "常见携带英雄", preferences: { conclusionMode: "off" },
    quickTask: { schemaVersion: "quick-task.v1", requestId: "invalid-emblem", id: "emblem-carriers",
      operation: "emblem_carriers", arguments: arguments_ } }, runtime);
  const regularResult = await request({ item: regular });
  assert.equal(regularResult.statusCode, 400);
  assert.equal(regularResult.payload.code, "invalid_emblem");
  assert.equal((await request({ item: A, url: "https://example.com" })).statusCode, 400);
  assert.equal(calls, 0);
});

test("carrier shortcut decorates existing emblem builds without changing their evidence or querying more builds", async () => {
  const items = [A, "DA_EdgeOfNight", "DA_GuinsoosRageblade"];
  let calls = 0;
  const runtime = createSmallWindowRuntime({ catalog, cacheStore: new MemoryCacheStore(), fetchItems: false,
    officialItemDetails: details, fetchOfficialItemDetails: async () => details,
    metaTFTClient: { getItemCarrierBuilds: async () => { calls++; return { data: [
      { unit_builds: `${UNIT}&${items.join("|")}`, placement_count: [20, 30, 40, 50, 40, 30, 20, 10] }
    ] }; } }, compsClient: { getUnitItemsProcessed: async () => ({ units: { [UNIT]: { avg: 4.5 } } }) } });
  const { statusCode, payload } = await handleRecommendRequest({ input: "常见携带英雄",
    preferences: { conclusionMode: "off" }, quickTask: { schemaVersion: "quick-task.v1", requestId: "carrier-build-display",
      id: "emblem-carriers", operation: "emblem_carriers", arguments: { item: A } } }, runtime);
  assert.equal(statusCode, 200);
  assert.equal(calls, 1);
  const build = payload.carriers[0].builds[0];
  assert.deepEqual(build.items, items);
  assert.deepEqual(build.displayItems.map(item => item.apiName), items);
  assert.equal(build.displayItems[0].name, "斗士纹章");
  assert.equal(build.displayItems[0].locked, true);
  assert.ok(build.displayItems.every(item => item.iconUrl?.startsWith("https://")));
  assert.equal(build.stats.games, 240);
});

test("S19 emblem rankings expose Smeech exclusion option, pass MetaTFT exclusion filter, and validate excluded units", async () => {
  const SMEECH = "DA_Smeech19";
  const s19Catalog = createCatalog({
    units: [
      { apiName: UNIT, zhName: "阿狸", aliases: ["阿狸"], current: true },
      { apiName: SMEECH, zhName: "史密奇", enName: "Smeech19", aliases: ["史密奇", "Smeech"], current: true }
    ],
    items: [
      { apiName: A, zhName: "斗士纹章", aliases: ["斗士纹章"], category: "emblem", current: true, obtainable: true },
      { apiName: B, zhName: "花仙子纹章", aliases: ["花仙子纹章"], category: "emblem", current: true, obtainable: true },
      { apiName: C, zhName: "魔女纹章", aliases: ["魔女纹章"], category: "emblem", current: true, obtainable: true }
    ]
  });
  let receivedItemParams = null;
  let receivedCarrierPlan = null;
  const runtime = createSmallWindowRuntime({
    catalog: s19Catalog,
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    officialItemDetails: details,
    fetchOfficialItemDetails: async () => details,
    metaTFTClient: {
      getItems: async (params) => { receivedItemParams = params; return response; },
      getItemCarrierBuilds: async (plan) => {
        receivedCarrierPlan = plan;
        return { data: [{ unit_builds: `${UNIT}&${A}`, placement_count: [30, 30, 30, 30, 20, 20, 20, 20] }] };
      }
    },
    compsClient: { getUnitItemsProcessed: async () => ({ units: { [UNIT]: { avg: 4.3 } } }) }
  });

  // Default S19 query includes Smeech (excludeUnits: []) and exposes emblemUnitFilter
  const defaultRes = await handleRecommendRequest({
    input: "查询可合成转职强度排行",
    seasonContextId: "set19-pbe",
    preferences: { conclusionMode: "off" },
    quickTask: { schemaVersion: "quick-task.v1", requestId: "s19-default", id: "emblem-rankings", operation: "emblem_rankings", arguments: {} }
  }, runtime);
  assert.equal(defaultRes.statusCode, 200);
  assert.deepEqual(defaultRes.payload.query.excludeUnits, []);
  assert.equal(defaultRes.payload.emblemUnitFilter?.apiName, SMEECH);
  assert.equal(defaultRes.payload.emblemUnitFilter?.name, "史密奇");
  assert.equal(receivedItemParams["sf[0][and][0][unit_unique]"], undefined);
  assert.match(defaultRes.payload.text, /斗士纹章/);

  // Excluding Smeech injects sf[0][and][0][unit_unique]=!DA_Smeech19-1 and updates URL/summary
  const excludedRes = await handleRecommendRequest({
    input: "查询可合成转职强度排行",
    seasonContextId: "set19-pbe",
    preferences: { conclusionMode: "off" },
    quickTask: { schemaVersion: "quick-task.v1", requestId: "s19-excl", id: "emblem-rankings", operation: "emblem_rankings", arguments: { excludeUnits: [SMEECH] } }
  }, runtime);
  assert.equal(excludedRes.statusCode, 200);
  assert.deepEqual(excludedRes.payload.query.excludeUnits, [SMEECH]);
  assert.equal(receivedItemParams["sf[0][and][0][unit_unique]"], `!${SMEECH}-1`);
  assert.match(excludedRes.payload.source.url, /unit_unique=%21DA_Smeech19-1/);
  assert.match(excludedRes.payload.text, /已排除史密奇/);

  // Carrier lookup on PBE with excludeUnits routes to unit_builds with the same exclusion filter
  const carrierRes = await handleRecommendRequest({
    input: "常见携带英雄",
    seasonContextId: "set19-pbe",
    preferences: { conclusionMode: "off" },
    quickTask: { schemaVersion: "quick-task.v1", requestId: "s19-carriers-excl", id: "emblem-carriers", operation: "emblem_carriers", arguments: { item: A, excludeUnits: [SMEECH] } }
  }, runtime);
  assert.equal(carrierRes.statusCode, 200);
  assert.equal(receivedCarrierPlan.endpoint, "unit_builds");
  assert.equal(receivedCarrierPlan.params["sf[0][and][0][unit_unique]"], `!${SMEECH}-1`);

  // Invalid excluded unit is rejected before retrieval
  const invalidRes = await handleRecommendRequest({
    input: "查询可合成转职强度排行",
    seasonContextId: "set19-pbe",
    preferences: { conclusionMode: "off" },
    quickTask: { schemaVersion: "quick-task.v1", requestId: "s19-invalid-excl", id: "emblem-rankings", operation: "emblem_rankings", arguments: { excludeUnits: ["UNKNOWN_UNIT"] } }
  }, runtime);
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.payload.code, "invalid_exclude_unit");

  // Non-S19 seasons do not expose the Smeech emblemUnitFilter
  const s18Res = await handleRecommendRequest({
    input: "查询可合成转职强度排行",
    seasonContextId: "set18-live",
    preferences: { conclusionMode: "off" },
    quickTask: { schemaVersion: "quick-task.v1", requestId: "s18-default", id: "emblem-rankings", operation: "emblem_rankings", arguments: {} }
  }, runtime);
  assert.equal(s18Res.statusCode, 200);
  assert.equal(s18Res.payload.emblemUnitFilter, null);
});
