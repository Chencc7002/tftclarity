import assert from "node:assert/strict";
import test from "node:test";

import {
  ANSWER_MODE_ROUTER_SCHEMA_VERSION,
  routeAnswerMode
} from "../src/routing/answer-mode-router.js";

test("AnswerModeRouter keeps precise current-stat queries structured", () => {
  const route = routeAnswerMode({
    input: "霞最好的装备是什么？",
    parsed: { intent: "unit_build_rankings", unit: "TFT18_Xayah" }
  });
  assert.equal(route.schemaVersion, ANSWER_MODE_ROUTER_SCHEMA_VERSION);
  assert.equal(route.mode, "structured");
  assert.deepEqual(route.structuredOperations, ["unit_build_rankings"]);
  assert.deepEqual(route.retrievalScopes, []);
  assert.equal(route.currentBestRequired, true);
});

test("AnswerModeRouter sends open strategy questions to RAG", () => {
  const route = routeAnswerMode({
    input: "霞阵容怎么过渡？",
    parsed: { intent: "comp_rankings" }
  });
  assert.equal(route.mode, "rag");
  assert.deepEqual(route.structuredOperations, []);
  assert.ok(route.retrievalScopes.includes("video_guides"));
});

test("AnswerModeRouter combines current statistics and explanation as Hybrid", () => {
  const route = routeAnswerMode({
    input: "霞最好的装备是什么，为什么？",
    parsed: { intent: "unit_build_rankings", unit: "TFT18_Xayah" }
  });
  assert.equal(route.mode, "hybrid");
  assert.deepEqual(route.structuredOperations, ["unit_build_rankings"]);
  assert.equal(route.authority.currentStatistics, "metatft");
  assert.equal(route.authority.videoMayOverrideCurrentStatistics, false);
  assert.equal(route.retrievalScopes.includes("current_stats"), false);
});

test("AnswerModeRouter recalls current_stats only for broad environment context", () => {
  const broad = routeAnswerMode({
    input: "当前版本环境概览和热门阵容推荐",
    parsed: { intent: "comp_rankings" }
  });
  assert.ok(broad.retrievalScopes.includes("current_stats"));

  const trend = routeAnswerMode({
    input: "最近阵容有什么变化",
    parsed: { intent: "comp_trends" }
  });
  assert.ok(trend.retrievalScopes.includes("current_stats"));

  const exactHybrid = routeAnswerMode({
    input: "霞三件装备怎么配，为什么？",
    parsed: { intent: "unit_best_3_items" }
  });
  assert.equal(exactHybrid.retrievalScopes.includes("current_stats"), false);
});

test("AnswerModeRouter does not invent a unit-build operation for a broad environment question", () => {
  const route = routeAnswerMode({
    input: "当前环境怎么样？",
    parsed: { intent: "unit_build_rankings", unit: null }
  });
  assert.equal(route.mode, "rag");
  assert.deepEqual(route.structuredOperations, []);
  assert.ok(route.retrievalScopes.includes("current_stats"));
  assert.deepEqual(route.structuredReadiness.missingEntities, ["champion"]);
  assert.ok(route.reasonCodes.includes("structured_required_entities_missing"));
});

test("AnswerModeRouter applies requiredEntities to every registered structured intent", () => {
  const cases = [
    ["unit_item_comparison", "champion"],
    ["unit_emblem_rankings", "champion"],
    ["item_carrier_rankings", "item"],
    ["unit_details", "champion"],
    ["item_details", "item"],
    ["trait_details", "trait"]
  ];
  for (const [intent, missingEntity] of cases) {
    const route = routeAnswerMode({
      input: "请给我结果",
      parsed: { intent }
    });
    assert.equal(route.mode, "structured", intent);
    assert.deepEqual(route.structuredOperations, [], intent);
    assert.deepEqual(route.structuredReadiness.missingEntities, [missingEntity], intent);
  }

  const compRoute = routeAnswerMode({
    input: "当前稳定阵容",
    parsed: { intent: "comp_rankings" }
  });
  assert.equal(compRoute.structuredReadiness.executable, true);
});

test("AnswerModeRouter does not reject an unregistered open question", () => {
  const route = routeAnswerMode({
    input: "我不喜欢赌狗，有什么稳定阵容？",
    parsed: { intent: "comp_rankings" }
  });
  assert.equal(route.mode, "rag");
  assert.ok(route.reasonCodes.includes("knowledge_signal"));
});
