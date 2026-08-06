import test from "node:test";
import assert from "node:assert/strict";
import {
  ENTITY_RESOLUTION_ORDER,
  linkEntityMention,
  linkTaskFrameEntities
} from "../src/understanding/entity-linker.js";
import { extractEntityMentions } from "../src/understanding/entity-mention-extractor.js";
import { createCatalog } from "../src/index.js";
import {
  createPhase3EvaluationCatalog
} from "../eval/datasets/entity-linking-phase3-cases.mjs";

const catalog = createPhase3EvaluationCatalog();

test("entity linker follows the fixed resolution order and emits canonical provenance", async () => {
  assert.deepEqual(ENTITY_RESOLUTION_ORDER, [
    "exact",
    "normalized_alias",
    "current_patch_catalog",
    "pinyin_fuzzy",
    "semantic_retrieval",
    "llm_candidate_rerank"
  ]);

  const exact = await linkEntityMention({ rawText: "霞", expectedType: "champion" }, { catalog, patch: "17.7" });
  assert.equal(exact.resolvedId, "TFT17_Xayah");
  assert.equal(exact.source, "exact");
  assert.equal(exact.version, "17.7");
  assert.equal(exact.rawText, "霞");

  const alias = await linkEntityMention({ rawText: "逆羽", expectedType: "champion" }, { catalog, patch: "17.7" });
  assert.equal(alias.resolvedId, "TFT17_Xayah");
  assert.equal(alias.source, "normalized_alias");

  const pinyin = await linkEntityMention({ rawText: "niyu", expectedType: "champion" }, { catalog, patch: "17.7" });
  assert.equal(pinyin.resolvedId, "TFT17_Xayah");
  assert.equal(pinyin.source, "pinyin_fuzzy");
});

test("game concepts resolve through a reusable versioned catalog", async () => {
  const nineFive = await linkEntityMention({ rawText: "95", expectedType: "game_concept" }, { catalog });
  const reroll = await linkEntityMention({ rawText: "赌狗", expectedType: "game_concept" }, { catalog });
  const frontline = await linkEntityMention({ rawText: "前排装", expectedType: "game_concept" }, { catalog });
  assert.equal(nineFive.resolvedId, "concept.strategy.fast9_nine_five");
  assert.equal(reroll.resolvedId, "concept.strategy.reroll");
  assert.equal(frontline.resolvedId, "concept.item.frontline");
  assert.equal(nineFive.version, "game-concepts.v1");
});

test("uncertain and nonexistent entities keep candidates without forced wrong types", async () => {
  const unresolved = await linkEntityMention({ rawText: "炼刀", expectedType: "item" }, { catalog, patch: "17.7" });
  assert.equal(unresolved.resolvedId, null);
  assert.equal(unresolved.expectedType, "item");

  const nonexistent = await linkEntityMention({
    rawText: "不存在实体月影星刃",
    expectedType: "champion"
  }, { catalog, patch: "17.7" });
  assert.equal(nonexistent.resolvedId, null);
});

test("semantic retrieval and bounded candidate reranking cannot invent entity IDs", async () => {
  let semanticCalls = 0;
  const linked = await linkEntityMention({
    rawText: "xiayi",
    expectedType: "champion"
  }, {
    catalog,
    patch: "17.7",
    candidateRetriever: () => [
      { entityType: "unit", apiName: "TFT17_Xayah", matchedAlias: "xia", confidence: 0.86 },
      { entityType: "unit", apiName: "TFT17_MasterYi", matchedAlias: "yi", confidence: 0.84 }
    ],
    semanticRetriever: {
      async search() {
        semanticCalls += 1;
        return [{ apiName: "TFT17_Xayah", score: 0.91 }];
      }
    },
    candidateReranker: ({ candidates }) => [
      { ...candidates.find((candidate) => candidate.id === "TFT17_Xayah"), confidence: 0.99 },
      { id: "invented_entity", canonicalName: "伪造实体", type: "champion", confidence: 1 }
    ]
  });

  assert.equal(semanticCalls, 1);
  assert.equal(linked.resolvedId, "TFT17_Xayah");
  assert.equal(linked.source, "llm_candidate_rerank");
  assert.equal(linked.candidates.some((candidate) => candidate.id === "invented_entity"), false);
});

