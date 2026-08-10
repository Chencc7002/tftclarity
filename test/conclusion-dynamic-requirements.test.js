import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CONCLUSION_SPEC_REGISTRY,
  createCatalog,
  createIntentEnvelope,
  createQuestionContract,
  generateEvidenceBackedConclusion
} from "../src/index.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/conclusion-fixture.json", import.meta.url), "utf8"));
const catalog = createCatalog();

function contractFor(result, input = "fixture equipment query") {
  const query = result.query;
  const intentEnvelope = createIntentEnvelope({
    input,
    parsed: {
      intent: query.intent,
      unit: query.unit,
      confidence: 1,
      parser: { entityMatches: [] }
    },
    query,
    validation: { valid: true },
    catalog
  });
  const spec = CONCLUSION_SPEC_REGISTRY.resolve({
    intent: query.intent,
    questionType: query.performanceItem ? "item_performance" : "default",
    resultType: result.type
  });
  return createQuestionContract({
    originalQuestion: input,
    intentEnvelope,
    query,
    result: { ...result, validation: { valid: true } },
    spec
  });
}

function buildResult(builds) {
  return {
    ...structuredClone(fixture),
    rankedBuilds: builds
  };
}

test("stable single-build queries require neither empty core tendency nor sample risk", () => {
  const result = buildResult([structuredClone(fixture.rankedBuilds[0])]);
  const contract = contractFor(result);

  assert.deepEqual(contract.requiredAnswerDimensions, ["build_performance"]);
  assert.deepEqual(contract.allowedAnswerDimensions, [
    "build_performance", "core_item_tendency", "sample_risk"
  ]);
  assert.equal(contract.requirementContext.candidateCount, 1);
  assert.equal(contract.requirementContext.hasLowSample, false);
});

test("multiple stable builds activate core tendency without manufacturing sample risk", () => {
  const contract = contractFor(buildResult(structuredClone(fixture.rankedBuilds)));

  assert.deepEqual(contract.requiredAnswerDimensions, ["build_performance", "core_item_tendency"]);
  assert.equal(contract.requirementContext.hasMultipleCandidates, true);
  assert.equal(contract.requirementContext.hasLowSample, false);
});

test("actual low-sample evidence activates the sample-risk dimension", () => {
  const lowSampleBuilds = structuredClone(fixture.rankedBuilds).map((build) => ({
    ...build,
    stats: { ...build.stats, games: 120 }
  }));
  const contract = contractFor(buildResult(lowSampleBuilds));

  assert.deepEqual(contract.requiredAnswerDimensions, [
    "build_performance", "core_item_tendency", "sample_risk"
  ]);
  assert.equal(contract.requirementContext.hasLowSample, true);
});

test("item rankings activate sample risk only when a displayed item is low-sample", () => {
  const result = {
    type: "unit_item_rankings",
    query: {
      ...structuredClone(fixture.query),
      intent: "unit_item_rankings"
    },
    itemRankings: [
      {
        apiName: "TFT_Item_GuinsoosRageblade",
        coverage: 0.4,
        stats: { games: 1200, top4Rate: 0.61, winRate: 0.18, avgPlacement: 3.86 }
      },
      {
        apiName: "TFT_Item_InfinityEdge",
        coverage: 0.3,
        stats: { games: 900, top4Rate: 0.58, winRate: 0.16, avgPlacement: 3.98 }
      }
    ]
  };
  const stable = contractFor(result);
  assert.deepEqual(stable.requiredAnswerDimensions, ["item_performance_ranking", "metric_reliability"]);

  result.itemRankings[1].stats.games = 100;
  const lowSample = contractFor(result);
  assert.deepEqual(lowSample.requiredAnswerDimensions, [
    "item_performance_ranking", "metric_reliability", "sample_risk"
  ]);
});

test("mixed item rankings expose up to thirty candidates to conclusion requirements", () => {
  const result = {
    type: "unit_item_rankings",
    query: {
      ...structuredClone(fixture.query),
      intent: "unit_item_rankings",
      itemCategories: ["ordinary_completed", "artifact"]
    },
    itemRankingMethodology: {
      methodology: "category_relative_sample_tier_then_performance_v1"
    },
    itemRankings: Array.from({ length: 35 }, (_, index) => ({
      apiName: `TFT_Test_Mixed_Item_${index + 1}`,
      stats: { games: 1000, top4Rate: 0.5, winRate: 0.1, avgPlacement: 4 }
    }))
  };

  const contract = contractFor(result);
  assert.equal(contract.requirementContext.candidateCount, 30);
});

