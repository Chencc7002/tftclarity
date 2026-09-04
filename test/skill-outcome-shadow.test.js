import assert from "node:assert/strict";
import test from "node:test";
import { createSmallWindowRuntime, handleReactChatRequest } from "../src/app/small-window-server.js";
import { MemoryCacheStore } from "../src/index.js";
import { parseSemanticTask } from "../src/understanding/semantic-task-parser.js";
import { UNIT_PLAY_GUIDANCE_SKILL } from "../src/skills/index.js";
import { queryEntityCatalog } from "../src/domain/tft/entity-catalog-query.js";

const OUTCOME_SCHEMA = "agent-skill-outcome-shadow.v1";
const unitId = "DA_18_Warwick";

async function run({ shadow = true, observer, input = "沃里克怎么玩？", definitions, failProvider = false } = {}) {
  const events = [];
  const prompts = [];
  const progressTypes = [];
  const persisted = [];
  const persistedAtOutcome = [];
  let toolCalls = 0;
  let parserCalls = 0;
  const cacheStore = new MemoryCacheStore();
  const originalAdd = cacheStore.addQueryEvent.bind(cacheStore);
  cacheStore.addQueryEvent = async (event) => { persisted.push(structuredClone(event)); return originalAdd(event); };
  const runtime = createSmallWindowRuntime({
    cacheStore,
    agentSkillsShadowV1: shadow,
    ...(definitions ? { skillDefinitions: definitions } : {}),
    parseSemanticTask: async (text, options) => { parserCalls += 1; return parseSemanticTask(text, options); },
    onAgentSkillShadow: (event) => {
      events.push(structuredClone(event));
      if (event.schemaVersion === OUTCOME_SCHEMA) persistedAtOutcome.push(structuredClone(persisted));
      return observer?.(event);
    },
    reactToolHandlers: {
      entity_catalog_query: async (input) => {
        toolCalls += 1;
        return queryEntityCatalog({ catalog: { units: [{ apiName: unitId, zhName: "沃里克", name: "Warwick" }], items: [], traits: [] }, input });
      },
      unit_builds: async () => {
        toolCalls += 1;
        return { type: "unit_build_rankings", unit: { apiName: unitId, name: "沃里克" },
          query: { unit: unitId, seasonContextId: "set18-live", patch: "current" },
          cards: [{ title: "来源样本", items: [{ apiName: "TFT_Item_InfinityEdge", name: "无尽之刃" }], stats: { games: 100 } }],
          source: { provider: "metatft", updatedAt: new Date().toISOString() } };
      }
    },
    reactDecisionProvider: async ({ state, toolCatalog }) => {
      prompts.push(structuredClone({ question: state.question, messages: state.messages, semanticAdvisory: state.semanticAdvisory, toolCatalog }));
      if (failProvider) throw new Error("private-provider-error-sentinel");
      if (!state.evidence.some((entry) => entry.toolName === "entity_catalog_query")) return {
        schemaVersion: "react-action.v1", type: "call_tool", tool: "entity_catalog_query", arguments: { entityType: "unit", filters: { names: ["沃里克"] } }, purposeCode: "retrieve_entity_details"
      };
      const builds = state.evidence.find((entry) => entry.toolName === "unit_builds");
      return builds ? {
        schemaVersion: "react-action.v1", type: "finish", answer: "模型原始回答。",
        evidenceIds: [builds.evidenceId], reasonCode: "sufficient_evidence"
      } : {
        schemaVersion: "react-action.v1", type: "call_tool", tool: "unit_builds", arguments: { unit: unitId }, purposeCode: "retrieve_current_statistics"
      };
    }
  });
  const result = await handleReactChatRequest({ input, locale: "zh-CN", seasonContextId: "set18-live", conversationId: "skill-outcome-test" }, runtime,
    { onProgress: (event) => { progressTypes.push(event.type); } });
  return { result, events, prompts, progressTypes, persisted, persistedAtOutcome, toolCalls, parserCalls };
}

test("finished shadow reads real Ledger observations and runs after scoped answer persistence", async () => {
  const output = await run();
  assert.equal(output.persistedAtOutcome[0].length, 1);
  assert.equal(output.persistedAtOutcome[0][0].response.answerOrigin, "system_equipment_summary");
  const event = output.events.find((entry) => entry.schemaVersion === OUTCOME_SCHEMA);
  assert.equal(output.events.length, 2);
  assert.equal(event.success, true);
  assert.equal(event.runStatus, "completed", JSON.stringify(output.result.payload));
  assert.equal(event.outcome.equipmentStatisticsObserved, true, JSON.stringify(event));
  assert.equal(event.outcome.dataAvailability.current_unit_build_statistics, "available");
  assert.equal(event.outcome.dataAvailability.current_composition_statistics, "unavailable");
  assert.deepEqual(event.outcome.coveredFacets, []);
  assert.deepEqual(event.outcome.missingFacets, ["equipment_logic"]);
  assert.deepEqual(event.outcome.answerCoverage.verifiedFacets, []);
  assert.equal(event.outcome.answerCoverage.completionEvaluated, false);
  assert.equal(event.llmCallsAdded, 0);
  assert.equal(output.parserCalls, 1);
  assert.equal(output.toolCalls, 2);
  assert.equal(output.result.payload.answerOrigin, "system_equipment_summary");
});

