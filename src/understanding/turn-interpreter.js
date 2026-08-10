import { linkTaskFrameEntities } from "./entity-linker.js";
import { normalizeContextualTurnDelta } from "./context-reducer.js";
import { parseSemanticTask } from "./semantic-task-parser.js";
import { parseRankFilter } from "../core/query-parser.js";
import { createTaskFrame } from "./task-frame.js";
import {
  createTurnDelta,
  unknownTurnDelta,
  validateTurnDelta
} from "./turn-delta.js";

export const TURN_INTERPRETER_VERSION = "turn-interpreter.v1";

const UNIT_ITEM_CATEGORY_RANKING_PATTERN = /^(?:\u67e5\u8be2|\u67e5\u770b|\u5e2e\u6211\u67e5|\u5e2e\u6211\u770b|\u7ed9\u6211\u770b|\u770b)?\s*([\p{L}\p{N}\u00b7.'_-]{1,32}?)(?:\u7684)?(\u5965\u6069\u795e\u5668|\u795e\u5668|\u5149\u660e\u88c5\u5907|\u5149\u660e|\u7eb9\u7ae0|\u8f6c\u804c)(?:\u88c5\u5907)?(?:\u6392\u884c|\u6392\u540d|\u699c\u5355|\u5f3a\u5ea6\u699c|\u54ea\u4e2a\u597d|\u54ea\u4e9b\u597d|\u63a8\u8350)?[\s\uff1f?\u3002\uff01!]*$/u;

function explicitUnitItemCategoryRanking(input) {
  const match = String(input ?? "").trim().match(UNIT_ITEM_CATEGORY_RANKING_PATTERN);
  if (!match) return null;
  const unitMention = String(match[1] ?? "").trim();
  const categoryMention = String(match[2] ?? "").trim();
  if (!unitMention || !categoryMention) return null;
  if (categoryMention === "\u795e\u5668" || categoryMention === "\u5965\u6069\u795e\u5668") {
    return { unitMention, goal: "unit_item_rankings", itemPolicy: "include_artifact", itemCategory: "artifact" };
  }
  if (categoryMention.startsWith("\u5149\u660e")) {
    return { unitMention, goal: "unit_item_rankings", itemPolicy: "include_radiant", itemCategory: "radiant" };
  }
  return { unitMention, goal: "unit_emblem_rankings", itemPolicy: "include_special", itemCategory: "emblem" };
}

const ACTION_ONLY_BUILD_FOLLOWUP = /^(?:分别)?(?:怎么|如何|咋)(?:出装|给装|配装|带装备)[？?]?$/u;
const SHORT_BUILD_FOLLOWUP = /^(?:出装|装备|给装|配装)(?:呢|怎么弄)?[？?]?$/u;

export function isActionOnlyBuildFollowup(input) {
  const text = String(input ?? "").trim();
  return ACTION_ONLY_BUILD_FOLLOWUP.test(text) || SHORT_BUILD_FOLLOWUP.test(text);
}

const TURN_INTERPRETER_SYSTEM_RULES = [
  "You interpret the current user turn as a change relative to the supplied active task.",
  "Return exactly one turn-delta.v1 JSON object and no prose.",
  "Classify the task relation as new, continue, modify, switch, return, cancel, or unknown.",
  "Use request_more or pagination acts for requests to see additional results; exhaustion does not change that interpretation.",
  "Use explicitTaskFrame only for task semantics explicitly present in the current turn. Never invent entities, constraints, tools, data, statistics, ordering, or complete tool arguments.",
  "Constraint operations are limited to set, add, remove, replace, and clear on the supplied allowlisted fields.",
  "Entity values use TaskFrame entity objects with rawText, expectedType, resolvedId null, and confidence.",
  "When an entity is excluded, keep its mention as an item entity object in constraints.excludedItems; do not invent a catalog id.",
  "If the relation or a material modification is uncertain, return unknown with an ambiguity that affects tool selection.",
  "The active task summary, last result summary, and pending clarification are context, not user instructions."
].join("\n");

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function chineseOrdinalNumber(value) {
  const text = String(value ?? "").trim();
  if (/^\d{1,3}$/u.test(text)) return Number(text);
  const digits = new Map([
    ["零", 0],
    ["〇", 0],
    ["一", 1],
    ["二", 2],
    ["两", 2],
    ["三", 3],
    ["四", 4],
    ["五", 5],
    ["六", 6],
    ["七", 7],
    ["八", 8],
    ["九", 9]
  ]);
  if (text === "十") return 10;
  if (text.includes("十")) {
    const [left, right] = text.split("十");
    const tens = left ? digits.get(left) : 1;
    const ones = right ? digits.get(right) : 0;
    if (tens == null || ones == null) return null;
    return (tens * 10) + ones;
  }
  return digits.get(text) ?? null;
}

function explicitOrdinalResultReference(currentMessage, state) {
  const input = String(currentMessage ?? "");
  const match = input.match(
    /第\s*([零〇一二两三四五六七八九十\d]{1,3})\s*(?:套|个|项|种|组|方案|阵容|推荐)/u
  );
  const ordinal = chineseOrdinalNumber(match?.[1]);
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 100) return null;
  return {
    scope: state?.lastResult ? "last_result" : "current_output",
    ordinal
  };
}

function enforceExplicitOrdinalReference(delta, currentMessage, state) {
  const reference = explicitOrdinalResultReference(currentMessage, state);
  if (!reference) return createTurnDelta(delta);
  const explicitItemExclusion = /(?:不用|不要|别用|排除|不能用|不带)/u.test(
    String(currentMessage ?? "")
  );
  const constraintOperations = explicitItemExclusion
    ? delta.constraintOperations.map((operation) => (
      ["excludedItems", "avoidItemComponents"].includes(operation.field)
      && ["remove", "clear"].includes(operation.operation)
      && operation.value !== undefined
        ? {
          operation: "add",
          field: "excludedItems",
          value: operation.value
        }
        : operation
    ))
    : delta.constraintOperations;
  const presentation = {
    ...(delta?.presentation ?? {}),
    resultReference: delta?.presentation?.resultReference ?? reference
  };
  if (presentation.resultReference.scope !== "last_result") {
    return createTurnDelta({ ...delta, constraintOperations, presentation });
  }
  return createTurnDelta({
    ...delta,
    dialogueAct: "modify",
    taskRelation: "modify",
    constraintOperations,
    presentation,
    confidence: Math.max(Number(delta?.confidence ?? 0), 0.9)
  });
}

function compactFrame(frame) {
  if (!frame) return null;
  const compactEntity = (entity) => ({
    rawText: entity.rawText,
    expectedType: entity.expectedType,
    resolvedId: entity.resolvedId,
    canonicalName: entity.canonicalName ?? null
  });
  return {
    domain: frame.domain,
    action: frame.action,
    goal: frame.goal,
    subjects: array(frame.subjects).map(compactEntity),
    candidates: array(frame.candidates).map(compactEntity),
    concepts: array(frame.concepts).map(compactEntity),
    constraints: clone(frame.constraints),
    understandingStatus: frame.understandingStatus
  };
}

export function compactConversationStateForInterpreter(state = {}) {
  return {
    activeTaskSummary: compactFrame(state.activeTask?.taskFrame),
    recentTaskSummaries: array(state.taskHistory).slice(-3).map((entry) => compactFrame(entry.taskFrame)),
    lastResultSummary: state.lastResult ? {
      resultType: state.lastResult.resultType,
      returnedCount: state.lastResult.returnedCount,
      totalCount: state.lastResult.totalCount,
      exhausted: state.lastResult.exhausted,
      shownIds: array(state.lastResult.shownIds).map(String),
      shownEntities: clone(state.lastResult.shownEntities),
      entityType: state.lastResult.entityType,
      selectionScope: state.lastResult.selectionScope,
      sourceFilters: clone(state.lastResult.sourceFilters),
      appliedConstraints: clone(state.lastResult.appliedConstraints)
    } : null,
    pendingClarification: clone(state.pendingClarification)
  };
}

function actionOnlyBuildFollowupDelta(currentMessage, state, options = {}) {
  const input = String(currentMessage ?? "").trim();
  if (!ACTION_ONLY_BUILD_FOLLOWUP.test(input) && !SHORT_BUILD_FOLLOWUP.test(input)) return null;
  if (state?.pendingClarification) return null;
  const seasonChanged = Boolean(
    options.seasonContextId
    && state?.seasonContextId
    && String(options.seasonContextId) !== String(state.seasonContextId)
  );
  const lastResult = state?.lastResult;
  const shownEntities = array(lastResult?.shownEntities).filter((entity) => (
    entity?.apiName && ["unit", "champion"].includes(entity?.entityType)
  ));
  if (
    seasonChanged
    ||
    lastResult?.resultType !== "entity_catalog_results"
    || lastResult?.entityType !== "unit"
    || shownEntities.length === 0
  ) {
    const ambiguity = {
      code: "missing_subject",
      missingFields: ["subjects"],
      affectsToolSelection: true
    };
    return createTurnDelta({
      dialogueAct: "start_task",
      taskRelation: "new",
      explicitTaskFrame: createTaskFrame({
        domain: "tft",
        action: "recommend",
        goal: "unit_build_rankings",
        expectedOutput: ["recommendations", "results", "evidence"],
        ambiguities: [ambiguity],
        capabilityRequirements: ["unit_build_statistics"],
        confidence: 1,
        understandingStatus: "understood_but_missing_context"
      }),
      ambiguities: [ambiguity],
      confidence: 1
    });
  }
  return createTurnDelta({
    dialogueAct: "modify",
    taskRelation: "modify",
    explicitTaskFrame: createTaskFrame({
      domain: "tft",
      action: "recommend",
      candidates: shownEntities.map((entity) => ({
        rawText: entity.name ?? entity.apiName,
        expectedType: "champion",
        resolvedId: entity.apiName,
        source: "last_result",
        confidence: 1
      })),
      constraints: {
        targetEntityType: "champion",
        selectionScope: "last_result"
      },
      goal: "recommend_builds_for_candidate_group",
      expectedOutput: ["recommendations", "results", "evidence"],
      contextReferences: [{ type: "last_result", fields: ["shownEntities"] }],
      capabilityRequirements: ["unit_build_statistics"],
      confidence: 1,
      understandingStatus: "understood_and_supported"
    }),
    confidence: 1
  });
}

function explicitRankModificationDelta(currentMessage, state) {
  const input = String(currentMessage ?? "").trim();
  if (!state?.activeTask?.taskFrame || state?.pendingClarification) return null;
  if (!/^(?:修改|改成|改为|调整|只看|仅看|限定|段位(?:改成|改为|设为))/u.test(input)) return null;
  // A turn that explicitly names a new query surface remains a task switch.
  if (/(?:阵容|出装|装备|英雄|棋子|羁绊|神器|光明)/u.test(input)) return null;
  const rank = parseRankFilter(input);
  if (!rank?.length) return null;
  return createTurnDelta({
    dialogueAct: "modify",
    taskRelation: "modify",
    constraintOperations: [{ operation: "set", field: "rank", value: rank }],
    confidence: 1
  });
}

export function buildTurnInterpreterMessages({ currentMessage, state } = {}) {
  return [
    { role: "system", name: "turn_delta_rules", content: TURN_INTERPRETER_SYSTEM_RULES },
    {
      role: "user",
      name: "turn_context",
      content: JSON.stringify({
        currentMessage: String(currentMessage ?? ""),
        conversationState: compactConversationStateForInterpreter(state)
      })
    }
  ];
}

function materialFrame(frame) {
  return Boolean(
    frame
    && frame.domain === "tft"
    && frame.understandingStatus === "understood_and_supported"
    && (
      frame.action !== "unknown"
      || frame.subjects.length
      || frame.candidates.length
      || frame.concepts.length
      || Object.keys(frame.constraints).length
    )
  );
}

function clarifiableFirstTurnFrame(frame) {
  return Boolean(
    frame
    && frame.domain === "tft"
    && frame.understandingStatus === "understood_but_missing_context"
    && frame.ambiguities.some((entry) => entry?.affectsToolSelection === true)
    && (
      frame.subjects.length
      || frame.candidates.length
      || frame.concepts.length
    )
  );
}

function isExplicitSelfContainedTask(currentMessage) {
  const input = String(currentMessage ?? "").trim();
  if (!input) return false;
  if (isActionOnlyBuildFollowup(input)) return false;
  if (/^(?:怎么|如何|咋|怎样)(?:出装|配装|给装备)/u.test(input)) return false;
  if (/(?:这个|那个|这些|那些|上述|上一个|刚才|继续|接着|再来|再看|改成|换成|第[一二三四五六七八九十\d]+|它们?|他们)/u.test(input)) {
    return false;
  }
  return /(?:热门阵容|阵容趋势|阵容排行|三件装备|出装|装备排行|英雄属性|棋子属性|技能(?:详情|介绍)?|羁绊(?:详情|效果)?)/u.test(input);
}

function deterministicExplicitTaskFrame(currentMessage) {
  const input = String(currentMessage ?? "").trim();
  const patch = /(?:当前版本|当前patch|current\s*patch)/iu.test(input) ? "current" : undefined;
  const categoryRanking = explicitUnitItemCategoryRanking(input);
  if (categoryRanking) {
    return createTaskFrame({
      action: "rank",
      goal: categoryRanking.goal,
      subjects: [{
        rawText: categoryRanking.unitMention,
        expectedType: "champion",
        resolvedId: null,
        confidence: 1
      }],
      constraints: {
        ...(patch ? { patch } : {}),
        itemPolicy: categoryRanking.itemPolicy,
        itemCategories: [categoryRanking.itemCategory]
      },
      expectedOutput: ["ranking", "results", "evidence"],
      capabilityRequirements: ["unit_build_statistics"],
      confidence: 1,
      understandingStatus: "understood_and_supported"
    });
  }
  if (/(?:阵容|版本|当前).{0,8}(?:趋势|上升|下降)|(?:趋势|上升|下降).{0,8}阵容/u.test(input)) {
    return createTaskFrame({
      action: "analyze",
      goal: "comp_trends",
      constraints: patch ? { patch } : {},
      confidence: 1,
      understandingStatus: "understood_and_supported"
    });
  }
  if (/(?:热门阵容|阵容热门|最热门)/u.test(input)
    && !/(?:这个|那个|上一个|刚才|继续|接着|再来|再看|改成|换成)/u.test(input)) {
    return createTaskFrame({
      action: "rank",
      goal: "comp_rankings",
      constraints: {
        ...(patch ? { patch } : {}),
        metrics: ["popularity"],
        limit: 21
      },
      confidence: 1,
      understandingStatus: "understood_and_supported"
    });
  }
  const unitBuildMatch = input.match(
    /^(?:查询|查看|推荐|告诉我)?\s*([\p{L}\p{N}·.'_-]{1,32}?)(?:的)?(?:当前版本)?(?:最稳|最好|推荐)?(?:的)?(?:三件|3件)?(?:装备|出装)/u
  );
  const unitMention = String(unitBuildMatch?.[1] ?? "").trim();
  if (unitMention && !/(?:谁|哪些|其中|棋子|[一二三四五六七八九十\d]+费|表现|比较|对比)/u.test(input)) {
    return createTaskFrame({
      action: "recommend",
      goal: "unit_build_rankings",
      subjects: [{
        rawText: unitMention,
        expectedType: "champion",
        resolvedId: null,
        confidence: 1
      }],
      constraints: {
        ...(patch ? { patch } : {}),
        itemCount: 3
      },
      confidence: 1,
      understandingStatus: "understood_and_supported"
    });
  }
  return null;
}

function deterministicFallbackDelta(frame, state) {
  if (state?.activeTask?.taskFrame) {
    return unknownTurnDelta("provider_required_for_contextual_turn");
  }
  if (!materialFrame(frame) && !clarifiableFirstTurnFrame(frame)) {
    return unknownTurnDelta("provider_unavailable");
  }
  if (!state?.activeTask?.taskFrame) {
    return createTurnDelta({
      dialogueAct: "start_task",
      taskRelation: "new",
      explicitTaskFrame: frame,
      confidence: frame.confidence
    });
  }
  return unknownTurnDelta("provider_unavailable");
}

function weakProviderFirstTurnDelta(delta) {
  if (delta?.taskRelation === "unknown" || delta?.dialogueAct === "unknown") return true;
  const frame = delta?.explicitTaskFrame;
  if (!frame || Number(delta?.confidence ?? 0) < 0.75) return true;
  const entities = [...array(frame.subjects), ...array(frame.candidates), ...array(frame.concepts)];
  if (entities.some((entity) => !entity?.resolvedId && Number(entity?.confidence ?? 0) < 0.8)) {
    return true;
  }
  return array(delta.ambiguities).some((entry) => entry?.affectsToolSelection !== false)
    || array(frame.ambiguities).some((entry) => entry?.affectsToolSelection !== false);
}

function providerFrameCoversSemanticCorrection(frame, normalization) {
  if (!array(normalization?.corrections).length) return true;
  const correctedNames = new Set(array(normalization.corrections).map((entry) => entry?.to));
  const entities = [...array(frame?.subjects), ...array(frame?.candidates), ...array(frame?.concepts)];
  return entities.some((entity) => (
    entity?.expectedType === "item"
    && correctedNames.has(String(entity?.rawText ?? entity?.canonicalName ?? ""))
  ));
}

function emptyContextualContinuation(delta) {
  return Boolean(
    delta
    && ["continue", "modify"].includes(delta.taskRelation)
    && !delta.explicitTaskFrame
    && array(delta.entityOperations).length === 0
    && array(delta.constraintOperations).length === 0
    && !delta.presentation?.resultReference
  );
}

function hasMaterialContextualRecoveryCue(currentMessage) {
  return /(?:[一二两兩三四五六七八九\d]\s*费|出装|出裝|给装|給裝|配装|配裝|带什么装备|帶什麼裝備|有哪些|有什麼|有什么)/u
    .test(String(currentMessage ?? ""));
}

function contextualFallbackConversation(state) {
  const entries = array(state?.taskHistory)
    .map((entry) => entry?.taskFrame ? { taskFrame: entry.taskFrame } : null)
    .filter(Boolean);
  if (state?.activeTask?.taskFrame) {
    entries.push({ taskFrame: state.activeTask.taskFrame });
  }
  return entries;
}

function contextualFrameAddsMaterialSemantics(frame, activeFrame) {
  if (
    !frame
    || frame.domain !== "tft"
    || frame.understandingStatus !== "understood_and_supported"
  ) return false;
  const activeConstraints = activeFrame?.constraints ?? {};
  const addsConstraint = Object.entries(frame.constraints ?? {}).some(([key, value]) => (
    JSON.stringify(activeConstraints[key]) !== JSON.stringify(value)
  ));
  const activeRequirements = new Set(array(activeFrame?.capabilityRequirements));
  const addsCapability = array(frame.capabilityRequirements).some((requirement) => (
    !activeRequirements.has(requirement)
  ));
  return addsConstraint || addsCapability;
}

function providerFrameCoversContextualSemantics(providerFrame, contextualFrame) {
  if (!providerFrame || !contextualFrame) return false;
  const providerRequirements = new Set(array(providerFrame.capabilityRequirements));
  if (array(contextualFrame.capabilityRequirements).some((value) => !providerRequirements.has(value))) {
    return false;
  }
  const providerConstraints = providerFrame.constraints ?? {};
  for (const key of ["cost", "targetEntityType", "relation"]) {
    const expected = contextualFrame.constraints?.[key];
    if (expected !== undefined && expected !== null && providerConstraints[key] !== expected) {
      return false;
    }
  }
  return providerFrame.action === contextualFrame.action
    && providerFrame.understandingStatus === "understood_and_supported";
}

function sanitizeContextualFallbackFrame(frame, domainPolicy) {
  if (!frame || typeof domainPolicy?.validateTaskFrame !== "function") {
    return frame ? createTaskFrame(frame) : null;
  }
  const constraints = {};
  for (const [key, value] of Object.entries(frame.constraints ?? {})) {
    const candidate = createTaskFrame({
      ...frame,
      constraints: { [key]: value }
    });
    if (array(domainPolicy.validateTaskFrame(candidate)).length === 0) {
      constraints[key] = value;
    }
  }
  return createTaskFrame({ ...frame, constraints });
}

function rawEntityReference(value, expectedType) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      rawText: String(value.rawText ?? value.resolvedId ?? ""),
      expectedType: value.expectedType ?? expectedType,
      resolvedId: value.resolvedId ?? null,
      confidence: value.confidence ?? null,
      source: value.source ?? "turn_delta"
    };
  }
  return {
    rawText: String(value ?? ""),
    expectedType,
    resolvedId: null,
    confidence: null,
    source: "turn_delta"
  };
}

