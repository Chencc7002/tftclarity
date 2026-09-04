import assert from "node:assert/strict";
import test from "node:test";
import { ToolExecutor } from "../src/agent/tools/executor.js";
import { ToolRegistry } from "../src/agent/tools/registry.js";
import {
  buildCompositionTrendFallback,
  buildCompositionReplacementFallback,
  buildInsufficientEvidenceFallback,
  buildItemContentionFallback,
  buildSingleUnitItemRankingFallback,
  enrichMetricLeaderInterpretations,
  ReactLoop
} from "../src/react/react-loop.js";
import { preferredAnswerLanguage, validateFinishAction } from "../src/react/termination-policy.js";
import { requestedEquipmentCategoryScope } from "../src/domain/tft/equipment-category-scope.js";

function definition(name, options = {}) {
  return {
    schemaVersion: "agent_tool.v1",
    name,
    version: "1",
    description: `${name} test tool`,
    capabilities: [],
    source: options.source ?? "test_source",
    inputSchema: options.inputSchema ?? {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        apiName: { type: "string" },
        apiNames: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
        seasonContextId: { type: "string" },
        unit: { type: "string" },
        patch: { type: "string" },
        direction: { type: "string", enum: ["rising", "falling"] },
        query: { type: "string" },
        documentTypes: { type: "array", items: { type: "string" } },
        values: { type: "array", items: { type: "string" } },
        filter: {
          type: "object",
          additionalProperties: false,
          required: [],
          properties: {
            tier: { type: "string" },
            region: { type: "string" }
          }
        }
      }
    },
    outputSchema: null,
    readOnly: true,
    riskLevel: "low",
    timeoutMs: 1000,
    idempotent: true,
    cacheable: true,
    trustTier: "first_party",
    sideEffect: "none",
    requiresApproval: false,
    permissions: ["test:read"],
    credentialScope: "none",
    evidenceType: options.evidenceType ?? `${name}_evidence`,
    execute: async (input, context) => context.handler(input, context)
  };
}

test("unit-play input-language guard rejects a Chinese answer for a clear English turn", () => {
  const ledger = { resolve: () => [], snapshot: () => ({ entries: [] }) };
  assert.equal(preferredAnswerLanguage("How should I play Amumu?"), "en");
  assert.equal(preferredAnswerLanguage("阿木木怎么玩？"), "zh");

  const rejected = validateFinishAction({
    reasonCode: "direct_answer",
    evidenceIds: [],
    answer: "阿木木是一名魔法坦克，可以在来牌顺时考虑。"
  }, ledger, {
    unitPlayInputLanguageGuard: true,
    currentTurnInput: "How should I play Amumu?"
  });
  assert.equal(rejected.valid, false);
  assert.match(rejected.errors.join("\n"), /requires an English answer/u);

  const accepted = validateFinishAction({
    reasonCode: "direct_answer",
    evidenceIds: [],
    answer: "Amumu is a magic tank. Consider playing him when his recommended items or upgrades come naturally."
  }, ledger, {
    unitPlayInputLanguageGuard: true,
    currentTurnInput: "How should I play Amumu?"
  });
  assert.equal(accepted.valid, true);

  const legacy = validateFinishAction({
    reasonCode: "direct_answer",
    evidenceIds: [],
    answer: "阿木木是一名魔法坦克，可以在来牌顺时考虑。"
  }, ledger);
  assert.equal(legacy.valid, true, "legacy completion remains unchanged");
});

function action(type, value = {}) {
  return { schemaVersion: "react-action.v1", type, ...value };
}

function call(tool, argumentsValue = {}, purposeCode = "retrieve_current_statistics") {
  return action("call_tool", {
    tool,
    arguments: argumentsValue,
    purposeCode
  });
}

function finish(answer, evidenceIds = [], reasonCode = "sufficient_evidence") {
  return action("finish", { answer, evidenceIds, reasonCode });
}

function queueProvider(actions) {
  const queue = [...actions];
  const requests = [];
  const provider = async (request) => {
    requests.push(structuredClone(request));
    return queue.shift();
  };
  provider.requests = requests;
  return provider;
}

function runtimeContext(options = {}) {
  let toolCalls = 0;
  let retries = 0;
  return {
    run: {
      runId: "run-1",
      budget: { maxRetriesPerTool: options.maxRetriesPerTool ?? 1 },
      assertActive() {},
      consumeToolCall() { toolCalls += 1; },
      consumeRetry() { retries += 1; },
      emit() {}
    },
    createEvidenceId: (() => {
      let index = 0;
      return () => `ev-${++index}`;
    })(),
    counters: {
      get toolCalls() { return toolCalls; },
      get retries() { return retries; }
    }
  };
}

async function runCase(options = {}) {
  const registry = new ToolRegistry(options.definitions ?? [
    definition("unit_details"),
    definition("unit_builds"),
    definition("comps_trends"),
    definition("comps_rankings"),
    definition("semantic_search", { evidenceType: "semantic_candidates" })
  ]);
  let id = 0;
  const toolExecutor = new ToolExecutor({
    registry,
    createId: () => `tool-${++id}`,
    now: (() => {
      let time = 1_700_000_000_000;
      return () => ++time;
    })()
  });
  const events = [];
  const context = runtimeContext(options);
  const loop = new ReactLoop({
    registry,
    toolExecutor,
    decisionProvider: options.provider,
    handlers: options.handlers ?? {},
    budget: options.budget,
    groundingMode: options.groundingMode,
    createId: () => `loop-${++id}`,
    now: () => 1_700_000_000_000
  });
  const result = await loop.run({
    input: options.input ?? "test",
    ...(Array.isArray(options.messages) ? { messages: options.messages } : {}),
    ...(options.bridgeContext ? { bridgeContext: options.bridgeContext } : {}),
    ...(options.semanticAdvisory ? { semanticAdvisory: options.semanticAdvisory } : {}),
    ...(options.locale ? { locale: options.locale } : {}),
    seasonContextId: options.seasonContextId ?? "set17-live"
  }, {
    ...context,
    ...(options.contextOverrides ?? {}),
    onEvent: (event) => events.push(event)
  });
  return { result, events, context };
}

test("controlled unit-play reuses the exact TaskFrame subject for unit build grounding", async () => {
  let buildCalls = 0;
  const provider = queueProvider([
    call("unit_builds", { unit: "DA_18_Warwick" }),
    finish("来源装备已经取得。", ["ev-1"])
  ]);
  const { result, events } = await runCase({
    input: "沃里克推荐装备",
    semanticAdvisory: {
      action: "recommend",
      goal: "recommend_unit_play",
      subject: { resolvedId: "DA_18_Warwick", canonicalName: "沃里克" },
      expectedOutput: ["unit_play_guidance"]
    },
    provider,
    definitions: [definition("unit_builds")],
    handlers: { unit_builds: async () => {
      buildCalls += 1;
      return { type: "unit_build_rankings", unit: { apiName: "DA_18_Warwick" },
        cards: [{ items: [] }], updatedAt: "2026-08-30T00:00:00.000Z" };
    } }
  });
  assert.equal(result.terminationReason, "completed", JSON.stringify({ result, events }, null, 2));
  assert.equal(buildCalls, 1);
  assert.ok(!events.some((event) => event.type === "decision_rejected"));
});

test("controlled unit-play cannot reuse a different TaskFrame subject for unit build grounding", async () => {
  let buildCalls = 0;
  const provider = queueProvider([
    call("unit_builds", { unit: "DA_18_Xayah" }),
    finish("无法取得装备。", [], "insufficient_evidence")
  ]);
  const { events } = await runCase({
    input: "沃里克推荐装备",
    semanticAdvisory: {
      action: "recommend",
      goal: "recommend_unit_play",
      subject: { resolvedId: "DA_18_Warwick", canonicalName: "沃里克" },
      expectedOutput: ["unit_play_guidance"]
    },
    provider,
    definitions: [definition("unit_builds")],
    handlers: { unit_builds: async () => { buildCalls += 1; return {}; } }
  });
  assert.equal(buildCalls, 0);
  assert.ok(events.some((event) => event.type === "decision_rejected"
    && event.data?.code === "ungrounded_unit_build_query"));
});

const evidence = (results, extra = {}) => ({
  updatedAt: "2026-08-06T00:00:00.000Z",
  results,
  ...extra
});

test("R1-01 ordinary chat finishes directly without TaskFrame or tools", async () => {
  const provider = queueProvider([
    finish("ReAct 会根据观察动态选择下一步。", [], "direct_answer")
  ]);
  const { result, context } = await runCase({ provider, input: "ReAct 和固定规划有什么区别？" });
  assert.equal(result.status, "completed");
  assert.equal(result.terminationReason, "completed");
  assert.equal(result.answerOrigin, "model");
  assert.equal(context.counters.toolCalls, 0);
  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].state.taskAnchor, null);
});

test("ReAct working state preserves the requested English response locale", async () => {
  const provider = queueProvider([
    finish("I will answer in English.", [], "direct_answer")
  ]);
  const { result } = await runCase({
    provider,
    input: "请用当前界面语言回答",
    locale: "en-US"
  });
  assert.equal(result.answer, "I will answer in English.");
  assert.equal(provider.requests[0].state.locale, "en-US");
});

test("English response locale rejects a Chinese model answer and accepts its English repair", async () => {
  const provider = queueProvider([
    finish("我会继续用中文回答。", [], "direct_answer"),
    finish("I will continue and provide the complete answer in English.", [], "direct_answer")
  ]);
  const { result, events } = await runCase({
    provider,
    input: "请总结当前版本",
    locale: "en-US"
  });
  assert.equal(result.answer, "I will continue and provide the complete answer in English.", JSON.stringify(result));
  assert.equal(provider.requests.length, 2);
  assert.ok(events.some((event) => (
    event.type === "decision_rejected"
    && event.data?.errors?.some((error) => error.includes("en-US response locale"))
  )));
});

test("R1-02 one static tool produces validated evidence and ordered events", async () => {
  const provider = queueProvider([
    call("unit_details", { apiName: "TFT18_Xayah" }, "retrieve_entity_details"),
    finish("霞会向目标发射羽刃。", ["ev-1"])
  ]);
  const { result, events } = await runCase({
    provider,
    handlers: { unit_details: async () => evidence([{ spell: "羽刃" }]) }
  });
  assert.equal(result.status, "completed");
  assert.equal(result.evidence.length, 1);
  assert.deepEqual(
    events.filter((event) => ["decision", "tool_started", "tool_completed", "evidence_added", "answer", "termination"].includes(event.type)).map((event) => event.type),
    ["decision", "tool_started", "tool_completed", "evidence_added", "decision", "answer", "termination"]
  );
  assert.deepEqual(
    provider.requests[1].state.transcript.map((entry) => entry.type),
    ["runtime_state", "decision", "observation", "runtime_state"]
  );
  assert.equal(provider.requests[1].state.transcript[2].value.evidenceId, "ev-1");
  assert.equal(provider.requests[1].state.transcript[2].value.evidence.evidenceId, "ev-1");
});

test("unit detail requests with 属性 do not enter the item-comparison completion guard", async () => {
  const provider = queueProvider([
    call("unit_details", { apiName: "TFT18_Ahri" }, "retrieve_entity_details"),
    finish("阿狸资料已返回。", ["ev-1"])
  ]);
  const { result, events } = await runCase({
    input: "查询阿狸的技能、费用、属性和羁绊资料",
    provider,
    handlers: {
      unit_details: async () => evidence([{ apiName: "TFT18_Ahri", spell: "灵魄炸弹" }])
    }
  });

  assert.equal(result.terminationReason, "completed", JSON.stringify({ result, events }, null, 2));
  assert.equal(events.some((event) => event.data?.code === "incomplete_item_comparison_details"), false);
});

test("explicit TFT and Golden Spatula request binds one video call to both ecosystems", async () => {
  let observedInput = null;
  const provider = queueProvider([
    call("strategy_video_search", { query: "九五阵容攻略" }, "retrieve_supporting_knowledge"),
    finish("已返回两个生态的视频候选。", ["ev-1"])
  ]);
  const { result } = await runCase({
    input: "分别找云顶之弈和金铲铲的九五攻略",
    provider,
    definitions: [definition("strategy_video_search", {
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string" },
          ecosystem: { type: "string", enum: ["tft_pc", "golden_spatula", "both"] }
        }
      }
    })],
    handlers: {
      strategy_video_search: async (input) => {
        observedInput = input;
        return evidence([{ title: "候选视频" }]);
      }
    }
  });
  assert.equal(result.status, "completed");
  assert.equal(observedInput.ecosystem, "both");
});

test("video search falls back deterministically when the decision provider is unavailable", async () => {
  let observedInput = null;
  const provider = async () => { throw new Error("model unavailable"); };
  const { result } = await runCase({
    input: "请分别找云顶之弈和金铲铲的九五攻略视频",
    provider,
    definitions: [definition("strategy_video_search", {
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string" },
          ecosystem: { type: "string", enum: ["tft_pc", "golden_spatula", "both"] }
        }
      }
    })],
    handlers: {
      strategy_video_search: async (input) => {
        observedInput = input;
        return evidence([{ title: "九五攻略" }], { type: "strategy_video_search_results" });
      }
    }
  });
  assert.equal(observedInput.ecosystem, "both");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.terminationReason, "decision_provider_failed");
  assert.ok(result.warnings.includes("decision_provider_video_fallback"));
});

test("historical video messages never hijack a short current-turn follow-up", async () => {
  let videoCalls = 0;
  const provider = async () => { throw new Error("model unavailable"); };
  const { result } = await runCase({
    input: "上升的",
    messages: [
      { role: "user", content: "有视频攻略吗？" },
      { role: "assistant", content: "找到了视频攻略。" }
    ],
    provider,
    definitions: [definition("strategy_video_search", {
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: { query: { type: "string" } }
      }
    })],
    handlers: {
      strategy_video_search: async () => {
        videoCalls += 1;
        return evidence([], { type: "strategy_video_search_results" });
      }
    }
  });
  assert.equal(videoCalls, 0);
  assert.equal(result.terminationReason, "decision_provider_failed");
  assert.ok(!result.warnings.includes("decision_provider_video_fallback"));
});

test("R1-03 statistical answers require evidence with updatedAt", async () => {
  const valid = await runCase({
    provider: queueProvider([
      call("unit_builds", { unit: "TFT18_Xayah" }),
      finish("这套出装前四率为0.6。", ["ev-1"])
    ]),
    handlers: { unit_builds: async () => evidence([{ top4Rate: 0.6 }]) }
  });
  assert.equal(valid.result.terminationReason, "completed");

  const invalid = await runCase({
    provider: queueProvider([
      call("unit_builds", { unit: "TFT18_Xayah" }),
      finish("这套出装前四率为0.6。", ["ev-1"])
    ]),
    handlers: { unit_builds: async () => ({ results: [{ top4Rate: 0.6 }] }) }
  });
  assert.equal(invalid.result.terminationReason, "missing_required_evidence");
});

test("rounded rates and placements remain grounded in cited numeric evidence", async () => {
  const grounded = await runCase({
    provider: queueProvider([
      call("unit_builds", { unit: "TFT17_Xayah" }),
      finish("稳定方案平均名次3.00、前四率74.6%、登顶率38.3%。", ["ev-1"])
    ]),
    handlers: {
      unit_builds: async () => evidence([{
        metrics: {
          averagePlacement: 2.997313723514993,
          top4Rate: 0.7455760384137537,
          winRate: 0.38279439911352875
        }
      }])
    }
  });
  assert.equal(grounded.result.terminationReason, "completed");

  const fabricated = await runCase({
    provider: queueProvider([
      call("unit_builds", { unit: "TFT17_Xayah" }),
      finish("稳定方案前四率80.0%。", ["ev-1"])
    ]),
    handlers: {
      unit_builds: async () => evidence([{ metrics: { top4Rate: 0.7455760384137537 } }])
    }
  });
  assert.equal(fabricated.result.terminationReason, "missing_required_evidence");
});

