import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createReactDecisionProvider } from "../src/react/react-decision-provider.js";

test("opt-in tactical presentation changes only two presentation rules, preserving catalog, control and default prompt", async () => {
  for (const messageLayout of ["append_only", "legacy_full_state"]) {
    const bodies = [];
    const action = { schemaVersion: "react-action.v1", type: "finish", answer: "当前资料不足。",
      evidenceIds: [], reasonCode: "insufficient_evidence", narrative: null };
    const request = { state: { question: "沃里克怎么玩？", tacticalPresentationScope: true,
      transcript: [{ type: "runtime_state", value: { nextActionAffordance: { recommendedAction: "finish" } } }] },
      toolCatalog: [{ name: "unit_details", inputSchema: { type: "object", additionalProperties: false } }] };
    for (const tacticalPresentationScope of [undefined, false, true, "true"]) {
      const provider = createReactDecisionProvider({ endpoint: "https://example.test", model: "test", messageLayout,
        tacticalPresentationScope, fetchImpl: async (_url, init) => {
          bodies.push(JSON.parse(init.body));
          return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(action) } }] }) };
        } });
      assert.deepEqual((await provider(request)).action, action);
    }
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(bodies[0], bodies[3]); // Request data and truthy strings cannot enable it.
    const baseline = bodies[0].messages[0].content.split("\n");
    const candidate = bodies[2].messages[0].content.split("\n");
    assert.equal(candidate.length, baseline.length);
    assert.equal(candidate.filter((line, index) => line !== baseline[index]).length, 2);
    assert.match(candidate.join("\n"), /Missing requested formation must be disclosed/);
    assert.match(candidate.join("\n"), /only when augments were requested/);
    assert.match(candidate.join("\n"), /execute callTool exactly as provided/);
    const versionNeutral = (body) => body.messages.slice(1).map(message => ({ ...message,
      content: message.content.replaceAll("react-decision-contract.v5.tactical-presentation.v1", "react-decision-contract.v5") }));
    assert.deepEqual(versionNeutral(bodies[0]), versionNeutral(bodies[2]));
    assert.equal(bodies[0].max_tokens, bodies[2].max_tokens);
  }
});

test("ordinary-only follow-ups get current scope guidance in both provider layouts", async () => {
  for (const messageLayout of ["append_only", "legacy_full_state"]) {
    for (const question of ["不含特殊装备", "修改为只包含普通装备", "改为近3天", "改为近7天"]) {
      let body;
      const provider = createReactDecisionProvider({
        endpoint: "https://example.test/chat/completions", model: "test-model", messageLayout,
        fetchImpl: async (_url, options) => {
          body = JSON.parse(options.body);
          return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
            schemaVersion: "react-action.v1", type: "call_tool", tool: "unit_builds",
            arguments: { unit: "DA_18_Aphelios", itemPolicy: "ordinary_only" }, purposeCode: "retrieve_current_statistics"
          }) } }] }) };
        }
      });
      await provider({ state: { question, evidence: [], messages: [
        { role: "user", content: "厄斐琉斯已有斗转和羊刀" },
        ...(question === "改为近7天" ? [
          { role: "user", content: "第三件只要普通装备" },
          { role: "assistant", content: "包含特殊装备" }
        ] : [])
      ],
        bridgeContext: { relation: "modify", records: [{ operation: "unit_build_completion" }] } },
        toolCatalog: [{ name: "unit_builds", inputSchema: { type: "object" } }] });
      if (question === "改为近3天") {
        const guidance = body.messages.find(message => message.content.includes("equipment-completion-guidance.v1"));
        assert.match(guidance?.content ?? "", /never unit_builds_batch/);
        assert.match(guidance.content, /Do not lock the recommended third item/);
        continue;
      }
      const guidance = body.messages.find(message => message.content.includes("equipment-category-guidance.v1"));
      assert.match(guidance?.content ?? "", /"itemPolicy":"ordinary_only"/u);
      assert.match(guidance.content, /does not change complete builds into single-item rankings/u);
      assert.match(guidance.content, /Re-query current unit_builds evidence/u);
      assert.match(guidance.content, /ordinary-only restricts the NEW remaining items/u);
      assert.match(guidance.content, /retain all lockedItems even when they are special/u);
    }
  }
});

