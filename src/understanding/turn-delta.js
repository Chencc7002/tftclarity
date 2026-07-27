import { createTaskFrame, validateTaskFrame } from "./task-frame.js";

export const TURN_DELTA_SCHEMA_VERSION = "turn-delta.v1";

export const TURN_DELTA_DIALOGUE_ACTS = Object.freeze([
  "start_task",
  "continue",
  "request_more",
  "request_less",
  "next_page",
  "previous_page",
  "modify",
  "compare",
  "switch_task",
  "confirm",
  "reject",
  "cancel",
  "clarify",
  "unknown"
]);

export const TURN_DELTA_TASK_RELATIONS = Object.freeze([
  "new",
  "continue",
  "modify",
  "switch",
  "return",
  "cancel",
  "unknown"
]);

export const TURN_DELTA_OPERATIONS = Object.freeze([
  "set",
  "add",
  "remove",
  "replace",
  "clear"
]);

export const TURN_DELTA_ENTITY_FIELDS = Object.freeze([
  "subjects",
  "candidates",
  "concepts"
]);

export const TURN_DELTA_CONSTRAINT_FIELDS = Object.freeze([
  "patch",
  "days",
  "queue",
  "rank",
  "rankFilter",
  "starLevel",
  "itemCount",
  "minSamples",
  "sort",
  "metrics",
  "limit",
  "specialMode",
  "strategy",
  "contested",
  "beginnerFriendly",
  "itemPolicy",
  "itemCategories",
  "traitFilters",
  "lockedItems",
  "ownedItems",
  "excludedItems",
  "comparisonItems",
  "primaryMetric",
  "performanceItem",
  "comp"
]);

const DIALOGUE_ACT_SET = new Set(TURN_DELTA_DIALOGUE_ACTS);
const TASK_RELATION_SET = new Set(TURN_DELTA_TASK_RELATIONS);
const OPERATION_SET = new Set(TURN_DELTA_OPERATIONS);
const ENTITY_FIELD_SET = new Set(TURN_DELTA_ENTITY_FIELDS);
const CONSTRAINT_FIELD_SET = new Set(TURN_DELTA_CONSTRAINT_FIELDS);
const TOP_LEVEL_FIELDS = new Set([
  "schemaVersion",
  "dialogueAct",
  "taskRelation",
  "explicitTaskFrame",
  "entityOperations",
  "constraintOperations",
  "presentation",
  "confidence",
  "ambiguities"
]);
const OPERATION_FIELDS = new Set(["operation", "field", "value", "oldValue"]);
const PRESENTATION_FIELDS = new Set(["requestedCount", "pageDirection", "avoidSeen"]);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function finiteConfidence(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function normalizeOperation(value = {}) {
  return {
    operation: value.operation ?? "set",
    field: value.field == null ? "" : String(value.field),
    ...(value.value !== undefined ? { value: clone(value.value) } : {}),
    ...(value.oldValue !== undefined ? { oldValue: clone(value.oldValue) } : {})
  };
}

export function createTurnDelta(value = {}) {
  return {
    schemaVersion: TURN_DELTA_SCHEMA_VERSION,
    dialogueAct: value.dialogueAct ?? "unknown",
    taskRelation: value.taskRelation ?? "unknown",
    explicitTaskFrame: value.explicitTaskFrame ? createTaskFrame(value.explicitTaskFrame) : null,
    entityOperations: array(value.entityOperations).map(normalizeOperation),
    constraintOperations: array(value.constraintOperations).map(normalizeOperation),
    presentation: {
      requestedCount: value.presentation?.requestedCount == null
        ? null
        : Number(value.presentation.requestedCount),
      pageDirection: value.presentation?.pageDirection ?? null,
      avoidSeen: value.presentation?.avoidSeen === true
    },
    confidence: finiteConfidence(value.confidence),
    ambiguities: array(value.ambiguities).map((entry) => clone(entry))
  };
}

function validateOperation(operation, path, allowedFields, errors, domainPolicy) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!OPERATION_SET.has(operation.operation)) errors.push(`${path}.operation is unsupported`);
  if (!allowedFields.has(operation.field)) errors.push(`${path}.field is unsupported`);
  for (const field of Object.keys(operation)) {
    if (!OPERATION_FIELDS.has(field)) errors.push(`${path}.${field} is not allowed`);
  }
  if (operation.operation !== "clear" && operation.value === undefined) {
    errors.push(`${path}.value is required for ${operation.operation}`);
  }
  if (operation.operation === "replace" && operation.oldValue === undefined) {
    errors.push(`${path}.oldValue is required for replace`);
  }
  if (typeof domainPolicy?.validateOperation === "function") {
    const result = domainPolicy.validateOperation(operation);
    if (result === false) errors.push(`${path} is rejected by domain policy`);
    else if (Array.isArray(result)) errors.push(...result.map((error) => `${path}.${error}`));
  }
}

