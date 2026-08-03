import test from "node:test";
import assert from "node:assert/strict";
import {
  MemoryCacheStore,
  createCatalog,
  createTaskFrame,
  createTurnDelta,
  unknownTurnDelta
} from "../src/index.js";
import {
  createSmallWindowRuntimeAsync,
  createSmallWindowRuntime,
  handleRecommendRequest,
  loadRuntimeCatalog
} from "../src/app/small-window-server.js";
import { CompsContextClient } from "../src/data/metatft-client.js";

export function createWebRuntimeOptions(options = {}) {
  const catalog = createCatalog({
    units: [
      { apiName: "TFT17_Bramble", zhName: "荆棘", cost: 4, aliases: ["荆棘"], current: true },
      { apiName: "TFT17_Bloom", zhName: "繁花", cost: 4, aliases: ["繁花"], current: true },
      { apiName: "TFT17_Sprout", zhName: "幼芽", cost: 2, aliases: ["幼芽"], current: true },
      { apiName: "TFT17_Disco", zhName: "节拍", cost: 4, aliases: ["节拍"], current: true },
      { apiName: "TFT17_Canopy", zhName: "天冠", cost: 5, aliases: ["天冠"], current: true },
      { apiName: "TFT17_Nova", zhName: "新星", cost: 5, aliases: ["新星"], current: true },
      { apiName: "TFT17_Fiora", zhName: "剑姬", cost: 5, aliases: ["剑姬", "菲奥娜"], current: true },
      { apiName: "TFT17_MasterYi", zhName: "剑圣", cost: 4, aliases: ["剑圣", "易"], current: true }
    ],
    traits: [
      {
        apiName: "TFT17_Woodling",
        filterId: "TFT17_Woodling_2",
        zhName: "木灵",
        displayName: "木灵",
        aliases: ["木灵", "木灵族"],
        current: true
      },
      {
        apiName: "TFT17_Berserker",
        filterId: "TFT17_Berserker_2",
        zhName: "狂战士",
        displayName: "狂战士",
        aliases: ["狂战士", "berserker"],
        current: true
      },
      {
        apiName: "TFT17_SpaceGroove",
        filterId: "TFT17_SpaceGroove_2",
        zhName: "太空律动",
        displayName: "太空律动",
        aliases: ["太空律动"],
        current: true
      }
    ],
    items: [
      { apiName: "TFT_Item_GuinsoosRageblade", zhName: "鬼索的狂暴之刃", category: "ordinary_completed", current: true, obtainable: true },
      { apiName: "TFT_Item_InfinityEdge", zhName: "无尽之刃", category: "ordinary_completed", current: true, obtainable: true },
      { apiName: "TFT_Item_GiantSlayer", zhName: "巨人杀手", category: "ordinary_completed", current: true, obtainable: true },
      { apiName: "TFT_Item_Deathblade", zhName: "死亡之刃", category: "ordinary_completed", current: true, obtainable: true },
      {
        apiName: "TFT17_Item_SpaceGrooveEmblemItem",
        zhName: "太空律动纹章",
        aliases: ["太空律动纹章", "太空律动转"],
        category: "emblem",
        current: true,
        obtainable: true
      }
    ]
  });
  return {
    catalog,
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    officialItemDetails: new Map([[
      "TFT17_Item_SpaceGrooveEmblemItem",
      {
        apiName: "TFT17_Item_SpaceGrooveEmblemItem",
        name: "太空律动纹章",
        effect: "携带者获得太空律动羁绊。",
        recipe: []
      }
    ]]),
    officialEntityDetails: {
      units: new Map([
        ["TFT17_Bramble", { apiName: "TFT17_Bramble", name: "荆棘", cost: 4, traitNames: ["木灵"] }],
        ["TFT17_Bloom", { apiName: "TFT17_Bloom", name: "繁花", cost: 4, traitNames: ["木灵"] }],
        ["TFT17_Sprout", { apiName: "TFT17_Sprout", name: "幼芽", cost: 2, traitNames: ["木灵"] }],
        ["TFT17_Disco", { apiName: "TFT17_Disco", name: "节拍", cost: 4, traitNames: ["太空律动"] }],
        ["TFT17_Canopy", { apiName: "TFT17_Canopy", name: "天冠", cost: 5, traitNames: ["木灵"] }],
        ["TFT17_Nova", { apiName: "TFT17_Nova", name: "新星", cost: 5, traitNames: ["太空律动"] }],
        ["TFT17_Fiora", { apiName: "TFT17_Fiora", name: "剑姬", cost: 5, traitNames: ["狂战士"] }],
        ["TFT17_MasterYi", { apiName: "TFT17_MasterYi", name: "剑圣", cost: 4, traitNames: ["狂战士"] }]
      ]),
      traits: new Map([
        ["TFT17_Woodling", {
          apiName: "TFT17_Woodling",
          name: "木灵",
          description: "木灵弈子获得成长属性。",
          levels: [{ units: 2, effect: "获得成长属性" }]
        }],
        ["TFT17_Berserker", {
          apiName: "TFT17_Berserker",
          name: "狂战士",
          description: "狂战士弈子获得攻击强化。",
          levels: [{ units: 2, effect: "获得攻击强化" }]
        }],
        ["TFT17_SpaceGroove", {
          apiName: "TFT17_SpaceGroove",
          name: "太空律动",
          description: "太空律动弈子随节拍强化。",
          levels: [{ units: 2, effect: "获得强化" }]
        }]
      ]),
      meta: { version: "test", season: "test", updatedAt: "2026-07-31T00:00:00.000Z" }
    },
    metaTFTClient: options.metaTFTClient ?? {
      async getUnitBuilds(plan) {
        const unit = plan.pathUnit;
        return {
          data: [{
            unit_builds: `${unit}&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer`,
            placement_count: unit === "TFT17_Bramble"
              ? [280, 220, 160, 120, 80, 50, 30, 20]
              : [120, 120, 120, 120, 120, 120, 120, 120]
          }]
        };
      },
      async getItemCarrierBuilds() {
        return {
          data: [
            {
              unit_builds: "TFT17_Bramble&TFT17_Item_SpaceGrooveEmblemItem|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
              placement_count: [0, 0, 140, 0, 0, 0, 0, 0]
            },
            {
              unit_builds: "TFT17_Bloom&TFT17_Item_SpaceGrooveEmblemItem|TFT_Item_GuinsoosRageblade|TFT_Item_GiantSlayer",
              placement_count: [0, 0, 0, 120, 0, 0, 0, 0]
            }
          ]
        };
      }
    },
    compsClient: options.compsClient ?? {
      async getUnitItemsProcessed() {
        return {
          updated: "2026-07-31T00:00:00.000Z",
          units: {
            TFT17_Bramble: { avg: 4.5 },
            TFT17_Bloom: { avg: 4.4 }
          }
        };
      }
    },
    conversationStateV2Mode: options.conversationStateV2Mode ?? "off",
    turnDeltaProvider: options.turnDeltaProvider ?? null
  };
}

