import test from "node:test";
import assert from "node:assert/strict";
import {
  compileExecutionPlan,
  validateExecutionPlan
} from "../src/agent/execution-plan.js";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";
import { ToolRegistry } from "../src/agent/tools/registry.js";
import { planTask } from "../src/agent/task-planner.js";
import {
  classifySemanticDifference,
  createTakeoverDecision
} from "../src/agent/takeover-controller.js";
import { matchTaskCapabilities } from "../src/understanding/capability-matcher.js";
import { resolveConceptCapability } from "../src/understanding/concept-capability-map.js";
import { createTaskFrame } from "../src/understanding/task-frame.js";
import { buildPhase65SemanticGapCases } from "../eval/datasets/semantic-gap-phase65-cases.mjs";
import { buildLiveLlmT3Cases } from "../eval/datasets/live-llm-t3-cases.mjs";
import { defaultFewShotExampleStore } from "../src/understanding/few-shot-example-store.js";
import { normalizeText } from "../src/core/normalizer.js";
import { runPhase65Evaluation } from "../eval/phase65-runner.mjs";

const FAST9_ID = "concept.strategy.fast9_nine_five";

function fast9Frame(overrides = {}) {
  return createTaskFrame({
    action: "recommend",
    concepts: [{
      rawText: "九五",
      expectedType: "game_concept",
      resolvedId: FAST9_ID,
      confidence: 1
    }],
    constraints: { patch: "current", limit: 3 },
    goal: "recommend_best_option",
    expectedOutput: ["recommendation", "composition_candidates", "evidence"],
    confidence: 0.97,
    understandingStatus: "understood_and_supported",
    ...overrides
  });
}

async function correctionFixture(frame = fast9Frame()) {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const capabilityMatch = matchTaskCapabilities(frame, registry);
  const taskPlanning = await planTask(frame, capabilityMatch, { registry });
  const executionPlanning = compileExecutionPlan(
    frame,
    capabilityMatch,
    taskPlanning,
    { registry }
  );
  return { registry, frame, capabilityMatch, taskPlanning, executionPlanning };
}

test("九五 maps to current-patch candidate retrieval, never one hard-coded composition", async () => {
  const { frame, capabilityMatch, taskPlanning, executionPlanning } = await correctionFixture();
  const mapping = resolveConceptCapability(frame);
  assert.equal(mapping.conceptId, FAST9_ID);
  assert.equal(mapping.tool, "comps_rankings");
  assert.equal(mapping.resultPolicy.neverResolveToSingleComp, true);
  assert.equal("compId" in mapping, false);
  assert.equal(capabilityMatch.selected[0].tool, "semantic_search");
  assert.equal(taskPlanning.validation.valid, true);
  assert.equal(executionPlanning.validation.valid, true);
  assert.equal(executionPlanning.plan.route, "semantic_correction");
  assert.deepEqual(
    executionPlanning.plan.steps.map((step) => step.tool),
    ["comps_rankings"]
  );
  assert.equal(executionPlanning.plan.steps[0].arguments.patch, "current");
  assert.equal(executionPlanning.plan.resultPolicy.type, "filter_by_strategy");
  assert.equal(
    executionPlanning.plan.finalEvidenceContract.collectionPath,
    "rankings.top4Rate"
  );
});

test("ExecutionPlan validator rejects arbitrary or non-read-only tool execution", async () => {
  const { registry, executionPlanning } = await correctionFixture();
  const arbitrary = structuredClone(executionPlanning.plan);
  arbitrary.steps[0].tool = "shell";
  const arbitraryValidation = validateExecutionPlan(arbitrary, { registry });
  assert.equal(arbitraryValidation.valid, false);
  assert.ok(arbitraryValidation.errors.some((error) => error.includes("not registered")));

  const definitions = createStructuredToolDefinitions();
  definitions.push({
    ...definitions[0],
    name: "mutating_tool",
    readOnly: false,
    sideEffect: "write",
    requiresApproval: true
  });
  const unsafeRegistry = new ToolRegistry(definitions);
  const unsafe = structuredClone(executionPlanning.plan);
  unsafe.steps[0].tool = "mutating_tool";
  unsafe.steps[0].evidenceContract.type = unsafeRegistry.get("mutating_tool").evidenceType;
  const unsafeValidation = validateExecutionPlan(unsafe, { registry: unsafeRegistry });
  assert.equal(unsafeValidation.valid, false);
  assert.ok(unsafeValidation.errors.some((error) => error.includes("first-party read-only")));
});

