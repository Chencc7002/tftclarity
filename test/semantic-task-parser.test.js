import test from "node:test";
import assert from "node:assert/strict";
import { createCatalog } from "../src/data/static-data.js";
import { parseSemanticTask, applyDeterministicTftSemantics } from "../src/understanding/semantic-task-parser.js";

const broadPlayCatalog = createCatalog({
  units: [
    { apiName: "DA_18_Warwick", zhName: "沃里克", aliases: ["沃里克", "warwick"] },
    { apiName: "DA_18_Ahri", zhName: "阿狸", aliases: ["阿狸", "ahri"] }
  ],
  items: []
});

test("semantic parser produces compositional task semantics for item comparison", async () => {
  const parsed = await parseSemanticTask("霞的炼刀和巨九选哪个？", {
    dynamicContext: { version: "17.7", currentTime: "2026-07-23T12:00:00+08:00" }
  });

  assert.equal(parsed.taskFrame.schemaVersion, "task-frame.v1");
  assert.equal(parsed.taskFrame.domain, "tft");
  assert.equal(parsed.taskFrame.action, "compare");
  assert.equal(parsed.taskFrame.goal, "choose_best");
  assert.deepEqual(parsed.taskFrame.subjects.map((entity) => entity.rawText), ["霞"]);
  assert.deepEqual(parsed.taskFrame.candidates.map((entity) => entity.rawText), ["炼刀", "巨九"]);
  assert.equal(parsed.taskFrame.understandingStatus, "understood_and_supported");
  assert.ok(parsed.telemetry.usage.cachedInputTokens > 0);
  assert.ok(parsed.telemetry.usage.uncachedInputTokens > 0);
  assert.ok(parsed.telemetry.usage.outputTokens > 0);
  assert.ok(parsed.telemetry.usage.cachedInputTokens + parsed.telemetry.usage.uncachedInputTokens <= parsed.telemetry.budget.maxInputTokens);
});

test("semantic parser separates understanding from support and domain status", async () => {
  const video = await parseSemanticTask("帮我找个当前版本霞的攻略视频");
  assert.equal(video.taskFrame.action, "find_video");
  assert.equal(video.taskFrame.understandingStatus, "understood_and_supported");
  assert.ok(video.taskFrame.capabilityRequirements.includes("strategy_video_search"));

  const concept = await parseSemanticTask("九五到底是啥意思？");
  assert.equal(concept.taskFrame.action, "explain");
  assert.equal(concept.taskFrame.understandingStatus, "understood_and_supported");

  const mail = await parseSemanticTask("帮我写一封请假邮件");
  assert.equal(mail.taskFrame.domain, "out_of_domain");
  assert.equal(mail.taskFrame.action, "unknown");
  assert.equal(mail.taskFrame.understandingStatus, "out_of_domain");
});

test("semantic parser preserves stable prefix order and appends dynamic state last", async () => {
  const parsed = await parseSemanticTask("霞怎么出装？", {
    dynamicContext: { version: "17.7", userState: { locale: "zh-CN" } }
  });
  assert.deepEqual(parsed.messages.map((message) => message.name), [
    "fixed_rules",
    "core_tool_index",
    "retrieved_examples",
    "dynamic_context"
  ]);
  assert.equal(JSON.parse(parsed.messages.at(-1).content).version, "17.7");
});

test("semantic parser enforces output token and latency budgets", async () => {
  await assert.rejects(
    () => parseSemanticTask("霞怎么出装？", { budget: { maxOutputTokens: 1 } }),
    /token budget exceeded/u
  );

  await assert.rejects(
    () => parseSemanticTask("霞怎么出装？", {
      budget: { maxLatencyMs: 5 },
      provider: () => new Promise((resolve) => setTimeout(resolve, 30))
    }),
    (error) => error.code === "semantic_parser_timeout"
  );
});

test("semantic parser records a controlled deterministic fallback after an invalid provider response", async () => {
  const parsed = await parseSemanticTask("霞的羊刀和巨九二选一", {
    providerFailureFallback: true,
    provider: async () => {
      throw new TypeError("invalid TaskFrame");
    }
  });

  assert.equal(parsed.taskFrame.action, "compare");
  assert.equal(parsed.taskFrame.understandingStatus, "understood_and_supported");
  assert.deepEqual(parsed.telemetry.providerFallback, {
    used: true,
    reason: "invalid_response"
  });
});

