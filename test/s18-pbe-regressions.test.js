import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCommunityDragonEntityDetails,
  fetchCommunityDragonEntityDetails
} from "../src/data/communitydragon-entity-details.js";
import { buildItemCatalogFromItemsResponse } from "../src/data/item-catalog.js";
import { buildUnitCatalogFromExplorerRows, mergeCatalogUnits } from "../src/data/domain-catalog.js";
import { createCatalog } from "../src/data/static-data.js";
import { buildCompRankingQuery, planQuery, recommendForInput } from "../src/index.js";
import { calculatePlacementStats } from "../src/core/stats-calculator.js";
import { aggregateItemCarrierRankings } from "../src/core/item-carrier-ranking.js";
import { makeQueryCacheKey } from "../src/data/cache-store.js";
import { buildQueryContext } from "../src/core/context-builder.js";
import { planMetaTFTItemCarrierBuilds, planMetaTFTUnitBuilds } from "../src/core/query-planner.js";
import { normalizeUnitBuildRows } from "../src/data/metatft-response-adapter.js";

test("Set 18 PBE unit builds use the working patch aggregate stats endpoint", () => {
  const query = buildQueryContext({
    intent: "unit_best_3_items",
    unit: "DA_18_Morgana"
  }, {
    catalog: createCatalog({
      units: [{ apiName: "DA_18_Morgana", zhName: "Morgana", cost: 4, current: true }],
      traits: [],
      items: []
    }),
    preferences: {
      seasonContextId: "set18-pbe",
      providerVersion: "metatft-pbe.v1",
      effectivePatch: "18.1",
      currentPatch: "18.1",
      patch: "current",
      unitBuildPatch: "18.1",
      queue: "PBE"
    }
  });
  const plan = planMetaTFTUnitBuilds(query);

  assert.equal(query.patch, "18.1");
  assert.equal(plan.path, "/tft-stat-api/unit_detail_items");
  assert.deepEqual(plan.params, {
    queue: "PBE",
    patch: "18.1",
    b_patch: "",
    days: "3",
    permit_filter_adjustment: "true",
    unit: "DA_18_Morgana",
    num_items: "3"
  });
});

test("Set 18 PBE unit detail builds adapt to Explorer-compatible rows", () => {
  const rows = normalizeUnitBuildRows({
    unit: "DA_18_Morgana",
    builds: [{
      buildNames: "DA_18_EmblemVanguard|DA_Morellonomicon|DA_VoidStaff",
      places: [20, 18, 16, 14, 10, 8, 6, 4],
      total: 96
    }],
    build_games: [{ patch: "18.1", b_patch_version: "", count: 30702 }]
  });

  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].unit_builds,
    "DA_18_Morgana&DA_18_EmblemVanguard|DA_Morellonomicon|DA_VoidStaff"
  );
  assert.deepEqual(rows[0].placement_count, [20, 18, 16, 14, 10, 8, 6, 4]);
});

test("Set 18 PBE item carriers use the aggregate item detail endpoint", () => {
  const plan = planMetaTFTItemCarrierBuilds({
    item: "DA_Artifact_TitanicHydra",
    queue: "PBE",
    patch: "18.1",
    days: 3,
    rankFilter: ["CHALLENGER"]
  });

  assert.equal(plan.path, "/tft-stat-api/item_detail");
  assert.deepEqual(plan.params, {
    queue: "PBE",
    patch: "18.1",
    b_patch: "",
    days: "3",
    permit_filter_adjustment: "true",
    itemName: "DA_Artifact_TitanicHydra"
  });
});

test("Set 18 PBE item detail rows produce carrier uplift rankings", () => {
  const item = "DA_Artifact_TitanicHydra";
  const catalog = createCatalog({
    units: [
      { apiName: "DA_18_ElderDragon", zhName: "Elder Dragon", current: true },
      { apiName: "DA_18_Rengar", zhName: "Rengar", current: true }
    ],
    traits: [],
    items: buildItemCatalogFromItemsResponse({ data: [{ items: item }] }, { includeSeeds: false })
  });
  const response = {
    units: [
      { unit: "DA_18_ElderDragon", places: [281, 172, 119, 102, 81, 73, 43, 21] },
      { unit: "DA_18_Rengar", places: [126, 79, 65, 43, 45, 28, 33, 19] }
    ],
    units_overall: [
      { unit: "DA_18_ElderDragon", places: [21734, 18284, 14796, 13108, 11517, 9878, 7968, 4609] },
      { unit: "DA_18_Rengar", places: [6450, 5895, 4862, 4386, 4049, 3963, 4073, 4266] }
    ]
  };

  const result = aggregateItemCarrierRankings(response, response, {
    item,
    minSamples: 100,
    positiveOnly: true,
    limit: 8,
    buildLimit: 2
  }, { catalog });

  assert.equal(result.type, "item_carrier_rankings");
  assert.equal(result.diagnostics.inputRows, 2);
  assert.ok(result.carriers.length > 0);
  assert.equal(result.carriers[0].builds[0].items[0], item);
});

