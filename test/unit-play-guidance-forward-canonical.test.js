import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FORWARD_CANONICAL_PROVIDER_AUTH_SCHEMA,
  FORWARD_CANONICAL_PAIR_ORDER_SHA256,
  auditForwardCanonicalRun,
  authorizeForwardCanonicalRun,
  buildForwardBlindedReviewArtifacts,
  buildForwardIndependentLabelTemplates,
  createForwardCanonicalFuse,
  createForwardFrozenReplayHandlers,
  createForwardProviderIdentityTracker,
  runForwardCanonicalExperiment
} from "../src/experiments/unit-play-guidance-forward/canonical.js";
import { sha256 } from "../src/experiments/unit-play-guidance-control/content.js";
import { createForwardScriptedTransport } from "../src/experiments/unit-play-guidance-forward/scripted-transport.js";

const load = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const config = await load("../eval/skills/unit-play-guidance-forward/config.v2.json");
const corpus = await load("../eval/skills/unit-play-guidance-forward/corpus.v2.json");
const observations = await load("../eval/skills/unit-play-guidance-forward/tool-observations.v2.json");
const preflightResult = await load("../eval/skills/unit-play-guidance-forward/preflight-result.v2.json");
const reviewSchema = await load("../eval/skills/unit-play-guidance-forward/review-schema.v2.json");
const manifest = await load("../eval/skills/unit-play-guidance-forward/run-manifest.v2.json");
const rawSha256 = async (path) => createHash("sha256").update(await readFile(new URL(path, import.meta.url))).digest("hex");

test("v2 call authorization fails closed while the frozen config is locked", () => {
  assert.throws(() => authorizeForwardCanonicalRun({ config, preflightResult, transportMode: "real_provider",
    cliAuthorized: true, environmentAuthorization: "1", apiKey: "test", endpoint: config.provider.endpoint,
    worktreeClean: true, implementationCommitSha: "a".repeat(40) }), /authorization artifact is required/u);
  assert.deepEqual(authorizeForwardCanonicalRun({ config, preflightResult, transportMode: "fake_test" }), {
    transportMode: "fake_test", providerCallsAuthorized: false, actualProviderModelCalls: 0, apiKey: null
  });
});

test("v2 real transport authorization is separately scoped to one commit and the frozen 180-run plan", () => {
  const commit = "a".repeat(40);
  const providerAuthorization = {
    schemaVersion: FORWARD_CANONICAL_PROVIDER_AUTH_SCHEMA,
    experimentId: config.experimentId,
    authorizationId: "test-only",
    scope: "one_formal_paired_run",
    approved: true,
    approvedCommitSha: commit,
    configNormalizedSha256: sha256(config),
    maxAgentRuns: 180,
    limits: { providerHttpRequestHardCap: 1800, totalTokenHardCap: null },
    provider: { hostname: "api.deepseek.com", model: config.provider.model }
  };
  const authorization = authorizeForwardCanonicalRun({ config, preflightResult, transportMode: "real_provider",
    cliAuthorized: true, environmentAuthorization: "1", apiKey: "test", endpoint: config.provider.endpoint,
    worktreeClean: true, implementationCommitSha: commit, providerAuthorization });
  assert.equal(authorization.providerCallsAuthorized, true);
  assert.equal(authorization.authorizationId, "test-only");
  assert.throws(() => authorizeForwardCanonicalRun({ config, preflightResult, transportMode: "real_provider",
    cliAuthorized: true, environmentAuthorization: "1", apiKey: "test", endpoint: config.provider.endpoint,
    worktreeClean: true, implementationCommitSha: "b".repeat(40), providerAuthorization }),
  /not bound to this implementation commit/u);
});

test("global request/token fuse and Provider identity checks fail closed", () => {
  const fuse = createForwardCanonicalFuse();
  fuse.beforeRequest(10_000_000);
  fuse.observePayload({ usage: { total_tokens: 10_000_001 } }, 10_000_000);
  assert.equal(fuse.snapshot().totalTokens, 10_000_001);
  assert.equal(fuse.snapshot().reservationUnderflows, 1);
  assert.equal(fuse.snapshot().exhausted, false);
  assert.throws(() => fuse.observePayload({ usage: null }, 1),
    (error) => error?.code === "hard_cap_enforcement_failure");

  const identity = createForwardProviderIdentityTracker();
  identity.observe({ model: "model-a", system_fingerprint: "fp-a" });
  assert.throws(() => identity.observe({ model: "model-a", system_fingerprint: "fp-b" }),
    (error) => error?.code === "provider_identity_drift");
});

