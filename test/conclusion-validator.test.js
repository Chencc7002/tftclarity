import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assembleEvidencePack, buildConclusionEvidence, createCatalog, validateConclusionOutput } from "../src/index.js";

const resultFixture = JSON.parse(readFileSync(new URL("./fixtures/conclusion-fixture.json", import.meta.url), "utf8"));
const buildResult = (overrides = {}) => ({ ...structuredClone(resultFixture), ...overrides });

const catalog = createCatalog();
const evidence = buildConclusionEvidence({ result: buildResult(), catalog, input: "霞已有羊刀怎么补？" });
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
    nextAction: "保留已有羊刀，再根据散件补齐另外两件装备。",
    riskNotice: null,
    ...overrides
  };
}

test("validateConclusionOutput accepts evidence-linked names and exact metrics", () => {
  const result = validateConclusionOutput(validOutput(), evidence, { catalog });
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.value.reasons[0].evidenceIds[0], "build:1");
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
  assert.equal(validResult.valid, true);
  assert.doesNotMatch(validResult.value.reasons[0].text, /core=/u);
  assert.doesNotMatch(validResult.value.summary, /(?:build|item-signal):/u);
  assert.doesNotMatch(validResult.value.summary, /stable/u);
  assert.match(validResult.value.summary, /被标记为稳定/u);

  const wrongLink = validOutput({
    reasons: [{ evidenceIds: ["build:1"], text: "羊刀是当前统计口径下的核心装备。" }]
  });
  assert.equal(validateConclusionOutput(wrongLink, evidence, { catalog }).valid, true);

  const promotedNonCore = validOutput({ summary: "无尽是当前前列方案的核心装备。" });
  assert.equal(validateConclusionOutput(promotedNonCore, evidence, { catalog }).valid, false);

  const absolute = validOutput({ nextAction: "羊刀是必备装备，优先合成。" });
  assert.equal(validateConclusionOutput(absolute, evidence, { catalog }).valid, false);

  const qualified = validOutput({ nextAction: "羊刀不是必备装备，仍需根据散件选择。" });
  assert.equal(validateConclusionOutput(qualified, evidence, { catalog }).valid, true);
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
    headline: "挑战者是当前样本中的稳定转职选择",
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

test("validateConclusionOutput rejects item-ranking conclusions that omit a displayed candidate", () => {
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
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /omits displayed evidence: item:2/u);
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

  const staleEvidence = structuredClone(evidence);
  staleEvidence.generationRules.mustMentionStaleData = true;
  assert.equal(validateConclusionOutput(validOutput(), staleEvidence, { catalog }).valid, false);
  assert.equal(validateConclusionOutput(validOutput({ riskNotice: "数据可能不是最新，请注意时效。" }), staleEvidence, { catalog }).valid, true);

  const noWinner = structuredClone(evidence);
  noWinner.generationRules.mustAvoidWinnerClaim = true;
  assert.equal(validateConclusionOutput(validOutput({ summary: "羊刀胜出，是当前更优选择。" }), noWinner, { catalog }).valid, false);
});