function createWebRuntime(options = {}) {
  return createSmallWindowRuntime(createWebRuntimeOptions(options));
}

test("pure all-units request still uses the entity catalog fast path", async () => {
  const response = await handleRecommendRequest({
    input: "所有棋子",
    conversationId: "pure-all-units"
  }, createWebRuntime());

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.type, "entity_catalog");
  assert.equal(response.payload.entityType, "unit");
  assert.equal(response.payload.items.length, 8);
  assert.equal(response.payload.executionPlan, undefined);
});

test("web request carries trait detail context into a registered entity catalog tool call", async () => {
  const runtime = createWebRuntime();
  const first = await handleRecommendRequest({
    input: "木灵羁绊有什么效果和激活层级？",
    conversationId: "trait-follow-up"
  }, runtime);
  const second = await handleRecommendRequest({
    input: "该羁绊内有什么四费卡？",
    conversationId: "trait-follow-up"
  }, runtime);

  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.type, "trait_details");
  assert.equal(second.statusCode, 200);
  assert.equal(second.payload.type, "entity_catalog_results");
  assert.equal(second.payload.source.provider, "Official TFT Catalog");
  assert.equal(second.payload.source.endpoint, "official_tft_catalog/entity_catalog_query");
  assert.deepEqual(second.payload.results.map((unit) => unit.apiName), ["TFT17_Bloom", "TFT17_Bramble"]);
  assert.equal(second.payload.query.traitFilters[0], "TFT17_Woodling");
  assert.equal(second.payload.taskFrame.contextReferences[0].type, "conversation");
  assert.equal(second.payload.taskFrame.contextReferences[0].fields.includes("concepts"), true);
  assert.equal(second.payload.executionPlan.steps[0].tool, "entity_catalog_query");
  assert.equal(second.payload.executionTrace.status, "completed");
});

