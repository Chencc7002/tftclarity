import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createSmallWindowRuntime, handleReactChatRequest } from "../src/app/small-window-server.js";
import { UNIT_PLAY_GUIDANCE_SKILL_V1_5_11 } from "../src/skills/definitions/unit-play-guidance.js";
import { MemoryCacheStore } from "../src/index.js";
import { parseSemanticTask } from "../src/understanding/semantic-task-parser.js";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const providerProjection = (request) => ({
  question: request.state.question,
  messages: request.state.messages,
  semanticAdvisory: request.state.semanticAdvisory,
  toolCatalog: request.toolCatalog
});

async function run({ candidateShadow, baseShadow = false, candidateSkillDefinitions } = {}) {
  let parserCalls = 0;
  let providerCalls = 0;
  let projection = null;
  const events = [];
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    agentSkillsShadowV1: baseShadow,
    agentSkillsCandidateShadowV1: candidateShadow,
    ...(candidateSkillDefinitions ? { candidateSkillDefinitions } : {}),
    parseSemanticTask: async (input, options) => {
      parserCalls += 1;
      return parseSemanticTask(input, options);
    },
    onAgentSkillShadow: (event) => { events.push(structuredClone(event)); },
    reactDecisionProvider: async (request) => {
      providerCalls += 1;
      projection = providerProjection(request);
      return { schemaVersion: "react-action.v1", type: "finish", answer: "继续使用当前生产路径。",
        evidenceIds: [], reasonCode: "direct_answer" };
    }
  });
  const result = await handleReactChatRequest({ input: "沃里克怎么玩？", locale: "zh-CN",
    seasonContextId: "set18-live" }, runtime);
  return { runtime, result, parserCalls, providerCalls, projection, events };
}

test("candidate Skill shadow defaults off and normalizes its dedicated environment flag", () => {
  const off = createSmallWindowRuntime({ cacheStore: new MemoryCacheStore() });
  const on = createSmallWindowRuntime({ cacheStore: new MemoryCacheStore(),
    env: { AGENT_SKILLS_CANDIDATE_SHADOW_V1: "enabled" } });
  const override = createSmallWindowRuntime({ cacheStore: new MemoryCacheStore(),
    env: { AGENT_SKILLS_CANDIDATE_SHADOW_V1: "enabled" }, agentSkillsCandidateShadowV1: false });
  assert.equal(off.agentSkillsCandidateShadowV1, false);
  assert.equal(on.agentSkillsCandidateShadowV1, true);
  assert.equal(override.agentSkillsCandidateShadowV1, false);
});

test("candidate Skill shadow observes 1.5.11 without changing the Provider request or response", async () => {
  const baseline = await run({ candidateShadow: false });
  const shadow = await run({ candidateShadow: true });
  const event = shadow.events.find((entry) => entry.schemaVersion === "agent-skill-candidate-shadow.v1");
  assert.equal(shadow.providerCalls, baseline.providerCalls);
  assert.equal(hash(shadow.projection), hash(baseline.projection));
  assert.equal(shadow.result.statusCode, baseline.result.statusCode);
  assert.equal(shadow.result.payload.status, baseline.result.payload.status);
  assert.equal(shadow.result.payload.answer, baseline.result.payload.answer);
  assert.equal(shadow.result.payload.answerOrigin, baseline.result.payload.answerOrigin);
  assert.deepEqual(shadow.result.payload.modelConclusion, baseline.result.payload.modelConclusion);
  assert.deepEqual(shadow.result.payload.safetyMetrics, baseline.result.payload.safetyMetrics);
  assert.deepEqual(shadow.result.payload.agentSuggestedActions, baseline.result.payload.agentSuggestedActions);
  assert.equal(shadow.parserCalls, 1);
  assert.equal(event.success, true);
  assert.equal(event.selected, true);
  assert.equal(event.skillId, "unit_play_guidance");
  assert.equal(event.skillVersion, "1.5.11");
  assert.equal(event.skillContentSha256, "7df0d4830a8221150a49ecf251e86ad7c25980e2468650cba4b4e718cd95be8a");
  assert.equal(event.llmCallsAdded, 0);
  assert.equal(Object.hasOwn(event, "skillContext"), false);
  assert.equal(Object.hasOwn(event, "instructions"), false);
  assert.deepEqual(event.effectiveTools, ["entity_catalog_query", "item_details_batch", "unit_builds"]);
});

