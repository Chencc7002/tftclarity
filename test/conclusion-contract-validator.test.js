import assert from "node:assert/strict";
import test from "node:test";

import { classifyConclusionValidationErrors, validateConclusionOutput } from "../src/index.js";

function evidence(overrides = {}) {
  return {
    questionContract: {
      schemaVersion: "question-contract.v1",
      contractId: "a".repeat(64),
      questionType: "default",
      targets: { comps: [], units: ["TFT17_Xayah"], items: [], traits: [] },
      requiredAnswerDimensions: ["build_performance", "core_item_tendency", "sample_risk"],
      requiredEvidence: {
        build_performance: ["visible_builds", "games", "avgPlacement", "top4Rate", "winRate"],
        core_item_tendency: ["visible_builds"], sample_risk: ["sample_status"]
      }
    },
    conclusionSpec: { id: "unit_build_rankings.default", version: 1 },
    query: { unit: { apiName: "TFT17_Xayah", name: "霞" } },
    structuredEvidence: [{
      evidenceId: "build:1", items: [{ apiName: "TFT_Item_Test", name: "测试装备" }],
      stats: { games: 1000, avgPlacement: 3.8, top4Rate: 0.6, winRate: 0.15 }, lowSample: false
    }],
    recommendations: [], itemSignals: [], semanticEvidence: [], generationRules: {},
    ...overrides
  };
}

function validOutput(pack = evidence()) {
  return {
    schemaVersion: "llm_conclusion.v2", contractId: pack.questionContract.contractId, status: "ok",
    addressedDimensions: ["build_performance", "core_item_tendency", "sample_risk"],
    missingDimensions: [], missingEvidence: [], headline: "当前方案有可复核证据",
    summary: "按当前可见数据解释这套方案。",
    reasons: [
      { dimension: "build_performance", evidenceIds: ["build:1"], text: "当前方案有统计表现。" },
      { dimension: "core_item_tendency", evidenceIds: ["build:1"], text: "当前可见方案体现装备倾向。" },
      { dimension: "sample_risk", evidenceIds: ["build:1"], text: "当前样本可用于复核。" }
    ], alternatives: [], nextAction: "继续按当前条件查看。", riskNotice: null
  };
}

test("v2 conclusion requires the exact contract id and every allowed dimension", () => {
  const pack = evidence();
  assert.equal(validateConclusionOutput(validOutput(pack), pack).valid, true);
  const mismatch = validateConclusionOutput({ ...validOutput(pack), contractId: "b".repeat(64) }, pack);
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.issues.some((issue) => issue.category === "contract_id_mismatch"));
  const missing = validOutput(pack);
  missing.addressedDimensions = missing.addressedDimensions.slice(0, 2);
  assert.ok(validateConclusionOutput(missing, pack).issues.some((issue) => issue.category === "missing_answer_dimension"));
});

test("v2 conclusion rejects unsupported dimensions and dimension claims without required evidence", () => {
  const pack = evidence();
  const unsupported = validOutput(pack);
  unsupported.addressedDimensions.push("full_build_recommendation");
  unsupported.reasons.push({ dimension: "full_build_recommendation", evidenceIds: ["build:1"], text: "给出完整推荐。" });
  assert.ok(validateConclusionOutput(unsupported, pack).issues.some((issue) => issue.category === "unsupported_answer_dimension"));
  const missingEvidence = validOutput(pack);
  missingEvidence.reasons[0].evidenceIds = ["semantic:1"];
  pack.semanticEvidence = [{ evidenceId: "semantic:1", text: "静态说明", type: "item_description" }];
  assert.ok(validateConclusionOutput(missingEvidence, pack).issues.some((issue) => issue.category === "dimension_without_evidence"));
});

test("derived item signals satisfy visible-build requirements only when their build lineage is present", () => {
  const pack = evidence();
  pack.itemSignals = [{
    evidenceId: "item-signal:1",
    kind: "item_core_signal",
    item: { apiName: "TFT_Item_Test", name: "测试装备" },
    buildEvidenceIds: ["build:1"],
    core: true
  }];
  const output = validOutput(pack);
  output.reasons[1].evidenceIds = ["item-signal:1"];
  assert.equal(validateConclusionOutput(output, pack).valid, true);

  pack.itemSignals[0].buildEvidenceIds = ["build:404"];
  assert.ok(validateConclusionOutput(output, pack).issues.some((issue) => (
    issue.category === "dimension_without_evidence" && /core_item_tendency/u.test(issue.message)
  )));
});

