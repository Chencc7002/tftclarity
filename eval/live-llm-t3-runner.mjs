import { performance } from "node:perf_hooks";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";
import { planExecution } from "../src/agent/execution-plan.js";
import { statusAfterPlanning } from "../src/agent/status-protocol.js";
import { ToolRegistry } from "../src/agent/tools/registry.js";
import { resolveEntities } from "../src/core/entity-resolver.js";
import { normalizeText } from "../src/core/normalizer.js";
import { createPhase3EvaluationCatalog } from "./datasets/entity-linking-phase3-cases.mjs";
import { matchTaskCapabilities } from "../src/understanding/capability-matcher.js";
import { resolveGameConcept } from "../src/understanding/concept-resolver.js";
import { defaultFewShotExampleStore } from "../src/understanding/few-shot-example-store.js";
import { parseSemanticTask } from "../src/understanding/semantic-task-parser.js";

export const LIVE_LLM_T3_EVALUATION_VERSION = "live-llm-t3-evaluation.v2";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function percentile(values, value) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(value * sorted.length) - 1)];
}

function allEntities(frame = {}) {
  return [
    ...array(frame.subjects),
    ...array(frame.candidates),
    ...array(frame.concepts)
  ];
}

function matchesMention(entity, mention) {
  const expected = normalizeText(mention);
  return [
    entity?.rawText,
    entity?.canonicalName,
    ...array(entity?.candidates).flatMap((candidate) => [
      candidate?.canonicalName,
      candidate?.matchedAlias
    ])
  ].filter(Boolean).some((value) => {
    const actual = normalizeText(value);
    return actual.includes(expected) || expected.includes(actual);
  });
}

function expectedResolvedId(mention, catalog) {
  const concept = resolveGameConcept(mention);
  if (concept.resolvedId) return concept.resolvedId;
  return resolveEntities(mention, { catalog }).all?.[0]?.target ?? null;
}

function evaluateEntities(frame, testCase, catalog) {
  const expectedMentions = array(testCase.expected.entityMentions);
  const entities = allEntities(frame);
  const matches = expectedMentions.map((mention) => {
    const resolvedId = testCase.category === "unknown_entity"
      ? null
      : expectedResolvedId(mention, catalog);
    const candidates = entities.filter((entity) => (
      matchesMention(entity, mention)
      || (resolvedId && entity?.resolvedId === resolvedId)
    ));
    return candidates.find((entity) => (
      resolvedId ? entity?.resolvedId === resolvedId : !entity?.resolvedId
    )) ?? candidates[0] ?? null;
  });
  const matched = matches.filter(Boolean).length;
  const shouldResolve = testCase.category !== "unknown_entity";
  const resolutionCorrect = matches.filter((entity) => (
    entity && (shouldResolve ? Boolean(entity.resolvedId) : !entity.resolvedId)
  )).length;
  return {
    expected: expectedMentions.length,
    matched,
    resolvedCorrect: resolutionCorrect,
    mentionRecall: expectedMentions.length ? matched / expectedMentions.length : 1,
    top1Accuracy: expectedMentions.length ? resolutionCorrect / expectedMentions.length : 1,
    values: entities.map((entity) => ({
      rawText: entity.rawText,
      expectedType: entity.expectedType,
      resolvedId: entity.resolvedId,
      confidence: entity.confidence
    }))
  };
}

function selectedTool(executionPlanning) {
  if (
    executionPlanning?.status !== "understood_and_supported"
    || executionPlanning?.validation?.valid !== true
  ) return null;
  const tools = [...new Set(array(executionPlanning.plan?.steps).map((step) => step.tool))];
  return tools.length === 1 ? tools[0] : tools.join("+");
}

function evaluationStatus(statusProtocol) {
  if (statusProtocol.understandingStatus === "out_of_domain") return "out_of_domain";
  if (statusProtocol.understandingStatus === "missing_context") {
    return "understood_but_missing_context";
  }
  if (statusProtocol.understandingStatus === "ambiguous") return "ambiguous";
  if (statusProtocol.capabilityStatus === "unsupported") return "understood_but_unsupported";
  return "understood_and_supported";
}

