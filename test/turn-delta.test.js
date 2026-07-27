import test from "node:test";
import assert from "node:assert/strict";
import {
  createTaskFrame,
  createTurnDelta,
  tftConversationPolicy,
  validateTurnDelta
} from "../src/index.js";

function frame() {
  return createTaskFrame({
    action: "rank",
    goal: "comp_rankings",
    constraints: { strategy: "reroll" },
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
}

test("TurnDelta.v1 accepts constrained task changes and presentation metadata", () => {
  const delta = createTurnDelta({
    dialogueAct: "modify",
    taskRelation: "modify",
    explicitTaskFrame: frame(),
    constraintOperations: [{
      operation: "set",
      field: "rank",
      value: ["CHALLENGER", "MASTER"]
    }],
    presentation: { requestedCount: 3, pageDirection: "next", avoidSeen: true },
    confidence: 0.98
  });
  assert.equal(validateTurnDelta(delta, { domainPolicy: tftConversationPolicy }).valid, true);
  assert.equal(Object.hasOwn(delta, "toolName"), false);
  assert.equal(Object.hasOwn(delta, "arguments"), false);
});

test("TurnDelta.v1 rejects illegal operations, fields, and domain values", () => {
  const illegalOperation = createTurnDelta({
    dialogueAct: "modify",
    taskRelation: "modify",
    constraintOperations: [{ operation: "execute", field: "rank", value: ["MASTER"] }]
  });
  assert.equal(validateTurnDelta(illegalOperation, { domainPolicy: tftConversationPolicy }).valid, false);

  const illegalField = createTurnDelta({
    dialogueAct: "modify",
    taskRelation: "modify",
    constraintOperations: [{ operation: "set", field: "sql", value: "select *" }]
  });
  assert.equal(validateTurnDelta(illegalField, { domainPolicy: tftConversationPolicy }).valid, false);

  const illegalValue = createTurnDelta({
    dialogueAct: "modify",
    taskRelation: "modify",
    constraintOperations: [{ operation: "set", field: "rank", value: ["SECRET_RANK"] }]
  });
  assert.equal(validateTurnDelta(illegalValue, { domainPolicy: tftConversationPolicy }).valid, false);

  const toolLeak = {
    ...createTurnDelta({
      dialogueAct: "continue",
      taskRelation: "continue",
      confidence: 1
    }),
    tool: "unit_builds"
  };
  assert.equal(validateTurnDelta(toolLeak, { domainPolicy: tftConversationPolicy }).valid, false);

  const operationLeak = createTurnDelta({
    dialogueAct: "modify",
    taskRelation: "modify",
    constraintOperations: [{ operation: "clear", field: "strategy" }],
    confidence: 1
  });
  operationLeak.constraintOperations[0].arguments = { strategy: "reroll" };
  assert.equal(validateTurnDelta(operationLeak, { domainPolicy: tftConversationPolicy }).valid, false);
});
