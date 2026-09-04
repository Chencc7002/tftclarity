import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";
import { ToolExecutor } from "../src/agent/tools/executor.js";
import { ToolRegistry } from "../src/agent/tools/registry.js";
import { createSmallWindowRuntime, handleReactChatRequest } from "../src/app/small-window-server.js";
import { createReactDecisionProvider } from "../src/react/react-decision-provider.js";
import { SkillRegistry } from "../src/skills/registry.js";
import { UNIT_PLAY_GUIDANCE_SKILL_V1_5_11 } from "../src/skills/definitions/unit-play-guidance.js";
import {
  prepareUnitPlayCandidateControl,
  resolveUnitPlayCandidateControl,
  UNIT_PLAY_CANDIDATE_CONTROL_SELECTOR,
  UNIT_PLAY_CANDIDATE_RENDERED_CONTEXT_SHA256,
  UNIT_PLAY_CANDIDATE_SKILL_SHA256
} from "../src/skills/unit-play-control.js";
import { MemoryCacheStore } from "../src/index.js";
import { createForwardFrozenReplayHandlers } from "../src/experiments/unit-play-guidance-forward/canonical.js";
import { taskFrameFromCase } from "../src/experiments/unit-play-guidance-control/harness.js";

const taskFrame = Object.freeze({
  schemaVersion: "task-frame.v1",
  domain: "tft",
  action: "recommend",
  goal: "recommend_unit_play",
  subjects: [{ expectedType: "champion", resolvedId: "DA_18_Warwick", canonicalName: "沃里克" }],
  candidates: [],
  concepts: [],
  constraints: [],
  expectedOutput: ["unit_play_guidance"],
  ambiguityPolicy: "clarify_if_blocking",
  ambiguities: [],
  assumptions: [],
  understandingStatus: "understood_and_supported"
});

function candidateControl() {
  const toolRegistry = new ToolRegistry(createStructuredToolDefinitions());
  const registry = new SkillRegistry({ definitions: [UNIT_PLAY_GUIDANCE_SKILL_V1_5_11], toolRegistry });
  return prepareUnitPlayCandidateControl({
    taskFrame,
    registry,
    runtimeAvailableTools: UNIT_PLAY_GUIDANCE_SKILL_V1_5_11.allowedTools
  });
}

test("single-user control requires the exact candidate selector and frozen Skill identity", () => {
  for (const value of [undefined, "off", "on", "unit_play_guidance@1.5.10", "other@1.5.11"]) {
    const resolved = resolveUnitPlayCandidateControl(value, UNIT_PLAY_GUIDANCE_SKILL_V1_5_11);
    assert.equal(resolved.enabled, false);
  }
  const resolved = resolveUnitPlayCandidateControl(
    UNIT_PLAY_CANDIDATE_CONTROL_SELECTOR,
    UNIT_PLAY_GUIDANCE_SKILL_V1_5_11
  );
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.diagnostic, null);
});

test("candidate preparation reproduces the accepted v6 hashes and exact Tool intersection", () => {
  const prepared = candidateControl();
  assert.equal(prepared.active, true);
  assert.equal(prepared.skillVersion, "1.5.11");
  assert.equal(prepared.skillContentSha256, UNIT_PLAY_CANDIDATE_SKILL_SHA256);
  assert.equal(prepared.renderedContextSha256, UNIT_PLAY_CANDIDATE_RENDERED_CONTEXT_SHA256);
  assert.deepEqual(prepared.effectiveTools, [...UNIT_PLAY_GUIDANCE_SKILL_V1_5_11.allowedTools].sort());
  assert.equal(JSON.parse(prepared.renderedGuidance).skillContext.skillVersion, "1.5.11");
});