test("react decision provider sends bounded state and returns a validated action", async () => {
  let observedBody;
  const provider = createReactDecisionProvider({
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    apiKey: "secret",
    fetchImpl: async (_url, options) => {
      observedBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  schemaVersion: "react-action.v1",
                  type: "call_tool",
                  tool: "unit_details",
                  arguments: { apiName: "TFT18_Xayah" },
                  purposeCode: "retrieve_entity_details"
                })
              }
            }],
            usage: { prompt_tokens: 20, completion_tokens: 10 }
          };
        }
      };
    }
  });
  const response = await provider({
    state: { question: "霞的技能是什么？", evidence: [] },
    toolCatalog: [{ name: "unit_details", inputSchema: { type: "object" } }]
  });
  assert.equal(response.action.type, "call_tool");
  assert.equal(response.action.tool, "unit_details");
  assert.equal(observedBody.model, "test-model");
  assert.equal(observedBody.response_format.type, "json_object");
  assert.match(observedBody.messages[0].content, /call_tool, ask_user, or finish/u);
  assert.match(observedBody.messages[0].content, /entity_catalog_query with entityType and filters\.names/u);
  assert.match(observedBody.messages[0].content, /call unit_builds/u);
  assert.match(observedBody.messages[0].content, /call item_details once for every compared item's exact resolved apiName/u);
  assert.match(observedBody.messages[0].content, /single-item ranking/u);
  assert.match(observedBody.messages[0].content, /comparisonItems/u);
  assert.match(observedBody.messages[0].content, /call comps_analysis/u);
  assert.match(observedBody.messages[0].content, /call comps_rankings with the concise composition mention/u);
  assert.match(observedBody.messages[0].content, /itemized_core_candidate proves only/u);
  assert.match(observedBody.messages[0].content, /composition_replacement_evaluation/u);
  assert.match(observedBody.messages[0].content, /composition_change_evaluation/u);
  assert.match(observedBody.messages[0].content, /add requires incomingApiName only/u);
  assert.match(observedBody.messages[0].content, /Never calculate composition trait counts or breakpoint changes yourself/u);
  assert.match(observedBody.messages[0].content, /not_evaluated/u);
  assert.match(observedBody.messages[0].content, /structured invalid status/u);
  assert.match(observedBody.messages[0].content, /Do not use direct_answer/u);
  assert.match(observedBody.messages[0].content, /itemContentionQueryPlan/u);
  assert.match(observedBody.messages[0].content, /itemContentionPlan\.status=available/u);
  assert.match(observedBody.messages[0].content, /coverageStatus=partial/u);
  assert.match(observedBody.messages[0].content, /whole composition may contain additional unobserved conflicts/u);
  assert.match(observedBody.messages[0].content, /priorityConclusion=not_evaluated/u);
  assert.match(observedBody.messages[0].content, /never repeat the baseline call/u);
  assert.match(observedBody.messages[0].content, /"constraints":\{"excludedItems"/u);
  assert.match(observedBody.messages[0].content, /unit_builds_batch receives its season, patch, and request scope from the server/u);
  assert.match(observedBody.messages[0].content, /nextActionAffordance/u);
  assert.match(observedBody.messages[0].content, /recommendedAction=finish/u);
  assert.match(observedBody.messages[0].content, /mechanismLookup\.required=true/u);
  assert.match(observedBody.messages[0].content, /never guess apiName/iu);
});

test("react decision provider deterministically preserves an explicit dual video ecosystem request", async () => {
  const provider = createReactDecisionProvider({
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: JSON.stringify({
            schemaVersion: "react-action.v1",
            type: "call_tool",
            tool: "strategy_video_search",
            arguments: { query: "九五阵容攻略" },
            purposeCode: "retrieve_supporting_knowledge"
          }) } }]
        };
      }
    })
  });
  const response = await provider({
    state: { question: "分别找云顶之弈和金铲铲的九五攻略", messages: [], evidence: [] },
    toolCatalog: [{
      name: "strategy_video_search",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          ecosystem: { type: "string", enum: ["tft_pc", "golden_spatula", "both"] }
        },
        required: ["query"]
      }
    }]
  });
  assert.equal(response.action.arguments.ecosystem, "both");
});