export function validateTurnDelta(value, options = {}) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["TurnDelta must be an object"], value: null };
  }
  if (value.schemaVersion !== TURN_DELTA_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${TURN_DELTA_SCHEMA_VERSION}`);
  }
  for (const field of Object.keys(value)) {
    if (!TOP_LEVEL_FIELDS.has(field)) errors.push(`${field} is not allowed`);
  }
  if (!DIALOGUE_ACT_SET.has(value.dialogueAct)) errors.push("dialogueAct is unsupported");
  if (!TASK_RELATION_SET.has(value.taskRelation)) errors.push("taskRelation is unsupported");
  if (value.explicitTaskFrame !== null) {
    const validation = validateTaskFrame(value.explicitTaskFrame);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => `explicitTaskFrame.${error}`));
    }
  }
  if (!Array.isArray(value.entityOperations)) errors.push("entityOperations must be an array");
  if (!Array.isArray(value.constraintOperations)) errors.push("constraintOperations must be an array");
  array(value.entityOperations).forEach((operation, index) => validateOperation(
    operation,
    `entityOperations[${index}]`,
    ENTITY_FIELD_SET,
    errors,
    options.domainPolicy
  ));
  array(value.constraintOperations).forEach((operation, index) => validateOperation(
    operation,
    `constraintOperations[${index}]`,
    new Set(options.domainPolicy?.constraintFields ?? CONSTRAINT_FIELD_SET),
    errors,
    options.domainPolicy
  ));
  const presentation = value.presentation;
  if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) {
    errors.push("presentation must be an object");
  } else {
    for (const field of Object.keys(presentation)) {
      if (!PRESENTATION_FIELDS.has(field)) errors.push(`presentation.${field} is not allowed`);
    }
    if (
      presentation.requestedCount !== null
      && (!Number.isInteger(presentation.requestedCount) || presentation.requestedCount < 1 || presentation.requestedCount > 100)
    ) {
      errors.push("presentation.requestedCount must be null or an integer from 1 to 100");
    }
    if (![null, "next", "previous", "same"].includes(presentation.pageDirection)) {
      errors.push("presentation.pageDirection is unsupported");
    }
    if (typeof presentation.avoidSeen !== "boolean") {
      errors.push("presentation.avoidSeen must be boolean");
    }
  }
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    errors.push("confidence must be between 0 and 1");
  }
  if (!Array.isArray(value.ambiguities)) errors.push("ambiguities must be an array");
  if (
    ["new", "switch"].includes(value.taskRelation)
    && value.explicitTaskFrame === null
  ) {
    errors.push("explicitTaskFrame is required for new or switch");
  }
  if (value.taskRelation === "cancel" && value.dialogueAct !== "cancel") {
    errors.push("cancel relation requires cancel dialogueAct");
  }
  return { valid: errors.length === 0, errors, value: errors.length === 0 ? value : null };
}

export function unknownTurnDelta(reason = "uninterpretable_turn") {
  return createTurnDelta({
    dialogueAct: "unknown",
    taskRelation: "unknown",
    confidence: 0,
    ambiguities: [{ code: String(reason), affectsToolSelection: true }]
  });
}
