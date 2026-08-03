import test from "node:test";
import assert from "node:assert/strict";
import {
  answerMechanismClassificationQuery,
  buildMechanismClassificationEvidence,
  normalizeMechanismClassifications,
  parseMechanismClassificationQuery
} from "../src/knowledge/mechanism-classification.js";
import { MemoryCacheStore, createCatalog } from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleRecommendRequest
} from "../src/app/small-window-server.js";

const entityDetails = {
  units: new Map([
    ["TFT_TestFarmer", {
      apiName: "TFT_TestFarmer",
      name: "采金者",
      cost: 2,
      traitNames: ["矿工"],
      ability: { name: "淘金", description: "胜利后获得 2 金币。" }
    }],
    ["TFT_CombatStacker", {
      apiName: "TFT_CombatStacker",
      name: "临时叠层者",
      cost: 3,
      traitNames: ["斗士"],
      ability: { name: "热身", description: "本场战斗每次施法获得攻击力。" }
    }]
  ]),
  traits: new Map([
    ["TFT_ShadowSoul", {
      apiName: "TFT_ShadowSoul",
      name: "暗影岛",
      description: "每场战斗收集灵魂，灵魂会保留。灵魂越多，弈子获得的法强越高。",
      levels: [{ units: 3, effect: "获得基于灵魂数量的法强。" }]
    }]
  ]),
  meta: { provider: "fixture" }
};

test("mechanism question parser maps the four product questions", () => {
  assert.deepEqual(parseMechanismClassificationQuery("哪些可发育？")?.entityTypes, ["unit", "trait"]);
  assert.deepEqual(parseMechanismClassificationQuery("哪些棋子可发育？"), {
    schemaVersion: "mechanism-classification-query.v1",
    metric: "development",
    entityTypes: ["unit"]
  });
  assert.equal(parseMechanismClassificationQuery("哪些棋子可成长？")?.metric, "growth");
  assert.deepEqual(parseMechanismClassificationQuery("哪些羁绊可发育。")?.entityTypes, ["trait"]);
  assert.equal(parseMechanismClassificationQuery("介绍一下暗影岛"), null);
});

test("current-season details are compacted into unit and trait evidence", () => {
  const evidence = buildMechanismClassificationEvidence(entityDetails);
  assert.equal(evidence.length, 3);
  assert.equal(evidence[0].entityType, "unit");
  assert.equal(evidence[0].description, "胜利后获得 2 金币。");
  assert.equal(evidence[2].entityType, "trait");
  assert.deepEqual(evidence[2].levels, [{ units: 3, effect: "获得基于灵魂数量的法强。" }]);
  assert.deepEqual(buildMechanismClassificationEvidence(null), []);
});

test("growth keeps the model verdict and separately flags definition conflicts", () => {
  const evidence = buildMechanismClassificationEvidence(entityDetails);
  const entries = normalizeMechanismClassifications({
    entries: [
      {
        entityType: "unit",
        apiName: "TFT_CombatStacker",
        name: "临时叠层者",
        isGrowth: true,
        isDevelopment: false,
        growthScope: "in_combat",
        persistence: "resets_after_combat",
        confidence: 0.9
      },
      {
        entityType: "trait",
        apiName: "TFT_ShadowSoul",
        name: "暗影岛",
        isGrowth: true,
        isDevelopment: false,
        growthScope: "cross_round",
        persistence: "permanent",
        confidence: 0.95
      },
      {
        entityType: "unit",
        apiName: "HALLUCINATED",
        name: "不存在的棋子",
        isGrowth: true,
        growthScope: "cross_round",
        persistence: "permanent"
      }
    ]
  }, evidence);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].isGrowth, true);
  assert.equal(entries[0].definitionMatchedGrowth, false);
  assert.equal(entries[0].needsReview, true);
  assert.equal(entries[1].isGrowth, true);
  assert.equal(entries[1].definitionMatchedGrowth, true);
});

test("classification scans each entity type once and reuses its season cache", async () => {
  let calls = 0;
  const provider = Object.assign(async () => {
    calls += 1;
    return {
      value: {
        entries: [
          {
            entityType: "unit",
            apiName: "TFT_TestFarmer",
            name: "采金者",
            isGrowth: false,
            isDevelopment: true,
            growthScope: "none",
            persistence: "one_time",
            trigger: "胜利后",
            summary: "胜利后获得金币。",
            confidence: 0.98
          },
          {
            entityType: "trait",
            apiName: "TFT_ShadowSoul",
            name: "暗影岛",
            isGrowth: true,
            isDevelopment: false,
            growthScope: "cross_round",
            persistence: "permanent",
            trigger: "每场战斗",
            progression: "累计灵魂",
            summary: "跨回合累计灵魂并提高战力。",
            confidence: 0.99
          }
        ]
      }
    };
  }, { model: "fixture-model", promptVersion: "fixture.v1" });
  const cache = new Map();
  const loadPromises = new Map();
  const common = {
    entityDetails,
    seasonContext: { id: "set-test" },
    provider,
    cache,
    loadPromises
  };
  const development = await answerMechanismClassificationQuery({
    ...common,
    input: "哪些棋子可发育？"
  });
  const growth = await answerMechanismClassificationQuery({
    ...common,
    input: "哪些羁绊可成长？"
  });
  const growthCached = await answerMechanismClassificationQuery({
    ...common,
    input: "哪些羁绊可成长？"
  });
  assert.equal(calls, 2);
  assert.equal(development.entries[0].name, "采金者");
  assert.equal(growth.entries[0].name, "暗影岛");
  assert.equal(growth.classificationMeta.cache, "miss");
  assert.equal(growthCached.classificationMeta.cache, "hit");
  assert.equal(growth.modelOutput.groups.trait.entries.length, 2);
});

test("small-window question route returns mechanism classification results", async () => {
  const provider = Object.assign(async ({ evidence }) => {
    assert.equal(evidence.length, 1);
    return {
      value: {
        entries: [{
          entityType: "trait",
          apiName: "TFT_ShadowSoul",
          name: "暗影岛",
          isGrowth: true,
          isDevelopment: false,
          growthScope: "cross_round",
          persistence: "permanent",
          trigger: "每场战斗",
          progression: "累计灵魂",
          summary: "跨回合累计灵魂并提高战力。",
          confidence: 0.99
        }]
      }
    };
  }, { model: "fixture-model", promptVersion: "fixture.v1" });
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    officialEntityDetails: entityDetails,
    metaTFTClient: {},
    compsClient: {},
    mechanismClassificationProvider: provider,
    mechanismClassificationConfig: { enabled: true, timeoutMs: 1000 }
  });
  const { statusCode, payload } = await handleRecommendRequest({
    input: "哪些羁绊可成长？"
  }, runtime);
  assert.equal(statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.type, "mechanism_classification");
  assert.equal(payload.entries[0].name, "暗影岛");
  assert.equal(payload.entries[0].isGrowth, true);
  assert.equal(payload.run.status, "completed");
});
