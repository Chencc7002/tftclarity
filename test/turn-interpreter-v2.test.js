import test from "node:test";
import assert from "node:assert/strict";

import {
  compactConversationStateForInterpreter,
  createCatalog,
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

test("explicit champion Artifact rankings override a malformed provider frame", async () => {
  let providerCalls = 0;
  const catalog = createCatalog({
    units: [{
      apiName: "DA_18_Ahri",
      zhName: "阿狸",
      aliases: ["阿狸", "Ahri"],
      current: true
    }]
  });
  const response = await interpretTurn({
    currentMessage: "阿狸神器排行",
    conversationState: createConversationState({ seasonContextId: "set18-pbe" }),
    seasonContextId: "set18-pbe",
    catalog,
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => {
      providerCalls += 1;
      return createTurnDelta({
      dialogueAct: "start_task",
      taskRelation: "new",
      explicitTaskFrame: createTaskFrame({
        action: "rank",
        goal: "rank_emblem_carriers",
        candidates: [reference("阿狸", "champion")],
        constraints: { comparisonItems: [reference("神器", "item")] },
        confidence: 0.9,
        understandingStatus: "understood_and_supported"
      }),
      confidence: 0.9
      });
    }
  });

  const frame = response.turnDelta.explicitTaskFrame;
  assert.equal(frame.goal, "unit_item_rankings");
  assert.equal(frame.subjects[0].resolvedId, "DA_18_Ahri");
  assert.equal(frame.constraints.itemPolicy, "include_artifact");
  assert.deepEqual(frame.constraints.itemCategories, ["artifact"]);
  assert.deepEqual(frame.constraints.comparisonItems ?? [], []);
  assert.equal(providerCalls, 0);
  assert.equal(response.telemetry.providerCalled, false);
});

test("action-only build follow-up reuses only a current visible unit result group", async () => {
  let providerCalls = 0;
  const response = await interpretTurn({
    currentMessage: "怎么出装？",
    conversationState: createConversationState({
      seasonContextId: "set17-live",
      activeTask: {
        taskFrame: createTaskFrame({
          action: "search",
          concepts: [{
            rawText: "太空律动",
            expectedType: "trait",
            resolvedId: "TFT17_SpaceGroove",
            confidence: 1
          }],
          constraints: { cost: 3, targetEntityType: "champion", relation: "member_of_trait" },
          goal: "find_relevant_data",
          capabilityRequirements: ["entity_catalog_filtering"],
          confidence: 1,
          understandingStatus: "understood_and_supported"
        })
      },
      lastResult: {
        resultType: "entity_catalog_results",
        toolName: "entity_catalog_query",
        shownIds: ["TFT17_Ornn", "TFT17_Samira"],
        shownEntities: [
          { apiName: "TFT17_Ornn", name: "奥恩", entityType: "unit" },
          { apiName: "TFT17_Samira", name: "莎弥拉", entityType: "unit" }
        ],
        entityType: "unit",
        returnedCount: 2,
        totalCount: 2,
        exhausted: true,
        appliedConstraints: { cost: 3 },
        sourceFilters: { cost: 3, traits: ["TFT17_SpaceGroove"] },
        selectionScope: "current_visible_results"
      }
    }),
    seasonContextId: "set17-live",
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => {
      providerCalls += 1;
      return createTurnDelta({ dialogueAct: "continue", taskRelation: "continue", confidence: 0.95 });
    }
  });

  assert.equal(providerCalls, 1);
  assert.equal(response.turnDelta.taskRelation, "modify");
  assert.equal(response.turnDelta.explicitTaskFrame.goal, "recommend_builds_for_candidate_group");
  assert.deepEqual(
    response.turnDelta.explicitTaskFrame.candidates.map((entity) => entity.resolvedId),
    ["TFT17_Ornn", "TFT17_Samira"]
  );
  assert.deepEqual(response.turnDelta.explicitTaskFrame.capabilityRequirements, ["unit_build_statistics"]);
});

test("action-only build wording without a visible unit result group still requires context", async () => {
  const response = await interpretTurn({
    currentMessage: "怎么出装？",
    conversationState: createConversationState({ seasonContextId: "set17-live" }),
    seasonContextId: "set17-live",
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => createTurnDelta({
      dialogueAct: "unknown",
      taskRelation: "unknown",
      confidence: 0.2,
      ambiguities: [{ code: "missing_subject", affectsToolSelection: true }]
    })
  });

  assert.equal(response.turnDelta.taskRelation, "new");
  assert.equal(response.turnDelta.explicitTaskFrame?.goal, "unit_build_rankings");
  assert.equal(
    response.turnDelta.explicitTaskFrame?.understandingStatus,
    "understood_but_missing_context"
  );
  assert.equal(response.turnDelta.explicitTaskFrame?.candidates.length ?? 0, 0);
  assert.equal(response.turnDelta.explicitTaskFrame?.ambiguities[0]?.code, "missing_subject");
  assert.equal(response.telemetry.providerFallback.reason, "action_only_build_followup_policy");
});

test("Turn Interpreter supplies ordered shown result ids for ordinal references", () => {
  const state = createConversationState({
    lastResult: {
      resultType: "comp_rankings",
      toolName: "comps_rankings",
      shownIds: ["comp-a", "comp-b", "comp-c"],
      returnedCount: 3,
      totalCount: 8,
      exhausted: false,
      appliedConstraints: {}
    }
  });

  assert.deepEqual(
    compactConversationStateForInterpreter(state).lastResultSummary.shownIds,
    ["comp-a", "comp-b", "comp-c"]
  );
});

test("explicit ordinal follow-ups override a provider's mistaken new-task relation", async () => {
  const activeFrame = createTaskFrame({
    action: "rank",
    goal: "comp_rankings",
    constraints: {
      reroll: false,
      limit: 3
    },
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const response = await interpretTurn({
    currentMessage: "第二套不用大剑的话怎么办？",
    conversationState: createConversationState({
      activeTask: {
        taskFrame: activeFrame,
        legacyIntent: "comp_rankings"
      },
      lastResult: {
        resultType: "comp_rankings",
        toolName: "comps_rankings",
        shownIds: ["comp-a", "comp-b", "comp-c"],
        returnedCount: 3,
        totalCount: 8,
        exhausted: false,
        appliedConstraints: activeFrame.constraints
      }
    }),
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => ({
      turnDelta: createTurnDelta({
        dialogueAct: "start_task",
        taskRelation: "new",
        explicitTaskFrame: createTaskFrame({
          action: "rank",
          goal: "comp_rankings",
          constraints: {
            excludedItems: [reference("大剑", "item")]
          },
          confidence: 0.9,
          understandingStatus: "understood_and_supported"
        }),
        confidence: 0.9
      })
    })
  });

  assert.equal(response.turnDelta.taskRelation, "modify");
  assert.equal(response.turnDelta.dialogueAct, "modify");
  assert.deepEqual(response.turnDelta.presentation.resultReference, {
    scope: "last_result",
    ordinal: 2
  });
});

test("explicit equipment exclusion wording cannot be inverted into removing the restriction", async () => {
  const sword = reference("大剑", "item");
  const response = await interpretTurn({
    currentMessage: "第二套不用大剑的话怎么办？",
    conversationState: createConversationState({
      activeTask: {
        taskFrame: createTaskFrame({
          action: "rank",
          goal: "comp_rankings",
          constraints: { avoidItemComponents: ["TFT_Item_BFSword"] },
          confidence: 1,
          understandingStatus: "understood_and_supported"
        }),
        legacyIntent: "comp_rankings"
      },
      lastResult: {
        resultType: "comp_rankings",
        toolName: "comps_rankings",
        shownIds: ["comp-a", "comp-b", "comp-c"],
        returnedCount: 3,
        totalCount: 3,
        exhausted: true,
        appliedConstraints: {}
      }
    }),
    catalog: createPhase3EvaluationCatalog(),
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => ({
      turnDelta: createTurnDelta({
        dialogueAct: "modify",
        taskRelation: "modify",
        constraintOperations: [{
          operation: "remove",
          field: "avoidItemComponents",
          value: [sword]
        }],
        confidence: 0.9
      })
    })
  });

  assert.equal(response.turnDelta.constraintOperations[0].operation, "add");
  assert.equal(response.turnDelta.constraintOperations[0].field, "excludedItems");
  assert.equal(
    response.turnDelta.constraintOperations[0].value[0].rawText,
    "大剑"
  );
});

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

test("Turn Interpreter recovers a self-contained first task when the provider returns unknown", async () => {
  const response = await interpretTurn({
    currentMessage: "观星者四费卡中谁的主流出装表现最好？",
    conversationState: createConversationState(),
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => createTurnDelta({
      dialogueAct: "unknown",
      taskRelation: "unknown",
      confidence: 0,
      ambiguities: [{ code: "provider_uncertain", affectsToolSelection: true }]
    }),
    semanticTaskParser: async () => ({
      taskFrame: createTaskFrame({
        domain: "tft",
        action: "search",
        concepts: [reference("观星者", "trait")],
        constraints: { cost: 4, targetEntityType: "champion" },
        goal: "compare_filtered_unit_builds",
        capabilityRequirements: ["entity_catalog_filtering", "unit_build_statistics"],
        confidence: 0.98,
        understandingStatus: "understood_and_supported"
      })
    })
  });

  assert.equal(response.turnDelta.taskRelation, "new");
  assert.equal(response.turnDelta.dialogueAct, "start_task");
  assert.equal(response.turnDelta.explicitTaskFrame.goal, "compare_filtered_unit_builds");
  assert.equal(response.telemetry.providerFallback.reason, "self_contained_task_recovery");
});

test("Turn Interpreter replaces a weak unresolved first-turn frame with strong deterministic semantics", async () => {
  const response = await interpretTurn({
    currentMessage: "观星者四费卡中谁的主流出装表现最好？",
    conversationState: createConversationState(),
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => createTurnDelta({
      dialogueAct: "start_task",
      taskRelation: "new",
      explicitTaskFrame: createTaskFrame({
        domain: "tft",
        action: "compare",
        subjects: [{
          rawText: "观星者四费卡",
          expectedType: "champion",
          resolvedId: null,
          confidence: 0.4
        }],
        goal: "compare_items",
        confidence: 0.5,
        understandingStatus: "understood_and_supported"
      }),
      confidence: 0.9
    }),
    semanticTaskParser: async () => ({
      taskFrame: createTaskFrame({
        domain: "tft",
        action: "search",
        concepts: [reference("观星者", "trait")],
        constraints: { cost: 4, targetEntityType: "champion" },
        goal: "compare_filtered_unit_builds",
        capabilityRequirements: ["entity_catalog_filtering", "unit_build_statistics"],
        confidence: 0.98,
        understandingStatus: "understood_and_supported"
      })
    })
  });

  assert.equal(response.turnDelta.explicitTaskFrame.goal, "compare_filtered_unit_builds");
  assert.equal(response.turnDelta.explicitTaskFrame.constraints.cost, 4);
  assert.equal(response.telemetry.providerFallback.reason, "self_contained_task_recovery");
});

test("Turn Interpreter recovers material contextual semantics from an empty provider continuation", async () => {
  const trait = {
    rawText: "木灵族",
    expectedType: "trait",
    resolvedId: "TFT17_Woodling",
    canonicalName: "木灵族",
    confidence: 1
  };
  const activeFrame = createTaskFrame({
    action: "explain",
    concepts: [trait],
    constraints: { traitFilters: ["TFT17_Woodling"] },
    goal: "trait_details",
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  let fallbackConversation = null;
  const response = await interpretTurn({
    currentMessage: "这个羁绊有哪些四费棋子，怎么出装",
    conversationState: createConversationState({
      activeTask: {
        taskFrame: activeFrame,
        legacyIntent: "trait_details"
      }
    }),
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => createTurnDelta({
      dialogueAct: "continue",
      taskRelation: "continue",
      confidence: 0.95
    }),
    semanticTaskParser: async (_input, options) => {
      fallbackConversation = options.conversation;
      return {
        taskFrame: createTaskFrame({
          action: "search",
          concepts: [trait],
          constraints: {
            traitFilters: ["TFT17_Woodling"],
            cost: 4,
            targetEntityType: "champion",
            relation: "member_of_trait",
            current: true
          },
          goal: "find_relevant_data",
          capabilityRequirements: [
            "entity_catalog_filtering",
            "unit_build_statistics"
          ],
          confidence: 0.94,
          understandingStatus: "understood_and_supported"
        })
      };
    }
  });

  assert.equal(fallbackConversation.length, 1);
  assert.equal(fallbackConversation[0].taskFrame.goal, "trait_details");
  assert.equal(response.turnDelta.taskRelation, "modify");
  assert.equal(response.turnDelta.dialogueAct, "modify");
  assert.equal(response.turnDelta.explicitTaskFrame.constraints.cost, 4);
  assert.deepEqual(response.turnDelta.explicitTaskFrame.capabilityRequirements, [
    "entity_catalog_filtering",
    "unit_build_statistics"
  ]);
  assert.equal(response.telemetry.providerFallback.reason, "contextual_task_recovery");
});

test("Turn Interpreter corrects a valid but materially incomplete contextual frame", async () => {
  const trait = {
    rawText: "木灵族",
    expectedType: "trait",
    resolvedId: "TFT17_Woodling",
    confidence: 1
  };
  const activeFrame = createTaskFrame({
    action: "explain",
    concepts: [trait],
    constraints: { traitFilters: ["TFT17_Woodling"] },
    goal: "trait_details",
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const recoveredFrame = createTaskFrame({
    action: "search",
    concepts: [trait],
    constraints: {
      traitFilters: ["TFT17_Woodling"],
      cost: 4,
      targetEntityType: "champion",
      relation: "member_of_trait"
    },
    goal: "compare_entity_build_performance",
    capabilityRequirements: ["entity_catalog_filtering", "unit_build_statistics"],
    confidence: 0.95,
    understandingStatus: "understood_and_supported"
  });
  const response = await interpretTurn({
    currentMessage: "这个羁绊有哪些四费棋子，怎么出装",
    conversationState: createConversationState({
      activeTask: { taskFrame: activeFrame, legacyIntent: "trait_details" }
    }),
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => ({
      turnDelta: createTurnDelta({
        dialogueAct: "modify",
        taskRelation: "modify",
        explicitTaskFrame: createTaskFrame({
          action: "search",
          concepts: [{ ...trait, resolvedId: null }],
          goal: "trait_details",
          expectedOutput: ["four_cost_champions", "item_builds"],
          confidence: 0.9,
          understandingStatus: "understood_and_supported"
        }),
        confidence: 0.9
      }),
      usage: { uncachedInputTokens: 20, outputTokens: 30 }
    }),
    semanticTaskParser: async () => ({ taskFrame: recoveredFrame })
  });

  assert.equal(response.telemetry.providerSucceeded, true);
  assert.equal(response.telemetry.providerFallback.reason, "contextual_task_recovery");
  assert.equal(response.telemetry.providerFallback.trigger, "incomplete_contextual_semantics");
  assert.equal(response.turnDelta.explicitTaskFrame.constraints.cost, 4);
  assert.deepEqual(response.turnDelta.explicitTaskFrame.capabilityRequirements, [
    "entity_catalog_filtering",
    "unit_build_statistics"
  ]);
});

test("contextual recovery preserves a resolved base trait when the catalog has multiple breakpoints", async () => {
  const catalog = createCatalog({
    units: [],
    items: [],
    traits: [1, 2, 3, 4].map((tier) => ({
      apiName: "TFT17_Astronaut",
      filterId: `TFT17_Astronaut_${tier}`,
      zhName: `${[3, 5, 7, 10][tier - 1]}木灵族`,
      displayName: `${[3, 5, 7, 10][tier - 1]}木灵族`,
      aliases: ["木灵族", "木灵"],
      current: true
    }))
  });
  const activeFrame = createTaskFrame({
    action: "explain",
    concepts: [{
      rawText: "木灵族",
      expectedType: "trait",
      resolvedId: "TFT17_Astronaut",
      canonicalName: "木灵族",
      confidence: 1
    }],
    constraints: { traitFilters: ["TFT17_Astronaut"] },
    goal: "trait_details",
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const response = await interpretTurn({
    currentMessage: "这个羁绊有哪些四费棋子，怎么出装",
    conversationState: createConversationState({
      activeTask: { taskFrame: activeFrame, legacyIntent: "trait_details" }
    }),
    catalog,
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => ({
      turnDelta: createTurnDelta({
        dialogueAct: "continue",
        taskRelation: "continue",
        confidence: 0.95
      }),
      usage: { cachedInputTokens: 5, uncachedInputTokens: 10, outputTokens: 20 }
    })
  });

  assert.equal(response.turnDelta.explicitTaskFrame.concepts[0].resolvedId, "TFT17_Astronaut");
  assert.deepEqual(response.turnDelta.explicitTaskFrame.constraints.traitFilters, ["TFT17_Astronaut"]);
  assert.equal(response.telemetry.providerCalled, true);
  assert.equal(response.telemetry.providerSucceeded, true);
  assert.deepEqual(response.telemetry.providerUsage, {
    cachedInputTokens: 5,
    uncachedInputTokens: 10,
    outputTokens: 20
  });
});

test("Turn Interpreter treats a self-contained task as new when only a stale clarification is pending", async () => {
  let fallbackParserCalls = 0;
  const response = await interpretTurn({
    currentMessage: "查询凯尔最稳三件装备",
    conversationState: createConversationState({
      pendingClarification: {
        reason: "turn_relation_uncertain",
        attempts: 1,
        question: "请补充关键信息"
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
          goal: "unit_build_rankings",
          subjects: [{
            rawText: "凯尔",
            expectedType: "champion",
            resolvedId: "DA_18_Kayle",
            confidence: 1
          }],
          confidence: 1,
          understandingStatus: "understood_and_supported"
        })
      };
    }
  });

  assert.equal(fallbackParserCalls, 0);
  assert.equal(response.turnDelta.taskRelation, "new");
  assert.equal(response.turnDelta.explicitTaskFrame.subjects[0].rawText, "凯尔");
});

test("Turn Interpreter replaces an active task for an explicit self-contained query", async () => {
  let parserCalls = 0;
  const response = await interpretTurn({
    currentMessage: "当前版本阵容趋势",
    conversationState: createConversationState({
      activeTask: {
        taskId: "old-unit-task",
        taskFrame: createTaskFrame({
          action: "rank",
          goal: "unit_build_rankings",
          subjects: [reference("凯尔", "champion")],
          confidence: 1,
          understandingStatus: "understood_and_supported"
        })
      }
    }),
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => ({
      turnDelta: createTurnDelta({
        dialogueAct: "continue",
        taskRelation: "continue",
        confidence: 0.8
      })
    }),
    semanticTaskParser: async () => {
      parserCalls += 1;
      return {
        taskFrame: createTaskFrame({
          action: "analyze",
          goal: "comp_trends",
          confidence: 1,
          understandingStatus: "understood_and_supported"
        })
      };
    }
  });

  assert.equal(parserCalls, 0);
  assert.equal(response.turnDelta.taskRelation, "new");
  assert.equal(response.turnDelta.explicitTaskFrame.goal, "comp_trends");
});

test("explicit champion build wording starts the same deterministic task across seasons", async () => {
  const response = await interpretTurn({
    currentMessage: "查询阿狸当前版本最稳三件装备",
    conversationState: createConversationState(),
    domainPolicy: tftConversationPolicy,
    semanticProvider: async () => ({
      turnDelta: createTurnDelta({
        dialogueAct: "unknown",
        taskRelation: "unknown",
        confidence: 0
      })
    }),
    entityLinking: false
  });

  assert.equal(response.turnDelta.taskRelation, "new");
  assert.equal(response.turnDelta.explicitTaskFrame.goal, "unit_build_rankings");
  assert.equal(response.turnDelta.explicitTaskFrame.subjects[0].rawText, "阿狸");
  assert.equal(response.turnDelta.explicitTaskFrame.constraints.itemCount, 3);
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