function semanticArgumentsCorrect(frame, executionPlanning, registry) {
  if (executionPlanning?.validation?.valid !== true) return true;
  const steps = array(executionPlanning.plan?.steps);
  if (steps.length < 1 || steps.length > 3) return false;
  const entities = allEntities(frame);
  const constraints = frame.constraints ?? {};
  const championIds = entities
    .filter((entity) => entity.expectedType === "champion" && entity.resolvedId)
    .map((entity) => entity.resolvedId);
  for (const step of steps) {
    if (step.tool === "unit_builds" && championIds.length && step.arguments.unit !== championIds[0]) {
      return false;
    }
    if (step.tool === "unit_details" && championIds.length && step.arguments.apiName !== championIds[0]) {
      return false;
    }
    const supportedArguments = registry.get(step.tool)?.inputSchema?.properties ?? {};
    for (const key of ["days", "patch", "queue", "rank", "minSamples", "metrics", "limit"]) {
      if (
        constraints[key] !== undefined
        && Object.hasOwn(supportedArguments, key)
        && JSON.stringify(step.arguments[key]) !== JSON.stringify(constraints[key])
      ) return false;
    }
  }
  const mapping = executionPlanning.conceptMapping;
  if (mapping?.argumentTemplate) {
    const step = steps.find((entry) => entry.tool === mapping.tool);
    if (!step) return false;
    for (const [key, value] of Object.entries(mapping.argumentTemplate)) {
      if (JSON.stringify(step.arguments[key]) !== JSON.stringify(value)) return false;
    }
  }
  return true;
}

function sanitizedError(error) {
  return {
    category: error?.name === "TypeError" ? "invalid_response" : "provider_or_budget_error",
    message: String(error?.message ?? error ?? "unknown error")
      .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
      .slice(0, 500)
  };
}

function expectedValues(value, fallback) {
  const values = Array.isArray(value) ? value : value === undefined ? [fallback] : [value];
  return new Set(values);
}

async function prepareConversation(testCase, catalog) {
  const prepared = [];
  for (const entry of array(testCase.conversation)) {
    if (entry?.taskFrame || entry?.frame || entry?.query || entry?.intent) {
      prepared.push(structuredClone(entry));
      continue;
    }
    const content = String(entry?.content ?? "");
    if (!content) continue;
    const parsed = await parseSemanticTask(content, {
      catalog,
      conversation: [],
      entityLinking: true,
      budget: {
        maxInputTokens: 2500,
        maxOutputTokens: 1200,
        maxLatencyMs: 45000
      }
    });
    prepared.push({
      ...structuredClone(entry),
      taskFrame: parsed.taskFrame
    });
  }
  return prepared;
}

function validateDataset(cases, repetitions) {
  const errors = [];
  if (cases.length < 100 || cases.length > 300) {
    errors.push("T3 dataset must contain 100-300 cases");
  }
  if (!Number.isInteger(repetitions) || repetitions < 3) {
    errors.push("T3 repetitions must be at least 3");
  }
  const ids = new Set();
  const inputs = new Set();
  const fewShotInputs = new Set(defaultFewShotExampleStore.examples.map((entry) => normalizeText(entry.input)));
  for (const testCase of cases) {
    if (!testCase.id || ids.has(testCase.id)) errors.push(`duplicate or missing id: ${testCase.id}`);
    ids.add(testCase.id);
    const input = normalizeText(testCase.input);
    if (!input || inputs.has(input)) errors.push(`duplicate or empty input: ${testCase.id}`);
    inputs.add(input);
    if (fewShotInputs.has(input)) errors.push(`T3 input overlaps few-shot: ${testCase.id}`);
  }
  return { valid: errors.length === 0, errors };
}

