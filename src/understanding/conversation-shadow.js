import { conversationResultStateFromResponse } from "./conversation-result-state.js";

export const CONVERSATION_STATE_V2_SHADOW_VERSION = "conversation-state-v2-shadow.v1";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function same(left, right) {
  if (left == null || right == null) return null;
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

export function compareConversationStateV2Shadow({
  delta,
  resolution,
  executionPlan,
  legacyResult
} = {}) {
  const legacyTool = legacyResult?.executionPlan?.steps?.[0]?.tool
    ?? legacyResult?.retrievalPlan?.structuredQueries?.[0]?.operation
    ?? null;
  const newTool = executionPlan?.steps?.[0]?.tool ?? null;
  const legacyParameters = legacyResult?.executionPlan?.steps?.[0]?.arguments
    ?? legacyResult?.retrievalPlan?.structuredQueries?.[0]?.params
    ?? null;
  const newParameters = executionPlan?.steps?.[0]?.arguments ?? null;
  const legacyResultState = conversationResultStateFromResponse(legacyResult);
  const newClarification = resolution?.decision === "clarify";
  const legacyClarification = legacyResult?.type === "clarification"
    || legacyResult?.clarification?.blocking === true;
  const toolEquivalent = same(newTool, legacyTool);
  const parametersEquivalent = same(newParameters, legacyParameters);
  const projectedResultState = (
    resolution?.decision === "execute"
    && toolEquivalent !== false
    && parametersEquivalent !== false
  ) ? legacyResultState : null;
  const differences = [];
  if (delta?.taskRelation === "unknown") differences.push("task_relation_difference");
  if (
    resolution?.resolvedTaskFrame?.goal
    && legacyResult?.query?.intent
    && resolution.resolvedTaskFrame.goal !== legacyResult.query.intent
  ) differences.push("active_task_difference");
  if (newClarification !== legacyClarification) differences.push("clarification_difference");
  if (toolEquivalent === false) differences.push("tool_difference");
  if (parametersEquivalent === false) differences.push("parameter_difference");
  if (
    legacyResultState === null
    && legacyResult?.type !== "clarification"
  ) {
    differences.push("result_state_difference");
  } else if (
    legacyResultState
    && projectedResultState === null
  ) {
    differences.push("result_state_unavailable");
  }
  const newExhausted = resolution?.decision === "exhausted"
    || projectedResultState?.exhausted === true;
  const legacyExhausted = legacyResultState?.exhausted ?? false;
  if (newExhausted !== legacyExhausted) differences.push("exhaustion_difference");
  return {
    schemaVersion: CONVERSATION_STATE_V2_SHADOW_VERSION,
    taskRelation: delta?.taskRelation ?? null,
    dialogueAct: delta?.dialogueAct ?? null,
    activeTask: resolution?.resolvedTaskFrame ? {
      action: resolution.resolvedTaskFrame.action,
      goal: resolution.resolvedTaskFrame.goal
    } : null,
    clarification: {
      legacy: legacyClarification,
      next: newClarification,
      equivalent: newClarification === legacyClarification
    },
    tool: {
      legacy: legacyTool,
      next: newTool,
      equivalent: toolEquivalent
    },
    completeParameters: {
      legacy: legacyParameters,
      next: newParameters,
      equivalent: parametersEquivalent
    },
    resultState: {
      legacy: legacyResultState,
      next: projectedResultState,
      equivalent: same(projectedResultState, legacyResultState)
    },
    exhausted: {
      legacy: legacyExhausted,
      next: newExhausted,
      equivalent: newExhausted === legacyExhausted
    },
    differences
  };
}
