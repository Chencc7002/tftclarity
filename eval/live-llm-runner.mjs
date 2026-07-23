import { readFile } from "node:fs/promises";
import { normalizeText } from "../src/core/normalizer.js";
import { parseSemanticTask } from "../src/understanding/semantic-task-parser.js";

export const LIVE_LLM_EVALUATION_VERSION = "phase-0-3-live-llm-smoke.v1";

function percentile(values, value) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(value * sorted.length) - 1)];
}

function allEntities(frame = {}) {
  return [
    ...(frame.subjects ?? []),
    ...(frame.candidates ?? []),
    ...(frame.concepts ?? [])
  ];
}

function entityRecall(frame, expectedMentions = []) {
  if (!expectedMentions.length) return { matched: 0, total: 0, recall: 1 };
  const actual = allEntities(frame).map((entity) => normalizeText(entity.rawText));
  const matched = expectedMentions.filter((mention) => {
    const normalized = normalizeText(mention);
    return actual.some((candidate) => (
      candidate.includes(normalized) || normalized.includes(candidate)
    ));
  }).length;
  return { matched, total: expectedMentions.length, recall: matched / expectedMentions.length };
}

function sanitizedError(error) {
  const message = String(error?.message ?? error ?? "unknown error")
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .slice(0, 500);
  return {
    category: error?.name === "TypeError" ? "invalid_response" : "provider_or_budget_error",
    message
  };
}