test("end shadow leaves prompts, tool calls, stream events and persisted answers unchanged", async () => {
  const off = await run({ shadow: false });
  const on = await run();
  // Ledger IDs are random per request; compare their same-tool references.
  const normalize = (value, output) => value === undefined ? value : JSON.parse(JSON.stringify(value, (_, item) => {
    const index = output.result.payload.evidence.findIndex((entry) => entry.evidenceId === item);
    return index < 0 ? item : `evidence-${index}:${output.result.payload.evidence[index].toolName}`;
  }));
  assert.equal(off.parserCalls, 0);
  assert.deepEqual(off.events, []);
  assert.deepEqual(on.prompts, off.prompts);
  assert.equal(on.toolCalls, off.toolCalls);
  assert.deepEqual(on.progressTypes, off.progressTypes);
  for (const key of ["status", "answer", "answerOrigin", "modelConclusion", "safetyMetrics", "agentSuggestedActions", "unavailableTools"]) {
    assert.deepEqual(normalize(on.result.payload[key], on), normalize(off.result.payload[key], off), key);
    assert.deepEqual(normalize(on.persisted[0].response[key], on), normalize(off.persisted[0].response[key], off), `persisted ${key}`);
  }
  for (const key of ["input", "seasonContextId", "conversationId", "llmUsed", "llmModel"]) assert.deepEqual(on.persisted[0][key], off.persisted[0][key], key);
  assert.equal(Object.hasOwn(on.result.payload, "skillProgress"), false);
  assert.equal(Object.hasOwn(on.persisted[0].response, "skillProgress"), false);
});

test("end telemetry excludes answer text, champion identity, snapshots and arbitrary errors", async () => {
  const output = await run();
  const serialized = JSON.stringify(output.events.find((entry) => entry.schemaVersion === OUTCOME_SCHEMA));
  for (const token of [unitId, "沃里克", "无尽之刃", "模型原始回答", "sourceStatements", "private-provider-error-sentinel", "queryId", "toolCallId"]) {
    assert.ok(!serialized.includes(token), token);
  }
});

test("throwing, rejecting and pending end observers cannot block or mutate results", async () => {
  const baseline = await run();
  for (const fail of [() => { throw new Error("observer failure"); }, () => Promise.reject(new Error("observer failure")), () => new Promise(() => {})]) {
    const output = await run({ observer: (event) => {
      if (event.schemaVersion !== OUTCOME_SCHEMA) return;
      event.outcome.coveredFacets.push("invented_facet");
      return fail();
    } });
    assert.equal(output.result.statusCode, baseline.result.statusCode);
    assert.equal(output.result.payload.answer, baseline.result.payload.answer);
    assert.equal(output.persisted[0].response.answer, baseline.persisted[0].response.answer);
    assert.equal(output.prompts.length, baseline.prompts.length);
  }
});

test("adapter version mismatch fails open without weakening production policies", async () => {
  const output = await run({ definitions: [{ ...UNIT_PLAY_GUIDANCE_SKILL, version: "2.0.0" }] });
  const event = output.events.find((entry) => entry.schemaVersion === OUTCOME_SCHEMA);
  assert.equal(output.result.payload.answerOrigin, "system_equipment_summary");
  assert.equal(event.success, false);
  assert.equal(event.fallbackReason, "skill_outcome_shadow_failed_open");
  assert.equal(event.outcome, undefined);
});

test("narrow Quick Task shaped chat queries do not get an end Skill observation", async () => {
  const output = await run({ input: "沃里克推荐什么装备？" });
  assert.equal(output.events.length, 1);
  assert.equal(output.events[0].selected, false);
});

test("provider failure still emits a bounded end observation without inventing support", async () => {
  const output = await run({ failProvider: true });
  const event = output.events.find((entry) => entry.schemaVersion === OUTCOME_SCHEMA);
  assert.ok(event, JSON.stringify(output.events));
  assert.deepEqual(event.outcome.coveredFacets, []);
  assert.equal(event.outcome.equipmentStatisticsObserved, false);
  assert.equal(event.outcome.answerCoverage.completionEvaluated, false);
  assert.ok(!JSON.stringify(event).includes("private-provider-error-sentinel"));
});
