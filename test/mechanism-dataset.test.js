import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { validateMechanismCase } from "../src/knowledge/mechanism-case-builder.js";

const datasetRoot = resolve("data", "generated", "mechanisms", "s17");

async function readJsonl(directory, fileName) {
  const text = await readFile(resolve(directory, fileName), "utf8");
  return text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line)) : [];
}

async function latestSnapshot() {
  const index = JSON.parse(await readFile(resolve(datasetRoot, "index.v1.json"), "utf8"));
  const snapshot = index.snapshots.find((entry) => entry.snapshotId === index.latestSnapshotId);
  assert.ok(snapshot, "latest snapshot must exist in index");
  return {
    index,
    snapshot,
    directory: resolve(snapshot.artifactDirectory)
  };
}

test("generated S17 standard cases satisfy traceability, semantic, and statistics invariants", async () => {
  const latest = await latestSnapshot();
  const [report, cases, partialCases, auxiliaryCases] = await Promise.all([
    readFile(resolve(latest.directory, "capture-report.v1.json"), "utf8").then(JSON.parse),
    readJsonl(latest.directory, "standard-cases.v1.jsonl"),
    readJsonl(latest.directory, "partial-official-cases.v1.jsonl"),
    readJsonl(latest.directory, "auxiliary-cases.v1.jsonl")
  ]);
  assert.equal(report.season, "S17");
  assert.equal(report.snapshotId, latest.snapshot.snapshotId);
  assert.equal(report.coverage.failedUnitCount, 0);
  assert.equal(report.coverage.officialUnitLinkRate, 1);
  assert.equal(report.integrity.duplicateCaseCount, 0);
  assert.deepEqual(report.integrity.missingOfficialItems, []);
  assert.equal(cases.length, report.coverage.standardCaseCount);
  assert.equal(partialCases.length, report.coverage.partialPublishedCaseCount);
  assert.equal(auxiliaryCases.length, report.coverage.auxiliaryPublishedCaseCount);
  assert.equal(new Set(cases.map((entry) => entry.caseId)).size, cases.length);
  assert.equal(new Date(report.provenance.generatedAt).toISOString(), report.provenance.generatedAt);
  assert.equal(new Date(report.provenance.sourceCapturedAt).toISOString(), report.provenance.sourceCapturedAt);

  const rawTokenPattern = /\{\{|TFTUnitProperty|%i:|set14AmpIcon/u;
  for (const entry of cases) {
    assert.deepEqual(validateMechanismCase(entry, { requireCompleteOfficialText: true }), []);
    assert.equal(entry.unit.entityType, "playable_candidate");
    assert.equal(entry.evidencePolicy.officialTextComplete, true);
    assert.doesNotMatch(entry.unit.ability.description ?? "", rawTokenPattern);
    assert.equal(entry.unit.sourceUrl, report.sources.officialChess.url);
    assert.equal(entry.unit.sourceDocumentHash, report.sources.officialChess.sha256);
    assert.equal(entry.items.length, 3);
    assert.equal(entry.items.every((item) => item.sourceUrl === report.sources.officialEquipment.url), true);
    assert.equal(entry.items.every((item) => item.sourceDocumentHash === report.sources.officialEquipment.sha256), true);
    assert.equal(entry.source.requestFingerprint.length, 64);
    assert.equal(entry.evidencePolicy.causalClaimAllowed, false);
    assert.notEqual(entry.stats.sampleEvidence.tier, undefined);
    assert.equal(
      [...entry.unit.mechanicAtoms, ...entry.items.flatMap((item) => item.mechanicAtoms)]
        .some((atom) => atom.condition === "as_described"),
      false
    );
  }
  assert.equal(partialCases.every((entry) => !entry.evidencePolicy.officialTextComplete), true);
  assert.equal(auxiliaryCases.every((entry) => entry.unit.entityType === "auxiliary"), true);
});

test("replacement files separate performance-eligible and mechanism-only comparisons", async () => {
  const latest = await latestSnapshot();
  const [cases, partialCases, auxiliaryCases, comparisons, mechanismOnly] = await Promise.all([
    readJsonl(latest.directory, "standard-cases.v1.jsonl"),
    readJsonl(latest.directory, "partial-official-cases.v1.jsonl"),
    readJsonl(latest.directory, "auxiliary-cases.v1.jsonl"),
    readJsonl(latest.directory, "replacement-comparisons.v1.jsonl"),
    readJsonl(latest.directory, "mechanism-only-replacement-comparisons.v1.jsonl")
  ]);
  const byId = new Map([...cases, ...partialCases, ...auxiliaryCases].map((entry) => [entry.caseId, entry]));

  for (const comparison of [...comparisons, ...mechanismOnly]) {
    const from = byId.get(comparison.from.caseId);
    const to = byId.get(comparison.to.caseId);
    assert.ok(from);
    assert.ok(to);
    assert.equal(from.unit.apiName, to.unit.apiName);
    assert.equal(comparison.sharedItems.length, 2);
    assert.deepEqual([...comparison.sharedItems, comparison.from.removedItem].sort(), [...from.rawItems].sort());
    assert.deepEqual([...comparison.sharedItems, comparison.to.addedItem].sort(), [...to.rawItems].sort());
    assert.notEqual(comparison.from.removedItem, comparison.to.addedItem);
    assert.equal(comparison.evidencePolicy.causalClaimAllowed, false);
  }
  assert.equal(comparisons.every((entry) => entry.sampleEvidence.minimumGames >= 400), true);
  assert.equal(comparisons.every((entry) => entry.evidencePolicy.eligibleForPerformanceInference), true);
  assert.equal(mechanismOnly.every((entry) => entry.sampleEvidence.minimumGames < 400), true);
  assert.equal(mechanismOnly.every((entry) => !entry.evidencePolicy.eligibleForPerformanceInference), true);
});
