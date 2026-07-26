import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AgentRuntime,
  ExecutionPlanExecutor,
  MemoryCacheStore,
  ToolExecutor,
  ToolRegistry,
  compileExecutionPlan,
  createCatalog,
  createStructuredToolDefinitions,
  planExecution,
  recommendForInput,
  validateExecutionPlan
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleRecommendRequest
} from "../src/app/small-window-server.js";
import {
  compareExecutionAndLegacyPlans,
  comparePublicBusinessResults
} from "../src/agent/shadow-comparison.js";
import { createTaskFrame } from "../src/understanding/task-frame.js";
import { matchTaskCapabilities } from "../src/understanding/capability-matcher.js";
import { compileTftToolArguments } from "../src/domain/tft/execution-arguments.js";
import {
  evaluateEntities,
  semanticArgumentsCorrect
} from "../eval/live-llm-t3-runner.mjs";
import { createPhase3EvaluationCatalog } from "../eval/datasets/entity-linking-phase3-cases.mjs";

function recommendationFrame() {
  return createTaskFrame({
    action: "recommend",
    subjects: [{
      rawText: "霞",
      expectedType: "champion",
      resolvedId: "TFT17_Xayah",
      confidence: 1
    }],
    constraints: { patch: "current", minSamples: 100 },
    goal: "recommend_best_option",
    expectedOutput: ["recommendation", "evidence"],
    confidence: 0.99,
    understandingStatus: "understood_and_supported"
  });
}

test("deterministic fast path compiles one semantic ExecutionPlan without invoking a planner", async () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const frame = recommendationFrame();
  const match = matchTaskCapabilities(frame, registry);
  let plannerCalls = 0;
  const planning = await planExecution(frame, match, {
    registry,
    planner: async () => {
      plannerCalls += 1;
      throw new Error("single-tool planning must not invoke a planner");
    }
  });

  assert.equal(planning.validation.valid, true);
  assert.equal(planning.plannerInvoked, false);
  assert.equal(plannerCalls, 0);
  assert.equal(planning.plan.route, "deterministic_fast_path");
  assert.equal(planning.plan.steps.length, 1);
  assert.equal(planning.plan.steps[0].tool, "unit_builds");
  assert.deepEqual(planning.plan.steps[0].arguments, {
    unit: "TFT17_Xayah",
    patch: "current",
    minSamples: 100
  });
});

test("controlled planner and fast path share the same executor with dependency output binding", async () => {
  const events = [];
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const toolExecutor = new ToolExecutor({ registry });
  const executor = new ExecutionPlanExecutor({ registry, toolExecutor });
  const plan = {
    schemaVersion: "execution-plan.v1",
    route: "controlled_planner",
    steps: [{
      id: "details",
      tool: "unit_details",
      arguments: { apiName: "TFT17_Xayah" },
      dependsOn: [],
      evidenceContract: {
        type: "official_unit",
        source: "official_catalog",
        requiredFields: ["source", "updatedAt"]
      }
    }, {
      id: "search",
      tool: "semantic_search",
      arguments: {
        documentTypes: ["entity"],
        patch: "current",
        locale: "zh-CN",
        topK: 3
      },
      dependsOn: ["details"],
      argumentBindings: [{
        argument: "query",
        stepId: "details",
        path: "apiName"
      }],
      evidenceContract: {
        type: "semantic_candidates",
        source: "semantic_index",
        requiredFields: ["source", "updatedAt"]
      }
    }],
    resultPolicy: { type: "identity" },
    finalEvidenceContract: {
      required: true,
      type: "semantic_candidates",
      source: "semantic_index",
      requiredFields: ["source", "updatedAt"],
      allowModelGeneratedStatistics: false
    }
  };
  assert.equal(validateExecutionPlan(plan, { registry }).valid, true);

  const runtime = new AgentRuntime({ onEvent: (event) => events.push(event) });
  const execution = await runtime.run({}, async (run) => executor.execute(plan, {
    run,
    handlers: {
      unit_details: async ({ apiName }) => ({
        apiName,
        updatedAt: "2026-07-24T00:00:00.000Z"
      }),
      semantic_search: async ({ query }) => ({
        query,
        hits: [],
        updatedAt: "2026-07-24T00:00:00.000Z"
      })
    }
  }));

  assert.equal(execution.value.status, "completed");
  assert.equal(execution.value.results[1].toolResult.value.query, "TFT17_Xayah");
  assert.deepEqual(
    execution.value.trace.steps.map((step) => step.status),
    ["completed", "completed"]
  );
  const calls = events.filter((event) => event.type === "tool_call_started");
  assert.deepEqual(calls.map((event) => event.data.executionSource), [
    "execution_plan",
    "execution_plan"
  ]);
  assert.deepEqual(calls.map((event) => event.data.executionStepId), ["details", "search"]);
});

