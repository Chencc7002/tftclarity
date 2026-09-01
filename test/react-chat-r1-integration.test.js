import { createLegacySeasonFixture } from "./fixtures/season-context.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultReactToolHandlerBundle,
  createSmallWindowRuntime,
  handleFeedbackRequest,
  handleReactChatRequest
} from "../src/app/small-window-server.js";
import { MemoryCacheStore, createCatalog, recommendForInput } from "../src/index.js";
import {
  assertHandlerCoverage,
  createTftToolHandlers
} from "../src/domain/tft/tool-handler-factory.js";

const directFinish = {
  schemaVersion: "react-action.v1",
  type: "finish",
  answer: "这是一个普通回答。",
  evidenceIds: [],
  reasonCode: "direct_answer"
};

test("independent react endpoint answers without entering recommendForInput", async () => {
  let legacyCalls = 0;
  let visibleTools = [];
  const runtime = createSmallWindowRuntime({
    reactDecisionProvider: async (request) => {
      visibleTools = request.toolCatalog.map((tool) => tool.name);
      return directFinish;
    },
    recommendForInputImpl: async () => {
      legacyCalls += 1;
      throw new Error("legacy chain must not run");
    }
  });
  const { statusCode, payload } = await handleReactChatRequest({
    input: "解释一下 ReAct",
    conversationId: "react-test"
  }, runtime);
  assert.equal(statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.answer, directFinish.answer);
  assert.equal(payload.terminationReason, "completed");
  assert.equal(runtime.reactChatBudget.maxToolCalls, null);
  assert.equal(runtime.reactGroundingMode, "observe");
  assert.equal(payload.run.budget.maxToolCalls, null);
  assert.equal(legacyCalls, 0);
  assert.deepEqual(visibleTools, [
    "unit_builds",
    "unit_builds_batch",
    "item_carrier_rankings",
    "comps_rankings",
    "composition_tactical_details",
    "composition_replacement_evaluation",
    "composition_change_evaluation",
    "comps_trends",
    "comps_analysis",
    "unit_details",
    "item_details",
    "item_details_batch",
    "trait_details",
    "entity_catalog_query",
    "composition_member_statistics",
    "strategy_video_search"
  ]);
});

test("default react completion handler retains a carried emblem but restricts the new slot", async () => {
  const unit = "TFT17_Xayah", emblem = "Test_BruiserEmblem", locked = "TFT_Item_GuinsoosRageblade";
  const catalog = createCatalog({ items: [...createCatalog().items, {
    apiName: emblem, zhName: "斗士纹章", aliases: ["斗转"], category: "emblem", current: true, obtainable: true
  }] });
  const rows = ["TFT_Item_InfinityEdge", "TFT5_Item_GuinsoosRagebladeRadiant"].map(candidate => ({
    unit_builds: `${unit}&${emblem}|${locked}|${candidate}`, placement_count: [150, 130, 110, 90, 70, 50, 30, 10]
  }));
  const runtime = createSmallWindowRuntime({ seasonContextService: createLegacySeasonFixture(), catalog, cacheStore: new MemoryCacheStore(), officialItemDetails: new Map(),
    recommendForInputImpl: (input, options) => recommendForInput(input, { ...options, response: rows }) });
  const bundle = await createDefaultReactToolHandlerBundle({ runtime, context: {},
    request: { input: "第三件只要普通装备", seasonContextId: "set17-live", locale: "zh-CN" } });
  const result = await bundle.handlers.unit_builds({ unit, lockedItems: [emblem, locked], itemPolicy: "ordinary_only", itemCount: 3, minSamples: 0 });
  assert.equal(result.type, "unit_build_completion");
  assert.equal(result.query.itemPolicyScope, "remaining_items");
  assert.deepEqual(result.query.lockedItems, [emblem, locked]);
  assert.deepEqual(result.cards.map(card => card.items.map(item => item.apiName)), [[emblem, locked, "TFT_Item_InfinityEdge"]]);
});