test("react decision provider keeps the stable contract and run context as an append-only prefix", async () => {
  const bodies = [];
  const provider = createReactDecisionProvider({
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: JSON.stringify({
              schemaVersion: "react-action.v1",
              type: "finish",
              answer: "已完成。",
              evidenceIds: [],
              reasonCode: "direct_answer",
              narrative: null
            }) } }]
          };
        }
      };
    }
  });
  const toolCatalog = [{
    name: "unit_details",
    inputSchema: { type: "object", properties: { apiName: { type: "string" } } }
  }];
  const initialState = {
    question: "霞的技能是什么？",
    seasonContextId: "set17-live",
    messages: [],
    taskAnchor: null,
    bridgeContext: null,
    evidence: [],
    transcript: [{
      type: "runtime_state",
      value: {
        iteration: 1,
        decisionCount: 0,
        toolCallCount: 0,
        remainingBudget: { decisions: 8, toolCalls: null },
        warnings: []
      }
    }]
  };
  await provider({ state: initialState, toolCatalog });
  await provider({
    state: {
      ...initialState,
      iteration: 2,
      decisionCount: 1,
      evidence: [{ evidenceId: "ev-1", temporalStatus: "current", value: { spell: "羽刃" } }],
      transcript: [
        initialState.transcript[0],
        {
          type: "decision",
          value: {
            schemaVersion: "react-action.v1",
            type: "call_tool",
            tool: "unit_details",
            arguments: { apiName: "TFT17_Xayah" },
            purposeCode: "retrieve_entity_details"
          }
        },
        {
          type: "observation",
          value: {
            type: "tool_result",
            evidenceId: "ev-1",
            value: { spell: "羽刃" },
            evidence: {
              evidenceId: "ev-1",
              type: "unit_details",
              source: "test",
              updatedAt: "2026-08-10T00:00:00.000Z",
              value: { spell: "羽刃" }
            }
          }
        },
        {
          type: "runtime_state",
          value: {
            iteration: 2,
            decisionCount: 1,
            toolCallCount: 1,
            remainingBudget: { decisions: 7, toolCalls: null },
            warnings: []
          }
        }
      ]
    },
    toolCatalog
  });

  assert.equal(bodies[0].messages.length, 4);
  assert.deepEqual(bodies[1].messages.slice(0, bodies[0].messages.length), bodies[0].messages);
  const stableContext = JSON.parse(bodies[0].messages[1].content);
  assert.equal(stableContext.schemaVersion, "react-stable-context.v1");
  assert.deepEqual(stableContext.toolCatalog, toolCatalog);
  const runContext = JSON.parse(bodies[0].messages[2].content);
  assert.equal(runContext.schemaVersion, "react-run-context.v1");
  assert.equal(runContext.iteration, undefined);
  const initialRuntimeState = JSON.parse(bodies[0].messages[3].content);
  assert.equal(initialRuntimeState.type, "runtime_state");
  assert.match(initialRuntimeState.instruction, /react-action\.v1/u);
  assert.equal(bodies[1].messages[4].role, "assistant");
  assert.equal(bodies[1].messages[5].role, "user");
  assert.equal(bodies[1].messages[6].role, "user");
  const observation = JSON.parse(bodies[1].messages[5].content);
  assert.equal(observation.value.value, undefined);
  assert.equal(observation.value.evidence.evidenceId, "ev-1");
});

test("react decision provider renders bounded broad unit-play semantic guidance", async () => {
  let body = null;
  const provider = createReactDecisionProvider({
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: JSON.stringify({
              schemaVersion: "react-action.v1",
              type: "finish",
              answer: "装备、阵容、站位和运营建议。",
              evidenceIds: [],
              reasonCode: "direct_answer",
              narrative: null
            }) } }]
          };
        }
      };
    }
  });
  const semanticAdvisory = {
    action: "recommend",
    goal: "recommend_unit_play",
    subject: {
      resolvedId: "DA_18_Warwick",
      canonicalName: "沃里克"
    },
    expectedOutput: ["unit_play_guidance"]
  };

  await provider({
    state: {
      question: "沃里克怎么玩？",
      messages: [],
      semanticAdvisory,
      evidence: [],
      transcript: []
    },
    toolCatalog: []
  });

  const runContext = JSON.parse(body.messages[2].content);
  assert.deepEqual(runContext.semanticAdvisory, semanticAdvisory);
  assert.match(runContext.semanticGuidance, /semantic guidance, not an execution plan/iu);
  assert.match(runContext.semanticGuidance, /do not reduce this broad request to equipment-only guidance/iu);
  assert.match(runContext.semanticGuidance, /composition context, positioning, and when\/how to play/iu);
  assert.match(runContext.semanticGuidance, /do not invent statistics/iu);
  assert.match(runContext.semanticGuidance, /do not search for a video unless the user explicitly asks/iu);
  assert.doesNotMatch(runContext.semanticGuidance, /only use these three tools/iu);
  assert.equal(Object.hasOwn(runContext.semanticAdvisory, "capabilityRequirements"), false);
  assert.equal(Object.hasOwn(runContext, "taskFrame"), false);
});

