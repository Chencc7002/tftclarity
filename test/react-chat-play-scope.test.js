import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createDefaultReactToolHandlerBundle,
  compositionCardEvidenceIds,
  createSmallWindowRuntime,
  handleReactChatRequest
} from "../src/app/small-window-server.js";
import { createCatalog, MemoryCacheStore } from "../src/index.js";
import {
  attachSessionEvidenceSnapshotHashes,
  loadAkaliVariant,
  isSessionEvidenceExplanationFollowUp,
  loadEquipmentQueryContinuation,
  loadFollowUpHistory,
  loadSessionEvidenceCarryover,
  singleEquipmentResultSubject,
  unitEquipmentFacetCoverage,
  unitResultCoverage
} from "../src/app/unit-follow-up.js";

const buildEvidenceValue = (unit = "DA_Cinderling18") => ({
  type: "unit_build_rankings", unit: { apiName: unit, name: "绯红树怪" },
  cards: [{ title: "样本出装", items: [{ apiName: "TFT_Item_InfinityEdge", name: "无尽之刃" }], stats: { games: 100 } }],
  source: { provider: "metatft", updatedAt: new Date().toISOString() }, updatedAt: new Date().toISOString()
});

test("an underspecified Akali follow-up uses only the last scoped, cited equipment result", async () => {
  const cacheStore = new MemoryCacheStore(), seasonContextId = "set19-pbe", conversationId = "variants";
  const apiName = "DA_Akali_TrueDamage19", value = buildEvidenceValue(apiName);
  value.unit.name = "阿卡丽";
  const evidence = { evidenceId: "build", toolCallId: "call", toolName: "unit_builds", type: value.type, value,
    fingerprint: createHash("sha256").update(JSON.stringify(value)).digest("hex") };
  cacheStore.addQueryEvent({ queryId: "akali", input: "真实伤害阿卡丽怎么出装", visitorScope: "owner", conversationId, seasonContextId,
    response: attachSessionEvidenceSnapshotHashes({ status: "completed", evidenceIds: ["build"], evidence: [evidence] }) });
  const runtime = { cacheStore, akaliVariantMode: "enforce" };
  const req = { conversationId, seasonContextId, historyQueryIds: ["akali"], input: "那阿卡丽要不要带夜刃" };
  assert.equal((await loadAkaliVariant(req, runtime, "owner")).apiName, apiName);
  assert.equal((await loadAkaliVariant(req, runtime, "other")).origin, "ambiguous");
  assert.equal((await loadAkaliVariant({ ...req, startNewTask: true }, runtime, "owner")).origin, "ambiguous");
  assert.equal((await loadAkaliVariant({ ...req, input: "换另一个阿卡丽" }, runtime, "owner")).origin, "ambiguous");
  assert.equal((await loadAkaliVariant({ ...req, input: "K/DA阿卡丽怎么出装" }, runtime, "owner")).apiName, "DA_AkaliKDA19");
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

test("explanation follow-ups reuse only cited validated session evidence without another tool call", async () => {
  const cacheStore = new MemoryCacheStore();
  let handlerCalls = 0;
  const runtime = createSmallWindowRuntime({
    cacheStore,
    reactToolHandlers: {
      unit_details: async () => {
        handlerCalls += 1;
        return {
          type: "unit_details",
          updatedAt: "2026-10-29T15:00:00.000Z",
          results: [{ apiName: "TFT18_CrimsonMarkTreant", name: "绯红印记树怪", spell: "猩红之怒" }]
        };
      }
    },
    reactDecisionProvider: async ({ state }) => {
      if (state.question.includes("通俗")) {
        const carried = state.evidence.filter((entry) => entry.metadata?.sessionCarryover === true);
        assert.equal(carried.length, 1, JSON.stringify(state.evidence));
        assert.equal(carried[0].temporalStatus, "historical");
        const repairingTemporalClaim = state.transcript?.some((event) => (
          event.type === "observation" && event.value?.type === "decision_rejected"
        ));
        return {
          schemaVersion: "react-action.v1",
          type: "finish",
          answer: repairingTemporalClaim
            ? "通俗说，它击败正在攻击的目标后会跳向下一个目标，并短暂强化自己。这是在解释上一条结果。"
            : "通俗说，它击败当前目标后会跳向下一个目标，并短暂强化自己。以上是当前赛季数据。",
          evidenceIds: [carried[0].evidenceId],
          reasonCode: "sufficient_evidence"
        };
      }
      const evidence = state.evidence.find((entry) => entry.toolName === "unit_details");
      return evidence ? {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "绯红印记树怪的技能是猩红之怒。",
        evidenceIds: [evidence.evidenceId],
        reasonCode: "sufficient_evidence"
      } : {
        schemaVersion: "react-action.v1",
        type: "call_tool",
        tool: "unit_details",
        arguments: { apiName: "TFT18_CrimsonMarkTreant" },
        purposeCode: "retrieve_entity_details"
      };
    }
  });
  const visitor = { scope: "session-owner" };
  const first = await handleReactChatRequest({
    input: "绯红印记树怪的技能是什么？",
    conversationId: "session-chat",
    seasonContextId: "set18-live"
  }, runtime, { visitor });
  assert.equal(first.payload.status, "completed");
  assert.equal(handlerCalls, 1);

  const second = await handleReactChatRequest({
    input: "你不能通俗地解释一下吗？",
    conversationId: "session-chat",
    seasonContextId: "set18-live",
    historyQueryIds: [first.payload.queryId],
    messages: [
      { role: "user", content: "绯红印记树怪的技能是什么？" },
      { role: "assistant", content: first.payload.answer }
    ]
  }, runtime, { visitor });
  assert.equal(second.payload.status, "completed_with_warning", JSON.stringify(second.payload));
  assert.equal(second.payload.safetyMetrics.actualToolCalls, 0);
  assert.equal(handlerCalls, 1);
  assert.equal(second.payload.evidence.length, 1);
  assert.equal(second.payload.evidence[0].metadata.sessionCarryover, true);
  assert.equal(second.payload.evidence[0].temporalStatus, "historical");
  assert.ok(second.payload.warnings.includes("session_evidence_temporal_repair_requested"));
  assert.match(second.payload.answer, /通俗说/u);
});

test("session evidence carryover rejects current-data requests, uncited evidence, wrong scope and expired receipts", async () => {
  assert.equal(isSessionEvidenceExplanationFollowUp("你不能通俗的解释一下吗"), true);
  assert.equal(isSessionEvidenceExplanationFollowUp("请解释一下它现在的最新胜率"), false);

  const cacheStore = new MemoryCacheStore();
  const now = Date.parse("2026-10-30T00:00:00.000Z");
  const evidence = {
    evidenceId: "cited",
    toolCallId: "call-1",
    toolName: "unit_details",
    type: "unit_details",
    source: "official_catalog",
    updatedAt: "2026-10-29T00:00:00.000Z",
    value: { type: "unit_details", results: [{ apiName: "TFT18_Test" }] },
    metadata: { source: "official_catalog", updatedAt: "2026-10-29T00:00:00.000Z" }
  };
  evidence.fingerprint = createHash("sha256").update(JSON.stringify({
    toolName: evidence.toolName, value: evidence.value, metadata: evidence.metadata
  })).digest("hex");
  for (const [queryId, changes] of Object.entries({
    valid: {},
    uncited: { response: { status: "completed", evidenceIds: [], evidence: [evidence] } },
    expired: { createdAt: "2026-10-20T00:00:00.000Z" }
  })) {
    cacheStore.addQueryEvent({
      queryId,
      input: "test",
      visitorScope: "owner",
      conversationId: "chat",
      seasonContextId: "set18-live",
      createdAt: "2026-10-29T00:00:00.000Z",
      response: attachSessionEvidenceSnapshotHashes({ status: "completed", evidenceIds: ["cited"], evidence: [structuredClone(evidence)] }),
      ...changes
    });
  }
  const request = { input: "再通俗解释一下", historyQueryIds: ["valid"], conversationId: "chat", seasonContextId: "set18-live" };
  assert.equal((await loadSessionEvidenceCarryover(request, { cacheStore }, "owner", { now })).length, 1);
  assert.deepEqual(await loadSessionEvidenceCarryover({ ...request, input: "解释一下当前胜率" }, { cacheStore }, "owner", { now }), []);
  assert.deepEqual(await loadSessionEvidenceCarryover(request, { cacheStore }, "other", { now }), []);
  assert.deepEqual(await loadSessionEvidenceCarryover({ ...request, historyQueryIds: ["uncited"] }, { cacheStore }, "owner", { now }), []);
  assert.deepEqual(await loadSessionEvidenceCarryover({ ...request, historyQueryIds: ["expired"] }, { cacheStore }, "owner", { now }), []);
});

test("a judgement on the previously displayed equipment metric can finish with zero tool calls", async () => {
  const cacheStore = new MemoryCacheStore();
  const scope = "metric-owner", conversationId = "metric-chat", seasonContextId = "set19-pbe";
  const input = "3.91其实很差了吧";
  const value = { type: "unit_item_rankings", query: { intent: "unit_item_rankings", unit: "DA_Zeri19", unitName: "泽丽", performanceItem: "rageblade", itemPolicy: "ordinary_only" },
    itemRankings: [{ apiName: "rageblade", name: "羊刀", stats: { avg: 3.91, top4: 59.7 } },
      { apiName: "infinity", name: "无尽", stats: { avg: 3.58 } }] };
  const answer = "羊刀均名3.91，前四59.70%，无尽3.58。";
  const entry = { evidenceId: "builds", toolCallId: "query", toolName: "unit_builds",
    type: value.type, source: "metatft", value, fingerprint: createHash("sha256").update(JSON.stringify(value)).digest("hex") };
  cacheStore.addQueryEvent({ queryId: "zeri", input: "泽丽的羊刀是差的吗", visitorScope: scope, conversationId,
    seasonContextId, response: attachSessionEvidenceSnapshotHashes({ status: "completed", answer, evidenceIds: ["builds"], evidence: [entry] }) });
  const request = { input, historyQueryIds: ["zeri"], conversationId, seasonContextId };
  for (const mode of ["off", "shadow", "enforce"]) {
    const runtime = createSmallWindowRuntime({ cacheStore, sessionMetricReviewMode: mode,
      reactDecisionProvider: async ({ state }) => {
        if (mode !== "enforce") {
          assert.equal(state.evidence.length, 0);
          return { schemaVersion: "react-action.v1", type: "ask_user", question: "你指的是哪个结果？",
            missingFields: ["unit"], reasonCode: "ambiguous_entity" };
        }
        const [snapshot] = state.evidence;
        assert.equal(snapshot.metadata.quotedMetric, "3.91");
        assert.equal(snapshot.temporalStatus, "historical");
        return { schemaVersion: "react-action.v1", type: "finish", answer: "在刚才那组数据里，羊刀3.91，比无尽3.58靠后。",
          evidenceIds: [snapshot.evidenceId], reasonCode: "sufficient_evidence" };
      }
    });
    const { payload } = await handleReactChatRequest(request, runtime, { visitor: { scope } });
    assert.deepEqual(payload.sessionMetricReview, mode === "off" ? undefined : { mode, matched: true });
    if (mode !== "enforce") continue;
    assert.equal(payload.status, "completed", JSON.stringify(payload));
    assert.equal(payload.answerOrigin, "system_session_equipment_review");
    assert.match(payload.answer, /羊刀为3\.91，无尽为3\.58/u);
    assert.equal(payload.safetyMetrics.actualToolCalls, 0);
    const rationale = await loadSessionEvidenceCarryover({ ...request, input: "为什么说羊刀偏弱？", historyQueryIds: [payload.queryId] }, runtime, scope);
    assert.equal(rationale.length, 1);
    assert.equal(rationale[0].metadata.originQueryId, "zeri");
    assert.equal(rationale[0].metadata.equipmentAssessment, true);
    const rounded = await loadSessionEvidenceCarryover({ ...request, input: "59.7%很低吗" }, runtime, scope);
    assert.equal(rounded[0].metadata.reviewField, "top4");
    const stars = await loadEquipmentQueryContinuation({ ...request, input: "那换成三星呢？", historyQueryIds: [payload.queryId] }, runtime, scope);
    assert.equal(stars.apiName, "DA_Zeri19");
    assert.deepEqual(stars.filters.starLevel, [3]);
    assert.equal(stars.filters.performanceItem, "rageblade");
    const core = await loadEquipmentQueryContinuation({ ...request, input: "那有什么核心装备呢" }, runtime, scope);
    assert.equal(core.filters.itemCount, 3);
    assert.equal(core.filters.performanceItem, undefined);
    assert.deepEqual(await loadSessionEvidenceCarryover({ ...request, input: "为什么说青龙刀偏弱？" }, runtime, scope), []);
    for (const question of ["3.91其实很差了吧，换三星呢", "查最新的3.91", "3.92其实很差了吧", "3.58其实很差了吧", "前四率3.91%很差吧"]) {
      assert.deepEqual(await loadSessionEvidenceCarryover({ ...request, input: question }, runtime, scope), []);
    }
    assert.deepEqual(await loadSessionEvidenceCarryover({ ...request, historyQueryIds: ["zeri", "missing"] }, runtime, scope), []);
    assert.deepEqual(await loadSessionEvidenceCarryover(request, runtime, "another-owner"), []);
    assert.deepEqual(await loadSessionEvidenceCarryover(request, runtime, scope, { refresh: true }), []);
  }
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

test("proactive guidance offers concrete comp detail pills plus artifact, emblem, and radiant quick tasks", async () => {
  const unit = "DA_Cinderling18";
  const artifactCoverage = unitEquipmentFacetCoverage({
    status: "completed",
    evidence: [{
      toolName: "unit_builds",
      value: {
        type: "unit_item_rankings",
        unit: { apiName: unit, name: "绯红树怪" },
        query: { unit, itemCategories: ["artifact"], itemPolicy: "include_artifact" },
        itemRankings: [{ name: "金币收集者", category: "artifact", stats: { games: 120 } }]
      }
    }]
  }, unit);
  assert.deepEqual(artifactCoverage, { ordinary: false, artifact: true, radiant: false, emblem: false });

  const mockCompsData = {
    results: {
      data: {
        cluster_id: 991,
        cluster_details: {
          "101": {
            cluster: "101",
            units_string: `${unit}, DA_18_Ahri, DA_18_Ornn`,
            traits_string: "TFT18_Mage_2",
            name: [{ name: "DA_Cinderling18", type: "unit", score: 1 }],
            builds: [
              { unit, buildName: ["TFT_Item_InfinityEdge", "TFT_Item_GuinsoosRageblade", "TFT_Item_WarmogsArmor"], count: 800 },
              { unit: "DA_18_Ahri", buildName: ["TFT_Item_JeweledGauntlet", "TFT_Item_SpearOfShojin", "TFT_Item_RabadonsDeathcap"], count: 750 },
              { unit: "DA_18_Ornn", buildName: ["TFT_Item_WarmogsArmor", "TFT_Item_GargoyleStoneplate", "TFT_Item_Redemption"], count: 650 }
            ],
            centroid: [2]
          },
          "102": {
            cluster: "102",
            units_string: `${unit}, DA_18_Yunara, DA_18_Thresh`,
            traits_string: "TFT18_Brawler_2",
            name: [{ name: "DA_18_Yunara", type: "unit", score: 1 }],
            builds: [
              { unit, buildName: ["TFT_Item_GuinsoosRageblade", "TFT_Item_InfinityEdge", "TFT_Item_WarmogsArmor"], count: 600 },
              { unit: "DA_18_Thresh", buildName: ["TFT_Item_WarmogsArmor", "TFT_Item_GargoyleStoneplate", "TFT_Item_Redemption"], count: 500 }
            ],
            centroid: [2]
          },
          "103": {
            cluster: "103",
            units_string: `${unit}, DA_18_Aphelios, DA_18_Ornn`,
            traits_string: "TFT18_Brawler_2",
            name: [{ name: "DA_18_Aphelios", type: "unit", score: 1 }],
            builds: [{ unit, buildName: ["TFT_Item_WarmogsArmor", "TFT_Item_InfinityEdge", "TFT_Item_GuinsoosRageblade"], count: 400 }],
            centroid: [2]
          }
        }
      }
    }
  };
  const mockCompsStats = {
    cluster_id: 991,
    results: [
      { cluster: "101", places: [200, 220, 240, 260, 180, 160, 140, 100] },
      { cluster: "102", places: [150, 170, 200, 220, 200, 180, 150, 130] },
      { cluster: "103", places: [100, 120, 140, 160, 180, 200, 180, 160] }
    ]
  };

  const { createCatalog } = await import("../src/index.js");
  const mockCatalog = createCatalog({
    units: [
      { apiName: unit, zhName: "绯红树怪", displayName: "绯红树怪", cost: 4 },
      { apiName: "DA_18_Ahri", zhName: "阿狸", displayName: "阿狸", cost: 4 },
      { apiName: "DA_18_Ornn", zhName: "奥恩", displayName: "奥恩", cost: 4 },
      { apiName: "DA_18_Yunara", zhName: "芸阿娜", displayName: "芸阿娜", cost: 4 },
      { apiName: "DA_18_Thresh", zhName: "锤石", displayName: "锤石", cost: 4 },
      { apiName: "DA_18_Aphelios", zhName: "厄斐琉斯", displayName: "厄斐琉斯", cost: 4 }
    ],
    items: [],
    traits: []
  });
  const mockEntityDetails = {
    units: new Map([
      [unit, { role: "ADCarry" }],
      ["DA_18_Ahri", { role: "MagicCarry" }],
      ["DA_18_Ornn", { role: "APTank" }],
      ["DA_18_Yunara", { role: "ADCarry" }],
      ["DA_18_Thresh", { role: "APTank" }],
      ["DA_18_Aphelios", { role: "ADCarry" }]
    ])
  };
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    catalog: mockCatalog,
    compsClient: {
      async getCompsData() { return mockCompsData; },
      async getCompsStats() { return mockCompsStats; }
    },
    reactToolHandlers: { unit_builds: async () => buildEvidenceValue(unit) },
    reactDecisionProvider: async ({ state }) => state.evidence.length ? {
      schemaVersion: "react-action.v1", type: "finish", answer: "绯红树怪推荐常规三件套。",
      evidenceIds: [state.evidence[0].evidenceId], reasonCode: "sufficient_evidence"
    } : {
      schemaVersion: "react-action.v1", type: "call_tool", tool: "unit_builds",
      arguments: { unit }, purposeCode: "retrieve_current_statistics"
    }
  });
  runtime.catalogCache = new Map([
    ["set18-live:metatft-live.v1:18.7:1100", { catalog: mockCatalog, entityDetails: mockEntityDetails }]
  ]);
  // Ensure catalogCache matches regardless of active default patch key.
  runtime.catalogCache.get = () => ({ catalog: mockCatalog, entityDetails: mockEntityDetails });

  const { payload } = await handleReactChatRequest({
    input: "绯红树怪怎么带",
    seasonContextId: "set18-live",
    locale: "zh-CN"
  }, runtime);

  const actions = payload.agentSuggestedActions?.actions ?? [];
  const compDetailActions = actions.filter((action) => action.actionType === "comp_detail");
  assert.equal(compDetailActions.length, 2, JSON.stringify({ status: payload.status, reason: payload.terminationReason, error: payload.error, actions }));
  assert.equal(compDetailActions[0].comp.source.clusterId, "101");
  assert.equal(compDetailActions[0].comp.source.dataClusterId, "991");
  assert.match(compDetailActions[0].meta, /前四.*均名/u);

  const moreComps = actions.find((action) => action.id === "continue_with_compositions");
  assert.ok(moreComps, "should offer more comps button when >2 comps match");
  assert.match(moreComps.label, /更多.*阵容/u);

  const artifact = actions.find((action) => action.id === "continue_with_artifacts");
  assert.deepEqual(artifact?.quickTask, {
    id: "special-items",
    operation: "unit_item_rankings",
    arguments: { champion: unit, specialCategory: "神器" }
  });

  const emblem = actions.find((action) => action.id === "continue_with_emblems");
  assert.deepEqual(emblem?.quickTask, {
    id: "item-performance",
    operation: "unit_item_rankings",
    arguments: { champion: unit, itemCategory: "纹章" }
  });

  const radiant = actions.find((action) => action.id === "continue_with_radiant");
  assert.deepEqual(radiant?.quickTask, {
    id: "special-items",
    operation: "unit_item_rankings",
    arguments: { champion: unit, specialCategory: "光明装备" }
  });

  assert.ok(actions.some((action) => action.id === "continue_with_video_guides"));
  assert.ok(!actions.some((action) => action.id === "continue_with_equipment"));

  const partnerActions = actions.filter((action) => action.actionType === "partner_unit");
  assert.ok(partnerActions.length >= 2, JSON.stringify(actions));
  assert.ok(partnerActions.every((action) => action.unitApiName !== unit), "must never recommend the queried unit itself");
  // Carry queried -> Tank core partners from Comp 101 (奥恩) and Comp 102 (锤石) rank ahead of same-role carry 阿狸.
  assert.equal(partnerActions[0].unitApiName, "DA_18_Ornn");
  assert.equal(partnerActions[1].unitApiName, "DA_18_Thresh");
  assert.match(partnerActions[0].meta, /主坦/u);
  assert.match(partnerActions[1].meta, /主坦.*芸阿娜/u);
  assert.deepEqual(partnerActions[0].quickTask, {
    id: "unit-build",
    operation: "unit_build_rankings",
    arguments: { champion: "DA_18_Ornn" }
  });
});

test("unit build recommendation keeps core top-3 cards intact and exposes up to 17 extra high-sample builds without leaking them into LLM prompts", async () => {
  const { handleRecommendRequest } = await import("../src/app/small-window-server.js");
  const { createReactDecisionProvider } = await import("../src/react/react-decision-provider.js");
  const catalog = createCatalog({
    units: {
      DA_18_TestCarry: { apiName: "DA_18_TestCarry", displayName: "绯红树怪", cost: 4 }
    },
    items: Object.fromEntries(
      Array.from({ length: 24 }, (_, idx) => [
        `TFT_Item_Test${idx + 1}`,
        { apiName: `TFT_Item_Test${idx + 1}`, displayName: `测试装备${idx + 1}`, category: "ordinary_completed" }
      ])
    )
  });
  const rankedBuilds = Array.from({ length: 25 }, (_, idx) => ({
    items: [
      `TFT_Item_Test${(idx % 6) + 1}`,
      `TFT_Item_Test${((idx + 1) % 10) + 7}`,
      `TFT_Item_Test${((idx + 2) % 8) + 17}`
    ],
    stats: {
      top4Rate: 0.65 - idx * 0.008,
      winRate: 0.22 - idx * 0.004,
      avgPlacement: 3.45 + idx * 0.04,
      games: 3000 - idx * 80
    },
    ranking: {
      method: "performance_role_v4",
      score: 0.9 - idx * 0.015,
      baseScore: 0.9 - idx * 0.015,
      performanceScore: 0.9 - idx * 0.015,
      coverageScore: 0.8,
      priorSamples: 100,
      generalRecommendation: idx === 0,
      sampleLeadRatio: idx === 0 ? 1.5 : null,
      applicabilityBasis: idx === 0 ? "sample_role_and_performance" : "performance_score",
      recommendationRole: idx === 0 ? "mainstream" : idx === 1 ? "best_performance_alternative" : "alternative",
      sampleTier: "high",
      samplePercentile: 0.9 - idx * 0.02,
      performanceTier: idx < 8 ? "high" : "medium",
      insightCode: "mainstream_best"
    }
  }));

  const runtime = createSmallWindowRuntime({
    catalog,
    recommendForInput: async () => ({
      ok: true,
      type: "unit_build_rankings",
      text: "ok",
      rankedBuilds,
      filteredBuilds: rankedBuilds,
      rows: rankedBuilds,
      query: {
        intent: "unit_build_rankings",
        unit: "DA_18_TestCarry",
        starLevel: [2],
        itemCount: 3,
        minSamples: 100,
        days: 3,
        patch: "current",
        queue: "1100",
        rankFilter: [],
        sort: "robust_first"
      },
      source: { endpoint: "/tft-explorer-api/unit_builds/DA_18_TestCarry", updatedAt: "2026-11-28T00:00:00.000Z" }
    })
  });

  const response = await handleRecommendRequest({
    input: "绯红树怪出装",
    seasonContextId: "set18-live",
    locale: "zh-CN"
  }, runtime);

  assert.equal(response.status, 200);
  assert.equal(response.payload.cards.length, 3);
  assert.equal(response.payload.extraBuilds.length, 17);
  assert.equal(response.payload.extraBuilds[0].rank, 4);
  assert.equal(response.payload.extraBuilds[16].rank, 20);
  assert.equal(response.payload.extraBuilds[0].items.length, 3);
  assert.ok(response.payload.extraBuilds[0].difference, "extra builds include difference vs top-1 build");

  // Confirm react-decision-provider strips UI-only extraBuilds before sending tool observations to the model.
  let capturedBody = null;
  const provider = createReactDecisionProvider({
    apiKey: "test-key",
    baseUrl: "https://example.invalid/v1",
    model: "test-model",
    fetchImpl: async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  schemaVersion: "react-action.v1",
                  thought: "done",
                  action: "finish",
                  answer: "已完成推荐。",
                  evidenceIds: ["ev-1"],
                  missingEvidence: []
                })
              }
            }]
          };
        }
      };
    }
  });
  await provider.decide({
    toolCatalog: [],
    state: {
      question: "绯红树怪出装",
      seasonContextId: "set18-live",
      locale: "zh-CN",
      messages: [],
      evidence: [],
      transcript: [{
        type: "observation",
        value: {
          type: "tool_result",
          evidence: {
            evidenceId: "ev-1",
            toolName: "unit_builds",
            value: {
              type: "unit_build_rankings",
              cards: response.payload.cards,
              extraBuilds: response.payload.extraBuilds
            }
          }
        }
      }]
    }
  });
  const promptText = JSON.stringify(capturedBody?.messages ?? []);
  assert.ok(promptText.includes("unit_build_rankings"));
  assert.ok(!promptText.includes("extraBuilds"), "extraBuilds must be stripped from model prompt messages");
});
