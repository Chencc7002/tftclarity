import test from "node:test";
import assert from "node:assert/strict";
import {
  createMechanismExtractionProvider,
  resolveMechanismExtractionConfig
} from "../src/knowledge/mechanism-extraction-provider.js";

test("mechanism extraction config uses dedicated variables before shared provider variables", () => {
  const config = resolveMechanismExtractionConfig({}, {
    OPENAI_BASE_URL: "https://shared.example/v1",
    MODEL_NAME: "shared-model",
    OPENAI_API_KEY: "shared-key",
    TFT_AGENT_MECHANISM_DISCOVERY_ENDPOINT: "https://discovery.example/v1",
    TFT_AGENT_MECHANISM_DISCOVERY_MODEL: "discovery-model",
    TFT_AGENT_MECHANISM_DISCOVERY_API_KEY: "discovery-key"
  });
  assert.equal(config.enabled, true);
  assert.equal(config.endpoint, "https://discovery.example/v1/chat/completions");
  assert.equal(config.model, "discovery-model");
  assert.equal(config.apiKey, "discovery-key");
});

test("mechanism provider tolerates reasoning wrappers but returns only the JSON object", async () => {
  let request;
  const provider = createMechanismExtractionProvider({
    endpoint: "https://provider.example/v1/chat/completions",
    model: "model",
    apiKey: "secret",
    promptText: "prompt",
    thinkingMode: "disabled",
    fetchImpl: async (_url, init) => {
      request = JSON.parse(init.body);
      return {
        ok: true,
        headers: { get: () => "request-1" },
        json: async () => ({
          choices: [{ message: { content: "<think>internal</think>\n```json\n{\"ok\":true}\n```" } }],
          usage: { total_tokens: 12 }
        })
      };
    }
  });
  const result = await provider({ pack: { caseId: "case:a" } });
  assert.deepEqual(result.value, { ok: true });
  assert.equal(result.providerRequestId, "request-1");
  assert.equal(request.response_format.type, "json_object");
  assert.deepEqual(request.thinking, { type: "disabled" });
});