test("Set 17 unit builds keep using the Explorer endpoint", () => {
  const plan = planMetaTFTUnitBuilds({
    unit: "TFT17_Xayah",
    starLevel: [2],
    itemCount: 3,
    queue: "1100",
    patch: "current",
    days: 3,
    rankFilter: ["PLATINUM"]
  });

  assert.equal(plan.path, "/tft-explorer-api/unit_builds/TFT17_Xayah");
  assert.equal(plan.params.patch, "current");
  assert.equal(plan.params.queue, "1100");
});

test("Set 18 DA Artifact ids inherit canonical manual aliases", () => {
  const items = buildItemCatalogFromItemsResponse({
    data: [{ items: "DA_Artifact_TitanicHydra" }]
  }, { includeSeeds: false });
  const hydra = items.find((item) => item.apiName === "DA_Artifact_TitanicHydra");

  assert.ok(hydra);
  assert.equal(hydra.category, "artifact");
  assert.equal(hydra.aliases.includes("巨九"), true);
  assert.equal(hydra.aliases.includes("巨型九头蛇"), true);
  assert.equal(hydra.aliases.includes("TFT_Item_Artifact_Artifact_TitanicHydra"), false);
});

test("chat routing resolves 巨九 to the Set 18 DA Artifact item", async () => {
  const items = buildItemCatalogFromItemsResponse({
    data: [{ items: "DA_Artifact_TitanicHydra" }]
  }, { includeSeeds: false });
  const catalog = createCatalog({
    units: [
      { apiName: "DA_18_Ahri", zhName: "阿狸", aliases: ["阿狸", "Ahri"], current: true },
      { apiName: "DA_18_Kayle", zhName: "凯尔", aliases: ["凯尔", "Kayle"], current: true }
    ],
    traits: [],
    items
  });
  const result = await recommendForInput("巨九适合给谁", {
    catalog,
    itemCarrierResponse: {
      source: "fixture",
      updatedAt: "2026-08-04T00:00:00.000Z",
      buildResponse: {
        data: [
          {
            unit_builds: "DA_18_Ahri&DA_Artifact_TitanicHydra|TFT_Item_JeweledGauntlet|TFT_Item_SpearOfShojin",
            placement_count: [100, 80, 60, 40, 20, 10, 10, 0]
          },
          {
            unit_builds: "DA_18_Kayle&DA_Artifact_TitanicHydra|TFT_Item_GuinsoosRageblade|TFT_Item_JeweledGauntlet",
            placement_count: [20, 30, 50, 80, 70, 40, 20, 10]
          }
        ]
      },
      baselineResponse: {
        units: {
          DA_18_Ahri: { avg: 4.2 },
          DA_18_Kayle: { avg: 4.6 }
        }
      }
    },
    conversationStateV2Mode: "on",
    semanticShadow: false,
    useSession: false
  });

  assert.equal(result.type, "item_carrier_rankings");
  assert.equal(result.query.item, "DA_Artifact_TitanicHydra");
  assert.ok(result.carriers.length > 0);
});