test("ExecutionPlan rejects arbitrary tools, cycles and more than three calls", () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const baseStep = {
    tool: "comps_rankings",
    arguments: { patch: "current" },
    evidenceContract: {
      type: "composition_rankings",
      source: "metatft",
      requiredFields: ["source", "updatedAt"]
    }
  };
  const arbitrary = {
    schemaVersion: "execution-plan.v1",
    route: "controlled_planner",
    steps: [{ ...baseStep, id: "one", tool: "shell", dependsOn: [] }],
    resultPolicy: { type: "identity" }
  };
  assert.equal(validateExecutionPlan(arbitrary, { registry }).valid, false);

  const cyclic = {
    schemaVersion: "execution-plan.v1",
    route: "controlled_planner",
    steps: [
      { ...baseStep, id: "one", dependsOn: ["two"] },
      { ...baseStep, id: "two", dependsOn: ["one"] }
    ],
    resultPolicy: { type: "identity" }
  };
  assert.equal(validateExecutionPlan(cyclic, { registry }).valid, false);

  const oversized = {
    schemaVersion: "execution-plan.v1",
    route: "controlled_planner",
    steps: Array.from({ length: 4 }, (_, index) => ({
      ...baseStep,
      id: `step-${index}`,
      dependsOn: []
    })),
    resultPolicy: { type: "identity" }
  };
  assert.equal(validateExecutionPlan(oversized, { registry }).valid, false);
});

test("executor records stop and degrade failure policies in step state", async () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const executor = new ExecutionPlanExecutor({
    registry,
    toolExecutor: new ToolExecutor({ registry })
  });
  const step = (id, onFailure) => ({
    id,
    tool: "comps_rankings",
    arguments: { patch: "current" },
    dependsOn: [],
    onFailure,
    evidenceContract: {
      type: "composition_rankings",
      source: "metatft",
      requiredFields: ["source", "updatedAt"]
    }
  });
  const plan = (onFailure) => ({
    schemaVersion: "execution-plan.v1",
    route: "controlled_planner",
    steps: [step("first", onFailure), step("second", "stop")],
    resultPolicy: { type: "identity" },
    finalEvidenceContract: {
      required: true,
      type: "composition_rankings",
      source: "metatft",
      requiredFields: ["source", "updatedAt"],
      allowModelGeneratedStatistics: false
    }
  });
  let calls = 0;
  const handlers = {
    comps_rankings: async () => {
      calls += 1;
      if (calls === 1) throw new Error("fixture failure");
      return {
        rankings: [],
        updatedAt: "2026-07-24T00:00:00.000Z"
      };
    }
  };

  const stopped = await executor.execute(plan("stop"), { handlers });
  assert.equal(stopped.status, "failed");
  assert.deepEqual(stopped.trace.steps.map((entry) => entry.status), ["failed", "skipped"]);

  calls = 0;
  const degraded = await executor.execute(plan("degrade"), { handlers });
  assert.equal(degraded.status, "degraded");
  assert.deepEqual(degraded.trace.steps.map((entry) => entry.status), ["failed", "completed"]);
});

test("shadow comparison checks complete parameters rather than tool names alone", () => {
  const comparison = compareExecutionAndLegacyPlans({
    steps: [{
      tool: "unit_builds",
      arguments: { unit: "TFT17_Xayah", patch: "current", minSamples: 100 }
    }]
  }, {
    structuredQueries: [{
      operation: "unit_builds",
      params: { unit: "TFT17_Xayah", patch: "current", minSamples: 50 }
    }]
  }, {
    selectedPath: "execution_plan"
  });

  assert.equal(comparison.toolDifference, false);
  assert.equal(comparison.parameterDifference, true);
  assert.deepEqual(comparison.parameterDifferences.map((entry) => entry.parameter), ["minSamples"]);
});

