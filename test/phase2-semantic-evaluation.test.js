import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { loadPhase2Cases, runPhase2Evaluation } from "../eval/phase2-runner.mjs";

test("phase 2 semantic evaluation remains reproducible after entity linking", async () => {
  const cases = await loadPhase2Cases(resolve("eval/datasets/natural-language-agent-phase0.v1.jsonl"));
  const report = await runPhase2Evaluation(cases, {
    currentTime: "2026-07-23T00:00:00+08:00"
  });
  assert.equal(report.passed, true);
  assert.ok(report.metrics.actionAccuracy >= 0.92);
  assert.ok(report.metrics.domainAccuracy >= 0.97);
  assert.equal(report.metrics.unsupportedUnderstandingRate, 1);
});
