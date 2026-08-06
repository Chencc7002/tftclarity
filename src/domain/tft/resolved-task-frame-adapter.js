import { normalizeAlias } from "../../core/normalizer.js";

export const TFT_RESOLVED_TASK_FRAME_ADAPTER_VERSION = "tft-resolved-task-frame-adapter.v1";

const LEGACY_INTENTS = new Set([
  "unit_best_3_items",
  "unit_build_rankings",
  "unit_build_completion",
  "unit_item_rankings",
  "unit_emblem_rankings",
  "unit_item_comparison",
  "item_carrier_rankings",
  "unit_item_availability",
  "unit_details",
  "item_details",
  "trait_details",
  "comp_rankings",
  "comp_trends",
  "comp_analysis"
]);

const TOOL_INTENTS = Object.freeze({
  unit_builds: "unit_build_rankings",
  unit_details: "unit_details",
  item_details: "item_details",
  trait_details: "trait_details",
  item_carrier_rankings: "item_carrier_rankings",
  comps_rankings: "comp_rankings",
  comps_trends: "comp_trends",
  comps_analysis: "comp_analysis",
  semantic_search: "unit_item_availability"
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function resolvedValue(entity) {
  return entity?.resolvedId ?? entity?.rawText ?? null;
}

function constraintEntityValues(values) {
  return array(values).map((value) => (
    typeof value === "string" ? value : resolvedValue(value)
  )).filter(Boolean);
}

function genericItemCategory(value) {
  return /^(?:(?:\u5965\u6069)?\u795e\u5668|\u5149\u660e(?:\u88c5\u5907)?|\u7eb9\u7ae0|\u8f6c\u804c)$/u.test(String(value ?? "").trim());
}

function intentFor(frame, executionPlan) {
  // The registered execution plan is the runtime's concrete routing decision.
  // It must take precedence over a legacy goal retained for conversation
  // compatibility, otherwise a generic ranking task can be forced back into
  // an unrelated legacy intent.
  const toolIntent = TOOL_INTENTS[executionPlan?.steps?.[0]?.tool];
  if (toolIntent) return toolIntent;
  if (LEGACY_INTENTS.has(frame.goal)) return frame.goal;
  const types = new Set([
    ...array(frame.subjects),
    ...array(frame.candidates),
    ...array(frame.concepts)
  ].map((entity) => entity.expectedType));
  const requirements = new Set(array(frame.capabilityRequirements));
  if (types.has("item") && requirements.has("item_carrier_statistics")) {
    return "item_carrier_rankings";
  }
  if (types.has("champion")) {
    if (frame.action === "compare") return "unit_item_comparison";
    if (frame.action === "rank") return "unit_item_rankings";
    if (frame.action === "explain") return "unit_details";
    return "unit_build_rankings";
  }
  if (types.has("composition") || frame.constraints.strategy || frame.constraints.specialMode) {
    return frame.action === "analyze" ? "comp_trends" : "comp_rankings";
  }
  return frame.action === "analyze" ? "comp_analysis" : "comp_rankings";
}

export function resolvedTaskFrameToParsed(frame, options = {}) {
  const constraints = frame?.constraints ?? {};
  const subjects = array(frame?.subjects);
  const candidates = array(frame?.candidates);
  const concepts = array(frame?.concepts);
  const unit = resolvedValue(subjects.find((entity) => entity.expectedType === "champion"));
  const itemCandidates = [...candidates, ...concepts]
    .filter((entity) => entity.expectedType === "item");
  const traitConcepts = concepts.filter((entity) => entity.expectedType === "trait");
  const compConcept = concepts.find((entity) => entity.expectedType === "composition");
  const compConstraint = constraints.comp?.expectedType === "composition"
    ? constraints.comp
    : null;
  const normalizedInput = normalizeAlias(options.input);
  const explicitTrendRequest = /(?:阵容|版本|当前).{0,8}(?:趋势|上升|下降)|(?:趋势|上升|下降).{0,8}阵容/u.test(normalizedInput);
  const explicitPopularRequest = /(?:热门阵容|阵容热门|最热门|热度|选择率)/u.test(normalizedInput);
  const explicitSingleItemRankingRequest = Boolean(unit) && (
    /(?:单件(?:装备)?|单装备|核心装备|核心装).{0,10}(?:排行|排名|榜|优先级|表现|最好|最强|怎么排|哪个好|哪个强)/u.test(normalizedInput)
    || /(?:排行|排名|榜|优先级|表现|最好|最强|怎么排|哪个好|哪个强).{0,10}(?:单件(?:装备)?|单装备|核心装备|核心装)/u.test(normalizedInput)
  );
  const explicitSpecialItemRankingRequest = Boolean(unit)
    && !/(?:三件|3件|三件套)/u.test(normalizedInput)
    && (
      /(?:神器|光明装备|光明装|纹章|转职).{0,10}(?:排行|排名|榜|优先级|表现|最好|最强|哪个好|哪个强)/u.test(normalizedInput)
      || /(?:排行|排名|榜|优先级|表现|最好|最强|哪个好|哪个强).{0,10}(?:神器|光明装备|光明装|纹章|转职)/u.test(normalizedInput)
    );
  const explicitUnitItemRankingRequest = explicitSingleItemRankingRequest
    || explicitSpecialItemRankingRequest;
  const routedIntent = intentFor(frame, options.executionPlan);
  // Deterministic wording must win over a model/default plan here. Otherwise a
  // clearly requested result type is silently degraded to a generic plan. In
  // particular, unit_builds serves both three-item builds and single-item
  // statistics, so the tool name alone cannot distinguish those contracts.
  const intent = explicitUnitItemRankingRequest
    && ["unit_best_3_items", "unit_build_rankings", "unit_item_rankings"].includes(routedIntent)
    ? "unit_item_rankings"
    : explicitTrendRequest && ["comp_rankings", "comp_trends", "comp_analysis"].includes(routedIntent)
      ? "comp_trends"
      : routedIntent;
  const carrierItem = intent === "item_carrier_rankings"
    ? resolvedValue(itemCandidates[0])
    : null;
  const requestedCount = options.presentation?.requestedCount
    ?? options.lastResult?.returnedCount
    ?? constraints.limit
    ?? 3;
  const requestMore = ["request_more", "next_page"].includes(options.dialogueAct);
  const explicitCount = /(?:前\s*)?\d+\s*(?:套|个|名)?|(?:几|若干)(?:套|个)/u.test(normalizedInput);
  const limit = requestMore
    ? Math.min(100, array(options.lastResult?.shownIds).length + requestedCount)
    : explicitPopularRequest
      && !explicitCount
      && !array(constraints.metrics).includes("popularity")
      ? 21
      : constraints.limit;
  const comparisonItems = constraintEntityValues(
    constraints.comparisonItems ?? (frame.action === "compare" ? itemCandidates : [])
  ).filter((value) => !genericItemCategory(value));
  const lockedItems = constraintEntityValues(constraints.lockedItems ?? constraints.ownedItems);
  const excludedItems = constraintEntityValues(constraints.excludedItems);
  const avoidItemComponents = constraintEntityValues(constraints.avoidItemComponents);
  const traitFilters = constraintEntityValues(constraints.traitFilters ?? traitConcepts);
  const strategy = constraints.strategy ?? (constraints.specialMode ? "reroll" : undefined);
  const reroll = constraints.reroll ?? (strategy === "reroll" ? true : null);
  const preferenceRequested = intent === "comp_rankings" && (
    strategy != null
    || reroll != null
    || constraints.contested != null
    || constraints.beginnerFriendly != null
    || avoidItemComponents.length > 0
  );
  const popularRequested = intent === "comp_rankings"
    && (explicitPopularRequest || array(constraints.metrics).includes("popularity"))
    && (limit == null || Number(limit) >= 21);
  const parsed = {
    rawInput: String(options.input ?? ""),
    intent,
    ...(unit ? { unit, unitAlias: subjects.find((entity) => entity.expectedType === "champion")?.rawText } : {}),
    ...(comparisonItems.length ? { comparisonItems, comparisonMode: "exclusive_presence" } : {}),
    ...(carrierItem ? { carrierItem } : {}),
    ...(lockedItems.length ? { lockedItems, ownedItems: lockedItems } : {}),
    ...(excludedItems.length ? { excludedItems } : {}),
    ...(avoidItemComponents.length ? { avoidItemComponents } : {}),
    ...(traitFilters.length ? { traitFilters } : {}),
    ...(compConstraint ? {
      compId: resolvedValue(compConstraint),
      compMention: compConstraint.rawText
    } : compConcept ? { compMention: resolvedValue(compConcept) } : {}),
    ...(constraints.rank ?? constraints.rankFilter ? { rankFilter: constraints.rank ?? constraints.rankFilter } : {}),
    ...Object.fromEntries(
      ["days", "patch", "queue", "starLevel", "itemCount", "minSamples", "sort", "metrics", "specialMode",
        "itemPolicy", "itemCategories", "primaryMetric", "performanceItem"]
        .filter((key) => constraints[key] !== undefined)
        .map((key) => [key, structuredClone(constraints[key])])
    ),
    ...(limit !== undefined ? { limit } : {}),
    ...(preferenceRequested ? {
      preferenceRequested: true,
      preferenceConditions: {
        strategy: strategy ?? null,
        reroll,
        goal: null,
        contested: constraints.contested ?? null,
        difficulty: null,
        beginnerFriendly: constraints.beginnerFriendly ?? null,
        count: Number.isInteger(limit) ? limit : requestedCount,
        returnAll: false
      }
    } : {}),
    ...(intent === "comp_rankings" ? {
      popularRequested,
      trendRequested: false
    } : intent === "comp_trends" ? {
      popularRequested: false,
      trendRequested: true
    } : {}),
    parser: {
      intentExplicit: true,
      usedLLM: options.providerUsed === true,
      entityMatches: [
        ...subjects,
        ...candidates,
        ...concepts
      ].filter((entity) => entity.resolvedId).map((entity) => ({
        entityType: entity.expectedType === "champion" ? "unit" : entity.expectedType,
        apiName: entity.resolvedId,
        alias: entity.rawText,
        matchType: "conversation_state",
        confidence: entity.confidence ?? 1
      })),
      unresolvedEntityHints: [],
      entityAmbiguities: [],
      conversationStateV2: {
        schemaVersion: TFT_RESOLVED_TASK_FRAME_ADAPTER_VERSION,
        taskRelation: options.taskRelation,
        dialogueAct: options.dialogueAct,
        avoidSeen: options.presentation?.avoidSeen === true,
        normalizedInput
      }
    }
  };
  return parsed;
}
