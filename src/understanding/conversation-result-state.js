import {
  createConversationState,
  MAX_CONVERSATION_SHOWN_IDS
} from "./conversation-state.js";

export const CONVERSATION_RESULT_STATE_VERSION = "conversation-result-state.v1";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function uniqueIds(values) {
  return [...new Set(array(values).map((value) => String(value ?? "").trim()).filter(Boolean))]
    .slice(-MAX_CONVERSATION_SHOWN_IDS);
}

function compId(value) {
  return value?.compId ?? value?.source?.clusterId ?? value?.id ?? null;
}

function buildId(value) {
  return value?.raw?.unit_builds
    ?? value?.raw?.unit_build
    ?? (Array.isArray(value?.items) ? value.items.join("|") : null)
    ?? value?.id
    ?? null;
}

function toolNameFromResult(result) {
  return result?.executionPlan?.steps?.[0]?.tool
    ?? result?.executionTrace?.steps?.[0]?.tool
    ?? result?.agentRouting?.plannedTools?.[0]
    ?? result?.retrievalPlan?.structuredQueries?.[0]?.operation
    ?? null;
}

function resultEvidenceValid(result) {
  if (!result || typeof result !== "object") return false;
  if (result.type === "clarification" || result.clarification?.blocking) return false;
  if (result.validation?.valid === false) return false;
  if (result.localDecision) return false;
  if (result.executionTrace?.status && result.executionTrace.status !== "completed") return false;
  if (result.executionTrace?.evidenceStatus === "insufficient") return false;
  if (result.agentStatus?.executionStatus && result.agentStatus.executionStatus !== "completed") return false;
  if (result.agentStatus?.evidenceStatus === "insufficient") return false;
  return typeof result.type === "string" && result.type.length > 0;
}

function compResultMetadata(result) {
  if (result.conversationPage) {
    return {
      shownIds: uniqueIds(result.conversationPage.shownIds),
      returnedCount: Number(result.conversationPage.returnedCount ?? 0),
      totalCount: Number(result.conversationPage.totalCount ?? 0)
    };
  }
  const selected = result.preferenceSearch
    ? Object.values(result.rankings ?? {}).flat()
    : Object.values(result.rankings ?? {}).flat();
  const shownIds = uniqueIds(selected.map(compId));
  const returnedCount = result.preferenceSearch?.returnedCount ?? shownIds.length;
  const lowSampleMatches = Number(result.preferenceSearch?.lowSampleMatches ?? 0);
  const totalCount = result.preferenceSearch
    ? Math.max(0, Number(result.preferenceSearch.conditionMatches ?? returnedCount) - lowSampleMatches)
    : Number.isInteger(result.diagnostics?.acceptedGroups)
      ? result.diagnostics.acceptedGroups
      : shownIds.length;
  return { shownIds, returnedCount, totalCount };
}

function unitResultMetadata(result) {
  if (result.conversationPage) {
    return {
      shownIds: uniqueIds(result.conversationPage.shownIds),
      returnedCount: Number(result.conversationPage.returnedCount ?? 0),
      totalCount: Number(result.conversationPage.totalCount ?? 0)
    };
  }
  const values = result.comparison?.entries?.length
    ? result.comparison.entries
    : result.itemRankings?.length
      ? result.itemRankings
      : result.rankedBuilds;
  const shownIds = uniqueIds(array(values).slice(0, 3).map((value) => (
    value?.apiName ?? value?.itemApiName ?? buildId(value)
  )));
  const totalCount = Array.isArray(values) ? values.length : shownIds.length;
  return { shownIds, returnedCount: shownIds.length, totalCount };
}