test("default guidance renderer preserves the pre-seam serialized messages byte-for-byte", async () => {
  let body = null;
  const provider = createReactDecisionProvider({
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: JSON.stringify({
              schemaVersion: "react-action.v1",
              type: "finish",
              answer: "ok",
              evidenceIds: [],
              reasonCode: "direct_answer",
              narrative: null
            }) } }]
          };
        }
      };
    }
  });
  await provider({
    state: {
      question: "沃里克怎么玩？",
      messages: [],
      seasonContextId: "set17-live",
      taskAnchor: null,
      bridgeContext: null,
      semanticAdvisory: {
        action: "recommend",
        goal: "recommend_unit_play",
        subject: { resolvedId: "DA_18_Warwick", canonicalName: "沃里克" },
        expectedOutput: ["unit_play_guidance"]
      },
      evidence: [],
      transcript: []
    },
    toolCatalog: []
  });
  const hash = createHash("sha256").update(JSON.stringify(body.messages)).digest("hex");
  assert.equal(hash, "45eb4dd0b17540e2aa5cb5284c42862da6336f8d3601c8af8ce71102e4007cb0");
});

test("custom guidance renderer replaces only the bounded professional guidance value", async () => {
  const bodies = [];
  const received = [];
  const response = {
    ok: true,
    async json() {
      return {
        choices: [{ message: { content: JSON.stringify({
          schemaVersion: "react-action.v1",
          type: "finish",
          answer: "ok",
          evidenceIds: [],
          reasonCode: "direct_answer",
          narrative: null
        }) } }]
      };
    }
  };
  const options = {
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    fetchImpl: async (_url, request) => {
      bodies.push(JSON.parse(request.body));
      return response;
    }
  };
  const baseline = createReactDecisionProvider(options);
  const candidate = createReactDecisionProvider({
    ...options,
    guidanceRenderer: (advisory) => {
      received.push(advisory);
      return "candidate-guidance-v1";
    }
  });
  const semanticAdvisory = {
    action: "recommend",
    goal: "recommend_unit_play",
    subject: { resolvedId: "DA_18_Warwick", canonicalName: "沃里克" },
    expectedOutput: ["unit_play_guidance"]
  };
  const request = {
    state: { question: "沃里克怎么玩？", messages: [], semanticAdvisory, evidence: [], transcript: [] },
    toolCatalog: []
  };
  await baseline(request);
  await candidate(request);
  assert.deepEqual(received, [semanticAdvisory]);
  const baselineRunContext = JSON.parse(bodies[0].messages[2].content);
  const candidateRunContext = JSON.parse(bodies[1].messages[2].content);
  assert.notEqual(baselineRunContext.semanticGuidance, candidateRunContext.semanticGuidance);
  assert.equal(candidateRunContext.semanticGuidance, "candidate-guidance-v1");
  baselineRunContext.semanticGuidance = candidateRunContext.semanticGuidance;
  assert.deepEqual(candidateRunContext, baselineRunContext);
  assert.deepEqual(bodies[1].messages.filter((_, index) => index !== 2), bodies[0].messages.filter((_, index) => index !== 2));
});

test("guidance renderer option fails closed when it is not a function", () => {
  assert.throws(() => createReactDecisionProvider({
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    guidanceRenderer: "candidate"
  }), /guidanceRenderer must be a function/u);
});

test("guidance renderer output fails closed before transport when it is not text", async () => {
  let transportCalls = 0;
  const provider = createReactDecisionProvider({
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    guidanceRenderer: () => ({ instructions: [] }),
    fetchImpl: async () => {
      transportCalls += 1;
      throw new Error("transport must not run");
    }
  });
  await assert.rejects(() => provider({ state: { semanticAdvisory: {} }, toolCatalog: [] }), /must return a string or null/u);
  assert.equal(transportCalls, 0);
});

