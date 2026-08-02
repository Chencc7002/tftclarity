import { TURN_DELTA_CONSTRAINT_FIELDS } from "../../understanding/turn-delta.js";
import { createTaskFrame } from "../../understanding/task-frame.js";
import { normalizeTftSemanticInput } from "../../core/semantic-input-normalizer.js";

export const TFT_CONVERSATION_POLICY_VERSION = "tft-conversation-policy.v1";

const RANKS = new Set([
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER"
]);
const STRATEGIES = new Set(["reroll", "fast8", "fast9"]);
const SORTS = new Set([
  "top4_first",
  "win_first",
  "avg_first",
  "games_first",
  "robust_first",
  "uplift_first"
]);
const METRICS = new Set(["top4_rate", "win_rate", "win_share", "avg_placement", "popularity"]);
const ITEM_POLICIES = new Set([
  "ordinary_only",
  "include_special",
  "include_artifact",
  "include_radiant",
  "all_current"
]);
const ITEM_CATEGORIES = new Set([
  "ordinary",
  "radiant",
  "artifact",
  "emblem",
  "support",
  "set_special"
]);
const TFT_EXPLICIT_TASK_CONSTRAINT_FIELDS = new Set([
  ...TURN_DELTA_CONSTRAINT_FIELDS,
  "cost",
  "targetEntityType",
  "selectionScope",
  "relation",
  "current",
  "projection",
  "candidateLimit",
  "externalSupportInterpretation"
]);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function all(values, predicate) {
  return array(values).every(predicate);
}

function entityReference(value, expectedType = null) {
  if (typeof value === "string") return Boolean(value.trim());
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!String(value.rawText ?? value.resolvedId ?? "").trim()) return false;
  return !expectedType || value.expectedType === expectedType;
}

