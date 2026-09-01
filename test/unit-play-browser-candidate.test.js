import test from "node:test";
import assert from "node:assert/strict";
import { createUnitPlayBrowserCandidate, projectUnitPlayModelObservation } from "../src/experiments/unit-play-guidance-browser/candidate.js";
import { ToolRegistry } from "../src/agent/tools/registry.js";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";
import { UNIT_PLAY_GUIDANCE_SKILL_V1_4 as skill } from "../src/skills/definitions/unit-play-guidance.js";

const registry = new ToolRegistry(createStructuredToolDefinitions());
const frame = { schemaVersion: "task-frame.v1", domain: "tft", action: "recommend", goal: "recommend_unit_play",
  expectedOutput: ["unit_play_guidance"], understandingStatus: "understood_and_supported", ambiguities: [],
  subjects: [{ expectedType: "champion", resolvedId: "DA_18_Warwick" }], candidates: [], concepts: [] };
const request = { state: { question: "沃里克怎么玩？", seasonContextId: "set18-live", transcript: [],
  semanticAdvisory: { goal: "recommend_unit_play", subject: { resolvedId: "DA_18_Warwick" } } },
  toolCatalog: registry.list().filter((tool) => skill.allowedTools.includes(tool.name)) };

function fixture(messageLayout = "append_only", decisionMessages = "event", modelObservationProjection = false) {
  const sent = [], events = [], baseline = [];
  const candidate = createUnitPlayBrowserCandidate({ toolRegistry: registry, decisionMessages, modelObservationProjection,
    parseTask: async (taskFrame) => ({ taskFrame }),
    baselineProvider: async (input) => { baseline.push(input); return "baseline"; },
    onEvent: (event) => events.push(event),
    providerOptions: { model: "test", endpoint: "https://unused.test", messageLayout, fetchImpl: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ schemaVersion: "react-action.v1",
        type: "finish", answer: "资料不足。", evidenceIds: [], reasonCode: "direct_answer", narrative: null }) } }] }) };
    } }
  });
  return { candidate, sent, events, baseline };
}

test("isolated candidate replaces professional guidance using the existing single parse and exact catalog", async () => {
  const f = fixture();
  await f.candidate.runRequest(async () => {
    await f.candidate.parseTask(frame);
    await f.candidate.decisionProvider(request, {});
    await f.candidate.decisionProvider(request, {});
  });
  assert.equal(f.baseline.length, 0);
  const content = f.sent[0].messages.map((message) => { try { return JSON.parse(message.content); } catch { return null; } });
  const run = content.find((value) => value?.schemaVersion === "react-run-context.v1");
  const rendered = JSON.parse(run.semanticGuidance);
  assert.deepEqual(rendered.skillContext.instructions, skill.instructions);
  assert.equal(rendered.skillContext.skillVersion, "1.4.0");
  assert.equal(rendered.contentHash, f.candidate.contentHash);
  assert.deepEqual(run.semanticAdvisory, request.state.semanticAdvisory);
  assert.deepEqual(content.find((value) => value?.toolCatalog)?.toolCatalog, JSON.parse(JSON.stringify(request.toolCatalog)));
  assert.ok(f.events.every((event) => event.parseCount === 1));
  assert.doesNotMatch(JSON.stringify(f.sent), /Semantic guidance for this turn:/u);
});

test("model observation projection is bounded to known unit-play fields and never mutates Evidence", () => {
  const observation = { type: "tool_result", tool: "unit_builds", evidenceId: "ev-build",
    nextActionAffordance: { recommendedAction: "call_tool", callTool: { tool: "item_details", arguments: { apiName: "item-a" } } },
    value: { type: "unit_build_rankings", mechanismQueryPlan: { status: "available", apiNames: ["item-a"] },
      junk: "x".repeat(5000), unit: { apiName: "unit-a", name: "A", iconUrl: "secret-large" },
      cards: [{ title: "main", winner: true, items: [{ apiName: "item-a", name: "A", iconUrl: "large" }], stats: { games: 10 } },
        { title: "alternative", items: [{ apiName: "item-b", name: "B" }] }], query: { unit: "unit-a", assumptions: ["large"] } },
    evidence: { evidenceId: "ev-build", toolName: "unit_builds", value: { type: "unit_build_rankings",
      unit: { apiName: "unit-a", name: "A" }, cards: [{ title: "main", winner: true, items: [{ apiName: "item-a", name: "A" }] }],
      ignored: "y".repeat(5000) } } };
  const before = JSON.stringify(observation);
  const projected = projectUnitPlayModelObservation(observation, "unit-a");
  assert.equal(JSON.stringify(observation), before);
  assert.equal(projected.value.cards.length, 1);
  assert.equal(projected.value.cards[0].items[0].apiName, "item-a");
  assert.equal(projected.value.junk, undefined);
  assert.equal(projected.value.unit.iconUrl, undefined);
  assert.deepEqual(projected.value.mechanismQueryPlan, { status: "available", apiNames: ["item-a"] });
  assert.equal(projected.evidence.value.ignored, undefined);
  assert.deepEqual(projected.nextActionAffordance, observation.nextActionAffordance);

  const tactical = projectUnitPlayModelObservation({ type: "tool_result", tool: "composition_tactical_details",
    value: { compId: "comp", formation: { status: "available", units: [
      { apiName: "unit-a", name: "A", boardPosition: { rowFromFront: 1, columnFromLeft: 2 }, cell: 99 },
      { apiName: "unit-b", name: "B", boardPosition: { rowFromFront: 4, columnFromLeft: 7 } }
    ] } } }, "unit-a");
  assert.deepEqual(tactical.value.formation.units, [{ apiName: "unit-a", name: "A",
    boardPosition: { rowFromFront: 1, columnFromLeft: 2 } }]);

  const batch = projectUnitPlayModelObservation({ type: "tool_result", tool: "item_details_batch",
    value: { schemaVersion: "official-item-detail-batch.v1", type: "item_details_batch", status: "found",
      mechanismStatus: "available", selection: { apiNames: ["item-a"] }, junk: "x".repeat(5000),
      items: [{ apiName: "item-a", displayName: "A", facts: { effect: "effect" }, iconUrl: "large",
        source: { sourceType: "official_tft_catalog", retrieval: { fetchedAt: "now" }, ignored: "large" } }] } }, "unit-a");
  assert.equal(batch.value.junk, undefined);
  assert.equal(batch.value.items[0].iconUrl, undefined);
  assert.equal(batch.value.items[0].source.ignored, undefined);
  assert.equal(batch.value.items[0].facts.effect, "effect");
});