test("an incomplete requested comparison succeeds only as explicit insufficient evidence", async () => {
  const result = {
    type: "unit_item_comparison",
    parsed: { intent: "unit_item_comparison", unit: "TFT17_Xayah", confidence: 1, parser: { entityMatches: [] } },
    query: {
      ...structuredClone(fixture.query),
      intent: "unit_item_comparison",
      comparisonItems: ["TFT_Item_GuinsoosRageblade", "TFT_Item_InfinityEdge"],
      primaryMetric: "top4Rate"
    },
    validation: { valid: true, errors: [], warnings: [] },
    clarification: { needsClarification: false, blocking: false },
    comparison: {
      winner: null,
      entries: [{
        apiName: "TFT_Item_GuinsoosRageblade",
        stable: true,
        qualified: true,
        stats: { games: 500, top4Rate: 0.6, winRate: 0.2, avgPlacement: 3.9 }
      }]
    },
    source: { provider: "MetaTFT", cache: "live", updatedAt: new Date().toISOString() },
    cache: { query: { hit: false } }
  };
  let capturedContract;
  const events = [];
  const conclusion = await generateEvidenceBackedConclusion({
    result,
    catalog,
    input: "compare two items",
    config: { enabled: true, model: "fixture-model", maxCorrections: 0, onEvent: (event) => events.push(event) },
    provider: async ({ evidence }) => {
      capturedContract = evidence.questionContract;
      return {
        schemaVersion: "llm_conclusion.v2",
        contractId: capturedContract.contractId,
        status: "insufficient_evidence",
        addressedDimensions: [],
        missingDimensions: [...capturedContract.requiredAnswerDimensions],
        missingEvidence: capturedContract.requiredAnswerDimensions.map((dimension) => ({
          dimension,
          requiredEvidence: [...capturedContract.requiredEvidence[dimension]]
        })),
        headline: "对比证据不足",
        summary: "当前证据不足以形成完整对比结论。",
        reasons: [],
        alternatives: [],
        nextAction: "补充同口径数据后重新比较。",
        riskNotice: "缺少完整对比证据。"
      };
    }
  });

  assert.ok(capturedContract, JSON.stringify({ conclusion, events }));
  assert.deepEqual(capturedContract.requiredAnswerDimensions, ["comparison_result", "comparison_metrics"]);
  assert.equal(capturedContract.requirementContext.comparisonRequested, true);
  assert.equal(capturedContract.requirementContext.comparisonOptionCount, 1);
  assert.equal(conclusion.status, "generated");
  assert.equal(conclusion.content.status, "insufficient_evidence");
  assert.deepEqual(conclusion.content.missingDimensions, ["comparison_result", "comparison_metrics"]);
});

test("completed special-item queries with zero candidates return explicit insufficient evidence", async () => {
  const result = {
    type: "unit_item_rankings",
    parsed: {
      intent: "unit_item_rankings",
      unit: "TFT17_Xayah",
      confidence: 1,
      parser: { entityMatches: [] }
    },
    query: {
      ...structuredClone(fixture.query),
      intent: "unit_item_rankings",
      itemPolicy: "include_artifact",
      itemCategories: ["artifact"],
      minSamples: 0
    },
    validation: { valid: true, errors: [], warnings: [] },
    clarification: { needsClarification: false, blocking: false },
    itemRankings: [],
    itemRankingMethodology: {
      methodology: "special_item_outlier_cleaned_avg_placement_only",
      totalGames: 0,
      completeBuildCount: 0,
      coverageReliable: false,
      sampleFloor: { outlierFloor: 0, relativeRatio: 0.02 }
    },
    source: { provider: "MetaTFT", cache: "live", updatedAt: new Date().toISOString() },
    cache: { query: { hit: false } }
  };
  let providerCalls = 0;
  const conclusion = await generateEvidenceBackedConclusion({
    result,
    catalog,
    input: "霞的神器排行",
    config: { enabled: true, model: "fixture-model", maxCorrections: 0 },
    provider: async ({ evidence }) => {
      providerCalls += 1;
      const contract = evidence.questionContract;
      return {
        schemaVersion: "llm_conclusion.v2",
        contractId: contract.contractId,
        status: "insufficient_evidence",
        addressedDimensions: [],
        missingDimensions: [...contract.requiredAnswerDimensions],
        missingEvidence: contract.requiredAnswerDimensions.map((dimension) => ({
          dimension,
          requiredEvidence: [...contract.requiredEvidence[dimension]]
        })),
        headline: "当前缺少神器排行证据",
        summary: "本次条件下没有可见神器候选，无法形成装备表现结论。",
        reasons: [],
        alternatives: [],
        nextAction: "可调整星级或段位范围后重新查询。",
        riskNotice: "当前证据不足。"
      };
    }
  });

  assert.equal(providerCalls, 1);
  assert.equal(conclusion.status, "generated");
  assert.equal(conclusion.content.status, "insufficient_evidence");
  assert.deepEqual(conclusion.content.missingDimensions, [
    "item_performance_ranking", "metric_reliability"
  ]);
});
