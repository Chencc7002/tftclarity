import { readFile } from "node:fs/promises";
import { createConclusionPromptRegistry } from "./conclusion-prompt-registry.js";

const PROMPT_URL = new URL("./prompts/generate-conclusion.md", import.meta.url);
export const DEFAULT_CONCLUSION_TIMEOUT_MS = 1800;
export const DEFAULT_CONCLUSION_MAX_OUTPUT_TOKENS = 350;

const CONCLUSION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "contractId", "status", "addressedDimensions", "missingDimensions", "missingEvidence",
    "headline", "summary", "reasons", "alternatives", "nextAction", "riskNotice"
  ],
  properties: {
    schemaVersion: { type: "string", enum: ["llm_conclusion.v2"] },
    contractId: { type: "string" },
    status: { type: "string", enum: ["ok", "insufficient_evidence"] },
    addressedDimensions: { type: "array", uniqueItems: true, items: { type: "string" } },
    missingDimensions: { type: "array", uniqueItems: true, items: { type: "string" } },
    missingEvidence: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["dimension", "requiredEvidence"],
        properties: {
          dimension: { type: "string" },
          requiredEvidence: { type: "array", items: { type: "string" } }
        }
      }
    },
    headline: { type: "string" },
    summary: { type: "string" },
    reasons: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["dimension", "evidenceIds", "text"],
        properties: {
          dimension: { type: "string" },
          evidenceIds: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
          text: { type: "string" }
        }
      }
    },
    alternatives: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["dimension", "evidenceIds", "text"],
        properties: {
          dimension: { type: "string" },
          evidenceIds: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
          text: { type: "string" }
        }
      }
    },
    nextAction: { type: "string" },
    riskNotice: { anyOf: [{ type: "string" }, { type: "null" }] }
  }
};

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function usesReasoningCompletionTokens(model) {
  return /^(?:gpt-5(?:$|[-.])|o[134](?:$|[-.]))/iu.test(String(model ?? ""));
}

function reasoningEffort(value, model) {
  const effort = String(value ?? (usesReasoningCompletionTokens(model) ? "minimal" : "")).trim().toLowerCase();
  if (!effort) return null;
  if (!["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort)) {
    throw new Error(`Unsupported conclusion reasoning effort: ${value}`);
  }
  return effort;
}

function thinkingMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  if (!mode) return null;
  if (["on", "enabled", "true"].includes(mode)) return "enabled";
  if (["off", "disabled", "false"].includes(mode)) return "disabled";
  throw new Error(`Unsupported conclusion thinking mode: ${value}`);
}

function normalizeMode(value = "off") {
  const mode = String(value ?? "off").trim().toLowerCase();
  if (["off", "none", "disabled", "false", "never"].includes(mode)) return "off";
  if (["on", "enabled", "true", "always", "auto"].includes(mode)) return "on";
  throw new Error(`Unsupported conclusion mode: ${value}`);
}

function normalizeProvider(value = "off") {
  const provider = String(value ?? "off").trim().toLowerCase();
  if (["off", "none", "disabled", "false"].includes(provider)) return "off";
  if (["openai_compatible", "openai-compatible", "chat", "http"].includes(provider)) return "openai_compatible";
  throw new Error(`Unsupported conclusion provider: ${value}`);
}

function chatCompletionsEndpoint(value) {
  const endpoint = String(value ?? "").trim().replace(/\/+$/u, "");
  if (!endpoint) return null;
  return /\/chat\/completions$/iu.test(endpoint) ? endpoint : `${endpoint}/chat/completions`;
}

