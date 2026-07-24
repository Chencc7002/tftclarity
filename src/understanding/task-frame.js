export const TASK_FRAME_SCHEMA_VERSION = "task-frame.v1";

export const TASK_FRAME_ACTIONS = Object.freeze([
  "search",
  "recommend",
  "compare",
  "rank",
  "explain",
  "analyze",
  "summarize",
  "find_video",
  "unknown"
]);

export const TASK_FRAME_ENTITY_TYPES = Object.freeze([
  "champion",
  "item",
  "trait",
  "composition",
  "augment",
  "patch",
  "game_concept",
  "video",
  "player_context"
]);

export const TASK_FRAME_UNDERSTANDING_STATUSES = Object.freeze([
  "understood_and_supported",
  "understood_but_missing_context",
  "understood_but_unsupported",
  "ambiguous",
  "out_of_domain"
]);

const ACTION_SET = new Set(TASK_FRAME_ACTIONS);
const ENTITY_TYPE_SET = new Set(TASK_FRAME_ENTITY_TYPES);
const STATUS_SET = new Set(TASK_FRAME_UNDERSTANDING_STATUSES);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  return [...new Set(array(values).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function finiteConfidence(value, fallback = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function normalizeEntity(value = {}) {
  return {
    rawText: String(value.rawText ?? value.mention ?? "").trim(),
    expectedType: String(value.expectedType ?? value.type ?? "game_concept"),
    resolvedId: value.resolvedId == null ? null : String(value.resolvedId),
    confidence: finiteConfidence(value.confidence),
    ...(value.canonicalName ? { canonicalName: String(value.canonicalName) } : {}),
    ...(value.patch ? { patch: String(value.patch) } : {}),
    ...(value.source ? { source: String(value.source) } : {}),
    ...(Array.isArray(value.candidates) ? {
      candidates: value.candidates.map((candidate) => ({ ...candidate }))
    } : {})
  };
}

export function createTaskFrame(value = {}) {
  return {
    schemaVersion: TASK_FRAME_SCHEMA_VERSION,
    domain: String(value.domain ?? "tft"),
    action: ACTION_SET.has(value.action) ? value.action : "unknown",
    subjects: array(value.subjects).map(normalizeEntity),
    candidates: array(value.candidates).map(normalizeEntity),
    concepts: array(value.concepts).map(normalizeEntity),
    constraints: value.constraints && typeof value.constraints === "object" && !Array.isArray(value.constraints)
      ? structuredClone(value.constraints)
      : {},
    goal: String(value.goal ?? value.userGoal ?? "understand_request"),
    expectedOutput: uniqueStrings(value.expectedOutput),
    contextReferences: array(value.contextReferences).map((reference) => (
      reference && typeof reference === "object" ? structuredClone(reference) : String(reference)
    )),
    ambiguities: array(value.ambiguities).map((ambiguity) => (
      ambiguity && typeof ambiguity === "object" ? structuredClone(ambiguity) : String(ambiguity)
    )),
    assumptions: uniqueStrings(value.assumptions),
    confidence: finiteConfidence(value.confidence, 0),
    understandingStatus: STATUS_SET.has(value.understandingStatus)
      ? value.understandingStatus
      : value.domain === "out_of_domain"
        ? "out_of_domain"
        : "ambiguous"
  };
}

function validateEntity(entity, path, errors) {
  if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof entity.rawText !== "string" || !entity.rawText.trim()) {
    errors.push(`${path}.rawText is required`);
  }
  if (!ENTITY_TYPE_SET.has(entity.expectedType)) {
    errors.push(`${path}.expectedType must be a supported entity type`);
  }
  if (entity.resolvedId !== null && typeof entity.resolvedId !== "string") {
    errors.push(`${path}.resolvedId must be a string or null`);
  }
  if (entity.confidence !== null && (
    !Number.isFinite(entity.confidence)
    || entity.confidence < 0
    || entity.confidence > 1
  )) {
    errors.push(`${path}.confidence must be null or between 0 and 1`);
  }
}

export function validateTaskFrame(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["TaskFrame must be an object"], value: null };
  }
  if (value.schemaVersion !== TASK_FRAME_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${TASK_FRAME_SCHEMA_VERSION}`);
  }
  if (!["tft", "out_of_domain"].includes(value.domain)) {
    errors.push("domain must be tft or out_of_domain");
  }
  if (!ACTION_SET.has(value.action)) errors.push("action must be a supported action");
  for (const key of ["subjects", "candidates", "concepts", "expectedOutput", "contextReferences", "ambiguities", "assumptions"]) {
    if (!Array.isArray(value[key])) errors.push(`${key} must be an array`);
  }
  for (const key of ["subjects", "candidates", "concepts"]) {
    array(value[key]).forEach((entity, index) => validateEntity(entity, `${key}[${index}]`, errors));
  }
  if (!value.constraints || typeof value.constraints !== "object" || Array.isArray(value.constraints)) {
    errors.push("constraints must be an object");
  }
  if (typeof value.goal !== "string" || !value.goal.trim()) errors.push("goal is required");
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    errors.push("confidence must be between 0 and 1");
  }
  if (!STATUS_SET.has(value.understandingStatus)) {
    errors.push("understandingStatus must be a supported status");
  }
  return { valid: errors.length === 0, errors, value: errors.length === 0 ? value : null };
}

const LEGACY_INTENT_ACTIONS = Object.freeze({
  unit_best_3_items: "recommend",
  unit_build_rankings: "recommend",
  unit_build_completion: "recommend",
  unit_item_rankings: "rank",
  unit_emblem_rankings: "rank",
  unit_item_comparison: "compare",
  unit_item_availability: "search",
  unit_details: "explain",
  item_details: "explain",
  trait_details: "explain",
  comp_rankings: "rank",
  comp_trends: "analyze",
  comp_analysis: "analyze",
  clarification: "unknown"
});

export function taskFrameFromIntentEnvelope(envelope = {}) {
  const entities = array(envelope.entities).map((entity) => ({
    rawText: entity.mention ?? entity.canonicalName ?? entity.apiName,
    expectedType: entity.type === "unit" ? "champion" : entity.type,
    resolvedId: entity.apiName ?? null,
    canonicalName: entity.canonicalName,
    confidence: entity.confidence,
    patch: entity.patch,
    source: entity.resolution ?? "intent_envelope"
  }));
  return createTaskFrame({
    domain: "tft",
    action: LEGACY_INTENT_ACTIONS[envelope.intent] ?? "unknown",
    subjects: entities.filter((entity) => entity.expectedType === "champion"),
    candidates: entities.filter((entity) => entity.expectedType === "item"),
    concepts: entities.filter((entity) => !["champion", "item"].includes(entity.expectedType)),
    constraints: envelope.constraints ?? {},
    goal: envelope.intent ?? "understand_request",
    expectedOutput: envelope.requestedMetrics ?? [],
    ambiguities: envelope.needsClarification ? envelope.warnings ?? ["legacy_clarification"] : [],
    confidence: envelope.confidence ?? 0,
    understandingStatus: envelope.needsClarification
      ? "understood_but_missing_context"
      : "understood_and_supported"
  });
}

export function migrateTaskFrame(value = {}) {
  if (value.schemaVersion === TASK_FRAME_SCHEMA_VERSION) {
    const normalized = createTaskFrame(value);
    const validation = validateTaskFrame(normalized);
    if (!validation.valid) throw new TypeError(validation.errors.join("; "));
    return normalized;
  }
  if (value.schemaVersion === "intent_envelope.v1") {
    return taskFrameFromIntentEnvelope(value);
  }
  throw new TypeError(`Unsupported task frame schema: ${value.schemaVersion ?? "missing"}`);
}