function taskFrameWithAppliedQuery(frame, query = {}) {
  const constraints = clone(frame?.constraints ?? {});
  const mappings = {
    rankFilter: "rank",
    days: "days",
    patch: "patch",
    queue: "queue",
    starLevel: "starLevel",
    itemCount: "itemCount",
    minSamples: "minSamples",
    sort: "sort",
    metrics: "metrics",
    limit: "limit",
    itemPolicy: "itemPolicy",
    itemCategories: "itemCategories",
    lockedItems: "lockedItems",
    excludedItems: "excludedItems",
    comparisonItems: "comparisonItems",
    primaryMetric: "primaryMetric",
    performanceItem: "performanceItem"
  };
  for (const [queryKey, constraintKey] of Object.entries(mappings)) {
    if (query[queryKey] !== undefined && query[queryKey] !== null) {
      constraints[constraintKey] = clone(query[queryKey]);
    }
  }
  if (query.preferenceConditions?.strategy != null) {
    constraints.strategy = query.preferenceConditions.strategy;
  } else if (query.specialMode === true) {
    constraints.strategy = "reroll";
  }
  return {
    ...clone(frame),
    constraints
  };
}

function appliedConstraintsFromQuery(query, fallback = {}) {
  if (query?.constraints && typeof query.constraints === "object") {
    return Object.fromEntries(Object.entries(query.constraints).map(([key, entry]) => [
      key,
      clone(entry?.value ?? entry)
    ]));
  }
  if (query && typeof query === "object") {
    return taskFrameWithAppliedQuery({ constraints: {} }, query).constraints;
  }
  return clone(fallback);
}

export function conversationResultStateFromResponse(result, options = {}) {
  if (!resultEvidenceValid(result)) return null;
  const metadata = String(result.type).startsWith("comp_")
    ? compResultMetadata(result)
    : unitResultMetadata(result);
  const totalCount = Number.isInteger(metadata.totalCount) ? metadata.totalCount : null;
  return {
    schemaVersion: CONVERSATION_RESULT_STATE_VERSION,
    resultType: String(result.type),
    toolName: toolNameFromResult(result),
    shownIds: metadata.shownIds,
    returnedCount: metadata.returnedCount,
    totalCount,
    cursor: totalCount == null ? null : {
      offset: metadata.shownIds.length,
      remaining: Math.max(0, totalCount - metadata.shownIds.length)
    },
    exhausted: totalCount !== null
      ? metadata.shownIds.length >= totalCount
      : metadata.returnedCount === 0,
    appliedConstraints: appliedConstraintsFromQuery(
      result.query,
      options.appliedConstraints ?? {}
    ),
    updatedAt: options.updatedAt ?? null
  };
}

export function updateConversationStateFromResult({
  previousState,
  resolution,
  result,
  delta,
  updatedAt = null,
  compatibilityQuery = null
} = {}) {
  const previous = createConversationState(previousState);
  const metadata = conversationResultStateFromResponse(result, { updatedAt });
  if (!metadata) return previous;
  const next = createConversationState(resolution?.nextState ?? previous);
  const accumulatesSeen = ["continue", "return"].includes(delta?.taskRelation)
    && ["request_more", "next_page", "continue"].includes(delta?.dialogueAct);
  const shownIds = uniqueIds([
    ...(accumulatesSeen ? previous.lastResult?.shownIds ?? [] : []),
    ...metadata.shownIds
  ]);
  const lastResult = {
    ...metadata,
    shownIds,
    returnedCount: metadata.returnedCount,
    cursor: metadata.totalCount == null ? metadata.cursor : {
      offset: shownIds.length,
      remaining: Math.max(0, metadata.totalCount - shownIds.length)
    },
    exhausted: metadata.totalCount !== null
      ? shownIds.length >= metadata.totalCount
      : metadata.exhausted
  };
  next.lastResult = lastResult;
  next.activeTask = {
    taskFrame: taskFrameWithAppliedQuery(
      resolution?.resolvedTaskFrame ?? next.activeTask?.taskFrame,
      result.query
    ),
    legacyIntent: String(result.type),
    updatedAt
  };
  next.pendingClarification = null;
  next.updatedAt = updatedAt;
  if (compatibilityQuery) next.query = clone(compatibilityQuery);
  next.lastResultIds = clone(shownIds);
  return createConversationState(next);
}
