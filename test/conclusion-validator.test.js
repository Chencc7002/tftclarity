import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assembleEvidencePack,
  buildConclusionEvidence,
  createConclusionValidationFeedback,
  createCatalog,
  repairConclusionCitations,
  validateConclusionOutput
} from "../src/index.js";

const resultFixture = JSON.parse(readFileSync(new URL("./fixtures/conclusion-fixture.json", import.meta.url), "utf8"));
const buildResult = (overrides = {}) => ({ ...structuredClone(resultFixture), ...overrides });

const catalog = createCatalog();
const ordinaryBuildResult = buildResult();
ordinaryBuildResult.query.lockedItems = [];
const evidence = buildConclusionEvidence({ result: ordinaryBuildResult, catalog, input: "霞怎么出装？" });
const itemEvidence = buildConclusionEvidence({
  result: {
    type: "unit_item_rankings",
    query: { intent: "unit_item_rankings", unit: "TFT17_Xayah", minSamples: 0, sort: "top4_first" },
    itemRankings: [
      { apiName: "TFT_Item_GuinsoosRageblade", stats: { games: 51, top4Rate: 0.961, winRate: 0.804, avgPlacement: 1.45 }, coverage: 0.002 },
      { apiName: "TFT_Item_InfinityEdge", stats: { games: 16, top4Rate: 0.688, winRate: 0.063, avgPlacement: 3.5 }, coverage: 0.001 },
      { apiName: "TFT_Item_GiantSlayer", stats: { games: 832, top4Rate: 0.633, winRate: 0.196, avgPlacement: 3.78 }, coverage: 0.034 },
      {
        apiName: "TFT_Item_LastWhisper",
        stats: { games: 2437, top4Rate: 0.628, winRate: 0.102, avgPlacement: 3.93 },
        coverage: 0.1,
        commonPairings: [{ items: ["TFT_Item_GiantSlayer", "TFT_Item_LastWhisper"], games: 352 }],
        copyCounts: [{ copyCount: 1, buildCount: 20, stats: { games: 2437 } }]
      },
      { apiName: "TFT_Item_Deathblade", stats: { games: 1111, top4Rate: 0.545, winRate: 0.075, avgPlacement: 4.29 }, coverage: 0.045 }
    ],
    source: { provider: "MetaTFT", cache: "live" },
    cache: { query: { hit: false } }
  },
  catalog,
  input: "霞带什么转职？"
});

function validOutput(overrides = {}) {
  return {
    schemaVersion: "llm_conclusion.v1",
    status: "ok",
    headline: "围绕羊刀补齐无尽与巨杀",
    summary: "当前统计口径下，第一套完整出装的前四率最高，可作为优先参考。",
    reasons: [{ evidenceIds: ["build:1"], text: "该组合前四率为61.2%，样本1248场，均名3.86。" }],
    alternatives: [{ evidenceIds: ["build:2"], text: "若更看重登顶率，可参考第二套组合。" }],
    nextAction: "保留已有羊刀，再从当前展示方案中补齐另外两件装备。",
    riskNotice: null,
    ...overrides
  };
}

test("validateConclusionOutput accepts evidence-linked names and exact metrics", () => {
  const result = validateConclusionOutput(validOutput(), evidence, { catalog });
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.value.reasons[0].evidenceIds[0], "build:1");
});

test("validateConclusionOutput follows item-signal build lineage without expanding public citations", () => {
  const value = validOutput({
    reasons: [{
      evidenceIds: ["item-signal:1"],
      text: "羊刀、无尽、巨杀、轻语和杀人剑都来自当前展示的两套方案。"
    }]
  });
  const result = validateConclusionOutput(value, evidence, { catalog });
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(result.value.reasons[0].evidenceIds, ["item-signal:1"]);
});

test("repairConclusionCitations adds a unique metric citation and reruns full validation", () => {
  const value = validOutput({
    alternatives: [{
      evidenceIds: ["build:2"],
      text: "方案二登顶率20.5%，高于方案一的18.3%。"
    }]
  });
  const initial = validateConclusionOutput(value, evidence, { catalog });
  assert.equal(initial.valid, false);
  const repaired = repairConclusionCitations(value, evidence, { catalog, validation: initial });
  assert.equal(repaired.changed, true);
  assert.equal(repaired.validation.valid, true, repaired.validation.errors.join("\n"));
  assert.deepEqual(repaired.value.alternatives[0].evidenceIds, ["build:1", "build:2"]);
  assert.deepEqual(value.alternatives[0].evidenceIds, ["build:2"]);
});

test("repairConclusionCitations matches percentage meaning instead of only matching the number", () => {
  const metricEvidence = structuredClone(evidence);
  metricEvidence.recommendations[1].stats.winRate = 0.612;
  const value = validOutput({
    alternatives: [{ evidenceIds: ["build:1"], text: "方案二登顶率为61.2%。" }]
  });
  const initial = validateConclusionOutput(value, metricEvidence, { catalog });
  assert.equal(initial.valid, false);
  assert.match(initial.errors.join("\n"), /unsupported percentage: 61\.2%/u);
  const repaired = repairConclusionCitations(value, metricEvidence, { catalog, validation: initial });
  assert.equal(repaired.validation.valid, true, repaired.validation.errors.join("\n"));
  assert.deepEqual(repaired.value.alternatives[0].evidenceIds, ["build:1", "build:2"]);
});