test("unit-play item mechanism plan is server-derived from the leading card and default off", async () => {
  const unit = "TFT17_Xayah";
  const items = ["TFT_Item_InfinityEdge", "TFT_Item_GuinsoosRageblade", "TFT_Item_SpearOfShojin"];
  const catalog = createCatalog();
  const rows = [{ unit_builds: `${unit}&${items.join("|")}`,
    placement_count: [150, 130, 110, 90, 70, 50, 30, 10] }];
  const runtime = createSmallWindowRuntime({ seasonContextService: createLegacySeasonFixture(), catalog,
    cacheStore: new MemoryCacheStore(), officialItemDetails: new Map(),
    recommendForInputImpl: (input, options) => recommendForInput(input, { ...options, response: rows }) });
  const request = { input: "霞怎么玩？", seasonContextId: "set17-live", locale: "zh-CN",
    semanticAdvisory: { action: "recommend", goal: "recommend_unit_play",
      subject: { resolvedId: unit }, expectedOutput: ["unit_play_guidance"] } };
  const legacy = await createDefaultReactToolHandlerBundle({ runtime, context: {}, request });
  const legacyResult = await legacy.handlers.unit_builds({ unit, itemCount: 3, minSamples: 0 });
  assert.equal(legacyResult.mechanismQueryPlan, undefined);
  runtime.reactUnitPlayItemMechanismBatch = true;
  const candidate = await createDefaultReactToolHandlerBundle({ runtime, context: {}, request });
  const result = await candidate.handlers.unit_builds({ unit, itemCount: 3, minSamples: 0 });
  assert.deepEqual(result.mechanismQueryPlan, {
    schemaVersion: "unit-play-item-mechanism-query-plan.v1",
    status: "available",
    apiNames: result.cards[0].items.map((item) => item.apiName),
    seasonContextId: "set17-live",
    sourceCardIndex: 0
  });
  const unrelated = await createDefaultReactToolHandlerBundle({ runtime, context: {},
    request: { input: "霞推荐出装", seasonContextId: "set17-live", locale: "zh-CN" } });
  assert.equal((await unrelated.handlers.unit_builds({ unit, itemCount: 3, minSamples: 0 })).mechanismQueryPlan, undefined);
});

test("default react unit_builds handler preserves deterministic equipment intents", async () => {
  const calls = [];
  const unitApiName = "TFT18_Test";
  const itemA = "TFT_Item_GuinsoosRageblade";
  const itemB = "TFT_Item_InfinityEdge";
  const catalog = createCatalog({
    units: [{ apiName: unitApiName, zhName: "测试棋子", aliases: ["测试棋子"] }],
    items: [
      { apiName: itemA, zhName: "鬼索的狂暴之刃", category: "ordinary_completed", aliases: ["羊刀"] },
      { apiName: itemB, zhName: "无尽之刃", category: "ordinary_completed", aliases: ["无尽"] }
    ]
  });
  const runtime = createSmallWindowRuntime({
    catalog,
    officialItemDetails: new Map(),
    recommendForInputImpl: async (_input, options) => {
      const query = options.resolvedParsedInput;
      calls.push(query);
      if (query.intent === "unit_item_rankings") {
        return {
          type: query.intent,
          query,
          text: "单件装备排行",
          itemRankings: [{
            apiName: itemA,
            category: "ordinary_completed",
            stats: { top4Rate: 0.6, winRate: 0.2, avgPlacement: 3.8, games: 100 },
            commonPairings: [],
            copyCounts: []
          }],
          source: { provider: "MetaTFT", updatedAt: "2026-08-13T00:00:00.000Z" }
        };
      }
      return {
        type: query.intent,
        query,
        text: "装备查询",
        rankedBuilds: [],
        source: { provider: "MetaTFT", updatedAt: "2026-08-13T00:00:00.000Z" }
      };
    }
  });
  const bundle = await createDefaultReactToolHandlerBundle({
    request: { seasonContextId: "set18-live", locale: "zh-CN" },
    runtime,
    context: {}
  });

  const ranked = await bundle.handlers.unit_builds({
    unit: unitApiName,
    itemCategories: ["ordinary_completed"]
  });
  const completed = await bundle.handlers.unit_builds({
    unit: unitApiName,
    lockedItems: [itemA]
  });
  const compared = await bundle.handlers.unit_builds({
    unit: unitApiName,
    comparisonItems: [itemA, itemB],
    primaryMetric: "performance"
  });

  assert.equal(ranked.type, "unit_item_rankings");
  assert.equal(completed.type, "unit_build_completion");
  assert.equal(compared.type, "unit_item_comparison");
  for (const value of [ranked, completed, compared]) {
    assert.deepEqual(value.scope, { seasonContextId: "set18-live", patch: "current" });
    assert.equal(value.source.updatedAt, "2026-08-13T00:00:00.000Z", "scope must not refresh an old source");
  }
  assert.deepEqual(calls.map((entry) => entry.intent), [
    "unit_item_rankings",
    "unit_build_completion",
    "unit_item_comparison"
  ]);
  assert.deepEqual(calls[1].lockedItems, [itemA]);
  assert.deepEqual(calls[2].comparisonItems, [itemA, itemB]);
  assert.equal(calls[2].primaryMetric, "top4Rate");
});

