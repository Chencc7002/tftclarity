import { performance } from "node:perf_hooks";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";
import { ToolRegistry } from "../src/agent/tools/registry.js";
import { planExecution } from "../src/agent/execution-plan.js";
import {
  DEFAULT_PHASE6_ROLLOUT_POLICY,
  TAKEOVER_ACTION_ORDER,
  createTakeoverDecision,
  finalizeTakeoverTrace,
  validateTakeoverPolicy
} from "../src/agent/takeover-controller.js";
import { matchTaskCapabilities } from "../src/understanding/capability-matcher.js";
import { compareSemanticShadow } from "../src/understanding/semantic-shadow.js";
import {
  buildPhase6TakeoverCases,
  PHASE6_TAKEOVER_DATASET_VERSION
} from "./datasets/takeover-phase6-cases.mjs";

export const PHASE6_EVALUATION_VERSION = "semantic-takeover-phase6.v1";

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * percentileValue) - 1)];
}

function aggregateSlice(results, field) {
  const groups = new Map();
  for (const result of results) {
    const key = result.slices[field];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result);
  }
  return Object.fromEntries([...groups.entries()].map(([key, values]) => [
    key,
    {
      total: values.length,
      quality: values.filter((value) => value.passed).length / values.length,
      fallbackRate: values.filter((value) => value.route === "legacy_fallback").length / values.length,
      p50LatencyMs: percentile(values.map((value) => value.latencyMs), 0.5),
      p95LatencyMs: percentile(values.map((value) => value.latencyMs), 0.95),
      p50InputTokens: percentile(values.map((value) => value.inputTokens), 0.5),
      p95InputTokens: percentile(values.map((value) => value.inputTokens), 0.95),
      p50OutputTokens: percentile(values.map((value) => value.outputTokens), 0.5),
      p95OutputTokens: percentile(values.map((value) => value.outputTokens), 0.95)
    }
  ]));
}

function progressivePolicy(action, rolloutPercent) {
  const activeIndex = TAKEOVER_ACTION_ORDER.indexOf(action);
  return Object.fromEntries(TAKEOVER_ACTION_ORDER.map((value, index) => [
    value,
    {
      offlinePassed: true,
      shadowPassed: true,
      rolloutPercent: index < activeIndex ? 100 : index === activeIndex ? rolloutPercent : 0
    }
  ]));
}

async function executeCase(testCase, registry, repetition) {
  const startedAt = performance.now();
  const match = matchTaskCapabilities(testCase.taskFrame, registry);
  const executionPlanning = await planExecution(testCase.taskFrame, match, {
    registry,
    budget: { maxSteps: 3, maxToolCalls: 3, maxPlanTokens: 800 }
  });
  const shadowDifference = compareSemanticShadow(
    { intent: testCase.legacyIntent, parser: {} },
    { taskFrame: testCase.taskFrame }
  );
  const decision = createTakeoverDecision({
    taskFrame: testCase.taskFrame,
    clarificationPolicy: { needsClarification: false, strategy: "answer" },
    capabilityMatch: match,
    executionPlanning,
    shadowDifference,
    legacyTools: [testCase.expectedTool],
    requestKey: `${testCase.id}:stable`,
    policy: DEFAULT_PHASE6_ROLLOUT_POLICY
  });
  const actualTool = executionPlanning.plan?.steps?.[0]?.tool ?? null;
  const passed = decision.route === "semantic"
    && actualTool === testCase.expectedTool
    && executionPlanning.validation?.valid === true;
  const inputTokens = Math.ceil(JSON.stringify(testCase.taskFrame).length / 3);
  const outputTokens = Number(executionPlanning.validation?.estimatedTokens ?? 0);
  const latencyMs = Math.max(0, performance.now() - startedAt);
  const trace = finalizeTakeoverTrace(decision, {
    toolStatus: passed ? "completed" : "failed",
    conclusionStatus: passed ? "completed" : "not_started",
    latencyMs,
    inputTokens,
    cachedInputTokens: 120,
    outputTokens
  });
  return {
    id: testCase.id,
    repetition,
    slices: testCase.slices,
    expectedTool: testCase.expectedTool,
    actualTool,
    route: decision.route,
    reason: decision.reason,
    shadowDifference: Boolean(
      shadowDifference.actionChanged
      || shadowDifference.domainChanged
      || shadowDifference.clarificationChanged
    ),
    latencyMs,
    inputTokens,
    cachedInputTokens: 120,
    outputTokens,
    traceFailureLayer: trace.failureLayer,
    passed
  };
}

