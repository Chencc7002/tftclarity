import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { queryEntityCatalog } from "../src/domain/tft/entity-catalog-query.js";

const dataset = JSON.parse(await readFile(new URL("../eval/entity-names/typos.json", import.meta.url), "utf8"));
assert.equal(dataset.schemaVersion, "entity-name-eval.v1");
const catalog = structuredClone(dataset.catalog);
const cases = [];
for (const entry of dataset.cases) {
  const observations = [];
  const args = { catalog, updatedAt: "2026-09-06T00:00:00.000Z",
    input: { entityType: entry.type, filters: { names: [entry.input] } } };
  const legacy = queryEntityCatalog(args);
  const shadow = queryEntityCatalog({ ...args, nameResolution: { mode: "shadow", onObservation: event => observations.push(event) } });
  assert.deepEqual(shadow, legacy, `Shadow changed the result for ${entry.input}`);
  const result = queryEntityCatalog({ ...args, nameResolution: { mode: "suggest" } });
  const resolution = result.resolution.requests[0];
  const candidates = resolution.candidates.map(candidate => candidate.apiName);
  const top1Correct = entry.expected.length > 0 && entry.expected.includes(candidates[0]);
  const recallCorrect = entry.expected.every(id => candidates.includes(id));
  const negativeCorrect = entry.expected.length > 0 || candidates.length === 0;
  const automaticDecisionSafe = entry.autoAccept !== false || !observations[0]?.autoAcceptEligible;
  cases.push({ ...entry, candidates, status: resolution.status, top1Correct,
    recallCorrect, negativeCorrect, autoAcceptEligible: observations[0]?.autoAcceptEligible ?? false,
    passed: recallCorrect && negativeCorrect && automaticDecisionSafe
      && (entry.expected.length ? top1Correct && resolution.status === "ambiguous" : resolution.status === "not_found") });
}
const positive = cases.filter(entry => entry.expected.length);
const negative = cases.filter(entry => !entry.expected.length);
const report = {
  schemaVersion: "entity-name-eval-report.v1",
  generatedAt: new Date().toISOString(),
  limitation: "Synthetic offline fixtures; not an estimate of production error rate. Auto-accept remains telemetry only. No LLM calls.",
  total: cases.length, passed: cases.filter(entry => entry.passed).length,
  positiveCount: positive.length, top1Correct: positive.filter(entry => entry.top1Correct).length,
  allExpectedInTop5: positive.filter(entry => entry.recallCorrect).length,
  negativeCount: negative.length, negativeCorrect: negative.filter(entry => entry.negativeCorrect).length,
  shadowEquivalent: cases.length, actualAutomaticCorrections: 0,
  autoAcceptHypotheses: cases.filter(entry => entry.autoAcceptEligible).length,
  cases
};
const directory = new URL("../.cache/eval/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("entity-name-candidates.json", directory), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, cases: undefined }, null, 2));
process.exitCode = report.passed === report.total ? 0 : 1;