test("UI-07C grounded build narrative is fail-soft when it exceeds deterministic evidence", async () => {
  const buildValue = evidence([{
    apiName: "TFT17_Karma",
    buildOptions: [
      { optionId: "karma-1", rank: 1, role: "stable", metrics: { samples: 750 } },
      { optionId: "karma-2", rank: 2, role: "alternative", metrics: { samples: 600 } },
      { optionId: "karma-3", rank: 3, role: "alternative", metrics: { samples: 500 } }
    ]
  }]);
  const provider = queueProvider([
    call("unit_builds", { unit: "TFT17_Karma" }),
    action("finish", {
      answer: "已返回 3 套确定性方案。",
      evidenceIds: ["ev-1"],
      reasonCode: "sufficient_evidence",
      narrative: {
        schemaVersion: "grounded-build-narrative.v1",
        summary: { text: "模型声称不存在的 99% 胜率。", evidenceIds: ["ev-1"] },
        options: [{
          optionId: "invented-option",
          explanation: "这是统计第一。",
          tradeoffs: [],
          risks: [],
          suitableWhen: [],
          evidenceIds: ["missing-evidence"]
        }]
      }
    })
  ]);
  const { result } = await runCase({
    provider,
    handlers: { unit_builds: async () => buildValue }
  });

  assert.equal(result.status, "completed_with_warning");
  assert.equal(result.narrative, null);
  assert.match(result.answer, /证据范围|确定性结果/u);
  assert.doesNotMatch(result.answer, /99%/u);
  assert.ok(result.warnings.includes("grounded_build_narrative_rejected"));
  assert.ok(result.narrativeWarnings.some((warning) => warning.includes("99%")));
  assert.equal(result.evidence[0].value.results[0].buildOptions.length, 3);
});

test("UI-07C observe mode preserves qualitative text and records grounding violations", async () => {
  const buildValue = evidence([{
    apiName: "TFT17_Karma",
    buildOptions: [
      { optionId: "karma-1", rank: 1, role: "stable", metrics: { samples: 750 } },
      { optionId: "karma-2", rank: 2, role: "alternative", metrics: { samples: 600 } },
      { optionId: "karma-3", rank: 3, role: "alternative", metrics: { samples: 500 } }
    ]
  }]);
  const provider = queueProvider([
    call("unit_builds", { unit: "TFT17_Karma" }),
    action("finish", {
      answer: "模型自由判断：这是阵容的绝对核心。",
      evidenceIds: ["ev-1"],
      reasonCode: "sufficient_evidence",
      narrative: {
        schemaVersion: "grounded-build-narrative.v1",
        summary: { text: "模型声称它是绝对核心。", evidenceIds: ["ev-1"] },
        options: [{
          optionId: "invented-option",
          explanation: "这是统计第一。",
          tradeoffs: [],
          risks: [],
          suitableWhen: [],
          evidenceIds: ["missing-evidence"]
        }]
      }
    })
  ]);
  const { result } = await runCase({
    provider,
    handlers: { unit_builds: async () => buildValue },
    groundingMode: "observe"
  });

  assert.equal(result.status, "completed_with_warning");
  assert.match(result.answer, /绝对核心/u);
  assert.equal(result.groundingAudit.mode, "observe");
  assert.equal(result.groundingAudit.narrativeAccepted, false);
  assert.equal(result.groundingAudit.qualitativeOutputPreserved, true);
  assert.ok(result.groundingAudit.violationCount > 0);
  assert.ok(result.warnings.includes("grounded_build_narrative_observed"));
});

test("UI-07D item mechanism batch is constrained to the deterministic difference plan", async () => {
  const buildValue = evidence([{
    buildOptions: [
      { optionId: "stable", rank: 1, items: [{ apiName: "JG" }] },
      { optionId: "alt", rank: 2, items: [{ apiName: "Morello" }] }
    ],
    mechanismQueryPlan: {
      apiNames: ["JG", "Morello"],
      comparisons: [{
        optionId: "alt",
        selectedPairs: [{ removedApiName: "JG", addedApiName: "Morello" }]
      }]
    }
  }]);
  const definitions = [
    definition("unit_builds_batch"),
    definition("item_details_batch", { evidenceType: "official_item_batch" })
  ];
  let batchCalls = 0;
  const valid = await runCase({
    definitions,
    provider: queueProvider([
      call("unit_builds_batch"),
      call("item_details_batch", {
        apiNames: ["JG", "Morello"],
        seasonContextId: "set17-live"
      }, "retrieve_entity_details"),
      action("finish", {
        answer: "已基于当前赛季装备证据解释差异。",
        evidenceIds: ["ev-1", "ev-2"],
        reasonCode: "sufficient_evidence",
        narrative: {
          schemaVersion: "grounded-build-narrative.v1",
          summary: { text: "稳定方案与备选的差异已有证据。", evidenceIds: ["ev-1"] },
          options: [
            {
              optionId: "stable",
              statisticalBasis: { text: "稳定方案由确定性排序给出。", evidenceIds: ["ev-1"] },
              mechanismDifference: null,
              suitableWhen: [],
              tradeoffs: [],
              risks: []
            },
            {
              optionId: "alt",
              statisticalBasis: { text: "这是确定性备选方案。", evidenceIds: ["ev-1"] },
              mechanismDifference: {
                text: "法爆提供技能暴击，鬼书提供重伤。",
                comparedItemApiNames: ["JG", "Morello"],
                evidenceRefs: [
                  { evidenceId: "ev-2", claimId: "official-item:JG" },
                  { evidenceId: "ev-2", claimId: "official-item:Morello" }
                ]
              },
              suitableWhen: [{
                text: "当需要限制回复时可以考虑。",
                inferenceType: "mechanism_based_advice",
                evidenceRefs: [{ evidenceId: "ev-2", claimId: "official-item:Morello" }]
              }],
              tradeoffs: [],
              risks: []
            }
          ]
        }
      })
    ]),
    handlers: {
      unit_builds_batch: async () => buildValue,
      item_details_batch: async () => {
        batchCalls += 1;
        return {
          updatedAt: "2026-08-06T00:00:00.000Z",
          mechanismStatus: "available",
          items: [
            { apiName: "JG", claimId: "official-item:JG", status: "found", facts: { effect: "技能可暴击" } },
            { apiName: "Morello", claimId: "official-item:Morello", status: "found", facts: { effect: "施加重伤" } }
          ]
        };
      }
    }
  });
  assert.equal(valid.result.status, "completed", JSON.stringify(valid.result));
  assert.equal(batchCalls, 1);
  assert.equal(valid.result.narrative.options[1].mechanismDifference.comparedItemApiNames[1], "Morello");

  const invalid = await runCase({
    definitions,
    provider: queueProvider([
      call("unit_builds_batch"),
      call("item_details_batch", {
        apiNames: ["JG", "InventedItem"],
        seasonContextId: "set17-live"
      }, "retrieve_entity_details"),
      finish("保留确定性出装结果。", ["ev-1"])
    ]),
    handlers: {
      unit_builds_batch: async () => buildValue,
      item_details_batch: async () => { throw new Error("must not execute"); }
    }
  });
  assert.equal(invalid.result.status, "completed");
  assert.ok(invalid.events.some((event) => (
    event.type === "decision_rejected"
    && event.data.code === "invalid_differentiating_item_selection"
  )));
});

test("unit-play item mechanism batch must exactly copy the server plan", async () => {
  const buildValue = {
    type: "unit_build_rankings",
    unit: { apiName: "DA_18_Warwick" },
    mechanismQueryPlan: {
      schemaVersion: "unit-play-item-mechanism-query-plan.v1",
      status: "available",
      apiNames: ["Shojin", "Sterak", "Titans"],
      seasonContextId: "set18-live",
      sourceCardIndex: 0
    },
    cards: [{ items: [{ apiName: "Shojin" }, { apiName: "Sterak" }, { apiName: "Titans" }] }],
    updatedAt: "2026-08-30T00:00:00.000Z"
  };
  const definitions = [definition("unit_builds"), definition("item_details_batch", { evidenceType: "official_item_batch" })];
  let batchCalls = 0;
  const valid = await runCase({
    input: "沃里克怎么玩？",
    seasonContextId: "set18-live",
    semanticAdvisory: { action: "recommend", goal: "recommend_unit_play",
      subject: { resolvedId: "DA_18_Warwick" }, expectedOutput: ["unit_play_guidance"] },
    definitions,
    provider: queueProvider([
      call("unit_builds", { unit: "DA_18_Warwick" }),
      call("item_details_batch", { apiNames: ["Shojin", "Sterak", "Titans"], seasonContextId: "set18-live" }, "retrieve_entity_details"),
      finish("三件来源装备机制已取得。", ["ev-1", "ev-2"])
    ]),
    handlers: {
      unit_builds: async () => buildValue,
      item_details_batch: async () => { batchCalls += 1; return { type: "item_details_batch",
        updatedAt: "2026-08-30T00:00:00.000Z", items: [{ apiName: "Shojin", status: "found" }] }; }
    }
  });
  assert.equal(valid.result.status, "completed", JSON.stringify(valid.result));
  assert.equal(batchCalls, 1);

  for (const argumentsValue of [
    { apiNames: ["Shojin", "Titans", "Sterak"], seasonContextId: "set18-live" },
    { apiNames: ["Shojin", "Sterak"], seasonContextId: "set18-live" },
    { apiNames: ["Shojin", "Sterak", "Titans"], seasonContextId: "set17-live" }
  ]) {
    const invalid = await runCase({
      input: "沃里克怎么玩？", seasonContextId: "set18-live",
      semanticAdvisory: { action: "recommend", goal: "recommend_unit_play",
        subject: { resolvedId: "DA_18_Warwick" }, expectedOutput: ["unit_play_guidance"] },
      definitions,
      provider: queueProvider([
        call("unit_builds", { unit: "DA_18_Warwick" }),
        call("item_details_batch", argumentsValue, "retrieve_entity_details"),
        finish("只保留来源装备统计。", ["ev-1"])
      ]),
      handlers: { unit_builds: async () => buildValue,
        item_details_batch: async () => assert.fail("invalid batch plan must not execute") }
    });
    assert.ok(invalid.events.some((event) => event.type === "decision_rejected"
      && event.data?.code === "invalid_differentiating_item_selection"), JSON.stringify(argumentsValue));
  }
});

test("R1-04 later decisions observe earlier tools in a multi-tool loop", async () => {
  const provider = queueProvider([
    call("comps_trends", { patch: "current" }),
    call("semantic_search", { patch: "current" }, "retrieve_supporting_knowledge"),
    finish("A阵容趋势上升，变化值为0.2。", ["ev-1", "ev-2"])
  ]);
  const { result } = await runCase({
    provider,
    handlers: {
      comps_trends: async () => evidence([{ comp: "A", change: 0.2 }]),
      semantic_search: async () => evidence([{ note: "版本加强" }])
    }
  });
  assert.equal(provider.requests[1].state.observations.length, 1);
  assert.equal(result.evidence.length, 2);
});

test("R1-05 missing context asks the user and ends the current run", async () => {
  const provider = queueProvider([action("ask_user", {
    question: "你指的是哪套阵容？",
    missingFields: ["composition"],
    reasonCode: "missing_context"
  })]);
  const { result, context } = await runCase({ provider });
  assert.equal(result.status, "clarification_required");
  assert.equal(result.terminationReason, "ask_user");
  assert.deepEqual(result.missingFields, ["composition"]);
  assert.equal(context.counters.toolCalls, 0);
});

test("R1-06 unknown tools are rejected before any handler executes", async () => {
  const provider = queueProvider([
    call("shell", { command: "whoami" }),
    call("shell", { command: "whoami" }),
    call("shell", { command: "whoami" })
  ]);
  const { result, events, context } = await runCase({ provider });
  assert.equal(result.terminationReason, "no_progress");
  assert.equal(context.counters.toolCalls, 0);
  assert.equal(events.filter((event) => event.type === "decision_rejected").length, 3);
});

test("R1-07 canonical duplicate calls ignore object key order", async () => {
  let calls = 0;
  const provider = queueProvider([
    call("comps_rankings", { patch: "current", filter: { tier: "S", region: "all" } }),
    call("comps_rankings", { filter: { region: "all", tier: "S" }, patch: "current" })
  ]);
  const { result } = await runCase({
    provider,
    handlers: {
      comps_rankings: async () => {
        calls += 1;
        return evidence([{ comp: "A" }]);
      }
    }
  });
  assert.equal(result.terminationReason, "duplicate_call");
  assert.equal(calls, 1);
});

test("ordered arrays remain distinct calls by default", async () => {
  let calls = 0;
  const provider = queueProvider([
    call("comps_rankings", { values: ["a", "b"] }),
    call("comps_rankings", { values: ["b", "a"] }),
    finish("涓ゆ鎺掑簭鏌ヨ宸插畬鎴愩€?", ["ev-1", "ev-2"])
  ]);
  const { result } = await runCase({
    provider,
    handlers: {
      comps_rankings: async (input) => {
        calls += 1;
        return evidence([{ values: input.values }]);
      }
    }
  });
  assert.equal(result.terminationReason, "completed");
  assert.equal(calls, 2);
});

test("model catalog and action validation expose only tools with handlers", async () => {
  const provider = queueProvider([
    call("semantic_search", { patch: "current" }),
    finish("Tool unavailable; insufficient evidence.", [], "insufficient_evidence")
  ]);
  const { result, context, events } = await runCase({
    provider,
    handlers: {
      unit_details: async () => evidence([{ apiName: "TFT18_Xayah" }])
    }
  });
  assert.deepEqual(provider.requests[0].toolCatalog.map((tool) => tool.name), ["unit_details"]);
  assert.equal(context.counters.toolCalls, 0);
  assert.equal(result.terminationReason, "insufficient_evidence");
});

test("R1-08 unsupported current statistics cannot pass as a direct answer", async () => {
  const { result, events } = await runCase({
    provider: queueProvider([
      finish("A阵容胜率最高，前四率为60%。", [], "direct_answer")
    ])
  });
  assert.equal(result.terminationReason, "missing_required_evidence");
  assert.equal(result.answer, null);
  assert.ok(events.some((event) => event.type === "decision_rejected"));
});

test("semantic evidence alone cannot support current best-ranking claims", async () => {
  const { result } = await runCase({
    provider: queueProvider([
      call("semantic_search", { patch: "current" }, "retrieve_supporting_knowledge"),
      finish("当前胜率最高的是这套方案。", ["ev-1"])
    ]),
    handlers: {
      semantic_search: async () => evidence([{ claimType: "creator_advice", claim: "作者推荐这套方案" }])
    }
  });
  assert.equal(result.terminationReason, "missing_required_evidence");
});

test("summary requests publish cited model output with validation warnings", async () => {
  const { result } = await runCase({
    input: "总结17.9更新",
    provider: queueProvider([
      call("semantic_search", { query: "17.9更新", documentTypes: ["patch_note"] }, "retrieve_supporting_knowledge"),
      finish("技能最高伤害提高至 999。", ["ev-1"])
    ]),
    handlers: {
      semantic_search: async () => evidence([{ claim: "技能伤害获得调整" }])
    }
  });
  assert.equal(result.status, "completed_with_warning");
  assert.equal(result.terminationReason, "completed");
  assert.equal(result.answer, "技能最高伤害提高至 999。");
  assert.equal(result.answerOrigin, "model_soft_validated_summary");
  assert.equal(result.modelConclusion.status, "accepted_with_validation_warnings");
  assert.ok(result.warnings.includes("summary_validation_softened"));
});

