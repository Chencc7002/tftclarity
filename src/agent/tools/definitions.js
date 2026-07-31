import { STRUCTURED_OPERATION_REGISTRY } from "../../retrieval/structured-retriever.js";
import { AGENT_TOOL_SCHEMA_VERSION } from "./registry.js";
import { ToolError } from "./tool-errors.js";

const DESCRIPTIONS = Object.freeze({
  unit_builds: "Use for current structured unit build statistics. Not for arbitrary URLs or model-generated facts. Input contains validated unit query constraints. Returns existing unit-build response data.",
  unit_builds_batch: "Compare current structured build statistics for at most five catalog-resolved units. The units must come from a prior registered tool step.",
  unit_comp_candidates: "Use for validated unit composition candidates. Not for global rankings. Input contains a unit and bounded sample scope. Returns existing candidate data.",
  item_carrier_rankings: "Use for current item-to-carrier statistics. Input requires one validated item and returns deterministic positive-uplift carrier aggregates with representative builds. Not for model-generated item advice.",
  comps_rankings: "Use for current composition rankings. Not for historical claims without evidence. Input contains validated ranking scope. Returns existing page-aligned ranking data.",
  comps_trends: "Use for composition trend retrieval. Not for causal claims. Input contains validated trend scope. Returns existing trend evidence.",
  comps_analysis: "Use for deterministic composition analysis evidence. Not for LLM-created statistics. Input contains validated analysis scope. Returns existing analysis inputs.",
  unit_details: "Use for current trusted unit catalog details. Not for live ranking statistics. Input requires an official unit apiName. Returns catalog data.",
  item_details: "Use for current trusted item catalog details. Not for ranking equipment strength. Input requires an official item apiName. Returns catalog data.",
  trait_details: "Use for current trusted trait catalog details. Not for live composition strength. Input requires an official trait apiName. Returns catalog data.",
  entity_catalog_query: "Query current TFT units, items or traits with bounded structured filters. Use for collection questions such as units of a given cost that belong to a trait.",
  composition_member_statistics: "Aggregate current composition samples by unit and optionally exclude native members of a target trait. Use for non-trait splash-unit statistics, never emblem-carrier rankings.",
  semantic_search: "Use for static semantic recall of aliases and descriptions. Not for realtime statistics or strength ranking. Input contains a bounded query and filters. Returns semantic candidates."
});

