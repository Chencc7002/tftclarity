import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createDefaultReactToolHandlerBundle, createSmallWindowRuntime, createSmallWindowRuntimeAsync, handleReactChatRequest } from "../src/app/small-window-server.js";
import { createCatalog } from "../src/data/static-data.js";
import { MemoryCacheStore } from "../src/data/cache-store.js";
import { ReactLoop } from "../src/react/react-loop.js";
import { createLegacySeasonFixture } from "./fixtures/season-context.js";
import { SQLiteConversationBridgeStore } from "../src/conversation/sqlite-conversation-bridge-store.js";

const fixture = JSON.parse(readFileSync(new URL("../eval/entity-names/typos.json", import.meta.url), "utf8"));
function runtimeFor(options = {}) {
  return createSmallWindowRuntime({
    env: {}, seasonContextService: createLegacySeasonFixture(),
    cacheStore: new MemoryCacheStore(), catalog: createCatalog(structuredClone(fixture.catalog)),
    officialEntityDetails: { meta: { updatedAt: "2026-09-06T00:00:00.000Z" },
      units: new Map(fixture.catalog.units.map(unit => [unit.apiName, { name: unit.zhName, cost: unit.cost ?? 1,
        ability: { name: "测试技能", description: "测试技能说明" } }])), traits: new Map() },
    ...options
  });
}
const request = { input: "卡尔马的技能是什么", seasonContextId: "set17-live", locale: "zh-CN" };
const catalogAction = name => ({ schemaVersion: "react-action.v1", type: "call_tool", tool: "entity_catalog_query",
  arguments: { entityType: "unit", filters: { names: [name] } }, purposeCode: "retrieve_entity_details" });
const guessedDetail = { schemaVersion: "react-action.v1", type: "call_tool", tool: "unit_details",
  arguments: { apiName: "Test_Karma" }, purposeCode: "retrieve_entity_details" };

test("runtime mode is server-controlled, defaults off and supports shadow telemetry", async () => {
  const off = runtimeFor();
  assert.equal(off.entityNameResolutionMode, "off");
  const observations = [];
  const shadow = runtimeFor({ env: { TFT_AGENT_ENTITY_NAME_RESOLUTION_MODE: "shadow" }, onEntityNameResolution: event => observations.push(event) });
  const offBundle = await createDefaultReactToolHandlerBundle({ request, runtime: off });
  const shadowBundle = await createDefaultReactToolHandlerBundle({ request, runtime: shadow });
  const input = catalogAction("卡尔马").arguments;
  const legacy = await offBundle.handlers.entity_catalog_query(input);
  assert.equal(legacy.resolution.requests[0].status, "not_found");
  assert.deepEqual(await shadowBundle.handlers.entity_catalog_query(input), legacy);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].seasonContextId, "set17-live");
  assert.equal(shadow.entityNameResolutionTelemetry.snapshot().withCandidates, 1);
  assert.equal(off.entityNameResolutionTelemetry.snapshot().completed, 0);
  await shadowBundle.handlers.entity_catalog_query(catalogAction("卡尔玛").arguments);
  assert.equal(observations.length, 1, "immediate exact path must bypass candidate generation");
});

test("default chat handler returns generated candidates and ReAct blocks a guessed details call", async () => {
  let decisions = 0;
  const runtime = runtimeFor({ entityNameResolutionMode: "suggest",
    reactDecisionProvider: async () => decisions++ === 0 ? catalogAction("卡尔马") : guessedDetail });
  const tools = [];
  const { payload } = await handleReactChatRequest({ ...request, conversationId: "typo-confirmation" }, runtime, {
    onProgress: event => { if (event.type === "tool_started") tools.push(event.data?.toolName ?? event.data?.tool); }
  });
  assert.equal(payload.status, "clarification_required", JSON.stringify(payload));
  assert.match(payload.question, /卡尔马.*卡尔玛/u);
  assert.deepEqual(payload.missingFields, ["unit"]);
  assert.equal(payload.evidence.length, 1);
  assert.equal(payload.evidence[0].toolName, "entity_catalog_query");
  assert.equal(runtime.entityNameResolutionTelemetry.snapshot().withCandidates, 1);
  assert.ok(!tools.includes("unit_details"));
});

