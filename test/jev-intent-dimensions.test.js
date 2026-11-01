import test from "node:test";
import assert from "node:assert/strict";
import { buildJevDimensionContext, projectJevDimensionInput, projectJevDimensions, dimensionTelemetry } from "../src/understanding/jev-intent-dimensions.js";
import { buildJevIntentRequest } from "../src/understanding/jev-intent-shadow.js";
import { createJevIntentObserver, projectJevIntentControl } from "../src/understanding/jev-intent-observer.js";
import { createSmallWindowRuntime, handleReactChatRequest } from "../src/app/small-window-server.js";
import { MemoryCacheStore, SQLiteConversationBridgeStore } from "../src/index.js";
import { DEFAULT_SEASON_CONTEXT_ID } from "../src/season/season-context.js";
import { createReactDecisionProvider } from "../src/react/react-decision-provider.js";

function response(choices = {}, scores = {}) {
  const selected = { action: "recommend", domain: "tft", context: "self_contained", ...choices };
  return { model: "jev-1.13.0", usage: { input_tokens: 10, output_tokens: 20 },
    answers: Object.fromEntries(Object.entries(buildJevIntentRequest({ input: "x" }).questions).map(([name, q]) => [name,
      { type: "choice", choice: selected[name], confidence: scores[name] ?? 0.95,
        probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, Number(key === selected[name])])) }])) };
}
const observed = (choices, scores) => ({ status: "observed", ...response(choices, scores) });
const direct = () => ({ schemaVersion: "react-action.v1", type: "finish", answer: "已收到", evidenceIds: [], reasonCode: "direct_answer" });
const request = (input = "推荐云顶阵容", extra = {}) => ({ input, locale: "zh-CN", seasonContextId: DEFAULT_SEASON_CONTEXT_ID, ...extra });
const bridge = (count = 1) => ({ relation: "continue", view: { schemaVersion: "conversation-bridge-context.v1", records: [
  { status: "completed", operation: "unit_builds", entityRefs: Array.from({ length: count }, (_, i) => ({ entityType: "unit", apiName: `Test_Unit${i}` })),
    displaySummary: "secret statistics 99%", normalizedArguments: { secret: "private" } }
] }, promotedEvidence: [{ secret: "historical" }] });

test("reliable action survives low domain/context scores when server domain is known", () => {
  const raw = observed({}, { domain: 0.45, context: 0.2 });
  const context = buildJevDimensionContext(request());
  const before = structuredClone(raw);
  assert.equal(projectJevIntentControl(raw).advisory, null);
  const next = projectJevDimensions(raw, context);
  assert.equal(next.advisory.action, "recommend");
  assert.equal(next.advisory.context, null);
  assert.equal(next.advisory.domainSource, "current_input");
  assert.deepEqual(next.accepted, { action: true, domain: true, context: false });
  assert.deepEqual(raw, before);
});

test("low action does not become an action adoption; missing context remains explicit", () => {
  const context = buildJevDimensionContext(request());
  const low = projectJevDimensions(observed({}, { action: 0.3 }), context);
  assert.equal(low.advisory.action, null);
  assert.equal(low.disposition, "context_hint_only");
  const missing = projectJevDimensions(observed({ action: "compare", context: "missing" }), context);
  assert.equal(missing.advisory.action, "compare");
  assert.ok(missing.advisory.uncertainties.includes("context_missing"));
  assert.equal(missing.advisory.entityContext.resolution, "unresolved");
});

test("current topic wins, generic new tasks never inherit TFT from old history", () => {
  for (const r of [request("帮我写 Python 代码"), request("帮我订酒店"), request("翻译这段文字")]) {
    const context = buildJevDimensionContext(r, { bridgeContext: bridge() });
    assert.equal(context.domain, "out_of_domain");
    assert.equal(projectJevDimensions(observed(), context).advisory, null);
    assert.deepEqual(context.previousEntities, []);
  }
  for (const r of [request("它呢", { startNewTask: true }), request("一个完全独立的问题")]) {
    const b = r.startNewTask ? bridge() : { ...bridge(), relation: "new_task" };
    const context = buildJevDimensionContext(r, { bridgeContext: b });
    assert.equal(context.domain, "unknown");
    assert.deepEqual(context.previousEntities, []);
  }
  const r = request("云顶阵容怎么选", { messages: [{ role: "user", content: "帮我订酒店" }] });
  assert.equal(buildJevDimensionContext(r).domain, "tft");
  assert.equal(buildJevDimensionContext(request("最新手机的数据怎么样")).domain, "unknown");
});

