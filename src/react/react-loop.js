import { randomUUID } from "node:crypto";
import { validateToolEvidence } from "../agent/tool-evidence-validator.js";
import { validateToolInput } from "../agent/tools/contracts.js";
import { parseCompTrendDirection } from "../core/comp-trend-intent.js";
import { itemDetailsBatchMatchesPlan } from "../domain/tft/differentiating-item-selector.js";
import { isItemCarrierRequest } from "../domain/tft/intent-patterns.js";
import { validateReactAction } from "./react-action.js";
import { DuplicateCallGuard } from "./duplicate-call-guard.js";
import { EvidenceLedger } from "./evidence-ledger.js";
import { validateFinishAction, validateGroundedBuildNarrative } from "./termination-policy.js";
import { ReactWorkingState } from "./working-state.js";

export const REACT_STREAM_EVENT_SCHEMA_VERSION = "react-stream-event.v1";

export const DEFAULT_REACT_LOOP_BUDGET = Object.freeze({
  deadlineMs: 30_000,
  maxDecisions: 24,
  maxToolCalls: null,
  maxRetriesPerTool: 1,
  maxConsecutiveNoProgress: 3
});

export function normalizeGroundingMode(value) {
  return String(value ?? "strict").trim().toLowerCase() === "observe"
    ? "observe"
    : "strict";
}

const SUMMARY_REQUEST_SIGNAL = /(?:总结|概括|摘要|归纳|梳理|(?:版本|补丁).{0,8}(?:更新|改动)|summari[sz]e|summary|recap|patch\s*notes?)/iu;
const SOFT_SUMMARY_VALIDATION_ERROR = /(?:answer statistic is not present in cited evidence|semantic knowledge evidence cannot support a current statistical or best-ranking claim|historical quick-tool evidence cannot support a current statistical or best-ranking claim)/iu;

function canPublishSummaryWithValidationWarnings(request, action, validation, ledger) {
  if (action?.reasonCode !== "sufficient_evidence" || !action.evidenceIds?.length) return false;
  const userText = [
    request?.input,
    request?.question,
    ...(Array.isArray(request?.messages) ? request.messages.map((message) => message?.content) : [])
  ].map((value) => String(value ?? "")).join("\n");
  if (!SUMMARY_REQUEST_SIGNAL.test(userText)) return false;
  const entries = ledger.resolve(action.evidenceIds);
  if (entries.length !== action.evidenceIds.length || entries.length === 0) return false;
  return validation.errors.length > 0
    && validation.errors.every((error) => SOFT_SUMMARY_VALIDATION_ERROR.test(String(error)));
}

function currentTurnUserText(request = {}) {
  return [request.input, request.question]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function applyRequestBoundVideoScope(action, request = {}) {
  if (action?.type !== "call_tool" || action.tool !== "strategy_video_search") return action;
  const userText = currentTurnUserText(request);
  const requestsTft = /(?:云顶之弈|teamfight\s*tactics|\btft\b)/iu.test(userText);
  const requestsGoldenSpatula = /(?:金铲铲(?:之战)?|golden\s*spatula)/iu.test(userText);
  if (!requestsTft || !requestsGoldenSpatula) return action;
  return {
    ...action,
    arguments: { ...(action.arguments ?? {}), ecosystem: "both" }
  };
}

function applyRequestBoundTrendDirection(action, request = {}) {
  if (action?.type !== "call_tool" || action.tool !== "comps_trends") return action;
  const direction = parseCompTrendDirection(currentTurnUserText(request));
  const argumentsValue = { ...(action.arguments ?? {}) };
  if (direction) argumentsValue.direction = direction;
  else delete argumentsValue.direction;
  return { ...action, arguments: argumentsValue };
}

function deterministicStrategyVideoFallback(request, availableToolNames, ledger) {
  if (!availableToolNames.has("strategy_video_search")) return null;
  if (ledger.snapshot().entries.some((entry) => entry.temporalStatus !== "historical")) return null;
  const userText = currentTurnUserText(request);
  if (!/(?:\u89c6\u9891|\u653b\u7565|bilibili|\u54d4\u54e9\u54d4\u54e9|b\u7ad9)/iu.test(userText)) return null;
  const requestsTft = /(?:\u4e91\u9876\u4e4b\u5f08|teamfight\s*tactics|\btft\b)/iu.test(userText);
  const requestsGoldenSpatula = /(?:\u91d1\u94f2\u94f2(?:\u4e4b\u6218)?|golden\s*spatula)/iu.test(userText);
  const ecosystem = requestsTft && requestsGoldenSpatula
    ? "both"
    : requestsGoldenSpatula
      ? "golden_spatula"
      : requestsTft
        ? "tft_pc"
        : undefined;
  return {
    schemaVersion: "react-action.v1",
    type: "call_tool",
    tool: "strategy_video_search",
    arguments: { query: userText, ...(ecosystem ? { ecosystem } : {}) },
    purposeCode: "retrieve_supporting_knowledge"
  };
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min ? Math.min(number, max) : fallback;
}

export function normalizeReactLoopBudget(value = {}) {
  return Object.freeze({
    deadlineMs: boundedInteger(value.deadlineMs, DEFAULT_REACT_LOOP_BUDGET.deadlineMs, 1, 120_000),
    maxDecisions: boundedInteger(value.maxDecisions, DEFAULT_REACT_LOOP_BUDGET.maxDecisions, 1, 50),
    // Tool calls are an observability metric, not a completion budget. Keep the
    // field for backwards-compatible runtime snapshots, but never cap it here.
    maxToolCalls: null,
    maxRetriesPerTool: boundedInteger(value.maxRetriesPerTool, DEFAULT_REACT_LOOP_BUDGET.maxRetriesPerTool, 0, 5),
    maxConsecutiveNoProgress: boundedInteger(
      value.maxConsecutiveNoProgress,
      DEFAULT_REACT_LOOP_BUDGET.maxConsecutiveNoProgress,
      1,
      10
    )
  });
}

function publicToolCatalog(registry, availableToolNames) {
  return registry.list().filter((definition) => availableToolNames.has(definition.name)).map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: structuredClone(definition.inputSchema),
    argumentPolicy: {
      allowedKeys: Object.keys(definition.inputSchema?.properties ?? {}),
      serverScopedKeys: definition.name === "unit_builds_batch"
        ? ["seasonContextId", "patch", "scopeKey"]
        : []
    },
    source: definition.source,
    evidenceType: definition.evidenceType,
    readOnly: definition.readOnly,
    sideEffect: definition.sideEffect,
    requiresApproval: definition.requiresApproval
  }));
}

function safeError(error) {
  return {
    code: String(error?.code ?? error?.name ?? "tool_failed"),
    recoverable: Boolean(error?.recoverable),
    message: String(error?.message ?? "Tool execution failed").slice(0, 300)
  };
}

function decisionEventData(action, state, budget) {
  return {
    type: action.type,
    tool: action.type === "call_tool" ? action.tool : null,
    purposeCode: action.type === "call_tool" ? action.purposeCode : null,
    iteration: state.decisions.length,
    remainingBudget: {
      decisions: Math.max(0, budget.maxDecisions - state.decisions.length),
      toolCalls: null
    }
  };
}

function validateItemDetailsBatchAction(action, ledger, request) {
  if (action.tool !== "item_details_batch") return { valid: true, errors: [] };
  const currentEntries = ledger.snapshot().entries.filter((entry) => (
    entry.temporalStatus !== "historical"
  ));
  const contentionEntry = currentEntries.find((entry) => (
    entry.toolName === "unit_builds_batch"
    && entry.value?.itemContentionPlan?.status === "available"
    && entry.value.itemContentionPlan.apiNames?.length
  ));
  const buildEntry = currentEntries.find((entry) => (
    entry.toolName === "unit_builds_batch"
    && (entry.value?.results ?? []).some((result) => result.mechanismQueryPlan?.apiNames?.length)
  ));
  const plan = contentionEntry?.value?.itemContentionPlan
    ?? buildEntry?.value?.results?.find((result) => (
      result.mechanismQueryPlan?.apiNames?.length
    ))?.mechanismQueryPlan;
  const errors = [];
  if (!plan) errors.push("item_details_batch requires a deterministic item-selection plan");
  else if (!itemDetailsBatchMatchesPlan(action.arguments?.apiNames, plan)) {
    errors.push("item_details_batch apiNames must exactly match the deterministic item-selection plan");
  }
  if (String(action.arguments?.seasonContextId ?? "") !== String(request.seasonContextId ?? "")) {
    errors.push("item_details_batch seasonContextId must match the current request");
  }
  return { valid: errors.length === 0, errors };
}

function compositionItemContentionRequest(request = {}) {
  const text = String(request.input ?? request.question ?? "");
  return /(?:(?:阵容|成员|棋子).{0,24}(?:装备|散件).{0,16}(?:竞争|冲突|抢|共用)|(?:装备|散件).{0,24}(?:竞争|冲突|抢|共用).{0,16}(?:阵容|成员|棋子)|composition.{0,24}(?:item|equipment).{0,16}(?:contention|conflict|compete))/iu
    .test(text);
}