test("non-summary requests still reject the same unsupported model claim", async () => {
  const { result } = await runCase({
    input: "当前哪个阵容最好",
    provider: queueProvider([
      call("semantic_search", { query: "阵容", documentTypes: ["mechanism_knowledge"] }, "retrieve_supporting_knowledge"),
      finish("当前最高胜率是 99%。", ["ev-1"])
    ]),
    handlers: {
      semantic_search: async () => evidence([{ claim: "作者推荐这套阵容" }])
    }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.terminationReason, "missing_required_evidence");
  assert.equal(result.answer, null);
});

test("semantic search retries must change scope and stop after two calls", async () => {
  let calls = 0;
  const unchanged = await runCase({
    provider: queueProvider([
      call("semantic_search", { query: "机制", documentTypes: ["mechanism_knowledge"] }),
      call("semantic_search", { query: "机制说明", documentTypes: ["mechanism_knowledge"] })
    ]),
    handlers: {
      semantic_search: async () => {
        calls += 1;
        return evidence([{ claim: "规则" }]);
      }
    }
  });
  assert.equal(unchanged.result.terminationReason, "semantic_search_scope_unchanged");
  assert.equal(calls, 1);

  calls = 0;
  const limited = await runCase({
    provider: queueProvider([
      call("semantic_search", { query: "机制", documentTypes: ["mechanism_knowledge"] }),
      call("semantic_search", { query: "视频", documentTypes: ["video_guide"] }),
      call("semantic_search", { query: "公告", documentTypes: ["patch_note"] })
    ]),
    handlers: {
      semantic_search: async () => {
        calls += 1;
        return evidence([{ claim: "规则" }]);
      }
    }
  });
  assert.equal(limited.result.terminationReason, "semantic_search_call_limit");
  assert.equal(calls, 2);
});

test("ambiguous exact alias resolution leads to ask_user without a details call", async () => {
  let detailCalls = 0;
  const catalogDefinition = definition("entity_catalog_query", {
    evidenceType: "official_entity_catalog",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entityType", "filters"],
      properties: {
        entityType: { type: "string" },
        filters: {
          type: "object",
          additionalProperties: false,
          required: ["names"],
          properties: { names: { type: "array", items: { type: "string" } } }
        }
      }
    }
  });
  const provider = queueProvider([
    call("entity_catalog_query", {
      entityType: "unit",
      filters: { names: ["卡尔玛"] }
    }, "retrieve_entity_details"),
    action("ask_user", {
      question: "你指的是哪一个卡尔玛？",
      missingFields: ["unit"],
      reasonCode: "ambiguous_entity"
    })
  ]);
  const { result } = await runCase({
    provider,
    definitions: [catalogDefinition, definition("unit_details")],
    handlers: {
      entity_catalog_query: async () => ({
        source: "test_source",
        updatedAt: "2026-08-06T00:00:00.000Z",
        resolution: {
          mode: "exact_alias",
          requests: [{
            inputName: "卡尔玛",
            normalizedName: "卡尔玛",
            status: "ambiguous",
            candidates: [
              { apiName: "TFT18_Karma", name: "卡尔玛", matchedAlias: "卡尔玛" },
              { apiName: "TFT18_KarmaSpecial", name: "特殊卡尔玛", matchedAlias: "卡尔玛" }
            ]
          }]
        },
        results: []
      }),
      unit_details: async () => {
        detailCalls += 1;
        return evidence([]);
      }
    }
  });
  assert.equal(result.terminationReason, "ask_user");
  assert.equal(detailCalls, 0);
});

test("a curated fuzzy unit candidate forces canonical confirmation even when the model tries to skip it", async () => {
  let buildCalls = 0;
  const catalogDefinition = definition("entity_catalog_query", {
    evidenceType: "official_entity_catalog",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["entityType", "filters"],
      properties: {
        entityType: { type: "string" },
        filters: { type: "object", additionalProperties: false, required: ["names"],
          properties: { names: { type: "array", items: { type: "string" } } }
        }
      }
    }
  });
  const provider = queueProvider([
    call("entity_catalog_query", { entityType: "unit", filters: { names: ["月男"] } }, "retrieve_entity_details"),
    call("unit_builds", { unit: "DA_18_Aphelios", itemPolicy: "include_artifact", itemCategories: ["artifact"] })
  ]);
  const { result } = await runCase({
    input: "查询月男的神器",
    provider,
    definitions: [catalogDefinition, definition("unit_builds")],
    handlers: {
      entity_catalog_query: async () => ({
        type: "entity_catalog_results", entityType: "unit", updatedAt: "2026-08-30T00:00:00.000Z",
        resolution: { mode: "exact_alias", requests: [{ inputName: "月男", normalizedName: "月男", status: "ambiguous", candidates: [{
          apiName: "DA_18_Aphelios", name: "厄斐琉斯", matchedAlias: "月男", matchType: "curated_fuzzy_alias"
        }] }] },
        results: [{ apiName: "DA_18_Aphelios", name: "厄斐琉斯" }]
      }),
      unit_builds: async () => { buildCalls += 1; return evidence([]); }
    }
  });
  assert.equal(result.status, "clarification_required");
  assert.equal(result.question, "“月男”可能指“厄斐琉斯”，请确认是否是这个英雄。");
  assert.deepEqual(result.missingFields, ["unit"]);
  assert.equal(buildCalls, 0);
});

test("affirming a fuzzy unit candidate re-resolves its canonical name and preserves the original artifact scope", async () => {
  const calls = [];
  const catalogDefinition = definition("entity_catalog_query", {
    evidenceType: "official_entity_catalog",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["entityType", "filters"],
      properties: {
        entityType: { type: "string" },
        filters: { type: "object", additionalProperties: false, required: ["names"],
          properties: { names: { type: "array", items: { type: "string" } } }
        }
      }
    }
  });
  const unitBuildDefinition = definition("unit_builds", {
    inputSchema: {
      type: "object", additionalProperties: false, required: ["unit"],
      properties: {
        unit: { type: "string" },
        itemPolicy: { type: "string" },
        itemCategories: { type: "array", items: { type: "string" } }
      }
    }
  });
  const provider = queueProvider([
    action("ask_user", { question: "你要查哪件神器？", missingFields: ["item"], reasonCode: "missing_context" }),
    call("unit_builds", { unit: "DA_18_Aphelios", itemPolicy: "ordinary_only", itemCategories: ["ordinary_completed"] }),
    finish("厄斐琉斯神器排行已返回。", ["ev-2"])
  ]);
  const { result } = await runCase({
    input: "是的",
    provider,
    bridgeContext: {
      relation: "reply_to_clarification",
      view: {
        pendingClarification: {
          reason: "ask_user",
          question: "“月男”可能指“厄斐琉斯”，请确认是否是这个英雄。",
          confirmationContext: {
            type: "entity_candidate",
            entityType: "unit",
            inputName: "月男",
            originalInput: "查询月男的神器",
            equipmentCategoryScope: { itemPolicy: "include_artifact", itemCategories: ["artifact"] },
            candidates: [{ apiName: "DA_18_Aphelios", name: "厄斐琉斯" }]
          }
        },
        records: []
      },
      promotedEvidence: []
    },
    definitions: [catalogDefinition, unitBuildDefinition],
    handlers: {
      entity_catalog_query: async (input) => {
        calls.push({ tool: "entity_catalog_query", input });
        return {
          type: "entity_catalog_results", entityType: "unit", updatedAt: "2026-08-30T00:00:00.000Z",
          resolution: { mode: "exact_alias", requests: [{ inputName: "厄斐琉斯", normalizedName: "厄斐琉斯", status: "resolved", candidates: [{
            apiName: "DA_18_Aphelios", name: "厄斐琉斯", matchedAlias: "厄斐琉斯", matchType: "exact_alias"
          }] }] },
          results: [{ apiName: "DA_18_Aphelios", name: "厄斐琉斯" }]
        };
      },
      unit_builds: async (input) => {
        calls.push({ tool: "unit_builds", input });
        return {
          type: "unit_item_rankings",
          updatedAt: "2026-08-30T00:00:00.000Z",
          unit: { apiName: "DA_18_Aphelios", name: "厄斐琉斯" },
          query: { unitName: "厄斐琉斯", itemPolicy: input.itemPolicy, itemCategories: input.itemCategories },
          itemRankings: [{ apiName: "TFT_Item_Artifact", name: "神器", category: "artifact", games: 100 }]
        };
      }
    }
  });

  assert.equal(result.status, "completed", JSON.stringify({ result, calls }, null, 2));
  assert.deepEqual(calls[0], {
    tool: "entity_catalog_query",
    input: { entityType: "unit", filters: { names: ["厄斐琉斯"] } }
  });
  assert.equal(calls[1].tool, "unit_builds");
  assert.equal(calls[1].input.unit, "DA_18_Aphelios");
  assert.equal(calls[1].input.itemPolicy, "include_artifact");
  assert.deepEqual(calls[1].input.itemCategories, ["artifact"]);
});

test("unit_builds rejects guessed entity ids and accepts exact catalog resolutions", async () => {
  let buildCalls = 0;
  const catalogDefinition = definition("entity_catalog_query", {
    evidenceType: "official_entity_catalog",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entityType", "filters"],
      properties: {
        entityType: { type: "string" },
        filters: {
          type: "object",
          additionalProperties: false,
          required: ["names"],
          properties: { names: { type: "array", items: { type: "string" } } }
        }
      }
    }
  });
  const unitBuildDefinition = definition("unit_builds", {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["unit"],
      properties: {
        unit: { type: "string" },
        comparisonItems: { type: "array", items: { type: "string" } }
      }
    }
  });
  const provider = queueProvider([
    call("unit_builds", { unit: "TFT18_Xayah", comparisonItems: ["TFT_Item_A", "TFT_Item_B"] }),
    call("entity_catalog_query", { entityType: "unit", filters: { names: ["霞"] } }, "retrieve_entity_details"),
    call("entity_catalog_query", { entityType: "item", filters: { names: ["羊刀", "无尽"] } }, "retrieve_entity_details"),
    call("unit_builds", { unit: "TFT18_Xayah", comparisonItems: ["TFT_Item_A", "TFT_Item_B"] }),
    finish("两件装备的确定性对比已完成。", ["ev-3"])
  ]);
  const { result, events } = await runCase({
    input: "霞带羊刀还是无尽装备？",
    provider,
    definitions: [catalogDefinition, unitBuildDefinition],
    handlers: {
      entity_catalog_query: async (input) => ({
        type: "entity_catalog_results",
        entityType: input.entityType,
        updatedAt: "2026-08-06T00:00:00.000Z",
        resolution: {
          requests: input.entityType === "unit"
            ? [{ status: "resolved", candidates: [{ apiName: "TFT18_Xayah" }] }]
            : [
              { status: "resolved", candidates: [{ apiName: "TFT_Item_A" }] },
              { status: "resolved", candidates: [{ apiName: "TFT_Item_B" }] }
            ]
        },
        results: input.entityType === "unit"
          ? [{ apiName: "TFT18_Xayah" }]
          : [{ apiName: "TFT_Item_A" }, { apiName: "TFT_Item_B" }]
      }),
      unit_builds: async () => {
        buildCalls += 1;
        return {
          type: "unit_item_comparison",
          updatedAt: "2026-08-06T00:00:00.000Z",
          comparison: { entries: [{ apiName: "TFT_Item_A" }, { apiName: "TFT_Item_B" }] }
        };
      }
    }
  });
  assert.equal(result.terminationReason, "completed", JSON.stringify({ result, events }, null, 2));
  assert.equal(buildCalls, 1);
  assert.ok(events.some((event) => event.type === "decision_rejected" && event.data?.code === "ungrounded_unit_build_query"));
});

test("artifact ranking follow-up rejects assistant-only performanceItem and binds mixed scope", async () => {
  let observedBuildInput = null;
  let buildCalls = 0;
  const catalogDefinition = definition("entity_catalog_query", {
    evidenceType: "official_entity_catalog",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entityType", "filters"],
      properties: {
        entityType: { type: "string" },
        filters: {
          type: "object",
          additionalProperties: false,
          required: ["names"],
          properties: { names: { type: "array", items: { type: "string" } } }
        }
      }
    }
  });
  const unitBuildDefinition = definition("unit_builds", {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["unit"],
      properties: {
        unit: { type: "string" },
        performanceItem: { type: "string" },
        itemPolicy: { type: "string" },
        itemCategories: { type: "array", items: { type: "string" } }
      }
    }
  });
  const provider = queueProvider([
    call("entity_catalog_query", {
      entityType: "unit",
      filters: { names: ["厄斐琉斯"] }
    }, "retrieve_entity_details"),
    call("entity_catalog_query", {
      entityType: "item",
      filters: { names: ["羊刀"] }
    }, "retrieve_entity_details"),
    call("unit_builds", {
      unit: "DA_18_Aphelios",
      performanceItem: "DA_GuinsoosRageblade",
      itemPolicy: "ordinary_only",
      itemCategories: ["ordinary_completed"]
    }),
    call("unit_builds", {
      unit: "DA_18_Aphelios",
      itemPolicy: "ordinary_only",
      itemCategories: ["ordinary_completed"]
    }),
    finish("含神器的单装备排行榜已返回。", ["ev-3"])
  ]);
  const { result, events } = await runCase({
    input: "加入神器，返回一个排行榜",
    messages: [
      { role: "user", content: "厄斐琉斯" },
      { role: "assistant", content: "主流出装是羊刀+无尽+海妖之怒。" },
      { role: "user", content: "我想查的是单装备数据" },
      { role: "assistant", content: "羊刀位列同类第一。" }
    ],
    provider,
    definitions: [catalogDefinition, unitBuildDefinition],
    handlers: {
      entity_catalog_query: async (input) => {
        const item = input.entityType === "item";
        return {
          type: "entity_catalog_results",
          entityType: input.entityType,
          updatedAt: "2026-08-30T00:00:00.000Z",
          resolution: {
            requests: [{
              inputName: input.filters.names[0],
              normalizedName: input.filters.names[0],
              status: "resolved",
              candidates: [{
                apiName: item ? "DA_GuinsoosRageblade" : "DA_18_Aphelios",
                name: input.filters.names[0],
                matchedAlias: input.filters.names[0]
              }]
            }]
          },
          results: [{ apiName: item ? "DA_GuinsoosRageblade" : "DA_18_Aphelios" }]
        };
      },
      unit_builds: async (input) => {
        buildCalls += 1;
        observedBuildInput = structuredClone(input);
        return {
          type: "unit_item_rankings",
          updatedAt: "2026-08-30T00:00:00.000Z",
          query: {
            itemPolicy: input.itemPolicy,
            itemCategories: input.itemCategories
          },
          itemRankings: [{ apiName: "DA_Item_Artifact", category: "artifact" }]
        };
      }
    }
  });

  assert.equal(result.terminationReason, "completed", JSON.stringify({ result, events }, null, 2));
  assert.equal(buildCalls, 1);
  assert.equal(observedBuildInput.performanceItem, undefined);
  assert.equal(observedBuildInput.itemPolicy, "include_artifact");
  assert.deepEqual(observedBuildInput.itemCategories, ["ordinary_completed", "artifact"]);
  assert.ok(events.some((event) => (
    event.type === "decision_rejected"
    && event.data?.code === "ungrounded_unit_build_query"
    && event.data?.errors?.some((error) => /historical assistant messages cannot authorize/u.test(error))
  )));
});

