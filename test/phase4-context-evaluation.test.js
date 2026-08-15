import test from "node:test";
import assert from "node:assert/strict";
import { createTaskFrame } from "../src/understanding/task-frame.js";
import { resolveTaskFrameContext } from "../src/understanding/context-resolver.js";
import { applyClarificationPolicy } from "../src/understanding/ambiguity-policy.js";
import { runPhase4Evaluation } from "../eval/phase4-runner.mjs";

test("phase 4 resolves plural references and records condition origins", () => {
  const previous = createTaskFrame({
    action: "compare",
    subjects: [{ rawText: "霞", expectedType: "champion", resolvedId: "xayah", confidence: 1 }],
    candidates: [
      { rawText: "羊刀", expectedType: "item", resolvedId: "guinsoo", confidence: 1 },
      { rawText: "无尽", expectedType: "item", resolvedId: "infinity", confidence: 1 }
    ],
    constraints: { patch: "current" },
    goal: "choose_best",
    understandingStatus: "understood_and_supported",
    confidence: 0.9
  });
  const current = createTaskFrame({
    action: "compare",
    goal: "choose_best",
    ambiguities: [{ code: "missing_context", affectsResult: true }],
    understandingStatus: "understood_but_missing_context",
    confidence: 0.8
  });
  const resolution = resolveTaskFrameContext(current, {
    input: "这两个哪个好",
    conversation: [{ taskFrame: previous }],
    defaults: { queue: "ranked" }
  });
  assert.deepEqual(resolution.taskFrame.candidates.map((value) => value.resolvedId), ["guinsoo", "infinity"]);
  assert.equal(resolution.fieldSources.constraints.patch, "conversation");
  assert.equal(resolution.fieldSources.constraints.queue, "system_default");
  const clarification = applyClarificationPolicy(resolution.taskFrame, resolution);
  assert.equal(clarification.needsClarification, false);
  assert.equal(clarification.strategy, "context_resolved");
});
test("phase 4 asks one relevant question and restates the understood goal when context is absent", () => {
  const current = createTaskFrame({
    action: "compare",
    goal: "choose_best",
    ambiguities: [{ code: "missing_context", affectsResult: true }],
    understandingStatus: "understood_but_missing_context",
    confidence: 0.8
  });
  const resolution = resolveTaskFrameContext(current, {
    input: "这两个哪个好",
    conversation: []
  });
  const clarification = applyClarificationPolicy(resolution.taskFrame, resolution);
  assert.equal(clarification.needsClarification, true);
  assert.equal(clarification.strategy, "ask_one_key_question");
  assert.match(clarification.question, /choose_best|比较/u);
  assert.equal(Object.hasOwn(clarification, "suggestions"), false);
});

test("phase 4 generic continuations inherit prior concepts and owned items", () => {
  const conceptPrior = createTaskFrame({
    action: "recommend",
    concepts: [{
      rawText: "95",
      expectedType: "game_concept",
      resolvedId: "concept.strategy.fast9_nine_five",
      confidence: 1
    }],
    goal: "recommend_best_option",
    understandingStatus: "understood_and_supported"
  });
  const conceptResolution = resolveTaskFrameContext(createTaskFrame({
    action: "rank",
    goal: "rank_options",
    understandingStatus: "understood_and_supported"
  }), {
    input: "那按当前强度排一下",
    conversation: [{ taskFrame: conceptPrior }]
  });
  assert.equal(conceptResolution.taskFrame.concepts[0].resolvedId, "concept.strategy.fast9_nine_five");

  const itemPrior = createTaskFrame({
    action: "search",
    subjects: [{ rawText: "霞", expectedType: "champion", resolvedId: "xayah", confidence: 1 }],
    candidates: [{ rawText: "巨九", expectedType: "item", resolvedId: "hydra", confidence: 1 }],
    goal: "find_relevant_data",
    understandingStatus: "understood_and_supported"
  });
  const itemResolution = resolveTaskFrameContext(createTaskFrame({
    action: "recommend",
    goal: "recommend_best_option",
    understandingStatus: "understood_and_supported"
  }), {
    input: "那再推荐两件装备",
    conversation: [{ taskFrame: itemPrior }]
  });
  assert.equal(itemResolution.taskFrame.subjects[0].resolvedId, "xayah");
  assert.equal(itemResolution.taskFrame.candidates[0].resolvedId, "hydra");
});

test("phase 4 treats a generic continuation with an explicit resolved entity as grounded", () => {
  const current = createTaskFrame({
    action: "analyze",
    subjects: [{
      rawText: "沃里克",
      expectedType: "champion",
      resolvedId: "DA_18_Warwick",
      confidence: 1
    }],
    goal: "analyze_evidence",
    ambiguities: [{ code: "missing_context", affectsResult: true }],
    understandingStatus: "understood_but_missing_context"
  });
  const resolution = resolveTaskFrameContext(current, {
    input: "沃里克怎么玩呢？",
    conversation: []
  });
  assert.equal(resolution.resolved, true);
  assert.deepEqual(resolution.missingFields, []);
  assert.equal(resolution.taskFrame.understandingStatus, "understood_and_supported");
  assert.equal(resolution.taskFrame.ambiguities.some((ambiguity) => (
    ["missing_context", "missing_context_reference"].includes(ambiguity?.code)
  )), false);
});

test("phase 4 still requires history for a true pronoun without an explicit entity", () => {
  const resolution = resolveTaskFrameContext(createTaskFrame({
    action: "unknown",
    goal: "understand_request",
    understandingStatus: "understood_and_supported"
  }), {
    input: "它呢？",
    conversation: []
  });
  assert.equal(resolution.resolved, false);
  assert.deepEqual(resolution.missingFields, ["conversation"]);
  assert.equal(resolution.taskFrame.ambiguities.some((ambiguity) => (
    ambiguity?.code === "missing_context_reference"
  )), true);
});

test("phase 4 evaluation enforces reference and clarification gates", async () => {
  const report = await runPhase4Evaluation();
  assert.equal(report.passed, true);
  assert.ok(report.metrics.multiTurnReferenceAccuracy >= 0.9);
  assert.ok(report.metrics.unnecessaryClarificationRate < 0.05);
  assert.equal(report.metrics.oneKeyQuestionRate, 1);
});
