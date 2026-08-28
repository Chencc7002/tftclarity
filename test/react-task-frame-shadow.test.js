import assert from "node:assert/strict";
import test from "node:test";
import {
  createSmallWindowRuntime,
  handleReactChatRequest
} from "../src/app/small-window-server.js";
import { MemoryCacheStore } from "../src/index.js";
import { parseSemanticTask } from "../src/understanding/semantic-task-parser.js";

function finishDecision(onState = () => {}) {
  return async (request) => {
    onState(request.state);
    return {
      schemaVersion: "react-action.v1",
      type: "finish",
      answer: "继续使用当前生产路径。",
      evidenceIds: [],
      reasonCode: "direct_answer"
    };
  };
}

test("ReAct TaskFrame shadow is disabled by default", async () => {
  let parserCalls = 0;
  let telemetryCalls = 0;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    parseSemanticTask: async () => {
      parserCalls += 1;
      throw new Error("shadow parser must remain disabled");
    },
    onReactTaskFrameShadow: () => {
      telemetryCalls += 1;
    },
    reactDecisionProvider: finishDecision()
  });

  const { statusCode, payload } = await handleReactChatRequest({
    input: "芸阿娜阵容搭配",
    locale: "zh-CN",
    seasonContextId: "set18-live"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.status, "completed");
  assert.equal(runtime.reactTaskFrameShadowV1, false);
  assert.equal(parserCalls, 0);
  assert.equal(telemetryCalls, 0);
});

test("ReAct TaskFrame shadow flag is normalized once from runtime environment", () => {
  const enabled = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    env: { TFT_AGENT_REACT_TASK_FRAME_SHADOW_V1: "on" }
  });
  const overridden = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    env: { TFT_AGENT_REACT_TASK_FRAME_SHADOW_V1: "on" },
    reactTaskFrameShadowV1: false
  });
  assert.equal(enabled.reactTaskFrameShadowV1, true);
  assert.equal(overridden.reactTaskFrameShadowV1, false);
});

test("ReAct TaskFrame control flag is independent and defaults off", () => {
  const enabled = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    env: { TFT_AGENT_REACT_TASK_FRAME_CONTROL_V1: "enabled" }
  });
  const overridden = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    env: { TFT_AGENT_REACT_TASK_FRAME_CONTROL_V1: "enabled" },
    reactTaskFrameControlV1: false
  });
  assert.equal(enabled.reactTaskFrameControlV1, true);
  assert.equal(enabled.reactTaskFrameShadowV1, false);
  assert.equal(overridden.reactTaskFrameControlV1, false);
});

test("control off preserves the complete legacy broad-play path", async () => {
  let parserCalls = 0;
  let providerRequest = null;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    parseSemanticTask: async () => {
      parserCalls += 1;
      throw new Error("control-off parser must not run");
    },
    reactDecisionProvider: async (request) => {
      providerRequest = request;
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "保持旧路径。",
        evidenceIds: [],
        reasonCode: "direct_answer"
      };
    }
  });

  const { payload } = await handleReactChatRequest({
    input: "沃里克怎么玩？",
    locale: "zh-CN",
    seasonContextId: "set18-live"
  }, runtime);

  assert.equal(payload.status, "completed");
  assert.equal(parserCalls, 0);
  assert.equal(providerRequest.state.question, "沃里克推荐出装");
  assert.match(providerRequest.state.messages.at(-1).content, /本轮只完成当前版本的出装数据查询/u);
  assert.deepEqual(providerRequest.toolCatalog.map((tool) => tool.name).sort(), [
    "entity_catalog_query",
    "item_details_batch",
    "unit_builds"
  ]);
  assert.equal(providerRequest.state.semanticAdvisory, null);
});

