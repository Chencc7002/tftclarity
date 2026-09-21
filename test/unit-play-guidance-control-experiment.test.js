import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  BASELINE_GUIDANCE_SHA256,
  CANDIDATE_SKILL_CONTENT,
  CANDIDATE_SKILL_CONTENT_SHA256,
  PINNED_BASELINE_GUIDANCE_SHA256,
  PINNED_CANDIDATE_SKILL_CONTENT_SHA256
} from "../src/experiments/unit-play-guidance-control/content.js";
import { runUnitPlayGuidanceControlExperiment } from "../src/experiments/unit-play-guidance-control/harness.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const corpusPath = path.join(ROOT, "eval", "skills", "unit-play-guidance-control", "corpus.v1.json");
const fixturePath = path.join(ROOT, "eval", "skills", "unit-play-guidance-control", "tool-observations.v1.json");
const corpus = JSON.parse(await fs.readFile(corpusPath, "utf8"));
const fixtures = JSON.parse(await fs.readFile(fixturePath, "utf8"));
const resultPromise = runUnitPlayGuidanceControlExperiment({ corpus, fixtures, includeCaseDetails: true });

async function productionExperimentImports() {
  const findings = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(ROOT, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (relative === "src/experiments") continue;
        await walk(absolute);
      } else if (entry.isFile() && /\.(?:js|mjs|cjs)$/u.test(entry.name)) {
        const source = await fs.readFile(absolute, "utf8");
        if (/experiments[\\/]unit-play-guidance-control|unit-play-guidance-control[\\/]harness/iu.test(source)) findings.push(relative);
      }
    }
  }
  await walk(path.join(ROOT, "src"));
  return findings;
}

test("PR1C corpus is frozen, versioned, multilingual, and meets 30/20/10 minimums", () => {
  assert.equal(corpus.frozenBeforeCandidateResults, true);
  assert.match(corpus.corpusVersion, /\.v1$/u);
  assert.equal(corpus.positive.length, 30);
  assert.equal(corpus.negative.length, 20);
  assert.equal(corpus.boundary.length, 10);
  assert.ok(corpus.positive.filter((entry) => /\b(?:how|give|explain|what)\b/iu.test(entry.input)).length >= 5);
  assert.ok(corpus.positive.some((entry) => Array.isArray(entry.messages) && entry.messages.length > 0));
  assert.equal(new Set([...corpus.positive, ...corpus.negative, ...corpus.boundary].map((entry) => entry.caseId)).size, 60);
});

test("baseline and candidate content are version-pinned and positioning is conditional", () => {
  assert.equal(BASELINE_GUIDANCE_SHA256, PINNED_BASELINE_GUIDANCE_SHA256);
  assert.equal(CANDIDATE_SKILL_CONTENT_SHA256, PINNED_CANDIDATE_SKILL_CONTENT_SHA256);
  assert.equal(CANDIDATE_SKILL_CONTENT.facets.find((facet) => facet.id === "positioning").requirement, "required_if_supported");
});

test("paired offline run passes routing, safety, value, fallback, and cost gates", async () => {
  const result = await resultPromise;
  assert.equal(result.status, "passed");
  assert.deepEqual(result.routing, {
    positiveEligible: 30,
    positiveTotal: 30,
    negativeFalseTakeover: 0,
    boundaryForcedTakeover: 0,
    secondTaskFrameParses: 0,
    llmSkillRouterCalls: 0,
    addedRoutingOrCompletionModelCalls: 0
  });
  assert.ok(Object.values(result.aggregate.gates).every(Boolean));
  assert.ok(Object.values(result.aggregate.safety).every((metric) => metric.A === 0 && metric.BNative === 0 && metric.BEndToEnd === 0));
});

test("B-native value is evaluated before fallback and B-end-to-end is reported separately", async () => {
  const result = await resultPromise;
  assert.equal(result.aggregate.answerCoverage.BNative.requiredCoverage, 1);
  assert.ok(result.aggregate.answerCoverage.BNative.requiredCoverage >= result.aggregate.answerCoverage.A.requiredCoverage);
  assert.ok(result.aggregate.evidenceCoverage.BNative.requiredCoverage >= result.aggregate.evidenceCoverage.A.requiredCoverage);
  assert.ok(result.aggregate.answerCoverage.valueGain >= 0.10 || result.aggregate.answerCoverage.relativeMissingReduction >= 0.20);
  assert.ok(result.aggregate.answerCoverage.BEndToEnd);
  assert.ok(result.aggregate.evidenceCoverage.BEndToEnd);
  assert.ok(result.aggregate.cost.BEndToEnd);
  assert.equal(result.cases.filter((entry) => entry.fallback.triggered).length, 0);
});

