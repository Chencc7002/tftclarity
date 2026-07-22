import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  RetrievalPlanner,
  buildCompRankingQuery,
  buildQueryContext,
  createCatalog,
  parseQuery,
  runLlmRetrievalPipeline,
  validateQueryContext
} from "../src/index.js";

const seedCatalog = createCatalog();
const catalog = createCatalog({
  units: [
    ...seedCatalog.units,
    { apiName: "TFT17_MasterYi", zhName: "易大师", aliases: ["易", "剑圣", "无极剑圣", "master yi", "yi"], current: true }
  ],
  traits: seedCatalog.traits,
  items: seedCatalog.items
});
const fixture = JSON.parse(readFileSync(new URL("./fixtures/conclusion-fixture.json", import.meta.url), "utf8"));

function resolveUnitRequest(input) {
  const parsed = parseQuery(input, { catalog });
  const query = buildQueryContext(parsed, { catalog });
  const validation = validateQueryContext(query, { catalog });
  return { parsed, query, validation, clarification: { needsClarification: false, blocking: false } };
}

function emblemResult(input) {
  const resolved = resolveUnitRequest(input);
  const apiNames = [
    "TFT17_Item_HPTankEmblemItem",
    "TFT17_Item_StargazerEmblemItem",
    "TFT17_Item_DarkStarEmblemItem"
  ];
  return {
    type: "unit_emblem_rankings",
    parsed: resolved.parsed,
    query: { ...resolved.query, intent: "unit_emblem_rankings", minSamples: 0 },
    validation: resolved.validation,
    clarification: resolved.clarification,
    itemRankings: apiNames.map((apiName, index) => ({
      apiName,
      stats: {
        games: [60, 840, 620][index],
        avgPlacement: [3.21, 3.78, 3.92][index],
        top4Rate: [0.71, 0.63, 0.6][index],
        winRate: [0.24, 0.18, 0.16][index]
      },
      coverage: [0.002, 0.04, 0.03][index]
    })),
    source: { provider: "MetaTFT", cache: "live", patch: "17.7", updatedAt: "2026-07-17T00:00:00Z" },
    cache: { query: { hit: false } }
  };
}

function emblemOutput(evidence = {}) {
  return {
    schemaVersion: "llm_conclusion.v2",
    contractId: evidence.questionContract?.contractId ?? "test-contract",
    status: "ok",
    addressedDimensions: ["emblem_performance_ranking", "metric_reliability", "sample_risk"],
    missingDimensions: [],
    missingEvidence: [],
    headline: "高样本候选更适合作为常规选择",
    summary: "低样本榜首只是纸面亮点，另外两个高样本候选更适合稳定参考。",
    reasons: [
      { dimension: "emblem_performance_ranking", evidenceIds: ["item:1", "item:2", "item:3"], text: "第一项样本不足，另外两项样本更充足，稳定性更容易复核。" },
      { dimension: "metric_reliability", evidenceIds: ["item:2"], text: "第二项的样本更充足。" },
      { dimension: "sample_risk", evidenceIds: ["item:1"], text: "第一项属于低样本，仅供观察。" }
    ],
    alternatives: [],
    nextAction: "根据当前可获得的纹章，在高样本候选中选择。",
    riskNotice: "低样本榜首仅供观察，不能视为稳定最优。"
  };
}

test("all emblem-ranking synonyms resolve to one intent without asking for a named emblem", () => {
  for (const input of [
    "剑圣哪个转职好",
    "剑圣有什么强的转职",
    "剑圣应该带什么转",
    "易大师适合什么纹章"
  ]) {
    const resolved = resolveUnitRequest(input);
    assert.equal(resolved.parsed.intent, "unit_emblem_rankings", input);
    assert.equal(resolved.validation.valid, true, input);
    assert.equal(resolved.parsed.parser.genericEmblemRequested, false, input);
  }
});

