import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aggregateItemCarrierRankings,
  buildCompRankingQuery,
  buildCompRankings,
  compileExecutionPlan,
  createCatalog,
  createIntentEnvelope,
  createTaskFrame,
  createStructuredToolDefinitions,
  ExecutionPlanExecutor,
  generateEvidenceBackedConclusion,
  makeQueryCacheKey,
  matchTaskCapabilities,
  MemoryCacheStore,
  parseQuery,
  planMetaTFTItemCarrierBuilds,
  recommendForInput,
  resolvedTaskFrameToParsed,
  taskFrameFromIntentEnvelope,
  ToolExecutor,
  ToolRegistry,
  validateStructuredParserOutput
} from "../src/index.js";
import { RetrievalPlanner } from "../src/retrieval/retrieval-planner.js";
import { parseSemanticTask } from "../src/understanding/semantic-task-parser.js";
import {
  createSmallWindowRuntime,
  handleRecommendRequest
} from "../src/app/small-window-server.js";

const compFixture = JSON.parse(await readFile(
  new URL("./fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url),
  "utf8"
));

const ITEM = "TFT_Item_Artifact_Dawncore";
const NAMI = "TFT17_Nami";
const LULU = "TFT17_Lulu";
const ASOL = "TFT17_AurelionSol";

function placement(avgBucket, games = 100) {
  const counts = Array(8).fill(0);
  counts[avgBucket - 1] = games;
  return counts;
}

function build(unit, items, counts) {
  return {
    unit_builds: `${unit}&${items.join("|")}`,
    placement_count: counts
  };
}

function itemCarrierResponses() {
  const rows = [
    build(NAMI, [ITEM, "TFT_Item_BlueBuff", "TFT_Item_JeweledGauntlet"], placement(3, 120)),
    build(NAMI, [ITEM, "TFT_Item_AdaptiveHelm", "TFT_Item_JeweledGauntlet"], placement(4, 80)),
    // Exact duplicate must not double-count.
    build(NAMI, [ITEM, "TFT_Item_AdaptiveHelm", "TFT_Item_JeweledGauntlet"], placement(4, 80)),
    build(LULU, [ITEM, "TFT_Item_BlueBuff", "TFT_Item_Morellonomicon"], placement(3, 110)),
    build(ASOL, [ITEM, "TFT_Item_SpearOfShojin", "TFT_Item_JeweledGauntlet"], placement(5, 150)),
    // The upstream item filter can leak unrelated rows; they must be rejected locally.
    build("TFT17_Ezreal", ["TFT_Item_BlueBuff", "TFT_Item_JeweledGauntlet"], placement(2, 999))
  ];
  return {
    buildResponse: { data: rows },
    baselineResponse: {
      updated: "2026-07-27T00:00:00.000Z",
      units: {
        [NAMI]: { avg: 4.2 },
        [LULU]: { avg: 3.8 },
        [ASOL]: { avg: 4.4 }
      }
    }
  };
}

function carrierCatalog() {
  return createCatalog({
    units: [
      { apiName: NAMI, zhName: "娜美", aliases: ["娜美", "nami"] },
      { apiName: LULU, zhName: "璐璐", aliases: ["璐璐", "lulu"] },
      { apiName: ASOL, zhName: "奥瑞利安·索尔", aliases: ["龙王", "asol"] }
    ],
    items: [{
      apiName: ITEM,
      zhName: "黎明核心",
      shortName: "黎明核心",
      aliases: ["黎明核心", "dawncore"],
      category: "artifact",
      current: true,
      obtainable: true
    }]
  });
}

test("parser distinguishes item-to-carrier questions from unit build questions", () => {
  for (const input of [
    "黎明核心适合给谁？",
    "黎明核心适合谁？",
    "黎明核心给谁？",
    "黎明核心谁带？",
    "黎明核心携带者"
  ]) {
    const parsed = parseQuery(input, { catalog: carrierCatalog() });
    assert.equal(parsed.intent, "item_carrier_rankings", input);
    assert.equal(parsed.carrierItem, ITEM, input);
    assert.equal(parsed.unit, undefined, input);
    assert.deepEqual(parsed.lockedItems, [], input);
  }
  const uplift = parseQuery("谁带黎明核心提升最大？", { catalog: carrierCatalog() });
  assert.equal(uplift.intent, "item_carrier_rankings");
  assert.equal(uplift.sort, "uplift_first");
});

test("a bare hero name clarifies equipment versus composition instead of defaulting to three items", async () => {
  const catalog = createCatalog({
    units: [{ apiName: "TFT17_Xayah", zhName: "霞", aliases: ["霞", "xayah"] }],
    items: []
  });
  const parsed = parseQuery("霞", { catalog });
  assert.equal(parsed.unit, "TFT17_Xayah");
  assert.equal(parsed.parser.intentExplicit, false);
  assert.equal(parsed.parser.bareUnitIntentAmbiguous, true);

  const legacy = await recommendForInput("霞", {
    catalog,
    semanticShadow: false,
    useSession: false
  });
  assert.equal(legacy.type, "clarification");
  assert.equal(legacy.clarification.reason, "ambiguous_unit_query_type");
  assert.match(legacy.clarification.question, /推荐装备.*阵容.*技能/u);
  assert.deepEqual(legacy.clarification.suggestions, ["霞推荐装备", "霞所在阵容", "霞技能描述（棋子资料）"]);

  const conversationV2 = await recommendForInput("霞", {
    catalog,
    semanticShadow: false,
    conversationStateV2Mode: "on",
    useSession: false
  });
  assert.equal(conversationV2.type, "clarification");
  assert.match(conversationV2.clarification.question, /推荐装备.*阵容.*技能/u);
  assert.deepEqual(conversationV2.clarification.suggestions, ["霞推荐装备", "霞所在阵容", "霞技能描述（棋子资料）"]);

});

test("structured parser contract allows one hero for comps and one item for carriers", () => {
  const base = {
    entities: { unit_mentions: [], item_mentions: [], trait_mentions: [] },
    constraints: {},
    needs_clarification: false,
    clarification_question: null
  };
  const comp = validateStructuredParserOutput({
    ...base,
    intent: "comp_rankings",
    entities: { ...base.entities, unit_mentions: ["努努"] },
    constraints: { metrics: ["top4_rate"], limit: 5 }
  });
  assert.equal(comp.valid, true, comp.errors.join("\n"));

  const carrier = validateStructuredParserOutput({
    ...base,
    intent: "item_carrier_rankings",
    entities: { ...base.entities, item_mentions: ["黎明核心"] },
    constraints: { limit: 8 }
  });
  assert.equal(carrier.valid, true, carrier.errors.join("\n"));
  const overLimit = validateStructuredParserOutput({
    ...base,
    intent: "item_carrier_rankings",
    entities: { ...base.entities, item_mentions: ["黎明核心"] },
    constraints: { limit: 9 }
  });
  assert.equal(overLimit.valid, false);
});

test("item carrier aggregation filters leaked rows, deduplicates, groups units, and keeps only positive uplift", () => {
  const { buildResponse, baselineResponse } = itemCarrierResponses();
  const result = aggregateItemCarrierRankings(buildResponse, baselineResponse, {
    item: ITEM,
    minSamples: 100,
    limit: 8,
    buildLimit: 2,
    positiveOnly: true
  });

  assert.deepEqual(result.carriers.map((entry) => entry.unitApiName), [NAMI, LULU]);
  assert.equal(result.carriers[0].stats.games, 200);
  assert.equal(result.carriers[0].builds.length, 2);
  assert.ok(result.carriers.every((entry) => entry.placementUplift > 0));
  assert.ok(result.diagnostics.rejected.some((entry) => (
    entry.unitApiName === ASOL && entry.reason === "non_positive_uplift"
  )));
  assert.equal(result.diagnostics.groupedUnits, 3);
});

test("item carrier aggregation rejects legacy Set 18 duplicates and impossible placement distributions", () => {
  const item = "TFT_Item_GuinsoosRageblade";
  const currentKayle = "DA_18_Kayle";
  const legacyKayle = "TFT18_Kayle";
  const catalog = createCatalog({
    units: [{ apiName: currentKayle, zhName: "凯尔", aliases: ["凯尔"] }],
    items: [{
      apiName: item,
      zhName: "鬼索的狂暴之刃",
      aliases: ["羊刀"],
      category: "ordinary_completed",
      current: true,
      obtainable: true
    }]
  });
  const buildResponse = { data: [
    build(currentKayle, [item, "TFT_Item_BlueBuff", "TFT_Item_JeweledGauntlet"],
      [100, 90, 80, 70, 60, 50, 40, 30]),
    build(legacyKayle, [item, "TFT_Item_Deathblade", "TFT_Item_JeweledGauntlet"],
      [4438, 200, 80, 40, 20, 12, 10, 10])
  ] };
  const baselineResponse = { units: {
    [currentKayle]: { avg: 4.4 },
    [legacyKayle]: { avg: 1.15 }
  } };

  const result = aggregateItemCarrierRankings(buildResponse, baselineResponse, {
    item,
    minSamples: 100,
    positiveOnly: false
  }, { catalog });

  assert.deepEqual(result.carriers.map((entry) => entry.unitApiName), [currentKayle]);
  assert.ok(result.carriers.every((entry) => entry.stats.avgPlacement >= 1.5));
  assert.ok(result.diagnostics.rejected.some((entry) => (
    entry.unitApiName === legacyKayle && entry.reason === "unit_not_in_current_catalog"
  )));
});

test("item carrier query planner and tool registry expose the bounded contract", () => {
  const plan = planMetaTFTItemCarrierBuilds({
    item: ITEM,
    days: 3,
    patch: "current",
    queue: "1100",
    rankFilter: ["MASTER"]
  });
  assert.equal(plan.path, "/tft-explorer-api/unit_builds");
  assert.equal(plan.params.item_unique, `${ITEM}-1`);

  const tool = createStructuredToolDefinitions()
    .find((definition) => definition.name === "item_carrier_rankings");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ["item"]);
  assert.equal(tool.capabilities[0].requiredEntityTypes[0], "item");
  assert.notEqual(
    makeQueryCacheKey({ intent: "item_carrier_rankings", item: ITEM, limit: 8, buildLimit: 2 }),
    makeQueryCacheKey({ intent: "item_carrier_rankings", item: "TFT_Item_BlueBuff", limit: 8, buildLimit: 2 })
  );
});

