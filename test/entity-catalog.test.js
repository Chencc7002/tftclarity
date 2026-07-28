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

test("entity catalog pagination is bounded", () => {
  const result = buildEntityCatalog(fixtureCatalog(), fixtureDetails(), {
    entityType: "unit",
    page: 1,
    limit: 999
  });

  assert.equal(result.pagination.limit, 200);
  assert.equal(result.pagination.returned, 2);
});
