import assert from "node:assert/strict";
import test from "node:test";
import { createReactDecisionProvider } from "../src/react/react-decision-provider.js";
import { MemoryCacheStore } from "../src/index.js";
import {
  createSmallWindowRuntimeAsync,
  getSmallWindowRuntimeStatus,
  resolveTieredLlmConfig
} from "../src/app/small-window-server.js";

test("ReAct append_only keeps static toolCatalog prefix byte-identical across turns and post-evidence steps", async () => {
  const bodies = [];
  const toolCatalog = [
    { name: "entity_catalog_query", inputSchema: { type: "object" } },
    { name: "unit_builds", inputSchema: { type: "object" } },
    { name: "comps_trends", inputSchema: { type: "object" } },
    { name: "emblem_rankings", inputSchema: { type: "object" } }
  ];
  const provider = createReactDecisionProvider({
    endpoint: "https://example.test/v1/chat/completions",
    model: "deepseek-v4-flash",
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return {
        ok: true,
        async json() {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  schemaVersion: "react-action.v1",
                  type: "finish",
                  answer: "已完成分析。",
                  evidenceIds: [],
                  reasonCode: "direct_answer",
                  narrative: null
                })
              }
            }],
            usage: { prompt_cache_hit_tokens: 2400, prompt_cache_miss_tokens: 180, completion_tokens: 24 }
          };
        }
      };
    }
  });

  // Step 1: initial turn before tool evidence
  const step1State = {
    question: "今天有哪些上升阵容？",
    seasonContextId: "set19-pbe",
    locale: "zh-CN",
    evidence: [],
    transcript: []
  };
  await provider({ state: step1State, toolCatalog });

  // Step 2: same turn AFTER comps_trends evidence arrives (triggers trendSummaryGuidance)
  const step2State = {
    ...step1State,
    evidence: [{ evidenceId: "ev-1", toolName: "comps_trends", temporalStatus: "current", value: { rising: [], falling: [] } }],
    transcript: [
      { type: "decision", value: { schemaVersion: "react-action.v1", type: "call_tool", tool: "comps_trends", arguments: {} } },
      { type: "observation", value: { type: "tool_result", tool: "comps_trends", status: "ok", evidenceId: "ev-1" } }
    ]
  };
  await provider({ state: step2State, toolCatalog });

  // Turn B: a completely different user asking an equipment-category question (triggers equipmentCategoryGuidance)
  await provider({
    state: {
      question: "蒙多医生神器推荐",
      seasonContextId: "set19-pbe",
      locale: "zh-CN",
      evidence: [],
      transcript: []
    },
    toolCatalog
  });

  const [m1, m2, m3] = bodies.map((b) => b.messages);

  // Static prefix (messages[0..3]: decisionContract + toolCatalog + emblemGuidance + itemGuidance)
  // MUST be byte-for-byte identical across Step 1, Step 2, AND different user Turn B!
  assert.deepEqual(m1.slice(0, 4), m2.slice(0, 4));
  assert.deepEqual(m1.slice(0, 4), m3.slice(0, 4));

  // Entire Step 1 message list MUST be an exact prefix of Step 2 (intra-loop append-only KV Cache)
  assert.deepEqual(m2.slice(0, m1.length), m1);

  // Post-evidence trend guidance is still present as system message, appended AFTER transcript
  const trendIdx = m2.findIndex((msg) => msg.role === "system" && msg.content.startsWith("composition-trend-summary-guidance.v1"));
  assert.ok(trendIdx > m1.length, "post-evidence guidance must appear after prior transcript to preserve prefix cache");
});

test("resolveTieredLlmConfig supports independent ReAct and lightweight overrides with backward-compatible fallback", async () => {
  const base = {
    enabled: true,
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-v4-flash",
    apiKey: "base-key"
  };

  // Fallback to base when no tiered env vars are set
  const fallback = resolveTieredLlmConfig(base, {}, {}, "TFT_AGENT_LIGHTWEIGHT");
  assert.equal(fallback.model, "deepseek-v4-flash");
  assert.equal(fallback.endpoint, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(fallback.thinkingMode, "disabled");

  // Independent overrides normalize base URL to /chat/completions
  const tiered = resolveTieredLlmConfig(base, {}, {
    TFT_AGENT_LIGHTWEIGHT_MODEL: "qwen-turbo-latest",
    TFT_AGENT_LIGHTWEIGHT_ENDPOINT: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    TFT_AGENT_LIGHTWEIGHT_API_KEY: "lw-key"
  }, "TFT_AGENT_LIGHTWEIGHT");
  assert.equal(tiered.model, "qwen-turbo-latest");
  assert.equal(tiered.endpoint, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.equal(tiered.apiKey, "lw-key");
  assert.equal(resolveTieredLlmConfig(base, { endpoint: "https://other.test/v1" }, {}).apiKey, null);

  // Runtime wires distinct models into reactDecisionProvider vs entitySlangProvider/turnDeltaProvider
  const runtime = await createSmallWindowRuntimeAsync({
    fetchItems: false,
    cacheStore: new MemoryCacheStore()
  }, {
    OPENAI_BASE_URL: "https://api.deepseek.com/v1",
    OPENAI_API_KEY: "base-key",
    MODEL_NAME: "deepseek-v4-flash",
    TFT_AGENT_REACT_DECISION_MODEL: "deepseek-v4-flash",
    TFT_AGENT_LIGHTWEIGHT_MODEL: "qwen-turbo-latest",
    TFT_AGENT_LLM_MODE: "auto"
  });
  try {
    assert.equal(runtime.reactDecisionProvider?.model, "deepseek-v4-flash");
    assert.equal(runtime.entitySlangProvider?.model, "qwen-turbo-latest");
    const status = getSmallWindowRuntimeStatus(runtime);
    assert.equal(status.modelTiering.reactDecision, "deepseek-v4-flash");
    assert.equal(status.modelTiering.lightweight, "qwen-turbo-latest");
  } finally {
    await runtime.cacheStore?.close?.();
    runtime.eventLoopMonitor?.disable?.();
  }
});