test("active Pool dashboard evidence is promoted into the ReAct ledger", async () => {
  let seenEvidence = [];
  const runtime = createSmallWindowRuntime({
    reactDecisionProvider: async (request) => {
      seenEvidence = request.state.evidence;
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "当前 Pool 的热门阵容是阿狸。",
        evidenceIds: [request.state.evidence[0].evidenceId],
        reasonCode: "sufficient_evidence"
      };
    }
  });
  const trustedAnalysisContext = {
    schemaVersion: "player-pool-analysis-evidence.v1",
    mode: "single_pool",
    generatedAt: "2026-08-13T00:00:00.000Z",
    statementPolicy: "只描述当前玩家池。",
    pool: {
      id: "pool-a",
      name: "pbe高手",
      scope: { season: "set18-live", patch: "18.1" },
      coverage: { matchCount: 180, activePlayerCount: 9 },
      performance: { avgPlacement: 3.82, top4Rate: .62, winRate: .2 },
      compositions: [{ label: "阿狸", matchWeightedUsageRate: .1, matchCount: 18 }]
    }
  };
  const { payload } = await handleReactChatRequest({
    input: "用新手能理解的话解读当前 Pool",
    conversationId: "pool-analysis-test"
  }, runtime, { trustedAnalysisContext });
  assert.equal(payload.ok, true);
  assert.equal(seenEvidence.length, 1);
  assert.equal(seenEvidence[0].toolName, "player_pool_stats");
  assert.equal(seenEvidence[0].source, "tftclarity_player_pool_dashboard");
  assert.equal(seenEvidence[0].value.pool.name, "pbe高手");
  assert.equal(payload.evidenceIds[0], seenEvidence[0].evidenceId);
});

