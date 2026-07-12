const VALID_INTENTS = new Set([
  "unit_best_3_items",
  "unit_item_availability",
  "unit_build_rankings",
  "unit_item_rankings",
  "unit_build_completion",
  "unit_item_comparison",
  "clarification",
  "comp_rankings"
]);

const VALID_COMP_METRICS = new Set([
  "top4_rate",
  "win_rate",
  "avg_placement",
  "popularity"
]);

const VALID_ITEM_POLICIES = new Set([
  "ordinary_only",
  "include_radiant",
  "include_artifact",
  "include_special"
]);

const VALID_SORTS = new Set([
  "top4_first",
  "win_first",
  "robust_first",
  "avg_first"
]);

const VALID_RANKS = new Set([
  "CHALLENGER",
  "GRANDMASTER",
  "MASTER",
  "DIAMOND",
  "EMERALD",
  "PLATINUM",
  "GOLD",
  "SILVER",
  "BRONZE",
  "IRON"
]);

const ALLOWED_ROOT_KEYS = new Set([
  "intent",
  "entities",
  "constraints",
  "needs_clarification",
  "needsClarification",
  "clarification_question",
  "clarificationQuestion"
]);

const ALLOWED_ENTITY_KEYS = new Set([
  "unit_mentions",
  "unitMentions",
  "item_mentions",
  "itemMentions",
  "trait_mentions",
  "traitMentions"
]);

const ALLOWED_CONSTRAINT_KEYS = new Set([
  "star_level",
  "starLevel",
  "item_count",
  "itemCount",
  "item_policy",
  "itemPolicy",
  "owned_items",
  "ownedItems",
  "excluded_items",
  "excludedItems",
  "min_samples",
  "minSamples",
  "sort",
  "rank_filter",
  "rankFilter",
  "days",
  "patch",
  "queue",
  "metrics",
  "limit"
]);

const ROOT_ALIAS_PAIRS = [
  ["needs_clarification", "needsClarification"],
  ["clarification_question", "clarificationQuestion"]
];

const ENTITY_ALIAS_PAIRS = [
  ["unit_mentions", "unitMentions"],
  ["item_mentions", "itemMentions"],
  ["trait_mentions", "traitMentions"]
];

const CONSTRAINT_ALIAS_PAIRS = [
  ["star_level", "starLevel"],
  ["item_count", "itemCount"],
  ["item_policy", "itemPolicy"],
  ["owned_items", "ownedItems"],
  ["excluded_items", "excludedItems"],
  ["min_samples", "minSamples"],
  ["rank_filter", "rankFilter"]
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(value, allowedKeys, path, errors) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`${path}.${key} is not supported`);
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireAnyKey(value, keys, path, errors) {
  if (!keys.some((key) => hasOwn(value, key))) {
    errors.push(`${path}.${keys[0]} is required`);
  }
}

function rejectDuplicateAliases(value, pairs, path, errors) {
  if (!isPlainObject(value)) return;
  for (const [snakeCase, camelCase] of pairs) {
    if (hasOwn(value, snakeCase) && hasOwn(value, camelCase)) {
      errors.push(`${path}.${snakeCase} and ${path}.${camelCase} cannot both be set`);
    }
  }
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function readArray(value, path, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  const result = [];
  for (const item of value) {
    if (typeof item !== "string" && typeof item !== "number") {
      errors.push(`${path} entries must be strings`);
      continue;
    }
    const normalized = String(item).trim();
    if (normalized) result.push(normalized);
  }
  return uniqueStrings(result);
}

function readInteger(value, path, errors, options = {}) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isInteger(number)) {
    errors.push(`${path} must be an integer`);
    return undefined;
  }
  if (options.min !== undefined && number < options.min) {
    errors.push(`${path} must be >= ${options.min}`);
  }
  if (options.max !== undefined && number > options.max) {
    errors.push(`${path} must be <= ${options.max}`);
  }
  return number;
}