test("control on sends the original broad-play request and bounded advisory to normal ReAct", async () => {
  let providerRequest = null;
  const answer = "装备：按真实数据选核心装。阵容：放进适合持续作战的体系。站位：按对手威胁调整。运营：满足前置条件时再作为核心。";
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    reactTaskFrameControlV1: true,
    reactDecisionProvider: async (request) => {
      providerRequest = request;
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer,
        evidenceIds: [],
        reasonCode: "direct_answer"
      };
    }
  });

  const { statusCode, payload } = await handleReactChatRequest({
    input: "沃里克怎么玩？",
    locale: "zh-CN",
    seasonContextId: "set18-live"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.status, "completed");
  assert.equal(payload.answer, answer);
  assert.notEqual(payload.answerOrigin, "system_equipment_summary");
  assert.equal(providerRequest.state.question, "沃里克怎么玩？");
  assert.equal(providerRequest.state.messages.some((message) => (
    /本轮只完成当前版本的出装数据查询/u.test(String(message?.content ?? ""))
  )), false);
  assert.deepEqual(providerRequest.state.semanticAdvisory, {
    action: "recommend",
    goal: "recommend_unit_play",
    subject: {
      resolvedId: "DA_18_Warwick",
      canonicalName: "沃里克"
    },
    expectedOutput: ["unit_play_guidance"]
  });
  for (const field of ["capabilityRequirements", "ambiguities", "assumptions", "constraints"]) {
    assert.equal(Object.hasOwn(providerRequest.state.semanticAdvisory, field), false);
  }
  assert.equal(Object.hasOwn(providerRequest.state, "taskFrame"), false);
  const toolNames = providerRequest.toolCatalog.map((tool) => tool.name);
  assert.ok(toolNames.includes("comps_rankings"));
  assert.ok(toolNames.includes("unit_details"));
  assert.notDeepEqual(toolNames.sort(), [
    "entity_catalog_query",
    "item_details_batch",
    "unit_builds"
  ]);
  assert.match(payload.answer, /装备/u);
  assert.match(payload.answer, /阵容/u);
  assert.match(payload.answer, /站位/u);
  assert.match(payload.answer, /运营/u);
});

test("ReAct shadow parses the original broad-play input without changing production state", async () => {
  let parserRequest = null;
  let shadowEvent = null;
  let decisionState = null;
  let turnDeltaCalls = 0;
  let semanticProviderCalls = 0;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    reactTaskFrameShadowV1: "true",
    parseSemanticTask: async (input, options) => {
      parserRequest = { input, options };
      return parseSemanticTask(input, options);
    },
    onReactTaskFrameShadow: (event) => {
      shadowEvent = event;
    },
    turnDeltaProvider: async () => {
      turnDeltaCalls += 1;
    },
    semanticTaskProvider: async () => {
      semanticProviderCalls += 1;
    },
    reactDecisionProvider: finishDecision((state) => {
      decisionState = state;
    })
  });

  const { statusCode, payload } = await handleReactChatRequest({
    input: "沃里克怎么玩呢？",
    locale: "zh-CN",
    seasonContextId: "set18-live"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.status, "completed");
  assert.equal(parserRequest.input, "沃里克怎么玩呢？");
  assert.equal(parserRequest.options.provider, null);
  assert.deepEqual(parserRequest.options.conversation, []);
  assert.ok(parserRequest.options.catalog);
  assert.equal(shadowEvent.success, true);
  assert.equal(shadowEvent.action, "recommend");
  assert.equal(shadowEvent.goal, "recommend_unit_play");
  assert.deepEqual(shadowEvent.expectedOutput, ["unit_play_guidance"]);
  assert.deepEqual(shadowEvent.subjectResolvedIds, ["DA_18_Warwick"]);
  assert.equal(shadowEvent.missingContextReference, false);
  assert.equal(shadowEvent.providerUsed, false);
  assert.equal(shadowEvent.legacyBroadUnitPlayMatched, true);
  assert.equal(turnDeltaCalls, 0);
  assert.equal(semanticProviderCalls, 0);
  assert.equal(decisionState.question, "沃里克推荐出装");
  assert.equal(Object.hasOwn(decisionState, "taskFrame"), false);
});

test("ReAct shadow parser failures fail open and keep the legacy request path", async () => {
  let shadowEvent = null;
  let decisionState = null;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    reactTaskFrameShadowV1: true,
    parseSemanticTask: async () => {
      throw new TypeError("shadow failure");
    },
    onReactTaskFrameShadow: (event) => {
      shadowEvent = event;
    },
    reactDecisionProvider: finishDecision((state) => {
      decisionState = state;
    })
  });

  const { statusCode, payload } = await handleReactChatRequest({
    input: "沃里克怎么玩呢？",
    locale: "zh-CN",
    seasonContextId: "set18-live"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.status, "completed");
  assert.deepEqual(shadowEvent, {
    success: false,
    errorName: "TypeError",
    providerUsed: false,
    legacyBroadUnitPlayMatched: true
  });
  assert.equal(decisionState.question, "沃里克推荐出装");
});

