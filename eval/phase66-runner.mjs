import { ExecutionPlanExecutor } from "../src/agent/execution-plan-executor.js";
import { planExecution, validateExecutionPlan } from "../src/agent/execution-plan.js";
import { ToolExecutor } from "../src/agent/tools/executor.js";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";
import { ToolRegistry } from "../src/agent/tools/registry.js";
import { createTaskFrame } from "../src/understanding/task-frame.js";
import { matchTaskCapabilities } from "../src/understanding/capability-matcher.js";
import { planTask } from "../src/legacy/task-planner.js";
import { buildPhase6TakeoverCases } from "./datasets/takeover-phase6-cases.mjs";
import { comparePublicBusinessResults } from "../src/agent/shadow-comparison.js";
import { parseSemanticTask } from "../src/understanding/semantic-task-parser.js";
import { createCatalog } from "../src/data/static-data.js";
import { normalizeText } from "../src/core/normalizer.js";
import { defaultFewShotExampleStore } from "../src/understanding/few-shot-example-store.js";
import { buildLiveLlmT3Cases } from "./datasets/live-llm-t3-cases.mjs";
import {
  PHASE661_HOLDOUT_DATASET_VERSION,
  buildPhase661HoldoutCases
} from "./datasets/phase661-holdout-cases.mjs";

export const PHASE66_EVALUATION_VERSION = "architecture-convergence-phase66.v2";

function semanticArgumentsCorrect(testCase, plan) {
  const step = plan?.steps?.[0];
  if (!step) return false;
  const schemaKeys = new Set(Object.keys(step.arguments));
  for (const [key, value] of Object.entries(testCase.taskFrame.constraints ?? {})) {
    if (key === "trend") continue;
    if (!schemaKeys.has(key)) return false;
    if (JSON.stringify(step.arguments[key]) !== JSON.stringify(value)) return false;
  }
  const champion = testCase.taskFrame.subjects
    .find((entity) => entity.expectedType === "champion");
  if (step.tool === "unit_builds" && champion && step.arguments.unit !== champion.resolvedId) {
    return false;
  }
  return true;
}

function unsupportedFrames() {
  return [
    createTaskFrame({
      domain: "tft",
      action: "find_video",
      goal: "find_strategy_video",
      expectedOutput: ["video_candidates"],
      confidence: 0.99,
      understandingStatus: "understood_and_supported"
    }),
    createTaskFrame({
      domain: "tft",
      action: "unknown",
      goal: "understand_request",
      confidence: 0.99,
      understandingStatus: "understood_and_supported"
    }),
    createTaskFrame({
      domain: "out_of_domain",
      action: "unknown",
      goal: "understand_request",
      confidence: 0.99,
      understandingStatus: "out_of_domain"
    })
  ];
}

function publicBusinessFixture(testCase, argumentsValue) {
  const updatedAt = "2026-07-24T00:00:00.000Z";
  return {
    type: testCase.legacyIntent,
    cards: [{
      id: testCase.id,
      title: testCase.action,
      query: structuredClone(argumentsValue)
    }],
    rankings: null,
    references: [],
    evidence: [{
      type: "structured",
      source: "fixture",
      updatedAt
    }],
    source: {
      provider: "fixture",
      updatedAt
    },
    clarification: null,
    answer: {
      status: "completed",
      text: `${testCase.action}:${testCase.expectedTool}`,
      evidenceValidation: { sufficient: true }
    },
    warnings: [],
    updatedAt
  };
}