export function resolveConclusionProviderConfig(options = {}, env = process.env) {
  const mode = normalizeMode(options.mode ?? env.TFT_AGENT_CONCLUSION_MODE ?? "off");
  const provider = normalizeProvider(options.provider ?? env.TFT_AGENT_CONCLUSION_PROVIDER ?? (mode === "off" ? "off" : "openai_compatible"));
  const endpoint = chatCompletionsEndpoint(
    options.endpoint ?? env.TFT_AGENT_CONCLUSION_ENDPOINT ?? env.OPENAI_BASE_URL
  );
  const model = options.model ?? env.TFT_AGENT_CONCLUSION_MODEL ?? env.MODEL_NAME ?? env.OPENAI_MODEL ?? null;
  const apiKey = options.apiKey ?? env.TFT_AGENT_CONCLUSION_API_KEY ?? env.OPENAI_API_KEY ?? null;
  const allowUnauthenticated = Boolean(options.allowUnauthenticated);
  const missing = [];
  if (mode !== "off" && provider !== "off") {
    if (!endpoint) missing.push("TFT_AGENT_CONCLUSION_ENDPOINT");
    if (!model) missing.push("TFT_AGENT_CONCLUSION_MODEL");
    if (!apiKey && !allowUnauthenticated) missing.push("TFT_AGENT_CONCLUSION_API_KEY");
  }
  return {
    enabled: mode !== "off" && provider !== "off" && missing.length === 0,
    mode,
    provider,
    endpoint,
    model: model ? String(model) : null,
    apiKey: apiKey ? String(apiKey) : null,
    missing,
    timeoutMs: positiveNumber(options.timeoutMs ?? env.TFT_AGENT_CONCLUSION_TIMEOUT_MS, DEFAULT_CONCLUSION_TIMEOUT_MS),
    maxOutputTokens: positiveNumber(
      options.maxOutputTokens ?? env.TFT_AGENT_CONCLUSION_MAX_OUTPUT_TOKENS,
      DEFAULT_CONCLUSION_MAX_OUTPUT_TOKENS
    ),
    temperature: Number(options.temperature ?? 0),
    reasoningEffort: reasoningEffort(
      options.reasoningEffort ?? env.TFT_AGENT_CONCLUSION_REASONING_EFFORT,
      model
    ),
    thinkingMode: thinkingMode(options.thinkingMode ?? env.TFT_AGENT_CONCLUSION_THINKING),
    useMaxCompletionTokens: options.useMaxCompletionTokens ?? usesReasoningCompletionTokens(model),
    useStructuredOutput: options.useStructuredOutput ?? usesReasoningCompletionTokens(model),
    includeResponseFormat: options.includeResponseFormat ?? true,
    promptVersion: String(options.promptVersion ?? "generate-conclusion.v9"),
    maxCorrections: Math.max(0, Math.min(5, Math.floor(Number(
      options.maxCorrections ?? env.TFT_AGENT_CONCLUSION_MAX_CORRECTIONS ?? 3
    )))),
    maxValidationErrors: Math.max(1, Math.min(50, Math.floor(Number(
      options.maxValidationErrors ?? env.TFT_AGENT_CONCLUSION_MAX_VALIDATION_ERRORS ?? 8
    )))),
    maxTransportRetries: Math.max(0, Math.min(3, Math.floor(Number(
      options.maxTransportRetries ?? env.TFT_AGENT_CONCLUSION_MAX_TRANSPORT_RETRIES ?? 1
    )))),
    cacheTtlMs: positiveNumber(options.cacheTtlMs, 30 * 60 * 1000),
    onEvent: options.onEvent
  };
}

export class ConclusionProviderError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ConclusionProviderError";
    this.code = options.code ?? "provider_error";
    this.recoverable = Boolean(options.recoverable);
    this.status = options.status ?? null;
  }
}

function responseContent(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? part?.content ?? "").join("");
  return content;
}

function parseStrictJson(content) {
  if (content && typeof content === "object") return content;
  const text = String(content ?? "").trim();
  if (!text) throw new ConclusionProviderError("Conclusion provider returned empty content", { code: "invalid_json" });
  if (text.startsWith("```") || !text.startsWith("{") || !text.endsWith("}")) {
    throw new ConclusionProviderError("Conclusion provider did not return strict JSON", { code: "invalid_json" });
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ConclusionProviderError("Conclusion provider returned invalid JSON", { code: "invalid_json", cause });
  }
}

async function promptText(value) {
  return value ?? readFile(PROMPT_URL, "utf8");
}

