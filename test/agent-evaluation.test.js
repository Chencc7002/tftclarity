import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { calculateAgentMetrics, percentile } from "../eval/metrics.mjs";
import { loadAgentEvalDataset, runAgentEvaluation } from "../eval/runner.mjs";
import { agentEvaluationExitCode, agentEvaluationMarkdown } from "../scripts/run-agent-eval.mjs";

test("core agent JSONL dataset is valid and contains 50 required offline cases", async () => {
  const cases = await loadAgentEvalDataset(new URL("../eval/datasets/core-agent-cases.jsonl", import.meta.url));
  assert.equal(cases.length, 50);
  assert.equal(new Set(cases.map((record) => record.id)).size, 50);
  const coverage = new Set(cases.flatMap((record) => record.coverage ?? []));
  for (const required of [
    "unit_details",
    "item_details",
    "trait_details",
    "multi_turn",
    "clarification",
    "low_sample",
    "empty_result",
    "stale",
    "embedding_failure",
    "llm_failure",
    "unknown_tool",
    "unknown_parameter",
    "source_mismatch",
    "timeout",
    "cancel",
    "budget_exhaustion",
    "late_result",
    "season_isolation",
    "llm_fact_authority"
  ]) {
    assert.equal(coverage.has(required), true, `missing evaluation coverage: ${required}`);
  }
});

test("agent metrics keep skipped separate from passed and compute stable small-sample P95", () => {
  const passing = (id, durationMs) => ({
    id,
    passed: true,
    skipped: false,
    durationMs,
    checks: { intent: true, clarification: true, tools: true, toolInput: true },
    actual: { status: "completed", fallback: false }
  });
  const results = [
    passing("one", 1),
    passing("two", 5),
    {
      id: "skip",
      passed: false,
      skipped: true,
      durationMs: 100,
      checks: { intent: false, clarification: false, tools: false, toolInput: false },
      actual: { status: "skipped", fallback: false }
    }
  ];
  const metrics = calculateAgentMetrics(results);
  assert.equal(metrics.total, 3);
  assert.equal(metrics.passed, 2);
  assert.equal(metrics.failed, 0);
  assert.equal(metrics.skipped, 1);
  assert.equal(metrics.task_success_rate, 1);
  assert.equal(metrics.p95_duration_ms, 5);
  assert.equal(percentile([2], 0.95), 2);
});

test("agent evaluation is repeatable offline and a required failure maps to exit code 1", async () => {
  const [cases, fixtureText] = await Promise.all([
    loadAgentEvalDataset(new URL("../eval/datasets/core-agent-cases.jsonl", import.meta.url)),
    readFile(new URL("./fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url), "utf8")
  ]);
  const options = { compFixture: JSON.parse(fixtureText) };
  const first = await runAgentEvaluation(cases, options);
  const second = await runAgentEvaluation(cases, options);
  assert.deepEqual(second, first);
  assert.equal(agentEvaluationExitCode(first), 0);
  assert.equal(agentEvaluationMarkdown(first), agentEvaluationMarkdown(second));

  const failed = structuredClone(first);
  failed.metrics.failed = 1;
  assert.equal(agentEvaluationExitCode(failed), 1);
});