test("retrieval planner emits item carrier operation with one canonical item", () => {
  const catalog = carrierCatalog();
  const parsed = parseQuery("黎明核心适合给谁？", { catalog });
  const query = {
    intent: parsed.intent,
    item: parsed.carrierItem,
    days: 3,
    patch: "current",
    queue: "1100",
    rankFilter: ["MASTER"],
    minSamples: 100,
    limit: 8,
    buildLimit: 2,
    positiveOnly: true,
    sort: "games_first"
  };
  const envelope = createIntentEnvelope({ input: parsed.rawInput, parsed, query, catalog });
  const plan = new RetrievalPlanner().plan(envelope);
  assert.equal(plan.structuredQueries.length, 1);
  assert.equal(plan.structuredQueries[0].operation, "item_carrier_rankings");
  assert.equal(plan.structuredQueries[0].params.item, ITEM);
  assert.equal(plan.structuredQueries[0].params.limit, 8);

  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const frame = taskFrameFromIntentEnvelope(envelope);
  const match = matchTaskCapabilities(frame, registry);
  const execution = compileExecutionPlan(frame, match, { registry });
  assert.equal(match.selected[0].tool, "item_carrier_rankings");
  assert.equal(execution.validation.valid, true, execution.validation.errors.join("\n"));
  assert.equal(execution.plan.steps[0].arguments.item, ITEM);
});