test("ResultPolicyExecutor filters, sorts and trims the public result from ExecutionPlan", async () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const executor = new ExecutionPlanExecutor({
    registry,
    toolExecutor: new ToolExecutor({ registry })
  });
  const frame = createTaskFrame({
    action: "recommend",
    concepts: [{
      rawText: "九五",
      expectedType: "game_concept",
      resolvedId: "concept.strategy.fast9_nine_five",
      confidence: 1
    }],
    constraints: { patch: "current", limit: 2 },
    goal: "recommend_best_option",
    expectedOutput: ["recommendation", "evidence"],
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const planning = await planExecution(
    frame,
    matchTaskCapabilities(frame, registry),
    { registry }
  );
  const execution = await executor.execute(planning.plan, {
    handlers: {
      comps_rankings: async () => ({
        candidates: [
          {
            compId: "slow",
            strategy: "reroll",
            stats: { games: 900, top4Rate: 0.7, winRate: 0.2, avgPlacement: 3.8 }
          },
          {
            compId: "fast-b",
            strategy: "fast9",
            stats: { games: 400, top4Rate: 0.6, winRate: 0.18, avgPlacement: 4.0 }
          },
          {
            compId: "fast-a",
            strategy: "fast9",
            stats: { games: 500, top4Rate: 0.65, winRate: 0.2, avgPlacement: 3.7 }
          }
        ],
        rankings: {
          top4Rate: [],
          winRate: [],
          winShare: [],
          avgPlacement: [],
          popularity: []
        },
        source: { updatedAt: "2026-07-24T00:00:00.000Z" },
        updatedAt: "2026-07-24T00:00:00.000Z"
      })
    }
  });

  assert.equal(execution.status, "completed");
  assert.equal(execution.resultPolicyExecution.policyType, "filter_by_strategy");
  assert.equal(execution.resultPolicyExecution.matchedCount, 2);
  assert.deepEqual(
    execution.result.rankings.top4Rate.map((entry) => entry.compId),
    ["fast-a", "fast-b"]
  );
  assert.deepEqual(
    execution.result.candidates.map((entry) => entry.compId),
    ["fast-a", "fast-b"]
  );
  assert.equal(execution.evidenceValidation.sufficient, true);
});

test("evidence validation enforces declared fields, type and final contract", async () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const executor = new ExecutionPlanExecutor({
    registry,
    toolExecutor: new ToolExecutor({ registry })
  });
  const frame = recommendationFrame();
  const planning = await planExecution(
    frame,
    matchTaskCapabilities(frame, registry),
    { registry }
  );
  const missingTimestamp = await executor.execute(planning.plan, {
    handlers: { unit_builds: async () => ({ data: [] }) }
  });
  assert.equal(missingTimestamp.status, "failed");
  assert.ok(missingTimestamp.evidenceValidation.errors.some((error) => (
    error.includes("updatedAt")
  )));

  const wrongFinal = structuredClone(planning.plan);
  wrongFinal.finalEvidenceContract = {
    ...wrongFinal.finalEvidenceContract,
    requiredFields: ["missingBusinessField"]
  };
  const missingBusinessField = await executor.execute(wrongFinal, {
    handlers: {
      unit_builds: async () => ({
        data: [],
        updatedAt: "2026-07-24T00:00:00.000Z"
      })
    }
  });
  assert.equal(missingBusinessField.status, "failed");
  assert.ok(missingBusinessField.evidenceValidation.finalErrors.some((error) => (
    error.includes("missingBusinessField")
  )));
});

test("public result equivalence compares cards, rankings, evidence, clarification and answer", () => {
  const baseline = {
    type: "comp_rankings",
    cards: [{ id: "a", title: "A" }],
    rankings: { top4Rate: [{ compId: "a" }] },
    evidence: [{ source: "metatft" }],
    clarification: null,
    answer: { status: "completed", text: "A" }
  };
  assert.equal(comparePublicBusinessResults(baseline, structuredClone(baseline)).equivalent, true);
  for (const field of ["cards", "rankings", "evidence", "clarification", "answer"]) {
    const changed = structuredClone(baseline);
    changed[field] = field === "clarification" ? { question: "?" } : { changed: true };
    const comparison = comparePublicBusinessResults(changed, baseline);
    assert.equal(comparison.equivalent, false, field);
    assert.ok(comparison.fieldDifferences.includes(field));
  }
});

