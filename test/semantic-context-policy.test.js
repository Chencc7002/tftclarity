import test from "node:test";
import assert from "node:assert/strict";
import {
  compressAgentContext,
  createAgentStateBar,
  shouldCompressContext,
  verifyCompressionRetention
} from "../src/understanding/context-policy.js";

test("context compression uses explicit triggers and retains goal, evidence and tool completion", () => {
  const stateBar = createAgentStateBar({
    objective: "choose_best",
    completedSteps: [
      { id: "resolve_champion", tool: "champion.resolve", status: "completed", summary: "霞" },
      { id: "compare_items", tool: "item.compare", status: "pending" }
    ],
    remainingBudget: { steps: 2, toolCalls: 1, inputTokens: 400, outputTokens: 120, deadlineMs: 800 },
    unresolvedAmbiguities: [{ code: "item_alias", candidates: ["炼刀", "巨九"] }],
    keyEvidence: [{ id: "catalog:霞", type: "entity", source: "current_catalog", summary: "TFT17_Xayah" }]
  });
  const before = {
    messages: Array.from({ length: 30 }, (_, index) => ({ role: "tool", content: `raw-${index}` })),
    stateBar,
    pendingItems: ["compare_items"],
    failureReasons: [],
    sourceReferences: ["catalog:霞"]
  };

  assert.deepEqual(shouldCompressContext(before, { maxMessages: 24 }).required, true);
  const compressed = compressAgentContext(before);
  assert.equal(compressed.messages, undefined);
  assert.equal(verifyCompressionRetention(before, compressed).valid, true);
  assert.equal(compressed.objective, "choose_best");
  assert.equal(compressed.completedSteps[0].status, "completed");
  assert.equal(compressed.keyEvidence[0].id, "catalog:霞");
});
