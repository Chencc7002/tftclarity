import test from "node:test";
import assert from "node:assert/strict";
import { createChatExecutionPlannerProvider } from "../src/index.js";

test("chat execution planner sends the bounded catalog and returns plan telemetry", async () => {
  let requestBody = null;
  const plan = {
    schemaVersion: "execution-plan.v1",
    route: "controlled_planner",
    steps: [],
    resultPolicy: { type: "identity" },
    finalEvidenceContract: {
      required: true,
      type: "test",
      source: "test",
      requiredFields: ["source"],
      allowModelGeneratedStatistics: false
    }
  };
  const provider = createChatExecutionPlannerProvider({
    endpoint: "https://llm.test/v1/chat/completions",
    model: "planner-model",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: JSON.stringify(plan) } }],
            usage: { prompt_tokens: 25, completion_tokens: 10 }
          };
        }
      };
    }
  });

  const result = await provider({
    taskFrame: { schemaVersion: "task-frame.v1", goal: "compare" },
    toolCatalog: [{ name: "entity_catalog_query" }],
    constraints: { maxSteps: 3, maxToolCalls: 3 }
  });

  assert.deepEqual(result.executionPlan, plan);
  assert.equal(result.telemetry.model, "planner-model");
  assert.deepEqual(result.telemetry.usage, {
    cachedInputTokens: 0,
    uncachedInputTokens: 25,
    outputTokens: 10
  });
  assert.equal(provider.plannerKind, "llm");
  assert.equal(requestBody.response_format.type, "json_object");
  assert.equal(requestBody.messages[1].content.includes("entity_catalog_query"), true);
});
