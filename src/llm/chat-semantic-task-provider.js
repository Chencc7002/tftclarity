import {
  createTaskFrame,
  validateTaskFrame
} from "../understanding/task-frame.js";
import {
  createTurnDelta,
  TURN_DELTA_CONSTRAINT_FIELDS,
  validateTurnDelta
} from "../understanding/turn-delta.js";

export const LIVE_SEMANTIC_TASK_PROMPT_VERSION = "live-semantic-task-contract.v10";

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

const TURN_DELTA_RESPONSE_CONTRACT = [
  "Return exactly one JSON object matching turn-delta.v1. Do not use Markdown.",
  "Interpret the current user turn as a change relative to the compact conversation state supplied in turn_context.",
  "Required keys: schemaVersion, dialogueAct, taskRelation, explicitTaskFrame, entityOperations, constraintOperations, presentation, confidence, ambiguities.",
  'schemaVersion must be "turn-delta.v1".',
  "dialogueAct is one of start_task, continue, request_more, request_less, next_page, previous_page, modify, compare, switch_task, confirm, reject, cancel, clarify, unknown.",
  "taskRelation is one of new, continue, modify, switch, return, cancel, unknown.",
  "When there is no active task and the current message is a self-contained TFT request, use dialogueAct start_task with taskRelation new and a complete explicitTaskFrame. Do not use unknown merely because there is no prior task.",
  "Classify by the requested object: composition or lineup recommendations and rankings are rank tasks with goal comp_rankings. Strategy or playstyle qualifiers belong in constraints and must not turn a composition task into a champion or item task.",
  "A performance comparison between multiple items for one champion is a compare task with goal unit_item_comparison: put the champion in subjects and the compared items in constraints.comparisonItems.",
  "When entities and task semantics are clear but their requested operation or relation is ambiguous, keep those semantics in explicitTaskFrame while marking the relation unknown so a clarification answer can resume without losing them.",
  "Use request_more for an additional batch even when lastResultSummary.exhausted is true; do not change tasks because a result is exhausted.",
  "For another batch or a different batch, set presentation.pageDirection to next and presentation.avoidSeen to true.",
  "new and switch require one complete task-frame.v1 explicitTaskFrame. For a purely elliptical continuation explicitTaskFrame may be null.",
  "For modify or return, prefer explicitTaskFrame null when operations completely describe the change. Otherwise it contains only current-turn task semantics and every required TaskFrame key.",
  "A non-null explicitTaskFrame must contain schemaVersion, domain, action, subjects, candidates, concepts, constraints, goal, expectedOutput, contextReferences, ambiguities, assumptions, capabilityRequirements, confidence, and understandingStatus.",
  'TaskFrame schemaVersion is "task-frame.v1"; all collection fields are arrays; understandingStatus is one of understood_and_supported, understood_but_missing_context, understood_but_unsupported, ambiguous, out_of_domain.',
  "TaskFrame entity expectedType is one of champion, item, trait, composition, augment, patch, game_concept, video, player_context. Do not add prefixes or use concept as an expectedType.",
  "Entity and constraint operation names are limited to set, add, remove, replace, clear. Each operation uses exactly operation, field, value, and for replace oldValue.",
  "Entity operation field is exactly subjects, candidates, or concepts. value and oldValue are arrays of TaskFrame entity objects.",
  `Constraint fields are limited to: ${TURN_DELTA_CONSTRAINT_FIELDS.join(", ")}.`,
  "For new deltas prefer the canonical fields rank, lockedItems, and strategy; rankFilter, ownedItems, and specialMode exist only for compatibility input.",
  "TaskFrame action is exactly one of search, recommend, compare, rank, explain, analyze, summarize, find_video, unknown. Composition recommendations use rank or recommend, never find_compositions.",
  "rank is an array containing only IRON, BRONZE, SILVER, GOLD, PLATINUM, EMERALD, DIAMOND, MASTER, GRANDMASTER, CHALLENGER. MASTER and above is [MASTER, GRANDMASTER, CHALLENGER].",
  "Constraint values must use only values authorized by the supplied domain policy. Never invent substitute labels or encode scalar constraints as arrays.",
  "Any entity or constraint operation changes the taskRelation to modify. continue is only for turns that leave task semantics unchanged.",
  "A contextual turn that inherits an entity but adds a new requested result, action, filter, cost, or tool requirement is not a pure continuation. For example, 这个羁绊有哪些四费棋子，怎么出装 must be modify with a non-null explicitTaskFrame containing the current-turn search/build semantics; never return an empty continue delta for it.",
  'For a trait-member build recommendation without explicit comparison wording, use action recommend, goal recommend_builds_for_candidate_group, constraints {"cost":4,"targetEntityType":"champion","relation":"member_of_trait"}, expectedOutput ["recommendations","results","evidence"], and capabilityRequirements ["entity_catalog_filtering","unit_build_statistics"]. Inherit the trait from conversation context and never reuse goal trait_details.',
  'Only when the user explicitly asks which candidate performs best, use goal compare_entity_build_performance and expectedOutput ["comparison","ranking","evidence"].',
  "Inside TaskFrame constraints, omit every unknown optional field instead of returning it as null.",
  "To remove an entire scalar constraint such as strategy, use clear with only operation and field. Do not use an empty array.",
  "For replace operations include both oldValue and value.",
  "presentation contains requestedCount (null or integer 1..100), pageDirection (null, next, previous, same), avoidSeen (boolean), and resultReference (null or an object with scope and ordinal).",
  "For an ordinal reference to an already displayed result such as 第二套, set resultReference to {\"scope\":\"last_result\",\"ordinal\":2}. The ordered ids are in lastResultSummary.shownIds.",
  "For an instruction about a result that this same turn will produce, such as 第二套详细讲, set resultReference to {\"scope\":\"current_output\",\"ordinal\":2}. This is an output directive, not missing conversation context.",
  "When pendingClarification is present and the user supplies its missing field, use continue or modify rather than new.",
  "Any request to resume, restore, or go back to a task present in recentTaskSummaries uses taskRelation return; pair it with dialogueAct continue or switch_task, never invent a return dialogueAct.",
  "Switching from a champion build task to composition rankings uses taskRelation switch and a rank TaskFrame for the composition ranking goal.",
  "Do not output a tool name, endpoint, complete tool arguments, statistics, ranking, or evidence decision.",
  "Do not invent resolved entity ids. Use rawText with resolvedId null when an entity is mentioned.",
  "When relation or a material field is uncertain, return taskRelation unknown, dialogueAct unknown, confidence below 0.5, and a structured ambiguity."
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

function omitNullConstraintValues(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const normalized = structuredClone(value);
  if (normalized.constraints && typeof normalized.constraints === "object") {
    normalized.constraints = Object.fromEntries(
      Object.entries(normalized.constraints).filter(([, entry]) => entry !== null)
    );
  }
  return normalized;
}

function normalizeProviderStructuredValue(value, turnDeltaRequest) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (!turnDeltaRequest) return omitNullConstraintValues(value);
  const normalized = structuredClone(value);
  if (normalized.explicitTaskFrame) {
    normalized.explicitTaskFrame = omitNullConstraintValues(normalized.explicitTaskFrame);
    const allowedOperationFields = new Set(TURN_DELTA_CONSTRAINT_FIELDS);
    normalized.constraintOperations = Array.isArray(normalized.constraintOperations)
      ? normalized.constraintOperations.filter((operation) => (
        allowedOperationFields.has(operation?.field)
      ))
      : normalized.constraintOperations;
  }
  return normalized;
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
    let invalidFeedback = null;
    const turnDeltaRequest = request.schemaVersion === "turn-delta.v1";
    const domainPromptRules = turnDeltaRequest
      ? (request.domainPolicy?.semanticTurnDeltaPromptRules ?? [])
      : [];
    const responseContract = [
      turnDeltaRequest ? TURN_DELTA_RESPONSE_CONTRACT : RESPONSE_CONTRACT,
      ...domainPromptRules
    ].join("\n");
    const body = {
      model: options.model,
      messages: [
        { role: "system", content: responseContract },
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
              content: [
                `The previous response was invalid. Return one concise, non-null ${turnDeltaRequest ? "turn-delta.v1" : "task-frame.v1"} JSON object now; no prose.`,
                invalidFeedback ? `Validation errors to correct: ${invalidFeedback}` : ""
              ].filter(Boolean).join("\n")
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
          const rawStructuredValue = normalizeProviderStructuredValue(
            parseJsonContent(rawProviderContent),
            turnDeltaRequest
          );
          if (turnDeltaRequest) {
            const validation = validateTurnDelta(rawStructuredValue, {
              domainPolicy: request.domainPolicy
            });
            if (!validation.valid) {
              throw new TypeError(
                `semantic task provider returned invalid TurnDelta: ${validation.errors.join("; ")}`
              );
            }
            const turnDelta = createTurnDelta(rawStructuredValue);
            const durationMs = Math.max(0, performance.now() - startedAt);
            options.onRequestLog?.({
              status: "ok",
              durationMs,
              firstTokenMs: null,
              firstTokenMeasurement: "unavailable_non_streaming",
              retryCount,
              usage: providerUsage,
              rawStructuredOutput: turnDelta
            });
            return { turnDelta, usage: providerUsage };
          }
          const validationCandidate = {
            ...rawStructuredValue,
            capabilityRequirements: Array.isArray(rawStructuredValue?.capabilityRequirements)
              ? rawStructuredValue.capabilityRequirements
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
          invalidFeedback = safeErrorMessage(error);
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