test("react answers persist a trusted feedback snapshot with validation context", async () => {
  const cacheStore = new MemoryCacheStore();
  const visitor = { scope: "react-feedback-user" };
  const runtime = createSmallWindowRuntime({
    cacheStore,
    reactDecisionProvider: async (request) => request.state.evidence.length
      ? {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "17.9 最高伤害提高至 999。",
        evidenceIds: [request.state.evidence[0].evidenceId],
        reasonCode: "sufficient_evidence"
      }
      : {
        schemaVersion: "react-action.v1",
        type: "call_tool",
        tool: "semantic_search",
        arguments: { query: "17.9更新", documentTypes: ["patch_note"] },
        purposeCode: "retrieve_supporting_knowledge"
      },
    reactToolHandlers: {
      semantic_search: async () => ({
        type: "semantic_search_results",
        hits: [{ claim: "17.9 伤害获得调整" }],
        updatedAt: "2026-08-12T00:00:00.000Z"
      })
    }
  });
  const { payload } = await handleReactChatRequest({ input: "总结17.9更新" }, runtime, { visitor });
  assert.match(payload.queryId, /^[0-9a-f-]{36}$/u);
  const queryEvent = await cacheStore.getQueryEvent(payload.queryId);
  assert.equal(queryEvent.response.answerOrigin, "model_soft_validated_summary");

  const feedback = await handleFeedbackRequest({
    queryId: payload.queryId,
    target: "explanation",
    rating: "unhelpful",
    reason: "explanation_incorrect"
  }, runtime, { visitor });
  assert.equal(feedback.feedback.payload.explanation, payload.answer);
  assert.equal(feedback.feedback.payload.explanationContext.answerOrigin, "model_soft_validated_summary");
  assert.ok(feedback.feedback.payload.explanationContext.validationWarnings.length > 0);
});

test("independent react endpoint executes a shared registered handler", async () => {
  let handlerCalls = 0;
  const runtime = createSmallWindowRuntime({
    reactDecisionProvider: async (request) => {
      const evidence = request.state.evidence[0];
      if (!evidence) {
        return {
          schemaVersion: "react-action.v1",
          type: "call_tool",
          tool: "unit_details",
          arguments: { apiName: "TFT18_Xayah" },
          purposeCode: "retrieve_entity_details"
        };
      }
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "霞的技能是羽刃。",
        evidenceIds: [evidence.evidenceId],
        reasonCode: "sufficient_evidence"
      };
    },
    reactToolHandlers: {
      unit_details: async () => {
        handlerCalls += 1;
        return {
          updatedAt: "2026-08-06T00:00:00.000Z",
          results: [{ apiName: "TFT18_Xayah", spell: "羽刃" }]
        };
      }
    }
  });
  const eventTypes = [];
  const { payload } = await handleReactChatRequest({ input: "霞的技能是什么？" }, runtime, {
    onProgress: (event) => eventTypes.push(event.type)
  });
  assert.equal(payload.ok, true);
  assert.equal(handlerCalls, 1);
  assert.equal(payload.evidence.length, 1);
  assert.deepEqual(eventTypes, [
    "run_started",
    "decision",
    "tool_started",
    "tool_completed",
    "evidence_added",
    "decision",
    "answer",
    "termination"
  ]);
});

test("react endpoint fails closed when no decision provider is configured", async () => {
  const runtime = createSmallWindowRuntime();
  const { statusCode, payload } = await handleReactChatRequest({ input: "hello" }, runtime);
  assert.equal(statusCode, 503);
  assert.equal(payload.code, "react_chat_unavailable");
});

test("react endpoint reserves one AI use per request and returns refreshed access", async () => {
  let reserveCalls = 0;
  let providerCalls = 0;
  const visitor = { scope: "quota-user", visitorHash: "visitor", ipHash: "ip" };
  const accessService = {
    config: { enabled: true },
    async reserveLlmUse(receivedVisitor) {
      assert.equal(receivedVisitor, visitor);
      reserveCalls += 1;
    },
    async publicStatus(receivedVisitor) {
      assert.equal(receivedVisitor, visitor);
      return { anonymous: true, quota: { limit: 50, used: 1, remaining: 49 } };
    }
  };
  const runtime = createSmallWindowRuntime({
    reactDecisionProvider: async (request) => {
      providerCalls += 1;
      if (!request.state.evidence.length) {
        return {
          schemaVersion: "react-action.v1",
          type: "call_tool",
          tool: "unit_details",
          arguments: { apiName: "TFT18_Xayah" },
          purposeCode: "retrieve_entity_details"
        };
      }
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "霞的技能是羽刃。",
        evidenceIds: [request.state.evidence[0].evidenceId],
        reasonCode: "sufficient_evidence"
      };
    },
    reactToolHandlers: {
      unit_details: async () => ({ results: [{ apiName: "TFT18_Xayah" }] })
    }
  });

  const { statusCode, payload } = await handleReactChatRequest({ input: "霞的技能是什么？" }, runtime, {
    visitor,
    accessService
  });

  assert.equal(statusCode, 200);
  assert.equal(providerCalls, 2);
  assert.equal(reserveCalls, 1);
  assert.deepEqual(payload.access.quota, { limit: 50, used: 1, remaining: 49 });
});

