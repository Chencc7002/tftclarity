import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  authorizeCanonicalRealProviderRun,
  createCanonicalRunFuse,
  PR1D_CANONICAL_PAIR_ORDER_SHA256,
  runCanonicalRealProviderExperiment
} from "../src/experiments/unit-play-guidance-real-provider/canonical.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const readJson = (relative) => fs.readFile(path.join(ROOT, relative), "utf8").then(JSON.parse);
const [config, corpus, fixtures] = await Promise.all([
  readJson("eval/skills/unit-play-guidance-real-provider/config.v1.json"),
  readJson("eval/skills/unit-play-guidance-control/corpus.v1.json"),
  readJson("eval/skills/unit-play-guidance-control/tool-observations.v1.json")
]);

function authorization(overrides = {}) {
  return authorizeCanonicalRealProviderRun({
    cliAuthorized: true,
    environmentAuthorization: "1",
    apiKey: "test-only-not-persisted",
    endpoint: config.provider.endpoint,
    worktreeClean: true,
    preflightStatus: "passed",
    pairOrderSha256: PR1D_CANONICAL_PAIR_ORDER_SHA256,
    implementationCommitSha: "a".repeat(40),
    ...overrides
  });
}

function parsedMessages(body) {
  return body.messages.map((message) => {
    try { return JSON.parse(message.content); } catch { return null; }
  }).filter(Boolean);
}

function fakeCanonicalFetch({ driftAtRequest = Number.POSITIVE_INFINITY } = {}) {
  let active = 0;
  let maxActive = 0;
  let requests = 0;
  const fetchImpl = async (_url, options) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    requests += 1;
    try {
      const body = JSON.parse(options.body);
      const messages = parsedMessages(body);
      const runContext = messages.find((entry) => entry.schemaVersion === "react-run-context.v1");
      const observations = messages.filter((entry) => entry.type === "observation" && entry.value?.type === "tool_result");
      const latest = observations.at(-1)?.value ?? null;
      const affordance = latest?.nextActionAffordance ?? latest?.evidence?.nextActionAffordance ?? null;
      const unit = runContext.taskAnchor.subjects[0].resolvedId;
      const seasonContextId = runContext.seasonContextId;
      let action;
      if (affordance?.recommendedAction === "call_tool" && affordance.callTool) {
        action = {
          schemaVersion: "react-action.v1",
          type: "call_tool",
          tool: affordance.callTool.tool,
          arguments: affordance.callTool.arguments,
          purposeCode: affordance.callTool.purposeCode
        };
      } else if (!observations.some((entry) => entry.value?.tool === "entity_catalog_query" || entry.value?.toolName === "entity_catalog_query")) {
        action = { schemaVersion: "react-action.v1", type: "call_tool", tool: "entity_catalog_query", arguments: { unit, seasonContextId }, purposeCode: "retrieve_entity_details" };
      } else if (!observations.some((entry) => entry.value?.tool === "unit_builds" || entry.value?.toolName === "unit_builds")) {
        action = { schemaVersion: "react-action.v1", type: "call_tool", tool: "unit_builds", arguments: { unit, seasonContextId }, purposeCode: "retrieve_current_statistics" };
      } else if (!observations.some((entry) => entry.value?.tool === "comps_rankings" || entry.value?.toolName === "comps_rankings")) {
        action = { schemaVersion: "react-action.v1", type: "call_tool", tool: "comps_rankings", arguments: { unit, seasonContextId }, purposeCode: "retrieve_current_statistics" };
      } else {
        const evidenceIds = observations.map((entry) => entry.value?.evidence?.evidenceId).filter(Boolean);
        action = {
          schemaVersion: "react-action.v1",
          type: "finish",
          answer: "当前证据已覆盖单位定位、装备逻辑和阵容语境；站位与选择时机只在证据明确时采用。",
          evidenceIds,
          reasonCode: "sufficient_evidence",
          narrative: null
        };
      }
      const payload = {
        model: requests >= driftAtRequest ? "deepseek-provider-build-drift" : "deepseek-provider-build-test",
        system_fingerprint: "fp-test-1",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(action) } }],
        usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 }
      };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    } finally {
      active -= 1;
    }
  };
  return { fetchImpl, snapshot: () => ({ requests, maxActive }) };
}

test("real-provider unlock requires every explicit gate and never returns the credential", () => {
  const approved = authorization();
  assert.equal(approved.providerCallsAuthorized, true);
  assert.equal(approved.credentialConfigured, true);
  assert.equal(approved.credentialBindingConfirmedFor, "api.deepseek.com");
  assert.doesNotMatch(JSON.stringify(approved), /test-only-not-persisted/u);

  assert.throws(() => authorization({ cliAuthorized: false }), /missing --canonical-real-provider/u);
  assert.throws(() => authorization({ environmentAuthorization: "0" }), /must equal 1/u);
  assert.throws(() => authorization({ apiKey: "" }), /is not configured/u);
  assert.throws(() => authorization({ endpoint: "https://example.com/chat" }), /api\.deepseek\.com/u);
  assert.throws(() => authorization({ worktreeClean: false }), /worktree must be clean/u);
  assert.throws(() => authorization({ preflightStatus: "failed" }), /preflight must pass/u);
  assert.throws(() => authorization({ pairOrderSha256: "drift" }), /pair order hash drifted/u);
});

