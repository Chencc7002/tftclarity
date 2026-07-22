import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  analyzeCompRankingResult,
  isCompAnalysisInput,
  parseCompAnalysisRequest,
  resolveCompAnalysisTarget
} from "../src/core/comp-analysis.js";
import { buildCompRankings } from "../src/core/comp-ranking-service.js";
import { enrichCompResponseWithTrendHistory } from "../src/core/comp-trend-history.js";
import { recommendForInput } from "../src/core/recommendation-service.js";
import { createCatalog } from "../src/data/static-data.js";
import { MemoryCacheStore } from "../src/data/cache-store.js";
import { associateOfficialPatchChanges } from "../src/data/official-patch-evidence.js";
import { assembleEvidencePack } from "../src/retrieval/evidence-assembler.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url), "utf8"));

function catalog() {
  return createCatalog({
    version: "17.7",
    units: [
      { apiName: "TFT17_Nunu", zhName: "努努", aliases: ["努努"] },
      { apiName: "TFT17_Vex", zhName: "薇古丝", aliases: ["薇古丝"] },
      { apiName: "TFT17_Illaoi", zhName: "俄洛伊", aliases: ["俄洛伊"] },
      { apiName: "TFT17_Karma", zhName: "卡尔玛", aliases: ["卡尔玛"] },
      { apiName: "TFT17_Bard", zhName: "巴德", aliases: ["巴德"] },
      { apiName: "TFT17_Blitzcrank", zhName: "布里茨", aliases: ["机器人"] },
      { apiName: "TFT17_Sona", zhName: "娑娜", aliases: ["琴女"] }
    ],
    traits: [
      { apiName: "TFT17_DarkStar", filterId: "TFT17_DarkStar_1", zhName: "暗星", aliases: ["暗星"] },
      { apiName: "TFT17_ShieldTank", filterId: "TFT17_ShieldTank_2", zhName: "护卫", aliases: ["护卫"] },
      { apiName: "TFT17_Stargazer", filterId: "TFT17_Stargazer_1", zhName: "观星者", aliases: ["观星者"] }
    ],
    items: []
  });
}

function query(overrides = {}) {
  return {
    intent: "comp_analysis",
    seasonContextId: "set17-live",
    providerVersion: "metatft-live.v1",
    effectivePatch: "17.7",
    patch: "current",
    queue: "1100",
    days: 3,
    rankFilter: ["PLATINUM"],
    minSamples: 100,
    limit: 5,
    ...overrides
  };
}

test("detects the stage-five analysis questions and temporal evidence requirement", () => {
  assert.equal(isCompAnalysisInput("暗星阵容当前版本还能玩吗？"), true);
  assert.equal(isCompAnalysisInput("霞带什么装备？"), false);
  const request = parseCompAnalysisRequest("薇古丝阵容为什么突然强了？", {
    units: ["TFT17_Vex"]
  });
  assert.equal(request.questionType, "cause_up");
  assert.equal(request.requiresHistoricalEvidence, true);
  assert.deepEqual(request.targetHints.units, ["TFT17_Vex"]);
});

test("builds current facts without manufacturing missing metrics", () => {
  const comp = {
    compId: "cluster:vex",
    name: "观星者 · 薇古丝",
    units: [{ apiName: "TFT17_Vex", name: "薇古丝", items: [] }],
    traits: [{ apiName: "TFT17_Stargazer", filterId: "TFT17_Stargazer_1", name: "观星者" }],
    stats: { games: 800, avgPlacement: 4.1, top4Rate: 0.53, winRate: null, pickRate: 0.02 },
    source: { clusterId: "vex", updatedAt: "2026-07-22T00:00:00.000Z" }
  };
  const analyzed = analyzeCompRankingResult({
    candidates: [comp],
    rankings: {},
    query: query(),
    source: { updatedAt: "2026-07-22T00:00:00.000Z" },
    trend: { comparisons: {} }
  }, parseCompAnalysisRequest("薇古丝阵容当前版本还能玩吗", { units: ["TFT17_Vex"] }));
  assert.equal(analyzed.type, "comp_analysis");
  assert.equal(analyzed.analysis.currentFacts.winRate.value, null);
  assert.equal(analyzed.analysis.currentFacts.winRate.status, "unavailable");
  assert.equal(analyzed.analysis.currentFacts.sampleSize.value, 800);
  assert.equal(analyzed.analysis.evidencePack[0].sourceType, "metatft_fact");
});

test("empty comp IDs never count as target matches", () => {
  const resolution = resolveCompAnalysisTarget([{
    compId: null,
    name: "无关体系",
    units: [],
    traits: [],
    stats: {}
  }], parseCompAnalysisRequest("请分析另一个体系"));
  assert.equal(resolution.status, "not_found");
});