test("TFT handler factory reports unavailable tools and enforces explicit coverage", () => {
  const runtime = createSmallWindowRuntime();
  const bundle = createTftToolHandlers({
    registry: runtime.toolRegistry,
    handlers: { unit_details: async () => ({}) }
  });
  assert.equal(typeof bundle.handlers.unit_details, "function");
  assert.deepEqual(bundle.availableToolNames, ["unit_details"]);
  assert.ok(bundle.unavailableTools.includes("unit_builds"));
  assert.throws(
    () => assertHandlerCoverage({ registry: runtime.toolRegistry, handlers: bundle.handlers }),
    /Missing TFT tool handlers/u
  );
  assert.doesNotThrow(() => assertHandlerCoverage({
    registry: runtime.toolRegistry,
    handlers: bundle.handlers,
    allowedMissingTools: bundle.unavailableTools
  }));
});

test("default react bundle is request-scoped and exposes H1 only when its dependency is available", async () => {
  const runtime = createSmallWindowRuntime({ seasonContextService: createLegacySeasonFixture(),
    cacheStore: new MemoryCacheStore(),
    semanticRetriever: {
      async search() { return []; }
    }
  });
  const bundle = await createDefaultReactToolHandlerBundle({
    request: { seasonContextId: "set17-live" },
    runtime,
    context: {}
  });
  assert.deepEqual(bundle.availableToolNames, [
    "entity_catalog_query",
    "comps_rankings",
    "comps_trends",
    "composition_tactical_details",
    "composition_replacement_evaluation",
    "composition_change_evaluation",
    "composition_member_statistics",
    "unit_builds",
    "unit_builds_batch",
    "comps_analysis",
    "item_carrier_rankings",
    "unit_details",
    "trait_details",
    "item_details",
    "item_details_batch",
    "semantic_search",
    "strategy_video_search"
  ]);
  assert.deepEqual(
    [...bundle.availableToolNames].sort(),
    Object.keys(bundle.handlers).sort()
  );
});

test("Set 18 live unit details reuse the season-scoped catalog", async () => {
  const rawOfficialDetails = {
    meta: { updatedAt: "2026-08-13T00:00:00.000Z" },
    units: new Map(),
    traits: new Map()
  };
  const pbeDetails = {
    meta: {
      updatedAt: "2026-08-14T00:00:00.000Z",
      sources: ["https://raw.communitydragon.org/pbe/"]
    },
    units: new Map([["DA_18_Warwick", {
      apiName: "DA_18_Warwick",
      name: "沃里克",
      cost: 4,
      traitNames: ["测试羁绊"],
      ability: { name: "无尽兽性", description: "扑向目标并持续攻击。" },
      stats: { mana: 40, attackRange: 1 }
    }]]),
    traits: new Map()
  };
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    officialEntityDetails: rawOfficialDetails
  });
  runtime.catalogCache.set(
    "set18-live:metatft-live.v1:current:1100:TFTSet18:latest:zh_cn",
    {
      catalog: createCatalog({
        units: [{ apiName: "DA_18_Warwick", zhName: "沃里克", aliases: ["沃里克"] }]
      }),
      warning: null,
      compsData: null,
      entityDetails: pbeDetails
    }
  );

  const bundle = await createDefaultReactToolHandlerBundle({
    request: { seasonContextId: "set18-live", locale: "zh-CN" },
    runtime,
    context: {}
  });
  const detail = await bundle.handlers.unit_details({ apiName: "DA_18_Warwick" });
  assert.equal(detail.status, "found");
  assert.equal(detail.displayName, "沃里克");
  assert.equal(detail.facts.ability.name, "无尽兽性");
  assert.equal(detail.source.sourceType, "communitydragon");
});

