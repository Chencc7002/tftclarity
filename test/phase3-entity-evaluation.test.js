import test from "node:test";
import assert from "node:assert/strict";
import { runPhase3Evaluation } from "../eval/phase3-runner.mjs";

test("phase 3 entity evaluation enforces all acceptance gates", async () => {
  const report = await runPhase3Evaluation();
  assert.equal(report.passed, true);
  assert.ok(report.metrics.coreTop1Accuracy >= 0.97);
  assert.ok(report.metrics.aliasTop3Recall >= 0.98);
  assert.ok(report.metrics.nonexistentFalseHitRate < 0.02);
  assert.equal(report.metrics.conceptAccuracy, 1);
});
