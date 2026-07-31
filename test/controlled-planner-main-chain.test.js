import test from "node:test";
import assert from "node:assert/strict";
import {
  ToolRegistry,
  createStructuredToolDefinitions,
  createTaskFrame,
  createTftControlledPlannerProvider,
  matchTaskCapabilities,
  planExecution
} from "../src/index.js";

test("composite catalog plus build task invokes the bounded controlled planner", async () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const frame = createTaskFrame({
    action: "search",
    concepts: [{ rawText: "木灵", expectedType: "trait", resolvedId: "TFT17_Woodling", confidence: 1 }],
    constraints: { targetEntityType: "champion", cost: 4, relation: "member_of_trait" },
    goal: "compare_entity_build_performance",
    expectedOutput: ["results", "ranking", "evidence"],
    capabilityRequirements: ["entity_catalog_filtering", "unit_build_statistics"],
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const match = matchTaskCapabilities(frame, registry);
  assert.equal(match.mode, "composite");
  assert.deepEqual(match.selected.map((entry) => entry.tool), ["entity_catalog_query", "unit_builds_batch"]);
  const planning = await planExecution(frame, match, {
    registry,
    planner: createTftControlledPlannerProvider(),
    budget: { maxSteps: 3, maxToolCalls: 3, maxPlanTokens: 1200 }
  });
  assert.equal(planning.plannerInvoked, true);
  assert.equal(planning.validation.valid, true, planning.validation.errors.join("; "));
  assert.equal(planning.plan.steps.length, 2);
  assert.deepEqual(planning.plan.steps[1].argumentBindings, [{
    argument: "entities",
    stepId: "find-entities",
    path: "results"
  }]);
});

test("invalid LLM planner output is recorded and replaced by the validated deterministic fallback", async () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const frame = createTaskFrame({
    action: "search",
    concepts: [{ rawText: "木灵", expectedType: "trait", resolvedId: "TFT17_Woodling", confidence: 1 }],
    constraints: { targetEntityType: "champion", cost: 4, relation: "member_of_trait" },
    goal: "compare_entity_build_performance",
    expectedOutput: ["results", "ranking", "evidence"],
    capabilityRequirements: ["entity_catalog_filtering", "unit_build_statistics"],
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const match = matchTaskCapabilities(frame, registry);
  const llmPlanner = async () => ({
    executionPlan: {
      schemaVersion: "execution-plan.v1",
      route: "controlled_planner",
      steps: [{ id: "unsafe", tool: "invented_tool", arguments: {} }]
    },
    telemetry: { durationMs: 12, usage: { uncachedInputTokens: 10, outputTokens: 5 } }
  });
  llmPlanner.plannerKind = "llm";
  llmPlanner.model = "planner-test-model";

  const planning = await planExecution(frame, match, {
    registry,
    planner: llmPlanner,
    plannerFallback: createTftControlledPlannerProvider(),
    budget: { maxSteps: 3, maxToolCalls: 3, maxPlanTokens: 1200 }
  });

  assert.equal(planning.validation.valid, true);
  assert.deepEqual(planning.plan.steps.map((step) => step.tool), [
    "entity_catalog_query",
    "unit_builds_batch"
  ]);
  assert.equal(planning.plannerInvocation.attempted, true);
  assert.equal(planning.plannerInvocation.llm, true);
  assert.equal(planning.plannerInvocation.model, "planner-test-model");
  assert.equal(planning.plannerInvocation.succeeded, true);
  assert.equal(planning.plannerInvocation.accepted, false);
  assert.equal(planning.plannerInvocation.corrected, true);
  assert.equal(planning.plannerInvocation.correctionReason, "invalid_execution_plan");
  assert.equal(planning.plannerInvocation.durationMs, 12);
  assert.deepEqual(planning.plannerInvocation.usage, { uncachedInputTokens: 10, outputTokens: 5 });
  assert.equal(planning.plannerInvocation.validationErrors.some((error) => error.includes("invented_tool")), true);
});
