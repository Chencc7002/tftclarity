import { createTaskFrame, validateTaskFrame } from "./task-frame.js";

export const CONVERSATION_STATE_SCHEMA_VERSION = "conversation-state.v2";
export const MAX_CONVERSATION_SHOWN_IDS = 100;
export const MAX_CONVERSATION_TASK_HISTORY = 8;

const LEGACY_INTENT_ACTIONS = Object.freeze({
  unit_best_3_items: "recommend",
  unit_build_rankings: "recommend",
  unit_build_completion: "recommend",
  unit_item_rankings: "rank",
  unit_emblem_rankings: "rank",
  unit_item_comparison: "compare",
  item_carrier_rankings: "rank",
  unit_item_availability: "search",
  unit_details: "explain",
  item_details: "explain",
  trait_details: "explain",
  comp_rankings: "rank",
  comp_trends: "analyze",
  comp_analysis: "analyze"
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function nullableTimestamp(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function boundedIds(values) {
  return [...new Set(array(values).map((value) => String(value ?? "").trim()).filter(Boolean))]
    .slice(-MAX_CONVERSATION_SHOWN_IDS);
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function legacyEntity(value, expectedType) {
  if (value == null || value === "") return null;
  const resolvedId = typeof value === "object"
    ? value.apiName ?? value.id ?? value.name ?? null
    : value;
  const rawText = typeof value === "object"
    ? value.name ?? value.canonicalName ?? value.apiName ?? value.id
    : value;
  if (rawText == null || rawText === "") return null;
  return {
    rawText: String(rawText),
    expectedType,
    resolvedId: resolvedId == null ? null : String(resolvedId),
    confidence: 1,
    source: "legacy_session"
  };
}

function legacyTaskFrame(query = {}) {
  if (!query?.intent) return null;
  const subject = legacyEntity(query.unit, "champion");
  const candidates = [
    ...array(query.comparisonItems ?? query.comparison_items),
    ...array(query.lockedItems ?? query.locked_items ?? query.ownedItems ?? query.owned_items)
  ].map((value) => legacyEntity(value, "item")).filter(Boolean);
  const concepts = [
    ...array(query.traitFilters ?? query.trait_filters)
      .map((value) => legacyEntity(value, "trait")).filter(Boolean),
    ...(query.comp?.value ? [legacyEntity(query.comp.value, "composition")].filter(Boolean) : [])
  ];
  const constraints = {};
  const mappings = {
    patch: "patch",
    days: "days",
    queue: "queue",
    rankFilter: "rank",
    starLevel: "starLevel",
    itemCount: "itemCount",
    minSamples: "minSamples",
    sort: "sort",
    metrics: "metrics",
    limit: "limit",
    specialMode: "specialMode",
    itemPolicy: "itemPolicy",
    itemCategories: "itemCategories",
    excludedItems: "excludedItems",
    avoidItemComponents: "avoidItemComponents",
    comparisonItems: "comparisonItems",
    primaryMetric: "primaryMetric"
  };
  for (const [legacyKey, field] of Object.entries(mappings)) {
    const value = query[legacyKey] ?? query[legacyKey.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)];
    if (value !== undefined && value !== null) constraints[field] = clone(value);
  }
  const preference = query.preferenceConditions ?? {};
  if (preference.strategy != null) constraints.strategy = preference.strategy;
  if (preference.reroll === true) {
    constraints.strategy = "reroll";
    constraints.specialMode = true;
  }
  if (
    typeof preference.reroll === "boolean"
    && (preference.reroll === false || preference.strategy == null)
  ) {
    constraints.reroll = preference.reroll;
  }
  return createTaskFrame({
    domain: "tft",
    action: LEGACY_INTENT_ACTIONS[query.intent] ?? "unknown",
    subjects: subject ? [subject] : [],
    candidates,
    concepts,
    constraints,
    goal: String(query.intent),
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
}

function normalizeLastResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const totalCount = value.totalCount == null ? null : nonNegativeInteger(value.totalCount, null);
  return {
    resultType: String(value.resultType ?? "unknown"),
    toolName: value.toolName == null ? null : String(value.toolName),
    shownIds: boundedIds(value.shownIds),
    returnedCount: nonNegativeInteger(value.returnedCount),
    totalCount,
    cursor: clone(value.cursor ?? null),
    exhausted: value.exhausted === true,
    appliedConstraints: value.appliedConstraints && typeof value.appliedConstraints === "object"
      && !Array.isArray(value.appliedConstraints)
      ? clone(value.appliedConstraints)
      : {},
    shownEntities: array(value.shownEntities).map((entity) => ({
      apiName: String(entity?.apiName ?? "").trim(),
      name: String(entity?.name ?? entity?.apiName ?? "").trim(),
      entityType: String(entity?.entityType ?? "unit").trim()
    })).filter((entity) => entity.apiName).slice(-MAX_CONVERSATION_SHOWN_IDS),
    entityType: value.entityType == null ? null : String(value.entityType),
    sourceFilters: value.sourceFilters && typeof value.sourceFilters === "object"
      && !Array.isArray(value.sourceFilters)
      ? clone(value.sourceFilters)
      : {},
    selectionScope: value.selectionScope == null ? null : String(value.selectionScope),
    updatedAt: nullableTimestamp(value.updatedAt)
  };
}

function normalizeActiveTask(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !value.taskFrame) return null;
  const taskFrame = createTaskFrame(value.taskFrame);
  return {
    taskFrame,
    legacyIntent: value.legacyIntent == null ? taskFrame.goal : String(value.legacyIntent),
    updatedAt: nullableTimestamp(value.updatedAt),
    ...(value.lastResult ? { lastResult: normalizeLastResult(value.lastResult) } : {})
  };
}

function normalizePendingClarification(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    reason: String(value.reason ?? "missing_context"),
    expectedFields: [...new Set(array(value.expectedFields).map(String).filter(Boolean))],
    candidateTask: value.candidateTask && typeof value.candidateTask === "object"
      ? clone(value.candidateTask)
      : null,
    askedAt: nullableTimestamp(value.askedAt)
  };
}

export function createConversationState(value = {}) {
  const activeTask = normalizeActiveTask(value.activeTask);
  const history = array(value.taskHistory)
    .map(normalizeActiveTask)
    .filter(Boolean)
    .slice(-MAX_CONVERSATION_TASK_HISTORY);
  const state = {
    schemaVersion: CONVERSATION_STATE_SCHEMA_VERSION,
    activeTask,
    taskHistory: history,
    lastResult: normalizeLastResult(value.lastResult),
    pendingClarification: normalizePendingClarification(value.pendingClarification),
    seasonContextId: value.seasonContextId == null ? null : String(value.seasonContextId),
    updatedAt: nullableTimestamp(value.updatedAt)
  };
  if (value.query && typeof value.query === "object") state.query = clone(value.query);
  if (Array.isArray(value.lastResultIds)) state.lastResultIds = boundedIds(value.lastResultIds);
  return state;
}

function validateLastResult(value, path, errors) {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object or null`);
    return;
  }
  if (typeof value.resultType !== "string" || !value.resultType) errors.push(`${path}.resultType is required`);
  if (value.toolName !== null && typeof value.toolName !== "string") errors.push(`${path}.toolName must be a string or null`);
  if (!Array.isArray(value.shownIds)) errors.push(`${path}.shownIds must be an array`);
  if (array(value.shownIds).length > MAX_CONVERSATION_SHOWN_IDS) {
    errors.push(`${path}.shownIds exceeds ${MAX_CONVERSATION_SHOWN_IDS}`);
  }
  if (!Number.isInteger(value.returnedCount) || value.returnedCount < 0) {
    errors.push(`${path}.returnedCount must be a non-negative integer`);
  }
  if (value.totalCount !== null && (!Number.isInteger(value.totalCount) || value.totalCount < 0)) {
    errors.push(`${path}.totalCount must be a non-negative integer or null`);
  }
  if (typeof value.exhausted !== "boolean") errors.push(`${path}.exhausted must be boolean`);
  if (!value.appliedConstraints || typeof value.appliedConstraints !== "object" || Array.isArray(value.appliedConstraints)) {
    errors.push(`${path}.appliedConstraints must be an object`);
  }
  if (!Array.isArray(value.shownEntities)) errors.push(`${path}.shownEntities must be an array`);
  if (array(value.shownEntities).length > MAX_CONVERSATION_SHOWN_IDS) {
    errors.push(`${path}.shownEntities exceeds ${MAX_CONVERSATION_SHOWN_IDS}`);
  }
  array(value.shownEntities).forEach((entity, index) => {
    if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
      errors.push(`${path}.shownEntities[${index}] must be an object`);
      return;
    }
    if (typeof entity.apiName !== "string" || !entity.apiName) {
      errors.push(`${path}.shownEntities[${index}].apiName is required`);
    }
    if (typeof entity.name !== "string" || !entity.name) {
      errors.push(`${path}.shownEntities[${index}].name is required`);
    }
    if (typeof entity.entityType !== "string" || !entity.entityType) {
      errors.push(`${path}.shownEntities[${index}].entityType is required`);
    }
  });
  if (value.entityType !== null && typeof value.entityType !== "string") {
    errors.push(`${path}.entityType must be a string or null`);
  }
  if (!value.sourceFilters || typeof value.sourceFilters !== "object" || Array.isArray(value.sourceFilters)) {
    errors.push(`${path}.sourceFilters must be an object`);
  }
  if (value.selectionScope !== null && typeof value.selectionScope !== "string") {
    errors.push(`${path}.selectionScope must be a string or null`);
  }
  if (value.updatedAt !== null && typeof value.updatedAt !== "string") {
    errors.push(`${path}.updatedAt must be a string or null`);
  }
}

function validateActiveTask(value, path, errors) {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object or null`);
    return;
  }
  const validation = validateTaskFrame(value.taskFrame);
  if (!validation.valid) errors.push(...validation.errors.map((error) => `${path}.taskFrame.${error}`));
  if (typeof value.legacyIntent !== "string" || !value.legacyIntent) {
    errors.push(`${path}.legacyIntent is required`);
  }
  if (value.updatedAt !== null && typeof value.updatedAt !== "string") {
    errors.push(`${path}.updatedAt must be a string or null`);
  }
  if (value.lastResult !== undefined) validateLastResult(value.lastResult, `${path}.lastResult`, errors);
}

