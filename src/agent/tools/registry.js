import { ToolError } from "./tool-errors.js";

export const AGENT_TOOL_SCHEMA_VERSION = "agent_tool.v1";

function validateDefinition(definition) {
  if (!definition || definition.schemaVersion !== AGENT_TOOL_SCHEMA_VERSION) {
    throw new ToolError(`Tool definition schemaVersion must be ${AGENT_TOOL_SCHEMA_VERSION}`, {
      code: "invalid_tool_definition"
    });
  }
  for (const field of ["name", "description", "source", "riskLevel"]) {
    if (!String(definition[field] ?? "").trim()) {
      throw new ToolError(`Tool definition requires ${field}`, { code: "invalid_tool_definition" });
    }
  }
  if (!definition.inputSchema || definition.inputSchema.type !== "object") {
    throw new ToolError("Tool definition requires an object inputSchema", { code: "invalid_tool_definition" });
  }
  if (definition.inputSchema.additionalProperties !== false) {
    throw new ToolError("Tool definition inputSchema must reject unknown fields", {
      code: "invalid_tool_definition"
    });
  }
  for (const field of ["readOnly", "idempotent", "cacheable"]) {
    if (typeof definition[field] !== "boolean") {
      throw new ToolError(`Tool definition requires boolean ${field}`, {
        code: "invalid_tool_definition"
      });
    }
  }
  if (typeof definition.execute !== "function") {
    throw new ToolError("Tool definition requires execute()", { code: "invalid_tool_definition" });
  }
  if (!Number.isFinite(Number(definition.timeoutMs)) || Number(definition.timeoutMs) <= 0) {
    throw new ToolError("Tool definition requires a positive timeoutMs", { code: "invalid_tool_definition" });
  }
  return Object.freeze({
    ...definition,
    name: String(definition.name),
    description: String(definition.description),
    source: String(definition.source),
    readOnly: Boolean(definition.readOnly),
    idempotent: Boolean(definition.idempotent),
    cacheable: Boolean(definition.cacheable)
  });
}

export class ToolRegistry {
  constructor(definitions = []) {
    this.definitions = new Map();
    for (const definition of definitions) this.register(definition);
  }

  register(definition) {
    const value = validateDefinition(definition);
    if (this.definitions.has(value.name)) {
      throw new ToolError(`Tool is already registered: ${value.name}`, {
        code: "tool_already_registered",
        toolName: value.name
      });
    }
    this.definitions.set(value.name, value);
    return this;
  }

  get(name) {
    return this.definitions.get(String(name)) ?? null;
  }

  list() {
    return [...this.definitions.values()];
  }
}