test("a missing legacy RetrievalPlan does not block a valid sovereign ExecutionPlan", async () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const toolExecutor = new ToolExecutor({ registry });
  const executionPlanExecutor = new ExecutionPlanExecutor({ registry, toolExecutor });
  const result = await recommendForInput("霞怎么出装？", {
    catalog: createCatalog(),
    useSession: false,
    executionPlanSovereignty: true,
    toolRegistry: registry,
    toolExecutor,
    executionPlanExecutor,
    retrievalPlanner: {
      plan() {
        throw new Error("legacy planner unavailable");
      }
    },
    metaTFTClient: {
      async getUnitBuilds() {
        return {
          data: [],
          capture: { capturedAt: "2026-07-24T00:00:00.000Z" }
        };
      }
    }
  });

  assert.equal(result.retrievalPlan, null);
  assert.equal(result.agentRouting.route, "semantic");
  assert.equal(result.agentRouting.executionPath, "deterministic_fast_path");
  assert.equal(result.executionTrace.source, "execution_plan");
});

test("production request traces real Runtime stages and sources the tool call from ExecutionPlan", async () => {
  const events = [];
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const toolExecutor = new ToolExecutor({ registry });
  const baseExecutionPlanExecutor = new ExecutionPlanExecutor({ registry, toolExecutor });
  let executedPlan = null;
  const executionPlanExecutor = {
    registry,
    async execute(plan, options) {
      executedPlan = structuredClone(plan);
      return baseExecutionPlanExecutor.execute(plan, options);
    }
  };
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    agentRunEvent: (event) => events.push(event),
    toolRegistry: registry,
    toolExecutor,
    executionPlanExecutor,
    metaTFTClient: {
      async getUnitBuilds() {
        return {
          data: [{
            unit_builds: "TFT17_Xayah&TFT_Item_RapidFireCannon|TFT_Item_RunaansHurricane|TFT_Item_RunaansHurricane",
            placement_count: [300, 250, 220, 180, 120, 90, 60, 30]
          }],
          capture: { capturedAt: "2026-07-24T00:00:00.000Z" }
        };
      }
    },
    compsClient: {}
  });

  const response = await handleRecommendRequest({
    input: "霞怎么出装？",
    conversationId: "phase66-runtime",
    preferences: { minSamples: 100 }
  }, runtime);

  assert.equal(response.statusCode, 200);
  const completedStages = events
    .filter((event) => event.type === "stage_completed" && event.data.status !== "failed")
    .map((event) => event.stage);
  for (const stage of ["resolving", "planning", "retrieving", "responding"]) {
    assert.ok(completedStages.includes(stage), `missing real stage: ${stage}`);
  }
  const call = events.find((event) => event.type === "tool_call_started");
  assert.equal(call.data.executionSource, "execution_plan");
  assert.equal(call.data.executionStepId, "execute");
  assert.ok(events.some((event) => event.type === "execution_plan_completed"));
  const semanticEvent = events.find((event) => event.type === "semantic_shadow_completed");
  assert.equal(semanticEvent?.data?.taskPlan, null);
  assert.equal(response.payload.run.toolCallCount, 1);
  assert.equal(executedPlan.route, "deterministic_fast_path");
  assert.deepEqual(executedPlan.steps[0].arguments, {
    unit: "TFT17_Xayah",
    days: 3,
    patch: "current",
    queue: "1100",
    rank: ["CHALLENGER", "DIAMOND", "EMERALD", "GRANDMASTER", "MASTER", "PLATINUM"],
    starLevel: [2],
    itemCount: 3,
    traitFilters: [],
    comp: null,
    itemPolicy: "ordinary_only",
    itemCategories: [],
    lockedItems: [],
    excludedItems: [],
    comparisonItems: [],
    minSamples: 100
  });
});

test("generic Agent and parser layers contain no named TFT business instances", () => {
  const genericFiles = [
    "../src/understanding/semantic-task-parser.js",
    "../src/understanding/domain-gate.js",
    "../src/understanding/entity-mention-extractor.js",
    "../src/understanding/concept-resolver.js",
    "../src/understanding/few-shot-example-store.js",
    "../src/llm/chat-semantic-task-provider.js",
    "../src/agent/execution-plan.js",
    "../src/agent/execution-plan-executor.js",
    "../src/agent/result-policy-executor.js",
    "../src/agent/takeover-controller.js",
    "../src/core/recommendation-service.js"
  ];
  const namedInstances = /fast9|九五|速九|霞|剑圣|劍聖|羊刀|巨杀|巨殺|无尽|無盡|TFT17_|TFT_Item_/iu;
  for (const file of genericFiles) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, namedInstances, file);
  }
});

