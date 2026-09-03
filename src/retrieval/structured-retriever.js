import { RETRIEVAL_PLAN_SCHEMA_VERSION } from "./contracts.js";

const OPERATION_REGISTRY = Object.freeze({
  unit_builds: Object.freeze({
    source: "metatft",
    params: Object.freeze([
      "unit", "days", "patch", "queue", "rank", "starLevel", "itemCount", "traitFilters",
      "comp", "itemPolicy", "itemCategories",
      "lockedItems", "excludedItems", "comparisonItems", "performanceItem", "minSamples"
    ])
  }),
  unit_comp_candidates: Object.freeze({
    source: "metatft",
    params: Object.freeze(["unit", "mention", "days", "patch", "queue", "rank", "minSamples"])
  }),
  unit_builds_batch: Object.freeze({
    source: "metatft",
    params: Object.freeze([
      "entities", "compositionId", "optionsPerUnit", "constraints", "starLevel", "days", "patch", "queue", "rank", "minSamples", "limit"
    ])
  }),
  item_carrier_rankings: Object.freeze({
    source: "metatft",
    params: Object.freeze([
      "item", "days", "patch", "queue", "rank", "minSamples", "limit",
      "buildLimit", "positiveOnly", "sort"
    ])
  }),
  comps_rankings: Object.freeze({
    source: "metatft",
    params: Object.freeze(["unit", "mention", "days", "patch", "queue", "rank", "minSamples", "metrics", "limit", "strategy"])
  }),
  composition_tactical_details: Object.freeze({
    source: "metatft",
    params: Object.freeze(["compositionId", "clusterId", "units", "seasonContextId"])
  }),
  composition_replacement_evaluation: Object.freeze({
    source: "metatft",
    params: Object.freeze([
      "compositionId", "targetApiName", "replacementApiName", "seasonContextId",
      "days", "patch", "queue", "rank"
    ])
  }),
  composition_change_evaluation: Object.freeze({
    source: "metatft",
    params: Object.freeze([
      "operation", "compositionId", "targetApiName", "incomingApiName", "seasonContextId",
      "days", "patch", "queue", "rank"
    ])
  }),
  comps_trends: Object.freeze({
    source: "metatft",
    params: Object.freeze(["days", "patch", "queue", "rank", "minSamples", "metrics", "limit", "direction", "strategy"])
  }),
  comps_analysis: Object.freeze({
    source: "metatft",
    params: Object.freeze(["mention", "days", "patch", "queue", "rank", "minSamples", "metrics", "limit", "strategy"])
  }),
  unit_details: Object.freeze({ source: "official_catalog", params: Object.freeze(["apiName"]) }),
  item_details: Object.freeze({ source: "official_catalog", params: Object.freeze(["apiName"]) }),
  item_details_batch: Object.freeze({
    source: "official_catalog",
    params: Object.freeze(["apiNames", "seasonContextId", "locale"])
  }),
  trait_details: Object.freeze({ source: "official_catalog", params: Object.freeze(["apiName"]) }),
  entity_catalog_query: Object.freeze({
    source: "official_tft_catalog",
    params: Object.freeze(["entityType", "filters", "projection", "sort", "limit"])
  }),
  composition_member_statistics: Object.freeze({
    source: "metatft",
    params: Object.freeze([
      "trait", "memberMode", "aggregateBy", "days", "patch", "queue", "rank", "minSamples", "limit"
    ])
  }),
  semantic_search: Object.freeze({
    source: "semantic_index",
    params: Object.freeze(["query", "documentTypes", "patch", "locale", "topK"])
  }),
  patch_facts: Object.freeze({
    source: "riot_patch_notes",
    params: Object.freeze(["patch", "locale"])
  }),
  strategy_video_search: Object.freeze({
    source: "bilibili",
    params: Object.freeze(["query", "ecosystem", "page", "limit"]),
    trustTier: "third_party",
    credentialScope: "bilibili_mcp",
    plannerAllowed: true
  })
});

