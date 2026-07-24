import assert from "node:assert/strict";
import test from "node:test";
import {
  DATASET_VERSION,
  REQUIRED_FAILURE_LABELS,
  REQUIRED_PHENOMENA,
  buildNaturalLanguageAgentCases
} from "../eval/datasets/natural-language-agent-cases.mjs";
import {
  evaluatePhase0Cases,
  serializeDataset
} from "../scripts/run-phase0-eval.mjs";

test("phase 0 dataset contains 300 unique, privacy-clean, fully labelled natural-language cases", () => {
  const cases = buildNaturalLanguageAgentCases();
  const report = evaluatePhase0Cases(cases);

  assert.equal(cases.length, 300);
  assert.equal(report.datasetVersion, DATASET_VERSION);
  assert.equal(report.uniqueInputs, 300);
  assert.equal(report.metrics.privacyViolations, 0);
  assert.equal(report.passed, true, JSON.stringify(report.failures));
});

test("phase 0 dataset independently covers every required failure label and phenomenon", () => {
  const report = evaluatePhase0Cases(buildNaturalLanguageAgentCases());

  for (const label of REQUIRED_FAILURE_LABELS) assert.ok(report.metrics.failureCounts[label] > 0, label);
  for (const label of REQUIRED_PHENOMENA) assert.ok(report.metrics.phenomenonCounts[label] > 0, label);
  assert.ok(report.metrics.nonStandardStyleRate >= 0.5);
  assert.ok(report.metrics.sourceCounts.anonymized_runtime_query >= 1);
});

test("phase 0 dataset serialization is deterministic JSONL", () => {
  const first = serializeDataset(buildNaturalLanguageAgentCases());
  const second = serializeDataset(buildNaturalLanguageAgentCases());

  assert.equal(first, second);
  assert.equal(first.trimEnd().split("\n").length, 300);
});

