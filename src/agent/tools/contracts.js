import { ToolError } from "./tool-errors.js";

export const AGENT_TOOL_RESULT_SCHEMA_VERSION = "agent_tool_result.v1";

function matchesType(value, type) {
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return Number.isFinite(value);
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function validateValue(value, schema, path, errors) {
  if (!schema || Object.keys(schema).length === 0) return;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type) => matchesType(value, type))) {
    errors.push(`${path} must be ${types.join(" or ")}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be an allowed value`);
  if (typeof value === "string") {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      errors.push(`${path} must contain at least ${schema.minLength} characters`);
    }
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
      errors.push(`${path} must contain at most ${schema.maxLength} characters`);
    }
  }
  if (typeof value === "number") {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) {
      errors.push(`${path} must be at least ${schema.minimum}`);
    }
    if (Number.isFinite(schema.maximum) && value > schema.maximum) {
      errors.push(`${path} must be at most ${schema.maximum}`);
    }
  }
  if (Array.isArray(value) && schema.items) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} items`);
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} items`);
    }
    value.forEach((entry, index) => validateValue(entry, schema.items, `${path}[${index}]`, errors));
  }
  if (value && typeof value === "object" && !Array.isArray(value) && schema.type === "object") {
    const properties = schema.properties ?? {};
    for (const field of schema.required ?? []) {
      if (!(field in value)) errors.push(`${path}.${field} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const field of Object.keys(value)) {
        if (!(field in properties)) errors.push(`${path}.${field} is not allowed`);
      }
    }
    for (const [field, child] of Object.entries(properties)) {
      if (field in value) validateValue(value[field], child, `${path}.${field}`, errors);
    }
    if (
      Array.isArray(schema.not?.required)
      && schema.not.required.length
      && schema.not.required.every((field) => field in value)
    ) {
      errors.push(`${path} must not contain ${schema.not.required.join(" and ")} together`);
    }
  }
}

export function validateToolInput(input, schema, toolName) {
  const errors = [];
  validateValue(input, schema, "input", errors);
  if (errors.length) {
    throw new ToolError(`Invalid input for ${toolName}`, {
      code: "invalid_tool_input",
      toolName,
      details: { errors }
    });
  }
  return structuredClone(input);
}

export function createToolResult(value = {}) {
  return {
    schemaVersion: AGENT_TOOL_RESULT_SCHEMA_VERSION,
    toolCallId: String(value.toolCallId),
    toolName: String(value.toolName),
    status: String(value.status),
    startedAt: String(value.startedAt),
    completedAt: String(value.completedAt),
    durationMs: Math.max(0, Number(value.durationMs ?? 0)),
    attempts: Math.max(1, Number(value.attempts ?? 1)),
    value: value.value ?? null,
    error: value.error ?? null,
    metadata: {
      source: value.metadata?.source ?? null,
      evidenceType: value.metadata?.evidenceType ?? null,
      updatedAt: value.metadata?.updatedAt ?? null,
      patch: value.metadata?.patch ?? null,
      cache: value.metadata?.cache ?? null,
      modelGeneratedStatistics: value.metadata?.modelGeneratedStatistics === true
    }
  };
}
