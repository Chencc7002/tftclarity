import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildCanonicalRunPlan,
  createProviderIdentityTracker,
  deterministicPairOrder,
  runRealProviderPreflight
} from "../src/experiments/unit-play-guidance-real-provider/preflight.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const readJson = (relative) => fs.readFile(path.join(ROOT, relative), "utf8").then(JSON.parse);
const [config, corpus, fixtures, facetLabelSchema] = await Promise.all([
  readJson("eval/skills/unit-play-guidance-real-provider/config.v1.json"),
  readJson("eval/skills/unit-play-guidance-control/corpus.v1.json"),
  readJson("eval/skills/unit-play-guidance-control/tool-observations.v1.json"),
  readJson("eval/skills/unit-play-guidance-real-provider/facet-label-schema.v1.json")
]);
const resultPromise = runRealProviderPreflight({
  config,
  corpus,
  fixtures,
  root: ROOT,
  apiKeyConfigured: true,
  implementationCommitSha: "preflight-test-sha"
});

test("PR1D config freezes the exact production-like Provider identity without a secret", () => {
  assert.equal(config.mode, "dry_run_zero_provider_calls");
  assert.equal(config.provider.endpoint, "https://api.deepseek.com/chat/completions");
  assert.equal(config.provider.model, "deepseek-v4-flash");
  assert.equal(config.provider.decisionPromptVersion, "react-decision-contract.v5");
  assert.equal(config.provider.messageLayout, "append_only");
  assert.equal(config.provider.temperature, 0);
  assert.equal(config.provider.topP, "omitted_provider_default");
  assert.equal(config.provider.maxOutputTokens, 1800);
  assert.equal(config.provider.repairMaxOutputTokens, 700);
  assert.equal(config.provider.timeoutMs, 25000);
  assert.equal(config.provider.maxActionAttempts, 2);
  assert.equal(config.provider.transportRetries, 0);
  assert.equal(config.provider.cacheNamespace, null);
  assert.equal(config.provider.clientResponseCache, false);
  assert.doesNotMatch(JSON.stringify(config), /api[_-]?key|authorization|bearer\s+/iu);
});

test("canonical plan deterministically interleaves 90 paired repetitions into 180 Agent runs", () => {
  const first = buildCanonicalRunPlan(config, corpus);
  const second = buildCanonicalRunPlan(config, corpus);
  assert.deepEqual(second, first);
  assert.equal(first.pairCount, 90);
  assert.equal(first.agentRunCount, 180);
  assert.equal(first.pairs.every((pair) => pair.order.length === 2 && new Set(pair.order).size === 2), true);
  assert.ok(first.pairs.some((pair) => pair.order.join("") === "AB"));
  assert.ok(first.pairs.some((pair) => pair.order.join("") === "BA"));
  assert.deepEqual(deterministicPairOrder(config.experimentId, corpus.positive[0].caseId, 1), first.pairs[0].order);
});

test("Provider identity tracker aborts on value, disappearance, or late-appearance drift", () => {
  const stable = createProviderIdentityTracker();
  stable.observe({ model: "deepseek-v4-flash", version: "build-1", system_fingerprint: "fp-1" });
  stable.observe({ model: "deepseek-v4-flash", version: "build-1", system_fingerprint: "fp-1" });
  assert.equal(stable.snapshot().immutableIdentityUnavailable, false);

  const changed = createProviderIdentityTracker();
  changed.observe({ model: "deepseek-v4-flash", system_fingerprint: "fp-1" });
  assert.throws(() => changed.observe({ model: "deepseek-v4-flash", system_fingerprint: "fp-2" }), /identity drift/u);

  const disappeared = createProviderIdentityTracker();
  disappeared.observe({ model: "deepseek-v4-flash", version: "build-1" });
  assert.throws(() => disappeared.observe({ model: "deepseek-v4-flash" }), /identity drift/u);

  const appeared = createProviderIdentityTracker();
  appeared.observe({ model: "deepseek-v4-flash" });
  assert.throws(() => appeared.observe({ model: "deepseek-v4-flash", version: "build-1" }), /identity drift/u);

  const unavailable = createProviderIdentityTracker();
  unavailable.observe({ model: "deepseek-v4-flash" });
  unavailable.observe({ model: "deepseek-v4-flash" });
  assert.equal(unavailable.snapshot().immutableIdentityUnavailable, true);
});

test("zero-call preflight passes frozen routing, fallback, hashes, seam, and plan gates", async () => {
  const result = await resultPromise;
  assert.equal(result.status, "passed");
  assert.equal(result.plan.plannedAgentRuns, 180);
  assert.equal(result.plan.pairCount, 90);
  assert.equal(result.plan.actualProviderHttpCalls, 0);
  assert.equal(result.seam.actualProviderHttpCalls, 0);
  assert.equal(result.seam.localCaptureRequests, 2);
  assert.equal(result.seam.defaultMessagesByteIdentical, true);
  assert.equal(result.seam.onlyGuidanceDiffers, true);
  assert.ok(Object.values(result.gates).every(Boolean));
  assert.deepEqual(result.deterministicChecks.routing, {
    positiveEligible: 30,
    positiveTotal: 30,
    negativeFalseTakeover: 0,
    boundaryForcedTakeover: 0,
    secondTaskFrameParses: 0,
    llmSkillRouterCalls: 0,
    addedRoutingOrCompletionModelCalls: 0
  });
  assert.deepEqual(result.deterministicChecks.fallback, {
    total: 5,
    fallbackToPinnedA: 5,
    wrongDestination: 0
  });
});

test("redacted manifest persists only credential presence and production call sites omit renderer", async () => {
  const result = await resultPromise;
  assert.deepEqual(result.manifest.credential, { sourceEnv: "OPENAI_API_KEY", configured: true });
  assert.equal(result.secretAudit.secretMaterialPersisted, 0);
  assert.doesNotMatch(JSON.stringify(result.manifest), /authorizationHeader|bearer\s+/iu);
  assert.deepEqual(result.productionAudit.experimentImports, []);
  assert.deepEqual(result.productionAudit.productionRendererReferences, []);
  assert.deepEqual(result.productionAudit.providerCallSites.map((site) => site.file), ["src/app/small-window-server.js"]);
  assert.equal(result.productionAudit.providerCallSites.every((site) => !site.rendererOptionPresent), true);
});

test("preflight rejects any mode that could imply Provider-call authorization", async () => {
  await assert.rejects(() => runRealProviderPreflight({
    config: { ...config, mode: "canonical_real_provider" },
    corpus,
    fixtures,
    root: ROOT
  }), /Provider calls are not authorized/u);
});

test("blinded facet labels cannot count keywords or composition membership as role evidence", () => {
  assert.equal(facetLabelSchema.label.keywordPresenceSufficient, false);
  assert.equal(facetLabelSchema.label.membershipImpliesCarryOrTank, false);
  assert.equal(facetLabelSchema.label.preserveOriginalIndependentLabels, true);
  assert.equal(facetLabelSchema.label.adjudicationRequiredOnDisagreement, true);
  assert.match(facetLabelSchema.label.coveredRule, /substantive.*evidenceUseValid.*qualificationValid/u);
});
