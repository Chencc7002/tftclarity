export const TAKEOVER_DECISION_VERSION = "semantic-takeover-decision.v2";
export const AGENT_TRACE_VERSION = "agent-route-trace.v1";
export const SEMANTIC_DIFFERENCE_VERSION = "semantic-difference-classification.v1";
export const SEMANTIC_DIFFERENCE_KINDS = Object.freeze([
  "equivalent",
  "trusted_correction",
  "entity_conflict",
  "low_confidence",
  "new_capability"
]);
export const TAKEOVER_ACTION_ORDER = Object.freeze([
  "search",
  "rank",
  "recommend",
  "compare",
  "explain",
  "analyze"
]);

export const DEFAULT_PHASE6_ROLLOUT_POLICY = Object.freeze(Object.fromEntries(
  TAKEOVER_ACTION_ORDER.map((action) => [action, Object.freeze({
    offlinePassed: true,
    shadowPassed: true,
    rolloutPercent: 100
  })])
));

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(array(values).filter(Boolean).map(String))];
}

function hashBucket(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "default")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

export function validateTakeoverPolicy(policy = DEFAULT_PHASE6_ROLLOUT_POLICY) {
  const errors = [];
  let priorExpanded = true;
  for (const action of TAKEOVER_ACTION_ORDER) {
    const entry = policy?.[action] ?? {};
    const percent = Number(entry.rolloutPercent ?? 0);
    if (typeof entry.offlinePassed !== "boolean") errors.push(`${action}.offlinePassed must be boolean`);
    if (typeof entry.shadowPassed !== "boolean") errors.push(`${action}.shadowPassed must be boolean`);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      errors.push(`${action}.rolloutPercent must be between 0 and 100`);
    }
    if (percent > 0 && (!entry.offlinePassed || !entry.shadowPassed)) {
      errors.push(`${action} cannot receive traffic before offline and shadow gates pass`);
    }
    if (percent > 0 && !priorExpanded) {
      errors.push(`${action} cannot receive traffic before the previous action reaches 100%`);
    }
    priorExpanded = priorExpanded && percent === 100;
  }
  return { valid: errors.length === 0, errors };
}

function countEntityState(frame) {
  const entities = [
    ...array(frame?.subjects),
    ...array(frame?.candidates),
    ...array(frame?.concepts)
  ];
  return {
    total: entities.length,
    resolved: entities.filter((entity) => entity?.resolvedId).length,
    unresolved: entities.filter((entity) => !entity?.resolvedId).length,
    types: unique(entities.map((entity) => entity?.expectedType))
  };
}

function entityIdsByType(frame) {
  const output = new Map();
  for (const entity of [
    ...array(frame?.subjects),
    ...array(frame?.candidates),
    ...array(frame?.concepts)
  ]) {
    if (!entity?.resolvedId) continue;
    const type = String(entity.expectedType ?? "unknown");
    if (!output.has(type)) output.set(type, new Set());
    output.get(type).add(String(entity.resolvedId));
  }
  return output;
}

function hasEntityConflict(taskFrame, legacyEntities = []) {
  const semantic = entityIdsByType(taskFrame);
  const legacy = new Map();
  for (const entity of array(legacyEntities)) {
    const type = String(entity?.expectedType ?? entity?.type ?? "unknown");
    const id = entity?.resolvedId ?? entity?.apiName ?? entity?.id;
    if (!id) continue;
    if (!legacy.has(type)) legacy.set(type, new Set());
    legacy.get(type).add(String(id));
  }
  for (const [type, semanticIds] of semantic) {
    const legacyIds = legacy.get(type);
    if (!legacyIds?.size) continue;
    if (![...semanticIds].some((id) => legacyIds.has(id))) return true;
  }
  return false;
}

function executionTools(input) {
  return unique(array(
    input.executionPlanning?.plan?.steps
    ?? input.taskPlanning?.plan?.steps
  ).map((step) => step.tool)).sort();
}

function correctionGatesPassed(input) {
  return Boolean(
    input.taskFrame?.schemaVersion === "task-frame.v1"
    && input.taskFrame?.understandingStatus === "understood_and_supported"
    && input.capabilityMatch?.status === "understood_and_supported"
    && input.executionPlanning?.validation?.valid === true
    && input.executionPlanning?.plan?.conceptMapping
    && input.executionPlanning?.plan?.finalEvidenceContract?.required === true
    && input.executionPlanning?.plan?.finalEvidenceContract?.allowModelGeneratedStatistics === false
  );
}

function planningContractPassed(input) {
  return Boolean(
    (
      input.executionPlanning?.validation?.valid === true
      && input.executionPlanning?.plan
    )
    || (
      input.taskPlanning?.validation?.valid === true
      && input.taskPlanning?.plan
    )
  );
}