test("ExecutionPlan and TFT query adapters keep entity arguments stable and unique", async () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const frame = createTaskFrame({
    action: "compare",
    subjects: [{
      rawText: "target",
      expectedType: "champion",
      resolvedId: "TFT17_Xayah",
      confidence: 1
    }],
    candidates: [
      {
        rawText: "item-a",
        expectedType: "item",
        resolvedId: "TFT_Item_GuinsoosRageblade",
        confidence: 1
      },
      {
        rawText: "item-b",
        expectedType: "item",
        resolvedId: "TFT_Item_Artifact_TitanicHydra",
        confidence: 1
      }
    ],
    concepts: [{
      rawText: "item-a-again",
      expectedType: "item",
      resolvedId: "TFT_Item_GuinsoosRageblade",
      confidence: 1
    }],
    goal: "choose_best",
    expectedOutput: ["comparison", "evidence"],
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const planning = await planExecution(
    frame,
    matchTaskCapabilities(frame, registry),
    { registry }
  );

  assert.deepEqual(planning.plan.steps[0].arguments.comparisonItems, [
    "TFT_Item_GuinsoosRageblade",
    "TFT_Item_Artifact_TitanicHydra"
  ]);
  assert.deepEqual(compileTftToolArguments("unit_builds", {
    unit: "TFT17_Xayah",
    comparisonItems: [
      "TFT_Item_GuinsoosRageblade",
      "TFT_Item_Artifact_TitanicHydra",
      "TFT_Item_GuinsoosRageblade"
    ],
    lockedItems: ["TFT_Item_GuinsoosRageblade", "TFT_Item_GuinsoosRageblade"]
  }), {
    unit: "TFT17_Xayah",
    lockedItems: ["TFT_Item_GuinsoosRageblade"],
    comparisonItems: [
      "TFT_Item_GuinsoosRageblade",
      "TFT_Item_Artifact_TitanicHydra"
    ]
  });
});

test("T3 complete-argument evaluation rejects duplicate, missing and extra item arguments", () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const catalog = createPhase3EvaluationCatalog();
  const frame = createTaskFrame({
    action: "compare",
    subjects: [{
      rawText: "霞",
      expectedType: "champion",
      resolvedId: "TFT17_Xayah",
      confidence: 1
    }],
    candidates: [
      {
        rawText: "羊刀",
        expectedType: "item",
        resolvedId: "TFT_Item_GuinsoosRageblade",
        confidence: 1
      },
      {
        rawText: "巨九",
        expectedType: "item",
        resolvedId: "TFT_Item_Artifact_TitanicHydra",
        confidence: 1
      }
    ],
    goal: "choose_best",
    expectedOutput: ["comparison", "evidence"],
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const testCase = {
    category: "comparison",
    expected: { entityMentions: ["霞", "羊刀", "巨九"] }
  };
  const planning = (comparisonItems) => ({
    validation: { valid: true },
    plan: {
      steps: [{
        tool: "unit_builds",
        arguments: {
          unit: "TFT17_Xayah",
          comparisonItems
        }
      }]
    }
  });

  assert.equal(semanticArgumentsCorrect(
    frame,
    planning(["TFT_Item_GuinsoosRageblade", "TFT_Item_Artifact_TitanicHydra"]),
    registry,
    testCase,
    catalog
  ), true);
  for (const invalid of [
    ["TFT_Item_GuinsoosRageblade"],
    [
      "TFT_Item_GuinsoosRageblade",
      "TFT_Item_Artifact_TitanicHydra",
      "TFT_Item_GuinsoosRageblade"
    ],
    [
      "TFT_Item_GuinsoosRageblade",
      "TFT_Item_Artifact_TitanicHydra",
      "TFT_Item_InfinityEdge"
    ]
  ]) {
    assert.equal(semanticArgumentsCorrect(
      frame,
      planning(invalid),
      registry,
      testCase,
      catalog
    ), false);
  }
});

test("T3 entity evaluation validates exact patch IDs without false negatives", () => {
  const catalog = createPhase3EvaluationCatalog();
  const frame = createTaskFrame({
    action: "compare",
    candidates: [
      {
        rawText: "霞",
        expectedType: "champion",
        resolvedId: "TFT17_Xayah",
        confidence: 1
      },
      {
        rawText: "17.4",
        expectedType: "patch",
        resolvedId: "patch.17.4",
        confidence: 1
      }
    ],
    goal: "compare_versions",
    confidence: 1,
    understandingStatus: "understood_but_unsupported"
  });
  const evaluation = evaluateEntities(frame, {
    category: "unsupported",
    expected: { entityMentions: ["霞", "17.4"] }
  }, catalog);

  assert.equal(evaluation.mentionRecall, 1);
  assert.equal(evaluation.top1Accuracy, 1);
});
