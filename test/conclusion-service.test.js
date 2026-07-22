import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MemoryCacheStore,
  createCatalog,
  generateEvidenceBackedConclusion,
  makeConclusionCacheKey
} from "../src/index.js";

const resultFixture = JSON.parse(readFileSync(new URL("./fixtures/conclusion-fixture.json", import.meta.url), "utf8"));
const buildResult = (overrides = {}) => ({ ...structuredClone(resultFixture), ...overrides });

const catalog = createCatalog();

function output(evidence = {}) {
  return {
    schemaVersion: "llm_conclusion.v2",
    contractId: evidence.questionContract?.contractId ?? "test-contract",
    status: "ok",
    addressedDimensions: ["build_performance", "core_item_tendency", "sample_risk"],
    missingDimensions: [],
    missingEvidence: [],
    headline: "围绕羊刀补齐无尽与巨杀",
    summary: "当前统计口径下，第一套完整出装的前四率最高，可优先参考。",
    reasons: [
      { dimension: "build_performance", evidenceIds: ["build:1"], text: "该组合前四率为61.2%，样本1248场。" },
      { dimension: "core_item_tendency", evidenceIds: ["build:1"], text: "当前可见组合都围绕已有装备继续补齐。" },
      { dimension: "sample_risk", evidenceIds: ["build:1"], text: "当前样本可用于复核这套方案。" }
    ],
    alternatives: [{ dimension: "build_performance", evidenceIds: ["build:2"], text: "若更看重登顶率，可参考第二套组合。" }],
    nextAction: "保留已有羊刀，再按散件补齐另外两件。",
    riskNotice: null
  };
}

const config = {
  enabled: true,
  model: "fixture-model",
  promptVersion: "fixture.v1",
  cacheTtlMs: 60000
};

test("conclusion service validates, caches, and reuses generated content", async () => {
  const cacheStore = new MemoryCacheStore();
  let calls = 0;
  const provider = async ({ evidence }) => { calls += 1; return output(evidence); };
  const args = {
    result: buildResult(),
    catalog,
    input: "霞已有羊刀怎么补？",
    config,
    provider,
    cacheStore,
    semanticEvidence: [{
      id: "item-description:rageblade",
      documentType: "item_description",
      text: "鬼索的狂暴之刃是当前版本目录中的装备。",
      source: "official_catalog",
      patch: "current",
      visible: true
    }]
  };
  const first = await generateEvidenceBackedConclusion(args);
  const second = await generateEvidenceBackedConclusion(args);
  assert.equal(first.status, "generated");
  assert.equal(second.status, "generated");
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  assert.equal(first.content.headline, output().headline);
  assert.equal(first.supportingEvidence.length, 1);
  assert.deepEqual(second.supportingEvidence, first.supportingEvidence);
});

test("conclusion service falls back on invalid output without changing the recommendation", async () => {
  const result = buildResult();
  const before = structuredClone(result);
  let calls = 0;
  const conclusion = await generateEvidenceBackedConclusion({
    result,
    catalog,
    input: "霞怎么出装？",
    config,
    provider: async ({ evidence }) => {
      calls += 1;
      return { ...output(evidence), reasons: [{ dimension: "build_performance", evidenceIds: ["build:1"], text: "前四率99.9%。" }] };
    }
  });
  assert.equal(conclusion.status, "fallback");
  assert.equal(conclusion.reason, "invalid_output");
  assert.equal(calls, 2);
  assert.deepEqual(result, before);
});

test("conclusion service retries once with validator feedback and accepts the correction", async () => {
  const calls = [];
  const conclusion = await generateEvidenceBackedConclusion({
    result: buildResult(),
    catalog,
    input: "霞怎么出装？",
    config,
    provider: async (request) => {
      calls.push(request);
      return calls.length === 1
        ? { ...output(request.evidence), reasons: [{ dimension: "build_performance", evidenceIds: ["build:1"], text: "前四率99.9%。" }] }
        : output(request.evidence);
    }
  });
  assert.equal(conclusion.status, "generated");
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[1].validationFeedback), /unsupported percentage/u);
});