const CAPABILITIES = Object.freeze({
  unit_builds: Object.freeze([
    Object.freeze({
      action: "recommend",
      requiredEntityTypes: ["champion"],
      allowedEntityTypes: ["champion", "item", "trait", "composition", "patch"],
      features: ["unit_build_statistics"],
      goals: ["recommend_best_option"],
      outputs: ["recommendation", "ranking", "evidence"]
    }),
    Object.freeze({
      action: "compare",
      requiredEntityTypes: ["champion", "item"],
      allowedEntityTypes: ["champion", "item", "trait", "composition", "patch"],
      goals: ["choose_best"],
      outputs: ["recommendation", "comparison", "evidence"]
    }),
    Object.freeze({
      action: "rank",
      requiredEntityTypes: ["champion"],
      allowedEntityTypes: ["champion", "item", "trait", "composition", "patch"],
      outputs: ["ranking", "evidence"]
    }),
    Object.freeze({
      action: "analyze",
      requiredEntityTypes: ["champion"],
      allowedEntityTypes: ["champion", "item", "trait", "composition", "patch"],
      goals: ["analyze_evidence"],
      outputs: ["analysis", "ranking", "evidence"]
    }),
    Object.freeze({
      action: "search",
      requiredEntityTypes: ["champion"],
      allowedEntityTypes: ["champion", "item", "trait", "composition", "patch"],
      goals: ["find_relevant_data"],
      outputs: ["results", "ranking", "evidence"]
    })
  ]),
  unit_builds_batch: Object.freeze([
    Object.freeze({
      action: "search",
      allowedEntityTypes: ["champion", "trait", "patch"],
      allowNoEntities: true,
      requiredConstraints: ["targetEntityType"],
      features: ["unit_build_statistics"],
      outputs: ["results", "ranking", "evidence"]
    }),
    Object.freeze({
      action: "recommend",
      allowedEntityTypes: ["champion", "trait", "patch"],
      allowNoEntities: true,
      requiredConstraints: ["targetEntityType"],
      features: ["unit_build_statistics"],
      outputs: ["recommendation", "ranking", "evidence"]
    }),
    Object.freeze({
      action: "analyze",
      allowedEntityTypes: ["champion", "trait", "patch"],
      allowNoEntities: true,
      requiredConstraints: ["targetEntityType"],
      features: ["unit_build_statistics"],
      outputs: ["analysis", "ranking", "evidence"]
    })
  ]),
  unit_comp_candidates: Object.freeze([
    Object.freeze({
      action: "search",
      requiredEntityTypes: ["champion", "composition"],
      allowedEntityTypes: ["champion", "composition", "trait"],
      outputs: ["results", "composition_candidates", "evidence"]
    }),
    Object.freeze({
      action: "recommend",
      requiredEntityTypes: ["champion", "composition"],
      allowedEntityTypes: ["champion", "composition", "trait", "item"],
      goals: ["recommend_best_option"],
      outputs: ["composition_candidates", "evidence"]
    })
  ]),
  item_carrier_rankings: Object.freeze([
    Object.freeze({
      action: "recommend",
      requiredEntityTypes: ["item"],
      allowedEntityTypes: ["item", "patch"],
      goals: ["recommend_best_option"],
      features: ["item_carrier_statistics"],
      outputs: ["ranking", "evidence"]
    }),
    Object.freeze({
      action: "rank",
      requiredEntityTypes: ["item"],
      allowedEntityTypes: ["item", "patch"],
      goals: ["rank_options"],
      features: ["item_carrier_statistics"],
      outputs: ["ranking", "evidence"]
    }),
    Object.freeze({
      action: "search",
      requiredEntityTypes: ["item"],
      allowedEntityTypes: ["item", "patch"],
      goals: ["find_relevant_data", "rank_emblem_carriers"],
      features: ["item_carrier_statistics"],
      outputs: ["results", "ranking", "evidence"]
    })
  ]),
  comps_rankings: Object.freeze([
    Object.freeze({
      action: "rank",
      requiredEntityTypes: ["champion", "composition"],
      allowedEntityTypes: ["composition", "trait", "champion", "game_concept", "patch"],
      goals: ["rank_options"],
      outputs: ["ranking", "evidence"]
    }),
    Object.freeze({
      action: "recommend",
      requiredEntityTypes: ["champion", "composition"],
      allowedEntityTypes: ["composition", "trait", "champion", "game_concept", "patch"],
      goals: ["recommend_best_option"],
      outputs: ["recommendation", "ranking", "evidence"]
    }),
    Object.freeze({
      action: "rank",
      allowedEntityTypes: ["composition", "trait", "champion", "game_concept", "patch"],
      allowNoEntities: true,
      goals: ["rank_options"],
      outputs: ["ranking", "evidence"]
    }),
    Object.freeze({
      action: "recommend",
      allowedEntityTypes: ["composition", "trait", "champion", "game_concept", "patch"],
      allowNoEntities: true,
      goals: ["recommend_best_option"],
      outputs: ["recommendation", "ranking", "evidence"]
    })
  ]),
  comps_trends: Object.freeze([
    Object.freeze({
      action: "analyze",
      allowedEntityTypes: ["composition", "trait", "champion", "game_concept", "patch"],
      allowNoEntities: true,
      goals: ["analyze_evidence"],
      requiredConstraints: ["trend"],
      outputs: ["analysis", "ranking", "evidence"]
    })
  ]),
  comps_analysis: Object.freeze([
    Object.freeze({
      action: "analyze",
      allowedEntityTypes: ["composition", "trait", "champion", "game_concept", "patch"],
      allowNoEntities: true,
      goals: ["analyze_evidence"],
      outputs: ["analysis", "evidence"]
    })
  ]),
  unit_details: Object.freeze([
    Object.freeze({
      action: "explain",
      requiredEntityTypes: ["champion"],
      allowedEntityTypes: ["champion"],
      outputs: ["explanation", "evidence"]
    })
  ]),
  item_details: Object.freeze([
    Object.freeze({
      action: "explain",
      requiredEntityTypes: ["item"],
      allowedEntityTypes: ["item"],
      outputs: ["explanation", "evidence"]
    })
  ]),
  trait_details: Object.freeze([
    Object.freeze({
      action: "explain",
      requiredEntityTypes: ["trait"],
      allowedEntityTypes: ["trait"],
      outputs: ["explanation", "evidence"]
    })
  ]),
  entity_catalog_query: Object.freeze([
    Object.freeze({
      action: "search",
      allowedEntityTypes: ["champion", "item", "trait", "game_concept", "patch"],
      allowNoEntities: true,
      requiredConstraints: ["targetEntityType"],
      features: ["entity_catalog_filtering"],
      outputs: ["results", "entity_details", "evidence"]
    }),
    Object.freeze({
      action: "recommend",
      allowedEntityTypes: ["champion", "item", "trait", "game_concept", "patch"],
      allowNoEntities: true,
      requiredConstraints: ["targetEntityType"],
      features: ["entity_catalog_filtering"],
      outputs: ["results", "entity_details", "evidence"]
    }),
    Object.freeze({
      action: "analyze",
      allowedEntityTypes: ["champion", "item", "trait", "game_concept", "patch"],
      allowNoEntities: true,
      requiredConstraints: ["targetEntityType"],
      features: ["entity_catalog_filtering"],
      outputs: ["results", "entity_details", "evidence"]
    })
  ]),
  composition_member_statistics: Object.freeze([
    Object.freeze({
      action: "search",
      requiredEntityTypes: ["trait", "game_concept"],
      allowedEntityTypes: ["trait", "game_concept", "patch"],
      features: ["composition_external_unit_statistics"],
      outputs: ["results", "ranking", "evidence"]
    }),
    Object.freeze({
      action: "analyze",
      requiredEntityTypes: ["trait", "game_concept"],
      allowedEntityTypes: ["trait", "game_concept", "patch"],
      features: ["composition_external_unit_statistics"],
      outputs: ["analysis", "ranking", "evidence"]
    })
  ]),
  semantic_search: Object.freeze([
    Object.freeze({
      action: "search",
      allowedEntityTypes: ["game_concept", "composition", "patch", "champion", "item", "trait"],
      allowNoEntities: true,
      outputs: ["results", "evidence"]
    }),
    Object.freeze({
      action: "recommend",
      requiredEntityTypes: ["game_concept"],
      allowedEntityTypes: ["game_concept", "composition"],
      goals: ["recommend_best_option"],
      outputs: ["recommendation", "composition_candidates", "evidence"]
    }),
    Object.freeze({
      action: "explain",
      requiredEntityTypes: ["patch"],
      allowedEntityTypes: ["patch"],
      goals: ["explain_concept_or_entity"],
      outputs: ["explanation", "evidence"]
    })
  ])
});