test("default react item carrier handler reuses the deterministic ranking service", async () => {
  let parsedInput = null;
  const itemApiName = "TFT_Item_GuinsoosRageblade";
  const runtime = createSmallWindowRuntime({ seasonContextService: createLegacySeasonFixture(),
    catalog: createCatalog({
      units: [{ apiName: "TFT18_Test", zhName: "测试棋子", aliases: ["测试棋子"] }],
      items: [{ apiName: itemApiName, zhName: "鬼索的狂暴之刃", aliases: ["羊刀"] }]
    }),
    recommendForInputImpl: async (_input, options) => {
      parsedInput = options.resolvedParsedInput;
      return {
        type: "item_carrier_rankings",
        item: itemApiName,
        query: { item: itemApiName },
        carriers: [{
          unitApiName: "TFT18_Test",
          stats: { top4Rate: .6, winRate: .2, avgPlacement: 3.7, games: 120 },
          baselineAvgPlacement: 4.2,
          unitDelta: -.5,
          placementUplift: .5,
          builds: []
        }],
        text: "鬼索的狂暴之刃共找到 1 个正向提升携带者。",
        source: { provider: "MetaTFT", updatedAt: "2026-08-13T00:00:00.000Z" },
        warnings: []
      };
    }
  });
  const bundle = await createDefaultReactToolHandlerBundle({
    request: { seasonContextId: "set17-live", locale: "zh-CN" },
    runtime,
    context: {}
  });
  const value = await bundle.handlers.item_carrier_rankings({ item: itemApiName });
  assert.equal(parsedInput.intent, "item_carrier_rankings");
  assert.equal(parsedInput.carrierItem, itemApiName);
  assert.equal(value.type, "item_carrier_rankings");
  assert.equal(value.item.apiName, itemApiName);
  assert.equal(value.carriers[0].unit.apiName, "TFT18_Test");
  assert.equal(value.updatedAt, "2026-08-13T00:00:00.000Z");
});