test("unnamed single-item data request binds the ordinary item ranking instead of complete builds", async () => {
  let observedBuildInput = null;
  const catalogDefinition = definition("entity_catalog_query", {
    evidenceType: "official_entity_catalog",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entityType", "filters"],
      properties: {
        entityType: { type: "string" },
        filters: {
          type: "object",
          additionalProperties: false,
          required: ["names"],
          properties: { names: { type: "array", items: { type: "string" } } }
        }
      }
    }
  });
  const unitBuildDefinition = definition("unit_builds", {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["unit"],
      properties: {
        unit: { type: "string" },
        itemPolicy: { type: "string" },
        itemCategories: { type: "array", items: { type: "string" } }
      }
    }
  });
  const provider = queueProvider([
    action("ask_user", {
      question: "您想查询厄斐琉斯的哪件单装备数据？请提供具体装备名称。",
      missingFields: ["item"],
      reasonCode: "missing_context"
    }),
    call("entity_catalog_query", {
      entityType: "unit",
      filters: { names: ["厄斐琉斯"] }
    }, "retrieve_entity_details"),
    call("unit_builds", { unit: "DA_18_Aphelios" }),
    finish("厄斐琉斯单装备排行榜已返回。", ["ev-2"])
  ]);
  const { result, events } = await runCase({
    input: "我想查的是单装备数据",
    messages: [
      { role: "user", content: "厄斐琉斯" },
      { role: "assistant", content: "主流出装是羊刀+无尽+海妖之怒。" }
    ],
    provider,
    definitions: [catalogDefinition, unitBuildDefinition],
    handlers: {
      entity_catalog_query: async () => ({
        type: "entity_catalog_results",
        entityType: "unit",
        updatedAt: "2026-08-30T00:00:00.000Z",
        resolution: {
          requests: [{
            inputName: "厄斐琉斯",
            normalizedName: "厄斐琉斯",
            status: "resolved",
            candidates: [{
              apiName: "DA_18_Aphelios",
              name: "厄斐琉斯",
              matchedAlias: "厄斐琉斯"
            }]
          }]
        },
        results: [{ apiName: "DA_18_Aphelios" }]
      }),
      unit_builds: async (input) => {
        observedBuildInput = structuredClone(input);
        return {
          type: "unit_item_rankings",
          updatedAt: "2026-08-30T00:00:00.000Z",
          query: {
            itemPolicy: input.itemPolicy,
            itemCategories: input.itemCategories
          },
          itemRankings: [{ apiName: "DA_Item_Ordinary", category: "ordinary_completed" }]
        };
      }
    }
  });

  assert.equal(result.terminationReason, "completed");
  assert.equal(observedBuildInput.itemPolicy, "ordinary_only");
  assert.deepEqual(observedBuildInput.itemCategories, ["ordinary_completed"]);
  assert.equal(observedBuildInput.performanceItem, undefined);
  assert.ok(events.some((event) => (
    event.type === "decision_rejected"
    && event.data?.code === "unnecessary_equipment_item_clarification"
  )));
});

test("equipment category vocabulary separates exclusive, additive and negated scopes", () => {
  for (const input of ["不含特殊装备", "不要特殊装备", "排除所有特殊装备", "修改为只包含普通装备", "without special items"]) {
    assert.deepEqual(requestedEquipmentCategoryScope(input), {
      itemPolicy: "ordinary_only", itemCategories: ["ordinary_completed"]
    }, input);
  }
  for (const input of ["查询厄飞流斯的神器", "我要查的是奥恩神器", "只查询神器", "只包含奥恩神器", "Aphelios artifacts"]) {
    assert.deepEqual(requestedEquipmentCategoryScope(input), {
      itemPolicy: "include_artifact", itemCategories: ["artifact"]
    }, input);
  }
  for (const input of ["加入神器", "加上奥恩神器", "神器也一起加入", "普通装备和神器一起排行"]) {
    assert.deepEqual(requestedEquipmentCategoryScope(input), {
      itemPolicy: "include_artifact", itemCategories: ["ordinary_completed", "artifact"]
    }, input);
  }
  assert.deepEqual(requestedEquipmentCategoryScope("不要神器，只查普通装备"), {
    itemPolicy: "ordinary_only", itemCategories: ["ordinary_completed"]
  });
  assert.equal(requestedEquipmentCategoryScope("不要神器"), null);
  for (const input of ["奥恩", "奥恩装备", "奥恩装", "查询奥恩的装备", "Ornn items"]) {
    assert.equal(requestedEquipmentCategoryScope(input), null, input);
  }
  assert.deepEqual(requestedEquipmentCategoryScope("不是普通装备，是奥恩神器"), {
    itemPolicy: "include_artifact", itemCategories: ["artifact"]
  });
  assert.deepEqual(requestedEquipmentCategoryScope("光明装备排行榜"), {
    itemPolicy: "include_radiant", itemCategories: ["radiant"]
  });
});

test("ordinary-only corrections override stale special scope without changing complete-build conditions", async (t) => {
  for (const input of ["不含特殊装备", "修改为只包含普通装备", "修改为只包含普通装备，改为近7天", "改为近7天"]) {
    await t.test(input, async () => {
      let observed;
      const initial = { unit: "DA_18_Aphelios", itemPolicy: "include_special", itemCategories: ["artifact"],
        itemCount: 3, starLevel: [2], days: 3, minSamples: 100 };
      if (input.includes("7天")) initial.days = 7;
      const { result, events } = await runCase({
        input, messages: [
          { role: "user", content: "厄斐琉斯三件套出装，包含特殊装备" },
          ...(input === "改为近7天" ? [
            { role: "user", content: "第三件只要普通装备" },
            { role: "assistant", content: "包含特殊装备" }
          ] : [])
        ],
        bridgeContext: { view: { relation: "modify", records: [{ operation: "unit_build_completion" }] } },
        provider: queueProvider([
          call("entity_catalog_query", { entityType: "unit", filters: { names: ["厄斐琉斯"] } }),
          call("unit_builds_batch", { entities: [{ apiName: initial.unit }] }),
          call("unit_builds", initial), finish("已更新三件套出装。", ["ev-2"])
        ]),
        definitions: [definition("unit_builds_batch", { inputSchema: {
          type: "object", additionalProperties: false, properties: {
            entities: { type: "array", items: { type: "object", properties: { apiName: { type: "string" } } } }
          }
        } }), definition("entity_catalog_query", { inputSchema: {
          type: "object", additionalProperties: false, properties: {
            entityType: { type: "string" }, filters: { type: "object", properties: { names: { type: "array", items: { type: "string" } } } }
          }
        } }), definition("unit_builds", { inputSchema: {
          type: "object", additionalProperties: false, required: ["unit"], properties: {
            unit: { type: "string" }, itemPolicy: { type: "string" }, itemCategories: { type: "array", items: { type: "string" } },
            itemCount: { type: "integer" }, starLevel: { type: "array", items: { type: "integer" } },
            days: { type: "integer" }, minSamples: { type: "integer" }
          }
        } })],
        handlers: { unit_builds_batch: async () => assert.fail("a scope edit must not execute an unconstrained batch"),
          entity_catalog_query: async () => evidence([{ apiName: "DA_18_Aphelios" }], {
          type: "entity_catalog_results", entityType: "unit",
          resolution: { requests: [{ inputName: "厄斐琉斯", status: "resolved", candidates: [{ apiName: "DA_18_Aphelios", name: "厄斐琉斯" }] }] }
        }), unit_builds: async (args) => {
          observed = args;
          return evidence([{ items: ["ordinary-a", "ordinary-b", "ordinary-c"] }], { type: "unit_build_rankings", query: args });
        } }
      });
      assert.equal(result.status, "completed", JSON.stringify(result));
      assert.ok(events.some(event => event.type === "decision_rejected" && event.data.code === "ungrounded_unit_build_query"));
      assert.deepEqual(observed, { ...initial, itemPolicy: "ordinary_only", itemCategories: [] });
    });
  }
});

test("artifact requests override stale ordinary scope and category corrections keep the contextual champion", async (t) => {
  for (const input of ["查询厄飞流斯的神器", "我要查的是奥恩神器", "厄斐琉斯神器装备排行榜", "只查奥恩神器", "厄斐琉斯光明装备排行榜", "不要神器，只查普通装备", "包含神器的完整出装", "厄斐琉斯推荐普通出装"]) {
    await t.test(input, async () => {
      const expected = requestedEquipmentCategoryScope(input);
      if (input.includes("完整出装") || input.includes("普通出装")) expected.itemCategories = [];
      const followUp = input === "我要查的是奥恩神器";
      let observed;
      const provider = queueProvider([
        ...(followUp ? [action("ask_user", {
          question: "奥恩神器是指哪一类？请提供具体装备名称。",
          missingFields: ["item"], reasonCode: "ambiguous_entity"
        })] : []),
        call("entity_catalog_query", { entityType: "unit", filters: { names: ["厄飞流斯"] } }),
        call("unit_builds", { unit: "DA_18_Aphelios", itemPolicy: "ordinary_only", ...(input.includes("普通出装") ? {} : { itemCategories: ["ordinary_completed"] }) }),
        finish("已按指定类别返回查询结果。", ["ev-2"])
      ]);
      const { result, events } = await runCase({
        input, provider,
        messages: followUp ? [
          { role: "user", content: "查询厄飞流斯的神器" },
          { role: "assistant", content: "羊刀+无尽+海妖之怒。" }
        ] : [],
        definitions: [
          definition("entity_catalog_query", { inputSchema: {
            type: "object", additionalProperties: false, required: ["entityType", "filters"],
            properties: {
              entityType: { type: "string" },
              filters: { type: "object", additionalProperties: false, properties: { names: { type: "array", items: { type: "string" } } } }
            }
          } }),
          definition("unit_builds", { inputSchema: {
            type: "object", additionalProperties: false, required: ["unit"],
            properties: { unit: { type: "string" }, itemPolicy: { type: "string" }, itemCategories: { type: "array", items: { type: "string" } } }
          } })
        ],
        handlers: {
          entity_catalog_query: async () => evidence([{ apiName: "DA_18_Aphelios" }], {
            type: "entity_catalog_results", entityType: "unit",
            resolution: { requests: [{ inputName: "厄飞流斯", status: "resolved", candidates: [{ apiName: "DA_18_Aphelios", name: "厄斐琉斯", matchedAlias: "厄飞流斯" }] }] }
          }),
          unit_builds: async (args) => {
            observed = args;
            return { updatedAt: "2026-08-30T00:00:00.000Z", type: "unit_item_rankings", query: args,
              itemRankings: [{ name: "狙击手的专注", category: "artifact" }] };
          }
        }
      });
      assert.equal(result.status, "completed", JSON.stringify(result.modelConclusion));
      assert.equal(observed.unit, "DA_18_Aphelios");
      assert.equal(observed.itemPolicy, expected.itemPolicy);
      assert.deepEqual(observed.itemCategories, expected.itemCategories);
      if (followUp) {
        assert.ok(events.some((event) => event.data?.code === "unnecessary_equipment_item_clarification"));
        assert.ok(result.observations.some((observation) => observation.repairInstruction?.includes("context")));
      }
    });
  }
});

test("artifact categories still allow clarification of missing champions or named comparison candidates", async () => {
  for (const [input, question, missingFields] of [
    ["查一下奥恩神器", "要查询哪个英雄的奥恩神器？", ["unit"]],
    ["比较厄斐琉斯的这两件神器", "请提供具体两件装备名称。", ["comparisonItems"]]
  ]) {
    const { result } = await runCase({ input, provider: queueProvider([
      action("ask_user", { question, missingFields, reasonCode: "missing_context" })
    ]) });
    assert.equal(result.status, "clarification_required");
    assert.equal(result.question, question);
  }
});

test("finish validation rejects an Artifact claim grounded only in ordinary equipment evidence", () => {
  const entry = {
    evidenceId: "ev-ordinary-items",
    toolName: "unit_builds",
    type: "unit_item_rankings",
    temporalStatus: "current",
    value: {
      type: "unit_item_rankings",
      query: {
        itemPolicy: "ordinary_only",
        itemCategories: ["ordinary_completed"]
      },
      itemRankings: [{ name: "羊刀", category: "ordinary_completed" }]
    }
  };
  const ledger = {
    resolve: (ids) => ids.includes(entry.evidenceId) ? [entry] : [],
    snapshot: () => ({ entries: [entry] })
  };
  for (const answer of ["单装备排行榜（含神器）：羊刀。", "厄斐琉斯主流神器：羊刀+无尽+海妖之怒。", "推荐奥恩神器：羊刀。", "神器推荐：羊刀。", "奥恩神器：羊刀。"] ) {
    const validation = validateFinishAction({ reasonCode: "sufficient_evidence", evidenceIds: [entry.evidenceId], answer }, ledger);
    assert.equal(validation.valid, false, answer);
    assert.ok(validation.errors.includes("answer claims an Artifact equipment ranking but cited evidence does not include artifact scope"));
  }
  for (const answer of ["普通装备排行榜，不含神器。", "神器数据不足，未返回神器排名。", "没有奥恩神器的数据。普通装备是羊刀。"]) {
    const validation = validateFinishAction({ reasonCode: "sufficient_evidence", evidenceIds: [entry.evidenceId], answer }, ledger);
    assert.equal(validation.valid, true, JSON.stringify(validation));
  }
  entry.value.query = { itemPolicy: "include_artifact", itemCategories: ["ordinary_completed", "artifact"] };
  const missingArtifacts = validateFinishAction({ reasonCode: "sufficient_evidence", evidenceIds: [entry.evidenceId], answer: "主流神器：羊刀。" }, ledger);
  assert.equal(missingArtifacts.valid, false, "an allowed category alone does not prove any artifact samples were returned");
});

test("artifact-only fallback does not claim ordinary equipment is included", () => {
  const fallback = buildSingleUnitItemRankingFallback({ snapshot: () => ({ entries: [{
    evidenceId: "ev-artifacts", toolName: "unit_builds", temporalStatus: "current",
    value: { type: "unit_item_rankings", unit: { name: "厄斐琉斯" }, query: { itemCategories: ["artifact"] },
      itemRankings: [{ name: "狙击手的专注", category: "artifact", stats: { games: 200, avg: 3.8 } }] }
  }] }) });
  assert.match(fallback.answer, /排行榜（神器）/u);
  assert.doesNotMatch(fallback.answer, /普通装备/u);
});

test("item ranking fallback summarizes mixed equipment evidence instead of using an unrelated result type", () => {
  const fallback = buildSingleUnitItemRankingFallback({
    snapshot: () => ({
      entries: [{
        evidenceId: "ev-mixed-items",
        toolName: "unit_builds",
        temporalStatus: "current",
        value: {
          type: "unit_item_rankings",
          unit: { name: "厄斐琉斯" },
          query: { itemCategories: ["ordinary_completed", "artifact"] },
          itemRankings: [
            { name: "金币收集者", category: "artifact", stats: { top4: 62.9, win: 14.8, avg: 3.87, games: 1743 } },
            { name: "杀人剑", category: "ordinary_completed", stats: { top4: 60.2, win: 10.3, avg: 4.07, games: 2949 } }
          ]
        }
      }]
    })
  });

  assert.deepEqual(fallback.evidenceIds, ["ev-mixed-items"]);
  assert.match(fallback.answer, /普通装备 \+ 神器/u);
  assert.match(fallback.answer, /1\. 金币收集者（神器） 前四率62\.9%/u);
  assert.match(fallback.answer, /2\. 杀人剑 前四率60\.2%/u);
  assert.doesNotMatch(fallback.answer, /视频/u);
});

test("metric leaders receive concise game-meaning explanations without labels or thresholds", () => {
  const answer = enrichMetricLeaderInterpretations(
    "今日选择率最高的阵容是星之守护者；吃鸡率最高的阵容是战斗学院。"
  );

  assert.match(answer, /星之守护者；\n选择率领先说明该阵容当前热度最高/u);
  assert.match(answer, /更可能遇到同行/u);
  assert.match(answer, /战斗学院。\n吃鸡率领先说明该阵容成型后的夺冠上限更高/u);
  assert.match(answer, /稳定性仍需结合前四率判断/u);
  assert.doesNotMatch(answer, /标签|阈值/u);
});

test("metric leader explanations are not duplicated when the model already explains them", () => {
  const source = "今日选择率最高的是星之守护者，因此更容易遇到同行和抢牌；吃鸡率最高的是战斗学院，说明它的夺冠上限更高。";
  assert.equal(enrichMetricLeaderInterpretations(source), source);
});

test("accepted composition ranking answers publish metric meaning explanations", async () => {
  const provider = queueProvider([
    call("comps_rankings", {}),
    finish("今日选择率最高的阵容是星之守护者；吃鸡率最高的阵容是战斗学院。", ["ev-1"])
  ]);
  const { result } = await runCase({
    input: "解析今天阵容",
    provider,
    handlers: {
      comps_rankings: async () => ({
        type: "comp_rankings",
        updatedAt: "2026-08-30T00:00:00.000Z",
        rankings: {
          popularity: [{ name: "星之守护者", stats: { selectionRate: 0.12 } }],
          winRate: [{ name: "战斗学院", stats: { winRate: 0.18 } }]
        }
      })
    }
  });

  assert.equal(result.status, "completed");
  assert.match(result.answer, /更可能遇到同行/u);
  assert.match(result.answer, /成型后的夺冠上限更高/u);
});

