export const INTENT_ENVELOPE_SCHEMA_VERSION = "intent_envelope.v1";
export const RETRIEVAL_PLAN_SCHEMA_VERSION = "retrieval_plan.v1";
export const SEMANTIC_HIT_SCHEMA_VERSION = "semantic_hit.v1";
export const EVIDENCE_PACK_SCHEMA_VERSION = "llm_evidence_pack.v2";

const DETAIL_INTENTS = new Set(["unit_details", "item_details", "trait_details"]);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(array(values).filter((value) => value !== undefined && value !== null))];
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function entityName(record, entityType) {
  if (!record) return null;
  if (entityType === "trait") return record.displayName ?? record.zhName ?? record.shortName ?? record.apiName;
  if (entityType === "item") return record.preferredDisplayName ?? record.shortName ?? record.zhName ?? record.apiName;
  return record.zhName ?? record.shortName ?? record.displayName ?? record.apiName;
}

function recordFor(catalog, entityType, apiName) {
  if (!apiName) return null;
  if (entityType === "unit") return catalog?.unitByApiName?.get?.(apiName) ?? null;
  if (entityType === "item") return catalog?.itemByApiName?.get?.(apiName) ?? null;
  if (entityType === "trait") {
    return catalog?.traitByFilterId?.get?.(apiName) ?? catalog?.traitByApiName?.get?.(apiName) ?? null;
  }
  return null;
}

function resolutionFor(match) {
  if (match?.matchType === "high_confidence_fuzzy") return "semantic_fuzzy";
  if (match?.matchType) return match.matchType;
  if (match?.source === "catalog_alias") return "exact_alias";
  return "exact_catalog";
}

function buildEntities(parsed, query, catalog) {
  const matches = array(parsed?.parser?.entityMatches);
  const values = [];
  const seen = new Set();
  const add = (entityType, apiName, mention = null, match = null) => {
    if (!apiName) return;
    const key = `${entityType}:${apiName}`;
    if (seen.has(key)) return;
    seen.add(key);
    const record = recordFor(catalog, entityType, apiName);
    values.push({
      type: entityType,
      mention: mention ?? match?.alias ?? entityName(record, entityType) ?? String(apiName),
      apiName: String(apiName),
      canonicalName: entityName(record, entityType) ?? String(apiName),
      confidence: finite(match?.confidence, record ? 1 : 0.8),
      resolution: resolutionFor(match),
      patch: record?.patch ?? query?.patch ?? catalog?.version ?? null,
      locale: "zh-CN"
    });
  };

  for (const match of matches) add(match.entityType, match.apiName, match.alias, match);
  add("unit", query?.unit ?? parsed?.unit, parsed?.unitAlias, matches.find((match) => match.entityType === "unit"));
  for (const apiName of unique([
    ...array(query?.lockedItems),
    ...array(query?.comparisonItems),
    ...array(query?.excludedItems)
  ])) add("item", apiName, null, matches.find((match) => match.entityType === "item" && match.apiName === apiName));
  for (const apiName of unique(query?.traitFilters)) {
    add("trait", apiName, null, matches.find((match) => match.entityType === "trait" && match.apiName === apiName));
  }
  return values;
}

function metricsFor(intent, query) {
  const explicit = unique(query?.requestedMetrics ?? query?.metrics);
  if (explicit.length) return explicit;
  if (intent === "comp_trends") return ["placementImprovement", "pickRate", "games", "trendScore"];
  if (intent === "comp_rankings") return ["top4Rate", "winRate", "avgPlacement", "pickRate", "games"];
  if (["unit_build_rankings", "unit_build_completion", "unit_best_3_items"].includes(intent)) {
    return ["games", "avgPlacement", "top4Rate", "winRate"];
  }
  if (["unit_item_rankings", "unit_emblem_rankings"].includes(intent)) {
    return ["coverage", "games", "avgPlacement", "top4Rate", "winRate"];
  }
  if (intent === "unit_item_comparison") return [query?.primaryMetric ?? "top4Rate", "games", "avgPlacement", "top4Rate", "winRate"];
  return [];
}

