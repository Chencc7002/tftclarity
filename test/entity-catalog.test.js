import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEntityCatalog,
  normalizeEntityCatalogType
} from "../src/index.js";

function fixtureCatalog() {
  return {
    units: [
      {
        apiName: "TFT17_Xayah",
        zhName: "霞",
        cost: 4,
        current: true,
        aliases: ["xayah"]
      },
      {
        apiName: "TFT17_MasterYi",
        zhName: "易",
        cost: 4,
        current: true,
        aliases: ["剑圣"]
      },
      {
        apiName: "TFT16_OldUnit",
        zhName: "旧棋子",
        current: false,
        aliases: []
      }
    ],
    traits: [
      {
        apiName: "TFT17_Stargazer",
        filterId: "TFT17_Stargazer_1",
        zhName: "观星者",
        current: true,
        aliases: ["2观星"]
      },
      {
        apiName: "TFT17_Stargazer",
        filterId: "TFT17_Stargazer_2",
        zhName: "观星者",
        current: true,
        aliases: ["4观星"]
      },
      {
        apiName: "TFT17_Duelist",
        filterId: "TFT17_Duelist_1",
        zhName: "决斗大师",
        current: true,
        aliases: ["决斗"]
      }
    ]
  };
}

function fixtureDetails() {
  return {
    units: new Map([
      ["TFT17_Xayah", {
        name: "霞",
        cost: 4,
        role: "物理输出",
        traitNames: ["观星者", "神射手"],
        source: { version: "16.14", season: "S17" }
      }],
      ["TFT17_MasterYi", {
        name: "易",
        cost: 4,
        role: "物理战士",
        traitNames: ["决斗大师"],
        source: { version: "16.14", season: "S17" }
      }]
    ]),
    traits: new Map([
      ["TFT17_Stargazer", {
        name: "观星者",
        type: "race",
        levels: [{ units: 2 }, { units: 4 }],
        iconUrl: "https://example.test/stargazer.png",
        source: { version: "16.14", season: "S17" }
      }],
      ["TFT17_Duelist", {
        name: "决斗大师",
        type: "job",
        levels: [{ units: 2 }, { units: 4 }, { units: 6 }],
        iconUrl: "https://example.test/duelist.png",
        source: { version: "16.14", season: "S17" }
      }]
    ])
  };
}

test("entity catalog normalizes public unit and trait aliases", () => {
  assert.equal(normalizeEntityCatalogType("英雄"), "unit");
  assert.equal(normalizeEntityCatalogType("champions"), "unit");
  assert.equal(normalizeEntityCatalogType("羁绊"), "trait");
  assert.equal(normalizeEntityCatalogType("items"), null);
});

test("unit catalog keeps current-season units and supports deterministic filters", () => {
  const result = buildEntityCatalog(fixtureCatalog(), fixtureDetails(), {
    entityType: "unit",
    cost: 4,
    trait: "观星"
  });

  assert.equal(result.pagination.total, 1);
  assert.equal(result.items[0].apiName, "TFT17_Xayah");
  assert.equal(result.items[0].role, "物理输出");
  assert.deepEqual(result.items[0].traitNames, ["观星者", "神射手"]);
  assert.equal(result.items.some((entry) => entry.apiName === "TFT16_OldUnit"), false);
});

test("trait catalog collapses activation tiers into one base trait", () => {
  const result = buildEntityCatalog(fixtureCatalog(), fixtureDetails(), {
    entityType: "trait"
  });

  assert.equal(result.pagination.total, 2);
  const stargazer = result.items.find((entry) => entry.apiName === "TFT17_Stargazer");
  assert.deepEqual(stargazer.tierCounts, [2, 4]);
  assert.equal(stargazer.traitType, "race");
});

test("entity catalogs project bilingual names, roles, and trait labels by display locale", () => {
  const units = buildEntityCatalog(fixtureCatalog(), fixtureDetails(), {
    entityType: "unit",
    locale: "en-US"
  });
  const traits = buildEntityCatalog(fixtureCatalog(), fixtureDetails(), {
    entityType: "trait",
    locale: "en-US"
  });

  const xayah = units.items.find((entry) => entry.apiName === "TFT17_Xayah");
  const masterYi = units.items.find((entry) => entry.apiName === "TFT17_MasterYi");
  const stargazer = traits.items.find((entry) => entry.apiName === "TFT17_Stargazer");
  assert.equal(xayah.name, "Xayah");
  assert.equal(xayah.zhName, "霞");
  assert.equal(xayah.role, "AD Carry");
  assert.deepEqual(xayah.traitNames, ["Stargazer"]);
  assert.equal(masterYi.name, "Master Yi");
  assert.deepEqual(masterYi.traitNames, ["Duelist"]);
  assert.equal(stargazer.name, "Stargazer");
  assert.equal(stargazer.zhName, "观星者");
});

test("entity catalog pagination is bounded", () => {
  const result = buildEntityCatalog(fixtureCatalog(), fixtureDetails(), {
    entityType: "unit",
    page: 1,
    limit: 999
  });

  assert.equal(result.pagination.limit, 200);
  assert.equal(result.pagination.returned, 2);
});

test("unit catalog collapses duplicate runtime ids onto the official detail-backed unit", () => {
  const catalog = {
    units: [
      { apiName: "DA_18_Diana", zhName: "Diana", cost: 3, current: true, aliases: ["diana"] },
      { apiName: "TFT18_Diana", zhName: "Diana", cost: 3, current: true, aliases: ["legacy-diana"] },
      { apiName: "DA_18_Elise", zhName: "Elise", cost: 2, current: true, aliases: ["elise"] },
      { apiName: "DA_18_EliseSpider", zhName: "Elise", cost: 2, current: true, aliases: ["spider-form"] }
    ],
    traits: []
  };
  const details = {
    units: new Map([
      ["DA_18_Diana", {
        apiName: "DA_18_Diana",
        name: "Diana",
        cost: 3,
        traitNames: ["Moon"],
        iconUrl: "https://example.test/diana.jpg"
      }],
      ["DA_18_Elise", {
        apiName: "DA_18_Elise",
        name: "Elise",
        cost: 2,
        traitNames: ["Coven"],
        iconUrl: "https://example.test/elise.jpg"
      }]
    ]),
    traits: new Map()
  };

  const all = buildEntityCatalog(catalog, details, { entityType: "unit" });
  const legacyAlias = buildEntityCatalog(catalog, details, {
    entityType: "unit",
    query: "TFT18_Diana"
  });

  assert.equal(all.pagination.total, 2);
  assert.deepEqual(all.items.map((entry) => entry.apiName).sort(), ["DA_18_Diana", "DA_18_Elise"]);
  assert.ok(all.items.every((entry) => entry.hasDetails && entry.iconUrl));
  assert.equal(legacyAlias.pagination.total, 1);
  assert.equal(legacyAlias.items[0].apiName, "DA_18_Diana");
});