export function classifySemanticDifference(input = {}) {
  const frame = input.taskFrame ?? {};
  const minimumConfidence = Math.max(0, Math.min(1, Number(input.minimumConfidence ?? 0.86)));
  const plannedTools = executionTools(input);
  const legacyTools = unique(input.legacyTools).sort();
  const difference = input.shadowDifference ?? {};
  const legacyUnsupported = Boolean(
    input.legacyUnsupported
    || difference.legacy?.action === "unknown"
    || difference.legacy?.needsClarification
  );
  const result = (kind, reason) => ({
    schemaVersion: SEMANTIC_DIFFERENCE_VERSION,
    kind,
    reason,
    trusted: kind === "equivalent" || kind === "trusted_correction",
    legacyUnsupported,
    plannedTools,
    legacyTools
  });
  if (hasEntityConflict(frame, input.legacyEntities)) {
    return result("entity_conflict", "resolved_entity_ids_disagree");
  }
  if (
    Number(frame.confidence ?? 0) < minimumConfidence
    || input.clarificationPolicy?.needsClarification
    || frame.understandingStatus !== "understood_and_supported"
    || input.capabilityMatch?.status !== "understood_and_supported"
    || !planningContractPassed(input)
  ) {
    return result("low_confidence", "semantic_gates_not_satisfied");
  }
  const shadowEquivalent = !(
    difference.actionChanged
    || difference.domainChanged
    || difference.clarificationChanged
  );
  if (
    shadowEquivalent
    && JSON.stringify(plannedTools) === JSON.stringify(legacyTools)
  ) {
    return result("equivalent", "legacy_semantics_and_tools_match");
  }
  if (legacyUnsupported && correctionGatesPassed(input)) {
    return result("trusted_correction", "legacy_unsupported_semantic_contract_passed");
  }
  return result("new_capability", "semantic_plan_exceeds_legacy_equivalence");
}

function traceFor(input = {}) {
  const frame = input.taskFrame ?? {};
  const entity = countEntityState(frame);
  const clarification = input.clarificationPolicy ?? {};
  const capability = input.capabilityMatch ?? {};
  const planning = input.executionPlanning ?? {};
  return {
    schemaVersion: AGENT_TRACE_VERSION,
    action: frame.action ?? "unknown",
    stages: {
      parsing: {
        status: frame.schemaVersion === "task-frame.v1" ? "completed" : "failed",
        schemaVersion: frame.schemaVersion ?? null,
        understandingStatus: frame.understandingStatus ?? null,
        confidence: Number(frame.confidence ?? 0)
      },
      entity: {
        status: entity.unresolved === 0 ? "completed" : "degraded",
        ...entity
      },
      context: {
        status: clarification.needsClarification ? "blocked" : "completed",
        references: array(frame.contextReferences).length,
        strategy: clarification.strategy ?? null
      },
      planning: {
        status: planning.validation?.valid === true ? "completed" : "blocked",
        tools: array(planning.plan?.steps).map((step) => step.tool),
        steps: array(planning.plan?.steps).length,
        estimatedTokens: Number(planning.validation?.estimatedTokens ?? 0)
      },
      tool: { status: "pending", error: null },
      conclusion: { status: "pending", error: null }
    },
    failureLayer: null
  };
}

function fallback(input, reason, failureLayer, mode = "fallback") {
  const trace = traceFor(input);
  trace.failureLayer = failureLayer;
  if (failureLayer && trace.stages[failureLayer]) trace.stages[failureLayer].status = "fallback";
  return {
    schemaVersion: TAKEOVER_DECISION_VERSION,
    route: "legacy_fallback",
    executionPath: "legacy_fallback",
    mode,
    action: input.taskFrame?.action ?? "unknown",
    reason,
    rolloutBucket: hashBucket(input.requestKey),
    semanticDifference: input.semanticDifference ?? null,
    plannedTools: executionTools(input),
    legacyTools: unique(input.legacyTools),
    trace
  };
}