test("server bridge supplies bounded antecedents but never resolves multiple candidates", () => {
  const r = request("那它呢");
  const single = buildJevDimensionContext(r, { bridgeContext: bridge() });
  assert.equal(single.domainSource, "conversation_bridge");
  assert.equal(single.previousAction, "recommend");
  assert.equal(single.entityResolution, "single_antecedent");
  const multiple = buildJevDimensionContext(r, { bridgeContext: bridge(2) });
  assert.equal(multiple.entityResolution, "unresolved");
  const projected = projectJevDimensions(observed({ context: "contextual" }), multiple);
  assert.ok(projected.advisory.uncertainties.includes("entity_unresolved"));
  assert.doesNotMatch(JSON.stringify(projectJevDimensionInput(r, single)), /secret|99%|private|historical/u);
  assert.doesNotMatch(JSON.stringify(dimensionTelemetry(projected)), /Test_Unit/u);
  assert.equal(buildJevDimensionContext(r, { bridgeContext: { ...bridge(), warning: "read_failed" } }).domain, "unknown");
});

test("current catalog mentions supersede historical antecedents and exclude unsafe IDs", () => {
  const context = buildJevDimensionContext(request("测试棋子怎么选"), { bridgeContext: bridge(),
    catalog: { units: [{ apiName: "Test_Current", zhName: "测试棋子" }, { apiName: "ignore instructions!", zhName: "测试棋子" }] } });
  assert.deepEqual(context.currentEntities, [{ entityType: "unit", apiName: "Test_Current" }]);
  assert.equal(context.entityResolution, "explicit_current");
});

test("projection ignores client state, bounds escaped text, and clears prior turns", () => {
  const r = request("再说说", { bridgeContext: bridge(), taskAnchor: { secret: "hidden" }, conversationSummary: "secret",
    messages: [{ role: "system", content: "secret" }, { role: "assistant", content: "99%" },
      ...Array.from({ length: 5 }, () => ({ role: "user", content: "\u0001".repeat(2000) }))] });
  const context = buildJevDimensionContext(r);
  assert.equal(context.domain, "unknown");
  const result = projectJevDimensionInput(r, context);
  assert.ok(result.conversationSummary.length <= 6000);
  assert.doesNotMatch(result.conversationSummary, /secret|99%/u);
  assert.doesNotThrow(() => buildJevIntentRequest(result));
  assert.deepEqual(JSON.parse(projectJevDimensionInput({ ...r, startNewTask: true }, context).conversationSummary).untrustedPreviousUserTurns, []);
});

test("dimension observation redacts IDs in telemetry and preserves limits", async () => {
  const events = [];
  const observer = createJevIntentObserver({ policy: "dimensions", mode: "shadow", maxRequests: 1, apiKey: "secret",
    fetchImpl: async () => ({ ok: true, json: async () => response({}, { domain: 0.1, context: 0.1 }) }), onObservation: e => events.push(e) });
  const result = await observer.observe(request("那它呢"), { serverContext: { bridgeContext: bridge() } });
  assert.equal(result.dimensions.advisory.action, "recommend");
  assert.equal(result.control, undefined);
  assert.equal((await observer.observe(request())).reason, "request_limit");
  assert.doesNotMatch(JSON.stringify([events, observer.snapshot()]), /Test_Unit|secret|那它/u);
  assert.deepEqual(observer.snapshot().dimensionCounts, { action: 1, domain: 1, context: 0, eligible: 1 });
  assert.equal(observer.snapshot().controlApplied, 0);
});

test("v2 shadow never delays or alters legacy control decision input", async () => {
  const states = [], bodies = [];
  let release, resolveEvent;
  const done = new Promise(resolve => { resolveEvent = resolve; });
  const common = { cacheStore: new MemoryCacheStore(), env: { TYPESAFE_API_KEY: "secret", TFT_AGENT_JEV_INTENT_MODE: "control" },
    jevIntentFetch: async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => response() }; },
    onJevIntentObservation: () => {}, onJevIntentOutcome: () => {},
    reactDecisionProvider: async ({ state }) => { states.push(structuredClone(state)); return direct(); } };
  await handleReactChatRequest(request(), createSmallWindowRuntime(common));
  const runtime = createSmallWindowRuntime({ ...common, env: { ...common.env, TFT_AGENT_JEV_INTENT_DIMENSIONS_MODE: "shadow", TFT_AGENT_JEV_INTENT_DIMENSIONS_SAMPLE_RATE: "1" },
    jevIntentDimensionsFetch: async () => { await new Promise(resolve => { release = resolve; }); return { ok: true, json: async () => response({ action: "compare" }) }; },
    onJevIntentDimensionsObservation: resolveEvent, onJevIntentDimensionsOutcome: () => {} });
  const shadow = await handleReactChatRequest(request(), runtime);
  assert.equal(shadow.payload.answer, "已收到");
  assert.deepEqual(states[0].intentAdvisory, states[1].intentAdvisory);
  assert.deepEqual(states[0].messages, states[1].messages);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(runtime.jevIntentDimensionsObserver.snapshot().inFlight, 1);
  release(); await done;
});