test("missing one frozen candidate Tool disables control instead of widening or partially activating it", () => {
  const toolRegistry = new ToolRegistry(createStructuredToolDefinitions());
  const registry = new SkillRegistry({ definitions: [UNIT_PLAY_GUIDANCE_SKILL_V1_5_11], toolRegistry });
  const prepared = prepareUnitPlayCandidateControl({
    taskFrame,
    registry,
    runtimeAvailableTools: UNIT_PLAY_GUIDANCE_SKILL_V1_5_11.allowedTools.filter((name) => (
      name !== "composition_tactical_details"
    ))
  });
  assert.equal(prepared.active, false);
  assert.equal(prepared.reason, "candidate_runtime_profile_mismatch");
  assert.equal(prepared.effectiveTools.includes("composition_tactical_details"), false);
});

test("small-window control is default off and an invalid selector preserves the legacy broad-play path", async () => {
  let providerRequest = null;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    agentSkillsUnitPlayControlV1: "on",
    reactDecisionProvider: async (request) => {
      providerRequest = request;
      return { schemaVersion: "react-action.v1", type: "finish", answer: "旧路径",
        evidenceIds: [], reasonCode: "direct_answer" };
    }
  });
  const { payload } = await handleReactChatRequest({ input: "沃里克怎么玩？", locale: "zh-CN",
    seasonContextId: "set18-live" }, runtime);
  assert.equal(runtime.agentSkillsUnitPlayControlV1, false);
  assert.equal(runtime.agentSkillUnitPlayControlDiagnostic, "invalid_candidate_control_selector");
  assert.equal(runtime.agentSkillCandidateShadowDiagnostic, null);
  assert.equal(providerRequest.state.question, "沃里克推荐出装");
  assert.equal(Object.hasOwn(providerRequest, "candidateDecisionProfile"), false);
  assert.equal(payload.answer, "旧路径");
});

test("exact selector activates 1.5.11 only for broad unit play and keeps Skill content out of public state", async () => {
  const controlEvents = [];
  let providerRequest = null;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    agentSkillsUnitPlayControlV1: UNIT_PLAY_CANDIDATE_CONTROL_SELECTOR,
    onAgentSkillControl: (event) => { controlEvents.push(event); },
    reactDecisionProvider: async (request) => {
      providerRequest = request;
      return { schemaVersion: "react-action.v1", type: "finish",
        answer: "当前证据不足，暂时无法可靠回答。", evidenceIds: [], reasonCode: "insufficient_evidence" };
    }
  });
  const { statusCode, payload } = await handleReactChatRequest({ input: "沃里克怎么玩？", locale: "zh-CN",
    seasonContextId: "set18-live" }, runtime);
  assert.equal(statusCode, 200);
  assert.equal(runtime.agentSkillsUnitPlayControlV1, true);
  assert.equal(runtime.agentSkillsUnitPlayControlOperational, true);
  assert.equal(providerRequest.state.question, "沃里克怎么玩？");
  assert.equal(providerRequest.candidateDecisionProfile.schemaVersion,
    "unit-play-candidate-decision-profile.v1");
  assert.equal(providerRequest.candidateDecisionProfile.tacticalPresentationScope, true);
  assert.equal(providerRequest.candidateDecisionProfile.decisionMessages, "action");
  assert.equal(providerRequest.candidateDecisionProfile.observationProjection.targetUnitId, "DA_18_Warwick");
  assert.deepEqual(providerRequest.toolCatalog.map(({ name }) => name).sort(),
    [...UNIT_PLAY_GUIDANCE_SKILL_V1_5_11.allowedTools].sort());
  assert.equal(payload.compositionCardScope, true);
  assert.equal(JSON.stringify(payload).includes("skillContext"), false);
  assert.equal(JSON.stringify(payload).includes(UNIT_PLAY_CANDIDATE_SKILL_SHA256), false);
  assert.equal(controlEvents.some((event) => event.stage === "started" && event.active), true);
  assert.equal(controlEvents.some((event) => event.stage === "completed" && event.active), true);
});