test("web request executes catalog filtering and batch build comparison as one semantic plan", async () => {
  const runtime = createWebRuntime({
    conversationStateV2Mode: "on",
    turnDeltaProvider: async () => unknownTurnDelta("provider_uncertain")
  });
  const response = await handleRecommendRequest({
    input: "木灵四费卡中谁的主流出装表现最好？",
    conversationId: "trait-build-comparison"
  }, runtime);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.type, "unit_builds_batch_results");
  assert.deepEqual(
    response.payload.executionPlan.steps.map((step) => step.tool),
    ["entity_catalog_query", "unit_builds_batch"]
  );
  assert.equal(response.payload.executionTrace.status, "completed");
  assert.equal(response.payload.executionTrace.toolCallCount, 2);
  assert.equal(response.payload.results.length, 2);
  assert.equal(response.payload.results[0].apiName, "TFT17_Bramble");
  assert.equal(response.payload.results[0].bestBuild.length, 3);
  assert.equal(response.payload.source.provider, "MetaTFT");
  assert.equal(response.payload.source.endpoint, "tft-explorer-api/unit_builds (batch)");
  assert.equal(response.payload.source.cache, "live");
});

test("production runtime factory answers a self-contained trait+cost group build query in one turn", async () => {
  const runtime = await createSmallWindowRuntimeAsync(createWebRuntimeOptions({
    conversationStateV2Mode: "off"
  }), {});
  const response = await handleRecommendRequest({
    input: "木灵族中的四费棋子怎么出装",
    conversationId: "woodling-four-cost-builds-single-turn"
  }, runtime);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.type, "unit_builds_batch_results");
  assert.equal(response.payload.resultMode, "per_entity_recommendations");
  assert.equal(response.payload.clarification, null);
  assert.equal(response.payload.text.includes("要查哪个英雄"), false);
  assert.equal(response.payload.text.includes("表现最好"), false);

  const frame = response.payload.taskFrame;
  assert.equal(frame.action, "recommend");
  assert.equal(frame.goal, "recommend_builds_for_candidate_group");
  assert.equal(frame.constraints.cost, 4);
  assert.equal(frame.constraints.targetEntityType, "champion");
  assert.equal(frame.constraints.relation, "member_of_trait");
  assert.deepEqual(frame.capabilityRequirements, [
    "entity_catalog_filtering",
    "unit_build_statistics"
  ]);
  assert.equal(frame.concepts[0].expectedType, "trait");
  assert.match(frame.concepts[0].resolvedId, /^TFT17_Woodling(?:_2)?$/);

  assert.equal(response.payload.capabilityMatch.status, "understood_and_supported");
  assert.equal(response.payload.capabilityMatch.mode, "composite");
  assert.equal(response.payload.capabilityMatch.goal, "recommend_builds_for_candidate_group");
  assert.deepEqual(
    response.payload.capabilityMatch.selected.map((entry) => entry.tool).sort(),
    ["entity_catalog_query", "unit_builds_batch"]
  );

  assert.deepEqual(
    response.payload.executionPlan.steps.map((step) => step.tool),
    ["entity_catalog_query", "unit_builds_batch"]
  );
  assert.equal(response.payload.executionPlan.steps[0].arguments.filters.cost, 4);
  assert.equal(response.payload.executionPlan.steps[0].arguments.filters.traits.length, 1);

  assert.equal(response.payload.executionTrace.status, "completed");
  assert.equal(response.payload.executionTrace.toolCallCount, 2);
  assert.deepEqual(
    response.payload.executionTrace.steps.map((step) => step.tool),
    ["entity_catalog_query", "unit_builds_batch"]
  );
  assert.ok(response.payload.executionTrace.steps.every((step) => step.status === "completed"));

  assert.deepEqual(
    response.payload.results.map((entry) => entry.apiName).sort(),
    ["TFT17_Bloom", "TFT17_Bramble"]
  );
  assert.ok(response.payload.results.every((entry) => entry.bestBuild.length === 3));
  assert.match(response.payload.text, /各自的主流出装/);
});

