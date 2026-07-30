import test from "node:test";
import assert from "node:assert/strict";

import {
  createConversationState,
  createTaskFrame,
  createTurnDelta,
  interpretTurn
} from "../src/index.js";
import { tftConversationPolicy } from "../src/domain/tft/conversation-policy.js";
import { createPhase3EvaluationCatalog } from "../eval/datasets/entity-linking-phase3-cases.mjs";

function reference(rawText, expectedType) {
  return { rawText, expectedType, resolvedId: null, confidence: 0.9 };
}

test("Turn Interpreter links entity and constraint operation values before reduction", async () => {
  const response = await interpretTurn({
    currentMessage: "change the current subject and exclude an item",
    conversationState: createConversationState({
      activeTask: {
        taskFrame: createTaskFrame({
          action: "recommend",
          goal: "unit_build_rankings",
          subjects: [{
            rawText: "霞",
            expectedType: "champion",
            resolvedId: "TFT17_Xayah",
            confidence: 1
          }],
          confidence: 1,
          understandingStatus: "understood_and_supported"
        }),
        legacyIntent: "unit_build_rankings"
      }
    }),
    catalog: createPhase3EvaluationCatalog(),
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => ({
      turnDelta: createTurnDelta({
        dialogueAct: "modify",
        taskRelation: "modify",
        entityOperations: [{
          operation: "replace",
          field: "subjects",
          oldValue: [reference("霞", "champion")],
          value: [reference("卡莎", "champion")]
        }],
        constraintOperations: [{
          operation: "add",
          field: "excludedItems",
          value: [reference("无尽之刃", "item")]
        }],
        confidence: 0.9
      })
    })
  });

  assert.equal(
    response.turnDelta.entityOperations[0].oldValue[0].resolvedId,
    "TFT17_Xayah"
  );
  assert.equal(
    response.turnDelta.entityOperations[0].value[0].resolvedId,
    "TFT17_Kaisa"
  );
  assert.equal(
    response.turnDelta.constraintOperations[0].value[0].resolvedId,
    "TFT_Item_InfinityEdge"
  );
});

test("Turn Interpreter rejects provider failure into an unknown delta when deterministic semantics are absent", async () => {
  const response = await interpretTurn({
    currentMessage: "elliptical",
    conversationState: createConversationState(),
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => {
      throw new Error("provider unavailable");
    },
    semanticTaskParser: async () => ({
      taskFrame: createTaskFrame({
        action: "unknown",
        goal: "unknown",
        confidence: 0,
        understandingStatus: "ambiguous"
      })
    })
  });

  assert.equal(response.turnDelta.taskRelation, "unknown");
  assert.equal(response.turnDelta.dialogueAct, "unknown");
  assert.equal(response.telemetry.providerFallback.used, true);
  assert.equal(response.telemetry.providerFallback.reason, "provider_error");
});

test("Turn Interpreter never substitutes a full task parser for a contextual turn after provider failure", async () => {
  let fallbackParserCalls = 0;
  const activeFrame = createTaskFrame({
    action: "recommend",
    goal: "recommend_best_option",
    concepts: [reference("active concept", "game_concept")],
    confidence: 0.95,
    understandingStatus: "understood_and_supported"
  });
  const response = await interpretTurn({
    currentMessage: "contextual follow-up",
    conversationState: createConversationState({
      activeTask: {
        taskId: "active-task",
        taskFrame: activeFrame,
        createdAt: null,
        updatedAt: null
      }
    }),
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => {
      throw new Error("provider unavailable");
    },
    semanticTaskParser: async () => {
      fallbackParserCalls += 1;
      return {
        taskFrame: createTaskFrame({
          action: "recommend",
          goal: "recommend_best_option",
          concepts: [reference("task concept", "game_concept")],
          confidence: 0.95,
          understandingStatus: "understood_and_supported"
        })
      };
    }
  });

  assert.equal(fallbackParserCalls, 0);
  assert.equal(response.turnDelta.taskRelation, "unknown");
  assert.equal(response.turnDelta.dialogueAct, "unknown");
  assert.equal(response.telemetry.providerFallback.reason, "provider_error");
});

test("Turn Interpreter permits deterministic task parsing for a context-free first turn after provider failure", async () => {
  let fallbackParserCalls = 0;
  const response = await interpretTurn({
    currentMessage: "self-contained task",
    conversationState: createConversationState(),
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => {
      throw new Error("provider unavailable");
    },
    semanticTaskParser: async () => {
      fallbackParserCalls += 1;
      return {
        taskFrame: createTaskFrame({
          action: "recommend",
          goal: "recommend_best_option",
          concepts: [reference("task concept", "game_concept")],
          confidence: 0.95,
          understandingStatus: "understood_and_supported"
        })
      };
    }
  });

  assert.equal(fallbackParserCalls, 1);
  assert.equal(response.turnDelta.taskRelation, "new");
  assert.equal(response.turnDelta.dialogueAct, "start_task");
  assert.equal(response.turnDelta.explicitTaskFrame.goal, "recommend_best_option");
  assert.equal(response.telemetry.providerFallback.reason, "provider_error");
});

test("Turn Interpreter does not guess a contextual relation after provider failure", async () => {
  const activeFrame = createTaskFrame({
    action: "recommend",
    goal: "unit_build_rankings",
    subjects: [{
      rawText: "霞",
      expectedType: "champion",
      resolvedId: "TFT17_Xayah",
      confidence: 1
    }],
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const response = await interpretTurn({
    currentMessage: "explicit-looking contextual change",
    conversationState: createConversationState({
      activeTask: {
        taskFrame: activeFrame,
        legacyIntent: activeFrame.goal
      }
    }),
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => {
      throw new Error("provider unavailable");
    },
    semanticTaskParser: async () => ({
      taskFrame: createTaskFrame({
        action: "recommend",
        goal: "unit_build_rankings",
        subjects: [{
          rawText: "卡莎",
          expectedType: "champion",
          resolvedId: "TFT17_Kaisa",
          confidence: 1
        }],
        confidence: 1,
        understandingStatus: "understood_and_supported"
      })
    })
  });

  assert.equal(response.turnDelta.taskRelation, "unknown");
  assert.equal(response.turnDelta.ambiguities[0].code, "provider_required_for_contextual_turn");
});
