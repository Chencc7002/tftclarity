import {
  createConversationState,
  MAX_CONVERSATION_TASK_HISTORY,
  validateConversationState
} from "./conversation-state.js";
import { createTaskFrame } from "./task-frame.js";
import { createTurnDelta, validateTurnDelta } from "./turn-delta.js";

export const CONTEXT_REDUCER_VERSION = "conversation-context-reducer.v1";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function entityIdentity(entity) {
  return `${entity?.expectedType ?? "game_concept"}:${entity?.resolvedId ?? entity?.rawText ?? ""}`;
}

function uniqueEntities(values) {
  const seen = new Set();
  return array(values).filter((entity) => {
    const identity = entityIdentity(entity);
    if (!identity.split(":").slice(1).join(":")) return false;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).map(clone);
}

function normalizeEntityValues(field, value) {
  const values = array(value);
  return createTaskFrame({
    action: "unknown",
    goal: "normalize_entities",
    [field]: values,
    understandingStatus: "understood_and_supported"
  })[field];
}

function comparable(value) {
  return JSON.stringify(value);
}

function valueArray(value) {
  return Array.isArray(value) ? value : [value];
}

function removeValues(current, values) {
  const removals = new Set(valueArray(values).map(comparable));
  return array(current).filter((entry) => !removals.has(comparable(entry)));
}

function addValues(current, values) {
  const merged = [...array(current), ...valueArray(values)];
  const seen = new Set();
  return merged.filter((entry) => {
    const key = comparable(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyValueOperation(current, operation) {
  if (operation.operation === "clear") return undefined;
  if (operation.operation === "set") return clone(operation.value);
  if (operation.operation === "add") {
    return addValues(Array.isArray(current) ? current : current == null ? [] : [current], operation.value);
  }
  if (operation.operation === "remove") {
    const next = removeValues(Array.isArray(current) ? current : current == null ? [] : [current], operation.value);
    return Array.isArray(current) ? next : next[0];
  }
  if (operation.operation === "replace") {
    const removed = removeValues(Array.isArray(current) ? current : current == null ? [] : [current], operation.oldValue);
    const next = addValues(removed, operation.value);
    return Array.isArray(current) ? next : next[0];
  }
  return clone(current);
}

function applyEntityOperations(frame, operations, changedFields) {
  const next = clone(frame);
  for (const operation of operations) {
    const current = next[operation.field] ?? [];
    if (operation.operation === "clear") {
      next[operation.field] = [];
    } else if (operation.operation === "set") {
      next[operation.field] = normalizeEntityValues(operation.field, operation.value);
    } else {
      const values = normalizeEntityValues(operation.field, operation.value);
      const oldValues = normalizeEntityValues(operation.field, operation.oldValue);
      if (operation.operation === "add") {
        next[operation.field] = uniqueEntities([...current, ...values]);
      } else if (operation.operation === "remove") {
        const removals = new Set(values.map(entityIdentity));
        next[operation.field] = current.filter((entity) => !removals.has(entityIdentity(entity)));
      } else if (operation.operation === "replace") {
        const removals = new Set(oldValues.map(entityIdentity));
        next[operation.field] = uniqueEntities([
          ...current.filter((entity) => !removals.has(entityIdentity(entity))),
          ...values
        ]);
      }
    }
    changedFields.push(operation.field);
  }
  return createTaskFrame(next);
}

function applyConstraintOperations(frame, operations, changedFields) {
  const constraints = clone(frame.constraints ?? {});
  for (const operation of operations) {
    const value = applyValueOperation(constraints[operation.field], operation);
    if (value === undefined || (
      Array.isArray(value) && value.length === 0
    )) {
      delete constraints[operation.field];
    } else {
      constraints[operation.field] = value;
    }
    changedFields.push(`constraints.${operation.field}`);
  }
  return createTaskFrame({ ...frame, constraints });
}

function bindCompositionResultReference(frame, resolution) {
  const reference = resolution.resultReference;
  if (
    reference?.scope !== "last_result"
    || !reference.resultId
    || frame?.goal !== "comp_rankings"
  ) return createTaskFrame(frame);
  const constraints = clone(frame.constraints ?? {});
  constraints.comp = {
    rawText: `result ${reference.ordinal}`,
    expectedType: "composition",
    resolvedId: String(reference.resultId),
    confidence: 1,
    source: "conversation_result_reference"
  };
  if (array(constraints.excludedItems).length) {
    constraints.avoidItemComponents = addValues(
      constraints.avoidItemComponents,
      constraints.excludedItems
    );
    delete constraints.excludedItems;
    resolution.changedFields.push(
      "constraints.avoidItemComponents",
      "constraints.excludedItems"
    );
    resolution.trace.steps.push("reinterpret_selected_comp_item_exclusion");
  }
  resolution.changedFields.push("constraints.comp");
  resolution.trace.steps.push("bind_selected_composition");
  return createTaskFrame({ ...frame, constraints });
}

function explicitFrameHasMaterial(frame) {
  return Boolean(
    frame
    && (
      frame.action !== "unknown"
      || frame.goal !== "understand_request"
      || frame.subjects.length
      || frame.candidates.length
      || frame.concepts.length
      || Object.keys(frame.constraints).length
    )
  );
}

function mergeExplicitFrame(base, explicit, changedFields, inheritedFields) {
  if (!explicitFrameHasMaterial(explicit)) return createTaskFrame(base);
  const next = clone(base);
  if (explicit.action !== "unknown") {
    next.action = explicit.action;
    changedFields.push("action");
  } else {
    inheritedFields.push("action");
  }
  if (explicit.domain && explicit.domain !== "out_of_domain") next.domain = explicit.domain;
  if (explicit.goal !== "understand_request") {
    next.goal = explicit.goal;
    changedFields.push("goal");
  } else {
    inheritedFields.push("goal");
  }
  for (const field of ["subjects", "candidates", "concepts"]) {
    if (explicit[field].length > 0) {
      next[field] = clone(explicit[field]);
      changedFields.push(field);
    } else if (base[field]?.length) {
      inheritedFields.push(field);
    }
  }
  next.constraints = {
    ...(base.constraints ?? {}),
    ...(explicit.constraints ?? {})
  };
  for (const key of Object.keys(base.constraints ?? {})) {
    if (!Object.hasOwn(explicit.constraints ?? {}, key)) inheritedFields.push(`constraints.${key}`);
  }
  for (const key of Object.keys(explicit.constraints ?? {})) changedFields.push(`constraints.${key}`);
  next.expectedOutput = explicit.expectedOutput.length ? clone(explicit.expectedOutput) : clone(base.expectedOutput);
  next.contextReferences = [...array(base.contextReferences), ...array(explicit.contextReferences)];
  next.ambiguities = clone(explicit.ambiguities);
  next.assumptions = [...new Set([...array(base.assumptions), ...array(explicit.assumptions)])];
  next.capabilityRequirements = explicit.capabilityRequirements.length
    ? clone(explicit.capabilityRequirements)
    : clone(base.capabilityRequirements);
  next.confidence = explicit.confidence;
  next.understandingStatus = explicit.understandingStatus;
  return createTaskFrame(next);
}

function taskEntry(frame, legacyIntent, lastResult = null) {
  return {
    taskFrame: createTaskFrame(frame),
    legacyIntent: String(legacyIntent ?? frame.goal),
    updatedAt: null,
    ...(lastResult ? { lastResult: clone(lastResult) } : {})
  };
}

function appendHistory(history, entry) {
  if (!entry) return array(history).map(clone);
  const frameKey = comparable(entry.taskFrame);
  return [
    ...array(history).filter((item) => comparable(item.taskFrame) !== frameKey).map(clone),
    clone(entry)
  ].slice(-MAX_CONVERSATION_TASK_HISTORY);
}

function frameEntityIdentities(frame) {
  return new Set([
    ...array(frame?.subjects),
    ...array(frame?.candidates),
    ...array(frame?.concepts)
  ].map(entityIdentity));
}

function historyMatch(history, explicitFrame) {
  if (!explicitFrameHasMaterial(explicitFrame)) return array(history).at(-1) ?? null;
  const requested = frameEntityIdentities(explicitFrame);
  for (let index = array(history).length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    const candidate = frameEntityIdentities(entry.taskFrame);
    const entityMatch = requested.size === 0 || [...requested].every((identity) => candidate.has(identity));
    const goalMatch = requested.size > 0
      || explicitFrame.goal === "understand_request"
      || explicitFrame.goal === entry.taskFrame.goal;
    if (entityMatch && goalMatch) return entry;
  }
  return null;
}

export function normalizeContextualTurnDelta(state, delta) {
  if (delta?.taskRelation !== "switch" || !delta.explicitTaskFrame) {
    return createTurnDelta(delta);
  }
  if (historyMatch(state?.taskHistory, delta.explicitTaskFrame)) {
    return createTurnDelta({
      ...delta,
      taskRelation: "return"
    });
  }
  const active = state?.activeTask?.taskFrame;
  const explicit = delta.explicitTaskFrame;
  const activeTypes = [...frameEntityIdentities(active)].map((identity) => identity.split(":")[0]).sort();
  const explicitTypes = [...frameEntityIdentities(explicit)].map((identity) => identity.split(":")[0]).sort();
  const sameTaskFamily = Boolean(
    active
    && (
      explicit.goal === active.goal
      || (
        explicit.action === active.action
        && comparable(activeTypes) === comparable(explicitTypes)
      )
    )
  );
  return createTurnDelta(sameTaskFamily ? {
    ...delta,
    taskRelation: "modify",
    dialogueAct: "modify"
  } : delta);
}

function candidateFrameFromPending(pending) {
  const candidate = pending?.candidateTask;
  if (!candidate || typeof candidate !== "object") return null;
  return candidate.taskFrame ? createTaskFrame(candidate.taskFrame) : createTaskFrame(candidate);
}

function taskFrameFieldPresent(frame, field) {
  if (["subjects", "candidates", "concepts"].includes(field)) {
    return array(frame?.[field]).length > 0;
  }
  if (field.startsWith("constraints.")) {
    const key = field.slice("constraints.".length);
    return frame?.constraints?.[key] !== undefined;
  }
  return frame?.[field] !== undefined && frame?.[field] !== null;
}

function completePendingTaskFrame(frame, pending, confidence, trace) {
  const expectedFields = array(pending?.expectedFields);
  if (
    !pending
    || expectedFields.length === 0
    || !expectedFields.every((field) => taskFrameFieldPresent(frame, field))
  ) return frame;
  const ambiguities = array(frame.ambiguities).filter((ambiguity) => {
    const missingFields = array(ambiguity?.missingFields);
    return missingFields.length === 0
      || !missingFields.every((field) => taskFrameFieldPresent(frame, field));
  });
  trace.steps.push("complete_pending_task_fields");
  return createTaskFrame({
    ...frame,
    ambiguities,
    confidence: Math.max(Number(frame.confidence ?? 0), Number(confidence ?? 0)),
    understandingStatus: ambiguities.length
      ? frame.understandingStatus
      : "understood_and_supported"
  });
}

function taskChanged(left, right) {
  return comparable(left) !== comparable(right);
}

function baseResolution(state, delta) {
  return {
    schemaVersion: CONTEXT_REDUCER_VERSION,
    resolvedTaskFrame: null,
    nextState: createConversationState(state),
    decision: "clarify",
    presentation: clone(delta?.presentation ?? null),
    resultReference: null,
    inheritedFields: [],
    changedFields: [],
    warnings: [],
    trace: {
      relation: delta?.taskRelation ?? "unknown",
      dialogueAct: delta?.dialogueAct ?? "unknown",
      steps: []
    }
  };
}

export function reduceConversationState({
  state,
  delta,
  defaults = {},
  domainPolicy = null
} = {}) {
  const normalizedState = createConversationState(state);
  if (
    delta?.schemaVersion === "turn-delta.v1"
    && typeof domainPolicy?.normalizeTurnDelta === "function"
  ) {
    delta = domainPolicy.normalizeTurnDelta(delta);
  }
  if (delta?.schemaVersion === "turn-delta.v1") {
    delta = normalizeContextualTurnDelta(normalizedState, delta);
  }
  const resolution = baseResolution(normalizedState, delta);
  const stateValidation = validateConversationState(normalizedState);
  if (!stateValidation.valid) {
    resolution.decision = "invalid_delta";
    resolution.warnings.push(...stateValidation.errors.map((error) => `invalid_state:${error}`));
    return resolution;
  }
  const deltaValidation = validateTurnDelta(delta, { domainPolicy });
  if (!deltaValidation.valid) {
    resolution.decision = "invalid_delta";
    resolution.warnings.push(...deltaValidation.errors);
    return resolution;
  }
  const requestedReference = delta.presentation?.resultReference;
  if (requestedReference?.scope === "last_result") {
    const resultId = normalizedState.lastResult?.shownIds?.[requestedReference.ordinal - 1] ?? null;
    if (!resultId) {
      resolution.decision = "clarify";
      resolution.nextState.pendingClarification = {
        reason: "result_reference_out_of_range",
        expectedFields: ["resultReference"],
        candidateTask: delta.explicitTaskFrame ? { taskFrame: clone(delta.explicitTaskFrame) } : null,
        askedAt: null
      };
      resolution.warnings.push("result_reference_out_of_range");
      resolution.trace.steps.push("reject_unresolved_result_reference");
      return resolution;
    }
    resolution.resultReference = {
      ...clone(requestedReference),
      resultId: String(resultId)
    };
    resolution.inheritedFields.push("lastResult.shownIds");
    resolution.trace.steps.push("resolve_last_result_reference");
  } else if (requestedReference?.scope === "current_output") {
    resolution.resultReference = {
      ...clone(requestedReference),
      resultId: null
    };
    resolution.trace.steps.push("defer_current_output_reference");
  }
  if (
    delta.taskRelation === "unknown"
    || delta.dialogueAct === "unknown"
    || (
      delta.confidence < 0.5
      && delta.ambiguities.some((entry) => entry?.affectsToolSelection !== false)
    )
  ) {
    resolution.decision = "clarify";
    resolution.nextState.pendingClarification = {
      reason: "turn_relation_uncertain",
      expectedFields: ["taskRelation"],
      candidateTask: delta.explicitTaskFrame ? { taskFrame: clone(delta.explicitTaskFrame) } : null,
      askedAt: null
    };
    resolution.trace.steps.push("reject_uncertain_delta");
    return resolution;
  }
  if (delta.taskRelation === "cancel") {
    const previous = normalizedState.activeTask
      ? taskEntry(
        normalizedState.activeTask.taskFrame,
        normalizedState.activeTask.legacyIntent,
        normalizedState.lastResult
      )
      : null;
    resolution.nextState.taskHistory = appendHistory(normalizedState.taskHistory, previous);
    resolution.nextState.activeTask = null;
    resolution.nextState.lastResult = null;
    resolution.nextState.pendingClarification = null;
    resolution.decision = "cancelled";
    resolution.changedFields.push("activeTask", "lastResult", "pendingClarification");
    resolution.trace.steps.push("cancel_active_task");
    return resolution;
  }

  let baseFrame = null;
  let restoredEntry = null;
  if (delta.taskRelation === "return") {
    restoredEntry = historyMatch(normalizedState.taskHistory, delta.explicitTaskFrame);
    if (!restoredEntry) {
      resolution.decision = "clarify";
      resolution.nextState.pendingClarification = {
        reason: "return_target_not_found",
        expectedFields: ["taskReference"],
        candidateTask: delta.explicitTaskFrame ? { taskFrame: clone(delta.explicitTaskFrame) } : null,
        askedAt: null
      };
      resolution.trace.steps.push("return_target_missing");
      return resolution;
    }
    baseFrame = restoredEntry.taskFrame;
    resolution.inheritedFields.push("taskHistory");
    resolution.trace.steps.push("restore_history_task");
  } else if (["new", "switch"].includes(delta.taskRelation)) {
    baseFrame = delta.explicitTaskFrame;
    resolution.trace.steps.push("start_explicit_task");
  } else {
    baseFrame = candidateFrameFromPending(normalizedState.pendingClarification)
      ?? normalizedState.activeTask?.taskFrame
      ?? null;
    if (baseFrame) {
      resolution.inheritedFields.push(
        normalizedState.pendingClarification ? "pendingClarification.candidateTask" : "activeTask"
      );
    }
    resolution.trace.steps.push("inherit_active_or_pending_task");
  }

  if (!baseFrame) {
    resolution.decision = "clarify";
    resolution.nextState.pendingClarification = {
      reason: "missing_active_task",
      expectedFields: ["task"],
      candidateTask: delta.explicitTaskFrame ? { taskFrame: clone(delta.explicitTaskFrame) } : null,
      askedAt: null
    };
    return resolution;
  }

  let frame = createTaskFrame(baseFrame);
  if (!["new", "switch", "return"].includes(delta.taskRelation) && delta.explicitTaskFrame) {
    frame = mergeExplicitFrame(
      frame,
      delta.explicitTaskFrame,
      resolution.changedFields,
      resolution.inheritedFields
    );
  }
  frame = applyEntityOperations(frame, delta.entityOperations, resolution.changedFields);
  frame = applyConstraintOperations(frame, delta.constraintOperations, resolution.changedFields);
  frame = bindCompositionResultReference(frame, resolution);
  frame = completePendingTaskFrame(
    frame,
    normalizedState.pendingClarification,
    delta.confidence,
    resolution.trace
  );
  const constraints = clone(frame.constraints);
  for (const [key, value] of Object.entries(defaults ?? {})) {
    if (constraints[key] !== undefined) continue;
    constraints[key] = clone(value);
    resolution.inheritedFields.push(`defaults.${key}`);
  }
  frame = createTaskFrame({ ...frame, constraints });
  if (typeof domainPolicy?.normalizeResolvedTaskFrame === "function") {
    frame = createTaskFrame(domainPolicy.normalizeResolvedTaskFrame(frame));
    resolution.trace.steps.push("normalize_domain_task_frame");
  }

  const policyDecision = typeof domainPolicy?.validateResolvedTaskFrame === "function"
    ? domainPolicy.validateResolvedTaskFrame(frame)
    : { decision: frame.action === "unknown" ? "clarify" : "execute", missingFields: [] };
  if (policyDecision.decision !== "execute") {
    resolution.decision = policyDecision.decision;
    resolution.nextState.pendingClarification = policyDecision.decision === "clarify" ? {
      reason: "task_frame_incomplete",
      expectedFields: policyDecision.missingFields ?? [],
      candidateTask: { taskFrame: clone(frame) },
      askedAt: null
    } : null;
    resolution.resolvedTaskFrame = frame;
    resolution.trace.steps.push("domain_policy_rejected");
    return resolution;
  }

  if (
    ["request_more", "next_page"].includes(delta.dialogueAct)
    && normalizedState.lastResult?.exhausted === true
    && delta.taskRelation !== "return"
  ) {
    resolution.resolvedTaskFrame = frame;
    resolution.decision = "exhausted";
    resolution.nextState.pendingClarification = null;
    resolution.inheritedFields.push("lastResult.exhausted");
    resolution.trace.steps.push("preserve_exhausted_task");
    return resolution;
  }

  const previousEntry = normalizedState.activeTask
    ? taskEntry(
      normalizedState.activeTask.taskFrame,
      normalizedState.activeTask.legacyIntent,
      normalizedState.lastResult
    )
    : null;
  let history = normalizedState.taskHistory;
  if (
    previousEntry
    && (
      ["new", "switch", "return"].includes(delta.taskRelation)
      || taskChanged(normalizedState.activeTask.taskFrame, frame)
    )
  ) {
    history = appendHistory(history, previousEntry);
  }
  if (delta.taskRelation === "return" && restoredEntry) {
    history = history.filter((entry) => comparable(entry.taskFrame) !== comparable(restoredEntry.taskFrame));
  }
  resolution.nextState.taskHistory = history;
  resolution.nextState.activeTask = taskEntry(
    frame,
    restoredEntry?.legacyIntent ?? frame.goal
  );
  resolution.nextState.pendingClarification = null;
  if (["new", "switch", "modify", "return"].includes(delta.taskRelation)) {
    resolution.nextState.lastResult = delta.taskRelation === "return"
      ? clone(restoredEntry?.lastResult ?? null)
      : null;
  }
  resolution.resolvedTaskFrame = frame;
  resolution.decision = "execute";
  resolution.changedFields.push("activeTask");
  resolution.trace.steps.push("resolve_executable_task");
  return resolution;
}