test("action-only build follow-up reuses the group scope in production mode off", async () => {
  const runtime = await createSmallWindowRuntimeAsync(createWebRuntimeOptions({
    conversationStateV2Mode: "off"
  }), {});
  const conversationId = "woodling-group-followup-off";
  const first = await handleRecommendRequest({
    input: "木灵族中的四费棋子有哪些",
    conversationId
  }, runtime);

  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.type, "entity_catalog_results");
  assert.deepEqual(
    first.payload.results.map((entry) => entry.apiName).sort(),
    ["TFT17_Bloom", "TFT17_Bramble"]
  );

  const second = await handleRecommendRequest({
    input: "怎么出装？",
    conversationId
  }, runtime);

  assert.equal(second.statusCode, 200);
  assert.equal(second.payload.type, "unit_builds_batch_results");
  assert.equal(second.payload.resultMode, "per_entity_recommendations");
  assert.equal(second.payload.clarification, null);
  assert.equal(second.payload.taskFrame.goal, "recommend_builds_for_candidate_group");
  assert.equal(second.payload.taskFrame.constraints.cost, 4);
  assert.equal(second.payload.taskFrame.constraints.targetEntityType, "champion");
  assert.equal(second.payload.taskFrame.constraints.relation, "member_of_trait");
  assert.match(second.payload.taskFrame.concepts[0].resolvedId, /^TFT17_Woodling(?:_2)?$/);
  assert.equal(second.payload.capabilityMatch.mode, "composite");
  assert.deepEqual(
    second.payload.executionPlan.steps.map((step) => step.tool),
    ["entity_catalog_query", "unit_builds_batch"]
  );
  assert.equal(second.payload.executionTrace.status, "completed");
  assert.equal(second.payload.executionTrace.toolCallCount, 2);
  assert.deepEqual(
    second.payload.results.map((entry) => entry.apiName).sort(),
    ["TFT17_Bloom", "TFT17_Bramble"]
  );
});

test("a multi-cost trait group query keeps every requested cost in the catalog filter", async () => {
  const runtime = await createSmallWindowRuntimeAsync(createWebRuntimeOptions({
    conversationStateV2Mode: "off"
  }), {});
  const response = await handleRecommendRequest({
    input: "狂战士羁绊中的五费和四费怎么出装",
    conversationId: "berserker-multi-cost-builds"
  }, runtime);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.type, "unit_builds_batch_results");
  assert.equal(response.payload.resultMode, "per_entity_recommendations");
  assert.equal(response.payload.clarification, null);
  assert.equal(response.payload.taskFrame.goal, "recommend_builds_for_candidate_group");
  assert.deepEqual(response.payload.taskFrame.constraints.cost, [4, 5]);
  assert.equal(response.payload.taskFrame.constraints.targetEntityType, "champion");
  assert.equal(response.payload.taskFrame.constraints.relation, "member_of_trait");
  assert.match(response.payload.taskFrame.concepts[0].resolvedId, /^TFT17_Berserker(?:_2)?$/);
  assert.deepEqual(response.payload.capabilityMatch.selected.map((entry) => entry.tool).sort(), [
    "entity_catalog_query",
    "unit_builds_batch"
  ]);
  assert.deepEqual(
    response.payload.executionPlan.steps[0].arguments.filters.cost,
    [4, 5]
  );
  assert.deepEqual(
    response.payload.executionPlan.steps.map((step) => step.tool),
    ["entity_catalog_query", "unit_builds_batch"]
  );
  assert.equal(response.payload.executionTrace.status, "completed");
  assert.equal(response.payload.executionTrace.toolCallCount, 2);
  assert.deepEqual(
    response.payload.results.map((entry) => entry.apiName).sort(),
    ["TFT17_Fiora", "TFT17_MasterYi"]
  );
  assert.deepEqual(
    response.payload.results.map((entry) => entry.name).sort(),
    ["剑圣", "剑姬"]
  );
});

test("a pure trait collection request returns the trait members without a cost filter", async () => {
  const runtime = await createSmallWindowRuntimeAsync(createWebRuntimeOptions({
    conversationStateV2Mode: "off"
  }), {});
  const inputs = ["返回木灵族羁绊中的棋子", "木灵族中有哪些棋子"];
  for (const [index, input] of inputs.entries()) {
    const response = await handleRecommendRequest({
      input,
      conversationId: `woodling-list-${index}`
    }, runtime);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.type, "entity_catalog_results");
    assert.equal(response.payload.taskFrame.action, "search");
    assert.equal(response.payload.taskFrame.goal, "find_relevant_data");
    assert.equal(response.payload.taskFrame.constraints.targetEntityType, "champion");
    assert.equal(response.payload.taskFrame.constraints.cost, undefined);
    assert.deepEqual(response.payload.taskFrame.capabilityRequirements, ["entity_catalog_filtering"]);
    assert.equal(response.payload.capabilityMatch.mode, "single_tool");
    assert.equal(response.payload.capabilityMatch.selected[0].tool, "entity_catalog_query");
    assert.deepEqual(
      response.payload.executionPlan.steps.map((step) => step.tool),
      ["entity_catalog_query"]
    );
    assert.equal(response.payload.executionPlan.steps[0].arguments.filters.cost, undefined);
    assert.equal(response.payload.executionPlan.steps[0].arguments.filters.traits.length, 1);
    assert.equal(response.payload.executionTrace.status, "completed");
    assert.equal(response.payload.executionTrace.toolCallCount, 1);
    assert.deepEqual(
      response.payload.results.map((entry) => entry.apiName).sort(),
      ["TFT17_Bloom", "TFT17_Bramble", "TFT17_Canopy", "TFT17_Sprout"]
    );
    assert.doesNotMatch(response.payload.text, /无法查询/);
  }
});

