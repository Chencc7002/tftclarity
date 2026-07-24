import { readFile } from "node:fs/promises";
import { parseSemanticTask } from "../src/understanding/semantic-task-parser.js";

export const PHASE2_EVALUATION_VERSION = "semantic-task-parser-phase2.v1";

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index];
}

export async function loadPhase2Cases(path) {
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function runPhase2Evaluation(cases, options = {}) {
  const results = [];
  for (const testCase of cases) {
    const parsed = await (options.parser ?? parseSemanticTask)(testCase.input, {
      conversation: testCase.conversation,
      dynamicContext: {
        version: testCase.labels?.constraints?.patch ?? "current",
        currentTime: options.currentTime ?? "2026-07-23T00:00:00+08:00"
      }
    });
    const frame = parsed.taskFrame;
    const expectedDomain = testCase.labels.domain;
    const expectedAction = testCase.labels.action;
    const unsupported = testCase.labels.supportStatus === "unsupported";
    const understoodUnsupported = !unsupported || ![
      "out_of_domain",
      "ambiguous"
    ].includes(frame.understandingStatus);
    results.push({
      id: testCase.id,
      expected: {
        domain: expectedDomain,
        action: expectedAction,
        supportStatus: testCase.labels.supportStatus
      },
      actual: {
        domain: frame.domain,
        action: frame.action,
        understandingStatus: frame.understandingStatus,
        confidence: frame.confidence
      },
      checks: {
        domain: frame.domain === expectedDomain,
        action: frame.action === expectedAction,
        unsupportedUnderstood: understoodUnsupported,
        inputBudget: (
          parsed.telemetry.usage.cachedInputTokens
          + parsed.telemetry.usage.uncachedInputTokens
        ) <= parsed.telemetry.budget.maxInputTokens,
        outputBudget: parsed.telemetry.usage.outputTokens <= parsed.telemetry.budget.maxOutputTokens,
        latencyBudget: parsed.telemetry.durationMs <= parsed.telemetry.budget.maxLatencyMs
      },
      telemetry: parsed.telemetry
    });
  }

  const count = (predicate) => results.filter(predicate).length;
  const unsupportedResults = results.filter((result) => (
    result.expected.supportStatus === "unsupported"
  ));
  const durations = results.map((result) => result.telemetry.durationMs);
  const metrics = {
    total: results.length,
    actionCorrect: count((result) => result.checks.action),
    actionAccuracy: results.length ? count((result) => result.checks.action) / results.length : 0,
    domainCorrect: count((result) => result.checks.domain),
    domainAccuracy: results.length ? count((result) => result.checks.domain) / results.length : 0,
    unsupportedTotal: unsupportedResults.length,
    unsupportedUnderstood: unsupportedResults.filter((result) => result.checks.unsupportedUnderstood).length,
    unsupportedUnderstandingRate: unsupportedResults.length
      ? unsupportedResults.filter((result) => result.checks.unsupportedUnderstood).length / unsupportedResults.length
      : 1,
    inputBudgetPassRate: results.length ? count((result) => result.checks.inputBudget) / results.length : 0,
    outputBudgetPassRate: results.length ? count((result) => result.checks.outputBudget) / results.length : 0,
    latencyBudgetPassRate: results.length ? count((result) => result.checks.latencyBudget) / results.length : 0,
    averageDurationMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
    p95DurationMs: percentile(durations, 0.95),
    averageCachedInputTokens: results.length
      ? results.reduce((sum, result) => sum + result.telemetry.usage.cachedInputTokens, 0) / results.length
      : 0,
    averageUncachedInputTokens: results.length
      ? results.reduce((sum, result) => sum + result.telemetry.usage.uncachedInputTokens, 0) / results.length
      : 0,
    averageOutputTokens: results.length
      ? results.reduce((sum, result) => sum + result.telemetry.usage.outputTokens, 0) / results.length
      : 0
  };
  const gates = {
    actionAccuracy: metrics.actionAccuracy >= 0.92,
    domainAccuracy: metrics.domainAccuracy >= 0.97,
    unsupportedUnderstanding: metrics.unsupportedUnderstandingRate === 1,
    tokenBudget: metrics.inputBudgetPassRate === 1 && metrics.outputBudgetPassRate === 1,
    latencyBudget: metrics.latencyBudgetPassRate === 1
  };
  return {
    evaluationVersion: PHASE2_EVALUATION_VERSION,
    datasetVersion: cases[0]?.datasetVersion ?? null,
    passed: Object.values(gates).every(Boolean),
    gates,
    metrics,
    results
  };
}