test("conclusion service allows a third correction when validation errors keep converging", async () => {
  const calls = [];
  const conclusion = await generateEvidenceBackedConclusion({
    result: buildResult(),
    catalog,
    input: "霞已有羊刀，剩下两件怎么带？",
    config: { ...config, maxCorrections: 3 },
    provider: async (request) => {
      calls.push(request);
      const candidate = output(request.evidence);
      if (calls.length === 1) {
        candidate.reasons = candidate.reasons.filter((entry) => entry.dimension !== "sample_risk");
        return candidate;
      }
      if (calls.length === 2) {
        candidate.reasons[1].evidenceIds = [
          "item-signal:1", "item-signal:2", "item-signal:3", "item-signal:4", "item-signal:5"
        ];
        return candidate;
      }
      if (calls.length === 3) {
        candidate.alternatives = [{
          dimension: "build_performance",
          evidenceIds: ["build:2"],
          text: "第二套登顶率为20.5%，高于第一套的18.3%。"
        }];
        return candidate;
      }
      candidate.alternatives = [{
        dimension: "build_performance",
        evidenceIds: ["build:1", "build:2"],
        text: "第二套登顶率为20.5%，高于第一套的18.3%。"
      }];
      return candidate;
    }
  });
  assert.equal(conclusion.status, "generated");
  assert.equal(calls.length, 4);
  assert.match(JSON.stringify(calls[1].validationFeedback), /missing_answer_dimension/u);
  assert.match(JSON.stringify(calls[2].validationFeedback), /evidenceIds must contain 1 to 3/u);
  assert.match(JSON.stringify(calls[3].validationFeedback), /unsupported percentage: 18\.3%/u);
});

test("conclusion service classifies non-JSON provider output as invalid output", async () => {
  const conclusion = await generateEvidenceBackedConclusion({
    result: buildResult(),
    catalog,
    input: "霞怎么出装？",
    config,
    provider: async () => {
      throw Object.assign(new Error("invalid JSON"), { code: "invalid_json", recoverable: false });
    }
  });
  assert.equal(conclusion.status, "fallback");
  assert.equal(conclusion.reason, "invalid_output");
});

test("conclusion service retries one recoverable provider error and skips stale evidence", async () => {
  let calls = 0;
  const provider = async ({ evidence }) => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("timeout"), { recoverable: true });
    return output(evidence);
  };
  const generated = await generateEvidenceBackedConclusion({ result: buildResult(), catalog, input: "霞怎么出装？", config, provider });
  assert.equal(generated.status, "generated");
  assert.equal(calls, 2);

  const staleResult = buildResult({ cache: { query: { hit: true, stale: true } } });
  const skipped = await generateEvidenceBackedConclusion({ result: staleResult, catalog, config, provider });
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.reason, "unsafe_state");
  assert.equal(calls, 2);
});

test("conclusion service reports disabled mode without calling a provider", async () => {
  let called = false;
  const conclusion = await generateEvidenceBackedConclusion({
    result: buildResult(), catalog, config: { enabled: false }, provider: async () => { called = true; }
  });
  assert.equal(conclusion.status, "disabled");
  assert.equal(called, false);
});

test("conclusion cache keys isolate evidence, model, base prompt and the selected intent prompt version", () => {
  const evidence = {
    schemaVersion: "llm_evidence_pack.v2",
    request: { intent: "unit_item_rankings", requestedIntent: "unit_item_rankings" },
    recommendations: []
  };
  const baseline = makeConclusionCacheKey(evidence, {
    model: "model-a",
    promptVersion: "provider.v1",
    basePromptVersion: "base.v1",
    intentPromptVersion: "unit-item.v1"
  });
  for (const config of [
    { model: "model-b", promptVersion: "provider.v1", basePromptVersion: "base.v1", intentPromptVersion: "unit-item.v1" },
    { model: "model-a", promptVersion: "provider.v2", basePromptVersion: "base.v1", intentPromptVersion: "unit-item.v1" },
    { model: "model-a", promptVersion: "provider.v1", basePromptVersion: "base.v2", intentPromptVersion: "unit-item.v1" },
    { model: "model-a", promptVersion: "provider.v1", basePromptVersion: "base.v1", intentPromptVersion: "unit-item.v2" }
  ]) {
    assert.notEqual(makeConclusionCacheKey(evidence, config), baseline);
  }
  assert.notEqual(
    makeConclusionCacheKey({ ...evidence, schemaVersion: "llm_evidence_pack.v3" }, {
      model: "model-a",
      promptVersion: "provider.v1",
      basePromptVersion: "base.v1",
      intentPromptVersion: "unit-item.v1"
    }),
    baseline
  );
  const versionedEvidence = {
    ...evidence,
    questionContract: { schemaVersion: "question-contract.v1", contractId: "a".repeat(64) },
    conclusionSpec: { id: "unit_item_rankings.default", version: 1 }
  };
  const versionedBaseline = makeConclusionCacheKey(versionedEvidence, { model: "model-a" });
  assert.notEqual(makeConclusionCacheKey({
    ...versionedEvidence,
    questionContract: { ...versionedEvidence.questionContract, contractId: "b".repeat(64) }
  }, { model: "model-a" }), versionedBaseline);
  assert.notEqual(makeConclusionCacheKey({
    ...versionedEvidence,
    conclusionSpec: { ...versionedEvidence.conclusionSpec, version: 2 }
  }, { model: "model-a" }), versionedBaseline);
  assert.notEqual(makeConclusionCacheKey(versionedEvidence, {
    model: "model-a", validatorVersion: "conclusion-validator.v3"
  }), versionedBaseline);
});