test("natural-language item carrier questions require rankings and matching item details", async () => {
  let submittedPrematureFinish = false;
  const runtime = createSmallWindowRuntime({
    reactToolHandlers: {
      entity_catalog_query: async () => ({
        type: "entity_catalog_results",
        source: "official_tft_catalog",
        updatedAt: "2026-08-13T00:00:00.000Z",
        entityType: "item",
        resolution: {
          requests: [{
            status: "resolved",
            candidates: [{ apiName: "TFT_Item_GuinsoosRageblade", name: "鬼索的狂暴之刃" }]
          }]
        },
        results: [{ apiName: "TFT_Item_GuinsoosRageblade", name: "鬼索的狂暴之刃" }]
      }),
      item_carrier_rankings: async () => ({
        type: "item_carrier_rankings",
        source: { provider: "MetaTFT", updatedAt: "2026-08-13T00:00:00.000Z" },
        updatedAt: "2026-08-13T00:00:00.000Z",
        item: { apiName: "TFT_Item_GuinsoosRageblade", name: "鬼索的狂暴之刃" },
        query: { item: "TFT_Item_GuinsoosRageblade" },
        carriers: [{ unit: { apiName: "TFT18_Test", name: "测试棋子" }, stats: { games: 120 } }]
      }),
      item_details: async () => ({
        schemaVersion: "official-entity-detail.v1",
        type: "item_details",
        status: "found",
        entityType: "item",
        apiName: "TFT_Item_GuinsoosRageblade",
        displayName: "鬼索的狂暴之刃",
        facts: { effect: "攻击会叠加攻速。", composition: [] },
        source: { sourceType: "official_tft_catalog" },
        updatedAt: "2026-08-13T00:00:00.000Z"
      })
    },
    reactDecisionProvider: async (request) => {
      const evidence = request.state.evidence;
      const catalog = evidence.find((entry) => entry.toolName === "entity_catalog_query");
      const carriers = evidence.find((entry) => entry.toolName === "item_carrier_rankings");
      const details = evidence.find((entry) => entry.toolName === "item_details");
      if (!catalog) return {
        schemaVersion: "react-action.v1",
        type: "call_tool",
        tool: "entity_catalog_query",
        arguments: { entityType: "item", filters: { names: ["羊刀"] } },
        purposeCode: "retrieve_entity_details"
      };
      if (!carriers) return {
        schemaVersion: "react-action.v1",
        type: "call_tool",
        tool: "item_carrier_rankings",
        arguments: { item: "TFT_Item_GuinsoosRageblade" },
        purposeCode: "retrieve_current_statistics"
      };
      if (!submittedPrematureFinish) {
        submittedPrematureFinish = true;
        return {
          schemaVersion: "react-action.v1",
          type: "finish",
          answer: "已找到适合携带羊刀的棋子。",
          evidenceIds: [carriers.evidenceId],
          reasonCode: "sufficient_evidence"
        };
      }
      if (!details) return {
        schemaVersion: "react-action.v1",
        type: "call_tool",
        tool: "item_details",
        arguments: { apiName: "TFT_Item_GuinsoosRageblade" },
        purposeCode: "retrieve_entity_details"
      };
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "羊刀应优先参考榜单中的正提升携带者；它的官方效果是攻击叠加攻速。",
        evidenceIds: [carriers.evidenceId, details.evidenceId],
        reasonCode: "sufficient_evidence"
      };
    }
  });
  const { statusCode, payload } = await handleReactChatRequest({
    input: "羊刀适合谁？",
    conversationId: "item-carrier-natural-language"
  }, runtime);
  assert.equal(statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(submittedPrematureFinish, true);
  assert.deepEqual(payload.evidence.map((entry) => entry.toolName), [
    "entity_catalog_query",
    "item_carrier_rankings",
    "item_details"
  ]);
  assert.deepEqual(payload.evidenceIds, [payload.evidence[1].evidenceId, payload.evidence[2].evidenceId]);
});

