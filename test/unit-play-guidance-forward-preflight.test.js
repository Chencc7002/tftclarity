import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildForwardPlan,
  deterministicForwardPairOrder,
  runForwardPreflight
} from "../src/experiments/unit-play-guidance-forward/preflight.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const readJson = (relative) => readFile(path.join(ROOT, relative), "utf8").then(JSON.parse);
const [config, corpus, observations, legacyCorpus, legacyObservations] = await Promise.all([
  readJson("eval/skills/unit-play-guidance-forward/config.v2.json"),
  readJson("eval/skills/unit-play-guidance-forward/corpus.v2.json"),
  readJson("eval/skills/unit-play-guidance-forward/tool-observations.v2.json"),
  readJson("eval/skills/unit-play-guidance-control/corpus.v1.json"),
  readJson("eval/skills/unit-play-guidance-control/tool-observations.v1.json")
]);
const resultPromise = runForwardPreflight({ config, corpus, observations, root: ROOT });

test("forward corpus discloses prior diagnostics and freezes 30/20/10 before formal pairs", () => {
  assert.equal(corpus.frozenBeforeFormalPairedResults, true);
  assert.equal(corpus.diagnosticDisclosure.priorNonFormalHttpDiagnosticsObserved, true);
  assert.equal(corpus.diagnosticDisclosure.formalPairResultsObservedBeforeFreeze, false);
  assert.equal(corpus.positive.length, 30);
  assert.equal(corpus.negative.length, 20);
  assert.equal(corpus.boundary.length, 10);
  assert.equal(new Set(corpus.positive.map((entry) => entry.unitApiName)).size, 10);
  assert.equal(corpus.positive.filter((entry) => entry.language === "en").length, 10);
  assert.ok(corpus.positive.every((entry) => entry.expectedCompositionCards === 2
    && entry.positioningPresentation === "cards_only"));
});

test("forward observations are zero-model registered-tool captures with two cards per unit", () => {
  assert.equal(observations.provenance.providerModelCalls, 0);
  assert.equal(observations.provenance.registeredToolExecutorOnly, true);
  assert.equal(Object.keys(observations.units).length, 10);
  for (const entry of Object.values(observations.units)) {
    assert.equal(entry.unitBuilds.value.mechanismQueryPlan.apiNames.length, 3);
    assert.deepEqual(entry.itemDetailsBatch.value.selection.apiNames,
      entry.unitBuilds.value.mechanismQueryPlan.apiNames);
    assert.equal(entry.initialComps.value.results.slice(0, 2).length, 2);
    assert.equal(entry.cards.length, 2);
    assert.ok(entry.cards.every((card) => card.tacticalDetails.value.formation.units.length >= 5));
  }
});

test("forward plan deterministically interleaves 90 pairs and 180 Agent runs", () => {
  const first = buildForwardPlan(config, corpus);
  const second = buildForwardPlan(config, corpus);
  assert.deepEqual(second, first);
  assert.equal(first.pairCount, 90);
  assert.equal(first.agentRunCount, 180);
  assert.deepEqual(first.pairs[0].order,
    deterministicForwardPairOrder(config.experimentId, corpus.positive[0].caseId, 1));
  assert.ok(first.pairs.some((pair) => pair.order.join("") === "AB"));
  assert.ok(first.pairs.some((pair) => pair.order.join("") === "BA"));
});

test("v2 zero-call preflight passes hashes, receipts, routing, projection and seam gates", async () => {
  const result = await resultPromise;
  assert.equal(result.status, "passed", JSON.stringify(result.gates));
  assert.equal(result.plan.actualProviderModelCalls, 0);
  assert.equal(result.routing.positiveSelected, 30);
  assert.equal(result.routing.negativeFalseTakeover, 0);
  assert.equal(result.routing.boundaryForcedTakeover, 0);
  assert.equal(result.observationsAudit.allValid, true);
  assert.equal(result.seam.onlyGuidanceDiffers, true);
  assert.equal(result.projection.originalUnchanged, true);
  assert.equal(result.projection.deterministic, true);
  assert.ok(Object.values(result.gates).every(Boolean));
});

test("tampered item order fails closed and a call-authorizing mode is rejected", async () => {
  const tampered = structuredClone(observations);
  const first = Object.values(tampered.units)[0];
  first.itemDetailsBatch.value.selection.apiNames.reverse();
  const result = await runForwardPreflight({ config, corpus, observations: tampered, root: ROOT });
  assert.equal(result.status, "failed");
  assert.equal(result.gates.currentFrozenObservations, false);
  assert.equal(result.gates.observationHash, false);
  await assert.rejects(() => runForwardPreflight({
    config: { ...config, mode: "canonical_real_provider" }, corpus, observations, root: ROOT
  }), /invalid or unauthorized forward config/u);
});

test("historical v1 frozen artifacts remain unchanged and separate", () => {
  assert.equal(legacyCorpus.corpusVersion, "unit-play-guidance-control-corpus.2026-08-18.v1");
  assert.equal(legacyObservations.fixtureVersion, "unit-play-guidance-frozen-observations.2026-08-18.v1");
  assert.notEqual(corpus.corpusVersion, legacyCorpus.corpusVersion);
  assert.notEqual(observations.fixtureVersion, legacyObservations.fixtureVersion);
});