test("a generated candidate can be confirmed and must be re-resolved in current catalog evidence", async () => {
  const runtime = runtimeFor({ entityNameResolutionMode: "suggest" });
  const bundle = await createDefaultReactToolHandlerBundle({ request, runtime });
  const calls = [];
  const handlers = Object.fromEntries(Object.entries(bundle.handlers).map(([name, handler]) => [name, async (...args) => {
    calls.push({ name, input: args[0] });
    return handler(...args);
  }]));
  const candidateResult = await bundle.handlers.entity_catalog_query(catalogAction("卡尔马").arguments);
  const candidates = candidateResult.resolution.requests[0].candidates.map(({ apiName, name }) => ({ apiName, name }));
  const loop = new ReactLoop({ registry: runtime.toolRegistry, toolExecutor: runtime.toolExecutor, handlers,
    decisionProvider: async ({ state }) => state.evidence.length < 2 ? guessedDetail : {
      schemaVersion: "react-action.v1", type: "finish", answer: "卡尔玛的技能是测试技能。",
      reasonCode: "sufficient_evidence", evidenceIds: state.evidence.map(entry => entry.evidenceId)
    } });
  const result = await loop.run({ input: "是的", seasonContextId: "set17-live",
    bridgeContext: { view: { pendingClarification: { confirmationContext: {
      type: "entity_candidate", entityType: "unit", inputName: "卡尔马", originalInput: request.input, candidates
    } } } } });
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(calls[0].name, "entity_catalog_query");
  assert.deepEqual(calls[0].input.filters.names, ["卡尔玛"]);
  assert.equal(calls[1].name, "unit_details");
  assert.equal(calls[1].input.apiName, "Test_Karma");
});

test("request bodies cannot turn candidate mode on", async () => {
  let decisions = 0;
  const runtime = runtimeFor({ reactDecisionProvider: async () => decisions++ === 0 ? catalogAction("卡尔马") : {
    schemaVersion: "react-action.v1", type: "ask_user", question: "请提供英雄名称", missingFields: ["unit"], reasonCode: "missing_context"
  } });
  await handleReactChatRequest({ ...request, entityNameResolutionMode: "suggest" }, runtime);
  assert.equal(runtime.entityNameResolutionMode, "off");
  assert.equal(runtime.entityNameResolutionTelemetry.snapshot().completed, 0);
});

test("unknown nickname uses current catalog and chat requires confirmation before details", async () => {
  let decisions = 0;
  let seen;
  const runtime = runtimeFor({ entitySlangMode: "suggest", entitySlangProvider: async request => {
    seen = request;
    return { schemaVersion: "entity-slang-proposal.v1", resolutions: request.mentions.map(mention => ({
      mention, candidateIds: ["Test_Karma"], reason: "known_nickname"
    })) };
  }, reactDecisionProvider: async () => decisions++ === 0 ? catalogAction("扇子姐姐") : guessedDetail });
  const { payload } = await handleReactChatRequest({ ...request, input: "扇子姐姐的技能是什么", conversationId: "slang-confirmation" }, runtime);
  assert.equal(payload.status, "clarification_required", JSON.stringify(payload));
  assert.match(payload.question, /扇子姐姐.*卡尔玛/u);
  assert.equal(payload.evidence.length, 1);
  assert.equal(payload.evidence[0].toolName, "entity_catalog_query");
  assert.equal(seen.seasonContextId, "set17-live");
  assert.equal(seen.currentQuestion, "扇子姐姐的技能是什么");
  assert.equal(runtime.entitySlangTelemetry.snapshot().calls, 1);

  const confirmed = await handleReactChatRequest({ ...request, input: "是的", conversationId: "slang-confirmation" }, runtime);
  assert.equal(runtime.entitySlangTelemetry.snapshot().calls, 1, "confirmation uses current exact resolution, no new slang call");
  assert.ok(confirmed.payload.evidence.some(entry => entry.toolName === "unit_details"), JSON.stringify(confirmed.payload));
});

