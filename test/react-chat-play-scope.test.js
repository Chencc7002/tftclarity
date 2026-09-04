import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultReactToolHandlerBundle,
  compositionCardEvidenceIds,
  createSmallWindowRuntime,
  handleReactChatRequest
} from "../src/app/small-window-server.js";
import { MemoryCacheStore } from "../src/index.js";
import { unitResultCoverage, singleEquipmentResultSubject, loadFollowUpHistory } from "../src/app/unit-follow-up.js";

const buildEvidenceValue = (unit = "DA_Cinderling18") => ({
  type: "unit_build_rankings", unit: { apiName: unit, name: "绯红树怪" },
  cards: [{ title: "样本出装", items: [{ apiName: "TFT_Item_InfinityEdge", name: "无尽之刃" }], stats: { games: 100 } }],
  source: { provider: "metatft", updatedAt: new Date().toISOString() }, updatedAt: new Date().toISOString()
});

test("deadline partial payload keeps its warning and never claims follow-up coverage is complete", { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  let markBlocked, release;
  const blocked = new Promise(resolve => { markBlocked = resolve; });
  const late = new Promise(resolve => { release = resolve; });
  const events = [];
  const runtime = createSmallWindowRuntime({ cacheStore: new MemoryCacheStore(),
    reactToolHandlers: { unit_builds: async () => buildEvidenceValue(),
      entity_catalog_query: async () => ({ type: "entity_catalog_results", entityType: "unit",
        updatedAt: new Date().toISOString(), results: [{ apiName: "DA_Cinderling18", name: "绯红树怪" }],
        resolution: { requests: [{ inputName: "绯红树怪", status: "resolved",
          candidates: [{ apiName: "DA_Cinderling18", name: "绯红树怪" }] }] } }) },
    reactDecisionProvider: async ({ state }) => {
      if (state.evidence.some(entry => entry.toolName === "unit_builds")) { markBlocked(); return late; }
      if (!state.evidence.length) return { schemaVersion: "react-action.v1", type: "call_tool", tool: "entity_catalog_query",
        arguments: { entityType: "unit", filters: { names: ["绯红树怪"] } }, purposeCode: "retrieve_entity_details" };
      return { schemaVersion: "react-action.v1", type: "call_tool", tool: "unit_builds",
        arguments: { unit: "DA_Cinderling18" }, purposeCode: "retrieve_current_statistics" };
    }
  });
  runtime.reactDeadlineRecovery = true;
  runtime.reactChatBudget = { ...runtime.reactChatBudget, deadlineMs: 100 };
  const pending = handleReactChatRequest({ input: "绯红树怪怎么玩？", seasonContextId: "set18-live" }, runtime,
    { onProgress: event => events.push(event) });
  await Promise.race([blocked, pending.then(result => assert.fail(JSON.stringify(result)))]);
  t.mock.timers.tick(100);
  const { statusCode, payload } = await pending;
  assert.equal(statusCode, 200);
  assert.equal(payload.status, "completed_with_warning");
  assert.equal(payload.run.status, "timed_out");
  assert.equal(payload.terminationReason, "deadline_exceeded");
  assert.equal(payload.answerOrigin, "system_evidence_fallback");
  assert.match(payload.answer, /超时.*部分结果/);
  assert.equal(payload.evidenceIds.length, 2);
  assert.equal(payload.agentSuggestedActions, undefined);
  const count = events.length;
  release({ schemaVersion: "react-action.v1", type: "finish", answer: "迟到的完整结论",
    evidenceIds: payload.evidenceIds, reasonCode: "sufficient_evidence" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, count);
});

test("isolated follow-up coverage counts displayed card receipts, never unshown Ledger results", () => {
  const evidence = [{ evidenceId: "builds", toolName: "unit_builds", value: buildEvidenceValue() },
    { evidenceId: "comps", toolName: "comps_rankings", value: { results: [{ members: [{ apiName: "DA_Cinderling18" }] }] } }];
  const result = { compositionCardScope: true, status: "completed_with_warning", evidence, evidenceIds: ["builds"] };
  assert.deepEqual(unitResultCoverage(result, "DA_Cinderling18"), { equipment: true, composition: false, video: false });
  assert.equal(unitResultCoverage({ ...result, cardEvidenceIds: ["comps"] }, "DA_Cinderling18").composition, true);
  assert.equal(unitResultCoverage({ ...result, evidenceIds: [], cardEvidenceIds: [] }, "DA_Cinderling18").equipment, false);
});

test("completed model card receipt retains cited snapshots despite small upstream clock skew", () => {
  const now = Date.now();
  const entry = (evidenceId, toolName, offsetMs) => ({ evidenceId, toolName,
    validatedAt: new Date(now).toISOString(), updatedAt: new Date(now + offsetMs).toISOString(),
    source: "metatft", metadata: { source: "metatft", updatedAt: new Date(now + offsetMs).toISOString() },
    value: { seasonContextId: "set18-live", source: { updatedAt: new Date(now + offsetMs).toISOString() } } });
  const result = { answerOrigin: "model", terminationReason: "completed",
    evidenceIds: ["ranking", "formation", "too-future", "wrong-season", "historical"], evidence: [
      entry("ranking", "comps_rankings", 0), entry("formation", "composition_tactical_details", 2_000),
      entry("uncited", "composition_tactical_details", 2_000), entry("build", "unit_builds", 0),
      entry("too-future", "composition_tactical_details", 20_000),
      { ...entry("wrong-season", "composition_tactical_details", 2_000), value: {
        ...entry("wrong-season", "composition_tactical_details", 2_000).value, seasonContextId: "set17-live" } },
      { ...entry("historical", "composition_tactical_details", 2_000), temporalStatus: "historical" }
    ] };
  assert.deepEqual(compositionCardEvidenceIds(result, now, "set18-live"), ["ranking", "formation"]);
  assert.deepEqual(compositionCardEvidenceIds({ ...result, answerOrigin: "system_evidence_fallback",
    terminationReason: "deadline_exceeded" }, now, "set18-live"), ["ranking"]);
});

test("follow-up coverage uses delivered rows and entity IDs, not wording or empty evidence", () => {
  const result = { status: "completed", evidence: [{ toolName: "unit_builds", value: buildEvidenceValue() }] };
  assert.deepEqual(unitResultCoverage(result, "DA_Cinderling18"), { equipment: true, composition: false, video: false });
  assert.equal(unitResultCoverage(result, "DA_18_Ahri").equipment, false);
  assert.equal(unitResultCoverage({ status: "completed", evidence: [{ toolName: "unit_builds_batch", value: {
    results: [{ unit: { apiName: "DA_Cinderling18" }, buildOptions: [{ optionId: "one" }] }]
  } }] }, "DA_Cinderling18").equipment, true);
  assert.equal(unitResultCoverage({ ...result, status: "clarification_required" }, "DA_Cinderling18").equipment, false);
  assert.equal(unitResultCoverage({ ...result, evidence: [{ toolName: "unit_builds", value: { ...buildEvidenceValue(), cards: [] } }] }, "DA_Cinderling18").equipment, false);
  assert.equal(unitResultCoverage({ status: "completed", evidence: [{ toolName: "comps_rankings", value: {
    resolution: { status: "ambiguous" }, results: [{ members: [{ apiName: "DA_Cinderling18" }] }]
  } }] }, "DA_Cinderling18").composition, false);
});

test("artifact ranking follow-ups use the returned champion and count delivered item rankings", async () => {
  const value = {
    type: "unit_item_rankings", unit: { apiName: "DA_18_Aphelios", name: "厄斐琉斯" },
    query: { unit: "DA_18_Aphelios", itemCategories: ["artifact"], itemPolicy: "include_artifact" },
    itemRankings: [{ name: "金币收集者", category: "artifact", stats: { games: 100 } }],
    updatedAt: new Date().toISOString()
  };
  const result = { status: "completed", evidence: [{ toolName: "unit_builds", value }] };
  assert.equal(unitResultCoverage(result, "DA_18_Aphelios").equipment, true);
  assert.equal(singleEquipmentResultSubject(result).apiName, "DA_18_Aphelios");
  assert.equal(singleEquipmentResultSubject({ evidence: [{ toolName: "unit_builds", value, temporalStatus: "historical" }] }), null);
  assert.equal(singleEquipmentResultSubject({ evidence: [{ toolName: "unit_builds", value: { ...value, itemRankings: [] } }] }), null);
  assert.equal(singleEquipmentResultSubject({ evidence: [...result.evidence, { toolName: "unit_builds", value: {
    ...value, unit: { apiName: "DA_18_Ornn", name: "奥恩" }, query: { ...value.query, unit: "DA_18_Ornn" }
  } }] }), null);
  const runtime = createSmallWindowRuntime({ cacheStore: new MemoryCacheStore(),
    reactToolHandlers: {
      unit_builds: async () => value,
      entity_catalog_query: async () => ({ type: "entity_catalog_results", entityType: "unit", updatedAt: new Date().toISOString(),
        results: [{ apiName: "DA_18_Aphelios" }], resolution: { requests: [{ inputName: "厄飞流斯", status: "resolved", candidates: [value.unit] }] }
      })
    },
    reactDecisionProvider: async ({ state }) => {
      const ranking = state.evidence.find((entry) => entry.toolName === "unit_builds");
      if (ranking) return {
        schemaVersion: "react-action.v1", type: "finish", answer: "厄斐琉斯的神器推荐：金币收集者。",
        evidenceIds: [ranking.evidenceId], reasonCode: "sufficient_evidence"
      };
      return state.evidence.length
        ? { schemaVersion: "react-action.v1", type: "call_tool", tool: "unit_builds", arguments: { unit: "DA_18_Aphelios" }, purposeCode: "retrieve_current_statistics" }
        : { schemaVersion: "react-action.v1", type: "call_tool", tool: "entity_catalog_query", arguments: { entityType: "unit", filters: { names: ["厄飞流斯"] } }, purposeCode: "retrieve_entity_details" };
    }
  });
  const { payload } = await handleReactChatRequest({
    input: "我要查的是奥恩神器", seasonContextId: "set18-live", messages: [{ role: "user", content: "查询厄飞流斯的神器" }]
  }, runtime);
  assert.equal(payload.agentSuggestedActions?.covered.equipment, true);
  assert.ok(!payload.agentSuggestedActions.actions.some((action) => action.id === "continue_with_equipment"));
  assert.equal(payload.agentSuggestedActions.actions.find((action) => action.id === "continue_with_compositions").quickTask.arguments.champion, "DA_18_Aphelios");
  assert.doesNotMatch(payload.agentSuggestedActions.prompt, /奥恩/u);
});

test("follow-up history is read from stored results and isolated by owner, conversation, season and reset", async () => {
  const cacheStore = new MemoryCacheStore();
  for (const [id, changes] of Object.entries({ valid: {}, owner: { visitorScope: "other" }, conversation: { conversationId: "other" }, season: { seasonContextId: "set17-live" } })) {
    cacheStore.addQueryEvent({ queryId: id, input: "test", visitorScope: "me", conversationId: "chat", seasonContextId: "set18-live", response: buildEvidenceValue(), ...changes });
  }
  const request = { historyQueryIds: ["valid", "owner", "conversation", "season", "missing"], conversationId: "chat", seasonContextId: "set18-live" };
  assert.equal((await loadFollowUpHistory(request, { cacheStore }, "me")).length, 1);
  assert.deepEqual(await loadFollowUpHistory({ ...request, startNewTask: true }, { cacheStore }, "me"), []);
});

test("successful equipment evidence suppresses duplicate items even for a how-to-equip query", async () => {
  const runtime = createSmallWindowRuntime({ cacheStore: new MemoryCacheStore(),
    reactToolHandlers: { unit_builds: async () => buildEvidenceValue() },
    reactDecisionProvider: async ({ state }) => state.evidence.length ? {
      schemaVersion: "react-action.v1", type: "finish", answer: "绯红树怪可以参考返回的出装。",
      evidenceIds: [state.evidence[0].evidenceId], reasonCode: "sufficient_evidence"
    } : { schemaVersion: "react-action.v1", type: "call_tool", tool: "unit_builds", arguments: { unit: "DA_Cinderling18" }, purposeCode: "retrieve_current_statistics" }
  });
  const { payload } = await handleReactChatRequest({ input: "绯红树怪怎么带", seasonContextId: "set18-live" }, runtime);
  assert.equal(payload.agentSuggestedActions?.covered.equipment, true, JSON.stringify(payload));
  assert.ok(!payload.agentSuggestedActions.actions.some((action) => action.id === "continue_with_equipment"));
  const action = payload.agentSuggestedActions.actions.find((action) => action.id === "continue_with_compositions");
  assert.deepEqual(action.quickTask, { id: "hero-comps", operation: "comp_rankings", arguments: { champion: "DA_Cinderling18" } });
});

test("completed stored equipment suppresses repeats after compositions, but failed history does not", async () => {
  const cacheStore = new MemoryCacheStore();
  const runtime = createSmallWindowRuntime({ cacheStore,
    reactToolHandlers: { comps_rankings: async () => ({
      type: "composition_rankings", results: [{ units: [{ apiName: "DA_Cinderling18" }] }],
      source: { provider: "metatft", updatedAt: new Date().toISOString() }
    }) },
    reactDecisionProvider: async ({ state }) => state.evidence.length ? {
      schemaVersion: "react-action.v1", type: "finish", answer: "绯红树怪在返回的阵容中。",
      evidenceIds: [state.evidence[0].evidenceId], reasonCode: "sufficient_evidence"
    } : { schemaVersion: "react-action.v1", type: "call_tool", tool: "comps_rankings", arguments: {}, purposeCode: "retrieve_current_statistics" }
  });
  for (const failed of [false, true]) {
    const queryId = failed ? "failed-build" : "completed-build";
    cacheStore.addQueryEvent({ queryId, input: "绯红树怪怎么带", visitorScope: "local", conversationId: "follow-chat",
      seasonContextId: "set18-live", response: failed ? { ...buildEvidenceValue(), ok: false } : buildEvidenceValue() });
    const { payload } = await handleReactChatRequest({ input: "绯红树怪阵容搭配", seasonContextId: "set18-live",
      conversationId: "follow-chat", historyQueryIds: [queryId] }, runtime);
    assert.equal(payload.agentSuggestedActions?.covered.composition, true, JSON.stringify(payload));
    assert.equal(payload.agentSuggestedActions.covered.equipment, !failed);
    assert.equal(payload.agentSuggestedActions.actions.some((action) => action.id === "continue_with_equipment"), failed);
  }
});

test("broad champion play scope without tool evidence does not claim equipment was completed", async () => {
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
    seasonContextId: "set18-live"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.status, "completed");
  assert.equal(decisionCalls, 1);
  assert.equal(decisionState.question, "芸阿娜推荐出装");
  assert.match(decisionState.messages.at(-1).content, /工具范围限制为 entity_catalog_query、unit_builds/);
  assert.equal(payload.agentSuggestedActions, undefined);
});

test("chat text alone cannot mark items and composition as successfully completed", async () => {
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
    seasonContextId: "set18-live",
    messages: [
      { role: "user", content: "芸阿娜怎么玩？" },
      { role: "assistant", content: "芸阿娜当前可参考的出装包括杀人剑、青龙刀和强袭者的链枷。" }
    ]
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.agentSuggestedActions, undefined);
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
    seasonContextId: "set18-live",
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
  assert.equal(payload.agentSuggestedActions, undefined);
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
    seasonContextId: "set18-live",
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
    seasonContextId: "set18-live"
  }, runtime);

  assert.equal(payload.status, "completed");
  assert.equal(decisionCalls, 1);
});

test("entity catalog resolves common S18 names without waiting for the full remote catalog", async () => {
  const runtime = createSmallWindowRuntime();
  runtime.cacheStore = new MemoryCacheStore();
  runtime.fetchOfficialEntityDetails = async () => new Promise(() => {});
  const bundle = await createDefaultReactToolHandlerBundle({
    request: { seasonContextId: "set18-live", locale: "zh-CN" },
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
    request: { seasonContextId: "set18-live", locale: "zh-CN" },
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
