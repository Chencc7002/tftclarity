import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MemoryCacheStore, createCatalog } from "../src/index.js";
import {
  createSmallWindowRuntime,
  getSmallWindowRuntimeStatus,
  handleFeedbackRequest,
  handleRecommendRequest,
  resolveSmallWindowConclusionConfig
} from "../src/app/small-window-server.js";

const resultFixture = JSON.parse(readFileSync(new URL("./fixtures/conclusion-fixture.json", import.meta.url), "utf8"));
const buildConclusionResult = (overrides = {}) => ({ ...structuredClone(resultFixture), ...overrides });

function providerOutput() {
  return {
    schemaVersion: "llm_conclusion.v1",
    status: "ok",
    headline: "围绕羊刀补齐无尽与巨杀",
    summary: "第一套完整出装可作为当前统计口径下的优先参考。",
    reasons: [{ evidenceIds: ["build:1"], text: "该组合前四率为61.2%，样本1248场。" }],
    alternatives: [{ evidenceIds: ["build:2"], text: "若更看重登顶率，可参考第二套组合。" }],
    nextAction: "保留羊刀，再按散件补齐另外两件。",
    riskNotice: null
  };
}

function runtimeWith(provider, config = {}) {
  return createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    metaTFTClient: {},
    compsClient: {},
    fetchItems: false,
    conclusionProvider: provider,
    conclusionGeneratorConfig: {
      enabled: true,
      mode: "on",
      provider: "injected",
      model: "fixture-model",
      promptVersion: "fixture.v1",
      cacheTtlMs: 60000,
      ...config
    },
    recommendForInputImpl: async () => structuredClone(buildConclusionResult())
  });
}

test("small-window HTTP serialization adds generatedConclusion without replacing deterministic cards", async () => {
  const runtime = runtimeWith(async () => providerOutput());
  const { statusCode, payload } = await handleRecommendRequest({
    input: "霞已有羊刀怎么补？",
    preferences: { conclusionMode: "on" }
  }, runtime);
  assert.equal(statusCode, 200);
  assert.equal(payload.answer.generatedConclusion.status, "generated");
  assert.equal(payload.answer.generatedConclusion.content.headline, providerOutput().headline);
  assert.equal(payload.cards[0].items.length, 3);
  assert.equal(payload.text, buildConclusionResult().text);
});

test("small-window keeps HTTP 200 and template facts when the provider fails", async () => {
  const runtime = runtimeWith(async () => { throw new Error("offline"); });
  const original = buildConclusionResult();
  const { statusCode, payload } = await handleRecommendRequest({ input: "霞怎么出装？" }, runtime);
  assert.equal(statusCode, 200);
  assert.equal(payload.answer.generatedConclusion.status, "fallback");
  assert.equal(payload.answer.generatedConclusion.reason, "provider_unavailable");
  assert.equal(payload.cards[0].stats.games, original.rankedBuilds[0].stats.games);
});

test("comp ranking requests with no visible evidence safely skip the LLM conclusion provider", async () => {
  let providerCalls = 0;
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    metaTFTClient: {},
    compsClient: {},
    fetchItems: false,
    conclusionProvider: async () => {
      providerCalls += 1;
      return providerOutput();
    },
    conclusionGeneratorConfig: { enabled: true, mode: "on" },
    recommendForInputImpl: async () => ({
      type: "comp_rankings",
      rankings: {},
      improving: [],
      references: [],
      query: {},
      source: {},
      diagnostics: {}
    })
  });
  const { statusCode, payload } = await handleRecommendRequest({ input: "当前版本阵容" }, runtime);
  assert.equal(statusCode, 200);
  assert.equal(providerCalls, 0);
  assert.equal(payload.answer.generatedConclusion.status, "skipped");
  assert.equal(payload.answer.generatedConclusion.reason, "unsafe_state");
});

test("conclusion configuration and runtime status never expose endpoint or API key values", () => {
  const config = resolveSmallWindowConclusionConfig({}, {
    TFT_AGENT_CONCLUSION_MODE: "on",
    TFT_AGENT_CONCLUSION_PROVIDER: "openai_compatible",
    TFT_AGENT_CONCLUSION_MODEL: "fixture-model",
    TFT_AGENT_CONCLUSION_ENDPOINT: "https://secret.example/v1",
    TFT_AGENT_CONCLUSION_API_KEY: "secret-value"
  });
  const runtime = createSmallWindowRuntime({ conclusionGeneratorConfig: config, metaTFTClient: {}, compsClient: {} });
  const serialized = JSON.stringify(getSmallWindowRuntimeStatus(runtime));
  assert.doesNotMatch(serialized, /secret\.example|secret-value/u);
  assert.equal(getSmallWindowRuntimeStatus(runtime).conclusionGenerator.endpointConfigured, true);
  assert.equal(getSmallWindowRuntimeStatus(runtime).conclusionGenerator.apiKeyConfigured, true);
});

test("explanation feedback uses an independent feedback type", async () => {
  const runtime = runtimeWith(async () => providerOutput());
  const response = await handleFeedbackRequest({
    feedbackType: "good_explanation",
    payload: { feedbackId: "explanation:1", input: "霞怎么出装？", headline: "标题" }
  }, runtime);
  assert.equal(response.ok, true);
  assert.equal(response.feedback.feedbackType, "good_explanation");
});