test("frozen replay accepts exact queries and rejects widened or invented queries", async () => {
  const evalCase = corpus.positive[0];
  const accesses = [];
  const handlers = createForwardFrozenReplayHandlers(evalCase, observations, { accesses });
  const fixture = observations.units[evalCase.unitApiName];
  await handlers.unit_details({ apiName: evalCase.unitApiName });
  await handlers.unit_builds({ unit: evalCase.unitApiName });
  const plan = fixture.unitBuilds.value.mechanismQueryPlan;
  await handlers.item_details_batch({ apiNames: plan.apiNames, seasonContextId: plan.seasonContextId });
  await assert.rejects(() => handlers.unit_builds({ unit: evalCase.unitApiName, days: 7 }),
    (error) => error?.code === "frozen_replay_input_mismatch");
  await assert.rejects(() => handlers.item_details({ apiName: plan.apiNames[0] }),
    (error) => error?.code === "frozen_replay_forbidden_lookup");
  assert.equal(accesses.length, 3);
});

test("blinded packet and two reviewer templates keep the key isolated", () => {
  const runs = [{ pairId: "p1", caseId: "c1", repetition: 2, arm: "B", input: "q",
    result: { answer: "a", evidence: [{ evidenceId: "e" }], compositionCards: [{ id: "card" }] } }];
  const blinded = buildForwardBlindedReviewArtifacts(runs, "a".repeat(40));
  assert.equal(blinded.packet.entries.length, 1);
  assert.doesNotMatch(JSON.stringify(blinded.packet.entries), /"arm"|"repetition"|providerUsage|guidanceSha/iu);
  assert.equal(blinded.key.entries[0].arm, "B");
  const labels = buildForwardIndependentLabelTemplates(blinded.packet, ["r1", "r2"]);
  assert.equal(labels.length, 2);
  assert.equal(labels[0].labels.length, 6);
  assert.notEqual(labels[0].reviewerId, labels[1].reviewerId);
});

test("v2 manifest pins the runner, review protocol, and Provider lock", async () => {
  assert.equal(manifest.runtime.pairOrderSha256, FORWARD_CANONICAL_PAIR_ORDER_SHA256);
  assert.equal(manifest.authorization.realProviderPairedRun, false);
  assert.equal(manifest.authorization.productionControl, false);
  assert.equal(manifest.scriptedDryRun.actualProviderModelCalls, 0);
  assert.equal(reviewSchema.reviewersRequired, 2);
  assert.equal(reviewSchema.blinding.excludedFromPacketEntries.includes("rawEvidenceId"), true);
  assert.equal(await rawSha256("../src/experiments/unit-play-guidance-forward/canonical.js"),
    manifest.implementation.canonicalRuntimeRawSha256);
  assert.equal(await rawSha256("../src/experiments/unit-play-guidance-forward/scripted-transport.js"),
    manifest.implementation.scriptedTransportRawSha256);
  assert.equal(await rawSha256("../scripts/run-unit-play-guidance-forward-canonical-dry-run.mjs"),
    manifest.implementation.dryRunScriptRawSha256);
  assert.equal(await rawSha256("../scripts/run-unit-play-guidance-forward-canonical.mjs"),
    manifest.implementation.formalRunnerRawSha256);
});