test("semantic parser normalizes broad named-unit play questions to unit guidance", async () => {
  for (const input of [
    "沃里克怎么玩？",
    "沃里克怎么玩呢？",
    "那沃里克的话该怎么玩呢？"
  ]) {
    const parsed = await parseSemanticTask(input, {
      provider: null,
      catalog: broadPlayCatalog,
      conversation: []
    });
    const frame = parsed.taskFrame;
    assert.equal(frame.schemaVersion, "task-frame.v1", input);
    assert.equal(frame.action, "recommend", input);
    assert.equal(frame.goal, "recommend_unit_play", input);
    assert.deepEqual(frame.expectedOutput, ["unit_play_guidance"], input);
    assert.deepEqual(frame.capabilityRequirements, [], input);
    assert.ok(frame.subjects.some((subject) => (
      subject.resolvedId === "DA_18_Warwick"
    )), input);
    assert.equal(frame.ambiguities.some((ambiguity) => (
      ambiguity?.code === "missing_context_reference"
    )), false, input);
  }
});

test("broad unit play normalization does not override explicit facets or multiple entities", async () => {
  const cases = [
    ["沃里克推荐什么装备？", "recommend_best_option"],
    ["沃里克的视频攻略怎么玩？", "find_strategy_video"],
    ["为什么沃里克强？", "explain_concept_or_entity"],
    ["沃里克和阿狸怎么玩？", "analyze_evidence"]
  ];
  for (const [input, expectedGoal] of cases) {
    const parsed = await parseSemanticTask(input, {
      provider: null,
      catalog: broadPlayCatalog,
      conversation: []
    });
    assert.notEqual(parsed.taskFrame.goal, "recommend_unit_play", input);
    assert.equal(parsed.taskFrame.goal, expectedGoal, input);
  }
});

test("opt-in compound play guidance refines the original TaskFrame without changing the default", async () => {
  for (const input of [
    "沃里克怎么玩？请给推荐装备和多个阵容，每个阵容带对应站位。",
    "沃里克怎么玩，装备、阵容和站位都讲一下",
    "请说说沃里克玩法。给出装和阵容推荐。"
  ]) {
    const options = { provider: null, catalog: broadPlayCatalog, conversation: [] };
    const legacy = (await parseSemanticTask(input, options)).taskFrame;
    const candidate = (await parseSemanticTask(input, { ...options, compoundUnitPlayGuidance: true })).taskFrame;
    assert.notEqual(legacy.goal, "recommend_unit_play", input);
    assert.equal(candidate.goal, "recommend_unit_play", input);
    assert.deepEqual(candidate.expectedOutput, ["unit_play_guidance"], input);
    const refined = await applyDeterministicTftSemantics(legacy, input, { compoundUnitPlayGuidance: true });
    assert.equal(refined.goal, candidate.goal, input);
  }
});

test("compound play opt-in preserves Quick Tasks, narrow facets, unresolved identities and unsupported decisions", async () => {
  for (const input of [
    "沃里克出装", "沃里克阵容和站位", "沃里克技能怎么玩，装备阵容呢？",
    "沃里克怎么玩？只说装备和阵容。", "沃里克怎么玩？装备阵容攻略视频。",
    "沃里克怎么玩？对比装备阵容。", "沃里克怎么玩？这阶段装备阵容该怎么转型？",
    "沃里克怎么玩？我现在的装备适合什么阵容？",
    "沃里克和阿狸怎么玩？装备阵容都给一下。",
    "未知英雄怎么玩？装备阵容怎么配？"
  ]) {
    const options = { provider: null, catalog: broadPlayCatalog, conversation: [] };
    const legacy = (await parseSemanticTask(input, options)).taskFrame;
    const candidate = (await parseSemanticTask(input, { ...options, compoundUnitPlayGuidance: true })).taskFrame;
    assert.deepEqual(candidate, legacy, input);
    assert.notEqual(candidate.goal, "recommend_unit_play", input);
  }
});
