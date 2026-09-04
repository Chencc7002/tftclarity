import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createSmallWindowRuntime, handleReactChatRequest } from "../src/app/small-window-server.js";
import { MemoryCacheStore } from "../src/index.js";
import { parseSemanticTask } from "../src/understanding/semantic-task-parser.js";

function stableDecisionProjection(request) {
  return {
    question: request.state.question,
    messages: request.state.messages,
    semanticAdvisory: request.state.semanticAdvisory,
    toolCatalog: request.toolCatalog
  };
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function run({ shadow }) {
  let providerCalls = 0;
  let parserCalls = 0;
  let providerProjection = null;
  let shadowEvent = null;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    agentSkillsShadowV1: shadow,
    parseSemanticTask: async (input, options) => {
      parserCalls += 1;
      return parseSemanticTask(input, options);
    },
    onAgentSkillShadow: (event) => { if (event.schemaVersion === "agent-skill-shadow.v1") shadowEvent = event; },
    reactDecisionProvider: async (request) => {
      providerCalls += 1;
      providerProjection = stableDecisionProjection(request);
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "继续使用当前生产路径。",
        evidenceIds: [],
        reasonCode: "direct_answer"
      };
    }
  });
  const result = await handleReactChatRequest({ input: "沃里克怎么玩？", locale: "zh-CN", seasonContextId: "set18-live" }, runtime);
  return { runtime, result, providerCalls, parserCalls, providerProjection, shadowEvent };
}

test("Skill shadow defaults off and does not parse or emit telemetry", async () => {
  const output = await run({ shadow: undefined });
  assert.equal(output.runtime.agentSkillsShadowV1, false);
  assert.equal(output.parserCalls, 0);
  assert.equal(output.shadowEvent, null);
  assert.equal(output.providerCalls, 1);
});

test("Skill shadow normalizes AGENT_SKILLS_SHADOW_V1 once", () => {
  const enabled = createSmallWindowRuntime({ cacheStore: new MemoryCacheStore(), env: { AGENT_SKILLS_SHADOW_V1: "enabled" } });
  const disabled = createSmallWindowRuntime({ cacheStore: new MemoryCacheStore(), env: { AGENT_SKILLS_SHADOW_V1: "enabled" }, agentSkillsShadowV1: false });
  assert.equal(enabled.agentSkillsShadowV1, true);
  assert.equal(disabled.agentSkillsShadowV1, false);
});

test("Skill shadow adds zero LLM calls and leaves decision prompt, tools, answer, and payload unchanged", async () => {
  const baseline = await run({ shadow: false });
  const shadow = await run({ shadow: true });
  assert.equal(shadow.parserCalls, 1);
  assert.equal(shadow.providerCalls, baseline.providerCalls);
  assert.equal(hash(shadow.providerProjection), hash(baseline.providerProjection));
  assert.equal(shadow.result.statusCode, baseline.result.statusCode);
  assert.equal(shadow.result.payload.status, baseline.result.payload.status);
  assert.equal(shadow.result.payload.answer, baseline.result.payload.answer);
  assert.equal(shadow.result.payload.answerOrigin, baseline.result.payload.answerOrigin);
  assert.deepEqual(shadow.result.payload.modelConclusion, baseline.result.payload.modelConclusion);
  assert.deepEqual(shadow.result.payload.safetyMetrics, baseline.result.payload.safetyMetrics);
  assert.deepEqual(shadow.result.payload.agentSuggestedActions, baseline.result.payload.agentSuggestedActions);
  assert.equal(Object.hasOwn(shadow.providerProjection, "skillContext"), false);
  assert.equal(Object.hasOwn(shadow.providerProjection, "skillProgress"), false);
  assert.equal(shadow.shadowEvent.success, true);
  assert.equal(shadow.shadowEvent.selected, true);
  assert.equal(shadow.shadowEvent.skillId, "unit_play_guidance");
  assert.equal(shadow.shadowEvent.skillVersion, "1.3.0");
  assert.equal(shadow.shadowEvent.dataAvailability.current_unit_build_statistics, "unknown");
  assert.ok(shadow.shadowEvent.unsupportedFacets.includes("unit_role"));
  assert.equal(shadow.shadowEvent.llmCallsAdded, 0);
  assert.deepEqual(shadow.shadowEvent.effectiveTools, ["entity_catalog_query", "unit_builds"]);
});