async function evaluateNaturalLanguageHoldout(registry) {
  const cases = buildPhase661HoldoutCases();
  const catalog = createCatalog();
  const exclusions = new Set([
    ...defaultFewShotExampleStore.examples.map((entry) => normalizeText(entry.input)),
    ...buildLiveLlmT3Cases().map((entry) => normalizeText(entry.input))
  ]);
  const normalizedInputs = cases.map((entry) => normalizeText(entry.input));
  const unique = new Set(normalizedInputs).size === cases.length;
  const isolated = normalizedInputs.every((input) => !exclusions.has(input));
  const results = [];
  for (const testCase of cases) {
    const parsed = await parseSemanticTask(testCase.input, {
      catalog,
      budget: {
        maxInputTokens: 100000,
        maxOutputTokens: 100000,
        maxLatencyMs: 45000
      }
    });
    const match = matchTaskCapabilities(parsed.taskFrame, registry);
    const planning = await planExecution(parsed.taskFrame, match, { registry });
    const actualTool = planning.plan?.steps?.[0]?.tool ?? null;
    results.push({
      id: testCase.id,
      category: testCase.category,
      input: testCase.input,
      expectedAction: testCase.expectedAction,
      actualAction: parsed.taskFrame.action,
      expectedTool: testCase.expectedTool,
      actualTool,
      capabilityRequirements: parsed.taskFrame.capabilityRequirements,
      actionCorrect: parsed.taskFrame.action === testCase.expectedAction,
      toolCorrect: actualTool === testCase.expectedTool
    });
  }
  return {
    datasetVersion: PHASE661_HOLDOUT_DATASET_VERSION,
    cases: cases.length,
    unique,
    isolated,
    actionAccuracy: results.filter((entry) => entry.actionCorrect).length / results.length,
    toolAccuracy: results.filter((entry) => entry.toolCorrect).length / results.length,
    unsupportedHonestDowngradeRate: results
      .filter((entry) => entry.category === "unsupported")
      .filter((entry) => entry.actualTool === null).length
      / results.filter((entry) => entry.category === "unsupported").length,
    results
  };
}