function readString(value, path, errors, allowedValues = null) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" && typeof value !== "number") {
    errors.push(`${path} must be a string`);
    return undefined;
  }
  const stringValue = String(value).trim();
  if (!stringValue) return undefined;
  if (allowedValues && !allowedValues.has(stringValue)) {
    errors.push(`${path} is not supported: ${stringValue}`);
  }
  return stringValue;
}

function readBoolean(value, path, errors) {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") {
    errors.push(`${path} must be a boolean`);
    return false;
  }
  return value;
}

function readStarLevels(value, path, errors) {
  const values = readArray(value, path, errors)
    .map((item) => readInteger(item, path, errors, {
      min: 1,
      max: 3
    }))
    .filter((item) => item !== undefined);
  return [...new Set(values)];
}

function readRankFilter(value, path, errors) {
  return readArray(value, path, errors)
    .map((rank) => rank.toUpperCase())
    .filter((rank) => {
      const valid = VALID_RANKS.has(rank);
      if (!valid) errors.push(`${path} contains unsupported rank: ${rank}`);
      return valid;
    });
}

export function validateStructuredParserOutput(rawValue) {
  const errors = [];
  if (!isPlainObject(rawValue)) {
    return {
      valid: false,
      errors: ["structured parser output must be an object"],
      value: null
    };
  }

  rejectUnknownKeys(rawValue, ALLOWED_ROOT_KEYS, "output", errors);
  requireAnyKey(rawValue, ["intent"], "output", errors);
  requireAnyKey(rawValue, ["entities"], "output", errors);
  requireAnyKey(rawValue, ["constraints"], "output", errors);
  requireAnyKey(rawValue, ["needs_clarification", "needsClarification"], "output", errors);
  requireAnyKey(rawValue, ["clarification_question", "clarificationQuestion"], "output", errors);
  rejectDuplicateAliases(rawValue, ROOT_ALIAS_PAIRS, "output", errors);

  const entities = isPlainObject(rawValue.entities) ? rawValue.entities : {};
  if (rawValue.entities !== undefined && !isPlainObject(rawValue.entities)) {
    errors.push("entities must be an object");
  }
  rejectUnknownKeys(entities, ALLOWED_ENTITY_KEYS, "entities", errors);
  rejectDuplicateAliases(entities, ENTITY_ALIAS_PAIRS, "entities", errors);

  const constraints = isPlainObject(rawValue.constraints) ? rawValue.constraints : {};
  if (rawValue.constraints !== undefined && !isPlainObject(rawValue.constraints)) {
    errors.push("constraints must be an object");
  }
  rejectUnknownKeys(constraints, ALLOWED_CONSTRAINT_KEYS, "constraints", errors);
  rejectDuplicateAliases(constraints, CONSTRAINT_ALIAS_PAIRS, "constraints", errors);

  const intent = readString(rawValue.intent, "intent", errors, VALID_INTENTS);
  const itemPolicy = readString(
    constraints.item_policy ?? constraints.itemPolicy,
    "constraints.item_policy",
    errors,
    VALID_ITEM_POLICIES
  );
  const sort = readString(constraints.sort, "constraints.sort", errors, VALID_SORTS);
  const patch = readString(constraints.patch, "constraints.patch", errors);
  const queue = readString(constraints.queue, "constraints.queue", errors);
  const needsClarification = readBoolean(
    rawValue.needs_clarification ?? rawValue.needsClarification,
    "needs_clarification",
    errors
  );
  const clarificationQuestion = readString(
    rawValue.clarification_question ?? rawValue.clarificationQuestion,
    "clarification_question",
    errors
  ) ?? null;

  const value = {
    intent,
    entities: {
      unitMentions: readArray(entities.unit_mentions ?? entities.unitMentions, "entities.unit_mentions", errors),
      itemMentions: readArray(entities.item_mentions ?? entities.itemMentions, "entities.item_mentions", errors),
      traitMentions: readArray(entities.trait_mentions ?? entities.traitMentions, "entities.trait_mentions", errors)
    },
    constraints: {
      starLevel: readStarLevels(constraints.star_level ?? constraints.starLevel, "constraints.star_level", errors),
      itemCount: readInteger(constraints.item_count ?? constraints.itemCount, "constraints.item_count", errors, {
        min: 0,
        max: 3
      }),
      itemPolicy,
      ownedItemMentions: readArray(
        constraints.owned_items ?? constraints.ownedItems,
        "constraints.owned_items",
        errors
      ),
      excludedItemMentions: readArray(
        constraints.excluded_items ?? constraints.excludedItems,
        "constraints.excluded_items",
        errors
      ),
      minSamples: readInteger(constraints.min_samples ?? constraints.minSamples, "constraints.min_samples", errors, {
        min: 1,
        max: 100000
      }),
      sort,
      rankFilter: readRankFilter(constraints.rank_filter ?? constraints.rankFilter, "constraints.rank_filter", errors),
      days: readInteger(constraints.days, "constraints.days", errors, {
        min: 1,
        max: 30
      }),
      patch,
      queue,
      metrics: readArray(constraints.metrics, "constraints.metrics", errors).filter((metric) => {
        const valid = VALID_COMP_METRICS.has(metric);
        if (!valid) errors.push(`constraints.metrics contains unsupported metric: ${metric}`);
        return valid;
      }),
      limit: readInteger(constraints.limit, "constraints.limit", errors, { min: 1, max: 10 })
    },
    needsClarification,
    clarificationQuestion
  };

  if (intent === "comp_rankings") {
    const entityMentions = [
      ...value.entities.unitMentions,
      ...value.entities.itemMentions,
      ...value.entities.traitMentions,
      ...value.constraints.ownedItemMentions,
      ...value.constraints.excludedItemMentions
    ];
    if (entityMentions.length > 0) {
      errors.push("comp_rankings cannot include unit, item, or trait mentions");
    }
    if (value.constraints.starLevel.length > 0
      || value.constraints.itemCount !== undefined
      || value.constraints.itemPolicy !== undefined
      || value.constraints.sort !== undefined) {
      errors.push("comp_rankings cannot include single-unit item constraints");
    }
    if (value.constraints.metrics.length === 0) {
      errors.push("comp_rankings requires at least one metric");
    }
    if (value.constraints.limit === undefined) {
      errors.push("comp_rankings requires limit");
    }
  } else if (value.constraints.metrics.length > 0 || value.constraints.limit !== undefined) {
    errors.push("metrics and limit are only valid for comp_rankings");
  }

  if (needsClarification && !clarificationQuestion) {
    errors.push("clarification_question is required when needs_clarification is true");
  }

  return {
    valid: errors.length === 0,
    errors,
    value: errors.length === 0 ? value : null
  };
}

export function buildStructuredParserExpansion(value) {
  if (!value) return "";
  return uniqueStrings([
    ...(value.entities?.unitMentions ?? []),
    ...(value.entities?.itemMentions ?? []),
    ...(value.entities?.traitMentions ?? []),
    ...(value.constraints?.ownedItemMentions ?? []),
    ...(value.constraints?.excludedItemMentions ?? [])
  ]).join(" ");
}

export function shouldUseStructuredParser(parsed, options = {}) {
  if (!options.structuredParser) return false;
  const mode = options.useStructuredParser ?? "auto";
  if (mode === false || mode === "never") return false;
  if (mode === true || mode === "always" || options.forceStructuredParser) return true;
  if (parsed.intent === "comp_rankings") return false;
  if ((parsed.parser?.entityAmbiguities ?? []).length > 0) return false;
  if ((parsed.parser?.unresolvedEntityHints ?? []).length > 0) return true;
  if (parsed.parser?.exclusion?.requested && (parsed.excludedItems ?? []).length === 0) return true;
  return !parsed.unit;
}