test("global fuse freezes 4M tokens, 1500 HTTP requests, and pair concurrency 1", () => {
  const tokenFuse = createCanonicalRunFuse();
  tokenFuse.beforeRequest();
  tokenFuse.observePayload({ usage: { prompt_tokens: 3_999_999, completion_tokens: 1, total_tokens: 4_000_000 } });
  assert.equal(tokenFuse.snapshot().exhaustedReason, "total_token_hard_cap");
  assert.throws(() => tokenFuse.beforeRequest(), /token hard cap|fuse is open/iu);

  const requestFuse = createCanonicalRunFuse();
  for (let index = 0; index < 1_500; index += 1) requestFuse.beforeRequest();
  assert.equal(requestFuse.snapshot().exhaustedReason, "provider_http_request_hard_cap");
  assert.throws(() => requestFuse.beforeRequest(), /HTTP-request hard cap|fuse is open/iu);
  assert.deepEqual(requestFuse.snapshot().limits, {
    totalTokenHardCap: 4_000_000,
    providerHttpRequestHardCap: 1_500,
    pairConcurrency: 1
  });
  assert.throws(() => createCanonicalRunFuse({
    totalTokenHardCap: 4_000_001,
    providerHttpRequestHardCap: 1_500,
    pairConcurrency: 1
  }), /limits must remain frozen/u);
});

test("fake transport executes the frozen 180-run plan sequentially and emits blinded artifacts", async () => {
  const fake = fakeCanonicalFetch();
  const { result, blinded } = await runCanonicalRealProviderExperiment({
    config,
    corpus,
    fixtures,
    authorization: authorization(),
    apiKey: "test-only-not-persisted",
    fetchImpl: fake.fetchImpl
  });
  assert.equal(result.status, "awaiting_facet_adjudication");
  assert.equal(result.plan.plannedAgentRuns, 180);
  assert.equal(result.plan.completedAgentRuns, 180);
  assert.equal(result.plan.orderSha256, PR1D_CANONICAL_PAIR_ORDER_SHA256);
  assert.equal(result.abort, null);
  assert.equal(result.aggregate.reliability.candidateSkillFailures, 0);
  assert.equal(result.aggregate.validPairedRepetitions, 90);
  assert.equal(result.aggregate.casesWithAtLeastTwoValidPairs, 30);
  assert.equal(result.providerIdentity.baseline.model, "deepseek-provider-build-test");
  assert.equal(result.providerIdentity.baseline.system_fingerprint, "fp-test-1");
  assert.equal(result.fuse.responsesWithoutUsage, 0);
  assert.equal(fake.snapshot().maxActive, 1);
  assert.equal(fake.snapshot().requests, result.fuse.providerHttpRequests);
  assert.equal(blinded.packet.entries.length, 180);
  assert.equal(blinded.key.entries.length, 180);
  assert.equal(blinded.packet.entries.some((entry) => Object.hasOwn(entry, "arm")), false);
  assert.doesNotMatch(JSON.stringify({ result, blinded }), /test-only-not-persisted/u);
});

test("Provider identity drift aborts the canonical attempt before a third HTTP request", async () => {
  const fake = fakeCanonicalFetch({ driftAtRequest: 2 });
  const { result } = await runCanonicalRealProviderExperiment({
    config,
    corpus,
    fixtures,
    authorization: authorization(),
    apiKey: "test-only-not-persisted",
    fetchImpl: fake.fetchImpl
  });
  assert.equal(result.status, "inconclusive");
  assert.equal(result.abort.code, "provider_identity_drift");
  assert.equal(result.plan.completedAgentRuns, 0);
  assert.equal(result.fuse.providerHttpRequests, 2);
  assert.equal(fake.snapshot().requests, 2);
});

test("candidate context drift is an immediate candidate_skill_failure before Provider HTTP", async () => {
  const fake = fakeCanonicalFetch();
  const driftedConfig = structuredClone(config);
  driftedConfig.frozen.candidateRenderedContextSha256 = "0".repeat(64);
  await assert.rejects(() => runCanonicalRealProviderExperiment({
    config: driftedConfig,
    corpus,
    fixtures,
    authorization: authorization(),
    apiKey: "test-only-not-persisted",
    fetchImpl: fake.fetchImpl
  }), (error) => error?.code === "candidate_skill_failure");
  assert.equal(fake.snapshot().requests, 0);
});
