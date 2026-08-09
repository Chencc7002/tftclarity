export const TOOL_EVIDENCE_VALIDATION_VERSION = "tool-evidence-validation.v1";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function resolvePath(value, path) {
  return String(path ?? "").split(".").filter(Boolean).reduce(
    (current, key) => current == null ? undefined : current[key],
    value
  );
}

function evidenceField(value, metadata, path) {
  if (path === "source") return metadata?.source;
  if (path === "updatedAt") return metadata?.updatedAt;
  if (String(path).startsWith("metadata.")) {
    return resolvePath(metadata, String(path).slice("metadata.".length));
  }
  const direct = resolvePath(value, path);
  if (direct !== undefined && direct !== null) return direct;
  return resolvePath(metadata, path);
}

function missing(value) {
  return value === undefined || value === null || value === "";
}

export function validateToolEvidence(input = {}) {
  const definition = input.definition ?? {};
  const toolResult = input.toolResult ?? {};
  const contract = input.evidenceContract ?? {};
  const errors = [];
  const expectedTool = String(input.toolName ?? definition.name ?? contract.tool ?? "");
  const expectedSource = String(contract.source ?? definition.source ?? "");
  const expectedType = String(contract.type ?? definition.evidenceType ?? "");
  const metadata = toolResult.metadata ?? {};

  if (toolResult.status !== "completed") errors.push("ToolResult is not completed");
  if (expectedTool && toolResult.toolName !== expectedTool) {
    errors.push(`evidence tool mismatch: expected ${expectedTool}`);
  }
  if (expectedSource && metadata.source !== expectedSource) {
    errors.push(`evidence source mismatch: expected ${expectedSource}`);
  }
  if (expectedType && metadata.evidenceType !== expectedType) {
    errors.push(`evidence type mismatch: expected ${expectedType}`);
  }
  if (
    contract.allowModelGeneratedStatistics === false
    && metadata.modelGeneratedStatistics === true
  ) {
    errors.push("model-generated statistics are forbidden");
  }
  for (const field of array(contract.requiredFields)) {
    if (missing(evidenceField(toolResult.value, metadata, field))) {
      errors.push(`evidence missing required field ${field}`);
    }
  }

  return {
    schemaVersion: TOOL_EVIDENCE_VALIDATION_VERSION,
    valid: errors.length === 0,
    errors
  };
}