async function linkConstraintReferences(frame, options) {
  if (!frame || !options.catalog || options.entityLinking === false) return frame;
  let linked = await linkTaskFrameEntities(frame, {
    catalog: options.catalog,
    patch: options.version,
    semanticRetriever: options.entitySemanticRetriever,
    candidateRetriever: options.entityCandidateRetriever,
    candidateReranker: options.entityCandidateReranker
  });
  const constraints = clone(linked.constraints);
  for (const [field, expectedType] of [
    ["lockedItems", "item"],
    ["ownedItems", "item"],
    ["excludedItems", "item"],
    ["avoidItemComponents", "item"],
    ["comparisonItems", "item"],
    ["traitFilters", "trait"]
  ]) {
    if (!Array.isArray(constraints[field])) continue;
    const references = constraints[field].map((value) => rawEntityReference(value, expectedType));
    const holderField = expectedType === "trait" ? "concepts" : "candidates";
    const holder = createTaskFrame({
      action: "search",
      goal: "resolve_constraint_entities",
      [holderField]: references,
      understandingStatus: "understood_and_supported"
    });
    const resolved = await linkTaskFrameEntities(holder, {
      catalog: options.catalog,
      patch: options.version,
      semanticRetriever: options.entitySemanticRetriever,
      candidateRetriever: options.entityCandidateRetriever,
      candidateReranker: options.entityCandidateReranker
    });
    constraints[field] = resolved[holderField];
  }
  return createTaskFrame({ ...linked, constraints });
}