function validateCompositionItemContentionBuildAction(action, ledger, request) {
  if (action.tool !== "unit_builds_batch") return { valid: true, errors: [] };
  const requested = compositionItemContentionRequest(request);
  const compositionId = String(action.arguments?.compositionId ?? "");
  if (!requested && !compositionId) return { valid: true, errors: [] };
  const entries = ledger.snapshot().entries.filter((entry) => entry.temporalStatus !== "historical");
  const compositionEntry = entries.find((entry) => (
    entry.toolName === "comps_rankings"
    && entry.value?.resolution?.status === "resolved"
    && (entry.value?.results ?? []).some((result) => (
      String(result.compositionRef?.compId ?? "") === compositionId
    ))
  ));
  const composition = compositionEntry?.value?.results?.find((result) => (
    String(result.compositionRef?.compId ?? "") === compositionId
  ));
  const plan = composition?.itemContentionQueryPlan ?? null;
  const actualApiNames = (action.arguments?.entities ?? []).map((entity) => String(entity?.apiName ?? ""));
  const expectedApiNames = (plan?.apiNames ?? []).map(String);
  const errors = [];
  if (!compositionId) errors.push("composition item contention requires compositionId");
  if (!compositionEntry) errors.push("compositionId must reference prior resolved current comps_rankings evidence");
  if (plan?.status !== "ready") errors.push("composition does not have a ready deterministic item-contention candidate plan");
  if (
    actualApiNames.length !== expectedApiNames.length
    || actualApiNames.some((apiName, index) => apiName !== expectedApiNames[index])
  ) {
    errors.push("unit_builds_batch entities must exactly match itemContentionQueryPlan apiNames in order");
  }
  if (Number(action.arguments?.optionsPerUnit) !== Number(plan?.optionsPerUnit)) {
    errors.push("unit_builds_batch optionsPerUnit must match itemContentionQueryPlan");
  }
  return { valid: errors.length === 0, errors };
}

