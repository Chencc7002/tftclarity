import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FACET_NAMES,
  NORMALIZED_COMP_IDENTITY_VERSION,
  NORMALIZED_SCHEMA_VERSION,
  normalizedCompIdentity,
  responseDocument,
  validateNormalizedProbe,
  validateRawProbeFixture,
  validateRawProbePair
} from "../src/probes/metatft-comp-guide/contracts.js";
import { normalizeCompGuideProbePair } from "../src/probes/metatft-comp-guide/normalizer.js";

const fixtureRoot = new URL("./fixtures/metatft-comp-guide/", import.meta.url);

async function json(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, fixtureRoot), "utf8"));
}

async function capturedFixtures() {
  return Promise.all([
    json("raw/metatft-409000-17.9.raw.json"),
    json("raw/metatft-409000-17.8.raw.json")
  ]);
}

async function normalizedFixtures() {
  return Promise.all([
    json("normalized/metatft-409000-17.9.normalized.json"),
    json("normalized/metatft-409000-17.8.normalized.json")
  ]);
}

async function assetManifest() {
  return JSON.parse(await readFile(new URL("../src/data/generated/asset-manifest.json", import.meta.url), "utf8"));
}

function refreshDocument(document) {
  return responseDocument(document.url, document.response, {
    status: document.status,
    contentType: document.contentType
  });
}

test("captured raw fixtures validate independently and as one two-patch pair", async () => {
  const fixtures = await capturedFixtures();
  for (const fixture of fixtures) {
    assert.deepEqual(validateRawProbeFixture(fixture), { valid: true, errors: [] });
    assert.match(fixture.capturedAt, /^2026-08-18T/u);
    assert.equal(fixture.identity.sourceCompId, "409000");
    assert.equal(fixture.identity.sourceClusterId, "409");
  }
  assert.deepEqual(validateRawProbePair(fixtures), { valid: true, errors: [] });
});

test("PR1B raw fixture bytes remain immutable through PR1B.5", async () => {
  const expected = new Map([
    ["raw/metatft-409000-17.9.raw.json", "836c609c0c519d6b647be2249a98ecd49d13aaea7f451b0cc6468b6767ebef5b"],
    ["raw/metatft-409000-17.8.raw.json", "73f78b56a13393b568e03b20471e3090b48785565a742a33d6fa363d765848aa"]
  ]);
  for (const [path, digest] of expected) {
    const bytes = await readFile(new URL(path, fixtureRoot));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), digest, path);
  }
});

test("fixture replay is deterministic, schema-valid, and network-free", async () => {
  const raw = await capturedFixtures();
  const expected = await normalizedFixtures();
  const actual = normalizeCompGuideProbePair(raw, await assetManifest());
  assert.deepEqual(actual, expected);
  assert.deepEqual(normalizeCompGuideProbePair(structuredClone(raw), await assetManifest()), expected);
  for (const fixture of actual) {
    assert.deepEqual(validateNormalizedProbe(fixture), { valid: true, errors: [] });
    assert.equal(fixture.safety.probeOnly, true);
    assert.equal(fixture.safety.answerReady, false);
  }
});

test("current patch exposes all six observed facets and previous patch fails closed", async () => {
  const fixtures = await normalizedFixtures();
  const current = fixtures.find((fixture) => fixture.statistics.patchRole === "current");
  const previous = fixtures.find((fixture) => fixture.statistics.patchRole === "previous");
  assert.ok(current);
  assert.ok(previous);
  assert.equal(current.schemaVersion, NORMALIZED_SCHEMA_VERSION);
  assert.equal(previous.schemaVersion, NORMALIZED_SCHEMA_VERSION);
  assert.equal(current.statistics.patch, "17.9");
  assert.equal(previous.statistics.patch, "17.8");
  assert.equal(current.identity.compId, previous.identity.compId);
  assert.ok(current.statistics.games > previous.statistics.games);
  assert.equal(current.guide.binding, "current_unversioned");
  assert.equal(current.guide.observedDuringPatch, "17.9");
  assert.equal(previous.guide.binding, "unavailable_for_requested_patch");
  assert.equal(previous.guide.observedDuringPatch, null);
  assert.equal("patch" in current, false);
  assert.equal("scope" in current, false);

  for (const name of FACET_NAMES) {
    assert.equal(current.guide.facets[name].binding, "current_unversioned", name);
    assert.equal(current.guide.facets[name].status, "observed", name);
    assert.ok(current.guide.facets[name].data.length > 0, name);
    assert.equal(previous.guide.facets[name].binding, "unavailable_for_requested_patch", name);
    assert.equal(previous.guide.facets[name].status, "not_available", name);
    assert.equal(previous.guide.facets[name].reason, "source_endpoint_not_patch_bound", name);
    assert.deepEqual(previous.guide.facets[name].data, [], name);
  }
  assert.equal(current.safety.crossPatchDetailReuse, false);
  assert.equal(previous.safety.crossPatchDetailReuse, false);
});

