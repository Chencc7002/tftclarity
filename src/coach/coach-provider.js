export const COACH_ANSWER_SCHEMA_VERSION = "coach_answer.v1";
export const DEFAULT_COACH_TIMEOUT_MS = 15000;
export const DEFAULT_COACH_MAX_OUTPUT_TOKENS = 2200;

const COACH_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "status",
    "headline",
    "text",
    "currentRecommendation",
    "reasons",
    "alternatives",
    "citations",
    "warnings"
  ],
  properties: {
    schemaVersion: { type: "string", enum: [COACH_ANSWER_SCHEMA_VERSION] },
    status: { type: "string", enum: ["ok", "insufficient_evidence"] },
    headline: { type: "string" },
    text: { type: "string" },
    currentRecommendation: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["evidenceId", "label"],
          properties: {
            evidenceId: { type: "string" },
            label: { type: "string" }
          }
        }
      ]
    },
    reasons: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["evidenceIds", "text"],
        properties: {
          evidenceIds: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: { type: "string" }
          },
          text: { type: "string" }
        }
      }
    },
    alternatives: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["evidenceIds", "text", "conditions"],
        properties: {
          evidenceIds: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: { type: "string" }
          },
          text: { type: "string" },
          conditions: { type: "array", items: { type: "string" } }
        }
      }
    },
    citations: { type: "array", uniqueItems: true, items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } }
  }
};

const SYSTEM_PROMPT = `你是 tftclarity 的中文 TFT 教练。输入是受控 EvidenceBundle JSON。
必须遵守：
1. 当 queryResult.candidates 非空时，currentRecommendation 必须逐字使用第一名候选的 evidenceId，当前最好/最强/排名主结论只能由该 MetaTFT 候选决定。
2. YouTube 只代表创作者观点，用于原因、优先级、开局、过渡、运营、站位、替代和环境条件；不得覆盖 MetaTFT 首选。
3. 视频与统计不同，只能写成“当前统计仍支持 A；该作者建议在条件 X 下使用 B”的条件性替代。
4. 没有结构化数据时不得声称“当前最好”；没有视频时明确说明解释主要基于统计和静态/机制知识。
5. 所有事实、实体、数字和来源必须来自 EvidenceBundle；每条 reason/alternative 引用实际使用的 evidenceId。
6. 不同 patch/赛季不得混用。creator_advice 不得写成官方事实或共识。
7. 返回严格 JSON，不带 Markdown 围栏。`;

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function chatEndpoint(value) {
  const endpoint = String(value ?? "").trim().replace(/\/+$/u, "");
  if (!endpoint) return null;
  return /\/chat\/completions$/iu.test(endpoint) ? endpoint : `${endpoint}/chat/completions`;
}

function responseContent(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? part?.content ?? "").join("");
  return content;
}

function strictJson(content) {
  if (content && typeof content === "object") return content;
  const text = String(content ?? "").trim();
  if (!text.startsWith("{") || !text.endsWith("}")) throw new Error("Coach provider returned non-JSON content");
  return JSON.parse(text);
}

export function resolveCoachProviderConfig(options = {}, env = process.env) {
  const mode = String(
    options.mode
    ?? env.TFT_AGENT_COACH_MODE
    ?? env.TFT_AGENT_CONCLUSION_MODE
    ?? "off"
  ).trim().toLowerCase();
  const endpoint = chatEndpoint(
    options.endpoint
    ?? env.TFT_AGENT_COACH_ENDPOINT
    ?? env.TFT_AGENT_CONCLUSION_ENDPOINT
    ?? env.OPENAI_BASE_URL
  );
  const model = options.model
    ?? env.TFT_AGENT_COACH_MODEL
    ?? env.TFT_AGENT_CONCLUSION_MODEL
    ?? env.MODEL_NAME
    ?? env.OPENAI_MODEL
    ?? null;
  const apiKey = options.apiKey
    ?? env.TFT_AGENT_COACH_API_KEY
    ?? env.TFT_AGENT_CONCLUSION_API_KEY
    ?? env.OPENAI_API_KEY
    ?? null;
  const enabled = !["off", "none", "disabled", "false"].includes(mode)
    && Boolean(endpoint)
    && Boolean(model)
    && (Boolean(apiKey) || options.allowUnauthenticated === true);
  return {
    enabled,
    mode,
    provider: enabled ? "openai_compatible" : "off",
    endpoint,
    model: model ? String(model) : null,
    apiKey: apiKey ? String(apiKey) : null,
    timeoutMs: positive(
      options.timeoutMs ?? env.TFT_AGENT_COACH_TIMEOUT_MS,
      DEFAULT_COACH_TIMEOUT_MS
    ),
    maxOutputTokens: positive(
      options.maxOutputTokens ?? env.TFT_AGENT_COACH_MAX_OUTPUT_TOKENS,
      DEFAULT_COACH_MAX_OUTPUT_TOKENS
    ),
    allowUnauthenticated: options.allowUnauthenticated === true
  };
}

export function createOpenAICompatibleCoachProvider(options = {}) {
  if (!options.endpoint || !options.model) {
    throw new Error("Coach provider requires endpoint and model");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const provider = async ({ question, evidenceBundle } = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), positive(options.timeoutMs, DEFAULT_COACH_TIMEOUT_MS));
    const body = {
      model: options.model,
      messages: [
        { role: "system", content: options.systemPrompt ?? SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            question: String(question ?? ""),
            evidenceBundle
          })
        }
      ],
      temperature: 0,
      max_tokens: positive(options.maxOutputTokens, DEFAULT_COACH_MAX_OUTPUT_TOKENS),
      response_format: options.useJsonSchema === true
        ? {
            type: "json_schema",
            json_schema: {
              name: "tft_coach_answer",
              strict: true,
              schema: COACH_RESPONSE_SCHEMA
            }
          }
        : { type: "json_object" }
    };
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
      if (!response.ok) throw new Error(`Coach provider returned HTTP ${response.status}`);
      return strictJson(responseContent(await response.json()));
    } finally {
      clearTimeout(timeout);
    }
  };
  provider.model = options.model;
  provider.provider = "openai_compatible";
  return provider;
}

export function createCoachProviderFromConfig(config = {}, options = {}) {
  if (!config.enabled) return null;
  return createOpenAICompatibleCoachProvider({
    ...config,
    fetchImpl: options.fetchImpl ?? config.fetchImpl
  });
}

export { COACH_RESPONSE_SCHEMA };
