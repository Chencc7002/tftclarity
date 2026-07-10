import test from "node:test";
import assert from "node:assert/strict";
import {
  MemoryCacheStore,
  createCatalog,
  createChatStructuredParser,
  recommendForInput,
  resolveStructuredParserConfig
} from "../src/index.js";
import {
  createSmallWindowRuntimeAsync,
  handleRecommendRequest,
  resolveSmallWindowStructuredParserConfig
} from "../src/app/small-window-server.js";

const fixtureRows = [
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [120, 100, 90, 80, 60, 40, 30, 20]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_LastWhisper|TFT_Item_Deathblade",
    placement_count: [60, 55, 50, 50, 40, 30, 20, 10]
  }
];

function fakeChatResponse(content) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        choices: [
          {
            message: {
              content
            }
          }
        ]
      };
    }
  };
}

test("chat structured parser posts the prompt contract and parses JSON responses", async () => {
  const calls = [];
  const parser = createChatStructuredParser({
    endpoint: "https://llm.local/v1/chat/completions",
    model: "test-model",
    apiKey: "secret",
    promptText: "Return strict JSON.",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return fakeChatResponse("```json\n{\"entities\":{\"unit_mentions\":[\"霞\"]},\"needs_clarification\":false}\n```");
    }
  });

  const output = await parser({
    input: "羽毛女怎么带",
    parsed: {
      intent: "unit_best_3_items",
      parser: {
        entityMatches: []
      }
    },
    catalogSummary: {
      units: 1,
      items: 13,
      traits: 1
    }
  });

  assert.deepEqual(output.entities.unit_mentions, ["霞"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://llm.local/v1/chat/completions");
  assert.equal(calls[0].init.headers.authorization, "Bearer secret");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "test-model");
  assert.equal(body.response_format.type, "json_object");
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[1].content, /羽毛女怎么带/);
  assert.match(body.messages[1].content, /already_parsed/);
});

test("structured parser config is disabled by default and validates enabled provider settings", () => {
  assert.deepEqual(resolveStructuredParserConfig({}, {}), {
    enabled: false,
    provider: "off",
    mode: "auto"
  });

  assert.throws(() => resolveStructuredParserConfig({
    provider: "chat"
  }, {}), /missing: TFT_AGENT_LLM_ENDPOINT, TFT_AGENT_LLM_MODEL/);

  assert.deepEqual(resolveSmallWindowStructuredParserConfig({}, {
    TFT_AGENT_LLM_PROVIDER: "chat",
    TFT_AGENT_LLM_ENDPOINT: "https://llm.local/v1/chat/completions",
    TFT_AGENT_LLM_MODEL: "test-model",
    TFT_AGENT_LLM_MODE: "always",
    TFT_AGENT_LLM_TIMEOUT_MS: "2500"
  }), {
    enabled: true,
    provider: "chat",
    mode: "always",
    endpoint: "https://llm.local/v1/chat/completions",
    model: "test-model",
    apiKey: undefined,
    timeoutMs: 2500,
    temperature: 0,
    maxTokens: 500,
    includeResponseFormat: true
  });
});

test("small-window runtime wires configured structured parser into recommendations", async () => {
  let calls = 0;
  const runtime = await createSmallWindowRuntimeAsync({
    cacheStore: new MemoryCacheStore(),
    catalog: createCatalog(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    llmFetch: async () => {
      calls += 1;
      return fakeChatResponse(JSON.stringify({
        intent: "unit_best_3_items",
        entities: {
          unit_mentions: ["霞"],
          item_mentions: ["羊刀"]
        },
        constraints: {
          item_count: 3,
          item_policy: "ordinary_only"
        },
        needs_clarification: false,
        clarification_question: null
      }));
    },
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      response: fixtureRows
    })
  }, {
    TFT_AGENT_LLM_PROVIDER: "chat",
    TFT_AGENT_LLM_ENDPOINT: "https://llm.local/v1/chat/completions",
    TFT_AGENT_LLM_MODEL: "test-model"
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: "羽毛女有鬼索刀怎么带"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(calls, 1);
  assert.equal(payload.query.unit, "TFT17_Xayah");
  assert.deepEqual(payload.lockedItems.map((item) => item.apiName), ["TFT_Item_GuinsoosRageblade"]);
  assert.equal(payload.cards.length, 2);
});
