import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sha256 } from "../src/experiments/unit-play-guidance-control/content.js";
import { runCompletionV4Preflight } from "../src/experiments/unit-play-guidance-completion-v4/preflight.js";
import { COMPLETION_V4_AUTH_SCHEMA, authorizeCompletionV4Run,
  runCompletionV4Experiment } from "../src/experiments/unit-play-guidance-completion-v4/canonical.js";
import { createForwardScriptedTransport } from "../src/experiments/unit-play-guidance-forward/scripted-transport.js";

const load = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const raw = async (path) => createHash("sha256").update(await readFile(new URL(path, import.meta.url))).digest("hex");
const config = await load("../eval/skills/unit-play-guidance-completion-v4/config.v4.json");
const corpus = await load("../eval/skills/unit-play-guidance-forward/corpus.v2.json");
const observations = await load("../eval/skills/unit-play-guidance-forward/tool-observations.v2.json");
const sourcePreflight = await load("../eval/skills/unit-play-guidance-forward/preflight-result.v2.json");
const preflightResult = await load("../eval/skills/unit-play-guidance-completion-v4/preflight-result.v4.json");
const manifest = await load("../eval/skills/unit-play-guidance-completion-v4/run-manifest.v4.json");

test("adaptive v4 zero-call preflight freezes candidate-only reliability without an efficacy claim", () => {
  const current = runCompletionV4Preflight({ config, corpus, observations, sourcePreflight });
  assert.deepEqual(current, preflightResult);
  assert.equal(current.status, "passed");
  assert.equal(current.plan.plannedAgentRuns, 90);
  assert.equal(current.plan.actualProviderModelCalls, 0);
  assert.equal(config.adaptiveDisclosure.pairedEfficacyClaimAllowed, false);
  assert.equal(config.authorization.productionControl, false);
});

test("v4 authorization binds the adaptive scope, commit, config, and 1000-request limit", () => {
  const commit = "d".repeat(40);
  const providerAuthorization = { schemaVersion: COMPLETION_V4_AUTH_SCHEMA,
    experimentId: config.experimentId, authorizationId: "test", approved: true,
    scope: "one_adaptive_candidate_reliability_run", approvedCommitSha: commit,
    configNormalizedSha256: sha256(config), maxAgentRuns: 90,
    limits: { providerHttpRequestHardCap: 1000, totalTokenHardCap: null } };
  const authorization = authorizeCompletionV4Run({ config, preflightResult, transportMode: "real_provider",
    cliAuthorized: true, environmentAuthorization: "1", apiKey: "test", worktreeClean: true,
    implementationCommitSha: commit, providerAuthorization });
  assert.equal(authorization.providerCallsAuthorized, true);
  assert.throws(() => authorizeCompletionV4Run({ config, preflightResult, transportMode: "real_provider",
    cliAuthorized: true, environmentAuthorization: "1", apiKey: "test", worktreeClean: true,
    implementationCommitSha: "e".repeat(40), providerAuthorization }), /binding mismatch/u);
});

test("v4 scripted transport completes 90 candidate runs and emits review artifacts with zero Provider calls", async () => {
  const transport = createForwardScriptedTransport();
  const authorization = authorizeCompletionV4Run({ config, preflightResult, transportMode: "fake_test" });
  const output = await runCompletionV4Experiment({ config, corpus, observations, preflightResult,
    authorization, fetchImpl: transport.fetchImpl });
  assert.equal(output.result.status, "awaiting_independent_review");
  assert.equal(output.result.plan.completedAgentRuns, 90);
  assert.equal(output.result.actualProviderModelCalls, 0);
  assert.deepEqual(output.result.aggregate.reliability,
    { nativeCompletionsPass: true, coveredCasesPass: true });
  assert.equal(output.result.aggregate.exactFrozenToolSequences, 90);
  assert.equal(output.review.packet.entries.length, 90);
  assert.equal(output.review.labels.length, 2);
  assert.equal(output.review.labels.every((entry) => entry.labels.length === 540), true);
  assert.equal(transport.snapshot().requests, 810);
});

test("v4 stops early once reliability gates are mathematically unreachable", async () => {
  const earlyFallback = async () => {
    const body = { choices: [{ message: { content: JSON.stringify({ schemaVersion: "react-action.v1",
      type: "finish", answer: "evidence unavailable", evidenceIds: [], reasonCode: "insufficient_evidence",
      narrative: null }) } }], model: "deepseek-v4-flash-test", system_fingerprint: "completion-v4-test",
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    const make = () => ({ ok: true, status: 200, async json() { return structuredClone(body); }, clone: make });
    return make();
  };
  const authorization = authorizeCompletionV4Run({ config, preflightResult, transportMode: "fake_test" });
  const output = await runCompletionV4Experiment({ config, corpus, observations, preflightResult,
    authorization, fetchImpl: earlyFallback });
  assert.equal(output.result.status, "inconclusive");
  assert.equal(output.result.stopReason, "native_model_completion_gate_unreachable");
  assert.equal(output.result.plan.completedAgentRuns, 10);
  assert.equal(output.result.aggregate.maxNativeModelCompletions, 80);
  assert.equal(output.review.packet.entries.length, 0);
  assert.deepEqual(output.review.labels, []);
});

test("v4 manifest pins the adaptive implementation and keeps Provider and production locked", async () => {
  assert.equal(manifest.authorization.realProviderRun, false);
  assert.equal(manifest.authorization.productionControl, false);
  assert.equal(manifest.classification.includes("no paired efficacy claim"), true);
  assert.equal(await raw("../src/experiments/unit-play-guidance-completion-v4/preflight.js"),
    manifest.implementation.preflightRawSha256);
  assert.equal(await raw("../src/experiments/unit-play-guidance-completion-v4/canonical.js"),
    manifest.implementation.canonicalRawSha256);
  assert.equal(await raw("../scripts/run-unit-play-guidance-completion-v4.mjs"),
    manifest.implementation.formalRunnerRawSha256);
  assert.equal(await raw("../scripts/run-unit-play-guidance-completion-v4-dry-run.mjs"),
    manifest.implementation.dryRunnerRawSha256);
});