test("base and candidate Skill shadows reuse the same deterministic TaskFrame parse", async () => {
  const output = await run({ candidateShadow: true, baseShadow: true });
  assert.equal(output.parserCalls, 1);
  assert.equal(output.events.filter((entry) => entry.schemaVersion === "agent-skill-shadow.v1").length, 1);
  assert.equal(output.events.filter((entry) => entry.schemaVersion === "agent-skill-candidate-shadow.v1").length, 1);
});

test("candidate Skill shadow fails open when its static definition is invalid", async () => {
  const output = await run({ candidateShadow: true,
    candidateSkillDefinitions: [{ schemaVersion: "agent-skill.invalid" }] });
  const event = output.events.find((entry) => entry.schemaVersion === "agent-skill-candidate-shadow.v1");
  assert.equal(output.runtime.agentSkillCandidateShadowOperational, false);
  assert.equal(output.providerCalls, 1);
  assert.equal(output.result.payload.answer, "继续使用当前生产路径。");
  assert.equal(output.parserCalls, 0);
  assert.equal(event.success, false);
  assert.equal(event.fallbackReason, "candidate_skill_subsystem_unavailable");
  assert.equal(event.diagnostic, "invalid_candidate_skill_definition");
});

test("a pending candidate shadow observer cannot delay the production response", async () => {
  let providerCalls = 0;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    agentSkillsCandidateShadowV1: true,
    onAgentSkillShadow: () => new Promise(() => {}),
    reactDecisionProvider: async () => {
      providerCalls += 1;
      return { schemaVersion: "react-action.v1", type: "finish", answer: "原路径",
        evidenceIds: [], reasonCode: "direct_answer" };
    }
  });
  const outcome = await Promise.race([
    handleReactChatRequest({ input: "沃里克怎么玩？", locale: "zh-CN",
      seasonContextId: "set18-live" }, runtime),
    new Promise((resolve) => setTimeout(() => resolve("timed_out"), 100))
  ]);
  assert.notEqual(outcome, "timed_out");
  assert.equal(outcome.payload.answer, "原路径");
  assert.equal(providerCalls, 1);
});

test("candidate Skill shadow emits conservative no-selection telemetry for a narrow query", async () => {
  let event = null;
  let providerQuestion = null;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    agentSkillsCandidateShadowV1: true,
    onAgentSkillShadow: (value) => { event = value; },
    reactDecisionProvider: async (request) => {
      providerQuestion = request.state.question;
      return { schemaVersion: "react-action.v1", type: "finish", answer: "原路径",
        evidenceIds: [], reasonCode: "direct_answer" };
    }
  });
  await handleReactChatRequest({ input: "沃里克推荐什么装备？", locale: "zh-CN",
    seasonContextId: "set18-live" }, runtime);
  assert.equal(providerQuestion, "沃里克推荐什么装备？");
  assert.equal(event.schemaVersion, "agent-skill-candidate-shadow.v1");
  assert.equal(event.success, true);
  assert.equal(event.selected, false);
  assert.equal(event.selectionStatus, "none");
});

test("candidate hash is tied to the accepted v6 Skill definition", () => {
  assert.equal(UNIT_PLAY_GUIDANCE_SKILL_V1_5_11.version, "1.5.11");
  assert.equal(hash(UNIT_PLAY_GUIDANCE_SKILL_V1_5_11),
    "7df0d4830a8221150a49ecf251e86ad7c25980e2468650cba4b4e718cd95be8a");
});
