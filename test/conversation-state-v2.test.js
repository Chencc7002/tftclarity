import test from "node:test";
import assert from "node:assert/strict";
import {
  CONVERSATION_STATE_SCHEMA_VERSION,
  MAX_CONVERSATION_SHOWN_IDS,
  MemoryCacheStore,
  conversationResultStateFromResponse,
  conversationStateSessionKey,
  createConversationState,
  migrateLegacySessionToConversationState,
  validateConversationState
} from "../src/index.js";

test("pending orchestration status does not discard already returned composition evidence", () => {
  const metadata = conversationResultStateFromResponse({
    type: "comp_rankings",
    query: {
      intent: "comp_rankings",
      preferenceConditions: { count: 3 }
    },
    preferenceSearch: {
      returnedCount: 3,
      conditionMatches: 3,
      lowSampleMatches: 0
    },
    rankings: {
      top4Rate: [
        { compId: "comp-a" },
        { compId: "comp-b" },
        { compId: "comp-c" }
      ]
    },
    agentStatus: {
      executionStatus: "pending",
      evidenceStatus: "pending"
    }
  });

  assert.deepEqual(metadata.shownIds, ["comp-a", "comp-b", "comp-c"]);
  assert.equal(metadata.returnedCount, 3);
});

test("entity catalog results persist the visible entity group and source filters", () => {
  const metadata = conversationResultStateFromResponse({
    type: "entity_catalog_results",
    query: { traitFilters: ["TFT17_SpaceGroove"], cost: 3 },
    result: {
      entityType: "unit",
      filters: { cost: 3, traits: ["TFT17_SpaceGroove"] },
      total: 2
    },
    results: [
      { apiName: "TFT17_Ornn", name: "奥恩" },
      { apiName: "TFT17_Samira", name: "莎弥拉" }
    ]
  });

  assert.deepEqual(metadata.shownIds, ["TFT17_Ornn", "TFT17_Samira"]);
  assert.deepEqual(metadata.shownEntities, [
    { apiName: "TFT17_Ornn", name: "奥恩", entityType: "unit" },
    { apiName: "TFT17_Samira", name: "莎弥拉", entityType: "unit" }
  ]);
  assert.deepEqual(metadata.sourceFilters, { cost: 3, traits: ["TFT17_SpaceGroove"] });
  assert.equal(metadata.selectionScope, "current_visible_results");
  assert.equal(metadata.returnedCount, 2);
  assert.equal(metadata.totalCount, 2);
});

test("ConversationState.v2 normalizes bounded result metadata and validates its schema", () => {
  const shownIds = Array.from({ length: MAX_CONVERSATION_SHOWN_IDS + 20 }, (_, index) => `id-${index}`);
  const state = createConversationState({
    lastResult: {
      resultType: "comp_rankings",
      toolName: "comps_rankings",
      shownIds,
      returnedCount: 3,
      totalCount: 120,
      exhausted: false,
      appliedConstraints: { strategy: "reroll" }
    },
    seasonContextId: "set17-live"
  });
  assert.equal(state.schemaVersion, CONVERSATION_STATE_SCHEMA_VERSION);
  assert.equal(state.lastResult.shownIds.length, MAX_CONVERSATION_SHOWN_IDS);
  assert.equal(state.lastResult.shownIds[0], "id-20");
  assert.equal(validateConversationState(state).valid, true);

  const invalid = structuredClone(state);
  invalid.lastResult.returnedCount = -1;
  assert.equal(validateConversationState(invalid).valid, false);

  const invalidPending = createConversationState({
    pendingClarification: {
      reason: "missing_subject",
      expectedFields: ["subjects"],
      candidateTask: { action: "recommend" }
    }
  });
  assert.equal(validateConversationState(invalidPending).valid, false);
});

test("legacy session values migrate to a complete active task without guessing exhaustion", () => {
  const state = migrateLegacySessionToConversationState({
    query: {
      intent: "comp_rankings",
      rankFilter: ["CHALLENGER", "MASTER"],
      preferenceConditions: { strategy: "reroll", reroll: true },
      specialMode: true
    },
    lastResultIds: ["a", "b", "c"],
    updatedAt: "2026-07-26T15:00:00.000Z"
  }, { seasonContextId: "set17-live" });

  assert.equal(state.activeTask.taskFrame.goal, "comp_rankings");
  assert.equal(state.activeTask.taskFrame.constraints.strategy, "reroll");
  assert.deepEqual(state.activeTask.taskFrame.constraints.rank, ["CHALLENGER", "MASTER"]);
  assert.equal(state.lastResult.exhausted, false);
  assert.equal(state.lastResult.totalCount, null);
  assert.equal(validateConversationState(state).valid, true);
});

test("conversation keys, TTL, and clear behavior isolate v2 state", () => {
  let now = 1000;
  const store = new MemoryCacheStore({ now: () => now, ttlMs: { session: 100 } });
  const firstKey = conversationStateSessionKey("conversation-a");
  const secondKey = conversationStateSessionKey("conversation-b");
  store.setSessionState(firstKey, createConversationState({ seasonContextId: "set17-live" }), {
    seasonContextId: "set17-live"
  });
  store.setSessionState(secondKey, createConversationState({ seasonContextId: "set17-live" }), {
    seasonContextId: "set17-live"
  });
  assert.notEqual(store.getSessionState(firstKey, { seasonContextId: "set17-live" }), null);
  store.deleteSessionState(firstKey, { seasonContextId: "set17-live" });
  assert.equal(store.getSessionState(firstKey, { seasonContextId: "set17-live" }), null);
  assert.notEqual(store.getSessionState(secondKey, { seasonContextId: "set17-live" }), null);
  now += 101;
  assert.equal(store.getSessionState(secondKey, { seasonContextId: "set17-live" }), null);
});
