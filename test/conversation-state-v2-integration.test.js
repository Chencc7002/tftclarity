import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import {
  ExecutionPlanExecutor,
  MemoryCacheStore,
  ToolExecutor,
  ToolRegistry,
  comparePublicBusinessResults,
  createCatalog,
  createStructuredToolDefinitions,
  createTaskFrame,
  createTurnDelta,
  migrateLegacySessionToConversationState,
  recommendForInput
} from "../src/index.js";

const compFixture = JSON.parse(await readFile(
  new URL("./fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url),
  "utf8"
));

const unitRows = [
  ["TFT_Item_RapidFireCannon", "TFT_Item_RunaansHurricane", "TFT_Item_RunaansHurricane"],
  ["TFT_Item_RapidFireCannon", "TFT_Item_InfinityEdge", "TFT_Item_GiantSlayer"],
  ["TFT_Item_GuinsoosRageblade", "TFT_Item_InfinityEdge", "TFT_Item_GiantSlayer"],
  ["TFT_Item_GuinsoosRageblade", "TFT_Item_LastWhisper", "TFT_Item_Deathblade"],
  ["TFT_Item_InfinityEdge", "TFT_Item_JeweledGauntlet", "TFT_Item_GiantSlayer"]
].map((items, index) => ({
  unit_builds: `TFT17_Xayah&${items.join("|")}`,
  placement_count: [40 - index, 30, 20, 10, 5, 4, 3, 2]
}));

function entity(rawText, expectedType, resolvedId = null) {
  return { rawText, expectedType, resolvedId, confidence: resolvedId ? 1 : null };
}

function compFrame(constraints = {}) {
  return createTaskFrame({
    action: "rank",
    goal: "comp_rankings",
    constraints: { limit: 3, ...constraints },
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
}

function unitFrame(unit, constraints = {}) {
  return createTaskFrame({
    action: "recommend",
    goal: "unit_build_rankings",
    subjects: [entity(unit, "champion", unit)],
    constraints,
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
}

function itemComparisonFrame(unit, items) {
  return createTaskFrame({
    action: "compare",
    goal: "unit_item_comparison",
    subjects: [entity(unit, "champion", unit)],
    constraints: {
      comparisonItems: items.map((item) => entity(item, "item", item))
    },
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
}

function catalogWithKaisa() {
  const base = createCatalog();
  return createCatalog({
    units: [
      ...base.units,
      {
        apiName: "TFT17_Kaisa",
        zhName: "卡莎",
        aliases: ["卡莎", "kaisa"],
        cost: 4,
        current: true
      }
    ]
  });
}

function queuedInterpreter(deltas) {
  const queue = [...deltas];
  return async () => {
    assert.ok(queue.length > 0, "turn interpreter queue was exhausted");
    return queue.shift();
  };
}

function newTask(frame) {
  return createTurnDelta({
    dialogueAct: "start_task",
    taskRelation: "new",
    explicitTaskFrame: frame,
    confidence: 1
  });
}

function modify(constraintOperations = [], explicitTaskFrame = null) {
  return createTurnDelta({
    dialogueAct: "modify",
    taskRelation: "modify",
    explicitTaskFrame,
    constraintOperations,
    confidence: 1
  });
}

function requestMore(count = null) {
  return createTurnDelta({
    dialogueAct: "request_more",
    taskRelation: "continue",
    presentation: { requestedCount: count, pageDirection: "next", avoidSeen: true },
    confidence: 1
  });
}

function rerollEnrichment(limit = 3) {
  return {
    async enrichRankingResult(value) {
      const eligible = new Set(value.candidates.slice(0, limit).map((entry) => entry.compId));
      const enrich = (entry) => ({
        ...entry,
        strategy: eligible.has(entry.compId) ? "reroll" : "fast8"
      });
      return {
        ...value,
        candidates: value.candidates.map(enrich),
        rankings: Object.fromEntries(
          Object.entries(value.rankings).map(([key, entries]) => [key, entries.map(enrich)])
        ),
        references: value.references.map(enrich)
      };
    }
  };
}

function baseCompOptions(cacheStore, sessionKey, turnInterpreter) {
  return {
    cacheStore,
    sessionKey,
    catalog: catalogWithKaisa(),
    compResponse: compFixture,
    compEnrichmentService: rerollEnrichment(3),
    preferences: { minSamples: 1 },
    conversationStateV2Mode: "on",
    semanticShadow: false,
    turnInterpreter
  };
}

test("reroll composition request followed by more preserves the task and reports exhaustion", async () => {
  const cacheStore = new MemoryCacheStore();
  const turnInterpreter = queuedInterpreter([
    newTask(compFrame({ strategy: "reroll", specialMode: true })),
    requestMore()
  ]);
  const options = baseCompOptions(cacheStore, "v2-exhausted", turnInterpreter);
  const first = await recommendForInput("推荐几个赌狗阵容", options);
  assert.equal(first.type, "comp_rankings");
  assert.equal(first.preferenceSearch.returnedCount, 3);
  assert.equal(first.conversationState.lastResult.exhausted, true);
  assert.equal(first.conversationState.lastResult.appliedConstraints.strategy, "reroll");
  assert.equal(
    Object.hasOwn(first.conversationState.lastResult.appliedConstraints, "seasonContextId"),
    false
  );
  assert.equal(first.conversationState.activeTask.taskFrame.constraints.strategy, "reroll");
  assert.equal(
    Object.hasOwn(first.conversationState.activeTask.taskFrame.constraints, "specialMode"),
    false
  );

  const second = await recommendForInput("可以多推荐几套吗", options);
  assert.equal(second.type, "conversation_exhausted");
  assert.equal(second.conversation.resolution.resolvedTaskFrame.goal, "comp_rankings");
  assert.equal(second.conversation.resolution.resolvedTaskFrame.constraints.strategy, "reroll");
  assert.doesNotMatch(second.text, /英雄/u);
});

test("required direct two-turn examples preserve the active task and apply only their delta", async () => {
  const compCases = [
    {
      id: "rank",
      first: "推荐几个赌狗阵容",
      second: "只看大师以上",
      firstDelta: newTask(compFrame({ strategy: "reroll" })),
      secondDelta: modify([{
        operation: "set",
        field: "rank",
        value: ["MASTER", "GRANDMASTER", "CHALLENGER"]
      }]),
      verify(result) {
        assert.deepEqual(result.query.rankFilter, ["MASTER", "GRANDMASTER", "CHALLENGER"]);
        assert.equal(result.query.preferenceConditions.strategy, "reroll");
      }
    },
    {
      id: "remove",
      first: "推荐几个赌狗阵容",
      second: "不要赌狗了",
      firstDelta: newTask(compFrame({ strategy: "reroll" })),
      secondDelta: modify([{ operation: "clear", field: "strategy" }]),
      verify(result) {
        assert.equal(result.query.preferenceRequested, false);
      }
    },
    {
      id: "page",
      first: "推荐几个热门阵容",
      second: "换一批",
      firstDelta: newTask(compFrame({ metrics: ["popularity"], limit: 2 })),
      secondDelta: requestMore(2),
      verify(result, firstResult) {
        assert.equal(
          result.conversationPage.shownIds.some((id) => (
            firstResult.conversationState.lastResult.shownIds.includes(id)
          )),
          false
        );
      }
    }
  ];
  for (const testCase of compCases) {
    const cacheStore = new MemoryCacheStore();
    const options = {
      ...baseCompOptions(
        cacheStore,
        `required-comp-${testCase.id}`,
        queuedInterpreter([testCase.firstDelta, testCase.secondDelta])
      ),
      compEnrichmentService: testCase.id === "page" ? null : rerollEnrichment(3)
    };
    const first = await recommendForInput(testCase.first, options);
    const second = await recommendForInput(testCase.second, options);
    testCase.verify(second, first);
  }

  const unitCases = [
    {
      id: "next",
      second: "第二套呢",
      delta: requestMore(2),
      verify(result) {
        assert.equal(result.query.unit, "TFT17_Xayah");
        assert.ok(result.conversationPage.returnedCount > 0);
      }
    },
    {
      id: "exclude",
      second: "如果没有轻语呢",
      delta: modify([{
        operation: "add",
        field: "excludedItems",
        value: [entity("Last Whisper", "item", "TFT_Item_LastWhisper")]
      }]),
      verify(result) {
        assert.deepEqual(result.query.excludedItems, ["TFT_Item_LastWhisper"]);
      }
    },
    {
      id: "replace",
      second: "换成卡莎",
      delta: modify([], unitFrame("TFT17_Kaisa")),
      verify(result) {
        assert.equal(result.query.unit, "TFT17_Kaisa");
      }
    }
  ];
  for (const testCase of unitCases) {
    const cacheStore = new MemoryCacheStore();
    const options = {
      cacheStore,
      sessionKey: `required-unit-${testCase.id}`,
      catalog: catalogWithKaisa(),
      response: unitRows,
      preferences: { minSamples: 1 },
      conversationStateV2Mode: "on",
      semanticShadow: false,
      turnInterpreter: queuedInterpreter([
        newTask(unitFrame("TFT17_Xayah")),
        testCase.delta
      ])
    };
    await recommendForInput("霞带什么装备", options);
    const second = await recommendForInput(testCase.second, options);
    testCase.verify(second);
  }
});

test("changing carried equipment widens an inherited ordinary policy for Artifacts and Radiant items", async () => {
  const baseCatalog = createCatalog();
  const ordinary = "TFT_Item_GuinsoosRageblade";
  const infinityEdge = "TFT_Item_InfinityEdge";
  const artifact = "TFT_Item_TestConversationArtifact";
  const radiant = "TFT_Item_TestConversationRadiant";
  const catalog = createCatalog({
    units: baseCatalog.units,
    items: [
      ...baseCatalog.items,
      {
        apiName: artifact,
        zhName: "测试神器",
        aliases: ["测试神器"],
        category: "artifact",
        current: true,
        obtainable: true
      },
      {
        apiName: radiant,
        zhName: "测试光明装",
        aliases: ["测试光明装"],
        category: "radiant",
        current: true,
        obtainable: true
      }
    ]
  });
  const response = [
    [ordinary, infinityEdge, "TFT_Item_GiantSlayer"],
    [artifact, ordinary, infinityEdge],
    [radiant, ordinary, infinityEdge]
  ].map((items, index) => ({
    unit_builds: `TFT17_Xayah&${items.join("|")}`,
    placement_count: [40 - index, 30, 20, 10, 5, 4, 3, 2]
  }));
  const cases = [
    { item: artifact, input: "修改已携带测试神器", policy: "include_artifact", label: /含神器装备/u },
    { item: radiant, input: "修改已携带测试光明装", policy: "include_radiant", label: /含光明装备/u }
  ];

  for (const testCase of cases) {
    const cacheStore = new MemoryCacheStore();
    const options = {
      cacheStore,
      sessionKey: `v2-locked-policy-${testCase.policy}`,
      catalog,
      response,
      preferences: { minSamples: 1, itemPolicy: "ordinary_only" },
      conversationStateV2Mode: "on",
      semanticShadow: false,
      turnInterpreter: queuedInterpreter([
        newTask(unitFrame("TFT17_Xayah", { itemPolicy: "ordinary_only" })),
        modify([{
          operation: "set",
          field: "lockedItems",
          value: [entity(testCase.input.replace("修改已携带", ""), "item", testCase.item)]
        }])
      ])
    };

    await recommendForInput("霞带什么装备", options);
    const changed = await recommendForInput(testCase.input, options);

    assert.deepEqual(changed.query.lockedItems, [testCase.item]);
    assert.equal(changed.query.itemPolicy, testCase.policy);
    assert.equal(changed.query.validation.valid, true);
    assert.match(changed.text, testCase.label);
    assert.equal(
      changed.query.assumptions.find((entry) => entry.key === "item_policy").value,
      testCase.policy
    );
  }
});

test("composition constraints can be added, removed, and replaced without changing the task", async () => {
  const cacheStore = new MemoryCacheStore();
  const turnInterpreter = queuedInterpreter([
    newTask(compFrame({ strategy: "reroll", specialMode: true })),
    modify([{ operation: "set", field: "rank", value: ["CHALLENGER", "GRANDMASTER", "MASTER"] }]),
    modify([
      { operation: "clear", field: "strategy" },
      { operation: "clear", field: "specialMode" }
    ]),
    modify([{ operation: "set", field: "strategy", value: "fast9" }])
  ]);
  const options = {
    ...baseCompOptions(cacheStore, "v2-constraints", turnInterpreter),
    compEnrichmentService: {
      async enrichRankingResult(value) {
        const enrich = (entry) => ({ ...entry, strategy: "fast9" });
        return {
          ...value,
          candidates: value.candidates.map(enrich),
          rankings: Object.fromEntries(
            Object.entries(value.rankings).map(([key, entries]) => [key, entries.map(enrich)])
          ),
          references: value.references.map(enrich)
        };
      }
    }
  };
  await recommendForInput("推荐几个赌狗阵容", options);
  const rank = await recommendForInput("只看大师以上", options);
  assert.equal(rank.type, "comp_rankings");
  assert.deepEqual(rank.query.rankFilter, ["CHALLENGER", "GRANDMASTER", "MASTER"]);
  assert.equal(rank.query.preferenceConditions.strategy, "reroll");

  const removed = await recommendForInput("不要赌狗了", options);
  assert.equal(removed.query.preferenceRequested, false);
  assert.equal(removed.query.specialMode, false);

  const replaced = await recommendForInput("改成九五运营", options);
  assert.equal(replaced.query.preferenceConditions.strategy, "fast9");
});

test("requesting another composition batch filters previously shown ids", async () => {
  const cacheStore = new MemoryCacheStore();
  const turnInterpreter = queuedInterpreter([
    newTask(compFrame({ metrics: ["popularity"], limit: 2 })),
    requestMore(2)
  ]);
  const options = {
    ...baseCompOptions(cacheStore, "v2-page", turnInterpreter),
    compEnrichmentService: null
  };
  const first = await recommendForInput("推荐几个热门阵容", options);
  const firstIds = first.conversationState.lastResult.shownIds;
  assert.equal(first.conversationState.lastResult.exhausted, false);

  const second = await recommendForInput("换一批", options);
  const secondIds = second.conversationPage.shownIds;
  assert.equal(second.type, "comp_rankings");
  assert.ok(secondIds.length > 0);
  assert.equal(secondIds.some((id) => firstIds.includes(id)), false);
});

test("unit build follow-ups inherit, exclude items, replace the champion, and return to history", async () => {
  const cacheStore = new MemoryCacheStore();
  const xayah = unitFrame("TFT17_Xayah");
  const kaisa = unitFrame("TFT17_Kaisa");
  const turnInterpreter = queuedInterpreter([
    newTask(xayah),
    createTurnDelta({
      dialogueAct: "next_page",
      taskRelation: "continue",
      presentation: { requestedCount: 2, pageDirection: "next", avoidSeen: true },
      confidence: 1
    }),
    modify([{
      operation: "add",
      field: "excludedItems",
      value: [entity("Last Whisper", "item", "TFT_Item_LastWhisper")]
    }]),
    modify([], kaisa),
    createTurnDelta({
      dialogueAct: "continue",
      taskRelation: "return",
      explicitTaskFrame: xayah,
      confidence: 1
    })
  ]);
  const options = {
    cacheStore,
    sessionKey: "v2-unit",
    catalog: catalogWithKaisa(),
    response: unitRows,
    preferences: { minSamples: 1 },
    conversationStateV2Mode: "on",
    semanticShadow: false,
    turnInterpreter
  };
  const first = await recommendForInput("霞带什么装备", options);
  assert.equal(first.query.unit, "TFT17_Xayah");
  assert.equal(first.conversationState.lastResult.exhausted, false, JSON.stringify(first.conversationState.lastResult));
  const second = await recommendForInput("第二套呢", options);
  assert.equal(second.type, "unit_build_rankings", JSON.stringify(second));
  assert.equal(second.query.unit, "TFT17_Xayah");
  assert.ok(second.conversationPage.returnedCount >= 1);
  assert.ok(second.conversationPage.returnedCount <= 2);

  const excluded = await recommendForInput("如果没有轻语呢", options);
  assert.deepEqual(excluded.query.excludedItems, ["TFT_Item_LastWhisper"]);

  const switched = await recommendForInput("换成卡莎", options);
  assert.equal(switched.query.unit, "TFT17_Kaisa");

  const returned = await recommendForInput("回到刚才霞的出装", options);
  assert.equal(returned.query.unit, "TFT17_Xayah");
  assert.deepEqual(returned.query.excludedItems, ["TFT_Item_LastWhisper"]);
});

test("item comparison clarification preserves the champion and replaces the compared items", async () => {
  const cacheStore = new MemoryCacheStore();
  const sessionKey = "v2-item-comparison-clarification";
  const qss = "TFT_Item_Quicksilver";
  const titan = "TFT_Item_TitansResolve";
  const edgeOfNight = "TFT_Item_GuardianAngel";
  const masterYi = "TFT17_MasterYi";
  const baseCatalog = createCatalog();
  const catalog = createCatalog({
    units: [
      ...baseCatalog.units,
      {
        apiName: masterYi,
        zhName: "易大师",
        aliases: ["易大师", "剑圣", "无极剑圣", "master yi", "yi"],
        current: true
      }
    ],
    items: [
      ...baseCatalog.items,
      {
        apiName: titan,
        zhName: "泰坦的坚决",
        shortName: "泰坦",
        aliases: ["泰坦", "泰坦的坚决"],
        category: "ordinary_completed",
        current: true,
        obtainable: true
      },
      {
        apiName: edgeOfNight,
        zhName: "夜之锋刃",
        shortName: "夜刃",
        aliases: ["夜刃", "夜之锋刃"],
        category: "ordinary_completed",
        current: true,
        obtainable: true
      }
    ]
  });
  const rows = [
    [qss, "TFT_Item_GuinsoosRageblade", "TFT_Item_Deathblade"],
    [titan, "TFT_Item_GuinsoosRageblade", "TFT_Item_Deathblade"],
    [edgeOfNight, "TFT_Item_GuinsoosRageblade", "TFT_Item_Deathblade"]
  ].map((items, index) => ({
    unit_builds: `${masterYi}&${items.join("|")}`,
    placement_count: [60 - index * 5, 50, 40, 30, 20, 10, 5, 2]
  }));
  const replacementFrame = itemComparisonFrame(masterYi, [qss, edgeOfNight]);
  const turnInterpreter = queuedInterpreter([
    newTask(itemComparisonFrame(masterYi, [qss, titan])),
    createTurnDelta({
      dialogueAct: "clarify",
      taskRelation: "unknown",
      explicitTaskFrame: replacementFrame,
      confidence: 0.4,
      ambiguities: [{
        code: "ambiguous_item_operation",
        affectsToolSelection: true,
        missingFields: ["taskRelation"]
      }]
    }),
    createTurnDelta({
      dialogueAct: "compare",
      taskRelation: "modify",
      confidence: 1
    })
  ]);
  const options = {
    cacheStore,
    sessionKey,
    catalog,
    response: rows,
    preferences: { minSamples: 1 },
    conversationStateV2Mode: "on",
    semanticShadow: false,
    turnInterpreter
  };

  const first = await recommendForInput("比较剑圣使用水银和泰坦时的表现", options);
  assert.equal(first.type, "unit_item_comparison");
  assert.equal(first.query.unit, masterYi);
  assert.deepEqual(first.query.comparisonItems, [qss, titan]);

  const clarification = await recommendForInput("水银和夜刃呢？", options);
  assert.equal(clarification.type, "clarification");
  assert.equal(clarification.conversation.resolution.nextState.pendingClarification.reason, "turn_relation_uncertain");

  const completed = await recommendForInput("比较这些装备哪个好", options);
  assert.equal(completed.type, "unit_item_comparison");
  assert.equal(completed.query.unit, masterYi);
  assert.deepEqual(completed.query.comparisonItems, [qss, edgeOfNight]);
  assert.equal(completed.conversationState.pendingClarification, null);
});

test("interleaved conversation ids remain isolated", async () => {
  const cacheStore = new MemoryCacheStore();
  const common = {
    cacheStore,
    catalog: catalogWithKaisa(),
    response: unitRows,
    preferences: { minSamples: 1 },
    conversationStateV2Mode: "on",
    semanticShadow: false
  };
  const firstOptions = {
    ...common,
    sessionKey: "last_query:conversation-a",
    turnInterpreter: queuedInterpreter([newTask(unitFrame("TFT17_Xayah")), requestMore(1)])
  };
  const secondOptions = {
    ...common,
    sessionKey: "last_query:conversation-b",
    turnInterpreter: queuedInterpreter([newTask(unitFrame("TFT17_Kaisa")), requestMore(1)])
  };
  const a1 = await recommendForInput("a1", firstOptions);
  const b1 = await recommendForInput("b1", secondOptions);
  assert.equal(a1.type, "unit_build_rankings", JSON.stringify(a1));
  assert.equal(b1.type, "unit_build_rankings", JSON.stringify(b1));
  const a2 = await recommendForInput("a2", firstOptions);
  const b2 = await recommendForInput("b2", secondOptions);
  assert.equal(a2.query.unit, "TFT17_Xayah");
  assert.equal(b2.query.unit, "TFT17_Kaisa");
});

test("tool failure does not replace the previous successful active task", async () => {
  const cacheStore = new MemoryCacheStore();
  const sessionKey = "v2-failure";
  await recommendForInput("first", {
    cacheStore,
    sessionKey,
    catalog: catalogWithKaisa(),
    response: unitRows,
    preferences: { minSamples: 1 },
    conversationStateV2Mode: "on",
    semanticShadow: false,
    turnInterpreter: queuedInterpreter([newTask(unitFrame("TFT17_Xayah"))])
  });
  await assert.rejects(() => recommendForInput("second", {
    cacheStore,
    sessionKey,
    catalog: catalogWithKaisa(),
    preferences: { minSamples: 1 },
    bypassQueryCache: true,
    metaTFTClient: {
      async getUnitBuilds() {
        throw new Error("fixture tool failure");
      }
    },
    conversationStateV2Mode: "on",
    semanticShadow: false,
    turnInterpreter: queuedInterpreter([modify([], unitFrame("TFT17_Kaisa"))])
  }), /fixture tool failure/);
  const entry = cacheStore.getSessionState(sessionKey, { seasonContextId: "set17-live" });
  assert.equal(entry.value.activeTask.taskFrame.subjects[0].resolvedId, "TFT17_Xayah");
});

test("uncertain turn creates pending clarification and the next explicit entity fills it", async () => {
  const cacheStore = new MemoryCacheStore();
  const candidate = createTaskFrame({
    action: "recommend",
    goal: "unit_build_rankings",
    confidence: 0.8,
    understandingStatus: "understood_and_supported"
  });
  const turnInterpreter = queuedInterpreter([
    createTurnDelta({
      dialogueAct: "unknown",
      taskRelation: "unknown",
      explicitTaskFrame: candidate,
      confidence: 0.2,
      ambiguities: [{ code: "missing_subject", affectsToolSelection: true }]
    }),
    createTurnDelta({
      dialogueAct: "clarify",
      taskRelation: "modify",
      explicitTaskFrame: unitFrame("TFT17_Xayah"),
      confidence: 1
    })
  ]);
  const options = {
    cacheStore,
    sessionKey: "v2-pending",
    catalog: createCatalog(),
    response: unitRows,
    preferences: { minSamples: 1 },
    conversationStateV2Mode: "on",
    semanticShadow: false,
    turnInterpreter
  };
  const clarification = await recommendForInput("ambiguous", options);
  assert.equal(clarification.type, "clarification");
  assert.equal(clarification.conversation.resolution.nextState.pendingClarification.reason, "turn_relation_uncertain");
  const completed = await recommendForInput("answer", options);
  assert.equal(completed.type, "unit_build_rankings");
  assert.equal(completed.query.unit, "TFT17_Xayah");
});

test("on mode bypasses legacy session inheritance and merges the request exactly once", async () => {
  const cacheStore = new MemoryCacheStore();
  const sessionKey = "v2-no-double-merge";
  cacheStore.setSessionState(sessionKey, {
    query: {
      intent: "unit_build_rankings",
      unit: "TFT17_Xayah",
      excludedItems: ["TFT_Item_InfinityEdge"],
      minSamples: 9
    },
    lastResultIds: ["legacy-result"]
  }, { seasonContextId: "set17-live" });

  const result = await recommendForInput("new task", {
    cacheStore,
    sessionKey,
    catalog: catalogWithKaisa(),
    response: unitRows,
    preferences: { minSamples: 1 },
    conversationStateV2Mode: "on",
    semanticShadow: false,
    turnInterpreter: queuedInterpreter([newTask(unitFrame("TFT17_Kaisa"))])
  });

  assert.equal(result.query.unit, "TFT17_Kaisa");
  assert.deepEqual(result.query.excludedItems, []);
  assert.equal(result.query.minSamples, 1);
  assert.equal(result.cache.session.inherited, false);
  assert.equal(result.conversationState.taskHistory.at(-1).taskFrame.subjects[0].resolvedId, "TFT17_Xayah");
});

test("an explicit quick-task start ignores the active task while preserving it in history", async () => {
  const cacheStore = new MemoryCacheStore();
  const observedActiveGoals = [];
  const turnInterpreter = async ({ conversationState }) => {
    observedActiveGoals.push(conversationState.activeTask?.taskFrame?.goal ?? null);
    return observedActiveGoals.length === 1
      ? newTask(compFrame())
      : newTask(unitFrame("TFT17_Xayah"));
  };
  const options = baseCompOptions(cacheStore, "v2-explicit-quick-task", turnInterpreter);

  const first = await recommendForInput("推荐当前版本热门阵容", options);
  const second = await recommendForInput("查询霞的当前版本最稳三件装备", {
    ...options,
    startNewTask: true,
    response: unitRows
  });

  assert.equal(first.type, "comp_rankings");
  assert.equal(second.type, "unit_build_rankings");
  assert.deepEqual(observedActiveGoals, [null, null]);
  assert.equal(second.conversationState.activeTask.taskFrame.goal, "unit_build_rankings");
  assert.equal(second.conversationState.taskHistory.at(-1).taskFrame.goal, "comp_rankings");
});

test("shadow mode records all migration comparison dimensions without changing the legacy response", async () => {
  const result = await recommendForInput("霞怎么出装", {
    useSession: false,
    catalog: catalogWithKaisa(),
    response: unitRows,
    preferences: { minSamples: 1 },
    conversationStateV2Mode: "shadow",
    semanticShadow: false,
    turnInterpreter: queuedInterpreter([newTask(unitFrame("TFT17_Xayah"))])
  });

  assert.equal(result.type, "unit_build_rankings");
  assert.equal(result.query.unit, "TFT17_Xayah");
  assert.equal(result.conversationState, undefined);
  assert.equal(result.conversationShadow.taskRelation, "new");
  for (const field of [
    "activeTask",
    "clarification",
    "tool",
    "completeParameters",
    "resultState",
    "exhausted"
  ]) {
    assert.ok(Object.hasOwn(result.conversationShadow, field), field);
  }
  if (
    result.conversationShadow.tool.equivalent === true
    && result.conversationShadow.completeParameters.equivalent === true
  ) {
    assert.equal(result.conversationShadow.resultState.equivalent, true);
  } else {
    assert.ok(
      result.conversationShadow.differences.some((difference) => (
        ["tool_difference", "parameter_difference", "result_state_unavailable"].includes(difference)
      ))
    );
  }
});

test("an unavailable interpreter provider degrades to clarification without calling a tool", async () => {
  let toolCalls = 0;
  const result = await recommendForInput("elliptical follow-up", {
    useSession: false,
    catalog: catalogWithKaisa(),
    conversationStateV2Mode: "on",
    semanticTaskParser: async () => ({
      taskFrame: createTaskFrame({
        action: "unknown",
        goal: "unknown",
        confidence: 0,
        understandingStatus: "needs_clarification"
      })
    }),
    metaTFTClient: {
      async getUnitBuilds() {
        toolCalls += 1;
        return { data: unitRows };
      }
    }
  });

  assert.equal(result.type, "clarification");
  assert.equal(result.conversation.resolution.decision, "clarify");
  assert.equal(result.conversation.delta.taskRelation, "unknown");
  assert.equal(toolCalls, 0);
});

test("resolved ConversationState v2 TaskFrame enters the sovereign Phase 6.6 execution plan", async () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const toolExecutor = new ToolExecutor({ registry });
  const executionPlanExecutor = new ExecutionPlanExecutor({ registry, toolExecutor });
  let toolCalls = 0;
  const result = await recommendForInput("execute current task", {
    useSession: false,
    catalog: catalogWithKaisa(),
    preferences: { minSamples: 1 },
    conversationStateV2Mode: "on",
    executionPlanSovereignty: true,
    toolRegistry: registry,
    toolExecutor,
    executionPlanExecutor,
    turnInterpreter: queuedInterpreter([newTask(unitFrame("TFT17_Xayah", {
      rank: ["MASTER", "GRANDMASTER", "CHALLENGER"],
      days: 1,
      minSamples: 1
    }))]),
    metaTFTClient: {
      async getUnitBuilds() {
        toolCalls += 1;
        return {
          data: unitRows,
          capture: { capturedAt: "2026-07-27T00:00:00.000Z" }
        };
      }
    }
  });

  assert.equal(result.type, "unit_build_rankings");
  assert.equal(result.executionTrace.source, "execution_plan");
  assert.equal(result.executionPlan.steps[0].tool, "unit_builds");
  assert.equal(result.executionPlan.steps[0].arguments.unit, "TFT17_Xayah");
  assert.deepEqual(
    result.executionPlan.steps[0].arguments.rank,
    ["MASTER", "GRANDMASTER", "CHALLENGER"]
  );
  assert.equal(toolCalls, 1);
});

test("new-task on-mode business results remain equivalent to the legacy first-turn path", async () => {
  const unitCommon = {
    useSession: false,
    catalog: catalogWithKaisa(),
    response: unitRows,
    preferences: { minSamples: 1 },
    semanticShadow: false
  };
  const legacyUnit = await recommendForInput("霞带什么装备", unitCommon);
  const nextUnit = await recommendForInput("霞带什么装备", {
    ...unitCommon,
    conversationStateV2Mode: "on",
    turnInterpreter: queuedInterpreter([newTask(unitFrame("TFT17_Xayah"))])
  });
  const unitComparison = comparePublicBusinessResults(nextUnit, legacyUnit);
  assert.equal(unitComparison.equivalent, true, JSON.stringify(unitComparison.fieldDifferences));

  const compCommon = {
    useSession: false,
    catalog: catalogWithKaisa(),
    compResponse: compFixture,
    preferences: { minSamples: 1 },
    compEnrichmentService: null,
    semanticShadow: false
  };
  const legacyComp = await recommendForInput("推荐几个热门阵容", compCommon);
  const equivalentCompFrame = migrateLegacySessionToConversationState({
    query: legacyComp.query
  }).activeTask.taskFrame;
  const nextComp = await recommendForInput("推荐几个热门阵容", {
    ...compCommon,
    conversationStateV2Mode: "on",
    turnInterpreter: queuedInterpreter([
      newTask(equivalentCompFrame)
    ])
  });
  const comparison = comparePublicBusinessResults(nextComp, legacyComp);
  assert.equal(comparison.equivalent, true, JSON.stringify(comparison.fieldDifferences));
});
