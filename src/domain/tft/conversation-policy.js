import { TURN_DELTA_CONSTRAINT_FIELDS } from "../../understanding/turn-delta.js";
import { createTaskFrame } from "../../understanding/task-frame.js";

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
const SORTS = new Set(["top4_first", "win_first", "avg_first", "games_first", "robust_first"]);
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
  if (field === "days") return Number.isInteger(value) && value >= 1 && value <= 30;
  if (field === "minSamples") return Number.isInteger(value) && value >= 0 && value <= 1_000_000;
  if (field === "limit" || field === "itemCount") {
    return Number.isInteger(value) && value >= 1 && value <= (field === "limit" ? 100 : 3);
  }
  if (field === "specialMode" || field === "beginnerFriendly") return typeof value === "boolean";
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
  if (["lockedItems", "ownedItems", "excludedItems", "comparisonItems"].includes(field)) {
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
  const compositionGoal = ["comp_rankings", "composition_rankings", "rank_options"].includes(frame.goal);
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

export const tftConversationPolicy = Object.freeze({
  schemaVersion: TFT_CONVERSATION_POLICY_VERSION,
  constraintFields: TURN_DELTA_CONSTRAINT_FIELDS,
  validateOperation,
  validateConstraintValue,
  normalizeTurnDelta,
  normalizeResolvedTaskFrame,
  validateResolvedTaskFrame
});