test("fake transport exercises all 180 canonical runs sequentially with zero actual Provider calls", async () => {
  const fake = createForwardScriptedTransport();
  const authorization = authorizeForwardCanonicalRun({ config, preflightResult, transportMode: "fake_test" });
  const { result, blinded, labels } = await runForwardCanonicalExperiment({ config, corpus, observations,
    preflightResult, authorization, fetchImpl: fake.fetchImpl, blindSeed: "b".repeat(40) });
  assert.equal(result.plan.orderSha256, FORWARD_CANONICAL_PAIR_ORDER_SHA256);
  assert.equal(result.plan.completedAgentRuns, 180);
  assert.equal(result.actualProviderModelCalls, 0);
  assert.equal(result.status, "awaiting_independent_review");
  assert.deepEqual(result.aggregate, { arms: {
    A: { attempted: 90, nativeModelCompletions: 90, nativeModelCompletionRate: 1,
      exactFrozenToolSequences: 90, exactFrozenToolSequenceRate: 1 },
    B: { attempted: 90, nativeModelCompletions: 90, nativeModelCompletionRate: 1,
      exactFrozenToolSequences: 90, exactFrozenToolSequenceRate: 1 }
  }, validPairedRepetitions: 90, casesWithAtLeastTwoValidPairs: 30,
    analyzability: { validPairedRepetitionsPass: true, coveredCasesPass: true } });
  assert.equal(result.fuse.providerHttpRequests, 1620);
  assert.equal(result.fuse.totalTokens, 19_440);
  assert.equal(result.fuse.exhausted, false);
  assert.equal(result.providerIdentity.observations, 1620);
  assert.equal(result.runs.every((run) => run.result.terminationReason === "completed"), true,
    JSON.stringify([...new Set(result.runs.map((run) => run.result.terminationReason))]));
  assert.equal(result.runs.every((run) => run.telemetry.toolCalls === 8), true);
  assert.equal(result.runs.every((run) => run.telemetry.frozenAccesses.length === 8), true);
  assert.equal(result.runs.every((run) => run.telemetry.frozenAccesses.map((entry) => entry.tool).join(",")
    === "unit_details,unit_builds,item_details_batch,comps_rankings,comps_rankings,composition_tactical_details,comps_rankings,composition_tactical_details"), true);
  assert.equal(result.runs.every((run) => run.telemetry.transportRequests === 9), true);
  assert.equal(result.runs.every((run) => run.telemetry.maxConcurrentTransportRequests === 1), true);
  assert.equal(blinded.packet.entries.length, 180);
  assert.equal(blinded.key.entries.length, 180);
  assert.equal(blinded.packet.entries.every((entry) => entry.compositionCards.length === 2
    && entry.compositionCards.every((card) => card.formation?.status === "available")), true);
  assert.doesNotMatch(JSON.stringify(blinded.packet.entries), /"arm"\s*:|"repetition"\s*:|providerUsage|guidanceSha/iu);
  assert.equal(blinded.packet.entries.every((entry) => entry.evidenceSummary.every((item) => !Object.hasOwn(item, "evidenceId"))), true);
  assert.equal(labels.length, 2);
  assert.equal(labels.every((entry) => entry.labels.length === 1080), true);
  assert.equal(fake.snapshot().maxActive, 1);
  assert.equal(fake.snapshot().requests, 1620);
});

test("native completion validity is independent from Tool-sequence adherence", () => {
  const audit = auditForwardCanonicalRun({
    result: { status: "completed_with_warning", terminationReason: "completed", answerOrigin: "model" },
    events: [],
    telemetry: { frozenAccesses: [{ tool: "unit_details" }], maxConcurrentTransportRequests: 1,
      providerLogs: [{ usage: { outputTokens: 1 } }] }
  });
  assert.equal(audit.valid, true);
  assert.equal(audit.checks.exactFrozenToolSequence, false);
});

test("rejected evidence-free finishes remain excluded as system fallbacks", async () => {
  const early = async () => {
    const body = { choices: [{ message: { content: JSON.stringify({ schemaVersion: "react-action.v1",
      type: "finish", answer: "资料不足。", evidenceIds: [], reasonCode: "insufficient_evidence", narrative: null }) } }],
    model: "deepseek-v4-flash-test", system_fingerprint: "early-test",
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    const make = () => ({ ok: true, status: 200, async json() { return structuredClone(body); }, clone: make });
    return make();
  };
  const authorization = authorizeForwardCanonicalRun({ config, preflightResult, transportMode: "fake_test" });
  const { result, blinded, labels } = await runForwardCanonicalExperiment({ config, corpus, observations,
    preflightResult, authorization, fetchImpl: early, blindSeed: "c".repeat(40) });
  assert.equal(result.status, "inconclusive");
  assert.equal(result.aggregate.validPairedRepetitions, 0);
  assert.equal(result.aggregate.arms.A.exactFrozenToolSequences, 0);
  assert.equal(result.aggregate.arms.B.exactFrozenToolSequences, 0);
  assert.equal(blinded.packet.entries.length, 0);
  assert.deepEqual(labels, []);
});

test("canonical runner rejects observation drift before dispatch", async () => {
  const fake = createForwardScriptedTransport();
  const drifted = structuredClone(observations);
  drifted.units[corpus.positive[0].unitApiName].unit.name = "drift";
  const authorization = authorizeForwardCanonicalRun({ config, preflightResult, transportMode: "fake_test" });
  await assert.rejects(() => runForwardCanonicalExperiment({ config, corpus, observations: drifted,
    preflightResult, authorization, fetchImpl: fake.fetchImpl }), (error) => error?.code === "frozen_input_drift");
  assert.equal(fake.snapshot().requests, 0);
});