test("daily composition analysis wording binds to the global rankings instead of a fake named comp", async () => {
  let observedArguments = null;
  let analysisCalls = 0;
  const provider = queueProvider([
    call("comps_analysis", { mention: "今天阵容" }),
    finish("今日选择率最高的阵容是星之守护者；吃鸡率最高的阵容是战斗学院。", ["ev-1"])
  ]);
  const { result, events } = await runCase({
    input: "解析今天阵容",
    provider,
    definitions: [
      definition("comps_analysis", {
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { mention: { type: "string" } }
        }
      }),
      definition("comps_rankings", {
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { mention: { type: "string" } }
        }
      })
    ],
    handlers: {
      comps_analysis: async () => {
        analysisCalls += 1;
        return evidence([]);
      },
      comps_rankings: async (input) => {
        observedArguments = structuredClone(input);
        return {
          type: "comp_rankings",
          updatedAt: "2026-08-30T00:00:00.000Z",
          rankings: {
            popularity: [{ name: "星之守护者", stats: { selectionRate: 0.12 } }],
            winRate: [{ name: "战斗学院", stats: { winRate: 0.18 } }]
          }
        };
      }
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(analysisCalls, 0);
  assert.equal(observedArguments.mention, undefined);
  assert.ok(events.some((event) => event.type === "decision" && event.data?.tool === "comps_rankings"));
  assert.match(result.answer, /更可能遇到同行/u);
  assert.match(result.answer, /夺冠上限更高/u);
});

test("R1-09 a failed tool becomes an observation and a later tool can recover", async () => {
  let trendCalls = 0;
  const provider = queueProvider([
    call("comps_trends", { patch: "current" }),
    call("comps_rankings", { patch: "current" }, "recover_from_failure"),
    finish("可用排行显示A阵容样本为100。", ["ev-1"])
  ]);
  const { result, context } = await runCase({
    provider,
    handlers: {
      comps_trends: async () => {
        trendCalls += 1;
        const error = new Error("temporary outage");
        error.recoverable = true;
        throw error;
      },
      comps_rankings: async () => evidence([{ comp: "A", games: 100 }])
    }
  });
  assert.equal(result.status, "completed_with_warning");
  assert.equal(result.evidence.length, 1);
  assert.equal(trendCalls, 2);
  assert.equal(context.counters.retries, 1);
});

test("a failed fingerprint may be retried before the capability failure circuit opens", async () => {
  let calls = 0;
  const provider = queueProvider([
    call("comps_rankings", { patch: "current" }),
    call("comps_rankings", { patch: "current" }),
    finish("第二次查询已返回可用证据。", ["ev-1"])
  ]);
  const { result } = await runCase({
    provider,
    handlers: {
      comps_rankings: async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary timeout");
        return evidence([{ comp: "A", games: 100 }]);
      }
    }
  });
  assert.equal(result.terminationReason, "completed");
  assert.equal(calls, 2);
});

test("single-unit equipment evidence remains available when model prose is unrelated", async () => {
  const provider = queueProvider([
    call("unit_builds", { unit: "TFT18_Test" }),
    finish("这是未经证据支持的视频结论。", ["ev-1"])
  ]);
  const { result } = await runCase({
    provider,
    handlers: {
      unit_builds: async () => ({
        type: "unit_build_rankings",
        updatedAt: "2026-08-14T00:00:00.000Z",
        unit: { apiName: "TFT18_Test", name: "测试棋子" },
        cards: [{
          title: "主流方案",
          items: [{ name: "羊刀" }, { name: "法爆" }, { name: "科技枪" }],
          stats: { games: 120, avg: 3.5, top4: "65%", win: "20%" }
        }]
      })
    }
  });
  assert.equal(result.status, "completed");
  assert.equal(result.evidence[0].value.cards[0].items[0].name, "羊刀");
});

test("single-unit cards count as non-empty evidence without a results array", async () => {
  const provider = queueProvider([
    call("unit_builds", { unit: "TFT18_Test" }),
    finish("测试棋子的主流方案已返回。", ["ev-1"])
  ]);
  const { result } = await runCase({
    provider,
    handlers: {
      unit_builds: async () => ({
        type: "unit_build_rankings",
        updatedAt: "2026-08-14T00:00:00.000Z",
        cards: [{ title: "主流方案", items: [{ name: "羊刀" }], stats: { games: 100 } }]
      })
    }
  });
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].toolName, "unit_builds");
});

test("R1-10 unrecoverable evidence failure can finish with an explicit limitation", async () => {
  const provider = queueProvider([
    call("unit_builds", { unit: "TFT18_Xayah" }),
    finish("查询失败，当前工具不可用，无法可靠判断。", [], "insufficient_evidence")
  ]);
  const { result } = await runCase({
    provider,
    handlers: { unit_builds: async () => { throw new Error("offline"); } }
  });
  assert.equal(result.terminationReason, "insufficient_evidence");
  assert.equal(result.status, "completed_with_warning");
  assert.equal(result.answerOrigin, "model");
});

test("Chinese insufficient-evidence wording is accepted without fabricated evidence", async () => {
  const { result } = await runCase({
    provider: queueProvider([
      finish("当前样本门槛下没有可验证的结果。", [], "insufficient_evidence")
    ])
  });
  assert.equal(result.terminationReason, "insufficient_evidence");
  assert.equal(result.evidence.length, 0);
});

test("insufficient-evidence wording gets one constrained model repair", async () => {
  const provider = queueProvider([
    finish("现在没法给出答案。", [], "insufficient_evidence"),
    finish("当前数据证据不足，暂时无法可靠判断。", [], "insufficient_evidence")
  ]);
  const { result, events } = await runCase({ provider });

  assert.equal(provider.requests.length, 2);
  assert.equal(result.terminationReason, "insufficient_evidence");
  assert.equal(result.answer, "当前数据证据不足，暂时无法可靠判断。");
  assert.equal(result.status, "completed_with_warning");
  assert.equal(
    provider.requests[1].state.observations.at(-1).repairInstruction.includes("不得补造统计"),
    true
  );
  assert.equal(events.filter((event) => event.type === "decision_rejected").length, 1);
});

test("repeated invalid insufficient-evidence wording produces a visible system fallback", async () => {
  const provider = queueProvider([
    finish("现在没法给出答案。", [], "insufficient_evidence"),
    finish("还是没法给出答案。", [], "insufficient_evidence")
  ]);
  const { result, events } = await runCase({ provider });

  assert.equal(result.terminationReason, "insufficient_evidence");
  assert.equal(result.status, "completed_with_warning");
  assert.equal(result.answerOrigin, "system_evidence_fallback");
  assert.equal(result.modelConclusion?.status, "rejected");
  assert.equal(typeof result.modelConclusion?.answer, "string");
  assert.ok(result.modelConclusion.answer.length > 0);
  assert.ok(result.modelConclusion?.validationErrors?.length > 0);
  assert.match(result.answer, /证据不足/u);
  assert.ok(result.warnings.includes("insufficient_evidence_answer_fallback"));
  assert.equal(events.find((event) => event.type === "answer")?.data.systemFallback, true);
});

test("unit-build timeout fallback names the entity, source failure, and cited evidence", async () => {
  const provider = queueProvider([
    call("unit_builds_batch"),
    finish("现在没法给出答案。", ["ev-1"], "insufficient_evidence"),
    finish("还是没法给出答案。", ["ev-1"], "insufficient_evidence")
  ]);
  const { result } = await runCase({
    provider,
    definitions: [definition("unit_builds_batch")],
    handlers: {
      unit_builds_batch: async () => ({
        type: "unit_builds_batch_results",
        source: {
          provider: "MetaTFT",
          updatedAt: "2026-08-06T00:00:00.000Z",
          risks: ["霞 build statistics are unavailable: MetaTFT request timed out after 2200ms"]
        },
        updatedAt: "2026-08-06T00:00:00.000Z",
        results: [{
          unit: { apiName: "TFT17_Xayah", displayName: "霞" },
          apiName: "TFT17_Xayah",
          name: "霞",
          buildOptions: [],
          available: false,
          warning: "霞 build statistics are unavailable: MetaTFT request timed out after 2200ms"
        }]
      })
    }
  });

  assert.match(result.answer, /“霞”/u);
  assert.match(result.answer, /MetaTFT/u);
  assert.match(result.answer, /超时/u);
  assert.match(result.answer, /证据不足/u);
  assert.deepEqual(result.evidenceIds, ["ev-1"]);
});

test("G5 insufficient-evidence fallback preserves the applied constraint and row-filter audit", () => {
  const entries = [
    {
      evidenceId: "ev-baseline",
      toolName: "unit_builds_batch",
      temporalStatus: "current",
      value: {
        query: { constraints: { lockedItems: [], excludedItems: [] } },
        itemContentionPlan: {
          contestedItems: [{
            itemRef: { apiName: "TFT_Item_Excluded", name: "测试排除装备" }
          }]
        },
        results: []
      }
    },
    {
      evidenceId: "ev-constrained",
      toolName: "unit_builds_batch",
      temporalStatus: "current",
      value: {
        query: {
          constraints: {
            lockedItems: [],
            excludedItems: ["TFT_Item_Excluded"]
          }
        },
        results: [
          {
            available: true,
            unit: { displayName: "Alpha" },
            buildOptions: [{ items: [{ apiName: "TFT_Item_Alternative" }] }],
            constraintAudit: {
              eligibleBeforeConstraints: 120,
              eligibleAfterConstraints: 80
            }
          },
          {
            available: false,
            unit: { displayName: "Beta" },
            buildOptions: [],
            warning: "MetaTFT timed out"
          }
        ]
      }
    }
  ];
  const fallback = buildInsufficientEvidenceFallback({
    snapshot: () => ({ entries })
  });
  assert.deepEqual(fallback.evidenceIds, ["ev-baseline", "ev-constrained"]);
  assert.match(fallback.answer, /测试排除装备/u);
  assert.match(fallback.answer, /TFT_Item_Excluded/u);
  assert.match(fallback.answer, /120→80/u);
  assert.match(fallback.answer, /Beta/u);
  assert.match(fallback.answer, /无法判断整个阵容/u);
});

test("decision-provider failure preserves available build cards with a visible warning", async () => {
  let decisions = 0;
  const failingProvider = async (request) => {
    decisions += 1;
    if (decisions === 1) return call("unit_builds_batch");
    throw new SyntaxError("truncated JSON");
  };
  const { result, events } = await runCase({
    provider: failingProvider,
    definitions: [definition("unit_builds_batch")],
    handlers: {
      unit_builds_batch: async () => evidence([{
        unit: { apiName: "TFT17_Xayah", displayName: "霞" },
        available: true,
        buildOptions: [
          { optionId: "stable", role: "stable" },
          { optionId: "alt-1", role: "alternative" },
          { optionId: "alt-2", role: "alternative" }
        ]
      }])
    }
  });

  assert.equal(result.status, "completed_with_warning");
  assert.equal(result.terminationReason, "decision_provider_fallback");
  assert.match(result.answer, /1 套稳定方案和 2 套备选方案/u);
  assert.deepEqual(result.evidenceIds, ["ev-1"]);
  assert.equal(events.find((event) => event.type === "answer")?.data.systemFallback, true);
});

test("invalid statistics over real build cards get one grounded finish repair", async () => {
  const provider = queueProvider([
    call("unit_builds_batch"),
    finish("霞的前四率是99%。", ["ev-1"]),
    finish("霞有三套可验证的当前出装方案。", ["ev-1"])
  ]);
  const { result } = await runCase({
    provider,
    definitions: [definition("unit_builds_batch")],
    handlers: {
      unit_builds_batch: async () => evidence([{
        unit: { apiName: "TFT17_Xayah", displayName: "霞" },
        available: true,
        buildOptions: [
          { optionId: "stable", role: "stable" },
          { optionId: "alt-1", role: "alternative" },
          { optionId: "alt-2", role: "alternative" }
        ]
      }])
    }
  });

  assert.equal(result.terminationReason, "completed");
  assert.equal(result.answer, "霞有三套可验证的当前出装方案。");
  assert.match(provider.requests[2].state.observations.at(-1).repairInstruction, /不要补造/u);
});

test("repeated invalid statistics preserve deterministic build cards instead of failing", async () => {
  const provider = queueProvider([
    call("unit_builds_batch"),
    finish("霞的前四率是99%。", ["ev-1"]),
    finish("霞的前四率还是99%。", ["ev-1"])
  ]);
  const { result } = await runCase({
    provider,
    definitions: [definition("unit_builds_batch")],
    handlers: {
      unit_builds_batch: async () => evidence([{
        unit: { apiName: "TFT17_Xayah", displayName: "霞" },
        available: true,
        buildOptions: [
          { optionId: "stable", role: "stable" },
          { optionId: "alt-1", role: "alternative" },
          { optionId: "alt-2", role: "alternative" }
        ]
      }])
    }
  });

  assert.equal(result.status, "completed_with_warning");
  assert.equal(result.terminationReason, "finish_validation_fallback");
  assert.match(result.answer, /1 套稳定方案和 2 套备选方案/u);
  assert.doesNotMatch(result.answer, /99/u);
});

test("R1-11 three empty observations hard-stop for no progress", async () => {
  const provider = queueProvider([
    call("comps_trends", { patch: "a" }),
    call("comps_rankings", { patch: "b" }),
    call("comps_trends", { patch: "c" }),
    finish("不应执行到这里。", [], "direct_answer")
  ]);
  const { result } = await runCase({
    provider,
    handlers: {
      comps_trends: async () => evidence([]),
      comps_rankings: async () => evidence([])
    }
  });
  assert.equal(result.terminationReason, "no_progress");
  assert.equal(provider.requests.length, 3);
});

test("G3 replacement evaluation requires resolved composition and two official unit details", async () => {
  const objectSchema = (required, properties) => ({
    type: "object",
    additionalProperties: false,
    required,
    properties
  });
  const definitions = [
    definition("comps_rankings", {
      inputSchema: objectSchema(["mention"], { mention: { type: "string" } })
    }),
    definition("entity_catalog_query", {
      inputSchema: objectSchema(["entityType", "filters"], {
        entityType: { type: "string" },
        filters: {
          type: "object",
          additionalProperties: false,
          required: ["names"],
          properties: { names: { type: "array", items: { type: "string" } } }
        }
      })
    }),
    definition("unit_details"),
    definition("composition_replacement_evaluation", {
      inputSchema: objectSchema([
        "compositionId", "targetApiName", "replacementApiName", "seasonContextId"
      ], {
        compositionId: { type: "string" },
        targetApiName: { type: "string" },
        replacementApiName: { type: "string" },
        seasonContextId: { type: "string" }
      })
    })
  ];
  let evaluationCalls = 0;
  const provider = queueProvider([
    call("comps_rankings", { mention: "Dynamic Comp" }),
    call("entity_catalog_query", {
      entityType: "unit",
      filters: { names: ["Alpha", "Delta"] }
    }, "retrieve_entity_details"),
    call("unit_details", { apiName: "Unit_A" }, "retrieve_entity_details"),
    call("unit_details", { apiName: "Unit_D" }, "retrieve_entity_details"),
    call("composition_replacement_evaluation", {
      compositionId: "cluster:dynamic",
      targetApiName: "Unit_A",
      replacementApiName: "Unit_D",
      seasonContextId: "set17-live"
    }),
    finish("已完成确定性的阵容结构变化评估。", ["ev-5"])
  ]);
  const { result, context } = await runCase({
    provider,
    definitions,
    handlers: {
      comps_rankings: async () => evidence([{
        compositionRef: { compId: "cluster:dynamic", name: "Dynamic Comp" },
        members: [{ apiName: "Unit_A" }, { apiName: "Unit_B" }]
      }], { resolution: { status: "resolved" } }),
      entity_catalog_query: async () => ({
        updatedAt: "2026-08-07T00:00:00.000Z",
        entityType: "unit",
        resolution: {
          requests: [
            { status: "resolved", candidates: [{ apiName: "Unit_A" }] },
            { status: "resolved", candidates: [{ apiName: "Unit_D" }] }
          ]
        },
        results: [{ apiName: "Unit_A" }, { apiName: "Unit_D" }]
      }),
      unit_details: async ({ apiName }) => ({
        updatedAt: "2026-08-07T00:00:00.000Z",
        status: "found",
        apiName,
        facts: { traits: [] }
      }),
      composition_replacement_evaluation: async () => {
        evaluationCalls += 1;
        return {
          updatedAt: "2026-08-07T00:00:00.000Z",
          status: "evaluated",
          traitDeltas: [{ trait: "dynamic", beforeCount: 2, afterCount: 1 }],
          strengthConclusion: "not_evaluated"
        };
      }
    }
  });
  assert.equal(result.status, "completed");
  assert.equal(evaluationCalls, 1);
  assert.equal(context.counters.toolCalls, 5);
  assert.equal(result.evidence.at(-1).toolName, "composition_replacement_evaluation");
});