test("H1 factory handlers return bounded catalog and semantic evidence", async () => {
  const runtime = createSmallWindowRuntime();
  const itemDetails = new Map([["TFT_Item_Test", {
    apiName: "TFT_Item_Test",
    name: "Test Item",
    effect: "Test effect",
    recipe: []
  }]]);
  itemDetails.meta = { updatedAt: "2026-08-06T00:00:00.000Z" };
  const bundle = createTftToolHandlers({
    registry: runtime.toolRegistry,
    seasonContext: { id: "set17-live", currentPatch: "17.7" },
    loadOfficialEntityDetails: async () => ({
      meta: { updatedAt: "2026-08-06T00:00:00.000Z" },
      units: new Map([["TFT17_Test", {
        apiName: "TFT17_Test",
        name: "Test Unit",
        cost: 4,
        traitNames: ["Test Trait"],
        ability: { name: "Test Spell", description: "Deals damage." },
        stats: { mana: 40, attackRange: 4 }
      }]]),
      traits: new Map([["TFT17_TestTrait", {
        apiName: "TFT17_TestTrait",
        name: "Test Trait",
        description: "Test description",
        levels: [{ units: 2, effect: "Test effect" }]
      }]])
    }),
    loadOfficialItemDetails: async () => itemDetails,
    semanticSearch: async (input) => [{
      id: "doc-1",
      text: input.query,
      documentType: input.documentTypes[0],
      updatedAt: "2026-08-06T00:00:00.000Z",
      sourceTitle: "本地攻略",
      sourceType: "youtube",
      sourceId: "local-video-1",
      author: "测试作者",
      publishedAt: "2026-08-01T00:00:00.000Z",
      timestampStart: 12,
      timestampEnd: 34,
      claimType: "creator_advice"
    }]
  });
  assert.deepEqual(bundle.availableToolNames, [
    "unit_details",
    "trait_details",
    "item_details",
    "item_details_batch",
    "semantic_search"
  ]);
  const unit = await bundle.handlers.unit_details({ apiName: "TFT17_Test" });
  const item = await bundle.handlers.item_details({ apiName: "TFT_Item_Test" });
  const itemBatch = await bundle.handlers.item_details_batch({
    apiNames: ["TFT_Item_Test"],
    seasonContextId: "set17-live",
    locale: "zh-CN"
  });
  const trait = await bundle.handlers.trait_details({ apiName: "TFT17_TestTrait_2" });
  assert.equal(unit.status, "found");
  assert.equal(unit.entityType, "unit");
  assert.equal(unit.entityRef.apiName, "TFT17_Test");
  assert.equal(unit.facts.ability.name, "Test Spell");
  assert.equal(item.status, "found");
  assert.equal(item.entityType, "item");
  assert.equal(itemBatch.mechanismStatus, "available");
  assert.equal(itemBatch.items[0].claimId, "official-item:TFT_Item_Test");
  assert.equal(trait.status, "found");
  assert.equal(trait.entityType, "trait");
  const missing = await bundle.handlers.unit_details({ apiName: "TFT17_Missing" });
  assert.equal(missing.status, "not_found");
  assert.deepEqual(missing.warnings, ["entity_not_found"]);
  const partialBundle = createTftToolHandlers({
    registry: runtime.toolRegistry,
    loadOfficialEntityDetails: async () => ({
      units: new Map([["TFT17_Partial", { apiName: "TFT17_Partial", name: "Partial" }]]),
      traits: new Map(),
      meta: { updatedAt: "2026-08-06T00:00:00.000Z" }
    })
  });
  const partial = await partialBundle.handlers.unit_details({ apiName: "TFT17_Partial" });
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.warnings, ["partial_entity_detail"]);
  for (const [tool, apiName, evidenceType] of [
    ["unit_details", "TFT17_Test", "official_unit"],
    ["item_details", "TFT_Item_Test", "official_item"],
    ["trait_details", "TFT17_TestTrait", "official_trait"],
    ["unit_details", "TFT17_Missing", "official_unit"]
  ]) {
    const result = await runtime.toolExecutor.execute(tool, { apiName }, {
      handler: bundle.handlers[tool]
    });
    assert.equal(result.status, "completed");
    assert.equal(result.metadata.evidenceType, evidenceType);
  }
  const semantic = await bundle.handlers.semantic_search({
    query: "test",
    documentTypes: ["mechanism_knowledge"],
    topK: 4
  });
  assert.deepEqual(semantic.scope.documentTypes, ["mechanism_knowledge"]);
  assert.equal(semantic.hits.length, 1);
  assert.equal(semantic.hits[0].author, "测试作者");
  assert.equal(semantic.hits[0].publishedAt, "2026-08-01T00:00:00.000Z");
  assert.equal(semantic.hits[0].timestampStart, 12);
  const video = await bundle.handlers.semantic_search({
    query: "本地视频攻略",
    documentTypes: ["video_guide"],
    topK: 4
  });
  assert.equal(video.scope.documentTypes[0], "video_guide");
  assert.equal(video.hits[0].documentType, "video_guide");
  assert.equal(video.hits[0].claimType, "creator_advice");
  await assert.rejects(
    () => runtime.toolExecutor.execute("semantic_search", {
      query: "test",
      documentTypes: ["comp_stats"]
    }, { handler: bundle.handlers.semantic_search }),
    (error) => /Invalid input for semantic_search/u.test(String(error?.cause?.message ?? error?.message))
  );
});
