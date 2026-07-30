import test from "node:test";
import assert from "node:assert/strict";
import {
  createConversationState,
  createTaskFrame,
  createTurnDelta,
  reduceConversationState,
  tftConversationPolicy
} from "../src/index.js";

function entity(rawText, expectedType, resolvedId = null) {
  return { rawText, expectedType, resolvedId, confidence: resolvedId ? 1 : null };
}

function compFrame(overrides = {}) {
  return createTaskFrame({
    action: "rank",
    goal: "comp_rankings",
    constraints: { strategy: "reroll", specialMode: true, limit: 3 },
    confidence: 1,
    understandingStatus: "understood_and_supported",
    ...overrides
  });
}

function unitFrame(unit, constraints = {}) {
  return createTaskFrame({
    action: "recommend",
    goal: "unit_build_rankings",
    subjects: [entity(unit, "champion", unit)],
    constraints,
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
}

function activeState(frame, lastResult = null) {
  return createConversationState({
    activeTask: { taskFrame: frame, legacyIntent: frame.goal },
    lastResult
  });
}

test("Context Reducer is deterministic and preserves untouched task fields", () => {
  const state = activeState(compFrame());
  const delta = createTurnDelta({
    dialogueAct: "modify",
    taskRelation: "modify",
    constraintOperations: [{
      operation: "set",
      field: "rank",
      value: ["CHALLENGER", "GRANDMASTER", "MASTER"]
    }],
    confidence: 1
  });
  const input = { state, delta, domainPolicy: tftConversationPolicy };
  const first = reduceConversationState(input);
  const second = reduceConversationState(input);
  assert.deepEqual(first, second);
  assert.equal(first.decision, "execute");
  assert.equal(first.resolvedTaskFrame.constraints.strategy, "reroll");
  assert.deepEqual(first.resolvedTaskFrame.constraints.rank, ["CHALLENGER", "GRANDMASTER", "MASTER"]);
});

test("Context Reducer applies set, add, remove, replace, and clear operations", () => {
  const firstItem = entity("第一件", "item", "item-a");
  const secondItem = entity("第二件", "item", "item-b");
  const thirdItem = entity("第三件", "item", "item-c");
  let state = activeState(unitFrame("unit-a", {
    excludedItems: [firstItem],
    specialMode: true
  }));
  const steps = [
    {
      operation: { operation: "add", field: "excludedItems", value: [secondItem] },
      expected: ["item-a", "item-b"]
    },
    {
      operation: { operation: "remove", field: "excludedItems", value: [firstItem] },
      expected: ["item-b"]
    },
    {
      operation: {
        operation: "replace",
        field: "excludedItems",
        oldValue: [secondItem],
        value: [thirdItem]
      },
      expected: ["item-c"]
    },
    {
      operation: { operation: "set", field: "excludedItems", value: [firstItem] },
      expected: ["item-a"]
    },
    {
      operation: { operation: "clear", field: "excludedItems" },
      expected: []
    }
  ];
  for (const step of steps) {
    const resolution = reduceConversationState({
      state,
      delta: createTurnDelta({
        dialogueAct: "modify",
        taskRelation: "modify",
        constraintOperations: [step.operation],
        confidence: 1
      }),
      domainPolicy: tftConversationPolicy
    });
    assert.equal(resolution.decision, "execute");
    assert.deepEqual(
      (resolution.resolvedTaskFrame.constraints.excludedItems ?? []).map((value) => value.resolvedId),
      step.expected
    );
    state = resolution.nextState;
  }
  const cleared = reduceConversationState({
    state,
    delta: createTurnDelta({
      dialogueAct: "modify",
      taskRelation: "modify",
      constraintOperations: [{ operation: "clear", field: "specialMode" }],
      confidence: 1
    }),
    domainPolicy: tftConversationPolicy
  });
  assert.equal(Object.hasOwn(cleared.resolvedTaskFrame.constraints, "specialMode"), false);
});

test("TFT policy canonicalizes compatibility aliases before execution planning", () => {
  const result = reduceConversationState({
    state: activeState(unitFrame("unit-a")),
    delta: createTurnDelta({
      dialogueAct: "modify",
      taskRelation: "modify",
      constraintOperations: [
        { operation: "set", field: "rankFilter", value: ["MASTER", "GRANDMASTER", "CHALLENGER"] },
        { operation: "set", field: "ownedItems", value: [entity("item", "item", "item-a")] },
        { operation: "set", field: "specialMode", value: true }
      ],
      confidence: 1
    }),
    domainPolicy: tftConversationPolicy
  });

  assert.deepEqual(result.resolvedTaskFrame.constraints.rank, [
    "MASTER",
    "GRANDMASTER",
    "CHALLENGER"
  ]);
  assert.deepEqual(result.resolvedTaskFrame.constraints.lockedItems, [
    entity("item", "item", "item-a")
  ]);
  assert.equal(result.resolvedTaskFrame.constraints.strategy, "reroll");
  assert.equal(Object.hasOwn(result.resolvedTaskFrame.constraints, "rankFilter"), false);
  assert.equal(Object.hasOwn(result.resolvedTaskFrame.constraints, "ownedItems"), false);
  assert.equal(Object.hasOwn(result.resolvedTaskFrame.constraints, "specialMode"), false);
});

test("TFT policy canonicalizes operation-bearing continuations and scalar removals", () => {
  const frame = createTaskFrame({
    action: "rank",
    goal: "comp_rankings",
    constraints: { strategy: "reroll", limit: 3 },
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const result = reduceConversationState({
    state: activeState(frame),
    delta: createTurnDelta({
      dialogueAct: "continue",
      taskRelation: "continue",
      constraintOperations: [{
        operation: "remove",
        field: "strategy",
        value: []
      }],
      confidence: 1
    }),
    domainPolicy: tftConversationPolicy
  });

  assert.equal(result.decision, "execute");
  assert.equal(result.trace.relation, "modify");
  assert.equal(result.trace.dialogueAct, "modify");
  assert.equal(Object.hasOwn(result.resolvedTaskFrame.constraints, "strategy"), false);
  assert.equal(result.resolvedTaskFrame.constraints.limit, 3);
});

test("requesting more from an exhausted result preserves the active task", () => {
  const frame = compFrame();
  const state = activeState(frame, {
    resultType: "comp_rankings",
    toolName: "comps_rankings",
    shownIds: ["a", "b", "c"],
    returnedCount: 3,
    totalCount: 3,
    exhausted: true,
    appliedConstraints: frame.constraints
  });
  const resolution = reduceConversationState({
    state,
    delta: createTurnDelta({
      dialogueAct: "request_more",
      taskRelation: "continue",
      presentation: { pageDirection: "next", avoidSeen: true },
      confidence: 1
    }),
    domainPolicy: tftConversationPolicy
  });
  assert.equal(resolution.decision, "exhausted");
  assert.equal(resolution.resolvedTaskFrame.goal, "comp_rankings");
  assert.equal(resolution.resolvedTaskFrame.constraints.strategy, "reroll");
  assert.deepEqual(resolution.nextState.activeTask, state.activeTask);
});

test("result ordinals resolve against the ordered prior result set", () => {
  const frame = compFrame({ constraints: { limit: 3, reroll: false } });
  const state = activeState(frame, {
    resultType: "comp_rankings",
    toolName: "comps_rankings",
    shownIds: ["comp-a", "comp-b", "comp-c"],
    returnedCount: 3,
    totalCount: 8,
    exhausted: false,
    appliedConstraints: frame.constraints
  });
  const resolution = reduceConversationState({
    state,
    delta: createTurnDelta({
      dialogueAct: "modify",
      taskRelation: "modify",
      constraintOperations: [{
        operation: "add",
        field: "excludedItems",
        value: [entity("暴风大剑", "item", "TFT_Item_BFSword")]
      }],
      presentation: {
        resultReference: { scope: "last_result", ordinal: 2 }
      },
      confidence: 1
    }),
    domainPolicy: tftConversationPolicy
  });

  assert.equal(resolution.decision, "execute");
  assert.deepEqual(resolution.resultReference, {
    scope: "last_result",
    ordinal: 2,
    resultId: "comp-b"
  });
  assert.ok(resolution.inheritedFields.includes("lastResult.shownIds"));
  assert.equal(resolution.resolvedTaskFrame.constraints.comp.resolvedId, "comp-b");
  assert.equal(
    resolution.resolvedTaskFrame.constraints.avoidItemComponents[0].resolvedId,
    "TFT_Item_BFSword"
  );
  assert.equal(
    Object.hasOwn(resolution.resolvedTaskFrame.constraints, "excludedItems"),
    false
  );
});

test("out-of-range result ordinals request clarification instead of guessing", () => {
  const frame = compFrame();
  const resolution = reduceConversationState({
    state: activeState(frame, {
      resultType: "comp_rankings",
      toolName: "comps_rankings",
      shownIds: ["comp-a"],
      returnedCount: 1,
      totalCount: 1,
      exhausted: true,
      appliedConstraints: frame.constraints
    }),
    delta: createTurnDelta({
      dialogueAct: "continue",
      taskRelation: "continue",
      presentation: {
        resultReference: { scope: "last_result", ordinal: 2 }
      },
      confidence: 1
    }),
    domainPolicy: tftConversationPolicy
  });

  assert.equal(resolution.decision, "clarify");
  assert.equal(resolution.nextState.pendingClarification.reason, "result_reference_out_of_range");
});

test("pending clarification is filled, switched, or cancelled without guessing", () => {
  const candidate = createTaskFrame({
    action: "recommend",
    goal: "unit_build_rankings",
    understandingStatus: "understood_and_supported",
    confidence: 0.8
  });
  const state = createConversationState({
    pendingClarification: {
      reason: "missing_required_entity",
      expectedFields: ["subject.champion"],
      candidateTask: { taskFrame: candidate }
    }
  });
  const filled = reduceConversationState({
    state,
    delta: createTurnDelta({
      dialogueAct: "clarify",
      taskRelation: "modify",
      explicitTaskFrame: unitFrame("unit-a"),
      confidence: 1
    }),
    domainPolicy: tftConversationPolicy
  });
  assert.equal(filled.decision, "execute");
  assert.equal(filled.resolvedTaskFrame.subjects[0].resolvedId, "unit-a");
  assert.equal(filled.nextState.pendingClarification, null);

  const cancelled = reduceConversationState({
    state,
    delta: createTurnDelta({
      dialogueAct: "cancel",
      taskRelation: "cancel",
      confidence: 1
    }),
    domainPolicy: tftConversationPolicy
  });
  assert.equal(cancelled.decision, "cancelled");
  assert.equal(cancelled.nextState.pendingClarification, null);
});

test("pending clarification can be completed by a constrained entity operation", () => {
  const candidate = createTaskFrame({
    action: "recommend",
    goal: "unit_build_rankings",
    ambiguities: [{ code: "missing_subject", missingFields: ["subjects"] }],
    understandingStatus: "understood_but_missing_context",
    confidence: 0.4
  });
  const state = createConversationState({
    pendingClarification: {
      reason: "missing_subject",
      expectedFields: ["subjects"],
      candidateTask: { taskFrame: candidate }
    }
  });
  const result = reduceConversationState({
    state,
    delta: createTurnDelta({
      dialogueAct: "modify",
      taskRelation: "modify",
      entityOperations: [{
        operation: "set",
        field: "subjects",
        value: [entity("unit-a", "champion", "unit-a")]
      }],
      confidence: 0.9
    }),
    domainPolicy: tftConversationPolicy
  });

  assert.equal(result.decision, "execute");
  assert.equal(result.resolvedTaskFrame.subjects[0].resolvedId, "unit-a");
  assert.equal(result.resolvedTaskFrame.understandingStatus, "understood_and_supported");
  assert.deepEqual(result.resolvedTaskFrame.ambiguities, []);
  assert.equal(result.nextState.pendingClarification, null);
});

test("switch and return restore the bounded prior task state", () => {
  const first = unitFrame("unit-a", { excludedItems: [entity("旧条件", "item", "item-a")] });
  const second = unitFrame("unit-b");
  const switched = reduceConversationState({
    state: activeState(first, {
      resultType: "unit_build_rankings",
      toolName: "unit_builds",
      shownIds: ["build-a"],
      returnedCount: 1,
      totalCount: 2,
      exhausted: false,
      appliedConstraints: first.constraints
    }),
    delta: createTurnDelta({
      dialogueAct: "switch_task",
      taskRelation: "switch",
      explicitTaskFrame: second,
      confidence: 1
    }),
    domainPolicy: tftConversationPolicy
  });
  assert.equal(switched.decision, "execute");
  assert.equal(switched.nextState.taskHistory.at(-1).taskFrame.subjects[0].resolvedId, "unit-a");

  const returned = reduceConversationState({
    state: switched.nextState,
    delta: createTurnDelta({
      dialogueAct: "switch_task",
      taskRelation: "switch",
      explicitTaskFrame: createTaskFrame({
        action: "recommend",
        goal: "recommend_items",
        subjects: [entity("unit-a", "champion", "unit-a")],
        confidence: 1,
        understandingStatus: "understood_and_supported"
      }),
      confidence: 1
    }),
    domainPolicy: tftConversationPolicy
  });
  assert.equal(returned.decision, "execute");
  assert.equal(returned.trace.relation, "return");
  assert.equal(returned.resolvedTaskFrame.subjects[0].resolvedId, "unit-a");
  assert.equal(returned.resolvedTaskFrame.constraints.excludedItems[0].resolvedId, "item-a");
});

test("a same-family subject switch is normalized to modify and retains task constraints", () => {
  const original = unitFrame("unit-a", {
    rank: ["MASTER"],
    excludedItems: [entity("item-a", "item", "item-a")]
  });
  const replacement = unitFrame("unit-b");
  const result = reduceConversationState({
    state: activeState(original),
    delta: createTurnDelta({
      dialogueAct: "switch_task",
      taskRelation: "switch",
      explicitTaskFrame: replacement,
      confidence: 1
    }),
    domainPolicy: tftConversationPolicy
  });

  assert.equal(result.trace.relation, "modify");
  assert.equal(result.trace.dialogueAct, "modify");
  assert.equal(result.resolvedTaskFrame.subjects[0].resolvedId, "unit-b");
  assert.deepEqual(result.resolvedTaskFrame.constraints.rank, ["MASTER"]);
  assert.equal(result.resolvedTaskFrame.constraints.excludedItems[0].resolvedId, "item-a");
});
