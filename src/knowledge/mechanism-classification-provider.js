import { readFile } from "node:fs/promises";

const DEFAULT_PROMPT_URL = new URL("./prompts/classify-growth-development.md", import.meta.url);

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function chatCompletionsEndpoint(value) {
  const endpoint = String(value ?? "").trim().replace(/\/+$/u, "");
  if (!endpoint) return null;
  return /\/chat\/completions$/iu.test(endpoint) ? endpoint : `${endpoint}/chat/completions`;
}

function normalizedMode(value) {
  const mode = String(value ?? "auto").trim().toLowerCase();
  return ["off", "disabled", "false", "0"].includes(mode) ? "off" : mode;
}

export function resolveMechanismClassificationConfig(options = {}, env = process.env) {
  const endpoint = chatCompletionsEndpoint(
    options.endpoint
      ?? env.TFT_AGENT_MECHANISM_CLASSIFICATION_ENDPOINT
      ?? env.OPENAI_BASE_URL
  );
  const model = String(
    options.model
      ?? env.TFT_AGENT_MECHANISM_CLASSIFICATION_MODEL
      ?? env.MODEL_NAME
      ?? env.OPENAI_MODEL
      ?? ""
  ).trim() || null;
  const apiKey = String(
    options.apiKey
      ?? env.TFT_AGENT_MECHANISM_CLASSIFICATION_API_KEY
      ?? env.OPENAI_API_KEY
      ?? ""
  ).trim() || null;
  const mode = normalizedMode(options.mode ?? env.TFT_AGENT_MECHANISM_CLASSIFICATION_MODE);
  const missing = [];
  if (!endpoint) missing.push("TFT_AGENT_MECHANISM_CLASSIFICATION_ENDPOINT");
  if (!model) missing.push("TFT_AGENT_MECHANISM_CLASSIFICATION_MODEL");
  if (!apiKey && !options.allowUnauthenticated) {
    missing.push("TFT_AGENT_MECHANISM_CLASSIFICATION_API_KEY");
  }
  return {
    enabled: mode !== "off" && missing.length === 0,
    mode,
    endpoint,
    model,
    apiKey,
    missing,
    timeoutMs: positiveNumber(
      options.timeoutMs ?? env.TFT_AGENT_MECHANISM_CLASSIFICATION_TIMEOUT_MS,
      90000
    ),
    maxOutputTokens: positiveNumber(
      options.maxOutputTokens ?? env.TFT_AGENT_MECHANISM_CLASSIFICATION_MAX_OUTPUT_TOKENS,
      8000
    ),
    temperature: Number(
      options.temperature ?? env.TFT_AGENT_MECHANISM_CLASSIFICATION_TEMPERATURE ?? 0.1
    ),
    thinkingMode: String(
      options.thinkingMode
        ?? env.TFT_AGENT_MECHANISM_CLASSIFICATION_THINKING_MODE
        ?? "disabled"
    ).trim() || null,
    promptVersion: "classify-growth-development.v4"
  };
}

function responseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text ?? part?.content ?? "").join("");
  }
  return content;
}

function strictJson(value) {
  if (value && typeof value === "object") return value;
  const text = String(value ?? "").trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw Object.assign(new Error("Mechanism classification provider did not return JSON"), {
      code: "invalid_json",
      recoverable: true,
      responsePreview: text.slice(0, 200)
    });
  }
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch (cause) {
    throw Object.assign(new Error("Mechanism classification provider returned invalid JSON", { cause }), {
      code: "invalid_json",
      recoverable: true,
      responsePreview: text.slice(0, 200)
    });
  }
}

export function createMechanismClassificationProvider(options = {}) {
  if (!options.endpoint || !options.model) {
    throw new Error("createMechanismClassificationProvider requires endpoint and model");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const thinkingMode = options.thinkingMode ?? "disabled";
  let promptPromise;
  const loadPrompt = () => {
    promptPromise ??= options.promptText !== undefined
      ? Promise.resolve(String(options.promptText))
      : readFile(options.promptUrl ?? DEFAULT_PROMPT_URL, "utf8");
    return promptPromise;
  };

  const provider = async ({ evidence, seasonContext = null, completenessAttempt = 1 } = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), positiveNumber(options.timeoutMs, 90000));
    try {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: await loadPrompt() },
            {
              role: "user",
              content: JSON.stringify({
                schemaVersion: "mechanism-classification-input.v1",
                seasonContext,
                completenessAttempt,
                expectedEntityCount: evidence?.length ?? 0,
                entities: evidence
              })
            }
          ],
          temperature: Number(options.temperature ?? 0.1),
          max_tokens: positiveNumber(options.maxOutputTokens, 8000),
          response_format: { type: "json_object" },
          ...(thinkingMode ? { thinking: { type: thinkingMode } } : {})
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        throw Object.assign(
          new Error(`Mechanism classification provider returned HTTP ${response.status}`),
          {
            code: "http_error",
            status: response.status,
            recoverable: response.status === 408 || response.status === 429 || response.status >= 500
          }
        );
      }
      const payload = await response.json();
      return {
        value: strictJson(responseText(payload)),
        usage: payload?.usage ?? null,
        providerRequestId: response.headers?.get?.("x-request-id") ?? null
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw Object.assign(new Error("Mechanism classification provider timed out"), {
          code: "timeout",
          recoverable: true
        });
      }
      if (error?.code && "recoverable" in error) throw error;
      throw Object.assign(new Error("Mechanism classification provider request failed", { cause: error }), {
        code: "network_error",
        recoverable: true
      });
    } finally {
      clearTimeout(timeout);
    }
  };
  provider.model = options.model;
  provider.promptVersion = "classify-growth-development.v4";
  return provider;
}

export function createMechanismClassificationProviderFromConfig(config, options = {}) {
  if (!config?.enabled) return null;
  return createMechanismClassificationProvider({
    ...config,
    ...options
  });
}
