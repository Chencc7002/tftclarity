import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MemoryCacheStore, createCatalog } from "../src/index.js";
import {
  createSmallWindowRuntime,
  getSmallWindowRuntimeStatus,
  handleConclusionStatusRequest,
  handleFeedbackRequest,
  handleRecommendRequest,
  resolveSmallWindowConclusionConfig,
  streamConclusionResponse
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

test("deferred conclusions return deterministic cards before starting the provider", async () => {
  let releaseProvider;
  let providerCalls = 0;
  const providerGate = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  const runtime = runtimeWith(async () => {
    providerCalls += 1;
    await providerGate;
    return providerOutput();
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: "霞已有羊刀怎么补？",
    deferConclusion: true,
    preferences: { conclusionMode: "on" }
  }, runtime, { visitor: { scope: "mini-user-a" } });

  assert.equal(statusCode, 200);
  assert.equal(payload.cards[0].items.length, 3);
  assert.equal(payload.answer.generatedConclusion.status, "pending");
  assert.equal(providerCalls, 0);

  const denied = handleConclusionStatusRequest(runtime, payload.answer.generatedConclusion.jobId, "mini-user-b");
  assert.equal(denied.statusCode, 404);

  const statusUrl = new URL(payload.answer.generatedConclusion.statusUrl, "https://tftclarity.cn");
  const started = handleConclusionStatusRequest(
    runtime,
    statusUrl.searchParams.get("jobId"),
    "mini-user-b",
    statusUrl.searchParams.get("token")
  );
  assert.equal(started.payload.status, "pending");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(providerCalls, 1);

  releaseProvider();
  await runtime.conclusionJobs.get(payload.answer.generatedConclusion.jobId).promise;
  const complete = handleConclusionStatusRequest(runtime, payload.answer.generatedConclusion.jobId, "mini-user-a");
  assert.equal(complete.payload.status, "complete");
  assert.equal(complete.payload.conclusion.content.headline, providerOutput().headline);
});

test("conclusion stream emits validated text one Unicode character at a time", async () => {
  const runtime = runtimeWith(async () => providerOutput(), {
    cacheTtlMs: 0
  });
  runtime.conclusionStreamIntervalMs = 0;
  const { payload } = await handleRecommendRequest({
    input: "霞已有羊刀怎么补？",
    deferConclusion: true,
    preferences: { conclusionMode: "on" }
  }, runtime);
  const chunks = [];
  const response = {
    destroyed: false,
    writableEnded: false,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    write(value) {
      chunks.push(value);
      return true;
    },
    end() {
      this.writableEnded = true;
    }
  };

  await streamConclusionResponse(
    {},
    response,
    runtime,
    payload.answer.generatedConclusion.jobId
  );

  const events = chunks.join("").trim().split("\n").map((line) => JSON.parse(line));
  const deltas = events.filter((event) => event.type === "delta");
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /application\/x-ndjson/u);
  assert.ok(deltas.length > 10);
  assert.ok(deltas.every((event) => Array.from(event.text).length === 1));
  assert.match(deltas.map((event) => event.text).join(""), /围绕羊刀补齐无尽与巨杀/u);
  assert.equal(events.at(-1).type, "complete");
  assert.equal(events.at(-1).conclusion.status, "generated");
});

test("semantic evidence sent to the conclusion model is returned as expandable safe evidence", async () => {
  let providerRequest;
  const result = buildConclusionResult({
    retrievalPlan: {
      schemaVersion: "retrieval_plan.v1",
      intent: "unit_build_completion",
      structuredQueries: [],
      semanticQueries: [{
        id: "semantic:static",
        query: "霞已有羊刀怎么补？",
        types: ["item_description"],
        patch: "current",
        locale: "zh-CN",
        topK: 2
      }],
      evidenceBudget: { maxItems: 40, maxCharacters: 16000 },
      requiredEvidence: [],
      promptKey: "unit-build-rankings",
      needsClarification: false,
      warnings: []
    }
  });
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    metaTFTClient: {},
    compsClient: {},
    fetchItems: false,
    semanticRetriever: {
      async search() {
        return [{
          id: "current:zh-CN:item_description:TFT_Item_GuinsoosRageblade",
          documentType: "item_description",
          score: 0.97,
          apiName: "TFT_Item_GuinsoosRageblade",
          patch: "current",
          locale: "zh-CN",
          source: "tencent_official_tft_catalog",
          metadata: {
            content: "羊刀每秒获得7%可叠加的攻击速度。",
            canonicalName: "鬼索的狂暴之刃",
            aliases: ["羊刀"]
          }
        }];
      }
    },
    conclusionProvider: async (request) => {
      providerRequest = request;
      return providerOutput();
    },
    conclusionGeneratorConfig: {
      enabled: true,
      mode: "on",
      provider: "injected",
      model: "fixture-model"
    },
    recommendForInputImpl: async () => structuredClone(result)
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: "霞已有羊刀怎么补？",
    preferences: { conclusionMode: "on" }
  }, runtime);
  assert.equal(statusCode, 200);
  assert.equal(providerRequest.evidence.semanticEvidence.length, 1);
  assert.equal("score" in providerRequest.evidence.semanticEvidence[0], false);
  assert.equal(payload.answer.generatedConclusion.supportingEvidence.length, 1);
  assert.match(payload.answer.generatedConclusion.supportingEvidence[0].text, /7%/u);
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
