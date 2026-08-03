import test from "node:test";
import assert from "node:assert/strict";
import {
  createMechanismClassificationProvider,
  resolveMechanismClassificationConfig
} from "../src/knowledge/mechanism-classification-provider.js";

test("mechanism classification config prefers dedicated variables and falls back to shared LLM", () => {
  const dedicated = resolveMechanismClassificationConfig({}, {
    OPENAI_BASE_URL: "https://shared.example/v1",
    MODEL_NAME: "shared-model",
    OPENAI_API_KEY: "shared-key",
    TFT_AGENT_MECHANISM_CLASSIFICATION_ENDPOINT: "https://classification.example/v1",
    TFT_AGENT_MECHANISM_CLASSIFICATION_MODEL: "classification-model",
    TFT_AGENT_MECHANISM_CLASSIFICATION_API_KEY: "classification-key"
  });
  assert.equal(dedicated.enabled, true);
  assert.equal(dedicated.endpoint, "https://classification.example/v1/chat/completions");
  assert.equal(dedicated.model, "classification-model");
  assert.equal(dedicated.apiKey, "classification-key");

  const shared = resolveMechanismClassificationConfig({}, {
    OPENAI_BASE_URL: "https://shared.example/v1",
    OPENAI_MODEL: "shared-model",
    OPENAI_API_KEY: "shared-key"
  });
  assert.equal(shared.enabled, true);
  assert.equal(shared.model, "shared-model");
});

test("mechanism classification provider sends current evidence and parses strict JSON", async () => {
  let request;
  const provider = createMechanismClassificationProvider({
    endpoint: "https://provider.example/v1/chat/completions",
    model: "model",
    apiKey: "secret",
    promptText: "definitions",
    fetchImpl: async (_url, init) => {
      request = JSON.parse(init.body);
      return {
        ok: true,
        headers: { get: () => "request-1" },
        json: async () => ({
          choices: [{ message: { content: "```json\n{\"entries\":[]}\n```" } }],
          usage: { total_tokens: 42 }
        })
      };
    }
  });
  const result = await provider({
    seasonContext: { id: "set18" },
    evidence: [{ entityType: "trait", apiName: "Trait", name: "羁绊" }]
  });
  assert.deepEqual(result.value, { entries: [] });
  assert.equal(result.providerRequestId, "request-1");
  assert.equal(request.response_format.type, "json_object");
  assert.deepEqual(request.thinking, { type: "disabled" });
  const input = JSON.parse(request.messages[1].content);
  assert.equal(input.seasonContext.id, "set18");
  assert.equal(input.entities[0].apiName, "Trait");
});