function safeParams(query, registration) {
  const allowed = new Set(registration.params);
  const params = {};
  for (const [key, value] of Object.entries(query?.params ?? {})) {
    if (!allowed.has(key)) continue;
    params[key] = Array.isArray(value) ? [...value] : value;
  }
  return params;
}

export class StructuredRetrievalError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "StructuredRetrievalError";
    this.code = options.code ?? "structured_retrieval_error";
    this.operation = options.operation ?? null;
    this.recoverable = Boolean(options.recoverable);
  }
}

export class StructuredRetriever {
  constructor(options = {}) {
    this.handlers = { ...(options.handlers ?? {}) };
    this.onEvent = options.onEvent;
  }

  register(operation, handler) {
    if (!OPERATION_REGISTRY[operation]) throw new RangeError(`Cannot register unknown structured operation: ${operation}`);
    if (typeof handler !== "function") throw new TypeError("Structured operation handler must be a function");
    this.handlers[operation] = handler;
    return this;
  }

  async executeQuery(query, context = {}) {
    const registration = OPERATION_REGISTRY[query?.operation];
    if (!registration || query?.source !== registration.source) {
      throw new StructuredRetrievalError(`Structured operation is not allowlisted: ${query?.source ?? "missing"}/${query?.operation ?? "missing"}`, {
        code: "operation_not_allowed",
        operation: query?.operation
      });
    }
    const handler = this.handlers[query.operation];
    if (typeof handler !== "function") {
      throw new StructuredRetrievalError(`Structured operation is unavailable: ${query.operation}`, {
        code: "operation_unavailable",
        operation: query.operation,
        recoverable: true
      });
    }
    const startedAt = Date.now();
    const params = safeParams(query, registration);
    try {
      const value = await handler(params, context);
      const result = {
        queryId: String(query.id ?? `structured:${query.operation}`),
        source: registration.source,
        operation: query.operation,
        params,
        required: query.required !== false,
        value,
        metadata: {
          patch: value?.patch ?? params.patch ?? null,
          cluster: value?.cluster ?? value?.clusterId ?? null,
          updatedAt: value?.updatedAt ?? null,
          cache: value?.cache ?? null,
          durationMs: Date.now() - startedAt
        }
      };
      this.onEvent?.({ type: "structured_retrieval_completed", operation: query.operation, durationMs: result.metadata.durationMs });
      return result;
    } catch (error) {
      this.onEvent?.({ type: "structured_retrieval_failed", operation: query.operation, durationMs: Date.now() - startedAt });
      if (error instanceof StructuredRetrievalError) throw error;
      throw new StructuredRetrievalError(`Structured operation failed: ${query.operation}: ${error?.message ?? "unknown error"}`, {
        code: "operation_failed",
        operation: query.operation,
        recoverable: true,
        cause: error
      });
    }
  }

  async execute(plan, context = {}) {
    if (plan?.schemaVersion !== RETRIEVAL_PLAN_SCHEMA_VERSION) {
      throw new TypeError(`RetrievalPlan schemaVersion must be ${RETRIEVAL_PLAN_SCHEMA_VERSION}`);
    }
    if (plan.needsClarification) return [];
    const results = [];
    for (const query of plan.structuredQueries ?? []) {
      try {
        results.push(await this.executeQuery(query, context));
      } catch (error) {
        if (query.required !== false) throw error;
        results.push({
          queryId: String(query.id ?? `structured:${query.operation}`),
          source: query.source,
          operation: query.operation,
          required: false,
          value: null,
          error: error.code ?? "operation_failed"
        });
      }
    }
    return results;
  }
}

export function createStructuredRetriever(options = {}) {
  return new StructuredRetriever(options);
}

export { OPERATION_REGISTRY as STRUCTURED_OPERATION_REGISTRY };
