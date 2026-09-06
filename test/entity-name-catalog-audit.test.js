import test from "node:test";
import assert from "node:assert/strict";
import { snapshotFromCache, validateSnapshot, extractObservedNames, generateCatalogStressCases, runCatalogAudit } from "../eval/entity-names/catalog-audit.js";

function cacheFixture() {
  return { domainCatalogs: {
    current: { updatedAt: "2026-09-01", value: { seasonContextId: "set18-live", patch: "current",
      units: [{ apiName: "A", zhName: "阿狸", current: true, raw: { secret: "do-not-copy" } },
        { apiName: "B", zhName: "阿卡丽", current: true }, { apiName: "C", zhName: "测试英雄", current: true }],
      traits: [{ apiName: "Trait", zhName: "魔战士", current: true }] } },
    newerOtherSeason: { updatedAt: "2026-09-06", value: { seasonContextId: "set19-live", units: [], traits: [] } }
  }, itemCatalogs: { current: { updatedAt: "2026-09-01", value: { seasonContextId: "set18-live", items: [
    { apiName: "I", zhName: "巨人杀手", aliases: ["巨杀"], current: true } ] } } },
    queryEvents: { q: { seasonContextId: "set18-live", input: "private full user message", visitorScope: "private-id",
      response: { evidence: [{ toolName: "entity_catalog_query", value: { entityType: "unit", resolution: {
        requests: [{ inputName: "阿丽", status: "resolved", candidates: [{ apiName: "B" }] }] } } }] } } } };
}

test("audit snapshots are scoped, hashed and restricted to entity metadata", () => {
  const snapshot = snapshotFromCache(cacheFixture(), "set18-live");
  assert.equal(snapshot.catalog.units.length, 3);
  assert.equal(snapshot.domainUpdatedAt, "2026-09-01");
  assert.equal(snapshot.freshness, "historical_not_verified_current");
  assert.doesNotThrow(() => validateSnapshot(snapshot));
  assert.ok(!JSON.stringify(snapshot).includes("private"));
  assert.ok(!JSON.stringify(snapshot).includes("do-not-copy"));
  snapshot.catalog.units[0].zhName = "tampered";
  assert.throws(() => validateSnapshot(snapshot), /hash mismatch/u);
  assert.throws(() => snapshotFromCache(cacheFixture(), "set19-live"), /cross-season/u);
});

test("historical model matches never become correctness labels", () => {
  const cache = cacheFixture();
  cache.queryEvents.duplicate = structuredClone(cache.queryEvents.q);
  cache.queryEvents.missing = { seasonContextId: "set18-live", response: {} };
  cache.queryEvents.other = { ...cache.queryEvents.q, seasonContextId: "set19-live" };
  const observed = extractObservedNames(cache, "set18-live");
  assert.equal(observed.queryCount, 3);
  assert.equal(observed.noCatalogEvidence, 1);
  assert.equal(observed.cases.length, 1);
  assert.equal(observed.cases[0].occurrences, 2);
  assert.equal(observed.cases[0].expectedIds, null);
  assert.equal(observed.cases[0].labelStatus, "unreviewed");
  assert.equal(observed.cases[0].origin, "local_qa");
  assert.ok(!JSON.stringify(observed).includes("private"));
  const report = runCatalogAudit(snapshotFromCache(cache, "set18-live"), observed.cases);
  assert.equal(report.observed.labeledCount, 0);
  assert.equal(report.observed.accuracy, null);
  assert.equal(report.rows[0].top1Correct, null);
  assert.equal(report.productionAccuracy, null);
  assert.equal(report.invariantsPass, true);
});

test("stress generation is reproducible and keeps colliding original targets", () => {
  const snapshot = snapshotFromCache(cacheFixture(), "set18-live");
  const first = generateCatalogStressCases(snapshot.catalog);
  assert.deepEqual(first, generateCatalogStressCases(snapshot.catalog));
  assert.ok(first.every(entry => entry.origin === "generated_stress"));
  const report = runCatalogAudit(snapshot, first);
  const ambiguous = report.rows.find(row => row.inputName === "阿丽" && row.group === "deletion");
  assert.equal(ambiguous.top1Correct, false);
  assert.equal(ambiguous.expectedInTop5, true);
  assert.equal(ambiguous.autoAcceptEligible, false);
  assert.equal(report.automaticCorrectionEnabled, false);
  assert.equal(report.productionAccuracy, null);
  assert.match(report.releaseGate, /^hold/u);
});

test("a generated mutation that is already another exact name is excluded from typo accuracy", () => {
  const snapshot = snapshotFromCache(cacheFixture(), "set18-live");
  const report = runCatalogAudit(snapshot, [{ type: "unit", inputName: "阿狸", origin: "generated_stress", expectedIds: ["B"] }]);
  assert.equal(report.generatedStress.exactCollisionsExcluded, 1);
  assert.equal(report.generatedStress.evaluable, 0);
  assert.equal(report.rows[0].exactPreserved, true);
  assert.equal(report.invariantsPass, true);
});

test("invalid or out-of-catalog labels fail instead of contributing misleading metrics", () => {
  const snapshot = snapshotFromCache(cacheFixture(), "set18-live");
  assert.throws(() => runCatalogAudit(snapshot, [{ type: "unit", inputName: "阿丽", origin: "generated_stress", expectedIds: ["Other_Season"] }]), /frozen catalog/u);
  assert.throws(() => runCatalogAudit(snapshot, [{ type: "unit", inputName: "", origin: "local_qa" }]), /Invalid audit case/u);
  assert.throws(() => extractObservedNames(cacheFixture(), "set18-live", "real_user_guess"), /Invalid source kind/u);
});