async function evaluateRun(testCase, repetition, options) {
  const startedAt = performance.now();
  let requestLog = null;
  try {
    const preparedConversation = await prepareConversation(testCase, options.catalog);
    const semanticResult = await parseSemanticTask(testCase.input, {
      catalog: options.catalog,
      conversation: preparedConversation,
      dynamicContext: {
        version: options.patch ?? options.catalog.version ?? "current",
        conversationSummary: testCase.conversation?.length ? testCase.conversation : null
      },
      provider: options.createProvider((value) => {
        requestLog = value;
      }),
      providerFailureFallback: true,
      budget: {
        maxInputTokens: options.budget.maxInputTokens,
        maxOutputTokens: options.budget.maxOutputTokens,
        maxLatencyMs: options.budget.maxRequestLatencyMs
      }
    });
    const frame = semanticResult.taskFrame;
    const capabilityMatch = matchTaskCapabilities(frame, options.registry);
    const executionPlanning = await planExecution(frame, capabilityMatch, {
      registry: options.registry,
      budget: { maxSteps: 3, maxToolCalls: 3, maxPlannerTokens: 600 }
    });
    const statusProtocol = statusAfterPlanning(frame, capabilityMatch, executionPlanning);
    const entity = evaluateEntities(frame, testCase, options.catalog);
    const tool = selectedTool(executionPlanning);
    const clarification = Boolean(semanticResult.clarificationPolicy?.needsClarification);
    const status = evaluationStatus(statusProtocol);
    const usage = requestLog?.usage ?? semanticResult.telemetry.usage;
    const durationMs = requestLog?.durationMs ?? semanticResult.telemetry.durationMs;
    const expectedDomain = expectedValues(
      testCase.expected.domain,
      array(testCase.expected.status).includes("out_of_domain")
        || testCase.expected.status === "out_of_domain"
        ? "out_of_domain"
        : "tft"
    );
    const expectedActions = expectedValues(testCase.expected.action, "unknown");
    const expectedStatuses = expectedValues(testCase.expected.status, "ambiguous");
    const checks = {
      domain: expectedDomain.has(frame.domain),
      action: expectedActions.has(frame.action),
      status: expectedStatuses.has(status),
      entityMention: entity.mentionRecall === 1,
      entityResolution: entity.top1Accuracy === 1,
      tool: tool === testCase.expected.tool,
      arguments: semanticArgumentsCorrect(frame, executionPlanning, options.registry),
      planShape: executionPlanning.plan
        ? executionPlanning.plan.steps.length >= 1
          && executionPlanning.plan.steps.length <= 3
          && executionPlanning.plan.route === (
            capabilityMatch.mode === "single_tool"
              ? "deterministic_fast_path"
              : "controlled_planner"
          )
        : true,
      clarification: clarification === testCase.expected.clarification,
      inputBudget: (
        Number(usage.cachedInputTokens ?? 0) + Number(usage.uncachedInputTokens ?? 0)
      ) <= options.budget.maxInputTokens,
      outputBudget: Number(usage.outputTokens ?? 0) <= options.budget.maxOutputTokens,
      latencyBudget: Number(durationMs) <= options.budget.maxRequestLatencyMs
    };
    return {
      id: testCase.id,
      category: testCase.category,
      repetition,
      expected: testCase.expected,
      actual: {
        domain: frame.domain,
        action: frame.action,
        status,
        parserStatus: frame.understandingStatus,
        statusProtocol,
        tool,
        arguments: executionPlanning.plan?.steps.map((step) => ({
          tool: step.tool,
          arguments: step.arguments
        })) ?? [],
        clarification,
        entities: entity.values
      },
      checks,
      passed: Object.values(checks).every(Boolean),
      telemetry: {
        durationMs,
        firstTokenMs: requestLog?.firstTokenMs ?? null,
        firstTokenMeasurement: requestLog?.firstTokenMeasurement ?? "unavailable_non_streaming",
        retryCount: requestLog?.retryCount ?? 0,
        providerFallback: Boolean(semanticResult.telemetry.providerFallback?.used),
        usage
      },
      error: null,
      wallDurationMs: Math.max(0, performance.now() - startedAt)
    };
  } catch (error) {
    return {
      id: testCase.id,
      category: testCase.category,
      repetition,
      expected: testCase.expected,
      actual: null,
      checks: {
        domain: false,
        action: false,
        status: false,
        entityMention: false,
        entityResolution: false,
        tool: false,
        arguments: false,
        planShape: false,
        clarification: false,
        inputBudget: false,
        outputBudget: false,
        latencyBudget: false
      },
      passed: false,
      telemetry: {
        durationMs: requestLog?.durationMs ?? null,
        firstTokenMs: requestLog?.firstTokenMs ?? null,
        firstTokenMeasurement: requestLog?.firstTokenMeasurement ?? "unavailable_non_streaming",
        retryCount: requestLog?.retryCount ?? 0,
        providerFallback: false,
        usage: requestLog?.usage ?? null
      },
      error: sanitizedError(error),
      wallDurationMs: Math.max(0, performance.now() - startedAt)
    };
  }
}

async function workerPool(jobs, concurrency, execute) {
  const results = new Array(jobs.length);
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await execute(jobs[index]);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, jobs.length) },
    () => worker()
  ));
  return results;
}

function metricRate(results, check) {
  return results.length
    ? results.filter((result) => result.checks[check]).length / results.length
    : 1;
}