const EVIDENCE_TYPES = Object.freeze({
  unit_builds: "unit_build_statistics",
  unit_builds_batch: "unit_build_batch_statistics",
  unit_comp_candidates: "composition_candidates",
  item_carrier_rankings: "item_carrier_statistics",
  comps_rankings: "composition_rankings",
  comps_trends: "composition_trends",
  comps_analysis: "composition_analysis",
  unit_details: "official_unit",
  item_details: "official_item",
  trait_details: "official_trait",
  entity_catalog_query: "official_entity_catalog",
  composition_member_statistics: "trait_external_unit_statistics",
  semantic_search: "semantic_candidates"
});

const PARAMETER_SCHEMAS = Object.freeze({
  unit: { type: "string" },
  item: { type: "string" },
  mention: { type: "string" },
  apiName: { type: "string" },
  days: { type: "integer" },
  patch: { type: "string" },
  queue: { type: ["string", "number"] },
  rank: { type: "array", items: { type: "string" } },
  starLevel: { type: "array", items: { type: "integer" } },
  itemCount: { type: "integer" },
  traitFilters: { type: "array", items: { type: "string" } },
  comp: { type: ["object", "null"] },
  itemPolicy: { type: "string" },
  itemCategories: { type: "array", items: { type: "string" } },
  lockedItems: { type: "array", items: { type: "string" } },
  excludedItems: { type: "array", items: { type: "string" } },
  comparisonItems: { type: "array", items: { type: "string" } },
  minSamples: { type: "integer" },
  strategy: { type: "string" },
  metrics: { type: "array", items: { type: "string" } },
  limit: { type: "integer" },
  query: { type: "string" },
  documentTypes: { type: "array", items: { type: "string" } },
  locale: { type: "string" },
  topK: { type: "integer" },
  buildLimit: { type: "integer" },
  positiveOnly: { type: "boolean" },
  sort: { type: "string" },
  entityType: { type: "string", enum: ["unit", "item", "trait"] },
  filters: {
    type: "object",
    additionalProperties: false,
    properties: {
      cost: { oneOf: [{ type: "integer" }, { type: "array", items: { type: "integer" } }] },
      traits: { type: "array", items: { type: "string" } },
      apiNames: { type: "array", items: { type: "string" } },
      categories: { type: "array", items: { type: "string" } },
      current: { type: "boolean" },
      obtainable: { type: "boolean" }
    }
  },
  projection: { type: "array", items: { type: "string" } },
  trait: { type: "string" },
  memberMode: { type: "string", enum: ["all_members", "non_trait_members"] },
  aggregateBy: { type: "string", enum: ["unit"] },
  entities: {
    type: "array",
    maxItems: 5,
    items: {
      type: "object",
      additionalProperties: true,
      required: ["apiName"],
      properties: { apiName: { type: "string" }, name: { type: "string" } }
    }
  }
});

