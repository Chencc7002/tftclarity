import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MemoryCacheStore,
  createCatalog,
  createTaskFrame,
  createTurnDelta,
  recommendForInput
} from "../src/index.js";

const PAGE_FIXTURE = JSON.parse(readFileSync(
  new URL("./fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url),
  "utf8"
));

function queuedInterpreter(deltas) {
  let index = 0;
  return async () => ({
    schemaVersion: "turn-interpreter.v1",
    turnDelta: deltas[index++],
    telemetry: { provider: "injected", providerFallback: null },
    messages: []
  });
}

test("a follow-up ordinal focuses the selected composition and keeps item adaptation scoped", async () => {
  const cacheStore = new MemoryCacheStore();
  const firstFrame = createTaskFrame({
    action: "rank",
    goal: "comp_rankings",
    constraints: { limit: 3 },
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const turnInterpreter = queuedInterpreter([
    createTurnDelta({
      dialogueAct: "start_task",
      taskRelation: "new",
      explicitTaskFrame: firstFrame,
      presentation: { requestedCount: 3 },
      confidence: 1
    }),
    createTurnDelta({
      dialogueAct: "modify",
      taskRelation: "modify",
      constraintOperations: [{
        operation: "add",
        field: "excludedItems",
        value: [{
          rawText: "大剑",
          expectedType: "item",
          resolvedId: "TFT_Item_BFSword",
          confidence: 1
        }]
      }],
      presentation: {
        resultReference: { scope: "last_result", ordinal: 2 }
      },
      confidence: 1
    })
  ]);
  const options = {
    cacheStore,
    sessionKey: "ordinal-focus-v2",
    catalog: createCatalog(),
    compResponse: PAGE_FIXTURE,
    preferences: { minSamples: 0, rankFilter: [] },
    conversationStateV2Mode: "on",
    semanticShadow: false,
    turnInterpreter
  };

  const first = await recommendForInput("推荐三套阵容", options);
  const secondId = first.conversationState.lastResult.shownIds[1];
  assert.ok(secondId);

  const second = await recommendForInput("第二套不用大剑的话怎么办？", options);
  const returnedIds = [
    ...new Set(Object.values(second.rankings ?? {}).flat().map((entry) => entry.compId))
  ];

  assert.equal(second.conversation.resolution.resultReference.resultId, secondId);
  assert.equal(second.query.compId, secondId);
  assert.deepEqual(second.query.avoidItemComponents, ["TFT_Item_BFSword"]);
  assert.deepEqual(returnedIds, [secondId]);
  assert.equal(
    Object.hasOwn(second.conversation.resolution.resolvedTaskFrame.constraints, "excludedItems"),
    false
  );
});
