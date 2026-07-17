import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MemoryCacheStore,
  createCatalog,
  generateEvidenceBackedConclusion
} from "../src/index.js";

const resultFixture = JSON.parse(readFileSync(new URL("./fixtures/conclusion-fixture.json", import.meta.url), "utf8"));
const buildResult = (overrides = {}) => ({ ...structuredClone(resultFixture), ...overrides });

const catalog = createCatalog();

function output() {
  return {
    schemaVersion: "llm_conclusion.v1",
    status: "ok",
    headline: "围绕羊刀补齐无尽与巨杀",
    summary: "当前统计口径下，第一套完整出装的前四率最高，可优先参考。",
    reasons: [{ evidenceIds: ["build:1"], text: "该组合前四率为61.2%，样本1248场。" }],
    alternatives: [{ evidenceIds: ["build:2"], text: "若更看重登顶率，可参考第二套组合。" }],
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
  const provider = async () => { calls += 1; return output(); };
  const args = { result: buildResult(), catalog, input: "霞已有羊刀怎么补？", config, provider, cacheStore };
  const first = await generateEvidenceBackedConclusion(args);
  const second = await generateEvidenceBackedConclusion(args);
  assert.equal(first.status, "generated");
  assert.equal(second.status, "generated");
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  assert.equal(first.content.headline, output().headline);
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
    provider: async () => {
      calls += 1;
      return { ...output(), reasons: [{ evidenceIds: ["build:1"], text: "前四率99.9%。" }] };
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
        ? { ...output(), reasons: [{ evidenceIds: ["build:1"], text: "前四率99.9%。" }] }
        : output();
    }
  });
  assert.equal(conclusion.status, "generated");
  assert.equal(calls.length, 2);
  assert.match(calls[1].validationFeedback.join("\n"), /unsupported percentage/u);
});

test("conclusion service classifies non-JSON provider output as invalid output", async () => {
  const conclusion = await generateEvidenceBackedConclusion({
    result: buildResult(),
    catalog,
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
  const provider = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("timeout"), { recoverable: true });
    return output();
  };
  const generated = await generateEvidenceBackedConclusion({ result: buildResult(), catalog, config, provider });
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