test("candidate decision profile injects the frozen guidance and projects only model input", async () => {
  const prepared = candidateControl();
  let providerPayload = null;
  const provider = createReactDecisionProvider({
    endpoint: "https://example.test/chat/completions",
    model: "test-model",
    fetchImpl: async (_url, init) => {
      providerPayload = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          schemaVersion: "react-action.v1", type: "finish", answer: "完成",
          evidenceIds: [], reasonCode: "direct_answer"
        }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  await provider({
    state: {
      question: "沃里克怎么玩？",
      seasonContextId: "set18-live",
      messages: [],
      taskAnchor: null,
      bridgeContext: null,
      semanticAdvisory: {
        goal: "recommend_unit_play",
        subject: { resolvedId: "DA_18_Warwick", canonicalName: "沃里克" }
      },
      evidence: [],
      transcript: [
        { type: "decision", value: { schemaVersion: "react-action.v1", type: "call_tool",
          tool: "unit_builds", arguments: { unit: "DA_18_Warwick" }, purposeCode: "retrieve_current_statistics" } },
        { type: "observation", value: { type: "tool_result", tool: "unit_builds", status: "completed",
          value: { type: "unit_builds", secret: "must-not-reach-model", cards: [
            { title: "one", items: [] }, { title: "two", items: [] }
          ] } } }
      ]
    },
    toolCatalog: createStructuredToolDefinitions().filter(({ name }) => (
      UNIT_PLAY_GUIDANCE_SKILL_V1_5_11.allowedTools.includes(name)
    )),
    candidateDecisionProfile: prepared.decisionProfile
  });
  const runContext = providerPayload.messages.map((message) => {
    try { return JSON.parse(message.content); } catch { return null; }
  }).find((value) => value?.schemaVersion === "react-run-context.v1");
  const assistant = providerPayload.messages.find((message) => message.role === "assistant");
  const observation = providerPayload.messages.map((message) => {
    try { return JSON.parse(message.content); } catch { return null; }
  }).find((value) => value?.schemaVersion === "react-transcript-event.v1" && value.type === "observation");
  assert.equal(runContext.semanticGuidance, prepared.renderedGuidance);
  assert.equal(JSON.parse(assistant.content).schemaVersion, "react-action.v1");
  assert.equal(JSON.parse(assistant.content).type, "call_tool");
  assert.equal(observation.value.value.cards.length, 1);
  assert.equal(Object.hasOwn(observation.value.value, "secret"), false);
});

test("narrow equipment queries never receive candidate control", async () => {
  let providerRequest = null;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    agentSkillsUnitPlayControlV1: UNIT_PLAY_CANDIDATE_CONTROL_SELECTOR,
    reactDecisionProvider: async (request) => {
      providerRequest = request;
      return { schemaVersion: "react-action.v1", type: "finish", answer: "原路径",
        evidenceIds: [], reasonCode: "direct_answer" };
    }
  });
  await handleReactChatRequest({ input: "沃里克推荐什么装备？", locale: "zh-CN",
    seasonContextId: "set18-live" }, runtime);
  assert.equal(providerRequest.state.question, "沃里克推荐什么装备？");
  assert.equal(Object.hasOwn(providerRequest, "candidateDecisionProfile"), false);
});