export function validateConversationState(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["ConversationState must be an object"], value: null };
  }
  if (value.schemaVersion !== CONVERSATION_STATE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CONVERSATION_STATE_SCHEMA_VERSION}`);
  }
  validateActiveTask(value.activeTask, "activeTask", errors);
  if (!Array.isArray(value.taskHistory)) errors.push("taskHistory must be an array");
  if (array(value.taskHistory).length > MAX_CONVERSATION_TASK_HISTORY) {
    errors.push(`taskHistory exceeds ${MAX_CONVERSATION_TASK_HISTORY}`);
  }
  array(value.taskHistory).forEach((entry, index) => validateActiveTask(entry, `taskHistory[${index}]`, errors));
  validateLastResult(value.lastResult, "lastResult", errors);
  if (value.pendingClarification !== null) {
    const pending = value.pendingClarification;
    if (!pending || typeof pending !== "object" || Array.isArray(pending)) {
      errors.push("pendingClarification must be an object or null");
    } else {
      if (typeof pending.reason !== "string" || !pending.reason) errors.push("pendingClarification.reason is required");
      if (!Array.isArray(pending.expectedFields)) errors.push("pendingClarification.expectedFields must be an array");
      if (pending.candidateTask !== null && typeof pending.candidateTask !== "object") {
        errors.push("pendingClarification.candidateTask must be an object or null");
      } else if (pending.candidateTask !== null) {
        const candidateFrame = pending.candidateTask.taskFrame ?? pending.candidateTask;
        const validation = validateTaskFrame(candidateFrame);
        if (!validation.valid) {
          errors.push(...validation.errors.map((error) => (
            `pendingClarification.candidateTask.${error}`
          )));
        }
      }
      if (pending.askedAt !== null && typeof pending.askedAt !== "string") {
        errors.push("pendingClarification.askedAt must be a string or null");
      }
    }
  }
  if (value.seasonContextId !== null && typeof value.seasonContextId !== "string") {
    errors.push("seasonContextId must be a string or null");
  }
  if (value.updatedAt !== null && typeof value.updatedAt !== "string") {
    errors.push("updatedAt must be a string or null");
  }
  return { valid: errors.length === 0, errors, value: errors.length === 0 ? value : null };
}

export function migrateLegacySessionToConversationState(sessionValue = {}, options = {}) {
  if (sessionValue?.schemaVersion === CONVERSATION_STATE_SCHEMA_VERSION) {
    const normalized = createConversationState({
      ...sessionValue,
      seasonContextId: sessionValue.seasonContextId ?? options.seasonContextId
    });
    const validation = validateConversationState(normalized);
    if (!validation.valid) throw new TypeError(`Invalid ConversationState: ${validation.errors.join("; ")}`);
    return normalized;
  }
  const query = sessionValue?.query ?? sessionValue?.last_query ?? (
    sessionValue?.intent ? sessionValue : null
  );
  const taskFrame = legacyTaskFrame(query);
  const shownIds = boundedIds(sessionValue?.lastResultIds ?? sessionValue?.last_result_ids);
  return createConversationState({
    activeTask: taskFrame ? {
      taskFrame,
      legacyIntent: query.intent,
      updatedAt: sessionValue.updatedAt ?? sessionValue.updated_at ?? null
    } : null,
    lastResult: taskFrame && shownIds.length ? {
      resultType: query.intent,
      toolName: null,
      shownIds,
      returnedCount: shownIds.length,
      totalCount: null,
      exhausted: false,
      appliedConstraints: taskFrame.constraints,
      updatedAt: sessionValue.updatedAt ?? sessionValue.updated_at ?? null
    } : null,
    seasonContextId: options.seasonContextId ?? query?.seasonContextId ?? null,
    updatedAt: sessionValue.updatedAt ?? sessionValue.updated_at ?? null,
    ...(query ? { query } : {}),
    lastResultIds: shownIds
  });
}

export function conversationStateSessionKey(conversationId, baseKey = "last_query") {
  const id = String(conversationId ?? "").trim();
  return !id || id === "default" ? String(baseKey) : `${baseKey}:${id}`;
}