test("pipeline returns a corrected conclusion after the first generated version fails validation", async () => {
  const calls = [];
  const result = await runLlmRetrievalPipeline({
    input: "剑圣哪个转职好",
    catalog,
    resolveRequest: resolveUnitRequest,
    retrieveStructured: ({ input }) => emblemResult(input),
    conclusionConfig: { enabled: true, model: "fixture-model", maxCorrections: 2 },
    conclusionProvider: async (request) => {
      calls.push(request);
      return calls.length === 1
        ? { ...emblemOutput(request.evidence), contractId: "wrong-contract-id" }
        : emblemOutput(request.evidence);
    }
  });
  assert.equal(result.status, "generated");
  assert.equal(result.conclusion.attempts, 2);
  assert.equal(result.conclusion.corrections, 1);
  assert.equal(calls[1].validationFeedback.schemaVersion, "conclusion_validation_feedback.v1");
  assert.equal(calls[1].validationFeedback.errors[0].category, "contract_id_mismatch");
});

test("pipeline stops repeated semantic validation errors and exposes template fallback", async () => {
  let calls = 0;
  const result = await runLlmRetrievalPipeline({
    input: "剑圣哪个转职好",
    catalog,
    resolveRequest: resolveUnitRequest,
    retrieveStructured: ({ input }) => emblemResult(input),
    conclusionConfig: { enabled: true, model: "fixture-model", maxCorrections: 2 },
    conclusionProvider: async ({ evidence }) => {
      calls += 1;
      const value = emblemOutput(evidence);
      return { ...value, reasons: [{ ...value.reasons[0], text: "前四率99.9%。" }, ...value.reasons.slice(1)] };
    }
  });
  assert.equal(result.status, "deterministic_fallback");
  assert.equal(result.conclusion.status, "fallback");
  assert.equal(result.conclusion.reason, "invalid_output");
  assert.equal(calls, 1);
  assert.equal(result.conclusion.validationFeedback.errors[0].category, "unsupported_number");
});

test("three-item evidence contains only the three visible cards even if the structured result has hidden rows", async () => {
  const result = structuredClone(fixture);
  result.rankedBuilds = Array.from({ length: 12 }, (_, index) => ({
    ...structuredClone(fixture.rankedBuilds[index % fixture.rankedBuilds.length]),
    items: [...fixture.rankedBuilds[index % fixture.rankedBuilds.length].items],
    stats: { ...fixture.rankedBuilds[index % fixture.rankedBuilds.length].stats, games: 1200 - index }
  }));
  let visibleBuildIds = [];
  const pipeline = await runLlmRetrievalPipeline({
    input: "霞怎么出装？",
    catalog,
    resolveRequest: resolveUnitRequest,
    retrieveStructured: async () => result,
    conclusionConfig: { enabled: true, model: "fixture-model" },
    conclusionProvider: async ({ evidence }) => {
      visibleBuildIds = evidence.structuredEvidence
        .filter((entry) => entry.evidenceId.startsWith("build:"))
        .map((entry) => entry.evidenceId);
      return {
        schemaVersion: "llm_conclusion.v2",
        contractId: evidence.questionContract.contractId,
        status: "ok",
        addressedDimensions: ["build_performance", "core_item_tendency", "sample_risk"],
        missingDimensions: [],
        missingEvidence: [],
        headline: "只比较当前展示的三套方案",
        summary: "当前展示方案各有取舍。",
        reasons: [
          { dimension: "build_performance", evidenceIds: ["build:1", "build:2", "build:3"], text: "三套可见方案都纳入比较。" },
          { dimension: "core_item_tendency", evidenceIds: ["build:1"], text: "当前组合用于观察装备倾向。" },
          { dimension: "sample_risk", evidenceIds: ["build:1"], text: "当前样本可用于复核。" }
        ],
        alternatives: [],
        nextAction: "从当前三套中选择。",
        riskNotice: null
      };
    }
  });
  assert.equal(pipeline.conclusion.status, "generated");
  assert.deepEqual(visibleBuildIds, ["build:1", "build:2", "build:3"]);
});