test("mode-on frames are enriched with deterministic entities and constraints", async () => {
  const droppingProvider = async () => createTurnDelta({
    dialogueAct: "start_task",
    taskRelation: "new",
    explicitTaskFrame: createTaskFrame({
      domain: "tft",
      action: "recommend",
      goal: "unit_build_rankings",
      constraints: { cost: 4 },
      confidence: 0.9,
      understandingStatus: "understood_and_supported"
    }),
    confidence: 0.9
  });
  const runtime = await createSmallWindowRuntimeAsync(createWebRuntimeOptions({
    conversationStateV2Mode: "on",
    turnDeltaProvider: droppingProvider
  }), {});

  const buildResponse = await handleRecommendRequest({
    input: "木灵族中的四费棋子怎么出装",
    conversationId: "mode-on-enrichment-builds"
  }, runtime);
  assert.equal(buildResponse.statusCode, 200);
  assert.equal(buildResponse.payload.type, "unit_builds_batch_results");
  assert.equal(buildResponse.payload.taskFrame.goal, "recommend_builds_for_candidate_group");
  assert.equal(buildResponse.payload.taskFrame.constraints.cost, 4);
  assert.match(buildResponse.payload.taskFrame.concepts[0].resolvedId, /^TFT17_Woodling(?:_2)?$/);
  assert.deepEqual(
    buildResponse.payload.executionPlan.steps.map((step) => step.tool),
    ["entity_catalog_query", "unit_builds_batch"]
  );
  assert.equal(buildResponse.payload.executionTrace.status, "completed");
  assert.equal(buildResponse.payload.executionTrace.toolCallCount, 2);
  assert.deepEqual(
    buildResponse.payload.results.map((entry) => entry.apiName).sort(),
    ["TFT17_Bloom", "TFT17_Bramble"]
  );

  const listResponse = await handleRecommendRequest({
    input: "返回木灵族羁绊中的棋子",
    conversationId: "mode-on-enrichment-list"
  }, runtime);
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.payload.type, "entity_catalog_results");
  assert.equal(listResponse.payload.taskFrame.action, "search");
  assert.equal(listResponse.payload.taskFrame.goal, "find_relevant_data");
  assert.equal(listResponse.payload.taskFrame.constraints.targetEntityType, "champion");
  assert.equal(listResponse.payload.taskFrame.constraints.cost, undefined);
  assert.match(listResponse.payload.taskFrame.concepts[0].resolvedId, /^TFT17_Woodling(?:_2)?$/);
  assert.deepEqual(
    listResponse.payload.executionPlan.steps.map((step) => step.tool),
    ["entity_catalog_query"]
  );
  assert.equal(listResponse.payload.executionPlan.steps[0].arguments.filters.traits.length, 1);
  assert.equal(listResponse.payload.executionTrace.status, "completed");
  assert.equal(listResponse.payload.executionTrace.toolCallCount, 1);
});

test("batch build page shows the highest-sample build per champion", async () => {
  const metaTFTClient = {
    async getUnitBuilds(plan) {
      const unit = plan.pathUnit;
      if (unit === "TFT17_Bramble") {
        return {
          data: [
            {
              unit_builds: "TFT17_Bramble&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
              placement_count: [100, 0, 0, 0, 0, 0, 0, 0]
            },
            {
              unit_builds: "TFT17_Bramble&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_Deathblade",
              placement_count: [200, 150, 100, 50, 0, 0, 0, 0]
            }
          ]
        };
      }
      return {
        data: [{
          unit_builds: `${unit}&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer`,
          placement_count: [120, 120, 120, 120, 120, 120, 120, 120]
        }]
      };
    },
    async getItemCarrierBuilds() {
      return { data: [] };
    }
  };
  const runtime = await createSmallWindowRuntimeAsync(createWebRuntimeOptions({
    conversationStateV2Mode: "off",
    metaTFTClient
  }), {});
  const response = await handleRecommendRequest({
    input: "木灵族中的四费棋子怎么出装",
    conversationId: "highest-sample-builds"
  }, runtime);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.type, "unit_builds_batch_results");
  const bramble = response.payload.results.find((entry) => entry.apiName === "TFT17_Bramble");
  assert.equal(bramble.available, true);
  assert.equal(bramble.games, 500);
  assert.deepEqual(
    bramble.bestBuild.map((entry) => entry.apiName),
    ["TFT_Item_GuinsoosRageblade", "TFT_Item_InfinityEdge", "TFT_Item_Deathblade"]
  );
});