test("react decision provider maps DeepSeek cache usage and labels request telemetry", async () => {
  const events = [];
  const provider = createReactDecisionProvider({
    endpoint: "https://api.deepseek.test/chat/completions",
    model: "deepseek-v4-flash",
    onRequestLog: (event) => events.push(event),
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: JSON.stringify({
            schemaVersion: "react-action.v1",
            type: "finish",
            answer: "已完成。",
            evidenceIds: [],
            reasonCode: "direct_answer",
            narrative: null
          }) } }],
          usage: {
            prompt_tokens: 256,
            prompt_cache_hit_tokens: 192,
            prompt_cache_miss_tokens: 64,
            completion_tokens: 12
          }
        };
      }
    })
  });

  const response = await provider({ state: { transcript: [] }, toolCatalog: [] });
  assert.deepEqual(response.telemetry.usage, {
    cachedInputTokens: 192,
    uncachedInputTokens: 64,
    outputTokens: 12
  });
  assert.equal(response.telemetry.requestKind, "react_decision");
  assert.equal(events[0].requestKind, "react_decision");
});

test("legacy benchmark layout reproduces the full-state request without transcript duplication", async () => {
  const bodies = [];
  const provider = createReactDecisionProvider({
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    messageLayout: "legacy_full_state",
    cacheNamespace: "legacy-benchmark",
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: JSON.stringify({
              schemaVersion: "react-action.v1",
              type: "finish",
              answer: "完成。",
              evidenceIds: [],
              reasonCode: "direct_answer",
              narrative: null
            }) } }]
          };
        }
      };
    }
  });

  await provider({
    state: {
      question: "缓存测试",
      iteration: 2,
      observations: [{ type: "tool_result", value: { ok: true } }],
      transcript: [{ type: "runtime_state", value: { iteration: 2 } }]
    },
    toolCatalog: []
  });

  assert.equal(provider.messageLayout, "legacy_full_state");
  assert.equal(bodies[0].messages.length, 2);
  assert.match(bodies[0].messages[0].content, /^\[cache-namespace:legacy-benchmark\]/u);
  const dynamicRequest = JSON.parse(bodies[0].messages[1].content);
  assert.equal(dynamicRequest.state.iteration, 2);
  assert.equal(dynamicRequest.state.transcript, undefined);
  assert.equal(dynamicRequest.state.observations.length, 1);
});

test("react decision provider rejects model-invented tools", async () => {
  let calls = 0;
  const provider = createReactDecisionProvider({
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    fetchImpl: async () => {
      calls += 1;
      return ({
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                schemaVersion: "react-action.v1",
                type: "call_tool",
                tool: "shell",
                arguments: {},
                purposeCode: "other"
              })
            }
          }]
        };
      }
      });
    }
  });
  await assert.rejects(
    () => provider({ state: {}, toolCatalog: [{ name: "unit_details" }] }),
    /tool is not registered/u
  );
  assert.equal(calls, 2);
});

test("react decision provider retries malformed JSON with a compact repair instruction", async () => {
  const bodies = [];
  const events = [];
  const provider = createReactDecisionProvider({
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    onRequestLog: (event) => events.push(event),
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      const content = bodies.length === 1
        ? '{"schemaVersion":"react-action.v1","type":"finish"'
        : JSON.stringify({
          schemaVersion: "react-action.v1",
          type: "finish",
          answer: "当前证据不足，暂时无法可靠回答。",
          evidenceIds: [],
          reasonCode: "insufficient_evidence",
          narrative: null
        });
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content } }],
            usage: {
              prompt_cache_hit_tokens: bodies.length === 1 ? 0 : 128,
              prompt_cache_miss_tokens: bodies.length === 1 ? 128 : 16,
              completion_tokens: 8
            }
          };
        }
      };
    }
  });

  const response = await provider({ state: {}, toolCatalog: [] });
  assert.equal(response.action.type, "finish");
  assert.equal(response.telemetry.attempts, 2);
  assert.equal(bodies[0].max_tokens, 1800);
  assert.equal(bodies[1].max_tokens, 700);
  assert.match(bodies[1].messages.at(-1).content, /narrative 设为 null/u);
  const repairedRequest = JSON.parse(bodies[1].messages.at(-1).content);
  assert.match(repairedRequest.instruction, /精简/u);
  assert.equal(events[0].status, "retry");
  assert.deepEqual(events[0].usage, {
    cachedInputTokens: 0,
    uncachedInputTokens: 128,
    outputTokens: 8
  });
});