export function createIntentEnvelope({ input = "", parsed = {}, query = {}, validation = {}, clarification = null, catalog = null } = {}) {
  const intent = query?.intent ?? parsed?.intent ?? null;
  const entities = buildEntities(parsed, query, catalog);
  const unresolved = array(parsed?.parser?.unresolvedEntityHints);
  const conflicts = [
    ...array(parsed?.parser?.constraintConflicts),
    ...array(parsed?.parser?.entityAmbiguities)
  ];
  const needsClarification = Boolean(
    clarification?.needsClarification
    || clarification?.blocking
    || validation?.valid === false
    || unresolved.length
    || conflicts.length
  );
  const minimumEntityConfidence = entities.length
    ? Math.min(...entities.map((entity) => finite(entity.confidence, 0)))
    : (DETAIL_INTENTS.has(intent) ? 0 : 1);
  const confidence = needsClarification
    ? Math.min(0.49, minimumEntityConfidence)
    : Math.max(0, Math.min(1, finite(parsed?.confidence, minimumEntityConfidence)));
  return {
    schemaVersion: INTENT_ENVELOPE_SCHEMA_VERSION,
    input: String(input ?? parsed?.rawInput ?? "").slice(0, 500),
    intent,
    confidence,
    entities,
    constraints: {
      days: finite(query?.days),
      minSamples: finite(query?.minSamples),
      rankFilter: unique(query?.rankFilter).map(String),
      patch: query?.patch ?? null,
      queue: query?.queue ?? null,
      itemPolicy: query?.itemPolicy ?? null,
      itemCategories: unique(query?.itemCategories).map(String),
      lockedItems: unique(query?.lockedItems).map(String),
      excludedItems: unique(query?.excludedItems).map(String),
      comparisonItems: unique(query?.comparisonItems).map(String),
      metrics: unique(query?.metrics).map(String),
      limit: finite(query?.limit),
      trendRequested: Boolean(query?.trendRequested)
    },
    requestedMetrics: metricsFor(intent, query),
    needsClarification,
    warnings: unique([
      ...array(query?.warnings),
      ...array(validation?.warnings),
      ...array(validation?.errors),
      ...conflicts.map((conflict) => typeof conflict === "string" ? conflict : JSON.stringify(conflict)),
      ...unresolved.map((hint) => `unresolved_${hint.entityType ?? "entity"}:${hint.inputFragment ?? ""}`)
    ]).map(String)
  };
}

export function validateIntentEnvelope(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) errors.push("IntentEnvelope must be an object");
  if (value?.schemaVersion !== INTENT_ENVELOPE_SCHEMA_VERSION) errors.push(`schemaVersion must be ${INTENT_ENVELOPE_SCHEMA_VERSION}`);
  if (typeof value?.intent !== "string" || !value.intent) errors.push("intent is required");
  if (!Number.isFinite(value?.confidence) || value.confidence < 0 || value.confidence > 1) errors.push("confidence must be between 0 and 1");
  for (const key of ["entities", "requestedMetrics", "warnings"]) {
    if (!Array.isArray(value?.[key])) errors.push(`${key} must be an array`);
  }
  if (!value?.constraints || typeof value.constraints !== "object" || Array.isArray(value.constraints)) errors.push("constraints must be an object");
  if (typeof value?.needsClarification !== "boolean") errors.push("needsClarification must be boolean");
  return { valid: errors.length === 0, errors, value: errors.length === 0 ? value : null };
}

export function createRetrievalPlan(value = {}) {
  return {
    schemaVersion: RETRIEVAL_PLAN_SCHEMA_VERSION,
    intent: value.intent ?? null,
    structuredQueries: array(value.structuredQueries),
    semanticQueries: array(value.semanticQueries),
    evidenceBudget: {
      maxItems: Math.max(1, Math.floor(finite(value.evidenceBudget?.maxItems, 40))),
      maxCharacters: Math.max(256, Math.floor(finite(value.evidenceBudget?.maxCharacters, 16000)))
    },
    requiredEvidence: unique(value.requiredEvidence).map(String),
    promptKey: value.promptKey ?? null,
    needsClarification: Boolean(value.needsClarification),
    warnings: unique(value.warnings).map(String)
  };
}

export function createSemanticHit(value = {}) {
  return {
    schemaVersion: SEMANTIC_HIT_SCHEMA_VERSION,
    id: String(value.id ?? ""),
    documentType: String(value.documentType ?? ""),
    score: finite(value.score, 0),
    ...(value.apiName ? { apiName: String(value.apiName) } : {}),
    ...(value.intent ? { intent: String(value.intent) } : {}),
    patch: value.patch ?? null,
    locale: value.locale ?? null,
    source: value.source ?? null,
    metadata: value.metadata && typeof value.metadata === "object" ? { ...value.metadata } : {}
  };
}

export function createEvidencePack(value = {}) {
  return {
    schemaVersion: EVIDENCE_PACK_SCHEMA_VERSION,
    request: value.request ?? {},
    query: value.query ?? {},
    structuredEvidence: array(value.structuredEvidence),
    semanticEvidence: array(value.semanticEvidence),
    derivedSignals: value.derivedSignals ?? {},
    warnings: unique(value.warnings).map(String),
    dataStatus: value.dataStatus ?? {},
    generationRules: value.generationRules ?? {}
  };
}