test("chat routing keeps the champion in explicit Artifact rankings", async () => {
  const items = buildItemCatalogFromItemsResponse({
    data: [
      { items: "DA_Artifact_TitanicHydra" },
      { items: "DA_Artifact_Fishbones" },
      { items: "TFT4_Item_OrnnInfinityForce" },
      { items: "TFT_Item_JeweledGauntlet" },
      { items: "TFT_Item_SpearOfShojin" }
    ]
  }, { includeSeeds: false });
  const catalog = createCatalog({
    units: [{ apiName: "DA_18_Ahri", zhName: "阿狸", aliases: ["阿狸", "Ahri"], current: true }],
    traits: [],
    items
  });
  const result = await recommendForInput("阿狸神器排行", {
    catalog,
    response: [
      {
        unit_builds: "DA_18_Ahri&DA_Artifact_TitanicHydra|TFT_Item_JeweledGauntlet|TFT_Item_SpearOfShojin",
        placement_count: [30, 20, 15, 10, 5, 3, 1, 1]
      },
      {
        unit_builds: "DA_18_Ahri&DA_Artifact_Fishbones|TFT_Item_JeweledGauntlet|TFT_Item_SpearOfShojin",
        placement_count: [10, 15, 20, 20, 10, 5, 3, 2]
      },
      {
        unit_builds: "DA_18_Ahri&TFT4_Item_OrnnInfinityForce|TFT_Item_JeweledGauntlet|TFT_Item_SpearOfShojin",
        placement_count: [5, 10, 15, 20, 20, 10, 5, 5]
      }
    ],
    conversationStateV2Mode: "on",
    semanticShadow: false,
    useSession: false
  });

  assert.equal(result.type, "unit_item_rankings");
  assert.equal(result.query.unit, "DA_18_Ahri");
  assert.equal(result.query.itemPolicy, "include_artifact");
  assert.deepEqual(result.query.itemCategories, ["artifact"]);
  assert.equal(result.itemRankings[0]?.apiName, "DA_Artifact_TitanicHydra");
});

test("Set 18 Explorer keeps DA unit ids and maps MetaTFT lookup aliases onto the canonical unit", () => {
  const unitLookupByApiName = new Map([["TFT18_Kayle", {
    apiName: "TFT18_Kayle",
    assetNames: ["DA_18_Kayle"],
    name: "凯尔",
    en_name: "Kayle",
    cost: 2
  }]]);
  const units = buildUnitCatalogFromExplorerRows({
    data: [{ units_unique: "DA_18_Kayle-1", placement_count: [9, 27, 57, 104, 154, 237, 289, 271] }]
  }, { includeSeeds: false, unitLookupByApiName });

  assert.deepEqual(units.map((unit) => unit.apiName), ["DA_18_Kayle"]);
  assert.equal(units[0].zhName, "凯尔");
  assert.equal(units[0].cost, 2);
  assert.equal(units[0].aliases.includes("TFT18_Kayle"), true);
  assert.equal(units[0].aliases.includes("天使"), true);

  const catalog = createCatalog({ units, traits: [], items: [] });
  assert.equal(planQuery("查询天使最稳三件装备", { catalog }).query.unit, "DA_18_Kayle");
  assert.equal(planQuery("查询凯尔最稳三件装备", { catalog }).query.unit, "DA_18_Kayle");
});

test("Set 18 catalog merge removes a persisted TFT18 alias when the DA unit arrives", () => {
  const merged = mergeCatalogUnits([
    { apiName: "TFT18_Kayle", zhName: "凯尔", aliases: ["凯尔"] }
  ], [
    { apiName: "DA_18_Kayle", zhName: "凯尔", aliases: ["Kayle"] }
  ]);
  assert.deepEqual(merged.map((unit) => unit.apiName), ["DA_18_Kayle"]);
  assert.deepEqual(new Set(merged[0].aliases), new Set(["凯尔", "Kayle"]));
});

test("Kayle placement distribution produces ordinary eight-place stats instead of the bad TFT18 sample", () => {
  const stats = calculatePlacementStats([9, 27, 57, 104, 154, 237, 289, 271]);
  assert.equal(stats.games, 1148);
  assert.ok(stats.avgPlacement > 4 && stats.avgPlacement < 7);
  assert.ok(stats.avgPlacement > 2);
  assert.ok(stats.top4Rate > 0.1 && stats.top4Rate < 0.25);
});