test("semantic task routing selects the correct tool for both new natural-language shapes", async () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  for (const input of ["黎明核心适合给谁？", "黎明核心适合谁？", "黎明核心给谁？"]) {
    const itemTask = await parseSemanticTask(input, {
      catalog: carrierCatalog()
    });
    assert.equal(
      matchTaskCapabilities(itemTask.taskFrame, registry).selected[0].tool,
      "item_carrier_rankings",
      input
    );
  }

  const heroCatalog = createCatalog({
    units: [{ apiName: "TFT17_Nunu", zhName: "努努", aliases: ["努努"] }],
    items: []
  });
  const compTask = await parseSemanticTask("努努可以玩什么阵容？", {
    catalog: heroCatalog
  });
  assert.equal(
    matchTaskCapabilities(compTask.taskFrame, registry).selected[0].tool,
    "comps_rankings"
  );
});

test("semantic item-carrier requests stay single-tool and adapt to the carrier intent without a plan", async () => {
  const input = "\u9ece\u660e\u6838\u5fc3\u6700\u9002\u5408\u54ea\u4e9b\u82f1\u96c4\u643a\u5e26";
  const task = await parseSemanticTask(input, { catalog: carrierCatalog() });
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const match = matchTaskCapabilities(task.taskFrame, registry);

  assert.deepEqual(task.taskFrame.capabilityRequirements, ["item_carrier_statistics"]);
  assert.equal(match.mode, "single_tool");
  assert.equal(match.selected[0].tool, "item_carrier_rankings");

  const parsed = resolvedTaskFrameToParsed(task.taskFrame, { input });
  assert.equal(parsed.intent, "item_carrier_rankings");
  assert.equal(parsed.carrierItem, ITEM);
});