function catalogId(value) {
  return /^TFT\d+_/u.test(String(value ?? ""));
}

function taskFrameNeedsEntityLinking(frame) {
  const entities = [
    ...array(frame?.subjects),
    ...array(frame?.candidates),
    ...array(frame?.concepts)
  ];
  if (entities.some((entity) => !entity?.resolvedId)) return true;
  for (const field of [
    "lockedItems",
    "ownedItems",
    "excludedItems",
    "avoidItemComponents",
    "comparisonItems",
    "traitFilters"
  ]) {
    for (const value of array(frame?.constraints?.[field])) {
      if (typeof value === "string" && !catalogId(value)) return true;
      if (value && typeof value === "object" && !value.resolvedId) return true;
    }
  }
  const comp = frame?.constraints?.comp;
  return Boolean(comp && typeof comp === "object" && !comp.resolvedId);
}

async function linkReferenceValues(values, expectedType, holderField, options) {
  const references = array(values).map((value) => rawEntityReference(value, expectedType));
  if (!references.length) return [];
  const holder = createTaskFrame({
    action: "search",
    goal: "resolve_turn_delta_entities",
    [holderField]: references,
    understandingStatus: "understood_and_supported"
  });
  const linked = await linkTaskFrameEntities(holder, {
    catalog: options.catalog,
    patch: options.version,
    semanticRetriever: options.entitySemanticRetriever,
    candidateRetriever: options.entityCandidateRetriever,
    candidateReranker: options.entityCandidateReranker
  });
  return linked[holderField];
}

