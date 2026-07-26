import {
  createTaskFrame,
  validateTaskFrame
} from "../understanding/task-frame.js";

export const LIVE_SEMANTIC_TASK_PROMPT_VERSION = "live-semantic-task-contract.v6";

const RESPONSE_CONTRACT = [
  "Return exactly one JSON object matching task-frame.v1. Do not use Markdown.",
  "The dynamic_context.input field is the only current user query. Retrieved examples are classification hints only: never copy their entities, wording or assumptions into the answer.",
  "Conversation summary is context only for an elliptical follow-up; otherwise extract entities only from dynamic_context.input.",
  "For an elliptical follow-up containing 那/这/它/她/他/刚才/另一个/继续/再来, inherit the referenced subjects, candidates and concepts from conversationSummary, add a contextReferences entry, and do not mark context missing when the antecedent is present.",
  "Required top-level keys: schemaVersion, domain, action, subjects, candidates, concepts, constraints, goal, expectedOutput, contextReferences, ambiguities, assumptions, confidence, understandingStatus.",
  'schemaVersion must be "task-frame.v1". domain is "tft" or "out_of_domain".',
  "action is one of search, recommend, compare, rank, explain, analyze, summarize, find_video, unknown.",
  "subjects, candidates, and concepts contain objects with rawText, expectedType, resolvedId, confidence.",
  "expectedType is one of champion, item, trait, composition, augment, patch, game_concept, video, player_context.",
  "Never invent a resolvedId: use null. confidence is null or a number from 0 to 1.",
  "Keep the JSON concise. Do not repeat an entity in multiple arrays and do not emit generic output words such as 装备、神装、三件套、数据、表现、吃分率、详情 or 候选 as entities.",
  "understandingStatus is one of understood_and_supported, understood_but_missing_context, understood_but_unsupported, ambiguous, out_of_domain.",
  "This parser reports understanding only. For any understood TFT request use understood_and_supported; Capability Matcher decides support later. Do not use understood_but_unsupported in new output.",
  "Preserve video search, historical comparison, database/player-data requests, forced low-sample conclusions, and matchup requests as understood actions with their entities and constraints.",
  "A request for an exact matchup or win-rate statistic is analyze. A comparison between multiple champions is compare.",
  "Do not silently canonicalize an uncertain typo into a known champion; preserve the typed mention and use ambiguous when identity is not certain.",
  "If a request depends on an unknown named champion, item, trait, composition or game concept, preserve the mention, use ambiguous, and add an ambiguity with code ambiguous_entity. Do not route an invented entity to generic analysis.",
  "Explicit intent words are authoritative: 推荐/三件套/怎么配 means recommend; 排名/排行/优先级 means rank; 比较/对比/还是/二选一 means compare; 趋势/在涨 means analyze; 视频/B站 means find_video.",
  "When two named items are connected by 和/与/跟/还是/二选一/怎么选, use compare even if the question mentions samples, placement, performance or win rate.",
  "Use understood_but_missing_context only when a referenced subject such as 这套/刚才 cannot be recovered from conversation.",
  "This is classification, not execution. Never refuse, return null, or add prose for unsafe or unsupported requests; encode them as one valid TaskFrame and leave execution support to Capability Matcher.",
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
    let retryCount = 0;
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
      const maxInvalidRetries = Math.max(0, Math.min(1, Number(options.maxInvalidRetries ?? 1)));
      for (let attempt = 0; attempt <= maxInvalidRetries; attempt += 1) {
        const attemptBody = attempt === 0 ? body : {
          ...body,
          messages: [
            ...body.messages,
            {
              role: "system",
              content: "The previous response was invalid. Return one concise, non-null task-frame.v1 JSON object now; no prose."
            }
          ]
        };
        const response = await fetchImpl(options.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {})
          },
          body: JSON.stringify(attemptBody),
          signal: controller.signal
        });
        if (!response.ok) {
          const responseText = typeof response.text === "function" ? await response.text() : "";
          throw new Error(`semantic task provider returned HTTP ${response.status}: ${responseText.slice(0, 300)}`);
        }
        const payload = await response.json();
        const attemptUsage = normalizedUsage(payload);
        providerUsage = {
          cachedInputTokens: Number(providerUsage?.cachedInputTokens ?? 0) + attemptUsage.cachedInputTokens,
          uncachedInputTokens: Number(providerUsage?.uncachedInputTokens ?? 0) + attemptUsage.uncachedInputTokens,
          outputTokens: Number(providerUsage?.outputTokens ?? 0) + attemptUsage.outputTokens
        };
        rawProviderContent = contentFromPayload(payload);
        try {
          const rawTaskFrame = parseJsonContent(rawProviderContent);
          const validationCandidate = {
            ...rawTaskFrame,
            capabilityRequirements: Array.isArray(rawTaskFrame?.capabilityRequirements)
              ? rawTaskFrame.capabilityRequirements
              : []
          };
          const validation = validateTaskFrame(validationCandidate);
          if (!validation.valid) {
            throw new TypeError(
              `semantic task provider returned invalid TaskFrame: ${validation.errors.join("; ")}`
            );
          }
          const taskFrame = createTaskFrame(validationCandidate);
          const durationMs = Math.max(0, performance.now() - startedAt);
          options.onRequestLog?.({
            status: "ok",
            durationMs,
            firstTokenMs: null,
            firstTokenMeasurement: "unavailable_non_streaming",
            retryCount,
            usage: providerUsage,
            rawStructuredOutput: taskFrame
          });
          return { taskFrame, usage: providerUsage };
        } catch (error) {
          if (attempt >= maxInvalidRetries) throw error;
          retryCount += 1;
        }
      }
      throw new TypeError("semantic task provider exhausted invalid-response retries");
    } catch (error) {
      const normalizedError = error?.name === "AbortError"
        ? new Error(`semantic task provider timed out after ${timeoutMs}ms`)
        : error;
      options.onRequestLog?.({
        status: "error",
        durationMs: Math.max(0, performance.now() - startedAt),
        firstTokenMs: null,
        firstTokenMeasurement: "unavailable_non_streaming",
        retryCount,
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