test("validateConclusionOutput maps paired percentage labels to their corresponding values", () => {
  const value = validOutput({
    reasons: [{ evidenceIds: ["build:1"], text: "该方案前四率和登顶率分别为61.2%和18.3%。" }]
  });
  const result = validateConclusionOutput(value, evidence, { catalog });
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("repairConclusionCitations collapses entity support through item-signal lineage", () => {
  const value = validOutput({
    reasons: [{ evidenceIds: ["build:2"], text: "方案一还包含无尽和巨杀。" }]
  });
  const initial = validateConclusionOutput(value, evidence, { catalog });
  assert.equal(initial.valid, false);
  const repaired = repairConclusionCitations(value, evidence, { catalog, validation: initial });
  assert.equal(repaired.validation.valid, true, repaired.validation.errors.join("\n"));
  assert.deepEqual(repaired.value.reasons[0].evidenceIds, ["build:1", "build:2"]);
});

test("repairConclusionCitations leaves ambiguous metric citations unresolved", () => {
  const ambiguousEvidence = structuredClone(evidence);
  ambiguousEvidence.recommendations[1].stats.winRate = 0.183;
  ambiguousEvidence.structuredEvidence = [...(ambiguousEvidence.structuredEvidence ?? []), {
    evidenceId: "note:1",
    type: "static_description",
    text: "仅用于提供当前查询上下文。"
  }];
  const value = validOutput({
    reasons: [{ evidenceIds: ["note:1"], text: "当前方案登顶率为18.3%。" }]
  });
  const initial = validateConclusionOutput(value, ambiguousEvidence, { catalog });
  assert.equal(initial.valid, false);
  const repaired = repairConclusionCitations(value, ambiguousEvidence, { catalog, validation: initial });
  assert.equal(repaired.changed, false);
  assert.equal(repaired.validation.valid, false);
});

test("validateConclusionOutput accepts quoted item combinations when every component is linked", () => {
  const value = validOutput({
    alternatives: [{
      evidenceIds: ["build:2"],
      text: "可选“羊刀+轻语+杀人剑”这套可见组合。"
    }]
  });
  const result = validateConclusionOutput(value, evidence, { catalog });
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("validateConclusionOutput distinguishes structural numbers from sample counts", () => {
  const value = validOutput({
    reasons: [{
      evidenceIds: ["build:1"],
      text: "第2套样本相对更少；当前组合实际有1248场，前四率61.2%。"
    }]
  });
  const result = validateConclusionOutput(value, evidence, { catalog });
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("validateConclusionOutput accepts standard display rounding, qualified sample approximation, and cited derived deltas", () => {
  const roundedEvidence = structuredClone(evidence);
  const first = roundedEvidence.recommendations.find((entry) => entry.evidenceId === "build:1");
  const second = roundedEvidence.recommendations.find((entry) => entry.evidenceId === "build:2");
  first.stats.top4Rate = 0.5125;
  first.stats.avgPlacement = 2.755;
  first.stats.games = 2232;
  second.stats.top4Rate = 0.3165;

  const value = validOutput({
    reasons: [{
      evidenceIds: ["build:1"],
      text: "该方案前四率51.3%，平均名次2.76，约2200场。"
    }],
    alternatives: [{
      evidenceIds: ["build:1", "build:2"],
      text: "按页面显示精度，两套方案前四率相差19.6个百分点。"
    }]
  });
  const result = validateConclusionOutput(value, roundedEvidence, { catalog });
  assert.equal(result.valid, true, result.errors.join("\n"));

  const unsupportedExact = structuredClone(value);
  unsupportedExact.reasons[0].text = "该方案前四率51.3%，平均名次2.76，共2200场。";
  const invalid = validateConclusionOutput(unsupportedExact, roundedEvidence, { catalog });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /unsupported sample count: 2200场/u);
});

test("validateConclusionOutput rounds integer percentages from the cited metric without admitting unrelated values", () => {
  const roundedEvidence = structuredClone(evidence);
  roundedEvidence.recommendations.find((entry) => entry.evidenceId === "build:1").stats.top4Rate = 0.667;
  const accepted = validateConclusionOutput(validOutput({
    reasons: [{ evidenceIds: ["build:1"], text: "该方案前四率67%。" }]
  }), roundedEvidence, { catalog });
  assert.equal(accepted.valid, true, accepted.errors.join("\n"));

  const rejected = validateConclusionOutput(validOutput({
    reasons: [{ evidenceIds: ["build:1"], text: "该方案前四率69%。" }]
  }), roundedEvidence, { catalog });
  assert.equal(rejected.valid, false);
  assert.match(rejected.errors.join("\n"), /unsupported percentage: 69%/u);
});

test("percentage correction feedback uses the same metric and display precision as validation", () => {
  const preciseEvidence = structuredClone(evidence);
  preciseEvidence.recommendations.find((entry) => entry.evidenceId === "build:1").stats.top4Rate = 0.0841152655;
  const invalidOutput = validOutput({
    reasons: [{ evidenceIds: ["build:1"], text: "该方案前四率为8.0%。" }]
  });
  const invalid = validateConclusionOutput(invalidOutput, preciseEvidence, { catalog });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /unsupported percentage: 8\.0%/u);
  const feedback = createConclusionValidationFeedback(invalid, preciseEvidence, { catalog });
  const issue = feedback.errors.find((entry) => entry.path === "reasons[0].text");
  assert.deepEqual(issue.allowedValues, [8.4]);
  assert.equal(issue.allowedValues.includes(8), false);

  const corrected = structuredClone(invalidOutput);
  corrected.reasons[0].text = "该方案前四率为8.4%。";
  assert.equal(validateConclusionOutput(corrected, preciseEvidence, { catalog }).valid, true);
});

test("validateConclusionOutput allows evidence-derived collection counts only in explicit count language", () => {
  const countEvidence = structuredClone(evidence);
  const seed = countEvidence.recommendations.find((entry) => entry.evidenceId === "build:1");
  for (let index = 3; index <= 5; index += 1) {
    countEvidence.recommendations.push({
      ...structuredClone(seed),
      evidenceId: `build:${index}`
    });
  }
  const valid = validOutput({
    reasons: [{
      evidenceIds: ["build:1"],
      text: "当前共5个候选方案，第一套使用现有证据作为优先参考。"
    }]
  });
  assert.equal(validateConclusionOutput(valid, countEvidence, { catalog }).valid, true);

  const invented = structuredClone(valid);
  invented.reasons[0].text = "当前共6个候选方案，第一套使用现有证据作为优先参考。";
  const rejected = validateConclusionOutput(invented, countEvidence, { catalog });
  assert.equal(rejected.valid, false);
  assert.match(rejected.errors.join("\n"), /unsupported number: 6/u);
});

test("validateConclusionOutput accepts evidence-backed dates and equivalent hour windows", () => {
  const datedEvidence = structuredClone(evidence);
  datedEvidence.dataStatus.updatedAt = "2026-07-16T08:00:00.000Z";
  datedEvidence.query.days = 3;
  const value = validOutput({
    summary: "截至2026-07-16，近72小时的当前统计口径下，第一套完整出装可作为优先参考。"
  });
  const result = validateConclusionOutput(value, datedEvidence, { catalog });
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("validateConclusionOutput does not treat generic stat aliases as unsupported entities", () => {
  const aliasCatalog = {
    ...catalog,
    traits: [...catalog.traits, {
      apiName: "TFT17_ASTrait",
      filterId: "TFT17_ASTrait_2",
      zhName: "挑战者",
      displayName: "3挑战者",
      aliases: ["挑战者", "攻速", "攻击速度"]
    }]
  };
  const generic = validateConclusionOutput(validOutput({
    nextAction: "可以按攻速这一统计词继续比较当前展示方案。"
  }), evidence, { catalog: aliasCatalog });
  assert.equal(generic.valid, true, generic.errors.join("\n"));

  const inventedEntity = validateConclusionOutput(validOutput({
    nextAction: "下一步直接选择挑战者羁绊。"
  }), evidence, { catalog: aliasCatalog });
  assert.equal(inventedEntity.valid, false);
  assert.match(inventedEntity.errors.join("\n"), /catalog entity absent from evidence: 挑战者/u);
});

test("validateConclusionOutput treats mana restoration wording as a generic mechanic instead of an item entity", () => {
  const generic = validateConclusionOutput(validOutput({
    nextAction: "可以按回蓝这一机制词继续比较当前展示方案。"
  }), evidence, { catalog });

  assert.equal(generic.valid, true, generic.errors.join("\n"));
});

test("validateConclusionOutput prefers the longest catalog entity over nested aliases", () => {
  const cappaApiName = "TFT_Item_Artifact_CappaJuice";
  const overlappingCatalog = {
    ...catalog,
    items: [
      ...catalog.items,
      {
        apiName: cappaApiName,
        preferredDisplayName: "帽子饮品",
        zhName: "帽子饮品",
        shortName: "帽子饮品",
        aliases: ["帽子饮品", "Cappa Juice"],
        category: "artifact"
      },
      {
        apiName: "TFT_Item_RabadonsDeathcap",
        zhName: "灭世者的死亡之帽",
        shortName: "帽子",
        aliases: ["帽子", "大帽"],
        category: "standard"
      }
    ]
  };
  const overlappingEvidence = structuredClone(evidence);
  const first = overlappingEvidence.recommendations.find((entry) => entry.evidenceId === "build:1");
  first.items.push({ apiName: cappaApiName, name: "帽子饮品" });

  const valid = validOutput({
    reasons: [{
      evidenceIds: ["build:1"],
      text: "帽子饮品出现在当前证据对应的候选方案中。"
    }]
  });
  const accepted = validateConclusionOutput(valid, overlappingEvidence, { catalog: overlappingCatalog });
  assert.equal(accepted.valid, true, accepted.errors.join("\n"));

  const unsupportedShortAlias = structuredClone(valid);
  unsupportedShortAlias.reasons[0].text = "帽子出现在当前证据对应的候选方案中。";
  const rejected = validateConclusionOutput(unsupportedShortAlias, overlappingEvidence, { catalog: overlappingCatalog });
  assert.equal(rejected.valid, false);
  assert.match(rejected.errors.join("\n"), /catalog entity absent from evidence: 帽子/u);
});

test("equipment conclusions allow more than three evidence ids for statistics and mechanics", () => {
  const value = validOutput({
    reasons: [{
      evidenceIds: ["build:1", "build:2", "item-signal:1", "item-signal:2"],
      text: "该组合前四率为61.2%，样本1248场，另见 build:2。"
    }]
  });
  const result = validateConclusionOutput(value, evidence, { catalog });
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(result.value.reasons[0].evidenceIds, ["build:1", "build:2", "item-signal:1", "item-signal:2"]);
});

test("repairConclusionCitations normalizes oversized evidence scopes by textual relevance", () => {
  const expandedEvidence = structuredClone(evidence);
  expandedEvidence.structuredEvidence = [
    ...(expandedEvidence.structuredEvidence ?? []),
    ...Array.from({ length: 13 }, (_, index) => ({
      evidenceId: `note:${index + 1}`,
      type: "static_description",
      text: "仅用于测试装备结论的证据容量。"
    }))
  ];
  const value = validOutput({
    reasons: [{
      evidenceIds: Array.from({ length: 13 }, (_, index) => `note:${index + 1}`),
      text: "当前结论仅限展示范围。"
    }]
  });
  const initial = validateConclusionOutput(value, expandedEvidence, { catalog });
  assert.equal(initial.valid, false);
  assert.match(initial.errors.join("\n"), /evidenceIds must contain 1 to 12 entries/u);
  const repaired = repairConclusionCitations(value, expandedEvidence, { catalog, validation: initial });
  assert.equal(repaired.changed, true);
  assert.equal(repaired.validation.valid, true, repaired.validation.errors.join("\n"));
  assert.equal(repaired.value.reasons[0].evidenceIds.length, 12);
});

test("validateConclusionOutput reports allowed numbers from the linked evidence scope", () => {
  const value = validOutput({
    reasons: [{ evidenceIds: ["build:1"], text: "该组合前四率为99.9%。" }]
  });
  const result = validateConclusionOutput(value, evidence, { catalog });
  assert.equal(result.valid, false);
  const issue = result.issues.find((entry) => entry.path === "reasons[0].text");
  assert.deepEqual(issue.linkedEvidenceIds, ["build:1"]);
  assert.equal(issue.allowedValues.includes(61.2), true);
  assert.equal(issue.allowedValues.includes(1248), false);
  assert.equal(issue.allowedValues.includes(846), false);
});

test("validateConclusionOutput accepts repeated-item counts derived from a linked build", () => {
  const repeatedEvidence = structuredClone(evidence);
  const build = repeatedEvidence.recommendations.find((entry) => entry.evidenceId === "build:1");
  build.items = [
    { apiName: "TFT_Item_GuinsoosRageblade", name: "羊刀" },
    { apiName: "TFT_Item_GuinsoosRageblade", name: "羊刀" },
    { apiName: "TFT_Item_GuinsoosRageblade", name: "羊刀" },
    { apiName: "TFT_Item_GuinsoosRageblade", name: "羊刀" }
  ];
  const value = validOutput({
    reasons: [{
      evidenceIds: ["build:1"],
      text: "该组合包含4件羊刀，前四率61.2%，样本1248场。"
    }]
  });
  const result = validateConclusionOutput(value, repeatedEvidence, { catalog });
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("validateConclusionOutput accepts linked visible semantic facts and rejects invented static numbers", () => {
  const semanticEvidence = assembleEvidencePack({
    result: buildResult(),
    catalog,
    input: "霞已有羊刀怎么补？",
    semanticEvidence: [{
      id: "item-description:rageblade",
      documentType: "item_description",
      text: "羊刀每秒获得7%可叠加的攻击速度。",
      source: "official_catalog",
      patch: "current",
      visible: true,
      metadata: {
        apiName: "TFT_Item_GuinsoosRageblade",
        canonicalName: "鬼索的狂暴之刃",
        aliases: ["羊刀"]
      }
    }]
  });
  const linked = validOutput({
    reasons: [{
      evidenceIds: ["item-description:rageblade"],
      text: "官方静态说明显示，羊刀每秒获得7%可叠加的攻击速度。"
    }]
  });
  const valid = validateConclusionOutput(linked, semanticEvidence, { catalog });
  assert.equal(valid.valid, true, valid.errors.join("\n"));

  const invented = structuredClone(linked);
  invented.reasons[0].text = "官方静态说明显示，羊刀每秒获得8%可叠加的攻击速度。";
  const invalid = validateConclusionOutput(invented, semanticEvidence, { catalog });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /unsupported percentage/u);
});

test("validateConclusionOutput accepts only evidence-linked core-item claims", () => {
  const valid = validOutput({
    summary: "羊刀在当前前列方案中重复出现，可视为核心装备趋势（item-signal:1; build:1）；首套完整方案还包含无尽与巨杀，且stable为真。",
    reasons: [{ evidenceIds: ["item-signal:1"], text: "羊刀在两套推荐中都出现，出现率100.0%，是当前统计口径下的核心装备趋势（core=true）。" }]
  });
  const validResult = validateConclusionOutput(valid, evidence, { catalog });
  assert.equal(validResult.valid, true, validResult.errors.join("\n"));
  assert.doesNotMatch(validResult.value.reasons[0].text, /core=/u);
  assert.doesNotMatch(validResult.value.summary, /(?:build|item-signal):/u);
  assert.doesNotMatch(validResult.value.summary, /stable/u);
  assert.match(validResult.value.summary, /被标记为稳定/u);

  const wrongLink = validOutput({
    reasons: [{ evidenceIds: ["build:1"], text: "羊刀是当前统计口径下的核心装备。" }]
  });
  assert.equal(validateConclusionOutput(wrongLink, evidence, { catalog }).valid, true);

  const coreThenCandidates = validOutput({
    reasons: [{
      evidenceIds: ["item-signal:1"],
      text: "核心装备为羊刀，候选装备包括无尽、巨杀、轻语和杀人剑。"
    }]
  });
  const coreThenCandidatesResult = validateConclusionOutput(coreThenCandidates, evidence, { catalog });
  assert.equal(coreThenCandidatesResult.valid, true, coreThenCandidatesResult.errors.join("\n"));

  const promotedNonCore = validOutput({ summary: "无尽是当前前列方案的核心装备。" });
  assert.equal(validateConclusionOutput(promotedNonCore, evidence, { catalog }).valid, false);

  const absolute = validOutput({ nextAction: "羊刀是必备装备，优先合成。" });
  assert.equal(validateConclusionOutput(absolute, evidence, { catalog }).valid, false);

  const qualified = validOutput({ nextAction: "羊刀不是必备装备，仍需从当前展示方案中选择。" });
  assert.equal(validateConclusionOutput(qualified, evidence, { catalog }).valid, true);
});

test("completion validation excludes locked items and requires the server key differentiator for priority claims", () => {
  const completionResult = buildResult({
    type: "unit_build_completion",
    query: {
      ...buildResult().query,
      intent: "unit_build_completion",
      lockedItems: ["dawn"],
      minSamples: 10,
      primaryMetric: "avgPlacement"
    },
    rankedBuilds: [
      { items: ["dawn", "rageblade", "infinity-edge"], stats: { games: 500, avgPlacement: 2.97, top4Rate: 0.6, winRate: 0.2 } },
      { items: ["dawn", "deathblade", "rageblade"], stats: { games: 500, avgPlacement: 2.13, top4Rate: 0.7, winRate: 0.3 } },
      { items: ["dawn", "deathblade", "infinity-edge"], stats: { games: 500, avgPlacement: 3.58, top4Rate: 0.5, winRate: 0.1 } }
    ]
  });
  const completionEvidence = buildConclusionEvidence({ result: completionResult, catalog });
  const priority = validOutput({
    headline: "已携带dawn时，推荐当前第一套展示方案。",
    reasons: [{
      evidenceIds: [completionEvidence.itemDifferentiation.keyDifferentiatorEvidenceId],
      text: "优先保证rageblade，它是当前可比展示方案中区分度最高的未锁定装备。"
    }],
    alternatives: [{
      evidenceIds: ["build:1", "build:2", "build:3"],
      text: "deathblade与infinity-edge构成当前可见候选差异。"
    }],
    nextAction: "dawn仅作为已携带条件保留。",
    riskNotice: "当前对比只描述关联，不证明装备单独造成名次变化。"
  });
  const priorityValidation = validateConclusionOutput(priority, completionEvidence, { catalog });
  assert.equal(priorityValidation.valid, true, priorityValidation.errors.join("\n"));

  const lockedAsCore = structuredClone(priority);
  lockedAsCore.summary = "核心装备：dawn。";
  assert.equal(validateConclusionOutput(lockedAsCore, completionEvidence, { catalog }).valid, false);

  const noSignal = structuredClone(completionEvidence);
  noSignal.itemDifferentiation.itemSignals.forEach((signal) => { signal.keyDifferentiator = false; });
  assert.equal(validateConclusionOutput(priority, noSignal, { catalog }).valid, false);

  const noSignalFallback = validOutput({
    headline: "已携带dawn时，推荐当前第一套展示方案。",
    summary: "补装倾向不明确，按当前完整方案排名选择。",
    reasons: [{
      evidenceIds: ["build:1", "build:2", "build:3"],
      text: "补装倾向不明确，未锁定装备之间没有稳定的唯一优先项。"
    }],
    alternatives: [{
      evidenceIds: ["build:1", "build:2", "build:3"],
      text: "可直接比较当前展示的完整补装方案。"
    }],
    nextAction: "dawn仅作为已携带条件保留。",
    riskNotice: "结论仅限当前展示方案。"
  });
  assert.equal(validateConclusionOutput(noSignalFallback, noSignal, { catalog }).valid, true);

  const forcedWithoutSignal = structuredClone(noSignalFallback);
  forcedWithoutSignal.nextAction = "补装倾向不明确，但建议优先选择rageblade。";
  assert.equal(validateConclusionOutput(forcedWithoutSignal, noSignal, { catalog }).valid, false);

  const causal = structuredClone(priority);
  causal.reasons[0].text = "rageblade导致平均名次提升，是当前优先保证装备。";
  assert.equal(validateConclusionOutput(causal, completionEvidence, { catalog }).valid, false);
});

test("equipment mechanism and role explanations require matching official evidence and reject excluded scope", () => {
  const result = buildResult();
  result.query.lockedItems = [];
  const mechanicsEvidence = buildConclusionEvidence({
    result,
    catalog,
    officialItemDetails: new Map([
      ["TFT_Item_GuinsoosRageblade", { effect: "攻击会提供攻击速度。" }],
      ["TFT_Item_InfinityEdge", { effect: "提供暴击相关效果。" }],
      ["TFT_Item_GiantSlayer", { effect: "对高生命值目标提供额外伤害。" }]
    ]),
    officialEntityDetails: {
      units: new Map([["TFT17_Xayah", { role: "远程物理输出" }]]),
      meta: { version: "17.7" }
    }
  });
  const ragebladeName = mechanicsEvidence.itemMechanics[0].item.name;
  const supported = validOutput({
    reasons: [{
      evidenceIds: ["item-mechanic:1", "unit-mechanic:1"],
      text: `${ragebladeName}提供攻击速度；霞的官方定位为远程物理输出，这只用于解释当前统计结果。`
    }]
  });
  assert.equal(validateConclusionOutput(supported, mechanicsEvidence, { catalog }).valid, true);

  const matchupDescription = validOutput({
    reasons: [{
      evidenceIds: ["item-mechanic:1"],
      text: `${ragebladeName}提供攻击速度，可用于对抗坦克。`
    }]
  });
  assert.equal(validateConclusionOutput(matchupDescription, mechanicsEvidence, { catalog }).valid, true);

  const missingRoleEvidence = structuredClone(mechanicsEvidence);
  missingRoleEvidence.unitMechanics = [];
  const unsupportedUnitRole = validOutput({
    reasons: [{ evidenceIds: ["build:1"], text: "霞的官方定位是远程物理输出。" }]
  });
  const unsupportedUnitRoleValidation = validateConclusionOutput(unsupportedUnitRole, missingRoleEvidence, { catalog });
  assert.equal(unsupportedUnitRoleValidation.valid, false);
  assert.match(unsupportedUnitRoleValidation.errors.join("\n"), /role claim without linked official unit mechanics/u);

  const percentageMechanicsClaim = validOutput({
    reasons: [{
      evidenceIds: ["build:1"],
      text: `${ragebladeName}提供+35%攻击力、+35%暴击几率及技能暴击，提升爆发。`
    }]
  });
  const percentageMechanicsEvidence = structuredClone(mechanicsEvidence);
  percentageMechanicsEvidence.itemMechanics = [];
  const percentageMechanicsValidation = validateConclusionOutput(percentageMechanicsClaim, percentageMechanicsEvidence, { catalog });
  assert.equal(percentageMechanicsValidation.valid, false);
  assert.match(percentageMechanicsValidation.errors.join("\n"), /item-mechanism claim without linked official item mechanics/u);

  const effectCoverageEvidence = structuredClone(mechanicsEvidence);
  effectCoverageEvidence.questionContract = {
    schemaVersion: "question-contract.v1",
    contractId: "e".repeat(64),
    questionType: "default",
    requiredAnswerDimensions: ["build_performance", "core_item_tendency"],
    requiredEvidence: {
      build_performance: ["visible_builds"],
      core_item_tendency: ["visible_builds"]
    }
  };
  const missingRequiredEffects = {
    schemaVersion: "llm_conclusion.v2",
    contractId: effectCoverageEvidence.questionContract.contractId,
    status: "ok",
    addressedDimensions: ["build_performance", "core_item_tendency"],
    missingDimensions: [],
    missingEvidence: [],
    headline: "推荐当前第一套完整三件套。",
    summary: "当前结论基于前三套展示方案。",
    reasons: [
      { dimension: "core_item_tendency", evidenceIds: ["item-signal:1"], text: "羊刀属于当前核心装备。" },
      { dimension: "build_performance", evidenceIds: ["build:1"], text: "第一套方案可优先参考。" }
    ],
    alternatives: [],
    nextAction: "按当前展示方案选择。",
    riskNotice: null
  };
  const missingRequiredEffectsValidation = validateConclusionOutput(
    missingRequiredEffects,
    effectCoverageEvidence,
    { catalog }
  );
  assert.equal(missingRequiredEffectsValidation.valid, false);
  assert.match(missingRequiredEffectsValidation.errors.join("\n"), /must discuss the official item effect for core item/u);
  assert.match(missingRequiredEffectsValidation.errors.join("\n"), /must discuss the official item effect for candidate item/u);

  const repairedRequiredEffects = repairConclusionCitations(
    missingRequiredEffects,
    effectCoverageEvidence,
    { catalog, validation: missingRequiredEffectsValidation }
  );
  assert.equal(repairedRequiredEffects.changed, true);
  assert.equal(
    repairedRequiredEffects.repairs.some((repair) => repair.kind === "required_item_effect"),
    true
  );
  assert.equal(
    repairedRequiredEffects.validation.valid,
    true,
    repairedRequiredEffects.validation.errors.join("\n")
  );

  const evidenceLinkedEffects = structuredClone(missingRequiredEffects);
  evidenceLinkedEffects.reasons = [
    {
      dimension: "core_item_tendency",
      evidenceIds: ["item-signal:1", "item-mechanic:1"],
      text: `${ragebladeName}属于当前核心装备，并提供攻击速度。`
    },
    {
      dimension: "build_performance",
      evidenceIds: ["build:1", "item-mechanic:2", "item-mechanic:3"],
      text: "候补无尽提供暴击相关效果；巨杀对高生命值目标提供额外伤害。"
    }
  ];
  const evidenceLinkedEffectsValidation = validateConclusionOutput(
    evidenceLinkedEffects,
    effectCoverageEvidence,
    { catalog }
  );
  assert.equal(evidenceLinkedEffectsValidation.valid, true, evidenceLinkedEffectsValidation.errors.join("\n"));

  const citationWithoutEffectText = structuredClone(evidenceLinkedEffects);
  citationWithoutEffectText.reasons[1].text = "无尽是当前候补装备；巨杀对高生命值目标提供额外伤害。";
  const citationWithoutEffectTextValidation = validateConclusionOutput(
    citationWithoutEffectText,
    effectCoverageEvidence,
    { catalog }
  );
  assert.equal(citationWithoutEffectTextValidation.valid, false);
  assert.match(citationWithoutEffectTextValidation.errors.join("\n"), /must discuss the official item effect for candidate item/u);

  mechanicsEvidence.structuredEvidence = [
    ...(mechanicsEvidence.structuredEvidence ?? []),
    ...Array.from({ length: 12 }, (_, index) => ({
      evidenceId: `mechanics-note:${index + 1}`,
      type: "static_description",
      text: "仅用于测试已占满的证据范围。"
    }))
  ];
  const repairableMechanicsCitation = validOutput({
    reasons: [{
      evidenceIds: Array.from({ length: 12 }, (_, index) => `mechanics-note:${index + 1}`),
      text: `${ragebladeName}提供攻击速度。`
    }]
  });
  const repairableInitial = validateConclusionOutput(repairableMechanicsCitation, mechanicsEvidence, { catalog });
  assert.equal(repairableInitial.valid, false);
  assert.match(repairableInitial.errors.join("\n"), /item-mechanism claim without linked official item mechanics/u);
  const repairedMechanicsCitation = repairConclusionCitations(
    repairableMechanicsCitation,
    mechanicsEvidence,
    { catalog, validation: repairableInitial }
  );
  assert.equal(repairedMechanicsCitation.changed, true);
  assert.equal(repairedMechanicsCitation.validation.valid, true, repairedMechanicsCitation.validation.errors.join("\n"));
  assert.equal(repairedMechanicsCitation.value.reasons[0].evidenceIds.includes("item-mechanic:1"), true);

  const missingItemEvidence = structuredClone(mechanicsEvidence);
  missingItemEvidence.itemMechanics = [];
  const missingItemCitation = structuredClone(supported);
  missingItemCitation.reasons[0].evidenceIds = ["build:1", "unit-mechanic:1"];
  assert.equal(validateConclusionOutput(missingItemCitation, missingItemEvidence, { catalog }).valid, false);

  const traitReasoning = validOutput({ nextAction: "根据羁绊档位决定羊刀是否更好。" });
  assert.equal(validateConclusionOutput(traitReasoning, mechanicsEvidence, { catalog }).valid, false);
  const componentPlanning = validOutput({ nextAction: "大剑紧缺时把散件留给其他英雄。" });
  assert.equal(validateConclusionOutput(componentPlanning, mechanicsEvidence, { catalog }).valid, false);
});

test("equipment conclusion has no fixed character limit", () => {
  const longButSupported = validOutput({
    headline: "推荐当前第一套完整三件套方案。",
    reasons: [{
      dimension: "build_performance",
      evidenceIds: ["build:1"],
      text: `当前第一套完整方案可作为优先参考。${"这段补充说明不引入新的装备、数值或因果判断。".repeat(12)}`
    }],
    alternatives: [{ dimension: "core_item_tendency", evidenceIds: ["build:2"], text: "其他可见方案仅作为当前筛选范围内的备选参考。" }],
    riskNotice: "结论仅限当前前三套展示方案与筛选条件。"
  });
  const validation = validateConclusionOutput(longButSupported, evidence, { catalog });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
});

test("validateConclusionOutput accepts evidence-backed emblem shorthand", () => {
  const emblemApiName = "TFT17_Item_ChallengerEmblemItem";
  const emblemCatalog = createCatalog({
    items: [{
      apiName: emblemApiName,
      zhName: "挑战者纹章",
      shortName: "挑战者转",
      aliases: ["挑战者纹章", "挑战者转", "挑战者转职"],
      category: "emblem"
    }]
  });
  const emblemEvidence = buildConclusionEvidence({
    result: {
      type: "unit_item_rankings",
      query: { intent: "unit_item_rankings", unit: "TFT17_Xayah", minSamples: 0, sort: "top4_first" },
      itemRankings: [{
        apiName: emblemApiName,
        stats: { games: 830, top4Rate: 0.633, winRate: 0.195, avgPlacement: 3.79 },
        coverage: 0.034
      }],
      source: { provider: "MetaTFT", cache: "live" },
      cache: { query: { hit: false } }
    },
    catalog: emblemCatalog,
    input: "霞有什么强的转职？"
  });
  const value = {
    schemaVersion: "llm_conclusion.v1",
    status: "ok",
    headline: "挑战者是当前样本中的核心转职选择",
    summary: "挑战者有830场样本，前四率63.3%，平均名次3.79，可作为当前统计口径下的常规参考。",
    reasons: [{ evidenceIds: ["item:1"], text: "挑战者有830场样本，前四率63.3%，平均名次3.79。" }],
    alternatives: [],
    nextAction: "需要转职时可优先参考挑战者。",
    riskNotice: null
  };
  const validation = validateConclusionOutput(value, emblemEvidence, { catalog: emblemCatalog });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
});

test("validateConclusionOutput accepts reliability analysis across every displayed item ranking", () => {
  const value = validOutput({
    headline: "高样本下巨杀与轻语更适合常规参考",
    summary: "羊刀虽在原始指标中领先，但只有51场，属于低样本亮点。巨杀有832场、平均名次3.78，轻语有2437场、平均名次3.93，更适合作为高样本常规参考；杀人剑虽有1111场，但平均名次4.29，相对不是优先选择。",
    reasons: [
      { evidenceIds: ["item:3", "item:4"], text: "巨杀与轻语前四率接近63%，样本分别为832场和2437场、平均名次3.78和3.93，两者标记为 stable。" },
      { evidenceIds: ["item:4"], text: "轻语覆盖率10.0%，与巨杀的常见搭配有352场。" }
    ],
    alternatives: [{ evidenceIds: ["item:5"], text: "杀人剑样本1111场，但前四率54.5%、平均名次4.29，表现弱于前述两个稳定候选。" }],
    nextAction: "一般对局优先在巨杀和轻语之间选择（分别引用 item:3 与 item:4），并把羊刀视为低样本观察项。",
    riskNotice: "羊刀与无尽属于低样本结果，仅代表当前样本趋势。"
  });
  const result = validateConclusionOutput(value, itemEvidence, { catalog });
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.doesNotMatch(result.value.reasons[0].text, /\bstable\b/u);
  assert.match(result.value.reasons[0].text, /标记为稳定/u);
  assert.doesNotMatch(result.value.nextAction, /item:/u);
});

test("validateConclusionOutput links every named candidate in a cross-ranking comparison", () => {
  const names = itemEvidence.recommendations.map((entry) => entry.item.name);
  const value = {
    schemaVersion: "llm_conclusion.v1",
    status: "ok",
    headline: "稳定样本候选更适合作为常规参考",
    summary: `${names[0]}和${names[1]}属于低样本观察；${names[2]}与${names[3]}的稳定样本表现更好，${names[4]}虽有样本基础但指标相对较弱。`,
    reasons: [
      {
        evidenceIds: ["item:1", "item:2"],
        text: `${names[0]}只有51局，${names[1]}只有16局，均属于低样本观察。`
      },
      {
        evidenceIds: ["item:3", "item:5"],
        text: `${names[2]} games=832、top4Rate=63.3%、avgPlacement=3.78，${names[3]} games=2437、top4Rate=62.8%，均好于${names[4]}的54.5%（分别来自 item:3、item:4、item:5）。`
      }
    ],
    alternatives: [],
    nextAction: `常规对局优先参考${names[2]}或${names[3]}。`,
    riskNotice: "低样本候选仅代表当前样本趋势。"
  };
  const result = validateConclusionOutput(value, itemEvidence, { catalog });
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(result.value.reasons[1].evidenceIds, ["item:3", "item:5", "item:4"]);
  assert.doesNotMatch(result.value.reasons[1].text, /item:/u);
  assert.doesNotMatch(result.value.reasons[1].text, /games=|top4Rate=|avgPlacement=|来自\s*[、与]?/u);
  assert.match(result.value.reasons[1].text, /832场|前四率63\.3%|平均名次3\.78/u);
});

test("validateConclusionOutput requires the ranking leader and highest-sample representative without forcing every candidate", () => {
  const names = itemEvidence.recommendations.map((entry) => entry.item.name);
  const value = {
    schemaVersion: "llm_conclusion.v1",
    status: "ok",
    headline: "高样本候选更适合作为常规参考",
    summary: `${names[0]}属于低样本亮点，${names[2]}、${names[3]}与${names[4]}提供了更高样本的参考。`,
    reasons: [{ evidenceIds: ["item:3", "item:4"], text: `${names[2]}样本832局，${names[3]}样本2437局。` }],
    alternatives: [{ evidenceIds: ["item:5"], text: `${names[4]}样本1111局。` }],
    nextAction: "优先参考稳定候选。",
    riskNotice: `${names[0]}是低样本结果。`
  };
  const result = validateConclusionOutput(value, itemEvidence, { catalog });
  assert.equal(result.valid, true, result.errors.join("\n"));

  const missingRepresentative = structuredClone(value);
  missingRepresentative.summary = `${names[0]}属于低样本亮点，${names[2]}与${names[4]}提供了更高样本的参考。`;
  missingRepresentative.reasons = [{ evidenceIds: ["item:3"], text: `${names[2]}样本832局。` }];
  missingRepresentative.nextAction = `优先参考${names[2]}。`;
  const invalid = validateConclusionOutput(missingRepresentative, itemEvidence, { catalog });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /omits representative evidence: item:4/u);
});

test("validateConclusionOutput requires comp conclusions to cover displayed evidence", () => {
  const compEvidence = buildConclusionEvidence({
    result: {
      type: "comp_rankings",
      query: { intent: "comp_rankings", metrics: ["top4_rate", "win_rate"], minSamples: 500, limit: 3 },
      rankings: {
        top4Rate: [{ compId: "comp-a", name: "阵容甲", stats: { games: 2400, top4Rate: 0.64, winRate: 0.17, avgPlacement: 3.82 }, units: [], traits: [] }],
        winRate: [{ compId: "comp-b", name: "阵容乙", stats: { games: 1800, top4Rate: 0.6, winRate: 0.24, avgPlacement: 3.94 }, units: [], traits: [] }]
      },
      references: [],
      source: {},
      warnings: [],
      cache: { query: { hit: false } }
    },
    catalog,
    input: "当前版本阵容推荐"
  });
  const output = {
    schemaVersion: "llm_conclusion.v1",
    status: "ok",
    headline: "按目标指标分别选择阵容甲与阵容乙",
    summary: "阵容甲在前四率榜靠前，阵容乙在登顶率榜靠前，适合按目标取舍。",
    reasons: [
      { evidenceIds: ["comp:1"], text: "阵容甲有2400局，前四率64.0%，平均名次3.82。" },
      { evidenceIds: ["comp:2"], text: "阵容乙有1800局，登顶率24.0%，平均名次3.94。" }
    ],
    alternatives: [],
    nextAction: "保分优先看阵容甲，追求登顶率可看阵容乙。",
    riskNotice: null
  };
  assert.equal(validateConclusionOutput(output, compEvidence, { catalog }).valid, true);
  const omitted = structuredClone(output);
  omitted.summary = "阵容甲在前四率榜靠前。";
  omitted.reasons = [omitted.reasons[0]];
  omitted.nextAction = "优先看阵容甲。";
  const invalid = validateConclusionOutput(omitted, compEvidence, { catalog });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /comp-ranking conclusion omits displayed evidence: comp:2/u);
});

test("validateConclusionOutput rejects unknown evidence, fabricated metrics, entities, and causal claims", () => {
  const cases = [
    validOutput({ reasons: [{ evidenceIds: ["build:99"], text: "样本1248场。" }] }),
    validOutput({ reasons: [{ evidenceIds: ["build:1"], text: "该组合前四率为99.9%。" }] }),
    validOutput({ headline: "改用“神秘刀”" }),
    validOutput({ summary: "这套装备导致胜率提升。" }),
    validOutput({ summary: "当前证据支持综合强度分999。" })
  ];
  for (const value of cases) {
    const result = validateConclusionOutput(value, evidence, { catalog });
    assert.equal(result.valid, false, JSON.stringify(value));
  }
});

test("validateConclusionOutput enforces low-sample and unresolved-comparison risk boundaries", () => {
  const lowEvidence = structuredClone(evidence);
  lowEvidence.recommendations[0].lowSample = true;
  lowEvidence.generationRules.mustMentionLowSample = true;
  assert.equal(validateConclusionOutput(validOutput(), lowEvidence, { catalog }).valid, false);
  assert.equal(validateConclusionOutput(validOutput({ riskNotice: "当前属于低样本结果，仅供参考。" }), lowEvidence, { catalog }).valid, true);
  assert.equal(validateConclusionOutput(validOutput({ riskNotice: "当前属于低样本结果。" }), evidence, { catalog }).valid, false);
  assert.equal(validateConclusionOutput(validOutput({ riskNotice: "当前并非低样本结果。" }), evidence, { catalog }).valid, true);
  assert.equal(validateConclusionOutput(validOutput({ summary: "当前结果已做低样本校正，可结合样本覆盖参考。" }), evidence, { catalog }).valid, true);

  const staleEvidence = structuredClone(evidence);
  staleEvidence.generationRules.mustMentionStaleData = true;
  assert.equal(validateConclusionOutput(validOutput(), staleEvidence, { catalog }).valid, false);
  assert.equal(validateConclusionOutput(validOutput({ riskNotice: "数据可能不是最新，请注意时效。" }), staleEvidence, { catalog }).valid, true);

  const noWinner = structuredClone(evidence);
  noWinner.generationRules.mustAvoidWinnerClaim = true;
  assert.equal(validateConclusionOutput(validOutput({ summary: "羊刀胜出，是当前更优选择。" }), noWinner, { catalog }).valid, false);
});