test("current emblem shorthand resolves to item-carrier rankings", async () => {
  const emblemCatalog = createCatalog({
    items: [
      {
        apiName: "TFT17_Item_SpaceGrooveEmblemItem",
        zhName: "太空律动纹章",
        shortName: "太空律动转",
        aliases: ["太空律动转", "太空律动转职"],
        category: "emblem",
        current: true,
        obtainable: true
      },
      {
        apiName: "TFT17_Item_DarkStarEmblemItem",
        zhName: "暗星纹章",
        shortName: "暗星转",
        aliases: ["暗星转", "暗星转职"],
        category: "emblem",
        current: true,
        obtainable: true
      }
    ]
  });

  for (const [name, apiName] of [
    ["太空律动转", "TFT17_Item_SpaceGrooveEmblemItem"],
    ["暗星转", "TFT17_Item_DarkStarEmblemItem"]
  ]) {
    const input = `${name}最适合哪些英雄携带`;
    const task = await parseSemanticTask(input, { catalog: emblemCatalog });
    const parsed = resolvedTaskFrameToParsed(task.taskFrame, { input });
    assert.equal(parsed.intent, "item_carrier_rankings", name);
    assert.equal(parsed.carrierItem, apiName, name);
  }
});

test("semantic parser maps Chinese three-item wording to the valid item count", async () => {
  const catalog = createCatalog({
    units: [{ apiName: "TFT17_Xayah", zhName: "\u971e", aliases: ["\u971e"] }]
  });
  const task = await parseSemanticTask(
    "\u67e5\u8be2\u971e\u7684\u5f53\u524d\u7248\u672c\u6700\u7a33\u4e09\u4ef6\u88c5\u5907",
    { catalog }
  );

  assert.equal(task.taskFrame.constraints.itemCount, 3);
});