function unitBuildBatchConstraintItems(action) {
  const constraints = action.arguments?.constraints ?? {};
  const unique = (values) => [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
  return {
    lockedItems: unique(constraints.lockedItems),
    excludedItems: unique(constraints.excludedItems)
  };
}

function unitBuildBatchNextActionAffordance(action, toolResult, addition, ledger) {
  if (action.tool !== "unit_builds_batch") return null;
  const value = toolResult?.value ?? {};
  const constraints = value.query?.constraints
    ?? value.constraints
    ?? action.arguments?.constraints
    ?? {};
  const lockedItems = [...new Set((Array.isArray(constraints.lockedItems) ? constraints.lockedItems : [])
    .map(String).filter(Boolean))];
  const excludedItems = [...new Set((Array.isArray(constraints.excludedItems) ? constraints.excludedItems : [])
    .map(String).filter(Boolean))];
  if (!lockedItems.length && !excludedItems.length) return null;

  const results = Array.isArray(value.results) ? value.results : [];
  const returnedOptionCount = results.reduce((total, result) => (
    total + (Array.isArray(result?.buildOptions) ? result.buildOptions.length : 0)
  ), 0);
  const successfulAudits = results
    .filter((result) => result?.available !== false)
    .map((result) => result?.constraintAudit)
    .filter(Boolean);
  const constraintApplied = successfulAudits.length > 0 && successfulAudits.every((audit) => (
    audit.applicationMode === "deterministic_source_row_filter_before_ranking"
    || audit.appliedBeforeRanking === true
  ));
  const evidenceIds = ledger.snapshot().entries
    .filter((entry) => entry.temporalStatus !== "historical" && entry.toolName === "unit_builds_batch")
    .map((entry) => entry.evidenceId);
  if (addition?.entry?.evidenceId && !evidenceIds.includes(addition.entry.evidenceId)) {
    evidenceIds.push(addition.entry.evidenceId);
  }

  return {
    schemaVersion: "react-next-action-affordance.v1",
    resultStatus: addition?.added && constraintApplied
      ? returnedOptionCount > 0 ? "sufficient" : "constrained_empty"
      : "invalid_or_unverified",
    constraintApplied,
    returnedOptionCount,
    constraints: { lockedItems, excludedItems },
    recommendedAction: "finish",
    finish: {
      reasonCode: returnedOptionCount > 0 ? "sufficient_evidence" : "insufficient_evidence",
      requiredEvidenceIds: evidenceIds
    },
    mechanismLookup: {
      required: false,
      allowedItemApiNames: []
    }
  };
}

function compositionTacticalNextActionAffordance(action, toolResult, request) {
  if (action.tool !== "comps_rankings") return null;
  if (!/(?:站位|棋盘|海克斯|强化符文|position|positioning|augment)/iu.test(
    String(request.input ?? request.question ?? "")
  )) return null;
  const value = toolResult?.value ?? {};
  if (value.resolution?.status !== "resolved") return null;
  const plan = value.results?.[0]?.tacticalDetailQueryPlan;
  if (plan?.status !== "ready") return null;
  return {
    schemaVersion: "react-next-action-affordance.v1",
    resultStatus: "composition_resolved",
    recommendedAction: "call_tool",
    callTool: {
      tool: "composition_tactical_details",
      purposeCode: "retrieve_current_statistics",
      arguments: {
        compositionId: plan.compositionId,
        clusterId: plan.clusterId,
        units: [...(plan.units ?? [])],
        seasonContextId: plan.seasonContextId
      }
    }
  };
}

function compositionTrendNextActionAffordance(action, toolResult, addition) {
  if (action.tool !== "comps_trends" || !addition?.added || !addition.entry?.evidenceId) return null;
  const value = toolResult?.value ?? {};
  const requestedDirection = value.requestedDirection ?? value.query?.trendDirection ?? null;
  const risingCount = Array.isArray(value.rising) ? value.rising.length : 0;
  const fallingCount = Array.isArray(value.falling) ? value.falling.length : 0;
  const popularityCount = Array.isArray(value.rankings?.popularity)
    ? value.rankings.popularity.length
    : 0;
  const requestedSectionCount = requestedDirection === "rising"
    ? risingCount
    : requestedDirection === "falling"
      ? fallingCount
      : risingCount + fallingCount + popularityCount;
  if (requestedSectionCount === 0) return null;
  return {
    schemaVersion: "react-next-action-affordance.v1",
    resultStatus: requestedDirection
      ? "requested_trend_available"
      : risingCount && fallingCount && popularityCount
        ? "trend_overview_complete"
        : "trend_overview_partial",
    requestedDirection,
    sectionAvailability: {
      rising: { status: risingCount ? "available" : "empty", count: risingCount },
      falling: { status: fallingCount ? "available" : "empty", count: fallingCount },
      popularity: { status: popularityCount ? "available" : "empty", count: popularityCount }
    },
    recommendedAction: "finish",
    finish: {
      reasonCode: "sufficient_evidence",
      requiredEvidenceIds: [addition.entry.evidenceId]
    }
  };
}

function resolvedCatalogItem(entries, apiName) {
  return entries.some((entry) => (
    entry.toolName === "entity_catalog_query"
    && entry.value?.entityType === "item"
    && (entry.value?.resolution?.requests ?? []).some((resolution) => (
      resolution.status === "resolved"
      && resolution.candidates?.length === 1
      && String(resolution.candidates[0]?.apiName ?? "") === apiName
    ))
  ));
}

function resolvedCatalogEntity(entries, entityType, apiName) {
  return entries.some((entry) => (
    entry.toolName === "entity_catalog_query"
    && entry.value?.entityType === entityType
    && (entry.value?.resolution?.requests ?? []).some((resolution) => (
      resolution.status === "resolved"
      && resolution.candidates?.length === 1
      && String(resolution.candidates[0]?.apiName ?? "") === apiName
    ))
  ));
}

function validateUnitBuildsAction(action, ledger, request = {}) {
  if (action.tool !== "unit_builds") return { valid: true, errors: [] };
  const question = String(request.input ?? request.question ?? "");
  if (!/(?:\u88c5\u5907|\u51fa\u88c5|\u5355\u4ef6|\u795e\u5668|\u5149\u660e|\u7f8a\u5200|\u65e0\u5c3d|\u54ea\u4e2a\u597d|\u6bd4\u8f83|\bbuild\b|\bitem\b|equipment)/iu.test(question)) {
    return { valid: true, errors: [] };
  }
  const entries = ledger.snapshot().entries.filter((entry) => entry.temporalStatus !== "historical");
  const unitApiName = String(action.arguments?.unit ?? "");
  const itemApiNames = [...new Set([
    ...(action.arguments?.lockedItems ?? []),
    ...(action.arguments?.excludedItems ?? []),
    ...(action.arguments?.comparisonItems ?? []),
    action.arguments?.performanceItem
  ].map((value) => String(value ?? "").trim()).filter(Boolean))];
  const errors = [];
  if (!resolvedCatalogEntity(entries, "unit", unitApiName)) {
    errors.push("unit_builds unit requires prior exact unit entity_catalog_query resolution");
  }
  for (const apiName of itemApiNames) {
    if (!resolvedCatalogItem(entries, apiName)) {
      errors.push(`unit_builds item requires prior exact item entity_catalog_query resolution: ${apiName}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function validateItemCarrierAction(action, ledger) {
  if (action.tool !== "item_carrier_rankings") return { valid: true, errors: [] };
  const apiName = String(action.arguments?.item ?? "");
  const entries = ledger.snapshot().entries.filter((entry) => entry.temporalStatus !== "historical");
  const errors = [];
  if (!resolvedCatalogItem(entries, apiName)) {
    errors.push("item_carrier_rankings item requires prior exact item entity_catalog_query resolution");
  }
  return { valid: errors.length === 0, errors };
}

function itemCarrierNextActionAffordance(action, toolResult, addition, ledger) {
  if (action.tool !== "item_carrier_rankings" || !addition?.added) return null;
  const value = toolResult?.value ?? {};
  const apiName = String(value.item?.apiName ?? value.item ?? value.query?.item ?? "").trim();
  if (!apiName) return null;
  const entries = ledger.snapshot().entries.filter((entry) => entry.temporalStatus !== "historical");
  const hasDetails = entries.some((entry) => (
    entry.toolName === "item_details"
    && String(entry.value?.apiName ?? "") === apiName
    && ["found", "partial"].includes(entry.value?.status)
  ));
  if (hasDetails) return null;
  return {
    schemaVersion: "react-next-action-affordance.v1",
    resultStatus: "carrier_ranking_available",
    recommendedAction: "call_tool",
    callTool: {
      tool: "item_details",
      purposeCode: "retrieve_entity_details",
      arguments: { apiName }
    }
  };
}

function requestsComparisonItemDetails(request = {}) {
  const text = String(request.input ?? request.question ?? "");
  return /(?:详情|说明|效果|属性|details?|effects?)/iu.test(text);
}

function comparisonItemApiNames(entry) {
  return [...new Set((
    entry?.value?.comparison?.entries
    ?? entry?.value?.comparison?.rankedEntries
    ?? []
  ).map((item) => String(item?.apiName ?? "").trim()).filter(Boolean))];
}

function comparisonItemDetailsNextActionAffordance(action, _toolResult, addition, ledger, request) {
  if (!addition?.added || !requestsComparisonItemDetails(request)) return null;
  if (!["unit_builds", "item_details"].includes(action.tool)) return null;
  const entries = ledger.snapshot().entries.filter((entry) => entry.temporalStatus !== "historical");
  const comparisonEntry = [...entries].reverse().find((entry) => (
    entry.toolName === "unit_builds"
    && entry.value?.type === "unit_item_comparison"
  ));
  const apiNames = comparisonItemApiNames(comparisonEntry);
  if (!apiNames.length) return null;
  const detailed = new Set(entries.filter((entry) => (
    entry.toolName === "item_details"
    && ["found", "partial"].includes(entry.value?.status)
  )).map((entry) => String(entry.value?.apiName ?? "")));
  const apiName = apiNames.find((candidate) => !detailed.has(candidate));
  if (!apiName) return null;
  return {
    schemaVersion: "react-next-action-affordance.v1",
    resultStatus: "item_comparison_details_incomplete",
    recommendedAction: "call_tool",
    callTool: {
      tool: "item_details",
      purposeCode: "retrieve_entity_details",
      arguments: { apiName }
    }
  };
}

function validateItemCarrierWorkflowFinish(request, action, ledger) {
  if (!isItemCarrierRequest(request.input ?? request.question ?? "")) {
    return { valid: true, errors: [] };
  }
  if (action.reasonCode === "insufficient_evidence") {
    return { valid: true, errors: [] };
  }
  const cited = ledger.resolve(action.evidenceIds ?? []);
  const carrierEntries = cited.filter((entry) => entry.toolName === "item_carrier_rankings");
  const detailEntries = cited.filter((entry) => entry.toolName === "item_details");
  const carrierItems = new Set(carrierEntries.map((entry) => String(
    entry.value?.item?.apiName ?? entry.value?.item ?? entry.value?.query?.item ?? ""
  )).filter(Boolean));
  const matchingDetails = detailEntries.some((entry) => carrierItems.has(String(entry.value?.apiName ?? "")));
  const errors = [];
  if (!carrierEntries.length) errors.push("item carrier request requires cited item_carrier_rankings evidence");
  if (!matchingDetails) errors.push("item carrier request requires cited matching item_details evidence");
  return { valid: errors.length === 0, errors };
}

function validateComparisonItemDetailsFinish(request, action, ledger) {
  if (!requestsComparisonItemDetails(request) || action.reasonCode === "insufficient_evidence") {
    return { valid: true, errors: [] };
  }
  const currentEntries = ledger.snapshot().entries.filter((entry) => entry.temporalStatus !== "historical");
  const hasComparisonWorkflow = currentEntries.some((entry) => (
    entry.toolName === "unit_builds"
    && entry.value?.type === "unit_item_comparison"
  ));
  if (!hasComparisonWorkflow) return { valid: true, errors: [] };

  const cited = ledger.resolve(action.evidenceIds ?? []);
  const comparisonEntry = cited.find((entry) => (
    entry.toolName === "unit_builds"
    && entry.value?.type === "unit_item_comparison"
  ));
  if (!comparisonEntry) {
    return { valid: false, errors: ["item comparison details request requires cited unit_builds comparison evidence"] };
  }
  const apiNames = comparisonItemApiNames(comparisonEntry);
  const detailApiNames = new Set(cited.filter((entry) => (
    entry.toolName === "item_details"
    && ["found", "partial"].includes(entry.value?.status)
  )).map((entry) => String(entry.value?.apiName ?? "")));
  const missing = apiNames.filter((apiName) => !detailApiNames.has(apiName));
  return missing.length
    ? { valid: false, errors: [`item comparison details request is missing cited item_details evidence: ${missing.join(", ")}`] }
    : { valid: true, errors: [] };
}

function knownItemApiNames(entries) {
  const known = new Set();
  const add = (value) => {
    const apiName = String(value ?? "").trim();
    if (apiName) known.add(apiName);
  };
  for (const entry of entries) {
    if (entry.toolName === "entity_catalog_query" && entry.value?.entityType === "item") {
      for (const request of entry.value?.resolution?.requests ?? []) {
        if (request?.status !== "resolved") continue;
        for (const candidate of request.candidates ?? []) add(candidate?.apiName);
      }
      for (const result of entry.value?.results ?? []) add(result?.apiName);
    }
    if (entry.toolName === "item_details") add(entry.value?.apiName);
    if (entry.toolName === "item_details_batch") {
      for (const item of entry.value?.items ?? []) add(item?.apiName);
    }
    if (entry.toolName === "unit_builds_batch") {
      for (const result of entry.value?.results ?? []) {
        for (const option of result?.buildOptions ?? []) {
          for (const item of option?.items ?? []) add(typeof item === "string" ? item : item?.apiName);
        }
      }
      for (const item of entry.value?.itemContentionPlan?.contestedItems ?? []) {
        add(item?.itemRef?.apiName);
      }
    }
    if (entry.toolName === "comps_rankings") {
      for (const result of entry.value?.results ?? []) {
        for (const member of result?.members ?? []) {
          for (const item of member?.itemizationEvidence?.items ?? []) add(item);
        }
      }
    }
  }
  return known;
}

function sameUnitBuildBatchScope(entry, action) {
  const expectedEntities = (action.arguments?.entities ?? []).map((entity) => String(entity?.apiName ?? ""));
  const priorEntities = (entry.value?.query?.entities ?? entry.value?.results ?? [])
    .map((entity) => String(entity?.apiName ?? entity?.unit?.apiName ?? ""));
  if (
    expectedEntities.length !== priorEntities.length
    || expectedEntities.some((apiName, index) => apiName !== priorEntities[index])
  ) return false;
  const expectedCompositionId = String(action.arguments?.compositionId ?? "");
  const priorCompositionId = String(entry.value?.query?.compositionId ?? "");
  return !expectedCompositionId || expectedCompositionId === priorCompositionId;
}

function explicitUnitBuildConstraintRequest(request = {}) {
  return /(?:固定|锁定|保留|排除|不考虑|不要|去掉|移除|分配给|给.{0,12}(?:之后|以后|后)|\b(?:lock|locked|exclude|excluded|without|remove|assign|fixed)\b)/iu
    .test(String(request.input ?? request.question ?? ""));
}

function validateUnitBuildBatchConstraintAction(action, ledger, request) {
  if (action.tool !== "unit_builds_batch") return { valid: true, errors: [] };
  const constraints = unitBuildBatchConstraintItems(action);
  const constrainedItems = [...new Set([...constraints.lockedItems, ...constraints.excludedItems])];
  if (!constrainedItems.length) return { valid: true, errors: [] };
  const entries = ledger.snapshot().entries;
  const errors = [];
  const overlap = constraints.lockedItems.filter((apiName) => constraints.excludedItems.includes(apiName));
  if (overlap.length) {
    errors.push("unit_builds_batch constraints cannot lock and exclude the same item");
  }
  const explicitConstraintIntent = explicitUnitBuildConstraintRequest(request);
  if (!explicitConstraintIntent) {
    errors.push("unit_builds_batch constraints require an explicit user lock or exclusion instruction");
  }
  const knownItems = knownItemApiNames(entries);
  const ungrounded = constrainedItems.filter((apiName) => !knownItems.has(apiName));
  if (ungrounded.length) {
    errors.push("unit_builds_batch constraint items require prior resolved item or build evidence");
  }
  const baseline = entries.findLast((entry) => {
    if (entry.toolName !== "unit_builds_batch" || !sameUnitBuildBatchScope(entry, action)) return false;
    const priorConstraints = entry.value?.query?.constraints ?? entry.value?.constraints ?? {};
    return !(priorConstraints.lockedItems?.length || priorConstraints.excludedItems?.length);
  });
  if (!baseline) {
    errors.push("constrained unit_builds_batch requires prior unconstrained evidence for the same unit scope");
  }
  return { valid: errors.length === 0, errors };
}

function validateCompositionReplacementAction(action, ledger, request) {
  if (![
    "composition_change_evaluation",
    "composition_replacement_evaluation"
  ].includes(action.tool)) {
    return { valid: true, errors: [] };
  }
  const legacyReplacement = action.tool === "composition_replacement_evaluation";
  const operation = legacyReplacement ? "replace" : String(action.arguments?.operation ?? "");
  const snapshot = ledger.snapshot().entries.filter((entry) => entry.temporalStatus !== "historical");
  const compositionId = String(action.arguments?.compositionId ?? "");
  const targetApiName = String(action.arguments?.targetApiName ?? "");
  const incomingApiName = String(
    legacyReplacement
      ? action.arguments?.replacementApiName
      : action.arguments?.incomingApiName
    ?? ""
  );
  const targetRequired = operation === "remove" || operation === "replace";
  const incomingRequired = operation === "add" || operation === "replace";
  const compositionEntry = snapshot.find((entry) => (
    entry.toolName === "comps_rankings"
    && entry.value?.resolution?.status === "resolved"
    && (entry.value?.results ?? []).some((result) => (
      String(result.compositionRef?.compId ?? "") === compositionId
    ))
  ));
  const composition = compositionEntry?.value?.results?.find((result) => (
    String(result.compositionRef?.compId ?? "") === compositionId
  ));
  const catalogResolved = (apiName) => snapshot.some((entry) => (
    entry.toolName === "entity_catalog_query"
    && entry.value?.entityType === "unit"
    && (entry.value?.resolution?.requests ?? []).some((resolution) => (
      resolution.status === "resolved"
      && resolution.candidates?.length === 1
      && String(resolution.candidates[0]?.apiName ?? "") === apiName
    ))
  ));
  const detailResolved = (apiName) => snapshot.some((entry) => (
    entry.toolName === "unit_details"
    && entry.value?.status === "found"
    && String(entry.value?.apiName ?? "") === apiName
  ));
  const errors = [];
  if (!["add", "remove", "replace"].includes(operation)) {
    errors.push("composition change operation must be add, remove, or replace");
  }
  if (targetRequired && !targetApiName) {
    errors.push(`${operation} composition change requires targetApiName`);
  }
  if (incomingRequired && !incomingApiName) {
    errors.push(`${operation} composition change requires incomingApiName`);
  }
  if (!legacyReplacement && operation === "add" && targetApiName) {
    errors.push("add composition change must not include targetApiName");
  }
  if (!legacyReplacement && operation === "remove" && incomingApiName) {
    errors.push("remove composition change must not include incomingApiName");
  }
  if (!compositionEntry) {
    errors.push("compositionId must reference prior resolved current comps_rankings evidence");
  }
  if (targetRequired && targetApiName && !catalogResolved(targetApiName)) {
    errors.push("targetApiName requires prior resolved unit entity_catalog_query evidence");
  }
  if (incomingRequired && incomingApiName && !catalogResolved(incomingApiName)) {
    errors.push("incomingApiName requires prior resolved unit entity_catalog_query evidence");
  }
  if (targetRequired && targetApiName && !detailResolved(targetApiName)) {
    errors.push("targetApiName requires prior current unit_details evidence");
  }
  if (incomingRequired && incomingApiName && !detailResolved(incomingApiName)) {
    errors.push("incomingApiName requires prior current unit_details evidence");
  }
  if (String(action.arguments?.seasonContextId ?? "") !== String(request.seasonContextId ?? "")) {
    errors.push("composition change seasonContextId must match the current request");
  }
  return { valid: errors.length === 0, errors };
}

function validateCompositionTacticalDetailsAction(action, ledger, request) {
  if (action.tool !== "composition_tactical_details") return { valid: true, errors: [] };
  const entries = ledger.snapshot().entries.filter((entry) => entry.temporalStatus !== "historical");
  const compositionId = String(action.arguments?.compositionId ?? "");
  const composition = entries
    .filter((entry) => entry.toolName === "comps_rankings" && entry.value?.resolution?.status === "resolved")
    .flatMap((entry) => entry.value?.results ?? [])
    .find((result) => String(result.tacticalDetailQueryPlan?.compositionId ?? "") === compositionId);
  const plan = composition?.tacticalDetailQueryPlan ?? null;
  const actualUnits = (action.arguments?.units ?? []).map(String);
  const expectedUnits = (plan?.units ?? []).map(String);
  const errors = [];
  if (!composition) errors.push("compositionId must reference prior resolved current comps_rankings evidence");
  if (plan?.status !== "ready") errors.push("composition does not have a ready tacticalDetailQueryPlan");
  if (String(action.arguments?.clusterId ?? "") !== String(plan?.clusterId ?? "")) {
    errors.push("clusterId must exactly match tacticalDetailQueryPlan");
  }
  if (
    actualUnits.length !== expectedUnits.length
    || actualUnits.some((apiName, index) => apiName !== expectedUnits[index])
  ) {
    errors.push("units must exactly match tacticalDetailQueryPlan in order");
  }
  if (
    String(action.arguments?.seasonContextId ?? "") !== String(plan?.seasonContextId ?? "")
    || String(action.arguments?.seasonContextId ?? "") !== String(request.seasonContextId ?? "")
  ) {
    errors.push("seasonContextId must match the current request and tacticalDetailQueryPlan");
  }
  return { valid: errors.length === 0, errors };
}

function displayNameForBuildResult(result = {}) {
  return String(
    result.unit?.displayName
    ?? result.name
    ?? result.displayName
    ?? result.apiName
    ?? ""
  ).trim();
}

function buildConstrainedBatchFallback(entries, buildEntries) {
  const constrainedEntry = buildEntries.findLast((entry) => {
    const constraints = entry.value?.query?.constraints ?? entry.value?.constraints ?? {};
    return constraints.lockedItems?.length || constraints.excludedItems?.length;
  });
  if (!constrainedEntry) return null;
  const value = constrainedEntry.value ?? {};
  const constraints = value.query?.constraints ?? value.constraints ?? {};
  const lockedItems = (constraints.lockedItems ?? []).map(String);
  const excludedItems = (constraints.excludedItems ?? []).map(String);
  const itemNames = new Map();
  for (const entry of entries) {
    for (const item of entry.value?.itemContentionPlan?.contestedItems ?? []) {
      const apiName = String(item.itemRef?.apiName ?? "");
      const name = String(item.itemRef?.name ?? "");
      if (apiName && name) itemNames.set(apiName, name);
    }
    for (const item of entry.value?.items ?? []) {
      const apiName = String(item.apiName ?? "");
      const name = String(item.name ?? item.displayName ?? "");
      if (apiName && name) itemNames.set(apiName, name);
    }
  }
  const itemLabel = (apiName) => {
    const name = itemNames.get(apiName);
    return name ? `“${name}”（${apiName}）` : apiName;
  };
  const constraintParts = [];
  if (excludedItems.length) {
    constraintParts.push(`排除${excludedItems.map(itemLabel).join("、")}`);
  }
  if (lockedItems.length) {
    constraintParts.push(`锁定${lockedItems.map(itemLabel).join("、")}`);
  }

  const results = Array.isArray(value.results) ? value.results : [];
  const successfulResults = results.filter((result) => (
    result?.available === true && result.buildOptions?.length
  ));
  const failedResults = results.filter((result) => result?.available === false);
  const returnedOptions = successfulResults.flatMap((result) => result.buildOptions ?? []);
  const auditChanges = successfulResults.flatMap((result) => {
    const audit = result.constraintAudit;
    if (
      !Number.isInteger(audit?.eligibleBeforeConstraints)
      || !Number.isInteger(audit?.eligibleAfterConstraints)
    ) return [];
    const name = displayNameForBuildResult(result) || "该成员";
    return [`${name}候选行 ${audit.eligibleBeforeConstraints}→${audit.eligibleAfterConstraints}`];
  });
  const failedNames = [...new Set(failedResults.map(displayNameForBuildResult).filter(Boolean))];
  const coverageText = failedNames.length
    ? `${failedNames.map((name) => `“${name}”`).join("、")}的构筑数据本次不可用；因此证据覆盖不完整，无法判断整个阵容在该约束下的完整出装结果，整个阵容可能仍有未观测情况。`
    : "本次目标成员均取得了可验证的约束后构筑数据。";
  const resultText = returnedOptions.length
    ? `约束后仍返回 ${returnedOptions.length} 个可验证构筑选项。`
    : "约束后没有返回匹配的可验证构筑，不能据此推荐替代方案。";
  const auditText = auditChanges.length
    ? `约束审计显示过滤在排序前生效：${auditChanges.join("；")}。`
    : "约束已在来源行排序前应用，但本次没有足够的成功成员行数可供比较。";
  return {
    answer: `已按相同阵容、成员顺序和统计范围重新查询，并${constraintParts.join("、")}。${auditText}${resultText}${coverageText}`,
    evidenceIds: buildEntries
      .filter((entry) => entry.temporalStatus !== "historical")
      .map((entry) => entry.evidenceId)
  };
}

export function buildConstrainedBatchEvidenceFallback(ledger) {
  const entries = ledger.snapshot().entries;
  return buildConstrainedBatchFallback(
    entries,
    entries.filter((entry) => entry.toolName === "unit_builds_batch")
  );
}

export function buildInsufficientEvidenceFallback(ledger) {
  const entries = ledger.snapshot().entries;
  const buildEntries = entries.filter((entry) => entry.toolName === "unit_builds_batch");
  const constrainedFallback = buildConstrainedBatchEvidenceFallback(ledger);
  if (constrainedFallback) return constrainedFallback;
  const unavailableResults = buildEntries.flatMap((entry) => (
    Array.isArray(entry.value?.results)
      ? entry.value.results.filter((result) => result?.available === false)
      : []
  ));
  const names = [...new Set(unavailableResults.map(displayNameForBuildResult).filter(Boolean))];
  const risks = buildEntries.flatMap((entry) => (
    Array.isArray(entry.value?.source?.risks) ? entry.value.source.risks : []
  ));
  const warnings = unavailableResults.map((result) => String(result.warning ?? ""));
  const failureText = [...risks, ...warnings].join(" ");
  const timedOut = /(?:timed?\s*out|timeout|超时)/iu.test(failureText);
  const provider = buildEntries
    .map((entry) => String(entry.value?.source?.provider ?? "").trim())
    .find(Boolean);
  const evidenceIds = (buildEntries.length ? buildEntries : entries)
    .filter((entry) => entry.temporalStatus !== "historical")
    .map((entry) => entry.evidenceId);

  if (names.length) {
    const subject = names.map((name) => `“${name}”`).join("、");
    const source = provider ? `${provider} ` : "";
    const failure = timedOut ? "请求超时" : "暂时不可用";
    return {
      answer: `已识别到${subject}，但当前 ${source}出装统计${failure}，证据不足，暂时无法生成可靠的当前版本出装方案。请稍后重试。`,
      evidenceIds
    };
  }

  return {
    answer: "当前可用数据证据不足，暂时无法可靠回答这个问题。请稍后重试。",
    evidenceIds
  };
}

function trendCompName(row) {
  return String(row?.name ?? row?.compositionRef?.name ?? row?.compId ?? "未知阵容").trim();
}

function trendPlacementLabel(row, direction) {
  const change = row?.trend?.avgPlacementChange;
  if (typeof change !== "number" || !Number.isFinite(change)) return "";
  return direction === "rising"
    ? `（平均名次改善 ${Math.abs(change).toFixed(2)}）`
    : `（平均名次变差 ${Math.abs(change).toFixed(2)}）`;
}

function trendPopularityLabel(row) {
  const selectionRate = row?.stats?.selectionRate;
  return typeof selectionRate === "number" && Number.isFinite(selectionRate)
    ? `（选取率 ${(selectionRate * 100).toFixed(1)}%）`
    : "";
}

function trendRowsText(rows, formatter) {
  return rows.slice(0, 3)
    .map((row) => `${trendCompName(row)}${formatter(row)}`)
    .join("、");
}

export function buildCompositionTrendFallback(ledger) {
  const entry = ledger.snapshot().entries.findLast((candidate) => (
    candidate.temporalStatus !== "historical"
    && candidate.toolName === "comps_trends"
    && candidate.value?.type === "comp_trends"
  ));
  if (!entry) return null;
  const value = entry.value;
  const requestedDirection = value.requestedDirection ?? value.query?.trendDirection ?? null;
  const rising = Array.isArray(value.rising) ? value.rising : [];
  const falling = Array.isArray(value.falling) ? value.falling : [];
  const popularity = Array.isArray(value.rankings?.popularity) ? value.rankings.popularity : [];
  if (requestedDirection === "rising" && !rising.length) return null;
  if (requestedDirection === "falling" && !falling.length) return null;
  if (!requestedDirection && !rising.length && !falling.length && !popularity.length) return null;

  const sections = [];
  if (requestedDirection !== "falling") {
    sections.push(rising.length
      ? `上升阵容：${trendRowsText(rising, (row) => trendPlacementLabel(row, "rising"))}`
      : falling.length
        ? "上升阵容：当前没有检测到符合条件的阵容"
        : "上升/下降变化榜：当前暂无可用数据");
  }
  if (requestedDirection !== "rising" && falling.length) {
    sections.push(`下降阵容：${trendRowsText(falling, (row) => trendPlacementLabel(row, "falling"))}`);
  }
  if (!requestedDirection && popularity.length) {
    sections.push(`选取率排行：${trendRowsText(popularity, trendPopularityLabel)}`);
  }
  return {
    answer: `MetaTFT 今日趋势中，${sections.join("；")}。各榜单按当前返回结果独立展示。`,
    evidenceIds: [entry.evidenceId]
  };
}

function buildAvailableEvidenceFallback(ledger) {
  const entries = ledger.snapshot().entries;
  const buildEntries = entries.filter((entry) => entry.toolName === "unit_builds_batch");
  const results = buildEntries.flatMap((entry) => (
    Array.isArray(entry.value?.results)
      ? entry.value.results.filter((result) => result?.available === true && result.buildOptions?.length)
      : []
  ));
  if (!results.length) return null;
  const names = [...new Set(results.map(displayNameForBuildResult).filter(Boolean))];
  const optionCount = Math.min(...results.map((result) => result.buildOptions.length));
  const planText = optionCount >= 3
    ? "1 套稳定方案和 2 套备选方案"
    : `${optionCount} 套有统计证据的方案`;
  return {
    answer: `已获取${names.map((name) => `“${name}”`).join("、")}的当前出装统计，但 AI 的补充分析暂时未完成。先展示${planText}及其可验证数据；机制解读可稍后重试。`,
    evidenceIds: entries
      .filter((entry) => entry.temporalStatus !== "historical")
      .map((entry) => entry.evidenceId)
  };
}

function buildSingleUnitBuildFallback(ledger) {
  const entries = ledger.snapshot().entries;
  const entry = entries.findLast((candidate) => (
    candidate.toolName === "unit_builds"
    && candidate.temporalStatus !== "historical"
    && Array.isArray(candidate.value?.cards)
    && candidate.value.cards.length > 0
  ));
  if (!entry) return null;
  const value = entry.value;
  const unitName = value.unit?.name ?? value.query?.unitName ?? "该棋子";
  const cards = value.cards.slice(0, 3);
  const cardText = cards.map((card) => {
    const items = (card.items ?? []).map((item) => item.name ?? item.apiName).filter(Boolean).join("、");
    const stats = card.stats ?? {};
    return `${card.title ?? "方案"}：${items || "装备数据"}（场次 ${stats.games ?? "-"}，平均名次 ${stats.avg ?? "-"}，前四率 ${stats.top4 ?? "-"}，登顶率 ${stats.win ?? "-"}）`;
  }).join("；");
  return {
    answer: `${unitName}当前可参考的出装：${cardText}。`,
    evidenceIds: [entry.evidenceId]
  };
}

export function buildItemContentionFallback(ledger) {
  const entry = ledger.snapshot().entries.findLast((candidate) => (
    candidate.toolName === "unit_builds_batch"
    && candidate.value?.itemContentionPlan
    && candidate.temporalStatus !== "historical"
  ));
  if (!entry) return null;
  const plan = entry.value.itemContentionPlan;
  const successfulNames = (plan.successfulUnits ?? plan.eligibleUnits ?? [])
    .map((unit) => unit.name ?? unit.apiName)
    .filter(Boolean);
  const failedNames = (plan.failedUnits ?? [])
    .map((failure) => failure.unit?.name ?? failure.unit?.apiName)
    .filter(Boolean);
  const successfulSubject = successfulNames.length
    ? successfulNames.map((name) => `“${name}”`).join("、")
    : "已成功返回的成员";
  const failedSubject = failedNames.length
    ? failedNames.map((name) => `“${name}”`).join("、")
    : "其他候选成员";
  const coverageWarning = plan.coverageStatus === "partial"
    ? `${failedSubject}的构筑数据本次不可用，因此无法判断整个阵容是否还存在其他装备冲突。`
    : "";

  if (plan.status === "available") {
    const conflicts = (plan.contestedItems ?? []).map((item) => {
      const itemName = item.itemRef?.name ?? item.itemRef?.apiName ?? "该装备";
      const participantNames = (item.participants ?? [])
        .map((participant) => participant.unitRef?.name ?? participant.unitRef?.apiName)
        .filter(Boolean);
      return `${itemName}（${participantNames.join("、")}）`;
    }).filter(Boolean);
    if (!conflicts.length) return null;
    return {
      answer: `当前构筑数据已检测到装备竞争：${conflicts.join("；")}。${coverageWarning}装备优先级未评估，不能据此判断必须优先给谁。`,
      evidenceIds: [entry.evidenceId]
    };
  }
  if (plan.status === "no_contention") {
    return {
      answer: plan.coverageStatus === "partial"
        ? `在已成功取得构筑数据的${successfulSubject}中，暂未检测到共享装备竞争；${coverageWarning}`
        : `在本次纳入分析且成功返回构筑数据的${successfulSubject}中，未检测到共享装备竞争。该结论仅覆盖当前统计构筑选项。`,
      evidenceIds: [entry.evidenceId]
    };
  }
  if (plan.status === "insufficient_build_data") {
    return {
      answer: `当前只有${Number(plan.successfulUnitCount ?? successfulNames.length)}名阵容成员取得有效构筑数据，不足以判断阵容内是否存在装备竞争。${coverageWarning}`,
      evidenceIds: [entry.evidenceId]
    };
  }
  return null;
}

export function buildCompositionReplacementFallback(ledger) {
  const entry = ledger.snapshot().entries.findLast((candidate) => (
    ["composition_change_evaluation", "composition_replacement_evaluation"].includes(
      candidate.toolName
    )
    && candidate.temporalStatus !== "historical"
  ));
  if (!entry) return null;
  const value = entry.value ?? {};
  const operation = value.operation
    ?? (entry.toolName === "composition_replacement_evaluation" ? "replace" : null);
  const compositionName = value.compositionRef?.name ?? "当前阵容";
  const targetName = value.target?.name ?? value.target?.apiName ?? "目标棋子";
  const incoming = value.incoming ?? value.replacement;
  const incomingName = incoming?.name ?? incoming?.apiName ?? "新增棋子";
  if (value.status === "invalid_target") {
    return {
      answer: `${targetName}不是“${compositionName}”的阵容成员，因此无法执行本次${operation === "remove" ? "下人" : "换人"}评估。`,
      evidenceIds: [entry.evidenceId]
    };
  }
  if (["invalid_incoming", "invalid_replacement", "invalid_change", "invalid_operation"].includes(value.status)) {
    const reason = ["incoming_already_in_composition", "replacement_already_in_composition"].includes(
      value.failureReason
    )
      ? `${incomingName}已经是“${compositionName}”的阵容成员，因此本次变更不成立。`
      : ["incoming_matches_target", "replacement_matches_target"].includes(value.failureReason)
        ? `${targetName}与${incomingName}是同一名棋子，因此阵容不会发生变化。`
        : `当前官方棋子证据或参数无法支持本次${operation === "add" ? "加人" : operation === "remove" ? "下人" : "换人"}评估。`;
    return { answer: reason, evidenceIds: [entry.evidenceId] };
  }
  if (value.status !== "evaluated") return null;
  const changeText = (delta) => {
    const beforeTier = Number(delta.beforeBreakpoint?.tierIndex ?? 0);
    const afterTier = Number(delta.afterBreakpoint?.tierIndex ?? 0);
    if (delta.breakpointChange === "activated") return `由未激活变为第${afterTier}档`;
    if (delta.breakpointChange === "deactivated") return `由第${beforeTier}档变为未激活`;
    if (delta.breakpointChange === "advanced") return `由第${beforeTier}档升至第${afterTier}档`;
    if (delta.breakpointChange === "regressed") return `由第${beforeTier}档降至第${afterTier}档`;
    return "激活档位未变化";
  };
  const deltas = (value.traitDeltas ?? []).map((delta) => (
    `${delta.traitRef?.name ?? delta.traitRef?.apiName ?? "羁绊"} ${delta.beforeCount}→${delta.afterCount}（${changeText(delta)}）`
  ));
  const actionText = operation === "add"
    ? `向“${compositionName}”加入${incomingName}`
    : operation === "remove"
      ? `从“${compositionName}”移除${targetName}`
      : `将${targetName}替换为${incomingName}`;
  return {
    answer: `${actionText}后的确定性结构变化：${deltas.length ? deltas.join("；") : "没有羁绊数量或档位变化"}。该评估不包含强弱结论。`,
    evidenceIds: [entry.evidenceId]
  };
}

function buildRejectedNarrativeFallback(ledger) {
  return buildConstrainedBatchEvidenceFallback(ledger)
    ?? buildItemContentionFallback(ledger)
    ?? buildSingleUnitBuildFallback(ledger)
    ?? buildAvailableEvidenceFallback(ledger)
    ?? {
    answer: "已获取可验证结果，但模型生成的部分说明超出当前证据范围，已隐藏。请以结果区的证据和确定性结果为准。",
    evidenceIds: ledger.snapshot().entries
      .filter((entry) => entry.temporalStatus !== "historical")
      .map((entry) => entry.evidenceId)
  };
}

export class ReactLoop {
  constructor(options = {}) {
    if (typeof options.decisionProvider !== "function") {
      throw new TypeError("ReactLoop requires a decisionProvider");
    }
    if (!options.registry) throw new TypeError("ReactLoop requires a ToolRegistry");
    if (!options.toolExecutor) throw new TypeError("ReactLoop requires a ToolExecutor");
    this.decisionProvider = options.decisionProvider;
    this.registry = options.registry;
    this.toolExecutor = options.toolExecutor;
    this.handlers = { ...(options.handlers ?? {}) };
    this.resolveHandler = options.resolveHandler ?? null;
    this.availableToolNames = new Set(
      (options.availableToolNames ?? Object.keys(this.handlers)).map(String)
    );
    for (const name of this.availableToolNames) {
      if (!this.registry.get(name)) {
        throw new TypeError(`Available ReAct tool is not registered: ${name}`);
      }
    }
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? Date.now;
    this.budget = normalizeReactLoopBudget(options.budget);
    this.groundingMode = normalizeGroundingMode(options.groundingMode);
    this.validateEvidence = options.validateEvidence ?? validateToolEvidence;
  }

  async run(request = {}, context = {}) {
    const budget = normalizeReactLoopBudget({ ...this.budget, ...(context.budget ?? {}) });
    const groundingMode = normalizeGroundingMode(context.groundingMode ?? this.groundingMode);
    const state = new ReactWorkingState(request, budget);
    const ledger = new EvidenceLedger({
      createId: context.createEvidenceId ?? this.createId,
      now: this.now,
      validate: this.validateEvidence
    });
    const duplicateGuard = new DuplicateCallGuard();
    const runId = String(context.run?.runId ?? context.runId ?? this.createId());
    const onEvent = context.onEvent ?? null;
    let insufficientFinishRepairCount = 0;
    let sufficientFinishRepairCount = 0;
    let consecutiveToolFailures = 0;
    let modelConclusion = null;
    const failuresByCapability = new Map();
    let sequence = 0;
    const emit = (type, data = {}) => {
      const event = {
        schemaVersion: REACT_STREAM_EVENT_SCHEMA_VERSION,
        runId,
        sequence: ++sequence,
        type,
        timestamp: new Date(this.now()).toISOString(),
        data: structuredClone(data)
      };
      try {
        onEvent?.(event);
      } catch {
        // Observability must never change the run result.
      }
      return event;
    };
    const terminate = (terminationReason, extra = {}) => {
      state.terminate(terminationReason);
      emit("termination", { terminationReason, ...extra });
      return {
        schemaVersion: "react-run-result.v1",
        status: extra.status ?? "failed",
        terminationReason,
        answer: extra.answer ?? null,
        answerOrigin: extra.answerOrigin ?? null,
        modelConclusion: modelConclusion ? structuredClone(modelConclusion) : null,
        narrative: extra.narrative ?? null,
        narrativeWarnings: extra.narrativeWarnings ?? [],
        groundingAudit: extra.groundingAudit ?? null,
        question: extra.question ?? null,
        missingFields: extra.missingFields ?? [],
        evidenceIds: extra.evidenceIds ?? [],
        evidence: ledger.snapshot().entries,
        observations: structuredClone(state.observations),
        warnings: [...state.warnings],
        safetyMetrics: {
          actualToolCalls: state.toolCallCount,
          uniqueToolFingerprints: duplicateGuard.size,
          duplicateCallsBlocked: state.duplicateCallsBlocked,
          decisions: state.decisions.length,
          progressDecisions: state.progressDecisionCount,
          maxConsecutiveNoProgress: state.maxObservedConsecutiveNoProgress,
          toolFailures: state.toolFailureCount
        }
      };
    };
    const terminateForNoProgress = (reason = "no_progress") => {
      const entries = ledger.snapshot().entries.filter((entry) => entry.temporalStatus !== "historical");
      const available = buildConstrainedBatchEvidenceFallback(ledger)
        ?? buildItemContentionFallback(ledger)
        ?? buildAvailableEvidenceFallback(ledger);
      const stopExplanation = reason === "duplicate_call"
        ? "模型尝试重复同一查询，但没有新的条件或证据可支持再次执行；系统已拦截重复调用。"
        : reason === "capability_failure_circuit_open"
          ? "同一查询能力已连续失败，系统已停止继续调用该能力。"
          : reason === "tool_failure_circuit_open"
            ? "多个工具连续失败，系统已停止继续执行，避免无效重试。"
            : reason === "runaway_loop_fuse"
              ? "任务在较长的决策链中仍未形成可交付结论，系统已触发异常循环熔断。"
              : "连续步骤没有产生新的有效证据或可交付结论，系统已停止继续执行。";
      const fallback = available ?? {
        answer: entries.length
          ? `已取得部分有效证据。${stopExplanation}未被现有证据支持的部分不会推断。`
          : `${stopExplanation}当前证据不足，无法可靠回答这个问题。`,
        evidenceIds: entries.map((entry) => entry.evidenceId)
      };
      state.warn(reason);
      emit("answer", {
        answer: fallback.answer,
        evidenceIds: fallback.evidenceIds,
        reasonCode: entries.length ? "partial_evidence" : "insufficient_evidence",
        narrativeAccepted: false,
        systemFallback: true
      });
      return terminate(reason, {
        status: "completed_with_warning",
        answer: fallback.answer,
        evidenceIds: fallback.evidenceIds,
        answerOrigin: "system_evidence_fallback"
      });
    };

    emit("run_started", { budget });
    for (const promoted of request.bridgeContext?.promotedEvidence ?? []) {
      const addition = ledger.addHistorical(promoted);
      if (addition.added) {
        emit("evidence_promoted", {
          evidenceId: addition.entry.evidenceId,
          tool: addition.entry.toolName,
          type: addition.entry.type,
          source: addition.entry.source,
          temporalStatus: addition.entry.temporalStatus
        });
      }
    }
    if (request.bridgeContext?.warning) state.warn(request.bridgeContext.warning);
    if (request.bridgeContext?.requiredClarification) {
      const clarification = request.bridgeContext.requiredClarification;
      state.recordDecision({
        schemaVersion: "react-action.v1",
        type: "ask_user",
        question: clarification.question,
        missingFields: clarification.missingFields,
        reasonCode: "missing_context"
      });
      emit("decision", {
        type: "ask_user",
        tool: null,
        purposeCode: null,
        iteration: state.decisions.length,
        remainingBudget: {
          decisions: Math.max(0, budget.maxDecisions - state.decisions.length),
          toolCalls: null
        }
      });
      emit("ask_user", {
        question: clarification.question,
        missingFields: clarification.missingFields,
        reasonCode: "missing_context"
      });
      return terminate("ask_user", {
        status: "clarification_required",
        question: clarification.question,
        missingFields: clarification.missingFields
      });
    }
    const catalog = publicToolCatalog(this.registry, this.availableToolNames);

    while (state.decisions.length < budget.maxDecisions) {
      context.run?.assertActive?.();
      state.recordRuntimeState();
      let provided;
      try {
        provided = await this.decisionProvider({
          schemaVersion: "react-decision-request.v1",
          state: state.snapshot(ledger),
          toolCatalog: catalog
        }, {
          signal: context.signal,
          runId
        });
      } catch (error) {
        const normalized = safeError(error);
        emit("error", { code: normalized.code, message: normalized.message });
        const deterministicVideoAction = deterministicStrategyVideoFallback(
          request,
          this.availableToolNames,
          ledger
        );
        if (deterministicVideoAction) {
          state.warn("decision_provider_video_fallback");
          provided = { action: deterministicVideoAction };
        } else {
        const fallback = buildItemContentionFallback(ledger)
          ?? buildSingleUnitBuildFallback(ledger)
          ?? buildAvailableEvidenceFallback(ledger);
        if (fallback) {
          state.warn("decision_provider_answer_fallback");
          emit("answer", {
            answer: fallback.answer,
            evidenceIds: fallback.evidenceIds,
            reasonCode: "sufficient_evidence",
            narrativeAccepted: false,
            systemFallback: true
          });
          return terminate("decision_provider_fallback", {
            status: "completed_with_warning",
            answer: fallback.answer,
            evidenceIds: fallback.evidenceIds,
            answerOrigin: "system_evidence_fallback"
          });
        }
        return terminate("decision_provider_failed", { status: "failed" });
        }
      }

      const candidate = provided?.action ?? provided;
      const validation = validateReactAction(candidate, {
        registry: this.registry,
        availableToolNames: this.availableToolNames
      });
      if (!validation.valid) {
        if (candidate?.type === "finish" && typeof candidate?.answer === "string" && candidate.answer.trim()) {
          modelConclusion = {
            schemaVersion: "react-model-conclusion.v1",
            answer: candidate.answer.trim(),
            reasonCode: typeof candidate.reasonCode === "string" ? candidate.reasonCode : null,
            evidenceIds: Array.isArray(candidate.evidenceIds)
              ? candidate.evidenceIds.map(String)
              : [],
            status: "rejected",
            validationErrors: validation.errors.map(String)
          };
        }
        state.recordDecision({
          schemaVersion: "react-action.v1",
          type: "rejected",
          errors: validation.errors
        });
        state.recordObservation({ type: "decision_rejected", errors: validation.errors });
        emit("decision_rejected", {
          iteration: state.decisions.length,
          errors: validation.errors.map((error) => String(error).slice(0, 200))
        });
        if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
          return terminateForNoProgress();
        }
        continue;
      }

      const action = applyRequestBoundTrendDirection(
        applyRequestBoundVideoScope(validation.value, request),
        request
      );
      state.recordDecision(action);
      emit("decision", decisionEventData(action, state, budget));

      if (action.type === "ask_user") {
        emit("ask_user", {
          question: action.question,
          missingFields: action.missingFields,
          reasonCode: action.reasonCode
        });
        return terminate("ask_user", {
          status: "clarification_required",
          question: action.question,
          missingFields: action.missingFields
        });
      }

      if (action.type === "finish") {
        modelConclusion = {
          schemaVersion: "react-model-conclusion.v1",
          answer: action.answer,
          reasonCode: action.reasonCode,
          evidenceIds: [...action.evidenceIds],
          status: "submitted",
          validationErrors: []
        };
        const carrierFinishValidation = validateItemCarrierWorkflowFinish(request, action, ledger);
        if (!carrierFinishValidation.valid) {
          modelConclusion.status = "rejected";
          modelConclusion.validationErrors = carrierFinishValidation.errors.map(String);
          state.recordObservation({
            type: "decision_rejected",
            actionType: "finish",
            reasonCode: action.reasonCode,
            errors: carrierFinishValidation.errors,
            repairInstruction: "Continue the item-carrier workflow: cite current item_carrier_rankings evidence and retrieve matching item_details before finishing."
          }, { progress: false });
          emit("decision_rejected", {
            iteration: state.decisions.length,
            code: "incomplete_item_carrier_workflow",
            errors: carrierFinishValidation.errors,
            repairable: true
          });
          if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
            return terminateForNoProgress("incomplete_item_carrier_workflow");
          }
          continue;
        }
        const comparisonDetailFinishValidation = validateComparisonItemDetailsFinish(
          request,
          action,
          ledger
        );
        if (!comparisonDetailFinishValidation.valid) {
          modelConclusion.status = "rejected";
          modelConclusion.validationErrors = comparisonDetailFinishValidation.errors.map(String);
          state.recordObservation({
            type: "decision_rejected",
            actionType: "finish",
            reasonCode: action.reasonCode,
            errors: comparisonDetailFinishValidation.errors,
            repairInstruction: "Continue the item-comparison workflow: retrieve and cite item_details for every compared item before finishing."
          }, { progress: false });
          emit("decision_rejected", {
            iteration: state.decisions.length,
            code: "incomplete_item_comparison_details",
            errors: comparisonDetailFinishValidation.errors,
            repairable: true
          });
          if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
            return terminateForNoProgress("incomplete_item_comparison_details");
          }
          continue;
        }
        const finishValidation = validateFinishAction(action, ledger);
        if (!finishValidation.valid) {
          modelConclusion.status = "rejected";
          modelConclusion.validationErrors = finishValidation.errors.map(String);
          emit("decision_rejected", {
            iteration: state.decisions.length,
            errors: finishValidation.errors
          });
          if (canPublishSummaryWithValidationWarnings(request, action, finishValidation, ledger)) {
            const warnings = finishValidation.errors.map(String);
            modelConclusion.status = "accepted_with_validation_warnings";
            state.warn("summary_validation_softened");
            emit("answer", {
              answer: action.answer,
              evidenceIds: action.evidenceIds,
              reasonCode: action.reasonCode,
              narrativeAccepted: false,
              systemFallback: false,
              validationWarnings: warnings
            });
            return terminate("completed", {
              status: "completed_with_warning",
              answer: action.answer,
              evidenceIds: action.evidenceIds,
              narrativeWarnings: warnings,
              groundingAudit: {
                schemaVersion: "grounding-audit.v1",
                mode: "summary_soft_validation",
                narrativeAccepted: false,
                qualitativeOutputPreserved: true,
                violationCount: warnings.length,
                violations: warnings
              },
              answerOrigin: "model_soft_validated_summary"
            });
          }
          if (action.reasonCode === "insufficient_evidence") {
            const trendFallback = buildCompositionTrendFallback(ledger);
            insufficientFinishRepairCount += 1;
            state.recordObservation({
              type: "decision_rejected",
              actionType: "finish",
              reasonCode: action.reasonCode,
              errors: finishValidation.errors,
              repairInstruction: trendFallback
                ? "趋势 Evidence 为部分可用：不得把空的上升榜或旧 officialGate 门槛解释成整个结果不可用。改用 sufficient_evidence，引用趋势 Evidence，并展示所有非空的下降榜和选取率榜；只限定空榜单。"
                : "明确告诉用户数据或证据不足、查询失败或来源不可用；不得补造统计、装备或结论。继续使用 insufficient_evidence。"
            }, { progress: false });
            const canRepair = (
              insufficientFinishRepairCount === 1
              && state.decisions.length < budget.maxDecisions
            );
            if (canRepair) {
              state.warn("insufficient_evidence_answer_repair_requested");
              continue;
            }

            const fallback = trendFallback ?? buildInsufficientEvidenceFallback(ledger);
            state.warn(trendFallback
              ? "composition_trend_partial_evidence_fallback"
              : "insufficient_evidence_answer_fallback");
            emit("answer", {
              answer: fallback.answer,
              evidenceIds: fallback.evidenceIds,
              reasonCode: trendFallback ? "sufficient_evidence" : "insufficient_evidence",
              narrativeAccepted: false,
              systemFallback: true
            });
            return terminate(trendFallback ? "finish_validation_fallback" : "insufficient_evidence", {
              status: "completed_with_warning",
              answer: fallback.answer,
              evidenceIds: fallback.evidenceIds,
              answerOrigin: "system_evidence_fallback"
            });
          }
          if (action.reasonCode === "sufficient_evidence") {
            const fallback = buildCompositionTrendFallback(ledger)
              ?? buildCompositionReplacementFallback(ledger)
              ?? buildConstrainedBatchEvidenceFallback(ledger)
              ?? buildItemContentionFallback(ledger)
              ?? buildSingleUnitBuildFallback(ledger)
              ?? buildAvailableEvidenceFallback(ledger);
            if (fallback) {
              sufficientFinishRepairCount += 1;
              state.recordObservation({
                type: "decision_rejected",
                actionType: "finish",
                reasonCode: action.reasonCode,
                errors: finishValidation.errors,
                repairInstruction: "修正最终回答，只保留被已引用 Evidence 逐项支持的统计数字与机制；不要补造、换算错误或沿用被拒绝的数字。"
              }, { progress: false });
              const canRepair = (
                sufficientFinishRepairCount === 1
                && state.decisions.length < budget.maxDecisions
              );
              if (canRepair) {
                state.warn("sufficient_evidence_answer_repair_requested");
                continue;
              }
              state.warn("sufficient_evidence_answer_fallback");
              emit("answer", {
                answer: fallback.answer,
                evidenceIds: fallback.evidenceIds,
                reasonCode: "sufficient_evidence",
                narrativeAccepted: false,
                systemFallback: true
              });
              return terminate("finish_validation_fallback", {
                status: "completed_with_warning",
                answer: fallback.answer,
                evidenceIds: fallback.evidenceIds,
                answerOrigin: "system_evidence_fallback"
              });
            }
          }
          return terminate(
            action.reasonCode === "sufficient_evidence" || /statistical claim/u.test(finishValidation.errors.join(" "))
              ? "missing_required_evidence"
              : "invalid_finish",
            { status: "failed" }
          );
        }
        const narrativeValidation = validateGroundedBuildNarrative(
          action.narrative,
          ledger,
          action.evidenceIds
        );
        const rejectedNarrativeFallback = narrativeValidation.valid || groundingMode === "observe"
          ? null
          : buildRejectedNarrativeFallback(ledger);
        if (!narrativeValidation.valid) {
          state.warn(
            groundingMode === "observe"
              ? "grounded_build_narrative_observed"
              : "grounded_build_narrative_rejected"
          );
        }
        const groundingAudit = {
          schemaVersion: "grounding-audit.v1",
          mode: groundingMode,
          narrativeAccepted: narrativeValidation.valid,
          qualitativeOutputPreserved: groundingMode === "observe" && !narrativeValidation.valid,
          violationCount: narrativeValidation.errors.length,
          violations: narrativeValidation.errors
        };
        modelConclusion.status = rejectedNarrativeFallback
          ? "rejected"
          : narrativeValidation.valid
            ? "accepted"
            : "accepted_with_grounding_warnings";
        modelConclusion.validationErrors = narrativeValidation.errors.map(String);
        const status = state.warnings.length ? "completed_with_warning" : "completed";
        emit("answer", {
          answer: rejectedNarrativeFallback?.answer ?? action.answer,
          evidenceIds: rejectedNarrativeFallback?.evidenceIds ?? action.evidenceIds,
          reasonCode: action.reasonCode,
          narrativeAccepted: narrativeValidation.valid,
          systemFallback: Boolean(rejectedNarrativeFallback)
        });
        return terminate(
          action.reasonCode === "insufficient_evidence" ? "insufficient_evidence" : "completed",
          {
            status,
            answer: rejectedNarrativeFallback?.answer ?? action.answer,
            evidenceIds: rejectedNarrativeFallback?.evidenceIds ?? action.evidenceIds,
            narrative: narrativeValidation.value,
            narrativeWarnings: narrativeValidation.errors,
            groundingAudit,
            answerOrigin: rejectedNarrativeFallback
              ? "system_evidence_fallback"
              : "model"
          }
        );
      }

      try {
        const definition = this.registry.get(action.tool);
        validateToolInput(action.arguments, definition.inputSchema, action.tool);
      } catch (error) {
        const errors = Array.isArray(error?.details?.errors) && error.details.errors.length
          ? error.details.errors.map(String)
          : [String(error?.message ?? "invalid tool input")];
        state.recordObservation({
          type: "decision_rejected",
          tool: action.tool,
          errors,
          repairInstruction: "Repair the arguments to match this tool's inputSchema exactly; do not repeat the invalid shape."
        }, { progress: false });
        emit("decision_rejected", {
          iteration: state.decisions.length,
          code: "invalid_tool_input",
          tool: action.tool,
          errors,
          repairable: true
        });
        if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
          return terminateForNoProgress("invalid_tool_input");
        }
        continue;
      }

      const contentionBuildValidation = validateCompositionItemContentionBuildAction(
        action,
        ledger,
        request
      );
      if (!contentionBuildValidation.valid) {
        state.recordObservation({
          type: "decision_rejected",
          tool: action.tool,
          errors: contentionBuildValidation.errors
        }, { progress: false });
        emit("decision_rejected", {
          iteration: state.decisions.length,
          code: "invalid_item_contention_candidate_selection",
          tool: action.tool,
          errors: contentionBuildValidation.errors
        });
        if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
          return terminateForNoProgress();
        }
        continue;
      }
      const itemCarrierValidation = validateItemCarrierAction(action, ledger);
      if (!itemCarrierValidation.valid) {
        state.recordObservation({
          type: "decision_rejected",
          tool: action.tool,
          errors: itemCarrierValidation.errors,
          repairInstruction: "Resolve the named item with entity_catalog_query first, then copy its exact apiName into item_carrier_rankings."
        }, { progress: false });
        emit("decision_rejected", {
          iteration: state.decisions.length,
          code: "ungrounded_item_carrier_query",
          tool: action.tool,
          errors: itemCarrierValidation.errors,
          repairable: true
        });
        if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
          return terminateForNoProgress("ungrounded_item_carrier_query");
        }
        continue;
      }
      const unitBuildValidation = validateUnitBuildsAction(action, ledger, request);
      if (!unitBuildValidation.valid) {
        state.recordObservation({
          type: "decision_rejected",
          tool: action.tool,
          errors: unitBuildValidation.errors,
          repairInstruction: "Resolve the champion and every named item with entity_catalog_query, then copy their exact apiNames into unit_builds."
        }, { progress: false });
        emit("decision_rejected", {
          iteration: state.decisions.length,
          code: "ungrounded_unit_build_query",
          tool: action.tool,
          errors: unitBuildValidation.errors,
          repairable: true
        });
        if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
          return terminateForNoProgress("ungrounded_unit_build_query");
        }
        continue;
      }
      const itemBatchValidation = validateItemDetailsBatchAction(action, ledger, request);
      if (!itemBatchValidation.valid) {
        state.recordObservation({
          type: "decision_rejected",
          tool: action.tool,
          errors: itemBatchValidation.errors
        }, { progress: false });
        emit("decision_rejected", {
          iteration: state.decisions.length,
          code: "invalid_differentiating_item_selection",
          tool: action.tool,
          errors: itemBatchValidation.errors
        });
        if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
          return terminateForNoProgress();
        }
        continue;
      }
      const batchConstraintValidation = validateUnitBuildBatchConstraintAction(
        action,
        ledger,
        request
      );
      if (!batchConstraintValidation.valid) {
        state.recordObservation({
          type: "decision_rejected",
          tool: action.tool,
          errors: batchConstraintValidation.errors
        }, { progress: false });
        emit("decision_rejected", {
          iteration: state.decisions.length,
          code: "invalid_unit_build_batch_constraints",
          tool: action.tool,
          errors: batchConstraintValidation.errors
        });
        if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
          return terminateForNoProgress();
        }
        continue;
      }
      const replacementValidation = validateCompositionReplacementAction(action, ledger, request);
      if (!replacementValidation.valid) {
        state.recordObservation({
          type: "decision_rejected",
          tool: action.tool,
          errors: replacementValidation.errors
        }, { progress: false });
        emit("decision_rejected", {
          iteration: state.decisions.length,
          code: action.tool === "composition_change_evaluation"
            ? "invalid_composition_change_evidence"
            : "invalid_composition_replacement_evidence",
          tool: action.tool,
          errors: replacementValidation.errors
        });
        if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
          return terminateForNoProgress();
        }
        continue;
      }
      const tacticalDetailsValidation = validateCompositionTacticalDetailsAction(action, ledger, request);
      if (!tacticalDetailsValidation.valid) {
        state.recordObservation({
          type: "decision_rejected",
          tool: action.tool,
          errors: tacticalDetailsValidation.errors
        }, { progress: false });
        emit("decision_rejected", {
          iteration: state.decisions.length,
          code: "invalid_composition_tactical_detail_evidence",
          tool: action.tool,
          errors: tacticalDetailsValidation.errors
        });
        if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
          return terminateForNoProgress();
        }
        continue;
      }
      const duplicate = duplicateGuard.check(action.tool, action.arguments);
      if (duplicate.duplicate) {
        state.recordDuplicateBlocked();
        const requestedConstraintRepair = action.tool === "unit_builds_batch"
          && ![
            ...unitBuildBatchConstraintItems(action).lockedItems,
            ...unitBuildBatchConstraintItems(action).excludedItems
          ].length;
        if (requestedConstraintRepair) {
          const errors = [
            "repeated unconstrained baseline; copy the baseline scope and add nested constraints.lockedItems or constraints.excludedItems"
          ];
          state.recordObservation({
            type: "decision_rejected",
            tool: action.tool,
            errors,
            repairInstruction: "Do not repeat the baseline. Retry unit_builds_batch with the same scope and a non-empty nested constraints object grounded in the user request."
          }, { progress: false });
          emit("decision_rejected", {
            iteration: state.decisions.length,
            code: "duplicate_call",
            tool: action.tool,
            errors,
            repairable: true
          });
          if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
            return terminateForNoProgress("duplicate_call");
          }
          continue;
        }
        emit("decision_rejected", {
          iteration: state.decisions.length,
          code: "duplicate_call",
          tool: action.tool
        });
        return terminateForNoProgress("duplicate_call");
      }
      const callPolicy = duplicateGuard.checkPolicy(action.tool, action.arguments);
      if (!callPolicy.allowed) {
        emit("decision_rejected", {
          iteration: state.decisions.length,
          code: callPolicy.code,
          tool: action.tool
        });
        return terminateForNoProgress(callPolicy.code);
      }
      if ((failuresByCapability.get(action.tool) ?? 0) >= 2) {
        state.recordObservation({
          type: "decision_rejected",
          tool: action.tool,
          errors: ["same capability failed twice without intervening progress"]
        }, { progress: false });
        emit("decision_rejected", {
          iteration: state.decisions.length,
          code: "capability_failure_circuit_open",
          tool: action.tool
        });
        if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
          return terminateForNoProgress("capability_failure_circuit_open");
        }
        continue;
      }

      const definition = this.registry.get(action.tool);
      const handler = this.handlers[action.tool]
        ?? this.resolveHandler?.(action.tool, action, request)
        ?? null;
      emit("tool_started", { tool: action.tool, iteration: state.decisions.length });
      let toolResult;
      try {
        toolResult = await this.toolExecutor.execute(action.tool, action.arguments, {
          source: definition.source,
          handler,
          run: context.run,
          signal: context.signal,
          maxRetriesPerTool: budget.maxRetriesPerTool,
          intent: "react_chat"
        });
      } catch (error) {
        const normalized = safeError(error);
        consecutiveToolFailures += 1;
        failuresByCapability.set(action.tool, (failuresByCapability.get(action.tool) ?? 0) + 1);
        state.recordToolFailure();
        state.warn(`${action.tool}:${normalized.code}`);
        state.recordObservation({
          type: "tool_failed",
          tool: action.tool,
          error: normalized,
          toolResult: error?.toolResult ?? null
        }, { toolCall: Boolean(error?.toolResult), progress: false });
        emit("tool_failed", { tool: action.tool, error: normalized });
        if (consecutiveToolFailures >= 3) {
          return terminateForNoProgress("tool_failure_circuit_open");
        }
        if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
          return terminateForNoProgress();
        }
        continue;
      }

      emit("tool_completed", {
        tool: action.tool,
        toolCallId: toolResult.toolCallId,
        attempts: toolResult.attempts
      });
      // A failed or timed-out call did not produce reusable work. Record the
      // fingerprint only after execution succeeds so the model can retry once
      // under the existing per-capability failure circuit.
      duplicateGuard.record(action.tool, action.arguments);
      const evidenceContract = {
        type: definition.evidenceType,
        source: definition.source,
        requiredFields: ["source", "updatedAt"],
        allowModelGeneratedStatistics: false
      };
      const addition = ledger.add({ definition, toolResult, evidenceContract });
      const nextActionAffordance = compositionTacticalNextActionAffordance(
        action,
        toolResult,
        request
      ) ?? compositionTrendNextActionAffordance(
        action,
        toolResult,
        addition
      ) ?? unitBuildBatchNextActionAffordance(
        action,
        toolResult,
        addition,
        ledger
      ) ?? itemCarrierNextActionAffordance(action, toolResult, addition, ledger)
        ?? comparisonItemDetailsNextActionAffordance(
          action,
          toolResult,
          addition,
          ledger,
          request
        );
      state.recordObservation({
        type: "tool_result",
        tool: action.tool,
        status: toolResult.status,
        toolCallId: toolResult.toolCallId,
        evidenceId: addition.entry?.evidenceId ?? null,
        evidenceStatus: addition.added ? "valid" : addition.reason,
        value: toolResult.value,
        evidence: addition.entry ?? null,
        ...(nextActionAffordance ? { nextActionAffordance } : {})
      }, { toolCall: true, progress: addition.added });
      if (addition.added) {
        consecutiveToolFailures = 0;
        failuresByCapability.clear();
        emit("evidence_added", {
          evidenceId: addition.entry.evidenceId,
          tool: addition.entry.toolName,
          type: addition.entry.type,
          source: addition.entry.source,
          updatedAt: addition.entry.updatedAt
        });
      }
      if (state.consecutiveNoProgress >= budget.maxConsecutiveNoProgress) {
        return terminateForNoProgress();
      }
    }

    return terminateForNoProgress("runaway_loop_fuse");
  }
}