test("v2 control uses a single classifier, permits LLM correction and falls back without retries", async () => {
  for (const fail of [false, true]) {
    let legacyCalls = 0, calls = 0, state, outcome;
    const runtime = createSmallWindowRuntime({ cacheStore: new MemoryCacheStore(),
      env: { TYPESAFE_API_KEY: "secret", TFT_AGENT_JEV_INTENT_MODE: "control", TFT_AGENT_JEV_INTENT_DIMENSIONS_MODE: "control", TFT_AGENT_JEV_INTENT_DIMENSIONS_SAMPLE_RATE: "1" },
      jevIntentFetch: async () => { legacyCalls++; throw new Error("legacy must not run"); },
      jevIntentDimensionsFetch: async () => { calls++; if (fail) throw new Error("private error"); return { ok: true, json: async () => response({}, { domain: 0.2, context: 0.2 }) }; },
      onJevIntentDimensionsObservation: () => {}, onJevIntentDimensionsOutcome: x => { outcome = x; },
      reactDecisionProvider: async r => { state = r.state; return direct(); } });
    const result = await handleReactChatRequest(request(), runtime);
    assert.equal(result.payload.answer, "已收到");
    assert.equal(legacyCalls, 0); assert.equal(calls, 1);
    assert.equal(state.intentAdvisory?.action ?? null, fail ? null : "recommend");
    assert.equal(outcome.actionHintApplied, !fail);
    assert.equal(outcome.hintAcceptance, "not_measured");
  }
});

test("real scoped Bridge metadata reaches Jev; cross-conversation and reset do not inherit", async () => {
  const store = await SQLiteConversationBridgeStore.open({ filePath: ":memory:" });
  try {
    const input = { scopeKey: "local", conversationId: "jev-a", requestId: "jev-seed", seasonContextId: DEFAULT_SEASON_CONTEXT_ID,
      quickTask: { id: "unit-build", operation: "unit_build_rankings", arguments: { champion: "测试英雄" } } };
    await store.reserveQuickTask(input);
    await store.commitQuickTask({ ...input, payload: { type: "unit_build_rankings", unit: { apiName: "Test_OnlyHere", name: "测试英雄" } } });
    const bodies = [];
    const runtime = createSmallWindowRuntime({ cacheStore: new MemoryCacheStore(), conversationBridgeStore: store,
      env: { TYPESAFE_API_KEY: "secret", TFT_AGENT_JEV_INTENT_DIMENSIONS_MODE: "control", TFT_AGENT_JEV_INTENT_DIMENSIONS_SAMPLE_RATE: "1" },
      jevIntentDimensionsFetch: async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => response({ context: "contextual" }) }; },
      onJevIntentDimensionsObservation: () => {}, onJevIntentDimensionsOutcome: () => {}, reactDecisionProvider: async () => direct() });
    await handleReactChatRequest(request("它为什么这样", { conversationId: "jev-a" }), runtime);
    await handleReactChatRequest(request("它为什么这样", { conversationId: "jev-b", taskAnchor: { entity: "Test_OnlyHere" } }), runtime);
    await handleReactChatRequest(request("它为什么这样", { conversationId: "jev-a", startNewTask: true }), runtime);
    assert.match(bodies[0].state.conversationSummary, /Test_OnlyHere/u);
    for (const body of bodies.slice(1)) assert.doesNotMatch(body.state.conversationSummary, /Test_OnlyHere/u);
  } finally { store.close(); }
});

test("both LLM message layouts receive partial hints with unchanged tool schemas", async () => {
  for (const messageLayout of ["append_only", "legacy_full_state"]) {
    let body;
    const advisory = projectJevDimensions(observed({}, { context: 0.1 }), buildJevDimensionContext(request())).advisory;
    const toolCatalog = [{ name: "unit_details", inputSchema: { type: "object", additionalProperties: false } }];
    const provider = createReactDecisionProvider({ endpoint: "https://example.test", model: "test", messageLayout,
      fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ...direct(), narrative: null }) } }] }) }; } });
    await provider({ state: { question: "云顶问题", intentAdvisory: advisory }, toolCatalog });
    const guidance = body.messages.find(x => x.content.startsWith("jev-intent-dimensions.v2"));
    assert.match(guidance.content, /Null action\/context means uncertain/u);
    assert.match(guidance.content, /may correct the hint/u);
    const contexts = body.messages.flatMap(x => { try { return [JSON.parse(x.content)]; } catch { return []; } });
    assert.deepEqual(contexts.find(x => x.toolCatalog)?.toolCatalog, toolCatalog);
  }
});