export async function runPhase66Evaluation() {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const events = [];
  const toolExecutor = new ToolExecutor({ registry, onEvent: (event) => events.push(event) });
  const executor = new ExecutionPlanExecutor({ registry, toolExecutor });
  const cases = buildPhase6TakeoverCases();
  const results = [];

  for (const testCase of cases) {
    const match = matchTaskCapabilities(testCase.taskFrame, registry);
    const planning = await planExecution(testCase.taskFrame, match, { registry });
    const legacyPlanning = await planTask(testCase.taskFrame, match, { registry });
    let execution = null;
    if (planning.plan) {
      execution = await executor.execute(planning.plan, {
        handlers: Object.fromEntries(planning.plan.steps.map((step) => [
          step.tool,
          async (argumentsValue) => publicBusinessFixture(testCase, argumentsValue)
        ]))
      });
    }
    const executionArguments = planning.plan?.steps?.[0]?.arguments ?? null;
    const legacyArguments = legacyPlanning.plan?.steps?.[0]?.arguments ?? null;
    const legacyPublicResult = publicBusinessFixture(testCase, legacyArguments);
    const publicComparison = comparePublicBusinessResults(
      execution?.result,
      legacyPublicResult
    );
    results.push({
      id: testCase.id,
      expectedTool: testCase.expectedTool,
      actualTool: planning.plan?.steps?.[0]?.tool ?? null,
      planValid: planning.validation?.valid === true,
      route: planning.plan?.route ?? null,
      stepCount: planning.plan?.steps?.length ?? 0,
      argumentsCorrect: semanticArgumentsCorrect(testCase, planning.plan),
      executionSource: execution?.trace?.source ?? null,
      executionStatus: execution?.status ?? null,
      parameterSemanticEquivalent: JSON.stringify(executionArguments)
        === JSON.stringify(legacyArguments),
      publicResultEquivalent: publicComparison.equivalent,
      publicResultDifferences: publicComparison.fieldDifferences
    });
  }

  const unsupported = [];
  for (const frame of unsupportedFrames()) {
    const match = matchTaskCapabilities(frame, registry);
    const planning = await planExecution(frame, match, { registry });
    unsupported.push({
      capabilityStatus: match.status,
      plan: planning.plan
    });
  }

  const maliciousPlans = [
    {
      schemaVersion: "execution-plan.v1",
      route: "controlled_planner",
      steps: [{
        id: "execute",
        tool: "shell",
        arguments: {},
        dependsOn: [],
        evidenceContract: { type: "unknown", source: "local", requiredFields: ["source"] }
      }],
      resultPolicy: { type: "identity" }
    },
    {
      schemaVersion: "execution-plan.v1",
      route: "controlled_planner",
      steps: [{
        id: "execute",
        tool: "semantic_search",
        arguments: { query: "x", url: "https://example.com" },
        dependsOn: [],
        evidenceContract: {
          type: "semantic_candidates",
          source: "semantic_index",
          requiredFields: ["source"]
        }
      }],
      resultPolicy: { type: "identity" }
    },
    {
      schemaVersion: "execution-plan.v1",
      route: "controlled_planner",
      steps: [{
        id: "execute",
        tool: "comps_rankings",
        arguments: { sql: "select * from players" },
        dependsOn: [],
        evidenceContract: {
          type: "composition_rankings",
          source: "metatft",
          requiredFields: ["source"]
        }
      }],
      resultPolicy: { type: "identity" }
    }
  ];
  const securityRejections = maliciousPlans.filter((plan) => (
    !validateExecutionPlan(plan, { registry }).valid
  )).length;
  const holdout = await evaluateNaturalLanguageHoldout(registry);

  const metrics = {
    cases: results.length,
    supportedPlanRate: results.filter((result) => result.planValid).length / results.length,
    toolNameAccuracy: results.filter((result) => (
      result.actualTool === result.expectedTool
    )).length / results.length,
    argumentSemanticAccuracy: results.filter((result) => result.argumentsCorrect).length / results.length,
    averageSteps: results.reduce((sum, result) => sum + result.stepCount, 0) / results.length,
    maxSteps: Math.max(...results.map((result) => result.stepCount)),
    wrongToolCallRate: results.filter((result) => (
      result.actualTool !== result.expectedTool
    )).length / results.length,
    executionPlanSourceRate: results.filter((result) => (
      result.executionSource === "execution_plan"
      && result.executionStatus === "completed"
    )).length / results.length,
    parameterSemanticEquivalenceRate: results.filter((result) => (
      result.parameterSemanticEquivalent
    )).length / results.length,
    publicResultEquivalenceRate: results.filter((result) => (
      result.publicResultEquivalent
    )).length / results.length,
    unsupportedHonestDowngradeRate: unsupported.filter((entry) => (
      entry.capabilityStatus !== "understood_and_supported" && entry.plan === null
    )).length / unsupported.length,
    securityRejections,
    securityCases: maliciousPlans.length,
    maximumToolCalls: 3,
    holdoutCases: holdout.cases,
    holdoutActionAccuracy: holdout.actionAccuracy,
    holdoutToolAccuracy: holdout.toolAccuracy,
    holdoutUnsupportedHonestDowngradeRate: holdout.unsupportedHonestDowngradeRate
  };
  const gates = {
    allSupportedTasksPlanned: metrics.supportedPlanRate === 1,
    toolNameAccuracy: metrics.toolNameAccuracy >= 0.99,
    argumentSemanticAccuracy: metrics.argumentSemanticAccuracy >= 0.98,
    singleToolAverageOneStep: metrics.averageSteps === 1,
    maximumThreeSteps: metrics.maxSteps <= 3,
    wrongToolCalls: metrics.wrongToolCallRate < 0.01,
    executionPlanSovereignty: metrics.executionPlanSourceRate === 1,
    parameterSemanticEquivalence: metrics.parameterSemanticEquivalenceRate >= 0.99,
    publicResultEquivalence: metrics.publicResultEquivalenceRate >= 0.99,
    unsupportedHonestDowngrade: metrics.unsupportedHonestDowngradeRate === 1,
    securityBoundary: metrics.securityRejections === metrics.securityCases,
    independentHoldout: holdout.cases >= 30
      && holdout.unique
      && holdout.isolated
      && holdout.actionAccuracy >= 0.95
      && holdout.toolAccuracy >= 0.95
      && holdout.unsupportedHonestDowngradeRate === 1
  };
  return {
    schemaVersion: "phase66-evaluation-report.v1",
    evaluationVersion: PHASE66_EVALUATION_VERSION,
    datasetVersion: "semantic-takeover-phase6.v1",
    evidenceLevels: {
      publicResultEquivalence: "deterministic_public_projection_fixture",
      productionResultEquivalence: "runtime_shadow_comparison_test"
    },
    passed: Object.values(gates).every(Boolean),
    gates,
    metrics,
    results,
    unsupported,
    holdout
  };
}