test("MetaTFT comp_options invalid JSON is isolated from catalog refresh and planning", async () => {
  const invalidJsonFetch = async (url) => {
    if (String(url).includes("/tft-comps-api/comp_options")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        }
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => []
    };
  };
  const runtime = await createSmallWindowRuntimeAsync({
    cacheStore: new MemoryCacheStore(),
    fetchItems: true,
    catalogMetaTFTClient: {
      async getItems() {
        return { data: [] };
      },
      async getUnitsUnique() {
        return { data: [
          { units_unique: "TFT17_Bloom-4" },
          { units_unique: "TFT17_Bramble-4" }
        ] };
      },
      async getTraits() {
        return { data: [{ traits: "TFT17_Woodling_2" }] };
      }
    },
    compsClient: new CompsContextClient({
      fetchImpl: invalidJsonFetch,
      timeoutMs: 60,
      maxRetries: 0
    }),
    conversationStateV2Mode: "off"
  }, {});
  const entry = await loadRuntimeCatalog(runtime, {
    seasonContextId: "set17-live",
    patch: "current",
    queue: "1100"
  });

  assert.deepEqual(entry.compsData.compOptions, []);
  assert.equal(entry.compOptionsFailure.status, "failed");
  assert.equal(entry.compOptionsFailure.code, "metatft_invalid_json");
  assert.equal(entry.compOptionsFailure.endpoint, "tft-comps-api/comp_options");
  assert.match(entry.compOptionsFailure.message, /invalid JSON/);
  assert.match(entry.warning, /invalid JSON/);
  assert.ok(entry.catalog.units.some((unit) => unit.apiName === "TFT17_Bloom"));
});

test("a hanging MetaTFT comp_options refresh is bounded by its endpoint timeout", async () => {
  const hangingFetch = async (url, options = {}) => {
    if (String(url).includes("/tft-comps-api/comp_options")) {
      return new Promise((_, reject) => {
        options.signal?.addEventListener?.("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => []
    };
  };
  const runtime = await createSmallWindowRuntimeAsync({
    cacheStore: new MemoryCacheStore(),
    fetchItems: true,
    catalogMetaTFTClient: {
      async getItems() {
        return { data: [] };
      },
      async getUnitsUnique() {
        return { data: [] };
      },
      async getTraits() {
        return { data: [] };
      }
    },
    compsClient: new CompsContextClient({
      fetchImpl: hangingFetch,
      timeoutMs: 60,
      maxRetries: 0
    }),
    conversationStateV2Mode: "off"
  }, {});
  const startedAt = Date.now();
  const entry = await loadRuntimeCatalog(runtime, {
    seasonContextId: "set17-live",
    patch: "current",
    queue: "1100"
  });
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs < 2000, `catalog refresh took ${elapsedMs}ms`);
  assert.equal(entry.compOptionsFailure.status, "failed");
  assert.equal(entry.compOptionsFailure.code, "metatft_timeout");
  assert.deepEqual(entry.compsData.compOptions, []);
});

test("catalog wording does not truncate a five-cost build comparison", async () => {
  const runtime = createWebRuntime({ conversationStateV2Mode: "on" });
  const response = await handleRecommendRequest({
    input: "所有棋子中哪些五费卡的出装表现最好？",
    conversationId: "all-units-five-cost-builds"
  }, runtime);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.type, "unit_builds_batch_results");
  assert.notEqual(response.payload.type, "entity_catalog");
  assert.deepEqual(
    response.payload.executionPlan.steps.map((step) => step.tool),
    ["entity_catalog_query", "unit_builds_batch"]
  );
  assert.deepEqual(
    response.payload.results.map((unit) => unit.apiName).sort(),
    ["TFT17_Canopy", "TFT17_Fiora", "TFT17_Nova"]
  );
  assert.equal(response.payload.taskFrame.constraints.cost, 5);
});

test("item detail wording does not truncate a carrier ranking request", async () => {
  const response = await handleRecommendRequest({
    input: "太空律动纹章是什么装备，谁带最好？",
    conversationId: "item-details-plus-carriers"
  }, createWebRuntime({ conversationStateV2Mode: "on" }));

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.type, "item_carrier_rankings");
  assert.equal(response.payload.query.item, "TFT17_Item_SpaceGrooveEmblemItem");
});