test("marks temporal analysis unavailable when no verifiable baseline exists", () => {
  const facts = buildCompRankings(fixture, { query: query(), catalog: catalog() });
  const analyzed = analyzeCompRankingResult(facts, parseCompAnalysisRequest("努努阵容为什么突然弱了", {
    units: ["TFT17_Nunu"]
  }));
  assert.equal(analyzed.analysis.status, "insufficient_historical_evidence");
  assert.equal(analyzed.analysis.comparison.evidenceStatus, "unavailable");
  assert.match(analyzed.analysis.answer.conclusion, /证据不足/u);
  assert.equal(analyzed.analysis.evidencePack.some((record) => record.sourceType === "historical_fact"), false);
});

test("versioned snapshots calculate all five deltas and stay season scoped", async () => {
  const store = new MemoryCacheStore({ now: () => Date.parse("2026-07-18T00:00:00.000Z") });
  const baselineQuery = query({ effectivePatch: "17.6" });
  await enrichCompResponseWithTrendHistory(fixture, {
    cacheStore: store,
    query: baselineQuery,
    now: Date.parse("2026-07-18T00:00:00.000Z")
  });
  const current = structuredClone(fixture);
  const row = current.compsStats.results.find((entry) => entry.cluster === "409002");
  row.places = [120, 220, 320, 420, 390, 290, 190, 90, 2040];
  const enriched = await enrichCompResponseWithTrendHistory(current, {
    cacheStore: store,
    query: query({ effectivePatch: "17.7" }),
    now: Date.parse("2026-07-22T00:00:00.000Z")
  });
  const comparison = enriched.trend.comparisons["409002"];
  assert.equal(comparison.currentPatch, "17.7");
  assert.equal(comparison.baselinePatch, "17.6");
  assert.equal(comparison.evidenceStatus, "complete");
  assert.equal(Object.values(comparison.metrics).every((value) => Number.isFinite(value)), true);
});

test("official patch changes associate only with related units or traits", () => {
  const related = associateOfficialPatchChanges({
    units: [{ apiName: "TFT17_Vex" }],
    traits: [{ apiName: "TFT17_Stargazer", filterId: "TFT17_Stargazer_1" }]
  }, "17.7");
  const unrelated = associateOfficialPatchChanges({
    units: [{ apiName: "TFT17_Nunu" }],
    traits: [{ apiName: "TFT17_DarkStar", filterId: "TFT17_DarkStar_1" }]
  }, "17.7");
  assert.equal(related.some((entry) => entry.id === "17.7-vex-stargazer"), true);
  assert.equal(unrelated.some((entry) => entry.id === "17.7-vex-stargazer"), false);
});

test("recommendation flow resolves a named comp and exposes typed Evidence Pack sources", async () => {
  const result = await recommendForInput("努努阵容当前版本还能玩吗？", {
    catalog: catalog(),
    compResponse: fixture,
    preferences: query(),
    useSession: false
  });
  assert.equal(result.type, "comp_analysis");
  assert.equal(result.analysis.target.compId, "cluster:409002");
  assert.equal(result.analysis.currentFacts.avgPlace.status, "available");
  const pack = assembleEvidencePack({ result, catalog: catalog(), input: "努努阵容当前版本还能玩吗？" });
  assert.equal(pack.structuredEvidence.some((record) => record.sourceType === "metatft_fact"), true);
  assert.equal(pack.structuredEvidence.some((record) => record.sourceType === "official_patch"), true);
  assert.equal(pack.request.intent, "comp_analysis");
});

test("structured-parser-only comp analysis rebuilds the target request", async () => {
  const result = await recommendForInput("努努这套体系值得投入吗", {
    catalog: catalog(),
    compResponse: fixture,
    preferences: query(),
    useSession: false,
    useStructuredParser: "always",
    structuredParser: async () => ({
      intent: "comp_analysis",
      entities: { unit_mentions: ["努努"], item_mentions: [], trait_mentions: [] },
      constraints: {
        star_level: [], item_count: null, item_policy: null, locked_items: [],
        comparison_items: [], comparison_mode: null, primary_metric: null,
        excluded_items: [], min_samples: null, sort: null, rank_filter: [],
        days: null, patch: null, queue: null, metrics: [], limit: null,
        strategy: null, reroll: null, goal: null, contested: null,
        difficulty: null, beginner_friendly: null, count: null
      },
      needs_clarification: false,
      clarification_question: null
    })
  });

  assert.equal(result.parsed.parser.structuredParser?.valid, true, JSON.stringify(result.parsed.parser.structuredParser));
  assert.equal(result.type, "comp_analysis");
  assert.equal(result.analysis.target.compId, "cluster:409002");
  assert.deepEqual(result.query.analysis.targetHints.units, ["TFT17_Nunu"]);
  assert.equal(result.parsed.parser.structuredParser.applied.includes("analysis"), true);
});
