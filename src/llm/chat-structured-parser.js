import { readFile } from "node:fs/promises";

const PROMPT_URL = new URL("./prompts/parse-query.md", import.meta.url);
export const DEFAULT_STRUCTURED_PARSER_TIMEOUT_MS = 1500;
export const DEFAULT_STRUCTURED_PARSER_MODE = "auto";

function normalizeProvider(value = "off") {
  const provider = String(value ?? "off").trim().toLowerCase();
  if (!provider || provider === "off" || provider === "none" || provider === "disabled" || provider === "false") {
    return "off";
  }
  if (provider === "chat" || provider === "http" || provider === "openai-compatible") return "chat";
  throw new Error(`Unsupported structured parser provider: ${value}`);
}

function normalizeMode(value = DEFAULT_STRUCTURED_PARSER_MODE) {
  const mode = String(value ?? DEFAULT_STRUCTURED_PARSER_MODE).trim().toLowerCase();
  if (mode === "auto" || mode === "always" || mode === "never") return mode;
  if (mode === "true") return "always";
  if (mode === "false") return "never";
  throw new Error(`Unsupported structured parser mode: ${value}`);
}

function numericOption(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function chatCompletionsEndpoint(baseUrl) {
  const normalized = String(baseUrl ?? "").trim().replace(/\/+$/u, "");
  if (!normalized) return undefined;
  if (/\/chat\/completions$/iu.test(normalized)) return normalized;
  return `${normalized}/chat/completions`;
}

function compactParsed(parsed = {}) {
  return {
    intent: parsed.intent,
    unit: parsed.unit,
    unitAlias: parsed.unitAlias,
    starLevel: parsed.starLevel,
    itemCount: parsed.itemCount,
    traitFilters: parsed.traitFilters,
    itemPolicy: parsed.itemPolicy,
    lockedItems: parsed.lockedItems ?? parsed.ownedItems,
    comparisonItems: parsed.comparisonItems,
    comparisonMode: parsed.comparisonMode,
    primaryMetric: parsed.primaryMetric,
    ownedItems: parsed.ownedItems,
    excludedItems: parsed.excludedItems,
    minSamples: parsed.minSamples,
    sort: parsed.sort,
    preferenceRequested: parsed.preferenceRequested,
    preferenceConditions: parsed.preferenceConditions,
    entityMatches: parsed.parser?.entityMatches ?? []
  };
}

function jsonFromContent(content) {
  if (content && typeof content === "object") return content;
  const text = String(content ?? "").trim();
  if (!text) throw new Error("structured parser response was empty");

  try {
    return JSON.parse(text);
  } catch {
    const withoutFence = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    try {
      return JSON.parse(withoutFence);
    } catch {
      const first = withoutFence.indexOf("{");
      const last = withoutFence.lastIndexOf("}");
      if (first >= 0 && last > first) {
        return JSON.parse(withoutFence.slice(first, last + 1));
      }
      throw new Error("structured parser response did not contain valid JSON");
    }
  }
}

function responseContent(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const firstChoice = payload?.choices?.[0];
  const content = firstChoice?.message?.content ?? firstChoice?.text;
  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text ?? part?.content ?? "")
      .join("");
  }
  return content;
}

async function readPrompt(promptText) {
  if (promptText) return promptText;
  return readFile(PROMPT_URL, "utf8");
}

