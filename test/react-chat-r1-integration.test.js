import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultReactToolHandlerBundle,
  createSmallWindowRuntime,
  handleReactChatRequest
} from "../src/app/small-window-server.js";
import { MemoryCacheStore } from "../src/index.js";
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
    "unit_builds_batch",
    "comps_rankings",
    "composition_tactical_details",
    "composition_replacement_evaluation",
    "composition_change_evaluation",
    "unit_details",
    "item_details",
    "item_details_batch",
    "trait_details",
    "entity_catalog_query",
    "composition_member_statistics"
  ]);
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
  const runtime = createSmallWindowRuntime({
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
    "composition_tactical_details",
    "composition_replacement_evaluation",
    "composition_change_evaluation",
    "composition_member_statistics",
    "unit_builds_batch",
    "unit_details",
    "trait_details",
    "item_details",
    "item_details_batch",
    "semantic_search"
  ]);
  assert.deepEqual(
    [...bundle.availableToolNames].sort(),
    Object.keys(bundle.handlers).sort()
  );
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