test("CommunityDragon PBE details expose Set 18 unit stats, ability, and trait tiers", () => {
  const details = buildCommunityDragonEntityDetails({
    teamplanner: {
      TFTSet18: [{
        character_id: "DA_18_Kayle",
        tier: 2,
        display_name: "凯尔",
        traits: [
          { name: "日光射线", id: "DA_18_Solar" },
          { name: "迅捷射手", id: "DA_18_Rapidfire" }
        ]
      }]
    },
    traits: [{
      display_name: "迅捷射手",
      trait_id: "DA_18_Rapidfire",
      set: "TFTSet18",
      tooltip_text: "你的队伍获得@TeamAS*100@%攻击速度。<br><row>(@MinUnits@)每次攻击+@ASPerAttack*100@%</row>",
      innate_trait_sets: [{ constants: [{ name: "TeamAS", value: 0.1 }] }],
      conditional_trait_sets: [{
        min_units: 2,
        max_units: 2,
        constants: [{ name: "ASPerAttack", value: 0.03 }]
      }]
    }],
    lookup: {
      units: [{
        apiName: "TFT18_Kayle",
        assetNames: ["DA_18_Kayle"],
        stats: { hp: 550, mana: 0, initialMana: 0, damage: 10, armor: 30, magicResist: 30, attackSpeed: 0.75, range: 4, critChance: 0.25 },
        ability: { name: "太阳裁决", desc: "造成<TFTAttribute attributeID=\"MagicDamage\"/>魔法伤害。" },
        attributeValues: { MagicDamage: [56, 84, 98, 112] }
      }]
    }
  }, { tftSet: "TFTSet18", version: "18.1" });

  const kayle = details.units.get("DA_18_Kayle");
  assert.equal(kayle.stats.health, 550);
  assert.equal(kayle.stats.critChance, 25);
  assert.equal(kayle.ability.name, "太阳裁决");
  assert.match(kayle.ability.description, /56\/84\/98\/112/);
  assert.deepEqual(kayle.traitNames, ["日光射线", "迅捷射手"]);
  assert.equal(details.traits.get("DA_18_Rapidfire").levels[0].units, 2);
  assert.match(details.traits.get("DA_18_Rapidfire").levels[0].effect, /3%/);
});

test("CommunityDragon PBE details fall back to local raw snapshots when the network is unavailable", async () => {
  const payloads = {
    planner: { TFTSet18: [{
      character_id: "DA_18_Ahri",
      display_name: "阿狸",
      tier: 4,
      traits: [{ name: "灵魂莲华" }, { name: "法师" }]
    }] },
    traits: [],
    lookup: { units: [{
      apiName: "TFT18_Ahri",
      assetNames: ["DA_18_Ahri"],
      stats: { hp: 850, mana: 100, initialMana: 20, armor: 40, magicResist: 40, attackSpeed: 0.8 },
      ability: {
        name: "灵魄炸弹",
        desc: "造成<TFTAttribute attributeID=\"Damage\"/>魔法伤害",
        attributeValues: { Damage: [485, 735, 3500] }
      }
    }] }
  };
  const details = await fetchCommunityDragonEntityDetails({
    fetchImpl: async () => { throw new Error("offline"); },
    tftSet: "TFTSet18",
    localCachePaths: { teamplanner: "planner", traits: "traits", lookup: "lookup" },
    readJsonFile: async (path) => payloads[path]
  });
  const ahri = details.units.get("DA_18_Ahri");
  assert.equal(ahri.cost, 4);
  assert.equal(ahri.stats.health, 850);
  assert.equal(ahri.ability.name, "灵魄炸弹");
  assert.match(ahri.ability.description, /485\/735\/3500/u);
  assert.deepEqual(ahri.traitNames, ["灵魂莲华", "法师"]);
});

test("composition cache keys isolate popular, trend, and preference result contracts", () => {
  const base = { seasonContextId: "set18-pbe", providerVersion: "metatft-pbe.v1", effectivePatch: "18.1", patch: "18.1", queue: "PBE", intent: "comp_rankings" };
  const popular = makeQueryCacheKey({ ...base, metrics: ["popularity"], popularRequested: true });
  const metricOnly = makeQueryCacheKey({ ...base, metrics: ["popularity"], popularRequested: false });
  const preference = makeQueryCacheKey({ ...base, metrics: ["avg_placement"], preferenceRequested: true, preferenceConditions: { goal: "balanced", count: 3 } });
  assert.notEqual(popular, metricOnly);
  assert.notEqual(popular, preference);
});

test("Set 18 composition queries use patch 18.1 while Explorer remains on current", () => {
  const query = buildCompRankingQuery({
    intent: "comp_rankings",
    patch: "current",
    popularRequested: true
  }, {
    preferences: {
      seasonContextId: "set18-pbe",
      currentPatch: "18.1",
      patch: "current",
      compPatch: "18.1",
      queue: "PBE"
    }
  });

  assert.equal(query.patch, "18.1");
  assert.equal(query.effectivePatch, "18.1");
  assert.equal(query.popularRequested, true);
});
