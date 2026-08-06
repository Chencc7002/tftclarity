export const SYSTEM_INTERACTION_ROUTE_SCHEMA_VERSION = "system_interaction_route.v1";
export const SYSTEM_INTERACTION_ANSWER_MODE = "system_help";

export const SYSTEM_INTERACTION_TYPES = Object.freeze([
  "greeting",
  "capability_help",
  "usage_help",
  "out_of_domain"
]);

const INTERACTION_TYPE_SET = new Set(SYSTEM_INTERACTION_TYPES);

export function normalizeSystemInteractionInput(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ");
}

export function compactSystemInteractionInput(value) {
  return normalizeSystemInteractionInput(value)
    .replace(/[\s，。！？、,.!?;；:："'“”‘’（）()【】[\]{}<>《》~～·…-]+/gu, "");
}

export function unhandledSystemInteraction() {
  return Object.freeze({ handled: false });
}

export function createSystemInteractionResult({
  interactionType,
  answer
} = {}) {
  if (!INTERACTION_TYPE_SET.has(interactionType)) {
    throw new TypeError(`Unsupported system interaction type: ${interactionType}`);
  }
  const text = String(answer ?? "").trim();
  if (!text) throw new TypeError("System interaction answer must not be empty");
  return {
    handled: true,
    schemaVersion: SYSTEM_INTERACTION_ROUTE_SCHEMA_VERSION,
    interactionType,
    answerMode: SYSTEM_INTERACTION_ANSWER_MODE,
    answer: text,
    showEvidencePanel: false
  };
}

export function validateSystemInteractionResult(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["result must be an object"] };
  }
  if (value.handled === false) {
    const fields = Object.keys(value);
    if (fields.length !== 1) errors.push("unhandled result may only contain handled");
    return { valid: errors.length === 0, errors };
  }
  if (value.handled !== true) errors.push("handled must be true or false");
  if (value.schemaVersion !== SYSTEM_INTERACTION_ROUTE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SYSTEM_INTERACTION_ROUTE_SCHEMA_VERSION}`);
  }
  if (!INTERACTION_TYPE_SET.has(value.interactionType)) {
    errors.push("interactionType is unsupported");
  }
  if (value.answerMode !== SYSTEM_INTERACTION_ANSWER_MODE) {
    errors.push(`answerMode must be ${SYSTEM_INTERACTION_ANSWER_MODE}`);
  }
  if (typeof value.answer !== "string" || !value.answer.trim()) {
    errors.push("answer must be a non-empty string");
  }
  if (value.showEvidencePanel !== false) {
    errors.push("showEvidencePanel must be false");
  }
  return { valid: errors.length === 0, errors };
}
