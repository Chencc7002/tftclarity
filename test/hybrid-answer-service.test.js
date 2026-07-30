import assert from "node:assert/strict";
import test from "node:test";

import {
  DETERMINISTIC_ANSWER_RENDERERS,
  HybridAnswerService,
  validateCoachAnswer
} from "../src/coach/hybrid-answer-service.js";
import {
  STRUCTURED_RESULT_CANDIDATE_ADAPTERS,
  buildEvidenceBundle
} from "../src/knowledge/evidence-bundle-builder.js";

function structuredResult() {
  return {
    type: "unit_build_rankings",
    query: { unit: "TFT18_Xayah" },
    source: { provider: "MetaTFT", updatedAt: "2026-07-28T00:00:00Z" },
    rankedBuilds: [{
      evidenceId: "stats:build:1",
      items: ["羊刀", "无尽", "轻语"],
      stats: {
        games: 1843,
        avgPlacement: 4.02,
        top4Rate: 0.563,
        winRate: 0.141
      }
    }]
  };
}

const VIDEO = {
  evidenceId: "youtube:guide:item_priority:1",
  sourceType: "youtube",
  sourceId: "abc123xyz00",
  author: "测试频道",
  claimType: "creator_advice",
  claim: "高血量前排多时巨杀更合适",
  conditions: ["高血量前排较多"],
  timestampStart: 332
};

test("Hybrid answer falls back without losing structured statistics", async () => {
  const service = new HybridAnswerService();
  const result = await service.answer({
    question: "霞最好的装备是什么，为什么？",
    mode: "hybrid",
    structuredResult: structuredResult(),
    knowledgeEvidence: [VIDEO]
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.content.currentRecommendation.evidenceId, "stats:build:1");
  assert.match(result.text, /MetaTFT/);
  assert.equal(result.evidenceBundle.queryResult.candidates.length, 1);
});

test("Hybrid validator rejects a video recommendation overriding MetaTFT first place", () => {
  const service = new HybridAnswerService();
  return service.answer({
    question: "霞最好的装备是什么，为什么？",
    mode: "hybrid",
    structuredResult: structuredResult(),
    knowledgeEvidence: [VIDEO]
  }).then((fallback) => {
    const invalid = {
      ...fallback.content,
      currentRecommendation: {
        evidenceId: VIDEO.evidenceId,
        label: "羊刀 + 巨杀 + 轻语"
      }
    };
    const validation = validateCoachAnswer(invalid, fallback.evidenceBundle);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((error) => error.includes("must be stats:build:1")));
  });
});

test("Hybrid answer accepts a grounded provider response", async () => {
  const provider = async ({ evidenceBundle }) => {
    const first = evidenceBundle.queryResult.candidates[0];
    return {
      schemaVersion: "coach_answer.v1",
      status: "ok",
      headline: "当前统计首选不变",
      text: "当前统计首选是羊刀、无尽、轻语；高血量前排较多时，作者建议把巨杀作为条件性方案。",
      currentRecommendation: {
        evidenceId: first.evidenceId,
        label: first.items.join(" + ")
      },
      reasons: [{
        evidenceIds: [first.evidenceId],
        text: "主结论来自 MetaTFT 第一名候选。"
      }],
      alternatives: [{
        evidenceIds: [VIDEO.evidenceId],
        text: "巨杀只作为环境针对。",
        conditions: VIDEO.conditions
      }],
      citations: [first.evidenceId, VIDEO.evidenceId],
      warnings: []
    };
  };
  provider.model = "test-model";
  const service = new HybridAnswerService({ provider });
  const result = await service.answer({
    question: "霞最好的装备是什么，为什么？",
    mode: "hybrid",
    structuredResult: structuredResult(),
    knowledgeEvidence: [VIDEO]
  });
  assert.equal(result.status, "generated");
  assert.equal(result.model, "test-model");
  assert.equal(result.content.currentRecommendation.evidenceId, "stats:build:1");
});