test("sample thresholds are distinguished from observed game counts in validation feedback", () => {
  const pack = evidence();
  pack.query.minSamples = 100;
  const threshold = validOutput(pack);
  threshold.reasons[2].text = "筛选门槛为最低100场样本，当前记录为1000场。";
  assert.equal(validateConclusionOutput(threshold, pack).valid, true);

  const unsupported = validOutput(pack);
  unsupported.reasons[2].text = "当前只有100场样本。";
  const validation = validateConclusionOutput(unsupported, pack);
  const issue = validation.issues.find((entry) => entry.category === "unsupported_number");
  assert.ok(issue);
  assert.deepEqual(issue.allowedValues, [1000]);

  const classified = classifyConclusionValidationErrors(validation.errors, pack, { output: unsupported });
  assert.deepEqual(classified.find((entry) => entry.category === "unsupported_number")?.allowedValues, [1000]);
});

test("validation feedback identifies an unlinked evidence record that supports a scoped number", () => {
  const pack = evidence();
  pack.structuredEvidence.push({
    evidenceId: "build:2",
    items: [{ apiName: "TFT_Item_Alternative", name: "备选装备" }],
    stats: { games: 846, avgPlacement: 3.98, top4Rate: 0.588, winRate: 0.205 },
    lowSample: false
  });
  pack.structuredEvidence[0].stats.winRate = 0.183;
  const output = validOutput(pack);
  output.alternatives = [{
    dimension: "build_performance",
    evidenceIds: ["build:2"],
    text: "第二套登顶率为20.5%，高于第一套的18.3%。"
  }];

  const validation = validateConclusionOutput(output, pack);
  const issue = validation.issues.find((entry) => entry.category === "unsupported_number");
  assert.ok(issue);
  assert.equal(issue.path, "alternatives[0].text");
  assert.deepEqual(issue.linkedEvidenceIds, ["build:2"]);
  assert.deepEqual(issue.missingEvidenceIds, ["build:1"]);
  assert.match(issue.message, /build:1/u);
  assert.match(issue.message, /补充实际使用的对应证据|删除该数值/u);
  assert.ok(!issue.allowedValues.includes(18.3));
});

test("insufficient_evidence explicitly partitions answered and missing dimensions", () => {
  const pack = evidence();
  pack.questionContract.requiredAnswerDimensions = ["current_popularity", "historical_popularity_change", "possible_causes"];
  pack.questionContract.requiredEvidence = {
    current_popularity: ["metatft_fact", "pickRate"],
    historical_popularity_change: ["historical_fact"],
    possible_causes: ["historical_fact", "official_patch"]
  };
  pack.structuredEvidence = [{
    evidenceId: "analysis-source:1", type: "metatft_fact", authority: "primary_statistics",
    details: { metrics: { pickRate: 0.05 } }
  }];
  const output = validOutput(pack);
  output.status = "insufficient_evidence";
  output.addressedDimensions = ["current_popularity"];
  output.missingDimensions = ["historical_popularity_change", "possible_causes"];
  output.missingEvidence = [
    { dimension: "historical_popularity_change", requiredEvidence: ["historical_fact"] },
    { dimension: "possible_causes", requiredEvidence: ["historical_fact", "official_patch"] }
  ];
  output.reasons = [{ dimension: "current_popularity", evidenceIds: ["analysis-source:1"], text: "当前热度有可复核记录。" }];
  output.riskNotice = "其他维度证据不足，不能得出判断。";
  assert.equal(validateConclusionOutput(output, pack).valid, true);
});

test("current facts cannot stand in for history and causal claims stay bounded", () => {
  const pack = evidence();
  pack.questionContract.requiredAnswerDimensions = ["historical_popularity_change"];
  pack.questionContract.requiredEvidence = { historical_popularity_change: ["historical_fact"] };
  pack.structuredEvidence[0].type = "metatft_fact";
  const output = validOutput(pack);
  output.addressedDimensions = ["historical_popularity_change"];
  output.reasons = [{ dimension: "historical_popularity_change", evidenceIds: ["build:1"], text: "当前事实必然导致热度下降。" }];
  const result = validateConclusionOutput(output, pack);
  assert.ok(result.issues.some((issue) => issue.category === "current_fact_used_as_history"));
  assert.ok(result.issues.some((issue) => issue.category === "unsupported_causal_claim"));
});

test("popularity questions reject strength-only answers", () => {
  const pack = evidence();
  pack.questionContract.questionType = "popularity_drop";
  pack.questionContract.requiredAnswerDimensions = ["current_popularity"];
  pack.questionContract.requiredEvidence = { current_popularity: ["metatft_fact", "pickRate"] };
  pack.structuredEvidence = [{
    evidenceId: "analysis-source:1",
    type: "metatft_fact",
    authority: "primary_statistics",
    details: { metrics: { pickRate: 0.05 } }
  }];
  const output = validOutput(pack);
  output.addressedDimensions = ["current_popularity"];
  output.reasons = [{
    dimension: "current_popularity",
    evidenceIds: ["analysis-source:1"],
    text: "当前阵容强度较高。"
  }];
  const result = validateConclusionOutput(output, pack);
  assert.ok(result.issues.some((issue) => issue.category === "question_focus_mismatch"));
});
