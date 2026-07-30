import assert from "node:assert/strict";
import test from "node:test";
import { buildOfficialTftEntityDetails } from "../src/data/official-entity-details.js";
import { buildOfficialTftItemDetailsCatalog } from "../src/data/official-item-details.js";
import {
  classifySampleEvidence,
  createMechanismCase,
  createSingleItemReplacementComparisons,
  validateMechanismCase
} from "../src/knowledge/mechanism-case-builder.js";
import { extractTextNumericAtoms } from "../src/knowledge/mechanic-atom-extractor.js";

const chess = {
  version: "16.14",
  season: "2026.S17",
  data: [{
    chessId: "17",
    displayName: "测试英雄",
    hero_EN_name: "TFT17_Test",
    chessRole: "物理射手",
    life: "900",
    magic: "80",
    startMagic: "20",
    attack: "60",
    attackSpeed: "0.75",
    attackRange: "4",
    armor: "30",
    spellBlock: "30",
    crit: "25",
    skillName: "测试技能",
    skillType: "主动",
    skillIntroduce: "每3次攻击造成150%攻击力的伤害。"
  }]
};

const equipment = {
  version: "16.14",
  season: "2026.S17",
  data: [
    {
      equipId: "1",
      englishName: "TFT_Item_A",
      name: "装备A",
      effect: "获得10%攻击速度。",
      formula: ""
    },
    {
      equipId: "2",
      englishName: "TFT_Item_B",
      name: "装备B",
      effect: "每次攻击获得5%攻击力。",
      formula: ""
    },
    {
      equipId: "3",
      englishName: "TFT_Item_C",
      name: "装备C",
      effect: "获得20护甲。",
      formula: ""
    },
    {
      equipId: "4",
      englishName: "TFT_Item_D",
      name: "装备D",
      effect: "获得25魔抗。",
      formula: ""
    }
  ]
};

function buildCase(items, placementCount) {
  const details = buildOfficialTftEntityDetails({
    chess,
    race: { data: [] },
    job: { data: [] }
  });
  const itemCatalog = buildOfficialTftItemDetailsCatalog(equipment);
  return createMechanismCase({
    row: {
      unit_builds: `TFT17_Test&${items.join("|")}`,
      placement_count: placementCount
    },
    unit: details.units.get("TFT17_Test"),
    itemCatalog,
    patch: "16.14",
    queryContext: {
      queue: "RANKED_TFT",
      days: 30,
      rankFilter: ["CHALLENGER", "GRANDMASTER", "MASTER"],
      starLevel: 2,
      itemCount: 3,
      providerPatch: "current"
    },
    source: {
      provider: "MetaTFT",
      endpoint: "/unit_builds/TFT17_Test",
      capturedAt: "2026-07-28T00:00:00.000Z",
      providerQuery: { patch: "current" },
      responseHash: "response-hash"
    },
    officialHashes: {
      chess: "chess-document-hash",
      equipment: "equipment-document-hash"
    }
  }).case;
}

test("numeric atoms retain units, conditions, source refs, and version hashes", () => {
  const atoms = extractTextNumericAtoms("每3次攻击造成150%攻击力的伤害。", {
    sourceRef: "official:test",
    sourceVersion: "16.14",
    sourceHash: "entity-hash"
  });
  assert.equal(atoms.length, 2);
  assert.equal(atoms[0].unit, "attacks");
  assert.match(atoms[0].condition, /每3次攻击/u);
  assert.equal(atoms[1].unit, "percentage_point");
  assert.deepEqual(atoms[1].source, {
    ref: "official:test",
    version: "16.14",
    hash: "entity-hash"
  });
});

test("numeric atoms label three-value star scaling and never use an opaque as_described condition", () => {
  const atoms = extractTextNumericAtoms("永久获得12/18/33最大生命值。获得20护甲。");
  assert.deepEqual(atoms.slice(0, 3).map((atom) => atom.condition), [
    "star_level_1",
    "star_level_2",
    "star_level_3"
  ]);
  assert.equal(atoms[3].condition, "always");
  assert.equal(atoms.some((atom) => atom.condition === "as_described"), false);
});

test("mechanism cases link official facts and exactly reproduce placement statistics", () => {
  const record = buildCase(
    ["TFT_Item_A", "TFT_Item_B", "TFT_Item_C"],
    [10, 9, 8, 7, 6, 5, 4, 3]
  );
  assert.equal(record.schemaVersion, "mechanism_case.v1");
  assert.equal(record.patch, "16.14");
  assert.equal(record.stats.games, 52);
  assert.equal(record.stats.avgPlacement, 192 / 52);
  assert.equal(record.stats.top4Rate, 34 / 52);
  assert.equal(record.stats.winRate, 10 / 52);
  assert.deepEqual(record.stats.sampleEvidence, classifySampleEvidence(52));
  assert.equal(record.unit.sourceDocumentHash, "chess-document-hash");
  assert.equal(record.items.every((item) => item.sourceDocumentHash === "equipment-document-hash"), true);
  assert.equal(record.source.providerQuery.patch, "current");
  assert.deepEqual(validateMechanismCase(record), []);
});

test("single-item replacement comparisons preserve duplicate-item multisets and remain non-causal", () => {
  const left = buildCase(
    ["TFT_Item_A", "TFT_Item_B", "TFT_Item_B"],
    [20, 18, 16, 14, 12, 10, 8, 6]
  );
  const right = buildCase(
    ["TFT_Item_A", "TFT_Item_B", "TFT_Item_D"],
    [24, 20, 18, 16, 10, 8, 6, 4]
  );
  const comparisons = createSingleItemReplacementComparisons([left, right]);
  assert.equal(comparisons.length, 1);
  assert.deepEqual(comparisons[0].sharedItems, ["TFT_Item_A", "TFT_Item_B"]);
  assert.equal(comparisons[0].from.removedItem, "TFT_Item_B");
  assert.equal(comparisons[0].to.addedItem, "TFT_Item_D");
  assert.equal(comparisons[0].evidencePolicy.causalClaimAllowed, false);
  assert.equal(comparisons[0].sampleEvidence.tier, "weak");
  assert.equal(comparisons[0].evidencePolicy.eligibleForPerformanceInference, false);
});

test("cases reject any three-item build that cannot link every item to official data", () => {
  const details = buildOfficialTftEntityDetails({
    chess,
    race: { data: [] },
    job: { data: [] }
  });
  const result = createMechanismCase({
    row: {
      unit_builds: "TFT17_Test&TFT_Item_A|TFT_Item_B|TFT_Item_Missing",
      placement_count: [1, 1, 1, 1, 1, 1, 1, 1]
    },
    unit: details.units.get("TFT17_Test"),
    itemCatalog: buildOfficialTftItemDetailsCatalog(equipment),
    patch: "16.14",
    queryContext: {},
    source: {}
  });
  assert.equal(result.case, null);
  assert.deepEqual(result.errors, ["missing_official_item:TFT_Item_Missing"]);
});