test("Skill shadow matcher/parser failures fail open without changing production request", async () => {
  let providerQuestion = null;
  let event = null;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    agentSkillsShadowV1: true,
    parseSemanticTask: async () => { throw new TypeError("parse failed"); },
    onAgentSkillShadow: (value) => { event = value; },
    reactDecisionProvider: async (request) => {
      providerQuestion = request.state.question;
      return { schemaVersion: "react-action.v1", type: "finish", answer: "旧路径", evidenceIds: [], reasonCode: "direct_answer" };
    }
  });
  const { payload } = await handleReactChatRequest({ input: "沃里克怎么玩？", locale: "zh-CN", seasonContextId: "set18-live" }, runtime);
  assert.equal(payload.status, "completed");
  assert.equal(providerQuestion, "沃里克推荐出装");
  assert.equal(event.success, false);
  assert.equal(event.fallbackReason, "skill_shadow_failed_open");
});

test("Skill and TaskFrame shadows reuse one deterministic parse promise", async () => {
  let parserCalls = 0;
  let taskFrameEvents = 0;
  let skillEvents = 0;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    reactTaskFrameShadowV1: true,
    agentSkillsShadowV1: true,
    parseSemanticTask: async (input, options) => {
      parserCalls += 1;
      return parseSemanticTask(input, options);
    },
    onReactTaskFrameShadow: () => { taskFrameEvents += 1; },
    onAgentSkillShadow: (event) => { if (event.schemaVersion === "agent-skill-shadow.v1") skillEvents += 1; },
    reactDecisionProvider: async () => ({
      schemaVersion: "react-action.v1",
      type: "finish",
      answer: "旧路径",
      evidenceIds: [],
      reasonCode: "direct_answer"
    })
  });
  await handleReactChatRequest({ input: "沃里克怎么玩？", locale: "zh-CN", seasonContextId: "set18-live" }, runtime);
  assert.equal(parserCalls, 1);
  assert.equal(taskFrameEvents, 1);
  assert.equal(skillEvents, 1);
});

test("narrow parameterized queries emit no-Skill telemetry and keep their original request", async () => {
  let event = null;
  let question = null;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    agentSkillsShadowV1: true,
    onAgentSkillShadow: (value) => { event = value; },
    reactDecisionProvider: async (request) => {
      question = request.state.question;
      return { schemaVersion: "react-action.v1", type: "finish", answer: "原路径", evidenceIds: [], reasonCode: "direct_answer" };
    }
  });
  await handleReactChatRequest({ input: "沃里克推荐什么装备？", locale: "zh-CN", seasonContextId: "set18-live" }, runtime);
  assert.equal(question, "沃里克推荐什么装备？");
  assert.equal(event.success, true);
  assert.equal(event.selected, false);
  assert.equal(event.selectionStatus, "none");
});

test("invalid static Skill definitions are fail-visible while production remains healthy", async () => {
  let event = null;
  let parserCalls = 0;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    agentSkillsShadowV1: true,
    skillDefinitions: [{ schemaVersion: "agent-skill.invalid" }],
    parseSemanticTask: async () => { parserCalls += 1; throw new Error("disabled subsystem must not parse"); },
    onAgentSkillShadow: (value) => { event = value; },
    reactDecisionProvider: async () => ({
      schemaVersion: "react-action.v1",
      type: "finish",
      answer: "生产路径健康",
      evidenceIds: [],
      reasonCode: "direct_answer"
    })
  });
  assert.equal(runtime.agentSkillShadowOperational, false);
  assert.equal(runtime.agentSkillShadowDiagnostic, "invalid_skill_definition");
  const { payload } = await handleReactChatRequest({ input: "沃里克怎么玩？", locale: "zh-CN", seasonContextId: "set18-live" }, runtime);
  assert.equal(payload.status, "completed");
  assert.equal(payload.answer, "生产路径健康");
  assert.equal(parserCalls, 0);
  assert.equal(event.success, false);
  assert.equal(event.fallbackReason, "skill_subsystem_unavailable");
  assert.equal(event.diagnostic, "invalid_skill_definition");
});
