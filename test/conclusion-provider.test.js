import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAICompatibleConclusionProvider,
  resolveConclusionProviderConfig
} from "../src/index.js";

const output = {
  schemaVersion: "llm_conclusion.v1",
  status: "ok",
  headline: "标题",
  summary: "摘要",
  reasons: [],
  alternatives: [],
  nextAction: "行动",
  riskNotice: null
};

test("conclusion provider config is off by default and missing configuration stays non-fatal", () => {
  assert.equal(resolveConclusionProviderConfig({}, {}).enabled, false);
  const missing = resolveConclusionProviderConfig({ mode: "on", provider: "openai_compatible" }, {});
  assert.equal(missing.enabled, false);
  assert.ok(missing.missing.includes("TFT_AGENT_CONCLUSION_MODEL"));
  assert.equal(missing.maxCorrections, 3);
});

test("OpenAI-compatible conclusion provider sends only the evidence request and parses strict JSON", async () => {
  let request;
  const provider = createOpenAICompatibleConclusionProvider({
    endpoint: "https://provider.example/v1/chat/completions",
    model: "safe-model",
    apiKey: "secret-key",
    promptText: "prompt",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(output) } }] }) };
    }
  });
  const evidence = { schemaVersion: "llm_conclusion_evidence.v1", recommendations: [] };
  assert.deepEqual(await provider({ evidence }), output);
  const body = JSON.parse(request.init.body);
  assert.equal(body.messages[1].content, JSON.stringify(evidence));
  assert.equal(request.init.headers.authorization, "Bearer secret-key");
  assert.doesNotMatch(request.init.body, /secret-key|provider\.example/u);
  assert.equal(body.max_tokens, 350);
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(body.response_format.type, "json_object");
});

test("GPT-5 conclusion config uses a minimal reasoning budget and completion-token parameter", async () => {
  const config = resolveConclusionProviderConfig({
    mode: "on",
    model: "gpt-5-mini",
    endpoint: "https://provider.example/v1",
    apiKey: "secret-key"
  }, {});
  assert.equal(config.reasoningEffort, "minimal");
  assert.equal(config.useMaxCompletionTokens, true);

  let body;
  const provider = createOpenAICompatibleConclusionProvider({
    ...config,
    promptText: "prompt",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(output) } }] }) };
    }
  });
  await provider({ evidence: {} });
  assert.equal(body.max_completion_tokens, 350);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.reasoning_effort, "minimal");
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema.required, [
    "schemaVersion", "contractId", "status", "addressedDimensions", "missingDimensions", "missingEvidence",
    "headline", "summary", "reasons", "alternatives", "nextAction", "riskNotice"
  ]);
  assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
});

test("DeepSeek conclusion config can disable thinking without sending reasoning effort", async () => {
  const config = resolveConclusionProviderConfig({
    mode: "on",
    model: "deepseek-v4-flash",
    endpoint: "https://api.deepseek.com",
    apiKey: "secret-key"
  }, {
    TFT_AGENT_CONCLUSION_THINKING: "disabled",
    TFT_AGENT_CONCLUSION_REASONING_EFFORT: "high"
  });
  assert.equal(config.thinkingMode, "disabled");
  assert.equal(config.reasoningEffort, "high");

  let body;
  const provider = createOpenAICompatibleConclusionProvider({
    ...config,
    promptText: "prompt",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(output) } }] }) };
    }
  });
  await provider({ evidence: {} });
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.max_tokens, 350);
  assert.equal(body.response_format.type, "json_object");
});

test("OpenAI-compatible conclusion provider rejects Markdown-wrapped JSON", async () => {
  const provider = createOpenAICompatibleConclusionProvider({
    endpoint: "https://provider.example/v1/chat/completions",
    model: "safe-model",
    promptText: "prompt",
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(output)}\n\`\`\`` } }] }) })
  });
  await assert.rejects(() => provider({ evidence: {} }), (error) => error.code === "invalid_json" && error.recoverable === false);
});

test("OpenAI-compatible conclusion provider sends validation feedback on a corrective attempt", async () => {
  let body;
  const provider = createOpenAICompatibleConclusionProvider({
    endpoint: "https://provider.example/v1/chat/completions",
    model: "safe-model",
    promptText: "prompt",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(output) } }] }) };
    }
  });
  await provider({ evidence: {}, validationFeedback: ["headline contains an unsupported entity"] });
  assert.equal(body.messages.length, 3);
  assert.match(body.messages[2].content, /headline contains an unsupported entity/u);
  assert.match(body.messages[2].content, /重新生成完整 JSON/u);
});
