import assert from "node:assert/strict";
import test from "node:test";
import { compileExecutionPlan } from "../src/agent/execution-plan.js";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";
import { ToolRegistry } from "../src/agent/tools/registry.js";
import { matchTaskCapabilities } from "../src/understanding/capability-matcher.js";
import { createTaskFrame } from "../src/understanding/task-frame.js";

test("find_video compiles to the registered strategy_video_search capability", () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const definition = registry.get("strategy_video_search");
  assert.equal(definition.source, "bilibili");
  assert.equal(definition.trustTier, "third_party");
  assert.equal(definition.readOnly, true);
  assert.deepEqual(definition.inputSchema.properties.ecosystem.enum, [
    "tft_pc",
    "golden_spatula",
    "both"
  ]);

  const frame = createTaskFrame({
    domain: "tft",
    action: "find_video",
    goal: "find_strategy_video",
    understandingStatus: "understood_and_supported",
    subjects: [{ expectedType: "champion", rawText: "霞", resolvedId: "TFT18_Xayah" }],
    capabilityRequirements: ["strategy_video_search"],
    expectedOutput: ["video_candidates", "evidence"]
  });
  const capability = matchTaskCapabilities(frame, registry);
  assert.equal(capability.status, "understood_and_supported");
  assert.equal(capability.selected[0].tool, "strategy_video_search");
  const execution = compileExecutionPlan(frame, capability, { registry });
  assert.equal(execution.status, "understood_and_supported");
  assert.equal(execution.plan.steps[0].tool, "strategy_video_search");
  assert.deepEqual(execution.plan.steps[0].arguments, { query: "霞" });
});
