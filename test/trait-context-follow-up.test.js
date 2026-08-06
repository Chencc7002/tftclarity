import test from "node:test";
import assert from "node:assert/strict";
import { createTaskFrame, resolveTaskFrameContext } from "../src/index.js";

const woodling = {
  rawText: "木灵",
  expectedType: "trait",
  resolvedId: "TFT17_Woodling",
  canonicalName: "木灵",
  confidence: 1
};

test("deictic trait collection query inherits the sole prior trait", () => {
  const current = createTaskFrame({
    action: "search",
    constraints: { targetEntityType: "champion", cost: 4, relation: "member_of_trait" },
    goal: "find_entities_matching_filters",
    confidence: 0.95,
    understandingStatus: "understood_and_supported"
  });
  const resolution = resolveTaskFrameContext(current, {
    input: "该羁绊内有什么四费卡",
    conversation: [{ taskFrame: createTaskFrame({
      action: "explain",
      concepts: [woodling],
      goal: "trait_details",
      confidence: 1,
      understandingStatus: "understood_and_supported"
    }) }]
  });
  assert.equal(resolution.usedConversation, true);
  assert.equal(resolution.taskFrame.concepts[0].resolvedId, "TFT17_Woodling");
  assert.equal(resolution.taskFrame.concepts[0].source ?? null, null);
});
test("deictic trait query asks when prior context contains two traits", () => {
  const current = createTaskFrame({
    action: "search",
    constraints: { targetEntityType: "champion", cost: 4 },
    goal: "find_entities_matching_filters",
    confidence: 0.9,
    understandingStatus: "understood_and_supported"
  });
  const resolution = resolveTaskFrameContext(current, {
    input: "该羁绊有什么四费",
    conversation: [{ taskFrame: createTaskFrame({
      action: "compare",
      concepts: [woodling, { ...woodling, rawText: "太空律动", resolvedId: "TFT17_SpaceGroove", canonicalName: "太空律动" }],
      goal: "compare_traits",
      confidence: 1,
      understandingStatus: "understood_and_supported"
    }) }]
  });
  assert.equal(resolution.taskFrame.understandingStatus, "ambiguous");
  assert.equal(resolution.taskFrame.ambiguities[0].code, "ambiguous_entity");
  assert.equal(resolution.taskFrame.ambiguities[0].candidates.length, 2);
});