test("web conversation expands a deictic trait follow-up into four-cost units and batch builds", async () => {
  const runtime = createWebRuntime({
    conversationStateV2Mode: "on",
    turnDeltaProvider: async () => createTurnDelta({
      dialogueAct: "continue",
      taskRelation: "continue",
      confidence: 0.95
    })
  });
  const first = await handleRecommendRequest({
    input: "木灵族是什么羁绊",
    conversationId: "deictic-trait-builds"
  }, runtime);
  const second = await handleRecommendRequest({
    input: "这个羁绊有哪些四费棋子，怎么出装",
    conversationId: "deictic-trait-builds"
  }, runtime);

  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.type, "trait_details");
  assert.equal(second.statusCode, 200);
  assert.equal(second.payload.type, "unit_builds_batch_results");
  assert.deepEqual(
    second.payload.executionPlan.steps.map((step) => step.tool),
    ["entity_catalog_query", "unit_builds_batch"]
  );
  assert.equal(
    second.payload.executionPlan.steps[0].arguments.filters.traits.length,
    1
  );
  assert.deepEqual(
    second.payload.results.map((unit) => unit.apiName).sort(),
    ["TFT17_Bloom", "TFT17_Bramble"]
  );
  assert.equal(second.payload.taskFrame.constraints.cost, 4);
  assert.match(
    second.payload.taskFrame.concepts[0].resolvedId,
    /^TFT17_Woodling(?:_2)?$/
  );
  assert.deepEqual(second.payload.taskFrame.capabilityRequirements, [
    "entity_catalog_filtering",
    "unit_build_statistics"
  ]);
  assert.equal(second.payload.conversation.providerFallback.reason, "contextual_task_recovery");
  assert.equal(second.payload.conversation.providerInvocation.attempted, true);
  assert.equal(second.payload.conversation.providerInvocation.succeeded, true);
  assert.equal(second.payload.conversation.providerInvocation.corrected, true);
  assert.equal(first.payload.meta.llmUsed, false);
  assert.deepEqual(first.payload.meta.llmStages, []);
  assert.equal(second.payload.meta.llmUsed, true);
  assert.deepEqual(second.payload.meta.llmStages, ["turn_interpreter"]);
  const firstEvent = await runtime.cacheStore.getQueryEvent(first.payload.queryId);
  const secondEvent = await runtime.cacheStore.getQueryEvent(second.payload.queryId);
  assert.equal(firstEvent.llmUsed, false);
  assert.equal(secondEvent.llmUsed, true);
  assert.equal(second.payload.executionTrace.status, "completed");
  assert.equal(second.payload.executionTrace.toolCallCount, 2);
});

test("three-turn catalog conversation reuses displayed units for an action-only build follow-up", async () => {
  const runtime = createWebRuntime({
    conversationStateV2Mode: "on",
    turnDeltaProvider: async () => createTurnDelta({
      dialogueAct: "continue",
      taskRelation: "continue",
      confidence: 0.95
    })
  });
  const conversationId = "catalog-then-action-only-builds";
  const first = await handleRecommendRequest({
    input: "木灵族是什么羁绊",
    conversationId
  }, runtime);
  const second = await handleRecommendRequest({
    input: "该羁绊内有哪些四费棋子",
    conversationId
  }, runtime);
  const third = await handleRecommendRequest({
    input: "怎么出装？",
    conversationId
  }, runtime);

  assert.equal(first.payload.type, "trait_details");
  assert.equal(second.payload.type, "entity_catalog_results");
  assert.deepEqual(
    second.payload.results.map((entry) => entry.apiName).sort(),
    ["TFT17_Bloom", "TFT17_Bramble"]
  );
  assert.equal(third.statusCode, 200);
  assert.equal(third.payload.type, "unit_builds_batch_results");
  assert.deepEqual(third.payload.executionPlan.steps.map((step) => step.tool), ["unit_builds_batch"]);
  assert.deepEqual(
    third.payload.executionPlan.steps[0].arguments.entities.map((entry) => entry.apiName),
    second.payload.results.map((entry) => entry.apiName)
  );
  assert.equal(third.payload.resultMode, "per_entity_recommendations");
  assert.match(third.payload.text, /各自的主流出装/);
  assert.doesNotMatch(third.payload.text, /表现最好/);
  assert.equal(third.payload.meta.llmUsed, true);
  assert.deepEqual(third.payload.meta.llmStages, ["turn_interpreter"]);
});