test("comp trend generation uses standardized improvement and pick-rate foundation", async () => {
  const input = "当前版本阵容趋势";
  const parsed = parseQuery(input, { catalog });
  const query = buildCompRankingQuery(parsed);
  const structured = {
    type: "comp_trends",
    parsed,
    query,
    validation: { valid: true, errors: [], warnings: [] },
    clarification: { needsClarification: false, blocking: false },
    rankings: {},
    references: [],
    improving: [
      { compId: "comp-a", name: "阵容甲", stats: { games: 2400, avgPlacement: 3.8, top4Rate: 0.61, winRate: 0.16, pickRate: 0.051 }, trend: { avgPlacementChange: -0.24, emergenceScore: 0.71, improving: true } },
      { compId: "comp-b", name: "阵容乙", stats: { games: 900, avgPlacement: 4.0, top4Rate: 0.56, winRate: 0.12, pickRate: 0.018 }, trend: { avgPlacementChange: -0.31, emergenceScore: 0.59, improving: true } }
    ],
    source: { provider: "MetaTFT", cache: "live", patch: "17.7", updatedAt: "2026-07-17T00:00:00Z" },
    cache: { query: { hit: false } }
  };
  const result = await runLlmRetrievalPipeline({
    input,
    catalog,
    resolveRequest: async () => ({ parsed, query, validation: structured.validation, clarification: structured.clarification }),
    retrieveStructured: async () => structured,
    conclusionConfig: { enabled: true, model: "fixture-model" },
    conclusionProvider: async ({ evidence }) => ({
      schemaVersion: "llm_conclusion.v2",
      contractId: evidence.questionContract.contractId,
      status: "ok",
      addressedDimensions: ["current_popularity", "placement_trend", "sample_risk"],
      missingDimensions: [],
      missingEvidence: [],
      headline: "阵容甲更值得关注",
      summary: "阵容甲兼有名次改善和更高的登场基础；阵容乙提升更大但使用基础较低。",
      reasons: [
        { dimension: "current_popularity", evidenceIds: ["comp:1", "comp:2"], text: "阵容甲登场率5.1%，阵容乙登场率1.8%。" },
        { dimension: "placement_trend", evidenceIds: ["comp:1", "comp:2"], text: "阵容甲提升0.24，阵容乙提升0.31。" },
        { dimension: "sample_risk", evidenceIds: ["comp:1"], text: "当前样本可用于趋势观察。" }
      ],
      alternatives: [],
      nextAction: "优先观察提升与登场基础同时较强的阵容。",
      riskNotice: null
    })
  });
  assert.equal(parsed.intent, "comp_trends");
  assert.equal(result.conclusion.status, "generated");
});

test("detail intents never call the conclusion provider", async () => {
  let providerCalls = 0;
  const input = "易大师资料";
  const parsed = { rawInput: input, intent: "unit_details", unit: "TFT17_MasterYi", unitAlias: "易大师", parser: { entityMatches: [] } };
  const query = { intent: "unit_details", unit: "TFT17_MasterYi", warnings: [] };
  const result = await runLlmRetrievalPipeline({
    input,
    catalog,
    resolveRequest: async () => ({ parsed, query, validation: { valid: true, errors: [], warnings: [] }, clarification: null }),
    retrieveStructured: async () => ({ type: "unit_details", query, details: { apiName: "TFT17_MasterYi" } }),
    conclusionConfig: { enabled: true },
    conclusionProvider: async () => { providerCalls += 1; return emblemOutput(); }
  });
  assert.equal(result.status, "structured_only");
  assert.equal(result.retrievalPlan.promptKey, null);
  assert.equal(providerCalls, 0);
});

test("semantic or embedding failure does not block the structured query", async () => {
  let structuredCalls = 0;
  const result = await runLlmRetrievalPipeline({
    input: "霞怎么出装？",
    catalog,
    resolveRequest: resolveUnitRequest,
    planner: new RetrievalPlanner({ forceSemantic: true }),
    semanticRetriever: { search: async () => { throw Object.assign(new Error("offline"), { code: "embedding_provider_unavailable" }); } },
    retrieveStructured: async () => { structuredCalls += 1; return structuredClone(fixture); },
    conclusionConfig: { enabled: false }
  });
  assert.equal(structuredCalls, 1);
  assert.equal(result.structuredResult.type, fixture.type);
  assert.equal(result.conclusion.status, "disabled");
});