function validateConstraintValue(field, value) {
  if (field === "cost") {
    const costs = Array.isArray(value) ? value : [value];
    return costs.length > 0 && costs.every((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 9);
  }
  if (field === "targetEntityType") return ["champion", "unit", "item", "trait"].includes(value);
  if (field === "selectionScope") return ["last_result", "current_visible_results"].includes(value);
  if (field === "relation") return value === "member_of_trait";
  if (field === "current") return typeof value === "boolean";
  if (field === "projection") {
    return Array.isArray(value) && value.length <= 20 && value.every((entry) => typeof entry === "string");
  }
  if (field === "candidateLimit") return Number.isInteger(value) && value >= 1 && value <= 5;
  if (field === "externalSupportInterpretation") {
    return ["non_trait_splash_unit", "emblem_carrier"].includes(value);
  }
  if (field === "days") return Number.isInteger(value) && value >= 1 && value <= 30;
  if (field === "minSamples") return Number.isInteger(value) && value >= 0 && value <= 1_000_000;
  if (field === "limit" || field === "itemCount") {
    return Number.isInteger(value) && value >= 1 && value <= (field === "limit" ? 100 : 3);
  }
  if (field === "specialMode" || field === "beginnerFriendly") return typeof value === "boolean";
  if (field === "reroll") return typeof value === "boolean";
  if (field === "rank" || field === "rankFilter") return Array.isArray(value) && all(value, (entry) => RANKS.has(entry));
  if (field === "starLevel") return Array.isArray(value) && all(value, (entry) => [1, 2, 3, 4].includes(entry));
  if (field === "metrics") return Array.isArray(value) && all(value, (entry) => METRICS.has(entry));
  if (field === "sort") return SORTS.has(value);
  if (field === "strategy") return value === null || STRATEGIES.has(value);
  if (field === "itemPolicy") return ITEM_POLICIES.has(value);
  if (field === "itemCategories") return Array.isArray(value) && all(value, (entry) => ITEM_CATEGORIES.has(entry));
  if (["patch", "queue", "contested", "primaryMetric", "performanceItem"].includes(field)) {
    return typeof value === "string" && value.length > 0 && value.length <= 120;
  }
  if (field === "traitFilters") return Array.isArray(value) && all(value, (entry) => entityReference(entry, "trait"));
  if ([
    "lockedItems",
    "ownedItems",
    "excludedItems",
    "avoidItemComponents",
    "comparisonItems"
  ].includes(field)) {
    return Array.isArray(value) && all(value, (entry) => entityReference(entry, "item"));
  }
  if (field === "comp") return value === null || entityReference(value, "composition");
  return false;
}

function validateOperation(operation) {
  if (!TURN_DELTA_CONSTRAINT_FIELDS.includes(operation.field)) return true;
  if (operation.operation === "clear") return true;
  if (!validateConstraintValue(operation.field, operation.value)) {
    return [`value is invalid for ${operation.field}`];
  }
  if (
    operation.operation === "replace"
    && !validateConstraintValue(operation.field, operation.oldValue)
  ) {
    return [`oldValue is invalid for ${operation.field}`];
  }
  return true;
}

function validateTaskFrame(frame) {
  const errors = [];
  for (const [field, value] of Object.entries(frame?.constraints ?? {})) {
    if (!TFT_EXPLICIT_TASK_CONSTRAINT_FIELDS.has(field)) {
      errors.push(`constraints.${field} is unsupported`);
      continue;
    }
    if (!validateConstraintValue(field, value)) {
      errors.push(`constraints.${field} is invalid`);
    }
  }
  if (frame?.constraints?.strategy === "reroll" && frame?.constraints?.reroll === false) {
    errors.push("constraints.strategy conflicts with constraints.reroll");
  }
  return errors;
}

function validateResolvedTaskFrame(frame) {
  if (frame.domain !== "tft") return { decision: "unsupported", missingFields: [] };
  if (frame.understandingStatus === "understood_but_unsupported") {
    return { decision: "unsupported", missingFields: [] };
  }
  if (["ambiguous", "understood_but_missing_context"].includes(frame.understandingStatus)) {
    return {
      decision: "clarify",
      missingFields: frame.ambiguities.flatMap((entry) => entry?.missingFields ?? [])
    };
  }
  if (frame.action === "unknown") return { decision: "clarify", missingFields: ["action"] };
  return { decision: "execute", missingFields: [] };
}

function normalizeResolvedTaskFrame(frame) {
  const constraints = structuredClone(frame.constraints ?? {});
  if (constraints.rank === undefined && constraints.rankFilter !== undefined) {
    constraints.rank = constraints.rankFilter;
  }
  delete constraints.rankFilter;
  if (constraints.lockedItems === undefined && constraints.ownedItems !== undefined) {
    constraints.lockedItems = constraints.ownedItems;
  }
  delete constraints.ownedItems;
  if (constraints.strategy === undefined && constraints.specialMode === true) {
    constraints.strategy = "reroll";
  }
  delete constraints.specialMode;
  // `rank_options` is a generic semantic goal shared by unit, item, and
  // composition ranking tools. Keep it generic here and let capability
  // matching select the concrete tool from the resolved entities.
  const compositionGoal = ["comp_rankings", "composition_rankings"].includes(frame.goal);
  return createTaskFrame({
    ...frame,
    action: compositionGoal ? "rank" : frame.action,
    goal: compositionGoal ? "comp_rankings" : frame.goal,
    constraints
  });
}

function normalizeTurnDelta(delta) {
  const scalarFields = new Set([
    "patch",
    "days",
    "queue",
    "minSamples",
    "sort",
    "limit",
    "specialMode",
    "strategy",
    "reroll",
    "contested",
    "beginnerFriendly",
    "itemPolicy",
    "primaryMetric",
    "performanceItem",
    "comp"
  ]);
  const constraintOperations = (delta.constraintOperations ?? []).map((operation) => {
    const next = structuredClone(operation);
    if (
      next.operation === "remove"
      && Array.isArray(next.value)
      && next.value.length === 0
    ) {
      return {
        operation: "clear",
        field: next.field
      };
    }
    if (
      scalarFields.has(next.field)
      && Array.isArray(next.value)
      && next.value.length === 1
    ) next.value = next.value[0];
    if (
      scalarFields.has(next.field)
      && Array.isArray(next.oldValue)
      && next.oldValue.length === 1
    ) next.oldValue = next.oldValue[0];
    return next;
  });
  const hasModification = constraintOperations.length > 0
    || (delta.entityOperations ?? []).length > 0;
  return {
    ...structuredClone(delta),
    taskRelation: hasModification && delta.taskRelation === "continue"
      ? "modify"
      : delta.taskRelation,
    dialogueAct: hasModification && delta.dialogueAct === "continue"
      ? "modify"
      : delta.dialogueAct,
    constraintOperations
  };
}

function normalizeSemanticInput(input, options = {}) {
  return normalizeTftSemanticInput(input, options);
}

export const tftConversationPolicy = Object.freeze({
  schemaVersion: TFT_CONVERSATION_POLICY_VERSION,
  constraintFields: TURN_DELTA_CONSTRAINT_FIELDS,
  semanticTurnDeltaPromptRules: Object.freeze([
    "itemPolicy is a scalar string containing only ordinary_only, include_special, include_artifact, include_radiant, or all_current. For an emblem use include_special, never emblem.",
    "itemCategories is always an array containing only ordinary, radiant, artifact, emblem, support, or set_special. For an emblem use [\"emblem\"], never the scalar \"emblem\".",
    "A request asking which champions should carry one named item or emblem is an item-carrier ranking: use action rank, goal rank_emblem_carriers, put the named equipment in candidates with expectedType item, and require item_carrier_statistics. Never classify it as comp_rankings.",
    "strategy is a scalar string containing only reroll, fast8, or fast9. Never use an array and never invent values such as no_gambling, non-vertical, stable, or flexible.",
    "Use reroll false for requests that exclude reroll or 赌狗 compositions. Use reroll true for requests that require them. Do not encode negation as strategy reroll.",
    "Use contested low for requests that prefer less-contested or 没那么卷 compositions. Use sort robust_first for stability. Use limit and presentation.requestedCount for an explicit result count.",
    "For a soft component preference such as 最好少用大剑 or 尽量减少大剑需求, put the item entity in constraints.avoidItemComponents. Use excludedItems only for a hard exclusion such as 不要大剑 or 完全不用大剑."
  ]),
  validateOperation,
  validateTaskFrame,
  validateConstraintValue,
  normalizeTurnDelta,
  normalizeSemanticInput,
  normalizeResolvedTaskFrame,
  validateResolvedTaskFrame
});