test("control parse failure and invalid frames both fall back to the full legacy path", async () => {
  for (const parser of [
    async () => { throw new Error("parse failed"); },
    async () => ({ taskFrame: null })
  ]) {
    let decisionState = null;
    const runtime = createSmallWindowRuntime({
      cacheStore: new MemoryCacheStore(),
      reactTaskFrameControlV1: true,
      parseSemanticTask: parser,
      reactDecisionProvider: finishDecision((state) => {
        decisionState = state;
      })
    });

    const { statusCode, payload } = await handleReactChatRequest({
      input: "沃里克怎么玩？",
      locale: "zh-CN",
      seasonContextId: "set18-live"
    }, runtime);

    assert.equal(statusCode, 200);
    assert.equal(payload.status, "completed");
    assert.equal(decisionState.question, "沃里克推荐出装");
    assert.match(decisionState.messages.at(-1).content, /本轮只完成当前版本的出装数据查询/u);
    assert.equal(decisionState.semanticAdvisory, null);
  }
});

test("shadow and control share one deterministic parse and never call semantic providers", async () => {
  let parserCalls = 0;
  let shadowEvent = null;
  let decisionState = null;
  let turnDeltaCalls = 0;
  let semanticProviderCalls = 0;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    reactTaskFrameShadowV1: true,
    reactTaskFrameControlV1: true,
    parseSemanticTask: async (input, options) => {
      parserCalls += 1;
      return parseSemanticTask(input, options);
    },
    onReactTaskFrameShadow: (event) => {
      shadowEvent = event;
    },
    turnDeltaProvider: async () => {
      turnDeltaCalls += 1;
    },
    semanticTaskProvider: async () => {
      semanticProviderCalls += 1;
    },
    reactDecisionProvider: finishDecision((state) => {
      decisionState = state;
    })
  });
  runtime.semanticTaskProvider = async () => {
    semanticProviderCalls += 1;
  };

  const { payload } = await handleReactChatRequest({
    input: "沃里克怎么玩呢？",
    locale: "zh-CN",
    seasonContextId: "set18-live"
  }, runtime);

  assert.equal(payload.status, "completed");
  assert.equal(parserCalls, 1);
  assert.equal(shadowEvent.success, true);
  assert.equal(decisionState.question, "沃里克怎么玩呢？");
  assert.equal(turnDeltaCalls, 0);
  assert.equal(semanticProviderCalls, 0);
});

test("control rejects narrow, multi-entity, and ambiguous TaskFrames", async () => {
  const naturalCases = [
    "沃里克推荐什么装备？",
    "沃里克怎么玩，有攻略视频吗？",
    "为什么沃里克要这么玩？",
    "沃里克和阿狸怎么玩？"
  ];
  for (const input of naturalCases) {
    let decisionState = null;
    const runtime = createSmallWindowRuntime({
      cacheStore: new MemoryCacheStore(),
      reactTaskFrameControlV1: true,
      reactDecisionProvider: finishDecision((state) => {
        decisionState = state;
      })
    });
    const { payload } = await handleReactChatRequest({
      input,
      locale: "zh-CN",
      seasonContextId: "set18-live"
    }, runtime);
    assert.equal(payload.status, "completed", input);
    assert.equal(decisionState.semanticAdvisory, null, input);
  }

  let ambiguousState = null;
  const ambiguousRuntime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    reactTaskFrameControlV1: true,
    parseSemanticTask: async () => ({
      taskFrame: {
        schemaVersion: "task-frame.v1",
        domain: "tft",
        action: "recommend",
        goal: "recommend_unit_play",
        expectedOutput: ["unit_play_guidance"],
        subjects: [{
          rawText: "沃里克",
          expectedType: "champion",
          resolvedId: "DA_18_Warwick",
          confidence: 1
        }],
        candidates: [],
        concepts: [],
        ambiguities: [{
          code: "missing_context_reference",
          affectsResult: true,
          affectsToolSelection: true
        }]
      }
    }),
    reactDecisionProvider: finishDecision((state) => {
      ambiguousState = state;
    })
  });
  await handleReactChatRequest({
    input: "沃里克怎么玩？",
    locale: "zh-CN",
    seasonContextId: "set18-live"
  }, ambiguousRuntime);
  assert.equal(ambiguousState.question, "沃里克推荐出装");
  assert.equal(ambiguousState.semanticAdvisory, null);
});