export async function loadLiveLlmCases(path) {
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function runLiveLlmEvaluation(cases, options = {}) {
  const startedAt = performance.now();
  const results = [];
  const budget = {
    maxRequests: Number(options.budget?.maxRequests ?? 20),
    maxInputTokens: Number(options.budget?.maxInputTokens ?? 2000),
    maxOutputTokens: Number(options.budget?.maxOutputTokens ?? 1200),
    maxRequestLatencyMs: Number(options.budget?.maxRequestLatencyMs ?? 45000),
    maxTotalTokens: Number(options.budget?.maxTotalTokens ?? 70000),
    maxWallMs: Number(options.budget?.maxWallMs ?? 720000)
  };
  if (cases.length > budget.maxRequests) {
    throw new RangeError(`live LLM case count ${cases.length} exceeds request budget ${budget.maxRequests}`);
  }

  let totalTokens = 0;
  for (const testCase of cases) {
    if (performance.now() - startedAt > budget.maxWallMs) {
      throw new RangeError(`live LLM evaluation exceeded wall-clock budget ${budget.maxWallMs}ms`);
    }
    let requestLog = null;
    try {
      const parsed = await parseSemanticTask(testCase.input, {
        conversation: testCase.conversation,
        dynamicContext: {
          version: "current",
          conversationSummary: testCase.conversation?.length
            ? testCase.conversation
            : null
        },
        provider: options.createProvider((value) => {
          requestLog = value;
        }),
        entityLinking: false,
        budget: {
          maxInputTokens: budget.maxInputTokens,
          maxOutputTokens: budget.maxOutputTokens,
          maxLatencyMs: budget.maxRequestLatencyMs
        }
      });
      const frame = parsed.taskFrame;
      const recall = entityRecall(frame, testCase.expected.entityMentions);
      const usage = requestLog?.usage ?? parsed.telemetry.usage;
      const requestTokens = (
        Number(usage.cachedInputTokens ?? 0)
        + Number(usage.uncachedInputTokens ?? 0)
        + Number(usage.outputTokens ?? 0)
      );
      totalTokens += requestTokens;
      results.push({
        id: testCase.id,
        expected: testCase.expected,
        actual: {
          domain: frame.domain,
          action: frame.action,
          understandingStatus: frame.understandingStatus,
          entityMentions: allEntities(frame).map((entity) => entity.rawText)
        },
        checks: {
          structuredOutput: true,
          domain: frame.domain === testCase.expected.domain,
          action: frame.action === testCase.expected.action,
          understandingStatus: frame.understandingStatus === testCase.expected.understandingStatus,
          entityRecall: recall.recall,
          inputBudget: (
            Number(usage.cachedInputTokens ?? 0)
            + Number(usage.uncachedInputTokens ?? 0)
          ) <= budget.maxInputTokens,
          outputBudget: Number(usage.outputTokens ?? 0) <= budget.maxOutputTokens,
          latencyBudget: Number(requestLog?.durationMs ?? parsed.telemetry.durationMs) <= budget.maxRequestLatencyMs
        },
        telemetry: {
          durationMs: requestLog?.durationMs ?? parsed.telemetry.durationMs,
          firstTokenMs: requestLog?.firstTokenMs ?? null,
          firstTokenMeasurement: requestLog?.firstTokenMeasurement ?? "unavailable_non_streaming",
          usage,
          retryCount: requestLog?.retryCount ?? 0
        },
        rawStructuredOutput: requestLog?.rawStructuredOutput ?? frame,
        error: null
      });
    } catch (error) {
      results.push({
        id: testCase.id,
        expected: testCase.expected,
        actual: null,
        checks: {
          structuredOutput: false,
          domain: false,
          action: false,
          understandingStatus: false,
          entityRecall: 0,
          inputBudget: false,
          outputBudget: false,
          latencyBudget: false
        },
        telemetry: {
          durationMs: requestLog?.durationMs ?? null,
          firstTokenMs: requestLog?.firstTokenMs ?? null,
          firstTokenMeasurement: requestLog?.firstTokenMeasurement ?? "unavailable_non_streaming",
          usage: requestLog?.usage ?? null,
          retryCount: requestLog?.retryCount ?? 0
        },
        rawStructuredOutput: requestLog?.rawStructuredOutput ?? null,
        error: sanitizedError(error)
      });
    }
    if (totalTokens > budget.maxTotalTokens) {
      throw new RangeError(`live LLM evaluation exceeded total token budget ${budget.maxTotalTokens}`);
    }
  }

  const count = (predicate) => results.filter(predicate).length;
  const durations = results.map((result) => result.telemetry.durationMs).filter(Number.isFinite);
  const expectedEntities = results.reduce((sum, result) => (
    sum + result.expected.entityMentions.length
  ), 0);
  const matchedEntities = results.reduce((sum, result) => (
    sum + result.checks.entityRecall * result.expected.entityMentions.length
  ), 0);
  const metrics = {
    total: results.length,
    successfulRequests: count((result) => result.error === null),
    structuredOutputRate: results.length ? count((result) => result.checks.structuredOutput) / results.length : 0,
    domainAccuracy: results.length ? count((result) => result.checks.domain) / results.length : 0,
    actionAccuracy: results.length ? count((result) => result.checks.action) / results.length : 0,
    understandingStatusAccuracy: results.length
      ? count((result) => result.checks.understandingStatus) / results.length
      : 0,
    entityMentionRecall: expectedEntities ? matchedEntities / expectedEntities : 1,
    inputBudgetPassRate: results.length ? count((result) => result.checks.inputBudget) / results.length : 0,
    outputBudgetPassRate: results.length ? count((result) => result.checks.outputBudget) / results.length : 0,
    latencyBudgetPassRate: results.length ? count((result) => result.checks.latencyBudget) / results.length : 0,
    totalCachedInputTokens: results.reduce((sum, result) => (
      sum + Number(result.telemetry.usage?.cachedInputTokens ?? 0)
    ), 0),
    totalUncachedInputTokens: results.reduce((sum, result) => (
      sum + Number(result.telemetry.usage?.uncachedInputTokens ?? 0)
    ), 0),
    totalOutputTokens: results.reduce((sum, result) => (
      sum + Number(result.telemetry.usage?.outputTokens ?? 0)
    ), 0),
    averageDurationMs: durations.length
      ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length
      : 0,
    p95DurationMs: percentile(durations, 0.95),
    totalDurationMs: Math.max(0, performance.now() - startedAt),
    totalRetries: results.reduce((sum, result) => sum + result.telemetry.retryCount, 0)
  };
  const gates = {
    requestSuccess: metrics.successfulRequests === metrics.total,
    structuredOutput: metrics.structuredOutputRate === 1,
    domainAccuracy: metrics.domainAccuracy >= 0.95,
    actionAccuracy: metrics.actionAccuracy >= 0.85,
    understandingStatusAccuracy: metrics.understandingStatusAccuracy >= 0.8,
    entityMentionRecall: metrics.entityMentionRecall >= 0.8,
    tokenBudget: metrics.inputBudgetPassRate === 1 && metrics.outputBudgetPassRate === 1,
    latencyBudget: metrics.latencyBudgetPassRate === 1
  };
  return {
    schemaVersion: "live_llm_evaluation_report.v1",
    evaluationVersion: LIVE_LLM_EVALUATION_VERSION,
    datasetVersion: cases[0]?.datasetVersion ?? null,
    passed: Object.values(gates).every(Boolean),
    gates,
    budget,
    metrics,
    results
  };
}
