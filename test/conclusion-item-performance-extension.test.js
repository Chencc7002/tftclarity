import assert from "node:assert/strict";
import test from "node:test";

import {
  createCatalog,
  generateEvidenceBackedConclusion,
  validateConclusionOutput
} from "../src/index.js";

const catalog = createCatalog();
const targetItem = "TFT_Item_GuinsoosRageblade";

function result({ includeTarget = true } = {}) {
  const items = includeTarget
    ? [targetItem, "TFT_Item_InfinityEdge"]
    : ["TFT_Item_InfinityEdge"];
  return {
    type: "unit_item_rankings",
    parsed: { intent: "unit_item_rankings", unit: "TFT17_Xayah", confidence: 1, parser: { entityMatches: [] } },
    query: {
      intent: "unit_item_rankings", unit: "TFT17_Xayah", performanceItem: targetItem,
      days: 3, rankFilter: ["EMERALD", "DIAMOND"], minSamples: 100,
      seasonContextId: "set17-live", warnings: []
    },
    validation: { valid: true, errors: [], warnings: [] },
    clarification: { needsClarification: false, blocking: false },
    itemRankings: items.map((apiName, index) => ({
      apiName, coverage: index === 0 ? 0.42 : 0.31,
      stats: { games: index === 0 ? 1200 : 900, avgPlacement: index === 0 ? 3.82 : 3.96, top4Rate: index === 0 ? 0.61 : 0.58, winRate: index === 0 ? 0.17 : 0.15 }
    })),
    source: { provider: "MetaTFT", cache: "live", patch: "17.7", updatedAt: "2026-07-22T00:00:00Z" },
    cache: { query: { hit: false } }
  };
}

function okOutput(evidence) {
  return {
    schemaVersion: "llm_conclusion.v2", contractId: evidence.questionContract.contractId, status: "ok",
    addressedDimensions: ["target_item_performance", "ranking_context", "sample_risk"],
    missingDimensions: [], missingEvidence: [], headline: "目标装备表现可复核",
    summary: "只解释目标装备在当前统计口径下的表现。",
    reasons: [
      { dimension: "target_item_performance", evidenceIds: ["item:1"], text: "目标装备有当前统计表现。" },
      { dimension: "ranking_context", evidenceIds: ["item:1", "item:2"], text: "目标装备与另一个可见候选处于同一排名口径。" },
      { dimension: "sample_risk", evidenceIds: ["item:1"], text: "当前样本可用于复核。" }
    ], alternatives: [], nextAction: "继续查看目标装备的当前表现。", riskNotice: null
  };
}

test("declarative item_performance Spec creates its Question Contract without changing the conclusion engine", async () => {
  let capturedEvidence = null;
  const conclusion = await generateEvidenceBackedConclusion({
    result: result(), catalog, input: "霞的羊刀表现怎么样？",
    principalId: "user-extension", conversationId: "conversation-extension",
    config: { enabled: true, model: "fixture-model" },
    provider: async ({ evidence }) => {
      capturedEvidence = evidence;
      return okOutput(evidence);
    }
  });
  assert.equal(conclusion.status, "generated");
  assert.equal(capturedEvidence.questionContract.questionType, "item_performance");
  assert.equal(capturedEvidence.conclusionSpec.id, "unit_item_rankings.item_performance");
  assert.deepEqual(capturedEvidence.questionContract.requiredAnswerDimensions,
    ["target_item_performance", "ranking_context", "sample_risk"]);
  assert.deepEqual(conclusion.content.addressedDimensions,
    ["target_item_performance", "ranking_context", "sample_risk"]);
});

test("item_performance Validator rejects evidence-correct output that answers with a full build", async () => {
  let validation;
  await generateEvidenceBackedConclusion({
    result: result(), catalog, input: "霞的羊刀表现怎么样？",
    config: { enabled: true, model: "fixture-model", maxCorrections: 0 },
    provider: async ({ evidence }) => {
      const output = okOutput(evidence);
      output.reasons[0].text = "基于目标装备证据，推荐完整三件套出装。";
      validation = validateConclusionOutput(output, evidence, { catalog });
      return output;
    }
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.category === "question_focus_mismatch"));
});

test("item_performance returns insufficient_evidence when the target item record is absent", async () => {
  const conclusion = await generateEvidenceBackedConclusion({
    result: result({ includeTarget: false }), catalog, input: "霞的羊刀表现怎么样？",
    config: { enabled: true, model: "fixture-model" },
    provider: async ({ evidence }) => ({
      schemaVersion: "llm_conclusion.v2", contractId: evidence.questionContract.contractId,
      status: "insufficient_evidence",
      addressedDimensions: ["ranking_context", "sample_risk"],
      missingDimensions: ["target_item_performance"],
      missingEvidence: [{
        dimension: "target_item_performance",
        requiredEvidence: ["target_item", "games", "avgPlacement", "top4Rate", "winRate"]
      }],
      headline: "目标装备证据不足", summary: "当前排名数据没有目标装备记录，不能判断其表现。",
      reasons: [
        { dimension: "ranking_context", evidenceIds: ["item:1"], text: "当前仍有其他可见装备排名记录。" },
        { dimension: "sample_risk", evidenceIds: ["item:1"], text: "现有候选样本可用于复核排名口径。" }
      ], alternatives: [], nextAction: "调整条件后重新查询目标装备。", riskNotice: "缺少目标装备证据，不能给出表现判断。"
    })
  });
  assert.equal(conclusion.status, "generated");
  assert.equal(conclusion.content.status, "insufficient_evidence");
  assert.deepEqual(conclusion.content.missingDimensions, ["target_item_performance"]);
});
