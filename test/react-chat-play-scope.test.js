import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultReactToolHandlerBundle,
  createSmallWindowRuntime,
  handleReactChatRequest
} from "../src/app/small-window-server.js";
import { MemoryCacheStore } from "../src/index.js";

test("broad champion play question answers items first and offers composition or video follow-ups", async () => {
  let decisionCalls = 0;
  let decisionState = null;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    reactDecisionProvider: async (request) => {
      decisionCalls += 1;
      decisionState = request.state;
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "芸阿娜优先参考当前出装数据。",
        evidenceIds: [],
        reasonCode: "direct_answer"
      };
    }
  });

  const { statusCode, payload } = await handleReactChatRequest({
    input: "芸阿娜怎么玩？",
    locale: "zh-CN",
    seasonContextId: "set18-pbe"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.status, "completed");
  assert.equal(decisionCalls, 1);
  assert.equal(decisionState.question, "芸阿娜推荐出装");
  assert.match(decisionState.messages.at(-1).content, /工具范围限制为 entity_catalog_query、unit_builds/);
  assert.deepEqual(payload.agentSuggestedActions.actions.map((action) => action.query), [
    "芸阿娜阵容搭配", "芸阿娜视频攻略"
  ]);
  assert.equal(payload.agentSuggestedActions.reason, "contextual_unit_information_gap");
  assert.deepEqual(payload.agentSuggestedActions.covered, {
    equipment: true,
    composition: false,
    video: false
  });
  assert.equal(payload.agentSuggestedActions.entity.apiName, "DA_18_Yunara");
});

test("after items and composition, contextual guidance only asks whether to continue with video", async () => {
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    reactDecisionProvider: async () => ({
      schemaVersion: "react-action.v1",
      type: "finish",
      answer: "芸阿娜是当前阵容的核心输出。",
      evidenceIds: [],
      reasonCode: "direct_answer"
    })
  });

  const { statusCode, payload } = await handleReactChatRequest({
    input: "芸阿娜阵容搭配",
    locale: "zh-CN",
    seasonContextId: "set18-pbe",
    messages: [
      { role: "user", content: "芸阿娜怎么玩？" },
      { role: "assistant", content: "芸阿娜当前可参考的出装包括杀人剑、青龙刀和强袭者的链枷。" }
    ]
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.agentSuggestedActions.prompt, "已经看过芸阿娜的装备和阵容了，要不要继续查看视频攻略？");
  assert.deepEqual(payload.agentSuggestedActions.actions.map((action) => action.query), [
    "芸阿娜视频攻略"
  ]);
  assert.deepEqual(payload.agentSuggestedActions.covered, {
    equipment: true,
    composition: true,
    video: false
  });
});

test("a named unit in the current turn overrides an unrelated multi-composition result", async () => {
  let decisionState = null;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    reactDecisionProvider: async (request) => {
      decisionState = request.state;
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "阿狸优先参考当前出装数据。",
        evidenceIds: [],
        reasonCode: "direct_answer"
      };
    }
  });

  const { statusCode, payload } = await handleReactChatRequest({
    input: "请问阿狸这个棋子我现在应该怎么玩呢？",
    locale: "zh-CN",
    seasonContextId: "set18-pbe",
    messages: [
      { role: "user", content: "简述今日上升的阵容" },
      {
        role: "assistant",
        content: "今日上升阵容包括黑荆棘·沃里克、宿敌·卡兹克、召唤师·深红锋喙鸟和裁决使·芸阿娜。"
      }
    ]
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(decisionState.question, "阿狸推荐出装");
  assert.equal(payload.agentSuggestedActions.entity.apiName, "DA_18_Ahri");
  assert.deepEqual(payload.agentSuggestedActions.covered, {
    equipment: true,
    composition: false,
    video: false
  });
  assert.deepEqual(payload.agentSuggestedActions.actions.map((action) => action.query), [
    "阿狸阵容搭配", "阿狸视频攻略"
  ]);
  assert.doesNotMatch(JSON.stringify(payload.agentSuggestedActions), /沃里克|卡兹克|深红锋喙鸟|芸阿娜/u);
});

test("an ambiguous pronoun after a multi-composition result asks the user instead of guessing", async () => {
  let decisionCalls = 0;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    reactDecisionProvider: async () => {
      decisionCalls += 1;
      throw new Error("the agent must not guess an entity");
    }
  });

  const { statusCode, payload } = await handleReactChatRequest({
    input: "这个怎么玩？",
    locale: "zh-CN",
    seasonContextId: "set18-pbe",
    messages: [
      { role: "user", content: "简述今日上升的阵容" },
      { role: "assistant", content: "上升阵容包括黑荆棘·沃里克、召唤师·深红锋喙鸟和裁决使·芸阿娜。" }
    ]
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(decisionCalls, 0);
  assert.equal(payload.status, "clarification_required");
  assert.equal(payload.terminationReason, "ambiguous_unit_reference");
  assert.match(payload.question, /具体想了解哪一个/u);
  assert.ok(payload.clarification.entityCandidates.length > 1);
});

test("explicit champion guidance question continues into the agent", async () => {
  let decisionCalls = 0;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    reactDecisionProvider: async () => {
      decisionCalls += 1;
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "继续查询阵容。",
        evidenceIds: [],
        reasonCode: "direct_answer"
      };
    }
  });

  const { payload } = await handleReactChatRequest({
    input: "芸阿娜阵容搭配",
    locale: "zh-CN",
    seasonContextId: "set18-pbe"
  }, runtime);

  assert.equal(payload.status, "completed");
  assert.equal(decisionCalls, 1);
});

test("entity catalog resolves common S18 names without waiting for the full remote catalog", async () => {
  const runtime = createSmallWindowRuntime();
  runtime.cacheStore = new MemoryCacheStore();
  runtime.fetchOfficialEntityDetails = async () => new Promise(() => {});
  const bundle = await createDefaultReactToolHandlerBundle({
    request: { seasonContextId: "set18-pbe", locale: "zh-CN" },
    runtime,
    context: {}
  });

  const startedAt = Date.now();
  const result = await bundle.handlers.entity_catalog_query({
    entityType: "unit",
    filters: { names: ["芸阿娜"] },
    limit: 5
  });

  assert.ok(Date.now() - startedAt < 500);
  assert.equal(result.resolution.requests[0].status, "resolved");
  assert.equal(result.results[0].apiName, "DA_18_Yunara");
});

test("entity catalog also resolves common item aliases without remote startup work", async () => {
  const runtime = createSmallWindowRuntime();
  runtime.cacheStore = new MemoryCacheStore();
  runtime.fetchOfficialEntityDetails = async () => new Promise(() => {});
  const bundle = await createDefaultReactToolHandlerBundle({
    request: { seasonContextId: "set18-pbe", locale: "zh-CN" },
    runtime,
    context: {}
  });

  const result = await bundle.handlers.entity_catalog_query({
    entityType: "item",
    filters: { names: ["羊刀"] },
    limit: 5
  });

  assert.equal(result.resolution.requests[0].status, "resolved");
  assert.equal(result.results[0].apiName, "TFT_Item_GuinsoosRageblade");
});
