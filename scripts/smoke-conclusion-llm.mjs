import { readFileSync } from "node:fs";

import { loadLocalEnvironment } from "../src/config/load-env.js";
import {
  createCatalog,
  createConclusionProviderFromConfig,
  generateEvidenceBackedConclusion,
  resolveConclusionProviderConfig
} from "../src/index.js";

loadLocalEnvironment();

// Running this script is an explicit one-shot opt-in. It does not persistently
// change TFT_AGENT_CONCLUSION_MODE or any other local environment setting.
const smokeTimeoutMs = Number(process.env.SMOKE_CONCLUSION_TIMEOUT_MS ?? 10_000);
const smokeMaxOutputTokens = process.env.SMOKE_CONCLUSION_MAX_OUTPUT_TOKENS === undefined
  ? null
  : Number(process.env.SMOKE_CONCLUSION_MAX_OUTPUT_TOKENS);
const config = resolveConclusionProviderConfig({
  mode: "on",
  timeoutMs: smokeTimeoutMs,
  ...(smokeMaxOutputTokens === null ? {} : { maxOutputTokens: smokeMaxOutputTokens })
});
if (!config.enabled) {
  throw new Error(`Conclusion LLM configuration is incomplete: ${config.missing.join(", ")}`);
}

const requestLogs = [];
const responseMetadata = [];
function safeProviderError(payload) {
  const error = payload?.error;
  if (!error || typeof error !== "object") return null;
  const clipped = (value, limit) => String(value ?? "")
    .replace(/\b(?:https?|wss?):\/\/\S+/giu, "[redacted-url]")
    .replace(/\b(?:bearer\s+\S+|sk-[A-Za-z0-9_-]{8,})/giu, "[redacted-secret]")
    .slice(0, limit) || null;
  return {
    type: clipped(error.type, 80),
    code: clipped(error.code, 80),
    message: clipped(error.message, 500)
  };
}
const provider = createConclusionProviderFromConfig(config, {
  async fetchImpl(...args) {
    const response = await fetch(...args);
    try {
      const payload = await response.clone().json();
      const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text ?? payload?.output_text;
      const text = typeof content === "string" ? content.trim() : "";
      responseMetadata.push({
        httpStatus: response.status,
        finishReason: payload?.choices?.[0]?.finish_reason ?? null,
        contentType: Array.isArray(content) ? "array" : typeof content,
        contentLength: text.length,
        startsWithObject: text.startsWith("{"),
        startsWithFence: text.startsWith("```"),
        providerError: response.ok ? null : safeProviderError(payload)
      });
    } catch {
      responseMetadata.push({ httpStatus: response.status, responseJson: false });
    }
    return response;
  },
  onRequestLog(event) {
    requestLogs.push(event);
  }
});
const result = JSON.parse(readFileSync(
  new URL("../test/fixtures/conclusion-fixture.json", import.meta.url),
  "utf8"
));
const conclusion = await generateEvidenceBackedConclusion({
  result,
  catalog: createCatalog(),
  input: "霞已有羊刀，剩下两件怎么带？",
  config,
  provider,
  requestEnabled: true,
  bypassCache: true
});

if (conclusion.status !== "generated") {
  const providerError = requestLogs.at(-1)?.error ?? "none";
  throw new Error(`Real conclusion smoke failed: ${conclusion.status}/${conclusion.reason}; provider=${providerError}; metadata=${JSON.stringify(responseMetadata.at(-1) ?? null)}`);
}

console.log(JSON.stringify({
  ok: true,
  provider: config.provider,
  model: config.model,
  status: conclusion.status,
  latencyMs: conclusion.latencyMs,
  timeoutMs: config.timeoutMs,
  maxOutputTokens: config.maxOutputTokens,
  attempts: requestLogs.length,
  contentFields: Object.keys(conclusion.content ?? {}),
  headlineLength: conclusion.content?.headline?.length ?? 0
}, null, 2));
