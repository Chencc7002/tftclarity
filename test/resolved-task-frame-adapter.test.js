import test from "node:test";
import assert from "node:assert/strict";

import {
  createTaskFrame,
  resolvedTaskFrameToParsed
} from "../src/index.js";

test("resolved composition tasks preserve non-reroll and low-contest preferences", () => {
  const parsed = resolvedTaskFrameToParsed(createTaskFrame({
    action: "rank",
    goal: "comp_rankings",
    constraints: {
      reroll: false,
      contested: "low",
      sort: "robust_first",
      limit: 3
    },
    confidence: 1,
    understandingStatus: "understood_and_supported"
  }), {
    presentation: { requestedCount: 3 },
    taskRelation: "new",
    dialogueAct: "start_task",
    input: "推荐三套稳定、没那么卷的非赌狗阵容"
  });

  assert.equal(parsed.intent, "comp_rankings");
  assert.equal(parsed.preferenceRequested, true);
  assert.deepEqual(parsed.preferenceConditions, {
    strategy: null,
    reroll: false,
    goal: null,
    contested: "low",
    difficulty: null,
    beginnerFriendly: null,
    count: 3,
    returnAll: false
  });
  assert.equal(parsed.sort, "robust_first");
});

test("resolved ordinal composition targets become focused comp queries", () => {
  const parsed = resolvedTaskFrameToParsed(createTaskFrame({
    action: "rank",
    goal: "comp_rankings",
    constraints: {
      comp: {
        rawText: "result 2",
        expectedType: "composition",
        resolvedId: "comp-b",
        confidence: 1
      },
      avoidItemComponents: [{
        rawText: "大剑",
        expectedType: "item",
        resolvedId: "TFT_Item_BFSword",
        confidence: 1
      }]
    },
    confidence: 1,
    understandingStatus: "understood_and_supported"
  }), {
    presentation: {
      resultReference: { scope: "last_result", ordinal: 2 }
    },
    taskRelation: "modify",
    dialogueAct: "modify"
  });

  assert.equal(parsed.compId, "comp-b");
  assert.deepEqual(parsed.avoidItemComponents, ["TFT_Item_BFSword"]);
});