function httpRecoverable(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function createOpenAICompatibleConclusionProvider(options = {}) {
  if (!options.endpoint) throw new Error("createOpenAICompatibleConclusionProvider requires endpoint");
  if (!options.model) throw new Error("createOpenAICompatibleConclusionProvider requires model");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("createOpenAICompatibleConclusionProvider requires fetch or fetchImpl");
  let promptPromise = null;
  const registry = options.promptRegistry ?? createConclusionPromptRegistry();
  const getPrompt = async (evidence, correction) => {
    if (options.promptText !== undefined) {
      promptPromise ??= promptText(options.promptText);
      return promptPromise;
    }
    const intent = evidence?.request?.requestedIntent ?? evidence?.request?.intent;
    const prompt = await registry.load({
      intent,
      questionType: evidence?.questionContract?.questionType ?? "default",
      resultType: evidence?.questionContract?.resultType ?? intent,
      specId: evidence?.conclusionSpec?.id ?? null
    }, { correction });
    if (!prompt) {
      throw new ConclusionProviderError(`No conclusion prompt is registered for intent: ${intent ?? "missing"}`, {
        code: "unregistered_intent",
        recoverable: false
      });
    }
    return prompt.text;
  };

  const provider = async ({ evidence, validationFeedback = [] } = {}) => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutMs = positiveNumber(options.timeoutMs, DEFAULT_CONCLUSION_TIMEOUT_MS);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const body = {
      model: options.model,
      messages: [
        { role: "system", content: await getPrompt(evidence, Array.isArray(validationFeedback) ? validationFeedback.length > 0 : Boolean(validationFeedback)) },
        { role: "user", content: JSON.stringify(evidence) },
        ...((Array.isArray(validationFeedback) ? validationFeedback.length > 0 : Boolean(validationFeedback)) ? [{
          role: "user",
          content: `上一版结论未通过证据校验。请重新生成完整 JSON，并逐项修正 validationFeedback。若某项给出 missingEvidenceIds，请在产生该数字或比较的同一条 reason/alternative 中补充实际使用的对应 Evidence ID（每条最多 3 个），或删除不受当前引用支持的内容：\n${JSON.stringify(validationFeedback)}`
        }] : [])
      ],
      temperature: Number(options.temperature ?? 0)
    };
    const maxOutputTokens = positiveNumber(options.maxOutputTokens, DEFAULT_CONCLUSION_MAX_OUTPUT_TOKENS);
    if (options.useMaxCompletionTokens ?? usesReasoningCompletionTokens(options.model)) {
      body.max_completion_tokens = maxOutputTokens;
    } else {
      body.max_tokens = maxOutputTokens;
    }
    if (options.thinkingMode) body.thinking = { type: options.thinkingMode };
    if (options.reasoningEffort && options.thinkingMode !== "disabled") {
      body.reasoning_effort = options.reasoningEffort;
    }
    if (options.includeResponseFormat !== false) {
      body.response_format = (options.useStructuredOutput ?? usesReasoningCompletionTokens(options.model))
        ? {
            type: "json_schema",
            json_schema: {
              name: "tft_evidence_conclusion",
              strict: true,
              schema: CONCLUSION_RESPONSE_SCHEMA
            }
          }
        : { type: "json_object" };
    }

    try {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new ConclusionProviderError(`Conclusion provider returned HTTP ${response.status}`, {
          code: "http_error",
          status: response.status,
          recoverable: httpRecoverable(response.status)
        });
      }
      const payload = await response.json();
      const value = parseStrictJson(responseContent(payload));
      options.onRequestLog?.({ status: "ok", durationMs: Date.now() - startedAt, model: options.model });
      return value;
    } catch (error) {
      const timeoutError = error?.name === "AbortError";
      const normalized = error instanceof ConclusionProviderError
        ? error
        : new ConclusionProviderError(timeoutError ? "Conclusion provider timed out" : "Conclusion provider request failed", {
          code: timeoutError ? "timeout" : "network_error",
          recoverable: true,
          cause: error
        });
      options.onRequestLog?.({
        status: "error",
        durationMs: Date.now() - startedAt,
        model: options.model,
        error: normalized.code
      });
      throw normalized;
    } finally {
      clearTimeout(timeout);
    }
  };
  provider.model = options.model;
  provider.provider = "openai_compatible";
  return provider;
}

export function createConclusionProviderFromConfig(config = {}, options = {}) {
  if (!config.enabled) return null;
  if (config.provider !== "openai_compatible") throw new Error(`Unsupported conclusion provider: ${config.provider}`);
  return createOpenAICompatibleConclusionProvider({
    ...config,
    fetchImpl: options.fetchImpl ?? config.fetchImpl,
    promptText: options.promptText ?? config.promptText,
    onRequestLog: options.onRequestLog ?? config.onRequestLog
  });
}