function sliceMetrics(results) {
  const groups = new Map();
  for (const result of results) {
    if (!groups.has(result.category)) groups.set(result.category, []);
    groups.get(result.category).push(result);
  }
  return Object.fromEntries([...groups].map(([category, values]) => {
    const byCase = new Map();
    for (const value of values) {
      if (!byCase.has(value.id)) byCase.set(value.id, []);
      byCase.get(value.id).push(value);
    }
    return [category, {
      runs: values.length,
      passRate: values.filter((value) => value.passed).length / values.length,
      passAtK: [...byCase.values()].filter((runs) => runs.some((value) => value.passed)).length
        / byCase.size,
      passPowerK: [...byCase.values()].filter((runs) => runs.every((value) => value.passed)).length
        / byCase.size,
      entityResolutionAccuracy: metricRate(values, "entityResolution"),
      toolSelectionAccuracy: metricRate(values, "tool"),
      argumentSemanticAccuracy: metricRate(values, "arguments"),
      clarificationAccuracy: metricRate(values, "clarification")
    }];
  }));
}

export async function runLiveLlmT3Evaluation(cases, options = {}) {
  const startedAt = performance.now();
  const repetitions = Number(options.repetitions ?? 3);
  const datasetValidation = validateDataset(cases, repetitions);
  if (!datasetValidation.valid) {
    throw new TypeError(`Invalid T3 dataset: ${datasetValidation.errors.join("; ")}`);
  }
  const budget = {
    maxRequests: Number(options.budget?.maxRequests ?? 900),
    maxInputTokens: Number(options.budget?.maxInputTokens ?? 5000),
    // The provider permits one invalid-structure retry; the run-level budget
    // therefore reserves two 1,200-token attempts while each attempt remains capped.
    maxOutputTokens: Number(options.budget?.maxOutputTokens ?? 2400),
    maxRequestLatencyMs: Number(options.budget?.maxRequestLatencyMs ?? 45000),
    maxTotalTokens: Number(options.budget?.maxTotalTokens ?? 1200000),
    maxWallMs: Number(options.budget?.maxWallMs ?? 1800000)
  };
  const jobs = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const testCase of cases) jobs.push({ testCase, repetition });
  }
  if (jobs.length > budget.maxRequests) {
    throw new RangeError(`T3 request count ${jobs.length} exceeds budget ${budget.maxRequests}`);
  }
  const registry = options.registry ?? new ToolRegistry(createStructuredToolDefinitions());
  const catalog = options.catalog ?? createPhase3EvaluationCatalog();
  const results = await workerPool(
    jobs,
    Math.max(1, Math.min(8, Number(options.concurrency ?? 4))),
    ({ testCase, repetition }) => evaluateRun(testCase, repetition, {
      ...options,
      budget,
      registry,
      catalog
    })
  );
  const totalTokens = results.reduce((sum, result) => (
    sum
    + Number(result.telemetry.usage?.cachedInputTokens ?? 0)
    + Number(result.telemetry.usage?.uncachedInputTokens ?? 0)
    + Number(result.telemetry.usage?.outputTokens ?? 0)
  ), 0);
  if (totalTokens > budget.maxTotalTokens) {
    throw new RangeError(`T3 total tokens ${totalTokens} exceeds budget ${budget.maxTotalTokens}`);
  }
  const totalDurationMs = Math.max(0, performance.now() - startedAt);
  if (totalDurationMs > budget.maxWallMs) {
    throw new RangeError(`T3 wall time ${totalDurationMs}ms exceeds budget ${budget.maxWallMs}ms`);
  }
  const byCase = new Map();
  for (const result of results) {
    if (!byCase.has(result.id)) byCase.set(result.id, []);
    byCase.get(result.id).push(result);
  }
  const durations = results.map((result) => result.telemetry.durationMs).filter(Number.isFinite);
  const successful = results.filter((result) => !result.error);
  const slices = sliceMetrics(results);
  const unsupported = results.filter((result) => result.category === "unsupported");
  const unsupportedHonestDowngrades = unsupported.filter((result) => (
    !result.error
    && (
      (
        result.actual?.status === "understood_but_unsupported"
        && result.actual?.statusProtocol?.understandingStatus === "understood"
        && result.actual?.statusProtocol?.capabilityStatus === "unsupported"
        && result.actual?.statusProtocol?.planningStatus === "not_planned"
        && result.actual?.statusProtocol?.finalOutcome === "degraded"
      )
      || (
        result.actual?.status === "out_of_domain"
        && result.actual?.statusProtocol?.understandingStatus === "out_of_domain"
        && result.actual?.statusProtocol?.capabilityStatus === "unsupported"
        && result.actual?.statusProtocol?.planningStatus === "not_planned"
        && result.actual?.statusProtocol?.finalOutcome === "refused"
      )
    )
    && result.actual?.tool === null
    && array(result.actual?.arguments).length === 0
    && result.actual?.clarification === false
  )).length;
  const metrics = {
    cases: cases.length,
    repetitions,
    requests: results.length,
    successfulRequests: results.filter((result) => !result.error).length,
    requestSuccessRate: results.filter((result) => !result.error).length / results.length,
    providerFallbacks: results.filter((result) => result.telemetry.providerFallback).length,
    providerFallbackRate: results.filter((result) => result.telemetry.providerFallback).length / results.length,
    passAtK: [...byCase.values()].filter((values) => values.some((value) => value.passed)).length / byCase.size,
    passPowerK: [...byCase.values()].filter((values) => values.every((value) => value.passed)).length / byCase.size,
    domainAccuracy: metricRate(results, "domain"),
    actionAccuracy: metricRate(results, "action"),
    statusAccuracy: metricRate(results, "status"),
    entityMentionRecall: metricRate(results, "entityMention"),
    entityResolutionTop1Accuracy: metricRate(results, "entityResolution"),
    toolSelectionAccuracy: metricRate(results, "tool"),
    argumentSemanticAccuracy: metricRate(results, "arguments"),
    planShapeAccuracy: metricRate(results, "planShape"),
    clarificationAccuracy: metricRate(results, "clarification"),
    unsupportedHonestDowngradeRate: unsupported.length
      ? unsupportedHonestDowngrades / unsupported.length
      : 1,
    contextPassPowerK: slices.context?.passPowerK ?? 1,
    tokenBudgetPassRate: successful.length ? successful.filter((result) => (
      result.checks.inputBudget && result.checks.outputBudget
    )).length / successful.length : 0,
    latencyBudgetPassRate: successful.length
      ? successful.filter((result) => result.checks.latencyBudget).length / successful.length
      : 0,
    tokens: {
      cachedInput: results.reduce((sum, result) => sum + Number(result.telemetry.usage?.cachedInputTokens ?? 0), 0),
      uncachedInput: results.reduce((sum, result) => sum + Number(result.telemetry.usage?.uncachedInputTokens ?? 0), 0),
      output: results.reduce((sum, result) => sum + Number(result.telemetry.usage?.outputTokens ?? 0), 0),
      total: totalTokens,
      perRequestP50: percentile(results.map((result) => (
        Number(result.telemetry.usage?.cachedInputTokens ?? 0)
        + Number(result.telemetry.usage?.uncachedInputTokens ?? 0)
        + Number(result.telemetry.usage?.outputTokens ?? 0)
      )), 0.5),
      perRequestP95: percentile(results.map((result) => (
        Number(result.telemetry.usage?.cachedInputTokens ?? 0)
        + Number(result.telemetry.usage?.uncachedInputTokens ?? 0)
        + Number(result.telemetry.usage?.outputTokens ?? 0)
      )), 0.95)
    },
    latency: {
      averageMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      wallMs: totalDurationMs
    }
  };
  const gates = {
    datasetSize: cases.length >= 100 && cases.length <= 300,
    repetitions: repetitions >= 3,
    requestSuccess: metrics.requestSuccessRate >= 0.99,
    providerFallback: metrics.providerFallbackRate <= 0.01,
    passAtK: metrics.passAtK >= 0.95,
    passPowerK: metrics.passPowerK >= 0.9,
    domainAccuracy: metrics.domainAccuracy >= 0.98,
    actionAccuracy: metrics.actionAccuracy >= 0.95,
    statusAccuracy: metrics.statusAccuracy >= 0.9,
    entityResolution: metrics.entityResolutionTop1Accuracy >= 0.97,
    toolSelection: metrics.toolSelectionAccuracy >= 0.99,
    argumentSemantics: metrics.argumentSemanticAccuracy >= 0.98,
    planShape: metrics.planShapeAccuracy >= 0.99,
    clarification: metrics.clarificationAccuracy >= 0.95,
    unsupportedHonestDowngrade: metrics.unsupportedHonestDowngradeRate === 1,
    contextPassPowerK: metrics.contextPassPowerK >= 0.95,
    tokenBudget: metrics.tokenBudgetPassRate === 1,
    latencyBudget: metrics.latencyBudgetPassRate === 1
  };
  return {
    schemaVersion: "live-llm-t3-report.v2",
    evaluationVersion: LIVE_LLM_T3_EVALUATION_VERSION,
    datasetVersion: cases[0]?.datasetVersion ?? null,
    passed: Object.values(gates).every(Boolean),
    gates,
    budget,
    metrics,
    slices,
    results
  };
}