const REQUIRED_PARAMETERS = Object.freeze({
  unit_builds: Object.freeze(["unit"]),
  unit_builds_batch: Object.freeze(["entities"]),
  unit_comp_candidates: Object.freeze(["unit", "mention"]),
  item_carrier_rankings: Object.freeze(["item"]),
  unit_details: Object.freeze(["apiName"]),
  item_details: Object.freeze(["apiName"]),
  trait_details: Object.freeze(["apiName"]),
  entity_catalog_query: Object.freeze(["entityType"]),
  composition_member_statistics: Object.freeze(["trait"]),
  semantic_search: Object.freeze(["query"])
});

export function createStructuredToolDefinitions(options = {}) {
  return Object.entries(STRUCTURED_OPERATION_REGISTRY).map(([name, registration]) => ({
    schemaVersion: AGENT_TOOL_SCHEMA_VERSION,
    name,
    version: "1",
    description: DESCRIPTIONS[name] ?? `Use only for allowlisted ${name} retrieval. Not for arbitrary operations. Returns existing deterministic data.`,
    capabilities: CAPABILITIES[name] ?? [],
    source: registration.source,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: REQUIRED_PARAMETERS[name] ?? [],
      properties: Object.fromEntries(registration.params.map((parameter) => [
        parameter,
        PARAMETER_SCHEMAS[parameter] ?? {}
      ]))
    },
    outputSchema: null,
    readOnly: true,
    riskLevel: "low",
    timeoutMs: Number(options.timeoutByTool?.[name] ?? options.defaultTimeoutMs ?? 5000),
    idempotent: true,
    cacheable: true,
    trustTier: "first_party",
    sideEffect: "none",
    requiresApproval: false,
    permissions: [`${registration.source}:read`],
    credentialScope: "none",
    evidenceType: EVIDENCE_TYPES[name] ?? "structured_evidence",
    execute: async (input, context = {}) => {
      if (typeof context.handler !== "function") {
        throw new ToolError(`Tool handler is unavailable: ${name}`, {
          code: "tool_not_available",
          toolName: name,
          recoverable: true
        });
      }
      return context.handler(input, context);
    }
  }));
}