test("all five candidate faults fall back to a clean pinned A run", async () => {
  const result = await resultPromise;
  assert.equal(result.faultInjection.total, 5);
  assert.equal(result.faultInjection.fallbackToPinnedA, 5);
  assert.equal(result.faultInjection.wrongDestination, 0);
  assert.deepEqual(result.faultInjection.cases.map((entry) => entry.fault), [
    "skill_definition_failure",
    "skill_context_failure",
    "candidate_runtime_failure",
    "grounding_rejection",
    "budget_failure"
  ]);
  for (const entry of result.faultInjection.cases) {
    assert.equal(entry.fallbackDestination, "A");
    assert.equal(entry.fallbackGuidanceHash, PINNED_BASELINE_GUIDANCE_SHA256);
    assert.equal(entry.succeeded, true);
  }
});

test("arm mutable state and fixture telemetry are isolated with sentinel proof", async () => {
  const result = await resultPromise;
  assert.deepEqual(result.isolation, {
    baselineAndCandidateStateSnapshotsAreDistinct: true,
    baselineSentinelAbsentFromCandidate: true,
    evidenceIdNamespacesDistinct: true,
    telemetryArraysDistinct: true,
    conversationPersistenceWrites: 0,
    productionHandlerImportsExperiment: 0
  });
  const first = result.cases[0];
  assert.equal(first.A.telemetry.sentinelObserved, "A-only");
  assert.doesNotMatch(JSON.stringify(first.BNative.telemetry.decisionStateSnapshots), /A-only/u);
  assert.notStrictEqual(first.A.telemetry.fixtureAccesses, first.BNative.telemetry.fixtureAccesses);
  assert.ok(first.A.result.evidence.every((entry) => entry.evidenceId.includes("-A-")));
  assert.ok(first.BNative.result.evidence.every((entry) => entry.evidenceId.includes("-B-")));
});

test("same Tool plus arguments replays the same frozen Observation in both arms", async () => {
  const result = await resultPromise;
  for (const entry of result.cases) {
    const key = (access) => `${access.tool}:${JSON.stringify(access.input)}`;
    const a = new Map(entry.A.telemetry.fixtureAccesses.map((access) => [key(access), access.valueHash]));
    const b = new Map(entry.BNative.telemetry.fixtureAccesses.map((access) => [key(access), access.valueHash]));
    assert.deepEqual(b, a);
  }
});

test("unsupported positioning is qualified without tactical Tool retrieval", async () => {
  const result = await resultPromise;
  const unsupportedIds = new Set(corpus.positive.filter((entry) => !entry.positioningSupported).map((entry) => entry.caseId));
  assert.ok(unsupportedIds.size > 0);
  for (const entry of result.cases.filter((value) => unsupportedIds.has(value.caseId))) {
    assert.equal(entry.BNative.answerFacets.qualifiedUnavailable.positioning, true);
    assert.equal(entry.BNative.telemetry.fixtureAccesses.some((access) => access.tool === "composition_tactical_details"), false);
  }
});

test("cost gates use the same deterministic estimator for both arms", async () => {
  const result = await resultPromise;
  const a = result.aggregate.cost.A;
  const b = result.aggregate.cost.BNative;
  assert.ok(b.meanToolCalls <= a.meanToolCalls + 0.5);
  assert.ok(b.p95ToolCalls <= a.p95ToolCalls + 1);
  assert.ok(b.meanReplayLatencyMs <= a.meanReplayLatencyMs * 1.20);
  assert.ok(b.meanTokens <= a.meanTokens * 1.20);
  assert.equal(result.aggregate.efficiency.extraToolCallsPerNewRequiredFacet, 0);
  assert.ok(result.aggregate.efficiency.tokensPerCoveredFacet > 0);
});

test("production source does not import the experiment harness", async () => {
  assert.deepEqual(await productionExperimentImports(), []);
  const productionProvider = await fs.readFile(path.join(ROOT, "src", "react", "react-decision-provider.js"), "utf8");
  assert.doesNotMatch(productionProvider, /unit_play_guidance\.experiment|renderCandidateSkillContext|unit-play-guidance-control/u);
});

test("paired replay is byte-deterministic at the structured result boundary", async () => {
  const first = await resultPromise;
  const second = await runUnitPlayGuidanceControlExperiment({ corpus, fixtures, includeCaseDetails: true });
  assert.deepEqual(second, first);
});
