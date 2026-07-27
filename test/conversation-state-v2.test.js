import test from "node:test";
import assert from "node:assert/strict";
import {
  CONVERSATION_STATE_SCHEMA_VERSION,
  MAX_CONVERSATION_SHOWN_IDS,
  MemoryCacheStore,
  conversationStateSessionKey,
  createConversationState,
  migrateLegacySessionToConversationState,
  validateConversationState
} from "../src/index.js";

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