export function createTakeoverDecision(input = {}) {
  const policy = input.policy ?? DEFAULT_PHASE6_ROLLOUT_POLICY;
  const policyValidation = validateTakeoverPolicy(policy);
  if (!policyValidation.valid) return fallback(input, "invalid_rollout_policy", "planning");
  const action = input.taskFrame?.action;
  if (!TAKEOVER_ACTION_ORDER.includes(action)) {
    return fallback(input, "action_not_enabled", "parsing");
  }
  const gate = policy[action];
  if (!gate.offlinePassed) return fallback(input, "offline_gate_failed", "parsing", "shadow");
  if (!gate.shadowPassed) return fallback(input, "shadow_gate_failed", "parsing", "shadow");
  if (input.clarificationPolicy?.needsClarification) {
    return fallback(input, "clarification_required", "context");
  }
  if (input.capabilityMatch?.status !== "understood_and_supported") {
    return fallback(input, "unsupported_capability", "planning");
  }
  if (!planningContractPassed(input)) {
    return fallback(input, "invalid_execution_plan", "planning");
  }
  const semanticDifference = classifySemanticDifference(input);
  const classifiedInput = { ...input, semanticDifference };
  if (semanticDifference.kind === "entity_conflict") {
    return fallback(classifiedInput, "entity_conflict", "entity");
  }
  if (semanticDifference.kind === "low_confidence") {
    return fallback(classifiedInput, "low_confidence_semantics", "parsing");
  }
  if (semanticDifference.kind === "new_capability") {
    const difference = input.shadowDifference ?? {};
    if (difference.actionChanged || difference.domainChanged || difference.clarificationChanged) {
      return fallback(classifiedInput, "shadow_difference", "parsing");
    }
    if (
      input.executionPlanSovereignty !== true
      && JSON.stringify(semanticDifference.plannedTools) !== JSON.stringify(semanticDifference.legacyTools)
    ) {
      return fallback(classifiedInput, "plan_not_compatible_with_legacy", "planning");
    }
    if (input.executionPlanSovereignty !== true) {
      return fallback(classifiedInput, "new_capability_not_enabled", "planning");
    }
  }
  const plannedTools = executionTools(input);
  const entityState = countEntityState(input.taskFrame);
  const correctionMapping = input.executionPlanning?.plan?.conceptMapping ?? null;
  const unresolvedRequired = [
    ...array(input.taskFrame?.subjects),
    ...array(input.taskFrame?.candidates),
    ...array(input.taskFrame?.concepts)
  ].filter((entity) => (
    !entity?.resolvedId
    && !(
      semanticDifference.kind === "trusted_correction"
      && correctionMapping
      && entity?.expectedType === "composition"
      && /^(?:阵容|体系)$/u.test(String(entity.rawText ?? "").trim())
    )
  ));
  if (
    entityState.unresolved > 0
    && unresolvedRequired.length > 0
    && !plannedTools.every((tool) => tool === "semantic_search")
  ) {
    return fallback(classifiedInput, "unresolved_execution_entity", "entity");
  }
  const legacyTools = unique(input.legacyTools).sort();
  if (
    semanticDifference.kind === "equivalent"
    && input.executionPlanSovereignty !== true
    && JSON.stringify(plannedTools) !== JSON.stringify(legacyTools)
  ) {
    return fallback(classifiedInput, "plan_not_compatible_with_legacy", "planning");
  }
  const rolloutBucket = hashBucket(input.requestKey);
  if (Number(gate.rolloutPercent) <= rolloutBucket) {
    return fallback(classifiedInput, "outside_rollout_bucket", null, "canary");
  }
  const trace = traceFor(input);
  return {
    schemaVersion: TAKEOVER_DECISION_VERSION,
    route: semanticDifference.kind === "trusted_correction" ? "semantic_correction" : "semantic",
    executionPath: semanticDifference.kind === "trusted_correction"
      ? "semantic_correction"
      : input.executionPlanSovereignty === true
        ? input.executionPlanning?.plan?.route ?? "execution_plan"
        : "legacy_equivalent",
    mode: Number(gate.rolloutPercent) === 100 ? "active" : "canary",
    action,
    reason: semanticDifference.reason,
    rolloutBucket,
    plannedTools,
    legacyTools,
    semanticDifference,
    trace
  };
}

export function finalizeTakeoverTrace(decision, outcome = {}) {
  const trace = structuredClone(decision?.trace ?? traceFor({}));
  const toolStatus = String(outcome.toolStatus ?? "completed");
  const conclusionStatus = String(outcome.conclusionStatus ?? (
    toolStatus === "completed" ? "completed" : "not_started"
  ));
  trace.stages.tool = {
    status: toolStatus,
    error: outcome.toolError ? String(outcome.toolError) : null
  };
  trace.stages.conclusion = {
    status: conclusionStatus,
    error: outcome.conclusionError ? String(outcome.conclusionError) : null
  };
  if (outcome.failureLayer) trace.failureLayer = String(outcome.failureLayer);
  else if (!["completed", "cache_hit"].includes(toolStatus)) trace.failureLayer = "tool";
  else if (conclusionStatus !== "completed") trace.failureLayer = "conclusion";
  trace.metrics = {
    latencyMs: Math.max(0, Number(outcome.latencyMs ?? 0)),
    inputTokens: Math.max(0, Number(outcome.inputTokens ?? 0)),
    cachedInputTokens: Math.max(0, Number(outcome.cachedInputTokens ?? 0)),
    outputTokens: Math.max(0, Number(outcome.outputTokens ?? 0))
  };
  return trace;
}