test("action-only build wording in a new conversation asks for a champion", async () => {
  const runtime = createWebRuntime({
    conversationStateV2Mode: "on",
    turnDeltaProvider: async () => createTurnDelta({
      dialogueAct: "start_task",
      taskRelation: "new",
      explicitTaskFrame: createTaskFrame({
        action: "rank",
        goal: "comp_rankings",
        confidence: 0.95,
        understandingStatus: "understood_and_supported"
      }),
      confidence: 0.95
    })
  });
  const response = await handleRecommendRequest({
    input: "怎么出装？",
    conversationId: "action-only-build-without-context"
  }, runtime);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.type, "clarification");
  assert.equal(response.payload.text, "要查哪个英雄的出装？请告诉我英雄名称。");
  assert.equal(response.payload.conversation.providerInvocation.attempted, true);
  assert.equal(response.payload.conversation.providerInvocation.succeeded, true);
  assert.equal(response.payload.conversation.providerInvocation.corrected, true);
  assert.equal(
    response.payload.conversation.providerInvocation.correctionReason,
    "action_only_build_followup_policy"
  );
});

test("batch build lookup returns partial evidence when one unit source fails", async () => {
  const runtime = createWebRuntime({
    conversationStateV2Mode: "on",
    turnDeltaProvider: async () => createTurnDelta({
      dialogueAct: "continue",
      taskRelation: "continue",
      confidence: 0.95
    }),
    metaTFTClient: {
      async getUnitBuilds(plan) {
        if (plan.pathUnit === "TFT17_Bramble") {
          throw new Error("simulated unit timeout");
        }
        return {
          data: [{
            unit_builds: `${plan.pathUnit}&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer`,
            placement_count: [120, 120, 120, 120, 120, 120, 120, 120]
          }]
        };
      }
    }
  });
  await handleRecommendRequest({
    input: "木灵族是什么羁绊",
    conversationId: "partial-trait-builds"
  }, runtime);
  const response = await handleRecommendRequest({
    input: "这个羁绊有哪些四费棋子，怎么出装",
    conversationId: "partial-trait-builds"
  }, runtime);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.type, "unit_builds_batch_results");
  assert.equal(response.payload.results.length, 2);
  assert.equal(response.payload.results[0].apiName, "TFT17_Bloom");
  assert.equal(response.payload.results[0].available, true);
  const unavailable = response.payload.results.find((entry) => entry.apiName === "TFT17_Bramble");
  assert.equal(unavailable.available, false);
  assert.match(unavailable.warning, /simulated unit timeout/);
  assert.match(response.payload.text, /荆棘的统计暂时不可用/);
  assert.equal(response.payload.executionTrace.status, "completed");
});

test("web request treats external support as material ambiguity before any stats lookup", async () => {
  const runtime = createWebRuntime();
  const response = await handleRecommendRequest({
    input: "太空律动外援",
    conversationId: "external-ambiguity"
  }, runtime);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.type, "clarification");
  assert.equal(response.payload.clarification.reason, "ambiguous_game_concept");
  assert.match(response.payload.clarification.question, /非太空律动单挂/);
  assert.match(response.payload.clarification.question, /转职/);
  assert.equal(response.payload.taskFrame.understandingStatus, "ambiguous");
});

test("web conversation carries emblem-carrier meaning from 转谁带 into 外援", async () => {
  const runtime = createWebRuntime({
    conversationStateV2Mode: "on",
    turnDeltaProvider: async () => createTurnDelta({
      dialogueAct: "continue",
      taskRelation: "continue",
      confidence: 0.95
    })
  });
  const conversationId = "emblem-carrier-external-support";
  const first = await handleRecommendRequest({
    input: "太空律动转谁带",
    conversationId
  }, runtime);
  const second = await handleRecommendRequest({
    input: "太空律动外援",
    conversationId
  }, runtime);

  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.type, "item_carrier_rankings");
  assert.equal(first.payload.query.item, "TFT17_Item_SpaceGrooveEmblemItem");
  assert.equal(second.statusCode, 200);
  assert.notEqual(second.payload.clarification?.reason, "missing_unit");
  assert.equal(second.payload.type, "item_carrier_rankings");
  assert.equal(second.payload.query.item, "TFT17_Item_SpaceGrooveEmblemItem");
  assert.equal(second.payload.clarification?.needsClarification, undefined);
  assert.equal(
    second.payload.taskFrame.constraints.externalSupportInterpretation,
    "emblem_carrier"
  );
  assert.ok(
    second.payload.taskFrame.assumptions.includes("按适合携带目标羁绊转职的外援棋子理解")
  );
});
