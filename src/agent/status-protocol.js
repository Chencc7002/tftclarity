export const AGENT_STATUS_PROTOCOL_VERSION = "agent-status.v1";

export const AGENT_STATUS_ENUMS = Object.freeze({
  understandingStatus: Object.freeze([
    "pending",
    "understood",
    "missing_context",
    "ambiguous",
    "out_of_domain",
    "failed"
  ]),
  capabilityStatus: Object.freeze(["pending", "supported", "unsupported"]),
  planningStatus: Object.freeze(["pending", "planned", "not_planned", "failed"]),
  executionStatus: Object.freeze([
    "pending",
    "completed",
    "degraded",
    "failed",
    "cancelled",
    "timed_out"
  ]),
  evidenceStatus: Object.freeze(["pending", "sufficient", "insufficient"]),
  finalOutcome: Object.freeze([
    "pending",
    "answered",
    "clarified",
    "degraded",
    "refused"
  ])
});

const ENUM_SETS = Object.fromEntries(
  Object.entries(AGENT_STATUS_ENUMS).map(([key, values]) => [key, new Set(values)])
);

function frameUnderstandingStatus(frame = {}) {
  if (frame.domain === "out_of_domain" || frame.understandingStatus === "out_of_domain") {
    return "out_of_domain";
  }
  if (frame.understandingStatus === "ambiguous") return "ambiguous";
  if (frame.understandingStatus === "understood_but_missing_context") return "missing_context";
  return "understood";
}

function invariantErrors(status) {
  const errors = [];
  if (
    status.capabilityStatus === "supported"
    && status.understandingStatus !== "understood"
  ) {
    errors.push("supported capability requires understood input");
  }
  if (
    status.planningStatus === "planned"
    && status.capabilityStatus !== "supported"
  ) {
    errors.push("planned status requires supported capability");
  }
  if (
    ["completed", "degraded", "failed", "cancelled", "timed_out"]
      .includes(status.executionStatus)
    && status.planningStatus !== "planned"
  ) {
    errors.push("terminal execution status requires a plan");
  }
  if (
    status.evidenceStatus === "sufficient"
    && status.executionStatus !== "completed"
  ) {
    errors.push("sufficient evidence requires completed execution");
  }
  if (
    status.finalOutcome === "answered"
    && !(
      status.understandingStatus === "understood"
      && status.capabilityStatus === "supported"
      && status.planningStatus === "planned"
      && status.executionStatus === "completed"
      && status.evidenceStatus === "sufficient"
    )
  ) {
    errors.push("answered outcome requires a fully completed supported run");
  }
  if (
    status.finalOutcome === "clarified"
    && !["missing_context", "ambiguous"].includes(status.understandingStatus)
  ) {
    errors.push("clarified outcome requires missing or ambiguous understanding");
  }
  if (
    status.finalOutcome === "refused"
    && status.understandingStatus !== "out_of_domain"
  ) {
    errors.push("refused outcome requires out-of-domain understanding");
  }
  return errors;
}

export function validateAgentStatus(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["Agent status must be an object"], value: null };
  }
  if (value.schemaVersion !== AGENT_STATUS_PROTOCOL_VERSION) {
    errors.push(`schemaVersion must be ${AGENT_STATUS_PROTOCOL_VERSION}`);
  }
  for (const [key, allowed] of Object.entries(ENUM_SETS)) {
    if (!allowed.has(value[key])) errors.push(`${key} is not an allowed status`);
  }
  if (errors.length === 0) errors.push(...invariantErrors(value));
  return {
    valid: errors.length === 0,
    errors,
    value: errors.length === 0 ? structuredClone(value) : null
  };
}

export function createAgentStatus(value = {}) {
  const status = {
    schemaVersion: AGENT_STATUS_PROTOCOL_VERSION,
    understandingStatus: value.understandingStatus ?? "pending",
    capabilityStatus: value.capabilityStatus ?? "pending",
    planningStatus: value.planningStatus ?? "pending",
    executionStatus: value.executionStatus ?? "pending",
    evidenceStatus: value.evidenceStatus ?? "pending",
    finalOutcome: value.finalOutcome ?? "pending"
  };
  const validation = validateAgentStatus(status);
  if (!validation.valid) {
    throw new TypeError(`Invalid agent status: ${validation.errors.join("; ")}`);
  }
  return validation.value;
}

export function statusAfterUnderstanding(frame) {
  return createAgentStatus({
    understandingStatus: frameUnderstandingStatus(frame)
  });
}

export function statusAfterPlanning(frame, capabilityMatch, executionPlanning) {
  const understanding = frameUnderstandingStatus(frame);
  const canEvaluateCapability = understanding === "understood";
  const capabilitySupported = canEvaluateCapability
    && capabilityMatch?.status === "understood_and_supported";
  const capabilityStatus = canEvaluateCapability
    ? capabilitySupported ? "supported" : "unsupported"
    : understanding === "out_of_domain" ? "unsupported" : "pending";
  const planningStatus = capabilitySupported
    ? executionPlanning?.validation?.valid === true ? "planned" : "failed"
    : "not_planned";
  const finalOutcome = ["missing_context", "ambiguous"].includes(understanding)
    ? "clarified"
    : understanding === "out_of_domain"
      ? "refused"
      : capabilityStatus === "unsupported" || planningStatus === "failed"
        ? "degraded"
        : "pending";
  return createAgentStatus({
    understandingStatus: understanding,
    capabilityStatus,
    planningStatus,
    executionStatus: "pending",
    evidenceStatus: "pending",
    finalOutcome
  });
}

export function statusAfterExecution(status, execution) {
  const base = status
    ? createAgentStatus(status)
    : createAgentStatus({
      understandingStatus: "understood",
      capabilityStatus: "supported",
      planningStatus: "planned"
    });
  const executionStatus = [
    "completed",
    "degraded",
    "failed",
    "cancelled",
    "timed_out"
  ].includes(execution?.status)
    ? execution.status
    : "failed";
  const evidenceSufficient = execution?.evidenceValidation?.sufficient === true;
  return createAgentStatus({
    ...base,
    executionStatus,
    evidenceStatus: evidenceSufficient ? "sufficient" : "insufficient",
    finalOutcome: executionStatus === "completed" && evidenceSufficient
      ? "answered"
      : "degraded"
  });
}
