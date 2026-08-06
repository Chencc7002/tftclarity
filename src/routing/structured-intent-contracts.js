export const STRUCTURED_INTENT_CONTRACTS_SCHEMA_VERSION = "structured_intent_contracts.v1";

const CHAMPION = Object.freeze({
  entityType: "champion",
  paths: Object.freeze(["unit", "query.unit", "apiName", "query.apiName"])
});

const ITEM = Object.freeze({
  entityType: "item",
  paths: Object.freeze([
    "carrierItem",
    "item",
    "query.carrierItem",
    "query.item",
    "apiName",
    "query.apiName"
  ])
});

const TRAIT = Object.freeze({
  entityType: "trait",
  paths: Object.freeze([
    "trait",
    "query.trait",
    "apiName",
    "query.apiName",
    "traitFilters",
    "query.traitFilters"
  ])
});

function contract(operation, requiredEntities = []) {
  return Object.freeze({
    operation,
    requiredEntities: Object.freeze(requiredEntities)
  });
}

export const STRUCTURED_INTENT_CONTRACTS = Object.freeze({
  unit_build_rankings: contract("unit_builds", [CHAMPION]),
  unit_build_completion: contract("unit_builds", [CHAMPION]),
  unit_best_3_items: contract("unit_builds", [CHAMPION]),
  unit_item_rankings: contract("unit_builds", [CHAMPION]),
  unit_item_comparison: contract("unit_builds", [CHAMPION]),
  unit_item_availability: contract("unit_builds", [CHAMPION]),
  unit_emblem_rankings: contract("unit_builds", [CHAMPION]),
  item_carrier_rankings: contract("item_carrier_rankings", [ITEM]),
  comp_rankings: contract("comps_rankings"),
  comp_trends: contract("comps_trends"),
  comp_analysis: contract("comps_analysis"),
  unit_details: contract("unit_details", [CHAMPION]),
  item_details: contract("item_details", [ITEM]),
  trait_details: contract("trait_details", [TRAIT])
});

function valueAtPath(value, path) {
  return String(path).split(".").reduce(
    (current, key) => current?.[key],
    value
  );
}

function present(value) {
  if (Array.isArray(value)) return value.some(present);
  if (typeof value === "string") return Boolean(value.trim());
  return value !== null && value !== undefined && value !== false;
}

function entityPresent(parsed, entity) {
  return entity.paths.some((path) => present(valueAtPath(parsed, path)));
}

export function structuredIntentReadiness(parsed = {}) {
  const intent = String(parsed?.intent ?? parsed?.query?.intent ?? "").trim();
  const contractValue = STRUCTURED_INTENT_CONTRACTS[intent] ?? null;
  if (!contractValue) {
    return {
      schemaVersion: STRUCTURED_INTENT_CONTRACTS_SCHEMA_VERSION,
      intent: intent || null,
      registered: false,
      executable: false,
      operation: null,
      requiredEntities: [],
      missingEntities: []
    };
  }
  const requiredEntities = contractValue.requiredEntities.map((entity) => entity.entityType);
  const missingEntities = contractValue.requiredEntities
    .filter((entity) => !entityPresent(parsed, entity))
    .map((entity) => entity.entityType);
  return {
    schemaVersion: STRUCTURED_INTENT_CONTRACTS_SCHEMA_VERSION,
    intent,
    registered: true,
    executable: missingEntities.length === 0,
    operation: contractValue.operation,
    requiredEntities,
    missingEntities
  };
}

export function isStructuredIntentExecutable(parsed = {}) {
  return structuredIntentReadiness(parsed).executable;
}
