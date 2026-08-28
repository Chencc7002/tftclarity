import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryCacheStore,
  createCatalog
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleRecommendRequest,
  startSmallWindowServer
} from "../src/app/small-window-server.js";

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function instrumentedRuntime(options = {}) {
  const calls = {
    metatft: 0,
    rag: 0,
    recommendation: 0,
    llm: 0,
    turnDelta: 0
  };
  const fail = (name) => async () => {
    calls[name] += 1;
    throw new Error(`${name} must not be called`);
  };
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    conversationStateV2Mode: options.conversationStateV2Mode ?? "off",
    metaTFTClient: {
      getItems: fail("metatft"),
      getUnitsUnique: fail("metatft"),
      getTraits: fail("metatft")
    },
    compsClient: {},
    semanticRetriever: {
      search: fail("rag")
    },
    turnDeltaProvider: fail("turnDelta"),
    structuredParser: fail("llm"),
    conclusionProvider: fail("llm"),
    coachProvider: fail("llm"),
    recommendForInputImpl: async (input) => {
      calls.recommendation += 1;
      return {
        type: "clarification",
        text: `existing-flow:${input}`,
        query: {},
        clarification: {
          needsClarification: true,
          question: "existing flow reached"
        },
        rankedBuilds: [],
        results: []
      };
    }
  });
  return { runtime, calls };
}

test("system interactions bypass MetaTFT, RAG, LLM, EvidenceBundle, and TurnDelta", async () => {
  const { runtime, calls } = instrumentedRuntime({ conversationStateV2Mode: "on" });
  const cases = [
    ["你好", "greeting"],
    ["你能做什么", "capability_help"],
    ["怎么使用", "usage_help"],
    ["帮我写论文", "out_of_domain"]
  ];
  for (const [input, interactionType] of cases) {
    const { statusCode, payload } = await handleRecommendRequest({
      input,
      conversationId: "system-interaction-test"
    }, runtime);
    assert.equal(statusCode, 200, input);
    assert.equal(payload.type, "system_interaction", input);
    assert.equal(payload.handled, true, input);
    assert.equal(payload.interactionType, interactionType, input);
    assert.equal(payload.answerMode, "system_help", input);
    assert.equal(payload.systemInteraction.interactionType, interactionType, input);
    assert.equal(payload.mode, "system_help", input);
    assert.equal(payload.showEvidencePanel, false, input);
    assert.equal(payload.evidenceBundle, undefined, input);
    assert.equal(payload.knowledgeEvidence, undefined, input);
    assert.equal(payload.conversation.stateVersion, "conversation-state.v2", input);
    assert.equal(payload.conversation.mode, "on", input);
    assert.equal(payload.conversation.delta, null, input);
    assert.equal(payload.conversation.stateMutation, "none", input);
    assert.equal(payload.meta.llmUsed, false, input);
    assert.equal(payload.meta.metatftUsed, false, input);
    assert.equal(payload.meta.retrievalUsed, false, input);
    assert.equal(payload.run.toolCallCount, 0, input);
  }
  assert.deepEqual(calls, {
    metatft: 0,
    rag: 0,
    recommendation: 0,
    llm: 0,
    turnDelta: 0
  });
});

test("TFT requests are not intercepted and still enter the existing recommendation path", async () => {
  const { runtime, calls } = instrumentedRuntime();
  for (const input of ["霞最好的装备是什么", "你好，霞最好的装备是什么"]) {
    const { payload } = await handleRecommendRequest({ input }, runtime);
    assert.notEqual(payload.type, "system_interaction", input);
    assert.equal(payload.clarification.question, "existing flow reached", input);
  }
  assert.equal(calls.recommendation, 2);
});

test("HTTP /api/recommend returns every deterministic system interaction without evidence", async () => {
  const { runtime, calls } = instrumentedRuntime();
  const started = await startSmallWindowServer({
    host: "127.0.0.1",
    port: 0,
    runtime,
    prewarmCatalog: false
  });
  try {
    const cases = [
      ["你好", "greeting"],
      ["你能做什么", "capability_help"],
      ["怎么使用", "usage_help"],
      ["帮我写论文", "out_of_domain"]
    ];
    for (const [input, interactionType] of cases) {
      const response = await fetch(new URL("/api/recommend", started.url), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          connection: "close"
        },
        body: JSON.stringify({
          input,
          conversationId: "system-http"
        })
      });
      const payload = await response.json();
      assert.equal(response.status, 200, input);
      assert.equal(payload.interactionType, interactionType, input);
      assert.equal(payload.showEvidencePanel, false, input);
      assert.equal("evidenceBundle" in payload, false, input);
      assert.equal("knowledgeEvidence" in payload, false, input);
      assert.equal(payload.run.toolCallCount, 0, input);
      assert.equal(payload.seasonContext.id, "set18-live", input);
    }
    assert.deepEqual(calls, {
      metatft: 0,
      rag: 0,
      recommendation: 0,
      llm: 0,
      turnDelta: 0
    });
  } finally {
    started.server.closeIdleConnections?.();
    await closeServer(started.server);
  }
});
