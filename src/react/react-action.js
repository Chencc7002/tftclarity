export const REACT_ACTION_SCHEMA_VERSION = "react-action.v1";

export const REACT_ACTION_TYPES = Object.freeze([
  "call_tool",
  "ask_user",
  "finish"
]);

export const REACT_PURPOSE_CODES = Object.freeze([
  "retrieve_current_statistics",
  "retrieve_entity_details",
  "compare_sources",
  "retrieve_supporting_knowledge",
  "recover_from_failure",
  "other"
]);

export const REACT_ASK_REASON_CODES = Object.freeze([
  "missing_context",
  "ambiguous_entity",
  "conflicting_constraints"
]);

export const REACT_FINISH_REASON_CODES = Object.freeze([
  "direct_answer",
  "sufficient_evidence",
  "insufficient_evidence"
]);

const ALLOWED_FIELDS = Object.freeze({
  call_tool: new Set(["schemaVersion", "type", "tool", "arguments", "purposeCode"]),
  ask_user: new Set(["schemaVersion", "type", "question", "missingFields", "reasonCode"]),
  finish: new Set(["schemaVersion", "type", "answer", "evidenceIds", "reasonCode", "narrative"])
});

function object(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.every((entry) => nonEmptyString(entry));
}

export function validateReactAction(value, options = {}) {
  const errors = [];
  if (!object(value)) {
    return { valid: false, value: null, errors: ["action must be an object"] };
  }
  if (value.schemaVersion !== REACT_ACTION_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${REACT_ACTION_SCHEMA_VERSION}`);
  }
  if (!REACT_ACTION_TYPES.includes(value.type)) errors.push("type must be an allowed action");
  const allowed = ALLOWED_FIELDS[value.type];
  if (allowed) {
    for (const field of Object.keys(value)) {
      if (!allowed.has(field)) errors.push(`${field} is not allowed for ${value.type}`);
    }
  }

  if (value.type === "call_tool") {
    if (!nonEmptyString(value.tool)) errors.push("call_tool.tool is required");
    if (!object(value.arguments)) errors.push("call_tool.arguments must be an object");
    if (!REACT_PURPOSE_CODES.includes(value.purposeCode)) {
      errors.push("call_tool.purposeCode must be allowed");
    }
    if (options.registry && value.tool && !options.registry.get(value.tool)) {
      errors.push("call_tool.tool is not registered");
    } else if (
      value.tool
      && options.availableToolNames
      && !options.availableToolNames.has(value.tool)
    ) {
      errors.push("call_tool.tool is not available in this run");
    }
  } else if (value.type === "ask_user") {
    if (!nonEmptyString(value.question)) errors.push("ask_user.question is required");
    if (!stringArray(value.missingFields)) {
      errors.push("ask_user.missingFields must be an array of non-empty strings");
    }
    if (!REACT_ASK_REASON_CODES.includes(value.reasonCode)) {
      errors.push("ask_user.reasonCode must be allowed");
    }
  } else if (value.type === "finish") {
    if (!nonEmptyString(value.answer)) errors.push("finish.answer is required");
    if (!stringArray(value.evidenceIds) && !Array.isArray(value.evidenceIds)) {
      errors.push("finish.evidenceIds must be an array of strings");
    } else if (Array.isArray(value.evidenceIds) && value.evidenceIds.some((entry) => typeof entry !== "string")) {
      errors.push("finish.evidenceIds must contain only strings");
    }
    if (!REACT_FINISH_REASON_CODES.includes(value.reasonCode)) {
      errors.push("finish.reasonCode must be allowed");
    }
  }

  return {
    valid: errors.length === 0,
    value: errors.length ? null : structuredClone(value),
    errors
  };
}

export function createReactAction(value, options = {}) {
  const validation = validateReactAction(value, options);
  if (!validation.valid) {
    throw new TypeError(`Invalid ReactAction: ${validation.errors.join("; ")}`);
  }
  return validation.value;
}