export async function runPhase6Evaluation(options = {}) {
  const registry = options.registry ?? new ToolRegistry(createStructuredToolDefinitions());
  const cases = options.cases ?? buildPhase6TakeoverCases();
  const repetitions = Math.max(3, Math.min(5, Number(options.repetitions ?? 5)));
  const results = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const testCase of cases) {
      results.push(await executeCase(testCase, registry, repetition));
    }
  }

  const byCase = new Map();
  for (const result of results) {
    if (!byCase.has(result.id)) byCase.set(result.id, []);
    byCase.get(result.id).push(result);
  }
  const passAtK = [...byCase.values()].filter((values) => values.some((value) => value.passed)).length / byCase.size;
  const passPowerK = [...byCase.values()].filter((values) => values.every((value) => value.passed)).length / byCase.size;
  const wrongToolCalls = results.filter((result) => result.actualTool !== result.expectedTool).length;
  const shadowDifferences = results.filter((result) => result.shadowDifference).length;
  const supportedEffective = results.filter((result) => result.passed).length;

  const canary = {};
  for (const action of TAKEOVER_ACTION_ORDER) {
    const testCase = cases.find((entry) => entry.action === action);
    const policy = progressivePolicy(action, 10);
    const policyValidation = validateTakeoverPolicy(policy);
    let semantic = 0;
    let fallback = 0;
    for (let index = 0; index < 100; index += 1) {
      const match = matchTaskCapabilities(testCase.taskFrame, registry);
      const executionPlanning = await planExecution(testCase.taskFrame, match, { registry });
      const decision = createTakeoverDecision({
        taskFrame: testCase.taskFrame,
        clarificationPolicy: { needsClarification: false },
        capabilityMatch: match,
        executionPlanning,
        shadowDifference: compareSemanticShadow(
          { intent: testCase.legacyIntent, parser: {} },
          { taskFrame: testCase.taskFrame }
        ),
        legacyTools: [testCase.expectedTool],
        requestKey: `${action}:canary:${index}`,
        policy
      });
      if (decision.route === "semantic") semantic += 1;
      else fallback += 1;
    }
    canary[action] = {
      policyValid: policyValidation.valid,
      rolloutPercent: 10,
      semantic,
      fallback,
      observedBothRoutes: semantic > 0 && fallback > 0
    };
  }

  const metrics = {
    cases: cases.length,
    repetitions,
    runs: results.length,
    supportedEffective,
    effectiveAnswerRate: results.length ? supportedEffective / results.length : 1,
    wrongToolCalls,
    wrongToolCallRate: results.length ? wrongToolCalls / results.length : 0,
    shadowDifferences,
    shadowDifferenceRate: results.length ? shadowDifferences / results.length : 0,
    fallbackCount: results.filter((result) => result.route === "legacy_fallback").length,
    fallbackRate: results.filter((result) => result.route === "legacy_fallback").length / results.length,
    passAtK,
    passPowerK,
    latency: {
      p50Ms: percentile(results.map((result) => result.latencyMs), 0.5),
      p95Ms: percentile(results.map((result) => result.latencyMs), 0.95)
    },
    tokens: {
      inputP50: percentile(results.map((result) => result.inputTokens), 0.5),
      inputP95: percentile(results.map((result) => result.inputTokens), 0.95),
      cachedInputP50: percentile(results.map((result) => result.cachedInputTokens), 0.5),
      cachedInputP95: percentile(results.map((result) => result.cachedInputTokens), 0.95),
      outputP50: percentile(results.map((result) => result.outputTokens), 0.5),
      outputP95: percentile(results.map((result) => result.outputTokens), 0.95)
    }
  };
  const slices = Object.fromEntries(
    ["action", "entityType", "style", "version", "toolType"]
      .map((field) => [field, aggregateSlice(results, field)])
  );
  const gates = {
    effectiveAnswerRate: metrics.effectiveAnswerRate >= 0.9,
    wrongToolCallRate: metrics.wrongToolCallRate < 0.01,
    shadowDifference: metrics.shadowDifferences === 0,
    stability: passAtK >= 0.9 && passPowerK >= 0.9,
    canary: Object.values(canary).every((value) => value.policyValid && value.observedBothRoutes),
    actionSlices: TAKEOVER_ACTION_ORDER.every((action) => slices.action[action]?.quality >= 0.9)
  };
  return {
    evaluationVersion: PHASE6_EVALUATION_VERSION,
    datasetVersion: PHASE6_TAKEOVER_DATASET_VERSION,
    passed: Object.values(gates).every(Boolean),
    gates,
    metrics,
    canary,
    slices,
    results
  };
}