test("G3 replacement evaluation is rejected before prerequisite evidence exists", async () => {
  let evaluationCalls = 0;
  const replacementDefinition = definition("composition_replacement_evaluation", {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["compositionId", "targetApiName", "replacementApiName", "seasonContextId"],
      properties: {
        compositionId: { type: "string" },
        targetApiName: { type: "string" },
        replacementApiName: { type: "string" },
        seasonContextId: { type: "string" }
      }
    }
  });
  const provider = queueProvider([
    call("composition_replacement_evaluation", {
      compositionId: "cluster:dynamic",
      targetApiName: "Unit_A",
      replacementApiName: "Unit_D",
      seasonContextId: "set17-live"
    }),
    finish("证据不足，无法可靠完成替换评估。", [], "insufficient_evidence")
  ]);
  const { result, events } = await runCase({
    provider,
    definitions: [replacementDefinition],
    handlers: {
      composition_replacement_evaluation: async () => {
        evaluationCalls += 1;
        return evidence([]);
      }
    }
  });
  assert.equal(evaluationCalls, 0);
  assert.equal(result.status, "completed");
  assert.equal(result.terminationReason, "insufficient_evidence");
  assert.ok(events.some((event) => (
    event.type === "decision_rejected"
    && event.data.code === "invalid_composition_replacement_evidence"
  )));
});

test("composition add evaluation requires one grounded incoming unit and executes once", async () => {
  const objectSchema = (required, properties) => ({
    type: "object",
    additionalProperties: false,
    required,
    properties
  });
  const definitions = [
    definition("comps_rankings", {
      inputSchema: objectSchema(["mention"], { mention: { type: "string" } })
    }),
    definition("entity_catalog_query", {
      inputSchema: objectSchema(["entityType", "filters"], {
        entityType: { type: "string" },
        filters: {
          type: "object",
          additionalProperties: false,
          required: ["names"],
          properties: { names: { type: "array", items: { type: "string" } } }
        }
      })
    }),
    definition("unit_details"),
    definition("composition_change_evaluation", {
      inputSchema: objectSchema(["operation", "compositionId", "seasonContextId"], {
        operation: { type: "string", enum: ["add", "remove", "replace"] },
        compositionId: { type: "string" },
        targetApiName: { type: "string" },
        incomingApiName: { type: "string" },
        seasonContextId: { type: "string" }
      })
    })
  ];
  let changeCalls = 0;
  const provider = queueProvider([
    call("comps_rankings", { mention: "Dynamic Comp" }),
    call("entity_catalog_query", {
      entityType: "unit",
      filters: { names: ["Delta"] }
    }, "retrieve_entity_details"),
    call("unit_details", { apiName: "Unit_D" }, "retrieve_entity_details"),
    call("composition_change_evaluation", {
      operation: "add",
      compositionId: "cluster:dynamic",
      incomingApiName: "Unit_D",
      seasonContextId: "set17-live"
    }),
    finish("加入 Delta 后，Frost 羁绊人数增加，但尚未激活。", ["ev-4"])
  ]);
  const { result, context } = await runCase({
    provider,
    definitions,
    handlers: {
      comps_rankings: async () => evidence([{
        compositionRef: { compId: "cluster:dynamic", name: "Dynamic Comp" },
        members: [{ apiName: "Unit_A" }, { apiName: "Unit_B" }]
      }], { resolution: { status: "resolved" } }),
      entity_catalog_query: async () => ({
        updatedAt: "2026-08-07T00:00:00.000Z",
        entityType: "unit",
        resolution: {
          requests: [
            { status: "resolved", candidates: [{ apiName: "Unit_D" }] }
          ]
        },
        results: [{ apiName: "Unit_D" }]
      }),
      unit_details: async ({ apiName }) => ({
        updatedAt: "2026-08-07T00:00:00.000Z",
        status: "found",
        apiName,
        facts: { traits: ["Frost"] }
      }),
      composition_change_evaluation: async () => {
        changeCalls += 1;
        return {
          updatedAt: "2026-08-07T00:00:00.000Z",
          operation: "add",
          status: "evaluated",
          traitDeltas: [{
            traitRef: { name: "Frost" },
            beforeCount: 0,
            afterCount: 1,
            beforeBreakpoint: { tierIndex: 0 },
            afterBreakpoint: { tierIndex: 0 },
            breakpointChange: "count_increased"
          }],
          strengthConclusion: "not_evaluated"
        };
      }
    }
  });
  assert.equal(result.status, "completed");
  assert.equal(changeCalls, 1);
  assert.equal(context.counters.toolCalls, 4);
  assert.equal(result.evidence.at(-1).toolName, "composition_change_evaluation");
});

test("composition add evaluation is rejected without grounded incoming unit evidence", async () => {
  let changeCalls = 0;
  const changeDefinition = definition("composition_change_evaluation", {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["operation", "compositionId", "seasonContextId"],
      properties: {
        operation: { type: "string", enum: ["add", "remove", "replace"] },
        compositionId: { type: "string" },
        targetApiName: { type: "string" },
        incomingApiName: { type: "string" },
        seasonContextId: { type: "string" }
      }
    }
  });
  const provider = queueProvider([
    call("composition_change_evaluation", {
      operation: "add",
      compositionId: "cluster:dynamic",
      incomingApiName: "Unit_D",
      seasonContextId: "set17-live"
    }),
    finish("证据不足，无法可靠完成加人后的羁绊评估。", [], "insufficient_evidence")
  ]);
  const { result, events } = await runCase({
    provider,
    definitions: [changeDefinition],
    handlers: {
      composition_change_evaluation: async () => {
        changeCalls += 1;
        return evidence([]);
      }
    }
  });
  assert.equal(changeCalls, 0);
  assert.equal(result.status, "completed");
  assert.ok(events.some((event) => (
    event.type === "decision_rejected"
    && event.data.code === "invalid_composition_change_evidence"
  )));
});

test("G3 finish validation rejects a blanket no-change claim when a breakpoint changed", () => {
  const entry = {
    evidenceId: "ev-g3",
    toolName: "composition_replacement_evaluation",
    temporalStatus: "current",
    value: {
      status: "evaluated",
      traitDeltas: [{
        beforeCount: 2,
        afterCount: 1,
        thresholds: [2, 4, 6],
        breakpointChange: "deactivated"
      }]
    }
  };
  const ledger = {
    resolve(ids) {
      return ids.includes(entry.evidenceId) ? [entry] : [];
    }
  };
  const invalid = validateFinishAction({
    reasonCode: "sufficient_evidence",
    evidenceIds: [entry.evidenceId],
    answer: "The count changes from 2 to 1, but all traits have no breakpoint changes."
  }, ledger);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes("answer contradicts deterministic composition breakpoint changes"));
  const valid = validateFinishAction({
    reasonCode: "sufficient_evidence",
    evidenceIds: [entry.evidenceId],
    answer: "The count changes from 2 to 1 and the breakpoint is deactivated."
  }, ledger);
  assert.equal(valid.valid, true);
});

test("finish validation accepts a rounded positive placement improvement from composition trend evidence", () => {
  const entry = {
    evidenceId: "ev-comp-trend",
    toolName: "comps_trends",
    type: "composition_trends",
    temporalStatus: "current",
    value: {
      type: "comp_trends",
      rising: [{
        name: "未来战士 · 潘森",
        stats: { avgPlacement: 4 },
        trend: {
          baselineAvgPlacement: 4.8183,
          avgPlacementChange: -0.8182999999999998,
          direction: "rising",
          improving: true
        }
      }]
    }
  };
  const ledger = { resolve: (ids) => ids.includes(entry.evidenceId) ? [entry] : [] };
  const validation = validateFinishAction({
    reasonCode: "sufficient_evidence",
    evidenceIds: [entry.evidenceId],
    answer: "未来战士 · 潘森的平均名次由 4.82 提升至 4.00，提升 0.82 名。"
  }, ledger);
  assert.equal(validation.valid, true, validation.errors.join("; "));
});

test("trend overview cannot discard falling and popularity evidence when rising is empty", () => {
  const entry = {
    evidenceId: "ev-comp-trend-partial",
    toolName: "comps_trends",
    type: "composition_trends",
    temporalStatus: "current",
    value: {
      type: "comp_trends",
      requestedDirection: null,
      rising: [],
      falling: [{ name: "战斗学院 · 悠米" }],
      rankings: { popularity: [{ name: "星之守护者 · 阿狸" }] }
    }
  };
  const ledger = {
    resolve: (ids) => ids.includes(entry.evidenceId) ? [entry] : [],
    snapshot: () => ({ entries: [entry] })
  };
  const validation = validateFinishAction({
    reasonCode: "insufficient_evidence",
    evidenceIds: [entry.evidenceId],
    answer: "上升榜为空，因此当前证据不足，无法可靠提供趋势排名。"
  }, ledger);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes(
    "insufficient_evidence cannot discard available composition trend sections"
  ));
});

test("an explicitly rising-only request may report insufficient evidence when rising is empty", () => {
  const entry = {
    evidenceId: "ev-rising-empty",
    toolName: "comps_trends",
    type: "composition_trends",
    temporalStatus: "current",
    value: {
      type: "comp_trends",
      requestedDirection: "rising",
      rising: [],
      falling: [{ name: "不会进入当前方向的阵容" }],
      rankings: { popularity: [{ name: "不会进入当前方向的热门阵容" }] }
    }
  };
  const ledger = {
    resolve: (ids) => ids.includes(entry.evidenceId) ? [entry] : [],
    snapshot: () => ({ entries: [entry] })
  };
  const validation = validateFinishAction({
    reasonCode: "insufficient_evidence",
    evidenceIds: [entry.evidenceId],
    answer: "当前上升榜没有可验证结果，证据不足。"
  }, ledger);
  assert.equal(validation.valid, true, validation.errors.join("; "));
});

test("the user's explicit trend direction overrides a contradictory model argument", async () => {
  let observedInput = null;
  const provider = queueProvider([
    call("comps_trends", { patch: "current", direction: "falling" }),
    finish("当前上升榜没有可验证结果，证据不足。", ["ev-1"], "insufficient_evidence")
  ]);
  const { result } = await runCase({
    input: "最近有哪些上升阵容？",
    provider,
    handlers: {
      comps_trends: async (input) => {
        observedInput = structuredClone(input);
        return {
          updatedAt: "2026-08-06T00:00:00.000Z",
          type: "comp_trends",
          requestedDirection: input.direction,
          rising: [],
          falling: [],
          rankings: { popularity: [] },
          trend: { status: "upstream" }
        };
      }
    }
  });
  assert.equal(observedInput.direction, "rising");
  assert.equal(result.terminationReason, "insufficient_evidence");
});

test("trend fallback renders available falling and popularity sections independently", () => {
  const entry = {
    evidenceId: "ev-comp-trend-partial",
    toolName: "comps_trends",
    temporalStatus: "current",
    value: {
      type: "comp_trends",
      requestedDirection: null,
      rising: [],
      falling: [{
        name: "战斗学院 · 悠米",
        trend: { avgPlacementChange: 0.27 }
      }],
      rankings: { popularity: [{
        name: "星之守护者 · 阿狸",
        stats: { selectionRate: 0.625 }
      }] }
    }
  };
  const fallback = buildCompositionTrendFallback({
    snapshot: () => ({ entries: [entry] })
  });
  assert.deepEqual(fallback.evidenceIds, ["ev-comp-trend-partial"]);
  assert.match(fallback.answer, /上升阵容：当前没有检测到/u);
  assert.match(fallback.answer, /下降阵容：战斗学院 · 悠米/u);
  assert.match(fallback.answer, /选取率排行：星之守护者 · 阿狸/u);
  assert.match(fallback.answer, /62\.5%/u);
});

test("repeated whole-result trend downgrade falls back to valid partial trend evidence", async () => {
  let observedInput = null;
  const provider = queueProvider([
    call("comps_trends", { patch: "current", direction: "rising" }),
    finish("上升榜为空，当前证据不足，无法可靠提供趋势排名。", ["ev-1"], "insufficient_evidence"),
    finish("仍然没有上升阵容，当前证据不足。", ["ev-1"], "insufficient_evidence")
  ]);
  const { result } = await runCase({
    input: "今日趋势解析",
    provider,
    handlers: {
      comps_trends: async (input) => {
        observedInput = structuredClone(input);
        return {
        updatedAt: "2026-08-06T00:00:00.000Z",
        type: "comp_trends",
        requestedDirection: null,
        rising: [],
        falling: [{
          name: "战斗学院 · 悠米",
          trend: { avgPlacementChange: 0.27 }
        }],
        rankings: { popularity: [{
          name: "星之守护者 · 阿狸",
          stats: { selectionRate: 0.625 }
        }] },
          trend: { status: "upstream", officialGate: { status: "insufficient", eligibleCount: 0 } }
        };
      }
    }
  });

  assert.equal(observedInput.direction, undefined);
  assert.equal(result.status, "completed_with_warning");
  assert.equal(result.terminationReason, "finish_validation_fallback");
  assert.equal(result.answerOrigin, "system_evidence_fallback");
  assert.match(result.answer, /下降阵容：战斗学院 · 悠米/u);
  assert.match(result.answer, /选取率排行：星之守护者 · 阿狸/u);
  assert.ok(result.warnings.includes("composition_trend_partial_evidence_fallback"));
  assert.deepEqual(
    provider.requests[1].state.observations.at(-1).nextActionAffordance.sectionAvailability,
    {
      rising: { status: "empty", count: 0 },
      falling: { status: "available", count: 1 },
      popularity: { status: "available", count: 1 }
    }
  );
  assert.match(
    provider.requests[2].state.observations.at(-1).repairInstruction,
    /改用 sufficient_evidence/u
  );
});

test("finish validation does not allow an absolute rounded delta for unrelated evidence", () => {
  const entry = {
    evidenceId: "ev-unrelated-delta",
    toolName: "unit_builds_batch",
    type: "unit_builds_batch_results",
    temporalStatus: "current",
    value: { avgPlacementChange: -0.8182999999999998 }
  };
  const ledger = { resolve: (ids) => ids.includes(entry.evidenceId) ? [entry] : [] };
  const validation = validateFinishAction({
    reasonCode: "sufficient_evidence",
    evidenceIds: [entry.evidenceId],
    answer: "提升 0.82 名。"
  }, ledger);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("answer statistic is not present in cited evidence: 0.82"));
});

test("G3 deterministic fallback renders breakpoint evidence without model prose", () => {
  const entry = {
    evidenceId: "ev-g3",
    toolName: "composition_replacement_evaluation",
    temporalStatus: "current",
    value: {
      status: "evaluated",
      compositionRef: { name: "Dynamic Comp" },
      target: { name: "Alpha" },
      replacement: { name: "Delta" },
      traitDeltas: [{
        traitRef: { name: "Guard" },
        beforeCount: 2,
        afterCount: 1,
        beforeBreakpoint: { tierIndex: 1 },
        afterBreakpoint: { tierIndex: 0 },
        breakpointChange: "deactivated"
      }]
    }
  };
  const fallback = buildCompositionReplacementFallback({
    snapshot: () => ({ entries: [entry] })
  });
  assert.deepEqual(fallback.evidenceIds, ["ev-g3"]);
  assert.match(fallback.answer, /Guard 2→1/u);
  assert.match(fallback.answer, /第1档变为未激活/u);
  assert.match(fallback.answer, /不包含强弱结论/u);
});