test("patch switching changes stats but never promotes unbound detail responses", async () => {
  const fixtures = await capturedFixtures();
  const current = fixtures.find((fixture) => fixture.patch.role === "current");
  const previous = fixtures.find((fixture) => fixture.patch.role === "previous");
  assert.notEqual(current.endpoints.compsStats.responseSha256, previous.endpoints.compsStats.responseSha256);
  assert.equal(previous.endpoints.compDetails, null);
  assert.equal(previous.endpoints.compAugmentTiers, null);
  assert.equal(
    previous.bindingProbes.compDetails.canonicalResponseSha256,
    current.endpoints.compDetails.canonicalResponseSha256
  );
  assert.equal(
    previous.bindingProbes.compAugmentTiers.canonicalResponseSha256,
    current.endpoints.compAugmentTiers.canonicalResponseSha256
  );
  const previousStatsUrl = new URL(previous.endpoints.compsStats.url);
  assert.equal(previousStatsUrl.searchParams.get("patch"), "17.8");
  assert.equal(previousStatsUrl.searchParams.get("b_patch"), "");
});

test("every emitted entity reference is exactly resolved or explicitly unmapped", async () => {
  const [current, previous] = await normalizedFixtures();
  assert.equal(previous.entityMappings.length, 0);
  assert.ok(current.entityMappings.some((mapping) => mapping.status === "resolved"));
  assert.ok(current.entityMappings.some((mapping) => mapping.status === "explicitly_unmapped"));
  assert.ok(current.entityMappings.every((mapping) => ["resolved", "explicitly_unmapped"].includes(mapping.status)));
  assert.ok(current.entityMappings.every((mapping) => mapping.guessed === false));
  assert.ok(current.entityMappings.every((mapping) => mapping.providerRef.provider === "MetaTFT"));
  assert.ok(current.entityMappings.filter((mapping) => mapping.status === "explicitly_unmapped").every((mapping) => mapping.canonicalId === null));
  assert.equal(new Set(current.entityMappings.map((mapping) => `${mapping.entityType}:${mapping.providerRef.apiName}`)).size, current.entityMappings.length);
  assert.deepEqual(validateNormalizedProbe(current), { valid: true, errors: [] });
});

test("normalized identity is versioned, Set-scoped, and deterministic", async () => {
  const [current, previous] = await normalizedFixtures();
  assert.equal(current.identity.identityVersion, NORMALIZED_COMP_IDENTITY_VERSION);
  assert.equal(current.identity.set, "TFTSet17");
  assert.equal(current.identity.compId, previous.identity.compId);
  const replay = normalizedCompIdentity({
    tftSet: current.identity.set,
    queue: current.identity.queue,
    sourceCompId: current.identity.sourceAliases.sourceCompId,
    sourceClusterId: current.identity.sourceAliases.clusterId,
    units: [...current.identity.signature.units].reverse(),
    traits: [...current.identity.signature.traits].reverse()
  });
  assert.equal(replay.compId, current.identity.compId);
  const nextSet = normalizedCompIdentity({
    tftSet: "TFTSet18",
    queue: current.identity.queue,
    sourceCompId: current.identity.sourceAliases.sourceCompId,
    sourceClusterId: current.identity.sourceAliases.clusterId,
    units: current.identity.signature.units,
    traits: current.identity.signature.traits
  });
  assert.notEqual(nextSet.compId, current.identity.compId);
});

test("first-carousel data is an observed frequency and cannot validate as causal priority", async () => {
  const [current] = structuredClone(await normalizedFixtures());
  const facet = current.guide.facets.firstCarouselComponents;
  assert.equal(facet.semantics, "observed_frequency");
  assert.ok(Math.abs(facet.data.reduce((sum, row) => sum + row.observedFrequency, 0) - 1) < 1e-12);
  assert.equal("componentPriority" in current.guide.facets, false);
  facet.semantics = "causal_priority";
  assert.equal(validateNormalizedProbe(current).valid, false);
});