test("multi-step item-carrier execution receives handlers for prerequisite tools", async () => {
  const catalog = carrierCatalog();
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const toolExecutor = new ToolExecutor({ registry });
  const executionPlanExecutor = new ExecutionPlanExecutor({ registry, toolExecutor });
  const input = "\u9ece\u660e\u6838\u5fc3\u6700\u9002\u5408\u54ea\u4e9b\u82f1\u96c4\u643a\u5e26";
  let catalogCalls = 0;
  const controlledPlanner = async ({ toolCatalog }) => {
    const byName = new Map(toolCatalog.map((tool) => [tool.name, tool]));
    const catalogTool = byName.get("entity_catalog_query");
    const carrierTool = byName.get("item_carrier_rankings");
    return {
      schemaVersion: "execution-plan.v1",
      route: "controlled_planner",
      steps: [
        {
          id: "step1",
          tool: "entity_catalog_query",
          arguments: { entityType: "unit", filters: { current: true }, limit: 5 },
          dependsOn: [],
          argumentBindings: [],
          onFailure: "stop",
          evidenceContract: {
            type: catalogTool.evidenceType,
            source: catalogTool.source,
            requiredFields: ["source", "updatedAt", "results"]
          }
        },
        {
          id: "step2",
          tool: "item_carrier_rankings",
          arguments: { item: ITEM },
          dependsOn: ["step1"],
          argumentBindings: [],
          onFailure: "stop",
          evidenceContract: {
            type: carrierTool.evidenceType,
            source: carrierTool.source,
            requiredFields: ["source", "updatedAt", "buildResponse", "baselineResponse"]
          }
        }
      ],
      resultPolicy: { type: "identity" },
      finalEvidenceContract: {
        type: carrierTool.evidenceType,
        source: carrierTool.source,
        required: true,
        requiredFields: ["source", "updatedAt", "buildResponse", "baselineResponse"],
        allowModelGeneratedStatistics: false
      }
    };
  };
  controlledPlanner.plannerKind = "llm";
  controlledPlanner.model = "fixture";
  const semanticTaskParser = async (message, options) => {
    const semantic = await parseSemanticTask(message, options);
    semantic.taskFrame = createTaskFrame({
      ...semantic.taskFrame,
      action: "search",
      goal: "find_relevant_data",
      constraints: {
        ...semantic.taskFrame.constraints,
        targetEntityType: "champion",
        current: true
      },
      capabilityRequirements: ["entity_catalog_filtering", "item_carrier_statistics"]
    });
    return semantic;
  };
  const responses = itemCarrierResponses();

  const result = await recommendForInput(input, {
    catalog,
    cacheStore: new MemoryCacheStore(),
    useSession: false,
    bypassQueryCache: true,
    semanticTaskParser,
    controlledPlanner,
    executionPlanSovereignty: true,
    toolRegistry: registry,
    toolExecutor,
    executionPlanExecutor,
    agentToolHandlers: {
      entity_catalog_query: async () => {
        catalogCalls += 1;
        return {
          type: "entity_catalog_results",
          source: "official_tft_catalog",
          updatedAt: "2026-08-02T00:00:00.000Z",
          results: [{ apiName: NAMI, name: "Nami" }]
        };
      }
    },
    metaTFTClient: {
      async getItemCarrierBuilds() {
        return responses.buildResponse;
      }
    },
    compsClient: {
      async getUnitItemsProcessed() {
        return responses.baselineResponse;
      }
    }
  });

  assert.equal(catalogCalls, 1);
  assert.equal(result.type, "item_carrier_rankings");
  assert.deepEqual(result.carriers.map((entry) => entry.unitApiName), [NAMI, LULU]);
});

test("recommendation service returns deterministic item carrier results without conclusion content", async () => {
  const responses = itemCarrierResponses();
  const result = await recommendForInput("黎明核心适合谁？", {
    catalog: carrierCatalog(),
    itemCarrierResponse: {
      source: "metatft",
      updatedAt: "2026-07-27T00:00:00.000Z",
      ...responses
    },
    semanticShadow: false,
    useSession: false
  });

  assert.equal(result.type, "item_carrier_rankings");
  assert.deepEqual(result.carriers.map((entry) => entry.unitApiName), [NAMI, LULU]);
  assert.equal(result.answer, undefined);
  assert.equal(result.query.positiveOnly, true);
  assert.equal(result.query.limit, 8);
});

test("conversation-state v2 on-mode executes item carrier routing instead of asking for a hero", async () => {
  const responses = itemCarrierResponses();
  const result = await recommendForInput("谁带黎明核心提升最大？", {
    catalog: carrierCatalog(),
    cacheStore: new MemoryCacheStore(),
    itemCarrierResponse: {
      source: "metatft",
      updatedAt: "2026-07-27T00:00:00.000Z",
      ...responses
    },
    conversationStateV2Mode: "on",
    useSession: false
  });
  assert.equal(result.type, "item_carrier_rankings");
  assert.equal(result.query.item, ITEM);
  assert.equal(result.query.sort, "uplift_first");
});