test("composition add fallback renders deterministic trait deltas", () => {
  const entry = {
    evidenceId: "ev-add",
    toolName: "composition_change_evaluation",
    temporalStatus: "current",
    value: {
      operation: "add",
      status: "evaluated",
      compositionRef: { name: "Dynamic Comp" },
      incoming: { name: "Delta" },
      traitDeltas: [{
        traitRef: { name: "Frost" },
        beforeCount: 1,
        afterCount: 2,
        beforeBreakpoint: { tierIndex: 0 },
        afterBreakpoint: { tierIndex: 1 },
        breakpointChange: "activated"
      }]
    }
  };
  const fallback = buildCompositionReplacementFallback({
    snapshot: () => ({ entries: [entry] })
  });
  assert.deepEqual(fallback.evidenceIds, ["ev-add"]);
  assert.match(fallback.answer, /加入Delta/u);
  assert.match(fallback.answer, /Frost 1→2/u);
  assert.match(fallback.answer, /由未激活变为第1档/u);
});

test("G4-A composition item contention follows deterministic candidates and contested items", async () => {
  const objectSchema = (required, properties) => ({
    type: "object",
    additionalProperties: false,
    required,
    properties
  });
  const definitions = [
    definition("comps_rankings", {
      inputSchema: objectSchema(["mention"], { mention: { type: "string" } })
    }),
    definition("unit_builds_batch", {
      inputSchema: objectSchema(["entities", "compositionId", "optionsPerUnit"], {
        entities: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true,
            required: ["apiName"],
            properties: { apiName: { type: "string" }, name: { type: "string" } }
          }
        },
        compositionId: { type: "string" },
        optionsPerUnit: { type: "integer" }
      })
    }),
    definition("item_details_batch", {
      evidenceType: "official_item_batch",
      inputSchema: objectSchema(["apiNames", "seasonContextId"], {
        apiNames: { type: "array", items: { type: "string" } },
        seasonContextId: { type: "string" }
      })
    })
  ];
  let buildCalls = 0;
  let itemCalls = 0;
  const entities = [{ apiName: "Unit_A", name: "Alpha" }, { apiName: "Unit_B", name: "Beta" }];
  const provider = queueProvider([
    call("comps_rankings", { mention: "Dynamic Comp" }),
    call("unit_builds_batch", {
      compositionId: "cluster:dynamic",
      entities,
      optionsPerUnit: 3
    }),
    call("item_details_batch", {
      apiNames: ["Item_Shared"],
      seasonContextId: "set17-live"
    }, "retrieve_entity_details"),
    finish(
      "Alpha and Beta both use Item_Shared in retrieved build options. Its official effect is cited. Equipment priority was not evaluated.",
      ["ev-2", "ev-3"]
    )
  ]);
  const { result, context, events } = await runCase({
    provider,
    definitions,
    input: "Analyze composition item contention for Dynamic Comp",
    handlers: {
      comps_rankings: async () => evidence([{
        compositionRef: { compId: "cluster:dynamic", name: "Dynamic Comp" },
        members: entities.map((entity) => ({ ...entity, relations: ["member_of_comp", "itemized_core_candidate"] })),
        itemContentionQueryPlan: {
          status: "ready",
          compositionId: "cluster:dynamic",
          entities,
          apiNames: ["Unit_A", "Unit_B"],
          optionsPerUnit: 3
        }
      }], { resolution: { status: "resolved" } }),
      unit_builds_batch: async () => {
        buildCalls += 1;
        return {
          updatedAt: "2026-08-07T00:00:00.000Z",
          results: [],
          itemContentionPlan: {
            status: "available",
            apiNames: ["Item_Shared"],
            priorityConclusion: "not_evaluated",
            contestedItems: [{
              itemRef: { apiName: "Item_Shared", name: "Shared" },
              participants: entities.map((unitRef) => ({ unitRef }))
            }]
          }
        };
      },
      item_details_batch: async () => {
        itemCalls += 1;
        return {
          updatedAt: "2026-08-07T00:00:00.000Z",
          mechanismStatus: "available",
          items: [{ apiName: "Item_Shared", status: "found", facts: { effect: "Official effect" } }]
        };
      }
    }
  });
  assert.equal(result.status, "completed", JSON.stringify({ result, events }, null, 2));
  assert.equal(buildCalls, 1);
  assert.equal(itemCalls, 1);
  assert.equal(context.counters.toolCalls, 3);
});

test("composition tactical details must copy the resolved deterministic query plan", async () => {
  const tacticalDefinition = definition("composition_tactical_details", {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["compositionId", "clusterId", "units", "seasonContextId"],
      properties: {
        compositionId: { type: "string" },
        clusterId: { type: "string" },
        units: { type: "array", items: { type: "string" } },
        seasonContextId: { type: "string" }
      }
    }
  });
  let tacticalCalls = 0;
  const argumentsValue = {
    compositionId: "409000",
    clusterId: "409",
    units: ["TFT17_Front", "TFT17_Back"],
    seasonContextId: "set17-live"
  };
  const tacticalProvider = queueProvider([
    call("comps_rankings", { mention: "Dynamic Comp" }),
    call("composition_tactical_details", argumentsValue),
    finish("已按站位数据展示棋盘，并列出可验证的强化符文。", ["ev-2"])
  ]);
  const { result, context } = await runCase({
    input: "Dynamic Comp怎么站位，推荐什么海克斯？",
    definitions: [definition("comps_rankings", {
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["mention"],
        properties: { mention: { type: "string" } }
      }
    }), tacticalDefinition],
    provider: tacticalProvider,
    handlers: {
      comps_rankings: async () => evidence([{
        compositionRef: { compId: "409000", clusterId: "409", name: "Dynamic Comp" },
        tacticalDetailQueryPlan: {
          schemaVersion: "composition-tactical-detail-query.v1",
          status: "ready",
          ...argumentsValue
        }
      }], { resolution: { status: "resolved" } }),
      composition_tactical_details: async () => {
        tacticalCalls += 1;
        return {
          type: "composition_tactical_details",
          updatedAt: "2026-08-09T00:00:00.000Z",
          formation: { status: "available", units: [{ apiName: "TFT17_Front", cell: 24 }] },
          augmentRecommendations: { status: "available", entries: [{ apiName: "Augment_A", tier: "S" }] }
        };
      }
    }
  });
  assert.equal(result.status, "completed");
  assert.equal(tacticalCalls, 1);
  assert.equal(context.counters.toolCalls, 2);
  assert.deepEqual(
    tacticalProvider.requests[1].state.observations.at(-1).nextActionAffordance.callTool,
    {
      tool: "composition_tactical_details",
      purposeCode: "retrieve_current_statistics",
      arguments: argumentsValue
    }
  );
});

test("tactical finish validation rejects prose that moves units to a different board row", () => {
  const entry = {
    evidenceId: "ev-tactical",
    toolName: "composition_tactical_details",
    temporalStatus: "current",
    value: {
      formation: {
        status: "available",
        units: [
          { name: "易", boardPosition: { rowFromFront: 1 }, combatProfile: { attackRange: 1 } },
          { name: "菲奥娜", boardPosition: { rowFromFront: 1 }, combatProfile: { attackRange: 1 } },
          { name: "厄加特", boardPosition: { rowFromFront: 2 }, combatProfile: { attackRange: 2 } },
          { name: "卑尔维斯", boardPosition: { rowFromFront: 2 }, combatProfile: { attackRange: 2 } }
        ]
      }
    }
  };
  const ledger = { resolve: (ids) => ids.includes(entry.evidenceId) ? [entry] : [] };
  const invalid = validateFinishAction({
    reasonCode: "sufficient_evidence",
    evidenceIds: [entry.evidenceId],
    answer: "**中排（第2排）**：**易**、**菲奥娜**方便切入。"
  }, ledger);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => /contradicts formation for 易/u.test(error)));

  const valid = validateFinishAction({
    reasonCode: "sufficient_evidence",
    evidenceIds: [entry.evidenceId],
    answer: "**前排（第1排）**：**易**、**菲奥娜**位于边角，方便切入。\n**中排（第2排）**：**厄加特**、**卑尔维斯**利用2格攻击距离输出。"
  }, ledger);
  assert.equal(valid.valid, true, valid.errors.join("; "));

  const cardOnly = validateFinishAction({
    reasonCode: "sufficient_evidence",
    evidenceIds: [entry.evidenceId],
    answer: "易放在前排。"
  }, ledger, { compositionCardScope: true, compositionCardsOwnPositioning: true });
  assert.equal(cardOnly.valid, false);
  assert.ok(cardOnly.errors.includes("positioning prose is reserved for the cited composition cards"));

  const cardsOwnPositioning = validateFinishAction({
    reasonCode: "sufficient_evidence",
    evidenceIds: [entry.evidenceId],
    answer: "阵容与站位请查看对应来源卡片。"
  }, ledger, { compositionCardScope: true, compositionCardsOwnPositioning: true });
  assert.equal(cardsOwnPositioning.valid, true, cardsOwnPositioning.errors.join("; "));
});

test("G4-A rejects model-selected composition members outside the deterministic candidate plan", async () => {
  const unitBatchDefinition = definition("unit_builds_batch", {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entities", "compositionId", "optionsPerUnit"],
      properties: {
        entities: { type: "array", items: { type: "object", additionalProperties: true } },
        compositionId: { type: "string" },
        optionsPerUnit: { type: "integer" }
      }
    }
  });
  let buildCalls = 0;
  const provider = queueProvider([
    call("comps_rankings", { mention: "Dynamic Comp" }),
    call("unit_builds_batch", {
      compositionId: "cluster:dynamic",
      entities: [{ apiName: "Unit_Model_Selected" }],
      optionsPerUnit: 3
    }),
    finish("Current evidence is insufficient to analyze item contention.", ["ev-1"], "insufficient_evidence")
  ]);
  const { result, events } = await runCase({
    provider,
    input: "Analyze composition item contention for Dynamic Comp",
    definitions: [definition("comps_rankings", {
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["mention"],
        properties: { mention: { type: "string" } }
      }
    }), unitBatchDefinition],
    handlers: {
      comps_rankings: async () => evidence([{
        compositionRef: { compId: "cluster:dynamic", name: "Dynamic Comp" },
        members: [{ apiName: "Unit_A" }, { apiName: "Unit_B" }],
        itemContentionQueryPlan: {
          status: "ready",
          compositionId: "cluster:dynamic",
          apiNames: ["Unit_A", "Unit_B"],
          entities: [{ apiName: "Unit_A" }, { apiName: "Unit_B" }],
          optionsPerUnit: 3
        }
      }], { resolution: { status: "resolved" } }),
      unit_builds_batch: async () => {
        buildCalls += 1;
        return evidence([]);
      }
    }
  });
  assert.equal(buildCalls, 0);
  assert.equal(result.terminationReason, "insufficient_evidence");
  assert.ok(events.some((event) => (
    event.type === "decision_rejected"
    && event.data.code === "invalid_item_contention_candidate_selection"
  )));
});

test("G4-A contention evidence cannot support an unevidenced item priority claim", () => {
  const entries = [
    {
      evidenceId: "ev-builds",
      toolName: "unit_builds_batch",
      temporalStatus: "current",
      value: {
        itemContentionPlan: {
          status: "available",
          apiNames: ["Item_Shared"],
          priorityConclusion: "not_evaluated"
        }
      }
    },
    {
      evidenceId: "ev-items",
      toolName: "item_details_batch",
      temporalStatus: "current",
      value: { items: [{ apiName: "Item_Shared", facts: { effect: "Official effect" } }] }
    }
  ];
  const ledger = { resolve: (ids) => entries.filter((entry) => ids.includes(entry.evidenceId)) };
  const validation = validateFinishAction({
    reasonCode: "sufficient_evidence",
    evidenceIds: entries.map((entry) => entry.evidenceId),
    answer: "The item must be assigned to Alpha as the best holder."
  }, ledger);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("item contention evidence does not support an equipment priority claim"));
});

test("G4-A partial no-contention evidence cannot be expanded to the whole composition", () => {
  const entries = [{
    evidenceId: "ev-builds",
    toolName: "unit_builds_batch",
    temporalStatus: "current",
    value: {
      itemContentionPlan: {
        status: "no_contention",
        coverageStatus: "partial",
        successfulUnits: [{ apiName: "Unit_A", name: "Alpha" }, { apiName: "Unit_B", name: "Beta" }],
        failedUnits: [{ unit: { apiName: "Unit_C", name: "Gamma" }, reason: "timeout" }]
      }
    }
  }];
  const ledger = { resolve: (ids) => entries.filter((entry) => ids.includes(entry.evidenceId)) };
  const rejected = validateFinishAction({
    reasonCode: "sufficient_evidence",
    evidenceIds: ["ev-builds"],
    answer: "Gamma 请求超时，但该阵容中不存在共享装备的竞争情况。"
  }, ledger);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.includes(
    "item contention answer overstates sampled non-detection as absolute absence"
  ));
  assert.ok(rejected.errors.includes(
    "partial item contention coverage requires failed-unit and whole-composition limitations"
  ));

  const accepted = validateFinishAction({
    reasonCode: "sufficient_evidence",
    evidenceIds: ["ev-builds"],
    answer: "在成功返回的 Alpha、Beta 中暂未检测到共享装备竞争；Gamma 请求超时，因此无法判断整个阵容是否还有其他装备冲突。"
  }, ledger);
  assert.equal(accepted.valid, true);
});

test("G4-A deterministic fallback exposes partial coverage in user-facing text", () => {
  const entry = {
    evidenceId: "ev-g4",
    toolName: "unit_builds_batch",
    temporalStatus: "current",
    value: {
      itemContentionPlan: {
        status: "no_contention",
        coverageStatus: "partial",
        successfulUnitCount: 2,
        successfulUnits: [{ apiName: "Unit_A", name: "Alpha" }, { apiName: "Unit_B", name: "Beta" }],
        failedUnits: [{ unit: { apiName: "Unit_C", name: "Gamma" }, reason: "timeout" }]
      }
    }
  };
  const fallback = buildItemContentionFallback({ snapshot: () => ({ entries: [entry] }) });
  assert.deepEqual(fallback.evidenceIds, ["ev-g4"]);
  assert.match(fallback.answer, /Alpha/u);
  assert.match(fallback.answer, /Gamma/u);
  assert.match(fallback.answer, /暂未检测到共享装备竞争/u);
  assert.match(fallback.answer, /无法判断整个阵容/u);
});

