import assert from "node:assert/strict";
import test from "node:test";
import { AnonymousAccessService } from "../src/access/anonymous-access.js";
import {
  createSmallWindowRuntime,
  handleFeedbackRequest,
  handleFeedbackStatsRequest,
  handleRecommendRequest
} from "../src/app/small-window-server.js";
import { MemoryCacheStore, createCatalog } from "../src/index.js";
import { SQLiteCacheStore } from "../src/data/sqlite-cache-store.js";

function recommendationResult() {
  return {
    type: "unit_build_rankings",
    text: "fixture",
    query: {
      intent: "unit_build_rankings",
      unit: "TFT17_Xayah",
      starLevel: [2],
      itemCount: 3,
      traitFilters: [],
      itemPolicy: "ordinary_only",
      ownedItems: [],
      excludedItems: [],
      minSamples: 100,
      days: 3,
      patch: "current",
      queue: "1100",
      rankFilter: ["PLATINUM"],
      sort: "top4_first",
      warnings: [],
      assumptions: [],
      constraints: {}
    },
    rankedBuilds: [{
      items: ["TFT_Item_GuinsoosRageblade", "TFT_Item_JeweledGauntlet", "TFT_Item_StatikkShiv"],
      stats: { top4Rate: 0.61, winRate: 0.18, avgPlacement: 3.9, games: 1200 }
    }],
    rows: [],
    filteredBuilds: [],
    cache: { query: { hit: false, stale: false } },
    source: { patch: "current" }
  };
}

function runtime() {
  return createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    metaTFTClient: {},
    compsClient: {},
    fetchItems: false,
    recommendForInputImpl: async () => structuredClone(recommendationResult())
  });
}

test("server query ids bind feedback to the visitor and trusted response snapshot", async () => {
  const appRuntime = runtime();
  const visitor = { scope: "visitor-a" };
  const { payload } = await handleRecommendRequest({ input: "霞怎么出装？" }, appRuntime, { visitor });
  assert.match(payload.queryId, /^[0-9a-f-]{36}$/u);
  assert.equal(appRuntime.cacheStore.getQueryEvent(payload.queryId).visitorScope, "visitor-a");

  const result = await handleFeedbackRequest({
    queryId: payload.queryId,
    target: "recommendation",
    cardIndex: 0,
    rating: "unhelpful",
    reason: "wrong_items",
    recommendation: { title: "forged", stats: { games: 999999999 } }
  }, appRuntime, { visitor });

  assert.equal(result.ok, true);
  assert.equal(result.feedback.payload.recommendation.title, payload.cards[0].title);
  assert.equal(result.feedback.payload.recommendation.stats.games, 1200);
  assert.equal(result.feedback.reason, "wrong_items");
  assert.equal(result.feedback.visitorScope, "visitor-a");

  const duplicate = await handleFeedbackRequest({
    queryId: payload.queryId,
    target: "recommendation",
    cardIndex: 0,
    rating: "helpful"
  }, appRuntime, { visitor });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.feedback.rating, "unhelpful");
});

test("feedback rejects another visitor and invalid recommendation indexes", async () => {
  const appRuntime = runtime();
  const { payload } = await handleRecommendRequest({ input: "霞怎么出装？" }, appRuntime, {
    visitor: { scope: "visitor-a" }
  });
  await assert.rejects(() => handleFeedbackRequest({
    queryId: payload.queryId,
    target: "recommendation",
    cardIndex: 0,
    rating: "helpful"
  }, appRuntime, { visitor: { scope: "visitor-b" } }), (error) => error.statusCode === 404);
  await assert.rejects(() => handleFeedbackRequest({
    queryId: payload.queryId,
    target: "recommendation",
    cardIndex: 9,
    rating: "helpful"
  }, appRuntime, { visitor: { scope: "visitor-a" } }), (error) => error.statusCode === 400);
});

