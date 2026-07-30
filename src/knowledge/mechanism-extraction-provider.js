import { readFile } from "node:fs/promises";

const DEFAULT_PROMPT_URL = new URL("./prompts/discover-mechanism-factors.md", import.meta.url);

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function chatCompletionsEndpoint(value) {
  const endpoint = String(value ?? "").trim().replace(/\/+$/u, "");
  if (!endpoint) return null;
  return /\/chat\/completions$/iu.test(endpoint) ? endpoint : `${endpoint}/chat/completions`;
}

export function resolveMechanismExtractionConfig(options = {}, env = process.env) {
  const endpoint = chatCompletionsEndpoint(
    options.endpoint
      ?? env.TFT_AGENT_MECHANISM_DISCOVERY_ENDPOINT
      ?? env.OPENAI_BASE_URL
  );
  const model = String(
    options.model
      ?? env.TFT_AGENT_MECHANISM_DISCOVERY_MODEL
      ?? env.MODEL_NAME
      ?? env.OPENAI_MODEL
      ?? ""
  ).trim() || null;
  const apiKey = String(
    options.apiKey
      ?? env.TFT_AGENT_MECHANISM_DISCOVERY_API_KEY
      ?? env.OPENAI_API_KEY
      ?? ""
  ).trim() || null;
  const missing = [];
  if (!endpoint) missing.push("TFT_AGENT_MECHANISM_DISCOVERY_ENDPOINT");
  if (!model) missing.push("TFT_AGENT_MECHANISM_DISCOVERY_MODEL");
  if (!apiKey && !options.allowUnauthenticated) missing.push("TFT_AGENT_MECHANISM_DISCOVERY_API_KEY");
  return {
    enabled: missing.length === 0,
    endpoint,
    model,
    apiKey,
    missing,
    timeoutMs: positiveNumber(
      options.timeoutMs ?? env.TFT_AGENT_MECHANISM_DISCOVERY_TIMEOUT_MS,
      90000
    ),
    maxOutputTokens: positiveNumber(
      options.maxOutputTokens ?? env.TFT_AGENT_MECHANISM_DISCOVERY_MAX_OUTPUT_TOKENS,
      5000
    ),
    temperature: Number(options.temperature ?? env.TFT_AGENT_MECHANISM_DISCOVERY_TEMPERATURE ?? 0.2),
    promptVersion: "discover-mechanism-factors.v1"
  };
}

function responseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? part?.content ?? "").join("");
  return content;
}

function strictJson(value) {
  if (value && typeof value === "object") return value;
  const text = String(value ?? "").trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw Object.assign(new Error("Mechanism extraction provider did not return strict JSON"), {
      code: "invalid_json",
      recoverable: true,
      responsePreview: text.slice(0, 200)
    });
  }
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch (cause) {
    throw Object.assign(new Error("Mechanism extraction provider returned invalid JSON", { cause }), {
      code: "invalid_json",
      recoverable: true,
      responsePreview: text.slice(0, 200)
    });
  }
}

export function createMechanismExtractionProvider(options = {}) {
  if (!options.endpoint || !options.model) {
    throw new Error("createMechanismExtractionProvider requires endpoint and model");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let promptPromise;
  const loadPrompt = () => {
    promptPromise ??= options.promptText !== undefined
      ? Promise.resolve(String(options.promptText))
      : readFile(options.promptUrl ?? DEFAULT_PROMPT_URL, "utf8");
    return promptPromise;
  };

  const provider = async ({ pack, validationFeedback = null, previousOutput = null } = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), positiveNumber(options.timeoutMs, 90000));
    const messages = [
      { role: "system", content: await loadPrompt() },
      { role: "user", content: JSON.stringify(pack) }
    ];
    if (validationFeedback?.length) {
      messages.push({
        role: "user",
        content: [
          "上一版 JSON 未通过本地证据校验。仅修复列出的错误，返回完整 JSON。",
          `上一版：${JSON.stringify(previousOutput)}`,
          `错误：${JSON.stringify(validationFeedback)}`
        ].join("\n")
      });
    }
    const body = {
      model: options.model,
      messages,
      temperature: Number(options.temperature ?? 0.2),
      max_tokens: positiveNumber(options.maxOutputTokens, 5000),
      response_format: { type: "json_object" }
    };
    if (options.thinkingMode) body.thinking = { type: options.thinkingMode };
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
        const error = new Error(`Mechanism extraction provider returned HTTP ${response.status}`);
        error.code = "http_error";
        error.status = response.status;
        error.recoverable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw error;
      }
      const payload = await response.json();
      return {
        value: strictJson(responseText(payload)),
        usage: payload?.usage ?? null,
        providerRequestId: response.headers?.get?.("x-request-id") ?? null
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw Object.assign(new Error("Mechanism extraction provider timed out"), {
          code: "timeout",
          recoverable: true
        });
      }
      if (error?.code && "recoverable" in error) throw error;
      throw Object.assign(new Error("Mechanism extraction provider request failed", { cause: error }), {
        code: "network_error",
        recoverable: true
      });
    } finally {
      clearTimeout(timeout);
    }
  };
  provider.model = options.model;
  provider.promptVersion = "discover-mechanism-factors.v1";
  return provider;
}