test("production control seam completes the frozen two-card Tool sequence without a Provider", async () => {
  const corpus = JSON.parse(readFileSync(new URL(
    "../eval/skills/unit-play-guidance-forward/corpus.v2.json",
    import.meta.url
  ), "utf8"));
  const observations = JSON.parse(readFileSync(new URL(
    "../eval/skills/unit-play-guidance-forward/tool-observations.v2.json",
    import.meta.url
  ), "utf8"));
  const evalCase = corpus.positive[0];
  const frozenTaskFrame = taskFrameFromCase(evalCase);
  const fixture = observations.units[evalCase.unitApiName];
  const cards = fixture.cards.slice(0, 2);
  const cardPlan = (card) => card.resolvedComps.value.results.find((entry) => (
    entry.compositionRef?.compId === card.candidate?.compositionRef?.compId
  ))?.tacticalDetailQueryPlan ?? card.resolvedComps.value.results[0].tacticalDetailQueryPlan;
  const actions = [
    { tool: "unit_details", arguments: { apiName: evalCase.unitApiName }, purposeCode: "retrieve_entity_details" },
    { tool: "unit_builds", arguments: { unit: evalCase.unitApiName }, purposeCode: "retrieve_current_statistics" },
    { tool: "item_details_batch", arguments: {
      apiNames: fixture.unitBuilds.value.mechanismQueryPlan.apiNames,
      seasonContextId: fixture.unitBuilds.value.mechanismQueryPlan.seasonContextId
    }, purposeCode: "retrieve_entity_details" },
    { tool: "comps_rankings", arguments: { unit: evalCase.unitApiName }, purposeCode: "retrieve_current_statistics" },
    { tool: "comps_rankings", arguments: { mention: cards[0].candidate.compositionRef.compId },
      purposeCode: "retrieve_current_statistics" },
    { tool: "composition_tactical_details", arguments: {
      compositionId: cardPlan(cards[0]).compositionId,
      clusterId: cardPlan(cards[0]).clusterId,
      units: cardPlan(cards[0]).units,
      seasonContextId: cardPlan(cards[0]).seasonContextId
    }, purposeCode: "retrieve_current_statistics" },
    { tool: "comps_rankings", arguments: { mention: cards[1].candidate.compositionRef.compId },
      purposeCode: "retrieve_current_statistics" },
    { tool: "composition_tactical_details", arguments: {
      compositionId: cardPlan(cards[1]).compositionId,
      clusterId: cardPlan(cards[1]).clusterId,
      units: cardPlan(cards[1]).units,
      seasonContextId: cardPlan(cards[1]).seasonContextId
    }, purposeCode: "retrieve_current_statistics" }
  ];
  let decisionIndex = 0;
  const telemetry = { accesses: [] };
  const frozenNow = Date.parse(observations.frozenAt) + 1;
  const toolRegistry = new ToolRegistry(createStructuredToolDefinitions());
  let toolId = 0;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    toolRegistry,
    toolExecutor: new ToolExecutor({
      registry: toolRegistry,
      createId: () => `candidate-control-tool-${++toolId}`,
      now: () => frozenNow
    }),
    reactNow: () => frozenNow,
    agentSkillsUnitPlayControlV1: UNIT_PLAY_CANDIDATE_CONTROL_SELECTOR,
    parseSemanticTask: async () => ({ taskFrame: frozenTaskFrame }),
    reactToolHandlers: createForwardFrozenReplayHandlers(evalCase, observations, telemetry),
    reactGroundingMode: "strict",
    reactDecisionProvider: async (request) => {
      if (decisionIndex < actions.length) {
        const next = actions[decisionIndex++];
        return { schemaVersion: "react-action.v1", type: "call_tool", ...next };
      }
      decisionIndex += 1;
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "韦鲁斯是远程物理输出，技能可打击多个目标。来源推荐装备主要提供攻击、暴击和持续输出；拿到这些推荐装备，或者韦鲁斯来牌多、升星顺时，可以考虑玩。",
        evidenceIds: request.state.evidence.map(({ evidenceId }) => evidenceId),
        reasonCode: "sufficient_evidence",
        narrative: null
      };
    }
  });
  const { statusCode, payload } = await handleReactChatRequest({
    input: evalCase.input,
    locale: evalCase.language,
    seasonContextId: observations.seasonContextId
  }, runtime);
  assert.equal(statusCode, 200);
  assert.equal(payload.status, "completed", JSON.stringify({
    terminationReason: payload.terminationReason,
    answerOrigin: payload.answerOrigin,
    warnings: payload.warnings,
    modelConclusion: payload.modelConclusion,
    accesses: telemetry.accesses.map(({ tool }) => tool)
  }));
  assert.equal(payload.answerOrigin, "model");
  assert.deepEqual(telemetry.accesses.map(({ tool }) => tool), [
    "unit_details", "unit_builds", "item_details_batch", "comps_rankings",
    "comps_rankings", "composition_tactical_details", "comps_rankings",
    "composition_tactical_details"
  ]);
  assert.equal(payload.evidence.filter(({ toolName }) => toolName === "composition_tactical_details").length, 2);
  assert.equal(payload.compositionCardScope, true);
  assert.equal(payload.cardEvidenceIds.length >= 2, true);
  assert.equal(decisionIndex, 9);
});