test("SQLite is the final feedback uniqueness authority", async (t) => {
  let store;
  try {
    store = await SQLiteCacheStore.open({ filePath: ":memory:" });
  } catch (error) {
    if (/SQLiteCacheStore requires/u.test(String(error?.message))) {
      t.skip("SQLite driver is unavailable in this Node runtime");
      return;
    }
    throw error;
  }
  store.addQueryEvent({ queryId: "query-1", runId: "run-1", visitorScope: "visitor-a", input: "fixture" });
  assert.equal(store.getQueryEvent("query-1").runId, "run-1");
  const options = {
    feedbackId: "query-1:recommendation:0",
    queryId: "query-1",
    visitorScope: "visitor-a",
    feedbackTarget: "recommendation",
    rating: "helpful",
    cardIndex: 0
  };
  const first = store.addFeedbackEvent("good_recommendation", { input: "fixture" }, options);
  const second = store.addFeedbackEvent("bad_recommendation", { input: "forged" }, options);
  assert.equal(first.duplicate, undefined);
  assert.equal(second.duplicate, true);
  assert.equal(store.listFeedbackEvents({ limit: 10 }).length, 1);
});

test("SQLite migrates legacy JSON feedback IDs without losing duplicate history", async (t) => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    t.skip("node:sqlite is unavailable in this Node runtime");
    return;
  }
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE feedback_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feedback_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
    INSERT INTO feedback_events (feedback_type, payload_json, created_at)
    VALUES
      ('good_recommendation', '{"feedbackId":"duplicate-id"}', '2026-01-01T00:00:00.000Z'),
      ('bad_recommendation', '{"feedbackId":"duplicate-id"}', '2026-01-02T00:00:00.000Z'),
      ('entity_correction', '{}', '2026-01-03T00:00:00.000Z');
  `);
  const store = new SQLiteCacheStore({ database });
  const events = store.listFeedbackEvents({ limit: 10 });
  assert.equal(events.length, 3);
  assert.equal(new Set(events.map((event) => event.feedbackId)).size, 3);
  assert.equal(events.every((event) => Boolean(event.feedbackId)), true);
  assert.equal(store.findFeedbackEventByFeedbackId("duplicate-id")?.id, 1);
  database.close();
});

test("feedback rate limiting is enforced separately for a visitor", () => {
  const service = new AnonymousAccessService({
    enabled: true,
    secret: "x".repeat(32),
    feedbackVisitorPerMinute: 2,
    feedbackIpPerMinute: 10,
    now: () => 1_000
  });
  const visitor = { visitorHash: "visitor", ipHash: "ip" };
  service.enforceFeedbackRate(visitor);
  service.enforceFeedbackRate(visitor);
  assert.throws(() => service.enforceFeedbackRate(visitor), (error) => error.statusCode === 429);
});

test("feedback stats aggregate trusted fields without exposing individual visitors", async () => {
  const appRuntime = runtime();
  const now = new Date().toISOString();
  appRuntime.cacheStore.addFeedbackEvent("good_recommendation", {
    resultType: "unit_build_rankings",
    query: { unit: "TFT17_Xayah", patch: "17.7" },
    cache: { hit: true, stale: false },
    llm: { used: true, model: "fixture-model" }
  }, {
    feedbackId: "stats-1",
    feedbackTarget: "recommendation",
    rating: "helpful",
    createdAt: now
  });
  appRuntime.cacheStore.addFeedbackEvent("bad_explanation", {
    resultType: "unit_build_rankings",
    query: { unit: "TFT17_Xayah", patch: "17.7" },
    cache: { hit: false, stale: true }
  }, {
    feedbackId: "stats-2",
    feedbackTarget: "explanation",
    rating: "unhelpful",
    reason: "answer_unclear",
    createdAt: now
  });

  const result = await handleFeedbackStatsRequest(appRuntime, { days: 30 });
  assert.equal(result.stats.total, 2);
  assert.equal(result.stats.helpfulRate, 0.5);
  assert.equal(result.stats.targets.recommendation, 1);
  assert.equal(result.stats.reasons.answer_unclear, 1);
  assert.equal(result.stats.units.TFT17_Xayah, 2);
  assert.equal(result.stats.patches["17.7"], 2);
  assert.equal(result.stats.llm.used, 1);
  assert.equal(result.stats.cache.stale, 1);
  assert.equal(JSON.stringify(result).includes("visitorScope"), false);
});