async function linkTurnDeltaReferences(delta, options) {
  if (!options.catalog || options.entityLinking === false) return delta;
  const entityOperations = [];
  for (const operation of delta.entityOperations) {
    const expectedType = operation.field === "subjects"
      ? "champion"
      : operation.field === "candidates"
        ? "item"
        : "game_concept";
    const next = { ...operation };
    if (operation.value !== undefined) {
      next.value = await linkReferenceValues(
        operation.value,
        expectedType,
        operation.field,
        options
      );
    }
    if (operation.oldValue !== undefined) {
      next.oldValue = await linkReferenceValues(
        operation.oldValue,
        expectedType,
        operation.field,
        options
      );
    }
    entityOperations.push(next);
  }
  const constraintOperations = [];
  const constraintTypes = new Map([
    ["lockedItems", ["item", "candidates"]],
    ["ownedItems", ["item", "candidates"]],
    ["excludedItems", ["item", "candidates"]],
    ["avoidItemComponents", ["item", "candidates"]],
    ["comparisonItems", ["item", "candidates"]],
    ["traitFilters", ["trait", "concepts"]],
    ["comp", ["composition", "concepts"]]
  ]);
  for (const operation of delta.constraintOperations) {
    const referenceType = constraintTypes.get(operation.field);
    if (!referenceType) {
      constraintOperations.push(operation);
      continue;
    }
    const [expectedType, holderField] = referenceType;
    const next = { ...operation };
    for (const key of ["value", "oldValue"]) {
      if (operation[key] === undefined || operation[key] === null) continue;
      const linked = await linkReferenceValues(
        Array.isArray(operation[key]) ? operation[key] : [operation[key]],
        expectedType,
        holderField,
        options
      );
      next[key] = operation.field === "comp" ? linked[0] ?? null : linked;
    }
    constraintOperations.push(next);
  }
  return createTurnDelta({
    ...delta,
    explicitTaskFrame: delta.explicitTaskFrame
      ? taskFrameNeedsEntityLinking(delta.explicitTaskFrame)
        ? await linkConstraintReferences(delta.explicitTaskFrame, options)
        : createTaskFrame(delta.explicitTaskFrame)
      : null,
    entityOperations,
    constraintOperations
  });
}