test("classifySemanticDifference distinguishes all five semantic difference classes", async () => {
  const fixture = await correctionFixture();
  const base = {
    taskFrame: fixture.frame,
    clarificationPolicy: { needsClarification: false },
    capabilityMatch: fixture.capabilityMatch,
    taskPlanning: fixture.taskPlanning,
    executionPlanning: fixture.executionPlanning,
    legacyTools: ["comps_rankings"]
  };
  assert.equal(classifySemanticDifference({
    ...base,
    shadowDifference: {
      legacy: { action: "rank", needsClarification: true },
      actionChanged: true,
      clarificationChanged: true
    }
  }).kind, "trusted_correction");

  const equivalentPlanning = structuredClone(fixture.executionPlanning);
  equivalentPlanning.plan.route = "legacy_equivalent";
  equivalentPlanning.plan.conceptMapping = null;
  assert.equal(classifySemanticDifference({
    ...base,
    executionPlanning: equivalentPlanning,
    shadowDifference: {}
  }).kind, "equivalent");

  assert.equal(classifySemanticDifference({
    ...base,
    shadowDifference: {},
    legacyEntities: [{
      expectedType: "game_concept",
      resolvedId: "concept.strategy.reroll"
    }]
  }).kind, "entity_conflict");

  assert.equal(classifySemanticDifference({
    ...base,
    taskFrame: fast9Frame({ confidence: 0.4 }),
    shadowDifference: {}
  }).kind, "low_confidence");

  assert.equal(classifySemanticDifference({
    ...base,
    shadowDifference: { actionChanged: true, legacy: { action: "rank" } }
  }).kind, "new_capability");
});

test("legacy unsupported can route through semantic_correction only after every contract passes", async () => {
  const fixture = await correctionFixture();
  const input = {
    taskFrame: fixture.frame,
    clarificationPolicy: { needsClarification: false },
    capabilityMatch: fixture.capabilityMatch,
    taskPlanning: fixture.taskPlanning,
    executionPlanning: fixture.executionPlanning,
    shadowDifference: {
      legacy: { action: "rank", needsClarification: true },
      actionChanged: true,
      clarificationChanged: true
    },
    legacyTools: ["comps_rankings"],
    requestKey: "fast9-core"
  };
  const correction = createTakeoverDecision(input);
  assert.equal(correction.route, "semantic_correction");
  assert.equal(correction.executionPath, "semantic_correction");
  assert.equal(correction.semanticDifference.kind, "trusted_correction");

  const invalidExecution = structuredClone(fixture.executionPlanning);
  invalidExecution.validation.valid = false;
  const fallback = createTakeoverDecision({
    ...input,
    executionPlanning: invalidExecution
  });
  assert.equal(fallback.route, "legacy_fallback");
  assert.equal(fallback.semanticDifference.kind, "new_capability");
});

test("phase 6.5 and T3 datasets meet size, category, uniqueness and few-shot isolation requirements", () => {
  const gaps = buildPhase65SemanticGapCases();
  assert.ok(gaps.length >= 100);
  assert.equal(new Set(gaps.map((entry) => entry.id)).size, gaps.length);
  assert.equal(new Set(gaps.map((entry) => entry.input)).size, gaps.length);

  const t3 = buildLiveLlmT3Cases();
  assert.ok(t3.length >= 100 && t3.length <= 300);
  assert.equal(t3.length, 120);
  assert.equal(new Set(t3.map((entry) => entry.id)).size, t3.length);
  assert.equal(new Set(t3.map((entry) => normalizeText(entry.input))).size, t3.length);
  const categoryCounts = Object.groupBy
    ? Object.fromEntries(Object.entries(Object.groupBy(t3, (entry) => entry.category)).map(
      ([category, values]) => [category, values.length]
    ))
    : t3.reduce((counts, entry) => ({
      ...counts,
      [entry.category]: Number(counts[entry.category] ?? 0) + 1
    }), {});
  assert.deepEqual(categoryCounts, {
    slang: 20,
    typo: 20,
    context: 20,
    comparison: 20,
    unknown_entity: 20,
    unsupported: 20
  });
  const fewShotInputs = new Set(
    defaultFewShotExampleStore.examples.map((entry) => normalizeText(entry.input))
  );
  assert.equal(t3.some((entry) => fewShotInputs.has(normalizeText(entry.input))), false);
});

test("phase 6.5 evaluation covers at least 100 semantic gaps with stable safe routing", async () => {
  const report = await runPhase65Evaluation();
  assert.equal(report.passed, true);
  assert.ok(report.metrics.cases >= 100);
  assert.ok(report.metrics.repetitions >= 3);
  assert.equal(report.metrics.arbitraryToolCalls, 0);
  assert.ok(report.metrics.passAtK >= 0.95);
  assert.ok(report.metrics.passPowerK >= 0.9);
});
