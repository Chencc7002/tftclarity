import test from "node:test";
import assert from "node:assert/strict";
import {
  COACH_RESPONSE_SCHEMA,
  createOpenAICompatibleCoachProvider,
  resolveCoachProviderConfig
} from "../src/coach/coach-provider.js";

test("coach provider inherits disabled thinking for DeepSeek JSON output", async () => {
  const config = resolveCoachProviderConfig({}, {
    TFT_AGENT_CONCLUSION_MODE: "on",
    TFT_AGENT_CONCLUSION_THINKING: "disabled",
    OPENAI_BASE_URL: "https://example.test",
    MODEL_NAME: "deepseek-v4-flash",
    OPENAI_API_KEY: "test-key"
  });
  assert.equal(config.enabled, true);
  assert.equal(config.thinkingMode, "disabled");

  let requestBody;
  const provider = createOpenAICompatibleCoachProvider({
    ...config,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: '{"schemaVersion":"coach_answer.v1"}' } }]
          };
        }
      };
    }
  });

  const answer = await provider({ question: "test", evidenceBundle: {} });
  assert.equal(answer.schemaVersion, "coach_answer.v1");
  assert.deepEqual(requestBody.thinking, { type: "disabled" });
  assert.equal(requestBody.response_format.type, "json_object");
});

test("coach JSON schema permits the required dimension fields", () => {
  assert.ok(COACH_RESPONSE_SCHEMA.properties.reasons.items.required.includes("dimension"));
  assert.ok(COACH_RESPONSE_SCHEMA.properties.alternatives.items.required.includes("dimension"));
  assert.equal(
    COACH_RESPONSE_SCHEMA.properties.reasons.items.properties.dimension.type,
    "string"
  );
});