test("unmapped augment provider references survive normalization", async () => {
  const [current] = await normalizedFixtures();
  const augment = current.entityMappings.find((mapping) => mapping.entityType === "augment" && mapping.status === "explicitly_unmapped");
  assert.ok(augment);
  assert.match(augment.providerRef.apiName, /^TFT/u);
  assert.equal(augment.canonicalId, null);
});

test("historical guide facets cannot be promoted to observed", async () => {
  const [, previous] = structuredClone(await normalizedFixtures());
  previous.guide.facets.earlyBoards.status = "observed";
  previous.guide.facets.earlyBoards.data = [{ level: 4, units: ["TFT17_Jax"] }];
  delete previous.guide.facets.earlyBoards.reason;
  assert.equal(validateNormalizedProbe(previous).valid, false);
});

test("missing raw identity fails closed", async () => {
  const fixtures = structuredClone(await capturedFixtures());
  delete fixtures[0].identity.sourceCompId;
  const result = validateRawProbePair(fixtures);
  assert.equal(result.valid, false);
  assert.throws(
    () => normalizeCompGuideProbePair(fixtures, { assets: [] }),
    (error) => error?.code === "PROBE_SCHEMA_INVALID"
  );
});

test("stats type mutation fails closed after response hash is refreshed", async () => {
  const fixtures = structuredClone(await capturedFixtures());
  const current = fixtures.find((fixture) => fixture.patch.role === "current");
  const row = current.endpoints.compsStats.response.results.find((entry) => String(entry.cluster) === "409000");
  row.places = "schema-changed";
  current.endpoints.compsStats = refreshDocument(current.endpoints.compsStats);
  assert.deepEqual(validateRawProbePair(fixtures), { valid: true, errors: [] });
  assert.throws(
    () => normalizeCompGuideProbePair(fixtures, { assets: [] }),
    (error) => error?.code === "PROBE_COMP_STATS_MISSING"
  );
});

test("patch metadata mutation fails before normalization", async () => {
  const fixtures = structuredClone(await capturedFixtures());
  fixtures.find((fixture) => fixture.patch.role === "previous").patch.label = "17.7";
  const result = validateRawProbePair(fixtures);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path.includes("compsStats.url")));
  assert.throws(
    () => normalizeCompGuideProbePair(fixtures, { assets: [] }),
    (error) => error?.code === "PROBE_SCHEMA_INVALID"
  );
});

test("missing detail field becomes parse_failed rather than invented guidance", async () => {
  const fixtures = structuredClone(await capturedFixtures());
  const current = fixtures.find((fixture) => fixture.patch.role === "current");
  const previous = fixtures.find((fixture) => fixture.patch.role === "previous");
  delete current.endpoints.compDetails.response.results.early_options;
  delete previous.bindingProbes.compDetails.response.results.early_options;
  current.endpoints.compDetails = refreshDocument(current.endpoints.compDetails);
  previous.bindingProbes.compDetails = refreshDocument(previous.bindingProbes.compDetails);
  assert.deepEqual(validateRawProbePair(fixtures), { valid: true, errors: [] });
  const normalized = normalizeCompGuideProbePair(fixtures, await assetManifest());
  assert.equal(normalized[0].guide.facets.earlyBoards.status, "parse_failed");
  assert.deepEqual(normalized[0].guide.facets.earlyBoards.data, []);
  assert.equal(normalized[1].guide.facets.earlyBoards.status, "not_available");
});

test("cross-patch detail activation is rejected as contamination", async () => {
  const fixtures = structuredClone(await capturedFixtures());
  const previous = fixtures.find((fixture) => fixture.patch.role === "previous");
  previous.endpoints.compDetails = structuredClone(previous.bindingProbes.compDetails);
  const result = validateRawProbePair(fixtures);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.message.includes("must not be active evidence")));
});

test("entity mapping removal and guessed mapping mutations invalidate normalized output", async () => {
  const [current] = structuredClone(await normalizedFixtures());
  current.entityMappings.shift();
  assert.equal(validateNormalizedProbe(current).valid, false);

  const [second] = structuredClone(await normalizedFixtures());
  second.entityMappings[0].guessed = true;
  assert.equal(validateNormalizedProbe(second).valid, false);
});