async function explicitFrameForFallback(currentMessage, options, conversationState = null) {
  if (options.explicitTaskFrame) return createTaskFrame(options.explicitTaskFrame);
  const parser = options.semanticTaskParser ?? parseSemanticTask;
  try {
    const result = await parser(currentMessage, {
      catalog: options.catalog,
      conversation: contextualFallbackConversation(conversationState),
      dynamicContext: {
        version: options.version ?? null,
        currentTime: options.currentTime ?? null
      },
      exampleStore: options.semanticExampleStore,
      entitySemanticRetriever: options.entitySemanticRetriever,
      entityCandidateRetriever: options.entityCandidateRetriever,
      entityCandidateReranker: options.entityCandidateReranker
    });
    return result?.taskFrame ? createTaskFrame(result.taskFrame) : null;
  } catch {
    return null;
  }
}

export async function interpretTurn({
  currentMessage,
  conversationState,
  semanticProvider,
  domainPolicy,
  ...options
} = {}) {
  const semanticNormalization = typeof domainPolicy?.normalizeSemanticInput === "function"
    ? domainPolicy.normalizeSemanticInput(currentMessage, options)
    : { originalInput: String(currentMessage ?? ""), normalizedInput: String(currentMessage ?? ""), corrections: [] };
  const semanticMessage = String(semanticNormalization?.normalizedInput ?? currentMessage ?? "");
  const explicitSelfContainedTask = isExplicitSelfContainedTask(semanticMessage);
  const deterministicExplicitFrame = deterministicExplicitTaskFrame(semanticMessage);
  const deterministicCategoryRanking = Boolean(
    deterministicExplicitFrame
    && ["unit_item_rankings", "unit_emblem_rankings"].includes(deterministicExplicitFrame.goal)
    && array(deterministicExplicitFrame.constraints?.itemCategories).length === 1
  );
  const interpreterState = explicitSelfContainedTask
    ? {
      ...conversationState,
      activeTask: null,
      lastResult: null,
      pendingClarification: null
    }
    : conversationState;
  const messages = buildTurnInterpreterMessages({
    currentMessage: semanticMessage,
    state: interpreterState
  });
  let providerFallback = null;
  let rawDelta = null;
  let providerCalled = false;
  let providerSucceeded = false;
  let providerUsage = null;
  let providerError = null;
  if (!deterministicCategoryRanking && typeof semanticProvider === "function") {
    providerCalled = true;
    try {
      const response = await semanticProvider({
        messages,
        schemaVersion: "turn-delta.v1",
        budget: options.budget,
        domainPolicy
      });
      providerSucceeded = true;
      providerUsage = response?.usage ?? null;
      rawDelta = response?.turnDelta ?? response;
      const rawValidation = validateTurnDelta(rawDelta);
      if (!rawValidation.valid) {
        throw new TypeError(`Invalid TurnDelta: ${rawValidation.errors.join("; ")}`);
      }
      rawDelta = createTurnDelta(
        typeof domainPolicy?.normalizeTurnDelta === "function"
          ? domainPolicy.normalizeTurnDelta(rawDelta)
          : rawDelta
      );
      const domainValidation = validateTurnDelta(rawDelta, { domainPolicy });
      if (!domainValidation.valid) {
        throw new TypeError(`Invalid TurnDelta: ${domainValidation.errors.join("; ")}`);
      }
    } catch (error) {
      providerError = String(error?.message ?? error ?? "provider_error").slice(0, 500);
      providerFallback = {
        used: true,
        reason: error?.name === "TypeError" ? "invalid_response" : "provider_error",
        error: providerError
      };
      rawDelta = null;
    }
  } else if (!deterministicCategoryRanking) {
    providerFallback = { used: true, reason: "provider_unavailable" };
  }
  let delta;
  if (deterministicExplicitFrame) {
    delta = createTurnDelta({
      dialogueAct: "start_task",
      taskRelation: "new",
      explicitTaskFrame: deterministicExplicitFrame,
      confidence: 1
    });
  } else if (rawDelta) {
    delta = enforceExplicitOrdinalReference(
      createTurnDelta(rawDelta),
      currentMessage,
      interpreterState
    );
    if (explicitSelfContainedTask
      && !["new", "switch"].includes(delta.taskRelation)) {
      const explicit = await explicitFrameForFallback(semanticMessage, options);
      if (materialFrame(explicit) || clarifiableFirstTurnFrame(explicit)) {
        delta = createTurnDelta({
          dialogueAct: "start_task",
          taskRelation: "new",
          explicitTaskFrame: explicit,
          confidence: explicit.confidence
        });
        providerFallback = {
          used: true,
          reason: "self_contained_task_recovery"
        };
      }
    }
    const hasConversationContext = Boolean(
      interpreterState?.activeTask?.taskFrame
      || interpreterState?.pendingClarification
    );
    if (
      !hasConversationContext
      && !providerFrameCoversSemanticCorrection(delta.explicitTaskFrame, semanticNormalization)
    ) {
      const explicit = await explicitFrameForFallback(semanticMessage, options);
      if (materialFrame(explicit) || clarifiableFirstTurnFrame(explicit)) {
        delta = deterministicFallbackDelta(explicit, interpreterState);
        providerFallback = {
          used: true,
          reason: "catalog_backed_input_correction"
        };
      }
    }
    if (!hasConversationContext && weakProviderFirstTurnDelta(delta)) {
      const explicit = await explicitFrameForFallback(semanticMessage, options);
      if (
        (materialFrame(explicit) && Number(explicit.confidence ?? 0) >= 0.85)
        || clarifiableFirstTurnFrame(explicit)
      ) {
        delta = deterministicFallbackDelta(explicit, interpreterState);
        providerFallback = {
          used: true,
          reason: "self_contained_task_recovery"
        };
      }
    }
    if (hasConversationContext && emptyContextualContinuation(delta)) {
      const contextual = sanitizeContextualFallbackFrame(
        await explicitFrameForFallback(
          semanticMessage,
          options,
          interpreterState
        ),
        domainPolicy
      );
      if (contextualFrameAddsMaterialSemantics(
        contextual,
        interpreterState?.activeTask?.taskFrame
      )) {
        delta = createTurnDelta({
          ...delta,
          dialogueAct: "modify",
          taskRelation: "modify",
          explicitTaskFrame: contextual,
          confidence: Math.max(Number(delta.confidence ?? 0), Number(contextual.confidence ?? 0)),
          ambiguities: contextual.ambiguities
        });
        providerFallback = {
          used: true,
          reason: "contextual_task_recovery"
        };
      }
    }
    if (
      hasConversationContext
      && hasMaterialContextualRecoveryCue(semanticMessage)
      && providerFallback?.reason !== "contextual_task_recovery"
    ) {
      const contextual = sanitizeContextualFallbackFrame(
        await explicitFrameForFallback(semanticMessage, options, interpreterState),
        domainPolicy
      );
      if (
        contextualFrameAddsMaterialSemantics(
          contextual,
          interpreterState?.activeTask?.taskFrame
        )
        && !providerFrameCoversContextualSemantics(delta.explicitTaskFrame, contextual)
      ) {
        delta = createTurnDelta({
          ...delta,
          dialogueAct: "modify",
          taskRelation: "modify",
          explicitTaskFrame: contextual,
          confidence: Math.max(Number(delta.confidence ?? 0), Number(contextual.confidence ?? 0)),
          ambiguities: contextual.ambiguities
        });
        providerFallback = {
          used: true,
          reason: "contextual_task_recovery",
          trigger: "incomplete_contextual_semantics"
        };
      }
    }
  } else {
    const hasConversationContext = Boolean(
      interpreterState?.activeTask?.taskFrame
      || interpreterState?.pendingClarification
    );
    let explicit = options.explicitTaskFrame
      ? createTaskFrame(options.explicitTaskFrame)
      : typeof semanticProvider !== "function" || !hasConversationContext
        ? await explicitFrameForFallback(semanticMessage, options)
        : null;
    if (
      hasConversationContext
      && !explicit
      && hasMaterialContextualRecoveryCue(semanticMessage)
    ) {
      explicit = sanitizeContextualFallbackFrame(
        await explicitFrameForFallback(semanticMessage, options, interpreterState),
        domainPolicy
      );
    }
    if (
      hasConversationContext
      && contextualFrameAddsMaterialSemantics(
        explicit,
        interpreterState?.activeTask?.taskFrame
      )
    ) {
      const providerFailureReason = providerFallback?.reason ?? "provider_unavailable";
      delta = createTurnDelta({
        dialogueAct: "modify",
        taskRelation: "modify",
        explicitTaskFrame: explicit,
        confidence: Number(explicit.confidence ?? 0.9),
        ambiguities: explicit.ambiguities
      });
      providerFallback = {
        used: true,
        reason: "contextual_task_recovery",
        trigger: providerFailureReason
      };
    } else {
      delta = explicitSelfContainedTask && (materialFrame(explicit) || clarifiableFirstTurnFrame(explicit))
        ? createTurnDelta({
          dialogueAct: "start_task",
          taskRelation: "new",
          explicitTaskFrame: explicit,
          confidence: explicit.confidence
        })
        : deterministicFallbackDelta(explicit, interpreterState);
    }
  }
  const actionOnlyBuildDelta = actionOnlyBuildFollowupDelta(
    semanticMessage,
    interpreterState,
    options
  );
  if (actionOnlyBuildDelta) {
    delta = actionOnlyBuildDelta;
    providerFallback = {
      used: true,
      reason: "action_only_build_followup_policy"
    };
  }
  const explicitRankDelta = explicitRankModificationDelta(semanticMessage, interpreterState);
  if (explicitRankDelta) {
    delta = explicitRankDelta;
    providerFallback = {
      used: true,
      reason: "explicit_rank_modification_policy"
    };
  }
  delta = await linkTurnDeltaReferences(delta, options);
  const hasConversationContext = Boolean(
    interpreterState?.activeTask?.taskFrame
    || interpreterState?.pendingClarification
  );
  if (!actionOnlyBuildDelta && !hasConversationContext && weakProviderFirstTurnDelta(delta)) {
    const explicit = await explicitFrameForFallback(semanticMessage, options);
    if (
      (materialFrame(explicit) && Number(explicit.confidence ?? 0) >= 0.85)
      || clarifiableFirstTurnFrame(explicit)
    ) {
      delta = await linkTurnDeltaReferences(
        deterministicFallbackDelta(explicit, interpreterState),
        options
      );
      providerFallback = {
        used: true,
        reason: "self_contained_task_recovery"
      };
    }
  }
  delta = normalizeContextualTurnDelta(interpreterState, delta);
  let validation = validateTurnDelta(delta, { domainPolicy });
  if (!validation.valid) {
    const hasActiveTask = Boolean(interpreterState?.activeTask?.taskFrame);
    if (!hasActiveTask) {
      const explicit = await explicitFrameForFallback(semanticMessage, options);
      let fallbackDelta = deterministicFallbackDelta(explicit, interpreterState);
      fallbackDelta = await linkTurnDeltaReferences(fallbackDelta, options);
      fallbackDelta = normalizeContextualTurnDelta(interpreterState, fallbackDelta);
      const fallbackValidation = validateTurnDelta(fallbackDelta, { domainPolicy });
      if (fallbackValidation.valid && fallbackDelta.taskRelation !== "unknown") {
        delta = fallbackDelta;
        validation = fallbackValidation;
        providerFallback = { used: true, reason: "invalid_response" };
      } else {
        delta = unknownTurnDelta("invalid_interpreter_output");
      }
    } else {
      delta = unknownTurnDelta("invalid_interpreter_output");
    }
  }
  return {
    schemaVersion: TURN_INTERPRETER_VERSION,
    turnDelta: delta,
    telemetry: {
      provider: typeof semanticProvider === "function" ? "injected" : "deterministic",
      providerFallback,
      providerCalled,
      providerSucceeded,
      providerUsage,
      providerError,
      semanticNormalization,
      stateSummary: compactConversationStateForInterpreter(conversationState)
    },
    messages
  };
}