test("G5 constrained batch requires and reuses an unconstrained baseline for the same unit scope", async () => {
  const entities = [{ apiName: "TFT17_Alpha", name: "Alpha" }];
  const excludedItem = "TFT_Item_Excluded";
  const unitBatchDefinition = definition("unit_builds_batch", {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entities"],
      properties: {
        entities: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["apiName"],
            properties: { apiName: { type: "string" }, name: { type: "string" } }
          }
        },
        constraints: {
          type: "object",
          additionalProperties: false,
          properties: {
            lockedItems: { type: "array", items: { type: "string" } },
            excludedItems: { type: "array", items: { type: "string" } }
          }
        }
      }
    }
  });
  const provider = queueProvider([
    call("unit_builds_batch", { entities }),
    call("unit_builds_batch", {
      entities,
      constraints: { excludedItems: [excludedItem] }
    }),
    finish(
      "The constrained query returned a new option without TFT_Item_Excluded after filtering source rows before ranking.",
      ["ev-1", "ev-2"]
    )
  ]);
  const calls = [];
  const { result, events } = await runCase({
    provider,
    input: "先看 Alpha 的基线出装，然后排除 TFT_Item_Excluded 重新查询。",
    definitions: [unitBatchDefinition],
    handlers: {
      unit_builds_batch: async (input) => {
        calls.push(structuredClone(input));
        const constrained = Boolean(input.constraints?.excludedItems?.length);
        return {
          type: "unit_builds_batch_results",
          updatedAt: "2026-08-08T00:00:00.000Z",
          query: {
            entities,
            constraints: constrained
              ? { lockedItems: [], excludedItems: [excludedItem] }
              : { lockedItems: [], excludedItems: [] }
          },
          itemContentionPlan: {
            status: "available",
            coverageStatus: "complete",
            priorityConclusion: "not_evaluated",
            contestedItems: [{
              itemRef: { apiName: "TFT_Item_Shared", name: "Shared" },
              participants: []
            }]
          },
          results: [{
            unit: entities[0],
            buildOptions: [{
              items: constrained
                ? [{ apiName: "TFT_Item_Alternative" }]
                : [{ apiName: excludedItem }, { apiName: "TFT_Item_Alternative" }]
            }],
            constraintAudit: {
              applicationMode: constrained
                ? "deterministic_source_row_filter_before_ranking"
                : "none",
              changedEligibleRowSet: constrained
            }
          }]
        };
      }
    }
  });
  assert.equal(result.status, "completed", JSON.stringify({ result, events }, null, 2));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].constraints, undefined);
  assert.deepEqual(calls[1].constraints, { excludedItems: [excludedItem] });
  assert.equal(events.some((event) => event.type === "decision_rejected"), false);
  const batchCatalog = provider.requests[0].toolCatalog.find((tool) => tool.name === "unit_builds_batch");
  assert.ok(batchCatalog.argumentPolicy.allowedKeys.includes("constraints"));
  assert.deepEqual(batchCatalog.argumentPolicy.serverScopedKeys, ["seasonContextId", "patch", "scopeKey"]);
  const affordance = provider.requests.at(-1).state.observations.at(-1).nextActionAffordance;
  assert.equal(affordance.schemaVersion, "react-next-action-affordance.v1");
  assert.equal(affordance.resultStatus, "sufficient");
  assert.equal(affordance.constraintApplied, true);
  assert.equal(affordance.recommendedAction, "finish");
  assert.equal(affordance.mechanismLookup.required, false);
  assert.deepEqual(affordance.finish.requiredEvidenceIds, ["ev-1", "ev-2"]);
});

test("unit-play fixed card affordance recommends finish after required tactical cards", async () => {
  const compsDefinition = definition("comps_rankings", {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["mention"],
      properties: { mention: { type: "string" } }
    }
  });
  const tacticalDefinition = definition("composition_tactical_details", {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["compositionId", "clusterId", "units", "seasonContextId"],
      properties: {
        compositionId: { type: "string" },
        clusterId: { type: "string" },
        units: { type: "array", items: { type: "string" } },
        seasonContextId: { type: "string" }
      }
    }
  });
  const provider = queueProvider([
    call("comps_rankings", { mention: "cluster:one" }),
    call("composition_tactical_details", {
      compositionId: "comp-one",
      clusterId: "cluster-one",
      units: ["TFT_Alpha"],
      seasonContextId: "set17-live"
    }),
    call("comps_rankings", { mention: "cluster:two" }),
    call("composition_tactical_details", {
      compositionId: "comp-two",
      clusterId: "cluster-two",
      units: ["TFT_Alpha"],
      seasonContextId: "set17-live"
    }),
    finish("已取得装备和两张阵容卡；拿到推荐装备，或者来牌多、升星顺时可以考虑玩。",
      ["ev-1", "ev-2", "ev-3", "ev-4"])
  ]);
  const tacticalPlan = (id) => ({
    status: "ready",
    compositionId: `comp-${id}`,
    clusterId: `cluster-${id}`,
    units: ["TFT_Alpha"],
    seasonContextId: "set17-live"
  });
  const { result } = await runCase({
    provider,
    input: "Alpha 怎么玩？阵容与站位用卡片展示。",
    definitions: [compsDefinition, tacticalDefinition],
    contextOverrides: {
      compositionCardScope: true,
      compositionCardsOwnPositioning: true,
      unitPlayFixedCardCompletionAffordance: true,
      unitPlayFixedCardCount: 2
    },
    handlers: {
      comps_rankings: async (input) => {
        const id = input.mention?.includes("two") ? "two" : "one";
        return {
          type: "composition_rankings",
          resolution: { status: "resolved" },
          results: [{
            compositionRef: { name: `Comp ${id}` },
            tacticalDetailQueryPlan: tacticalPlan(id)
          }],
          source: { updatedAt: "2026-08-08T00:00:00.000Z" },
          updatedAt: "2026-08-08T00:00:00.000Z"
        };
      },
      composition_tactical_details: async (input) => ({
        type: "composition_tactical_details",
        ok: true,
        compId: input.compositionId,
        clusterId: input.clusterId,
        seasonContextId: input.seasonContextId,
        formation: {
          units: [{
            apiName: "TFT_Alpha",
            name: "Alpha",
            boardPosition: { rowFromFront: 1, columnFromLeft: 1 }
          }]
        },
        source: { updatedAt: "2026-08-08T00:00:00.000Z" },
        updatedAt: "2026-08-08T00:00:00.000Z"
      })
    }
  });
  assert.equal(result.terminationReason, "completed");
  const firstTacticalObservation = provider.requests[2].state.observations.at(-1);
  assert.equal(firstTacticalObservation.tool, "composition_tactical_details");
  assert.equal(firstTacticalObservation.nextActionAffordance, undefined);
  const secondTacticalObservation = provider.requests[4].state.observations.at(-1);
  const affordance = secondTacticalObservation.nextActionAffordance;
  assert.equal(affordance.schemaVersion, "react-next-action-affordance.v1");
  assert.equal(affordance.resultStatus, "unit_play_fixed_composition_cards_complete");
  assert.equal(affordance.recommendedAction, "finish");
  assert.deepEqual(affordance.finish.requiredEvidenceIds, ["ev-1", "ev-2", "ev-3", "ev-4"]);
  assert.equal(affordance.compositionCards.positioningProseAllowed, false);
});

test("G5 lets the model repair one repeated baseline by adding the requested nested constraint", async () => {
  const entities = [{ apiName: "TFT17_Alpha", name: "Alpha" }];
  const excludedItem = "TFT_Item_Excluded";
  const unitBatchDefinition = definition("unit_builds_batch", {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entities"],
      properties: {
        entities: { type: "array", items: { type: "object", additionalProperties: true } },
        constraints: {
          type: "object",
          additionalProperties: false,
          properties: { excludedItems: { type: "array", items: { type: "string" } } }
        }
      }
    }
  });
  const provider = queueProvider([
    call("unit_builds_batch", { entities }),
    call("unit_builds_batch", { entities }),
    call("unit_builds_batch", { entities, constraints: { excludedItems: [excludedItem] } }),
    finish("The new constrained evidence excludes TFT_Item_Excluded.", ["ev-1", "ev-2"])
  ]);
  let executions = 0;
  const { result, events } = await runCase({
    provider,
    input: "先查 Alpha 基线，然后排除 TFT_Item_Excluded 再查。",
    definitions: [unitBatchDefinition],
    handlers: {
      unit_builds_batch: async (input) => {
        executions += 1;
        const constrained = Boolean(input.constraints?.excludedItems?.length);
        return {
          type: "unit_builds_batch_results",
          updatedAt: "2026-08-08T00:00:00.000Z",
          query: {
            entities,
            constraints: constrained
              ? { lockedItems: [], excludedItems: [excludedItem] }
              : { lockedItems: [], excludedItems: [] }
          },
          results: [{
            unit: entities[0],
            buildOptions: [{ items: [{ apiName: constrained ? "TFT_Item_Alternative" : excludedItem }] }],
            constraintAudit: {
              applicationMode: constrained
                ? "deterministic_source_row_filter_before_ranking"
                : "none"
            }
          }]
        };
      }
    }
  });
  assert.equal(result.status, "completed", JSON.stringify({ result, events }, null, 2));
  assert.equal(executions, 2, "the repeated baseline must remain blocked");
  const repair = events.find((event) => (
    event.type === "decision_rejected"
    && event.data.code === "duplicate_call"
  ));
  assert.equal(repair?.data.repairable, true);
  assert.match(repair?.data.errors?.join(" ") ?? "", /nested constraints/u);
});

test("G5 validates tool arguments before fingerprinting so an invalid constraint shape can be repaired", async () => {
  const entities = [{ apiName: "TFT17_Alpha", name: "Alpha" }];
  const excludedItem = "TFT_Item_Excluded";
  const unitBatchDefinition = definition("unit_builds_batch", {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entities"],
      properties: {
        entities: { type: "array", items: { type: "object", additionalProperties: true } },
        constraints: {
          type: "object",
          additionalProperties: false,
          properties: { excludedItems: { type: "array", items: { type: "string" } } }
        }
      }
    }
  });
  const provider = queueProvider([
    call("unit_builds_batch", { entities }),
    call("unit_builds_batch", { entities, excludedItems: [excludedItem] }),
    call("unit_builds_batch", { entities, constraints: { excludedItems: [excludedItem] } }),
    finish("The repaired constrained evidence excludes TFT_Item_Excluded.", ["ev-1", "ev-2"])
  ]);
  let executions = 0;
  const { result, events } = await runCase({
    provider,
    input: "先查 Alpha 基线，然后排除 TFT_Item_Excluded 再查。",
    definitions: [unitBatchDefinition],
    handlers: {
      unit_builds_batch: async (input) => {
        executions += 1;
        const constrained = Boolean(input.constraints?.excludedItems?.length);
        return {
          type: "unit_builds_batch_results",
          updatedAt: "2026-08-08T00:00:00.000Z",
          query: {
            entities,
            constraints: constrained
              ? { lockedItems: [], excludedItems: [excludedItem] }
              : { lockedItems: [], excludedItems: [] }
          },
          results: [{
            unit: entities[0],
            buildOptions: [{ items: [{ apiName: constrained ? "TFT_Item_Alternative" : excludedItem }] }]
          }]
        };
      }
    }
  });
  assert.equal(result.status, "completed", JSON.stringify({ result, events }, null, 2));
  assert.equal(executions, 2, "invalid top-level excludedItems must never reach the handler");
  const repair = events.find((event) => (
    event.type === "decision_rejected"
    && event.data.code === "invalid_tool_input"
  ));
  assert.equal(repair?.data.repairable, true);
  assert.match(repair?.data.errors?.join(" ") ?? "", /excludedItems is not allowed/u);
  assert.equal(events.some((event) => (
    event.type === "decision_rejected"
    && event.data.code === "duplicate_call"
  )), false);
});

test("G5 no-progress fallback reports the constrained evidence before generic contention evidence", async () => {
  const entities = [{ apiName: "TFT17_Alpha", name: "Alpha" }];
  const excludedItem = "TFT_Item_Excluded";
  const unitBatchDefinition = definition("unit_builds_batch", {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entities"],
      properties: {
        entities: { type: "array", items: { type: "object", additionalProperties: true } },
        constraints: {
          type: "object",
          additionalProperties: false,
          properties: { excludedItems: { type: "array", items: { type: "string" } } }
        }
      }
    }
  });
  const constrainedAction = call("unit_builds_batch", {
    entities,
    constraints: { excludedItems: [excludedItem] }
  });
  const provider = queueProvider([
    call("unit_builds_batch", { entities }),
    constrainedAction,
    constrainedAction
  ]);
  let executions = 0;
  const { result } = await runCase({
    provider,
    input: "先查 Alpha 基线，然后排除 TFT_Item_Excluded 再查。",
    definitions: [unitBatchDefinition],
    handlers: {
      unit_builds_batch: async (input) => {
        executions += 1;
        const constrained = Boolean(input.constraints?.excludedItems?.length);
        return {
          type: "unit_builds_batch_results",
          updatedAt: "2026-08-08T00:00:00.000Z",
          query: {
            entities,
            constraints: constrained
              ? { lockedItems: [], excludedItems: [excludedItem] }
              : { lockedItems: [], excludedItems: [] }
          },
          itemContentionPlan: {
            status: "available",
            contestedItems: [{
              itemRef: { apiName: "TFT_Item_Other", name: "Other" },
              participants: []
            }]
          },
          results: [{
            available: true,
            unit: { displayName: "Alpha" },
            buildOptions: [{
              items: [{ apiName: constrained ? "TFT_Item_Alternative" : excludedItem }]
            }],
            constraintAudit: constrained ? {
              eligibleBeforeConstraints: 10,
              eligibleAfterConstraints: 7
            } : null
          }]
        };
      }
    }
  });
  assert.equal(executions, 2);
  assert.equal(result.terminationReason, "duplicate_call");
  assert.equal(result.answerOrigin, "system_evidence_fallback");
  assert.match(result.answer, /TFT_Item_Excluded/u);
  assert.match(result.answer, /10→7/u);
  assert.doesNotMatch(result.answer, /Other/u);
});

test("G5 rejects a constrained batch when same-scope baseline and grounded item evidence are missing", async () => {
  const entities = [{ apiName: "TFT17_Alpha", name: "Alpha" }];
  const unitBatchDefinition = definition("unit_builds_batch", {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entities"],
      properties: {
        entities: { type: "array", items: { type: "object", additionalProperties: true } },
        constraints: {
          type: "object",
          additionalProperties: false,
          properties: {
            excludedItems: { type: "array", items: { type: "string" } }
          }
        }
      }
    }
  });
  let toolCalls = 0;
  const provider = queueProvider([
    call("unit_builds_batch", {
      entities,
      constraints: { excludedItems: ["TFT_Item_Ungrounded"] }
    }),
    finish("当前缺少同范围基线和已解析装备证据，证据不足，暂时无法可靠给出约束后的出装推荐。", [], "insufficient_evidence")
  ]);
  const { result, events } = await runCase({
    provider,
    input: "排除 TFT_Item_Ungrounded 后重新查询 Alpha。",
    definitions: [unitBatchDefinition],
    handlers: {
      unit_builds_batch: async () => {
        toolCalls += 1;
        return evidence([]);
      }
    }
  });
  assert.equal(toolCalls, 0);
  assert.equal(result.terminationReason, "insufficient_evidence");
  const rejection = events.find((event) => (
    event.type === "decision_rejected"
    && event.data.code === "invalid_unit_build_batch_constraints"
  ));
  assert.ok(rejection);
  assert.match(rejection.data.errors.join(" "), /prior resolved item or build evidence/u);
  assert.match(rejection.data.errors.join(" "), /prior unconstrained evidence/u);
});

test("R1-12 tool calls are unbounded while the decision fuse remains", async (t) => {
  await t.test("tool-call count is observability, not a completion budget", async () => {
    let calls = 0;
    const provider = queueProvider([
      call("comps_rankings", { patch: "1" }),
      call("comps_rankings", { patch: "2" }),
      call("comps_rankings", { patch: "3" }),
      call("comps_rankings", { patch: "4" }),
      finish("查询链已完成。", [], "direct_answer")
    ]);
    const { result } = await runCase({
      provider,
      handlers: {
        comps_rankings: async (input) => {
          calls += 1;
          return evidence([{ patch: input.patch }]);
        }
      },
      budget: { maxDecisions: 6, maxToolCalls: 1 }
    });
    assert.equal(result.terminationReason, "completed");
    assert.equal(calls, 4);
    assert.equal(result.safetyMetrics.actualToolCalls, 4);
    assert.equal(result.safetyMetrics.uniqueToolFingerprints, 4);
  });

  await t.test("decision count is only a runaway-loop fuse", async () => {
    const provider = queueProvider([
      call("comps_rankings", { patch: "1" }),
      call("comps_rankings", { patch: "2" }),
      finish("不应执行到这里。", [], "direct_answer")
    ]);
    const { result } = await runCase({
      provider,
      handlers: { comps_rankings: async (input) => evidence([{ patch: input.patch }]) },
      budget: { maxDecisions: 2, maxToolCalls: 10 }
    });
    assert.equal(result.terminationReason, "runaway_loop_fuse");
    assert.equal(result.status, "completed_with_warning");
    assert.match(result.answer, /连续步骤|有效证据/u);
    assert.equal(provider.requests.length, 2);
  });
});