test("item carrier result is an unregistered conclusion intent and never calls the LLM provider", async () => {
  const responses = itemCarrierResponses();
  const catalog = carrierCatalog();
  const result = await recommendForInput("黎明核心适合给谁？", {
    catalog,
    itemCarrierResponse: {
      source: "metatft",
      updatedAt: "2026-07-27T00:00:00.000Z",
      ...responses
    },
    semanticShadow: false,
    useSession: false
  });
  let calls = 0;
  const conclusion = await generateEvidenceBackedConclusion({
    result,
    catalog,
    input: "黎明核心适合给谁？",
    config: { enabled: true, model: "must-not-run" },
    provider: async () => {
      calls += 1;
      return {};
    }
  });

  assert.equal(calls, 0);
  assert.equal(conclusion.status, "skipped");
  assert.ok(["unregistered_intent", "unsafe_state"].includes(conclusion.reason));
});

test("hero comp query preserves the unit and filters page rankings by membership", () => {
  const catalog = createCatalog({
    units: [{
      apiName: "TFT17_Nunu",
      zhName: "努努",
      aliases: ["努努", "nunu"]
    }]
  });
  const parsed = parseQuery("努努可以玩什么阵容？", { catalog });
  assert.equal(parsed.intent, "comp_rankings");
  assert.equal(parsed.unit, "TFT17_Nunu");

  const query = buildCompRankingQuery(parsed, {
    preferences: { minSamples: 1, rankFilter: [], days: 3, queue: "1100" }
  });
  const result = buildCompRankings(compFixture, { query, catalog });
  const all = Object.values(result.rankings).flat();
  assert.ok(all.length > 0);
  assert.ok(all.every((comp) => comp.units.some((unit) => unit.apiName === "TFT17_Nunu")));
  assert.ok(result.diagnostics.rejected.some((entry) => entry.reason === "missing_target_unit"));
});

test("recommendation service returns only comps containing the requested hero", async () => {
  const catalog = createCatalog({
    units: [{
      apiName: "TFT17_Nunu",
      zhName: "努努",
      aliases: ["努努", "nunu"]
    }]
  });
  const result = await recommendForInput("努努可以玩什么阵容？", {
    catalog,
    compResponse: compFixture,
    semanticShadow: false,
    useSession: false,
    preferences: { minSamples: 1, rankFilter: [], days: 3, queue: "1100" }
  });

  assert.equal(result.type, "comp_rankings");
  assert.equal(result.query.unit, "TFT17_Nunu");
  assert.ok(Object.values(result.rankings).flat().length > 0);
  assert.ok(Object.values(result.rankings).flat().every((comp) => (
    comp.units.some((unit) => unit.apiName === "TFT17_Nunu")
  )));
});

test("small-window endpoint serializes at most eight carriers with representative builds", async () => {
  const catalog = carrierCatalog();
  const { buildResponse, baselineResponse } = itemCarrierResponses();
  const aggregated = aggregateItemCarrierRankings(buildResponse, baselineResponse, {
    item: ITEM,
    minSamples: 100,
    limit: 8,
    buildLimit: 2,
    positiveOnly: true
  });
  const runtime = createSmallWindowRuntime({
    catalog,
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: async () => ({
      ...aggregated,
      text: "黎明核心共找到 2 个正向提升携带者。",
      source: {
        provider: "MetaTFT",
        endpoint: "tft-explorer-api/unit_builds + tft-comps-api/unit_items_processed",
        updatedAt: "2026-07-27T00:00:00.000Z"
      },
      cache: null,
      warnings: []
    })
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: "黎明核心适合给谁？",
    preferences: { conclusionMode: "off" }
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.type, "item_carrier_rankings");
  assert.equal(payload.carriers.length, 2);
  assert.ok(payload.carriers.length <= 8);
  assert.ok(payload.carriers.every((carrier) => (
    carrier.placementUplift > 0
    && carrier.builds.length > 0
    && carrier.builds.length <= 2
  )));
  assert.equal(payload.answer.generatedConclusion.status, "disabled");
});