export function resolveStructuredParserConfig(options = {}, env = process.env) {
  const compatibleEndpoint = chatCompletionsEndpoint(env.OPENAI_BASE_URL);
  const compatibleModel = env.MODEL_NAME ?? env.OPENAI_MODEL;
  const inferredProvider = compatibleEndpoint && compatibleModel ? "chat" : "off";
  const provider = normalizeProvider(
    options.provider ?? env.TFT_AGENT_LLM_PROVIDER ?? inferredProvider
  );
  const mode = normalizeMode(options.mode ?? env.TFT_AGENT_LLM_MODE ?? DEFAULT_STRUCTURED_PARSER_MODE);
  if (provider === "off") {
    return {
      enabled: false,
      provider,
      mode
    };
  }

  const endpoint = options.endpoint ?? env.TFT_AGENT_LLM_ENDPOINT ?? compatibleEndpoint;
  const model = options.model ?? env.TFT_AGENT_LLM_MODEL ?? compatibleModel;
  const apiKey = options.apiKey ?? env.TFT_AGENT_LLM_API_KEY ?? env.OPENAI_API_KEY;
  const timeoutMs = numericOption(
    options.timeoutMs ?? env.TFT_AGENT_LLM_TIMEOUT_MS,
    DEFAULT_STRUCTURED_PARSER_TIMEOUT_MS
  );
  const missing = [];
  if (!endpoint) missing.push("TFT_AGENT_LLM_ENDPOINT");
  if (!model) missing.push("TFT_AGENT_LLM_MODEL");
  if (missing.length > 0) {
    throw new Error(`Structured parser provider "${provider}" is enabled but missing: ${missing.join(", ")}`);
  }

  return {
    enabled: true,
    provider,
    mode,
    endpoint,
    model,
    apiKey,
    timeoutMs,
    temperature: Number(options.temperature ?? env.TFT_AGENT_LLM_TEMPERATURE ?? 0),
    maxTokens: Number(options.maxTokens ?? env.TFT_AGENT_LLM_MAX_TOKENS ?? 500),
    includeResponseFormat: options.includeResponseFormat ?? env.TFT_AGENT_LLM_RESPONSE_FORMAT !== "0"
  };
}

export function createChatStructuredParser(options = {}) {
  if (!options.endpoint) throw new Error("createChatStructuredParser requires endpoint");
  if (!options.model) throw new Error("createChatStructuredParser requires model");

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("createChatStructuredParser requires fetch or fetchImpl");
  }

  let promptPromise = null;
  const getPrompt = () => {
    promptPromise ??= readPrompt(options.promptText);
    return promptPromise;
  };

  return async function chatStructuredParser({ input, parsed, catalogSummary } = {}) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutMs = numericOption(options.timeoutMs, DEFAULT_STRUCTURED_PARSER_TIMEOUT_MS);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const body = {
      model: options.model,
      messages: [
        {
          role: "system",
          content: await getPrompt()
        },
        {
          role: "user",
          content: JSON.stringify({
            input: String(input ?? ""),
            already_parsed: compactParsed(parsed),
            catalog_summary: catalogSummary ?? null
          })
        }
      ],
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 500
    };
    if (options.includeResponseFormat !== false) {
      body.response_format = {
        type: "json_object"
      };
    }

    try {
      const headers = {
        "content-type": "application/json",
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {})
      };
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = typeof response.text === "function" ? await response.text() : "";
        throw new Error(`structured parser provider returned HTTP ${response.status}: ${errorText}`.trim());
      }

      const payload = await response.json();
      const parsedResponse = jsonFromContent(responseContent(payload));
      options.onRequestLog?.({
        status: "ok",
        durationMs: Date.now() - startedAt,
        model: options.model
      });
      return parsedResponse;
    } catch (error) {
      options.onRequestLog?.({
        status: "error",
        durationMs: Date.now() - startedAt,
        model: options.model,
        error: error.name === "AbortError" ? "timeout" : error.message
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}

export function createStructuredParserFromConfig(config = {}, options = {}) {
  if (!config.enabled) return null;
  if (config.provider !== "chat") {
    throw new Error(`Unsupported structured parser provider: ${config.provider}`);
  }
  return createChatStructuredParser({
    ...config,
    fetchImpl: options.fetchImpl ?? config.fetchImpl,
    promptText: options.promptText ?? config.promptText,
    onRequestLog: options.onRequestLog ?? config.onRequestLog
  });
}