test("opt-in projection changes only provider input and reports exact byte savings", async () => {
  for (const messageLayout of ["append_only", "legacy_full_state"]) {
    const f = fixture(messageLayout, "event", true);
    const largeObservation = { type: "tool_result", tool: "unit_builds", evidenceId: "ev",
      evidence: { evidenceId: "ev", toolName: "unit_builds", value: { type: "unit_build_rankings",
        unit: { apiName: "DA_18_Warwick", name: "沃里克" }, cards: [{ title: "main", winner: true,
          items: [{ apiName: "item-a", name: "A", iconUrl: "large" }] }], junk: "x".repeat(3000) } } };
    const input = { ...request, state: { ...request.state, transcript: [
      { type: "observation", value: largeObservation }
    ], observations: [largeObservation], evidence: [largeObservation.evidence] } };
    const before = JSON.stringify(input);
    await f.candidate.runRequest(async () => {
      await f.candidate.parseTask(frame);
      await f.candidate.decisionProvider(input, {});
    });
    assert.equal(JSON.stringify(input), before);
    assert.equal(f.sent.length, 1);
    assert.doesNotMatch(JSON.stringify(f.sent[0]), /"junk"|iconUrl|xxx/u);
    const event = f.events.find((entry) => entry.stage === "provider_request");
    assert.equal(event.modelObservationProjection, true);
    assert.ok(event.inputBytesAfterProjection < event.inputBytesBeforeProjection);
  }
});

test("isolated candidate audits guidance in the existing legacy message layout too", async () => {
  const f = fixture("legacy_full_state");
  await f.candidate.runRequest(async () => {
    await f.candidate.parseTask(frame);
    await f.candidate.decisionProvider(request, {});
  });
  const body = JSON.parse(f.sent[0].messages.find((message) => message.role === "user").content);
  assert.deepEqual(body.toolCatalog, JSON.parse(JSON.stringify(request.toolCatalog)));
  assert.deepEqual(JSON.parse(body.state.semanticGuidance).skillContext.instructions, skill.instructions);
  assert.equal(f.events.filter((event) => event.stage === "provider_request").length, 1);
  assert.equal(f.baseline.length, 0);
});

test("optional action-history diagnostic preserves observations, runtime state and actual model output", async () => {
  const action = { schemaVersion: "react-action.v1", type: "call_tool", tool: "unit_details",
    arguments: { apiName: "DA_18_Warwick" }, purposeCode: "retrieve_entity_details" };
  const input = { ...request, state: { ...request.state, transcript: [
    { type: "decision", value: action },
    { type: "observation", value: { type: "tool_error", message: "test source unavailable" } },
    { type: "runtime_state", value: { iteration: 2, warnings: ["test"] } }
  ] } };
  const event = fixture(), direct = fixture("append_only", "action");
  const before = JSON.stringify(input);
  for (const f of [event, direct]) await f.candidate.runRequest(async () => {
    await f.candidate.parseTask(frame);
    const result = await f.candidate.decisionProvider(input, {});
    assert.equal(result.action.type, "finish");
    assert.equal(result.action.answer, "资料不足。");
  });
  assert.deepEqual(JSON.parse(direct.sent[0].messages.find((message) => message.role === "assistant").content), action);
  const exceptAssistant = (f) => f.sent[0].messages.filter((message) => message.role !== "assistant");
  assert.deepEqual(exceptAssistant(event), exceptAssistant(direct));
  assert.equal(JSON.stringify(input), before);
});

test("no Skill, untrusted taskAnchor and separate concurrent requests cannot inherit candidate guidance", async () => {
  const f = fixture();
  await f.candidate.decisionProvider({ ...request, state: { ...request.state, taskAnchor: frame } }, {});
  await Promise.all([
    f.candidate.runRequest(async () => { await f.candidate.parseTask(frame); await f.candidate.decisionProvider(request, {}); }),
    f.candidate.runRequest(async () => { await f.candidate.parseTask({ ...frame, goal: "unit_build_rankings" }); await f.candidate.decisionProvider(request, {}); })
  ]);
  assert.equal(f.sent.length, 1);
  assert.equal(f.baseline.length, 2);
  assert.ok(f.events.some((event) => event.reason === "no_skill"));
});

test("candidate refuses a second TaskFrame parse and does not inject for a mismatched subject", async () => {
  const f = fixture();
  await f.candidate.runRequest(async () => {
    await f.candidate.parseTask(frame);
    await f.candidate.decisionProvider({ ...request, state: { ...request.state,
      semanticAdvisory: { ...request.state.semanticAdvisory, subject: { resolvedId: "another" } } } }, {});
    await assert.rejects(f.candidate.parseTask(frame), /one TaskFrame parse/);
  });
  assert.equal(f.sent.length, 0);
  assert.equal(f.baseline.length, 1);
});