test("slang shadow preserves default handler output and request bodies cannot enable it", async () => {
  const slangRequest = { ...request, input: "扇子姐姐的技能是什么", entitySlangMode: "suggest" };
  let calls = 0;
  const provider = async request => { calls++; return { schemaVersion: "entity-slang-proposal.v1",
    resolutions: request.mentions.map(mention => ({ mention, candidateIds: ["Test_Karma"], reason: "known_nickname" })) }; };
  const off = runtimeFor({ entitySlangProvider: provider });
  const shadow = runtimeFor({ env: { TFT_AGENT_ENTITY_SLANG_MODE: "shadow" }, entitySlangProvider: provider });
  const offBundle = await createDefaultReactToolHandlerBundle({ request: slangRequest, runtime: off });
  const shadowBundle = await createDefaultReactToolHandlerBundle({ request: slangRequest, runtime: shadow });
  const input = catalogAction("扇子姐姐").arguments;
  const legacy = await offBundle.handlers.entity_catalog_query(input);
  assert.equal(calls, 0);
  assert.equal(legacy.resolution.requests[0].status, "not_found");
  assert.deepEqual(await shadowBundle.handlers.entity_catalog_query(input), legacy);
  assert.equal(calls, 1);
  assert.equal(shadow.entitySlangTelemetry.snapshot().proposals, 1);
});

test("async server factory wires the configured model without making eager slang calls", async () => {
  let calls = 0;
  const runtime = await createSmallWindowRuntimeAsync({
    cacheStore: new MemoryCacheStore(), catalog: createCatalog(structuredClone(fixture.catalog)),
    seasonContextService: createLegacySeasonFixture(), fetchItems: false, metaTFTClient: {}, compsClient: {},
    llmProvider: "chat", llmEndpoint: "https://configured.test/chat", llmModel: "test-model", llmMode: "auto",
    entitySlangFetch: async (url, options) => {
      calls++;
      assert.equal(url, "https://configured.test/chat");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "test-model");
      const input = JSON.parse(body.messages[1].content);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        schemaVersion: "entity-slang-proposal.v1", resolutions: input.mentions.map(mention => ({
          mention, candidateIds: ["Test_Karma"], reason: "known_nickname"
        }))
      }) } }] }) };
    }
  }, { TFT_AGENT_ENTITY_SLANG_MODE: "suggest" });
  assert.equal(calls, 0);
  assert.equal(runtime.entitySlangMode, "suggest");
  const bundle = await createDefaultReactToolHandlerBundle({ runtime, request: { ...request, input: "扇子姐姐的技能是什么" } });
  const result = await bundle.handlers.entity_catalog_query(catalogAction("扇子姐姐").arguments);
  assert.equal(result.resolution.requests[0].status, "ambiguous");
  assert.equal(calls, 1);
});

for (const withBridge of [true, false]) test(`second candidate selection rechecks current evidence (bridge=${withBridge})`, async t => {
  const conversationBridgeStore = withBridge ? await SQLiteConversationBridgeStore.open({ filePath: ":memory:" }) : null;
  t.after(() => conversationBridgeStore?.close());
  const runtime = runtimeFor({ conversationBridgeStore, entitySlangMode: "suggest", entitySlangProvider: async request => ({
    schemaVersion: "entity-slang-proposal.v1", resolutions: request.mentions.map(mention => ({
      mention, candidateIds: ["Test_Nami", "Test_Karma"], reason: "ambiguous"
    }))
  }), reactDecisionProvider: async ({ state }) => state.evidence.length === 0 ? catalogAction(state.question.includes("卡尔玛") ? "卡尔玛" : "扇子姐姐")
    : state.evidence.length === 1 ? guessedDetail : {
      schemaVersion: "react-action.v1", type: "finish", answer: "卡尔玛的技能是测试技能。",
      reasonCode: "sufficient_evidence", evidenceIds: state.evidence.map(entry => entry.evidenceId)
    } });
  const base = { ...request, conversationId: "click-second-candidate" };
  const first = await handleReactChatRequest({ ...base, input: "扇子姐姐的技能是什么" }, runtime);
  assert.equal(first.payload.status, "clarification_required");
  assert.deepEqual(first.payload.clarificationContext.candidates.map(row => row.name), ["娜美", "卡尔玛"]);
  const selected = await handleReactChatRequest({ ...base, input: withBridge ? "卡尔玛" : "卡尔玛的技能是什么" }, runtime);
  assert.equal(selected.payload.status, "completed", JSON.stringify(selected.payload));
  const catalogEvidence = selected.payload.evidence.find(entry => entry.toolName === "entity_catalog_query");
  assert.equal(catalogEvidence.value.resolution.requests[0].inputName, "卡尔玛");
  assert.equal(catalogEvidence.value.resolution.requests[0].status, "resolved");
  assert.equal(selected.payload.evidence.filter(entry => entry.toolName === "unit_details").length, 1);
  assert.equal(runtime.entitySlangTelemetry.snapshot().calls, 1);
});