test("mention extraction is independent of action parsing and linked TaskFrames preserve roles", async () => {
  const mentions = extractEntityMentions("霞的羊刀和巨九选哪个", { catalog });
  assert.equal(mentions.some((mention) => mention.rawText === "霞" && mention.expectedType === "champion"), true);
  assert.equal(mentions.some((mention) => mention.rawText === "羊刀" && mention.expectedType === "item"), true);
  assert.equal(mentions.some((mention) => mention.rawText === "巨九" && mention.expectedType === "item"), true);

  const linked = await linkTaskFrameEntities({
    subjects: [{ rawText: "霞", expectedType: "champion" }],
    candidates: [{ rawText: "羊刀", expectedType: "item" }, { rawText: "巨九", expectedType: "item" }],
    concepts: [{ rawText: "九五", expectedType: "game_concept" }]
  }, { catalog, patch: "17.7" });
  assert.equal(linked.subjects[0].resolvedId, "TFT17_Xayah");
  assert.deepEqual(linked.candidates.map((entity) => entity.resolvedId), [
    "TFT_Item_GuinsoosRageblade",
    "TFT_Item_Artifact_TitanicHydra"
  ]);
  assert.equal(linked.concepts[0].resolvedId, "concept.strategy.fast9_nine_five");
});

test("trait tier candidates sharing one base apiName collapse to the base trait", async () => {
  const tieredCatalog = createCatalog({
    units: [],
    items: [],
    traits: [
      { apiName: "TFT17_Astronaut", filterId: "TFT17_Astronaut_1", zhName: "木灵族", displayName: "3木灵族", aliases: ["木灵族"], current: true },
      { apiName: "TFT17_Astronaut", filterId: "TFT17_Astronaut_2", zhName: "木灵族", displayName: "5木灵族", aliases: ["木灵族"], current: true },
      { apiName: "TFT17_Astronaut", filterId: "TFT17_Astronaut_3", zhName: "木灵族", displayName: "7木灵族", aliases: ["木灵族"], current: true },
      { apiName: "TFT17_Astronaut", filterId: "TFT17_Astronaut_4", zhName: "木灵族", displayName: "10木灵族", aliases: ["木灵族"], current: true }
    ]
  });
  const linked = await linkEntityMention({
    rawText: "木灵族",
    expectedType: "trait"
  }, { catalog: tieredCatalog, patch: "17.7" });

  assert.equal(linked.resolvedId, "TFT17_Astronaut");
  assert.equal(linked.canonicalName, "木灵族");
  assert.equal(linked.candidates.length, 1);
  assert.equal(linked.source, "exact");
});

test("trait candidates across different base apiNames stay ambiguous", async () => {
  const mixedCatalog = createCatalog({
    units: [],
    items: [],
    traits: [
      { apiName: "TFT17_Astronaut", filterId: "TFT17_Astronaut_2", zhName: "宇航员", displayName: "5宇航员", aliases: ["木灵族"], current: true },
      { apiName: "TFT17_StarGazer", filterId: "TFT17_StarGazer_3", zhName: "观星者", displayName: "7观星者", aliases: ["木灵族"], current: true }
    ]
  });
  const linked = await linkEntityMention({
    rawText: "木灵族",
    expectedType: "trait"
  }, { catalog: mixedCatalog, patch: "17.7" });

  assert.equal(linked.resolvedId, null);
  assert.ok(linked.candidates.length >= 2);
});

test("Set 18 official and adaptive provider ids link as one champion", async () => {
  const adaptiveCatalog = createCatalog({
    units: [
      { apiName: "DA_18_MasterYi_AD", canonicalApiName: "TFT18_MasterYi", zhName: "易", aliases: ["易", "Master Yi"], current: true },
      { apiName: "TFT18_MasterYi", canonicalApiName: "TFT18_MasterYi", zhName: "易", aliases: ["易", "Master Yi"], current: true }
    ],
    items: [],
    traits: []
  });
  const linked = await linkEntityMention({
    rawText: "易",
    expectedType: "champion"
  }, { catalog: adaptiveCatalog, patch: "18.1" });

  assert.equal(linked.resolvedId, "DA_18_MasterYi_AD");
  assert.equal(linked.canonicalName, "易");
  assert.equal(linked.candidates.length, 1);
});
