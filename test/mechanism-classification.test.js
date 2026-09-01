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
  assert.equal(entries[1].originalDescription, entityDetails.traits.get("TFT_ShadowSoul").description);
  assert.deepEqual(entries[1].originalLevels, entityDetails.traits.get("TFT_ShadowSoul").levels);
});

test("classification scans each entity type once and reuses its season cache", async () => {
  let calls = 0;
  const provider = Object.assign(async ({ evidence }) => {
    calls += 1;
    return {
      value: {
        entries: evidence.map((entity) => {
          if (entity.apiName === "TFT_TestFarmer") return {
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
          };
          if (entity.apiName === "TFT_ShadowSoul") return {
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
          };
          return {
            entityType: entity.entityType,
            apiName: entity.apiName,
            name: entity.name,
            isGrowth: false,
            isDevelopment: false,
            growthScope: "in_combat",
            persistence: "resets_after_combat",
            summary: "仅在当前战斗生效。",
            confidence: 0.95
          };
        })
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
  assert.equal(growth.modelOutput.groups.trait.entries.length, 1);
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

test("classification batches a full trait catalog and still returns a late growth trait", async () => {
  const rivalApiName = "DA_18_Rival";
  const traits = new Map(Array.from({ length: 25 }, (_, index) => {
    const apiName = index === 22 ? rivalApiName : `DA_18_Trait_${index}`;
    return [apiName, {
      apiName,
      name: index === 22 ? "\u5bbf\u654c" : `Trait ${index}`,
      description: index === 22
        ? "Kha'Zix permanently evolves after takedowns."
        : "Combat stats only.",
      levels: []
    }];
  }));
  let calls = 0;
  const provider = Object.assign(async ({ evidence }) => {
    calls += 1;
    assert.ok(evidence.length <= 12);
    return {
      value: {
        entries: evidence.map((entity) => ({
          entityType: "trait",
          apiName: entity.apiName,
          name: entity.name,
          isGrowth: entity.apiName === rivalApiName,
          isDevelopment: entity.apiName === rivalApiName,
          growthScope: entity.apiName === rivalApiName ? "cross_round" : "none",
          persistence: entity.apiName === rivalApiName ? "permanent" : "none",
          summary: entity.apiName === rivalApiName ? "Permanent evolution and repeated gold income." : "Combat only.",
          confidence: 0.95
        }))
      }
    };
  }, { model: "fixture-model", promptVersion: "fixture.v3" });

  const result = await answerMechanismClassificationQuery({
    input: "\u54ea\u4e9b\u7f81\u7eca\u53ef\u6210\u957f\uff1f",
    entityDetails: { units: new Map(), traits, meta: { provider: "fixture" } },
    seasonContext: { id: "set18-live" },
    provider
  });

  assert.equal(calls, 3);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].apiName, rivalApiName);
  assert.equal(result.classificationMeta.batchCount, 3);
  assert.equal(result.classificationMeta.complete, true);
  assert.equal(result.modelOutput.groups.trait.entries.length, 25);
});

test("classification retries only omitted entities instead of silently dropping them", async () => {
  const traitDetails = new Map([
    ["DA_18_Coven", {
      apiName: "DA_18_Coven",
      name: "\u9b54\u5973",
      description: "Collect Coven Essence from takedowns and losses, then exchange it for rewards.",
      levels: []
    }],
    ["DA_18_Rival", {
      apiName: "DA_18_Rival",
      name: "\u5bbf\u654c",
      description: "Permanently evolves and grants gold after repeated takedowns.",
      levels: []
    }]
  ]);
  const calls = [];
  const provider = Object.assign(async ({ evidence, completenessAttempt }) => {
    calls.push({ apiNames: evidence.map((entity) => entity.apiName), completenessAttempt });
    const returned = completenessAttempt === 1 ? evidence.slice(0, 1) : evidence;
    return {
      value: {
        entries: returned.map((entity) => ({
          entityType: "trait",
          apiName: entity.apiName,
          name: entity.name,
          isGrowth: entity.apiName === "DA_18_Rival",
          isDevelopment: true,
          growthScope: entity.apiName === "DA_18_Rival" ? "cross_round" : "none",
          persistence: entity.apiName === "DA_18_Rival" ? "permanent" : "permanent",
          summary: "Resource or permanent progression.",
          confidence: 0.9
        }))
      }
    };
  }, { model: "fixture-model", promptVersion: "fixture.v3" });

  const result = await answerMechanismClassificationQuery({
    input: "\u54ea\u4e9b\u7f81\u7eca\u53ef\u53d1\u80b2\uff1f",
    entityDetails: { units: new Map(), traits: traitDetails, meta: { provider: "fixture" } },
    seasonContext: { id: "set18-live" },
    provider
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].apiNames, ["DA_18_Coven", "DA_18_Rival"]);
  assert.deepEqual(calls[1].apiNames, ["DA_18_Rival"]);
  assert.equal(result.entries.length, 2);
  assert.equal(result.classificationMeta.completenessRetryCount, 1);
  assert.equal(result.classificationMeta.complete, true);
  assert.equal(result.modelOutput.groups.trait.entries.length, 2);
});

test("an incomplete model response is disclosed and never made sticky in cache", async () => {
  let calls = 0;
  const provider = Object.assign(async () => {
    calls += 1;
    return { value: { entries: [] } };
  }, { model: "fixture-model", promptVersion: "fixture.v3" });
  const cache = new Map();
  const common = {
    input: "\u54ea\u4e9b\u7f81\u7eca\u53ef\u53d1\u80b2\uff1f",
    entityDetails: {
      units: new Map(),
      traits: new Map([["DA_18_Coven", {
        apiName: "DA_18_Coven",
        name: "\u9b54\u5973",
        description: "Collect Essence and exchange it for rewards.",
        levels: []
      }]])
    },
    seasonContext: { id: "set18-live" },
    provider,
    cache,
    loadPromises: new Map()
  };

  const first = await answerMechanismClassificationQuery(common);
  const second = await answerMechanismClassificationQuery(common);

  assert.equal(calls, 6);
  assert.equal(first.classificationMeta.complete, false);
  assert.equal(first.classificationMeta.incompleteEntities[0].name, "\u9b54\u5973");
  assert.equal(second.classificationMeta.cache, "miss");
  assert.equal(cache.size, 0);
});