test("Hybrid validator rejects invented statistics", () => {
  const bundle = buildEvidenceBundle({
    mode: "hybrid",
    structuredEvidence: [{
      evidenceId: "stats:build:1",
      resultType: "item_build",
      items: ["羊刀", "无尽", "轻语"],
      stats: {
        games: 1843,
        avgPlacement: 4.02,
        top4Rate: 0.563,
        winRate: 0.141
      },
      riskFlags: []
    }],
    knowledgeEvidence: []
  });
  const validation = validateCoachAnswer({
    schemaVersion: "coach_answer.v1",
    status: "ok",
    headline: "当前首选",
    text: "这套装备当前前四率是 99%。",
    currentRecommendation: {
      evidenceId: "stats:build:1",
      label: "羊刀 + 无尽 + 轻语"
    },
    reasons: [{
      evidenceIds: ["stats:build:1"],
      text: "MetaTFT 排名第一。"
    }],
    alternatives: [],
    citations: ["stats:build:1"],
    warnings: []
  }, bundle);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /unsupported statistical number/);
});

test("Hybrid trend fallback uses rising candidates instead of general rankings", async () => {
  const service = new HybridAnswerService();
  const result = await service.answer({
    question: "最近哪些阵容正在上升？",
    mode: "hybrid",
    query: { intent: "comp_trends" },
    structuredResult: {
      type: "comp_trends",
      source: { provider: "MetaTFT", updatedAt: "2026-07-29T00:00:00Z" },
      rankings: {
        top4_rate: [{
          name: "普通排行第一",
          stats: { games: 1000, avgPlacement: 4, top4Rate: 0.6, winRate: 0.1 }
        }]
      },
      rising: [{
        name: "正在上升阵容",
        stats: { games: 500, avgPlacement: 4.2, top4Rate: 0.55, winRate: 0.12 },
        trend: { direction: "rising", improving: true, avgPlacementChange: -0.25 }
      }]
    },
    knowledgeEvidence: []
  });
  assert.equal(result.evidenceBundle.queryResult.candidates[0].name, "正在上升阵容");
  assert.equal(result.evidenceBundle.queryResult.candidates[0].resultType, "comp_trend");
  assert.equal(result.evidenceBundle.queryResult.candidates[0].stats.avgPlacementChange, -0.25);
  assert.match(result.text, /正在上升阵容/);
  assert.doesNotMatch(result.text, /普通排行第一/);
});

test("structured evidence adapters and deterministic renderers are registered by task type", () => {
  assert.equal(typeof STRUCTURED_RESULT_CANDIDATE_ADAPTERS.comp_trends, "function");
  assert.equal(typeof STRUCTURED_RESULT_CANDIDATE_ADAPTERS.item_carrier_rankings, "function");
  assert.equal(typeof DETERMINISTIC_ANSWER_RENDERERS.comp_trends, "function");
  assert.equal(typeof DETERMINISTIC_ANSWER_RENDERERS.unit_build_rankings, "function");

  const bundle = buildEvidenceBundle({
    mode: "structured",
    structuredResult: {
      type: "item_carrier_rankings",
      carriers: [{
        unitApiName: "TFT18_Xayah",
        placementUplift: 0.25,
        stats: { games: 300, avgPlacement: 3.9, top4Rate: 0.58, winRate: 0.14 }
      }]
    }
  });
  assert.equal(bundle.queryResult.candidates[0].resultType, "item_carrier");
  assert.equal(bundle.queryResult.candidates[0].name, "TFT18_Xayah");
});

test("empty MetaTFT QueryResult remains authoritative instead of falling through to generic RAG", async () => {
  const service = new HybridAnswerService();
  const result = await service.answer({
    question: "霞最好的装备是什么，为什么？",
    mode: "hybrid",
    structuredResult: {
      type: "unit_build_rankings",
      query: { unit: "TFT17_Xayah", minSamples: 100 },
      source: { provider: "MetaTFT", updatedAt: "2026-07-29T00:00:00Z" },
      rankedBuilds: []
    },
    knowledgeEvidence: []
  });
  assert.equal(result.content.status, "insufficient_evidence");
  assert.match(result.text, /MetaTFT 结构化 QueryResult/);
  assert.match(result.text, /没有满足样本门槛和筛选条件的候选/);
  assert.ok(result.warnings.includes("structured_query_no_eligible_candidates"));
});
