import { validateTaskFrame } from "../understanding/task-frame.js";

export const LIVE_SEMANTIC_TASK_PROMPT_VERSION = "live-semantic-task-contract.v2";

const RESPONSE_CONTRACT = [
  "Return exactly one JSON object matching task-frame.v1. Do not use Markdown.",
  "The dynamic_context.input field is the only current user query. Retrieved examples are classification hints only: never copy their entities, wording or assumptions into the answer.",
  "Conversation summary is context only for an elliptical follow-up; otherwise extract entities only from dynamic_context.input.",
  "Required top-level keys: schemaVersion, domain, action, subjects, candidates, concepts, constraints, goal, expectedOutput, contextReferences, ambiguities, assumptions, confidence, understandingStatus.",
  'schemaVersion must be "task-frame.v1". domain is "tft" or "out_of_domain".',
  "action is one of search, recommend, compare, rank, explain, analyze, summarize, find_video, unknown.",
  "subjects, candidates, and concepts contain objects with rawText, expectedType, resolvedId, confidence.",
  "expectedType is one of champion, item, trait, composition, augment, patch, game_concept, video, player_context.",
  "Never invent a resolvedId: use null. confidence is null or a number from 0 to 1.",
  "understandingStatus is one of understood_and_supported, understood_but_missing_context, understood_but_unsupported, ambiguous, out_of_domain.",
  "Use understood_but_unsupported for video search, historical comparison without history tools, arbitrary database/player-data requests, forced conclusions from inadequate samples, unsupported matchups, and standalone 九五 strategy-definition requests.",
  "A request for an exact matchup or win-rate statistic is analyze. A comparison between multiple champions is compare. Both are understood_but_unsupported with the current tools.",
  "Do not silently canonicalize an uncertain typo into a known champion; preserve the typed mention and use ambiguous when identity is not certain.",
  "Use understood_but_missing_context only when a referenced subject such as 这套/刚才 cannot be recovered from conversation.",
  "An inability to execute does not erase understanding: keep the understood action and entities whenever possible.",
  "Put two compared champions or items in candidates; put a single target champion in subjects; put traits, compositions, patches, videos and game concepts in concepts.",
  "constraints must be an object. expectedOutput, contextReferences, ambiguities and assumptions must always be JSON arrays, even when empty. goal must be a non-empty concise string.",
  'Minimal shape example: {"schemaVersion":"task-frame.v1","domain":"tft","action":"search","subjects":[],"candidates":[],"concepts":[],"constraints":{},"goal":"find_data","expectedOutput":["results"],"contextReferences":[],"ambiguities":[],"assumptions":[],"confidence":0.9,"understandingStatus":"understood_and_supported"}.'
].join("\n");

function contentFromPayload(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text ?? part?.content ?? "").join("");
  }
  return content;
}

function parseJsonContent(content) {
  if (content && typeof content === "object") return content;
  const text = String(content ?? "").trim();
  if (!text) throw new Error("semantic task provider response was empty");
  try {
    return JSON.parse(text);
  } catch {
    const withoutFence = text
      .replace(/^```(?:json)?\s*/iu, "")
      .replace(/\s*```$/u, "")
      .trim();
    const first = withoutFence.indexOf("{");
    const last = withoutFence.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(withoutFence.slice(first, last + 1));
    }
    throw new Error("semantic task provider response did not contain valid JSON");
  }
}

function normalizedUsage(payload = {}) {
  const usage = payload.usage ?? {};
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const cachedInputTokens = Number(
    usage.prompt_tokens_details?.cached_tokens
    ?? usage.input_tokens_details?.cached_tokens
    ?? usage.cached_input_tokens
    ?? 0
  );
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  return {
    cachedInputTokens: Math.max(0, cachedInputTokens),
    uncachedInputTokens: Math.max(0, promptTokens - cachedInputTokens),
    outputTokens: Math.max(0, outputTokens)
  };
}

function safeErrorMessage(error) {
  return String(error?.message ?? error ?? "unknown error").slice(0, 500);
}

export function createChatSemanticTaskProvider(options = {}) {
  if (!options.endpoint) throw new TypeError("createChatSemanticTaskProvider requires endpoint");
  if (!options.model) throw new TypeError("createChatSemanticTaskProvider requires model");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("createChatSemanticTaskProvider requires fetch or fetchImpl");
  }

  return async function chatSemanticTaskProvider(request = {}) {
    const startedAt = performance.now();
    const timeoutMs = Math.max(1, Number(options.timeoutMs ?? request.budget?.maxLatencyMs ?? 45000));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let providerUsage = null;
    let rawProviderContent = null;
    const body = {
      model: options.model,
      messages: [
        { role: "system", content: RESPONSE_CONTRACT },
        ...(request.messages ?? []).map((message) => ({
          role: message.role,
          content: message.content
        }))
      ],
      temperature: Number(options.temperature ?? 0),
      max_tokens: Math.max(1, Math.min(
        Number(options.maxTokens ?? request.budget?.maxOutputTokens ?? 450),
        Number(request.budget?.maxOutputTokens ?? 450)
      ))
    };
    if (options.includeResponseFormat !== false) {
      body.response_format = { type: "json_object" };
    }
    if (options.thinkingMode) {
      body.thinking = { type: options.thinkingMode };
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
        const responseText = typeof response.text === "function" ? await response.text() : "";
        throw new Error(`semantic task provider returned HTTP ${response.status}: ${responseText.slice(0, 300)}`);
      }
      const payload = await response.json();
      providerUsage = normalizedUsage(payload);
      rawProviderContent = contentFromPayload(payload);
      const taskFrame = parseJsonContent(rawProviderContent);
      const validation = validateTaskFrame(taskFrame);
      if (!validation.valid) {
        throw new TypeError(`semantic task provider returned invalid TaskFrame: ${validation.errors.join("; ")}`);
      }
      const durationMs = Math.max(0, performance.now() - startedAt);
      options.onRequestLog?.({
        status: "ok",
        durationMs,
        firstTokenMs: null,
        firstTokenMeasurement: "unavailable_non_streaming",
        retryCount: 0,
        usage: providerUsage,
        rawStructuredOutput: taskFrame
      });
      return { taskFrame, usage: providerUsage };
    } catch (error) {
      const normalizedError = error?.name === "AbortError"
        ? new Error(`semantic task provider timed out after ${timeoutMs}ms`)
        : error;
      options.onRequestLog?.({
        status: "error",
        durationMs: Math.max(0, performance.now() - startedAt),
        firstTokenMs: null,
        firstTokenMeasurement: "unavailable_non_streaming",
        retryCount: 0,
        usage: providerUsage,
        rawStructuredOutput: rawProviderContent,
        error: safeErrorMessage(normalizedError)
      });
      throw normalizedError;
    } finally {
      clearTimeout(timeout);
    }
  };
}
