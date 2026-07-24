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
  if (Array.isArray(value) && schema.items) {
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
      patch: value.metadata?.patch ?? null,
      cache: value.metadata?.cache ?? null
    }
  };
}
