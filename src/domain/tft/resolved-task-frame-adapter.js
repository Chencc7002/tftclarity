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
  const intent = intentFor(frame, options.executionPlan);
  const carrierItem = intent === "item_carrier_rankings"
    ? resolvedValue(itemCandidates[0])
    : null;
  const requestedCount = options.presentation?.requestedCount
    ?? options.lastResult?.returnedCount
    ?? constraints.limit
    ?? 3;
  const requestMore = ["request_more", "next_page"].includes(options.dialogueAct);
  const limit = requestMore
    ? Math.min(100, array(options.lastResult?.shownIds).length + requestedCount)
    : constraints.limit;
  const comparisonItems = constraintEntityValues(
    constraints.comparisonItems ?? (frame.action === "compare" ? itemCandidates : [])
  );
  const lockedItems = constraintEntityValues(constraints.lockedItems ?? constraints.ownedItems);
  const excludedItems = constraintEntityValues(constraints.excludedItems);
  const traitFilters = constraintEntityValues(constraints.traitFilters ?? traitConcepts);
  const strategy = constraints.strategy ?? (constraints.specialMode ? "reroll" : undefined);
  const popularRequested = intent === "comp_rankings"
    && array(constraints.metrics).includes("popularity")
    && (
      constraints.limit == null
      || Number(constraints.limit) >= 21
    );
  const parsed = {
    rawInput: String(options.input ?? ""),
    intent,
    ...(unit ? { unit, unitAlias: subjects.find((entity) => entity.expectedType === "champion")?.rawText } : {}),
    ...(comparisonItems.length ? { comparisonItems, comparisonMode: "exclusive_presence" } : {}),
    ...(carrierItem ? { carrierItem } : {}),
    ...(lockedItems.length ? { lockedItems, ownedItems: lockedItems } : {}),
    ...(excludedItems.length ? { excludedItems } : {}),
    ...(traitFilters.length ? { traitFilters } : {}),
    ...(compConcept ? { compMention: resolvedValue(compConcept) } : {}),
    ...(constraints.rank ?? constraints.rankFilter ? { rankFilter: constraints.rank ?? constraints.rankFilter } : {}),
    ...Object.fromEntries(
      ["days", "patch", "queue", "starLevel", "itemCount", "minSamples", "sort", "metrics", "specialMode",
        "itemPolicy", "itemCategories", "primaryMetric", "performanceItem"]
        .filter((key) => constraints[key] !== undefined)
        .map((key) => [key, structuredClone(constraints[key])])
    ),
    ...(limit !== undefined ? { limit } : {}),
    ...(strategy ? {
      preferenceRequested: intent === "comp_rankings",
      preferenceConditions: {
        strategy,
        reroll: strategy === "reroll" ? true : null,
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
        normalizedInput: normalizeAlias(options.input)
      }
    }
  };
  return parsed;
}
